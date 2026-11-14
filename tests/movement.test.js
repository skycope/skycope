// Movement and camera QA without a GPU (thread D): the rig's springs, the
// cat never snagging on a trunk, the lens clear of trunks and ground and
// never stepping, and the walker's per-frame allocations.
import test from 'node:test';
import assert from 'node:assert/strict';
import v8 from 'node:v8';
import { spring } from '../src/walker.js';
import { island, walkerFor } from './interaction-harness.js';
import { ISLAND, islandPoint } from '../src/terrain.js';

const SEED = 1847;
const HOME = Math.atan2(0 - ISLAND.z, 6 - ISLAND.x);

test('the rig spring is critically damped and frame-rate independent', () => {
  for (const omega of [2.4, 9, 14]) {
    const a = { x: 1, v: 0 }, b = { x: 1, v: 0 };
    let min = Infinity;
    for (let i = 0; i < 30; i++) { spring(a, 0, omega, 1 / 30); min = Math.min(min, a.x); }
    for (let i = 0; i < 120; i++) spring(b, 0, omega, 1 / 120);
    assert.ok(min >= -1e-12, `no overshoot (ω ${omega}: ${min})`);
    assert.ok(Math.abs(a.x - b.x) < 1e-9, `30 fps and 120 fps agree (${a.x} vs ${b.x})`);
    assert.ok(a.x < Math.exp(-omega * 1) * (1 + omega) + 1e-9, 'settles at the critical rate');
  }
  // A spring started moving toward the target still never passes it.
  const s = { x: 1, v: -3 };
  for (let i = 0; i < 200; i++) { spring(s, 0, 9, 1 / 60); assert.ok(s.x > -1e-9, `${s.x}`); }
});

// Trunks with open ground round them (no other trunk, rock or water within
// a few metres), for walking at.
function openTrunks(obstacles, walker, n) {
  const out = [];
  for (const t of obstacles.trunks) {
    if (t.r > 0.4 || t.r < 0.06) continue;
    const crowded = obstacles.trunks.some((o) => o !== t && Math.hypot(o.x - t.x, o.z - t.z) < 3);
    if (crowded) continue;
    const g = walker.surface(t.x, t.z);
    let flat = true;
    for (let k = 0; k < 8 && flat; k++) {
      const a = (k / 8) * Math.PI * 2;
      const x = t.x + Math.sin(a) * 2.5, z = t.z + Math.cos(a) * 2.5;
      if (Math.abs(walker.surface(x, z) - g) > 0.5 || walker.solids.distance(x, g + 0.3, z, 1) < 0.5 || walker.water(x, z).level > walker.surface(x, z)) flat = false;
    }
    if (flat) out.push(t);
    if (out.length >= n) break;
  }
  return out;
}

test('a cat walking into a trunk slides round it and never snags', () => {
  const { obstacles } = island(SEED);
  const walker = walkerFor(SEED);
  const { cat, camera } = walker;
  const trunks = openTrunks(obstacles, walker, 12);
  assert.ok(trunks.length >= 6, `found ${trunks.length} open trunks`);
  const input = { move: [0, 1], run: false, jump: false };
  let worst = Infinity;
  for (const t of trunks) {
    for (const [a, offset] of [[0.3, 0], [1.9, 0.04], [3.5, -0.08], [5.0, t.r * 0.8]]) {
      // From 1.6 m out, heading straight at the trunk (offset sideways).
      const hx = -Math.sin(a), hz = -Math.cos(a);
      cat.x = t.x + Math.sin(a) * 1.6 + hz * offset;
      cat.z = t.z + Math.cos(a) * 1.6 - hx * offset;
      cat.y = walker.surface(cat.x, cat.z);
      cat.heading = Math.atan2(hx, hz);
      camera.yaw = cat.heading;
      cat.speed = cat.vy = cat.air = cat.turn = 0;
      cat.sit = cat.idle = 0;
      for (let f = 0; f < 240; f++) {
        // Keep wanting the same direction (keys are camera-relative).
        camera.yaw = Math.atan2(hx, hz);
        walker.update(1 / 60, input, null);
      }
      // How far past the trunk the cat got, along the way it wanted to go.
      const past = (cat.x - t.x) * hx + (cat.z - t.z) * hz;
      worst = Math.min(worst, past);
      assert.ok(past > 0.6, `trunk at (${t.x.toFixed(1)}, ${t.z.toFixed(1)}) r ${t.r.toFixed(2)}, approach ${a}/${offset}: only ${past.toFixed(2)} m past it`);
    }
  }
});

