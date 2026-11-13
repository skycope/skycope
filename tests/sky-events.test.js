import test from "node:test";
import { MAGIC_FIELDS } from "../src/sea-sky-magic.js"; // boat:
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { skyAt } from "../src/astronomy.js";
import { lightingAt } from "../src/sunlight.js";
import {
  skyConditions,
  skyEventFrame,
  skySpectacles,
  createSkyEvents,
  strikeBrightness,
  strikeInSlot,
  parseSkyForce,
  quietSkyUniforms,
} from "../src/sky-events.js";

const at = (iso) => skyAt(new Date(iso));
const showers = { low: 0.45, mid: 0.15, high: 0.2, cover: 0.5, rain: 1.5, wind: [3, 1] };
const clear = { low: 0, mid: 0, high: 0.05, cover: 0.05, rain: 0, wind: [2, 1] };
const overcastRain = { low: 0.95, mid: 0.75, high: 0.8, cover: 1, rain: 3, wind: [6, 2] };
const storm = { low: 1, mid: 0.9, high: 0.9, cover: 1, rain: 8, wind: [12, 5], preset: "storm" };
const LOW_SUN = "2026-09-08T15:50:00Z"; // sun 8° in the west
const NOON = "2026-09-08T12:00:00Z"; // sun ~50°
const NIGHT = "2026-09-10T19:30:00Z"; // moonless

test("a rainbow needs sunlit rain and a sun lower than 42°", () => {
  assert.ok(skyConditions({ celestial: at(LOW_SUN), weather: showers, sunlit: 0.9 }).rainbow > 0.5);
  // Sun too high: the bow is below the horizon.
  assert.equal(skyConditions({ celestial: at(NOON), weather: showers, sunlit: 0.9 }).rainbow, 0);
  // No rain, or the sun behind the cloud, or a full deck: no bow.
  assert.equal(skyConditions({ celestial: at(LOW_SUN), weather: { ...showers, rain: 0 }, sunlit: 0.9 }).rainbow, 0);
  assert.equal(skyConditions({ celestial: at(LOW_SUN), weather: showers, sunlit: 0.1 }).rainbow, 0);
  assert.equal(skyConditions({ celestial: at(LOW_SUN), weather: overcastRain }).rainbow, 0);
  // Night: no sun bow; a moonbow only under a bright moon.
  assert.equal(skyConditions({ celestial: at(NIGHT), weather: showers, sunlit: 0.9 }).moonbow, 0);
  assert.ok(skyConditions({ celestial: at("2026-09-26T19:00:00Z"), weather: showers, sunlit: 0.9 }).moonbow > 0.5);
});

test("nothing fires where it cannot occur", () => {
  // A clear noon: no rainbow, halo, rays, lightning, meteors or zodiacal light.
  const quiet = skyEventFrame({ seed: 7, time: 100, celestial: at(NOON), weather: clear, date: new Date(NOON) });
  assert.deepEqual(quiet.uniforms, quietSkyUniforms());
  // Meteors and satellites never by day; lightning never without a storm.
  for (let t = 0; t < 3600; t += 1.3) {
    const f = skyEventFrame({ seed: 7, time: t, celestial: at(NOON), weather: showers, sunlit: 0.9, date: new Date(NOON) });
    assert.equal(f.uniforms.meteor[3] + f.uniforms.trail[3] + f.uniforms.satellite[3], 0);
    assert.equal(f.uniforms.events[1], 0);
  }
  // Crepuscular rays: not under a clear sky nor a full overcast deck.
  assert.equal(skyConditions({ celestial: at(LOW_SUN), weather: clear }).rays, 0);
  assert.equal(skyConditions({ celestial: at(LOW_SUN), weather: { ...overcastRain, rain: 0 } }).rays, 0);
  assert.ok(skyConditions({ celestial: at(LOW_SUN), weather: { ...showers, rain: 0 } }).rays > 0.3);
  // Meteors are hidden by cloud.
  assert.equal(skyConditions({ celestial: at(NIGHT), weather: overcastRain }).meteorVisibility, 0);
});

test("events are deterministic by seed and time", () => {
  const input = { celestial: at(NIGHT), weather: storm, date: new Date(NIGHT) };
  const run = (seed) => {
    const out = [];
    for (let t = 0; t < 600; t += 1 / 30) {
      const f = skyEventFrame({ seed, time: t, ...input });
      if (f.uniforms.events[1] > 0) out.push(`${t.toFixed(3)}:${f.uniforms.bolt.map((v) => v.toFixed(4))}`);
    }
    return out.join("|");
  };
  const a = run(1847);
  assert.ok(a.length > 0, "a storm flashes within ten minutes");
  assert.equal(a, run(1847));
  assert.notEqual(a, run(1848));
});

