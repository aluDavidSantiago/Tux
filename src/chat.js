// Mensajería privada 1 a 1 en tiempo real.
// chats/{uidA}_{uidB} (uids ordenados): { members: [uidA, uidB], lastMessage { text, senderId, createdAt },
//                                         updatedAt, lastRead { [uid]: timestamp } }
// chats/{chatId}/messages/{id}: { senderId, text, createdAt, replyTo? { proofId, title, thumb } }
// El mensaje y la actualización del chat van en el mismo batch (las reglas lo exigen).
import {
  collection,
  doc,
  query,
  where,
  orderBy,
  limitToLast,
  limit,
  onSnapshot,
  updateDoc,
  writeBatch,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "./firebaseConfig.js";

export const MESSAGE_MAX = 1000;

export const chatIdFor = (uidA, uidB) => [uidA, uidB].sort().join("_");
export const otherMember = (chat, uid) => chat.members?.find((m) => m !== uid) || uid;
const millis = (ts) => ts?.toMillis?.() || 0;

// Hay mensajes nuevos que el usuario no ha visto.
export const isUnread = (chat, uid) =>
  Boolean(chat.lastMessage && chat.lastMessage.senderId !== uid && millis(chat.updatedAt) > millis(chat.lastRead?.[uid]));

// Conversaciones del usuario, la más reciente primero.
export function watchChats(uid, callback) {
  const q = query(collection(db, "chats"), where("members", "array-contains", uid), limit(100));
  return onSnapshot(q, (snap) => {
    // "estimate": las marcas de tiempo pendientes de servidor ya traen hora local (no null).
    const chats = snap.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) }));
    chats.sort((a, b) => millis(b.updatedAt) - millis(a.updatedAt));
    callback(chats);
  }, (err) => console.warn("Tux: no se pudieron cargar los chats.", err));
}

// Últimos mensajes de una conversación (también funciona si el chat aún no existe).
export function watchMessages(chatId, callback, onError) {
  const q = query(collection(db, "chats", chatId, "messages"), orderBy("createdAt", "asc"), limitToLast(200));
  return onSnapshot(q, (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) }))), onError);
}

export async function sendMessage({ from, to, text, replyTo = null }) {
  const body = text.trim().slice(0, MESSAGE_MAX);
  if (!body) return;
  const chatId = chatIdFor(from, to);
  const chatRef = doc(db, "chats", chatId);
  const batch = writeBatch(db);
  const message = { senderId: from, text: body, createdAt: serverTimestamp() };
  if (replyTo) {
    message.replyTo = {
      proofId: String(replyTo.proofId || "").slice(0, 128),
      title: String(replyTo.title || "").slice(0, 80),
      thumb: replyTo.thumb || ""
    };
  }
  batch.set(doc(collection(chatRef, "messages")), message);
  batch.set(chatRef, {
    members: [from, to].sort(),
    lastMessage: { text: body.slice(0, 140), senderId: from, createdAt: serverTimestamp() },
    updatedAt: serverTimestamp(),
    lastRead: { [from]: serverTimestamp() }
  }, { merge: true });
  await batch.commit();
}

export const markChatRead = (chatId, uid) =>
  updateDoc(doc(db, "chats", chatId), { [`lastRead.${uid}`]: serverTimestamp() });
