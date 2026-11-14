// Dense trap sweep round the landmarks only (QA density: 0.5 m grid,
// eight headings), for one or more seeds. Prints every trap, solid entered
// or stand on air (tests/sweep.js).
//   node scripts/places-sweep.mjs [seed=1847 …] [--only=wreck,lighthouse]
import { sweep } from "../tests/sweep.js";
import { placesLayout } from "../src/place-layout.js";
import { shoreDistance } from "../src/terrain.js";

const args = process.argv.slice(2);
const only = args.find((a) => a.startsWith("--only="))?.slice(7).split(",");
const seeds = args.filter((a) => !a.startsWith("--")).map(Number);
for (const seed of seeds.length ? seeds : [1847]) {
  const points = [];
  for (const p of placesLayout(seed)) {
    if (only && !only.includes(p.id)) continue;
    const r = p.id === "lighthouse" ? 18 : p.id === "milkwood" ? 15 : 9;
    for (let x = p.x - r; x <= p.x + r; x += 0.5)
      for (let z = p.z - r; z <= p.z + r; z += 0.5)
        if (Math.hypot(x - p.x, z - p.z) <= r && shoreDistance(x, z) > -6) points.push({ x, z, near: p.id });
  }
  const t = Date.now();
  const found = sweep(seed, { points, headings: 8, seconds: 1.5 });
  console.log(`seed ${seed}: ${points.length} starts, ${found.length} problems (${((Date.now() - t) / 1000).toFixed(0)} s)`);
  for (const f of found) console.log(" ", JSON.stringify(f));
}
