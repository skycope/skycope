// Markdown tables from scripts/loading-capture.mjs output (docs/review/loading/):
//   node scripts/loading-tables.mjs docs/review/loading
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2] ?? "docs/review/loading";
const read = (name) => (existsSync(join(dir, name)) ? JSON.parse(readFileSync(join(dir, name), "utf8")) : null);

// Timing: per strip run (production build, Fast 3G, CPU 4×), ms from navigation.
for (const label of ["before", "after"]) {
  const runs = read(`${label}-strips.json`);
  if (!runs) continue;
  console.log(`\n### ${label}: production build, Fast 3G, CPU 4× (ms from navigation)\n`);
  console.log("| case | first paint | veil sky drawn | main.js fetched | first real frame | world shown |");
  console.log("|---|---|---|---|---|---|");
  for (const r of runs)
    console.log(`| ${r.name.replace(`${label}-`, "")} | ${r.firstPaint ?? "–"} | ${r.marks.painted ?? "–"} | ${r.mainFetched ?? "–"} | ${r.ready ?? "–"} | ${r.marks.shown ?? "–"} |`);
}

// Colour agreement summary.
const rows = read("after-colour-agreement.json");
if (rows) {
  const group = {};
  for (const r of rows) {
    const region = r.view === "home" ? "first view (horizon to 15°, sea −1°)" : r.view === "up" ? "30° to zenith" : "open sea (horizon, −1° to −15°)";
    const key = `${r.scene} | ${region}`;
    (group[key] ??= []).push(r);
  }
  console.log("\n### colour agreement, veil vs rendered sky/sea canvases (CIE76 ΔE; max channel difference in sRGB levels)\n");
  console.log("| scene | region | samples | median ΔE | max ΔE | median max-channel |");
  console.log("|---|---|---|---|---|---|");
  const median = (v) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)];
  for (const [key, v] of Object.entries(group))
    console.log(`| ${key} | ${v.length} | ${median(v.map((r) => r.deltaE)).toFixed(1)} | ${Math.max(...v.map((r) => r.deltaE)).toFixed(1)} | ${median(v.map((r) => r.maxChannel))} |`);
}
