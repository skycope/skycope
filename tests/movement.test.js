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

// Measured: 32 KB per frame before (Math.hypot, terrain noise recomputed
// per sample, closure numbers re-boxed, iterator destructuring), about
// 9 KB after; what is left is numbers returned boxed from calls V8 does
// not inline. Young-generation garbage, but it adds up to scavenges.
test('the walker and its camera allocate little per frame', () => {
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
  assert.ok(bytes < 12 * 1024, `${bytes.toFixed(0)} bytes allocated per frame`);
});

// Every ceremony from three sides: where its wide shot ends, after the rig
// has settled. The lens clear of rock, solids, trunks and plant crowns, the
// place's top seen past the land and the landmarks. Counts the old,
// straight-on shot's failures alongside, for the report.
test('each ceremony ends on a clear view of its place', async () => {
  const { ceremonyFrames, placeGround, SHOTS } = await import('../src/journey.js');
  const { KEEPSAKES } = await import('../src/magic.js');
  const { forest, places, obstacles } = island(SEED);
  const walker = walkerFor(SEED);
  const { cat, camera, solids } = walker;
  const canopies = forest.obstacles.canopies;
  const crown = places.crown;
  const settle = (yaw, elevation, distance, look) => {
    walker.freeCamera(true);
    camera.yaw = yaw; camera.elevation = elevation; camera.distance = distance; camera.targetY = cat.y;
    walker.lookAt(look, 1);
    for (let i = 0; i < 120; i++) walker.update(1 / 60, { move: [0, 0], run: false, jump: false }, null);
    const view = { x: camera.x, y: camera.y, z: camera.z, azimuth: camera.azimuth + Math.PI / 4, pitch: camera.pitch };
    walker.lookAt(null);
    walker.freeCamera(false);
    return view;
  };
  const faults = (lens, subject) => {
    const out = [];
    if (solids.distance(lens.x, lens.y, lens.z, 1) < 0.25) out.push('lens at a solid');
    if (lens.y - walker.surface(lens.x, lens.z) < 0.3) out.push('lens at the ground');
    for (const c of canopies) if (Math.hypot(lens.x - c.x, lens.y - c.y, lens.z - c.z) < c.r * 0.8) { out.push('lens in a crown'); break; }
    for (const t of obstacles.trunks) if (Math.hypot(lens.x - t.x, lens.z - t.z) < t.r + 0.4 && lens.y < walker.surface(t.x, t.z) + 0.8 * Math.max(1.5, (t.r - 0.02) / 0.034)) { out.push('a trunk at the lens'); break; }
    const top = { x: subject.x, y: subject.y1, z: subject.z };
    // (The top is the landmark's own: the line may end in it, not short.)
    const f = solids.trace(lens.x, lens.y, lens.z, top.x, top.y, top.z, 0.05);
    if (f < 0.999 && Math.hypot(lens.x + (top.x - lens.x) * f - subject.x, lens.z + (top.z - lens.z) * f - subject.z) > subject.r) out.push('top behind a landmark');
    let leafy = 0;
    for (const c of canopies) {
      const ex = top.x - lens.x, ey = top.y - lens.y, ez = top.z - lens.z, ll = ex * ex + ey * ey + ez * ez;
      const t = Math.max(0, Math.min(1, ((c.x - lens.x) * ex + (c.y - lens.y) * ey + (c.z - lens.z) * ez) / ll));
      if (Math.hypot(lens.x + ex * t - c.x, lens.y + ey * t - c.y, lens.z + ez * t - c.z) < c.r * 0.7) leafy++;
    }
    if (leafy > 1) out.push(`${leafy} crowns in front`);
    // In the frame (58 degrees tall, wider across): the cat and the top.
    const inFrame = (p) => {
      const dx = p.x - lens.x, dz = p.z - lens.z;
      const across = Math.abs(Math.atan2(Math.sin(Math.atan2(dx, dz) - lens.azimuth), Math.cos(Math.atan2(dx, dz) - lens.azimuth)));
      const up = Math.abs(Math.atan2(p.y - lens.y, Math.hypot(dx, dz)) - lens.pitch);
      return across < 0.75 && up < 0.48;
    };
    if (!inFrame({ x: cat.x, y: cat.y + 0.15, z: cat.z })) out.push('cat out of frame');
    if (solids.trace(lens.x, lens.y, lens.z, cat.x, cat.y + 0.2, cat.z, 0.03) < 0.95) out.push('cat behind a landmark');
    if (!inFrame(top)) out.push('top out of frame');
    for (let i = 1; i < 16; i++) {
      const t = i / 16, x = lens.x + (top.x - lens.x) * t, z = lens.z + (top.z - lens.z) * t;
      if (lens.y + (top.y - lens.y) * t < walker.surface(x, z) - 0.05) { out.push('top behind the land'); break; }
    }
    return out;
  };
  let before = 0, after = 0, shots = 0;
  const report = [], old = [];
  for (const place of places.pois) {
    const gift = KEEPSAKES[place.id];
    if (!gift) continue;
    const r = place.r > 0 ? place.r : 4;
    for (const a of [0, 2.1, 4.2]) {
      const d = r + Math.max(1.5, r * 0.45) - 0.8;
      let x = place.x + Math.sin(a) * d, z = place.z + Math.cos(a) * d;
      for (let i = 0; i < 20 && walker.surface(x, z) < 0.05; i++) { x += (place.x - x) * 0.1; z += (place.z - z) * 0.1; }
      cat.x = x; cat.z = z; cat.y = walker.surface(x, z); cat.speed = cat.air = cat.vy = 0;
      cat.heading = Math.atan2(place.x - x, place.z - z);
      const ground = placeGround(place, walker.surface);
      const shot = SHOTS[gift] ?? SHOTS.default;
      const yaw = cat.heading;
      const frames = ceremonyFrames(walker, { place, gift, ground, shot, yaw, crown, canopies, fov: 1.0 });
      const was = faults(settle(yaw, shot.wide[0], shot.wide[1], null), frames.subject);
      const now = faults(settle(frames.wide.yaw, frames.wide.elevation, frames.wide.distance, frames.wide.look), frames.subject);
      shots++;
      if (was.length) { before++; old.push(`${place.id} from ${a}: ${was.join(', ')}`); }
      if (now.length) { after++; report.push(`${place.id} from ${a}: ${now.join(', ')}`); }
    }
  }
  console.log(`ceremony shots with a fault: ${before}/${shots} straight-on, ${after}/${shots} searched\n  was: ${old.join('\n  was: ')}\n  now: ${report.join('\n  now: ')}`);
  assert.ok(after <= 1, `ceremony shots still faulty:\n${report.join('\n')}`);
  assert.ok(after < before || before === 0, `no better than straight-on (${before} -> ${after})`);
});

