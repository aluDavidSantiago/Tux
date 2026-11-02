// Configuración del servidor de multimedia de Tux (sobrescribible por variables de entorno).
import os from "node:os";
import path from "node:path";

const MB = 1024 * 1024;

export const PORT = Number(process.env.TUX_PORT || 8787);
export const HOST = process.env.TUX_HOST || "127.0.0.1";

// Raíz del almacenamiento en el disco externo y el volumen que debe estar montado.
export const STORAGE_ROOT = path.resolve(process.env.TUX_STORAGE_ROOT || "/Volumes/HDD/Tux_Storage");
export const VOLUME_ROOT = path.resolve(process.env.TUX_VOLUME_ROOT || "/Volumes/HDD");

// URL pública (túnel HTTPS de Cloudflare). Si no se define, se lee la que deja server/tunnel/tunnel.sh.
export const PUBLIC_URL = process.env.TUX_PUBLIC_URL || "";
export const TUNNEL_URL_FILE = process.env.TUX_TUNNEL_URL_FILE || path.join(os.homedir(), "Library/Logs/Tux/tunnel-url.txt");

// Clave HMAC de los tickets de lectura (se genera sola la primera vez; fuera del repo y del HDD).
export const TICKET_SECRET_FILE = process.env.TUX_TICKET_SECRET_FILE || path.join(os.homedir(), ".tux/media-ticket.key");
export const TICKET_TTL = 12 * 3600;     // segundos de validez mínima de un ticket
export const TICKET_BUCKET = 6 * 3600;   // tickets emitidos en la misma franja son idénticos (URLs cacheables)

export const FIREBASE_PROJECT_ID = process.env.TUX_FIREBASE_PROJECT || "tuxsocial";

export const ALLOWED_ORIGINS = new Set([
  "https://aludavidsantiago.github.io",
  "http://localhost:8080",
  "http://127.0.0.1:8080",
  ...(process.env.TUX_EXTRA_ORIGINS || "").split(",").map((o) => o.trim()).filter(Boolean)
]);

// Tipos admitidos: firma binaria ("magic bytes") + límite de tamaño.
// Límites pensados para exportaciones 360° de Insta360 (fotos de 70+ MP, vídeo 5.7K).
export const MEDIA_TYPES = {
  "image/jpeg": { ext: "jpg", max: 50 * MB },
  "image/png": { ext: "png", max: 50 * MB },
  "video/mp4": { ext: "mp4", max: 500 * MB }
};
export const THUMB_MAX = 2 * MB;
export const USER_QUOTA = 20 * 1024 * MB;
export const UPLOADS_PER_MINUTE = 20;

// Cloudflare limita cada petición a 100 MB: los archivos grandes se suben por trozos.
export const CHUNK_MAX = 48 * MB;
export const PENDING_UPLOAD_TTL = 60 * 60 * 1000;
