// Tux · orquestador de la interfaz: Panel (actividad estrella), Mis planes, Galería VR,
// Ajustes, feed de exploración, autenticación y modales.
import {
  CATEGORIES, BUDGETS, EFFORTS, WHEN, DURATIONS, SAMPLE_ACTIVITIES,
  watchActivities, getActivity, getActivitiesByAuthor, createActivity, deleteActivity,
  seedActivities, deleteSeedActivities, matchesFilters, normalize, millis, isValidImageUrl
} from "../../src/activities.js";
import {
  signInWithGoogle, completeRedirectSignIn, signInWithEmail, signUpWithEmail, resetPassword, logOut,
  watchSession, authErrorMessage
} from "../../src/auth.js";
import { AVATAR_COLORS, ensureUserProfile, watchUserProfile, updateUserProfile } from "../../src/users.js";
import {
  watchLikes, watchSaved, setLike, setSaved, watchComments, addComment, deleteComment
} from "../../src/social.js";
import {
  FREQUENCIES, DISCARD_REASONS, normalizePrefs, savePrefs, saveStar, watchHistory, setHistory, restoreFromTrash,
  removeProofFromHistory
} from "../../src/plans.js";
import { currentPeriod, msUntilNextPeriod, pickStar, scoreActivity } from "../../src/recommendations.js";
import {
  ACCEPT_ATTR, LIMITS_LABEL, validateFile, probeMedia, isEquirectangular, detectSphericalMetadata, uploadMedia,
  checkMediaServer, resolveMediaUrl, mediaThumbUrl, createProof, deleteMediaRef, deleteProofDoc, watchVrProofs, SAMPLE_VR
} from "../../src/media.js";
import { NOTIFICATION_KINDS, watchNotifications, markAllRead, deleteNotification } from "../../src/notifications.js";
import { isAdminUser } from "../../src/admin.js";
import {
  $, $$, h, svgUse, tuxLogo, formatCount, timeAgo, formatCountdown, toast, setLoading, setThumb,
  openModal, closeModal, initModals, confirmDialog
} from "./ui.js";
import { initViewer, openViewer } from "./viewer.js";

export const APP_VERSION = "1.1.0-beta";

/* ==========================================================
   Estado
   ========================================================== */
const state = {
  user: null,
  profile: null,
  profileLoaded: false,
  history: new Map(),      // activityId → { status, reason, proofUrl… }
  historyLoaded: false,
  guestStar: null,
  remote: [],
  feedReady: false,
  liked: new Set(),
  saved: [],
  myPlans: [],
  vr: [],
  isAdmin: false,
  notifications: [],
  filters: { budget: new Set(), effort: new Set(), category: new Set(), when: new Set(), search: "" },
  view: "dashboard",
  plansTab: "accepted",
  feedKey: null
};

const cache = new Map();
let sessionUnsubs = [];
const renderSig = {};

const usingSamples = () => state.feedReady && state.remote.length === 0;
const feedSource = () => (usingSamples() ? SAMPLE_ACTIVITIES : state.remote);
const findActivity = (id) =>
  state.remote.find((a) => a.id === id) || SAMPLE_ACTIVITIES.find((a) => a.id === id) || cache.get(id);
const historyOf = (status) =>
  [...state.history.values()].filter((e) => e.status === status)
    .sort((a, b) => millis(b.updatedAt) - millis(a.updatedAt));
const currentPrefs = () => normalizePrefs(state.user ? state.profile?.prefs : null);

async function resolveActivity(id) {
  const known = findActivity(id);
  if (known) return known;
  try {
    const a = await getActivity(id);
    if (a) cache.set(id, a);
    return a;
  } catch {
    return null;
  }
}

// Punto único tras cualquier cambio de datos.
function onDataChange() {
  ensureStar();
  refreshCardStates();
  renderHeader();
  renderActiveView();
}

/* ==========================================================
   Tema (por defecto oscuro OLED)
   ========================================================== */
const themeMeta = $('meta[name="theme-color"]');
const darkQuery = matchMedia("(prefers-color-scheme: dark)");

function themePreference() {
  try {
    return localStorage.getItem("tux-theme") || "dark";
  } catch {
    return "dark";
  }
}

function applyTheme(pref) {
  if (pref === "light" || pref === "dark") document.documentElement.dataset.theme = pref;
  else delete document.documentElement.dataset.theme;
  try { localStorage.setItem("tux-theme", pref); } catch {}
  syncThemeUI();
}

function syncThemeUI() {
  const pref = themePreference();
  const dark = pref === "dark" || (pref === "system" && darkQuery.matches);
  themeMeta.setAttribute("content", dark ? "#0D0D0E" : "#FFFFFF");
  const group = $("#theme-switch");
  if (!group) return;
  $$("[data-theme-option]", group).forEach((btn, i) => {
    const active = btn.dataset.themeOption === pref;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-checked", String(active));
    if (active) setThumb(group, i);
  });
}
darkQuery.addEventListener("change", syncThemeUI);

/* ==========================================================
   Autenticación
   ========================================================== */
initModals();
const authModal = $("#auth-modal");
const authForm = $("#auth-form");
const authError = $("#auth-error");
let authMode = "login";

const AUTH_DEFAULT_SUBTITLE = "Planes sencillos, cerca de ti.";
const AUTH_PROMPT = "Crea una cuenta o inicia sesión para interactuar en Tux";
let afterAuth = null;

function setAuthMode(mode) {
  authMode = mode;
  const signup = mode === "signup";
  $$("#auth-tabs [data-tab]").forEach((tab, i) => {
    const active = tab.dataset.tab === mode;
    tab.classList.toggle("is-active", active);
    tab.setAttribute("aria-selected", String(active));
    if (active) setThumb($("#auth-tabs"), i);
  });
  $("#nickname-field").hidden = !signup;
  $("#reset-btn").hidden = signup;
  $("#auth-submit").textContent = signup ? "Crear cuenta" : "Iniciar sesión";
  authForm.password.autocomplete = signup ? "new-password" : "current-password";
  authError.textContent = "";
  authError.classList.remove("is-ok");
}

function openAuth(mode = "login", message = AUTH_DEFAULT_SUBTITLE) {
  setAuthMode(mode);
  const subtitle = $("#auth-subtitle");
  subtitle.textContent = message;
  subtitle.classList.toggle("is-prompt", message !== AUTH_DEFAULT_SUBTITLE);
  openModal(authModal);
}

// Navegar es libre; interactuar exige sesión. Devuelve true si ya hay usuario.
function requireAuth(then = null) {
  if (state.user) return true;
  afterAuth = then;
  openAuth("login", AUTH_PROMPT);
  return false;
}

$("#auth-tabs").addEventListener("click", (e) => {
  const tab = e.target.closest("[data-tab]");
  if (tab) setAuthMode(tab.dataset.tab);
});

function afterSignIn(user) {
  if (!user) return; // Google pasó a redirección: la página se recargará.
  closeModal(authModal);
  authForm.reset();
  const name = state.profile?.nickname || user.displayName || "pingüino";
  toast(`Hola, ${name} 🐧`);
  const next = afterAuth;
  afterAuth = null;
  if (next) setTimeout(next, 300);
}

authModal.addEventListener("close", () => {
  if (!state.user) afterAuth = null;
});

authForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = authForm.email.value;
  const password = authForm.password.value;
  const nickname = authForm.nickname.value.trim();
  authError.classList.remove("is-ok");
  if (!email || !password) return (authError.textContent = "Completa email y contraseña.");
  if (authMode === "signup" && nickname.length < 2) {
    return (authError.textContent = "Elige un nickname de al menos 2 caracteres.");
  }
  const submit = $("#auth-submit");
  setLoading(submit, true);
  try {
    const user = authMode === "signup"
      ? await signUpWithEmail(email, password, nickname)
      : await signInWithEmail(email, password);
    afterSignIn(user);
  } catch (err) {
    console.error("Tux: error de autenticación.", err);
    authError.textContent = authErrorMessage(err);
  } finally {
    setLoading(submit, false);
  }
});

$("#google-btn").addEventListener("click", async (e) => {
  const btn = e.currentTarget;
  setLoading(btn, true);
  try {
    afterSignIn(await signInWithGoogle());
  } catch (err) {
    console.error("Tux: error con Google.", err);
    authError.classList.remove("is-ok");
    authError.textContent = authErrorMessage(err);
  } finally {
    setLoading(btn, false);
  }
});

$("#reset-btn").addEventListener("click", async () => {
  const email = authForm.email.value;
  if (!email) {
    authError.classList.remove("is-ok");
    authError.textContent = "Escribe tu email y vuelve a pulsar.";
    return authForm.email.focus();
  }
  try {
    await resetPassword(email);
    authError.classList.add("is-ok");
    authError.textContent = "Te enviamos un enlace para restablecerla.";
  } catch (err) {
    authError.classList.remove("is-ok");
    authError.textContent = authErrorMessage(err);
  }
});

watchSession((user) => {
  sessionUnsubs.forEach((unsub) => unsub());
  sessionUnsubs = [];
  Object.assign(state, {
    user, profile: null, profileLoaded: false, history: new Map(), historyLoaded: false, guestStar: null,
    liked: new Set(), saved: [], myPlans: [], isAdmin: false, notifications: []
  });

  if (user) {
    ensureUserProfile(user).catch((err) => console.warn("Tux: perfil no creado.", err));
    sessionUnsubs.push(
      watchUserProfile(user.uid, (profile) => {
        state.profile = profile;
        state.profileLoaded = true;
        onDataChange();
      }),
      watchHistory(user.uid, (map) => {
        state.history = map;
        state.historyLoaded = true;
        onDataChange();
      }),
      watchLikes(user.uid, (ids) => {
        state.liked = new Set(ids);
        refreshCardStates();
      }),
      watchSaved(user.uid, (ids) => {
        state.saved = ids;
        onDataChange();
      }),
      watchNotifications(user.uid, (items) => {
        state.notifications = items;
        renderBell();
        if (notificationsModal.open) renderNotifications();
      })
    );
    isAdminUser(user.uid).then((value) => {
      if (state.user?.uid !== user.uid) return;
      state.isAdmin = value;
      onDataChange();
    });
    loadMyPlans();
  } else if (state.view === "plans") {
    setView("dashboard");
  }
  renderFeed(true);
  renderBell();
  onDataChange();
});

