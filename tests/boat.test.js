import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createForest } from "../src/forest.js";
import { createPlaces } from "../src/places.js";
import { createWalker } from "../src/walker.js";
import { createSea } from "../src/sea-surface.js";
import { createWaveModes } from "../src/wave-modes.js";
import { swellUniform } from "../src/swell.js";
import { shoreDistance } from "../src/terrain.js";
import { seededRandom } from "../src/random.js";
import { createBoatDynamics, BOAT, findMooring } from "../src/boat-dynamics.js";

const SEEDS = [1, 1847, 99999];

// The island as the walker knows it: forest rocks and trunks, the places'
// tiles and solids, and the sea on its own clock.
const worlds = new Map();
function world(seed, wind = [4, 2]) {
  if (worlds.has(seed)) return worlds.get(seed);
  const land = new THREE.Group();
  const forest = createForest(land, seed);
  const places = createPlaces(land, seed, { shared: land.userData.forestShared });
  const obstacles = forest.obstacles;
  obstacles.trunks.push(...places.obstacles.trunks);
  obstacles.domes.push(...places.obstacles.domes);
  obstacles.blockers = places.blockers;
  const modes = createWaveModes(seed);
  const sea = createSea(seed, modes.data);
  const walker = createWalker(obstacles, sea, null);
  const swell = swellUniform(seed, wind);
  const tick = (t) => {
    modes.update(t, wind);
    sea.set(t, swell, wind);
  };
  const w = { forest, places, walker, sea, tick, boatPoi: places.pois.find((p) => p.id === "boat") };
  worlds.set(seed, w);
  return w;
}

test("the boat finds a mooring in its cove, afloat and clear", () => {
  for (const seed of SEEDS) {
    const { walker, sea, tick, boatPoi } = world(seed);
    tick(10);
    assert.ok(boatPoi, `seed ${seed}: a boat landmark`);
    const m = findMooring(boatPoi.x, boatPoi.z, walker.bed);
    assert.ok(m, `seed ${seed}: a mooring`);
    const off = -shoreDistance(m.x, m.z);
    assert.ok(off > 2 && off < 22, `seed ${seed}: mooring ${off.toFixed(1)} m out`);
    const boat = createBoatDynamics({ sea, bed: walker.bed, solids: walker.solids });
    boat.place(m.x, m.z, m.heading);
    assert.ok(boat.probe(m.x, m.z, m.heading) <= 0.02, `seed ${seed}: clear of the bed`);
  }
});

test("random sailing for ten minutes stays on the water, clear and inside the limit", () => {
  for (const seed of SEEDS) {
    const { walker, sea, tick, boatPoi } = world(seed);
    const m = findMooring(boatPoi.x, boatPoi.z, walker.bed);
    const boat = createBoatDynamics({ sea, bed: walker.bed, solids: walker.solids });
    tick(0);
    boat.place(m.x, m.z, m.heading);
    const random = seededRandom(seed * 7 + 3);
    const dt = 1 / 30;
    let input = { dir: [0, 1], throttle: 1, hurry: false };
    let next = 0;
    let farthest = 0;
    let worst = 0;
    let travelled = 0;
    let lastX = m.x, lastZ = m.z;
    for (let t = 0; t < 600; t += dt) {
      if (t > next) {
        next = t + 3 + random() * 15;
        const a = random() * Math.PI * 2;
        // Mostly outward or along the shore, now and then straight in.
        input = { dir: [Math.sin(a), Math.cos(a)], throttle: random() < 0.15 ? 0 : 1, hurry: random() < 0.3 };
      }
      tick(t);
      const s = boat.step(dt, input);
      for (const k of ["x", "z", "heading", "vx", "vz", "r", "y", "pitch", "roll", "level", "slopeX", "slopeZ"])
        assert.ok(Number.isFinite(s[k]), `seed ${seed}: ${k} finite at ${t.toFixed(1)} s`);
      assert.ok(shoreDistance(s.x, s.z) < 0, `seed ${seed}: on land at ${t.toFixed(1)} s`);
      farthest = Math.max(farthest, s.offshore);
      // A keel may touch the sand as a trough passes; never a boulder.
      const d = boat.probe(s.x, s.z, s.heading);
      if (boat.contact.rock) worst = Math.max(worst, d);
      else assert.ok(d < 0.4 && shoreDistance(s.x, s.z) < -1.5, `seed ${seed}: up the beach by ${d.toFixed(2)} at ${t.toFixed(1)} s`);
      travelled += Math.hypot(s.x - lastX, s.z - lastZ);
      lastX = s.x;
      lastZ = s.z;
    }
    assert.ok(farthest <= BOAT.outer + 0.5, `seed ${seed}: ${farthest.toFixed(1)} m out`);
    assert.ok(worst < 0.12, `seed ${seed}: into the bed or a rock by ${worst.toFixed(3)} m`);
    assert.ok(travelled > 150, `seed ${seed}: it sails (${travelled.toFixed(0)} m)`);
  }
});

