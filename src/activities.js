// Módulo de actividades: lectura desde Firestore con filtros de presupuesto y esfuerzo.
// Colección esperada: "activities" con campos { title, description, emoji, budget, effort, createdAt }.
//   budget: "free" | "low" | "mid"    effort: "low" | "mid"
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "./firebaseConfig.js";

export const BUDGETS = { all: "Todo", free: "Gratis", low: "$", mid: "$$" };
export const EFFORTS = { all: "Todo", low: "Relax", mid: "Moderado" };

// Actividades de ejemplo para la maqueta mientras la colección esté vacía.
export const SAMPLE_ACTIVITIES = [
  { id: "s1", emoji: "🌅", title: "Mira el atardecer", description: "Busca un punto alto cerca de casa y quédate hasta que salgan las primeras estrellas.", budget: "free", effort: "low" },
  { id: "s2", emoji: "☕", title: "Café en un sitio nuevo", description: "Elige la cafetería más cercana en la que nunca hayas entrado.", budget: "low", effort: "low" },
  { id: "s3", emoji: "📚", title: "Biblioteca sin plan", description: "Coge el tercer libro de una estantería al azar y lee un capítulo.", budget: "free", effort: "low" },
  { id: "s4", emoji: "🚲", title: "Ruta en bici", description: "Pedalea 30 minutos sin rumbo fijo y vuelve por un camino distinto.", budget: "free", effort: "mid" },
  { id: "s5", emoji: "🍜", title: "Cena de mercado", description: "Compra tres ingredientes que nunca hayas probado y cocina algo sencillo.", budget: "mid", effort: "mid" },
  { id: "s6", emoji: "🧺", title: "Picnic exprés", description: "Un bocadillo, una manta y el parque más próximo. Nada más.", budget: "low", effort: "low" }
];

export async function fetchActivities({ budget = "all", effort = "all", max = 20 } = {}) {
  const constraints = [];
  if (budget !== "all") constraints.push(where("budget", "==", budget));
  if (effort !== "all") constraints.push(where("effort", "==", effort));
  constraints.push(orderBy("createdAt", "desc"), limit(max));

  const snapshot = await getDocs(query(collection(db, "activities"), ...constraints));
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

export function filterSamples({ budget = "all", effort = "all" } = {}) {
  return SAMPLE_ACTIVITIES.filter(
    (a) => (budget === "all" || a.budget === budget) && (effort === "all" || a.effort === effort)
  );
}
