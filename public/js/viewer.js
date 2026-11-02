// Visor multimedia compartido (app y /admin). Si el contenido es 360° —por marca guardada o porque
// al cargarlo resulta ser equirectangular 2:1— se abre SIEMPRE el visor inmersivo 360°/VR.
import { $, h, svgUse, toast, openModal, closeModal } from "./ui.js";
import { mountVrScene } from "./vr.js";
import { isEquirectangular } from "../../src/media.js";

let session = null;
let token = 0;
let modal, stage, soundBtn, loading, actionsBox, coverBtn;

export function initViewer() {
  modal = $("#viewer-modal");
  stage = $("#viewer-stage");
  soundBtn = $("#viewer-sound");
  loading = $("#viewer-loading");
  // Acciones opcionales sobre el contenido (ver perfil del autor, responder…).
  actionsBox = h("div", { class: "viewer-actions" });
  soundBtn.before(actionsBox);
  // Botón flotante del autor: fija el ángulo actual como portada de la publicación 360°.
  coverBtn = h("button", { class: "viewer-cover-btn", type: "button", hidden: true }, svgUse("i-image"), "Fijar como portada");
  modal.append(coverBtn);
  modal.addEventListener("close", () => {
    token++;
    session?.destroy();
    session = null;
    stage.replaceChildren();
  });
}

function setSoundIcon(muted) {
  soundBtn.replaceChildren(svgUse(muted ? "i-mute" : "i-volume"));
  soundBtn.setAttribute("aria-label", muted ? "Activar sonido" : "Silenciar");
}

// Lee las dimensiones reales del archivo remoto (sin descargar el vídeo entero).
function probeRemote(url, type) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 8000);
    const done = (dims) => {
      clearTimeout(timer);
      resolve(dims);
    };
    if (type === "video") {
      const v = document.createElement("video");
      v.preload = "metadata";
      v.muted = true;
      v.crossOrigin = "anonymous";
      v.onloadedmetadata = () => done({ width: v.videoWidth, height: v.videoHeight });
      v.onerror = () => done(null);
      v.src = url;
    } else {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => done({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => done(null);
      img.src = url;
    }
  });
}

// actions: [{ icon, label, onClick }] — botones bajo el título (el visor se cierra al pulsarlos).
// view: encuadre inicial 360° { yaw, pitch, fov }. onSetCover(view): si se indica, el visor muestra
// «Fijar como portada» en modo inmersivo y entrega el ángulo actual de la cámara.
export async function openViewer({ url, type = "image", is360 = false, title = "", sub = "", actions = [], view = null, onSetCover = null }) {
  const current = ++token;
  session?.destroy();
  session = null;
  stage.replaceChildren();
  $("#viewer-title").textContent = title;
  $("#viewer-sub").textContent = sub;
  actionsBox.replaceChildren(...actions.map((a) => h("button", {
    class: "viewer-action", type: "button",
    onclick: () => {
      closeModal(modal);
      a.onClick();
    }
  }, svgUse(a.icon), a.label)));
  $("#viewer-badge").hidden = true;
  coverBtn.hidden = true;
  soundBtn.hidden = type !== "video";
  setSoundIcon(true);
  openModal(modal);
  loading.hidden = false;

  // Detección en reproducción: un archivo 2:1 sin marcar también se abre en 360°.
  let immersive = is360;
  if (!immersive) {
    const dims = await probeRemote(url, type);
    if (current !== token) return;
    immersive = Boolean(dims && isEquirectangular(dims.width, dims.height));
  }
  $("#viewer-badge").hidden = !immersive;

  let media;
  try {
    if (immersive) {
      const created = await mountVrScene(stage, { url, type, view });
      if (current !== token || !modal.open) return created.destroy();
      session = created;
      media = created.media;
      if (onSetCover) {
        coverBtn.hidden = false;
        coverBtn.onclick = async () => {
          coverBtn.disabled = true;
          try {
            await onSetCover(created.getView());
            toast("Portada fijada · así se verá en el feed");
          } catch (err) {
            console.error(err);
            toast("No se pudo guardar la portada.");
          } finally {
            coverBtn.disabled = false;
          }
        };
      }
    } else {
      media = type === "video"
        ? h("video", { src: url, autoplay: true, loop: true, playsinline: true, controls: true })
        : h("img", { src: url, alt: title });
      if (type === "video") media.muted = true;
      stage.append(media);
    }
  } catch (err) {
    console.error(err);
    toast(err.message || "No se pudo abrir el visor.");
    closeModal(modal);
    return;
  } finally {
    if (current === token) loading.hidden = true;
  }

  soundBtn.onclick = () => {
    if (!media || media.tagName !== "VIDEO") return;
    media.muted = !media.muted;
    if (!media.muted) media.play?.().catch(() => {});
    setSoundIcon(media.muted);
  };
}
