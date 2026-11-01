// Utilidades de interfaz compartidas: DOM, iconos, logo, toasts y modales.
import { millis } from "../../src/activities.js";

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const SVG_NS = "http://www.w3.org/2000/svg";
export const LOGO_SRC = "./img/logo.png";

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
