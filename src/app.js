import { buildRamp, rampInterpolator, HUES, simulateCVD, contrast } from "./color.js";
import { computeBreaks, classify, makeFormatter } from "./scales.js";
import { parseTable, guessColumns, toNumber } from "./parse.js";
import { buildIndex, joinRows, resolve } from "./match.js";
import { SAMPLES } from "./samples.js";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const el = (tag, attrs = {}, ...kids) => {
  const n = tag === "svg" || tag === "path" || tag === "g" || tag === "text" || tag === "rect"
    ? document.createElementNS("http://www.w3.org/2000/svg", tag)
    : document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") n.setAttribute("class", v);
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (k === "html") n.innerHTML = v;
    else n.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null) n.append(kid.nodeType ? kid : document.createTextNode(kid));
  return n;
};

// ---------------------------------------------------------------- map defs
const MAPS = {
  "us-states": {
    label: "美国各州 US states",
    file: "data/us-states-10m.json", object: "states", outline: "nation",
    regions: "data/regions-us-states.json", idWidth: 2,
    projected: true, viewBox: [0, 0, 975, 610], keyHint: "州名 / 缩写，如 California、CA、加利福尼亚",
  },
  "us-counties": {
    label: "美国各县 US counties",
    file: "data/us-counties-10m.json", object: "counties", outline: "states",
    regions: "data/regions-us-counties.json", idWidth: 5,
    projected: true, viewBox: [0, 0, 975, 610], keyHint: "5 位 FIPS 或 “Dane, WI”",
  },
  world: {
    label: "世界各国 World",
    file: "data/world-countries-50m.json", object: "countries", outline: null,
    regions: "data/regions-world.json", idWidth: 3,
    projected: false, viewBox: [0, 0, 960, 500], keyHint: "国名 / ISO 代码，如 China、CN、CHN、中国",
  },
};
const PROJECTIONS = {
  equalEarth: { label: "等积 Equal Earth", fn: () => d3.geoEqualEarth() },
  naturalEarth: { label: "自然地球 Natural Earth", fn: () => d3.geoNaturalEarth1() },
  robinson: { label: "等距圆柱 Equirectangular", fn: () => d3.geoEquirectangular() },
  mercator: { label: "墨卡托 Mercator", fn: () => d3.geoMercator() },
};
const METHODS = {
  quantile: "分位数 Quantile",
  jenks: "自然断点 Jenks",
  equal: "等距 Equal interval",
  log: "对数 Log",
  diverging: "对称分位 Symmetric quantile",
  divergingEqual: "对称等距 Symmetric equal",
};

// ---------------------------------------------------------------- state
const DEFAULTS = {
  map: "us-states",
  raw: "",
  sample: "us-gdp",
  keyIndex: 0,
  valueIndex: 1,
  kind: "sequential",
  hue: "blue",
  hue2: "red",
  method: "quantile",
  bins: 5,
  continuous: false,
  reverse: false,
  center: 0,
  fmtStyle: "auto",
  decimals: "",
  unit: "",
  labels: "auto",
  cvd: "none",
  theme: "auto",
  projection: "equalEarth",
  hideAntarctica: true,
  title: "",
  subtitle: "",
  source: "",
};
let S = { ...DEFAULTS };
const geoCache = new Map();
let geo = null;      // { features, outline, index }
let view = null;     // derived render data
let selected = null;

const save = () => { try { localStorage.setItem("datamap.v1", JSON.stringify(S)); } catch {} };
const load = () => {
  try {
    const j = JSON.parse(localStorage.getItem("datamap.v1") || "null");
    if (j && typeof j === "object") S = { ...DEFAULTS, ...j };
  } catch {}
};

const effMode = () =>
  S.theme === "auto" ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : S.theme;

// ---------------------------------------------------------------- data load
async function ensureGeo() {
  const def = MAPS[S.map];
  if (geoCache.has(S.map)) { geo = geoCache.get(S.map); return; }
  setStatus("加载地图数据…", "");
  const [topo, regions] = await Promise.all([
    fetch(def.file).then((r) => r.json()),
    fetch(def.regions).then((r) => r.json()),
  ]);
  const fc = topojson.feature(topo, topo.objects[def.object]);
  const outline = def.outline
    ? topojson.mesh(topo, topo.objects[def.outline], (a, b) => a !== b || def.outline === "nation")
    : null;
  const g = {
    features: fc.features.map((f) => ({ ...f, id: f.id == null ? "x-" + (f.properties?.name || "").toLowerCase().replace(/[^a-z]+/g, "-") : String(f.id) })),
    outline,
    index: buildIndex(regions, { idWidth: def.idWidth }),
    regions,
  };
  geoCache.set(S.map, g);
  geo = g;
}

/**
 * Pasting state names while the world map is showing should just work: score the
 * key column against every basemap and switch if another one clearly wins.
 * Returns the winning map key, or null when the current one is fine.
 */
