// Servidor de multimedia de Tux. Escucha solo en 127.0.0.1: el acceso desde fuera de casa entra por
// el túnel HTTPS de Cloudflare (server/tunnel/), que reenvía aquí sin abrir puertos en el router.
//   POST   /api/media/ticket              → ticket de lectura (requiere ID token de Firebase)
//   POST   /api/media                     → sube una prueba de una vez (requiere ID token)
//   POST   /api/media/uploads             → inicia una subida por trozos ({ mime, size })
//   PUT    /api/media/uploads/{id}?offset → añade un trozo (≤ 48 MB, bajo el límite de Cloudflare)
//   DELETE /api/media/users/{uid}/{file}  → borra un archivo (su dueño o un admin)
//   GET    /media/users/{uid}/{file}?k=   → sirve un archivo a usuarios con ticket válido (con rangos)
//   GET    /health                        → estado del servidor, del disco y URL pública del túnel
// No existen rutas de listado; la purga masiva solo se hace con admin.js.
import http from "node:http";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import {
  PORT, HOST, ALLOWED_ORIGINS, MEDIA_TYPES, THUMB_MAX, USER_QUOTA, UPLOADS_PER_MINUTE, CHUNK_MAX, PENDING_UPLOAD_TTL,
  PUBLIC_URL, TUNNEL_URL_FILE
} from "./config.js";
import {
  initStorage, assertVolumeMounted, saveUpload, resolveMediaFile, userUsage, deleteMediaFile,
  beginChunkedUpload, appendChunk, pendingBytes, expireStaleUploads
} from "./storage.js";
import { verifyFirebaseToken, isAdminToken } from "./auth.js";
import { issueTicket, verifyTicket } from "./tickets.js";

const CONTENT_TYPES = { jpg: "image/jpeg", png: "image/png", mp4: "video/mp4" };
const MEDIA_PATH_RE = /^\/media\/users\/([A-Za-z0-9]{1,128})\/([0-9a-f-]{36}(?:\.thumb)?\.(jpg|png|mp4))$/;
const DELETE_PATH_RE = /^\/api\/media\/users\/([A-Za-z0-9]{1,128})\/([0-9a-f-]{36}(?:\.thumb)?\.(?:jpg|png|mp4))$/;
const CHUNK_PATH_RE = /^\/api\/media\/uploads\/([0-9a-f-]{36})$/;

function corsHeaders(req, { publicRead = false } = {}) {
  const origin = req.headers.origin;
  const headers = {
    Vary: "Origin",
    // Chrome: acceso desde una web pública (GitHub Pages) a localhost.
    "Access-Control-Allow-Private-Network": "true"
  };
  if (origin && ALLOWED_ORIGINS.has(origin)) headers["Access-Control-Allow-Origin"] = origin;
  else if (publicRead) headers["Access-Control-Allow-Origin"] = "*";
  return headers;
}

function sendJson(res, status, body, extra = {}) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extra });
  res.end(JSON.stringify(body));
}

const bearer = (req) => (req.headers.authorization || "").replace(/^Bearer\s+/i, "");

// Cuerpo JSON pequeño (peticiones de control, no archivos).
async function readJson(req, limit = 4096) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > limit) throw Object.assign(new Error("Petición demasiado grande."), { status: 413 });
  }
  try {
    return JSON.parse(raw || "{}");
  } catch {
    throw Object.assign(new Error("JSON no válido."), { status: 400 });
  }
}

// URL pública con la que el túnel expone este servidor (variable de entorno o archivo de tunnel.sh).
function publicUrl() {
  if (PUBLIC_URL) return PUBLIC_URL;
  try {
    const url = fs.readFileSync(TUNNEL_URL_FILE, "utf8").trim();
    return /^https:\/\/[a-z0-9.-]+$/i.test(url) ? url : "";
  } catch {
    return "";
  }
}

// Limitador simple por usuario (ventana de 1 minuto).
const uploadLog = new Map();
function rateLimited(uid) {
  const now = Date.now();
  const recent = (uploadLog.get(uid) || []).filter((t) => now - t < 60000);
  recent.push(now);
  uploadLog.set(uid, recent);
  return recent.length > UPLOADS_PER_MINUTE;
}

