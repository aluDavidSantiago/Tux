// Operaciones de administración. Los permisos reales los imponen las reglas de Firestore
// (colección admins/{uid}) y el servidor del HDD; aquí solo se orquestan.
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  writeBatch,
  increment,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "./firebaseConfig.js";
import { deleteMediaRef, deleteProofDoc } from "./media.js";
import { mediaServerUrl } from "./mediaConfig.js";
import { removeProofFromHistory } from "./plans.js";

// Solo puede leerse el propio documento admins/{uid}: si existe, el usuario es admin.
export async function isAdminUser(uid) {
  try {
    return (await getDoc(doc(db, "admins", uid))).exists();
  } catch {
    return false;
  }
}

const fromSnap = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));

export const listProofs = async () =>
  fromSnap(await getDocs(query(collection(db, "proofs"), orderBy("createdAt", "desc"), limit(300))));
export const listActivities = async () =>
  fromSnap(await getDocs(query(collection(db, "activities"), orderBy("createdAt", "desc"), limit(300))));
export const listUsers = async () => fromSnap(await getDocs(query(collection(db, "users"), limit(500))));
export const listSentNotifications = async () =>
  fromSnap(await getDocs(query(collection(db, "notifications"), orderBy("createdAt", "desc"), limit(60))));

// Borra los archivos de una prueba en el HDD (principal y miniatura) antes de tocar Firestore,
// para no dejar registros apuntando a ficheros huérfanos ni ficheros sin registro.
async function deleteProofFiles(proof, adminUser) {
  await deleteMediaRef(proof.url, adminUser);
  if (proof.thumbUrl && proof.thumbUrl !== proof.url) await deleteMediaRef(proof.thumbUrl, adminUser).catch(() => {});
}

// "Quitar solo prueba": borra archivo + registro de la prueba y devuelve el plan del usuario a "en curso".
export async function adminRemoveProofMedia(proof, adminUser) {
  await deleteProofFiles(proof, adminUser);
  await deleteProofDoc(proof.id);
  const entry = await getDoc(doc(db, "users", proof.uid, "history", proof.activityId)).catch(() => null);
  if (entry?.exists() && entry.data().proofId === proof.id) await removeProofFromHistory(proof.uid, proof.activityId);
}

// "Eliminar publicación" (prueba): borra archivo + registro + la entrada de historial asociada.
export async function adminDeleteProof(proof, adminUser) {
  await deleteProofFiles(proof, adminUser);
  const batch = writeBatch(db);
  batch.delete(doc(db, "proofs", proof.id));
  const entry = await getDoc(doc(db, "users", proof.uid, "history", proof.activityId)).catch(() => null);
  if (entry?.exists() && entry.data().proofId === proof.id) batch.delete(entry.ref);
  await batch.commit();
}

export const adminDeleteActivity = async (id) => {
  const batch = writeBatch(db);
  batch.delete(doc(db, "activities", id));
  await batch.commit();
};

// Envía una notificación a uno o varios usuarios (lotes de 400 escrituras).
export async function sendNotification({ toUids, title, body, kind, fromName }) {
  for (let i = 0; i < toUids.length; i += 400) {
    const batch = writeBatch(db);
    toUids.slice(i, i + 400).forEach((toUid) => batch.set(doc(collection(db, "notifications")), {
      toUid, title: title.trim(), body: body.trim(), kind, read: false,
      fromName: (fromName || "Equipo Tux").slice(0, 40), createdAt: serverTimestamp()
    }));
    await batch.commit();
  }
  return toUids.length;
}

/* ---------- Publicaciones reportadas ---------- */
export const listReports = async () =>
  fromSnap(await getDocs(query(collection(db, "reports"), orderBy("createdAt", "desc"), limit(500))));

const deleteReportsFor = async (proofId) => {
  const snap = await getDocs(query(collection(db, "reports"), where("proofId", "==", proofId)));
  await commitDeletes(snap.docs.map((d) => d.ref));
};

// Descartar: la publicación se queda y se borran sus reportes.
export const adminDismissReports = (proofId) => deleteReportsFor(proofId);

// Borrado en cascada de una publicación reportada: archivos del HDD, prueba, historial y reportes.
export async function adminDeleteReportedProof(proof, adminUser) {
  await adminDeleteProof(proof, adminUser);
  await deleteReportsFor(proof.id);
}

/* ---------- Cuentas: desactivar, reactivar y eliminar ---------- */
export const listDisabledUsers = async () => fromSnap(await getDocs(query(collection(db, "disabledUsers"), limit(500))));

