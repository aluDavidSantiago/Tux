// Módulo multimedia: validación, detección 360° (equirectangular), subida a Cloudinary
// y registro de pruebas en Firestore.
// proofs/{id}: { uid, authorName, activityId, activityTitle, url, thumbUrl, type, is360,
//                width, height, caption, createdAt }
import {
  collection,
  addDoc,
  query,
  where,
  limit,
  onSnapshot,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "./firebaseConfig.js";
import { CLOUDINARY, isMediaConfigured } from "./mediaConfig.js";

const MB = 1024 * 1024;
export const ACCEPTED_TYPES = {
  "image/jpeg": { kind: "image", max: 10 * MB },
  "image/png": { kind: "image", max: 10 * MB },
  "video/mp4": { kind: "video", max: 100 * MB }
};
export const ACCEPT_ATTR = Object.keys(ACCEPTED_TYPES).join(",");

export function validateFile(file) {
  const spec = ACCEPTED_TYPES[file.type];
  if (!spec) throw new Error("Formato no admitido. Usa JPG, PNG o MP4.");
  if (file.size > spec.max) {
    throw new Error(`El archivo supera el máximo de ${spec.max / MB} MB para ${spec.kind === "video" ? "vídeo" : "imagen"}.`);
  }
  return spec.kind;
}

// Lee dimensiones (y duración en vídeo) desde el archivo local.
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
      video.preload = "metadata";
      video.muted = true;
      video.onloadedmetadata = () =>
        resolve({ objectUrl, width: video.videoWidth, height: video.videoHeight, duration: video.duration });
      video.onerror = () => reject(new Error("No se pudo leer el vídeo."));
      video.src = objectUrl;
    }
  });
}

// Las fotos/vídeos 360° equirectangulares tienen proporción 2:1.
export const isEquirectangular = (width, height) =>
  width >= 1024 && height > 0 && Math.abs(width / height - 2) <= 0.04;

export function uploadToCloudinary(file, kind, { folder, onProgress } = {}) {
  if (!isMediaConfigured()) {
    return Promise.reject(new Error("La subida de archivos aún no está configurada (Cloudinary)."));
  }
  const form = new FormData();
  form.append("file", file);
  form.append("upload_preset", CLOUDINARY.uploadPreset);
  if (folder) form.append("folder", folder);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `https://api.cloudinary.com/v1_1/${CLOUDINARY.cloudName}/${kind}/upload`);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch {}
      if (xhr.status >= 200 && xhr.status < 300 && data.secure_url) resolve(data);
      else reject(new Error(data.error?.message || `Error al subir (${xhr.status}).`));
    };
    xhr.onerror = () => reject(new Error("Sin conexión durante la subida."));
    xhr.send(form);
  });
}

// Miniatura vía transformaciones de Cloudinary (primer fotograma en vídeo).
export function cloudinaryThumb(url, kind) {
  const transform = kind === "video" ? "so_0,w_600,c_limit,q_auto" : "w_600,c_limit,q_auto,f_auto";
  const thumb = url.replace("/upload/", `/upload/${transform}/`);
  return kind === "video" ? thumb.replace(/\.[a-z0-9]+$/i, ".jpg") : thumb;
}

export async function createProof({ user, authorName, activity, upload, kind, is360, caption }) {
  const ref = await addDoc(collection(db, "proofs"), {
    uid: user.uid,
    authorName: (authorName || "pingüino").slice(0, 24),
    activityId: activity.id,
    activityTitle: activity.title.slice(0, 80),
    url: upload.secure_url,
    thumbUrl: cloudinaryThumb(upload.secure_url, kind),
    type: kind,
    is360,
    width: upload.width || 0,
    height: upload.height || 0,
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
