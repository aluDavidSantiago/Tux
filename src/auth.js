// Módulo de autenticación: inicio de sesión con Google y escucha de sesión.
import {
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { auth } from "./firebaseConfig.js";

const provider = new GoogleAuthProvider();

export const signIn = () => signInWithPopup(auth, provider);
export const logOut = () => signOut(auth);
export const watchSession = (callback) => onAuthStateChanged(auth, callback);
