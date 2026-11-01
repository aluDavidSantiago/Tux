// Módulo de actividades (TuxPlans): catálogo de opciones, lectura en tiempo real y publicación.
// Documento activities/{id}:
//   { title, description, emoji, imageUrl, category, budget, effort, when, duration,
//     authorId, authorName, likeCount, commentCount, createdAt }
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
