import { test } from "node:test";
import assert from "node:assert/strict";
import { createAffordances, ACTS } from "../src/affordances.js";

const LIST = [
  { place: "pool", id: "pool-rim", kind: "sit-near", x: 0, y: 0, z: 0, r: 0.9, facing: 0, seconds: 5 },
  { place: "beacon", id: "beacon-top", kind: "sit-near", x: 20, y: 1.05, z: 0, r: 0.6, facing: 0 },
  { place: "wreck", id: "wreck-boiler", kind: "inside", x: 40, y: 0.2, z: 0, r: 0.9 },
  { place: "wreck", id: "wreck-bell", kind: "meow-near", x: 40, y: 0.2, z: 0, r: 0.9 },
  { place: "boat", id: "boat-hull", kind: "on-top", x: 60, y: 0.6, z: 0, r: 1.2 },
  { place: "milkwood", id: "milkwood-fork", kind: "perch", x: 80, y: 2, z: 0, r: 0.5, facing: Math.PI / 2 },
  { place: "penguins", id: "penguin-1", kind: "animal", x: 100, y: 0, z: 0, r: 8 },
];
const cat = (o) => ({ x: 0, y: 0, z: 0, heading: 0, speed: 0, sitting: false, meowed: false, jumpedOnto: null, bumped: null, onGround: true, ...o });

// Run a script of [catState, seconds] legs at 60 Hz; collect events.
function run(aff, legs, dt = 1 / 60) {
  const out = [];
  for (const [c, secs] of legs) for (let i = 0; i < Math.round(secs / dt); i++) out.push(...aff.update(c, dt));
  return out;
}
const of = (ev, type, id) => ev.filter((e) => e.type === type && e.id === id);

test("sat-near fires once after the dwell, then left once", () => {
  const aff = createAffordances(LIST);
  const ev = run(aff, [[cat({ x: 3 }), 1], [cat({ x: 0.3, sitting: true }), 6], [cat({ x: 3 }), 1]]);
  assert.equal(of(ev, "sat-near", "pool-rim").length, 1);
  assert.equal(of(ev, "left", "pool-rim").length, 1);
  const short = run(createAffordances(LIST), [[cat({ x: 0.3, sitting: true }), 4]]);
  assert.equal(of(short, "sat-near", "pool-rim").length, 0, "5 s pool needs 5 s");
});

test("sitting facing away does not count", () => {
  const ev = run(createAffordances(LIST), [[cat({ x: 20, y: 1.05, sitting: true, heading: Math.PI }), 3]]);
  assert.equal(of(ev, "sat-near", "beacon-top").length, 0);
});

test("walking past every spot at the old proximity radius fires nothing", () => {
  const aff = createAffordances(LIST);
  const ev = [];
  // a straight walk along z = 0.4 at 1.5 m/s, never sitting, ground level
  for (let x = -10; x < 120; x += 1.5 / 60) ev.push(...aff.update(cat({ x, z: 0.4, speed: 1.5, heading: Math.PI / 2, y: 5 }), 1 / 60));
  assert.deepEqual(ev, []);
});

test("inside fires after 0.6 s; meow inside answers", () => {
  const aff = createAffordances(LIST);
  const ev = run(aff, [[cat({ x: 40.2, y: 0.2 }), 0.5]]);
  assert.equal(of(ev, "inside", "wreck-boiler").length, 0);
  const ev2 = run(aff, [[cat({ x: 40.2, y: 0.2 }), 0.2], [cat({ x: 40.2, y: 0.2, meowed: true }), 1 / 60]]);
  assert.equal(of(ev2, "inside", "wreck-boiler").length, 1);
  assert.equal(of(ev2, "meow-near", "wreck-bell").length, 1);
});

test("on-top fires after settling, once; hop off and on fires again", () => {
  const aff = createAffordances(LIST);
  const ev = run(aff, [[cat({ x: 60, y: 0.6, jumpedOnto: "boat-hull" }), 1], [cat({ x: 63, y: 0 }), 1], [cat({ x: 60, y: 0.6 }), 1]]);
  assert.equal(of(ev, "on-top", "boat-hull").length, 2, "two hops = two on-top (ACTS.boat count 2)");
  assert.equal(of(ev, "left", "boat-hull").length, 1);
  assert.equal(ACTS.boat.count, 2);
});

test("perch at the fork fires; airborne or standing does not", () => {
  const ev = run(createAffordances(LIST), [[cat({ x: 80, y: 2, sitting: true, heading: Math.PI / 2 }), 2]]);
  assert.equal(of(ev, "sat-near", "milkwood-fork").length, 1);
});

test("hysteresis: jitter across the enter radius neither re-fires nor leaves", () => {
  const aff = createAffordances(LIST);
  const ev = run(aff, [[cat({ x: 0.3, sitting: true }), 5.5]]);
  assert.equal(of(ev, "sat-near", "pool-rim").length, 1);
  const jitter = [];
  for (let i = 0; i < 600; i++) jitter.push(...aff.update(cat({ x: 0.9 + (i % 2 ? 0.05 : -0.05), sitting: true }), 1 / 60));
  assert.deepEqual(jitter, []);
  // and jitter before firing does not reset the dwell
  const aff2 = createAffordances(LIST);
  const ev2 = [];
  for (let i = 0; i < 700; i++) ev2.push(...aff2.update(cat({ x: 0.9 + (i % 2 ? 0.05 : -0.05), sitting: true }), 1 / 60));
  assert.equal(of(ev2, "sat-near", "pool-rim").length, 1);
});

test("ran-at: fast within the cone fires once; slow or sideways does not", () => {
  const aff = createAffordances(LIST);
  const ev = run(aff, [[cat({ x: 94, speed: 4, heading: Math.PI / 2 }), 1]]);
  assert.equal(of(ev, "ran-at", "penguin-1").length, 1);
  const slow = run(createAffordances(LIST), [[cat({ x: 94, speed: 1, heading: Math.PI / 2 }), 1]]);
  const side = run(createAffordances(LIST), [[cat({ x: 94, speed: 4, heading: 0 }), 1]]);
  assert.equal(slow.length + side.length, 0);
});

test("bumped passes through with place", () => {
  const ev = createAffordances(LIST).update(cat({ bumped: { id: "boat-hull" } }), 0.016);
  assert.deepEqual(ev, [{ type: "bumped", id: "boat-hull", place: "boat", t: 0.016 }]);
});

test("deterministic: same script, same events; reset restarts", () => {
  const legs = [[cat({ x: 0.3, sitting: true }), 6], [cat({ x: 40.2, y: 0.2, meowed: true }), 1], [cat({ x: 5 }), 1]];
  const aff = createAffordances(LIST);
  const a = run(aff, legs);
  aff.reset();
  const b = run(aff, legs);
  assert.deepEqual(a, b);
  assert.deepEqual(a, run(createAffordances(LIST), legs));
});

test("near returns the closest spot", () => {
  assert.equal(createAffordances(LIST).near(59, 0).id, "boat-hull");
});