async function detectMap(parsed, keyIndex) {
  if (!parsed.rows.length) return null;
  const probe = parsed.rows.slice(0, 80).map((r) => r[keyIndex]).filter((k) => k != null && String(k).trim() !== "");
  if (probe.length < 3) return null;
  const score = async (key) => {
    if (geoCache.has(key)) indexCache.set(key, geoCache.get(key).index);
    else if (!indexCache.has(key)) {
      const def = MAPS[key];
      const regions = await fetch(def.regions).then((r) => r.json());
      indexCache.set(key, buildIndex(regions, { idWidth: def.idWidth }));
    }
    const idx = indexCache.get(key);
    return probe.filter((p) => resolve(idx, p).id).length / probe.length;
  };
  const scores = {};
  for (const key of Object.keys(MAPS)) scores[key] = await score(key);
  const mine = scores[S.map];
  const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  // Only switch on a decisive win, so a partly-matching dataset is never yanked away.
  if (best[0] !== S.map && best[1] >= 0.6 && best[1] > mine + 0.3) return best[0];
  return null;
}
const indexCache = new Map();
let autoNote = "";

/** Paste / upload entry point: re-guess columns, auto-pick the basemap, re-render. */
async function onDataChanged() {
  const parsed = parseTable(S.raw);
  const g = parsed.columns.length ? guessColumns(parsed) : { keyIndex: 0, valueIndex: 1 };
  let target = null;
  try { target = await detectMap(parsed, g.keyIndex); } catch {}
  if (target) {
    S.map = target;
    selected = null;
    $("#mapSel").value = target;
    await ensureGeo();
    autoNote = `已自动切换到「${MAPS[target].label}」`;
  } else autoNote = "";
  S._autoCols = true;
  refresh();
}

// ---------------------------------------------------------------- pipeline
function compute() {
  const parsed = parseTable(S.raw);
  const cols = parsed.columns.length;
  let ki = Math.min(S.keyIndex, Math.max(0, cols - 1));
  let vi = Math.min(S.valueIndex, Math.max(0, cols - 1));
  if (S._autoCols && cols) {
    const g = guessColumns(parsed);
    ki = g.keyIndex; vi = g.valueIndex;
    S.keyIndex = ki; S.valueIndex = vi; S._autoCols = false;
  }
  const join = joinRows(geo.index, parsed.rows, ki, vi);
  const values = [...join.values.values()].filter(Number.isFinite);
  const { breaks, min, max, note } = computeBreaks(values, {
    method: S.method,
    n: +S.bins,
    center: +S.center || 0,
  });
  const n = Math.max(2, breaks.length - 1);
  const mode = effMode();
  const colors = buildRamp({ kind: S.kind, hue: S.hue, hue2: S.hue2, n, mode, reverse: S.reverse });
  const interp = rampInterpolator({ kind: S.kind, hue: S.hue, hue2: S.hue2, mode, reverse: S.reverse });
  const fmtOpts = { style: S.fmtStyle, decimals: S.decimals === "" ? null : +S.decimals, values };
  const fmt = makeFormatter({ ...fmtOpts, unit: S.unit });
  // Legend ticks drop the unit — it already sits in the legend title, and
  // repeating it on every tick makes adjacent labels collide.
  const fmtTick = makeFormatter(fmtOpts);

  const colorOf = (v) => {
    if (!Number.isFinite(v)) return null;
    if (S.continuous) {
      if (max === min) return interp(0.5);
      let t = (v - min) / (max - min);
      if (S.kind === "diverging") {
        const span = Math.max(Math.abs(max - (+S.center || 0)), Math.abs(min - (+S.center || 0))) || 1;
        t = (v - (+S.center || 0)) / (2 * span) + 0.5;
      }
      return interp(t);
    }
    const i = classify(v, breaks);
    return i < 0 ? null : colors[Math.min(i, colors.length - 1)];
  };

  view = { parsed, join, values, breaks, colors, interp, fmt, fmtTick, min, max, note, colorOf, mode };
}