test("held outward, the sea turns it home inside the outer limit", () => {
  const { walker, sea, tick, boatPoi } = world(1847);
  const m = findMooring(boatPoi.x, boatPoi.z, walker.bed);
  const boat = createBoatDynamics({ sea, bed: walker.bed, solids: walker.solids });
  tick(0);
  boat.place(m.x, m.z, m.heading);
  const s = boat.state;
  let max = 0;
  for (let t = 0; t < 400; t += 1 / 30) {
    tick(t);
    const ox = s.x - 58, oz = s.z - 70, r = Math.hypot(ox, oz);
    boat.step(1 / 30, { dir: [ox / r, oz / r], throttle: 1, hurry: true });
    max = Math.max(max, s.offshore);
  }
  assert.ok(max > BOAT.outerSoft, `reached the open sea (${max.toFixed(1)})`);
  assert.ok(max <= BOAT.outer + 0.5, `never past the limit (${max.toFixed(1)})`);
  // Let go: it drifts back inside the soft limit.
  for (let t = 400; t < 520; t += 1 / 30) {
    tick(t);
    boat.step(1 / 30, {});
  }
  assert.ok(s.offshore < BOAT.outer - 2, `turned home (${s.offshore.toFixed(1)})`);
});

test("sailed straight at the beach, it grounds on the sand and stops", () => {
  const { walker, sea, tick, boatPoi } = world(1847);
  const m = findMooring(boatPoi.x, boatPoi.z, walker.bed);
  const boat = createBoatDynamics({ sea, bed: walker.bed, solids: walker.solids });
  tick(0);
  boat.place(m.x, m.z, m.heading);
  const s = boat.state;
  let grounded = false;
  for (let t = 0; t < 60; t += 1 / 30) {
    tick(t);
    const ix = 58 - s.x, iz = 70 - s.z, r = Math.hypot(ix, iz);
    boat.step(1 / 30, { dir: [ix / r, iz / r], throttle: 1 });
    if (s.bowGrounded) grounded = true;
    assert.ok(shoreDistance(s.x, s.z) < 0);
  }
  assert.ok(grounded, "the bow grounds");
});