async function handleUpload(req, res, verifyToken) {
  // Rechazos tempranos: se descarta el cuerpo pendiente para que el navegador reciba la respuesta
  // (si se cierra la conexión a mitad de subida, el cliente solo vería un error de red).
  const reject = (status, error, headers) => {
    req.resume();
    sendJson(res, status, { error }, headers);
  };
  const cors = corsHeaders(req);
  if (!cors["Access-Control-Allow-Origin"]) return reject(403, "Origen no permitido.");

  const uid = await verifyToken(bearer(req));
  if (rateLimited(uid)) return reject(429, "Demasiadas subidas. Espera un minuto.", cors);

  const mime = (req.headers["content-type"] || "").split(";")[0].trim();
  const role = req.headers["x-tux-role"] === "thumb" ? "thumb" : "main";
  const type = MEDIA_TYPES[mime];
  if (!type) return reject(415, "Formato no admitido. Usa JPG, PNG o MP4.", cors);
  const maxBytes = role === "thumb" ? THUMB_MAX : type.max;
  const declared = Number(req.headers["content-length"] || 0);
  if (declared > maxBytes) return reject(413, "Archivo demasiado grande.", cors);
  if ((await userUsage(uid)) + pendingBytes(uid) + declared > USER_QUOTA) {
    return reject(507, "Has alcanzado tu espacio máximo de almacenamiento.", cors);
  }

  assertVolumeMounted();
  const saved = await saveUpload({
    uid, mime, stream: req, maxBytes, role, mediaId: req.headers["x-tux-media-id"]
  });
  sendJson(res, 201, { id: saved.id, key: saved.key, size: saved.size }, cors);
}

// Ticket de lectura: valida la sesión de Firebase y devuelve una firma para las URLs de /media.
async function handleTicket(req, res, verifyToken) {
  req.resume();
  const cors = corsHeaders(req);
  if (!cors["Access-Control-Allow-Origin"]) return sendJson(res, 403, { error: "Origen no permitido." });
  const uid = await verifyToken(bearer(req));
  sendJson(res, 200, issueTicket(uid), cors);
}

// Subida por trozos, paso 1: reserva el archivo tras validar sesión, tipo, tamaño y cuota.
async function handleChunkBegin(req, res, verifyToken) {
  const cors = corsHeaders(req);
  if (!cors["Access-Control-Allow-Origin"]) {
    req.resume();
    return sendJson(res, 403, { error: "Origen no permitido." });
  }
  const uid = await verifyToken(bearer(req));
  const { mime, size } = await readJson(req);
  if (rateLimited(uid)) return sendJson(res, 429, { error: "Demasiadas subidas. Espera un minuto." }, cors);
  if ((await userUsage(uid)) + pendingBytes(uid) + Number(size || 0) > USER_QUOTA) {
    return sendJson(res, 507, { error: "Has alcanzado tu espacio máximo de almacenamiento." }, cors);
  }
  assertVolumeMounted();
  sendJson(res, 201, { ...(await beginChunkedUpload({ uid, mime, size: Number(size) })), chunkSize: CHUNK_MAX }, cors);
}

// Subida por trozos, paso 2: cada PUT añade un trozo en ?offset=; el último publica el archivo.
async function handleChunk(req, res, match, verifyToken) {
  const cors = corsHeaders(req);
  if (!cors["Access-Control-Allow-Origin"]) {
    req.resume();
    return sendJson(res, 403, { error: "Origen no permitido." });
  }
  const uid = await verifyToken(bearer(req));
  const offset = Number(new URL(req.url, "http://localhost").searchParams.get("offset"));
  if (!Number.isSafeInteger(offset) || offset < 0) {
    req.resume();
    return sendJson(res, 400, { error: "Posición no válida." }, cors);
  }
  assertVolumeMounted();
  try {
    const result = await appendChunk({ uid, uploadId: match[1], offset, stream: req, chunkMax: CHUNK_MAX });
    sendJson(res, result.done ? 201 : 200, result, cors);
  } catch (err) {
    req.resume();
    if (!err.status || err.status === 500) throw err;
    sendJson(res, err.status, { error: err.message, received: err.received }, cors);
  }
}

// Borrado sincronizado con Firestore: solo el dueño del archivo o un admin.
async function handleDelete(req, res, match, { verifyToken, isAdmin }) {
  const cors = corsHeaders(req);
  if (!cors["Access-Control-Allow-Origin"]) return sendJson(res, 403, { error: "Origen no permitido." });
  const token = bearer(req);
  const requester = await verifyToken(token);
  const [, ownerUid, fileName] = match;
  if (requester !== ownerUid && !(await isAdmin(token, requester))) {
    return sendJson(res, 403, { error: "No puedes borrar archivos de otro usuario." }, cors);
  }
  assertVolumeMounted();
  const removed = await deleteMediaFile(ownerUid, fileName);
  console.log(`[tux] borrado ${ownerUid}/${fileName} (${removed} archivo/s) por ${requester === ownerUid ? "su dueño" : `admin ${requester}`}`);
  res.writeHead(204, cors);
  res.end();
}

