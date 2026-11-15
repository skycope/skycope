// Recipes as data (sound-plan.md sections 4–8), so tests can check them
// without rendering and the player can vary them per hit. A patch is
// { bus, ref?, maxSeconds, layers: [layer] }; a layer is one of
//
//   { noise: colour, type, f, to?, q, attack, tail, gain, at? }
//   { tone: wave, hz, to?, attack, tail, gain, at?, partials? }
//   { modes: [[hz, t60, gain]], gain, tick? }
//   { bubble: f | [lo, hi], ratio, tail, gain, at? }
//
// plus `chance` (0…1, the layer plays that often), `count` and `spacing`
// (a run of grains), and `pick` ranges written as [lo, hi]. Gains are
// linear envelope peaks into the bus, before its fader. Every hit varies
// ±3 dB in level, ±10 % in filter frequency, ±15 % in length and up to
// 12 ms in time.

export const SURFACE = { rock: 0, wetSand: 1, drySand: 2, scrub: 3, forest: 4, grass: 5, timber: 6, metal: 7, shallows: 8, pebbles: 9, deck: 10 };
export const SURFACE_NAMES = Object.fromEntries(Object.entries(SURFACE).map(([k, v]) => [v, k]));

// Footsteps (reworked 15 Nov after the owner heard the first pass as
// "off"). A cat's walk is close to silent: a faint soft compression on
// sand, a whisper of blades in grass, almost nothing on rock, a soft low
// pad on timber. So every recipe here is filtered noise only (nothing
// pitched except the boiler's iron), with attacks of 8–15 ms, low-passed,
// with short tails, and quiet: walking sits about 20 LU under the home
// beach's bed and is masked by it most of the time. Only a run is clearly
// audible, and still soft. Each step varies ±3 dB, ±10 % in its filters and
// up to 12 ms in time; hind paws are a little softer and darker.
const soft = (colour, type, f, q, attack, tail, gain, extra = {}) => ({ noise: colour, type, f, q, attack, tail, gain, ...extra });

export const STEPS = {
  // A faint soft compression and the barest "shh".
  [SURFACE.drySand]: {
    says: "a faint soft compression, barely there",
    trim: 0.87,
    layers: [
      soft("pink", "bandpass", 600, 0.7, 0.014, 0.06, 0.03, { to: 420 }),
      soft("white", "bandpass", 1800, 0.7, 0.012, 0.035, 0.009),
    ],
  },
  // Denser and darker: a damp pad.
  [SURFACE.wetSand]: {
    says: "a damp, darker pad",
    trim: 0.77,
    layers: [
      soft("pink", "bandpass", 380, 0.8, 0.01, 0.05, 0.04),
      soft("pink", "lowpass", 900, -3, 0.01, 0.03, 0.006),
    ],
  },
  // A whisper of blades.
  [SURFACE.grass]: {
    says: "a whisper of blades",
    trim: 1.38,
    layers: [soft("pink", "bandpass", 2600, 0.8, 0.012, [0.035, 0.05], 0.02, { count: [1, 2], spacing: [0.015, 0.025] })],
  },
  // Low bush and restio: a soft brush, a little body.
  [SURFACE.scrub]: {
    says: "a soft brush through low bush",
    trim: 1.17,
    layers: [
      soft("pink", "bandpass", 2000, 0.8, 0.01, [0.04, 0.06], 0.02, { count: 2, spacing: [0.015, 0.03] }),
      soft("brown", "lowpass", 300, -3, 0.01, 0.04, 0.005),
    ],
  },
  // Leaf litter under the trees: a soft dry settle.
  [SURFACE.forest]: {
    says: "a soft settle in leaf litter",
    trim: 1.02,
    layers: [
      soft("pink", "bandpass", 1500, 0.7, 0.01, [0.045, 0.07], 0.02, { count: 2, spacing: [0.02, 0.03] }),
      soft("brown", "lowpass", 350, -3, 0.01, 0.04, 0.006),
    ],
  },
  // Rock and made stone (the stoep, steps, the cairn): almost nothing.
  [SURFACE.rock]: {
    says: "almost nothing",
    trim: 1.75,
    layers: [soft("pink", "bandpass", 900, 0.7, 0.008, 0.025, 0.012)],
  },
  // Shingle and shell: a soft grit shifting.
  [SURFACE.pebbles]: {
    says: "a soft grit shifting",
    trim: 2.09,
    layers: [soft("pink", "bandpass", 1400, 1, 0.008, 0.03, 0.012, { count: 2, spacing: [0.02, 0.03] })],
  },
  // Timber (the keelson, the boat ashore, the milkwood's limb): a soft low pad.
  [SURFACE.timber]: {
    says: "a soft low pad on wood",
    trim: 0.89,
    layers: [soft("pink", "bandpass", 260, 0.8, 0.01, 0.05, 0.035)],
  },
  // The boat's deck: lower, a touch hollow.
  [SURFACE.deck]: {
    says: "a soft low pad, a touch hollow",
    trim: 0.94,
    sendB: 0.15,
    layers: [soft("pink", "bandpass", 210, 0.8, 0.01, 0.06, 0.035)],
  },
  // Inside the boiler: the one pitched step. A soft pad that the iron
  // rings with, quietly; the drum (world.js) carries it on.
  [SURFACE.metal]: {
    says: "a soft pad that the iron answers with a faint ring",
    trim: 0.29,
    layers: [
      soft("brown", "lowpass", 450, -3, 0.008, 0.04, 0.02),
      { modes: [[196, 0.7, 1], [418, 0.55, 0.6], [733, 0.45, 0.4], [1210, 0.35, 0.25]], gain: 0.008, attack: 0.006 },
    ],
  },
  // The swash: a soft wet pad, no plinks.
  [SURFACE.shallows]: {
    says: "a soft wet pad",
    trim: 1.19,
    layers: [soft("pink", "bandpass", 900, 1, 0.012, 0.08, 0.03, { to: 500 })],
  },
};