/* ==========================================================
   Piezas visuales de actividades
   ========================================================== */
function placeholder(a) {
  return h("div", { class: "placeholder", dataset: { cat: a.category || "chill" } },
    h("span", { class: "ph-emoji", text: a.emoji || CATEGORIES[a.category]?.emoji || "🐧" }),
    tuxLogo("ph-tux")
  );
}

// Imagen con fundido; si es equirectangular (2:1) avisa para ofrecer el visor 360°.
function mediaImage(url, { cls = "", onPanorama } = {}) {
  if (!url || !isValidImageUrl(url)) return null;
  const img = h("img", { class: cls, src: url, alt: "", loading: "lazy", decoding: "async", referrerpolicy: "no-referrer" });
  img.addEventListener("load", () => {
    img.classList.add("is-loaded");
    if (onPanorama && isEquirectangular(img.naturalWidth, img.naturalHeight)) onPanorama(img);
  });
  img.addEventListener("error", () => img.remove());
  return img;
}

function panoramaButton(url, title) {
  return h("button", {
    class: "btn-360", type: "button", "aria-label": "Ver en 360°",
    onclick: (e) => {
      e.stopPropagation();
      openViewer({ url, type: "image", is360: true, title, sub: "Imagen 360° del plan" });
    }
  }, svgUse("i-orbit"), "Ver en 360°");
}

function budgetMeta(budget) {
  const info = BUDGETS[budget] || BUDGETS.free;
  if (budget === "free" || !BUDGETS[budget]) return h("span", { class: "meta", title: "Gratis" }, "Gratis");
  const level = { low: 1, mid: 2, high: 3 }[budget];
  return h("span", { class: "meta budget-scale", title: info.range },
    h("span", { text: "$".repeat(level) }),
    h("span", { class: "off", text: "$".repeat(3 - level) })
  );
}

function effortMeta(effort) {
  const info = EFFORTS[effort] || EFFORTS.low;
  const bars = h("span", { class: "effort-bars", "aria-hidden": "true" },
    [1, 2, 3].map((n) => h("i", { class: n <= info.level ? "on" : "" }))
  );
  return h("span", { class: "meta", title: `Esfuerzo ${info.short.toLowerCase()}` }, bars, info.short);
}

function metaRow(a, cls) {
  const when = WHEN[a.when];
  return h("div", { class: cls },
    budgetMeta(a.budget),
    effortMeta(a.effort),
    when && h("span", { class: "meta" }, `${when.emoji} ${when.label}`),
    a.duration && h("span", { class: "meta" }, svgUse("i-clock"), a.duration)
  );
}

function categoryBadge(a) {
  const cat = CATEGORIES[a.category] || CATEGORIES.chill;
  return h("span", { class: "badge-cat" }, `${cat.emoji} ${cat.label}`);
}

function railButton(action, iconId, label) {
  return h("button", { class: "rail-btn", type: "button", dataset: { action }, "aria-label": label },
    h("span", { class: "rail-icon" }, svgUse(iconId)),
    h("span", { class: "rail-count", text: label })
  );
}

function buildCard(a) {
  const own = state.user && a.authorId === state.user.uid && !a.sample;
  const card = h("article", { class: "card", dataset: { id: a.id }, "aria-label": a.title });
  const media = h("div", { class: "card-media" }, placeholder(a));
  const img = mediaImage(a.imageUrl, { onPanorama: () => card.append(panoramaButton(a.imageUrl, a.title)) });
  if (img) media.append(img);

  card.append(
    media,
    h("div", { class: "card-scrim" }),
    h("div", { class: "card-info" },
      h("div", { class: "card-badges" },
        categoryBadge(a),
        a.sample && h("span", { class: "badge-sample", text: "Ejemplo" })
      ),
      h("h2", { class: "card-title", text: a.title }),
      a.description && h("p", { class: "card-desc", text: a.description }),
      metaRow(a, "card-meta"),
      h("p", { class: "card-author" }, "por ", h("b", { text: `@${a.authorName || "Tux"}` }),
        a.createdAt ? ` · ${timeAgo(a.createdAt)}` : "")
    ),
    h("div", { class: "card-rail" },
      railButton("like", "i-heart", "Me apunto"),
      railButton("comment", "i-comment", "0"),
      railButton("save", "i-bookmark", "Guardar"),
      railButton("done", "i-check", "Lo hice"),
      railButton("share", "i-share", "Enviar"),
      own && railButton("delete", "i-trash", "Borrar")
    )
  );
  return card;
}

function refreshCardStates() {
  const saved = new Set(state.saved);
  $$(".card[data-id]").forEach((card) => {
    const id = card.dataset.id;
    const a = findActivity(id);
    const like = $('[data-action="like"]', card);
    const liked = state.liked.has(id);
    like.classList.toggle("is-on", liked);
    like.setAttribute("aria-pressed", String(liked));
    $(".rail-count", like).textContent = a?.likeCount ? formatCount(a.likeCount) : "Me apunto";
    $('[data-action="comment"] .rail-count', card).textContent = formatCount(a?.commentCount || 0);
    const save = $('[data-action="save"]', card);
    save.classList.toggle("is-on", saved.has(id));
    $(".rail-count", save).textContent = saved.has(id) ? "Guardado" : "Guardar";
    $('[data-action="done"]', card).classList.toggle("is-on", state.history.get(id)?.status === "completed");
  });
}

/* ==========================================================
   Feed de exploración
   ========================================================== */
const feed = $("#feed");

function emptyFeedState() {
  return h("div", { class: "empty" },
    tuxLogo("empty-mark"),
    h("h3", { text: "No hay planes con estos filtros" }),
    h("p", { text: "Tux sugiere crear uno. Seguro que a alguien más le apetece lo mismo." }),
    h("div", { class: "empty-actions" },
      h("button", { class: "primary-btn", type: "button", onclick: openCreate }, "Crear un plan"),
      h("button", { class: "primary-btn secondary", type: "button", onclick: clearFilters }, "Limpiar filtros")
    )
  );
}

function renderFeed(force = false) {
  if (!state.feedReady) return;
  const list = feedSource().filter((a) => matchesFilters(a, state.filters));
  const key = list.map((a) => a.id).join("|");
  updateFilterSummary(list.length);
  if (key === state.feedKey && !force) return refreshCardStates();

  const index = feed.clientHeight ? Math.round(feed.scrollTop / feed.clientHeight) : 0;
  const currentId = feed.children[index]?.dataset?.id;
  feed.replaceChildren(...(list.length ? list.map(buildCard) : [emptyFeedState()]));
  state.feedKey = key;
  refreshCardStates();
  const keepIndex = list.findIndex((a) => a.id === currentId);
  feed.scrollTop = keepIndex > 0 ? keepIndex * feed.clientHeight : 0;
}

function feedLoaded(list) {
  state.remote = list;
  state.feedReady = true;
  renderFeed();
  onDataChange();
}

watchActivities(feedLoaded, (err) => {
  console.warn("Tux: no se pudo leer Firestore, usando planes de ejemplo.", err);
  feedLoaded([]);
});

// Si Firestore tarda (red lenta), arranca con los ejemplos.
setTimeout(() => {
  if (!state.feedReady) feedLoaded([]);
}, 3500);

function openFeed() {
  setView("feed");
}
$("#feed-back").addEventListener("click", () => setView("dashboard"));

/* ---------- Acciones de tarjeta ---------- */
async function toggleLike(id, card) {
  const a = findActivity(id);
  if (a?.sample) return toast("Es un plan de ejemplo · publica el tuyo 🐧");
  if (!requireAuth()) return;
  const liked = !state.liked.has(id);
  if (a) a.likeCount = Math.max(0, (a.likeCount || 0) + (liked ? 1 : -1));
  liked ? state.liked.add(id) : state.liked.delete(id);
  refreshCardStates();
  pop(card, "like");
  try {
    await setLike(state.user.uid, id, liked);
  } catch (err) {
    console.error(err);
    if (a) a.likeCount = Math.max(0, (a.likeCount || 0) + (liked ? -1 : 1));
    liked ? state.liked.delete(id) : state.liked.add(id);
    refreshCardStates();
    toast("No se pudo guardar tu apunte.");
  }
}

async function toggleSaved(id, card) {
  if (!requireAuth()) return;
  const on = !state.saved.includes(id);
  state.saved = on ? [id, ...state.saved] : state.saved.filter((x) => x !== id);
  refreshCardStates();
  if (card) pop(card, "save");
  try {
    await setSaved(state.user.uid, id, on);
    toast(on ? "Guardado en Mis planes" : "Quitado de guardados");
  } catch (err) {
    console.error(err);
    state.saved = on ? state.saved.filter((x) => x !== id) : [id, ...state.saved];
    refreshCardStates();
    toast("No se pudo actualizar.");
  }
}

async function sharePlan(a) {
  const url = `${location.origin}${location.pathname}#plan=${a.id}`;
  try {
    if (navigator.share) await navigator.share({ title: `${a.title} · Tux`, text: a.description, url });
    else {
      await navigator.clipboard.writeText(url);
      toast("Enlace copiado");
    }
  } catch (err) {
    if (err?.name !== "AbortError") toast("No se pudo compartir.");
  }
}

async function removePlan(a) {
  const ok = await confirmDialog({
    title: "Eliminar publicación",
    message: `"${a.title}" desaparecerá del feed para todos. Esta acción no se puede deshacer.`,
    confirmLabel: "Eliminar"
  });
  if (!ok) return;
  try {
    await deleteActivity(a.id);
    closeModal($("#plan-modal"));
    toast("Publicación eliminada");
    loadMyPlans();
  } catch (err) {
    console.error(err);
    toast("No se pudo borrar.");
  }
}

