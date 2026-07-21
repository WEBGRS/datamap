import { chromium } from "playwright";
const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
await page.goto(process.env.BASE || "http://localhost:8123", { waitUntil: "networkidle" });
await page.waitForSelector("svg#map .region");
await page.waitForTimeout(800);
const root = await page.evaluate(() => ({
  scrollW: document.documentElement.scrollWidth,
  clientW: document.documentElement.clientWidth,
  tw: (() => { const n = document.querySelector(".tw"); return n ? { cw: n.clientWidth, sw: n.scrollWidth, scrolls: n.scrollWidth > n.clientWidth } : null; })(),
}));
console.log("root scrollWidth", root.scrollW, "clientWidth", root.clientW, "| page scrolls:", root.scrollW > root.clientW);
console.log(".tw", JSON.stringify(root.tw));
const bad = await page.evaluate(() => {
  const w = document.documentElement.clientWidth;
  // Ignore content that is legitimately inside its own horizontal scroller.
  const inScroller = (e) => {
    for (let p = e.parentElement; p; p = p.parentElement) {
      const ov = getComputedStyle(p).overflowX;
      if (ov === "auto" || ov === "scroll" || ov === "hidden") return true;
    }
    return false;
  };
  return [...document.querySelectorAll("*")]
    .filter((e) => !inScroller(e))
    .map((e) => ({ e, r: e.getBoundingClientRect() }))
    .filter(({ r }) => r.right > w + 1 && r.width > 0)
    .map(({ e, r }) => `${e.tagName.toLowerCase()}${e.id ? "#" + e.id : ""}${e.className && typeof e.className === "string" ? "." + e.className.split(" ").filter(Boolean).join(".") : ""} right=${r.right.toFixed(0)} w=${r.width.toFixed(0)}`)
    .slice(0, 20);
});
console.log("viewport 420 — overflowing:", bad.length ? "\n  " + bad.join("\n  ") : "none");
await browser.close();