test("a storm flashes a few times a minute, each stroke seen on a frame", () => {
  let strikes = 0;
  for (let slot = 0; slot < 600; slot++) if (strikeInSlot(3, slot, 3)) strikes++;
  assert.ok(strikes > 15 && strikes < 50, `${strikes} strikes in ten minutes`);
  const strike = strikeInSlot(3, 0, 60, { bearing: 0, elevation: 20 });
  // Integrated over the frame: a 60 fps frame and a 30 fps frame both catch it.
  assert.ok(strikeBrightness(strike, strike.at + 1 / 60, 1 / 60) > 0.5);
  assert.ok(strikeBrightness(strike, strike.at + 1 / 30, 1 / 30) > 0.3);
  assert.equal(strikeBrightness(strike, strike.at + 3), 0);
  assert.ok(Math.abs(strike.thunderDelay - strike.distanceKm / 0.343) < 1e-9);
});

test("the live scheduler publishes each strike once, with its bearing and distance", () => {
  const events = createSkyEvents({ seed: 1847 });
  const heard = [];
  events.on((e) => heard.push(e));
  const celestial = at(NIGHT);
  const lighting = lightingAt(celestial, storm);
  for (let t = 0; t < 300; t += 1 / 60) events.update({ time: t, celestial, weather: storm, lighting, date: new Date(NIGHT) });
  const strikes = heard.filter((e) => e.type === "lightning");
  assert.ok(strikes.length > 3);
  assert.equal(new Set(strikes.map((e) => e.at)).size, strikes.length);
  for (const s of strikes) {
    assert.ok(s.bearing >= 0 && s.bearing < 360 && s.distanceKm > 2 && s.strength > 0);
    assert.ok(["ground", "cloud"].includes(s.kind));
  }
});

test("meteors fly on dark clear nights, away from a shower's radiant", () => {
  let seen = 0;
  for (let t = 0; t < 3600; t += 0.5) {
    const f = skyEventFrame({ seed: 5, time: t, celestial: at(NIGHT), weather: clear, date: new Date(NIGHT) });
    if (f.uniforms.meteor[3] > 0) {
      seen++;
      assert.ok(f.uniforms.meteor[1] > 0, "meteors are above the horizon");
    }
  }
  assert.ok(seen > 5, `${seen} meteor frames in an hour`);
  // Geminid peak: the shower's radiant is up in the small hours.
  const geminids = skyConditions({ celestial: at("2026-12-14T00:30:00Z"), weather: clear, date: new Date("2026-12-14T00:30:00Z") });
  assert.equal(geminids.shower?.id, "geminids");
});

test("skySpectacles lists what can be seen, pure and sorted", () => {
  const date = new Date(LOW_SUN);
  const list = skySpectacles({ date, weather: showers, sunlit: 0.9, seed: 1 });
  const bow = list.find((s) => s.id === "rainbow");
  assert.ok(bow?.active);
  // Opposite the sun (west-ish): the bow is in the east.
  assert.ok(bow.bearing > 60 && bow.bearing < 140);
  assert.deepEqual(list, skySpectacles({ date, weather: showers, sunlit: 0.9, seed: 1 }));
  for (const s of list) assert.ok(s.title && typeof s.active === "boolean");
  assert.equal(skySpectacles({ date: new Date(NOON), weather: clear }).filter((s) => s.active).length, 0);
  const night = skySpectacles({ date: new Date(NIGHT), weather: clear });
  assert.ok(night.some((s) => s.id === "meteors"));
});

test("debug forcing only with ?perf", () => {
  assert.equal(parseSkyForce("?sky=rainbow"), null);
  assert.deepEqual(parseSkyForce("?perf&sky=rainbow,lightning"), ["rainbow", "lightning"]);
  assert.equal(parseSkyForce("?perf&sky=aurora"), null);
});

test("the Atmosphere struct carries the sky-event fields at its end", () => {
  const view = readFileSync(new URL("../src/shaders/view.wgsl", import.meta.url), "utf8");
  const struct = view.match(/struct Atmosphere \{([^]*?)\n\};/)[1];
  const fields = [...struct.matchAll(/^\s*(\w+):/gm)].map((m) => m[1]);
  // sea-sky-magic's fields follow them (tests/sea-sky-magic.test.js).
  // (boat: eight of them now, with the lantern.)
  const magic = MAGIC_FIELDS.length;
  assert.deepEqual(fields.slice(-7 - magic, -magic), Object.keys(quietSkyUniforms()));
  const render = readFileSync(new URL("../scripts/render-sky.mjs", import.meta.url), "utf8");
  assert.match(render, /skyEventFrame/);
});
