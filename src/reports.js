// Reportes de publicaciones: reports/{proofId}_{reporterUid} (uno por usuario y publicación).
// Solo los admins pueden leerlos y resolverlos (panel /admin → Reportadas).
import { doc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "./firebaseConfig.js";

export const REPORT_REASONS = [
  { id: "inappropriate", emoji: "🚫", label: "Contenido inapropiado u ofensivo" },
  { id: "spam", emoji: "📢", label: "Spam o publicidad" },
  { id: "fake", emoji: "🎭", label: "No es una prueba real del plan" },
  { id: "privacy", emoji: "🔒", label: "Vulnera la privacidad o derechos de alguien" },
  { id: "other", emoji: "💬", label: "Otro motivo" }
];

export const reportLabel = (id) => REPORT_REASONS.find((r) => r.id === id)?.label || id;

export function reportProof(user, proof, reason, note = "") {
  return setDoc(doc(db, "reports", `${proof.id}_${user.uid}`), {
    proofId: proof.id,
    proofUid: proof.uid,
    activityTitle: (proof.activityTitle || "").slice(0, 80),
    reporterUid: user.uid,
    reason,
    note: note.trim().slice(0, 280),
    createdAt: serverTimestamp()
  });
}
