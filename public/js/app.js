// Punto de entrada de la interfaz de Tux.
import { BUDGETS, EFFORTS, fetchActivities, filterSamples } from "../../src/activities.js";
import { signIn, logOut, watchSession } from "../../src/auth.js";

const state = { budget: "all", effort: "all", user: null };

const feed = document.getElementById("feed");
const cardTemplate = document.getElementById("card-template");
const emptyTemplate = document.getElementById("empty-template");
const themeToggle = document.getElementById("theme-toggle");
const authBtn = document.getElementById("auth-btn");

/* ---------- Tema ---------- */
function currentTheme() {
  const explicit = document.documentElement.dataset.theme;
  if (explicit) return explicit;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

themeToggle.addEventListener("click", () => {
  const next = currentTheme() === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem("tux-theme", next); } catch (e) {}
});

/* ---------- Feed ---------- */
function renderCards(activities) {
  feed.replaceChildren();
  if (!activities.length) {
    feed.append(emptyTemplate.content.cloneNode(true));
    return;
  }
  for (const a of activities) {
    const node = cardTemplate.content.cloneNode(true);
    node.querySelector(".card-emoji").textContent = a.emoji || "🐧";
    node.querySelector(".card-title").textContent = a.title;
    node.querySelector(".card-desc").textContent = a.description;
    const tags = node.querySelector(".card-tags");
    for (const label of [BUDGETS[a.budget], EFFORTS[a.effort]]) {
      if (!label) continue;
      const tag = document.createElement("span");
      tag.className = "tag";
      tag.textContent = label;
      tags.append(tag);
    }
    feed.append(node);
  }
  feed.scrollTo({ top: 0 });
}

async function loadFeed() {
  const filters = { budget: state.budget, effort: state.effort };
  let activities = [];
  try {
    activities = await fetchActivities(filters);
  } catch (err) {
    console.warn("Tux: no se pudo leer Firestore, usando datos de ejemplo.", err);
  }
  renderCards(activities.length ? activities : filterSamples(filters));
}

/* ---------- Filtros ---------- */
document.querySelectorAll(".filter-group").forEach((group) => {
  group.addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    group.querySelectorAll(".chip").forEach((c) => {
      const active = c === chip;
      c.classList.toggle("is-active", active);
      c.setAttribute("aria-checked", String(active));
    });
    state[group.dataset.filter] = chip.dataset.value;
    loadFeed();
  });
});

/* ---------- Acciones de tarjeta (maqueta) ---------- */
feed.addEventListener("click", (e) => {
  const action = e.target.closest(".action");
  if (action) action.classList.toggle("is-on");
});

/* ---------- Autenticación ---------- */
authBtn.addEventListener("click", async () => {
  try {
    if (state.user) await logOut();
    else await signIn();
  } catch (err) {
    console.error("Tux: error de autenticación.", err);
  }
});

watchSession((user) => {
  state.user = user;
  authBtn.textContent = user ? "Salir" : "Entrar";
});

loadFeed();
