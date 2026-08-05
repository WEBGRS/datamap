// Verify the deployed site actually renders, not just that it returns 200.
import { chromium } from "playwright";

const URL = process.env.URL || "https://webgrs.github.io/datamap/";
const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1340, height: 900 } });
const problems = [];
const failedReqs = [];
page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") problems.push("console: " + m.text()); });
page.on("requestfailed", (r) => failedReqs.push(`${r.url()} — ${r.failure()?.errorText}`));
page.on("response", (r) => { if (r.status() >= 400) failedReqs.push(`${r.status()} ${r.url()}`); });

console.log("GET", URL);
const res = await page.goto(URL, { waitUntil: "networkidle", timeout: 60000 });
console.log("http", res.status());

await page.waitForSelector("svg#map .region", { timeout: 30000 });
await page.waitForTimeout(1500);

const s = await page.evaluate(() => ({
  regions: document.querySelectorAll("svg#map .region").length,
  painted: [...document.querySelectorAll("svg#map .region")]
    .filter((p) => p.getAttribute("fill") !== getComputedStyle(document.documentElement).getPropertyValue("--nodata").trim()).length,
  title: document.querySelector("#chartTitle")?.value,
  tiles: document.querySelectorAll("#tiles .tile").length,
  legend: document.querySelectorAll("#legend .lg-bin").length,
  rows: document.querySelectorAll("#tableHost table.data tbody tr").length,
  samples: document.querySelectorAll("#sampleSel option").length - 1,
  hscroll: document.documentElement.scrollWidth > document.documentElement.clientWidth,
}));
console.log(JSON.stringify(s, null, 1));

if (s.painted !== 51) problems.push(`expected 51 painted states, got ${s.painted}`);
if (s.samples !== 10) problems.push(`expected 10 samples, got ${s.samples}`);
if (s.hscroll) problems.push("page scrolls horizontally");

// exercise the two heaviest data files over the network
for (const [sample, expect] of [["world-gdp", 199], ["county-pop", 3133]]) {
  await page.selectOption("#sampleSel", sample);
  await page.waitForSelector(`#tableCount`);
  await page.waitForFunction((n) => document.querySelectorAll("#tableHost table.data tbody tr").length >= n, expect - 5, { timeout: 120000 }).catch(() => {});
  const n = await page.$$eval("#tableHost table.data tbody tr", (r) => r.length);
  console.log(`${sample}: ${n} rows`);
  if (n < expect - 5) problems.push(`${sample} loaded ${n} rows, expected ~${expect}`);
}

await page.screenshot({ path: "shots/live.png" });
await browser.close();

if (failedReqs.length) console.log("failed requests:\n  " + failedReqs.join("\n  "));
console.log(problems.length ? "\nPROBLEMS:\n - " + problems.join("\n - ") : "\nlive site OK");
process.exit(problems.length || failedReqs.length ? 1 : 0);
