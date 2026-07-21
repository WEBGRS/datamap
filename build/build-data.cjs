// Build vendored assets + region lookup tables from npm atlases.
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const NM = path.join(ROOT, "node_modules");
const DATA = path.join(ROOT, "data");
const VENDOR = path.join(ROOT, "vendor");
fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(VENDOR, { recursive: true });

const cp = (from, to) => {
  fs.copyFileSync(from, to);
  console.log("  +", path.relative(ROOT, to), (fs.statSync(to).size / 1024).toFixed(0) + "KB");
};

// --- vendor libs ---
console.log("vendor:");
cp(path.join(NM, "d3/dist/d3.min.js"), path.join(VENDOR, "d3.min.js"));
cp(path.join(NM, "topojson-client/dist/topojson-client.min.js"), path.join(VENDOR, "topojson-client.min.js"));

// --- geometry ---
console.log("geometry:");
cp(path.join(NM, "us-atlas/states-albers-10m.json"), path.join(DATA, "us-states-10m.json"));
cp(path.join(NM, "us-atlas/counties-albers-10m.json"), path.join(DATA, "us-counties-10m.json"));
cp(path.join(NM, "world-atlas/countries-50m.json"), path.join(DATA, "world-countries-50m.json"));

// --- US states: fips / abbr / name / zh ---
const US_STATES = [
  ["01","AL","Alabama","阿拉巴马"],["02","AK","Alaska","阿拉斯加"],["04","AZ","Arizona","亚利桑那"],
  ["05","AR","Arkansas","阿肯色"],["06","CA","California","加利福尼亚"],["08","CO","Colorado","科罗拉多"],
  ["09","CT","Connecticut","康涅狄格"],["10","DE","Delaware","特拉华"],["11","DC","District of Columbia","华盛顿哥伦比亚特区"],
  ["12","FL","Florida","佛罗里达"],["13","GA","Georgia","佐治亚"],["15","HI","Hawaii","夏威夷"],
  ["16","ID","Idaho","爱达荷"],["17","IL","Illinois","伊利诺伊"],["18","IN","Indiana","印第安纳"],
  ["19","IA","Iowa","艾奥瓦"],["20","KS","Kansas","堪萨斯"],["21","KY","Kentucky","肯塔基"],
  ["22","LA","Louisiana","路易斯安那"],["23","ME","Maine","缅因"],["24","MD","Maryland","马里兰"],
  ["25","MA","Massachusetts","马萨诸塞"],["26","MI","Michigan","密歇根"],["27","MN","Minnesota","明尼苏达"],
  ["28","MS","Mississippi","密西西比"],["29","MO","Missouri","密苏里"],["30","MT","Montana","蒙大拿"],
  ["31","NE","Nebraska","内布拉斯加"],["32","NV","Nevada","内华达"],["33","NH","New Hampshire","新罕布什尔"],
  ["34","NJ","New Jersey","新泽西"],["35","NM","New Mexico","新墨西哥"],["36","NY","New York","纽约"],
  ["37","NC","North Carolina","北卡罗来纳"],["38","ND","North Dakota","北达科他"],["39","OH","Ohio","俄亥俄"],
  ["40","OK","Oklahoma","俄克拉何马"],["41","OR","Oregon","俄勒冈"],["42","PA","Pennsylvania","宾夕法尼亚"],
  ["44","RI","Rhode Island","罗得岛"],["45","SC","South Carolina","南卡罗来纳"],["46","SD","South Dakota","南达科他"],
  ["47","TN","Tennessee","田纳西"],["48","TX","Texas","得克萨斯"],["49","UT","Utah","犹他"],
  ["50","VT","Vermont","佛蒙特"],["51","VA","Virginia","弗吉尼亚"],["53","WA","Washington","华盛顿州"],
  ["54","WV","West Virginia","西弗吉尼亚"],["55","WI","Wisconsin","威斯康星"],["56","WY","Wyoming","怀俄明"],
  ["72","PR","Puerto Rico","波多黎各"],
];

