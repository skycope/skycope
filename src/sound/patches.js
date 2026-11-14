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
// ±12 % gain, ±6 % filter frequency and ±15 % length.

export const SURFACE = { rock: 0, wetSand: 1, drySand: 2, scrub: 3, forest: 4, grass: 5, timber: 6, metal: 7, shallows: 8, pebbles: 9, deck: 10 };
export const SURFACE_NAMES = Object.fromEntries(Object.entries(SURFACE).map(([k, v]) => [v, k]));

const grain = (lo, hi, extra = {}) => ({ noise: "white", type: "bandpass", f: [lo, hi], q: 1.5, attack: 0.003, tail: [0.022, 0.04], gain: 0.01, ...extra });

export const STEPS = {
  // Soft, no click, a little "shh" as the grains settle.
  [SURFACE.drySand]: {
    says: "soft and whispery",
    trim: 3.9,
    layers: [
      { noise: "white", type: "lowpass", f: 1100, to: 420, q: 0.7, attack: 0.014, tail: 0.095, gain: 0.03 },
      { noise: "white", type: "bandpass", f: 3200, q: 1.2, attack: 0.008, tail: 0.04, gain: 0.005, at: 0.025 },
    ],
  },
  // Denser and darker, firm ground under it, now and then a suck.
  [SURFACE.wetSand]: {
    says: "dark and firm",
    trim: 1.88,
    layers: [
      { noise: "pink", type: "bandpass", f: 480, q: 0.9, attack: 0.008, tail: 0.06, gain: 0.05 },
      { noise: "white", type: "bandpass", f: 900, q: 1, attack: 0.006, tail: 0.04, gain: 0.012 },
      { tone: "sine", hz: 180, to: 120, attack: 0.004, tail: 0.035, gain: 0.003 },
      { noise: "white", type: "bandpass", f: 2400, q: 6, attack: 0.002, tail: 0.018, gain: 0.006, at: 0.04, chance: 1 / 3 },
    ],
  },
  // Blades brushing over soft soil.
  [SURFACE.grass]: {
    says: "a light brushing",
    trim: 5.4,
    layers: [
      { ...grain(5500, 8000), count: [2, 3], spacing: [0.008, 0.014] },
      { noise: "brown", type: "lowpass", f: 300, q: 0, attack: 0.004, tail: 0.05, gain: 0.002 },
    ],
  },
  // As grass, plus one step in four a twig.
  [SURFACE.scrub]: {
    says: "brushing, a twig now and then",
    trim: 5.7,
    layers: [
      { ...grain(3500, 6000), count: [2, 3], spacing: [0.008, 0.014] },
      { noise: "brown", type: "lowpass", f: 300, q: 0, attack: 0.004, tail: 0.05, gain: 0.003 },
      { noise: "white", type: "bandpass", f: 2200, q: 9, attack: 0.001, tail: 0.012, gain: 0.016, chance: 0.25, at: 0.01 },
    ],
  },
  // Leaf litter: one more grain, a soft thump under it, the twig.
  [SURFACE.forest]: {
    says: "leaf litter, an occasional twig",
    trim: 5.1,
    layers: [
      { ...grain(2500, 5000, { tail: [0.03, 0.05] }), count: [3, 4], spacing: [0.008, 0.016] },
      { noise: "brown", type: "lowpass", f: 380, q: 0, attack: 0.004, tail: 0.06, gain: 0.005 },
      { noise: "white", type: "bandpass", f: 2200, q: 9, attack: 0.001, tail: 0.012, gain: 0.016, chance: 0.25, at: 0.012 },
    ],
  },
  // A cat on stone is nearly silent; the tick of a claw is what you hear.
  [SURFACE.rock]: {
    says: "nearly silent, a claw tick",
    trim: 6.9,
    layers: [
      { noise: "white", type: "bandpass", f: 4200, q: 4, attack: 0.001, tail: 0.014, gain: 0.016 },
      { tone: "sine", hz: 420, attack: 0.001, tail: 0.025, gain: 0.0004 },
      { noise: "white", type: "highpass", f: 5000, q: 0, attack: 0.0005, tail: 0.006, gain: 0.003, at: 0.004, chance: 0.3, running: 1 },
    ],
  },
  // A knock with a body under it (the keel, a sill, a limb).
  [SURFACE.timber]: {
    says: "a soft wooden knock",
    trim: 0.83,
    layers: [
      { noise: "brown", type: "lowpass", f: 500, q: 0, attack: 0.002, tail: 0.045, gain: 0.03 },
      { modes: [[210, 0.16, 1], [340, 0.12, 0.6]], gain: 0.02 },
    ],
  },
  // The boat's deck: lower and hollow (send B).
  [SURFACE.deck]: {
    says: "a hollow knock on the deck",
    trim: 0.76,
    sendB: 0.2,
    layers: [
      { noise: "brown", type: "lowpass", f: 450, q: 0, attack: 0.002, tail: 0.05, gain: 0.03 },
      { modes: [[150, 0.2, 1], [260, 0.15, 0.6]], gain: 0.022 },
    ],
  },
  // Inside the boiler: the ring is the point; each step hangs.
  [SURFACE.metal]: {
    says: "a ringing metal step",
    trim: 0.36,
    layers: [
      { modes: [[196, 0.95, 1], [418, 0.75, 0.6], [733, 0.6, 0.4], [1210, 0.45, 0.25]], gain: 0.016, tick: { noise: "white", type: "bandpass", f: 2500, q: 0.8, attack: 0.0005, tail: 0.004, gain: 0.02 } },
      { noise: "white", type: "highpass", f: 6000, q: 0, attack: 0.0005, tail: 0.005, gain: 0.01 },
    ],
  },
  // A plip, then drops.
  [SURFACE.shallows]: {
    says: "a plip, then drops",
    trim: 2.5,
    layers: [
      { noise: "pink", type: "bandpass", f: 1100, to: 500, q: 1.4, attack: 0.006, tail: 0.11, gain: 0.035 },
      { bubble: [700, 1500], ratio: 1.6, attack: 0.002, tail: 0.03, gain: 0.008, at: [0.03, 0.09], count: [1, 2], spacing: [0.02, 0.05] },
    ],
  },
  // Stones shifting: three clicks over 40 ms, the last with a tap.
  [SURFACE.pebbles]: {
    says: "stones shifting",
    trim: 12,
    layers: [
      { noise: "white", type: "bandpass", f: [1400, 2400], q: 7, attack: 0.0005, tail: 0.014, gain: 0.012, count: 3, spacing: [0.012, 0.016] },
      { tone: "sine", hz: 300, attack: 0.001, tail: 0.02, gain: 0.0003, at: 0.035 },
    ],
  },
};