function pop(card, action) {
  const btn = $(`[data-action="${action}"]`, card);
  if (!btn) return;
  btn.classList.remove("is-popping");
  void btn.offsetWidth;
  btn.classList.add("is-popping");
}

document.addEventListener("click", (e) => {
  const btn = e.target.closest(".rail-btn");
  if (!btn) return;
  const card = btn.closest(".card");
  const id = card.dataset.id;
  const a = findActivity(id);
  switch (btn.dataset.action) {
    case "like": return toggleLike(id, card);
    case "comment": return a?.sample ? toast("Los planes de ejemplo no tienen comentarios") : openComments(id);
    case "save": return toggleSaved(id, card);
    case "done":
      if (state.history.get(id)?.status === "completed") return toast("Ya completaste este plan ✓");
      return a && openComplete(a);
    case "share": return a && sharePlan(a);
    case "delete": return a && removePlan(a);
  }
});

// Doble toque sobre la tarjeta = "Me apunto".
let lastTap = { time: 0, x: 0, y: 0, id: null };
document.addEventListener("pointerup", (e) => {
  if (e.pointerType === "mouse" && e.button !== 0) return;
  const card = e.target.closest(".card");
  if (!card || e.target.closest("button, a")) return;
  const now = Date.now();
  const near = Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 40;
  if (now - lastTap.time < 320 && near && lastTap.id === card.dataset.id) {
    lastTap = { time: 0, x: 0, y: 0, id: null };
    const rect = card.getBoundingClientRect();
    const burst = h("div", { class: "burst" }, svgUse("i-heart"));
    burst.style.left = `${e.clientX - rect.left}px`;
    burst.style.top = `${e.clientY - rect.top}px`;
    card.append(burst);
    burst.addEventListener("animationend", () => burst.remove());
    if (!state.liked.has(card.dataset.id)) toggleLike(card.dataset.id, card);
  } else {
    lastTap = { time: now, x: e.clientX, y: e.clientY, id: card.dataset.id };
  }
});

/* ==========================================================
   Filtros y búsqueda
   ========================================================== */
const filtersModal = $("#filters-modal");
const searchInput = $("#search-input");

const FILTER_OPTIONS = {
  budget: Object.entries(BUDGETS).map(([value, b]) => ({ value, label: b.label, hint: b.short === b.label ? "" : b.short })),
  effort: Object.entries(EFFORTS).map(([value, e]) => ({ value, label: e.label })),
  category: Object.entries(CATEGORIES).map(([value, c]) => ({ value, label: `${c.emoji} ${c.label}` })),
  when: Object.entries(WHEN).map(([value, w]) => ({ value, label: `${w.emoji} ${w.label}` }))
};

function chip({ value, label, hint }, active = false) {
  return h("button", { class: `chip${active ? " is-active" : ""}`, type: "button", dataset: { value }, "aria-pressed": String(active) },
    label, hint && h("small", { text: hint }));
}

for (const [group, options] of Object.entries(FILTER_OPTIONS)) {
  const container = $(`[data-filter="${group}"]`, filtersModal);
  container.append(...options.map((o) => chip(o)));
  container.addEventListener("click", (e) => {
    const btn = e.target.closest(".chip");
    if (!btn) return;
    const set = state.filters[group];
    set.has(btn.dataset.value) ? set.delete(btn.dataset.value) : set.add(btn.dataset.value);
    onFiltersChange();
  });
}

let searchTimer;
searchInput.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.filters.search = normalize(searchInput.value);
    onFiltersChange();
  }, 150);
});

function onFiltersChange() {
  for (const group of Object.keys(FILTER_OPTIONS)) {
    $$(`[data-filter="${group}"] .chip`, filtersModal).forEach((btn) => {
      const on = state.filters[group].has(btn.dataset.value);
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-pressed", String(on));
    });
  }
  renderActiveFilters();
  renderFeed();
}

function clearFilters() {
  for (const group of Object.keys(FILTER_OPTIONS)) state.filters[group].clear();
  state.filters.search = "";
  searchInput.value = "";
  onFiltersChange();
}

function renderActiveFilters() {
  const chips = [];
  for (const [group, options] of Object.entries(FILTER_OPTIONS)) {
    for (const opt of options) {
      if (!state.filters[group].has(opt.value)) continue;
      chips.push(h("button", {
        class: "active-chip", type: "button", "aria-label": `Quitar ${opt.label}`,
        onclick: () => { state.filters[group].delete(opt.value); onFiltersChange(); }
      }, opt.label, svgUse("i-x")));
    }
  }
  if (state.filters.search) {
    chips.unshift(h("button", {
      class: "active-chip", type: "button", "aria-label": "Quitar búsqueda",
      onclick: () => { searchInput.value = ""; state.filters.search = ""; onFiltersChange(); }
    }, `“${searchInput.value.trim()}”`, svgUse("i-x")));
  }
  $("#active-filters").replaceChildren(...chips);
  const f = state.filters;
  const count = f.budget.size + f.effort.size + f.category.size + f.when.size + (f.search ? 1 : 0);
  const badge = $("#filters-badge");
  badge.hidden = count === 0;
  badge.textContent = count;
}

function updateFilterSummary(count) {
  $("#filters-apply").textContent =
    count === 0 ? "Sin resultados" : `Ver ${count} ${count === 1 ? "plan" : "planes"}`;
}

$("#filters-btn").addEventListener("click", () => openModal(filtersModal));
$("#search-btn").addEventListener("click", () => {
  openModal(filtersModal);
  setTimeout(() => searchInput.focus(), 300);
});
$("#filters-clear").addEventListener("click", clearFilters);

/* ==========================================================
   Navegación
   ========================================================== */
const VIEWS = ["dashboard", "plans", "vr", "settings", "feed"];

function setView(view) {
  if (!VIEWS.includes(view)) return;
  const changed = state.view !== view;
  state.view = view;
  $("#app").dataset.view = view;
  $$(".view").forEach((v) => v.classList.toggle("is-active", v.id === `view-${view}`));
  $$(".tab-item").forEach((t) => t.classList.toggle("is-active", t.dataset.nav === view));
  if (view === "feed") {
    renderFeed();
    return;
  }
  delete renderSig[view];
  renderActiveView();
  const page = $(`#view-${view} .page`);
  if (changed && page) {
    page.parentElement.scrollTop = 0;
    page.classList.add("is-entering");
    setTimeout(() => page.classList.remove("is-entering"), 700);
  }
}

$(".tabbar").addEventListener("click", (e) => {
  const item = e.target.closest("[data-nav]");
  if (!item) return;
  const target = item.dataset.nav;
  if (target === "plans" && !requireAuth(() => setView("plans"))) return;
  if (target === state.view) {
    $(`#view-${target}`)?.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }
  setView(target);
});

// Renderiza la vista activa solo si cambió algo relevante (evita parpadeos en tiempo real).
function renderActiveView() {
  const renderers = { dashboard: renderDashboard, plans: renderPlans, vr: renderVr, settings: renderSettings };
  renderers[state.view]?.();
}

function memo(view, sig) {
  if (renderSig[view] === sig) return false;
  renderSig[view] = sig;
  return true;
}

/* ==========================================================
   Cabecera y perfil
   ========================================================== */
function avatarElement(profile, { interactive = false } = {}) {
  const color = AVATAR_COLORS.includes(profile?.avatarColor) ? profile.avatarColor : "orange";
  const content = profile?.photoURL
    ? h("img", { src: profile.photoURL, alt: "", referrerpolicy: "no-referrer" })
    : tuxLogo("avatar-tux");
  return h(interactive ? "button" : "div", {
    class: "avatar", type: interactive ? "button" : null, dataset: { color },
    "aria-label": interactive ? "Toca para cambiar el color de tu avatar" : null,
    onclick: interactive ? onAvatarTap : null
  }, content);
}

function renderHeader() {
  const btn = $("#header-avatar");
  const sig = state.user ? `${state.profile?.photoURL}|${state.profile?.avatarColor}` : "guest";
  if (btn.dataset.sig === sig) return;
  btn.dataset.sig = sig;
  if (!state.user) {
    btn.className = "header-avatar";
    btn.replaceChildren(svgUse("i-user"));
    btn.setAttribute("aria-label", "Iniciar sesión");
    return;
  }
  const av = avatarElement(state.profile);
  btn.className = "header-avatar avatar";
  btn.dataset.color = av.dataset.color;
  btn.replaceChildren(...av.childNodes);
  btn.setAttribute("aria-label", "Tu perfil");
}

$("#header-avatar").addEventListener("click", () => {
  if (!requireAuth(openProfile)) return;
  openProfile();
});

let avatarTimer;
function onAvatarTap(e) {
  const avatar = e.currentTarget;
  avatar.classList.remove("is-waving");
  void avatar.offsetWidth;
  avatar.classList.add("is-waving");
  if (!state.profile || state.profile.photoURL) return;
  const next = AVATAR_COLORS[(AVATAR_COLORS.indexOf(avatar.dataset.color) + 1) % AVATAR_COLORS.length];
  avatar.dataset.color = next;
  clearTimeout(avatarTimer);
  avatarTimer = setTimeout(() => {
    updateUserProfile(state.user.uid, { avatarColor: avatar.dataset.color }).catch(() => toast("No se pudo guardar el color."));
  }, 600);
}

async function loadMyPlans() {
  if (!state.user) return;
  try {
    state.myPlans = await getActivitiesByAuthor(state.user.uid);
    state.myPlans.forEach((a) => cache.set(a.id, a));
  } catch (err) {
    console.warn("Tux: no se pudieron cargar tus planes.", err);
  }
  if ($("#profile-modal").open) renderProfile();
  if (state.view === "plans") renderPlans();
}

const profileModal = $("#profile-modal");

function openProfile() {
  renderProfile();
  openModal(profileModal);
  loadMyPlans();
}

const stat = (value, label) => h("div", { class: "stat" }, h("b", { text: value }), h("span", { text: label }));

