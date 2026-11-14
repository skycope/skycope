// Which solids (body ones) and tiles are at a point: QA for a sweep hit.
//   node scripts/places-probe.mjs <seed> <x> <z> [y]
import { island, walkerFor } from "../tests/interaction-harness.js";
import { primitiveDistance } from "../src/blockers.js";
import { groundHeight } from "../src/terrain.js";

const [seed, x, z, yArg] = process.argv.slice(2).map(Number);
const { obstacles } = island(seed);
const walker = walkerFor(seed);
const s = walker.surface(x, z);
const y = Number.isFinite(yArg) ? yArg : s;
console.log({ ground: groundHeight(x, z), surface: s, y });
for (const q of walker.solids.list) {
  if (Math.abs(q.x - x) > q.r + 1 || Math.abs(q.z - z) > q.r + 1) continue;
  const d = primitiveDistance(q, x, y + 0.17, z);
  if (d < 0.3) console.log("solid", { k: q.k, body: q.body, d: +d.toFixed(3), x: +q.x.toFixed(2), z: +q.z.toFixed(2), y0: +q.y0.toFixed(2), y1: +q.y1.toFixed(2), rad: q.rad });
}
for (const t of obstacles.trunks) if (Math.hypot(t.x - x, t.z - z) < t.r + 0.5) console.log("trunk", t);
