// Headless smoke test: drives every sample + control and screenshots the result.
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.join(HERE, "..", "shots");
fs.mkdirSync(SHOTS, { recursive: true });
const BASE = process.env.BASE || "http://localhost:8123";

const browser = await chromium.launch({ channel: "msedge" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();

const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));

await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForSelector("svg#map .region", { timeout: 20000 });

const stat = async (tag) => {
  const s = await page.evaluate(() => ({
    regions: document.querySelectorAll("svg#map .region").length,
    painted: [...document.querySelectorAll("svg#map .region")].filter((p) => {
      const f = p.getAttribute("fill");
      return f && f !== getComputedStyle(document.documentElement).getPropertyValue("--nodata").trim();
    }).length,
    legendBins: document.querySelectorAll("#legend .lg-bin, #legend .lg-cont").length,
    tiles: document.querySelectorAll("#tiles .tile").length,
    status: document.querySelector("#status")?.innerText.replace(/\s+/g, " ").trim(),
    tableRows: document.querySelectorAll("#tableHost table.data tbody tr").length,
    title: document.querySelector("#chartTitle")?.value,
    bodyScrollX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  }));
  console.log(`${tag.padEnd(22)} regions=${String(s.regions).padStart(4)} painted=${String(s.painted).padStart(4)} bins=${s.legendBins} tiles=${s.tiles} rows=${String(s.tableRows).padStart(4)} hscroll=${s.bodyScrollX}`);
  console.log(`  ${s.status}`);
  if (s.bodyScrollX) errors.push(`${tag}: page scrolls horizontally`);
  if (!s.painted) errors.push(`${tag}: nothing painted`);
  return s;
};

const samples = await page.$$eval("#sampleSel option", (os) => os.map((o) => o.value).filter(Boolean));
console.log("samples:", samples.join(", "), "\n");

for (const s of samples) {
  await page.selectOption("#sampleSel", s);
  await page.waitForTimeout(s.startsWith("county") ? 2200 : 900);
  await stat(s);
  await page.screenshot({ path: path.join(SHOTS, `sample-${s}.png`), fullPage: false });
}

// --- control sweep on the flagship dataset ---
await page.selectOption("#sampleSel", "us-gdp");
await page.waitForTimeout(800);

console.log("\ncontrols:");
for (const m of ["quantile", "jenks", "equal", "log"]) {
  await page.selectOption("#methodSel", m);
  await page.waitForTimeout(400);
  await stat("method=" + m);
}
for (const n of ["3", "7"]) {
  await page.fill("#binsInput", n).catch(() => {});
  await page.$eval("#binsInput", (el, v) => { el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); }, n);
  await page.waitForTimeout(400);
  await stat("bins=" + n);
}
await page.check("#contCheck");
await page.waitForTimeout(400);
await stat("continuous");
await page.uncheck("#contCheck");

// hue swatches
const hues = await page.$$('.swatches[data-hue="hue"] .swatch');
await hues[2].click();
await page.waitForTimeout(400);
await stat("hue=teal");
await hues[0].click();

// diverging
await page.click('[data-k="diverging"]');
await page.waitForTimeout(500);
await stat("diverging");
await page.screenshot({ path: path.join(SHOTS, "control-diverging.png") });
await page.click('[data-k="sequential"]');
await page.waitForTimeout(400);

// labels + CVD + dark
await page.selectOption("#panel select >> nth=-3", "auto").catch(() => {});
await page.evaluate(() => {
  const sels = [...document.querySelectorAll("#panel select")];
  const labelSel = sels.find((s) => [...s.options].some((o) => o.value === "value"));
  labelSel.value = "auto"; labelSel.dispatchEvent(new Event("change", { bubbles: true }));
});
await page.waitForTimeout(500);
await stat("labels=auto");
await page.screenshot({ path: path.join(SHOTS, "control-labels.png") });

