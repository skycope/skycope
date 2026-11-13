import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createFlySteer, fireflyTraits, FLY_KIND } from "../src/fireflies.js";
import { createLandMagic, magicUniforms, lampCatch, lampSpin, nearestLights, mixGiftColour } from "../src/land-magic.js";
import { createMagic } from "../src/magic.js";
import { PRINT_MAGIC } from "../src/cat-ground.js";

const pose = (x, z, extra = {}) => ({ x, z, y: 0, air: 0, sleepy: 0, ...extra });

test("firefly traits are deterministic by seed and split into the three flocks", () => {
  const a = fireflyTraits(1847, 600), b = fireflyTraits(1847, 600), c = fireflyTraits(7, 600);
  assert.deepEqual(a.traits, b.traits);
  assert.notDeepEqual(a.traits, c.traits);
  const counts = [0, 0, 0];
  for (let i = 0; i < 600; i++) counts[a.kinds[i * 2]]++;
  assert.equal(counts[FLY_KIND.escort], 132);
  assert.ok(counts[FLY_KIND.home] > 200 && counts[FLY_KIND.roam] > 200);
  for (const v of a.traits) assert.ok(Number.isFinite(v) && v >= 0 && v < 2.5);
});

test("the escort follows the cat, stays bounded, scatters on a leap and settles as it dozes", () => {
  const steer = createFlySteer();
  let s = steer.step(1 / 60, pose(0, 0));
  for (let i = 0; i < 600; i++) s = steer.step(1 / 60, pose(i * 0.08, 0)); // ~4.8 m/s for 10 s
  assert.ok(s.x > 40 && s.x < 48.1, `centre follows behind the cat (${s.x})`);
  assert.ok(s.vx > 4 && s.vx < 5.2, "streams along the cat's velocity");
  assert.ok(s.spread < 2, "spread stays small while running");
  for (let i = 0; i < 30; i++) s = steer.step(1 / 60, pose(48, 0, { air: 0.5 }));
  assert.ok(s.scatter > 0.9 && s.spread > 3, "a leap throws them wide");
  for (let i = 0; i < 300; i++) s = steer.step(1 / 60, pose(48, 0));
  assert.ok(s.scatter < 0.01, "they re-form");
  for (let i = 0; i < 1200; i++) s = steer.step(1 / 60, pose(48, 0, { sleepy: 0.55 }));
  assert.ok(s.sleep > 0.9, "they settle on a dozing cat");
  // A teleport snaps rather than streaking across the island; velocity is clamped.
  s = steer.step(1 / 60, pose(-60, 80));
  assert.ok(Math.abs(s.x + 60) < 1e-9 && Math.hypot(s.vx, s.vz) <= 12 * Math.SQRT2 + 1e-9);
  // Garbage dt never produces NaN.
  s = steer.step(NaN, pose(0, 0));
  s = steer.step(-1, pose(0, 0));
  for (const k of ["x", "y", "z", "vx", "vz", "spread", "scatter", "sleep", "call"]) assert.ok(Number.isFinite(s[k]), k);
});

test("a meow flashes the escort once per call and fades", () => {
  const steer = createFlySteer();
  steer.step(1 / 60, pose(0, 0));
  const call = { at: 1, x: 0, z: 0 };
  let s = steer.step(1 / 60, pose(0, 0), call);
  assert.ok(s.call > 0.95);
  for (let i = 0; i < 300; i++) s = steer.step(1 / 60, pose(0, 0), call);
  assert.ok(s.call < 0.01, "the same call does not flash again");
  s = steer.step(1 / 60, pose(0, 0), { at: 9, x: 0, z: 0 });
  assert.ok(s.call > 0.95, "a new call does");
});

