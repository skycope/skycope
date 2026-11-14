import test from "node:test";
import assert from "node:assert/strict";
import { WAKING, WAKE_LIGHT, GIFT_COLOURS, wakingAt, wakingSea, frontArrival, createWaking, stepWaking, wakingSource, practicalLevel, lampCatch } from "../src/waking.js";

const GIFTS = ["fireflies", "tideglow", "lamp", "stars", "seafolk", "boat", "finale"];

test("nothing outside the waking: all zero before it and after its end", () => {
  for (const gift of GIFTS) {
    for (const s of [-1, -0.01, NaN, WAKING.end + 0.01, 99]) {
      const w = wakingAt(s, WAKE_LIGHT[gift], 1);
      assert.equal(w.radius + w.inside + w.front + w.glint, 0, `${gift} at ${s}`);
    }
    // And it eases to nothing rather than stepping off at the end.
    const late = wakingAt(WAKING.end - 0.01, WAKE_LIGHT[gift], 1);
    assert.ok(late.inside < 1e-3 && late.glint < 1e-3, gift);
  }
});

test("the front runs out, decelerating, never past its reach, and dies before it stops", () => {
  for (const gift of GIFTS) {
    const spec = WAKE_LIGHT[gift];
    let last = 0, lastStep = Infinity;
    for (let s = 0; s <= WAKING.end; s += 0.05) {
      const w = wakingAt(s, spec, 1);
      assert.ok(w.radius >= last - 1e-9 && w.radius <= spec.reach, `${gift} monotonic, bounded`);
      if (s > WAKING.start + 0.05) {
        assert.ok(w.radius - last <= lastStep + 1e-9, `${gift} decelerates`);
        lastStep = w.radius - last;
      }
      last = w.radius;
      assert.ok(w.inside <= spec.night + 1e-9, `${gift} body light under its night peak`);
    }
    assert.equal(wakingAt(WAKING.start, spec, 1).front, 0, "no front before the catch");
    assert.ok(wakingAt(15.9, spec, 1).front < 0.01 * spec.front, "spent at full reach");
  }
});

test("the catch flickers like a wick, and reduced motion only eases up in place", () => {
  const spec = WAKE_LIGHT.tideglow;
  const a = wakingAt(0.13, spec, 1).caught, dip = wakingAt(0.33, spec, 1).caught, b = wakingAt(1.0, spec, 1).caught;
  assert.ok(a > 0.2 && b > 0.5, `catches (${a}, ${b})`);
  assert.ok(dip < b, "gutters before it swells");
  for (let s = 0; s < WAKING.end; s += 0.1) {
    const r = wakingAt(s, spec, 1, true);
    assert.equal(r.front, 0);
    assert.equal(r.radius, spec.reach);
  }
  // Monotonic catch with reduced motion: no flicker.
  let prev = 0;
  for (let s = 0; s <= 1.5; s += 0.05) {
    const c = wakingAt(s, spec, 1, true).caught;
    assert.ok(c >= prev - 1e-12);
    prev = c;
  }
  assert.equal(lampCatch(Infinity), 1);
});

test("the front reaches a point when the curves say it does", () => {
  const spec = WAKE_LIGHT.fireflies;
  for (const d of [1, 5, 12, 20]) {
    const t = frontArrival(d, spec);
    assert.ok(Math.abs(wakingAt(t, spec, 1).radius - d) < 1e-6, `${d} m`);
  }
  assert.equal(frontArrival(spec.reach + 1, spec), Infinity);
});

test("the sea: zero for a gift whose light stays ashore; a longer tail for the tideglow", () => {
  assert.equal(wakingSea(2, WAKE_LIGHT.fireflies, 1).radius, 0);
  assert.equal(wakingSea(2, WAKE_LIGHT.stars, 1).inside, 0);
  const t = WAKE_LIGHT.tideglow;
  assert.ok(wakingSea(8, t, 1).inside > wakingAt(8, t, 1).inside * 2, "lit water outlasts the land");
  assert.equal(wakingSea(16.5, t, 1).inside, 0);
});

test("the record runs on wall time, follows a moving source, and is spent", () => {
  let w = createWaking("boat", [1, 2, 3], { follow: () => [4, 5, 6] });
  w = stepWaking(w, 1);
  assert.equal(w.age, 1);
  assert.deepEqual([w.x, w.y, w.z], [4, 5, 6]);
  const frozen = createWaking("lamp", [0, 0, 0], { age: 2, frozen: true });
  assert.equal(stepWaking(frozen, 5).age, 2);
  assert.equal(stepWaking(createWaking("lamp", [0, 0, 0], { age: 15.9 }), 0.5), null);
  assert.equal(createWaking("nonsense", [0, 0, 0]), null);
});

test("sources sit at each keepsake; the practical hands over without a gap", () => {
  const pois = [{ id: "wreck", x: 1, z: 2 }, { id: "pool", x: 3, z: 4 }];
  assert.deepEqual(wakingSource("tideglow", { pois, surface: () => 1 }), [1, 1.6, 2]);
  assert.ok(wakingSource("seafolk", { pois, surface: () => 1 })[1] < 1, "under the pool's surface");
  assert.deepEqual(wakingSource("fireflies", { crown: { x: 5, z: 6, ground: 2 }, surface: () => 2 }), [5, 3.6, 6]);
  assert.equal(wakingSource("boat", { pois }), null);
  assert.equal(practicalLevel(0), 0);
  assert.equal(practicalLevel(8), 1);
  assert.equal(practicalLevel(-Infinity), 0);
  assert.equal(practicalLevel(Infinity), 1);
  for (const g of GIFTS) assert.equal(GIFT_COLOURS[g].length, 3);
});
