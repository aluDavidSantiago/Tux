// Módulo multimedia: validación, detección 360° (equirectangular), subida al servidor de Tux (HDD
// externo, accesible por túnel HTTPS) y registro de pruebas en Firestore.
// Las referencias a archivos se guardan como "local:users/{uid}/{archivo}" y se resuelven contra el
// servidor multimedia activo (mediaConfig.js) con el ticket de lectura de la sesión.
// proofs/{id}: { uid, authorName, activityId, activityTitle, url, thumbUrl, type, is360,
//                width, height, caption, createdAt, cover? { yaw, pitch, fov } (portada 360°, grados) }
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "./firebaseConfig.js";
import { mediaServerUrl, onMediaServerChange } from "./mediaConfig.js";

const MB = 1024 * 1024;
// Los JPG/MP4 360° exportados de Insta360 pesan mucho: límites pensados para el HDD.
export const MEDIA_LIMITS = { image: 50 * MB, video: 500 * MB };
// Cloudflare corta las peticiones de más de 100 MB: por encima de esto se sube por trozos.
const CHUNK_THRESHOLD = 48 * MB;
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

// Versión reducida de una foto: las 360° de Insta360 (70+ MP) son pesadas para el feed y superan el
// tamaño máximo de textura de muchos móviles. 2048 px de ancho para 360°, 1080 px para fotos planas.
function downscaleImage(img) {
  const max = isEquirectangular(img.naturalWidth, img.naturalHeight) ? 2048 : 1080;
  const scale = Math.min(1, max / img.naturalWidth);
  if (scale === 1 && img.naturalWidth * img.naturalHeight < 1200000) return Promise.resolve(null);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.85));
}

// Lee dimensiones (y duración y miniatura) desde el archivo local.
export function probeMedia(file, kind) {
  const objectUrl = URL.createObjectURL(file);
  return new Promise((resolve, reject) => {
    if (kind === "image") {
      const img = new Image();
      img.onload = async () => resolve({
        objectUrl, width: img.naturalWidth, height: img.naturalHeight, thumbBlob: await downscaleImage(img).catch(() => null)
      });
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

/* ---------- Sesión de lectura (ticket firmado por el servidor) ---------- */
// <img> y <video> no pueden enviar el ID token: el servidor lo valida una vez y entrega un ticket
// que se añade a las URLs. Sin sesión no hay ticket y el HDD no entrega nada.
let mediaUser = null;
let ticket = null;          // { value, expiresAt, server }
let ticketTimer = null;
const accessListeners = new Set();

export function onMediaAccessChange(callback) {
  accessListeners.add(callback);
  return () => accessListeners.delete(callback);
}
const notifyAccess = () => accessListeners.forEach((cb) => cb());

async function refreshTicket() {
  clearTimeout(ticketTimer);
  const user = mediaUser;
  if (!user) return;
  const server = mediaServerUrl();
  let next = null;
  try {
    const res = await fetch(`${server}/api/media/ticket`, {
      method: "POST",
      headers: { Authorization: `Bearer ${await user.getIdToken()}` },
      cache: "no-store"
    });
    if (res.ok) {
      const data = await res.json();
      next = { value: data.ticket, expiresAt: data.expiresAt, server };
    }
  } catch {
    next = null;
  }
  if (mediaUser !== user) return;
  // Renueva una hora antes de caducar; si el servidor no responde, reintenta en un minuto.
  const wait = next ? Math.max(60000, next.expiresAt - Date.now() - 3600000) : 60000;
  ticketTimer = setTimeout(refreshTicket, wait);
  if (next?.value === ticket?.value && next?.server === ticket?.server) return;
  if (!next && ticket?.server === server && ticket.expiresAt > Date.now()) return;
  ticket = next;
  notifyAccess();
}

// Espera a que haya ticket de lectura (p. ej. al abrir un enlace de Quick Share recién iniciada la sesión).
export function waitForMediaAccess(timeout = 15000) {
  if (ticket) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      off();
      resolve(false);
    }, timeout);
    const off = onMediaAccessChange(() => {
      if (!ticket) return;
      clearTimeout(timer);
      off();
      resolve(true);
    });
  });
}

export function startMediaSession(user) {
  if (mediaUser?.uid === user?.uid) return;
  mediaUser = user;
  ticket = null;
  notifyAccess();
  refreshTicket();
}

export function stopMediaSession() {
  mediaUser = null;
  ticket = null;
  clearTimeout(ticketTimer);
  notifyAccess();
}

onMediaServerChange(() => {
  ticket = null;
  notifyAccess();
  refreshTicket();
});

/* ---------- Resolución de referencias ---------- */
export const isLocalRef = (ref) => typeof ref === "string" && ref.startsWith("local:");

