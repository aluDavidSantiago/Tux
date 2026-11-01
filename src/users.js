// Módulo de perfiles: documento users/{uid} con nickname, avatar, bio y fecha de registro.
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  onSnapshot,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "./firebaseConfig.js";

// Colores disponibles para el avatar del pingüino.
export const AVATAR_COLORS = ["orange", "ice", "mint", "lilac", "night"];

const userRef = (uid) => doc(db, "users", uid);

function defaultNickname(user) {
  const base = user.displayName || (user.email || "tux").split("@")[0];
  return base.slice(0, 24);
}

// Crea el perfil la primera vez que el usuario entra (email o Google).
// El listener de sesión y el flujo de registro pueden llamarla a la vez: se comparte
// una única creación por uid y, si llega un nickname explícito, se aplica después.
const pending = new Map();

export async function ensureUserProfile(user, nickname) {
  if (!pending.has(user.uid)) {
    pending.set(user.uid, createIfMissing(user).finally(() => pending.delete(user.uid)));
  }
  const profile = await pending.get(user.uid);
  const wanted = nickname?.trim().slice(0, 24);
  if (wanted && profile.nickname !== wanted) {
    await updateUserProfile(user.uid, { nickname: wanted });
    return { ...profile, nickname: wanted };
  }
  return profile;
}

async function createIfMissing(user) {
  const ref = userRef(user.uid);
  const snap = await getDoc(ref);
  if (snap.exists()) return snap.data();
  const profile = {
    nickname: defaultNickname(user),
    photoURL: user.photoURL || "",
    avatarColor: "orange",
    bio: "Explorando planes sencillos con Tux 🐧",
    createdAt: serverTimestamp()
  };
  await setDoc(ref, profile);
  return profile;
}

export const watchUserProfile = (uid, callback) =>
  onSnapshot(userRef(uid), (snap) => callback(snap.exists() ? snap.data() : null));

export function updateUserProfile(uid, changes) {
  const allowed = {};
  if (typeof changes.nickname === "string") allowed.nickname = changes.nickname.trim().slice(0, 24);
  if (typeof changes.bio === "string") allowed.bio = changes.bio.trim().slice(0, 160);
  if (AVATAR_COLORS.includes(changes.avatarColor)) allowed.avatarColor = changes.avatarColor;
  if (typeof changes.photoURL === "string") allowed.photoURL = changes.photoURL.trim().slice(0, 500);
  return updateDoc(userRef(uid), allowed);
}
