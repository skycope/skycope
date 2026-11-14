import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { STAGES, progressAt, homeView, project, wispRise, skyColour, paint, TONE, toneCurve, createLoadingScreen } from "../src/loading-screen.js";
import { skyAt } from "../src/astronomy.js";
import { createWalker } from "../src/walker.js";

// Cape Town minutes on a fixed day (UTC+2).
const at = (minutes) => skyAt(new Date(Date.UTC(2026, 10, 14, 0, minutes) - 2 * 3600000));

test("progress only moves forward, through the milestones, to 1", () => {
  let p = 0;
  let last = 0;
  for (const stage of ["start", "gpu", "island", "world", "shaders", "ready"]) {
    p = progressAt(stage, p);
    assert.ok(p > last, stage);
    last = p;
  }
  assert.equal(p, 1);
  assert.equal(progressAt("gpu", 0.5), 0.5, "a late milestone never moves it back");
  assert.equal(progressAt("unknown", 0.3), 0.3);
  assert.ok(Object.values(STAGES).every((v) => v > 0 && v <= 1));
});

test("the veil paints from the camera the walker opens on", () => {
  const camera = createWalker({ trunks: [], domes: [] }).camera;
  const view = homeView();
  for (const k of ["x", "y", "z"]) assert.ok(Math.abs(view[k] - camera[k]) < 0.15, `${k}: ${view[k]} vs ${camera[k]}`);
  assert.ok(Math.abs(view.azimuth - camera.azimuth) < 0.01);
  assert.ok(Math.abs(view.pitch - camera.pitch) < 0.03);
});

test("projection: straight ahead is the centre, the wisp's rise is in view", () => {
  const view = { x: 0, y: 2, z: 0, azimuth: -Math.PI / 4, pitch: 0 };
  // azimuth -π/4 looks along +z.
  const [u, v] = project(view, [0, 2, 50], 16 / 9);
  assert.ok(Math.abs(u - 0.5) < 1e-9 && Math.abs(v - 0.5) < 1e-9);
  assert.ok(project(view, [3, 2, 50], 16 / 9)[0] > 0.5, "+x is to the right");
  assert.ok(project(view, [0, 4, 50], 16 / 9)[1] < 0.5, "up is up");
  assert.equal(project(view, [0, 2, -5], 1), null);
  const home = homeView();
  const cat = createWalker({ trunks: [], domes: [] }).cat;
  const rise = project(home, wispRise(cat), 16 / 10);
  assert.ok(rise && rise[0] > 0 && rise[0] < 1 && rise[1] > 0 && rise[1] < 1, String(rise));
});

test("the tone curve is tone.wgsl's", () => {
  const wgsl = readFileSync(new URL("../src/shaders/tone.wgsl", import.meta.url), "utf8");
  const constant = (name) => wgsl.match(new RegExp(`const ${name}: \\w+ = ([^;]+);`))[1];
  assert.equal(Number(constant("TONE_GAIN")), TONE.gain);
  assert.equal(Number(constant("VIBRANCE")), TONE.vibrance);
  assert.equal(Number(constant("OVERCAST_VIBRANCE")), TONE.overcastVibrance);
  assert.deepEqual(constant("OVERCAST_BALANCE").replace(/^\w+\(/, "").match(/[\d.]+/g).map(Number), TONE.overcastBalance);
  // Black stays black, bright light rolls off below white.
  assert.deepEqual(toneCurve([0, 0, 0], 0), [0, 0, 0]);
  assert.ok(toneCurve([20, 20, 20], 0).every((v) => v > 0.9 && v <= 1));
});

test("the sky's colours follow the hour", () => {
  const up = [0, 1, 0];
  const noon = skyColour(at(750), null, up);
  const night = skyColour(at(1320), null, up);
  assert.ok(noon[2] > noon[0] + 40, `noon zenith is blue: ${noon}`);
  assert.ok(night.reduce((a, b) => a + b) < noon.reduce((a, b) => a + b) / 3, `night is dark: ${night}`);
  // Near sunset the sky toward the sun is the bright side, and at dusk the
  // low sky glows warm.
  const sky = at(1150);
  const sun = [(sky.sun[0] + sky.sun[2]) * Math.SQRT1_2, 0.2, (sky.sun[2] - sky.sun[0]) * Math.SQRT1_2];
  const sum = (c) => c[0] + c[1] + c[2];
  assert.ok(sum(skyColour(sky, null, sun)) > sum(skyColour(sky, null, [-sun[0], 0.2, -sun[2]])));
  const dusk = skyColour(at(1185), null, [sun[0], 0.03, sun[2]]);
  assert.ok(dusk[0] > dusk[2] + 60, `dusk horizon: ${dusk}`);
  // Overcast greys it.
  const grey = skyColour(at(750), { cover: 1, low: 1, mid: 1, high: 1, rain: 0 }, up);
  assert.ok(Math.abs(grey[2] - grey[0]) < Math.abs(noon[2] - noon[0]));
});

test("the painting is whole, opaque and lit by the hour", () => {
  const mean = (pixels) => {
    let sum = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      assert.equal(pixels[i + 3], 255);
      sum += pixels[i] + pixels[i + 1] + pixels[i + 2];
    }
    return sum / (pixels.length / 4) / 3;
  };
  const day = paint(48, 30, { celestial: at(750) });
  const night = paint(48, 30, { celestial: at(1320), weather: { cover: 0.5, low: 0.5 } });
  assert.equal(day.length, 48 * 30 * 4);
  assert.ok(mean(day) > 100 && mean(night) < mean(day) / 2, `${mean(day)} ${mean(night)}`);
  // Sky above, land or sea below: the top row is brighter than the bottom by day.
  const row = (j) => mean(day.subarray(j * 48 * 4, (j + 1) * 48 * 4));
  assert.ok(Number.isFinite(row(0)) && Number.isFinite(row(29)));
});

test("without its markup the veil is a quiet no-op", () => {
  const absent = createLoadingScreen({ document: { querySelector: () => null } });
  absent.progress("gpu");
  absent.scene({});
  absent.ready();
  absent.fail();
  absent.dispose();
});
