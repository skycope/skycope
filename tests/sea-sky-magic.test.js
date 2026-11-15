import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createMagic } from "../src/magic.js";
import { magicUniforms, quietMagicUniforms, MAGIC_FIELDS, lampAngle, magicFixture, magicPasses } from "../src/sea-sky-magic.js";
import { WAKE_LIGHT, wakingSea } from "../src/waking.js";

test("every magic uniform is zero while every gift sleeps", () => {
  const magic = createMagic();
  magic.update(1 / 60, 10);
  const u = magicUniforms(magic, { time: 10, lamp: { x: 1, y: 2, z: 3 } });
  for (const k of MAGIC_FIELDS) assert.deepEqual(u[k], [0, 0, 0, 0], k);
  assert.deepEqual(u, quietMagicUniforms());
  assert.deepEqual(magicUniforms(null), quietMagicUniforms());
});

test("awake gifts fill their lanes", () => {
  const magic = createMagic({ force: ["tideglow", "stars", "lamp", "finale"] });
  magic.update(1 / 60, 30);
  const u = magicUniforms(magic, { time: 30, lamp: { x: 5, y: 16, z: -7 } });
  // The sky no longer leans close (story-and-wow.md 6): y stays 0.
  assert.deepEqual(u.magic.slice(0, 3), [1, 0, 1]);
  // The ending has happened: the south star, steady, for good; no pen.
  assert.equal(u.magic[3], 1);
  magic.update(1 / 60, 600);
  assert.equal(magicUniforms(magic, { time: 600 }).magic[3], 1);
  assert.equal(u.magic2[0], 0);
  // While the ending plays, its record drives the star, the swell, the pen.
  magic.ending = { star: 0.4, swell: 0.7, pen: 1.5 };
  const e = magicUniforms(magic, { time: 600 });
  assert.equal(e.magic[3], 0.4);
  assert.equal(e.magic2[0], 1.5);
  assert.equal(e.wispColour[3], 0.7);
  magic.ending = null;
  assert.deepEqual(u.lamp.slice(0, 3), [5, 16, -7]);
  assert.ok(Math.abs(u.lamp[3] - lampAngle(30)) < 1e-9);
  // The lamp turns once in 12 s, like places.js.
  assert.ok(Math.abs(lampAngle(3) - Math.PI / 2) < 1e-9);
  assert.ok(Math.abs(lampAngle(15) - lampAngle(3)) < 1e-9);
});

test("a waking's light reaches the sea with its own reach, and only for gifts that do", () => {
  const waking = { gift: "tideglow", x: 4, y: 0.6, z: 9, age: 2.2 };
  const record = magicFixture({ gifts: ["tideglow"], clock: 12, waking });
  const u = magicUniforms(record, { night: 1 });
  const sea = wakingSea(2.2, WAKE_LIGHT.tideglow, 1);
  assert.deepEqual(u.waking.slice(0, 2), [4, 9]);
  assert.ok(Math.abs(u.waking[2] - sea.radius) < 1e-9 && sea.radius > 30 && sea.radius < 120);
  assert.ok(u.waking[3] > 0, "its front");
  assert.equal(u.wakingLight[3], 0.6, "the source's height");
  assert.ok(u.wakingLight[2] > u.wakingLight[0], "blue");
  assert.deepEqual(magicPasses(u).water, true);
  // The lit water keeps glinting after the land has gone dark, then ends.
  assert.ok(magicUniforms({ ...record, waking: { ...waking, age: 9 } }, { night: 1 }).waking[2] > 0);
  assert.deepEqual(magicUniforms({ ...record, waking: { ...waking, age: 16.1 } }, { night: 1 }).waking, [0, 0, 0, 0]);
  // The milkwood's own light stays on the land; only its wave crosses the bay.
  const milkwood = magicUniforms({ ...record, waking: { ...waking, gift: "fireflies" } }, { night: 1 });
  assert.equal(milkwood.waking[2], 0);
  assert.ok(milkwood.wakingWave[2] > 0 && milkwood.wakingWave[0] > 0, "the wave");
  assert.deepEqual(milkwood.waking.slice(0, 2), [4, 9], "from its source");
  assert.equal(magicPasses(milkwood).water, true);
  // The wave and its echo are over by eight seconds.
  const late = magicUniforms({ ...record, waking: { ...waking, gift: "fireflies", age: 8 } }, { night: 1 });
  assert.deepEqual([late.wakingWave, late.wakingTint, late.waking], [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]);
  const call = magicUniforms({ ...record, call: { at: 11, x: 0, z: 0 } });
  assert.ok(Math.abs(call.magic2[1] - 1) < 0.01);
});

