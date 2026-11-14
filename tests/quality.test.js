import test from "node:test";
import assert from "node:assert/strict";
import {
  STEPS,
  baseSettings,
  qualityLadder,
  renderSizes,
  createQualityState,
  stepQuality,
  pinQuality,
  qualitySettings,
} from "../src/quality.js";

// Feed `seconds` of frames at `fps` with a constant cost.
function run(state, { from = 0, seconds, cost, source = "gpu", fps = 60 }) {
  let s = state;
  let now = from;
  const levels = [];
  for (let i = 0; i < seconds * fps; i++) {
    now = from + i / fps;
    s = stepQuality(s, { now, cost: typeof cost === "function" ? cost(s, now) : cost, source });
    levels.push(s.level);
  }
  return { state: s, now, levels };
}

test("the ladder sheds in the recommended order, land resolution last", () => {
  const ladder = qualityLadder(baseSettings());
  const order = [];
  for (let i = 1; i < ladder.length; i++) {
    const changed = Object.keys(ladder[i]).filter((k) => ladder[i][k] !== ladder[i - 1][k]);
    order.push(...changed.filter((k) => !order.includes(k)));
  }
  assert.deepEqual(order, ["shadowSlices", "cloudSteps", "skyScale", "seaScale", "lodBias", "fps", "landScale"]);
  const last = ladder[ladder.length - 1];
  assert.equal(last.landScale, 0.85);
  assert.equal(last.fps, 30);
  // Desktop starts at MSAA 2, the alpha-to-coverage floor: never shed below it.
  assert.ok(ladder.every((l) => l.msaa === 2));
  // Every level differs from the one above (no wasted steps).
  for (let i = 1; i < ladder.length; i++) assert.notDeepEqual(ladder[i], ladder[i - 1]);
});

test("a budget that starts at MSAA 4 sheds it to 2 before pacing", () => {
  const ladder = qualityLadder({ ...baseSettings(), msaa: 4 });
  const msaa = ladder.findIndex((l) => l.msaa === 2);
  const fps = ladder.findIndex((l) => l.fps < 60);
  assert.ok(msaa > 0 && msaa < fps);
  assert.ok(STEPS.some((s) => s.msaa === 2));
});

test("40 fps is offered only where the display paces it evenly", () => {
  const paces = (refresh) => [...new Set(qualityLadder(baseSettings(), { refresh }).map((l) => l.fps))];
  assert.deepEqual(paces(60), [60, 30]);
  assert.deepEqual(paces(120), [60, 40, 30]);
});

test("the light budget never gains MSAA and keeps its cheaper clouds", () => {
  const ladder = qualityLadder(baseSettings({ light: true }));
  assert.ok(ladder.every((l) => l.msaa === 0));
  assert.ok(ladder.every((l) => l.cloudSteps === 32));
});

test("render sizes: land, sea and sky from one place", () => {
  const settings = baseSettings();
  const retina = renderSizes({ width: 1440, height: 900, dpr: 2 }, settings);
  // Capped by the pixel budgets, not the device pixel ratio.
  assert.ok(retina.land[0] * retina.land[1] <= 1.62e6);
  assert.ok(retina.sea[0] * retina.sea[1] <= 1.52e6);
  assert.deepEqual(retina.cloud, [Math.ceil(retina.sky[0] / 2), Math.ceil(retina.sky[1] / 2)]);
  // A small window at 1x renders at its own size.
  const small = renderSizes({ width: 800, height: 600, dpr: 1 }, settings);
  assert.deepEqual(small.land, [800, 600]);
  assert.deepEqual(small.sea, [800, 600]);
  // The deepest shed keeps the land at 0.85 linear.
  const ladder = qualityLadder(settings);
  const worst = renderSizes({ width: 1440, height: 900, dpr: 2 }, ladder[ladder.length - 1]);
  assert.ok(Math.abs(worst.land[0] / retina.land[0] - 0.85) < 0.01);
  // The reveal puts every layer on one coarse grid; a photo overrides the budget.
  const reveal = renderSizes({ width: 1440, height: 900, dpr: 2, reveal: 1 / 8 }, settings);
  assert.deepEqual(reveal.land, [180, 113]);
  assert.deepEqual(reveal.sea, reveal.land);
  assert.deepEqual(renderSizes({ width: 1440, height: 900, dpr: 2, photo: [2400, 1500] }, settings).land, [2400, 1500]);
});