test("the ride: woken, launched by a push, board by pushing at the hull, steer, jump out, beach", async () => {
  const { createBoatRide, RIDE } = await import("../src/boat-ride.js");
  const { createMagic } = await import("../src/magic.js");
  const { walker, sea, tick, places } = world(1847);
  const landmark = places.layout.find((p) => p.id === "boat");
  const magic = createMagic();
  const ride = createBoatRide({ landmark, sea, bed: walker.bed, solids: walker.solids, magic });
  const cat = walker.cat;
  const none = { move: [0, 0], run: false, jump: false };
  const dt = 1 / 30;
  let t = 0;
  const run = (seconds, input = none, yaw = 0) => {
    let carried = false;
    for (let end = t + seconds; t < end; t += dt) {
      tick(t);
      carried = ride.update(dt, input, cat, yaw);
    }
    return carried;
  };
  run(1);
  assert.equal(ride.ride.state, "asleep");
  assert.equal(ride.deck(ride.state.x, ride.state.z), -Infinity, "no deck while asleep");
  magic.wake("boat");
  run(3);
  assert.equal(ride.ride.state, "ready", "woken, it waits on its logs for the cat");
  // The cat pushes at the upturned hull from beside it.
  const fx0 = Math.sin(landmark.facing), fz0 = Math.cos(landmark.facing);
  Object.assign(cat, { x: landmark.x + fz0 * 1.15, z: landmark.z - fx0 * 1.15, air: 0 });
  cat.y = walker.surface(cat.x, cat.z);
  run(0.1, { move: [0, 1], run: false, jump: false }, Math.atan2(landmark.x - cat.x, landmark.z - cat.z));
  assert.equal(ride.ride.state, "launching");
  for (let k = 0; k < 40 && ride.ride.state === "launching"; k++) run(0.5);
  assert.equal(ride.ride.state, "waiting");
  assert.ok(Number.isFinite(ride.deck(ride.state.x, ride.state.z)), "a deck afloat");
  // The cat beside the hull, pushing toward it.
  const s = ride.state;
  const side = { x: s.x + Math.cos(s.heading) * 1.1, z: s.z - Math.sin(s.heading) * 1.1 };
  Object.assign(cat, { x: side.x, z: side.z, y: s.y - 0.3, air: 0 });
  const toward = Math.atan2(s.x - cat.x, s.z - cat.z);
  run(0.1, { move: [0, 1], run: false, jump: false }, toward);
  assert.equal(ride.ride.state, "boarding");
  run(RIDE.hop + 0.2);
  assert.equal(ride.ride.state, "aboard");
  assert.ok(ride.carries(cat));
  assert.ok(cat.y > s.y, "the cat stands above the water in the boat");
  assert.equal(cat.waterY, -Infinity);
  // Steer out to sea for a while: it moves, carrying the cat.
  const x0 = s.x, z0 = s.z;
  const out = Math.atan2(s.x - 58, s.z - 70);
  assert.ok(run(20, { move: [0, 1], run: true, jump: false }, out));
  assert.ok(Math.hypot(s.x - x0, s.z - z0) > 8, "it sailed");
  assert.ok(Math.hypot(cat.x - s.x, cat.z - s.z) < 2.5, "the cat goes with it");
  for (const k of ["x", "y", "z", "heading"]) assert.ok(Number.isFinite(cat[k]));
  // Jump out near shore: handed back to the walker, airborne.
  if (s.offshore < RIDE.jumpLimit) {
    const carried = run(dt * 1.5, { move: [0, 0], run: false, jump: true }, out);
    assert.equal(carried, false);
    assert.ok(cat.air > 0 && cat.vy > 0, "leapt");
    assert.ok(["waiting", "adrift"].includes(ride.ride.state));
  }
});

test("the cove mooring and the launch glide keep clear of boulders and landmark solids", async () => {
  const { createBoatRide } = await import("../src/boat-ride.js");
  const { rockyAt } = await import("../src/boat-dynamics.js");
  for (const seed of SEEDS) {
    const { walker, sea, places } = world(seed);
    const landmark = places.layout.find((p) => p.id === "boat");
    const ride = createBoatRide({ landmark, sea, bed: walker.bed, solids: walker.solids });
    const m = ride.cove;
    const blocked = (x, z) => rockyAt(x, z, walker.bed(x, z)) || walker.solids.touches(x, 0.5, z, 0.3);
    // Nothing within a metre and a half of the hull.
    const fx = Math.sin(m.heading), fz = Math.cos(m.heading);
    for (let u = -3.8; u <= 3.8; u += 0.25)
      for (let v = -2.3; v <= 2.3; v += 0.25)
        assert.ok(!blocked(m.x + fx * u + fz * v, m.z + fz * u - fx * v), `seed ${seed}: boulder by the mooring at ${u}, ${v}`);
    // The glide from the logs passes over no boulder.
    const dx = m.x - landmark.x, dz = m.z - landmark.z, L = Math.hypot(dx, dz);
    for (let t = 3; t <= L; t += 0.2)
      for (const v of [-0.7, 0, 0.7]) {
        const x = landmark.x + (dx / L) * t - (dz / L) * v, z = landmark.z + (dz / L) * t + (dx / L) * v;
        assert.ok(!blocked(x, z), `seed ${seed}: the glide crosses a boulder ${t.toFixed(1)} m out`);
      }
  }
});

