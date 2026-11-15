import test from "node:test";
import assert from "node:assert/strict";
import { levelAt, fadeWidth, packMargin, createLodChunk, chunkLevel, packChunk, packDue, fadeScale, easeBias } from "../src/instance-lod.js";

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

// What an instance looks like from the eye at distance d: the scale it is
// drawn at in each level it is packed into (0 where it is not packed).
function drawn(chunk, index, d) {
  return chunk.outputs.map((out, level) => {
    for (let k = 0; k < chunk.counts[level]; k++)
      if (out.canopyShade[k] === index) return fadeScale(out.fade.slice(k * 4, k * 4 + 4), d);
    return 0;
  });
}

test("each instance chooses its own level by its own distance", () => {
  assert.equal(levelAt(5, LEVELS), 0);
  assert.equal(levelAt(11, LEVELS), 1);
  assert.equal(levelAt(70, LEVELS), 2);
  // A chunk straddling the 11 m boundary draws its near instances in full
  // and its far ones as cards; those near the band are in both.
  const chunk = row([3, 5, 14, 18]);
  const counts = packChunk(chunk, [0, 0, 0]);
  assert.deepEqual(counts, [2, 2, 0]);
  assert.equal(chunk.state, -1);
  // Instances keep their own attributes through the packing.
  assert.deepEqual([...chunk.outputs[1].canopyShade.slice(0, 2)], [2, 3]);
  // The far level's matrices carry its growth; translation is untouched.
  assert.ok(Math.abs(chunk.outputs[1].matrix[0] - 1.12) < 1e-6);
  assert.equal(chunk.outputs[1].matrix[12], 14);
  // One in the band is drawn at both levels.
  assert.deepEqual(packChunk(row([10]), [0, 0, 0]), [1, 1, 0]);
});

test("the render budget's bias pulls every level in, a step at a time", () => {
  assert.equal(levelAt(10, LEVELS, 1), 0);
  assert.equal(levelAt(10, LEVELS, 0.85), 1);
  // Bias is followed in steps of 0.02, then lands.
  assert.equal(easeBias(undefined, 0.72), 0.72);
  assert.ok(Math.abs(easeBias(1, 0.72) - 0.98) < 1e-9);
  assert.ok(Math.abs(easeBias(0.73, 0.72) - 0.72) < 1e-9);
});

test("a whole chunk well inside one level is packed once, not per instance", () => {
  const chunk = row([20, 25, 30]);
  assert.equal(chunkLevel(chunk, [0, 0, 0]), 1);
  packChunk(chunk, [0, 0, 0]);
  assert.equal(chunk.state, 1);
  assert.equal(packDue(chunk, [0.2, 0, 0], 1), false);
  // Near a band (within the margin the eye may move) it goes per instance.
  assert.equal(chunkLevel(row([11.5, 15]), [0, 0, 0]), -1);
  // A straddling chunk is re-packed once the eye has moved part of the margin.
  const mixed = row([4, 8, 12, 18]);
  packChunk(mixed, [0, 0, 0]);
  assert.equal(packDue(mixed, [0.2, 0, 0], 1), false);
  assert.equal(packDue(mixed, [packMargin(4), 0, 0], 1), true);
  // And everything is re-packed when the bias changes.
  assert.equal(packDue(chunk, [0, 0, 0], 0.85), true);
});

test("no swaps: across a band both levels are drawn, the coarse one emerging as the fine one shrinks away", () => {
  // The second instance is dropped by the far level.
  const chunk = row([55, 56], (i) => (i === 0 ? 0b111 : 0b011));
  packChunk(chunk, [0, 0, 0]);
  const boundary = 60, width = fadeWidth(boundary);
  const before = boundary - width - 0.5 + 0.1;
  // Full size at its level before the band; the coarse level packed (the
  // margin) but drawn at nothing, so packing it is never seen.
  assert.deepEqual(drawn(chunk, 0, before).map((s) => +s.toFixed(3)), [0, 1, 0]);
  // Through the band the fine one shrinks smoothly to nothing while the
  // coarse one grows from 90% to full: the outline never falls below 90%.
  let last = drawn(chunk, 0, before);
  for (let d = before; d <= boundary + 1; d += 0.02) {
    const s = drawn(chunk, 0, d);
    assert.ok(Math.max(s[1], s[2]) >= 0.9 - 1e-9, `outline held at ${d.toFixed(2)} m`);
    assert.ok(Math.abs(s[1] - last[1]) < 0.05 && Math.abs(s[2] - last[2]) < 0.05, `no jump at ${d.toFixed(2)} m`);
    last = s;
  }
  assert.deepEqual(drawn(chunk, 0, boundary + 0.2).map((s) => +s.toFixed(3)), [0, 0, 1]);
  // The dropped one shrinks to nothing over the same band.
  const mid = drawn(chunk, 1, boundary - width / 2 + 0.1)[1];
  assert.ok(mid > 0.3 && mid < 0.7);
  assert.equal(drawn(chunk, 1, boundary + 0.2)[1], 0);
  // An instance that first appears at a level grows in from nothing.
  const late = row([55], () => 0b100);
  packChunk(late, [0, 0, 0]);
  assert.equal(+drawn(late, 0, before)[2].toFixed(3), 0);
  assert.equal(+drawn(late, 0, boundary + 0.2)[2].toFixed(3), 1);
  // The last level never fades; and a mesh without the attribute reads
  // (0, 0, 0, 1): full size.
  assert.equal(fadeScale([0, 0, 0, 1], 5), 1);
  assert.equal(fadeScale([0, 0, 0, 1], 500), 1);
});

test("a late re-pack is never seen: the eye may move up to the margin and every instance is still drawn", () => {
  const distances = Array.from({ length: 80 }, (_, i) => 1 + i);
  const chunk = row(distances);
  packChunk(chunk, [0, 0, 0]);
  const margin = packMargin(chunk.min[0] - chunk.maxRadius) * 0.6;
  for (const shift of [-margin, margin])
    distances.forEach((d, i) => {
      const s = drawn(chunk, i, d - shift);
      assert.ok(Math.max(...s) >= 0.9 - 1e-9, `instance at ${d} m drawn with the eye moved ${shift.toFixed(2)} m`);
    });
});

test("through a sliced shadow refresh, packing serves the held shadow eye as well as the camera's", () => {
  const distances = Array.from({ length: 60 }, (_, i) => 1 + i);
  const chunk = row(distances);
  const held = [0, 0, 0];
  packChunk(chunk, held);
  // The camera walks on 6 m (re-packing as it goes); the shadow pass's eye
  // stays where the refresh began, and sees every instance just as then.
  const before = distances.map((d, i) => drawn(chunk, i, d));
  for (let x = 0.5; x <= 6; x += 0.5) packChunk(chunk, [x, 0, 0], 1, held);
  distances.forEach((d, i) => {
    const now = drawn(chunk, i, d);
    now.forEach((s, level) => assert.ok(Math.abs(s - before[i][level]) < 1e-6, `instance at ${d} m, level ${level}: ${before[i][level]} -> ${s}`));
  });
  // And for the camera too.
  distances.forEach((d, i) => assert.ok(Math.max(...drawn(chunk, i, Math.abs(d - 6))) >= 0.9 - 1e-9, `camera sees ${d} m`));
});
