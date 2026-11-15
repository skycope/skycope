import test from "node:test";
import assert from "node:assert/strict";
import { WAKING, WAKE_LIGHT, GIFT_COLOURS, WAVE, wakingAt, wakingSea, waveAt, waveArrival, frontArrival, createWaking, stepWaking, wakingSource, practicalLevel, lampCatch } from "../src/waking.js";

test("the wave crosses the island once, decelerating, and leaves nothing behind", () => {
  const spec = WAKE_LIGHT.fireflies;
  assert.equal(waveAt(0.5, spec, 1).strength, 0, "not before the catch");
  assert.equal(waveAt(8, spec, 1).strength + waveAt(8, spec, 1).echoStrength, 0, "over by 8 s");
  const v0 = waveAt(WAVE.start + 0.01, spec, 1).speed;
  assert.ok(v0 > 25 && v0 < 36, `starts at about 30 m/s (${v0})`);
  const r6 = waveAt(6.5, spec, 1).radius;
  assert.ok(r6 > 110 && r6 < 160, `past the island's far shore by 6.5 s (${r6})`);
  let last = 0;
  for (let s = WAVE.start; s < 7.8; s += 0.05) {
    const v = waveAt(s, spec, 1);
    assert.ok(v.radius >= last && v.strength <= WAVE.night + 1e-9);
    last = v.radius;
  }
  assert.ok(waveAt(6.6, spec, 1).echo < waveAt(6.0, spec, 1).echo, "the echo runs home");
  assert.equal(waveAt(3, spec, 1, true).strength, 0, "reduced motion: no wave");
  assert.ok(waveAt(3, spec, 0).strength < waveAt(3, spec, 1).strength, "dimmer by day");
  assert.ok(Math.abs(waveAt(waveArrival(40), spec, 1).radius - 40) < 1e-6);
  assert.equal(waveArrival(10, { wave: 0 }), Infinity);
});

test("no flicker above 3 Hz: the catch's gutters, at any catch speed", () => {
  for (const speed of [1, 2]) {
    let dips = 0, prev = lampCatch(0, speed), falling = false;
    for (let s = 0.01; s <= 1.0; s += 0.002) {
      const c = lampCatch(s, speed);
      if (c < prev) falling = true;
      else if (falling && c > prev) { dips++; falling = false; }
      prev = c;
    }
    assert.ok(dips <= 3, `speed ${speed}: ${dips} dips in the first second`);
  }
});

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
  // The hollow sits in the bole's face toward the visitor, not inside it.
  const hollow = wakingSource("fireflies", { crown: { x: 5, z: 6 }, surface: () => 2, toward: [5, 16] });
  assert.ok(Math.abs(hollow[0] - 5) < 1e-9 && Math.abs(hollow[2] - 7.05) < 1e-9 && hollow[1] === 3.6);
  // The wreck's ember: the furnace end of the boiler drum facing the visitor.
  const drum = { k: 2, rad: 0.64, ax: 0, ay: 0.3, az: 2, bx: 2, by: 0.3, bz: 2, x: 1, z: 2 };
  const ember = wakingSource("tideglow", { pois, blockers: [drum], toward: [10, 2] });
  assert.ok(ember[0] > 2 && Math.abs(ember[2] - 2) < 1e-9, "past the drum's near end");
  assert.equal(wakingSource("boat", { pois }), null);
  assert.equal(practicalLevel(0), 0);
  assert.equal(practicalLevel(8), 1);
  assert.equal(practicalLevel(-Infinity), 0);
  assert.equal(practicalLevel(Infinity), 1);
  for (const g of GIFTS) assert.equal(GIFT_COLOURS[g].length, 3);
});

// On the real props (the places rework rebuilt them after these anchors
// were set): the ember in the boiler's furnace mouth, the pool's light in
// its water over the basin floor, the boat's in its lantern, the lamp in
// the lantern room, the hollow in the milkwood's bole face.
test("each waking light sits in its own prop on the reworked places", async () => {
  const { island, walkerFor } = await import("./interaction-harness.js");
  const { groundHeight } = await import("../src/terrain.js");
  for (const seed of [1847, 1, 99999]) {
    const { places } = island(seed);
    const walker = walkerFor(seed);
    const at = (gift) => wakingSource(gift, { pois: places.pois, crown: places.crown, beacon: places.beacon, blockers: places.blockers, anchors: places.wakingAnchors, surface: gift === "seafolk" ? walker.surface : groundHeight });
    const boiler = places.affordances.find((a) => a.id === "wreck-boiler");
    const ember = at("tideglow");
    const into = (ember[0] - boiler.x) * Math.sin(boiler.facing) + (ember[2] - boiler.z) * Math.cos(boiler.facing);
    assert.ok(Math.hypot(ember[0] - boiler.x, ember[2] - boiler.z) < 1.4 && into > 0.3, `seed ${seed}: the ember toward the furnace mouth (${into.toFixed(2)} m)`);
    assert.ok(ember[1] > boiler.y && ember[1] < boiler.y + 0.5, `seed ${seed}: the ember on the furnace floor`);
    const pool = places.pois.find((p) => p.id === "pool");
    const sea = at("seafolk");
    assert.ok(Math.hypot(sea[0] - pool.x, sea[2] - pool.z) < 0.5 && sea[1] > walker.surface(pool.x, pool.z) + 0.02, `seed ${seed}: the pool's light above its floor`);
    const lantern = places.lamps.find((l) => Math.hypot(l.x - places.wakingAnchors.boat[0], l.z - places.wakingAnchors.boat[2]) < 0.01);
    assert.ok(lantern && Math.abs(at("boat")[1] - lantern.y) < 0.01, `seed ${seed}: the boat's light in its lantern`);
    assert.deepEqual(at("lamp"), [places.beacon.x, places.beacon.y, places.beacon.z]);
    const hollow = at("fireflies"), bole = places.obstacles.trunks.find((t) => Math.hypot(t.x - places.crown.x, t.z - places.crown.z) < 0.01);
    const d = Math.hypot(hollow[0] - bole.x, hollow[2] - bole.z);
    assert.ok(d > bole.r - 0.05 && d < bole.r + 0.2, `seed ${seed}: the hollow in the bole's face (${d.toFixed(2)} m, bole ${bole.r.toFixed(2)})`);
  }
});
