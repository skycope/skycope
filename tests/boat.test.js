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

test("the ride: launch on waking, board by pushing at the hull, steer, jump out, beach", async () => {
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
  run(0.2);
  assert.equal(ride.ride.state, "launching");
  run(RIDE.launch + 0.5);
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