function renderProfile() {
  const root = $("#profile-content");
  if (!state.user) return root.replaceChildren();
  const p = state.profile || {};
  const since = millis(p.createdAt)
    ? new Date(millis(p.createdAt)).toLocaleDateString("es", { month: "long", year: "numeric" })
    : null;
  const grid = h("div", { class: "tile-grid" });
  root.replaceChildren(
    h("div", { class: "profile-head" },
      avatarElement(p, { interactive: true }),
      h("h1", { class: "profile-name", text: p.nickname || state.user.displayName || "Pingüino" }),
      p.bio && h("p", { class: "profile-bio", text: p.bio }),
      since && h("p", { class: "profile-since", text: `En Tux desde ${since}` }),
      h("button", { class: "profile-edit", type: "button", onclick: openEditProfile }, "Editar perfil")
    ),
    h("div", { class: "stats" },
      stat(historyOf("completed").length, "Completados"),
      stat(state.myPlans.length, "Publicados"),
      stat(state.saved.length, "Guardados")
    ),
    h("h2", { class: "section-title", text: "Tus publicaciones" }),
    grid
  );
  if (!state.myPlans.length) {
    grid.append(h("p", { class: "tile-empty", text: "Aún no has publicado planes. Comparte el primero desde el Panel." }));
  } else {
    grid.append(...state.myPlans.map((a) =>
      h("button", { class: "tile", type: "button", "aria-label": a.title, onclick: () => openPlan(a.id) },
        placeholder(a), mediaImage(a.imageUrl) || "", h("span", { class: "tile-title", text: a.title }))));
  }
}

/* ==========================================================
   Motor de la actividad estrella
   ========================================================== */
const sameStar = (a, b) =>
  (!a && !b) || Boolean(a && b && a.activityId === b.activityId && a.period === b.period && a.frequencyDays === b.frequencyDays);

function ensureStar() {
  if (!state.feedReady) return;
  if (state.user && (!state.profileLoaded || !state.historyLoaded)) return;
  const prefs = currentPrefs();
  const freq = prefs.frequencyDays;
  const period = currentPeriod(freq);
  const star = (state.user && state.profile?.star) || state.guestStar;
  const status = star && state.history.get(star.activityId)?.status;
  const valid = star && star.period === period && star.frequencyDays === freq
    && status !== "discarded" && findActivity(star.activityId);
  if (valid) return;

  const pick = pickStar(feedSource(), { prefs, history: state.history, seed: `${state.user?.uid || "guest"}:${period}` });
  const next = pick ? { activityId: pick.activity.id, period, frequencyDays: freq } : null;
  if (sameStar(star, next)) return;
  if (state.user && state.profile) {
    state.profile = { ...state.profile, star: next };
    saveStar(state.user.uid, next).catch((err) => console.warn("Tux: no se pudo guardar la estrella.", err));
  } else {
    state.guestStar = next;
  }
}

function currentStar() {
  const star = (state.user && state.profile?.star) || state.guestStar;
  const activity = star && findActivity(star.activityId);
  if (!activity) return null;
  const entry = state.history.get(activity.id);
  return { activity, status: entry?.status || "pending", entry };
}

/* ==========================================================
   Vista: Panel
   ========================================================== */
function greeting() {
  const hour = new Date().getHours();
  if (hour < 6) return "Buenas noches";
  if (hour < 13) return "Buenos días";
  if (hour < 20) return "Buenas tardes";
  return "Buenas noches";
}

function starLabel(freq) {
  if (freq === 1) return "Actividad del día";
  if (freq === 7) return "Actividad de la semana";
  return `Actividad estrella · ${freq} días`;
}

function renderDashboard() {
  const prefs = currentPrefs();
  const star = currentStar();
  const sig = JSON.stringify([
    state.feedReady, state.user?.uid, state.profile?.nickname, prefs, star?.activity.id, star?.status,
    star?.entry?.proofUrl, star?.activity.title, historyOf("accepted").length, historyOf("completed").length,
    historyOf("discarded").length, feedSource().length
  ]);
  if (!memo("dashboard", sig)) return;

  const name = state.user ? (state.profile?.nickname || state.user.displayName || "") : "";
  const date = new Date().toLocaleDateString("es", { weekday: "long", day: "numeric", month: "long" });

  $("#dashboard").replaceChildren(
    h("header", { class: "page-head" },
      h("p", { class: "eyebrow", text: date }),
      h("h1", { class: "page-title", text: name ? `${greeting()}, ${name}` : greeting() })
    ),
    state.feedReady
      ? starCard(star, prefs)
      : h("div", { class: "star star-empty" }, tuxLogo("empty-mark loading-mark")),
    h("div", { class: "quick" },
      h("button", { class: "quick-tile", type: "button", onclick: openFeed },
        h("span", { class: "quick-icon" }, svgUse("i-compass")),
        h("span", {}, h("b", { text: "Explorar planes" }), h("small", { text: `${feedSource().length} ideas en el feed` }))
      ),
      h("button", { class: "quick-tile", type: "button", onclick: openCreate },
        h("span", { class: "quick-icon" }, svgUse("i-plus")),
        h("span", {}, h("b", { text: "Publicar TuxPlan" }), h("small", { text: "Comparte tu idea" }))
      )
    ),
    h("div", { class: "mini-stats" },
      stat(historyOf("accepted").length, "En curso"),
      stat(historyOf("completed").length, "Completados"),
      stat(historyOf("discarded").length, "En papelera")
    )
  );
}

function starCard(star, prefs) {
  if (!star) {
    return h("section", { class: "star star-empty" },
      tuxLogo("empty-mark"),
      h("h3", { text: "Has explorado todos los planes" }),
      h("p", { text: "Publica uno nuevo o restaura alguno de la papelera para que Tux vuelva a sugerirlo." }),
      h("button", { class: "primary-btn", type: "button", onclick: openCreate }, "Publicar TuxPlan")
    );
  }
  const { activity: a, status, entry } = star;
  const media = h("div", { class: "star-media" },
    placeholder(a),
    h("span", { class: "star-pill" }, svgUse("i-star"), starLabel(prefs.frequencyDays)),
    h("div", { class: "star-overlay" },
      h("div", { class: "card-badges" }, categoryBadge(a), a.sample && h("span", { class: "badge-sample", text: "Ejemplo" })),
      h("h2", { class: "star-title", text: a.title })
    )
  );
  const img = mediaImage(a.imageUrl, { cls: "cover", onPanorama: () => media.append(panoramaButton(a.imageUrl, a.title)) });
  if (img) media.prepend(img);

  const body = h("div", { class: "star-body" });
  if (a.description) body.append(h("p", { class: "star-desc", text: a.description }));
  body.append(metaRow(a, "star-meta"));

  if (status === "pending") {
    const { reasons } = scoreActivity(a, prefs);
    body.append(
      h("div", { class: "star-reasons" },
        (reasons.length ? reasons : ["Elegida por Tux para ti"]).map((r) => h("span", { class: "reason-chip", text: r }))),
      h("div", { class: "star-actions" },
        h("button", { class: "primary-btn", type: "button", onclick: () => acceptPlan(a) }, "Aceptar plan"),
        h("button", { class: "ghost-btn", type: "button", onclick: () => openDiscard(a) }, "Descartar")
      )
    );
  } else if (status === "accepted") {
    body.append(
      h("p", { class: "star-status" }, h("span", { class: "status-dot" }), "Aceptado · ciérralo con una prueba"),
      h("div", { class: "star-actions" },
        h("button", { class: "primary-btn", type: "button", onclick: () => openComplete(a) }, "Completar con prueba"),
        h("button", { class: "ghost-btn", type: "button", onclick: () => openDiscard(a) }, "Descartar")
      )
    );
  } else if (status === "completed") {
    body.append(h("p", { class: "star-status" }, h("span", { class: "status-dot done" }), "Completado · ¡bien hecho!"));
    if (entry?.proofUrl) {
      body.append(
        proofThumb(entry, a.title),
        h("div", { class: "star-actions two" },
          h("button", { class: "ghost-btn", type: "button", onclick: () => openComplete(a, { replace: entry }) }, "Reemplazar prueba"),
          h("button", { class: "ghost-btn", type: "button", onclick: () => removeProof(entry) }, "Quitar prueba")
        )
      );
    }
  }
  if (state.user && a.authorId === state.user.uid && !a.sample) {
    body.append(h("button", { class: "link-btn danger star-delete", type: "button", onclick: () => removePlan(a) }, "Eliminar mi publicación"));
  }
  body.append(h("p", { class: "star-foot" }, svgUse("i-clock"),
    h("span", { id: "star-countdown", text: countdownText(prefs.frequencyDays) })));

  return h("section", { class: "star", "aria-label": "Actividad estrella" }, media, body);
}

function countdownText(freq) {
  return `Nueva actividad estrella en ${formatCountdown(msUntilNextPeriod(freq))}`;
}

// Actualiza la cuenta atrás y detecta el cambio de periodo.
let lastPeriodKey = null;
setInterval(() => {
  const freq = currentPrefs().frequencyDays;
  const el = $("#star-countdown");
  if (el) el.textContent = countdownText(freq);
  const key = `${freq}:${currentPeriod(freq)}`;
  if (lastPeriodKey && key !== lastPeriodKey) onDataChange();
  lastPeriodKey = key;
}, 30000);

function proofThumb(entry, title) {
  return h("button", {
    class: "proof-thumb", type: "button", "aria-label": "Ver prueba",
    onclick: () => openViewer({
      url: resolveMediaUrl(entry.proofUrl), type: entry.proofType, is360: entry.is360, title, sub: "Tu prueba de actividad"
    })
  },
    h("img", { src: proofThumbUrl(entry), alt: "", loading: "lazy" }),
    entry.is360 && h("span", { class: "badge-360" }, svgUse("i-orbit"), "360°")
  );
}

const proofThumbUrl = (entry) =>
  mediaThumbUrl({ url: entry.proofUrl, thumbUrl: entry.proofThumb, type: entry.proofType });

