// Verificación de los ID tokens de Firebase Auth (firma de Google, emisor y audiencia del proyecto).
import { createRemoteJWKSet, jwtVerify } from "jose";
import { FIREBASE_PROJECT_ID } from "./config.js";

const JWKS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com")
);

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
