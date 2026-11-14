// The render budget: what every layer draws at, and what to give up first
// when the GPU cannot keep up. Pure (no DOM, no GPU): main.js feeds it
// measurements and applies the settings it returns; tests/quality.test.js
// drives it with synthetic load.
//
// Under load the old scaler cut every canvas's resolution together, down to
// half, and never shed anything else: slow and soft at once. This sheds in
// order of what is least visible per millisecond saved (perf research,
// November 2026): the shadow map's refresh cadence and the cloud march
// steps; the sky and cloud scale (they upscale smoothly); the sea's scale;
// vegetation detail distance (a LOD bias); MSAA 4 → 2; a steady 40 then
// 30 fps; and only last the land's resolution, never below 0.85.

// Each step is applied on top of the ones before it. Steps that change
// nothing for a budget (MSAA 4 → 2 where the base is 2) are dropped from
// that budget's ladder, so every level costs less than the one above.
export const STEPS = [
  { shadowSlices: 6, cloudSteps: 32 },
  { skyScale: 0.75 },
  { seaScale: 0.82 },
  { seaScale: 0.68 },
  { lodBias: 0.85 },
  { lodBias: 0.72 },
  { msaa: 2 },
  { fps: 40 },
  { fps: 30 },
  { landScale: 0.92 },
  { landScale: 0.85 },
];

// Full quality on each budget. `msaa` is the mesh layer's sample count
// (rocks fade at the waterline by alpha-to-coverage, so the desktop floor
// is 2); `shadowSlices` is how many frames a sun shadow refresh is spread
// over; `lodBias` scales every vegetation LOD distance.
export function baseSettings({ light = false } = {}) {
  return {
    shadowSlices: 3,
    cloudSteps: light ? 32 : 44,
    skyScale: 1,
    seaScale: 1,
    lodBias: 1,
    msaa: light ? 0 : 2,
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
      // A step only ever sheds: never raises what the budget starts below.
      next[key] = key === "msaa" && previous.msaa < value ? previous.msaa : value;
    }
    if (Object.keys(next).some((key) => next[key] !== previous[key])) ladder.push(next);
  }
  return ladder;
}

// Pixel budgets (pixels drawn, before any shed). The sky and clouds upscale
// smoothly; the sea is sharper; the land sharpest (MSAA'd geometry).
export const BUDGET = {
  desktop: { landPixels: 1600000, landDpr: 1.5, seaPixels: 1500000, seaDpr: 1.5, skyPixels: 450000 },
  light: { landPixels: 800000, landDpr: 1.5, seaPixels: 650000, seaDpr: 1.25, skyPixels: 220000 },
};

// Every layer's render size, decided here and nowhere else. `viewport` is
// the CSS size and device pixel ratio; `reveal` (a fraction) renders every
// layer on the loading reveal's shared coarse grid; `photo` ([w, h]) is a
// still's size.
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
  const land = size(Math.min(dpr, budget.landDpr, Math.sqrt(budget.landPixels / css)) * settings.landScale);
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
// between rendered frames, which vsync quantises (`source: "interval"`).
// Separate thresholds shed and restore, so it never sits on a boundary
// flipping; a restore that has to be shed again soon waits longer before
// it is tried again (per level), so it cannot saw-tooth.
const TUNING = {
  gpu: { shed: 0.88, restore: 0.62 },
  // Intervals never fall below the frame period, so restoring can only be
  // tried, with growing patience, while frames are on time.
  interval: { shed: 1.22, restore: 1.06 },
  // Seconds: the cost average's time constant, how long after a change
  // before its effect is judged, how long sustained headroom must last.
  smoothing: 0.35,
  settle: 0.4,
  shedAfter: 0.6,
  restoreAfter: 1.5,
  // A failed restore makes the next try at that level wait twice as long.
  retry: 3,
  maxRetry: 60,
  // A restore shed again within this many seconds counts as failed.
  failWindow: 6,
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
// `source` "gpu" or "interval". Never mutates `state`.
export function stepQuality(state, { now, cost, source }) {
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
  const shedding = s.level < s.ladder.length - 1 && s.cost > tune.shed * period;
  s.over = shedding ? s.over + dt : 0;
  if (s.over >= TUNING.shedAfter) return change(s, s.level + 1, now);
  const up = s.level - 1;
  const roomy = up >= 0 && s.cost < tune.restore * (1000 / s.ladder[up].fps);
  s.under = roomy ? s.under + dt : 0;
  if (roomy && s.under >= TUNING.restoreAfter && now >= s.notBefore[up]) return change(s, up, now);
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
