// Módulo social: "Me apunto" (likes), guardados y comentarios.
// likes/{uid}_{activityId}, saved/{uid}_{activityId}:
//   { uid, activityId, createdAt }
// activities/{id}/comments/{commentId}: { authorId, authorName, text, createdAt }
import {
  collection,
  doc,
  setDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  writeBatch,
  increment,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "./firebaseConfig.js";

const relationId = (uid, activityId) => `${uid}_${activityId}`;

// Devuelve un listener con el Set de activityIds del usuario en una colección de relación.
function watchRelation(name, uid, callback) {
  const q = query(collection(db, name), where("uid", "==", uid));
  return onSnapshot(q, (snap) => {
    const entries = snap.docs.map((d) => d.data());
    entries.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
    callback(entries.map((e) => e.activityId));
  }, (err) => console.warn(`Tux: no se pudo escuchar ${name}.`, err));
}

export const watchLikes = (uid, cb) => watchRelation("likes", uid, cb);
export const watchSaved = (uid, cb) => watchRelation("saved", uid, cb);

// El like y el contador se escriben en el mismo batch; las reglas verifican ambos.
export async function setLike(uid, activityId, liked) {
  const batch = writeBatch(db);
  const likeRef = doc(db, "likes", relationId(uid, activityId));
  if (liked) batch.set(likeRef, { uid, activityId, createdAt: serverTimestamp() });
  else batch.delete(likeRef);
  batch.update(doc(db, "activities", activityId), { likeCount: increment(liked ? 1 : -1) });
  await batch.commit();
}

async function setRelation(name, uid, activityId, on) {
  const ref = doc(db, name, relationId(uid, activityId));
  if (on) await setDoc(ref, { uid, activityId, createdAt: serverTimestamp() });
  else await deleteDoc(ref);
}

export const setSaved = (uid, activityId, on) => setRelation("saved", uid, activityId, on);

/* ---------- Comentarios ---------- */
const commentsCol = (activityId) => collection(db, "activities", activityId, "comments");

export function watchComments(activityId, callback) {
  const q = query(commentsCol(activityId), orderBy("createdAt", "asc"), limit(200));
  return onSnapshot(q, (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
}

export async function addComment(activityId, user, authorName, text) {
  const batch = writeBatch(db);
  const ref = doc(commentsCol(activityId));
  batch.set(ref, {
    authorId: user.uid,
    authorName: authorName.slice(0, 24),
    text: text.trim().slice(0, 500),
    createdAt: serverTimestamp()
  });
  batch.update(doc(db, "activities", activityId), { commentCount: increment(1) });
  await batch.commit();
}

export async function deleteComment(activityId, commentId) {
  const batch = writeBatch(db);
  batch.delete(doc(commentsCol(activityId), commentId));
  batch.update(doc(db, "activities", activityId), { commentCount: increment(-1) });
  await batch.commit();
}