// Cualquier usuario con sesión iniciada (ticket válido) puede ver las pruebas de los demás.
function handleMedia(req, res, match, url) {
  const [, uid, fileName, ext] = match;
  const headers = {
    ...corsHeaders(req, { publicRead: true }),
    "X-Content-Type-Options": "nosniff",
    "Cross-Origin-Resource-Policy": "cross-origin",
    "Content-Disposition": "inline"
  };
  try {
    verifyTicket(url.searchParams.get("k"));
  } catch (err) {
    return sendJson(res, err.status, { error: err.message }, headers);
  }
  const file = resolveMediaFile(uid, fileName);
  if (!file) {
    res.writeHead(404, headers);
    return res.end();
  }
  Object.assign(headers, {
    "Content-Type": CONTENT_TYPES[ext],
    "Accept-Ranges": "bytes",
    // Privado: la URL lleva un ticket personal y no debe quedar en cachés compartidas (CDN del túnel).
    "Cache-Control": "private, max-age=43200"
  });

  // Soporte de Range (necesario para reproducir y buscar en vídeo, sobre todo en Safari).
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || "");
  if (range) {
    let start = range[1] === "" ? file.size - Number(range[2]) : Number(range[1]);
    let end = range[1] !== "" && range[2] !== "" ? Number(range[2]) : file.size - 1;
    end = Math.min(end, file.size - 1);
    if (start < 0 || start > end) {
      res.writeHead(416, { ...headers, "Content-Range": `bytes */${file.size}` });
      return res.end();
    }
    res.writeHead(206, { ...headers, "Content-Range": `bytes ${start}-${end}/${file.size}`, "Content-Length": end - start + 1 });
    if (req.method === "HEAD") return res.end();
    return fs.createReadStream(file.path, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...headers, "Content-Length": file.size });
  if (req.method === "HEAD") return res.end();
  fs.createReadStream(file.path).pipe(res);
}

export function createTuxServer({ verifyToken = verifyFirebaseToken, isAdmin = isAdminToken } = {}) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    try {
      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          ...corsHeaders(req, { publicRead: url.pathname.startsWith("/media/") }),
          "Access-Control-Allow-Methods": "GET, HEAD, POST, PUT, DELETE, OPTIONS",
          "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Tux-Role, X-Tux-Media-Id, Range",
          "Access-Control-Max-Age": "600"
        });
        return res.end();
      }
      if (url.pathname === "/health" && req.method === "GET") {
        let disk = true;
        try { assertVolumeMounted(); } catch { disk = false; }
        return sendJson(res, disk ? 200 : 503,
          { ok: disk, storage: disk ? "HDD" : "desconectado", publicUrl: publicUrl() },
          corsHeaders(req, { publicRead: true }));
      }
      if (url.pathname === "/api/media/ticket" && req.method === "POST") return await handleTicket(req, res, verifyToken);
      if (url.pathname === "/api/media" && req.method === "POST") return await handleUpload(req, res, verifyToken);
      if (url.pathname === "/api/media/uploads" && req.method === "POST") return await handleChunkBegin(req, res, verifyToken);
      const chunk = CHUNK_PATH_RE.exec(url.pathname);
      if (chunk && req.method === "PUT") return await handleChunk(req, res, chunk, verifyToken);
      const del = DELETE_PATH_RE.exec(url.pathname);
      if (del && req.method === "DELETE") return await handleDelete(req, res, del, { verifyToken, isAdmin });
      const match = MEDIA_PATH_RE.exec(url.pathname);
      if (match && (req.method === "GET" || req.method === "HEAD")) return handleMedia(req, res, match, url);
      // Cualquier otra ruta (incluidos directorios): sin listados ni detalles.
      sendJson(res, 404, { error: "No encontrado." });
    } catch (err) {
      const status = err.status || 500;
      if (status === 500) console.error("[tux] error:", err);
      req.resume();
      if (!res.headersSent) sendJson(res, status, { error: status === 500 ? "Error interno." : err.message }, corsHeaders(req));
      else res.destroy();
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const { root } = await initStorage();
    setInterval(() => expireStaleUploads(PENDING_UPLOAD_TTL), 5 * 60 * 1000).unref();
    createTuxServer().listen(PORT, HOST, () => {
      console.log(`[tux] Servidor multimedia en http://${HOST === "127.0.0.1" ? "localhost" : HOST}:${PORT}`);
      console.log(`[tux] Almacenamiento: ${root}`);
      if (publicUrl()) console.log(`[tux] URL pública (túnel): ${publicUrl()}`);
    });
  } catch (err) {
    console.error(`[tux] No se pudo iniciar: ${err.message}`);
    process.exit(1);
  }
}
