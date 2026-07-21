// Regression checks for the stateful bits the smoke test doesn't cover.
import { chromium } from "playwright";

const BASE = process.env.BASE || "http://localhost:8123";
const browser = await chromium.launch({ channel: "msedge" });
const ctx = await browser.newContext({ viewport: { width: 1340, height: 900 } });
const page = await ctx.newPage();
const fails = [];
const check = (name, cond, detail = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (!cond) fails.push(name);
};
page.on("pageerror", (e) => fails.push("pageerror: " + e.message));

const paint = () => page.$$eval("svg#map .region", (ps, na) => ps.filter((p) => p.getAttribute("fill") !== na).length,
  "#ebeae5");
const settle = (ms = 900) => page.waitForTimeout(ms);

await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForSelector("svg#map .region");
await settle();

// 1. three-column paste: value column must be switchable
await page.fill("#raw", "州,人口,面积\nCalifornia,39,163\nTexas,30,268\nAlaska,0.7,663\nNew York,19,54");
await settle(1600);
const cols = await page.$$eval("#valSel option", (os) => os.map((o) => o.textContent));
check("3-column paste populates pickers", cols.length === 3, cols.join(" | "));
const maxWithPop = await page.$eval("#tiles .tile:nth-child(2) dd", (e) => e.textContent);
await page.selectOption("#valSel", "2"); // 面积
await settle();
const maxWithArea = await page.$eval("#tiles .tile:nth-child(2) dd", (e) => e.textContent);
check("switching value column changes the map", maxWithPop !== maxWithArea, `${maxWithPop} -> ${maxWithArea}`);
check("area column ranks Alaska first", (await page.$eval("#tiles .tile:nth-child(2) dd small", (e) => e.textContent)).includes("阿拉斯加"));

// 2. reload keeps state
await settle(400);
await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector("svg#map .region");
await settle(1200);
check("state survives reload", (await page.$eval("#raw", (e) => e.value)).includes("面积"));
check("value column survives reload", (await page.$eval("#valSel", (e) => e.value)) === "2");

// 3. clear
await page.click("text=清空");
await settle();
check("clear empties the map", (await paint()) === 0);
check("clear empties the legend", (await page.$eval("#legend", (e) => e.textContent)).includes("尚无数据"));

// 4. continuous legend + no bins
await page.selectOption("#sampleSel", "us-gdp");
await settle(1200);
await page.check("#contCheck");
await settle();
check("continuous shows a gradient legend", (await page.$$("#legend .lg-cont")).length === 1);
check("continuous hides the class slider", (await page.$eval("#binsField", (e) => e.style.display)) === "none");
check("continuous still paints every region", (await paint()) === 51);
await page.uncheck("#contCheck");

// 5. diverging: symmetric quantile must not collapse into one neutral class
await page.selectOption("#sampleSel", "county-growth");
await settle(2800);
const spread = await page.evaluate(() => {
  const counts = {};
  for (const p of document.querySelectorAll("svg#map .region")) {
    const f = p.getAttribute("fill");
    counts[f] = (counts[f] || 0) + 1;
  }
  const vals = Object.values(counts).sort((a, b) => b - a);
  return { classes: vals.length, biggestShare: vals[0] / vals.reduce((a, b) => a + b, 0) };
});
check("diverging spreads across classes", spread.biggestShare < 0.5, `largest class = ${(spread.biggestShare * 100).toFixed(0)}%`);

// 6. reverse flips the ramp
await page.selectOption("#sampleSel", "us-gdp");
await settle(1200);
const caBefore = await page.$eval('[data-id="06"]', (e) => e.getAttribute("fill"));
await page.click("text=反转 Reverse");
await settle();
const caAfter = await page.$eval('[data-id="06"]', (e) => e.getAttribute("fill"));
check("reverse repaints", caBefore !== caAfter, `${caBefore} -> ${caAfter}`);
await page.click("text=反转 Reverse");

// 7. click a region -> table row highlight
await page.click('[data-id="48"]'); // Texas
await settle(600);
check("clicking a region selects it", (await page.$$('[data-id="48"].sel')).length === 1);
check("clicking a region opens the table", await page.$eval("#tableView", (e) => e.open));

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILING: ${fails.join(", ")}` : "\nall regression checks pass");
process.exit(fails.length ? 1 : 0);
