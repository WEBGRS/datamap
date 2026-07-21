// Download every raw source the data + sample builders read. Run before them.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WIKI = "https://en.wikipedia.org/w/api.php?action=parse&prop=wikitext&format=json&formatversion=2&page=";

const SOURCES = {
  "iso3166.json": "https://raw.githubusercontent.com/lukes/ISO-3166-Countries-with-Regional-Codes/master/all/all.json",
  "wiki_gdp.json": WIKI + "List_of_U.S._states_and_territories_by_GDP",
  "co-est.csv": "https://www2.census.gov/programs-surveys/popest/datasets/2020-2024/counties/totals/co-est2024-alldata.csv",
  "wb_gdp.json": "https://api.worldbank.org/v2/country/all/indicator/NY.GDP.MKTP.CD?date=2024&format=json&per_page=400",
  "wb_pcap.json": "https://api.worldbank.org/v2/country/all/indicator/NY.GDP.PCAP.CD?date=2024&format=json&per_page=400",
  "wb_pop.json": "https://api.worldbank.org/v2/country/all/indicator/SP.POP.TOTL?date=2024&format=json&per_page=400",
  "wb_life.json": "https://api.worldbank.org/v2/country/all/indicator/SP.DYN.LE00.IN?date=2023&format=json&per_page=400",
};

const force = process.argv.includes("--force");
for (const [name, url] of Object.entries(SOURCES)) {
  const dest = path.join(HERE, name);
  if (fs.existsSync(dest) && !force) { console.log("  ·", name, "(cached)"); continue; }
  const res = await fetch(url, { headers: { "user-agent": "datamap-build/1.0 (build script)" } });
  if (!res.ok) { console.error("  ✗", name, res.status); process.exitCode = 1; continue; }
  const body = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, body);
  console.log("  +", name, (body.length / 1024).toFixed(0) + "KB");
}
