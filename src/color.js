// OKLab/OKLCH color math, sequential & diverging ramps, CVD simulation.

// ---- sRGB <-> linear ----
const toLin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const toSrgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
const clamp01 = (x) => Math.min(1, Math.max(0, x));

export function hexToRgb(hex) {
  const h = hex.replace("#", "").trim();
  const n = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return [parseInt(n.slice(0, 2), 16) / 255, parseInt(n.slice(2, 4), 16) / 255, parseInt(n.slice(4, 6), 16) / 255];
}
export function rgbToHex([r, g, b]) {
  const f = (x) => Math.round(clamp01(x) * 255).toString(16).padStart(2, "0");
  return "#" + f(r) + f(g) + f(b);
}

// ---- OKLab (Ottosson) ----
export function rgbToOklab([r, g, b]) {
  const R = toLin(r), G = toLin(g), B = toLin(b);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
export function oklabToRgb([L, a, bb]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * bb) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * bb) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * bb) ** 3;
  return [
    toSrgb(+4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    toSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    toSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}
export const oklabToOklch = ([L, a, b]) => [L, Math.hypot(a, b), (Math.atan2(b, a) * 180) / Math.PI];
export const oklchToOklab = ([L, C, h]) => [L, C * Math.cos((h * Math.PI) / 180), C * Math.sin((h * Math.PI) / 180)];
export const hexToOklch = (hex) => oklabToOklch(rgbToOklab(hexToRgb(hex)));

const inGamut = ([r, g, b]) => r >= -1e-4 && r <= 1.0001 && g >= -1e-4 && g <= 1.0001 && b >= -1e-4 && b <= 1.0001;

// Reduce chroma until the color fits sRGB, holding L and hue.
export function oklchToHex([L, C, h]) {
  let lo = 0, hi = C, rgb = oklabToRgb(oklchToOklab([L, C, h]));
  if (inGamut(rgb)) return rgbToHex(rgb);
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    rgb = oklabToRgb(oklchToOklab([L, mid, h]));
    if (inGamut(rgb)) lo = mid; else hi = mid;
  }
  return rgbToHex(oklabToRgb(oklchToOklab([L, lo, h])));
}

// ---- contrast & distance ----
const relLum = ([r, g, b]) => 0.2126 * toLin(r) + 0.7152 * toLin(g) + 0.0722 * toLin(b);
export function contrast(hexA, hexB) {
  const a = relLum(hexToRgb(hexA)), b = relLum(hexToRgb(hexB));
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
export function deltaE(hexA, hexB) {
  const a = rgbToOklab(hexToRgb(hexA)), b = rgbToOklab(hexToRgb(hexB));
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) * 100;
}

// ---- CVD simulation (Machado-Oliveira-Fernandes 2009, severity 1.0) ----
const CVD = {
  protanopia: [0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998],
  deuteranopia: [0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.01182, 0.04294, 0.968881],
  tritanopia: [1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733, 0.691367, 0.3039],
};
export function simulateCVD(hex, kind) {
  const m = CVD[kind];
  if (!m) return hex;
  const [r, g, b] = hexToRgb(hex).map(toLin);
  const out = [m[0] * r + m[1] * g + m[2] * b, m[3] * r + m[4] * g + m[5] * b, m[6] * r + m[7] * g + m[8] * b];
  return rgbToHex(out.map((c) => toSrgb(clamp01(c))));
}

// ---- ramps ----
// Documented blue sequential ramp (steps 100 -> 700). Its L/C trajectory is the
// template every other hue reuses, so all ramps are monotone-light by construction.
export const BLUE_RAMP = [
  "#cde2fb", "#b7d3f6", "#9ec5f4", "#86b6ef", "#6da7ec", "#5598e7", "#3987e5",
  "#2a78d6", "#256abf", "#1c5cab", "#184f95", "#104281", "#0d366b",
];
const TEMPLATE = BLUE_RAMP.map(hexToOklch); // [L, C, h] per step

