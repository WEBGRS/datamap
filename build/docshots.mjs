// Capture the README screenshots at 1x so they stay small.
import { chromium } from "playwright";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const DOCS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "docs");
fs.mkdirSync(DOCS, { recursive: true });

const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1340, height: 880 }, deviceScaleFactor: 1 });
await page.goto(process.env.BASE || "http://localhost:8123", { waitUntil: "networkidle" });
await page.waitForSelector("svg#map .region");

const setTheme = (t) => page.click(`[data-t="${t}"]`);
const shot = async (name, sample, theme = "light", wait = 1200) => {
  await setTheme(theme);
  await page.selectOption("#sampleSel", sample);
  await page.waitForTimeout(wait);
  await page.screenshot({ path: path.join(DOCS, name + ".png") });
  console.log("  +", name + ".png");
};

await shot("hero-us-gdp", "us-gdp");
await shot("county-growth", "county-growth", "light", 2600);
await shot("dark-world", "world-life", "dark", 1600);
await setTheme("light");
await browser.close();
for (const f of fs.readdirSync(DOCS)) console.log("   ", f, (fs.statSync(path.join(DOCS, f)).size / 1024).toFixed(0) + "KB");
