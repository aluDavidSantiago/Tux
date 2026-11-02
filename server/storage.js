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
// Pruebas ({uuid}.ext), sus miniaturas ({uuid}.thumb.jpg) y la foto de perfil (avatar.jpg).
const FILE_RE = /^([0-9a-f-]{36}(\.thumb)?\.(jpg|png|mp4)|avatar\.jpg)$/;
const MAIN_EXTS = ["mp4", "jpg", "png"];

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
  await removeStaleParts();
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
    if (!isValidFileName(name)) continue;
    const st = await fsp.stat(path.join(dir, name)).catch(() => null);
    if (st?.isFile()) total += st.size;
  }
  return total;
}

// Copia el flujo al archivo de salida sin pasar de maxBytes. Si se indica mime, comprueba la firma
// con los primeros bytes. Devuelve los bytes escritos.
function pipeLimited(stream, out, { maxBytes, mime }) {
  let size = 0;
  let checked = !mime;
  let head = Buffer.alloc(0);

  // Deja de guardar pero sigue drenando la petición para poder responder con el error.
  const stopReading = () => {
    stream.removeAllListeners("data");
    stream.removeAllListeners("end");
    stream.resume();
  };

  return new Promise((resolve, reject) => {
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
      if (!checked || size === 0) return reject(Object.assign(new Error("Archivo vacío o incompleto."), { status: 400 }));
      out.end(() => resolve(size));
    });
    stream.on("error", reject);
    out.on("error", reject);
  });
}

// Guarda el flujo en un .part y lo renombra al final (nunca deja archivos a medias visibles).
// role "thumb" requiere mediaId de un archivo existente del mismo usuario (vídeo o foto).
export async function saveUpload({ uid, mime, stream, maxBytes, role = "main", mediaId }) {
  const type = MEDIA_TYPES[mime];
  if (!type) throw Object.assign(new Error("Tipo de archivo no admitido."), { status: 415 });
  const dir = await userDir(uid);

  let id = crypto.randomUUID();
  let fileName = `${id}.${type.ext}`;
  if (role === "thumb") {
    if (mime !== "image/jpeg") throw Object.assign(new Error("La miniatura debe ser JPG."), { status: 415 });
    if (!/^[0-9a-f-]{36}$/.test(mediaId || "") || !MAIN_EXTS.some((ext) => fs.existsSync(path.join(dir, `${mediaId}.${ext}`)))) {
      throw Object.assign(new Error("Archivo de origen no encontrado."), { status: 404 });
    }
    id = mediaId;
    fileName = `${id}.thumb.jpg`;
  }

  const finalPath = path.join(dir, fileName);
  const partPath = `${finalPath}.part`;
  const out = fs.createWriteStream(partPath, { flags: "wx", mode: 0o600 });
  let size;
  try {
    size = await pipeLimited(stream, out, { maxBytes, mime });
    await fsp.rename(partPath, finalPath);
  } catch (err) {
    out.destroy();
    await fsp.rm(partPath, { force: true });
    throw err;
  }
  return { id, fileName, size, key: `local:users/${uid}/${fileName}` };
}

// Foto de perfil: sobrescribe users/{uid}/avatar.jpg de forma atómica (.part + rename).
export async function saveAvatar({ uid, stream, maxBytes }) {
  const dir = await userDir(uid);
  const finalPath = path.join(dir, "avatar.jpg");
  const partPath = `${finalPath}.${crypto.randomUUID()}.part`;
  const out = fs.createWriteStream(partPath, { flags: "wx", mode: 0o600 });
  try {
    const size = await pipeLimited(stream, out, { maxBytes, mime: "image/jpeg" });
    await fsp.rename(partPath, finalPath);
    return { size, key: `local:users/${uid}/avatar.jpg` };
  } catch (err) {
    out.destroy();
    await fsp.rm(partPath, { force: true });
    throw err;
  }
}

/* ---------- Subidas por trozos (archivos > 100 MB a través del túnel de Cloudflare) ---------- */
// uploadId → { uid, mime, ext, size, received, partPath, finalPath, id, touched, busy }
const pendingUploads = new Map();

const dropPending = async (uploadId) => {
  const up = pendingUploads.get(uploadId);
  pendingUploads.delete(uploadId);
  if (up) await fsp.rm(up.partPath, { force: true });
};

export function expireStaleUploads(ttl) {
  const now = Date.now();
  for (const [uploadId, up] of pendingUploads) {
    if (!up.busy && now - up.touched > ttl) dropPending(uploadId);
  }
}

