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

const DEG = Math.PI / 180;
const clampFov = (fov) => Math.max(30, Math.min(110, fov));

// Monta una escena con la foto (a-sky) o el vídeo (a-videosphere) equirectangular.
// view: { yaw, pitch, fov } en grados (portada elegida por el autor) para el encuadre inicial.
// Devuelve { media, getView, destroy }. El botón de VR de A-Frame permite entrar en modo inmersivo.
export async function mountVrScene(container, { url, type, view = null }) {
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
  camera.setAttribute("camera", `fov: ${clampFov(view?.fov || 80)}`);
  camera.setAttribute("look-controls", "reverseMouseDrag: true; touchEnabled: true; magicWindowTrackingEnabled: true");
  camera.setAttribute("wasd-controls", "enabled: false");

  scene.append(assets, sphere, camera);
  container.append(scene);
  if (type === "video") media.play?.().catch(() => {});

  // Encuadre inicial: look-controls guarda el giro en yawObject (Y) y pitchObject (X).
  const applyView = () => {
    const look = camera.components["look-controls"];
    if (!look?.yawObject) return;
    look.yawObject.rotation.y = (view?.yaw || 0) * DEG;
    look.pitchObject.rotation.x = (view?.pitch || 0) * DEG;
  };
  if (view) {
    if (scene.hasLoaded) applyView();
    else scene.addEventListener("loaded", applyView, { once: true });
  }

  // Zoom: rueda del ratón o pellizco con dos dedos ajustan el campo de visión.
  const setFov = (fov) => camera.setAttribute("camera", "fov", clampFov(fov));
  const getFov = () => Number(camera.getAttribute("camera")?.fov) || 80;
  const onWheel = (e) => {
    e.preventDefault();
    setFov(getFov() + e.deltaY * 0.05);
  };
  let pinch = null;
  const distance = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  const onTouchStart = (e) => { if (e.touches.length === 2) pinch = { d: distance(e.touches), fov: getFov() }; };
  const onTouchMove = (e) => { if (pinch && e.touches.length === 2) setFov(pinch.fov * pinch.d / distance(e.touches)); };
  const onTouchEnd = () => { pinch = null; };
  container.addEventListener("wheel", onWheel, { passive: false });
  container.addEventListener("touchstart", onTouchStart, { passive: true });
  container.addEventListener("touchmove", onTouchMove, { passive: true });
  container.addEventListener("touchend", onTouchEnd);

  return {
    media,
    // Ángulo real hacia el que mira la cámara (incluye el giroscopio en móviles).
    getView() {
      const dir = new window.THREE.Vector3();
      camera.object3D.getWorldDirection(dir); // eje +Z de la entidad: la cámara mira hacia -Z
      return {
        yaw: Math.atan2(dir.x, dir.z) / DEG,
        pitch: Math.asin(Math.max(-1, Math.min(1, -dir.y))) / DEG,
        fov: getFov()
      };
    },
    destroy() {
      container.removeEventListener("wheel", onWheel);
      container.removeEventListener("touchstart", onTouchStart);
      container.removeEventListener("touchmove", onTouchMove);
      container.removeEventListener("touchend", onTouchEnd);
      if (type === "video") {
        media.pause();
        media.removeAttribute("src");
        media.load();
      }
      scene.remove();
    }
  };
}
