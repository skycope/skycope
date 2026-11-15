import test from "node:test";
import assert from "node:assert/strict";
import {
  STEPS,
  TUNING,
  baseSettings,
  qualityLadder,
  renderSizes,
  createQualityState,
  stepQuality,
  pinQuality,
  qualitySettings,
  easeBias,
} from "../src/quality.js";

// Feed `seconds` of frames at `fps` with a constant cost; the camera moving
// unless `still`.
function run(state, { from = 0, seconds, cost, source = "gpu", fps = 60, still = false }) {
  let s = state;
  let now = from;
  const levels = [];
  for (let i = 0; i < seconds * fps; i++) {
    now = from + i / fps;
    s = stepQuality(s, { now, cost: typeof cost === "function" ? cost(s, now) : cost, source, still: typeof still === "function" ? still(now) : still });
    levels.push(s.level);
  }
  return { state: s, now, levels };
}

// Times (seconds) at which the level changed.
function changes(levels, fps = 60, from = 0) {
  const out = [];
  for (let i = 1; i < levels.length; i++) if (levels[i] !== levels[i - 1]) out.push(from + i / fps);
  return out;
}

test("the ladder sheds only what the visitor cannot see change, in order", () => {
  const ladder = qualityLadder(baseSettings({ dpr: 2 }));
  const order = [];
  for (let i = 1; i < ladder.length; i++) {
    const changed = Object.keys(ladder[i]).filter((k) => ladder[i][k] !== ladder[i - 1][k]);
    order.push(...changed.map((k) => `${k}:${ladder[i][k]}`));
  }
  assert.deepEqual(order, [
    "shadowSlices:8", "cloudSteps:32", "skyScale:0.75", "seaScale:0.82",
    "seaScale:0.68", "lodBias:0.85", "lodBias:0.72", "fps:30",
  ]);
  for (let i = 1; i < ladder.length; i++) assert.notDeepEqual(ladder[i], ladder[i - 1]);
});

test("the land's resolution and MSAA are fixed for the session on every budget", () => {
  assert.ok(STEPS.every((s) => !("landScale" in s) && !("msaa" in s)));
  for (const options of [{ dpr: 2 }, { dpr: 1 }, { light: true }]) {
    const ladder = qualityLadder(baseSettings(options));
    const sizes = ladder.map((l) => renderSizes({ width: 1440, height: 900, dpr: options.dpr ?? 2, light: options.light }, l).land.join("x"));
    assert.equal(new Set(sizes).size, 1, `land sizes ${[...new Set(sizes)]}`);
    assert.equal(new Set(ladder.map((l) => l.msaa)).size, 1);
  }
  assert.equal(baseSettings({ dpr: 1 }).msaa, 4);
  assert.equal(baseSettings({ dpr: 2 }).msaa, 2);
  assert.equal(baseSettings({ light: true }).msaa, 0);
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
  const settings = baseSettings({ dpr: 2 });
  const retina = renderSizes({ width: 1440, height: 900, dpr: 2 }, settings);
  // A Retina laptop's land at its pixel budget (0.61 of native linear).
  assert.ok(Math.abs(retina.land[0] * retina.land[1] - 1.94e6) < 0.02e6);
  assert.ok(retina.sea[0] * retina.sea[1] <= 1.52e6);
  assert.deepEqual(retina.cloud, [Math.ceil(retina.sky[0] / 2), Math.ceil(retina.sky[1] / 2)]);
  // A small window at 1x renders at its own size.
  const small = renderSizes({ width: 800, height: 600, dpr: 1 }, baseSettings({ dpr: 1 }));
  assert.deepEqual(small.land, [800, 600]);
  assert.deepEqual(small.sea, [800, 600]);
  // A coarse grid and a photo override the budget.
  const grid = renderSizes({ width: 1440, height: 900, dpr: 2, reveal: 1 / 8 }, settings);
  assert.deepEqual(grid.land, [180, 113]);
  assert.deepEqual(renderSizes({ width: 1440, height: 900, dpr: 2, photo: [2400, 1500] }, settings).land, [2400, 1500]);
});

test("light load holds full quality", () => {
  const { levels } = run(createQualityState(qualityLadder(baseSettings())), { seconds: 60, cost: 9 });
  assert.ok(levels.every((l) => l === 0));
});

test("sustained load sheds one level at a time, never two changes within the dwell", () => {
  // Each level saves 8% of the cost; 19 ms at full quality (moderate, not severe).
  const cost = (s) => 19 * Math.pow(0.92, s.level);
  const { state, levels } = run(createQualityState(qualityLadder(baseSettings())), { seconds: 90, cost });
  for (let i = 1; i < levels.length; i++) assert.ok(Math.abs(levels[i] - levels[i - 1]) <= 1);
  const at = changes(levels);
  for (let i = 1; i < at.length; i++) assert.ok(at[i] - at[i - 1] >= TUNING.dwell - 1e-6, `changes ${at}`);
  // Settled where it fits, and only shed (no restore under the same load).
  assert.ok(cost(state) < 0.9 * (1000 / qualitySettings(state).fps));
  assert.ok(levels.every((l, i) => i === 0 || l >= levels[i - 1]));
});