// The first-visit audit's pins (G1-G3): W held with the camera following,
// walking straight at the two trunks it reproduced on, the wreck's keel and
// rib rows, and boulder flanks from four sides. Before: 10 s with no
// movement at both trunks. The cat may go round or hop; it may not stand
// still pressing for more than a few seconds.
test('walking straight at a trunk, the keel or a boulder never pins the cat', () => {
  const { obstacles } = island(SEED);
  const walker = walkerFor(SEED);
  const { cat, camera } = walker;
  const cases = [[62.0, 74.1, 0, true], [104.6, 62.1, 1.74, true]];
  for (const x of [-10, -7, -4]) { cases.push([x, 40.4, 0, true]); cases.push([x, 46.6, Math.PI, true]); }
  const big = obstacles.domes.filter((d) => !d.bridge && d.r > 1.2 && d.r < 4 && Math.hypot(d.x - ISLAND.x, d.z - ISLAND.z) < 60).slice(0, 6);
  for (const d of big) for (const a of [0, 1.6, 3.2, 4.7]) cases.push([d.x + Math.sin(a) * (d.r + 1), d.z + Math.cos(a) * (d.r + 1), a + Math.PI, false]);
  const fails = [];
  for (const [x, z, heading, mustPass] of cases) {
    cat.x = x; cat.z = z; cat.y = walker.surface(x, z); cat.heading = heading;
    if (walker.water(x, z).level > cat.y + 0.1) continue;
    cat.speed = cat.vy = cat.air = cat.turn = 0; cat.sit = cat.idle = 0; cat.swim = cat.wade = cat.water = 0;
    camera.yaw = heading; camera.elevation = 0.38; camera.distance = 3.4; camera.targetY = cat.y;
    const input = { move: [0, 1], run: false, jump: false };
    let still = 0, worst = 0, px = cat.x, pz = cat.z;
    for (let f = 0; f < 600; f++) {
      walker.update(1 / 60, input, null);
      if (f % 30 === 29) {
        still = Math.hypot(cat.x - px, cat.z - pz) < 0.05 ? still + 0.5 : 0;
        worst = Math.max(worst, still);
        px = cat.x; pz = cat.z;
      }
    }
    const moved = Math.hypot(cat.x - x, cat.z - z);
    if (worst > 3 || (mustPass && moved < 3)) fails.push(`(${x.toFixed(1)}, ${z.toFixed(1)}) heading ${heading.toFixed(2)}: pinned ${worst} s, moved ${moved.toFixed(1)} m`);
  }
  assert.equal(fails.length, 0, fails.join('\n'));
});

// Nothing grows up through a boulder: no plant or grass clump roots inside
// a rock's footprint where the rock stands out of the ground.
test('no plant roots inside a boulder', async () => {
  const { rockFootprints } = await import('../src/forest.js');
  const { createVegetation, vegetationLayout } = await import('../src/vegetation.js');
  const { rockLayout } = await import('../src/rocks.js');
  const { placeRocks } = await import('../src/place-rocks.js');
  const { seededRandom } = await import('../src/random.js');
  const rocks = placeRocks(SEED, rockLayout(seededRandom(SEED)));
  const onRock = rockFootprints(rocks);
  const before = vegetationLayout(SEED).filter((p) => onRock(p.x, p.z, 0)).length;
  const grown = createVegetation(SEED, { avoid: onRock });
  const plants = grown.layout.filter((p) => onRock(p.x, p.z, 0)).length;
  const turf = grown.turf.filter((t) => onRock(t.position.x, t.position.z, 0)).length;
  console.log(`plants rooted in a boulder: ${before} before, ${plants} after; grass clumps: ${turf}`);
  assert.equal(plants, 0);
  assert.equal(turf, 0);
});
