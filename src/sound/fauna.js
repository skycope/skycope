// Animal voices as rare, quiet events in a calm soundscape (owner, 15 Nov:
// "the sounds are annoying theres some dominating animal noise"; measured
// in the live site: the penguin colony beside the spawn beach brayed about
// 26 times a minute, at 27–41 m, at full level).
//
// The sea and the wind are the sound of the site. An animal is heard
// occasionally, at a distance, softly:
//   - every voice is gated here before it is built;
//   - one animal voice at most in any 6 s, across species, never two at once;
//   - each species has its own randomised gap (the colony brays at most once
//     every 40–90 s);
//   - idle chatter fades out over the first minutes the cat stands still
//     (gone after three);
//   - nothing speaks because the cat merely stands near (a penguin's threat
//     display, an oystercatcher's wary piping): a reaction voice only when
//     the cat startles an animal, and then once (per species, 25 s);
//   - distance falls off steeply ((ref / d) ^ 1.25) and dulls fast
//     (12 kHz × exp(−d / 45), floor 700 Hz), so the colony is faint from the
//     spawn point;
//   - LEVEL trims each voice so that at its typical distance it peaks at
//     least 9 LU under the home beach's bed (set by measurement:
//     tests/audio/animals.test.js).

export const RULES = {
  // key: { voice, idle | reaction, gap [s], ref (m) }
  "penguins:bray": { voice: "penguin", idle: true, gap: [40, 90], ref: 6 },
  "penguins:honk": { voice: "penguin", reaction: true, ref: 6 },
  "penguins:threat": null, // the cat merely standing near
  "penguins:splash": { voice: "penguin-splash", idle: true, gap: [30, 70], ref: 6 },
  "seals:bark": { voice: "seal", idle: true, gap: [50, 110], ref: 8, startle: (e) => (e.gain ?? 0) >= 0.95 },
  "seals:splash": { voice: "seal-splash", reaction: true, ref: 8 },
  "seals:blow": { voice: "seal-snort", idle: true, gap: [40, 90], ref: 6 },
  "whale:blow": { voice: "whale", idle: true, gap: [45, 120], ref: 40 },
  "whale:fluke": { voice: "whale-slap", idle: true, gap: [60, 150], ref: 40 },
  "whale:slap": { voice: "whale-slap", idle: true, gap: [60, 150], ref: 40 },
  "whale:breach": { voice: "whale-breach", idle: true, gap: [90, 180], ref: 40 },
  "whale:crash": { voice: "whale-breach", idle: true, gap: [90, 180], ref: 40 },
  "tortoise:hiss": { voice: "tortoise", reaction: true, ref: 1.5 },
  "oystercatchers:flush": { voice: "oystercatcher", reaction: true, ref: 6 },
  "oystercatchers:pipe": null, // wary of a cat merely near
  "gull:idle": { voice: "gull", idle: true, gap: [45, 120], ref: 12 },
  "owl:idle": { voice: "owl", idle: true, gap: [180, 360], ref: 12 },
  "owl:answer": { voice: "owl", reaction: true, ref: 12 },
  "penguins:answer": { voice: "penguin", reaction: true, ref: 6 },
};

// Per-voice level trims (× the recipe), set by measurement so each peaks
// ≥ 9 LU under the home beach's bed at its typical distance.
export const LEVEL = { penguin: 1, "penguin-splash": 1, seal: 1, "seal-splash": 1, "seal-snort": 1, whale: 1, "whale-slap": 1, "whale-breach": 1, tortoise: 1, oystercatcher: 1, gull: 1, owl: 1 };
// Where each is usually heard from (m), for that measurement.
export const TYPICAL = { penguin: 30, "penguin-splash": 30, seal: 60, "seal-splash": 60, "seal-snort": 30, whale: 110, "whale-slap": 110, "whale-breach": 110, tortoise: 1.5, oystercatcher: 10, gull: 45, owl: 25 };

export const BUDGET = { window: 6, reactionCooldown: 25, fadeStart: 60, fadeEnd: 180 };
export const LAW = { exponent: 1.25, air: 45, top: 12000, floor: 700 };

// Distance gain, air and reverb for an animal at `d` m with reference `ref`.
export function animalPlace(d, ref) {
  return {
    gain: (ref / Math.max(ref, d)) ** LAW.exponent,
    cutoff: Math.max(LAW.floor, LAW.top * Math.exp(-d / LAW.air)),
    sendA: Math.min(0.45, 0.08 + d / 200),
  };
}

export function createFauna(core) {
  const next = {}; // per species: earliest time it may speak again
  const reacted = {}; // per species: last reaction time
  let lastVoice = -Infinity;
  let busyUntil = -Infinity;
  let stillFor = 0;

  function fade() {
    const t = Math.min(1, Math.max(0, (stillFor - BUDGET.fadeStart) / (BUDGET.fadeEnd - BUDGET.fadeStart)));
    return 1 - t * t * (3 - 2 * t);
  }

  // May `key` speak now? Logs the decision (core.heard) either way.
  // Returns the rule (with its voice) or null.
  function allow(key, at, e = {}) {
    const now = core.ctx.currentTime;
    const rule = RULES[key];
    const hold = (why) => {
      core.noteHeard(key, at, { played: false, why, gain: e.gain ?? 1 });
      return null;
    };
    if (rule === undefined) return hold("unknown");
    if (rule === null) return hold("the cat merely near");
    const species = rule.voice.split("-")[0];
    const startle = rule.reaction || rule.startle?.(e);
    if (now - lastVoice < BUDGET.window || now < busyUntil) return hold("another voice in the last 6 s");
    if (startle) {
      if (now - (reacted[species] ?? -Infinity) < BUDGET.reactionCooldown) return hold("already reacted");
      reacted[species] = now;
    } else {
      if (now < (next[species] ?? 0)) return hold("species gap");
      if (core.random() > fade()) return hold("standing still: idle chatter faded");
      next[species] = now + core.rand(rule.gap[0], rule.gap[1]);
    }
    lastVoice = now;
    core.noteHeard(key, at, { played: true, why: startle ? "startled" : "idle", gain: e.gain ?? 1 });
    return { ...rule, startle, level: LEVEL[rule.voice] ?? 1 };
  }

  return {
    allow,
    // Where an animal is, as the voice wants it (core.voice options).
    where(at, ref) {
      const d = core.listener ? Math.hypot(at.x - core.listener.x, at.z - core.listener.z, (at.y ?? core.listener.y) - core.listener.y) : ref;
      const p = animalPlace(d, ref);
      return { d, ...p };
    },
    // A voice is sounding until `t`.
    busy(t) {
      busyUntil = Math.max(busyUntil, t);
    },
    // Each frame: how long the cat has stood still.
    update(cat, dt) {
      stillFor = cat && Math.abs(cat.speed ?? 0) > 0.2 ? 0 : stillFor + dt;
    },
    get stillFor() {
      return stillFor;
    },
    get idleFade() {
      return fade();
    },
  };
}