// Hue anchors taken from the categorical palette slots.
export const HUES = {
  blue: { label: "蓝 Blue", h: hexToOklch("#2a78d6")[2] },
  orange: { label: "橙 Orange", h: hexToOklch("#eb6834")[2] },
  teal: { label: "青 Teal", h: hexToOklch("#1baf7a")[2] },
  violet: { label: "紫 Violet", h: hexToOklch("#4a3aa7")[2] },
  green: { label: "绿 Green", h: hexToOklch("#008300")[2] },
  red: { label: "红 Red", h: hexToOklch("#e34948")[2] },
  magenta: { label: "品红 Magenta", h: hexToOklch("#e87ba4")[2] },
};

// Sample n colors from the template trajectory at a given hue.
// lo/hi are positions in 0..1 along the 100->700 range.
function rampAt(hueKey, n, lo = 0, hi = 1) {
  if (n === 1) n = 2;
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = lo + ((hi - lo) * i) / (n - 1);
    const p = t * (TEMPLATE.length - 1);
    const i0 = Math.floor(p), i1 = Math.min(TEMPLATE.length - 1, i0 + 1), f = p - i0;
    const L = TEMPLATE[i0][0] + (TEMPLATE[i1][0] - TEMPLATE[i0][0]) * f;
    const C = TEMPLATE[i0][1] + (TEMPLATE[i1][1] - TEMPLATE[i0][1]) * f;
    out.push(hueKey === "blue" ? nearestBlue(p) : oklchToHex([L, C, HUES[hueKey].h]));
  }
  return out;
}
// Blue returns the documented hexes verbatim where a step lands on one.
function nearestBlue(p) {
  const i = Math.round(p);
  if (Math.abs(p - i) < 1e-9) return BLUE_RAMP[i];
  const i0 = Math.floor(p), i1 = Math.min(TEMPLATE.length - 1, i0 + 1), f = p - i0;
  const a = TEMPLATE[i0], b = TEMPLATE[i1];
  return oklchToHex([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, HUES.blue.h]);
}

export const MID = { light: "#f0efec", dark: "#383835" };

/**
 * Build the class colors for a scale.
 * mode: "light" | "dark" — dark flips the anchor (low value sits near the surface).
 */
export function buildRamp({ kind, hue = "blue", hue2 = "red", n = 5, mode = "light", reverse = false }) {
  let colors;
  if (kind === "diverging") {
    const half = Math.floor(n / 2);
    const odd = n % 2 === 1;
    // Light surface: poles dark, fading to a neutral mid. Dark surface: poles bright.
    const [near, far] = mode === "dark" ? [0.62, 0.06] : [0.22, 0.94];
    const lowArm = rampAt(hue, half + 1, near, far).slice(1).reverse(); // pole -> midpoint
    const highArm = rampAt(hue2, half + 1, near, far).slice(1); // midpoint -> pole
    colors = [...lowArm, ...(odd ? [MID[mode]] : []), ...highArm];
  } else {
    colors = mode === "dark" ? rampAt(hue, n, 0.95, 0.02) : rampAt(hue, n, 0.02, 0.95);
  }
  if (reverse) colors = colors.slice().reverse();
  return colors;
}

// Continuous interpolator over the same trajectory.
export function rampInterpolator({ kind, hue = "blue", hue2 = "red", mode = "light", reverse = false }) {
  const steps = buildRamp({ kind, hue, hue2, n: 11, mode, reverse });
  const labs = steps.map((h) => rgbToOklab(hexToRgb(h)));
  return (t) => {
    const p = Math.min(1, Math.max(0, t)) * (labs.length - 1);
    const i0 = Math.floor(p), i1 = Math.min(labs.length - 1, i0 + 1), f = p - i0;
    const c = [0, 1, 2].map((k) => labs[i0][k] + (labs[i1][k] - labs[i0][k]) * f);
    return rgbToHex(oklabToRgb(c).map(clamp01));
  };
}