// Colloquial short forms that normalisation alone would not reach.
const US_ALIAS_EXTRA = {
  DC: ["Washington, D.C.", "Washington DC", "Washington D.C.", "华盛顿特区", "哥伦比亚特区", "Dist. of Columbia"],
  CA: ["加州"], TX: ["德州", "德克萨斯州", "得州"], NY: ["纽约州"], FL: ["佛州"],
  PA: ["宾州", "宾夕法尼亚州"], MA: ["麻省", "麻州"], CT: ["康州"], NJ: ["新泽西州"],
  IL: ["伊州"], WA: ["华盛顿州", "华州"], GA: ["乔治亚", "乔治亚州"], MI: ["密州"],
  VA: ["弗州"], NC: ["北卡"], SC: ["南卡"], ND: ["北达"], SD: ["南达"],
  WI: ["威州", "威斯康辛", "威斯康辛州"], MN: ["明州"], MD: ["马州"], OH: ["俄州"],
  HI: ["夏威夷州"], AK: ["阿拉斯加州"], NM: ["新墨州"], NH: ["新罕布什尔州"],
};

const usTopo = JSON.parse(fs.readFileSync(path.join(DATA, "us-states-10m.json"), "utf8"));
const usIds = new Set(usTopo.objects.states.geometries.map((g) => g.id));
const usRegions = US_STATES.filter(([fips]) => usIds.has(fips)).map(([id, abbr, name, zh]) => ({
  id, name, zh,
  aliases: [abbr, name, zh, zh + "州", name.replace(/\s+/g, ""), "US-" + abbr, id, ...(US_ALIAS_EXTRA[abbr] || [])],
}));
console.log("us states:", usRegions.length, "of", usIds.size, "geometries");

// --- US counties: fips -> "County, ST" ---
const cTopo = JSON.parse(fs.readFileSync(path.join(DATA, "us-counties-10m.json"), "utf8"));
const fipsToAbbr = Object.fromEntries(US_STATES.map(([f, a]) => [f, a]));
const countyRegions = cTopo.objects.counties.geometries.map((g) => {
  const st = fipsToAbbr[String(g.id).slice(0, 2)] || "";
  const nm = g.properties.name;
  return { id: String(g.id), name: st ? `${nm}, ${st}` : nm, zh: "", aliases: [String(g.id), nm, `${nm} County, ${st}`, `${nm}, ${st}`, `${nm} ${st}`] };
});
console.log("us counties:", countyRegions.length);

// --- World countries: numeric -> iso2/iso3/en/zh ---
const iso = JSON.parse(fs.readFileSync(path.join(__dirname, "iso3166.json"), "utf8"));
const byNum = new Map();
for (const r of iso) {
  const num = String(r["country-code"]).padStart(3, "0");
  byNum.set(num, { iso2: r["alpha-2"], iso3: r["alpha-3"], isoName: r.name });
}
// Atlas ids without an ISO row (disputed / non-standard).
const EXTRA = {
  "-99": { iso2: "", iso3: "", isoName: "", zh: "" },
  "900": { iso2: "", iso3: "", isoName: "", zh: "" },
};
const ALIAS_EXTRA = {
  CN: ["中国", "中华人民共和国", "China", "Mainland China", "PRC", "People's Republic of China"],
  US: ["美国", "United States", "United States of America", "USA", "U.S.", "U.S.A.", "America"],
  GB: ["英国", "United Kingdom", "UK", "Great Britain", "Britain", "England"],
  RU: ["俄罗斯", "俄国", "Russia", "Russian Federation"],
  KR: ["韩国", "南韩", "South Korea", "Korea, South", "Republic of Korea", "Korea"],
  KP: ["朝鲜", "北朝鲜", "North Korea", "Korea, North", "DPRK"],
  IR: ["伊朗", "Iran", "Iran, Islamic Rep."],
  VN: ["越南", "Vietnam", "Viet Nam"],
  LA: ["老挝", "Laos", "Lao PDR"],
  SY: ["叙利亚", "Syria", "Syrian Arab Republic"],
  VE: ["委内瑞拉", "Venezuela", "Venezuela, RB"],
  BO: ["玻利维亚", "Bolivia"],
  TZ: ["坦桑尼亚", "Tanzania"],
  CD: ["刚果（金）", "刚果民主共和国", "DR Congo", "Democratic Republic of the Congo", "Congo, Dem. Rep.", "Congo-Kinshasa", "Zaire"],
  CG: ["刚果（布）", "刚果共和国", "Republic of the Congo", "Congo, Rep.", "Congo-Brazzaville", "Congo"],
  CI: ["科特迪瓦", "象牙海岸", "Ivory Coast", "Cote d'Ivoire", "Côte d’Ivoire"],
  CZ: ["捷克", "Czech Republic", "Czechia"],
  MM: ["缅甸", "Myanmar", "Burma"],
  MK: ["北马其顿", "Macedonia", "North Macedonia"],
  SZ: ["斯威士兰", "Swaziland", "Eswatini"],
  TR: ["土耳其", "Turkey", "Turkiye", "Türkiye"],
  NL: ["荷兰", "Netherlands", "Holland", "The Netherlands"],
  AE: ["阿联酋", "UAE", "United Arab Emirates"],
  EG: ["埃及", "Egypt", "Egypt, Arab Rep."],
  HK: ["香港", "Hong Kong", "Hong Kong SAR, China"],
  MO: ["澳门", "Macao", "Macau"],
  TW: ["台湾", "Taiwan", "Chinese Taipei", "Taiwan, China"],
  SLB: [], // placeholder ignored
};