// Bytes reservados por subidas en curso (cuentan para la cuota).
export const pendingBytes = (uid) =>
  [...pendingUploads.values()].filter((u) => u.uid === uid).reduce((n, u) => n + u.size, 0);

export async function beginChunkedUpload({ uid, mime, size }) {
  const type = MEDIA_TYPES[mime];
  if (!type) throw Object.assign(new Error("Formato no admitido. Usa JPG, PNG o MP4."), { status: 415 });
  if (!Number.isSafeInteger(size) || size <= 0) throw Object.assign(new Error("Tamaño no válido."), { status: 400 });
  if (size > type.max) throw Object.assign(new Error("Archivo demasiado grande."), { status: 413 });
  const dir = await userDir(uid);
  const id = crypto.randomUUID();
  const finalPath = path.join(dir, `${id}.${type.ext}`);
  const partPath = `${finalPath}.part`;
  await fsp.writeFile(partPath, "", { flag: "wx", mode: 0o600 });
  const uploadId = crypto.randomUUID();
  pendingUploads.set(uploadId, {
    uid, mime, size, received: 0, partPath, finalPath, id, fileName: path.basename(finalPath), touched: Date.now(), busy: false
  });
  return { uploadId };
}

// Añade un trozo en la posición offset. Al completar el tamaño declarado publica el archivo.
// Devuelve { received, done, id?, key? }.
export async function appendChunk({ uid, uploadId, offset, stream, chunkMax }) {
  const up = pendingUploads.get(uploadId);
  if (!up || up.uid !== uid) throw Object.assign(new Error("Subida no encontrada o caducada."), { status: 404 });
  if (up.busy) throw Object.assign(new Error("Ya se está recibiendo un trozo de esta subida."), { status: 409, received: up.received });
  if (offset !== up.received) {
    throw Object.assign(new Error("Posición del trozo incorrecta."), { status: 409, received: up.received });
  }
  up.busy = true;
  up.touched = Date.now();
  const out = fs.createWriteStream(up.partPath, { flags: "a" });
  try {
    const written = await pipeLimited(stream, out, {
      maxBytes: Math.min(chunkMax, up.size - up.received),
      mime: offset === 0 ? up.mime : null
    });
    up.received += written;
  } catch (err) {
    out.destroy();
    // Trozo fallido: se recorta lo escrito para que el cliente pueda reintentar desde la misma posición.
    await fsp.truncate(up.partPath, up.received).catch(() => {});
    if (err.status === 415) await dropPending(uploadId);
    throw Object.assign(err, { received: up.received });
  } finally {
    up.busy = false;
    up.touched = Date.now();
  }
  if (up.received < up.size) return { received: up.received, done: false };
  await fsp.rename(up.partPath, up.finalPath);
  pendingUploads.delete(uploadId);
  return { received: up.received, done: true, id: up.id, size: up.size, key: `local:users/${uid}/${up.fileName}` };
}

// Al arrancar no hay subidas en curso: se limpian los .part que dejara un cierre brusco.
async function removeStaleParts() {
  for (const uid of await fsp.readdir(USERS_DIR).catch(() => [])) {
    if (!isValidUid(uid)) continue;
    const dir = path.join(USERS_DIR, uid);
    for (const name of await fsp.readdir(dir).catch(() => [])) {
      if (name.endsWith(".part")) await fsp.rm(path.join(dir, name), { force: true });
    }
  }
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
  // Borrar el archivo principal arrastra su miniatura.
  if (!fileName.includes(".thumb.") && fileName !== "avatar.jpg") targets.push(fileName.replace(/\.(mp4|jpg|png)$/, ".thumb.jpg"));
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

// Borrado físico recursivo de la carpeta entera del usuario (admin.js y DELETE /api/admin/users/{uid}).
// Cancela antes sus subidas en curso. Devuelve cuántos archivos había.
export async function purgeUser(uid) {
  if (!isValidUid(uid)) throw Object.assign(new Error("UID no válido."), { status: 400 });
  for (const [uploadId, up] of pendingUploads) if (up.uid === uid) await dropPending(uploadId);
  const dir = path.join(USERS_DIR, uid);
  if (!dir.startsWith(USERS_DIR + path.sep)) throw Object.assign(new Error("Ruta no válida."), { status: 400 });
  const files = (await fsp.readdir(dir).catch(() => [])).length;
  await fsp.rm(dir, { recursive: true, force: true });
  return files;
}

export async function purgeAll() {
  await fsp.rm(USERS_DIR, { recursive: true, force: true });
  await fsp.mkdir(USERS_DIR, { recursive: true, mode: 0o700 });
}