// Las reglas bloquean cualquier escritura de una cuenta con disabledUsers/{uid}; el servidor del HDD
// tampoco le deja subir ni ver archivos.
export const adminDisableUser = (user, adminUser, { reason = "", deleted = false } = {}) =>
  setDoc(doc(db, "disabledUsers", user.id), {
    reason: reason.slice(0, 200), deleted, disabledBy: adminUser.uid,
    nickname: (user.nickname || "").slice(0, 24), createdAt: serverTimestamp()
  });

export const adminEnableUser = (uid) => deleteDoc(doc(db, "disabledUsers", uid));

// Borrados por lotes (Firestore admite 500 escrituras por batch).
async function commitDeletes(refs, extra = []) {
  const ops = [...refs.map((ref) => (b) => b.delete(ref)), ...extra];
  for (let i = 0; i < ops.length; i += 400) {
    const batch = writeBatch(db);
    ops.slice(i, i + 400).forEach((op) => op(batch));
    await batch.commit();
  }
}

const refsWhere = async (name, field, op, value) =>
  (await getDocs(query(collection(db, name), where(field, op, value)))).docs.map((d) => d.ref);

// Borrado físico recursivo de users/{uid}/ en el HDD a través del servidor (solo admins).
async function purgeUserStorage(uid, adminUser) {
  let res;
  try {
    res = await fetch(`${mediaServerUrl()}/api/admin/users/${uid}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${await adminUser.getIdToken()}` }
    });
  } catch {
    throw new Error("El servidor del HDD no responde: no se ha eliminado nada.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `No se pudo borrar la carpeta del usuario (${res.status}).`);
  return data.files || 0;
}

// Eliminación completa de una cuenta. Orden: bloqueo → archivos del HDD → datos de Firestore,
// para que el usuario no pueda crear contenido a mitad del proceso ni queden registros sin archivo.
// La cuenta de Firebase Auth no se puede borrar desde el navegador (requiere Admin SDK): queda
// bloqueada por disabledUsers/{uid}, que se conserva.
export async function adminDeleteAccount(user, adminUser, onStep = () => {}) {
  const uid = user.id;
  if (uid === adminUser.uid) throw new Error("No puedes eliminar tu propia cuenta de admin.");
  onStep("Bloqueando la cuenta…");
  await adminDisableUser(user, adminUser, { reason: "Cuenta eliminada por un admin", deleted: true });

  onStep("Borrando su carpeta del HDD…");
  const files = await purgeUserStorage(uid, adminUser);

  onStep("Limpiando seguidores…");
  const [following, followers] = await Promise.all([
    getDocs(query(collection(db, "follows"), where("followerUid", "==", uid))),
    getDocs(query(collection(db, "follows"), where("targetUid", "==", uid)))
  ]);
  // Se descuentan los contadores de la otra parte (si su perfil sigue existiendo).
  const counterOps = [];
  for (const d of following.docs) {
    const other = d.data().targetUid;
    if ((await getDoc(doc(db, "users", other))).exists()) counterOps.push((b) => b.update(doc(db, "users", other), { followersCount: increment(-1) }));
  }
  for (const d of followers.docs) {
    const other = d.data().followerUid;
    if ((await getDoc(doc(db, "users", other))).exists()) counterOps.push((b) => b.update(doc(db, "users", other), { followingCount: increment(-1) }));
  }
  await commitDeletes([...following.docs, ...followers.docs].map((d) => d.ref), counterOps);

  onStep("Borrando sus chats…");
  const chats = await getDocs(query(collection(db, "chats"), where("members", "array-contains", uid)));
  for (const chat of chats.docs) {
    const messages = await getDocs(collection(chat.ref, "messages"));
    await commitDeletes([...messages.docs.map((m) => m.ref), chat.ref]);
  }

  onStep("Borrando publicaciones y planes…");
  const activities = await getDocs(query(collection(db, "activities"), where("authorId", "==", uid)));
  for (const a of activities.docs) {
    const comments = await getDocs(collection(a.ref, "comments"));
    await commitDeletes([...comments.docs.map((c) => c.ref), a.ref]);
  }
  const history = await getDocs(collection(db, "users", uid, "history"));
  await commitDeletes([
    ...(await refsWhere("proofs", "uid", "==", uid)),
    ...history.docs.map((d) => d.ref),
    ...(await refsWhere("likes", "uid", "==", uid)),
    ...(await refsWhere("saved", "uid", "==", uid)),
    ...(await refsWhere("notifications", "toUid", "==", uid)),
    ...(await refsWhere("reports", "proofUid", "==", uid)),
    ...(await refsWhere("reports", "reporterUid", "==", uid)),
    doc(db, "userAvatars", uid),
    doc(db, "users", uid)
  ]);
  return { files };
}
