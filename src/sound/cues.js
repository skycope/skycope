// Named cues other lanes call as `state.sound.<cue>?.(...)`.
//
// The waking light (docs/design/waking-light.md section 6): the diegetic
// layer under each gift's score phrase, positioned at the source (`at`,
// { x, y, z }, ref 12 m), on the `magic` bus, below the phrase:
//
//   hush(gift, at)          T = 0      the ambient bed ducks 3 dB for 0.4 s
//   kindle(gift, at)        0.35 s     a tick plus the gift's own material
//   gutter(gift, at)        0.55/0.75  two soft puffs (lamp 0.8/1.5)
//   reach(gift, at)         0.35–2.8   air moving outward, pan opening to centre
//   arrive(gift, at)        tCat       one soft note at the gift's pitch + octave
//   glints(gift, at)        1–7 s      sparse high ticks, count per gift
//   settle(gift, at)        ~6 s       the practical's own small bed begins
//   waking(gift, at, { tCat })         all of the above on one clock, plus
//                                      each gift's extras (thump, clockwork,
//                                      necklace, meteor, answering bark, …)
//
// Every function takes an optional `{ delay }` (s) so a caller can line it
// up with the light's own curve (journey.js wakingAt / tCat).
//
// The story (docs/design/story-and-wow.md section 8): STORY_CUES, each a
// method named in camelCase (starFall, homePhrase, wickCatch, …) and also
// reachable as `cue("star-fall", …)`.

export const WAKING_CUES = ["hush", "kindle", "gutter", "reach", "arrive", "glints", "settle", "waking"];

export const STORY_CUES = [
  "star-fall", "star-land", "wisp-note", "home-phrase", "wick-catch", "glass-tick", "hull-knock", "hull-roll", "hull-slide", "hull-float",
  "boat-creak", "hull-slap", "bail-squeak", "wake-hiss", "boiler-step", "boiler-hum", "boiler-bell", "tide-light", "crown-wind", "crown-lights",
  "pool-drip", "pool-return", "shutter", "tower-echo", "clockwork", "beam-hold", "whale-blow-near", "whale-back", "fluke-drip", "boat-swell",
  "ending-rise", "ending-arrive", "turn", "call-down",
];
export const camel = (name) => name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);
export const GIFT_PITCH = { fireflies: 86, tideglow: 69, lamp: 62, stars: 93, seafolk: 50, boat: 66, finale: 74 };
export const GIFT_GLINTS = { fireflies: 12, tideglow: 10, lamp: 0, stars: 0, seafolk: 0, boat: 4, finale: 6 };

