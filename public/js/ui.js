// Utilidades de interfaz compartidas: DOM, iconos, logo, toasts y modales.
import { millis } from "../../src/activities.js";

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const SVG_NS = "http://www.w3.org/2000/svg";
// Relativo a este módulo: funciona igual desde /public/ y desde /public/admin/.
export const LOGO_SRC = new URL("../img/logo.png", import.meta.url).href;

export function h(tag, props = {}, ...children) {
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

export function svgUse(id, cls = "icon") {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", cls);
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS(SVG_NS, "use");
  use.setAttribute("href", `#${id}`);
  svg.append(use);
  return svg;
}

export const tuxLogo = (cls = "") => h("img", { class: `tux-logo ${cls}`, src: LOGO_SRC, alt: "", draggable: "false" });

export const formatCount = (n = 0) =>
  n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(".0", "")}k` : String(Math.max(0, n));

export function timeAgo(ts) {
  const ms = millis(ts);
  if (!ms) return "ahora";
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return "ahora";
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86400) return `${Math.floor(s / 3600)} h`;
  if (s < 604800) return `${Math.floor(s / 86400)} d`;
  return new Date(ms).toLocaleDateString("es", { day: "numeric", month: "short" });
}

export function formatCountdown(ms) {
  const minutes = Math.max(1, Math.ceil(ms / 60000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days) return `${days} d ${hours} h`;
  if (hours) return `${hours} h ${mins} min`;
  return `${mins} min`;
}

let toastTimer;
export function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("is-visible"), 2800);
}

export function setLoading(button, loading) {
  button.classList.toggle("is-loading", loading);
  button.disabled = loading;
}

export function setThumb(segmented, index) {
  $(".segmented-thumb", segmented)?.style.setProperty("--index", index);
}

/* ---------- Modales (dialog nativo con animación de salida) ---------- */
export function openModal(dialog) {
  if (dialog.open) return;
  dialog.classList.remove("is-closing");
  dialog.showModal();
  dialog.focus({ preventScroll: true });
}

export function closeModal(dialog) {
  if (!dialog.open || dialog.classList.contains("is-closing")) return;
  dialog.classList.add("is-closing");
  setTimeout(() => {
    dialog.classList.remove("is-closing");
    dialog.close();
  }, 260);
}

export function initModals() {
  $$("dialog.sheet").forEach((dialog) => {
    dialog.addEventListener("cancel", (e) => {
      e.preventDefault();
      closeModal(dialog);
    });
    // Clic fuera del rectángulo del diálogo (en el fondo) cierra.
    dialog.addEventListener("click", (e) => {
      if (e.target.closest("[data-close]")) return closeModal(dialog);
      if (e.target !== dialog) return;
      const r = dialog.getBoundingClientRect();
      const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      if (!inside) closeModal(dialog);
    });
  });
}

/* ---------- Confirmación (sustituye a window.confirm) ---------- */
let confirmEl = null;

function buildConfirm() {
  confirmEl = h("dialog", { class: "sheet confirm", tabindex: "-1", "aria-labelledby": "confirm-title" },
    h("div", { class: "sheet-grabber" }),
    h("div", { class: "confirm-icon" }, svgUse("i-trash")),
    h("h2", { id: "confirm-title" }),
    h("p", { class: "confirm-message" }),
    h("div", { class: "confirm-actions" },
      h("button", { class: "ghost-btn", type: "button", dataset: { answer: "no" } }, "Cancelar"),
      h("button", { class: "primary-btn", type: "button", dataset: { answer: "yes" } }, "Confirmar")
    )
  );
  document.body.append(confirmEl);
  confirmEl.addEventListener("cancel", (e) => {
    e.preventDefault();
    closeModal(confirmEl);
  });
}

// Devuelve una promesa que se resuelve a true/false según la respuesta.
export function confirmDialog({ title, message, confirmLabel = "Confirmar", danger = true, icon = "i-trash" }) {
  if (!confirmEl) buildConfirm();
  $("#confirm-title", confirmEl).textContent = title;
  $(".confirm-message", confirmEl).textContent = message;
  $(".confirm-icon", confirmEl).replaceChildren(svgUse(icon));
  $(".confirm-icon", confirmEl).classList.toggle("danger", danger);
  const yes = $('[data-answer="yes"]', confirmEl);
  yes.textContent = confirmLabel;
  yes.classList.toggle("danger", danger);
  return new Promise((resolve) => {
    let answer = false;
    const onClick = (e) => {
      const btn = e.target.closest("[data-answer]");
      const r = confirmEl.getBoundingClientRect();
      const outside = e.target === confirmEl
        && (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom);
      if (!btn && !outside) return;
      answer = btn?.dataset.answer === "yes";
      closeModal(confirmEl);
    };
    confirmEl.addEventListener("click", onClick);
    confirmEl.addEventListener("close", () => {
      confirmEl.removeEventListener("click", onClick);
      resolve(answer);
    }, { once: true });
    openModal(confirmEl);
  });
}
