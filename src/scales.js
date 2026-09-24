// Classification (breaks) + number formatting.

const asc = (a, b) => a - b;

function quantileSorted(sorted, p) {
  if (!sorted.length) return NaN;
  const i = (sorted.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

// Fisher-Jenks natural breaks via 1-D dynamic programming. Large inputs are
// sampled down first so the O(k*n^2) pass stays interactive.
function jenksBreaks(values, k) {
  let v = values.slice().sort(asc);
  const CAP = 400;
  if (v.length > CAP) {
    const step = v.length / CAP;
    const s = [];
    for (let i = 0; i < CAP; i++) s.push(v[Math.floor(i * step)]);
    s.push(v[v.length - 1]);
    v = s;
  }
  const n = v.length;
  if (n <= k) return [...new Set(v)];
  const mat1 = Array.from({ length: n + 1 }, () => new Array(k + 1).fill(0));
  const mat2 = Array.from({ length: n + 1 }, () => new Array(k + 1).fill(Infinity));
  for (let j = 1; j <= k; j++) { mat1[1][j] = 1; mat2[1][j] = 0; }
  for (let l = 2; l <= n; l++) {
    let s1 = 0, s2 = 0, w = 0, v4 = 0;
    for (let m = 1; m <= l; m++) {
      const i3 = l - m + 1, val = v[i3 - 1];
      s2 += val * val; s1 += val; w++;
      v4 = s2 - (s1 * s1) / w;
      const i4 = i3 - 1;
      if (i4 !== 0) {
        for (let j = 2; j <= k; j++) {
          if (mat2[l][j] >= v4 + mat2[i4][j - 1]) { mat1[l][j] = i3; mat2[l][j] = v4 + mat2[i4][j - 1]; }
        }
      }
    }
    mat1[l][1] = 1; mat2[l][1] = v4;
  }
  const kb = new Array(k + 1);
  kb[k] = v[n - 1]; kb[0] = v[0];
  let cnt = n;
  for (let j = k; j >= 2; j--) { kb[j - 1] = v[mat1[cnt][j] - 2]; cnt = mat1[cnt][j] - 1; }
  return kb;
}

/**
 * @returns {{breaks:number[], min:number, max:number, note:string}}
 * breaks has n+1 entries: [min, b1, ..., max]
 */
export function computeBreaks(values, { method = "quantile", n = 5, center = 0 } = {}) {
  const vals = values.filter((v) => Number.isFinite(v)).sort(asc);
  if (!vals.length) return { breaks: [], min: NaN, max: NaN, note: "" };
  const min = vals[0], max = vals[vals.length - 1];
  if (min === max) return { breaks: [min, max], min, max, note: "所有值相同 / all values equal" };

  if (method === "equal") {
    return { breaks: Array.from({ length: n + 1 }, (_, i) => min + ((max - min) * i) / n), min, max, note: "" };
  }
  if (method === "quantile") {
    const b = [min];
    for (let i = 1; i < n; i++) b.push(quantileSorted(vals, i / n));
    b.push(max);
    // Collapse duplicate edges (heavy ties) so no empty class survives.
    const uniq = b.filter((x, i) => i === 0 || x > b[i - 1]);
    return { breaks: uniq, min, max, note: uniq.length - 1 < n ? `重复值过多，合并为 ${uniq.length - 1} 级 / Too many ties, merged into ${uniq.length - 1} classes` : "" };
  }
  if (method === "jenks") {
    const b = jenksBreaks(vals, n);
    const uniq = b.filter((x, i) => i === 0 || x > b[i - 1]);
    return { breaks: uniq, min, max, note: uniq.length - 1 < n ? `合并为 ${uniq.length - 1} 级 / Merged into ${uniq.length - 1} classes` : "" };
  }
  if (method === "log") {
    const pos = vals.filter((v) => v > 0);
    if (!pos.length) return computeBreaks(values, { method: "equal", n });
    const lo = Math.log10(pos[0]), hi = Math.log10(pos[pos.length - 1]);
    const b = Array.from({ length: n + 1 }, (_, i) => Math.pow(10, lo + ((hi - lo) * i) / n));
    b[0] = Math.min(min, b[0]); b[n] = max;
    return { breaks: b, min, max, note: min <= 0 ? "含非正值，已并入最低级 / non-positive values folded into lowest class" : "" };
  }
  if (method === "divergingEqual") {
    // Equal-width classes mirrored around `center`. Honest but outlier-dominated:
    // one extreme county can push every other region into the neutral class.
    const span = Math.max(Math.abs(max - center), Math.abs(min - center)) || 1;
    const b = Array.from({ length: n + 1 }, (_, i) => center - span + ((2 * span) * i) / n);
    return { breaks: b, min, max, note: "" };
  }
  if (method === "diverging") {
    // Symmetric around `center`, but the arm thresholds come from quantiles of the
    // absolute deviation — so the classes stay balanced when the data is skewed.
    const dev = vals.map((v) => Math.abs(v - center)).sort(asc);
    const odd = n % 2 === 1;
    const k = odd ? (n + 1) / 2 : n / 2; // thresholds per arm
    const th = [];
    for (let i = 1; i <= k; i++) th.push(i === k ? dev[dev.length - 1] : quantileSorted(dev, i / k));
    const uniqTh = th.filter((x, i) => i === 0 || x > th[i - 1]);
    const b = [
      ...uniqTh.slice().reverse().map((t) => center - t),
      ...(odd ? [] : [center]),
      ...uniqTh.map((t) => center + t),
    ];
    const cls = b.length - 1;
    return { breaks: b, min, max, note: cls < n ? `重复值过多，合并为 ${cls} 级 / Too many ties, merged into ${cls} classes` : "" };
  }
  return computeBreaks(values, { method: "quantile", n });
}

/** Index of the class a value falls in, or -1. */
export function classify(value, breaks) {
  if (!Number.isFinite(value) || breaks.length < 2) return -1;
  for (let i = 1; i < breaks.length; i++) if (value <= breaks[i] || i === breaks.length - 1) return i - 1;
  return breaks.length - 2;
}

// ---- formatting ----
const LOCALE = "en-US";
export function makeFormatter({ style = "auto", decimals = null, unit = "", values = [] } = {}) {
  const abs = values.filter(Number.isFinite).map(Math.abs);
  const peak = abs.length ? Math.max(...abs) : 0;
  let opts, notation;
  if (style === "auto") {
    if (peak >= 1e5) notation = "compact";
    const spread = peak;
    const d = decimals != null ? decimals : spread >= 100 ? 0 : spread >= 1 ? 2 : 4;
    opts = { maximumFractionDigits: d, minimumFractionDigits: 0 };
  } else if (style === "compact") {
    notation = "compact";
    opts = { maximumFractionDigits: decimals != null ? decimals : 2 };
  } else if (style === "percent") {
    opts = { style: "percent", maximumFractionDigits: decimals != null ? decimals : 1 };
  } else if (style === "currency") {
    opts = { style: "currency", currency: "USD", maximumFractionDigits: decimals != null ? decimals : 0 };
    if (peak >= 1e5) notation = "compact";
  } else {
    opts = { maximumFractionDigits: decimals != null ? decimals : 0 };
  }
  const nf = new Intl.NumberFormat(LOCALE, { ...opts, ...(notation ? { notation, compactDisplay: "short" } : {}) });
  return (v) => (Number.isFinite(v) ? nf.format(v) + (unit ? " " + unit : "") : "—");
}