async function acceptPlan(a) {
  if (!requireAuth()) return;
  try {
    await setHistory(state.user.uid, a, "accepted");
    toast("Plan aceptado · lo tienes en Mis planes");
  } catch (err) {
    console.error(err);
    toast("No se pudo aceptar el plan.");
  }
}

/* ==========================================================
   Vista: Mis planes
   ========================================================== */
const PLAN_TABS = [
  { id: "accepted", label: "En curso", empty: "Acepta tu actividad estrella en el Panel y aparecerá aquí hasta que la completes." },
  { id: "completed", label: "Completados", empty: "Completa un plan con una foto o vídeo y quedará guardado aquí." },
  { id: "published", label: "Publicados", empty: "Aún no has publicado planes. Comparte el primero desde el Panel." },
  { id: "saved", label: "Guardados", empty: "Guarda planes desde el feed de exploración para tenerlos a mano." },
  { id: "discarded", label: "Papelera", empty: "La papelera está vacía. Los planes descartados no se vuelven a sugerir hasta que los restaures." }
];

function renderPlans() {
  const root = $("#plans");
  if (!state.user) {
    if (!memo("plans", "guest")) return;
    root.replaceChildren(
      h("header", { class: "page-head" }, h("h1", { class: "page-title", text: "Mis planes" })),
      h("div", { class: "list-empty" }, tuxLogo("empty-mark"),
        h("p", { text: "Inicia sesión para ver tus planes aceptados, completados y tu papelera." }),
        h("button", { class: "primary-btn", type: "button", style: "margin-top:16px", onclick: () => requireAuth() }, "Iniciar sesión"))
    );
    return;
  }
  const tab = state.plansTab;
  const entries = tab === "saved" ? state.saved
    : tab === "published" ? state.myPlans.map((a) => [a.id, a.title, a.likeCount, a.commentCount])
    : historyOf(tab).map((e) => [e.activityId, e.status, millis(e.updatedAt), e.proofUrl]);
  if (!memo("plans", JSON.stringify([tab, entries, state.feedReady]))) return;

  const counts = {
    accepted: historyOf("accepted").length, completed: historyOf("completed").length,
    published: state.myPlans.length, saved: state.saved.length, discarded: historyOf("discarded").length
  };
  const tabs = h("div", { class: "tab-chips", role: "tablist" },
    PLAN_TABS.map((t) => h("button", {
      type: "button", role: "tab", class: `tab-chip${t.id === tab ? " is-active" : ""}`, "aria-selected": String(t.id === tab),
      onclick: () => { state.plansTab = t.id; renderPlans(); }
    }, t.label, h("span", { class: "tab-count", text: counts[t.id] })))
  );
  const list = h("ul", { class: "plan-list" });

  root.replaceChildren(
    h("header", { class: "page-head" },
      h("h1", { class: "page-title", text: "Mis planes" }),
      h("p", { class: "page-sub", text: "Tu historial con Tux: en curso, completados, publicados, guardados y papelera." })
    ),
    tabs,
    list
  );
  fillPlanList(list, tab);
}

async function fillPlanList(list, tab) {
  const emptyMsg = PLAN_TABS.find((t) => t.id === tab).empty;
  let rows;
  if (tab === "saved") {
    const activities = (await Promise.all(state.saved.map(resolveActivity))).filter(Boolean);
    rows = activities.map(savedRow);
  } else if (tab === "published") {
    rows = state.myPlans.map(publishedRow);
  } else {
    rows = historyOf(tab).map((entry) => historyRow(entry, tab));
  }
  if (!list.isConnected || state.plansTab !== tab) return;
  list.replaceChildren(...(rows.length
    ? rows
    : [h("li", { class: "list-empty" }, tuxLogo("empty-mark"), h("p", { text: emptyMsg }))]));
}

function planThumb(source, { proof } = {}) {
  const thumb = h("span", { class: "plan-thumb" }, placeholder(source));
  if (proof?.proofUrl) {
    const src = proofThumbUrl(proof);
    if (src) thumb.append(h("img", { src, alt: "", loading: "lazy" }));
    if (proof.is360) thumb.append(h("span", { class: "mark-360", text: "360°" }));
  } else {
    const img = mediaImage(source.imageUrl);
    if (img) thumb.append(img);
  }
  return thumb;
}

function historyRow(entry, tab) {
  const activity = findActivity(entry.activityId) || { id: entry.activityId, ...entry };
  const when = entry.updatedAt ? timeAgo(entry.updatedAt) : "ahora";
  const labels = { accepted: "Aceptado", completed: "Completado", discarded: "Descartado" };
  const onMain = tab === "completed" && entry.proofUrl
    ? () => openViewer({ url: resolveMediaUrl(entry.proofUrl), type: entry.proofType, is360: entry.is360, title: entry.title, sub: `Completado · ${when}` })
    : () => openPlan(entry.activityId, entry);

  let actions = [];
  if (tab === "accepted") {
    actions = [
      h("button", { class: "ghost-btn small accent", type: "button", onclick: () => openComplete(activity) }, "Completar"),
      h("button", { class: "icon-action", type: "button", "aria-label": "Descartar", onclick: () => openDiscard(activity) }, svgUse("i-trash"))
    ];
  } else if (tab === "completed" && entry.proofUrl) {
    actions = [
      h("button", { class: "ghost-btn small", type: "button", onclick: () => openComplete(activity, { replace: entry }) }, "Reemplazar"),
      h("button", { class: "icon-action", type: "button", "aria-label": "Quitar prueba", onclick: () => removeProof(entry) }, svgUse("i-trash"))
    ];
  } else if (tab === "discarded") {
    actions = [h("button", { class: "ghost-btn small", type: "button", onclick: () => restorePlan(entry) }, "Restaurar")];
  }

  return h("li", { class: "plan-row" },
    h("button", { class: "plan-row-main", type: "button", onclick: onMain },
      planThumb(activity, { proof: tab === "completed" ? entry : null }),
      h("span", { class: "plan-text" },
        h("b", { text: entry.title || activity.title || "Plan" }),
        h("small", { text: `${labels[entry.status]} · ${when}` }),
        tab === "discarded" && entry.reason && h("span", { class: "reason-chip", text: entry.reason })
      )
    ),
    actions.length > 0 && h("span", { class: "plan-row-actions" }, actions)
  );
}

function savedRow(a) {
  return h("li", { class: "plan-row" },
    h("button", { class: "plan-row-main", type: "button", onclick: () => openPlan(a.id) },
      planThumb(a),
      h("span", { class: "plan-text" },
        h("b", { text: a.title }),
        h("small", { text: [CATEGORIES[a.category]?.label, a.duration].filter(Boolean).join(" · ") })
      )
    ),
    h("span", { class: "plan-row-actions" },
      h("button", { class: "icon-action", type: "button", "aria-label": "Quitar de guardados", onclick: () => toggleSaved(a.id) },
        svgUse("i-bookmark")))
  );
}

function publishedRow(a) {
  return h("li", { class: "plan-row" },
    h("button", { class: "plan-row-main", type: "button", onclick: () => openPlan(a.id) },
      planThumb(a),
      h("span", { class: "plan-text" },
        h("b", { text: a.title }),
        h("small", { text: `${formatCount(a.likeCount || 0)} apuntados · ${formatCount(a.commentCount || 0)} comentarios${a.seed ? " · prueba" : ""}` })
      )
    ),
    h("span", { class: "plan-row-actions" },
      h("button", { class: "icon-action", type: "button", "aria-label": "Eliminar publicación", onclick: () => removePlan(a) }, svgUse("i-trash")))
  );
}

// Quita la prueba multimedia: borra el archivo del HDD, el registro y devuelve el plan a "en curso".
async function removeProof(entry) {
  const ok = await confirmDialog({
    title: "Quitar prueba multimedia",
    message: "Se borrará el archivo del almacenamiento y el plan volverá a «En curso» para que subas otra prueba.",
    confirmLabel: "Quitar prueba"
  });
  if (!ok) return;
  try {
    await deleteMediaRef(entry.proofUrl, state.user);
    if (entry.proofThumb && entry.proofThumb !== entry.proofUrl) await deleteMediaRef(entry.proofThumb, state.user).catch(() => {});
    if (entry.proofId) await deleteProofDoc(entry.proofId).catch(() => {});
    await removeProofFromHistory(state.user.uid, entry.activityId);
    toast("Prueba eliminada · el plan vuelve a En curso");
  } catch (err) {
    console.error(err);
    toast(err.message || "No se pudo quitar la prueba.");
  }
}

async function restorePlan(entry) {
  try {
    await restoreFromTrash(state.user.uid, entry.activityId);
    toast("Restaurado · Tux podrá volver a sugerirlo");
  } catch (err) {
    console.error(err);
    toast("No se pudo restaurar.");
  }
}

/* ==========================================================
   Vista: Galería VR
   ========================================================== */
watchVrProofs((items) => {
  state.vr = items;
  if (state.view === "vr") renderVr();
}, (err) => console.warn("Tux: no se pudo cargar la galería VR.", err));

function vrTile(item) {
  return h("button", {
    class: "vr-tile", type: "button", "aria-label": `Ver ${item.activityTitle} en 360°`,
    onclick: () => openViewer({
      url: resolveMediaUrl(item.url), type: item.type, is360: true, title: item.activityTitle,
      sub: [`por @${item.authorName}`, item.caption].filter(Boolean).join(" · ")
    })
  },
    h("img", { src: mediaThumbUrl(item) || resolveMediaUrl(item.url), alt: "", loading: "lazy" }),
    h("span", { class: "badge-360" }, svgUse("i-orbit"), item.type === "video" ? "Vídeo 360°" : "360°"),
    h("span", { class: "vr-tile-info" },
      h("b", { text: item.activityTitle }),
      h("small", { text: `@${item.authorName}${item.sample ? " · Muestra" : ""}` })
    )
  );
}

