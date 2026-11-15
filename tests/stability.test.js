import test from "node:test";
import assert from "node:assert/strict";
import { prewarmWork, runPrewarm } from "../src/prewarm.js";
import { lampCatch } from "../src/waking.js";

// A fake scene: drawables with materials, some sharing one.
function scene(objects) {
  return { traverse(fn) { for (const o of objects) fn(o); } };
}
const material = (id) => ({ uuid: `m${id}` });

test("prewarm work: one drawable per material and object kind", () => {
  const a = material(1), b = material(2);
  const objects = [
    { isMesh: true, material: a },
    { isMesh: true, material: a },
    { isMesh: true, isInstancedMesh: true, material: a },
    { isMesh: true, material: b, receiveShadow: true },
    { isPoints: true, material: b },
    { isGroup: true },
  ];
  const work = prewarmWork(scene(objects));
  assert.deepEqual(work, [objects[0], objects[2], objects[3], objects[4]]);
});

test("prewarm compiles at most one new program per idle slice, and waits for each to link", async () => {
  // Every second drawable creates a program; each takes three polls to link.
  const work = Array.from({ length: 10 }, (_, i) => ({ isMesh: true, material: material(i), fresh: i % 2 === 0 }));
  let programs = 0;
  const linking = new Map();
  const log = [];
  const idleQueue = [];
  let inSlice = 0;
  const done = runPrewarm(work, {
    compile(o) {
      inSlice++;
      log.push(`compile ${o.material.uuid}`);
      if (o.fresh) { programs++; linking.set(o.material, 3); }
    },
    programs: () => programs,
    linked: (materials) => materials.every((m) => {
      const left = linking.get(m) ?? 0;
      if (left > 0) linking.set(m, left - 1);
      return left === 0;
    }),
    idle: (fn) => idleQueue.push(fn),
    wait: (fn) => fn(),
    now: () => 0,
  });
  // Drive the idle callbacks one at a time, like a browser between frames.
  let slices = 0;
  while (idleQueue.length) {
    inSlice = 0;
    const before = programs;
    idleQueue.shift()();
    slices++;
    assert.ok(programs - before <= 1, "never two new programs in one slice");
    assert.ok(inSlice >= 1);
    // Nothing is queued while a program is still linking.
    for (const left of linking.values()) assert.equal(left, 0);
  }
  const result = await done;
  assert.equal(result.compiled, 10);
  assert.equal(programs, 5);
  assert.equal(slices, result.slices);
  assert.ok(slices >= 5);
  assert.equal(log.length, 10);
});

test("prewarm respects the time budget of a slice", async () => {
  const work = Array.from({ length: 6 }, (_, i) => ({ isMesh: true, material: material(i) }));
  let clock = 0;
  const idleQueue = [];
  let perSlice = [], count = 0;
  const done = runPrewarm(work, {
    compile() { count++; clock += 3; },
    programs: () => 0,
    linked: () => true,
    idle: (fn) => idleQueue.push(fn),
    wait: (fn) => fn(),
    now: () => clock,
    sliceMs: 4,
  });
  while (idleQueue.length) { count = 0; idleQueue.shift()(); perSlice.push(count); }
  await done;
  assert.deepEqual(perSlice, [2, 2, 2]);
});

test("an empty scene prewarms at once", async () => {
  assert.deepEqual(await runPrewarm([], { compile() {}, programs: () => 0, linked: () => true, idle: () => assert.fail("no idle needed") }), { slices: 0, compiled: 0 });
});

// The waking catch's gutter: no faster than ~3 Hz however quickly a gift
// catches (photosensitivity guidance: under three flashes a second).
test("the waking gutter flickers under ~3 Hz at every pace", () => {
  for (const pace of [1, 2, 3]) {
    let peaks = 0, last = 0, rising = false;
    const dt = 0.002;
    for (let s = 0; s < 1.6 / pace; s += dt) {
      const v = lampCatch(s, pace);
      if (v > last) rising = true;
      else if (rising && v < last) { peaks++; rising = false; }
      last = v;
    }
    const hz = peaks / (1.6 / pace);
    assert.ok(hz <= 3.2, `pace ${pace}: ${hz.toFixed(1)} Hz`);
  }
});
