// Almacenamiento en disco: carpetas aisladas por usuario dentro de STORAGE_ROOT/users/{uid}/.
// Solo este módulo escribe en disco. No hay listados ni borrados accesibles desde la web;
// la purga se hace con admin.js.
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { STORAGE_ROOT, VOLUME_ROOT, MEDIA_TYPES } from "./config.js";

const USERS_DIR = path.join(STORAGE_ROOT, "users");
const UID_RE = /^[A-Za-z0-9]{1,128}$/;
const FILE_RE = /^[0-9a-f-]{36}(\.thumb)?\.(jpg|png|mp4)$/;

export const isValidUid = (uid) => UID_RE.test(uid);
export const isValidFileName = (name) => FILE_RE.test(name);

// Evita escribir en el disco interno si el HDD no está montado (macOS crearía /Volumes/HDD en el SSD).
export function assertVolumeMounted() {
  let volume, system;
  try {
    volume = fs.statSync(VOLUME_ROOT);
    system = fs.statSync("/");
  } catch {
    throw new Error(`El disco externo no está montado en ${VOLUME_ROOT}.`);
  }
  if (volume.dev === system.dev) {
    throw new Error(`${VOLUME_ROOT} no es un volumen externo montado (mismo dispositivo que /).`);
  }
}

export async function initStorage() {
  assertVolumeMounted();
  await fsp.mkdir(USERS_DIR, { recursive: true, mode: 0o700 });
  const notice = path.join(STORAGE_ROOT, "LEEME.txt");
  if (!fs.existsSync(notice)) {
    await fsp.writeFile(notice,
      "Almacenamiento gestionado por el servidor de Tux.\n" +
      "No modifiques estas carpetas a mano: usa `npm run admin` en server/ para inspeccionar o purgar.\n");
  }
  return { root: STORAGE_ROOT };
}

async function userDir(uid) {
  if (!isValidUid(uid)) throw Object.assign(new Error("UID no válido."), { status: 400 });
  const dir = path.join(USERS_DIR, uid);
  await fsp.mkdir(dir, { recursive: true, mode: 0o700 });
  return dir;
}

// Comprueba la firma binaria del archivo frente al tipo declarado.
function matchesSignature(mime, head) {
  if (mime === "image/jpeg") return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
  if (mime === "image/png") return head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mime === "video/mp4") return head.subarray(4, 8).toString("ascii") === "ftyp";
  return false;
}

export async function userUsage(uid) {
  if (!isValidUid(uid)) return 0;
  const dir = path.join(USERS_DIR, uid);
  let total = 0;
  for (const name of await fsp.readdir(dir).catch(() => [])) {
    const st = await fsp.stat(path.join(dir, name)).catch(() => null);
    if (st?.isFile()) total += st.size;
  }
  return total;
}

