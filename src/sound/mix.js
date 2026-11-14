// The mix: seven buses, two shared spaces, one limiter.
//
//   voices → bus fader → bus tone (low-pass, for shelter and sleep) ─┐
//   voices → send A (outdoor air, 1.6 s) ────────────────────────────┤→ sum → master → limiter → trim → out
//   voices → send B (small space, 0.35 s: the hull, the doorway) ────┘
//
// Each bus has a loudness target (integrated LUFS over its reference scene,
// docs/design/sound-plan.md section 2). FADER is what measurement said each
// bus needs to land there (tests/audio/mix.test.js re-measures it); the
// recipes' own gains stay in their natural units.
//
// The limiter should almost never act. WebAudio's DynamicsCompressor adds
// automatic makeup gain, (1 / curve(0 dBFS)) ^ 0.6, by the spec: with the
// old master compressor (−18 dB, 3:1, 30 dB knee) every sound on the site
// was boosted by that. `trim` cancels the makeup exactly, so below the
// threshold the chain is unity.
import { createReverb } from "../score.js";

export const BUSES = {
  amb: { target: -36, short: -32, priority: 1 },
  weather: { target: -32, short: -24, priority: 0 },
  foley: { target: -40, short: -34, priority: 2 },
  voice: { target: -34, short: -28, priority: 5 },
  world: { target: -36, short: -28, priority: 3 },
  magic: { target: -34, short: -26, priority: 4 },
  music: { target: -40, short: -34, priority: 4 },
};
export const BUS_NAMES = Object.keys(BUSES);

// Bus faders (linear), set by measurement of each bus's reference scene
// (scripts/sound-evidence.mjs prints them; tests hold them to ±2 LU).
export const FADER = { amb: 1, weather: 1, foley: 1, voice: 1, world: 1, magic: 1, music: 1 };

export const LIMITER = { threshold: -6, knee: 0, ratio: 20, attack: 0.002, release: 0.25, post: 0.89 };

// The spec's compression curve at 0 dBFS, and the makeup gain it implies.
export function compressorMakeup({ threshold, knee, ratio }) {
  let y;
  if (0 <= threshold) y = 0;
  else if (knee > 0 && 0 < threshold + knee) y = ((1 / ratio - 1) * threshold * threshold) / (2 * knee);
  else y = (knee > 0 ? threshold + knee + ((1 / ratio - 1) * knee) / 2 : threshold) + (0 - threshold - knee) / ratio;
  return 10 ** ((-y * 0.6) / 20);
}

export function createMix(ctx, { on = true, fader = FADER } = {}) {
  const out = ctx.createGain();
  out.gain.value = 1 / compressorMakeup(LIMITER);
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = LIMITER.threshold;
  limiter.knee.value = LIMITER.knee;
  limiter.ratio.value = LIMITER.ratio;
  limiter.attack.value = LIMITER.attack;
  limiter.release.value = LIMITER.release;
  const master = ctx.createGain();
  master.gain.value = on ? LIMITER.post : 0;
  const sum = ctx.createGain();
  sum.connect(master).connect(limiter).connect(out).connect(ctx.destination);

  const buses = {};
  for (const name of BUS_NAMES) {
    const input = ctx.createGain();
    input.gain.value = fader[name] ?? 1;
    const tone = ctx.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = 20000;
    tone.Q.value = -3;
    input.connect(tone).connect(sum);
    buses[name] = { input, tone, fader: fader[name] ?? 1, duck: 1, level: 1 };
  }
  // Send A: the island's air, short (an island has no hall).
  const air = createReverb(ctx, { seconds: 1.6, damping: 5200, predelay: 0.02 });
  air.output.connect(sum);
  // Send B: a small hollow space (the upturned hull, a doorway, the deck).
  const small = createReverb(ctx, { seconds: 0.35, damping: 4000, predelay: 0.004, lengths: [0.0047, 0.0071, 0.0089, 0.0113, 0.0131, 0.0157, 0.0173, 0.0199], trim: 0.5 });
  small.output.connect(sum);

  // A bus's level is fader × duck × level; each is eased on its own.
  function apply(name, time = 0.4) {
    const b = buses[name];
    b.input.gain.setTargetAtTime(b.fader * b.duck * b.level, ctx.currentTime, time);
  }

  return {
    buses,
    sendA: air.input,
    sendB: small.input,
    limiter,
    master,
    input: (name) => buses[name]?.input ?? buses.world.input,
    setOn(on, time = 0.15) {
      master.gain.setTargetAtTime(on ? LIMITER.post : 0, ctx.currentTime, time);
    },
    // A bus's own level (0…1+), e.g. music on/off.
    setLevel(name, level, time = 0.4) {
      buses[name].level = level;
      apply(name, time);
    },
    // A dip of `dB` reached over `attack` s, held, then back over `release`.
    duck(name, dB, { attack = 0.4, hold = 0, release = 2.5 } = {}) {
      const b = buses[name];
      const g = b.input.gain;
      const t = ctx.currentTime;
      const base = b.fader * b.duck * b.level;
      const low = base * 10 ** (dB / 20);
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      g.linearRampToValueAtTime(low, t + attack);
      g.setValueAtTime(low, t + attack + hold);
      g.linearRampToValueAtTime(base, t + attack + hold + release);
    },
    // A standing cut (shelter, sleep, the boiler): gain in dB and a
    // low-pass corner, eased.
    shade(name, { dB = 0, lowpass = 20000, time = 0.4 } = {}) {
      const b = buses[name];
      b.duck = 10 ** (dB / 20);
      apply(name, time);
      b.tone.frequency.setTargetAtTime(lowpass, ctx.currentTime, time);
    },
    get reduction() {
      return limiter.reduction ?? 0;
    },
  };
}