// ¿Se puede mostrar ya? (los archivos del HDD exigen sesión iniciada y ticket).
export const canViewMedia = (ref) => !isLocalRef(ref) || Boolean(ticket);

export function resolveMediaUrl(ref) {
  if (!isLocalRef(ref)) return ref;
  const url = `${mediaServerUrl()}/media/${ref.slice("local:".length)}`;
  // Las fotos de perfil llevan ?v= (se sobrescriben en la misma ruta): el ticket se añade con &.
  return ticket ? `${url}${url.includes("?") ? "&" : "?"}k=${encodeURIComponent(ticket.value)}` : url;
}

// Pruebas antiguas guardadas en Cloudinary: miniatura vía transformación (solo lectura).
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
function xhrUpload({ url, body, headers = {}, onProgress, method = "POST" }) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url);
    Object.entries(headers).forEach(([k, v]) => xhr.setRequestHeader(k, v));
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch {}
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(Object.assign(new Error(data.error || `Error al subir (${xhr.status}).`), { status: xhr.status, received: data.received }));
    };
    xhr.onerror = () => reject(Object.assign(new Error("No se pudo contactar con el servidor de almacenamiento de Tux."), { network: true }));
    xhr.send(body);
  });
}

// Archivos grandes: se reserva la subida y se envían trozos de ≤ 48 MB (límite de Cloudflare: 100 MB).
// Cada trozo se reintenta hasta 3 veces; el servidor indica desde qué byte continuar.
async function chunkedUpload({ server, file, token, onProgress }) {
  const auth = { Authorization: `Bearer ${token}` };
  const res = await fetch(`${server}/api/media/uploads`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ mime: file.type, size: file.size })
  }).catch(() => null);
  if (!res) throw new Error("No se pudo contactar con el servidor de almacenamiento de Tux.");
  const begin = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(begin.error || `Error al subir (${res.status}).`);

  const chunkSize = Math.min(begin.chunkSize || CHUNK_THRESHOLD, CHUNK_THRESHOLD);
  let offset = 0;
  let attempts = 0;
  while (true) {
    const end = Math.min(offset + chunkSize, file.size);
    try {
      const data = await xhrUpload({
        method: "PUT",
        url: `${server}/api/media/uploads/${begin.uploadId}?offset=${offset}`,
        body: file.slice(offset, end),
        headers: { ...auth, "Content-Type": "application/octet-stream" },
        onProgress: (p) => onProgress?.((offset + p * (end - offset)) / file.size)
      });
      attempts = 0;
      if (data.done) return data;
      offset = data.received;
    } catch (err) {
      if (++attempts > 3 || !(err.network || err.status === 409)) throw err;
      if (Number.isInteger(err.received)) offset = err.received;
      await new Promise((r) => setTimeout(r, 1500 * attempts));
    }
  }
}

// Comprueba que el servidor multimedia responde y que el disco externo está montado.
// Devuelve también la URL pública del túnel que anuncia el servidor (para el panel /admin).
export async function checkMediaServer(server = mediaServerUrl()) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(`${server}/health`, { signal: controller.signal, cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.ok) return { ok: true, server, publicUrl: data.publicUrl || "" };
    return { ok: false, server, message: "El disco externo HDD no está conectado al servidor de Tux." };
  } catch {
    return { ok: false, server, message: "El servidor de almacenamiento de Tux no responde (¿Mac mini apagado o túnel caído?)." };
  } finally {
    clearTimeout(timer);
  }
}

// Sube el archivo (y su miniatura si es vídeo). Devuelve { url, thumbUrl } como referencias guardables.
export async function uploadMedia({ file, kind, user, thumbBlob, onProgress }) {
  const server = mediaServerUrl();
  const token = await user.getIdToken();
  const main = file.size > CHUNK_THRESHOLD
    ? await chunkedUpload({ server, file, token, onProgress })
    : await xhrUpload({
        url: `${server}/api/media`,
        body: file,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": file.type, "X-Tux-Role": "main" },
        onProgress
      });
  // Fotos: si no hay versión reducida (o falla), la miniatura es el propio archivo.
  let thumbUrl = kind === "image" ? main.key : "";
  if (thumbBlob) {
    const thumb = await xhrUpload({
      url: `${server}/api/media`,
      body: thumbBlob,
      headers: {
        Authorization: `Bearer ${token}`, "Content-Type": "image/jpeg",
        "X-Tux-Role": "thumb", "X-Tux-Media-Id": main.id
      }
    }).catch(() => null);
    thumbUrl = thumb?.key || thumbUrl;
  }
  return { url: main.key, thumbUrl };
}