test("where the boat was left is remembered per seed, falling back to the cove", async () => {
  const { createBoatRide, BOAT_KEY } = await import("../src/boat-ride.js");
  const { createMagic } = await import("../src/magic.js");
  const { walker, sea, places, tick } = world(1847);
  const landmark = places.layout.find((p) => p.id === "boat");
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  const awake = () => createMagic({ force: ["boat"] });
  const cat = { ...walker.cat, air: 0, waterSlope: [0, 0], flow: [0, 0] };
  const none = { move: [0, 0], jump: false };
  const a = createBoatRide({ landmark, sea, bed: walker.bed, solids: walker.solids, magic: awake(), seed: 1847, storage });
  tick(0);
  a.update(1 / 30, none, cat);
  assert.equal(a.ride.state, "waiting");
  assert.ok(Math.hypot(a.state.x - a.cove.x, a.state.z - a.cove.z) < 0.5, "starts at the cove");
  a.ride.state = "aboard";
  const s = a.state;
  const out = Math.atan2(s.x - 58, s.z - 70) + 1.4;
  // (Rowed out a little way, short of where a boat left is adrift.)
  for (let t = 0; t < 4.8; t += 1 / 30) {
    tick(t);
    a.update(1 / 30, { move: [0, 1], jump: false }, cat, out);
  }
  a.update(1 / 30, { move: [0, 0], jump: true }, cat, out);
  assert.notEqual(a.ride.state, "aboard", `jumped out (${s.offshore.toFixed(1)} m out)`);
  assert.ok(store.has(BOAT_KEY + 1847), `stored (state ${a.ride.state}, ${s.offshore.toFixed(1)} m out)`);
  const left = JSON.parse(store.get(BOAT_KEY + 1847));
  assert.ok(Math.hypot(left.x - a.cove.x, left.z - a.cove.z) > 2, "somewhere else than the cove");
  const b = createBoatRide({ landmark, sea, bed: walker.bed, solids: walker.solids, magic: awake(), seed: 1847, storage });
  b.update(1 / 30, none, cat);
  assert.ok(Math.hypot(b.state.x - left.x, b.state.z - left.z) < 0.5, "where it was left");
  store.set(BOAT_KEY + 1847, '{"x": 58, "z": 70, "heading": 0}');
  const c = createBoatRide({ landmark, sea, bed: walker.bed, solids: walker.solids, magic: awake(), seed: 1847, storage });
  c.update(1 / 30, none, cat);
  assert.ok(Math.hypot(c.state.x - c.cove.x, c.state.z - c.cove.z) < 0.5, "the cove again");
});

// ---- Buoyancy, the launch and the painter (boat-dynamics.js, boat-launch.js).

test("afloat, the hull's waterline stays with the swell it is drawn in", () => {
  for (const [seed, wind] of [[1847, [4, 2]], [1, [14, 6]]]) {
    const { walker, sea, tick, boatPoi } = world(seed, wind);
    const m = findMooring(boatPoi.x, boatPoi.z, walker.bed);
    const boat = createBoatDynamics({ sea, bed: walker.bed, solids: walker.solids });
    tick(0);
    boat.place(m.x, m.z, m.heading);
    const s = boat.state;
    let worst = 0, worstTilt = 0;
    const dir = [Math.sin(m.heading + Math.PI), Math.cos(m.heading + Math.PI)];
    for (let t = 0; t < 90; t += 1 / 30) {
      tick(t);
      // Moored for a while, then rowed out and along.
      boat.step(1 / 30, t < 30 ? {} : { dir, throttle: 1 });
      const mean = s.water.reduce((a, b) => a + b, 0) / 9;
      // (In the shallows, the sand holds it up in a trough.)
      if (t < 2 || s.grounded > 0.05 || walker.bed(s.x, s.z) + BOAT.draft > mean - 0.05) continue;
      worst = Math.max(worst, Math.abs(s.y - mean));
      // The drawn surface under the middle, against the hull's.
      const drawn = sea.drawn(s.x, s.z);
      assert.ok(Math.abs(drawn - s.water[4]) < 1e-6, "the grid's middle is the drawn sea");
      const along = (s.water[7] - s.water[1]) / (2 * 0.85 * BOAT.length / 2);
      worstTilt = Math.max(worstTilt, Math.abs(Math.atan(along) * 0.85 - s.pitch));
    }
    assert.ok(worst < 0.06, `seed ${seed}: heave within 6 cm of the swell's mean under it (${worst.toFixed(3)})`);
    assert.ok(worstTilt < 0.12, `seed ${seed}: pitch follows the swell (${worstTilt.toFixed(3)} rad)`);
  }
});