test("nothing is lit while the lamp sleeps; it catches, then the beams turn", () => {
  const shared = magicUniforms();
  const lamps = [{ x: 0, y: 1, z: 0, colour: [1, 0.6, 0.3] }, { x: 50, y: 1, z: 0, colour: [1, 0.6, 0.3] }];
  const land = createLandMagic({ shared, lamps, beacon: { x: 10, y: 17, z: 5 } });
  const magic = createMagic();
  let t = 0;
  for (let i = 0; i < 120; i++) {
    t += 1 / 60; magic.update(1 / 60, t);
    const st = land.update({ magic, time: t, dt: 1 / 60, night: 1, pose: pose(0, 0) });
    assert.equal(st.lamp.lit, 0);
    assert.equal(st.lampLights, 0);
  }
  assert.equal(shared.magicLamp.value.w, 0);
  assert.equal(shared.magicOn.value, 0, "every gift asleep: the land's magic block is skipped");
  assert.equal(PRINT_MAGIC.level.value, 0.12, "only a hint in the steps at night");
  magic.wake("lamp");
  const angles = [];
  for (let i = 0; i < 600; i++) {
    t += 1 / 60; magic.update(1 / 60, t);
    const st = land.update({ magic, time: t, dt: 1 / 60, night: 1, pose: pose(1, 0) });
    angles.push(st.lamp.angle);
  }
  const st = land.state;
  assert.ok(st.lamp.lit > 0.95 && st.lampLights > 0.9);
  assert.ok(shared.magicLamp.value.w > 0 && shared.magicOn.value === 1);
  assert.ok(angles[60] < 0.05, "still while the lamp catches");
  assert.ok(angles[599] > 0.5, "then the first sweep");
  // Slot 3 holds the nearest lamp to the cat.
  assert.equal(shared.magicGlow.value[3].x, 0);
});

test("the lamp's catch and spin curves are bounded and settle", () => {
  for (let s = -1; s < 10; s += 0.05) {
    const c = lampCatch(s), w = lampSpin(s);
    assert.ok(c >= 0 && c <= 1 && w >= 0 && w <= 1);
  }
  assert.equal(lampCatch(Infinity), 1, "restored from an earlier visit (wakeAt −∞): already lit");
  assert.equal(lampSpin(Infinity), 1);
  assert.equal(lampCatch(-Infinity), 0, "asleep (wakeAt +∞): dark");
  assert.equal(lampCatch(5), 1);
  assert.equal(lampSpin(8), 1);
});

test("a waking's ring runs out at its own speed and is spent past its reach", () => {
  const shared = magicUniforms();
  const land = createLandMagic({ shared });
  const magic = createMagic();
  magic.update(0, 10);
  magic.pulse = { x: 5, y: 0, z: 7, at: 10, gift: "stars", colour: [0.78, 0.76, 1], speed: 20, reach: 100 };
  magic.update(0, 12);
  land.update({ magic, time: 12, dt: 0, night: 1, pose: pose(0, 0) });
  assert.equal(shared.magicPulse.value.z, 40);
  assert.equal(shared.magicPulse.value.x, 5);
  assert.equal(shared.magicPulse.value.y, -7, "Three world z is mirrored");
  assert.ok(shared.magicPulse.value.w > 0);
  magic.update(0, 16);
  land.update({ magic, time: 16, dt: 0, night: 1, pose: pose(0, 0) });
  assert.equal(shared.magicPulse.value.w, 0);
});

test("lamp helpers: nearest lights and the gifts' step colour", () => {
  const out = [];
  nearestLights([{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 3, z: 0 }], 9, 0, out, 2);
  assert.deepEqual(out, [1, 2]);
  const c = mixGiftColour({ lamp: 1 }, new THREE.Color());
  assert.ok(c.r > c.b, "the lamp's steps are warm");
  const none = mixGiftColour({}, new THREE.Color());
  assert.ok(none.g > 0.5, "a hint colour before any gift");
});

test("the finale blazes for its ceremony, then settles", async () => {
  const { finaleBlaze } = await import("../src/land-magic.js");
  const at = (clock, wakeAt, level = 1) => finaleBlaze({ clock, levels: { finale: level }, wakeAt: { finale: wakeAt } });
  assert.equal(at(10, Infinity, 0), 0);
  assert.ok(at(30, 10) > 0.95, "full during the ceremony");
  assert.ok(at(200, 10) < 0.15, "settled after it");
  assert.ok(at(5, -Infinity) < 0.15, "restored from an earlier visit: settled");
});