// Scripted walks through the forest and up the hill: every frame, the lens
// is clear of trunks and the ground, and its velocity never jumps (a step).
test('the follow camera stays clear of trunks and ground and never steps', () => {
  const walker = walkerFor(SEED);
  const { cat, camera, solids } = walker;
  const { obstacles } = island(SEED);
  const routes = [
    { from: islandPoint(HOME, 9), weave: 0.7 },
    { from: islandPoint(HOME + 0.25, 16), run: true, weave: 0.4 },
    { from: islandPoint(HOME + 0.8, 26), weave: 0.5 },
    { from: islandPoint(HOME - 0.6, 12), turn: Math.PI / 2, weave: 0.9 },
  ];
  const dt = 1 / 60;
  let worstStep = 0, landmarkSteps = 0, worstTrunk = Infinity, worstGround = Infinity, frames = 0;
  for (const r of routes) {
    cat.x = r.from.x; cat.z = r.from.z; cat.y = walker.surface(cat.x, cat.z);
    // Inland (toward the island's centre), or turned from it.
    cat.heading = Math.atan2(ISLAND.x - cat.x, ISLAND.z - cat.z) + (r.turn ?? 0);
    camera.yaw = cat.heading; camera.elevation = 0.38; camera.distance = 3.4; camera.targetY = cat.y;
    cat.speed = cat.vy = cat.air = 0;
    const input = { move: [0, 1], run: Boolean(r.run), jump: false };
    let p0 = null, p1 = null;
    for (let f = 0; f < 600; f++) {
      input.move[0] = Math.sin(f / 70) * r.weave;
      input.jump = f % 150 === 75;
      walker.update(dt, input, null);
      frames++;
      const p = [camera.x, camera.y, camera.z];
      if (p0 && p1) {
        const dv = Math.hypot(p[0] - 2 * p1[0] + p0[0], p[1] - 2 * p1[1] + p0[1], p[2] - 2 * p1[2] + p0[2]) / dt;
        // Within a metre of a landmark's solid (the wreck's ribs), the
        // last-resort guard may still pull the lens in a step: counted.
        if (solids.distance(camera.x, camera.y, camera.z, 1) < 1) { if (dv > 1.5) landmarkSteps++; }
        else worstStep = Math.max(worstStep, dv);
      }
      p0 = p1; p1 = p;
      worstGround = Math.min(worstGround, camera.y - walker.surface(camera.x, camera.z));
      for (const t of obstacles.trunks) {
        const dx = camera.x - t.x, dz = camera.z - t.z;
        if (Math.abs(dx) > 2 || Math.abs(dz) > 2) continue;
        // (The stem is solid up to about 80% of the tree's height.)
        const crown = walker.surface(t.x, t.z) + 0.8 * Math.max(1.5, (t.r - 0.02) / 0.034);
        if (camera.y < crown) worstTrunk = Math.min(worstTrunk, Math.hypot(dx, dz) - t.r);
      }
      assert.ok(solids.distance(camera.x, camera.y, camera.z, 1) > 0.05, 'lens inside a solid');
    }
  }
  assert.ok(worstTrunk > 0.1, `lens within ${worstTrunk.toFixed(3)} m of a trunk`);
  assert.ok(worstGround > 0.2, `lens ${worstGround.toFixed(3)} m above the ground`);
  // A velocity change of a few m/s within one 60 fps frame reads as a jolt
  // (before the rig's fixes: 150-165 m/s). The arm drawing in for a trunk
  // peaks near 1 m/s per frame, the lens bending round bark near 2.2.
  assert.ok(landmarkSteps < frames * 0.005, `${landmarkSteps} steps beside landmarks`);
  assert.ok(worstStep < 2.5, `the lens's velocity jumped ${worstStep.toFixed(2)} m/s in one frame (${frames} frames)`);
});

test('the walker and its camera allocate (almost) nothing per frame', () => {
  island(SEED);
  const walker = walkerFor(SEED);
  const { cat, camera } = walker;
  const p = islandPoint(HOME, 14);
  cat.x = p.x; cat.z = p.z; cat.y = walker.surface(p.x, p.z);
  cat.heading = Math.atan2(ISLAND.x - p.x, ISLAND.z - p.z); camera.yaw = cat.heading;
  const input = { move: [0, 1], run: false, jump: false };
  for (let i = 0; i < 600; i++) walker.update(1 / 60, input, null);
  const before = v8.getHeapStatistics().total_allocated_bytes;
  const N = 2000;
  for (let i = 0; i < N; i++) {
    input.move[0] = Math.sin(i / 90) * 0.6;
    input.jump = i % 240 === 0;
    walker.update(1 / 60, input, null);
  }
  const bytes = (v8.getHeapStatistics().total_allocated_bytes - before) / N;
  assert.ok(bytes < 2048, `${bytes.toFixed(0)} bytes allocated per frame`);
});
