// Delimited-text parsing + numeric coercion.

/** Sniff the delimiter from the first few lines. */
function sniff(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 12);
  const cands = ["\t", ",", ";", "|"];
  let best = ",", bestScore = -1;
  for (const d of cands) {
    const counts = lines.map((l) => splitLine(l, d).length);
    const mode = counts.sort((a, b) => a - b)[Math.floor(counts.length / 2)];
    if (mode < 2) continue;
    const consistent = counts.filter((c) => c === mode).length / counts.length;
    const score = consistent * 10 + mode;
    if (score > bestScore) { bestScore = score; best = d; }
  }
  return best;
}

/** RFC4180-ish single-line split honouring double quotes. */
function splitLine(line, delim) {
  const out = [];
  let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === delim) { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/** Split full text into rows, keeping quoted newlines together. */
function splitRows(text, delim) {
  const rows = [];
  let cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') q = !q;
    if (!q && (c === "\n" || c === "\r")) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      rows.push(cur); cur = "";
    } else cur += c;
  }
  if (cur) rows.push(cur);
  return rows.filter((r) => r.trim()).map((r) => splitLine(r, delim));
}

/** "$1,234.5万" -> 12345 style coercion. Returns NaN when not numeric. */
export function toNumber(raw) {
  if (typeof raw === "number") return raw;
  if (raw == null) return NaN;
  let s = String(raw).trim();
  if (!s || /^(n\/?a|na|nan|null|-|--|—|nil)$/i.test(s)) return NaN;
  let mult = 1, neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  s = s.replace(/[$¥€£₹%\s,_'  ]/g, "");
  if (String(raw).includes("%")) mult *= 0.01;
  const suffix = { k: 1e3, K: 1e3, m: 1e6, M: 1e6, b: 1e9, B: 1e9, t: 1e12, T: 1e12, 万: 1e4, 亿: 1e8, 千: 1e3, 百万: 1e6, 十亿: 1e9 };
  for (const key of ["百万", "十亿", "万", "亿", "千"]) {
    if (s.endsWith(key)) { mult *= suffix[key]; s = s.slice(0, -key.length); break; }
  }
  if (/[kKmMbBtT]$/.test(s) && /\d/.test(s)) { mult *= suffix[s.slice(-1)]; s = s.slice(0, -1); }
  const n = Number(s);
  if (!Number.isFinite(n)) return NaN;
  return (neg ? -n : n) * mult;
}

const looksNumeric = (v) => Number.isFinite(toNumber(v));

/**
 * Parse pasted/uploaded text into { columns, rows, headerUsed }.
 * Header detection: first row is a header if it is non-numeric where later rows are numeric.
 */
export function parseTable(text) {
  const clean = String(text || "").replace(/^﻿/, "").trim();
  if (!clean) return { columns: [], rows: [], delimiter: "," };
  const delim = sniff(clean);
  let cells = splitRows(clean, delim);
  if (!cells.length) return { columns: [], rows: [], delimiter: delim };

  const width = Math.max(...cells.map((r) => r.length));
  cells = cells.map((r) => (r.length === width ? r : [...r, ...new Array(width - r.length).fill("")]));

  const first = cells[0];
  const body = cells.slice(1);
  let header = false;
  if (body.length) {
    const firstNumeric = first.filter(looksNumeric).length;
    const bodyNumeric = body.slice(0, 20).map((r) => r.filter(looksNumeric).length);
    const avgBody = bodyNumeric.reduce((a, b) => a + b, 0) / bodyNumeric.length;
    header = firstNumeric < avgBody || (firstNumeric === 0 && avgBody === 0 && body.length > 1 && /name|region|state|country|value|地区|名称|省|州|国家|数值/i.test(first.join(" ")));
  }
  const columns = header ? first.map((h, i) => h || `列${i + 1}`) : first.map((_, i) => `列${i + 1}`);
  const rows = header ? body : cells;
  return { columns, rows, delimiter: delim, headerUsed: header };
}

/** Pick the most likely key column (text) and value column (numeric). */
export function guessColumns({ columns, rows }) {
  if (!columns.length) return { keyIndex: 0, valueIndex: 1 };
  const sample = rows.slice(0, 60);
  const numericRatio = columns.map((_, c) => {
    const vals = sample.map((r) => r[c]).filter((v) => v !== "" && v != null);
    if (!vals.length) return 0;
    return vals.filter(looksNumeric).length / vals.length;
  });
  const nameHint = /name|region|state|country|province|code|地区|名称|省|州|国家|城市|县/i;
  const valueHint = /value|gdp|pop|count|total|amount|rate|score|数值|人口|总量|数量|金额|指标/i;

  let keyIndex = columns.findIndex((c, i) => numericRatio[i] < 0.5 && nameHint.test(c));
  if (keyIndex < 0) keyIndex = numericRatio.findIndex((r) => r < 0.5);
  if (keyIndex < 0) keyIndex = 0;

  let valueIndex = columns.findIndex((c, i) => i !== keyIndex && numericRatio[i] >= 0.6 && valueHint.test(c));
  if (valueIndex < 0) valueIndex = numericRatio.findIndex((r, i) => i !== keyIndex && r >= 0.6);
  if (valueIndex < 0) valueIndex = columns.length > 1 ? (keyIndex === 0 ? 1 : 0) : 0;
  return { keyIndex, valueIndex };
}
