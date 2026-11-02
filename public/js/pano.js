// Miniaturas panorámicas 360° (feed, perfiles, Galería VR) apuntando a la portada elegida por el autor.
// Un único contexto WebGL compartido dibuja la proyección rectilínea y se copia a un <canvas> 2D por
// tarjeta: así caben decenas de miniaturas sin agotar el límite de contextos WebGL del navegador.
// La orientación coincide con la del visor A-Frame (a-sky con rotación 0 -90 0 y look-controls).
const MAX_TEXTURES = 8;
const DEG = Math.PI / 180;

let gl = null;
let glCanvas = null;
let uniforms = null;
let unsupported = false;
const textures = new Map(); // src → Promise<WebGLTexture>

const VERTEX = `
attribute vec2 a_pos;
varying vec2 v_pos;
void main() { v_pos = a_pos; gl_Position = vec4(a_pos, 0.0, 1.0); }`;

// Rayo de cámara → (pitch en X, yaw en Y) → coordenadas equirectangulares (u: longitud, v: latitud).
const FRAGMENT = `
precision highp float;
uniform sampler2D u_tex;
uniform float u_aspect, u_tan, u_yaw, u_pitch;
varying vec2 v_pos;
void main() {
  vec3 r = normalize(vec3(v_pos.x * u_aspect * u_tan, v_pos.y * u_tan, -1.0));
  float cp = cos(u_pitch), sp = sin(u_pitch);
  r = vec3(r.x, r.y * cp - r.z * sp, r.y * sp + r.z * cp);
  float cy = cos(u_yaw), sy = sin(u_yaw);
  r = vec3(r.x * cy + r.z * sy, r.y, -r.x * sy + r.z * cy);
  float u = fract(atan(-r.x, r.z) / 6.28318530718);
  float v = acos(clamp(r.y, -1.0, 1.0)) / 3.14159265359;
  gl_FragColor = texture2D(u_tex, vec2(u, v));
}`;

function initGl() {
  if (gl || unsupported) return gl;
  glCanvas = document.createElement("canvas");
  gl = glCanvas.getContext("webgl", { preserveDrawingBuffer: true, antialias: false, premultipliedAlpha: false });
  if (!gl) {
    unsupported = true;
    return null;
  }
  const compile = (type, src) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    return shader;
  };
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    unsupported = true;
    gl = null;
    return null;
  }
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const pos = gl.getAttribLocation(program, "a_pos");
  gl.enableVertexAttribArray(pos);
  gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
  uniforms = Object.fromEntries(["u_aspect", "u_tan", "u_yaw", "u_pitch"].map((n) => [n, gl.getUniformLocation(program, n)]));
  return gl;
}

// Carga la imagen (CORS) y la reduce al tamaño de textura admitido por la GPU.
function loadTexture(src) {
  if (textures.has(src)) {
    const hit = textures.get(src);
    textures.delete(src);
    textures.set(src, hit); // LRU
    return hit;
  }
  const promise = new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => {
      const limit = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), 4096);
      let source = img;
      if (img.naturalWidth > limit) {
        const c = document.createElement("canvas");
        c.width = limit;
        c.height = Math.round(limit * img.naturalHeight / img.naturalWidth);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        source = c;
      }
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      resolve(tex);
    };
    img.onerror = () => reject(new Error("No se pudo cargar la imagen 360°."));
    img.src = src;
  });
  promise.catch(() => textures.delete(src));
  textures.set(src, promise);
  while (textures.size > MAX_TEXTURES) {
    const [oldest, old] = textures.entries().next().value;
    textures.delete(oldest);
    old.then((tex) => gl.deleteTexture(tex)).catch(() => {});
  }
  return promise;
}

export const DEFAULT_VIEW = { yaw: 0, pitch: 0, fov: 80 };
const normalizeView = (v) => ({ ...DEFAULT_VIEW, ...(v || {}) });

function draw(target, tex, view) {
  const w = target.width;
  const h = target.height;
  if (!w || !h) return;
  glCanvas.width = w;
  glCanvas.height = h;
  gl.viewport(0, 0, w, h);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.uniform1f(uniforms.u_aspect, w / h);
  gl.uniform1f(uniforms.u_tan, Math.tan((view.fov * DEG) / 2));
  gl.uniform1f(uniforms.u_yaw, view.yaw * DEG);
  gl.uniform1f(uniforms.u_pitch, view.pitch * DEG);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  target.getContext("2d").drawImage(glCanvas, 0, 0);
}

// Monta una miniatura 360° en `container`. Se dibuja al entrar en pantalla.
// interactive: arrastrar para mirar alrededor (horizontal en táctil, libre con ratón).
// Devuelve el <canvas> o null si no hay WebGL (el llamador muestra un <img>).
export function mountPanoThumb(container, { src, view, interactive = false, onTap } = {}) {
  if (!initGl()) return null;
  const canvas = document.createElement("canvas");
  canvas.className = `pano-thumb${interactive ? " is-interactive" : ""}`;
  const state = { view: normalizeView(view), tex: null, frame: 0 };

  const render = () => {
    state.frame = 0;
    if (!state.tex || !canvas.isConnected) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(canvas.clientWidth * dpr);
    const h = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    draw(canvas, state.tex, state.view);
  };
  const schedule = () => { state.frame ||= requestAnimationFrame(render); };

  const visible = new IntersectionObserver((entries) => {
    if (!entries.some((e) => e.isIntersecting)) return;
    visible.disconnect();
    loadTexture(src).then((tex) => {
      state.tex = tex;
      canvas.classList.add("is-loaded");
      schedule();
    }).catch(() => canvas.dispatchEvent(new Event("error")));
  }, { rootMargin: "200px" });
  visible.observe(canvas);
  new ResizeObserver(schedule).observe(canvas);

  let drag = null;
  canvas.addEventListener("pointerdown", (e) => {
    drag = { x: e.clientX, y: e.clientY, moved: 0, mouse: e.pointerType === "mouse", view: { ...state.view } };
    if (interactive && drag.mouse) canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!drag || !interactive) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    drag.moved = Math.max(drag.moved, Math.hypot(dx, dy));
    const perPx = state.view.fov / Math.max(1, canvas.clientHeight);
    state.view.yaw = ((drag.view.yaw + dx * perPx + 540) % 360) - 180;
    if (drag.mouse) state.view.pitch = Math.max(-85, Math.min(85, drag.view.pitch + dy * perPx));
    schedule();
  });
  const end = () => {
    if (drag && drag.moved < 8) onTap?.({ ...state.view });
    drag = null;
  };
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", () => { drag = null; });

  container.append(canvas);
  return canvas;
}
