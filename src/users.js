// Módulo de perfiles: documento users/{uid} con nickname, avatar, bio, preferencias, contadores de
// seguidores (followersCount / followingCount) y fecha de registro. Los perfiles son públicos.
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  limit,
  setDoc,
  updateDoc,
  onSnapshot,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "./firebaseConfig.js";
import { DEFAULT_PREFS } from "./plans.js";

// Colores disponibles para el avatar del pingüino.
export const AVATAR_COLORS = ["orange", "ice", "mint", "lilac", "night"];

const userRef = (uid) => doc(db, "users", uid);

function defaultNickname(user) {
  const base = user.displayName || (user.email || "Tux").split("@")[0];
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
    photoURL: (user.photoURL || "").slice(0, 500),
    avatarColor: "orange",
    bio: "Explorando planes sencillos con Tux 🐧",
    prefs: { ...DEFAULT_PREFS },
    createdAt: serverTimestamp()
  };
  try {
    await setDoc(ref, profile);
    return profile;
  } catch (err) {
    // Si algún campo opcional es rechazado, crea al menos el perfil mínimo.
    console.warn("Tux: perfil completo rechazado, creando perfil mínimo.", err);
    const minimal = { nickname: profile.nickname || "pinguino", createdAt: serverTimestamp() };
    await setDoc(ref, minimal);
    return minimal;
  }
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

/* ---------- Perfiles públicos ---------- */
// Caché de perfiles ajenos (cabeceras de publicaciones, chats, listas de seguidores).
const profileCache = new Map();

export function getPublicProfile(uid) {
  if (!profileCache.has(uid)) {
    profileCache.set(uid, getDoc(userRef(uid))
      .then((snap) => (snap.exists() ? { uid, ...snap.data() } : null))
      .catch(() => {
        profileCache.delete(uid);
        return null;
      }));
  }
  return profileCache.get(uid);
}

export const rememberProfile = (uid, profile) => profile && profileCache.set(uid, Promise.resolve({ uid, ...profile }));

// Búsqueda por nickname. Con pocos cientos de usuarios basta con filtrar en el cliente
// (Firestore no tiene búsqueda por subcadena).
let directory = null;
export async function searchUsers(text) {
  directory ||= getDocs(query(collection(db, "users"), limit(500)))
    .then((snap) => snap.docs.map((d) => ({ uid: d.id, ...d.data() })))
    .catch((err) => {
      directory = null;
      throw err;
    });
  const needle = text.trim().toLowerCase();
  const users = await directory;
  users.forEach((u) => rememberProfile(u.uid, u));
  return needle
    ? users.filter((u) => (u.nickname || "").toLowerCase().includes(needle)).slice(0, 20)
    : [];
}
