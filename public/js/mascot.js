// Tux, la mascota personalizable: catálogo de ítems por hueco, condiciones de desbloqueo y render SVG
// por capas (fondo → pingüino base → ropa → accesorio → gorro). Las capas usan el sistema de
// coordenadas del PNG original (296×512); el viewBox deja margen arriba para gorros altos.
const SVG_NS = "http://www.w3.org/2000/svg";
const BASE_SRC = new URL("../img/logo.png", import.meta.url).href;

export const SLOTS = [
  { id: "hat", label: "Gorros" },
  { id: "outfit", label: "Ropa" },
  { id: "accessory", label: "Accesorios" },
  { id: "background", label: "Fondos" }
];

// need: { stat, min } — stats: completed, vr, followers, following, plans. Sin need = gratis.
export const ITEMS = [
  { id: "cap", slot: "hat", label: "Gorra Tux", emoji: "🧢" },
  { id: "beanie", slot: "hat", label: "Gorro de lana", emoji: "🧶", need: { stat: "completed", min: 1 } },
  { id: "party", slot: "hat", label: "Gorro de fiesta", emoji: "🥳", need: { stat: "plans", min: 1 } },
  { id: "crown", slot: "hat", label: "Corona", emoji: "👑", need: { stat: "completed", min: 10 } },
  { id: "scarf", slot: "outfit", label: "Bufanda", emoji: "🧣" },
  { id: "bowtie", slot: "outfit", label: "Pajarita", emoji: "🎀", need: { stat: "followers", min: 3 } },
  { id: "tshirt", slot: "outfit", label: "Camiseta Tux", emoji: "👕", need: { stat: "completed", min: 5 } },
  { id: "medal", slot: "outfit", label: "Medalla", emoji: "🏅", need: { stat: "followers", min: 10 } },
  { id: "sunglasses", slot: "accessory", label: "Gafas de sol", emoji: "🕶️" },
  { id: "flower", slot: "accessory", label: "Flor", emoji: "🌼" },
  { id: "headphones", slot: "accessory", label: "Auriculares", emoji: "🎧", need: { stat: "following", min: 3 } },
  { id: "vr", slot: "accessory", label: "Gafas VR", emoji: "🥽", need: { stat: "vr", min: 1 } },
  { id: "camera", slot: "accessory", label: "Cámara 360°", emoji: "📷", need: { stat: "vr", min: 3 } },
  { id: "ice", slot: "background", label: "Hielo", emoji: "🧊" },
  { id: "sunset", slot: "background", label: "Atardecer", emoji: "🌅", need: { stat: "completed", min: 3 } },
  { id: "night", slot: "background", label: "Noche estrellada", emoji: "🌌", need: { stat: "vr", min: 1 } },
  { id: "aurora", slot: "background", label: "Aurora", emoji: "✨", need: { stat: "followers", min: 5 } }
];

const NEED_LABELS = {
  completed: (n) => `Completa ${n} ${n === 1 ? "plan" : "planes"} con prueba`,
  vr: (n) => `Comparte ${n} ${n === 1 ? "prueba" : "pruebas"} 360°`,
  followers: (n) => `Consigue ${n} seguidores`,
  following: (n) => `Sigue a ${n} personas`,
  plans: (n) => `Publica ${n} plan`
};

export const itemById = (id) => ITEMS.find((i) => i.id === id);
export const isUnlocked = (item, stats) => !item.need || (stats?.[item.need.stat] || 0) >= item.need.min;
export const unlockHint = (item) => (item.need ? NEED_LABELS[item.need.stat](item.need.min) : "Disponible");
export const unlockedIds = (stats) => ITEMS.filter((i) => isUnlocked(i, stats)).map((i) => i.id);
export const EMPTY_EQUIPPED = { hat: "", outfit: "", accessory: "", background: "" };

/* ---------- Capas (coordenadas del PNG 296×512) ---------- */
const BACKGROUNDS = {
  ice: ["#e7f5ff", "#74c0fc"],
  sunset: ["#ffd8a8", "#ff6b35"],
  night: ["#364fc7", "#0d0d0e"],
  aurora: ["#63e6be", "#7048e8"]
};