// `trim` on each surface is set by measurement (scripts/sound-measure.mjs)
// so that, walking, wet and dry sand land at the same loudness, grass and
// scrub 2–3 dB under them, rock 6 dB under (nearly silent), timber and
// metal a little over (the knock and the ring are the point).

// The longest a footstep may last (s), for the tests.
export const STEP_MAX_SECONDS = { default: 0.25, [SURFACE.metal]: 1.4, [SURFACE.timber]: 0.4, [SURFACE.deck]: 0.45 };

const pick = (core, x) => (Array.isArray(x) ? core.rand(x[0], x[1]) : x);
const pickInt = (core, x) => (Array.isArray(x) ? Math.floor(core.rand(x[0], x[1] + 0.999)) : x ?? 1);

// Plays a list of layers into voice `v`. `scale` multiplies every gain,
// `shorten` every tail; `running` turns on layers marked `running: 1`.
export function playLayers(core, v, layers, { scale = 1, shorten = 1, running = false, at = 0, vary = true } = {}) {
  if (!v) return 0;
  let end = v.t;
  const g = (x) => (vary ? core.vary(x, 0.12) : x) * scale;
  const f = (x) => (vary ? core.vary(x, 0.06) : x);
  const len = (x) => (vary ? core.vary(x, 0.15) : x) * shorten;
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
        end = Math.max(end, core.modes(v, { modes: layer.modes.map(([hz, t60, gm]) => [hz, t60 * shorten, gm]), gain: g(layer.gain), at: offset, tick }));
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