test("the Atmosphere struct ends with the magic fields", () => {
  const view = readFileSync(new URL("../src/shaders/view.wgsl", import.meta.url), "utf8");
  const struct = view.match(/struct Atmosphere \{([^]*?)\n\};/)[1];
  const fields = [...struct.matchAll(/^\s*(\w+):/gm)].map((m) => m[1]);
  assert.deepEqual(fields.slice(-MAGIC_FIELDS.length), MAGIC_FIELDS);
  const render = readFileSync(new URL("../scripts/render-sky.mjs", import.meta.url), "utf8");
  assert.match(render, /magicUniforms/);
  const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  assert.match(main, /magicUniforms/);
});

test("the stars gift keeps the real meteor rate and answers a meow with a falling star", async () => {
  const { skyEventFrame, skyConditions, CALL_ANSWER } = await import("../src/sky-events.js");
  const { skyAt } = await import("../src/astronomy.js");
  const date = new Date("2026-09-10T19:30:00Z");
  const celestial = skyAt(date);
  const weather = { low: 0, mid: 0, high: 0, cover: 0, rain: 0, wind: [2, 1] };
  const base = { seed: 1847, date, celestial, weather, view: { azimuth: 3.5, pitch: 0.35 } };
  const c = skyConditions({ celestial, weather, date });
  assert.ok(c.meteorVisibility > 0.01, "a dark night");
  const count = (magic) => {
    let n = 0;
    for (let t = 0; t < 600; t += 0.5) if (skyEventFrame({ ...base, time: t, magic }).uniforms.meteor[3] > 0) n++;
    return n;
  };
  assert.equal(count({ stars: 1 }), count(null), "no extra meteors");
  // Asleep, a meow brings nothing; awake, a star falls after the delay.
  const callAt = 500.3;
  const at = callAt + CALL_ANSWER.delay + 0.15;
  const quiet = skyEventFrame({ ...base, time: at, magic: { stars: 0, callAt } });
  const answered = skyEventFrame({ ...base, time: at, magic: { stars: 1, callAt } });
  assert.ok(answered.uniforms.meteor[3] > 0.5);
  assert.ok(answered.uniforms.meteor[3] > quiet.uniforms.meteor[3]);
  // Unchanged without magic.
  assert.deepEqual(skyEventFrame({ ...base, time: 120 }).uniforms, skyEventFrame({ ...base, time: 120, magic: null }).uniforms);
});

test("magicVariant compiles the gifts in or out by the MAGIC_AWAKE override", async () => {
  const { magicVariant, magicActive, quietMagicUniforms } = await import("../src/sea-sky-magic.js");
  const view = readFileSync(new URL("../src/shaders/view.wgsl", import.meta.url), "utf8");
  assert.match(magicVariant(view, false), /@id\(7301\) override MAGIC_AWAKE: bool = false;/);
  assert.match(magicVariant("@id(7301) override a:bool=true;", false), /a:bool=false;/);
  assert.deepEqual(magicVariant({ version: 1, wgsl: "@id(7301) override a:bool=false;" }, true), { version: 1, wgsl: "@id(7301) override a:bool=true;" });
  assert.throws(() => magicVariant("fn x() {}", false));
  assert.equal(magicActive(quietMagicUniforms()), false);
  assert.equal(magicActive({ ...quietMagicUniforms(), wisp: [1, 2, 3, 0.5] }), true);
});

test("asleep gifts select the plain pipelines, pass by pass", async () => {
  const { magicPasses, magicUniforms, quietMagicUniforms } = await import("../src/sea-sky-magic.js");
  const quiet = quietMagicUniforms();
  assert.deepEqual(magicPasses(quiet), { sky: false, water: false });
  // Every gift asleep in a real record (no waking, no wisp): both plain.
  const asleep = createMagic();
  asleep.update(1 / 60, 10);
  assert.deepEqual(magicPasses(magicUniforms(asleep, { time: 10 })), { sky: false, water: false });
  // The wisp lights the sea, not the sky: only the water wakes.
  assert.deepEqual(magicPasses({ ...quiet, wisp: [1, 2, 3, 0.5] }), { sky: false, water: true });
  assert.deepEqual(magicPasses({ ...quiet, lantern: [1, 2, 3, 0.5] }), { sky: false, water: true });
  assert.deepEqual(magicPasses({ ...quiet, waking: [1, 2, 3, 0] }), { sky: false, water: true }, "a waking lights the water through its linger (front 0, radius set)");
  // A meow alone draws nothing in either pass.
  assert.deepEqual(magicPasses({ ...quiet, magic2: [0, 4, 0, 0] }), { sky: false, water: false });
  // The south star and the Cross's pen wake the sky only; tideglow and
  // the lamp only the sea.
  assert.deepEqual(magicPasses({ ...quiet, magic: [0, 0, 0, 0.3] }), { sky: true, water: false });
  assert.deepEqual(magicPasses({ ...quiet, magic2: [1.2, 0, 0, 0] }), { sky: true, water: false });
  assert.deepEqual(magicPasses({ ...quiet, magic: [1, 0, 1, 0] }), { sky: false, water: true });
});