const LAYERS = {
  cap: `<path d="M70 62 Q66 -8 148 -12 Q230 -8 226 62 Z" fill="#ff6b35"/>
    <path d="M146 52 Q236 38 290 64 Q240 78 146 66 Z" fill="#e8590c"/>
    <circle cx="148" cy="-10" r="9" fill="#e8590c"/>
    <path d="M110 24 L148 6 L186 24" stroke="#fff" stroke-width="7" fill="none" stroke-linecap="round" opacity=".85"/>`,
  beanie: `<path d="M66 66 Q64 -22 148 -22 Q232 -22 230 66 Z" fill="#38d9a9"/>
    <rect x="58" y="44" width="180" height="30" rx="14" fill="#20c997"/>
    <path d="M90 50v18M114 50v18M138 50v18M162 50v18M186 50v18M210 50v18" stroke="#12b886" stroke-width="5"/>
    <circle cx="148" cy="-32" r="20" fill="#fff"/>`,
  party: `<path d="M104 46 L148 -86 L192 46 Z" fill="#9775fa"/>
    <path d="M118 6 L178 6 M128 -26 L168 -26 M138 -56 L158 -56" stroke="#ffd43b" stroke-width="9" stroke-linecap="round"/>
    <circle cx="148" cy="-90" r="15" fill="#ffd43b"/>
    <ellipse cx="148" cy="48" rx="50" ry="9" fill="#7048e8"/>`,
  crown: `<path d="M78 46 L88 -22 L120 16 L148 -38 L176 16 L208 -22 L218 46 Z" fill="#fcc419" stroke="#f08c00" stroke-width="5" stroke-linejoin="round"/>
    <circle cx="148" cy="22" r="10" fill="#ff6b35"/><circle cx="108" cy="30" r="7" fill="#4dabf7"/><circle cx="188" cy="30" r="7" fill="#4dabf7"/>`,
  scarf: `<path d="M44 220 Q148 268 252 220 L256 252 Q148 300 40 252 Z" fill="#fa5252"/>
    <path d="M196 252 L226 346 L192 352 L174 260 Z" fill="#e03131"/>
    <path d="M70 236 Q148 270 226 236" stroke="#fff" stroke-width="6" fill="none" opacity=".7" stroke-dasharray="14 12"/>`,
  bowtie: `<path d="M148 246 L102 222 L102 272 Z" fill="#ff6b35"/><path d="M148 246 L194 222 L194 272 Z" fill="#ff6b35"/>
    <rect x="136" y="234" width="24" height="24" rx="7" fill="#e8590c"/>`,
  tshirt: `<path d="M50 246 Q148 284 246 246 L256 392 Q148 414 40 392 Z" fill="#ff6b35"/>
    <path d="M50 246 L22 300 L50 320 Z M246 246 L274 300 L246 320 Z" fill="#e8590c"/>
    <path d="M148 300 l11 22 24 3 -18 16 5 24 -22 -12 -22 12 5 -24 -18 -16 24 -3z" fill="#fff"/>`,
  medal: `<path d="M118 232 L148 300 L178 232" stroke="#4dabf7" stroke-width="14" fill="none" stroke-linejoin="round"/>
    <circle cx="148" cy="318" r="30" fill="#fcc419" stroke="#f08c00" stroke-width="6"/>
    <path d="M148 302 l6 12 13 2 -10 9 3 13 -12 -7 -12 7 3 -13 -10 -9 13 -2z" fill="#fff"/>`,
  sunglasses: `<rect x="82" y="84" width="60" height="40" rx="14" fill="#0d0d0e"/>
    <rect x="154" y="84" width="60" height="40" rx="14" fill="#0d0d0e"/>
    <path d="M142 98 Q148 92 154 98 M82 96 L60 88 M214 96 L236 88" stroke="#0d0d0e" stroke-width="6" fill="none" stroke-linecap="round"/>
    <path d="M94 94 L112 94 M166 94 L184 94" stroke="#fff" stroke-width="5" stroke-linecap="round" opacity=".5"/>`,
  flower: `<g transform="translate(222 30)"><circle r="13" cy="-16" fill="#fff"/><circle r="13" cy="16" fill="#fff"/>
    <circle r="13" cx="-16" fill="#fff"/><circle r="13" cx="16" fill="#fff"/><circle r="11" fill="#fcc419"/></g>`,
  headphones: `<path d="M58 112 Q58 -14 148 -14 Q238 -14 238 112" stroke="#343a40" stroke-width="14" fill="none"/>
    <rect x="38" y="92" width="36" height="62" rx="16" fill="#ff6b35"/><rect x="222" y="92" width="36" height="62" rx="16" fill="#ff6b35"/>`,
  vr: `<path d="M64 100 L36 96 M232 100 L260 96" stroke="#ced4da" stroke-width="10" stroke-linecap="round"/>
    <rect x="64" y="74" width="168" height="58" rx="20" fill="#f1f3f5"/>
    <rect x="76" y="84" width="144" height="38" rx="14" fill="#343a40"/>
    <path d="M90 104 L206 104" stroke="#ff6b35" stroke-width="6" stroke-linecap="round"/>`,
  camera: `<g transform="translate(206 286) rotate(-8) scale(1.3)"><rect x="0" y="0" width="46" height="84" rx="12" fill="#343a40"/>
    <circle cx="23" cy="24" r="14" fill="#212529" stroke="#868e96" stroke-width="4"/><circle cx="23" cy="24" r="5" fill="#4dabf7"/>
    <rect x="15" y="54" width="16" height="6" rx="3" fill="#ff6b35"/></g>`
};

// Devuelve un <svg> con las capas equipadas. cls se añade al elemento (p. ej. "avatar-tux").
export function mascotSvg(equipped = {}, cls = "") {
  const eq = { ...EMPTY_EQUIPPED, ...equipped };
  const bg = BACKGROUNDS[eq.background];
  const layer = (id) => (id && LAYERS[id]) || "";
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "-60 -110 416 640");
  svg.setAttribute("class", `mascot ${cls}`.trim());
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = `
    ${bg ? `<defs><linearGradient id="bg-${eq.background}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${bg[0]}"/><stop offset="1" stop-color="${bg[1]}"/></linearGradient></defs>
      <circle cx="148" cy="232" r="292" fill="url(#bg-${eq.background})"/>` : ""}
    <image href="${BASE_SRC}" x="0" y="0" width="296" height="512"/>
    ${layer(eq.outfit)}${layer(eq.accessory)}${layer(eq.hat)}`;
  return svg;
}
