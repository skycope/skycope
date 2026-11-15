// The previous veil's sky model (src/loading-screen.js at b00fa07, its
// skyColour, coast-metre directions) against the same rendered samples as
// docs/review/loading/after-colour-agreement.json, sky samples only (it
// painted land below the horizon, so its sea is not comparable).
//   node scripts/loading-before-colours.mjs <checkout of b00fa07> docs/review/loading
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [tree, dir = "docs/review/loading"] = process.argv.slice(2);
const { skyColour } = await import(join(tree, "src/loading-screen.js"));
const { skyAt } = await import(join(tree, "src/astronomy.js"));
const { presetWeather } = await import(join(tree, "src/weather-panel.js"));
const MIN = { dawn: 350, noon: 750, golden: 1145, dusk: 1188, night: 1320 };
const lab = (rgb) => {
  const l = rgb.map((v) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = f((0.4124 * l[0] + 0.3576 * l[1] + 0.1805 * l[2]) / 0.95047);
  const y = f(0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2]);
  const z = f((0.0193 * l[0] + 0.1192 * l[1] + 0.9505 * l[2]) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
};
const deltaE = (a, b) => Math.hypot(...lab(a).map((v, i) => v - lab(b)[i]));
const rows = JSON.parse(readFileSync(join(dir, "after-colour-agreement.json"), "utf8")).filter((r) => r.ray[1] > 0);
const out = rows.map((r) => {
  const [time, weather] = r.scene.split("-");
  const [e, up, n] = r.ray;
  const coast = [(e + n) * Math.SQRT1_2, up, (n - e) * Math.SQRT1_2];
  const before = skyColour(skyAt(new Date(Date.UTC(2026, 10, 15, 0, MIN[time]) - 7200000)), presetWeather(weather), coast);
  return { scene: r.scene, view: r.view, sample: r.sample, world: r.world, before, deltaE: Number(deltaE(before, r.world).toFixed(1)), after: r.deltaE };
});
writeFileSync(join(dir, "before-colour-agreement.json"), JSON.stringify(out, null, 2));
const median = (v) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)];
const by = {};
for (const r of out) (by[r.scene] ??= []).push(r);
console.log("| scene | sky samples | before median ΔE | before max ΔE | after median ΔE | after max ΔE |");
console.log("|---|---|---|---|---|---|");
for (const [k, v] of Object.entries(by))
  console.log(`| ${k} | ${v.length} | ${median(v.map((r) => r.deltaE)).toFixed(1)} | ${Math.max(...v.map((r) => r.deltaE)).toFixed(1)} | ${median(v.map((r) => r.after)).toFixed(1)} | ${Math.max(...v.map((r) => r.after)).toFixed(1)} |`);
