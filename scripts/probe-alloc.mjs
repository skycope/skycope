// Probe: bytes allocated per walker.update (walk + camera), seed 1847.
import v8 from "node:v8";
import { island, walkerFor } from "../tests/interaction-harness.js";
import { islandPoint, ISLAND } from "../src/terrain.js";

const seed = Number(process.argv[2] ?? 1847);
island(seed);
const walker = walkerFor(seed);
const { cat, camera } = walker;
const HOME = Math.atan2(0 - ISLAND.z, 6 - ISLAND.x);
const p = islandPoint(HOME, 14);
cat.x = p.x; cat.z = p.z; cat.y = walker.surface(p.x, p.z);
cat.heading = HOME + Math.PI; camera.yaw = cat.heading;
const input = { move: [0, 1], run: false, jump: false };
for (let i = 0; i < 600; i++) walker.update(1 / 60, input, null); // warm the JIT
const before = v8.getHeapStatistics().total_allocated_bytes;
const N = 3000;
let jerk = 0;
for (let i = 0; i < N; i++) {
  input.move[0] = Math.sin(i / 90) * 0.6;
  input.jump = i % 240 === 0;
  walker.update(1 / 60, input, null);
}
const bytes = (v8.getHeapStatistics().total_allocated_bytes - before) / N;
console.log(JSON.stringify({ seed, bytesPerFrame: Math.round(bytes), end: [cat.x.toFixed(1), cat.z.toFixed(1)] }));
