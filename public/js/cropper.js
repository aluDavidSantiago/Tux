// Recorte cuadrado de la foto de perfil: arrastrar para encuadrar, deslizador (o pellizco/rueda)
// para el zoom. Devuelve un JPG de 512×512 listo para guardarse como users/{uid}/avatar.jpg.
import { h, svgUse, openModal, closeModal } from "./ui.js";

const OUTPUT = 512;
let dialog = null;

function build() {
  dialog = h("dialog", { class: "sheet cropper", tabindex: "-1", "aria-labelledby": "crop-title" },
    h("div", { class: "sheet-grabber" }),
    h("header", { class: "sheet-header" },
      h("button", { class: "link-btn", type: "button", dataset: { answer: "no" } }, "Cancelar"),
      h("h2", { id: "crop-title", text: "Recortar foto" }),
      h("button", { class: "link-btn strong", type: "button", dataset: { answer: "yes" } }, "Usar")
    ),
    h("div", { class: "crop-stage" }, h("img", { class: "crop-img", alt: "", draggable: "false" }), h("div", { class: "crop-ring" })),
    h("label", { class: "crop-zoom" }, svgUse("i-image", "icon small"),
      h("input", { type: "range", min: "1", max: "4", step: "0.01", value: "1", "aria-label": "Zoom" }),
      svgUse("i-image"))
  );
  dialog.addEventListener("cancel", (e) => {
    e.preventDefault();
    closeModal(dialog);
  });
  document.body.append(dialog);
}

export function cropImage(file) {
  if (!dialog) build();
  const stage = dialog.querySelector(".crop-stage");
  const img = dialog.querySelector(".crop-img");
  const zoom = dialog.querySelector("input[type=range]");
  const url = URL.createObjectURL(file);
  const st = { scale: 1, x: 0, y: 0, base: 1 };

  // El lado corto de la imagen cubre el marco con zoom 1; x/y es el desplazamiento del centro.
  const size = () => stage.clientWidth;
  const clamp = () => {
    const s = st.base * st.scale;
    const maxX = Math.max(0, (img.naturalWidth * s - size()) / 2);
    const maxY = Math.max(0, (img.naturalHeight * s - size()) / 2);
    st.x = Math.max(-maxX, Math.min(maxX, st.x));
    st.y = Math.max(-maxY, Math.min(maxY, st.y));
  };
  const paint = () => {
    clamp();
    const s = st.base * st.scale;
    img.style.width = `${img.naturalWidth * s}px`;
    img.style.transform = `translate(calc(-50% + ${st.x}px), calc(-50% + ${st.y}px))`;
  };

  return new Promise((resolve) => {
    let result = null;
    const pointers = new Map();
    let pinch = null;
    const onDown = (e) => {
      stage.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), scale: st.scale };
      }
    };
    const onMove = (e) => {
      const prev = pointers.get(e.pointerId);
      if (!prev) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2 && pinch) {
        const [a, b] = [...pointers.values()];
        st.scale = Math.max(1, Math.min(4, pinch.scale * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d));
        zoom.value = st.scale;
      } else if (pointers.size === 1) {
        st.x += e.clientX - prev.x;
        st.y += e.clientY - prev.y;
      }
      paint();
    };
    const onUp = (e) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
    };
    const onWheel = (e) => {
      e.preventDefault();
      st.scale = Math.max(1, Math.min(4, st.scale - e.deltaY * 0.002));
      zoom.value = st.scale;
      paint();
    };
    const onZoom = () => {
      st.scale = Number(zoom.value);
      paint();
    };
    const onClick = async (e) => {
      const btn = e.target.closest("[data-answer]");
      if (!btn) return;
      if (btn.dataset.answer === "yes") result = await render();
      closeModal(dialog);
    };
    // Recorta en un lienzo de 512×512 la zona visible del marco.
    const render = () => {
      const s = st.base * st.scale;
      const side = size() / s;
      const sx = img.naturalWidth / 2 - st.x / s - side / 2;
      const sy = img.naturalHeight / 2 - st.y / s - side / 2;
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = OUTPUT;
      const ctx = canvas.getContext("2d");
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, sx, sy, side, side, 0, 0, OUTPUT, OUTPUT);
      return new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.88));
    };

    stage.addEventListener("pointerdown", onDown);
    stage.addEventListener("pointermove", onMove);
    stage.addEventListener("pointerup", onUp);
    stage.addEventListener("pointercancel", onUp);
    stage.addEventListener("wheel", onWheel, { passive: false });
    zoom.addEventListener("input", onZoom);
    dialog.addEventListener("click", onClick);
    dialog.addEventListener("close", () => {
      stage.removeEventListener("pointerdown", onDown);
      stage.removeEventListener("pointermove", onMove);
      stage.removeEventListener("pointerup", onUp);
      stage.removeEventListener("pointercancel", onUp);
      stage.removeEventListener("wheel", onWheel);
      zoom.removeEventListener("input", onZoom);
      dialog.removeEventListener("click", onClick);
      URL.revokeObjectURL(url);
      resolve(result);
    }, { once: true });

    img.onload = () => {
      openModal(dialog);
      requestAnimationFrame(() => {
        st.base = size() / Math.min(img.naturalWidth, img.naturalHeight);
        zoom.value = 1;
        paint();
      });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    Object.assign(st, { scale: 1, x: 0, y: 0 });
    img.src = url;
  });
}
