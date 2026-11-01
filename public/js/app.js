// Tux · lógica de la interfaz (feed, filtros, auth, perfil, publicación y comentarios).
import {
  CATEGORIES, BUDGETS, EFFORTS, WHEN, DURATIONS, SAMPLE_ACTIVITIES,
  watchActivities, getActivity, getActivitiesByAuthor, createActivity, deleteActivity,
  matchesFilters, normalize, millis, isValidImageUrl
} from "../../src/activities.js";
import {
  signInWithGoogle, signInWithEmail, signUpWithEmail, resetPassword, logOut,
  watchSession, authErrorMessage
} from "../../src/auth.js";
import { AVATAR_COLORS, ensureUserProfile, watchUserProfile, updateUserProfile } from "../../src/users.js";
import {
  watchLikes, watchSaved, watchCompleted, setLike, setSaved, setCompleted,
  watchComments, addComment, deleteComment
} from "../../src/social.js";

/* ==========================================================
   Utilidades
   ========================================================== */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const SVG_NS = "http://www.w3.org/2000/svg";

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === "class") el.className = value;
    else if (key === "text") el.textContent = value;
    else if (key === "dataset") Object.assign(el.dataset, value);
    else if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat()) {
    if (child != null && child !== false) el.append(child);
  }
  return el;
}

function svgUse(id, cls = "icon") {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", cls);
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS(SVG_NS, "use");
  use.setAttribute("href", `#${id}`);
  svg.append(use);
  return svg;
}

