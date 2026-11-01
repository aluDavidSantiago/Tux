// Módulo "Mis planes": preferencias, actividad estrella e historial del usuario.
// users/{uid}.prefs: { frequencyDays, interests[], maxBudget, maxEffort }
// users/{uid}.star:  { activityId, period, frequencyDays }
// users/{uid}/history/{activityId}:
//   { activityId, status: accepted|completed|discarded, title, category, emoji, imageUrl,
//     reason?, note?, proofId?, proofUrl?, proofType?, is360?, updatedAt }
import {
  collection,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "./firebaseConfig.js";

export const FREQUENCIES = [
  { days: 1, label: "Diaria", long: "cada día" },
  { days: 2, label: "2 días", long: "cada 2 días" },
  { days: 3, label: "3 días", long: "cada 3 días" },
  { days: 7, label: "Semanal", long: "cada semana" }
];

export const DISCARD_REASONS = [
  { id: "material", label: "No tengo el material requerido", emoji: "🎒" },
  { id: "location", label: "Ubicación inalcanzable", emoji: "📍" },
  { id: "vibe", label: "No es mi vibe", emoji: "🙅" },
  { id: "budget", label: "Fuera de mi presupuesto", emoji: "💸" },
  { id: "time", label: "No tengo tiempo ahora", emoji: "⏳" },
  { id: "other", label: "Otro motivo", emoji: "✍️" }
];

export const DEFAULT_PREFS = { frequencyDays: 1, interests: [], maxBudget: "high", maxEffort: "high" };

export function normalizePrefs(prefs) {
  const p = { ...DEFAULT_PREFS, ...(prefs || {}) };
  if (!FREQUENCIES.some((f) => f.days === p.frequencyDays)) p.frequencyDays = DEFAULT_PREFS.frequencyDays;
  p.interests = Array.isArray(p.interests) ? p.interests.slice(0, 5) : [];
  return p;
}

const userRef = (uid) => doc(db, "users", uid);
const historyRef = (uid, activityId) => doc(db, "users", uid, "history", activityId);

export const savePrefs = (uid, prefs) => updateDoc(userRef(uid), { prefs: normalizePrefs(prefs) });
export const saveStar = (uid, star) => updateDoc(userRef(uid), { star });

export function watchHistory(uid, callback) {
  return onSnapshot(collection(db, "users", uid, "history"), (snap) => {
    const map = new Map();
    snap.docs.forEach((d) => map.set(d.id, d.data()));
    callback(map);
  }, (err) => console.warn("Tux: no se pudo escuchar el historial.", err));
}

// Guarda el estado del plan con una copia mínima de la actividad (por si se borra después).
export function setHistory(uid, activity, status, extra = {}) {
  return setDoc(historyRef(uid, activity.id), {
    activityId: activity.id,
    status,
    title: (activity.title || "").slice(0, 80),
    category: activity.category || "chill",
    emoji: activity.emoji || "",
    imageUrl: activity.imageUrl || "",
    ...extra,
    updatedAt: serverTimestamp()
  });
}

// Restaurar desde la papelera = olvidar el descarte; vuelve a ser sugerible.
export const restoreFromTrash = (uid, activityId) => deleteDoc(historyRef(uid, activityId));
