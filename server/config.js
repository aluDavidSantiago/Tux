// Configuración del servidor de multimedia de Tux (sobrescribible por variables de entorno).
import path from "node:path";

const MB = 1024 * 1024;

export const PORT = Number(process.env.TUX_PORT || 8787);
export const HOST = process.env.TUX_HOST || "127.0.0.1";

// Raíz del almacenamiento en el disco externo y el volumen que debe estar montado.
export const STORAGE_ROOT = path.resolve(process.env.TUX_STORAGE_ROOT || "/Volumes/HDD/Tux_Storage");
export const VOLUME_ROOT = path.resolve(process.env.TUX_VOLUME_ROOT || "/Volumes/HDD");

export const FIREBASE_PROJECT_ID = process.env.TUX_FIREBASE_PROJECT || "tuxsocial";

export const ALLOWED_ORIGINS = new Set([
  "https://aludavidsantiago.github.io",
  "http://localhost:8080",
  "http://127.0.0.1:8080",
  ...(process.env.TUX_EXTRA_ORIGINS || "").split(",").map((o) => o.trim()).filter(Boolean)
]);

// Tipos admitidos: firma binaria ("magic bytes") + límite de tamaño.
export const MEDIA_TYPES = {
  "image/jpeg": { ext: "jpg", max: 10 * MB },
  "image/png": { ext: "png", max: 10 * MB },
  "video/mp4": { ext: "mp4", max: 100 * MB }
};
export const THUMB_MAX = 2 * MB;
export const USER_QUOTA = 5 * 1024 * MB;
export const UPLOADS_PER_MINUTE = 20;
