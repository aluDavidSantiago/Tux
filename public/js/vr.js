// Visor inmersivo 360°/VR con A-Frame (WebXR). Se carga bajo demanda la primera vez.
const AFRAME_SRC = "https://aframe.io/releases/1.6.0/aframe.min.js";
let aframeLoading = null;

function loadAframe() {
  if (window.AFRAME) return Promise.resolve();
  aframeLoading ||= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = AFRAME_SRC;
    script.onload = resolve;
    script.onerror = () => {
      aframeLoading = null;
      reject(new Error("No se pudo cargar el visor VR."));
    };
    document.head.append(script);
  });
  return aframeLoading;
}

// Monta una escena con la foto (a-sky) o el vídeo (a-videosphere) equirectangular.
// Devuelve { media, destroy }. El botón de VR de A-Frame permite entrar en modo inmersivo.
export async function mountVrScene(container, { url, type }) {
  await loadAframe();
  const mediaId = `vr-media-${Date.now()}`;
  const scene = document.createElement("a-scene");
  scene.setAttribute("embedded", "");
  scene.setAttribute("vr-mode-ui", "enabled: true");
  scene.setAttribute("loading-screen", "enabled: false");
  scene.setAttribute("device-orientation-permission-ui", "enabled: true");
  scene.setAttribute("renderer", "colorManagement: true; antialias: true");

  const assets = document.createElement("a-assets");
  assets.setAttribute("timeout", "30000");
  let media;
  if (type === "video") {
    media = document.createElement("video");
    media.crossOrigin = "anonymous";
    media.loop = true;
    media.muted = true;
    media.playsInline = true;
    media.autoplay = true;
    media.setAttribute("playsinline", "");
    media.setAttribute("webkit-playsinline", "");
  } else {
    media = document.createElement("img");
    media.crossOrigin = "anonymous";
  }
  media.id = mediaId;
  media.src = url;
  assets.append(media);

  const sphere = document.createElement(type === "video" ? "a-videosphere" : "a-sky");
  sphere.setAttribute("src", `#${mediaId}`);
  sphere.setAttribute("rotation", "0 -90 0");

  const camera = document.createElement("a-entity");
  camera.setAttribute("camera", "fov: 80");
  camera.setAttribute("look-controls", "reverseMouseDrag: true; touchEnabled: true; magicWindowTrackingEnabled: true");
  camera.setAttribute("wasd-controls", "enabled: false");

  scene.append(assets, sphere, camera);
  container.append(scene);
  if (type === "video") media.play?.().catch(() => {});

  return {
    media,
    destroy() {
      if (type === "video") {
        media.pause();
        media.removeAttribute("src");
        media.load();
      }
      scene.remove();
    }
  };
}