export function createCues(core, { world, foley, call, mix, score, home }) {
  const { ctx } = core;
  const NEAR = 12;
  const where = (at, delay = 0, extra = {}) => ({ bus: "magic", t: ctx.currentTime + 0.02 + delay, ...(at ? { at, ref: NEAR } : {}), ...extra });

  // --- Waking light ------------------------------------------------------

  function hush(_gift, _at, { delay = 0 } = {}) {
    if (delay > 0.05) return void schedule(delay, () => mix.duck("amb", -3, { attack: 0.05, hold: 0.35, release: 0.6 }));
    mix.duck("amb", -3, { attack: 0.05, hold: 0.35, release: 0.6 });
  }

  // Callbacks a little later on the audio clock (offline contexts too):
  // a silent source whose end runs `fn`.
  function schedule(delay, fn) {
    const clock = core.counted.createConstantSource();
    clock.offset.value = 0;
    const sink = core.counted.createGain();
    sink.gain.value = 0;
    clock.connect(sink).connect(mix.input("magic"));
    clock.start(ctx.currentTime);
    clock.stop(ctx.currentTime + delay);
    clock.onended = () => {
      clock.disconnect();
      sink.disconnect();
      fn();
    };
  }

  function kindle(gift, at, { delay = 0 } = {}) {
    const v = core.voice(where(at, delay));
    core.noise(v, { colour: "white", type: "highpass", f: 4000, q: 0, attack: 0.002, tail: 0.09, gain: 0.012 });
    switch (gift) {
      case "fireflies": // a hollow wooden knock
        core.modes(v, { modes: [[180, 0.12, 1], [410, 0.06, 0.4]], gain: 0.03 });
        break;
      case "tideglow": // struck iron inside the boiler
        core.modes(v, { modes: [[220, 0.6, 1], [587, 0.4, 0.6], [1320, 0.25, 0.35]], gain: 0.03 });
        break;
      case "lamp": // a match flaring and a glass tink
        core.noise(v, { colour: "pink", type: "bandpass", f: 1800, to: 3200, q: 1, attack: 0.01, tail: 0.3, gain: 0.02 });
        core.tone(v, { hz: 3200, attack: 0.001, tail: 0.35, gain: 0.008, at: 0.25, partials: [[1.5, 0.5, 0.6]] });
        break;
      case "stars": // a high glass harmonic, slow attack (A6 and E7)
        core.tone(v, { hz: hz(93), attack: 0.6, tail: 1.6, gain: 0.02, partials: [[1.4983, 0.6, 1]] });
        break;
      case "seafolk": // a deep bloop and a trickle of bubbles
        core.tone(v, { hz: 140, to: 70, attack: 0.01, tail: 0.25, gain: 0.04 });
        for (let i = 0; i < 6; i++) core.bubble(v, { f: core.rand(500, 1200), gain: 0.006, at: 0.15 + i * core.rand(0.05, 0.12) });
        break;
      case "boat": // the lantern's glass lifted, a match, the wick
        core.tone(v, { hz: 2900, attack: 0.001, tail: 0.12, gain: 0.006, partials: [[1.5, 0.5, 0.6]] });
        core.noise(v, { colour: "pink", type: "bandpass", f: 1800, to: 3200, q: 1, attack: 0.01, tail: 0.25, gain: 0.016, at: 0.18 });
        core.noise(v, { colour: "pink", type: "bandpass", f: 900, q: 0.8, attack: 0.08, tail: 0.4, gain: 0.008, at: 0.4 });
        break;
      default:
        core.tone(v, { hz: hz(GIFT_PITCH.finale), attack: 0.3, tail: 1.2, gain: 0.015 });
    }
    return v?.done();
  }

  function gutter(gift, at, { delay = 0 } = {}) {
    const times = gift === "lamp" ? [0.8, 1.5] : [0.55, 0.75];
    const v = core.voice(where(at, delay));
    for (const t of times) core.noise(v, { colour: "pink", type: "bandpass", f: 800, q: 1, attack: 0.02, tail: 0.08, gain: 0.012, at: t - 0.35 });
    return v?.done();
  }

  function reach(gift, at, { delay = 0 } = {}) {
    const v = core.voice(where(at, delay));
    if (!v) return null;
    // The pan opens from the source's bearing to the centre.
    const panner = v.nodes.find((n) => n.pan);
    panner?.pan.setValueAtTime(panner.pan.value, v.t);
    panner?.pan.linearRampToValueAtTime(0, v.t + 2.4);
    const band = gift === "fireflies" ? [3000, 6000] : gift === "stars" ? [1200, 450] : gift === "seafolk" ? [1500, 700] : [600, 2400];
    core.noise(v, { colour: "pink", type: "bandpass", f: band[0], to: band[1], q: 1, attack: 0.5, tail: 1.9, gain: 0.03 });
    if (gift === "lamp") {
      // The old bloom's D2 / A2, at half gain, here and only here.
      core.tone(v, { hz: 73.42, attack: 1.1, tail: 2.5, gain: 0.065 });
      core.tone(v, { hz: 110, attack: 1.1, tail: 2.5, gain: 0.028 });
    }
    if (gift === "boat") world.scrape(1.6, 0.03, at ? { at, ref: NEAR, t: v.t + 0.3 } : { t: v.t + 0.3 });
    if (gift === "seafolk") for (let i = 0; i < 8; i++) core.bubble(v, { f: core.rand(400, 900), gain: 0.004, at: 0.4 + i * 0.22 });
    return v.done();
  }

  // The light reaching the cat: one soft note, the gift's pitch and its octave.
  function arrive(gift, _at, { delay = 0 } = {}) {
    const v = core.voice({ bus: "magic", t: ctx.currentTime + 0.02 + delay });
    const f = hz(GIFT_PITCH[gift] ?? 74);
    core.tone(v, { hz: f, attack: 0.04, tail: 1.2, gain: 0.025, partials: [[0.5, 0.6, 1]] });
    return v?.done();
  }

  function glints(gift, at, { delay = 0, count = GIFT_GLINTS[gift] ?? 0 } = {}) {
    if (!count) return null;
    const v = core.voice({ bus: "magic", t: ctx.currentTime + 0.02 + delay + 1, ...(at ? { at, ref: NEAR * 2 } : {}) });
    if (!v) return null;
    // Each tick its own pan, wide: a few panners on the voice.
    const lanes = [-0.6, -0.2, 0.2, 0.6].map((p) => {
      const pan = core.counted.createStereoPanner();
      pan.pan.value = p;
      pan.connect(core.mix.input("magic"));
      v.add(pan);
      return pan;
    });
    for (let i = 0; i < count; i++) {
      const t = core.rand(0, 6) * (1 - 0.4 * core.random());
      const out = lanes[Math.floor(core.random() * lanes.length)];
      const f = core.rand(2500, 6000);
      core.tone(v, { hz: f, attack: 0.002, tail: core.rand(0.05, 0.12), gain: core.rand(0.004, 0.01) * Math.min(1, v.level), at: t, out });
    }
    return v.done();
  }

  // The practical's own small bed beginning (about 6 s).
  function settle(gift, at, { delay = 0 } = {}) {
    const w = at ? { at, ref: NEAR, t: ctx.currentTime + 0.02 + delay } : { t: ctx.currentTime + 0.02 + delay };
    switch (gift) {
      case "lamp":
        return world.clockwork(w, 4, 1);
      case "boat":
      case "tideglow":
        return lap(w, 3);
      case "fireflies": {
        const v = core.voice({ bus: "world", ...w });
        for (let i = 0; i < 3; i++) for (let k = 0; k < 3; k++) core.tone(v, { hz: 4500, attack: 0.008, tail: 0.022, gain: 0.006, at: i * 0.6 + k * 0.05 });
        return v?.done();
      }
      case "seafolk":
        return poolDrip(w);
      default:
        return null;
    }
  }

  // Water lapping at a hull or a rock: soft slops.
  function lap(w, n = 3) {
    const v = core.voice({ bus: "world", ...w });
    for (let i = 0; i < n; i++) core.noise(v, { colour: "pink", type: "lowpass", f: core.rand(500, 800), q: 0, attack: 0.05, tail: 0.25, gain: 0.02, at: i * core.rand(0.7, 1.3) });
    return v?.done();
  }

  // The whole sequence on one clock. opts: { tCat } (s after T = 0).
  function waking(gift, at, { tCat = 2.5 } = {}) {
    hush(gift, at);
    kindle(gift, at, { delay: 0.35 });
    gutter(gift, at, { delay: 0.35 });
    reach(gift, at, { delay: 0.35 });
    arrive(gift, at, { delay: Math.max(0.6, tCat) });
    glints(gift, at, { delay: 0 });
    settle(gift, at, { delay: 6 });
    const w = (d, extra = {}) => (at ? { at, ref: NEAR, t: ctx.currentTime + d, ...extra } : { t: ctx.currentTime + d, ...extra });
    if (gift === "tideglow") {
      const v = core.voice({ bus: "magic", ...w(2) });
      core.tone(v, { hz: 60, attack: 0.02, tail: 0.4, gain: 0.05 });
      v?.done();
    } else if (gift === "lamp") {
      world.clockwork(w(2.2), 4, 0.7);
      // A tiny "pt" as each lamp of the necklace lights, outward.
      const v = core.voice({ bus: "magic", ...w(2.4) });
      for (let i = 0; i < 5; i++) core.noise(v, { colour: "white", type: "bandpass", f: 2200, q: 3, attack: 0.001, tail: 0.012, gain: 0.006, at: i * 0.35 });
      v?.done();
    } else if (gift === "stars") {
      starFall({ delay: 3.5, gain: 0.5 });
    } else if (gift === "seafolk") {
      call("seal-bark", { distance: 40, pan: 0.2, gain: 0.6, delay: 4 });
    } else if (gift === "boat") {
      world.creak(at ? { where: { at, ref: NEAR, t: ctx.currentTime + 0.9 } } : {});
      world.hullSlap(0.4, w(3));
      world.bailSqueak(w(4.2));
      world.bailSqueak(w(5.1));
    }
    return 16;
  }

  // --- Story ---------------------------------------------------------------

  // A thin airy hiss falling a fifth over 1.4 s, quiet until the last 0.3 s.
  function starFall({ delay = 0, gain = 1, speed = 1 } = {}) {
    const len = 1.4 / speed;
    const v = core.voice({ bus: "magic", t: ctx.currentTime + 0.02 + delay });
    core.noise(v, { colour: "white", type: "bandpass", f: 6000, to: 4000, q: 4, attack: len * 0.8, tail: len * 0.25, gain: 0.012 * gain });
    core.noise(v, { colour: "white", type: "bandpass", f: 3000, to: 2000, q: 2, attack: len * 0.95, tail: 0.15, gain: 0.008 * gain });
    return v?.done();
  }

  // A low soft thump in sand, a spray of grain ticks, one glassy tick.
  function starLand(at, { delay = 0 } = {}) {
    const v = core.voice({ bus: "magic", t: ctx.currentTime + 0.02 + delay, ...(at ? { at, ref: NEAR } : {}) });
    core.tone(v, { hz: 70, to: 45, attack: 0.004, tail: 0.18, gain: 0.05 });
    core.noise(v, { colour: "brown", type: "lowpass", f: 400, q: 0, attack: 0.004, tail: 0.15, gain: 0.03 });
    for (let i = 0; i < 9; i++) core.noise(v, { colour: "white", type: "bandpass", f: core.rand(3000, 7000), q: 4, attack: 0.0005, tail: 0.008, gain: 0.004, at: 0.05 + core.rand(0, 0.4) });
    core.tone(v, { hz: 3520, attack: 0.001, tail: 0.5, gain: 0.006, at: 0.5 });
    return v?.done();
  }

  // The wisp speaks: one bell-like pluck from HOME_PHRASE[n − 1].
  function wispNote(n = 1, at = null) {
    const phrase = [74, 76, 78, 81, 83, 86];
    const midi = phrase[Math.max(0, Math.min(5, (n | 0) - 1))];
    const v = core.voice({ bus: "magic", ...(at ? { at, ref: NEAR } : {}) });
    core.tone(v, { hz: hz(midi), attack: 0.004, tail: 1.6, gain: 0.04, partials: [[2, 0.2, 0.5], [2.76, 0.06, 0.25], [1.003, 0.3, 1]] });
    return v?.done();
  }

  // A soft "fff" and settle; `large` for the lamp (with two gutters).
  function wickCatch(at = null, { large = false } = {}) {
    const v = core.voice({ bus: "world", ...(at ? { at, ref: 6 } : {}) });
    core.noise(v, { colour: "pink", type: "bandpass", f: 1600, to: 2800, q: 1, attack: 0.02, tail: large ? 0.4 : 0.25, gain: large ? 0.02 : 0.012 });
    core.noise(v, { colour: "pink", type: "bandpass", f: 700, q: 0.8, attack: 0.1, tail: 0.5, gain: 0.006, at: 0.2 });
    if (large) for (const t of [0.45, 0.8]) core.noise(v, { colour: "pink", type: "bandpass", f: 800, q: 1, attack: 0.02, tail: 0.08, gain: 0.01, at: t });
    return v?.done();
  }

  // Two or three irregular ticks of glass warming.
  function glassTick(at = null, { delay = 1 } = {}) {
    const v = core.voice({ bus: "world", t: ctx.currentTime + delay, ...(at ? { at, ref: 4 } : {}) });
    const n = 2 + Math.floor(core.random() * 2);
    let t = 0;
    for (let i = 0; i < n; i++) {
      core.tone(v, { hz: core.rand(3200, 4400), attack: 0.001, tail: 0.04, gain: 0.004, at: t });
      t += core.rand(0.4, 1.4);
    }
    return v?.done();
  }

  // Tower echo: the meow back, late and dark (40 m away and back).
  function towerEcho(distance = 30) {
    const delay = (2 * distance) / 343;
    const out = core.counted.createGain();
    out.gain.value = 0.25;
    const lp = core.filter("lowpass", 1200, -3);
    const pre = core.counted.createDelay(1);
    pre.delayTime.value = Math.min(0.9, delay);
    pre.connect(lp).connect(out).connect(core.mix.input("world"));
    foley.meow({ out: pre });
    schedule(delay + 2, () => [out, lp, pre].forEach((n) => n.disconnect()));
  }

  function whaleBlowNear(at = null) {
    const v = core.voice({ bus: "world", ...(at ? { at, ref: 30 } : {}) });
    core.noise(v, { colour: "pink", type: "bandpass", f: 480, to: 220, q: 0.6, attack: 0.08, tail: 1.5, gain: 0.2 });
    core.noise(v, { colour: "white", type: "bandpass", f: 2400, q: 0.5, attack: 0.05, tail: 1.2, gain: 0.05 });
    core.noise(v, { colour: "brown", type: "lowpass", f: 160, to: 60, q: 0, attack: 0.04, tail: 1.1, gain: 0.22 });
    for (let i = 0; i < 10; i++) core.bubble(v, { f: core.rand(600, 1400), gain: 0.008, at: 0.3 + core.rand(0, 1.2) });
    // the inhale, like a cave breathing in
    core.noise(v, { colour: "pink", type: "bandpass", f: 700, to: 1300, q: 0.8, attack: 0.9, tail: 0.3, gain: 0.07, at: 2.2 });
    return v?.done();
  }

  function whaleBack(at = null) {
    const v = core.voice({ bus: "world", ...(at ? { at, ref: 30 } : {}) });
    core.noise(v, { colour: "pink", type: "lowpass", f: 2000, to: 600, q: 0, attack: 0.3, tail: 1.6, gain: 0.06 });
    return v?.done();
  }

  function flukeDrip(at = null) {
    const v = core.voice({ bus: "world", ...(at ? { at, ref: 20 } : {}) });
    for (let i = 0; i < 14; i++) core.bubble(v, { f: core.rand(700, 1600), gain: 0.008, at: core.rand(0, 2) });
    return v?.done();
  }

  function boatSwell() {
    world.creak({ pitch: 0.8, gain: 0.014, where: { pan: 0, sendB: 0.15 } });
    world.creak({ pitch: 0.7, gain: 0.01, where: { pan: 0.2, sendB: 0.15, t: ctx.currentTime + 0.7 } });
    return world.hullSlap(0.8, { pan: 0, sendB: 0.15, t: ctx.currentTime + 0.4 });
  }

  function boilerHum(at = null) {
    const v = core.voice({ bus: "world", ...(at ? { at, ref: 10 } : {}) });
    core.noise(v, { colour: "pink", type: "bandpass", f: 147, q: 6, attack: 1.2, tail: 2, gain: 0.03 });
    core.tone(v, { hz: 73.42, attack: 1.5, tail: 2, gain: 0.006 });
    return v?.done();
  }

  // The swash with a faint glassy shimmer, once.
  function tideLight(pan = 0) {
    const v = core.voice({ bus: "magic", pan });
    core.noise(v, { colour: "pink", type: "bandpass", f: 2500, q: 0.6, attack: 0.6, tail: 1.5, gain: 0.02 });
    for (let i = 0; i < 6; i++) core.tone(v, { hz: core.rand(4000, 7000), attack: 0.05, tail: 0.6, gain: 0.003, at: 0.3 + i * 0.18 });
    return v?.done();
  }

  // The milkwood: leaves in wind; lit, a few very quiet high ticks.
  function crownWind(at = null, { lit = false } = {}) {
    const v = core.voice({ bus: "amb", ...(at ? { at, ref: 15 } : {}) });
    core.noise(v, { colour: "white", type: "highpass", f: 2800, q: 0, attack: 1.2, tail: 1.8, gain: 0.02 });
    if (lit) for (let i = 0; i < 4; i++) core.tone(v, { hz: core.rand(5000, 7500), attack: 0.002, tail: 0.06, gain: 0.002, at: core.rand(0.3, 2.5) });
    return v?.done();
  }

  // The pool: a drip and the suck of water in rock.
  function poolDrip(w = {}) {
    const v = core.voice({ bus: "world", ...w, ...(w.at ? { ref: w.ref ?? 4 } : {}) });
    core.bubble(v, { f: core.rand(900, 1300), ratio: 0.6, gain: 0.01, tail: 0.05 });
    core.noise(v, { colour: "pink", type: "bandpass", f: 450, to: 250, q: 3, attack: 0.04, tail: 0.25, gain: 0.015, at: core.rand(0.6, 1.2) });
    return v?.done();
  }

  // Fish back: a soft cluster of plops.
  function poolReturn(at = null) {
    const v = core.voice({ bus: "world", ...(at ? { at, ref: 4 } : {}) });
    for (let i = 0; i < 5; i++) core.bubble(v, { f: core.rand(500, 900), gain: 0.004, at: core.rand(0, 0.8) });
    return v?.done();
  }

  // A loose shutter in wind, irregular.
  function shutter(at = null) {
    const v = core.voice({ bus: "world", ...(at ? { at, ref: 10 } : {}) });
    const n = 1 + Math.floor(core.random() * 3);
    let t = 0;
    for (let i = 0; i < n; i++) {
      core.modes(v, { modes: [[180, 0.08, 1], [420, 0.05, 0.4]], gain: 0.012, at: t, tick: { colour: "brown", type: "lowpass", f: 600, q: 0, attack: 0.002, tail: 0.04, gain: 0.02 } });
      t += core.rand(0.15, 0.5);
    }
    return v?.done();
  }

  // The ending: the full phrase slow, each note with more air; then one
  // soft high bell and its octave below, then silence.
  function endingRise() {
    mix.duck("music", -12, { attack: 1, hold: 10, release: 4 });
    return home(6, 1.2);
  }
  function endingArrive() {
    const v = core.voice({ bus: "magic", sendA: 0.4 });
    core.tone(v, { hz: hz(98), attack: 0.01, tail: 4, gain: 0.03, partials: [[0.5, 0.7, 1.2]] });
    return v?.done();
  }
  // One held open fifth on D, very quiet, breathing.
  function turn(seconds = 12) {
    const v = core.voice({ bus: "magic" });
    core.tone(v, { hz: hz(50), attack: 3, hold: seconds - 6, tail: 3, gain: 0.012 });
    core.tone(v, { hz: hz(57), attack: 3, hold: seconds - 6, tail: 3, gain: 0.009 });
    return v?.done();
  }
  function callDown() {
    starFall({ speed: 0.5, gain: 0.5 });
    return wispNote(6);
  }

  const story = {
    starFall,
    starLand,
    wispNote,
    homePhrase: (n) => home(n),
    wickCatch,
    glassTick,
    hullKnock: (at, gain = 1) => world.knock({ hollow: true, gain, where: at ? { at, ref: 6 } : {} }),
    hullRoll: (at) => world.creak({ pitch: 0.8, where: at ? { at, ref: 6 } : {} }),
    hullSlide: (at) => world.scrape(1.5, 0.04, at ? { at, ref: 6 } : {}),
    hullFloat: (at) => {
      world.hullSlap(0.6, at ? { at, ref: 6 } : {});
      return lap(at ? { at, ref: 6, t: ctx.currentTime + 0.5 } : { t: ctx.currentTime + 0.5 }, 2);
    },
    boatCreak: (at) => world.creak({ where: at ? { at, ref: 6 } : {} }),
    hullSlap: (gain = 1, at = null) => world.hullSlap(gain, at ? { at, ref: 6 } : {}),
    bailSqueak: (at) => world.bailSqueak(at ? { at, ref: 4 } : {}),
    wakeHiss: (seconds = 2) => {
      const v = core.voice({ bus: "world" });
      core.noise(v, { colour: "pink", type: "bandpass", f: 1300, q: 0.7, attack: 0.5, hold: seconds, tail: 0.8, gain: 0.03 });
      return v?.done();
    },
    boilerStep: (running = false) => foley.step(7, running, 0),
    boilerHum,
    boilerBell: () => world.boilerBell(),
    tideLight,
    crownWind,
    crownLights: (at) => crownWind(at, { lit: true }),
    poolDrip: (at) => poolDrip(at ? { at } : {}),
    poolReturn,
    shutter,
    towerEcho,
    clockwork: (at) => world.clockwork(at ? { at, ref: 6 } : {}, 4, 1),
    beamHold: (seconds) => world.beamHold(seconds),
    whaleBlowNear,
    whaleBack,
    flukeDrip,
    boatSwell,
    endingRise,
    endingArrive,
    turn,
    callDown,
  };

  return {
    hush,
    kindle,
    gutter,
    reach,
    arrive,
    glints,
    settle,
    waking,
    schedule,
    ...story,
    cue(name, ...args) {
      const fn = story[camel(name)] ?? { hush, kindle, gutter, reach, arrive, glints, settle, waking }[name];
      return fn ? fn(...args) : null;
    },
  };
}