function renderVr() {
  if (!memo("vr", JSON.stringify(state.vr.map((v) => v.id)))) return;
  const community = state.vr;
  $("#vr").replaceChildren(
    h("header", { class: "page-head" },
      h("h1", { class: "page-title", text: "Galería VR" }),
      h("p", { class: "page-sub", text: "Momentos 360° de la comunidad. Arrastra para mirar alrededor o entra en modo VR con tu visor." })
    ),
    h("div", { class: "vr-hero" },
      h("span", { class: "quick-icon" }, svgUse("i-vr")),
      h("div", {},
        h("b", { text: "Comparte en 360°" }),
        h("p", { text: "Completa tu actividad estrella con una foto o vídeo 360° (proporción 2:1) y aparecerá aquí." })
      )
    ),
    community.length
      ? h("div", { class: "vr-grid" }, community.map(vrTile))
      : h("p", { class: "list-empty", text: "Aún no hay contenido 360° de la comunidad. ¡Estrena la galería!" }),
    community.length < 4 && h("h3", { class: "eyebrow vr-section-title", text: "Muestras de Tux" }),
    community.length < 4 && h("div", { class: "vr-grid" }, SAMPLE_VR.map(vrTile))
  );
}

/* ==========================================================
   Vista: Ajustes
   ========================================================== */
const PREF_OPTIONS = {
  maxBudget: Object.entries(BUDGETS).map(([value, b]) => ({ value, label: b.short })),
  maxEffort: Object.entries(EFFORTS).map(([value, e]) => ({ value, label: e.short }))
};

let prefsTimer;
function updatePrefs(change) {
  if (!requireAuth()) return;
  const prefs = { ...currentPrefs(), ...change };
  state.profile = { ...(state.profile || {}), prefs };
  onDataChange();
  clearTimeout(prefsTimer);
  prefsTimer = setTimeout(() => {
    savePrefs(state.user.uid, prefs)
      .then(() => toast("Preferencias guardadas"))
      .catch((err) => {
        console.error(err);
        toast("No se pudieron guardar las preferencias.");
      });
  }, 500);
}

function renderSettings() {
  const prefs = currentPrefs();
  const sig = JSON.stringify([state.user?.uid, state.user?.email, state.profile?.nickname, state.profile?.photoURL,
    state.profile?.avatarColor, prefs, historyOf("discarded").length, themePreference(), state.isAdmin, currentStar()?.activity.id]);
  if (!memo("settings", sig)) return;

  const freqIndex = FREQUENCIES.findIndex((f) => f.days === prefs.frequencyDays);
  const freqGroup = h("div", { class: "segmented four", role: "radiogroup", "aria-label": "Frecuencia" },
    FREQUENCIES.map((f) => h("button", {
      type: "button", role: "radio", class: f.days === prefs.frequencyDays ? "is-active" : "",
      "aria-checked": String(f.days === prefs.frequencyDays),
      onclick: () => updatePrefs({ frequencyDays: f.days })
    }, f.label)),
    h("span", { class: "segmented-thumb" })
  );
  setThumb(freqGroup, freqIndex);

  const interestChips = h("div", { class: "chips" }, Object.entries(CATEGORIES).map(([value, c]) => {
    const on = prefs.interests.includes(value);
    const btn = chip({ value, label: `${c.emoji} ${c.label}` }, on);
    btn.addEventListener("click", () => updatePrefs({
      interests: on ? prefs.interests.filter((x) => x !== value) : [...prefs.interests, value]
    }));
    return btn;
  }));

  const singleChips = (key) => h("div", { class: "chips" }, PREF_OPTIONS[key].map((opt) => {
    const btn = chip(opt, prefs[key] === opt.value);
    btn.addEventListener("click", () => updatePrefs({ [key]: opt.value }));
    return btn;
  }));

  const themeGroup = h("div", { class: "segmented three", id: "theme-switch", role: "radiogroup", "aria-label": "Tema" },
    [["dark", "Oscuro"], ["light", "Claro"], ["system", "Sistema"]].map(([value, label]) =>
      h("button", { type: "button", role: "radio", dataset: { themeOption: value }, onclick: () => applyTheme(value) }, label)),
    h("span", { class: "segmented-thumb" })
  );

  const account = state.user
    ? h("section", { class: "settings-card" },
        h("h3", { text: "Cuenta" }),
        h("div", { class: "account-row" },
          avatarElement(state.profile),
          h("div", {},
            h("b", { text: state.profile?.nickname || state.user.displayName || "Pingüino" }),
            h("small", { text: state.user.email || "Cuenta de Google" }))
        ),
        h("button", { class: "settings-row", type: "button", onclick: openEditProfile },
          svgUse("i-edit"), "Editar perfil", svgUse("i-chevron", "icon chev")),
        h("button", { class: "settings-row danger", type: "button", onclick: signOutUser },
          svgUse("i-logout"), "Cerrar sesión"),
        uidRow(state.user.uid)
      )
    : h("section", { class: "settings-card" },
        h("h3", { text: "Cuenta" }),
        h("p", { class: "help", style: "margin:0 0 12px", text: "Inicia sesión para guardar tus preferencias, aceptar planes y subir tus pruebas." }),
        h("button", { class: "primary-btn", type: "button", onclick: () => openAuth("signup") }, "Crear cuenta o iniciar sesión")
      );

  const freqLong = FREQUENCIES[freqIndex]?.long || "cada día";
  $("#settings").replaceChildren(
    h("header", { class: "page-head" }, h("h1", { class: "page-title", text: "Ajustes" })),
    account,
    h("section", { class: "settings-card" },
      h("h3", { text: "Actividad estrella" }),
      h("div", { class: "field" }, h("span", { text: "Frecuencia de sugerencias" }), freqGroup),
      h("p", { class: "help", text: `Tux te sugerirá una actividad estrella ${freqLong}. Mínimo una al día, máximo una a la semana.` }),
      h("div", { class: "field", style: "margin-top:16px" }, h("span", { text: "Intereses" }), interestChips),
      h("div", { class: "field" }, h("span", { text: "Presupuesto máximo" }), singleChips("maxBudget")),
      h("div", { class: "field" }, h("span", { text: "Energía máxima" }), singleChips("maxEffort"))
    ),
    h("section", { class: "settings-card" },
      h("h3", { text: "Historial" }),
      h("button", {
        class: "settings-row", type: "button",
        onclick: () => {
          if (!requireAuth()) return;
          state.plansTab = "discarded";
          setView("plans");
        }
      }, svgUse("i-trash"), "Papelera",
        h("span", { class: "count", text: String(historyOf("discarded").length) }), svgUse("i-chevron", "icon chev"))
    ),
    h("section", { class: "settings-card" }, h("h3", { text: "Apariencia" }), themeGroup),
    isDevMode() && devToolsCard(),
    h("p", { class: "app-version", text: `Tux · Versión ${APP_VERSION}` })
  );
  syncThemeUI();
}

/* ---------- Herramientas de desarrollo (admin o modo dev) ---------- */
// Modo dev: admins, localhost o ?dev=1 (se recuerda en este navegador).
function isDevMode() {
  if (state.isAdmin || ["localhost", "127.0.0.1"].includes(location.hostname)) return true;
  try {
    if (new URLSearchParams(location.search).get("dev") === "1") localStorage.setItem("tux-dev", "1");
    return localStorage.getItem("tux-dev") === "1";
  } catch {
    return false;
  }
}

async function runDevAction(button, action) {
  if (!requireAuth()) return;
  setLoading(button, true);
  try {
    await action();
  } catch (err) {
    console.error(err);
    toast(err.message || "La acción ha fallado.");
  } finally {
    setLoading(button, false);
  }
}

// Sustituye la actividad estrella actual por otra sin esperar al siguiente periodo.
function rerollStar() {
  const current = currentStar();
  const prefs = currentPrefs();
  const period = currentPeriod(prefs.frequencyDays);
  const history = new Map(state.history);
  if (current) history.set(current.activity.id, { status: "discarded" });
  const pick = pickStar(feedSource(), { prefs, history, seed: `${state.user?.uid}:${period}:${Date.now()}` });
  if (!pick) return toast("No quedan planes disponibles: genera más planes de prueba.");
  const next = { activityId: pick.activity.id, period, frequencyDays: prefs.frequencyDays };
  state.profile = { ...(state.profile || {}), star: next };
  saveStar(state.user.uid, next).catch((err) => console.warn("Tux: no se pudo guardar la estrella.", err));
  onDataChange();
  toast(`Nueva actividad estrella: ${pick.activity.title}`);
}

function devToolsCard() {
  const button = (icon, label, onclick, cls = "") =>
    h("button", { class: `settings-row ${cls}`, type: "button", onclick: (e) => onclick(e.currentTarget) }, svgUse(icon), label);
  return h("section", { class: "settings-card dev-card" },
    h("h3", { text: state.isAdmin ? "Herramientas de desarrollo · Admin" : "Herramientas de desarrollo" }),
    button("i-sparkle", "Generar más planes de prueba", (btn) => runDevAction(btn, async () => {
      const created = await seedActivities(state.user, state.profile, 6);
      toast(created ? `${created} planes de prueba creados` : "Ya tienes todos los planes de prueba");
      loadMyPlans();
    })),
    button("i-refresh", "Nueva actividad estrella ahora", () => state.user ? rerollStar() : requireAuth()),
    button("i-trash", "Borrar mis planes de prueba", (btn) => runDevAction(btn, async () => {
      const ok = await confirmDialog({
        title: "Borrar planes de prueba",
        message: "Se eliminarán todos los planes generados como prueba que hayas publicado.",
        confirmLabel: "Borrar"
      });
      if (!ok) return;
      toast(`${await deleteSeedActivities(state.user.uid)} planes de prueba eliminados`);
      loadMyPlans();
    }), "danger"),
    state.isAdmin && h("a", { class: "settings-row", href: "./admin/" }, svgUse("i-shield"), "Abrir panel de administración", svgUse("i-chevron", "icon chev"))
  );
}

function uidRow(uid) {
  return h("div", { class: "uid-row" },
    h("span", {}, h("small", { text: "Tu ID de usuario" }), h("code", { text: uid })),
    h("button", {
      class: "icon-action", type: "button", "aria-label": "Copiar ID",
      onclick: () => navigator.clipboard.writeText(uid).then(() => toast("ID copiado"), () => toast("No se pudo copiar"))
    }, svgUse("i-copy"))
  );
}