test("a stutter (severe overload) sheds within seconds", () => {
  const ladder = qualityLadder(baseSettings());
  const { state, levels } = run(createQualityState(ladder), { seconds: 20, cost: 45 });
  assert.ok(state.level >= 4, `level ${state.level}`);
  assert.ok(levels.indexOf(1) / 60 < 3);
});

test("at rest it sheds only when it must, and never restores", () => {
  const ladder = qualityLadder(baseSettings());
  // A brief overload while still (5 s) changes nothing: a moving camera would have shed.
  const brief = (s, now) => (now < 5 ? 17 : 9);
  assert.ok(run(createQualityState(ladder), { seconds: 30, cost: brief, still: true }).levels.every((l) => l === 0));
  assert.ok(run(createQualityState(ladder), { seconds: 30, cost: brief }).levels.some((l) => l > 0));
  // Shed under load, then the load goes while the camera stays still: hold.
  const loaded = run(createQualityState(ladder), { seconds: 30, cost: 30 });
  const held = run(loaded.state, { from: loaded.now, seconds: 120, cost: 6, still: true });
  assert.ok(held.levels.every((l) => l === loaded.state.level));
  // The camera moves: restores, slowly, one level per dwell.
  const moving = run(held.state, { from: held.now, seconds: 400, cost: 6 });
  assert.equal(moving.state.level, 0);
  const at = changes(moving.levels, 60, held.now);
  for (let i = 1; i < at.length; i++) assert.ok(at[i] - at[i - 1] >= TUNING.restoreDwell - 1e-6);
});

test("no oscillation on a boundary: a failed restore backs off for longer each time", () => {
  // Level 3 has headroom enough to tempt a restore; level 2 cannot hold.
  const cost = (s) => (s.level >= 3 ? 9.5 : 15.8);
  const ladder = qualityLadder(baseSettings());
  const { levels } = run(createQualityState(ladder), { seconds: 900, cost });
  const at = changes(levels);
  // Down to 3, then a handful of failed restores whose gaps keep growing.
  assert.ok(at.length < 12, `${at.length} changes in 15 minutes`);
  const restores = [];
  for (let i = 1; i < levels.length; i++) if (levels[i] < levels[i - 1]) restores.push(i / 60);
  for (let i = 2; i < restores.length; i++) assert.ok(restores[i] - restores[i - 1] > restores[i - 1] - restores[i - 2]);
});

test("quantised intervals: sheds when frames are missed, without saw-tooth", () => {
  const ladder = qualityLadder(baseSettings());
  const interval = (s) => (s.level < 4 ? 33.3 : 16.7);
  const { state, levels } = run(createQualityState(ladder), { seconds: 300, cost: interval, source: "interval" });
  assert.ok(state.level >= 4 && state.level <= 5);
  // Down four, then a few probes back up whose gaps double (60, 120, 240 s).
  assert.ok(changes(levels).length <= 10, `${changes(levels).length} changes`);
});

test("a pinned level holds whatever the load", () => {
  const ladder = qualityLadder(baseSettings());
  const pinned = pinQuality(createQualityState(ladder), 2);
  const { state } = run(pinned, { seconds: 10, cost: 40 });
  assert.equal(state.level, 2);
  const released = run(pinQuality(state, null), { seconds: 10, cost: 40 });
  assert.ok(released.state.level > 2);
  assert.equal(stepQuality(createQualityState(ladder), { now: 1, cost: NaN, source: "gpu" }).cost, null);
});

test("the LOD bias eases over seconds in 1% steps, never jumps", () => {
  let eased = 1;
  const drawn = [];
  for (let i = 0; i < 60 * 5; i++) {
    const b = easeBias(eased, 0.85, 1 / 60);
    eased = b.eased;
    drawn.push(b.drawn);
  }
  for (let i = 1; i < drawn.length; i++) assert.ok(Math.abs(drawn[i] - drawn[i - 1]) <= 0.0100001);
  assert.equal(drawn[drawn.length - 1], 0.85);
  // It takes about 2.5 s, not one frame.
  const reached = drawn.indexOf(0.85) / 60;
  assert.ok(reached > 2 && reached < 3, `${reached} s`);
  // The values handed on are exact steps, so the vegetation repacks only on a step.
  assert.ok(new Set(drawn).size <= 17);
});