test("the launch: nothing moves until the cat touches it, and the hull always bears on the logs, the sand or the water", async () => {
  const { createBoatRide } = await import("../src/boat-ride.js");
  const { createMagic } = await import("../src/magic.js");
  const { hullPoint } = await import("../src/boat-forms.js");
  const { LAUNCH } = await import("../src/boat-launch.js");
  const { groundHeight } = await import("../src/terrain.js");
  const { seabedDepth, shoreAlong } = await import("../src/sea-surface.js");
  // The bare sand and seabed (not the upturned hull's own walk tile).
  const { boatLogs, LOG_R } = await import("../src/place-shore.js");
  const { timberHeight } = await import("../src/place-kit.js");
  const bare = (x, z) => (shoreDistance(x, z) < 0 ? Math.max(groundHeight(x, z), -seabedDepth(-shoreDistance(x, z), shoreAlong(x, z))) : groundHeight(x, z));
  const points = [];
  for (const s of [-0.95, -0.5, 0, 0.5, 0.9]) for (const t of [0, 0.25, 0.5, 0.75, 1]) for (const side of [-1, 1]) points.push(new THREE.Vector3(...hullPoint(s, t, side)));
  // (Finely along the bottom too: a log bears on it between the stations.)
  for (let s = -0.98; s <= 0.92; s += 0.05) for (const t of [0, 0.2, 0.4]) for (const side of [-1, 1]) points.push(new THREE.Vector3(...hullPoint(s, t, side)));
  const euler = new THREE.Euler(0, 0, 0, "YXZ");
  const v = new THREE.Vector3();
  for (const seed of SEEDS) {
    const { walker, sea, tick, places } = world(seed);
    const landmark = places.layout.find((p) => p.id === "boat");
    const magic = createMagic();
    const ride = createBoatRide({ landmark, sea, bed: walker.bed, solids: walker.solids, magic });
    const cat = { ...walker.cat, x: landmark.x + 6, z: landmark.z + 6, y: 5, air: 0 };
    const none = { move: [0, 0] };
    // The logs it lay on (the places prop's own): sliding, it rides over
    // them; it went 0.4 m through them when the slide saw only the sand.
    const logs = boatLogs(landmark).map((q) => timberHeight(q, LOG_R));
    const logTop = (x, z) => Math.max(logs[0](x, z), logs[1](x, z));
    const sand = (x, z) => Math.max(bare(x, z), logTop(x, z));
    let through = 0;
    let t = 0;
    magic.wake("boat");
    for (; t < 10; t += 1 / 30) {
      tick(t);
      ride.update(1 / 30, none, cat);
    }
    assert.equal(ride.ride.state, "ready", `seed ${seed}: still on its logs, untouched`);
    ride.launch();
    let lowestGap = Infinity, frames = 0, phase = "";
    for (let k = 0; k < 40 * 30 && ride.ride.state === "launching"; k++, t += 1 / 30) {
      tick(t);
      ride.update(1 / 30, none, cat);
      const p = ride.ride.pose;
      if (ride.ride.state !== "launching") break;
      phase = p.phase;
      euler.set(-p.pitch, p.heading, -p.roll);
      // The gap between its lowest point and what is under that point.
      // On the logs (rocking, and rolling off them) it bears on the highest
      // sand under its length plus the logs; sliding, on the sand under each
      // point, or floats (its keel a draft into the water).
      let gap = Infinity, sunk = Infinity, top = -Infinity;
      const world = points.map((q) => q.clone().applyEuler(euler).add(new THREE.Vector3(p.x, p.y, p.z)));
      for (const w of world) top = Math.max(top, sand(w.x, w.z));
      for (const w of world) {
        const floor = sand(w.x, w.z);
        const water = sea.drawn(w.x, w.z);
        const under = p.phase === "slide" ? Math.max(floor, Number.isFinite(water) ? water - 0.25 : -Infinity) : top + LAUNCH.logs;
        gap = Math.min(gap, w.y - under);
        sunk = Math.min(sunk, w.y - floor);
        if (p.phase === "slide") through = Math.max(through, logTop(w.x, w.z) - w.y);
      }
      lowestGap = Math.min(lowestGap, gap);
      assert.ok(gap < 0.09, `seed ${seed}: ${p.phase} at ${(t).toFixed(2)} s, its lowest point ${gap.toFixed(3)} m above what bears it`);
      assert.ok(sunk > -0.12, `seed ${seed}: ${p.phase}, ${(-sunk).toFixed(3)} m into the sand`);
      frames++;
    }
    assert.ok(through < 0.03, `seed ${seed}: the hull slid ${through.toFixed(3)} m through a log`);
    assert.equal(ride.ride.state, "waiting", `seed ${seed}: afloat in the end (${phase})`);
    assert.ok(frames > 60, "a launch you can watch");
    assert.ok(ride.tether, "on its painter");
  }
});

