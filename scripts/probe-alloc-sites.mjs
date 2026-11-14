// Probe: where the walker's per-frame allocations come from (sampling heap
// profiler, keeping objects the scavenger has already collected).
import { Session } from "node:inspector/promises";
import { island, walkerFor } from "../tests/interaction-harness.js";
import { islandPoint, ISLAND } from "../src/terrain.js";

const seed = 1847;
island(seed);
const walker = walkerFor(seed);
const { cat, camera } = walker;
const HOME = Math.atan2(0 - ISLAND.z, 6 - ISLAND.x);
const p = islandPoint(HOME, 14);
cat.x = p.x; cat.z = p.z; cat.y = walker.surface(p.x, p.z);
cat.heading = HOME + Math.PI; camera.yaw = cat.heading;
const input = { move: [0, 1], run: false, jump: false };
for (let i = 0; i < 600; i++) walker.update(1 / 60, input, null);
const session = new Session();
session.connect();
await session.post("HeapProfiler.startSampling", { samplingInterval: 256, includeObjectsCollectedByMinorGC: true, includeObjectsCollectedByMajorGC: true });
for (let i = 0; i < 3000; i++) {
  input.move[0] = Math.sin(i / 90) * 0.6;
  input.jump = i % 240 === 0;
  walker.update(1 / 60, input, null);
}
const { profile } = await session.post("HeapProfiler.stopSampling");
const sites = new Map();
const walk = (node, stack) => {
  const f = node.callFrame;
  const here = `${f.functionName || "(anon)"} ${f.url.split("/").pop()}:${f.lineNumber + 1}`;
  const self = node.selfSize;
  if (self) sites.set(here, (sites.get(here) ?? 0) + self);
  for (const c of node.children) walk(c, [...stack, here]);
};
walk(profile.head, []);
const total = [...sites.values()].reduce((a, b) => a + b, 0);
console.log("bytes/frame", (total / 3000).toFixed(0));
for (const [k, v] of [...sites].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log((v / 3000).toFixed(0).padStart(6), k);
