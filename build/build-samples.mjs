// Generate src/samples.js from the fetched raw sources in build/.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildIndex, resolve } from "../src/match.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const read = (f) => fs.readFileSync(path.join(HERE, f), "utf8");
const readJson = (f) => JSON.parse(read(f));

const usIndex = buildIndex(readJson("../data/regions-us-states.json"), { idWidth: 2 });
const worldIndex = buildIndex(readJson("../data/regions-world.json"), { idWidth: 3 });
const countyIndex = buildIndex(readJson("../data/regions-us-counties.json"), { idWidth: 5 });

const num = (s) => {
  const n = Number(String(s).replace(/[,$%\s]/g, "").replace(/−/g, "-"));
  return Number.isFinite(n) ? n : NaN;
};
const round = (v, d) => (Number.isFinite(v) ? Number(v.toFixed(d)) : NaN);
// Wikitext cells wrap the figure in {{Increase}}/{{Decrease}}; the arrow carries the sign.
const cellNum = (c) => {
  const down = /\{\{\s*(Decrease|Negative)/i.test(c);
  let n = num(c.replace(/\{\{[^}]*\}\}/g, ""));
  if (Number.isFinite(n) && down && n > 0) n = -n;
  return n;
};
const median = (a) => {
  const s = a.filter(Number.isFinite).sort((x, y) => x - y);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

// ---------- US states: parse the BEA table out of the Wikipedia wikitext ----------
function usStateRows() {
  const t = readJson("wiki_gdp.json").parse.wikitext;
  const table = [...t.matchAll(/\{\|[\s\S]*?\n\|\}/g)].map((m) => m[0])[1];
  const rows = table.split(/\n\|-/).slice(1);
  const out = [];
  for (const r of rows) {
    const cells = r.split(/\n\s*\|(?!\})/).slice(1).map((c) => c.trim());
    if (cells.length < 9) continue;
    // State name lives in a {{flagg|useft|NAME|...}} template.
    const m = cells[0].match(/\{\{flagg\|[^|]*\|([^|}]+)/) || cells[0].match(/\[\[([^\]|]+)/);
    const name = (m ? m[1] : cells[0]).replace(/\{\{.*?\}\}/g, "").trim();
    if (!resolve(usIndex, name).id) continue;
    out.push({
      name,
      gdp2025: num(cells[2]), // millions USD
      gdp2024: num(cells[1]),
      growth: cellNum(cells[6]), // real GDP growth %
      pop: num(cells[7]),
      pcap2025: num(cells[9] ?? cells[8]),
    });
  }
  return out;
}

// ---------- World Bank ----------
function wbRows(file) {
  const j = readJson(file);
  const out = [];
  for (const r of j[1] || []) {
    if (r.value == null) continue;
    // ISO3 only. The name fallback would let regional aggregates ("Latin America
    // & Caribbean") land on a real country.
    const code = r.countryiso3code || r.country?.id;
    const hit = resolve(worldIndex, code);
    if (!hit.id || hit.how === "partial") continue;
    out.push({ id: hit.id, name: worldIndex.byId.get(hit.id).name, iso3: code, value: r.value, date: r.date });
  }
  // World Bank aggregates can collapse onto the same region; keep the first.
  const seen = new Set();
  return out.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
}

// ---------- Census counties ----------
function countyRows() {
  const lines = read("co-est.csv").split(/\r?\n/);
  const head = lines[0].split(",");
  const col = (n) => head.indexOf(n);
  const iS = col("STATE"), iC = col("COUNTY"), iSum = col("SUMLEV");
  const i24 = col("POPESTIMATE2024"), iBase = col("ESTIMATESBASE2020");
  // The atlas predates two boundary changes. Chugach + Copper River exactly
  // partition the old Valdez-Cordova borough, so they can be summed back.
  // Connecticut's 9 planning regions do NOT partition its 8 old counties, so
  // those stay unmatched rather than being faked.
  const MERGE = { "02063": "02261", "02066": "02261" };
  const acc = new Map();
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const c = line.split(",");
    if (c[iSum] !== "050") continue; // county records only
    const raw = c[iS] + c[iC];
    const fips = MERGE[raw] || raw;
    if (!countyIndex.byId.has(fips)) continue;
    const cur = acc.get(fips) || { fips, pop: 0, base: 0 };
    cur.pop += Number(c[i24]);
    cur.base += Number(c[iBase]);
    acc.set(fips, cur);
  }
  return [...acc.values()].map((r) => ({ fips: r.fips, pop: r.pop, growth: r.base > 0 ? ((r.pop - r.base) / r.base) * 100 : NaN }));
}

// ---------- assemble ----------
const q = (s) => (/[",]/.test(String(s)) ? `"${String(s).replace(/"/g, '""')}"` : String(s));
const csv = (header, rows) => [header, ...rows].join("\n");

const us = usStateRows();
const counties = countyRows();
const wbGdp = wbRows("wb_gdp.json");
const wbPcap = wbRows("wb_pcap.json");
const wbPop = wbRows("wb_pop.json");
const wbLife = wbRows("wb_life.json");
const usMedGrowth = round(median(us.map((r) => r.growth)), 1);

console.log(`us states ${us.length} | counties ${counties.length} | wb gdp ${wbGdp.length} pcap ${wbPcap.length} pop ${wbPop.length} life ${wbLife.length}`);
console.log("median us growth:", usMedGrowth);

const SAMPLES = {
  "us-gdp": {
    label: "美国 · 各州 GDP 2025 · US state GDP", map: "us-states",
    title: "美国各州 GDP · US state GDP · 2025", subtitle: "名义 GDP，十亿美元 (Nominal GDP, $ billions)",
    unit: "$bn", fmtStyle: "compact", method: "jenks", kind: "sequential", hue: "blue",
    source: "U.S. Bureau of Economic Analysis (BEA), 2025",
    csv: csv("州 State,GDP ($bn)", us.map((r) => `${q(r.name)},${round(r.gdp2025 / 1000, 1)}`)),
  },
  "us-gdp-pc": {
    label: "美国 · 各州人均 GDP 2025 · US GDP per capita", map: "us-states",
    title: "美国各州人均 GDP · US state GDP per capita · 2025", subtitle: "名义人均 GDP，美元 (Nominal GDP per capita, US$)",
    unit: "", fmtStyle: "currency", method: "quantile", kind: "sequential", hue: "teal",
    source: "BEA + U.S. Census Bureau, 2025",
    csv: csv("州 State,人均 GDP per capita (US$)", us.map((r) => `${q(r.name)},${Math.round(r.pcap2025)}`)),
  },
  "us-growth": {
    label: "美国 · 各州实际 GDP 增速 · US real GDP growth", map: "us-states",
    title: "美国各州实际 GDP 增速 · US state real GDP growth · 2024→2025",
    subtitle: `实际 GDP 同比变化，以全国中位数 ${usMedGrowth}% 为分界 (Real GDP growth vs. median)`,
    unit: "%", fmtStyle: "number", method: "diverging", kind: "diverging", hue: "blue",
    decimals: 1, center: usMedGrowth,
    source: "U.S. Bureau of Economic Analysis (BEA)",
    csv: csv("州 State,增速 Growth (%)", us.map((r) => `${q(r.name)},${round(r.growth, 1)}`)),
  },
  "us-pop": {
    label: "美国 · 各州人口 2025 · US state population", map: "us-states",
    title: "美国各州人口 · US state population · 2025", subtitle: "常住人口估计 (Resident population estimate)",
    unit: "people", fmtStyle: "compact", method: "jenks", kind: "sequential", hue: "violet",
    source: "U.S. Census Bureau, Population Estimates Program",
    csv: csv("州 State,人口 Population", us.map((r) => `${q(r.name)},${Math.round(r.pop)}`)),
  },
  "county-pop": {
    label: "美国 · 各县人口 2024 · US county population", map: "us-counties",
    title: "美国各县人口 · US county population · 2024", subtitle: "3,142 个县级行政区，对数分级 (3,142 counties, log scale)",
    unit: "people", fmtStyle: "compact", method: "log", kind: "sequential", hue: "blue",
    source: "U.S. Census Bureau, Vintage 2024 county estimates（康涅狄格 8 县因 2022 年改划规划区，底图无对应单元 / 8 Connecticut counties became planning regions in 2022 and have no basemap shape）",
    csv: csv("FIPS,人口 Population", counties.map((r) => `${r.fips},${r.pop}`)),
  },
  "county-growth": {
    label: "美国 · 各县人口变化 2020→24 · US county pop. change", map: "us-counties",
    title: "美国各县人口变化 · US county population change · 2020→2024", subtitle: "相对 2020 普查基数的变化 (% change vs 2020 base)",
    unit: "%", fmtStyle: "number", method: "diverging", kind: "diverging", hue: "blue",
    decimals: 1, center: 0,
    source: "U.S. Census Bureau, Vintage 2024 county estimates（康涅狄格 8 县因 2022 年改划规划区，底图无对应单元 / 8 Connecticut counties became planning regions in 2022 and have no basemap shape）",
    csv: csv("FIPS,变化 Change (%)", counties.filter((r) => Number.isFinite(r.growth)).map((r) => `${r.fips},${round(r.growth, 2)}`)),
  },
  "world-gdp": {
    label: "世界 · 各国 GDP 2024 · World GDP", map: "world",
    title: "世界各国 GDP · World GDP · 2024", subtitle: "名义 GDP，十亿美元，对数分级 (Nominal GDP, US$ bn, log scale)",
    unit: "$bn", fmtStyle: "compact", method: "log", kind: "sequential", hue: "blue",
    source: "World Bank, World Development Indicators (NY.GDP.MKTP.CD)",
    csv: csv("国家 Country,GDP ($bn)", wbGdp.map((r) => `${q(r.iso3)},${round(r.value / 1e9, 2)}`)),
  },
  "world-gdp-pc": {
    label: "世界 · 各国人均 GDP 2024 · World GDP per capita", map: "world",
    title: "世界各国人均 GDP · World GDP per capita · 2024", subtitle: "名义人均 GDP，美元 (GDP per capita, current US$)",
    unit: "", fmtStyle: "currency", method: "quantile", kind: "sequential", hue: "teal",
    source: "World Bank, World Development Indicators (NY.GDP.PCAP.CD)",
    csv: csv("国家 Country,人均 GDP per capita (US$)", wbPcap.map((r) => `${q(r.iso3)},${Math.round(r.value)}`)),
  },
  "world-pop": {
    label: "世界 · 各国人口 2024 · World population", map: "world",
    title: "世界各国人口 · World population · 2024", subtitle: "总人口，对数分级 (Total population, log scale)",
    unit: "people", fmtStyle: "compact", method: "log", kind: "sequential", hue: "violet",
    source: "World Bank, World Development Indicators (SP.POP.TOTL)",
    csv: csv("国家 Country,人口 Population", wbPop.map((r) => `${q(r.iso3)},${Math.round(r.value)}`)),
  },
  "world-life": {
    label: "世界 · 各国预期寿命 2023 · World life expectancy", map: "world",
    title: "世界各国预期寿命 · World life expectancy · 2023", subtitle: "出生时预期寿命，岁 (Life expectancy at birth, years)",
    unit: "years", fmtStyle: "number", decimals: 1, method: "quantile", kind: "sequential", hue: "orange",
    source: "World Bank, World Development Indicators (SP.DYN.LE00.IN)",
    csv: csv("国家 Country,预期寿命 Life expectancy (years)", wbLife.map((r) => `${q(r.iso3)},${round(r.value, 1)}`)),
  },
};

const banner = `// GENERATED by build/build-samples.mjs - do not edit by hand.
// Sources: U.S. Bureau of Economic Analysis, U.S. Census Bureau, World Bank WDI.
`;
fs.writeFileSync(path.join(ROOT, "src/samples.js"), banner + "export const SAMPLES = " + JSON.stringify(SAMPLES, null, 1) + ";\n", "utf8");
const size = fs.statSync(path.join(ROOT, "src/samples.js")).size;
console.log(`wrote src/samples.js (${(size / 1024).toFixed(0)}KB, ${Object.keys(SAMPLES).length} datasets)`);
for (const [k, s] of Object.entries(SAMPLES)) console.log("  ", k.padEnd(14), String(s.csv.split("\n").length - 1).padStart(5), "rows");
