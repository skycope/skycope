// The render budget: what every layer draws at, and what to give up first
// when the GPU cannot keep up. Pure (no DOM, no GPU): main.js feeds it
// measurements and applies the settings it returns; tests/quality.test.js
// drives it with synthetic load.
//
// Adaptation is allowed; seeing it happen is not. The land's resolution
// and MSAA are fixed for the session (chosen from the device, never changed
// at run time in either direction): a budget that moved the land across a
// 1.44× range made sharpness visibly wander and park at the bottom, and an
// MSAA toggle reallocates and changes every edge. The ladder sheds only
// what the visitor cannot see change: the shadow map's refresh cadence and
// the cloud march steps; the sky and cloud scale (they upscale smoothly);
// the sea's scale; vegetation detail distance (a LOD bias, which the land
// layer eases in over seconds, never steps); then a steady 40 or 30 fps.
// And the governor changes level rarely: a level holds for seconds at
// least, a restore waits for long headroom and for the camera to move, and
// a restore that fails backs off for longer each time.

// Each step is applied on top of the ones before it. Steps that change
// nothing for a budget are dropped from that budget's ladder, so every
// level costs less than the one above.
export const STEPS = [
  { shadowSlices: 8, cloudSteps: 32 },
  { skyScale: 0.75 },
  { seaScale: 0.82 },
  { seaScale: 0.68 },
  { lodBias: 0.85 },
  { lodBias: 0.72 },
  { fps: 40 },
  { fps: 30 },
];

// Full quality on each budget. `msaa` is the mesh layer's sample count,
// fixed for the session: 4 where the land renders at its native size
// (dpr ≤ 1.25), 2 on high-DPI screens, where two samples at more pixels
// look sharper for the same cost (rocks fade at the waterline by
// alpha-to-coverage, so 2 is the desktop floor), none on the light budget.
// `shadowSlices` is how many frames a sun shadow refresh is spread over;
// `lodBias` scales every vegetation LOD distance; `landScale` is the land's
// size relative to its budget (always 1: the land never changes size).
export function baseSettings({ light = false, dpr = 2 } = {}) {
  const hidpi = !light && dpr > 1.25;
  return {
    shadowSlices: 4,
    cloudSteps: light ? 32 : 44,
    skyScale: 1,
    seaScale: 1,
    lodBias: 1,
    msaa: light ? 0 : hidpi ? 2 : 4,
    fps: 60,
    landScale: 1,
  };
}

// The levels of one budget, best first. A pace is only offered where the
// display can hold it evenly (40 fps on 120 Hz, not on 60 Hz, where it
// would alternate one and two refreshes).
export function qualityLadder(base, { refresh = 60 } = {}) {
  const ladder = [{ ...base }];
  for (const step of STEPS) {
    if (step.fps && Math.abs(refresh / step.fps - Math.round(refresh / step.fps)) > 0.08) continue;
    const previous = ladder[ladder.length - 1];
    const next = { ...previous };
    for (const [key, value] of Object.entries(step)) {
      // A step only ever sheds: never raises what the budget starts below
      // (more shadow slices is the cheaper direction).
      next[key] = key === "shadowSlices" ? Math.max(previous[key], value) : Math.min(previous[key], value);
    }
    if (Object.keys(next).some((key) => next[key] !== previous[key])) ladder.push(next);
  }
  return ladder;
}

// Pixel budgets. The sky and clouds upscale smoothly; the sea is sharper;
// the land sharpest (MSAA'd geometry). The desktop land budget (1.94 MP at
// MSAA 2) costs about what 1.6 MP at MSAA 4 did, measured whole-frame
// (November 2026).
export const BUDGET = {
  desktop: { landPixels: 1940000, landDpr: 1.5, seaPixels: 1500000, seaDpr: 1.5, skyPixels: 450000 },
  light: { landPixels: 800000, landDpr: 1.5, seaPixels: 650000, seaDpr: 1.25, skyPixels: 220000 },
};

// Every layer's render size, decided here and nowhere else. `viewport` is
// the CSS size and device pixel ratio; `reveal` (a fraction) renders every
// layer on one coarse grid; `photo` ([w, h]) is a still's size.
export function renderSizes({ width, height, dpr = 1, light = false, reveal = 1, photo = null }, settings) {
  const budget = light ? BUDGET.light : BUDGET.desktop;
  const css = Math.max(1, width * height);
  const size = (scale) => [Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale))];
  if (reveal < 1) {
    const grid = [Math.max(1, Math.ceil(width * reveal)), Math.max(1, Math.ceil(height * reveal))];
    return { land: grid, sea: grid, sky: grid, cloud: half(grid) };
  }
  if (photo) {
    const sky = size(Math.min(1, Math.sqrt((budget.skyPixels * 2) / css)));
    return { land: photo, sea: photo, sky, cloud: half(sky) };
  }
  const fit = Math.min(dpr, budget.landDpr, Math.sqrt(budget.landPixels / css));
  const land = size(fit * (settings.landScale ?? 1));
  const sea = size(Math.min(dpr, budget.seaDpr, Math.sqrt(budget.seaPixels / css)) * settings.seaScale);
  const sky = size(Math.min(1, Math.sqrt(budget.skyPixels / css)) * settings.skyScale);
  return { land, sea, sky, cloud: half(sky) };
}

// The temporal clouds march one pixel of every 2×2 block per frame.
function half([w, h]) {
  return [Math.ceil(w / 2), Math.ceil(h / 2)];
}

