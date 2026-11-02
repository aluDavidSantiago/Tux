// Módulo social: "Me apunto" (likes), guardados, comentarios y seguidores.
// likes/{uid}_{activityId}, saved/{uid}_{activityId}:
//   { uid, activityId, createdAt }
// activities/{id}/comments/{commentId}: { authorId, authorName, text, createdAt }
// follows/{followerUid}_follows_{targetUid}: { followerUid, targetUid, createdAt }
//   + contadores users/{uid}.followersCount / followingCount (mismo batch; las reglas lo verifican).
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
  getDocs,
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

/* ---------- Seguidores ---------- */
export const followId = (followerUid, targetUid) => `${followerUid}_follows_${targetUid}`;

// Relación y ambos contadores en un único batch: las reglas exigen que vayan juntos.
export async function setFollow(followerUid, targetUid, on) {
  if (followerUid === targetUid) throw new Error("No puedes seguirte a ti mismo.");
  const batch = writeBatch(db);
  const ref = doc(db, "follows", followId(followerUid, targetUid));
  if (on) batch.set(ref, { followerUid, targetUid, createdAt: serverTimestamp() });
  else batch.delete(ref);
  batch.update(doc(db, "users", followerUid), { followingCount: increment(on ? 1 : -1) });
  batch.update(doc(db, "users", targetUid), { followersCount: increment(on ? 1 : -1) });
  await batch.commit();
}

// uids a los que sigue un usuario (en tiempo real).
export function watchFollowing(uid, callback) {
  const q = query(collection(db, "follows"), where("followerUid", "==", uid), limit(500));
  return onSnapshot(q, (snap) => callback(snap.docs.map((d) => d.data().targetUid)),
    (err) => console.warn("Tux: no se pudo escuchar a quién sigues.", err));
}

// Lista de seguidores o seguidos de cualquier usuario (perfil público).
export async function listFollows(uid, kind) {
  const field = kind === "followers" ? "targetUid" : "followerUid";
  const snap = await getDocs(query(collection(db, "follows"), where(field, "==", uid), limit(300)));
  const entries = snap.docs.map((d) => d.data());
  entries.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
  return entries.map((e) => (kind === "followers" ? e.followerUid : e.targetUid));
}
