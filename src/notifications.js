// Notificaciones de usuario (las envían los admins desde /admin).
// notifications/{id}: { toUid, title, body, kind: info|360|warning, read, fromName, createdAt }
import {
  collection,
  doc,
  query,
  where,
  limit,
  onSnapshot,
  updateDoc,
  deleteDoc,
  writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "./firebaseConfig.js";

export const NOTIFICATION_KINDS = {
  info: { label: "Aviso", emoji: "💬" },
  "360": { label: "Formato 360°", emoji: "🌐" },
  warning: { label: "Importante", emoji: "⚠️" }
};

export function watchNotifications(uid, callback) {
  const q = query(collection(db, "notifications"), where("toUid", "==", uid), limit(100));
  return onSnapshot(q, (snap) => {
    const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    items.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
    callback(items);
  }, (err) => console.warn("Tux: no se pudieron cargar las notificaciones.", err));
}

export async function markAllRead(items) {
  const unread = items.filter((n) => !n.read);
  if (!unread.length) return;
  const batch = writeBatch(db);
  unread.forEach((n) => batch.update(doc(db, "notifications", n.id), { read: true }));
  await batch.commit();
}

export const deleteNotification = (id) => deleteDoc(doc(db, "notifications", id));
export const markRead = (id) => updateDoc(doc(db, "notifications", id), { read: true });
