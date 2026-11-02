// Quick Share (Atajo de iOS + etiqueta NFC): clave personal con la que un Atajo sube la última foto o
// vídeo de la Insta360 al servidor de Tux, y enlace que abre la app directamente en «Publicar».
//   Enlaces admitidos (en /Tux/public/ o /Tux/upload/):
//     ?quick=true                  → abre el modal de publicación listo para elegir archivo
//     ?quick={uuid}.{jpg|png|mp4}  → carga ese archivo (ya subido por el Atajo a la carpeta del usuario)
//     ?mediaUrl=https://…          → descarga ese archivo (si el origen permite CORS) y lo prepara
//     &autoOpen360=true            → si es 360°, abre directamente el selector de portada
import { mediaServerUrl } from "./mediaConfig.js";

const STAGED_RE = /^[0-9a-f-]{36}\.(jpg|png|mp4)$/;

// Lee y elimina de la barra de direcciones los parámetros de Quick Share (para no repetirlo al recargar).
export function takeQuickParams() {
  const params = new URLSearchParams(location.search);
  const quick = params.get("quick");
  const mediaUrl = params.get("mediaUrl");
  if (!quick && !mediaUrl) return null;
  const result = {
    staged: STAGED_RE.test(quick || "") ? quick : null,
    mediaUrl: /^https:\/\//.test(mediaUrl || "") ? mediaUrl : null,
    auto360: params.get("autoOpen360") === "true"
  };
  ["quick", "mediaUrl", "autoOpen360"].forEach((k) => params.delete(k));
  const rest = params.toString();
  history.replaceState(null, "", location.pathname + (rest ? `?${rest}` : "") + location.hash);
  return result;
}

async function call(method, user) {
  let res;
  try {
    res = await fetch(`${mediaServerUrl()}/api/quick/key`, {
      method, headers: { Authorization: `Bearer ${await user.getIdToken()}` }, cache: "no-store"
    });
  } catch {
    throw new Error("El servidor de Tux no responde.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

export const quickKeyStatus = (user) => call("GET", user);
// Generar una clave nueva invalida la anterior (el Atajo antiguo deja de funcionar).
export const createQuickKey = (user) => call("POST", user);
export const revokeQuickKey = (user) => call("DELETE", user);

// URL pública de Firestore de la que el Atajo lee el servidor activo (cambia con el túnel rápido).
export const CONFIG_URL = "https://firestore.googleapis.com/v1/projects/tuxsocial/databases/(default)/documents/config/media";
export const APP_QUICK_URL = "https://aludavidsantiago.github.io/Tux/upload/?quick=true";