const wTopo = JSON.parse(fs.readFileSync(path.join(DATA, "world-countries-50m.json"), "utf8"));
const zhNames = new Intl.DisplayNames(["zh-Hans"], { type: "region" });
const enNames = new Intl.DisplayNames(["en"], { type: "region" });
const missing = [];
// Atlas entries with no ISO numeric id get a synthetic stable id.
const SYNTH = { Kosovo: ["XK", "XKX", "科索沃"], Somaliland: ["", "", "索马里兰"], "N. Cyprus": ["", "", "北塞浦路斯"] };
const worldRegions = wTopo.objects.countries.geometries.map((g) => {
  const atlasName = g.properties.name;
  const id = g.id == null ? "x-" + atlasName.toLowerCase().replace(/[^a-z]+/g, "-") : String(g.id);
  const rec = byNum.get(id) || EXTRA[id];
  if (!rec) missing.push(`${id} ${atlasName}`);
  if (!rec && SYNTH[atlasName]) {
    const [i2, i3, z] = SYNTH[atlasName];
    const al = new Set([id, atlasName, z, i2, i3].filter(Boolean));
    return { id, name: atlasName, zh: z, iso2: i2, iso3: i3, aliases: [...al] };
  }
  const iso2 = rec ? rec.iso2 : "";
  let zh = "";
  let enAlt = "";
  if (iso2) {
    try { zh = zhNames.of(iso2) || ""; } catch {}
    try { enAlt = enNames.of(iso2) || ""; } catch {}
  }
  const aliases = new Set([id, atlasName, atlasName.replace(/\s+/g, "")]);
  if (rec) { if (rec.iso2) aliases.add(rec.iso2); if (rec.iso3) aliases.add(rec.iso3); if (rec.isoName) aliases.add(rec.isoName); }
  if (zh) { aliases.add(zh); aliases.add(zh.replace(/[（(].*[)）]/g, "")); }
  if (enAlt) aliases.add(enAlt);
  for (const a of ALIAS_EXTRA[iso2] || []) aliases.add(a);
  return { id, name: atlasName, zh, iso2, iso3: rec ? rec.iso3 : "", aliases: [...aliases].filter(Boolean) };
});
console.log("world countries:", worldRegions.length, "| no ISO row:", missing.length, missing.slice(0, 20).join(" | "));

const out = (f, obj) => {
  fs.writeFileSync(path.join(DATA, f), JSON.stringify(obj));
  console.log("  +", "data/" + f, (fs.statSync(path.join(DATA, f)).size / 1024).toFixed(0) + "KB");
};
out("regions-us-states.json", usRegions);
out("regions-us-counties.json", countyRegions);
// Dedupe by id (e.g. Ashmore & Cartier Is. shares ISO 036 with Australia); merge aliases.
const wByeId = new Map();
for (const r of worldRegions) {
  const prev = wByeId.get(r.id);
  if (prev) prev.aliases = [...new Set([...prev.aliases, ...r.aliases])];
  else wByeId.set(r.id, r);
}
out("regions-world.json", [...wByeId.values()]);