async function signOutUser() {
  await logOut();
  setView("dashboard");
  toast("Hasta pronto 🐧");
}

/* ==========================================================
   Editar perfil
   ========================================================== */
const editModal = $("#edit-modal");
const editForm = $("#edit-form");
const swatches = $("#avatar-swatches");

swatches.append(...AVATAR_COLORS.map((color) =>
  h("button", { class: "swatch", type: "button", dataset: { color }, "aria-label": `Color ${color}` })));
swatches.addEventListener("click", (e) => {
  const s = e.target.closest(".swatch");
  if (s) $$(".swatch", swatches).forEach((x) => x.classList.toggle("is-active", x === s));
});

function updateCounters(form) {
  $$(".counter[data-for]", form).forEach((counter) => {
    const input = form.elements[counter.dataset.for];
    counter.textContent = `${input.value.length}/${input.maxLength}`;
  });
}

function openEditProfile() {
  if (!requireAuth()) return;
  const p = state.profile || {};
  editForm.nickname.value = p.nickname || "";
  editForm.bio.value = p.bio || "";
  editForm.photoURL.value = p.photoURL || "";
  $$(".swatch", swatches).forEach((s) => s.classList.toggle("is-active", s.dataset.color === (p.avatarColor || "orange")));
  $("#edit-error").textContent = "";
  updateCounters(editForm);
  openModal(editModal);
}

editForm.addEventListener("input", () => updateCounters(editForm));
editForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const error = $("#edit-error");
  const nickname = editForm.nickname.value.trim();
  const photoURL = editForm.photoURL.value.trim();
  if (nickname.length < 2) return (error.textContent = "El nickname necesita al menos 2 caracteres.");
  if (!isValidImageUrl(photoURL)) return (error.textContent = "La foto debe ser una URL https.");
  const submit = $('button[type="submit"]', editForm);
  setLoading(submit, true);
  try {
    await updateUserProfile(state.user.uid, {
      nickname, bio: editForm.bio.value, photoURL,
      avatarColor: $(".swatch.is-active", swatches)?.dataset.color || "orange"
    });
    closeModal(editModal);
    toast("Perfil actualizado");
  } catch (err) {
    console.error(err);
    error.textContent = "No se pudo guardar. Inténtalo de nuevo.";
  } finally {
    setLoading(submit, false);
  }
});

/* ==========================================================
   Detalle de plan
   ========================================================== */
const planModal = $("#plan-modal");

async function openPlan(id, fallback) {
  const a = (await resolveActivity(id)) || (fallback && { id, ...fallback });
  if (!a) return toast("Este plan ya no existe");
  $("#plan-holder").replaceChildren(buildCard(a));
  refreshCardStates();
  openModal(planModal);
}

planModal.addEventListener("close", () => {
  $("#plan-holder").replaceChildren();
  if (location.hash.startsWith("#plan=")) history.replaceState(null, "", location.pathname + location.search);
});

function handleHash() {
  const match = location.hash.match(/^#plan=([\w-]+)$/);
  if (match) openPlan(match[1]);
}
window.addEventListener("hashchange", handleHash);

/* ==========================================================
   Publicar TuxPlan
   ========================================================== */
const createModal = $("#create-modal");
const createForm = $("#create-form");
const CREATE_DEFAULTS = { category: "chill", budget: "free", effort: "low", when: "day", duration: "1 h" };
const pick = { ...CREATE_DEFAULTS };

const PICK_OPTIONS = {
  category: FILTER_OPTIONS.category,
  budget: Object.entries(BUDGETS).map(([value, b]) => ({ value, label: b.short, hint: b.short === b.label ? "" : b.label })),
  effort: Object.entries(EFFORTS).map(([value, e]) => ({ value, label: e.short, hint: e.label })),
  when: FILTER_OPTIONS.when,
  duration: DURATIONS.map((d) => ({ value: d, label: d }))
};

for (const [field, options] of Object.entries(PICK_OPTIONS)) {
  const container = $(`[data-pick="${field}"]`, createForm);
  container.append(...options.map((o) => chip(o)));
  container.addEventListener("click", (e) => {
    const btn = e.target.closest(".chip");
    if (!btn) return;
    pick[field] = btn.dataset.value;
    syncPickers();
    renderCreatePreview();
  });
}

function syncPickers() {
  for (const field of Object.keys(PICK_OPTIONS)) {
    $$(`[data-pick="${field}"] .chip`, createForm).forEach((btn) => {
      const on = btn.dataset.value === pick[field];
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-pressed", String(on));
    });
  }
}

let previewUrl = null;
function renderCreatePreview() {
  const holder = $("#create-preview");
  const url = createForm.imageUrl.value.trim();
  const draft = { category: pick.category, emoji: CATEGORIES[pick.category].emoji };
  const title = h("div", { class: "create-preview-title", text: createForm.elements.title.value.trim() });
  // Solo recrea la imagen si cambia la URL, para no parpadear al escribir.
  const existingImg = $("img:not(.tux-logo)", holder);
  const img = url === previewUrl && existingImg ? existingImg : mediaImage(url);
  previewUrl = url;
  img?.classList.add("is-loaded");
  holder.replaceChildren(placeholder(draft), img || "", title);
}

createForm.addEventListener("input", (e) => {
  updateCounters(createForm);
  if (["title", "imageUrl"].includes(e.target.name)) renderCreatePreview();
});

function openCreate() {
  if (!requireAuth(openCreate)) return;
  $("#create-error").textContent = "";
  syncPickers();
  updateCounters(createForm);
  renderCreatePreview();
  openModal(createModal);
  setTimeout(() => createForm.elements.title.focus(), 350);
}

createForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const error = $("#create-error");
  const title = createForm.elements.title.value.trim();
  const imageUrl = createForm.imageUrl.value.trim();
  if (title.length < 3) return (error.textContent = "El título necesita al menos 3 caracteres.");
  if (!isValidImageUrl(imageUrl)) return (error.textContent = "La imagen debe ser una URL que empiece por https://");
  const submit = $("#create-submit");
  setLoading(submit, true);
  try {
    await createActivity({ title, description: createForm.description.value, imageUrl, ...pick }, state.user, state.profile);
    closeModal(createModal);
    createForm.reset();
    Object.assign(pick, CREATE_DEFAULTS);
    previewUrl = null;
    toast("¡TuxPlan publicado! 🎉");
    clearFilters();
    setView("feed");
    feed.scrollTo({ top: 0, behavior: "smooth" });
    loadMyPlans();
  } catch (err) {
    console.error(err);
    error.textContent = "No se pudo publicar. Revisa los datos e inténtalo de nuevo.";
  } finally {
    setLoading(submit, false);
  }
});

/* ==========================================================
   Comentarios
   ========================================================== */
const commentsModal = $("#comments-modal");
const commentForm = $("#comment-form");
const commentsList = $("#comments-list");
let commentsUnsub = null;
let commentsActivity = null;

function renderComments(comments) {
  const a = commentsActivity;
  $("#comments-title").textContent = comments.length === 1 ? "1 comentario" : `${comments.length} comentarios`;
  if (!comments.length) {
    commentsList.replaceChildren(h("li", { class: "comments-empty" }, tuxLogo(), "Sé el primero en comentar."));
    return;
  }
  const uid = state.user?.uid;
  commentsList.replaceChildren(...comments.map((c) => {
    const canDelete = uid && (c.authorId === uid || a?.authorId === uid);
    return h("li", { class: "comment" },
      h("span", { class: "comment-avatar", text: (c.authorName || "?").charAt(0) }),
      h("div", { class: "comment-body" },
        h("div", { class: "comment-head" }, h("b", { text: c.authorName || "pingüino" }), h("time", { text: timeAgo(c.createdAt) })),
        h("p", { class: "comment-text", text: c.text })
      ),
      canDelete && h("button", {
        class: "comment-del", type: "button", "aria-label": "Borrar comentario",
        onclick: () => deleteComment(a.id, c.id).catch(() => toast("No se pudo borrar."))
      }, svgUse("i-trash"))
    );
  }));
  commentsList.scrollTop = commentsList.scrollHeight;
}

async function openComments(id) {
  commentsActivity = await resolveActivity(id);
  if (!commentsActivity) return;
  $("#comments-plan").textContent = commentsActivity.title;
  commentForm.text.placeholder = state.user ? "Añade un comentario…" : "Entra para comentar";
  commentsList.replaceChildren();
  commentsUnsub?.();
  commentsUnsub = watchComments(id, renderComments);
  openModal(commentsModal);
}

commentsModal.addEventListener("close", () => {
  commentsUnsub?.();
  commentsUnsub = null;
});

commentForm.text.addEventListener("focus", () => {
  if (!state.user) {
    commentForm.text.blur();
    closeModal(commentsModal);
    requireAuth(() => openComments(commentsActivity.id));
  }
});

commentForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = commentForm.text.value.trim();
  if (!text || !commentsActivity || !requireAuth()) return;
  commentForm.text.value = "";
  try {
    await addComment(commentsActivity.id, state.user, state.profile?.nickname || "pingüino", text);
  } catch (err) {
    console.error(err);
    commentForm.text.value = text;
    toast("No se pudo enviar el comentario.");
  }
});

/* ==========================================================
   Justificación de descarte
   ========================================================== */
const discardModal = $("#discard-modal");
const discardForm = $("#discard-form");
const discardSubmit = $("#discard-submit");
let discardActivity = null;

$("#discard-reasons").append(...DISCARD_REASONS.map((r) =>
  h("label", { class: "reason" },
    h("input", { type: "radio", name: "reason", value: r.id }),
    h("span", { class: "reason-emoji", text: r.emoji }),
    h("span", { text: r.label }),
    h("span", { class: "reason-check", "aria-hidden": "true" })
  )));

function selectedReason() {
  const id = discardForm.elements.reason.value;
  return DISCARD_REASONS.find((r) => r.id === id) || null;
}

