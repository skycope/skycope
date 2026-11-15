// What the world does back (bus `world`, positioned): the boat, each
// animal's reaction to the cat, the places' small answers, and the
// boiler's drum. Recipes from sound-plan.md sections 5, 7 and 8.
import { STEPS, SURFACE, playLayers } from "./patches.js";

const TOP_SPEED = 2.4; // m/s, the boat hurrying

export function createWorld(core, { call }) {
  const { ctx } = core;
  const set = (param, value, time = 0.3) => param.setTargetAtTime(value, ctx.currentTime, time);
  let boat = null; // persistent wake chain while afloat
  let lastVr = 0;
  let lastCreak = -Infinity;
  let lastTick = -Infinity;
  let lastRollSign = 0;
  let taut = false;
  let boiler = null;

  // --- The boat ---------------------------------------------------------

  // Hull slap: a low knock, the water's body, then its lick.
  function hullSlap(gain = 1, where = {}) {
    const v = core.voice({ bus: "world", gain: Math.min(1.2, 0.4 + gain * 0.6), ...where });
    core.tone(v, { hz: 130, to: 85, attack: 0.003, tail: 0.09, gain: 0.05 });
    core.noise(v, { colour: "pink", type: "bandpass", f: 520, q: 1.5, attack: 0.004, tail: 0.07, gain: 0.03 });
    core.noise(v, { colour: "white", type: "highpass", f: 3500, q: 0, attack: 0.02, tail: 0.16, gain: 0.008, at: 0.03 });
    return v?.done();
  }

  // Keel on sand: brown noise band rising, roughened at 22 Hz.
  function scrape(seconds = 2.5, gain = 0.05, where = {}) {
    const v = core.voice({ bus: "world", ...where });
    if (!v) return null;
    const rough = core.counted.createGain();
    rough.gain.value = 0.5;
    const lfo = core.counted.createOscillator();
    lfo.type = "square";
    lfo.frequency.value = 22;
    const depth = core.counted.createGain();
    depth.gain.value = 0.5;
    lfo.connect(depth).connect(rough.gain);
    rough.connect(v.input);
    lfo.start(v.t);
    lfo.stop(v.t + seconds + 0.1);
    v.add(rough, lfo, depth);
    core.noise(v, { colour: "brown", type: "bandpass", f: 400, to: 700, q: 1.2, attack: seconds * 0.7, tail: seconds * 0.3, gain: gain * 3, out: rough });
    core.noise(v, { colour: "pink", type: "bandpass", f: 2400, q: 0.8, attack: seconds * 0.6, tail: seconds * 0.4, gain: gain * 0.15 });
    return v.done();
  }

  // A stick-slip creak: a buzzy low source through a narrow moving band.
  function creak({ pitch = 1, gain = 0.012, length = null, where = {} } = {}) {
    const v = core.voice({ bus: "world", ...where });
    const len = length ?? core.rand(0.18, 0.42);
    const f0 = core.rand(70, 110) * pitch;
    const band = core.rand(900, 1500) * pitch;
    core.voiced(v, { contour: [[0, f0], [0.5, f0 * 1.25], [1, f0 * 0.9]], formants: [[band, 12, 3], [band * 1.1, 12, 2]], length: len, gain, attack: 0.03, release: 0.06, rough: 0.6, roughRate: 31, vibrato: 18 });
    return v?.done();
  }

  // Knock on timber (boarding, the upturned hull, grounding).
  function knock({ hollow = false, gain = 1, where = {} } = {}) {
    const v = core.voice({ bus: "world", sendB: hollow ? 0.3 : 0.1, ...where });
    if (hollow) {
      core.noise(v, { colour: "brown", type: "lowpass", f: 400, q: 0, attack: 0.002, tail: 0.05, gain: 0.03 * gain });
      core.modes(v, { modes: [[120, 0.35, 1], [215, 0.28, 0.6], [370, 0.2, 0.3]], gain: 0.05 * gain });
    } else playLayers(core, v, STEPS[SURFACE.deck].layers, { scale: 1.5 * gain });
    return v?.done();
  }

  // The lantern's glass and wire: a tiny tick.
  function lanternTick(where = {}) {
    const v = core.voice({ bus: "world", ...where });
    core.tone(v, { hz: core.vary(2900, 0.03), attack: 0.001, tail: 0.04, gain: 0.004 });
    core.tone(v, { hz: core.vary(4350, 0.03), attack: 0.001, tail: 0.03, gain: 0.0025 });
    return v?.done();
  }

  // The lantern's bail squeaking as it swings.
  function bailSqueak(where = {}) {
    const v = core.voice({ bus: "world", ...where });
    const f = core.rand(2100, 2500);
    core.voiced(v, { type: "triangle", contour: [[0, f], [0.6, f * 1.18], [1, f * 1.1]], formants: [[f * 1.1, 6, 1.5]], length: 0.12, gain: 0.0045, attack: 0.02, release: 0.03 });
    return v?.done();
  }

  // The painter coming taut: a short rope creak and a soft thud at the stem.
  function painter(where = {}) {
    const v = core.voice({ bus: "world", ...where });
    core.voiced(v, { contour: [[0, 140], [1, 190]], formants: [[1800, 8, 2], [2600, 8, 1]], length: 0.22, gain: 0.008, attack: 0.02, release: 0.05, rough: 0.5, roughRate: 45 });
    core.noise(v, { colour: "brown", type: "lowpass", f: 300, q: 0, attack: 0.003, tail: 0.06, gain: 0.015 });
    return v?.done();
  }

  // Persistent while afloat: wake hiss and the bow's chuckle (two bubble
  // lanes driven by automation, so no nodes per bubble).
  function buildBoat() {
    const out = core.counted.createGain();
    const air = core.filter("lowpass", 16000, -3);
    const pan = core.counted.createStereoPanner();
    const sendB = core.counted.createGain();
    sendB.gain.value = 0;
    out.connect(air).connect(pan).connect(core.mix.input("world"));
    pan.connect(sendB).connect(core.mix.sendB);
    const hiss = core.bed({ colour: "pink", type: "bandpass", f: 1300, q: 0.7, bus: "world" });
    hiss.pan.disconnect();
    hiss.pan.connect(out);
    const lanes = [0, 1].map(() => {
      const osc = core.counted.createOscillator();
      const env = core.counted.createGain();
      env.gain.value = 0;
      osc.connect(env).connect(out);
      osc.start();
      return { osc, env, free: 0 };
    });
    return { out, air, pan, sendB, hiss, lanes, credit: 0, next: 0, made: [out, air, pan, sendB, ...lanes.flatMap((l) => [l.osc, l.env])] };
  }

  function dropBoat() {
    for (const s of boat.hiss.sources) s.stop();
    core.stats.loops -= boat.hiss.sources.length;
    boat.hiss.pan.disconnect();
    for (const l of boat.lanes) l.osc.stop();
    for (const n of boat.made) n.disconnect();
    boat = null;
  }

  // Each frame. b: { afloat, aboard, x, z, y, speed, roll, vr, stretch
  // (painter beyond its length, m; ≤ 0 slack), dt }.
  function updateBoat(b) {
    const now = ctx.currentTime;
    if (!b?.afloat) {
      if (boat) dropBoat();
      taut = false;
      return;
    }
    if (!boat) boat = buildBoat();
    const where = b.aboard ? { pan: 0, sendB: 0.15 } : { at: { x: b.x, z: b.z, y: b.y ?? 0 }, ref: 6 };
    // Position the persistent chain at the hull.
    if (b.aboard) {
      set(boat.out.gain, 1);
      set(boat.pan.pan, 0);
      set(boat.air.frequency, 20000);
      set(boat.sendB.gain, 0.15);
    } else {
      const p = core.place(where.at, 6);
      set(boat.out.gain, p.gain);
      set(boat.pan.pan, p.pan);
      set(boat.air.frequency, p.cutoff);
      set(boat.sendB.gain, 0);
    }
    const s = Math.min(1.3, Math.abs(b.speed ?? 0) / TOP_SPEED);
    set(boat.hiss.gain.gain, 0.03 * s * s, 0.5);
    // The bow's chuckle.
    boat.credit += (s > 0.03 ? 2 + 10 * s : 0) * Math.min(0.1, b.dt ?? 1 / 30);
    while (boat.credit >= 1) {
      boat.credit--;
      const lane = boat.lanes[boat.next++ % 2];
      const t = Math.max(now + 0.02 + core.random() * 0.03, lane.free);
      const f = core.rand(400, 900);
      const g = 0.005 * (0.6 + 0.6 * core.random());
      lane.osc.frequency.setValueAtTime(f, t);
      lane.osc.frequency.exponentialRampToValueAtTime(f * 1.6, t + 0.035);
      lane.env.gain.setValueAtTime(0, t);
      lane.env.gain.linearRampToValueAtTime(g, t + 0.002);
      lane.env.gain.exponentialRampToValueAtTime(g * 0.002, t + 0.035);
      lane.env.gain.linearRampToValueAtTime(0, t + 0.045);
      lane.free = t + 0.05;
    }
    // A creak at each turn of the roll, if the boat is working at all.
    const vr = b.vr ?? 0;
    const roll = b.roll ?? 0;
    if (Math.sign(vr) !== Math.sign(lastVr) && Math.abs(roll) > 0.03 && now - lastCreak > 1.2) {
      lastCreak = now;
      creak({ gain: 0.012 * Math.min(1, Math.abs(roll) / 0.08), where });
      if (core.random() < 0.5) bailSqueak(where);
    }
    lastVr = vr;
    // The lantern ticks when the roll passes ±6°.
    const sign = Math.abs(roll) > 0.105 ? Math.sign(roll) : 0;
    if (sign && sign !== lastRollSign && now - lastTick > 0.8) {
      lastTick = now;
      lanternTick(where);
    }
    if (sign) lastRollSign = sign;
    // The painter coming taut.
    const nowTaut = (b.stretch ?? -1) > 0.02;
    if (nowTaut && !taut) painter(where);
    taut = nowTaut;
  }

  // One boat event (boat.js events: knock, scrape, launch, board, jump,
  // bump, ground, hull-slap, leave, refuse).
  function boatEvent(e, b = {}) {
    const gain = e.gain ?? 1;
    const where = b.aboard ? { pan: 0, sendB: 0.15 } : b.x !== undefined ? { at: { x: b.x, z: b.z, y: b.y ?? 0 }, ref: 6 } : {};
    switch (e.type) {
      case "knock":
        knock({ hollow: true, gain, where });
        return;
      case "scrape":
        scrape(1.2, 0.04, where);
        return;
      case "launch":
        scrape(0.6, 0.05, where);
        call("splash-big", { ...where, size: 0.5 });
        hullSlap(0.6, { ...where, t: ctx.currentTime + 0.45 });
        return;
      case "board":
        knock({ gain: 1, where });
        hullSlap(0.5, where);
        return;
      case "leave":
        knock({ gain: 0.6, where });
        return;
      case "bump":
        knock({ gain: Math.min(1.4, 0.5 + gain), where });
        return;
      case "ground":
        scrape(0.4, 0.04, where);
        knock({ gain: 0.7, where });
        return;
      case "hull-slap":
        hullSlap(0.3 + 0.7 * gain, where);
        return;
      default:
    }
  }

  // --- Animals ------------------------------------------------------------

  const at = (e) => ({ x: e.x, z: e.z, y: e.y });

  // A penguin's soft "haw" (it looks at you); `up` raises the pitch.
  function haw(where, { up = 1, gain = 1 } = {}) {
    const v = core.voice({ bus: "world", ...where });
    const f = core.rand(290, 310) * up;
    core.voiced(v, { contour: [[0, f], [1, f * 0.87]], formants: [[700, 4, 1.4], [1400, 5, 0.8]], length: 0.18, gain: 0.03 * gain, rough: 0.3, roughRate: 40, attack: 0.02, release: 0.05 });
    return v?.done();
  }

  function wings(where, { f = 1200, rate = 6, seconds = 1, gain = 0.012 } = {}) {
    const v = core.voice({ bus: "world", ...where });
    const n = Math.round(rate * seconds);
    for (let i = 0; i < n; i++) core.noise(v, { colour: "white", type: "bandpass", f, q: 1, attack: 0.03, tail: 0.05, gain: gain * (1 - (i / n) * 0.7), at: i / rate });
    return v?.done();
  }

  function snort(where) {
    const v = core.voice({ bus: "world", ...where });
    core.noise(v, { colour: "pink", type: "bandpass", f: 600, to: 300, q: 1.5, attack: 0.015, tail: 0.22, gain: 0.04 });
    return v?.done();
  }

  function hiss(where) {
    const v = core.voice({ bus: "world", ...where });
    core.noise(v, { colour: "white", type: "highpass", f: 3000, q: 0, attack: 0.02, tail: 0.25, gain: 0.012 });
    return v?.done();
  }

  // Oystercatcher piping: "kleep" notes, accelerating, then slowing.
  function kleep(where, { notes = 8 } = {}) {
    const v = core.voice({ bus: "world", ...where });
    let tt = 0;
    for (let i = 0; i < notes; i++) {
      core.tone(v, { hz: 3600, to: 3000, glide: 0.06, attack: 0.004, tail: 0.05, gain: 0.03, at: tt, partials: [[2, 0.25, 1]] });
      const rate = i < notes * 0.6 ? 5 + (4 * i) / (notes * 0.6) : 9 - (4 * (i - notes * 0.6)) / (notes * 0.4);
      tt += 1 / rate;
    }
    return v?.done();
  }

  function tailSlap(where) {
    const v = core.voice({ bus: "world", ...where });
    core.noise(v, { colour: "white", type: "highpass", f: 800, q: 0, attack: 0.001, tail: 0.008, gain: 0.2 });
    core.noise(v, { colour: "pink", type: "lowpass", f: 1200, to: 200, q: 0, attack: 0.01, tail: 0.9, gain: 0.15 });
    v?.done();
    call("splash-big", { ...where, size: 1, delay: 0.05 });
  }

  // A wildlife event ({ source, type, x, z, gain }).
  function wild(e) {
    const where = { at: at(e) };
    const g = e.gain ?? 1;
    switch (`${e.source}:${e.type}`) {
      case "penguins:bray":
        return call("penguin-bray", { ...where, gain: 0.7 * g });
      case "penguins:honk":
        return haw({ ...where, ref: 8 }, { gain: g });
      case "penguins:threat":
        haw({ ...where, ref: 8 }, { up: 1.2, gain: g });
        haw({ ...where, ref: 8, t: ctx.currentTime + 0.18 }, { up: 1.25, gain: g * 0.8 });
        haw({ ...where, ref: 8, t: ctx.currentTime + 0.33 }, { up: 1.15, gain: g * 0.7 });
        return wings({ ...where, ref: 8 }, { gain: 0.006 * g });
      case "penguins:splash":
        return call("splash-big", { ...where, size: 0.4, gain: g });
      case "seals:bark":
        return call("seal-bark", { ...where, gain: g });
      case "seals:splash":
        return call("splash-big", { ...where, size: 0.6, gain: g });
      case "seals:blow":
        return snort({ ...where, ref: 25, gain: g });
      case "whale:blow":
        return call("whale-blow", { ...where, gain: g });
      case "whale:slap":
      case "whale:fluke":
        return tailSlap({ ...where, ref: 90, gain: g });
      case "whale:breach":
      case "whale:crash":
        return call("splash-big", { ...where, size: 1.6, gain: g });
      case "tortoise:hiss":
        return hiss({ ...where, ref: 1.5 });
      case "oystercatchers:flush":
        kleep({ ...where, ref: 8 }, { notes: 8 });
        return wings({ ...where, ref: 8 }, { f: 900, rate: 4, seconds: 2, gain: 0.012 });
      case "oystercatchers:pipe":
        return kleep({ ...where, ref: 8 }, { notes: 3 });
      default:
        return null;
    }
  }

  // --- Places -------------------------------------------------------------

  // The boiler's drum: a short metallic feedback delay with four modes,
  // built once on first entry; anything can be sent into it.
  function boilerDrum() {
    if (boiler) return boiler;
    const input = core.counted.createGain();
    const out = core.counted.createGain();
    out.gain.value = 0.6;
    const delay = core.counted.createDelay(0.05);
    delay.delayTime.value = 0.0095;
    const fb = core.counted.createGain();
    fb.gain.value = 0.82;
    const damp = core.filter("lowpass", 2800, -3);
    input.connect(delay).connect(damp).connect(fb).connect(delay);
    damp.connect(out);
    for (const hz of [73, 147, 196, 418]) {
      const b = core.filter("bandpass", hz, 30);
      const g = core.counted.createGain();
      g.gain.value = 0.5 * 4;
      input.connect(b).connect(g).connect(out);
    }
    out.connect(core.mix.input("world"));
    boiler = { input, out };
    return boiler;
  }

  // A meow inside the boiler comes back as one deep bell (D2 and partials).
  function boilerBell(delay = 0.12) {
    const v = core.voice({ bus: "world", t: ctx.currentTime + delay, sendB: 0.2 });
    core.tone(v, { hz: 73.42, attack: 0.08, tail: 3.5, gain: 0.12, partials: [[2, 0.4, 0.8], [2.76, 0.2, 0.5]] });
    return v?.done();
  }

  // The lighthouse beam holding the cat: a low warm swell on G2 and D3.
  function beamHold(seconds = 4) {
    const v = core.voice({ bus: "world" });
    if (!v) return null;
    const lp = core.filter("lowpass", 400, -3);
    lp.connect(v.input);
    v.add(lp);
    core.tone(v, { hz: 98, attack: 0.8, hold: seconds - 0.8, tail: 1.5, gain: 0.012, out: lp });
    core.tone(v, { hz: 146.83, attack: 0.8, hold: seconds - 0.8, tail: 1.5, gain: 0.009, out: lp });
    return v.done();
  }

  // The half-attempt: one relay click from the lantern room (arrives late).
  function relay(where = {}) {
    const v = core.voice({ bus: "world", ...where });
    core.noise(v, { colour: "white", type: "bandpass", f: 1500, q: 6, attack: 0.0005, tail: 0.006, gain: 0.01 });
    return v?.done();
  }

  // A slow heavy escapement within 15 m of the lit tower: one tick a second.
  function clockwork(where = {}, ticks = 4, tempo = 1) {
    const v = core.voice({ bus: "world", ...where });
    for (let i = 0; i < ticks; i++) {
      core.modes(v, { modes: [[620, 0.12, 1], [1480, 0.08, 0.5]], gain: 0.006, at: i / tempo, tick: { colour: "white", type: "bandpass", f: 3000, q: 2, attack: 0.0005, tail: 0.004, gain: 0.006 } });
      core.noise(v, { colour: "brown", type: "lowpass", f: 200, q: 0, attack: 0.002, tail: 0.04, gain: 0.01, at: i / tempo + 0.5 / tempo });
    }
    return v?.done();
  }

  return {
    hullSlap,
    scrape,
    creak,
    knock,
    lanternTick,
    bailSqueak,
    painter,
    updateBoat,
    boatEvent,
    wild,
    haw,
    wings,
    snort,
    hiss,
    kleep,
    tailSlap,
    boilerDrum,
    boilerBell,
    beamHold,
    relay,
    clockwork,
    get boatChain() {
      return !!boat;
    },
  };
}