await page.evaluate(() => {
  const sels = [...document.querySelectorAll("#panel select")];
  const cvd = sels.find((s) => [...s.options].some((o) => o.value === "deuteranopia"));
  cvd.value = "deuteranopia"; cvd.dispatchEvent(new Event("change", { bubbles: true }));
});
await page.waitForTimeout(500);
await stat("cvd=deuteranopia");
await page.screenshot({ path: path.join(SHOTS, "control-cvd.png") });
await page.evaluate(() => {
  const sels = [...document.querySelectorAll("#panel select")];
  const cvd = sels.find((s) => [...s.options].some((o) => o.value === "deuteranopia"));
  cvd.value = "none"; cvd.dispatchEvent(new Event("change", { bubbles: true }));
});

await page.click('[data-t="dark"]');
await page.waitForTimeout(700);
await stat("theme=dark");
await page.screenshot({ path: path.join(SHOTS, "theme-dark.png") });
await page.selectOption("#sampleSel", "world-life");
await page.waitForTimeout(1000);
await page.screenshot({ path: path.join(SHOTS, "theme-dark-world.png") });
await page.click('[data-t="light"]');
await page.waitForTimeout(500);

// --- messy user paste, from the world map: should auto-switch to US states ---
console.log("\nmessy paste (auto-detect basemap):");
await page.selectOption("#sampleSel", "world-gdp");
await page.waitForTimeout(900);
const messy = `地区\t2024营收\n加州\t$1,234.5万\n德州\t980万\nNew York\t8,100,000\nFlorida\t7.2M\n火星\t999\n华盛顿特区\t120万`;
await page.fill("#raw", messy);
await page.waitForTimeout(2000);
const s = await stat("messy");
const mapNow = await page.$eval("#mapSel", (e) => e.value);
console.log("  basemap now:", mapNow);
if (mapNow !== "us-states") errors.push("auto-detect did not switch to us-states (got " + mapNow + ")");
if (s.tableRows !== 5) errors.push("messy paste matched " + s.tableRows + " rows, expected 5");
await page.screenshot({ path: path.join(SHOTS, "messy-paste.png") });

// tooltip — aim at the largest painted shape, not whatever nth=5 happens to be
await page.evaluate(() => {
  const best = [...document.querySelectorAll("svg#map .region")]
    .map((p) => ({ p, a: p.getBBox().width * p.getBBox().height }))
    .sort((x, y) => y.a - x.a)[0].p;
  const r = best.getBoundingClientRect();
  best.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 }));
});
await page.waitForTimeout(400);
const tipVisible = await page.evaluate(() => getComputedStyle(document.querySelector(".tooltip")).opacity);
console.log("tooltip opacity:", tipVisible);
if (tipVisible !== "1") errors.push("tooltip did not open on hover");
await page.screenshot({ path: path.join(SHOTS, "tooltip.png") });

// table view
await page.click("#tableView > summary");
await page.waitForTimeout(400);
await page.screenshot({ path: path.join(SHOTS, "table-view.png"), fullPage: true });

// exports
const dl = [];
page.on("download", (d) => dl.push(d.suggestedFilename()));
await page.selectOption("#sampleSel", "us-gdp");
await page.waitForTimeout(900);
for (const id of ["#btnSVG", "#btnCSV", "#btnPNG"]) {
  await page.click(id);
  await page.waitForTimeout(1400);
}
console.log("\ndownloads:", dl.join(", ") || "(none)");
if (dl.length < 3) errors.push("exports produced only " + dl.length + " files");

// narrow viewport
await page.setViewportSize({ width: 420, height: 900 });
await page.waitForTimeout(700);
await stat("mobile");
await page.screenshot({ path: path.join(SHOTS, "mobile.png"), fullPage: true });

await browser.close();
console.log("\n" + (errors.length ? "PROBLEMS:\n - " + errors.join("\n - ") : "no console/page errors, no layout overflow"));
process.exit(errors.length ? 1 : 0);