test("light load holds full quality", () => {
  const { levels } = run(createQualityState(qualityLadder(baseSettings())), { seconds: 30, cost: 9 });
  assert.ok(levels.every((l) => l === 0));
});

test("sustained GPU load sheds quickly, one step at a time, and stops when it fits", () => {
  // Each level saves 8% of the cost; 22 ms at full quality.
  const cost = (s) => 22 * Math.pow(0.92, s.level);
  const { state, levels } = run(createQualityState(qualityLadder(baseSettings())), { seconds: 20, cost });
  // At most one level per change, and settled where cost < 88% of 16.7 ms.
  for (let i = 1; i < levels.length; i++) assert.ok(levels[i] - levels[i - 1] <= 1);
  assert.ok(cost(state) < 0.88 * (1000 / qualitySettings(state).fps));
  assert.ok(cost({ level: state.level - 1 }) >= 0.88 * (1000 / 60));
  // It got there within a few seconds, not the old minute.
  const firstSettled = levels.indexOf(state.level);
  assert.ok(firstSettled / 60 < 6, `settled after ${firstSettled / 60} s`);
  // And the land is untouched by a moderate overload.
  assert.equal(qualitySettings(state).landScale, 1);
});

test("an overload too big for detail paces down to 30 fps before land resolution", () => {
  const ladder = qualityLadder(baseSettings());
  const { state } = run(createQualityState(ladder), { seconds: 30, cost: 28 });
  const s = qualitySettings(state);
  assert.equal(s.fps, 30);
  assert.equal(s.landScale, 1);
  const heavy = run(createQualityState(ladder), { seconds: 40, cost: 45 });
  assert.equal(qualitySettings(heavy.state).landScale, 0.85);
});

test("recovers quickly when the load goes away", () => {
  const ladder = qualityLadder(baseSettings());
  const loaded = run(createQualityState(ladder), { seconds: 20, cost: 30 });
  assert.ok(loaded.state.level > 4);
  const { state, levels } = run(loaded.state, { from: loaded.now, seconds: 40, cost: 6 });
  assert.equal(state.level, 0);
  const back = levels.indexOf(0) / 60;
  assert.ok(back < 25, `full quality after ${back} s`);
});

test("it does not saw-tooth on a boundary: failed restores back off", () => {
  // Level 3 has enough headroom to tempt a restore (9.5 ms < 62% of 16.7),
  // but level 2 cannot hold (15.5 ms > 88%).
  const cost = (s) => (s.level >= 3 ? 9.5 : 15.5);
  const ladder = qualityLadder(baseSettings());
  const { levels } = run(createQualityState(ladder), { seconds: 120, cost });
  let changes = 0;
  for (let i = 1; i < levels.length; i++) if (levels[i] !== levels[i - 1]) changes++;
  // Without backoff this would flip every ~2 s (~60 changes).
  assert.ok(changes < 16, `${changes} changes in 2 minutes`);
});

test("quantised intervals: sheds when frames are missed, probes back with patience", () => {
  const ladder = qualityLadder(baseSettings());
  // Frames take two vsyncs until enough has been shed.
  const interval = (s) => (s.level < 4 ? 33.3 : 16.7);
  const { state, levels } = run(createQualityState(ladder), { seconds: 120, cost: interval, source: "interval" });
  assert.ok(state.level >= 4 && state.level <= 5);
  let changes = 0;
  for (let i = 1; i < levels.length; i++) if (levels[i] !== levels[i - 1]) changes++;
  assert.ok(changes < 20, `${changes} changes`);
});

test("a pinned level holds whatever the load", () => {
  const ladder = qualityLadder(baseSettings());
  const pinned = pinQuality(createQualityState(ladder), 2);
  const { state } = run(pinned, { seconds: 10, cost: 40 });
  assert.equal(state.level, 2);
  const released = run(pinQuality(state, null), { seconds: 10, cost: 40 });
  assert.ok(released.state.level > 2);
  // Bad measurements are ignored.
  assert.equal(stepQuality(createQualityState(ladder), { now: 1, cost: NaN, source: "gpu" }).cost, null);
});
