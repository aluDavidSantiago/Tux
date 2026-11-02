// Módulo multimedia: validación, detección 360° (equirectangular), subida (servidor local en el HDD
// o Cloudinary) y registro de pruebas en Firestore.
// Las referencias a archivos locales se guardan como "local:users/{uid}/{archivo}" y se resuelven
// contra LOCAL_MEDIA_SERVER al mostrarlas.
// proofs/{id}: { uid, authorName, activityId, activityTitle, url, thumbUrl, type, is360,
//                width, height, caption, createdAt }
import {
  collection,
  doc,
  addDoc,
  deleteDoc,
  query,
  where,
  limit,
  onSnapshot,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "./firebaseConfig.js";
import { MEDIA_PROVIDER, LOCAL_MEDIA_SERVER, CLOUDINARY, isMediaConfigured } from "./mediaConfig.js";

const MB = 1024 * 1024;
// Los JPG/MP4 360° exportados de Insta360 pesan mucho: el HDD local admite más que Cloudinary gratis.
export const MEDIA_LIMITS = MEDIA_PROVIDER === "local"
  ? { image: 50 * MB, video: 500 * MB }
  : { image: 10 * MB, video: 100 * MB };
export const ACCEPTED_TYPES = {
  "image/jpeg": { kind: "image", max: MEDIA_LIMITS.image },
  "image/png": { kind: "image", max: MEDIA_LIMITS.image },
  "video/mp4": { kind: "video", max: MEDIA_LIMITS.video }
};
export const LIMITS_LABEL = `JPG o PNG hasta ${MEDIA_LIMITS.image / MB} MB · MP4 hasta ${MEDIA_LIMITS.video / MB} MB`;
export const ACCEPT_ATTR = Object.keys(ACCEPTED_TYPES).join(",");

export function validateFile(file) {
  const spec = ACCEPTED_TYPES[file.type];
  if (!spec) throw new Error("Formato no admitido. Usa JPG, PNG o MP4.");
  if (file.size > spec.max) {
    throw new Error(`El archivo supera el máximo de ${spec.max / MB} MB para ${spec.kind === "video" ? "vídeo" : "imagen"}.`);
  }
  return spec.kind;
}

// Fotograma JPG del vídeo para usarlo como miniatura (el servidor local no transcodifica).
function captureVideoFrame(video) {
  return new Promise((resolve) => {
    const draw = () => {
      const scale = Math.min(1, 960 / (video.videoWidth || 960));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      try {
        canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.82);
      } catch {
        resolve(null);
      }
    };
    video.addEventListener("seeked", draw, { once: true });
    video.currentTime = Math.min(0.5, (video.duration || 1) / 2);
  });
}

