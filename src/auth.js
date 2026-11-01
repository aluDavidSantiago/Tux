// Módulo de autenticación: email/contraseña, Google (popup con fallback a redirect),
// recuperación y escucha de sesión.
import {
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  updateProfile,
  signOut,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { auth } from "./firebaseConfig.js";
import { ensureUserProfile } from "./users.js";

auth.languageCode = "es";
setPersistence(auth, browserLocalPersistence).catch(() => {});

const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });

// El perfil en Firestore nunca bloquea el acceso: si falla, se registra y se reintenta
// en el siguiente inicio de sesión (el listener de sesión también lo asegura).
async function safeEnsureProfile(user, nickname) {
  try {
    await ensureUserProfile(user, nickname);
  } catch (err) {
    console.warn("Tux: no se pudo crear/actualizar el perfil.", err);
  }
}

// Errores de popup que justifican pasar al flujo por redirección.
const POPUP_FALLBACK_CODES = new Set([
  "auth/popup-blocked",
  "auth/operation-not-supported-in-this-environment",
  "auth/web-storage-unsupported"
]);

// Devuelve el usuario, o null si se inició una redirección (la página se recargará).
export async function signInWithGoogle() {
  try {
    const { user } = await signInWithPopup(auth, googleProvider);
    await safeEnsureProfile(user);
    return user;
  } catch (err) {
    if (!POPUP_FALLBACK_CODES.has(err?.code)) throw err;
    await signInWithRedirect(auth, googleProvider);
    return null;
  }
}

// Completa un inicio con Google que volvió por redirección.
export async function completeRedirectSignIn() {
  const result = await getRedirectResult(auth);
  if (!result?.user) return null;
  await safeEnsureProfile(result.user);
  return result.user;
}

export async function signInWithEmail(email, password) {
  const { user } = await signInWithEmailAndPassword(auth, email.trim(), password);
  await safeEnsureProfile(user);
  return user;
}

export async function signUpWithEmail(email, password, nickname) {
  const { user } = await createUserWithEmailAndPassword(auth, email.trim(), password);
  try {
    await updateProfile(user, { displayName: nickname });
  } catch (err) {
    console.warn("Tux: no se pudo fijar el displayName.", err);
  }
  await safeEnsureProfile(user, nickname);
  return user;
}

export const resetPassword = (email) => sendPasswordResetEmail(auth, email.trim());
export const logOut = () => signOut(auth);
export const watchSession = (callback) => onAuthStateChanged(auth, callback);

const ERROR_MESSAGES = {
  "auth/invalid-email": "El email no es válido.",
  "auth/missing-email": "Escribe tu email.",
  "auth/missing-password": "Escribe tu contraseña.",
  "auth/invalid-credential": "Email o contraseña incorrectos.",
  "auth/invalid-login-credentials": "Email o contraseña incorrectos.",
  "auth/wrong-password": "Email o contraseña incorrectos.",
  "auth/user-not-found": "No existe ninguna cuenta con ese email.",
  "auth/user-disabled": "Esta cuenta está desactivada.",
  "auth/email-already-in-use": "Ya hay una cuenta con ese email. Prueba a iniciar sesión.",
  "auth/weak-password": "La contraseña debe tener al menos 6 caracteres.",
  "auth/password-does-not-meet-requirements": "La contraseña no cumple los requisitos de seguridad.",
  "auth/too-many-requests": "Demasiados intentos. Espera un momento.",
  "auth/popup-blocked": "El navegador bloqueó la ventana de Google.",
  "auth/popup-closed-by-user": "Se cerró la ventana de Google antes de terminar.",
  "auth/cancelled-popup-request": "Se cerró la ventana de Google antes de terminar.",
  "auth/account-exists-with-different-credential": "Ese email ya está registrado con otro método de acceso.",
  "auth/unauthorized-domain": "Este dominio no está autorizado en Firebase Auth.",
  "auth/operation-not-allowed": "Este método de acceso no está activado en Firebase.",
  "auth/admin-restricted-operation": "El registro está restringido en este proyecto.",
  "auth/configuration-not-found": "Firebase Auth no está configurado para este proyecto.",
  "auth/network-request-failed": "Sin conexión. Revisa tu red.",
  "auth/internal-error": "Error interno de Firebase. Inténtalo de nuevo."
};

// Mensaje legible + código real de Firebase para poder diagnosticar.
export function authErrorMessage(err) {
  const code = err?.code || "";
  const known = ERROR_MESSAGES[code];
  if (known) return `${known} (${code})`;
  if (code.startsWith("auth/api-key-not-valid")) return `La API key de Firebase no es válida. (${code})`;
  const raw = (err?.message || "").replace(/^Firebase:\s*/, "").trim();
  return raw || code || "Error desconocido.";
}
