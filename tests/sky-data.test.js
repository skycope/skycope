import assert from "node:assert/strict";
import { test } from "node:test";
import {
  capeTime,
  capeMinutes,
  dateAtCapeMinutes,
  skyAt,
} from "../src/astronomy.js";
import { fetchWeather, WEATHER_MAX_AGE_MS } from "../src/weather.js";

test("Cape Town's date and time do not depend on the visitor's timezone", () => {
  const now = new Date("2026-09-08T23:30:00Z");
  assert.equal(capeTime(now), "01:30");
  assert.equal(capeMinutes(now), 90);
  assert.equal(
    dateAtCapeMinutes(0, now).toISOString(),
    "2026-09-08T22:00:00.000Z",
  );
  assert.equal(
    dateAtCapeMinutes(1439, now).toISOString(),
    "2026-09-09T21:59:00.000Z",
  );
});

test("solar altitude, direction and palette agree with Cape Town's September sky", () => {
  // Broad physical bounds catch degree/radian or azimuth convention regressions.
  const noon = skyAt(new Date("2026-09-08T10:00:00Z"));
  assert.ok(noon.sunAltitude > 45 && noon.sunAltitude < 55);
  assert.ok(noon.sunAzimuth > 0 && noon.sunAzimuth < 30);
  assert.ok(noon.sun[1] > 0.7 && noon.sun[2] > 0.5);
  assert.equal(noon.scene, 0);
  const sunset = skyAt(new Date("2026-09-08T16:25:00Z"));
  assert.ok(sunset.sunAzimuth > 270 && sunset.sunAzimuth < 285);
  assert.ok(sunset.sun[0] < -0.9);
  assert.ok(sunset.scene > 0.7 && sunset.scene < 1.2);
  const midnight = skyAt(new Date("2026-09-08T22:00:00Z"));
  assert.ok(midnight.sun[1] < -0.8);
  assert.equal(midnight.scene, 2);
  for (const sky of [noon, sunset, midnight]) {
    assert.ok(Math.abs(Math.hypot(...sky.sun) - 1) < 1e-10);
    assert.ok(Math.abs(Math.hypot(...sky.moon) - 1) < 1e-10);
    assert.ok(sky.sidereal >= 0 && sky.sidereal < Math.PI * 2);
  }
});

test("weather requests fixed Cape Town coordinates and maps cloud layers and wind", async (t) => {
  let requested;
  t.mock.method(globalThis, "fetch", async (url) => {
    requested = new URL(url);
    return Response.json(weatherResponse());
  });
  const weather = await fetchWeather(new AbortController().signal);
  assert.equal(requested.searchParams.get("latitude"), "-33.9249");
  assert.equal(requested.searchParams.get("timezone"), "Africa/Johannesburg");
  assert.equal(weather.low, 0.7);
  assert.equal(weather.cover, 0.8);
  assert.equal(weather.rain, 2);
  assert.equal(weather.description, "rain");
  // Wind from the north blows south in east/up/north world coordinates.
  assert.ok(Math.abs(weather.wind[0]) < 1e-10);
  assert.ok(Math.abs(weather.wind[1] + 10) < 1e-10);
});

test("incomplete, stale and unsuccessful weather responses cannot become live data", async (t) => {
  const incomplete = weatherResponse();
  incomplete.current.cloud_cover_low = null;
  const stale = weatherResponse();
  stale.current.time -= WEATHER_MAX_AGE_MS / 1000 + 60;
  const responses = [
    Response.json(incomplete),
    Response.json(stale),
    new Response(null, { status: 503 }),
  ];
  t.mock.method(globalThis, "fetch", async () => responses.shift());
  await assert.rejects(fetchWeather(), /incomplete/);
  await assert.rejects(fetchWeather(), /out of date/);
  await assert.rejects(fetchWeather(), /503/);
});

function weatherResponse() {
  return {
    current: {
      time: Math.floor(Date.now() / 1000),
      temperature_2m: 18.4,
      cloud_cover: 80,
      cloud_cover_low: 70,
      cloud_cover_mid: 20,
      cloud_cover_high: 30,
      precipitation: 2,
      weather_code: 63,
      wind_speed_10m: 36,
      wind_direction_10m: 0,
    },
  };
}

test("world seeds are reproducible and invalid seeds cannot freeze the generator", async () => {
  const { sceneSeed, seededRandom } = await import("../src/random.js");
  assert.equal(sceneSeed("?seed=1847"), 1847);
  assert.equal(sceneSeed("?seed=4294967295"), 4294967295);
  for (const search of [
    "",
    "?seed=0",
    "?seed=-1",
    "?seed=NaN",
    "?seed=4294967296",
  ]) {
    const seed = sceneSeed(search);
    assert.ok(Number.isInteger(seed) && seed > 0 && seed <= 0xffffffff);
  }
  const a = seededRandom(1847);
  const b = seededRandom(1847);
  const c = seededRandom(2026);
  const samples = Array.from({ length: 20 }, () => a());
  assert.deepEqual(
    samples,
    Array.from({ length: 20 }, () => b()),
  );
  assert.notDeepEqual(
    samples,
    Array.from({ length: 20 }, () => c()),
  );
  const zero = seededRandom(0);
  assert.notEqual(zero(), zero());
});
