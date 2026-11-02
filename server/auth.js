// Verificación de los ID tokens de Firebase Auth (firma de Google, emisor y audiencia del proyecto).
import { createRemoteJWKSet, jwtVerify } from "jose";
import { FIREBASE_PROJECT_ID } from "./config.js";

const JWKS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com")
);

// ¿Es admin? Se consulta admins/{uid} en Firestore con el propio token del usuario
// (las reglas solo dejan leer el documento propio).
const adminCache = new Map();
export async function isAdminToken(token, uid) {
  const cached = adminCache.get(uid);
  // Positivos 5 min; negativos 30 s (para que dar de alta un admin surta efecto enseguida).
  if (cached && Date.now() - cached.at < (cached.value ? 300000 : 30000)) return cached.value;
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/admins/${encodeURIComponent(uid)}`;
  let value = false;
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    value = res.ok;
  } catch {
    value = false;
  }
  adminCache.set(uid, { value, at: Date.now() });
  return value;
}

// ¿Cuenta desactivada por un admin? Existe disabledUsers/{uid} (el usuario puede leer el suyo).
const disabledCache = new Map();
export async function isDisabledToken(token, uid) {
  const cached = disabledCache.get(uid);
  if (cached && Date.now() - cached.at < 60000) return cached.value;
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/disabledUsers/${encodeURIComponent(uid)}`;
  let value = false;
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    value = res.ok;
  } catch {
    value = false; // Firestore inaccesible: no se bloquea (el token sigue siendo válido).
  }
  disabledCache.set(uid, { value, at: Date.now() });
  return value;
}

// Devuelve el uid del usuario autenticado o lanza un error 401.
export async function verifyFirebaseToken(token) {
  if (!token) throw Object.assign(new Error("Falta el token de sesión."), { status: 401 });
  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`,
      audience: FIREBASE_PROJECT_ID,
      algorithms: ["RS256"]
    });
    if (!payload.sub) throw new Error("Token sin usuario.");
    return payload.sub;
  } catch {
    throw Object.assign(new Error("Sesión no válida o caducada."), { status: 401 });
  }
}
