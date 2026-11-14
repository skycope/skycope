// Probe: the first-visit audit's head-on pins (G1-G3), W held with the
// camera following: does the cat get past trunks, the wreck's keel and
// boulder flanks?
import { island, walkerFor } from "../tests/interaction-harness.js";
import { ISLAND, groundHeight } from "../src/terrain.js";

const { obstacles } = island(1847);
const walker = walkerFor(1847);
const { cat, camera } = walker;
const cases = [[62.0, 74.1, 0], [104.6, 62.1, 1.74]];
// The wreck's stick lines (object audit): walk at them across.
for (const x of [-10, -7, -4]) { cases.push([x, 40.4, 0]); cases.push([x, 46.6, Math.PI]); }
// Boulder flanks: the big rocks ashore, from 2.5 m out on four sides.
const big = obstacles.domes.filter((d) => !d.bridge && d.r > 1.2 && d.r < 4 && Math.hypot(d.x - ISLAND.x, d.z - ISLAND.z) < 60).slice(0, 6);
for (const d of big) for (const a of [0, 1.6, 3.2, 4.7]) cases.push([d.x + Math.sin(a) * (d.r + 1), d.z + Math.cos(a) * (d.r + 1), a + Math.PI]);
let stuck = 0;
for (const [x, z, heading] of cases) {
  cat.x = x; cat.z = z; cat.y = walker.surface(x, z); cat.heading = heading;
  if (cat.y < groundHeight(x, z) - 0.01 || walker.water(x, z).level > cat.y + 0.1) continue;
  cat.speed = cat.vy = cat.air = cat.turn = 0; cat.sit = cat.idle = 0;
  camera.yaw = heading; camera.elevation = 0.38; camera.distance = 3.4; camera.targetY = cat.y;
  const input = { move: [0, 1], run: false, jump: false };
  let still = 0, worst = 0;
  let px = cat.x, pz = cat.z;
  for (let f = 0; f < 600; f++) {
    walker.update(1 / 60, input, null);
    if (f % 30 === 29) {
      // Less than 5 cm in half a second counts as pinned.
      still = Math.hypot(cat.x - px, cat.z - pz) < 0.05 ? still + 0.5 : 0;
      worst = Math.max(worst, still);
      px = cat.x; pz = cat.z;
    }
  }
  const moved = Math.hypot(cat.x - x, cat.z - z);
  if (worst >= 2 || moved < 2) stuck++;
  console.log(`${x.toFixed(1)},${z.toFixed(1)} h ${heading.toFixed(2)}: moved ${moved.toFixed(2)} m, longest pin ${worst} s`);
}
console.log("pinned cases:", stuck);
