// Operaciones de administración. Los permisos reales los imponen las reglas de Firestore
// (colección admins/{uid}) y el servidor del HDD; aquí solo se orquestan.
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  orderBy,
  limit,
  writeBatch,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "./firebaseConfig.js";
import { deleteMediaRef, deleteProofDoc } from "./media.js";
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
