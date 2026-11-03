// Tickets de lectura: el navegador no puede mandar cabeceras en <img>/<video>, así que tras validar
// el ID token de Firebase (POST /api/media/ticket) el servidor entrega un ticket firmado con HMAC
// que se añade a las URLs de /media como ?k=… Formato: {uid}.{exp}.{firma}.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { TICKET_SECRET_FILE, TICKET_TTL, TICKET_BUCKET } from "./config.js";

let secret = null;

function loadSecret() {
  if (secret) return secret;
  if (process.env.TUX_TICKET_SECRET) return (secret = Buffer.from(process.env.TUX_TICKET_SECRET));
  try {
    secret = fs.readFileSync(TICKET_SECRET_FILE);
  } catch {
    fs.mkdirSync(path.dirname(TICKET_SECRET_FILE), { recursive: true, mode: 0o700 });
    secret = crypto.randomBytes(32);
    fs.writeFileSync(TICKET_SECRET_FILE, secret, { mode: 0o600 });
  }
  return secret;
}

const sign = (payload) => crypto.createHmac("sha256", loadSecret()).update(payload).digest("base64url");

export function issueTicket(uid, now = Date.now()) {
  const nowSec = Math.floor(now / 1000);
  const exp = Math.ceil((nowSec + TICKET_TTL) / TICKET_BUCKET) * TICKET_BUCKET;
  const payload = `${uid}.${exp}`;
  return { ticket: `${payload}.${sign(payload)}`, expiresAt: exp * 1000 };
}

// Devuelve el uid del ticket o lanza un 401.
export function verifyTicket(ticket, now = Date.now()) {
  const fail = () => { throw Object.assign(new Error("Acceso no autorizado: inicia sesión en Tux."), { status: 401 }); };
  const match = /^([A-Za-z0-9]{1,128})\.(\d{1,12})\.([A-Za-z0-9_-]{43})$/.exec(ticket || "");
  if (!match) fail();
  const [, uid, exp, sig] = match;
  const expected = Buffer.from(sign(`${uid}.${exp}`));
  if (!crypto.timingSafeEqual(expected, Buffer.from(sig))) fail();
  if (Number(exp) * 1000 < now) fail();
  return uid;
}
