// Motor "TuxPlans Central": elige UNA actividad estrella por periodo según el perfil.
// Funciones puras: sin Firestore ni DOM.
import { CATEGORIES, BUDGETS } from "./activities.js";

const DAY = 86400000;
const BUDGET_ORDER = ["free", "low", "mid", "high"];
const EFFORT_ORDER = ["low", "mid", "high"];

// Día local (cambia a medianoche del usuario, no en UTC).
function localDayIndex(now = new Date()) {
  return Math.floor((now.getTime() - now.getTimezoneOffset() * 60000) / DAY);
}

export const currentPeriod = (frequencyDays, now = new Date()) =>
  Math.floor(localDayIndex(now) / frequencyDays);

export function msUntilNextPeriod(frequencyDays, now = new Date()) {
  const nextDay = (currentPeriod(frequencyDays, now) + 1) * frequencyDays;
  return nextDay * DAY + now.getTimezoneOffset() * 60000 - now.getTime();
}

// Hash FNV-1a → [0, 1): variedad determinista por usuario y periodo.
function hash01(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 4294967296;
}

// Estados del historial que excluyen una actividad de nuevas sugerencias.
const EXCLUDED = new Set(["accepted", "completed", "discarded"]);

export function scoreActivity(activity, prefs) {
  let score = 0;
  const reasons = [];
  if (prefs.interests.length && prefs.interests.includes(activity.category)) {
    score += 3;
    reasons.push(`Te gusta ${CATEGORIES[activity.category]?.label || activity.category}`);
  }
  const budgetOk = BUDGET_ORDER.indexOf(activity.budget) <= BUDGET_ORDER.indexOf(prefs.maxBudget);
  const effortOk = EFFORT_ORDER.indexOf(activity.effort) <= EFFORT_ORDER.indexOf(prefs.maxEffort);
  if (budgetOk) {
    score += 1;
    if (activity.budget === "free") reasons.push("Gratis");
    else if (prefs.maxBudget !== "high") reasons.push(`Dentro de tu presupuesto (${BUDGETS[activity.budget]?.short})`);
  } else {
    score -= 2;
  }
  if (effortOk) score += 1;
  else score -= 2;
  if ((activity.likeCount || 0) >= 3) {
    score += Math.min(1.5, Math.log10(activity.likeCount + 1));
    reasons.push("Popular en Tux");
  }
  return { score, reasons };
}

export function pickStar(activities, { prefs, history, seed }) {
  let best = null;
  for (const activity of activities) {
    if (EXCLUDED.has(history.get(activity.id)?.status)) continue;
    const { score, reasons } = scoreActivity(activity, prefs);
    const total = score + hash01(`${seed}:${activity.id}`) * 1.5;
    if (!best || total > best.total) best = { activity, reasons, total };
  }
  if (best && !best.reasons.length) best.reasons.push("Elegida por Tux para ti");
  return best;
}
