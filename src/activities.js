// Módulo de actividades (TuxPlans): catálogo de opciones, lectura en tiempo real y publicación.
// Documento activities/{id}:
//   { title, description, emoji, imageUrl, category, budget, effort, when, duration,
//     authorId, authorName, likeCount, commentCount, createdAt, seed? }
import {
  collection,
  doc,
  addDoc,
  getDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  getDocs,
  writeBatch,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "./firebaseConfig.js";

export const CATEGORIES = {
  chill: { label: "Chill", emoji: "🛋️" },
  aventura: { label: "Aventura", emoji: "🧭" },
  gastronomia: { label: "Gastronomía", emoji: "🍜" },
  cultura: { label: "Cultura", emoji: "🎨" },
  nocturno: { label: "Nocturno", emoji: "🌙" }
};

export const BUDGETS = {
  free: { label: "Gratis", short: "Gratis", range: "0 €" },
  low: { label: "<10 €", short: "$", range: "menos de 10 €" },
  mid: { label: "10–25 €", short: "$$", range: "10–25 €" },
  high: { label: "+25 €", short: "$$$", range: "más de 25 €" }
};

export const EFFORTS = {
  low: { label: "Relax total", short: "Bajo", level: 1 },
  mid: { label: "Paseo ligero", short: "Medio", level: 2 },
  high: { label: "Activo", short: "Alto", level: 3 }
};

export const WHEN = {
  day: { label: "Día", emoji: "☀️" },
  night: { label: "Noche", emoji: "🌙" },
  weekend: { label: "Finde", emoji: "📅" }
};

export const DURATIONS = ["15 min", "30 min", "1 h", "2 h", "Medio día"];

const FEED_SIZE = 100;
const activitiesCol = collection(db, "activities");

// Planes de ejemplo para cuando la colección aún está vacía.
export const SAMPLE_ACTIVITIES = [
  { id: "sample-1", emoji: "🌅", title: "Atardecer desde un mirador", description: "Busca el punto más alto cerca de casa y quédate hasta que salgan las primeras estrellas.", category: "chill", budget: "free", effort: "low", when: "night", duration: "1 h", imageUrl: "https://images.unsplash.com/photo-1495616811223-4d98c6e9c869?w=1080&q=80" },
  { id: "sample-2", emoji: "☕", title: "Café en un sitio nuevo", description: "Entra en la cafetería más cercana en la que nunca hayas estado y pide lo de la casa.", category: "gastronomia", budget: "low", effort: "low", when: "day", duration: "30 min", imageUrl: "https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?w=1080&q=80" },
  { id: "sample-3", emoji: "📚", title: "Biblioteca sin plan", description: "Coge el tercer libro de una estantería al azar y lee un capítulo entero.", category: "cultura", budget: "free", effort: "low", when: "day", duration: "1 h", imageUrl: "" },
  { id: "sample-4", emoji: "🚲", title: "Ruta en bici sin rumbo", description: "Pedalea 30 minutos sin destino y vuelve por un camino que no conozcas.", category: "aventura", budget: "free", effort: "high", when: "weekend", duration: "1 h", imageUrl: "https://images.unsplash.com/photo-1507035895480-2b3156c31fc8?w=1080&q=80" },
  { id: "sample-5", emoji: "🍜", title: "Cena de mercado", description: "Compra tres ingredientes que nunca hayas probado y cocina algo sencillo con ellos.", category: "gastronomia", budget: "mid", effort: "mid", when: "night", duration: "2 h", imageUrl: "" },
  { id: "sample-6", emoji: "🎷", title: "Jazz en directo", description: "Busca un local con música en vivo esta noche. Mesa pequeña, una bebida y escuchar.", category: "nocturno", budget: "high", effort: "low", when: "night", duration: "2 h", imageUrl: "https://images.unsplash.com/photo-1415201364774-f6f0bb35f28f?w=1080&q=80" },
  { id: "sample-7", emoji: "🧺", title: "Picnic exprés", description: "Un bocadillo, una manta y el parque más próximo. Nada más.", category: "chill", budget: "low", effort: "mid", when: "weekend", duration: "1 h", imageUrl: "" }
].map((a) => ({ ...a, sample: true, likeCount: 0, commentCount: 0, authorName: "Tux" }));

const fromSnap = (snap) => ({ id: snap.id, ...snap.data() });

// Escucha en tiempo real los planes más recientes (los contadores se actualizan solos).
export function watchActivities(callback, onError) {
  const q = query(activitiesCol, orderBy("createdAt", "desc"), limit(FEED_SIZE));
  return onSnapshot(q, (snap) => callback(snap.docs.map(fromSnap)), onError);
}

export async function getActivity(id) {
  if (id.startsWith("sample-")) return SAMPLE_ACTIVITIES.find((a) => a.id === id) || null;
  const snap = await getDoc(doc(db, "activities", id));
  return snap.exists() ? fromSnap(snap) : null;
}

export async function getActivitiesByAuthor(uid) {
  // Sin orderBy para no requerir índice compuesto; se ordena en cliente.
  const snap = await getDocs(query(activitiesCol, where("authorId", "==", uid)));
  return snap.docs.map(fromSnap).sort((a, b) => millis(b.createdAt) - millis(a.createdAt));
}

export function createActivity(data, user, profile) {
  return addDoc(activitiesCol, {
    title: data.title.trim(),
    description: data.description.trim(),
    emoji: data.emoji || CATEGORIES[data.category].emoji,
    imageUrl: data.imageUrl.trim(),
    category: data.category,
    budget: data.budget,
    effort: data.effort,
    when: data.when,
    duration: data.duration,
    authorId: user.uid,
    authorName: profile?.nickname || user.displayName || "Tux",
    likeCount: 0,
    commentCount: 0,
    createdAt: serverTimestamp()
  });
}

export const deleteActivity = (id) => deleteDoc(doc(db, "activities", id));

/* ---------- Herramientas de desarrollo: planes de prueba ---------- */
const PANO = "https://cdn.aframe.io/360-image-gallery-boilerplate/img";
const SEED_TEMPLATES = [
  { title: "Mirador al amanecer", description: "Sube antes de que salga el sol y mira cómo se enciende la ciudad.", category: "chill", budget: "free", effort: "mid", when: "day", duration: "1 h", imageUrl: `${PANO}/sechelt.jpg` },
  { title: "Ruta urbana en 360°", description: "Recorre tu barrio y captura una esquina en 360°.", category: "aventura", budget: "free", effort: "mid", when: "weekend", duration: "2 h", imageUrl: `${PANO}/city.jpg` },
  { title: "Instalación inmersiva", description: "Busca una sala de arte con instalaciones y explórala con calma.", category: "cultura", budget: "low", effort: "low", when: "weekend", duration: "1 h", imageUrl: `${PANO}/cubes.jpg` },
  { title: "Desayuno en una terraza", description: "Pide algo que nunca hayas probado y lee el periódico sin prisa.", category: "gastronomia", budget: "low", effort: "low", when: "day", duration: "1 h", imageUrl: "" },
  { title: "Paseo nocturno sin móvil", description: "Treinta minutos caminando de noche sin mirar la pantalla.", category: "nocturno", budget: "free", effort: "low", when: "night", duration: "30 min", imageUrl: "" },
  { title: "Mercado de segunda mano", description: "Encuentra un objeto curioso por menos de 5 €.", category: "cultura", budget: "low", effort: "mid", when: "weekend", duration: "2 h", imageUrl: "" },
  { title: "Picnic de 15 minutos", description: "Una fruta, un banco al sol y nada más.", category: "chill", budget: "free", effort: "low", when: "day", duration: "15 min", imageUrl: "" },
  { title: "Cena con receta nueva", description: "Elige una receta de otro país y cocínala con lo que tengas.", category: "gastronomia", budget: "mid", effort: "mid", when: "night", duration: "2 h", imageUrl: "" },
  { title: "Bici hasta el río", description: "Pedalea hasta el agua más cercana y vuelve por otra ruta.", category: "aventura", budget: "free", effort: "high", when: "day", duration: "2 h", imageUrl: "" },
  { title: "Concierto pequeño", description: "Busca un directo en un local pequeño esta noche.", category: "nocturno", budget: "high", effort: "low", when: "night", duration: "2 h", imageUrl: "" },
  { title: "Museo gratuito", description: "Entra en un museo el día de entrada libre y elige una sola sala.", category: "cultura", budget: "free", effort: "low", when: "weekend", duration: "1 h", imageUrl: "" },
  { title: "Escalada en rocódromo", description: "Prueba una sesión de iniciación en el rocódromo de tu zona.", category: "aventura", budget: "mid", effort: "high", when: "weekend", duration: "Medio día", imageUrl: "" }
];

// Crea hasta `count` planes de prueba (marcados con seed: true) que el usuario aún no tenga.
export async function seedActivities(user, profile, count = 6) {
  const existing = new Set((await getActivitiesByAuthor(user.uid)).map((a) => a.title));
  const pool = SEED_TEMPLATES.filter((t) => !existing.has(t.title)).sort(() => Math.random() - 0.5).slice(0, count);
  const batch = writeBatch(db);
  for (const t of pool) {
    batch.set(doc(activitiesCol), {
      ...t,
      emoji: CATEGORIES[t.category].emoji,
      authorId: user.uid,
      authorName: profile?.nickname || user.displayName || "Tux",
      likeCount: 0,
      commentCount: 0,
      seed: true,
      createdAt: serverTimestamp()
    });
  }
  if (pool.length) await batch.commit();
  return pool.length;
}

export async function deleteSeedActivities(uid) {
  const seeds = (await getActivitiesByAuthor(uid)).filter((a) => a.seed);
  const batch = writeBatch(db);
  seeds.forEach((a) => batch.delete(doc(db, "activities", a.id)));
  if (seeds.length) await batch.commit();
  return seeds.length;
}

// Filtros: cada grupo es un Set; vacío = sin restricción.
export function matchesFilters(a, f) {
  if (f.budget.size && !f.budget.has(a.budget)) return false;
  if (f.effort.size && !f.effort.has(a.effort)) return false;
  if (f.category.size && !f.category.has(a.category)) return false;
  if (f.when.size && !f.when.has(a.when)) return false;
  if (f.search) {
    const text = normalize(`${a.title} ${a.description} ${CATEGORIES[a.category]?.label || ""}`);
    if (!f.search.split(/\s+/).every((word) => text.includes(word))) return false;
  }
  return true;
}

export const normalize = (s) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

export const millis = (ts) => (ts?.toMillis ? ts.toMillis() : 0);

export function isValidImageUrl(url) {
  if (!url) return true;
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}
