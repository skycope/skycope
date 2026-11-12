import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createMagic } from "../src/magic.js";
import { magicUniforms, quietMagicUniforms, MAGIC_FIELDS, lampAngle, magicFixture } from "../src/sea-sky-magic.js";

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
  assert.deepEqual(u.magic, [1, 1, 1, 1]);
  // Awake at load: the figures draw from load.
  assert.ok(Math.abs(u.magic2[0] - 30) < 0.01);
  assert.deepEqual(u.lamp.slice(0, 3), [5, 16, -7]);
  assert.ok(Math.abs(u.lamp[3] - lampAngle(30)) < 1e-9);
  // The lamp turns once in 12 s, like places.js.
  assert.ok(Math.abs(lampAngle(3) - Math.PI / 2) < 1e-9);
  assert.ok(Math.abs(lampAngle(15) - lampAngle(3)) < 1e-9);
});

test("the pulse runs at its own speed and fades out past its reach", () => {
  const record = magicFixture({ gifts: ["tideglow"], clock: 12, pulse: { x: 4, y: 0, z: 9, at: 10, gift: "tideglow", colour: [0.4, 0.8, 1], speed: 18, reach: 150 } });
  const u = magicUniforms(record);
  assert.deepEqual(u.pulse.slice(0, 3), [4, 9, 36]);
  assert.equal(u.pulse[3], 1);
  assert.deepEqual(u.pulseColour, [0.4, 0.8, 1, 150]);
  const late = magicUniforms({ ...record, clock: 10 + 600 / 18 });
  assert.deepEqual(late.pulse, [0, 0, 0, 0]);
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

test("the stars gift brings meteors and answers a meow with a falling star", async () => {
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
  assert.ok(count({ stars: 1 }) > count(null) * 2);
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
