import { buildRamp, HUES, contrast, hexToOklch, deltaE, simulateCVD } from "../src/color.js";

const SURF = { light: "#fcfcfb", dark: "#1a1a19" };
let fails = 0;
const row = (s) => console.log(s);

for (const mode of ["light", "dark"]) {
  for (const hue of Object.keys(HUES)) {
    for (const n of [3, 5, 7]) {
      const r = buildRamp({ kind: "sequential", hue, n, mode });
      const Ls = r.map((h) => hexToOklch(h)[0]);
      // monotone in the direction the mode anchors
      const dir = Ls[0] > Ls[Ls.length - 1] ? -1 : 1;
      const mono = Ls.every((v, i) => i === 0 || (dir > 0 ? v > Ls[i - 1] : v < Ls[i - 1]));
      const minDL = Math.min(...Ls.slice(1).map((v, i) => Math.abs(v - Ls[i])));
      // step furthest from the surface anchor must stay readable; adjacent steps must separate
      const minDE = Math.min(...r.slice(1).map((h, i) => deltaE(h, r[i])));
      const cvdMin = Math.min(
        ...["protanopia", "deuteranopia"].flatMap((k) =>
          r.slice(1).map((h, i) => deltaE(simulateCVD(h, k), simulateCVD(r[i], k)))
        )
      );
      const ok = mono && minDL >= 0.05 && minDE >= 4 && cvdMin >= 4;
      if (!ok) fails++;
      row(`${ok ? "PASS" : "FAIL"} seq ${mode.padEnd(5)} ${hue.padEnd(8)} n=${n} minΔL=${minDL.toFixed(3)} minΔE=${minDE.toFixed(1)} cvdΔE=${cvdMin.toFixed(1)}`);
    }
  }
  for (const n of [3, 5, 7]) {
    const r = buildRamp({ kind: "diverging", hue: "blue", hue2: "red", n, mode });
    const cmin = Math.min(...r.map((h) => contrast(h, SURF[mode])));
    const minDE = Math.min(...r.slice(1).map((h, i) => deltaE(h, r[i])));
    const cvdMin = Math.min(
      ...["protanopia", "deuteranopia"].flatMap((k) =>
        r.slice(1).map((h, i) => deltaE(simulateCVD(h, k), simulateCVD(r[i], k)))
      )
    );
    const ok = minDE >= 4 && cvdMin >= 3;
    if (!ok) fails++;
    row(`${ok ? "PASS" : "FAIL"} div ${mode.padEnd(5)} blue↔red n=${n} minΔE=${minDE.toFixed(1)} cvdΔE=${cvdMin.toFixed(1)} minContrast=${cmin.toFixed(2)}  ${r.join(" ")}`);
  }
}
console.log(fails ? `\n${fails} FAILING` : "\nall ramps pass");
process.exit(fails ? 1 : 0);
