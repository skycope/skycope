import v8 from "node:v8";
import { island, walkerFor } from "../tests/interaction-harness.js";
import { islandPoint, ISLAND, groundHeight, shoreDistance } from "../src/terrain.js";
import { seabedDepth, shoreAlong } from "../src/sea-surface.js";

const seed = 1847;
island(seed);
const walker = walkerFor(seed);
const { cat, camera, solids } = walker;
const HOME = Math.atan2(0 - ISLAND.z, 6 - ISLAND.x);
const p = islandPoint(HOME, 14);
const bytes = (name, f, n = 20000) => {
  for (let i = 0; i < 2000; i++) f(i);
  const b = v8.getHeapStatistics().total_allocated_bytes;
  for (let i = 0; i < n; i++) f(i);
  console.log(name, ((v8.getHeapStatistics().total_allocated_bytes - b) / n).toFixed(1));
};
bytes("surface", (i) => walker.surface(p.x + (i % 100) * 0.01, p.z));
bytes("groundHeight", (i) => groundHeight(p.x + (i % 100) * 0.01, p.z));
bytes("shoreDistance", (i) => shoreDistance(p.x + (i % 100) * 0.01, p.z));
bytes("seabedDepth", (i) => seabedDepth(3 + (i % 100) * 0.01, 0.4));
bytes("shoreAlong", (i) => shoreAlong(p.x + (i % 100) * 0.01, p.z));
bytes("solids.distance", (i) => solids.distance(p.x + (i % 100) * 0.01, 1, p.z, 0.4));
bytes("solids.touches", (i) => solids.touches(p.x + (i % 100) * 0.01, 1, p.z, 0.1));
bytes("solids.trace", (i) => solids.trace(p.x, 1, p.z, p.x + 3, 2, p.z + (i % 100) * 0.01, 0.4));
bytes("Math.hypot3", (i) => Math.hypot(i, 2, 3));