// Archivo ya subido (Quick Share): solo falta su miniatura. Devuelve { url, thumbUrl } como uploadMedia.
export async function finishStagedUpload({ ref, kind, user, thumbBlob }) {
  let thumbUrl = kind === "image" ? ref : "";
  if (thumbBlob) {
    const mediaId = ref.split("/").pop().split(".")[0];
    const thumb = await xhrUpload({
      url: `${mediaServerUrl()}/api/media`,
      body: thumbBlob,
      headers: {
        Authorization: `Bearer ${await user.getIdToken()}`, "Content-Type": "image/jpeg",
        "X-Tux-Role": "thumb", "X-Tux-Media-Id": mediaId
      }
    }).catch(() => null);
    thumbUrl = thumb?.key || thumbUrl;
  }
  return { url: ref, thumbUrl };
}

// Foto de perfil ya recortada (JPG). Devuelve la referencia "local:users/{uid}/avatar.jpg?v=…".
export async function uploadAvatar(blob, user) {
  const data = await xhrUpload({
    method: "PUT",
    url: `${mediaServerUrl()}/api/avatar`,
    body: blob,
    headers: { Authorization: `Bearer ${await user.getIdToken()}`, "Content-Type": "image/jpeg" }
  });
  return data.key;
}

export const isLocalAvatar = (ref) => /^local:users\/[A-Za-z0-9]+\/avatar\.jpg/.test(ref || "");

// Portada 360°: ángulo inicial elegido por el autor (grados, redondeados).
export function setProofCover(proofId, { yaw, pitch, fov }) {
  const round = (n, min, max) => Math.round(Math.min(max, Math.max(min, n)) * 10) / 10;
  return updateDoc(doc(db, "proofs", proofId), {
    cover: { yaw: round(yaw, -180, 180), pitch: round(pitch, -90, 90), fov: round(fov, 30, 120) }
  });
}

// Borra físicamente un archivo del HDD a través del servidor (el propio dueño o un admin).
// Las referencias antiguas de Cloudinary no se pueden borrar sin firma: se ignoran.
export async function deleteMediaRef(ref, user) {
  if (!isLocalRef(ref)) return false;
  const token = await user.getIdToken();
  let res;
  try {
    res = await fetch(`${mediaServerUrl()}/api/media/${ref.slice("local:".length).split("?")[0]}`, {
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
  return onSnapshot(q, (snap) => callback(proofsFrom(snap)), onError);
}

const proofsFrom = (snap) => {
  const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  items.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
  return items;
};

// Pruebas de un usuario (perfil público). Igualdad simple + orden en cliente: sin índice compuesto.
export const watchUserProofs = (uid, callback, onError) =>
  onSnapshot(query(collection(db, "proofs"), where("uid", "==", uid), limit(200)),
    (snap) => callback(proofsFrom(snap)), onError);

// Feed «Descubrir»: las pruebas más recientes de toda la comunidad.
export const watchRecentProofs = (callback, onError) =>
  onSnapshot(query(collection(db, "proofs"), orderBy("createdAt", "desc"), limit(60)),
    (snap) => callback(proofsFrom(snap)), onError);

// Feed «Siguiendo»: pruebas de una lista de usuarios (consultas "in" de 30 en 30).
export function watchProofsByAuthors(uids, callback, onError) {
  const groups = [];
  for (let i = 0; i < uids.length; i += 30) groups.push(uids.slice(i, i + 30));
  if (!groups.length) {
    callback([]);
    return () => {};
  }
  const results = groups.map(() => []);
  const unsubs = groups.map((group, i) =>
    onSnapshot(query(collection(db, "proofs"), where("uid", "in", group), limit(60)), (snap) => {
      results[i] = proofsFrom(snap);
      callback([].concat(...results)
        .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0)).slice(0, 80));
    }, onError));
  return () => unsubs.forEach((u) => u());
}

// Muestras 360° públicas (CORS abierto) para que la galería no arranque vacía.
export const SAMPLE_VR = [
  { id: "vr-sample-1", url: "https://cdn.aframe.io/360-image-gallery-boilerplate/img/sechelt.jpg", type: "image", activityTitle: "Atardecer en la costa", authorName: "Tux", sample: true },
  { id: "vr-sample-2", url: "https://cdn.aframe.io/360-image-gallery-boilerplate/img/city.jpg", type: "image", activityTitle: "Paseo por la ciudad", authorName: "Tux", sample: true },
  { id: "vr-sample-3", url: "https://cdn.aframe.io/360-image-gallery-boilerplate/img/cubes.jpg", type: "image", activityTitle: "Sala inmersiva", authorName: "Tux", sample: true }
].map((s) => ({ ...s, thumbUrl: s.url, is360: true }));
