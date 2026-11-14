// Probe: one pinned case, frame by frame.
//   node scripts/probe-pin2.mjs x z heading [frames]
import { island, walkerFor } from "../tests/interaction-harness.js";
import { groundHeight } from "../src/terrain.js";

const [x, z, heading, frames = 120] = process.argv.slice(2).map(Number);
island(1847);
const walker = walkerFor(1847);
const { cat, camera } = walker;
cat.x = x; cat.z = z; cat.y = walker.surface(x, z); cat.heading = heading;
camera.yaw = heading; camera.elevation = 0.38; camera.distance = 3.4; camera.targetY = cat.y;
const input = { move: [0, 1], run: false, jump: false };
for (let f = 0; f < frames; f++) {
  walker.update(1 / 60, input, null);
  if (f % 6 === 0) {
    const ahead = walker.surface(cat.x + Math.sin(cat.heading) * 0.2, cat.z + Math.cos(cat.heading) * 0.2);
    console.log(f, "pos", cat.x.toFixed(3), cat.z.toFixed(3), "y", cat.y.toFixed(2), "g", groundHeight(cat.x, cat.z).toFixed(2), "ahead", ahead.toFixed(2), "h", cat.heading.toFixed(2), "yaw", camera.yaw.toFixed(2), "spd", cat.speed.toFixed(2), "air", cat.air.toFixed(2));
  }
}
