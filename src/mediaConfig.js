// Servidor multimedia de Tux (server/): guarda todo en el HDD externo /Volumes/HDD/Tux_Storage.
// La web es estática (sin build ni variables de entorno), así que la URL se resuelve en tiempo de
// ejecución, por orden de prioridad:
//   1. ?media=https://… en la URL de la app (se recuerda en este navegador; ?media=reset lo borra).
//   2. Firestore config/media.serverUrl, que publica un admin desde /admin (URL del túnel HTTPS).
//   3. DEFAULT_MEDIA_SERVER (desarrollo en el propio Mac mini).
import { doc, onSnapshot, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "./firebaseConfig.js";

export const DEFAULT_MEDIA_SERVER = "http://localhost:8787";
const OVERRIDE_KEY = "tux-media-server";
const configRef = doc(db, "config", "media");

// https://… o http://localhost / 127.0.0.1 (sin barra final ni ruta).
export function normalizeServerUrl(value) {
  const url = String(value || "").trim().replace(/\/+$/, "");
  if (/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(url)) return url;
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(url)) return url;
  return "";
}

function readOverride() {
  try {
    const param = new URLSearchParams(location.search).get("media");
    if (param === "reset") localStorage.removeItem(OVERRIDE_KEY);
    else if (normalizeServerUrl(param)) localStorage.setItem(OVERRIDE_KEY, normalizeServerUrl(param));
    return normalizeServerUrl(localStorage.getItem(OVERRIDE_KEY));
  } catch {
    return "";
  }
}

const override = readOverride();
let remoteUrl = "";
const listeners = new Set();

export const mediaServerUrl = () => override || remoteUrl || DEFAULT_MEDIA_SERVER;
export const mediaServerSource = () => (override ? "override" : remoteUrl ? "config" : "default");

// Notifica cuando cambia la URL activa (p. ej. el admin publica la del túnel).
export function onMediaServerChange(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

onSnapshot(configRef, (snap) => {
  const next = normalizeServerUrl(snap.data()?.serverUrl);
  if (next === remoteUrl) return;
  const before = mediaServerUrl();
  remoteUrl = next;
  if (mediaServerUrl() !== before) listeners.forEach((cb) => cb(mediaServerUrl()));
}, (err) => console.warn("Tux: no se pudo leer config/media, se usa el servidor por defecto.", err));

// Solo admins (lo imponen las reglas de Firestore).
export function publishMediaServerUrl(url, user) {
  const serverUrl = normalizeServerUrl(url);
  if (!serverUrl) throw new Error("La URL debe ser https://… (o http://localhost en desarrollo).");
  return setDoc(configRef, { serverUrl, updatedBy: user.uid, updatedAt: serverTimestamp() });
}