test("on its painter the boat swings to the wind but stays by its post", async () => {
  const { createBoatRide, RIDE } = await import("../src/boat-ride.js");
  const { createMagic } = await import("../src/magic.js");
  for (const [seed, wind] of [1847, 1, 99999].flatMap((sd) => [[0, 0], [7, 0], [-5, 5]].map((w) => [sd, w]))) {
    const { walker, sea, places } = world(seed);
    const landmark = places.layout.find((p) => p.id === "boat");
    const ride = createBoatRide({ landmark, sea, bed: walker.bed, solids: walker.solids, magic: createMagic({ force: ["boat"] }) });
    const swell = (await import("../src/swell.js")).swellUniform(seed, wind);
    const modes = createWaveModes(seed);
    const cat = { ...walker.cat, x: landmark.x + 6, z: landmark.z + 6, y: 5, air: 0 };
    let far = 0, jolt = 0;
    const s = ride.state;
    let px = s.x, pz = s.z;
    for (let t = 0; t < 120; t += 1 / 30) {
      modes.update(t, wind);
      sea.set(t, swell, wind);
      ride.update(1 / 30, { move: [0, 0] }, cat);
      const stem = { x: s.x + Math.sin(s.heading) * 2.32, z: s.z + Math.cos(s.heading) * 2.32 };
      far = Math.max(far, Math.hypot(stem.x - ride.post.x, stem.z - ride.post.z));
      jolt = Math.max(jolt, Math.hypot(s.x - px, s.z - pz));
      px = s.x;
      pz = s.z;
      assert.ok(shoreDistance(s.x, s.z) < 0, "afloat");
    }
    // Set down on the sand in a trough, it sits; it is not shoved (that
    // threw it 0.2 m in a frame, out past its painter).
    assert.ok(jolt < 0.03, `seed ${seed} wind ${wind}: jolted ${jolt.toFixed(3)} m in a frame at its mooring`);
    assert.ok(far < RIDE.painter + 0.35, `seed ${seed} wind ${wind}: the stem within its painter of the post (${far.toFixed(2)} m)`);
  }
});

// The upturned hull ashore (places' prop) is the afloat boat's own form in
// the pose the launch starts from: at the push nothing changes shape or
// jumps (it was a lower, flatter hull, pitched 0.09 rad less), and the
// gunwale sits on the logs.
test("ashore and at the push the hull is one boat in one pose, on its logs", async () => {
  const { placesLayout } = await import("../src/place-layout.js");
  const { buildBoat, boatLogs } = await import("../src/place-shore.js");
  const { createMaterials } = await import("../src/place-kit.js");
  const { createLaunch, restPose, bareSand } = await import("../src/boat-launch.js");
  const { hullPoint, HULL } = await import("../src/boat-forms.js");
  for (const seed of SEEDS) {
    const p = placesLayout(seed).find((q) => q.kind === "boat");
    const b = buildBoat(p, createMaterials({}), { seed });
    const launch = createLaunch({ landmark: p, to: { x: p.x + 10, z: p.z }, bed: bareSand, water: () => -Infinity });
    const pose = launch.pose(0, {});
    const rest = restPose(p);
    assert.ok(Math.abs(pose.y - rest.y) < 1e-9 && Math.abs(pose.pitch - rest.pitch) < 1e-9, `seed ${seed}: the launch starts where the prop lies`);
    const m = new THREE.Matrix4().compose(new THREE.Vector3(pose.x, pose.y, pose.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(-pose.pitch, pose.heading, -pose.roll, "YXZ")), new THREE.Vector3(1, 1, 1));
    const at = (s, t, side) => new THREE.Vector3(...hullPoint(s, t, side)).applyMatrix4(m);
    // The prop's standing tile follows the launched hull's keel.
    const tile = b.surfaces.tiles[0];
    const tileAt = (x, z) => tile.heights[Math.round((z - tile.z0) / tile.cell) * tile.nx + Math.round((x - tile.x0) / tile.cell)];
    for (const s of [-0.6, 0, 0.5]) {
      const k = at(s, 0, 1);
      assert.ok(Math.abs(tileAt(k.x, k.z) - 0.02 - k.y) < 0.06, `seed ${seed}: the keel at ${s} stands where the launched hull's is (${(tileAt(k.x, k.z) - 0.02).toFixed(3)} vs ${k.y.toFixed(3)})`);
    }
    // The gunwale on the logs: each log's top just under it.
    const logs = boatLogs(p);
    for (const [i, s] of [-0.62, 0.55].entries()) {
      const g = Math.min(at(s, 1, -1).y, at(s, 1, 1).y);
      const top = Math.max(...logs[i].slice(1, 3).map((q) => q.y)) + 0.12;
      assert.ok(g - top > -0.005 && g - top < 0.04, `seed ${seed}: gunwale ${(g - top).toFixed(3)} m over log ${i}`);
    }
    assert.equal(HULL.half * 2, 4.6);
  }
});
