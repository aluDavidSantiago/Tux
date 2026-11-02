// Claves de Quick Share: permiten a un Atajo de iOS (sin sesión de Firebase) subir una foto o vídeo a
// la carpeta del usuario. Formato tuxq_{uid}.{keyId}.{firma HMAC}. Solo vale la última clave emitida
// para cada usuario (generar una nueva o revocarla invalida la anterior); el registro uid → keyId se
// guarda fuera del repo y del HDD.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { QUICK_KEYS_FILE } from "./config.js";
import { sign } from "./tickets.js";

let keys = null;

function load() {
  if (keys) return keys;
  try {
    keys = JSON.parse(fs.readFileSync(QUICK_KEYS_FILE, "utf8"));
  } catch {
    keys = {};
  }
  return keys;
}

function persist() {
  fs.mkdirSync(path.dirname(QUICK_KEYS_FILE), { recursive: true, mode: 0o700 });
  const tmp = `${QUICK_KEYS_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(keys), { mode: 0o600 });
  fs.renameSync(tmp, QUICK_KEYS_FILE);
}

export function issueQuickKey(uid) {
  load();
  const keyId = crypto.randomBytes(12).toString("hex");
  keys[uid] = { keyId, createdAt: Date.now() };
  persist();
  return { key: `tuxq_${uid}.${keyId}.${sign(`quick.${uid}.${keyId}`)}`, createdAt: keys[uid].createdAt };
}

export function revokeQuickKey(uid) {
  load();
  if (!keys[uid]) return false;
  delete keys[uid];
  persist();
  return true;
}

export const quickKeyStatus = (uid) => {
  const entry = load()[uid];
  return entry ? { active: true, createdAt: entry.createdAt } : { active: false };
};

// Devuelve el uid de una clave vigente o lanza un 401.
export function verifyQuickKey(key) {
  const fail = () => { throw Object.assign(new Error("Clave de subida rápida no válida o revocada. Genera una nueva en Tux → Ajustes."), { status: 401 }); };
  const match = /^tuxq_([A-Za-z0-9]{1,128})\.([0-9a-f]{24})\.([A-Za-z0-9_-]{43})$/.exec((key || "").trim());
  if (!match) fail();
  const [, uid, keyId, sig] = match;
  const expected = Buffer.from(sign(`quick.${uid}.${keyId}`));
  if (!crypto.timingSafeEqual(expected, Buffer.from(sig))) fail();
  if (load()[uid]?.keyId !== keyId) fail();
  return uid;
}
