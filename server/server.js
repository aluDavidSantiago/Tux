// Servidor de multimedia de Tux.
//   POST   /api/media                     → sube una prueba (requiere ID token de Firebase)
//   DELETE /api/media/users/{uid}/{file}  → borra un archivo (su dueño o un admin)
//   GET  /media/users/{uid}/{file} → sirve un archivo concreto (con soporte de rangos para vídeo)
//   GET  /health                   → estado del servidor y del disco
// No existen rutas de listado; la purga masiva solo se hace con admin.js.
import http from "node:http";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { PORT, HOST, ALLOWED_ORIGINS, MEDIA_TYPES, THUMB_MAX, USER_QUOTA, UPLOADS_PER_MINUTE } from "./config.js";
import { initStorage, assertVolumeMounted, saveUpload, resolveMediaFile, userUsage, deleteMediaFile } from "./storage.js";
import { verifyFirebaseToken, isAdminToken } from "./auth.js";

const CONTENT_TYPES = { jpg: "image/jpeg", png: "image/png", mp4: "video/mp4" };
const MEDIA_PATH_RE = /^\/media\/users\/([A-Za-z0-9]{1,128})\/([0-9a-f-]{36}(?:\.thumb)?\.(jpg|png|mp4))$/;
const DELETE_PATH_RE = /^\/api\/media\/users\/([A-Za-z0-9]{1,128})\/([0-9a-f-]{36}(?:\.thumb)?\.(?:jpg|png|mp4))$/;

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

  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const uid = await verifyToken(token);
  if (rateLimited(uid)) return reject(429, "Demasiadas subidas. Espera un minuto.", cors);

  const mime = (req.headers["content-type"] || "").split(";")[0].trim();
  const role = req.headers["x-tux-role"] === "thumb" ? "thumb" : "main";
  const type = MEDIA_TYPES[mime];
  if (!type) return reject(415, "Formato no admitido. Usa JPG, PNG o MP4.", cors);
  const maxBytes = role === "thumb" ? THUMB_MAX : type.max;
  const declared = Number(req.headers["content-length"] || 0);
  if (declared > maxBytes) return reject(413, "Archivo demasiado grande.", cors);
  if ((await userUsage(uid)) + declared > USER_QUOTA) {
    return reject(507, "Has alcanzado tu espacio máximo de almacenamiento.", cors);
  }

  assertVolumeMounted();
  const saved = await saveUpload({
    uid, mime, stream: req, maxBytes, role, mediaId: req.headers["x-tux-media-id"]
  });
  sendJson(res, 201, { id: saved.id, key: saved.key, size: saved.size }, cors);
}

// Borrado sincronizado con Firestore: solo el dueño del archivo o un admin.
async function handleDelete(req, res, match, { verifyToken, isAdmin }) {
  const cors = corsHeaders(req);
  if (!cors["Access-Control-Allow-Origin"]) return sendJson(res, 403, { error: "Origen no permitido." });
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
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

function handleMedia(req, res, match) {
  const [, uid, fileName, ext] = match;
  const file = resolveMediaFile(uid, fileName);
  const headers = {
    ...corsHeaders(req, { publicRead: true }),
    "X-Content-Type-Options": "nosniff",
    "Cross-Origin-Resource-Policy": "cross-origin",
    "Content-Disposition": "inline"
  };
  if (!file) {
    res.writeHead(404, headers);
    return res.end();
  }
  Object.assign(headers, {
    "Content-Type": CONTENT_TYPES[ext],
    "Accept-Ranges": "bytes",
    "Cache-Control": "public, max-age=31536000, immutable"
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
          "Access-Control-Allow-Methods": "GET, HEAD, POST, DELETE, OPTIONS",
          "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Tux-Role, X-Tux-Media-Id, Range",
          "Access-Control-Max-Age": "600"
        });
        return res.end();
      }
      if (url.pathname === "/health" && req.method === "GET") {
        let disk = true;
        try { assertVolumeMounted(); } catch { disk = false; }
        return sendJson(res, disk ? 200 : 503, { ok: disk, storage: disk ? "HDD" : "desconectado" }, corsHeaders(req, { publicRead: true }));
      }
      if (url.pathname === "/api/media" && req.method === "POST") return await handleUpload(req, res, verifyToken);
      const del = DELETE_PATH_RE.exec(url.pathname);
      if (del && req.method === "DELETE") return await handleDelete(req, res, del, { verifyToken, isAdmin });
      const match = MEDIA_PATH_RE.exec(url.pathname);
      if (match && (req.method === "GET" || req.method === "HEAD")) return handleMedia(req, res, match);
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
    createTuxServer().listen(PORT, HOST, () => {
      console.log(`[tux] Servidor multimedia en http://${HOST === "127.0.0.1" ? "localhost" : HOST}:${PORT}`);
      console.log(`[tux] Almacenamiento: ${root}`);
    });
  } catch (err) {
    console.error(`[tux] No se pudo iniciar: ${err.message}`);
    process.exit(1);
  }
}