// Sin justificación válida, el botón de descarte permanece desactivado.
function syncDiscard() {
  const reason = selectedReason();
  const note = discardForm.note.value.trim();
  const needsNote = reason?.id === "other";
  $("#discard-note-field").hidden = !reason;
  $("#discard-note-label").textContent = needsNote ? "Cuéntanos el motivo (obligatorio)" : "Comentario (opcional)";
  discardSubmit.disabled = !reason || (needsNote && note.length < 5);
  updateCounters(discardForm);
}

discardForm.addEventListener("input", syncDiscard);
discardForm.addEventListener("change", syncDiscard);

function openDiscard(a) {
  if (!requireAuth()) return;
  discardActivity = a;
  discardForm.reset();
  $("#discard-plan").textContent = a.title;
  $("#discard-error").textContent = "";
  syncDiscard();
  openModal(discardModal);
}

discardForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const reason = selectedReason();
  if (!reason || discardSubmit.disabled || !discardActivity) return;
  const note = discardForm.note.value.trim();
  setLoading(discardSubmit, true);
  try {
    await setHistory(state.user.uid, discardActivity, "discarded", { reason: reason.label, ...(note ? { note } : {}) });
    closeModal(discardModal);
    toast("Movido a la papelera · Tux no volverá a sugerirlo");
  } catch (err) {
    console.error(err);
    $("#discard-error").textContent = "No se pudo descartar. Inténtalo de nuevo.";
  } finally {
    setLoading(discardSubmit, false);
    syncDiscard();
  }
});

/* ==========================================================
   Completar con prueba multimedia (obligatoria)
   ========================================================== */
const completeModal = $("#complete-modal");
const completeForm = $("#complete-form");
const proofInput = $("#proof-input");
const dropzone = $("#dropzone");
const completeSubmit = $("#complete-submit");
const completeError = $("#complete-error");
const proof360 = $("#proof-360");
let completeCtx = null; // { activity, file, kind, probe, replace? }

proofInput.accept = ACCEPT_ATTR;
$("#dropzone-limits").textContent = LIMITS_LABEL;

function resetProof() {
  if (completeCtx?.probe?.objectUrl) URL.revokeObjectURL(completeCtx.probe.objectUrl);
  if (completeCtx) Object.assign(completeCtx, { file: null, kind: null, probe: null });
  proofInput.value = "";
  dropzone.classList.remove("has-file");
  $("#proof-preview").hidden = true;
  $("#proof-preview").replaceChildren();
  $("#proof-meta").hidden = true;
  $("#proof-progress").hidden = true;
  $("#proof-progress span").style.setProperty("--p", "0%");
  completeSubmit.disabled = true;
  completeError.textContent = "";
}

const formatSize = (bytes) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`);

async function handleProofFile(file) {
  if (!file || !completeCtx) return;
  resetProof();
  try {
    const kind = validateFile(file);
    const [probe, hasSphericalMeta] = await Promise.all([probeMedia(file, kind), detectSphericalMetadata(file, kind)]);
    Object.assign(completeCtx, { file, kind, probe });
    const byRatio = isEquirectangular(probe.width, probe.height);
    const detected = hasSphericalMeta || byRatio;
    const preview = kind === "image"
      ? h("img", { src: probe.objectUrl, alt: "Vista previa" })
      : h("video", { src: probe.objectUrl, autoplay: true, loop: true, playsinline: true });
    if (kind === "video") preview.muted = true;
    $("#proof-preview").replaceChildren(preview, h("span", { class: "dropzone-change", text: "Cambiar" }));
    $("#proof-preview").hidden = false;
    dropzone.classList.add("has-file");
    proof360.checked = detected;
    const parts = [
      kind === "image" ? "Foto" : `Vídeo · ${Math.round(probe.duration || 0)} s`,
      `${probe.width}×${probe.height}`,
      formatSize(file.size)
    ];
    const source = hasSphericalMeta ? "metadatos 360°" : "proporción 2:1";
    $("#proof-info").replaceChildren(parts.join(" · "), detected ? h("b", { text: ` · 360° detectado (${source})` }) : "");
    $("#proof-meta").hidden = false;
    completeSubmit.disabled = false;
  } catch (err) {
    completeError.textContent = err.message;
  }
}

proofInput.addEventListener("change", () => handleProofFile(proofInput.files[0]));
["dragenter", "dragover"].forEach((type) => dropzone.addEventListener(type, (e) => {
  e.preventDefault();
  dropzone.classList.add("is-dragging");
}));
["dragleave", "drop"].forEach((type) => dropzone.addEventListener(type, () => dropzone.classList.remove("is-dragging")));
dropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  handleProofFile(e.dataTransfer.files[0]);
});

function openComplete(a, { replace = null } = {}) {
  if (!requireAuth()) return;
  completeCtx = { activity: a, file: null, kind: null, probe: null, replace };
  completeForm.reset();
  resetProof();
  $("#complete-plan").textContent = a.title;
  $("#complete-title").textContent = replace ? "Reemplazar prueba" : "Completar plan";
  completeSubmit.textContent = replace ? "Reemplazar prueba" : "Completar plan";
  openModal(completeModal);
  // Avisa pronto si el almacenamiento (servidor local + disco HDD) no está disponible.
  checkMediaServer().then((status) => {
    if (!status.ok && completeCtx?.activity === a) completeError.textContent = status.message || "El almacenamiento no está disponible.";
  });
}

completeModal.addEventListener("close", () => {
  resetProof();
  completeCtx = null;
});

completeForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const ctx = completeCtx;
  if (!ctx?.file) return (completeError.textContent = "Adjunta una foto o un vídeo para completar el plan.");
  completeError.textContent = "";
  setLoading(completeSubmit, true);
  const progress = $("#proof-progress");
  const bar = $("span", progress);
  progress.hidden = false;
  try {
    const server = await checkMediaServer();
    if (!server.ok) throw new Error(server.message || "El almacenamiento no está disponible.");
    const upload = await uploadMedia({
      file: ctx.file, kind: ctx.kind, user: state.user, thumbBlob: ctx.probe.thumbBlob,
      onProgress: (p) => bar.style.setProperty("--p", `${Math.round(p * 100)}%`)
    });
    const is360 = proof360.checked;
    const proofId = await createProof({
      user: state.user, authorName: state.profile?.nickname, activity: ctx.activity, upload,
      kind: ctx.kind, is360, caption: completeForm.caption.value,
      width: ctx.probe.width, height: ctx.probe.height
    });
    await setHistory(state.user.uid, ctx.activity, "completed", {
      proofId, proofUrl: upload.url, proofThumb: upload.thumbUrl || "", proofType: ctx.kind, is360
    });
    // Al reemplazar: se borra la prueba anterior (archivo en el HDD + registro).
    const old = ctx.replace;
    if (old?.proofUrl && old.proofUrl !== upload.url) {
      await deleteMediaRef(old.proofUrl, state.user).catch((err) => console.warn("Tux: archivo anterior no borrado.", err));
      if (old.proofThumb && old.proofThumb !== old.proofUrl) await deleteMediaRef(old.proofThumb, state.user).catch(() => {});
      if (old.proofId) await deleteProofDoc(old.proofId).catch(() => {});
    }
    closeModal(completeModal);
    if (old) toast("Prueba reemplazada");
    else toast(is360 ? "¡Plan completado! Tu 360° ya está en la Galería VR 🎉" : "¡Plan completado! 🎉");
  } catch (err) {
    console.error(err);
    completeError.textContent = err.message || "No se pudo completar. Inténtalo de nuevo.";
  } finally {
    setLoading(completeSubmit, false);
    completeSubmit.disabled = !completeCtx?.file;
  }
});

/* ==========================================================
   Notificaciones
   ========================================================== */
const notificationsModal = $("#notifications-modal");

function renderBell() {
  const bell = $("#header-bell");
  bell.hidden = !state.user;
  const unread = state.notifications.filter((n) => !n.read).length;
  const badge = $("#bell-badge");
  badge.hidden = unread === 0;
  badge.textContent = unread > 9 ? "9+" : unread;
  bell.setAttribute("aria-label", unread ? `Notificaciones (${unread} sin leer)` : "Notificaciones");
}

function renderNotifications() {
  const list = $("#notification-list");
  if (!state.notifications.length) {
    list.replaceChildren(h("li", { class: "list-empty" }, tuxLogo("empty-mark"), h("p", { text: "No tienes notificaciones." })));
    return;
  }
  list.replaceChildren(...state.notifications.map((n) => {
    const kind = NOTIFICATION_KINDS[n.kind] || NOTIFICATION_KINDS.info;
    return h("li", { class: `notification${n.read ? "" : " is-unread"}` },
      h("span", { class: "notification-icon", text: kind.emoji }),
      h("div", { class: "notification-body" },
        h("div", { class: "notification-head" }, h("b", { text: n.title }), h("time", { text: timeAgo(n.createdAt) })),
        h("p", { text: n.body }),
        h("small", { text: `${kind.label} · ${n.fromName || "Equipo Tux"}` })
      ),
      h("button", {
        class: "icon-action", type: "button", "aria-label": "Borrar notificación",
        onclick: () => deleteNotification(n.id).catch(() => toast("No se pudo borrar."))
      }, svgUse("i-x"))
    );
  }));
}

$("#header-bell").addEventListener("click", () => {
  renderNotifications();
  openModal(notificationsModal);
  markAllRead(state.notifications).catch((err) => console.warn("Tux: no se pudieron marcar como leídas.", err));
});

initViewer();

/* ==========================================================
   Arranque
   ========================================================== */
completeRedirectSignIn()
  .then((user) => user && toast(`Hola, ${user.displayName || "pingüino"} 🐧`))
  .catch((err) => {
    console.error("Tux: error al volver de Google.", err);
    openAuth("login");
    authError.textContent = authErrorMessage(err);
  });

syncThemeUI();
setAuthMode("login");
renderActiveFilters();
renderHeader();
setView("dashboard");
handleHash();
