// Mascota Tux de cada usuario: userAvatars/{uid}
//   { equipped: { hat, outfit, accessory, background }, unlocked: [ids], updatedAt }
// Los desbloqueos se calculan en el cliente a partir de la actividad (son cosméticos).
import { doc, getDoc, setDoc, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "./firebaseConfig.js";

const avatarRef = (uid) => doc(db, "userAvatars", uid);
const cache = new Map();

export const watchMascot = (uid, callback) =>
  onSnapshot(avatarRef(uid), (snap) => {
    const data = snap.exists() ? snap.data() : null;
    cache.set(uid, Promise.resolve(data));
    callback(data);
  }, (err) => console.warn("Tux: no se pudo leer la mascota.", err));

export function getMascot(uid) {
  if (!cache.has(uid)) {
    cache.set(uid, getDoc(avatarRef(uid)).then((s) => (s.exists() ? s.data() : null)).catch(() => {
      cache.delete(uid);
      return null;
    }));
  }
  return cache.get(uid);
}

export function saveMascot(uid, { equipped, unlocked }) {
  const clean = {
    hat: equipped.hat || "", outfit: equipped.outfit || "",
    accessory: equipped.accessory || "", background: equipped.background || ""
  };
  return setDoc(avatarRef(uid), { equipped: clean, unlocked: [...new Set(unlocked)].slice(0, 40), updatedAt: serverTimestamp() });
}