// Lee dimensiones (y duración y miniatura en vídeo) desde el archivo local.
export function probeMedia(file, kind) {
  const objectUrl = URL.createObjectURL(file);
  return new Promise((resolve, reject) => {
    if (kind === "image") {
      const img = new Image();
      img.onload = () => resolve({ objectUrl, width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => reject(new Error("No se pudo leer la imagen."));
      img.src = objectUrl;
    } else {
      const video = document.createElement("video");
      video.preload = "auto";
      video.muted = true;
      video.playsInline = true;
      video.onloadeddata = async () => {
        const thumbBlob = await captureVideoFrame(video);
        resolve({ objectUrl, width: video.videoWidth, height: video.videoHeight, duration: video.duration, thumbBlob });
      };
      video.onerror = () => reject(new Error("No se pudo leer el vídeo."));
      video.src = objectUrl;
    }
  });
}

// Las fotos/vídeos 360° equirectangulares tienen proporción 2:1.
export const isEquirectangular = (width, height) =>
  width >= 1024 && height > 0 && Math.abs(width / height - 2) <= 0.04;

// Metadatos 360°: XMP GPano en JPG/PNG (Insta360, Ricoh, Google) y Spherical Video (V1 XML o
// cajas sv3d/proj de V2) en MP4. En vídeo se lee el principio y el final (el moov puede ir al final).
const SPHERICAL_MARKERS = [
  /GPano:ProjectionType\s*(=\s*["']|>)\s*equirectangular/i,
  /GPano:UsePanoramaViewer\s*(=\s*["']|>)\s*true/i,
  /GSpherical:Spherical\s*>\s*true/i,
  /GSpherical:ProjectionType\s*>\s*equirectangular/i
];

export async function detectSphericalMetadata(file, kind) {
  const SPAN = 1024 * 1024;
  const ranges = [[0, Math.min(file.size, SPAN)]];
  if (kind === "video" && file.size > SPAN) ranges.push([Math.max(SPAN, file.size - 4 * SPAN), file.size]);
  const decoder = new TextDecoder("latin1");
  for (const [start, end] of ranges) {
    const text = decoder.decode(await file.slice(start, end).arrayBuffer());
    if (SPHERICAL_MARKERS.some((re) => re.test(text))) return true;
    if (kind === "video" && text.includes("sv3d") && /proj|equi/.test(text)) return true;
  }
  return false;
}

/* ---------- Resolución de referencias ---------- */
export const isLocalRef = (ref) => typeof ref === "string" && ref.startsWith("local:");

export const resolveMediaUrl = (ref) =>
  isLocalRef(ref) ? `${LOCAL_MEDIA_SERVER}/media/${ref.slice("local:".length)}` : ref;

// Miniatura vía transformaciones de Cloudinary (primer fotograma en vídeo).
export function cloudinaryThumb(url, kind) {
  const transform = kind === "video" ? "so_0,w_600,c_limit,q_auto" : "w_600,c_limit,q_auto,f_auto";
  const thumb = url.replace("/upload/", `/upload/${transform}/`);
  return kind === "video" ? thumb.replace(/\.[a-z0-9]+$/i, ".jpg") : thumb;
}

// URL de miniatura para una prueba guardada ({ url, thumbUrl, type }).
export function mediaThumbUrl({ url, thumbUrl, type }) {
  if (thumbUrl) return resolveMediaUrl(thumbUrl);
  if (url?.startsWith("https://res.cloudinary.com/")) return cloudinaryThumb(url, type);
  return type === "image" ? resolveMediaUrl(url) : "";
}

/* ---------- Subida ---------- */
function xhrUpload({ url, body, headers = {}, onProgress }) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    Object.entries(headers).forEach(([k, v]) => xhr.setRequestHeader(k, v));
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch {}
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new Error(data.error?.message || data.error || `Error al subir (${xhr.status}).`));
    };
    xhr.onerror = () => reject(new Error(
      MEDIA_PROVIDER === "local"
        ? "No se pudo contactar con el servidor de almacenamiento local."
        : "Sin conexión durante la subida."
    ));
    xhr.send(body);
  });
}

// Comprueba que el servidor local responde y que el disco externo está montado.
export async function checkMediaServer() {
  if (MEDIA_PROVIDER !== "local") return { ok: isMediaConfigured() };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const res = await fetch(`${LOCAL_MEDIA_SERVER}/health`, { signal: controller.signal, cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.ok) return { ok: true };
    return { ok: false, message: "El disco externo HDD no está conectado al servidor de Tux." };
  } catch {
    return { ok: false, message: "El servidor de almacenamiento de Tux no responde. Arráncalo con «npm start» en server/." };
  } finally {
    clearTimeout(timer);
  }
}

// Sube el archivo (y su miniatura si es vídeo). Devuelve { url, thumbUrl } como referencias guardables.
export async function uploadMedia({ file, kind, user, thumbBlob, onProgress }) {
  if (MEDIA_PROVIDER === "local") {
    const token = await user.getIdToken();
    const main = await xhrUpload({
      url: `${LOCAL_MEDIA_SERVER}/api/media`,
      body: file,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": file.type, "X-Tux-Role": "main" },
      onProgress
    });
    let thumbUrl = kind === "image" ? main.key : "";
    if (kind === "video" && thumbBlob) {
      const thumb = await xhrUpload({
        url: `${LOCAL_MEDIA_SERVER}/api/media`,
        body: thumbBlob,
        headers: {
          Authorization: `Bearer ${token}`, "Content-Type": "image/jpeg",
          "X-Tux-Role": "thumb", "X-Tux-Media-Id": main.id
        }
      }).catch(() => null);
      thumbUrl = thumb?.key || "";
    }
    return { url: main.key, thumbUrl };
  }

  if (!isMediaConfigured()) throw new Error("La subida de archivos aún no está configurada (Cloudinary).");
  const form = new FormData();
  form.append("file", file);
  form.append("upload_preset", CLOUDINARY.uploadPreset);
  form.append("folder", `Tux/proofs/${user.uid}`);
  const data = await xhrUpload({
    url: `https://api.cloudinary.com/v1_1/${CLOUDINARY.cloudName}/${kind}/upload`,
    body: form,
    onProgress
  });
  return { url: data.secure_url, thumbUrl: cloudinaryThumb(data.secure_url, kind) };
}

// Borra físicamente un archivo del HDD a través del servidor (el propio dueño o un admin).
// Las referencias de Cloudinary no se pueden borrar sin firma: se ignoran.
export async function deleteMediaRef(ref, user) {
  if (!isLocalRef(ref)) return false;
  const token = await user.getIdToken();
  let res;
  try {
    res = await fetch(`${LOCAL_MEDIA_SERVER}/api/media/${ref.slice("local:".length)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` }
    });
  } catch {
    throw new Error("El servidor de almacenamiento no responde: no se ha borrado nada.");
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `No se pudo borrar el archivo (${res.status}).`);
  }
  return true;
}

export const deleteProofDoc = (proofId) => deleteDoc(doc(db, "proofs", proofId));

export async function createProof({ user, authorName, activity, upload, kind, is360, caption, width, height }) {
  const ref = await addDoc(collection(db, "proofs"), {
    uid: user.uid,
    authorName: (authorName || "pingüino").slice(0, 24),
    activityId: activity.id,
    activityTitle: activity.title.slice(0, 80),
    url: upload.url,
    thumbUrl: upload.thumbUrl || "",
    type: kind,
    is360,
    width: Math.round(width || 0),
    height: Math.round(height || 0),
    caption: (caption || "").trim().slice(0, 200),
    createdAt: serverTimestamp()
  });
  return ref.id;
}

// Contenido 360° de la comunidad (filtro de igualdad simple: sin índice compuesto).
export function watchVrProofs(callback, onError) {
  const q = query(collection(db, "proofs"), where("is360", "==", true), limit(120));
  return onSnapshot(q, (snap) => {
    const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    items.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
    callback(items);
  }, onError);
}

// Muestras 360° públicas (CORS abierto) para que la galería no arranque vacía.
export const SAMPLE_VR = [
  { id: "vr-sample-1", url: "https://cdn.aframe.io/360-image-gallery-boilerplate/img/sechelt.jpg", type: "image", activityTitle: "Atardecer en la costa", authorName: "Tux", sample: true },
  { id: "vr-sample-2", url: "https://cdn.aframe.io/360-image-gallery-boilerplate/img/city.jpg", type: "image", activityTitle: "Paseo por la ciudad", authorName: "Tux", sample: true },
  { id: "vr-sample-3", url: "https://cdn.aframe.io/360-image-gallery-boilerplate/img/cubes.jpg", type: "image", activityTitle: "Sala inmersiva", authorName: "Tux", sample: true }
].map((s) => ({ ...s, thumbUrl: s.url, is360: true }));