// `trim` on each surface is set by measurement (scripts/sound-footsteps.mjs)
// so that, walking, wet and dry sand land level, grass 2 dB under, rock 6
// dB under, timber and the deck 1–2 dB over, the boiler 4 dB over.

// The longest a footstep may last (s), for the tests.
export const STEP_MAX_SECONDS = { default: 0.25, [SURFACE.metal]: 1.4, [SURFACE.timber]: 0.4, [SURFACE.deck]: 0.45 };

const pick = (core, x) => (Array.isArray(x) ? core.rand(x[0], x[1]) : x);
const pickInt = (core, x) => (Array.isArray(x) ? Math.floor(core.rand(x[0], x[1] + 0.999)) : x ?? 1);

// Plays a list of layers into voice `v`. `scale` multiplies every gain,
// `shorten` every tail; `running` turns on layers marked `running: 1`.
export function playLayers(core, v, layers, { scale = 1, shorten = 1, running = false, at = 0, vary = true, fscale = 1, jitter = 0 } = {}) {
  if (!v) return 0;
  let end = v.t;
  const g = (x) => (vary ? x * 10 ** ((core.random() * 2 - 1) * 3 / 20) : x) * scale;
  const f = (x) => (vary ? core.vary(x, 0.1) : x) * fscale;
  const len = (x) => (vary ? core.vary(x, 0.15) : x) * shorten;
  if (vary && jitter) at += core.random() * jitter;
  for (const layer of layers) {
    const chance = running && layer.running ? layer.running : layer.chance ?? 1;
    if (chance < 1 && core.random() >= chance) continue;
    const count = pickInt(core, layer.count);
    let offset = at + (pick(core, layer.at) ?? 0);
    for (let i = 0; i < count; i++) {
      if (layer.noise) {
        const hz = f(pick(core, layer.f));
        end = Math.max(end, core.noise(v, { colour: layer.noise, type: layer.type, f: hz, to: layer.to ? layer.to * (hz / pick(core, layer.f)) : null, q: layer.q ?? 1, attack: layer.attack, hold: layer.hold ?? 0, tail: len(pick(core, layer.tail)), gain: g(layer.gain), at: offset }));
      } else if (layer.tone) {
        const hz = f(pick(core, layer.hz));
        end = Math.max(end, core.tone(v, { type: layer.tone, hz, to: layer.to ? layer.to * (hz / layer.hz) : null, attack: layer.attack, hold: layer.hold ?? 0, tail: len(pick(core, layer.tail)), gain: g(layer.gain), at: offset, partials: layer.partials }));
      } else if (layer.modes) {
        const tick = layer.tick ? { ...layer.tick, gain: g(layer.tick.gain), tail: len(layer.tick.tail) } : null;
        end = Math.max(end, core.modes(v, { modes: layer.modes.map(([hz, t60, gm]) => [hz, t60 * shorten, gm]), gain: g(layer.gain), at: offset, tick, attack: layer.attack ?? 0.0015 }));
      } else if (layer.bubble) {
        end = Math.max(end, core.bubble(v, { f: f(pick(core, layer.bubble)), ratio: layer.ratio ?? 1.6, attack: layer.attack ?? 0.002, tail: len(pick(core, layer.tail)), gain: g(layer.gain), at: offset }));
      }
      offset += pick(core, layer.spacing ?? 0);
    }
  }
  return end;
}

// A rough spectral centroid of a patch from its layers alone (Hz): each
// layer's centre weighted by its gain² × length. Good enough to check that
// surfaces differ before rendering anything.
export function estimateCentroid(patch) {
  let a = 0, b = 0;
  for (const l of patch.layers) {
    const mid = (x) => (Array.isArray(x) ? (x[0] + x[1]) / 2 : x);
    let hz;
    if (l.noise) {
      const fc = mid(l.f) * (l.to ? Math.sqrt(l.to / mid(l.f)) : 1);
      hz = l.type === "lowpass" ? fc * 0.55 : l.type === "highpass" ? fc * 1.5 : fc;
      if (l.noise === "brown" && l.type === "lowpass") hz = fc * 0.35;
    } else if (l.tone) hz = l.hz;
    else if (l.modes) hz = l.modes.reduce((s, m) => s + m[0] * m[2], 0) / l.modes.reduce((s, m) => s + m[2], 0);
    else if (l.bubble) hz = mid(l.bubble) * 1.3;
    const w = (l.gain ?? 0.01) ** 2 * mid(l.tail ?? 0.05) * (l.chance ?? 1) * mid(l.count ?? 1);
    a += hz * w;
    b += w;
  }
  return b ? a / b : 0;
}