// ---------------------------------------------------------------- render map
function renderMap() {
  const def = MAPS[S.map];
  const host = $("#mapWrap");
  const [, , VW, VH] = def.viewBox;
  const svg = el("svg", { id: "map", viewBox: `0 0 ${VW} ${VH}`, role: "img", preserveAspectRatio: "xMidYMid meet" });
  svg.setAttribute("aria-label", (S.title || "数据地图") + "：" + describeForSR());

  let path, feats = geo.features;
  if (def.projected) {
    path = d3.geoPath();
  } else {
    if (S.hideAntarctica) feats = feats.filter((f) => f.id !== "010");
    const proj = PROJECTIONS[S.projection].fn();
    proj.fitExtent([[8, 8], [VW - 8, VH - 8]], { type: "FeatureCollection", features: feats });
    path = d3.geoPath(proj);
    svg.append(el("path", { class: "sphere", d: path({ type: "Sphere" }) }));
  }

  const g = el("g", { class: "regions" });
  const na = getCss("--nodata");
  const cvd = (hex) => (S.cvd === "none" ? hex : simulateCVD(hex, S.cvd));
  for (const f of feats) {
    const v = view.join.values.get(f.id);
    const c = view.colorOf(v);
    const p = el("path", {
      class: "region hit" + (selected === f.id ? " sel" : ""),
      d: path(f) || "",
      fill: cvd(c || na),
      "data-id": f.id,
    });
    p.__f = f;
    g.append(p);
  }
  svg.append(g);
  if (geo.outline) svg.append(el("path", { class: "outline", d: path(geo.outline) }));

  // Selective direct labels: only where the shape holds the text AND nothing is
  // already there. Biggest shapes claim their label first.
  if (S.labels !== "none") {
    const lg = el("g", { class: "labels" });
    const placed = [];
    const overlaps = (a) => placed.some((b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0);
    const cands = [];
    for (const f of feats) {
      const v = view.join.values.get(f.id);
      if (S.labels === "value" && !Number.isFinite(v)) continue;
      const short = shortLabel(geo.index.byId.get(f.id), f);
      if (!short) continue;
      const b = path.bounds(f);
      const w = b[1][0] - b[0][0], h = b[1][1] - b[0][1];
      if (!Number.isFinite(w)) continue;
      // Real projected ink, not the bounding box: a scattered archipelago
      // (Micronesia, French Polynesia) has a huge box and almost no landmass.
      cands.push({ f, v, short, w, h, area: Math.abs(path.area(f)) });
    }
    cands.sort((a, b) => b.area - a.area);
    for (const c of cands) {
      const text = S.labels === "value" ? view.fmt(c.v) : c.short;
      const tw = text.length * 5.2 + 4, th = 11;
      if (c.w < tw || c.h < th || c.area < tw * th * 0.6) continue;
      const [cx, cy] = path.centroid(c.f);
      if (!Number.isFinite(cx)) continue;
      const box = { x0: cx - tw / 2 - 1, x1: cx + tw / 2 + 1, y0: cy - th / 2 - 1, y1: cy + th / 2 + 1 };
      if (overlaps(box)) continue;
      placed.push(box);
      lg.append(el("text", { class: "lbl", x: cx.toFixed(1), y: (cy + 3).toFixed(1) }, text));
    }
    svg.append(lg);
  }

  host.replaceChildren(svg);
  wireMapEvents(svg);
}

function shortLabel(region, f) {
  // 3,142 counties have no useful short form — only a handful would survive the
  // collision pass anyway, and those few read as arbitrary.
  if (S.map === "us-counties" && S.labels !== "value") return "";
  if (!region) return f.properties?.name || "";
  if (S.map === "us-states") {
    const ab = region.aliases.find((a) => /^[A-Z]{2}$/.test(a));
    return ab || region.name;
  }
  return region.iso2 || region.name;
}

function describeForSR() {
  const n = view.join.values.size;
  return `${n} 个地区着色，范围 ${view.fmt(view.min)} 至 ${view.fmt(view.max)}`;
}

// ---------------------------------------------------------------- tooltip
const tip = el("div", { class: "tooltip", role: "status" });
document.body.append(tip);
function showTip(f, ev) {
  const v = view.join.values.get(f.id);
  const r = geo.index.byId.get(f.id);
  const name = r ? r.name : f.properties?.name || f.id;
  const zh = r && r.zh && r.zh !== name ? r.zh : "";
  const c = view.colorOf(v);
  const rank = rankOf(f.id);
  tip.replaceChildren(
    el("div", { class: "t-name" }, (zh ? zh + " · " : "") + name),
    el("div", { class: "t-val" },
      el("i", { class: "t-chip", style: `background:${c || getCss("--nodata")}` }),
      Number.isFinite(v) ? view.fmt(v) : "无数据 no data"),
    rank ? el("div", { class: "t-meta" }, `第 ${rank.i} / ${rank.n} 位`) : null
  );
  tip.style.opacity = "1";
  moveTip(ev);
}
function moveTip(ev) {
  const pad = 14;
  const r = tip.getBoundingClientRect();
  let x = ev.clientX + pad, y = ev.clientY + pad;
  if (x + r.width > innerWidth - 8) x = ev.clientX - r.width - pad;
  if (y + r.height > innerHeight - 8) y = ev.clientY - r.height - pad;
  tip.style.left = Math.max(8, x) + "px";
  tip.style.top = Math.max(8, y) + "px";
}
const hideTip = () => { tip.style.opacity = "0"; };

function rankOf(id) {
  const v = view.join.values.get(id);
  if (!Number.isFinite(v)) return null;
  const sorted = view.values.slice().sort((a, b) => b - a);
  return { i: sorted.indexOf(v) + 1, n: sorted.length };
}

function wireMapEvents(svg) {
  svg.addEventListener("pointerover", (e) => {
    const p = e.target.closest?.(".region");
    if (p && p.__f) showTip(p.__f, e);
  });
  svg.addEventListener("pointermove", (e) => { if (tip.style.opacity === "1") moveTip(e); });
  svg.addEventListener("pointerleave", hideTip);
  svg.addEventListener("click", (e) => {
    const p = e.target.closest?.(".region");
    if (!p) return;
    selected = selected === p.dataset.id ? null : p.dataset.id;
    $$(".region", svg).forEach((n) => n.classList.toggle("sel", n.dataset.id === selected));
    if (selected) highlightRow(selected);
  });
}

// ---------------------------------------------------------------- legend
function renderLegend() {
  const host = $("#legend");
  const { breaks, colors, fmtTick: fmt } = view;
  const cvd = (hex) => (S.cvd === "none" ? hex : simulateCVD(hex, S.cvd));
  const kids = [];
  const title = el("div", { class: "legend-title" }, S.unit ? `图例 · ${S.unit}` : "图例 Legend");

  if (!view.values.length) {
    host.replaceChildren(el("div", { class: "lg-na" }, el("i", {}), "尚无数据 — 粘贴或选择一个示例数据集"));
    return;
  }
  if (S.continuous) {
    const stops = Array.from({ length: 24 }, (_, i) => cvd(view.interp(i / 23)));
    kids.push(el("div", {},
      title,
      el("div", { class: "lg-cont", style: `background:linear-gradient(90deg,${stops.join(",")})` }),
      el("div", { class: "lg-cont-labels" }, el("span", {}, fmt(view.min)), el("span", {}, fmt(view.max)))
    ));
  } else {
    const bins = el("div", { class: "lg-bins" });
    // Zero-width leading cell so the scale's lower bound is labelled too.
    bins.append(el("div", { class: "lg-bin start" }, el("i", { style: "width:0;margin-right:2px" }), el("span", {}, fmt(breaks[0]))));
    for (let i = 0; i < colors.length; i++) {
      bins.append(el("div", { class: "lg-bin" + (i === 0 ? " first" : "") + (i === colors.length - 1 ? " last" : "") },
        el("i", { style: `background:${cvd(colors[i])};margin-right:2px` }),
        el("span", {}, fmt(breaks[i + 1]))
      ));
    }
    kids.push(el("div", {}, title, bins));
  }
  const missing = geo.features.filter((f) => !Number.isFinite(view.join.values.get(f.id))).length;
  if (missing) kids.push(el("div", { class: "lg-na" }, el("i", {}), `无数据 ${missing}`));
  if (view.note) kids.push(el("div", { class: "lg-na" }, view.note));
  host.replaceChildren(...kids);
}

// ---------------------------------------------------------------- tiles
function renderTiles() {
  const host = $("#tiles");
  const vals = view.values;
  if (!vals.length) { host.replaceChildren(); return; }
  const sorted = vals.slice().sort((a, b) => a - b);
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const med = sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
  const topId = [...view.join.values.entries()].filter(([, v]) => Number.isFinite(v)).sort((a, b) => b[1] - a[1])[0];
  const botId = [...view.join.values.entries()].filter(([, v]) => Number.isFinite(v)).sort((a, b) => a[1] - b[1])[0];
  const nm = (id) => { const r = geo.index.byId.get(id); return r ? (r.zh || r.name) : id; };
  const tile = (k, v, sub) => el("dl", { class: "tile" }, el("dt", {}, k), el("dd", {}, v, sub ? el("small", {}, sub) : null));
  host.replaceChildren(
    tile("覆盖 Coverage", `${vals.length}`, `共 ${geo.features.length} 个地区`),
    tile("最高 Max", view.fmt(view.max), topId ? nm(topId[0]) : ""),
    tile("最低 Min", view.fmt(view.min), botId ? nm(botId[0]) : ""),
    tile("中位数 Median", view.fmt(med), ""),
    // Mean, not sum: a total is meaningless for rates, ages and per-capita figures.
    tile("平均 Mean", view.fmt(mean), "")
  );
}

// ---------------------------------------------------------------- table view
let sortKey = "value", sortDir = -1;
function renderTable() {
  const host = $("#tableHost");
  const rows = [...view.join.values.entries()].map(([id, v]) => {
    const r = geo.index.byId.get(id);
    return { id, name: r ? r.name : id, zh: r ? r.zh : "", value: v, color: view.colorOf(v), raw: view.join.labels.get(id) };
  });
  rows.sort((a, b) => {
    if (sortKey === "name") return sortDir * a.name.localeCompare(b.name);
    const av = Number.isFinite(a.value) ? a.value : -Infinity, bv = Number.isFinite(b.value) ? b.value : -Infinity;
    return sortDir * (av - bv);
  });
  const th = (key, label, cls = "") =>
    el("th", { class: cls, "aria-sort": sortKey === key ? (sortDir > 0 ? "ascending" : "descending") : "none",
      onclick: () => { if (sortKey === key) sortDir *= -1; else { sortKey = key; sortDir = key === "name" ? 1 : -1; } renderTable(); } },
      label + (sortKey === key ? (sortDir > 0 ? " ↑" : " ↓") : ""));

  const table = el("table", { class: "data" },
    el("thead", {}, el("tr", {}, el("th", { class: "num" }, "#"), th("name", "地区 Region"), th("value", "数值 Value", "num"))),
    el("tbody", {}, rows.map((r, i) =>
      el("tr", { "data-id": r.id, onclick: () => { selected = r.id; renderMap(); } },
        el("td", { class: "rank" }, String(i + 1)),
        el("td", {}, el("i", { class: "chip", style: `background:${r.color || getCss("--nodata")}` }), (r.zh ? r.zh + " · " : "") + r.name),
        el("td", { class: "num" }, view.fmt(r.value))
      ))
    )
  );
  const kids = [el("div", { class: "tw" }, table)];
  const un = view.join.unmatched;
  if (un.length) {
    kids.push(el("div", { class: "unmatched" },
      el("div", { style: "margin-bottom:5px" }, `⚠ ${un.length} 行未能匹配到地区（已跳过）：`),
      ...[...new Set(un)].slice(0, 60).map((u) => el("code", {}, u)),
      un.length > 60 ? el("span", {}, ` …等 ${un.length} 行`) : null
    ));
  }
  host.replaceChildren(...kids);
  $("#tableCount").textContent = `${rows.length} 行` + (un.length ? ` · ${un.length} 未匹配` : "");
}
function highlightRow(id) {
  const tv = $("#tableView");
  const tr = $(`tr[data-id="${CSS.escape(id)}"]`);
  if (!tr) return;
  tv.open = true;
  tr.scrollIntoView({ block: "center", behavior: "smooth" });
  tr.animate([{ background: getCss("--grid") }, { background: "transparent" }], { duration: 1200 });
}

// ---------------------------------------------------------------- export
function serializeSVG() {
  const src = $("#map");
  const clone = src.cloneNode(true);
  const mode = effMode();
  const tokens = ["--surface-1", "--plane", "--text-primary", "--muted", "--grid", "--axis", "--nodata", "--ocean"];
  const decl = tokens.map((t) => `${t}:${getCss(t)}`).join(";");
  const css = `
  :root{${decl}}
  .region{stroke:var(--surface-1);stroke-width:.6px;stroke-linejoin:round}
  .outline{fill:none;stroke:var(--axis);stroke-width:.7px}
  .sphere{fill:var(--ocean);stroke:var(--axis);stroke-width:.7px}
  text.lbl{font-family:${getComputedStyle(document.body).fontFamily.replace(/"/g, "'")};font-size:9px;font-weight:600;fill:var(--text-primary);paint-order:stroke;stroke:var(--surface-1);stroke-width:2.4px;text-anchor:middle}`;
  clone.insertBefore(el("style", { html: css }), clone.firstChild);
  const vb = src.getAttribute("viewBox").split(" ").map(Number);
  const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  bg.setAttribute("x", vb[0]); bg.setAttribute("y", vb[1]);
  bg.setAttribute("width", vb[2]); bg.setAttribute("height", vb[3]);
  bg.setAttribute("fill", getCss("--surface-1"));
  clone.insertBefore(bg, clone.children[1]);
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  return { text: new XMLSerializer().serializeToString(clone), w: vb[2], h: vb[3], mode };
}
function download(blob, name) {
  const a = el("a", { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
const slug = () => (S.title || "datamap").replace(/[\\/:*?"<>|]/g, "").trim().slice(0, 60) || "datamap";

function exportSVG() {
  const { text } = serializeSVG();
  download(new Blob([text], { type: "image/svg+xml;charset=utf-8" }), slug() + ".svg");
}
function exportPNG(scale = 2) {
  const { text, w, h } = serializeSVG();
  const img = new Image();
  img.onload = () => {
    const c = el("canvas");
    c.width = w * scale; c.height = h * scale;
    const ctx = c.getContext("2d");
    ctx.fillStyle = getCss("--surface-1");
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    c.toBlob((b) => download(b, slug() + ".png"), "image/png");
  };
  img.onerror = () => setStatus("PNG 导出失败，请改用 SVG", "warn");
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(text);
}
function exportCSV() {
  const rows = [...view.join.values.entries()].map(([id, v]) => {
    const r = geo.index.byId.get(id);
    return [id, r ? r.name : id, r ? r.zh : "", Number.isFinite(v) ? v : ""];
  }).sort((a, b) => (b[3] || -Infinity) - (a[3] || -Infinity));
  const esc = (s) => (/[",\n]/.test(String(s)) ? `"${String(s).replace(/"/g, '""')}"` : String(s));
  const csv = "﻿" + ["id,name,name_zh,value", ...rows.map((r) => r.map(esc).join(","))].join("\n");
  download(new Blob([csv], { type: "text/csv;charset=utf-8" }), slug() + ".csv");
}

// ---------------------------------------------------------------- helpers
const getCss = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
function setStatus(msg, cls = "") {
  const n = $("#status");
  n.replaceChildren(el("div", { class: cls }, msg));
}

// ---------------------------------------------------------------- panel UI
function buildPanel() {
  const p = $("#panel");
  const opt = (v, l, sel) => el("option", { value: v, selected: sel === v }, l);
  const field = (label, ...kids) => el("div", { class: "field" }, label ? el("label", {}, label) : null, ...kids);
  const group = (title, ...kids) => el("section", { class: "group" }, el("h2", {}, title), ...kids);

  // --- map ---
  const mapSel = el("select", { id: "mapSel", onchange: async (e) => { S.map = e.target.value; selected = null; await ensureGeo(); S._autoCols = true; refresh(); } },
    ...Object.entries(MAPS).map(([k, m]) => opt(k, m.label, S.map)));
  const projSel = el("select", { onchange: (e) => { S.projection = e.target.value; refresh(); } },
    ...Object.entries(PROJECTIONS).map(([k, m]) => opt(k, m.label, S.projection)));
  const antCheck = el("label", { class: "check" },
    el("input", { type: "checkbox", checked: S.hideAntarctica, onchange: (e) => { S.hideAntarctica = e.target.checked; refresh(); } }),
    "隐藏南极洲 Hide Antarctica");
  const worldOnly = el("div", { id: "worldOnly" }, field("投影 Projection", projSel), antCheck);

  // --- data ---
  const sampleSel = el("select", {
    id: "sampleSel",
    onchange: (e) => {
      const s = SAMPLES[e.target.value];
      if (!s) return;
      S.sample = e.target.value;
      S.map = s.map; S.raw = s.csv; S.title = s.title; S.subtitle = s.subtitle || ""; S.source = s.source || "";
      S.unit = s.unit || ""; S.fmtStyle = s.fmtStyle || "auto"; S.method = s.method || "quantile";
      S.kind = s.kind || "sequential"; S.hue = s.hue || "blue"; S._autoCols = true;
      S.center = s.center ?? 0; S.decimals = s.decimals ?? ""; S.continuous = false;
      autoNote = ""; selected = null;
      mapSel.value = S.map;
      $("#raw").value = S.raw;
      syncInputs();
      ensureGeo().then(() => refresh());
    },
  }, opt("", "— 选择示例 Sample —", ""), ...Object.entries(SAMPLES).map(([k, s]) => opt(k, s.label, S.sample)));

  const raw = el("textarea", {
    id: "raw", spellcheck: "false", placeholder: "地区,数值\nCalifornia,3987\nTexas,2664\n德克萨斯,2664\n\n支持逗号 / 制表符 / 分号；可直接从 Excel 粘贴",
    oninput: debounce(() => { S.raw = $("#raw").value; onDataChanged(); }, 350),
  });
  raw.value = S.raw;

  const fileBtn = el("input", { type: "file", id: "file", accept: ".csv,.tsv,.txt", style: "display:none",
    onchange: async (e) => {
      const f = e.target.files[0]; if (!f) return;
      S.raw = await f.text(); $("#raw").value = S.raw;
      if (!S.title) { S.title = f.name.replace(/\.[^.]+$/, ""); syncInputs(); }
      onDataChanged();
    } });

  const keySel = el("select", { id: "keySel", onchange: (e) => { S.keyIndex = +e.target.value; refresh(); } });
  const valSel = el("select", { id: "valSel", onchange: (e) => { S.valueIndex = +e.target.value; refresh(); } });

  // --- color ---
  const kindSeg = el("div", { class: "seg" },
    ...[["sequential", "顺序 Sequential"], ["diverging", "发散 Diverging"]].map(([k, l]) =>
      el("button", { type: "button", "data-k": k, "aria-pressed": String(S.kind === k),
        onclick: () => { S.kind = k; if (k === "diverging" && S.method !== "diverging") S.method = "diverging"; if (k === "sequential" && S.method === "diverging") S.method = "quantile"; syncInputs(); refresh(); } }, l)));

  const hueRow = (which) => el("div", { class: "swatches", "data-hue": which },
    ...Object.entries(HUES).map(([k]) => {
      const strip = buildRamp({ kind: "sequential", hue: k, n: 4, mode: effMode() });
      return el("button", { class: "swatch", type: "button", title: HUES[k].label, "aria-pressed": String(S[which] === k),
        onclick: () => { S[which] = k; refresh(); },
        html: strip.map((c) => `<i style="width:25%;background:${c}"></i>`).join("") });
    }));

  const methodSel = el("select", { id: "methodSel", onchange: (e) => { S.method = e.target.value; refresh(); } });
  const binsInput = el("input", { id: "binsInput", type: "range", min: "3", max: "7", step: "1", value: S.bins,
    oninput: (e) => { S.bins = +e.target.value; $("#binsOut").textContent = S.bins; refresh(); } });
  const contCheck = el("label", { class: "check" },
    el("input", { type: "checkbox", id: "contCheck", checked: S.continuous, onchange: (e) => { S.continuous = e.target.checked; syncInputs(); refresh(); } }),
    "连续色阶 Continuous");
  const revCheck = el("label", { class: "check" },
    el("input", { type: "checkbox", checked: S.reverse, onchange: (e) => { S.reverse = e.target.checked; refresh(); } }),
    "反转 Reverse");
  const centerInput = el("input", { type: "number", id: "centerInput", value: S.center, step: "any",
    oninput: debounce((e) => { S.center = e.target.value; refresh(); }, 300) });

  // --- display ---
  const fmtSel = el("select", { onchange: (e) => { S.fmtStyle = e.target.value; refresh(); } },
    ...[["auto", "自动 Auto"], ["number", "整数 Number"], ["compact", "紧凑 1.2M"], ["percent", "百分比 %"], ["currency", "货币 $"]].map(([v, l]) => opt(v, l, S.fmtStyle)));
  const decInput = el("input", { type: "number", min: "0", max: "6", placeholder: "自动", value: S.decimals,
    oninput: debounce((e) => { S.decimals = e.target.value; refresh(); }, 250) });
  const unitInput = el("input", { type: "text", placeholder: "如 亿美元 / people", value: S.unit,
    oninput: debounce((e) => { S.unit = e.target.value; refresh(); }, 250) });
  const labelSel = el("select", { onchange: (e) => { S.labels = e.target.value; refresh(); } },
    ...[["none", "不显示 None"], ["auto", "地区名 Region"], ["value", "数值 Value"]].map(([v, l]) => opt(v, l, S.labels)));
  const cvdSel = el("select", { onchange: (e) => { S.cvd = e.target.value; refresh(); } },
    ...[["none", "正常视觉 Normal"], ["protanopia", "红色盲 Protanopia"], ["deuteranopia", "绿色盲 Deuteranopia"], ["tritanopia", "蓝色盲 Tritanopia"]].map(([v, l]) => opt(v, l, S.cvd)));
  const themeSeg = el("div", { class: "seg" },
    ...[["auto", "跟随系统"], ["light", "浅色"], ["dark", "深色"]].map(([k, l]) =>
      el("button", { type: "button", "data-t": k, "aria-pressed": String(S.theme === k),
        onclick: () => { S.theme = k; applyTheme(); refresh(); } }, l)));

  p.replaceChildren(
    el("div", { class: "brand" }, el("h1", {}, "DataMap 数据地图"), el("span", {}, "v1")),
    el("p", { class: "tagline" }, "粘贴任意「地区 + 数值」两列数据，立刻得到一张配色合规的分级统计地图。"),

    group("地图 Map", field("底图 Basemap", mapSel), worldOnly),

    group("数据 Data",
      field("示例数据 Samples", sampleSel),
      field("粘贴数据 Paste", raw),
      el("div", { class: "btn-row" },
        el("button", { class: "btn", type: "button", onclick: () => $("#file").click() }, "上传文件"),
        el("button", { class: "btn ghost", type: "button", onclick: () => { S.raw = ""; $("#raw").value = ""; autoNote = ""; refresh(); } }, "清空"),
        fileBtn),
      el("div", { class: "row", style: "margin-top:10px" },
        field("地区列 Region", keySel),
        field("数值列 Value", valSel)),
      el("p", { class: "hint", id: "keyHint" }),
      el("div", { class: "status", id: "status" })),

    group("配色 Color",
      field("类型 Type", kindSeg),
      field("主色 Hue", hueRow("hue")),
      el("div", { id: "hue2Field" }, field("对侧色 Second hue", hueRow("hue2")), field("中心值 Center", centerInput)),
      field("分级方式 Method", methodSel),
      el("div", { id: "binsField" }, field(null, el("label", {}, "级数 Classes: ", el("b", { id: "binsOut" }, String(S.bins))), binsInput)),
      contCheck, revCheck),

    group("显示 Display",
      field("数值格式 Format", fmtSel),
      el("div", { class: "row" }, field("小数位 Decimals", decInput), field("单位 Unit", unitInput)),
      field("地图标签 Labels", labelSel),
      field("色觉模拟 CVD preview", cvdSel),
      field("主题 Theme", themeSeg),
      el("p", { class: "hint" }, "色觉模拟仅改变预览，不改变导出的原始配色。"))
  );
  syncInputs();
}

function syncInputs() {
  const p = $("#panel");
  if (!p) return;
  $("#worldOnly").style.display = S.map === "world" ? "" : "none";
  $("#hue2Field").style.display = S.kind === "diverging" ? "" : "none";
  $("#binsField").style.display = S.continuous ? "none" : "";
  $("#keyHint").textContent = MAPS[S.map].keyHint;
  $$("[data-k]", p).forEach((b) => b.setAttribute("aria-pressed", String(S.kind === b.dataset.k)));
  $$("[data-t]", p).forEach((b) => b.setAttribute("aria-pressed", String(S.theme === b.dataset.t)));
  $$('.swatches[data-hue="hue"] .swatch', p).forEach((b, i) => b.setAttribute("aria-pressed", String(Object.keys(HUES)[i] === S.hue)));
  $$('.swatches[data-hue="hue2"] .swatch', p).forEach((b, i) => b.setAttribute("aria-pressed", String(Object.keys(HUES)[i] === S.hue2)));

  const ms = $("#methodSel");
  const allowed = S.kind === "diverging"
    ? ["diverging", "divergingEqual", "quantile", "jenks", "equal"]
    : ["quantile", "jenks", "equal", "log"];
  ms.replaceChildren(...allowed.map((k) => el("option", { value: k, selected: S.method === k }, METHODS[k])));
  if (!allowed.includes(S.method)) { S.method = allowed[0]; ms.value = S.method; }

  $("#chartTitle").value = S.title;
  $("#chartSub").value = S.subtitle;
  $("#sourceInput").value = S.source;
  $("#contCheck").checked = S.continuous;
  $("#binsInput").value = S.bins;
  $("#binsOut").textContent = S.bins;
}

function syncColumnPickers() {
  const cols = view.parsed.columns;
  const fill = (sel, cur) => sel.replaceChildren(...cols.map((c, i) => el("option", { value: i, selected: i === cur }, `${i + 1}. ${c}`)));
  fill($("#keySel"), S.keyIndex);
  fill($("#valSel"), S.valueIndex);
  $("#keySel").disabled = $("#valSel").disabled = !cols.length;
}

function applyTheme() {
  document.documentElement.setAttribute("data-theme", S.theme === "auto" ? "" : S.theme);
  if (S.theme === "auto") document.documentElement.removeAttribute("data-theme");
}

// ---------------------------------------------------------------- refresh
function refresh() {
  if (!geo) return;
  compute();
  syncColumnPickers();
  renderMap();
  renderLegend();
  renderTiles();
  renderTable();
  reportStatus();
  syncInputs();
  save();
}

function reportStatus() {
  const { matched, unmatched, duplicates } = view.join;
  const total = geo.features.length;
  const kids = [];
  if (autoNote) kids.push(el("div", { class: "ok" }, "↔ " + autoNote));
  if (!view.parsed.rows.length) kids.push(el("div", { class: "" }, "等待数据…"));
  else {
    kids.push(el("div", { class: "ok" }, `✓ 已匹配 ${matched.length} 行 → ${view.join.values.size} 个地区（共 ${total}）`));
    if (unmatched.length) {
      kids.push(el("div", { class: "warn", onclick: () => { $("#tableView").open = true; $("#tableView").scrollIntoView({ behavior: "smooth" }); } },
        `⚠ ${unmatched.length} 行未匹配 — 点击查看`));
    }
    if (duplicates.length) kids.push(el("div", { class: "warn" }, `⚠ ${duplicates.length} 个重复地区，取最后一次出现的值`));
  }
  $("#status").replaceChildren(...kids);
}

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

// ---------------------------------------------------------------- boot
async function boot() {
  load();
  applyTheme();
  buildPanel();

  $("#chartTitle").addEventListener("input", (e) => { S.title = e.target.value; save(); });
  $("#chartSub").addEventListener("input", (e) => { S.subtitle = e.target.value; save(); });
  $("#sourceInput").addEventListener("input", (e) => { S.source = e.target.value; save(); });
  $("#btnPNG").addEventListener("click", () => exportPNG(2));
  $("#btnSVG").addEventListener("click", exportSVG);
  $("#btnCSV").addEventListener("click", exportCSV);
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { if (S.theme === "auto") refresh(); });

  if (!S.raw && SAMPLES[S.sample]) {
    const s = SAMPLES[S.sample];
    S.map = s.map; S.raw = s.csv; S.title = s.title; S.subtitle = s.subtitle || "";
    S.source = s.source || ""; S.unit = s.unit || ""; S.fmtStyle = s.fmtStyle || "auto";
    S.method = s.method || "quantile"; S.kind = s.kind || "sequential"; S.hue = s.hue || "blue";
    S.center = s.center ?? 0; S.decimals = s.decimals ?? "";
    $("#raw").value = S.raw;
    $("#mapSel").value = S.map;
    // Only the freshly-loaded sample needs column guessing; a restored session
    // already carries the user's own choice.
    S._autoCols = true;
  }
  await ensureGeo();
  refresh();
}
boot();
