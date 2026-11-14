import test from "node:test";
import assert from "node:assert/strict";
import { levelAt, fadeWidth, createLodChunk, chunkLevel, packChunk, packDue, fadeScale } from "../src/instance-lod.js";

// Levels like the leafy shoots': full, then cards, then half of them grown.
const LEVELS = [
  { start: 0, grow: 1 },
  { start: 11, grow: 1.12 },
  { start: 60, grow: 1.9 },
];

// A row of instances along +x at the given distances (radius 0.1).
function row(distances, keep = () => 0b111) {
  const n = distances.length;
  const positions = new Float32Array(n * 3);
  const matrix = new Float32Array(n * 16);
  const shade = new Float32Array(n);
  distances.forEach((d, i) => {
    positions[i * 3] = d;
    matrix.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, d, 0, 0, 1], i * 16);
    shade[i] = i;
  });
  const chunk = createLodChunk({
    positions,
    radii: new Float32Array(n).fill(0.1),
    kept: Uint8Array.from(distances, (d, i) => keep(i)),
    fields: [{ name: "matrix", size: 16, data: matrix }, { name: "canopyShade", size: 1, data: shade }],
    levels: LEVELS,
  });
  chunk.outputs = LEVELS.map(() => ({ matrix: new Float32Array(n * 16), canopyShade: new Float32Array(n), fade: new Float32Array(n * 4) }));
  return chunk;
}

test("each instance chooses its own level by its own distance", () => {
  assert.equal(levelAt(5, LEVELS), 0);
  assert.equal(levelAt(11, LEVELS), 1);
  assert.equal(levelAt(70, LEVELS), 2);
  // A chunk straddling the 11 m boundary draws its near instances in full
  // and its far ones as cards (the old chunk-centre choice drew them all
  // at one level).
  const chunk = row([4, 8, 12, 18]);
  const counts = packChunk(chunk, [0, 0, 0]);
  assert.deepEqual(counts, [2, 2, 0]);
  assert.equal(chunk.state, -1);
  // Instances keep their own attributes through the packing.
  assert.deepEqual([...chunk.outputs[1].canopyShade.slice(0, 2)], [2, 3]);
  // The far level's matrices carry its growth; translation is untouched.
  assert.ok(Math.abs(chunk.outputs[1].matrix[0] - 1.12) < 1e-6);
  assert.equal(chunk.outputs[1].matrix[12], 12);
});

test("the render budget's bias pulls every level in", () => {
  assert.equal(levelAt(10, LEVELS, 1), 0);
  assert.equal(levelAt(10, LEVELS, 0.85), 1);
  assert.deepEqual(packChunk(row([4, 8, 10, 18]), [0, 0, 0], 0.72), [2, 2, 0]);
});

test("a whole chunk inside one band is packed once, not per instance", () => {
  const chunk = row([20, 25, 30]);
  assert.equal(chunkLevel(chunk, [0, 0, 0]), 1);
  packChunk(chunk, [0, 0, 0]);
  assert.equal(chunk.state, 1);
  assert.equal(packDue(chunk, [0.2, 0, 0], 1), false);
  // A straddling chunk is re-packed once the eye has moved far enough.
  const mixed = row([4, 8, 12, 18]);
  packChunk(mixed, [0, 0, 0]);
  assert.equal(packDue(mixed, [0.2, 0, 0], 1), false);
  assert.equal(packDue(mixed, [1.5, 0, 0], 1), true);
  // And everything is re-packed when the bias changes.
  assert.equal(packDue(chunk, [0, 0, 0], 0.85), true);
});

test("no pops: dropped instances shrink to nothing and kept ones grow to the next size before the swap", () => {
  // The second instance is dropped by the far level.
  const chunk = row([50, 52], (i) => (i === 0 ? 0b111 : 0b011));
  packChunk(chunk, [0, 0, 0]);
  const fade = chunk.outputs[1].fade;
  const kept = [...fade.slice(0, 4)];
  const dropped = [...fade.slice(4, 8)];
  const boundary = 60;
  // Full size until the band, which ends at the boundary.
  assert.equal(fadeScale(kept, boundary - fadeWidth(boundary) - 0.5 + 0.1), 1);
  // At the boundary the kept one is already the far level's size (relative
  // to this level's), so the swap changes only its part count...
  assert.ok(Math.abs(fadeScale(kept, boundary + 0.1) - 1.9 / 1.12) < 1e-6);
  // ...and the dropped one is gone.
  assert.equal(fadeScale(dropped, boundary + 0.1), 0);
  // In between, it changes smoothly.
  const mid = fadeScale(dropped, boundary - fadeWidth(boundary) / 2 + 0.1);
  assert.ok(mid > 0.3 && mid < 0.7);
  // The last level never fades; and a mesh without the attribute reads
  // (0, 0, 0, 1): full size.
  assert.equal(fadeScale([1e9, 1, 1, 1], 500), 1);
  assert.equal(fadeScale([0, 0, 0, 1], 5), 1);
});
