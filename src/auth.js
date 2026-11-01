// Módulo de autenticación: email/contraseña, Google, recuperación y escucha de sesión.
import {
  GoogleAuthProvider,
  signInWithPopup,
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

export async function signInWithGoogle() {
  const { user } = await signInWithPopup(auth, googleProvider);
  await ensureUserProfile(user);
  return user;
}

export async function signInWithEmail(email, password) {
  const { user } = await signInWithEmailAndPassword(auth, email.trim(), password);
  await ensureUserProfile(user);
  return user;
}

export async function signUpWithEmail(email, password, nickname) {
  const { user } = await createUserWithEmailAndPassword(auth, email.trim(), password);
  await updateProfile(user, { displayName: nickname });
  await ensureUserProfile(user, nickname);
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
  "auth/wrong-password": "Email o contraseña incorrectos.",
  "auth/user-not-found": "No existe ninguna cuenta con ese email.",
  "auth/email-already-in-use": "Ya hay una cuenta con ese email.",
  "auth/weak-password": "La contraseña debe tener al menos 6 caracteres.",
  "auth/too-many-requests": "Demasiados intentos. Espera un momento.",
  "auth/popup-blocked": "El navegador bloqueó la ventana de Google.",
  "auth/popup-closed-by-user": "Se cerró la ventana de Google.",
  "auth/cancelled-popup-request": "Se cerró la ventana de Google.",
  "auth/unauthorized-domain": "Este dominio no está autorizado en Firebase.",
  "auth/operation-not-allowed": "Este método de acceso no está activado.",
  "auth/network-request-failed": "Sin conexión. Revisa tu red."
};

export const authErrorMessage = (err) =>
  ERROR_MESSAGES[err?.code] || "Algo salió mal. Inténtalo de nuevo.";