// The governor. A measurement is a frame's cost in milliseconds: GPU time
// where the platform reports it (`source: "gpu"`), else the interval
// between rendered frames, which vsync quantises (`source: "interval"`);
// `still` is true while the camera is at rest. Separate thresholds shed
// and restore, so it never sits on a boundary flipping.
export const TUNING = {
  gpu: { shed: 0.9, restore: 0.6 },
  // Intervals never fall below the frame period, so restoring can only be
  // tried, with growing patience, while frames are on time.
  interval: { shed: 1.22, restore: 1.06 },
  // A cost this far over the frame is a stutter: shed sooner.
  severe: 1.6,
  // Seconds: the cost average's time constant; how long after a change
  // before its effect is judged.
  smoothing: 0.8,
  settle: 1,
  // How long the cost must stay over before a shed: moving, at rest (where
  // a change is easiest to see, so only when unavoidable), and severe.
  shedAfter: 3,
  shedAfterStill: 8,
  shedAfterSevere: 1,
  // No two changes closer than this (a severe overload: `dwellSevere`).
  dwell: 8,
  dwellSevere: 2,
  // A restore needs this long since the last change, this long of
  // sustained headroom, and the camera moving.
  restoreDwell: 30,
  restoreAfter: 10,
  // A failed restore makes the next try at that level wait twice as long.
  retry: 60,
  maxRetry: 600,
  // A restore shed again within this many seconds counts as failed.
  failWindow: 40,
};

export function createQualityState(ladder) {
  return {
    ladder,
    level: 0,
    cost: null,
    source: null,
    changed: -Infinity,
    over: 0,
    under: 0,
    retry: ladder.map(() => TUNING.retry),
    notBefore: ladder.map(() => -Infinity),
    restoredAt: -Infinity,
    pinned: false,
  };
}

// One measurement in; the (new) state out. `now` is seconds; `cost` ms;
// `source` "gpu" or "interval"; `still` the camera at rest. Never mutates
// `state`.
export function stepQuality(state, { now, cost, source, still = false }) {
  if (state.pinned || !(cost > 0) || !Number.isFinite(cost)) return state;
  const s = { ...state };
  if (source !== s.source) {
    s.source = source;
    s.cost = null;
  }
  // Ignore what was measured before the last change took effect.
  if (now - s.changed < TUNING.settle) return s;
  const dt = s.lastSample === undefined ? 1 / 60 : Math.min(0.25, Math.max(0, now - s.lastSample));
  s.lastSample = now;
  const k = 1 - Math.exp(-dt / TUNING.smoothing);
  s.cost = s.cost === null ? cost : s.cost + (cost - s.cost) * k;
  const tune = TUNING[source] ?? TUNING.interval;
  const period = 1000 / s.ladder[s.level].fps;
  const severe = s.cost > TUNING.severe * period * (source === "interval" ? tune.shed : 1);
  const over = s.level < s.ladder.length - 1 && s.cost > tune.shed * period;
  s.over = over ? s.over + dt : 0;
  const since = now - s.changed;
  const patience = severe ? TUNING.shedAfterSevere : still ? TUNING.shedAfterStill : TUNING.shedAfter;
  if (over && s.over >= patience && since >= (severe ? TUNING.dwellSevere : TUNING.dwell)) return change(s, s.level + 1, now);
  const up = s.level - 1;
  const roomy = up >= 0 && s.cost < tune.restore * (1000 / s.ladder[up].fps);
  s.under = roomy ? s.under + dt : 0;
  if (roomy && !still && s.under >= TUNING.restoreAfter && since >= TUNING.restoreDwell && now >= s.notBefore[up]) return change(s, up, now);
  return s;
}

function change(s, level, now) {
  const next = { ...s, level, changed: now, over: 0, under: 0, cost: null, lastSample: undefined };
  if (level > s.level && now - s.restoredAt < TUNING.failWindow) {
    // The level just restored could not hold: back off before retrying it.
    const failed = s.level;
    next.retry = s.retry.slice();
    next.notBefore = s.notBefore.slice();
    next.notBefore[failed] = now + s.retry[failed];
    next.retry[failed] = Math.min(TUNING.maxRetry, s.retry[failed] * 2);
  }
  next.restoredAt = level < s.level ? now : s.restoredAt;
  return next;
}

// Hold a level (QA captures, review fixtures); `null` releases it.
export function pinQuality(state, level) {
  if (level === null || level === undefined) return { ...state, pinned: false };
  const clamped = Math.max(0, Math.min(state.ladder.length - 1, level));
  return { ...state, level: clamped, pinned: true, cost: null, over: 0, under: 0 };
}

export function qualitySettings(state) {
  return state.ladder[state.level];
}

// The LOD bias the land layer draws with, eased toward the budget's at most
// `rate` per second (`eased`), and what it hands the vegetation: that value
// in steps of `quantum` (`drawn`). Each step moves every fade band by 1%,
// which the per-instance fades absorb, and repacks only every few frames; a
// whole 15% step at once moved every band in view in one frame.
export function easeBias(eased, target, dt, { rate = 0.06, quantum = 0.01 } = {}) {
  const step = Math.min(Math.abs(target - eased), rate * Math.max(0, dt));
  const next = eased + Math.sign(target - eased) * step;
  const drawn = Math.abs(target - next) < 1e-6 ? target : Math.round(next / quantum) * quantum;
  return { eased: next, drawn };
}