// Guarda el flujo en un .part y lo renombra al final (nunca deja archivos a medias visibles).
// role "thumb" requiere mediaId de un vídeo existente del mismo usuario.
export async function saveUpload({ uid, mime, stream, maxBytes, role = "main", mediaId }) {
  const type = MEDIA_TYPES[mime];
  if (!type) throw Object.assign(new Error("Tipo de archivo no admitido."), { status: 415 });
  const dir = await userDir(uid);

  let id = crypto.randomUUID();
  let fileName = `${id}.${type.ext}`;
  if (role === "thumb") {
    if (mime !== "image/jpeg") throw Object.assign(new Error("La miniatura debe ser JPG."), { status: 415 });
    if (!/^[0-9a-f-]{36}$/.test(mediaId || "") || !fs.existsSync(path.join(dir, `${mediaId}.mp4`))) {
      throw Object.assign(new Error("Vídeo de origen no encontrado."), { status: 404 });
    }
    id = mediaId;
    fileName = `${id}.thumb.jpg`;
  }

  const finalPath = path.join(dir, fileName);
  const partPath = `${finalPath}.part`;
  const out = fs.createWriteStream(partPath, { flags: "wx", mode: 0o600 });
  let size = 0;
  let checked = false;
  let head = Buffer.alloc(0);

  // Deja de guardar pero sigue drenando la petición para poder responder con el error.
  const stopReading = () => {
    stream.removeAllListeners("data");
    stream.removeAllListeners("end");
    stream.resume();
  };

  try {
    await new Promise((resolve, reject) => {
      stream.on("data", (chunk) => {
        size += chunk.length;
        if (size > maxBytes) {
          stopReading();
          return reject(Object.assign(new Error("Archivo demasiado grande."), { status: 413 }));
        }
        if (!checked) {
          head = Buffer.concat([head, chunk]);
          if (head.length >= 12) {
            checked = true;
            if (!matchesSignature(mime, head)) {
              stopReading();
              return reject(Object.assign(new Error("El contenido no coincide con el tipo de archivo."), { status: 415 }));
            }
          }
        }
        if (!out.write(chunk)) {
          stream.pause();
          out.once("drain", () => stream.resume());
        }
      });
      stream.on("end", () => {
        if (!checked) return reject(Object.assign(new Error("Archivo vacío o incompleto."), { status: 400 }));
        out.end(resolve);
      });
      stream.on("error", reject);
      out.on("error", reject);
    });
    await fsp.rename(partPath, finalPath);
  } catch (err) {
    out.destroy();
    await fsp.rm(partPath, { force: true });
    throw err;
  }
  return { id, fileName, size, key: `local:users/${uid}/${fileName}` };
}

// Ruta absoluta de un archivo servible, o null si no es válida / no existe.
export function resolveMediaFile(uid, fileName) {
  if (!isValidUid(uid) || !isValidFileName(fileName)) return null;
  const full = path.join(USERS_DIR, uid, fileName);
  if (!full.startsWith(USERS_DIR + path.sep)) return null;
  try {
    const st = fs.statSync(full);
    return st.isFile() ? { path: full, size: st.size } : null;
  } catch {
    return null;
  }
}

// Borrado controlado (vía API autenticada): el archivo principal arrastra su miniatura.
// Devuelve el número de archivos eliminados; es idempotente (0 si ya no existían).
export async function deleteMediaFile(uid, fileName) {
  if (!isValidUid(uid) || !isValidFileName(fileName)) {
    throw Object.assign(new Error("Archivo no válido."), { status: 400 });
  }
  const dir = path.join(USERS_DIR, uid);
  const targets = [fileName];
  if (fileName.endsWith(".mp4")) targets.push(fileName.replace(/\.mp4$/, ".thumb.jpg"));
  let removed = 0;
  for (const name of targets) {
    const full = path.join(dir, name);
    if (!full.startsWith(USERS_DIR + path.sep)) continue;
    try {
      await fsp.unlink(full);
      removed++;
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
    }
  }
  return removed;
}

/* ---------- Solo administración (admin.js) ---------- */
export async function listUsers() {
  const result = [];
  for (const uid of await fsp.readdir(USERS_DIR).catch(() => [])) {
    if (!isValidUid(uid)) continue;
    const files = (await fsp.readdir(path.join(USERS_DIR, uid))).filter((f) => isValidFileName(f));
    result.push({ uid, files: files.length, bytes: await userUsage(uid) });
  }
  return result;
}

export async function listUserFiles(uid) {
  if (!isValidUid(uid)) throw new Error("UID no válido.");
  const dir = path.join(USERS_DIR, uid);
  const names = await fsp.readdir(dir).catch(() => []);
  return Promise.all(names.map(async (name) => ({ name, bytes: (await fsp.stat(path.join(dir, name))).size })));
}

export async function purgeUser(uid) {
  if (!isValidUid(uid)) throw new Error("UID no válido.");
  await fsp.rm(path.join(USERS_DIR, uid), { recursive: true, force: true });
}

export async function purgeAll() {
  await fsp.rm(USERS_DIR, { recursive: true, force: true });
  await fsp.mkdir(USERS_DIR, { recursive: true, mode: 0o700 });
}