const formatCount = (n = 0) =>
  n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(".0", "")}k` : String(Math.max(0, n));

function timeAgo(ts) {
  const ms = millis(ts);
  if (!ms) return "ahora";
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return "ahora";
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86400) return `${Math.floor(s / 3600)} h`;
  if (s < 604800) return `${Math.floor(s / 86400)} d`;
  return new Date(ms).toLocaleDateString("es", { day: "numeric", month: "short" });
}

let toastTimer;
function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("is-visible"), 2600);
}

function setLoading(button, loading) {
  button.classList.toggle("is-loading", loading);
  button.disabled = loading;
}

/* ==========================================================
   Estado
   ========================================================== */
const state = {
  user: null,
  profile: null,
  remote: [],            // planes de Firestore (tiempo real)
  feedReady: false,
  liked: new Set(),
  saved: [],             // ids, más recientes primero
  completed: [],
  myPlans: [],
  filters: { budget: new Set(), effort: new Set(), category: new Set(), when: new Set(), search: "" },
  view: "feed",
  profileTab: "mine",
  feedKey: null
};

const cache = new Map(); // id → actividad (para perfil y detalle)
let sessionUnsubs = [];

const usingSamples = () => state.feedReady && state.remote.length === 0;
const feedSource = () => (usingSamples() ? SAMPLE_ACTIVITIES : state.remote);
const findActivity = (id) =>
  state.remote.find((a) => a.id === id) || SAMPLE_ACTIVITIES.find((a) => a.id === id) || cache.get(id);

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

/* ==========================================================
   Tema
   ========================================================== */
const themeMeta = $('meta[name="theme-color"]');
const darkQuery = matchMedia("(prefers-color-scheme: dark)");

function themePreference() {
  try {
    return localStorage.getItem("tux-theme") || "system";
  } catch {
    return "system";
  }
}

function applyTheme(pref) {
  if (pref === "light" || pref === "dark") document.documentElement.dataset.theme = pref;
  else delete document.documentElement.dataset.theme;
  try {
    if (pref === "system") localStorage.removeItem("tux-theme");
    else localStorage.setItem("tux-theme", pref);
  } catch {}
  syncThemeUI();
}

function syncThemeUI() {
  const pref = themePreference();
  const dark = pref === "dark" || (pref === "system" && darkQuery.matches);
  themeMeta.setAttribute("content", dark ? "#0D0D0E" : "#FFFFFF");
  const options = $$("#theme-switch [data-theme-option]");
  options.forEach((btn, i) => {
    const active = btn.dataset.themeOption === pref;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-checked", String(active));
    if (active) setThumb($("#theme-switch"), i);
  });
}

darkQuery.addEventListener("change", syncThemeUI);
$("#theme-switch").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-theme-option]");
  if (btn) applyTheme(btn.dataset.themeOption);
});

function setThumb(segmented, index) {
  $(".segmented-thumb", segmented)?.style.setProperty("--index", index);
}

/* ==========================================================
   Modales (dialog nativo con animación de salida)
   ========================================================== */
function openModal(dialog) {
  if (dialog.open) return;
  dialog.classList.remove("is-closing");
  dialog.showModal();
  dialog.focus({ preventScroll: true });
}

function closeModal(dialog) {
  if (!dialog.open || dialog.classList.contains("is-closing")) return;
  dialog.classList.add("is-closing");
  setTimeout(() => {
    dialog.classList.remove("is-closing");
    dialog.close();
  }, 260);
}

$$("dialog.sheet").forEach((dialog) => {
  dialog.addEventListener("cancel", (e) => {
    e.preventDefault();
    closeModal(dialog);
  });
  // Clic en el fondo (fuera del rectángulo del diálogo) cierra.
  dialog.addEventListener("click", (e) => {
    if (e.target.closest("[data-close]")) return closeModal(dialog);
    if (e.target !== dialog) return;
    const r = dialog.getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    if (!inside) closeModal(dialog);
  });
});

/* ==========================================================
   Autenticación
   ========================================================== */
const authModal = $("#auth-modal");
const authForm = $("#auth-form");
const authError = $("#auth-error");
let authMode = "login";

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

function openAuth(mode = "login") {
  setAuthMode(mode);
  openModal(authModal);
}

function requireAuth(message = "Entra para continuar") {
  if (state.user) return true;
  toast(message);
  openAuth();
  return false;
}

$("#auth-tabs").addEventListener("click", (e) => {
  const tab = e.target.closest("[data-tab]");
  if (tab) setAuthMode(tab.dataset.tab);
});

async function afterSignIn(user) {
  closeModal(authModal);
  authForm.reset();
  const name = state.profile?.nickname || user.displayName || "pingüino";
  toast(`Hola, ${name} 🐧`);
}

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
    await afterSignIn(user);
  } catch (err) {
    authError.textContent = authErrorMessage(err);
  } finally {
    setLoading(submit, false);
  }
});

$("#google-btn").addEventListener("click", async (e) => {
  const btn = e.currentTarget;
  setLoading(btn, true);
  try {
    await afterSignIn(await signInWithGoogle());
  } catch (err) {
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
  state.user = user;
  state.profile = null;
  state.liked = new Set();
  state.saved = [];
  state.completed = [];
  state.myPlans = [];
  $("#settings-account").hidden = !user;

  if (user) {
    ensureUserProfile(user).catch((err) => console.warn("Tux: perfil no creado.", err));
    sessionUnsubs.push(
      watchUserProfile(user.uid, (profile) => {
        state.profile = profile;
        if (state.view === "profile") renderProfile();
      }),
      watchLikes(user.uid, (ids) => {
        state.liked = new Set(ids);
        refreshCardStates();
      }),
      watchSaved(user.uid, (ids) => {
        state.saved = ids;
        refreshCardStates();
        if (state.view === "profile") renderProfile();
      }),
      watchCompleted(user.uid, (ids) => {
        state.completed = ids;
        refreshCardStates();
        if (state.view === "profile") renderProfile();
      })
    );
    loadMyPlans();
  }
  refreshCardStates();
  renderFeed(true);
  if (state.view === "profile") renderProfile();
});

/* ==========================================================
   Tarjetas
   ========================================================== */
function placeholder(a) {
  return h("div", { class: "placeholder", dataset: { cat: a.category || "chill" } },
    h("span", { class: "ph-emoji", text: a.emoji || CATEGORIES[a.category]?.emoji || "🐧" }),
    svgUse("tux", "ph-tux")
  );
}

function mediaImage(url) {
  if (!url || !isValidImageUrl(url)) return null;
  const img = h("img", { src: url, alt: "", loading: "lazy", decoding: "async", referrerpolicy: "no-referrer" });
  img.addEventListener("load", () => img.classList.add("is-loaded"));
  img.addEventListener("error", () => img.remove());
  return img;
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

function railButton(action, iconId, label, extraClass = "") {
  return h("button", { class: `rail-btn ${extraClass}`, type: "button", dataset: { action }, "aria-label": label },
    h("span", { class: "rail-icon" }, svgUse(iconId)),
    h("span", { class: "rail-count", text: label })
  );
}

function buildCard(a) {
  const own = state.user && a.authorId === state.user.uid && !a.sample;
  const cat = CATEGORIES[a.category] || CATEGORIES.chill;
  const when = WHEN[a.when];

  return h("article", { class: "card", dataset: { id: a.id }, "aria-label": a.title },
    h("div", { class: "card-media" }, placeholder(a), mediaImage(a.imageUrl)),
    h("div", { class: "card-scrim" }),
    h("div", { class: "card-info" },
      h("div", { class: "card-badges" },
        h("span", { class: "badge-cat" }, `${cat.emoji} ${cat.label}`),
        a.sample && h("span", { class: "badge-sample", text: "Ejemplo" })
      ),
      h("h2", { class: "card-title", text: a.title }),
      a.description && h("p", { class: "card-desc", text: a.description }),
      h("div", { class: "card-meta" },
        budgetMeta(a.budget),
        effortMeta(a.effort),
        when && h("span", { class: "meta" }, `${when.emoji} ${when.label}`),
        a.duration && h("span", { class: "meta" }, svgUse("i-clock"), a.duration)
      ),
      h("p", { class: "card-author" }, "por ", h("b", { text: `@${a.authorName || "tux"}` }),
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
}

// Sincroniza estado (activo/contadores) de todas las tarjetas visibles.
function refreshCardStates() {
  const saved = new Set(state.saved);
  const completed = new Set(state.completed);
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
    $('[data-action="done"]', card).classList.toggle("is-on", completed.has(id));
  });
}

/* ==========================================================
   Feed
   ========================================================== */
const feed = $("#feed");

function filteredActivities() {
  return feedSource().filter((a) => matchesFilters(a, state.filters));
}

function emptyState() {
  return h("div", { class: "empty" },
    svgUse("tux", "empty-mark"),
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
  const list = filteredActivities();
  const key = list.map((a) => a.id).join("|");
  updateFilterSummary(list.length);

  if (key === state.feedKey && !force) return refreshCardStates();

  // Conserva la tarjeta visible al reconstruir.
  const index = feed.clientHeight ? Math.round(feed.scrollTop / feed.clientHeight) : 0;
  const currentId = feed.children[index]?.dataset?.id;

  feed.replaceChildren(...(list.length ? list.map(buildCard) : [emptyState()]));
  state.feedKey = key;
  refreshCardStates();

  const keepIndex = list.findIndex((a) => a.id === currentId);
  feed.scrollTop = keepIndex > 0 ? keepIndex * feed.clientHeight : 0;
}

watchActivities(
  (list) => {
    state.remote = list;
    state.feedReady = true;
    renderFeed();
  },
  (err) => {
    console.warn("Tux: no se pudo leer Firestore, usando planes de ejemplo.", err);
    state.remote = [];
    state.feedReady = true;
    renderFeed(true);
  }
);

// Si Firestore tarda (red lenta, base aún sin crear), muestra los ejemplos mientras tanto.
setTimeout(() => {
  if (state.feedReady) return;
  state.feedReady = true;
  renderFeed(true);
}, 3500);

/* ---------- Acciones de tarjeta ---------- */
async function toggleLike(id, card) {
  const a = findActivity(id);
  if (a?.sample) return toast("Es un plan de ejemplo · publica el tuyo 🐧");
  if (!requireAuth("Entra para apuntarte a planes")) return;
  const liked = !state.liked.has(id);
  // Actualización optimista; el snapshot de Firestore confirma después.
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

async function toggleRelation(kind, id, card) {
  if (!requireAuth(kind === "save" ? "Entra para guardar planes" : "Entra para registrar lo que haces")) return;
  const listKey = kind === "save" ? "saved" : "completed";
  const on = !state[listKey].includes(id);
  state[listKey] = on ? [id, ...state[listKey]] : state[listKey].filter((x) => x !== id);
  refreshCardStates();
  pop(card, kind);
  try {
    await (kind === "save" ? setSaved : setCompleted)(state.user.uid, id, on);
    if (on) toast(kind === "save" ? "Guardado en tu perfil" : "¡Bien hecho! Tux está orgulloso 🐧");
  } catch (err) {
    console.error(err);
    state[listKey] = on ? state[listKey].filter((x) => x !== id) : [id, ...state[listKey]];
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
  if (!confirm(`¿Borrar "${a.title}"? Esta acción no se puede deshacer.`)) return;
  try {
    await deleteActivity(a.id);
    closeModal($("#plan-modal"));
    toast("Plan borrado");
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

document.addEventListener("click", async (e) => {
  const btn = e.target.closest(".rail-btn");
  if (!btn) return;
  const card = btn.closest(".card");
  const id = card.dataset.id;
  const a = findActivity(id);
  switch (btn.dataset.action) {
    case "like": return toggleLike(id, card);
    case "comment": return a?.sample ? toast("Los planes de ejemplo no tienen comentarios") : openComments(id);
    case "save": return toggleRelation("save", id, card);
    case "done": return toggleRelation("done", id, card);
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

function chip({ value, label, hint }) {
  return h("button", { class: "chip", type: "button", dataset: { value }, "aria-pressed": "false" },
    label, hint && h("small", { text: hint }));
}

for (const [group, options] of Object.entries(FILTER_OPTIONS)) {
  const container = $(`[data-filter="${group}"]`, filtersModal);
  container.append(...options.map(chip));
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

function activeFilterCount() {
  const f = state.filters;
  return f.budget.size + f.effort.size + f.category.size + f.when.size + (f.search ? 1 : 0);
}

function renderActiveFilters() {
  const row = $("#active-filters");
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
  row.replaceChildren(...chips);

  const badge = $("#filters-badge");
  const count = activeFilterCount();
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
   Navegación entre vistas
   ========================================================== */
function setView(view) {
  state.view = view;
  $("#app").dataset.view = view;
  $$(".view").forEach((v) => v.classList.toggle("is-active", v.id === `view-${view}`));
  $$(".tab-item").forEach((t) => t.classList.toggle("is-active", t.dataset.nav === view));
  if (view === "profile") {
    renderProfile();
    loadMyPlans();
  }
}

$(".tabbar").addEventListener("click", (e) => {
  const item = e.target.closest("[data-nav]");
  if (!item) return;
  const target = item.dataset.nav;
  if (target === "create") return openCreate();
  if (target === "feed" && state.view === "feed") return feed.scrollTo({ top: 0, behavior: "smooth" });
  setView(target);
});

/* ==========================================================
   Perfil
   ========================================================== */
const PROFILE_TABS = [
  { id: "mine", label: "Mis planes", empty: "Aún no has publicado planes.\nComparte tu primer TuxPlan con el botón +." },
  { id: "saved", label: "Guardados", empty: "Guarda planes desde el feed\npara tenerlos a mano." },
  { id: "completed", label: "Cumplidos", empty: "Marca «Lo hice» en un plan\ny aparecerá aquí." }
];

async function loadMyPlans() {
  if (!state.user) return;
  try {
    state.myPlans = await getActivitiesByAuthor(state.user.uid);
    state.myPlans.forEach((a) => cache.set(a.id, a));
  } catch (err) {
    console.warn("Tux: no se pudieron cargar tus planes.", err);
  }
  if (state.view === "profile") renderProfile();
}

function avatarElement(profile, interactive) {
  const color = AVATAR_COLORS.includes(profile?.avatarColor) ? profile.avatarColor : "orange";
  const content = profile?.photoURL
    ? h("img", { src: profile.photoURL, alt: "", referrerpolicy: "no-referrer" })
    : svgUse("tux", "avatar-tux");
  return h(interactive ? "button" : "div", {
    class: "avatar", type: interactive ? "button" : null, dataset: { color },
    "aria-label": interactive ? "Toca a Tux para cambiar su color" : null,
    title: interactive ? "Toca a Tux" : null,
    onclick: interactive ? onAvatarTap : null
  }, content);
}

let avatarTimer;
function onAvatarTap(e) {
  const avatar = e.currentTarget;
  avatar.classList.remove("is-waving");
  void avatar.offsetWidth;
  avatar.classList.add("is-waving");
  if (!state.profile || state.profile.photoURL) return;
  const next = AVATAR_COLORS[(AVATAR_COLORS.indexOf(state.profile.avatarColor) + 1) % AVATAR_COLORS.length];
  avatar.dataset.color = next;
  // Agrupa toques rápidos en una sola escritura.
  clearTimeout(avatarTimer);
  avatarTimer = setTimeout(() => {
    updateUserProfile(state.user.uid, { avatarColor: avatar.dataset.color }).catch(() => toast("No se pudo guardar el color."));
  }, 600);
  state.profile = { ...state.profile, avatarColor: next };
}

function settingsButton() {
  return h("button", { class: "icon-btn", type: "button", "aria-label": "Ajustes", onclick: openSettings },
    svgUse("i-gear", "icon icon-gear"));
}

function renderProfile() {
  const root = $("#profile");
  if (!state.user) {
    root.replaceChildren(
      h("div", { class: "profile-top" }, settingsButton()),
      h("div", { class: "profile-guest" },
        svgUse("tux", "empty-mark"),
        h("h2", { text: "Tu rincón en Tux" }),
        h("p", { text: "Guarda planes, apúntate a los que te gusten y comparte los tuyos." }),
        h("button", { class: "primary-btn", type: "button", onclick: () => openAuth("signup") }, "Crear cuenta"),
        h("button", { class: "link-btn", type: "button", onclick: () => openAuth("login") }, "Ya tengo cuenta")
      )
    );
    return;
  }

  const p = state.profile || {};
  const since = millis(p.createdAt)
    ? new Date(millis(p.createdAt)).toLocaleDateString("es", { month: "long", year: "numeric" })
    : null;
  const tabIndex = PROFILE_TABS.findIndex((t) => t.id === state.profileTab);
  const counts = { mine: state.myPlans.length, saved: state.saved.length, completed: state.completed.length };

  const tabs = h("div", { class: "segmented three", role: "tablist" },
    PROFILE_TABS.map((t) => h("button", {
      type: "button", role: "tab", class: t.id === state.profileTab ? "is-active" : "",
      "aria-selected": String(t.id === state.profileTab),
      onclick: () => { state.profileTab = t.id; renderProfile(); }
    }, t.label)),
    h("span", { class: "segmented-thumb" })
  );
  setThumb(tabs, tabIndex);

  const grid = h("div", { class: "tile-grid" });

  root.replaceChildren(
    h("div", { class: "profile-top" }, settingsButton()),
    h("div", { class: "profile-head" },
      avatarElement(p, true),
      h("h1", { class: "profile-name", text: p.nickname || state.user.displayName || "Pingüino" }),
      p.bio && h("p", { class: "profile-bio", text: p.bio }),
      since && h("p", { class: "profile-since", text: `En Tux desde ${since}` }),
      h("button", { class: "profile-edit", type: "button", onclick: openEditProfile }, "Editar perfil")
    ),
    h("div", { class: "stats" },
      h("div", { class: "stat" }, h("b", { text: counts.mine }), h("span", { text: "Planes" })),
      h("div", { class: "stat" }, h("b", { text: counts.saved }), h("span", { text: "Guardados" })),
      h("div", { class: "stat" }, h("b", { text: counts.completed }), h("span", { text: "Cumplidos" }))
    ),
    tabs,
    grid
  );

  renderTiles(grid, state.profileTab);
}

async function renderTiles(grid, tab) {
  const ids = tab === "mine" ? state.myPlans.map((a) => a.id) : tab === "saved" ? state.saved : state.completed;
  const activities = (await Promise.all(ids.map(resolveActivity))).filter(Boolean);
  if (!grid.isConnected || state.profileTab !== tab) return;
  if (!activities.length) {
    const msg = PROFILE_TABS.find((t) => t.id === tab).empty;
    grid.replaceChildren(h("p", { class: "tile-empty", text: msg, style: "white-space: pre-line" }));
    return;
  }
  grid.replaceChildren(...activities.map((a, i) => {
    const tile = h("button", { class: "tile", type: "button", "aria-label": a.title, onclick: () => openPlan(a.id) },
      placeholder(a), mediaImage(a.imageUrl), h("span", { class: "tile-title", text: a.title }));
    tile.style.animationDelay = `${Math.min(i, 12) * 30}ms`;
    return tile;
  }));
}

/* ---------- Detalle de plan ---------- */
const planModal = $("#plan-modal");

async function openPlan(id) {
  const a = await resolveActivity(id);
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
   Ajustes y edición de perfil
   ========================================================== */
const settingsModal = $("#settings-modal");
const editModal = $("#edit-modal");
const editForm = $("#edit-form");

function openSettings() {
  syncThemeUI();
  openModal(settingsModal);
}

$("#logout-btn").addEventListener("click", async () => {
  await logOut();
  closeModal(settingsModal);
  toast("Hasta pronto 🐧");
});

$("#edit-profile-btn").addEventListener("click", () => {
  closeModal(settingsModal);
  setTimeout(openEditProfile, 280);
});

const swatches = $("#avatar-swatches");
swatches.append(...AVATAR_COLORS.map((color) => {
  const s = h("button", { class: "swatch", type: "button", dataset: { color }, "aria-label": `Color ${color}` });
  return s;
}));
swatches.addEventListener("click", (e) => {
  const s = e.target.closest(".swatch");
  if (!s) return;
  $$(".swatch", swatches).forEach((x) => x.classList.toggle("is-active", x === s));
});

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
      nickname,
      bio: editForm.bio.value,
      photoURL,
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
  container.append(...options.map(chip));
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
  const existingImg = $("img", holder);
  const img = url === previewUrl && existingImg ? existingImg : mediaImage(url);
  previewUrl = url;
  img?.classList.add("is-loaded");
  holder.replaceChildren(placeholder(draft), img, title);
}

function updateCounters(form) {
  $$(".counter[data-for]", form).forEach((counter) => {
    const input = form.elements[counter.dataset.for];
    counter.textContent = `${input.value.length}/${input.maxLength}`;
  });
}

createForm.addEventListener("input", (e) => {
  updateCounters(createForm);
  if (["title", "imageUrl"].includes(e.target.name)) renderCreatePreview();
});
editForm.addEventListener("input", () => updateCounters(editForm));

function openCreate() {
  if (!requireAuth("Entra para publicar tu TuxPlan")) return;
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
  $("#comments-title").textContent =
    comments.length === 1 ? "1 comentario" : `${comments.length} comentarios`;
  if (!comments.length) {
    commentsList.replaceChildren(h("li", { class: "comments-empty" },
      svgUse("tux"), "Sé el primero en comentar."));
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
    requireAuth("Entra para comentar");
  }
});

commentForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = commentForm.text.value.trim();
  if (!text || !commentsActivity || !requireAuth("Entra para comentar")) return;
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
   Arranque
   ========================================================== */
syncThemeUI();
setAuthMode("login");
renderActiveFilters();
renderProfile();
handleHash();
