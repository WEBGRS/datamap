// Resolve arbitrary user-typed region names to atlas feature ids.
import { toNumber } from "./parse.js";

const DIACRITICS = /[̀-ͯ]/g;
// Trailing words that carry no identity ("California State" == "California").
const SUFFIX = /(state|province|prefecture|county|parish|borough|region|republicof|the)$/;
const PREFIX = /^(the|republicof|stateof)/;

export function norm(s) {
  return String(s ?? "")
    .normalize("NFD").replace(DIACRITICS, "")
    .toLowerCase()
    .replace(/[’'`´]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}
function loose(s) {
  let n = norm(s);
  n = n.replace(PREFIX, "");
  for (let i = 0; i < 2; i++) n = n.replace(SUFFIX, "");
  n = n.replace(/[州省县市区]$/u, "");
  return n;
}

export function buildIndex(regions, { idWidth = 0 } = {}) {
  const exact = new Map();
  const fuzzy = new Map();
  const byId = new Map();
  const add = (map, key, id) => { if (key && !map.has(key)) map.set(key, id); };
  for (const r of regions) {
    byId.set(r.id, r);
    for (const a of r.aliases) { add(exact, norm(a), r.id); add(fuzzy, loose(a), r.id); }
    add(exact, norm(r.name), r.id);
    add(exact, norm(r.zh), r.id);
  }
  return { exact, fuzzy, byId, regions, idWidth };
}

/** @returns {{id:string|null, how:string}} */
export function resolve(index, raw) {
  const s = String(raw ?? "").trim();
  if (!s) return { id: null, how: "empty" };

  const n = norm(s);
  if (index.exact.has(n)) return { id: index.exact.get(n), how: "exact" };

  // Numeric codes: accept unpadded FIPS / ISO-numeric.
  if (/^\d+$/.test(s) && index.idWidth) {
    const padded = s.padStart(index.idWidth, "0");
    if (index.byId.has(padded)) return { id: padded, how: "code" };
    if (index.exact.has(norm(padded))) return { id: index.exact.get(norm(padded)), how: "code" };
  }

  const l = loose(s);
  if (index.fuzzy.has(l)) return { id: index.fuzzy.get(l), how: "loose" };

  // Containment, only when it lands on exactly one region (never guess between two)
  // and the two strings are close in length — otherwise "Latin America & Caribbean"
  // swallows the "America" alias and lands on the United States.
  if (l.length >= 4) {
    const ids = new Set();
    for (const [k, id] of index.fuzzy) {
      if (k.length < 4) continue;
      if (!k.includes(l) && !l.includes(k)) continue;
      const longer = Math.max(k.length, l.length);
      if ((longer - Math.min(k.length, l.length)) / longer > 0.5) continue;
      ids.add(id);
    }
    if (ids.size === 1) return { id: [...ids][0], how: "partial" };
    if (ids.size > 1) return { id: null, how: "ambiguous" };
  }
  return { id: null, how: "none" };
}

/**
 * Join parsed rows to regions.
 * @returns {{values:Map<string,number>, labels:Map<string,string>, matched:Array, unmatched:Array, duplicates:Array}}
 */
export function joinRows(index, rows, keyIndex, valueIndex) {
  const values = new Map();
  const labels = new Map();
  const matched = [];
  const unmatched = [];
  const duplicates = [];
  const seen = new Map();
  for (const row of rows) {
    const key = row[keyIndex];
    if (key == null || String(key).trim() === "") continue;
    const { id, how } = resolve(index, key);
    if (!id) { unmatched.push(String(key)); continue; }
    const num = toNumber(row[valueIndex]);
    if (seen.has(id)) duplicates.push(String(key));
    seen.set(id, true);
    values.set(id, num);
    labels.set(id, String(key));
    matched.push({ id, key: String(key), how, value: num });
  }
  return { values, labels, matched, unmatched, duplicates };
}
