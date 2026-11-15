// The cat's own sounds (bus `foley`, and `voice` for its calls): paws by
// surface, foliage it pushes through, water by depth, its body (jump,
// land, shake, drips) and its voice (meow, chirrup, purr). None of these
// is positioned: they pan a little by leg (±0.15).
import { STEPS, SURFACE, playLayers } from "./patches.js";

// Footsteps' overall level (patches.js gains are relative), and a run's lift.
export const STEP_LEVEL = 1;
export const RUN_BOOST = 2.8;

export function createFoley(core) {
  const { ctx } = core;
  let lastStep = -Infinity;
  let lastRunStep = -Infinity;
  let nextPaddle = 0;
  let nextBreath = 0;
  let wet = 0;
  let purr = null;
  let rustle = null;
  let inPlant = 0;
  let plantKind = "shrub";
  let lastSlosh = -Infinity;
  let boilerSend = null;

  // A paw landing on `surface` (patches.js SURFACE). info: { front, depth,
  // speed, scale }.
  function step(surface, running, pan = 0, info = {}) {
    const now = ctx.currentTime;
    // At a run only the front paws are voiced, at most eight a second.
    if (running && info.front === false) return null;
    if (now - (running ? lastRunStep : lastStep) < (running ? 0.12 : 0.05)) return null;
    if (running) lastRunStep = now;
    lastStep = now;
    if (surface === SURFACE.shallows && (info.depth ?? 0) > 0.06) return wade(info.depth, info.speed ?? 1, pan);
    const patch = STEPS[surface] ?? STEPS[SURFACE.drySand];
    // Running is clearly audible (about +9 dB), still soft; hind paws a
    // little softer and darker than front.
    const hind = info.front === false;
    const scale = STEP_LEVEL * (patch.trim ?? 1) * (running ? RUN_BOOST : 1) * (hind ? 0.84 : 1) * (info.scale ?? 1);
    const v = core.voice({ bus: "foley", pan, gain: 1, sendB: patch.sendB ?? 0 });
    if (v && boilerSend && surface === SURFACE.metal) v.input.connect(boilerSend);
    playLayers(core, v, patch.layers, { scale, shorten: running ? 0.85 : 1, running, fscale: hind ? 0.85 : 1, jitter: 0.008 });
    if (surface === SURFACE.shallows || surface === SURFACE.wetSand) wet = 1;
    return v?.done();
  }

  // Belly deep: a slosh per stride (and the splash when it ran in).
  function wade(depth, speed, pan) {
    const now = ctx.currentTime;
    if (now - lastSlosh < 0.22) return null;
    lastSlosh = now;
    wet = 1;
    const v = core.voice({ bus: "foley", pan });
    core.noise(v, { colour: "pink", type: "lowpass", f: core.vary(800, 0.08), q: 0, attack: 0.03, tail: core.vary(0.22, 0.15), gain: core.vary(0.035, 0.12) * Math.min(1.4, 0.6 + speed * 0.4) });
    core.bubble(v, { f: core.rand(500, 1100), gain: 0.005, at: core.rand(0.05, 0.15) });
    return v?.done();
  }

  // A plunge: strength 0…1.5 (entering at a run adds a low body).
  function splash(strength, pan = 0) {
    const g = 0.03 + strength * 0.09;
    const v = core.voice({ bus: "foley", pan });
    core.noise(v, { colour: "pink", type: "bandpass", f: core.rand(900, 1300), to: 350, q: 1.2, attack: 0.006, tail: 0.08 + strength * 0.2, gain: g });
    core.noise(v, { colour: "white", type: "highpass", f: 2600, q: 0, attack: 0.01, tail: 0.1 + strength * 0.25, gain: g * 0.4 });
    if (strength > 0.5) core.tone(v, { hz: 110, to: 60, attack: 0.005, tail: 0.12, gain: 0.04 * strength });
    const drops = Math.round(1 + strength * 4);
    for (let i = 0; i < drops; i++) core.bubble(v, { f: core.rand(700, 1600), gain: g * 0.12, at: 0.12 + core.rand(0, 0.35) });
    wet = 1;
    return v?.done();
  }

  // Swimming: a stroke now and then, a bubble with each, a small breath.
  function swim(amount, speed) {
    if (amount < 0.5) return;
    const now = ctx.currentTime;
    wet = 1;
    if (now >= nextPaddle) {
      nextPaddle = now + 0.5 - Math.min(speed, 0.8) * 0.25;
      const v = core.voice({ bus: "foley", pan: core.rand(-0.2, 0.2) });
      core.noise(v, { colour: "pink", type: "lowpass", f: core.rand(700, 1000), q: 0, attack: 0.02, tail: 0.12, gain: 0.03 * (0.7 + Math.min(1, speed) * 0.5) });
      core.bubble(v, { f: core.rand(500, 900), gain: 0.006, at: 0.06 });
      v?.done();
    }
    if (now >= nextBreath) {
      nextBreath = now + core.rand(2.5, 4);
      const v = core.voice({ bus: "foley" });
      core.noise(v, { colour: "white", type: "bandpass", f: 1900, q: 2.5, attack: 0.06, tail: 0.18, gain: 0.008 });
      v?.done();
    }
  }

  // Coming out: drips, rate falling.
  function drip(count = 10) {
    const v = core.voice({ bus: "foley" });
    let at = 0.05;
    for (let i = 0; i < count; i++) {
      core.bubble(v, { f: core.rand(800, 1700), gain: 0.005, at });
      at += 0.05 + (i / count) * 0.2 * core.rand(0.5, 1.5);
    }
    return v?.done();
  }

  // A shake: a flutter of fur throwing off spray (and droplets if wet).
  function shake() {
    const v = core.voice({ bus: "foley" });
    for (let i = 0; i < 9; i++)
      core.noise(v, { colour: "pink", type: "bandpass", f: 1500, q: 0.8, attack: 0.02, tail: 0.06, gain: 0.022 * Math.sin((i / 8) * Math.PI) + 0.006, at: 0.15 + i * 0.09 });
    if (wet > 0.3) for (let i = 0; i < 8; i++) core.bubble(v, { f: core.rand(700, 1500), gain: 0.006, at: 0.25 + core.rand(0, 0.5) });
    wet = 0;
    return v?.done();
  }

  function jump() {
    const v = core.voice({ bus: "foley" });
    core.noise(v, { colour: "pink", type: "bandpass", f: 600, to: 1400, q: 0.8, attack: 0.03, tail: 0.15, gain: 0.035 });
    return v?.done();
  }

  // Landing by surface: sand thuds, rock taps, timber knocks.
  function land(speed, surface = SURFACE.drySand) {
    const g = Math.min(0.12, 0.03 + speed * 0.025);
    const v = core.voice({ bus: "foley", sendB: surface === SURFACE.deck ? 0.2 : 0 });
    core.noise(v, { colour: "brown", type: "lowpass", f: 260, q: 0, attack: 0.01, tail: 0.1, gain: g * 0.5 });
    const patch = STEPS[surface];
    if (patch && surface !== SURFACE.drySand && surface !== SURFACE.wetSand) playLayers(core, v, patch.layers, { scale: 2 * STEP_LEVEL * patch.trim });
    return v?.done();
  }

  // Foliage: one carrier (a white-noise loop through a hopping band-pass)
  // whose gain is struck by grains while the cat moves through plants.
  // contact: { density 0…1, speed (m/s), kind "shrub" | "restio" | "broad" }.
  function brush(contact, dt) {
    const density = contact?.density ?? 0;
    const speed = Math.abs(contact?.speed ?? 0);
    const now = ctx.currentTime;
    if (density > 0.05) {
      inPlant = 1;
      plantKind = contact.kind ?? plantKind;
    } else if (inPlant) {
      inPlant = 0;
      // Leaving: one soft spring-back.
      const v = core.voice({ bus: "foley", pan: core.rand(-0.2, 0.2) });
      core.noise(v, { colour: "white", type: "bandpass", f: 2500, to: 1200, q: 1.2, attack: 0.02, tail: 0.18, gain: 0.008 });
      v?.done();
    }
    // Standing still inside a plant is silence.
    const moving = density > 0.05 && speed > 0.15;
    if (!moving) {
      if (rustle && now - rustle.used > 2) {
        for (const s of rustle.sources) s.stop();
        rustle.out.disconnect();
        rustle = null;
      }
      return;
    }
    if (!rustle) rustle = carrier();
    rustle.used = now;
    const rate = Math.min(40, 6 + 30 * Math.min(1.5, speed) * density);
    rustle.credit += rate * Math.min(0.1, dt);
    const dry = plantKind === "restio";
    while (rustle.credit >= 1) {
      rustle.credit--;
      const lane = rustle.lanes[rustle.next++ % rustle.lanes.length];
      const t = Math.max(now + 0.02, lane.free);
      const tail = dry ? core.rand(0.015, 0.03) : core.rand(0.025, 0.07);
      const g = 0.004 + 0.01 * Math.min(1, speed);
      lane.flt.frequency.setValueAtTime(dry ? core.rand(6000, 10000) : core.rand(3000, 8000), t);
      lane.pan.pan.setValueAtTime(core.rand(-0.3, 0.3), t);
      lane.env.gain.setValueAtTime(0, t);
      lane.env.gain.linearRampToValueAtTime(g, t + 0.004);
      lane.env.gain.exponentialRampToValueAtTime(g * 0.002, t + 0.004 + tail);
      lane.env.gain.linearRampToValueAtTime(0, t + 0.014 + tail);
      lane.free = t + 0.016 + tail;
      // Broad leaves: a lower slap now and then.
      if (plantKind === "broad" && core.random() < 0.35) {
        const v = core.voice({ bus: "foley", pan: core.rand(-0.3, 0.3) });
        core.noise(v, { colour: "white", type: "bandpass", f: core.rand(900, 1800), q: 1.2, attack: 0.004, tail: core.rand(0.06, 0.12), gain: g * 0.7 });
        v?.done();
      }
    }
  }

  function carrier() {
    const out = core.counted.createGain();
    out.connect(core.mix.input("foley"));
    const lanes = [];
    const sources = [];
    for (let i = 0; i < 3; i++) {
      const src = core.counted.createBufferSource();
      src.buffer = core.buffers.white;
      src.loop = true;
      const flt = core.filter("bandpass", 5000, 1.2);
      const env = core.counted.createGain();
      env.gain.value = 0;
      const pan = core.counted.createStereoPanner();
      src.connect(flt).connect(env).connect(pan).connect(out);
      src.start(0, core.random() * 1.8);
      sources.push(src);
      lanes.push({ flt, env, pan, free: 0 });
    }
    core.stats.loops += 3;
    return { out, lanes, sources, next: 0, credit: 0, used: 0 };
  }

  // The cat's voice: a buzzy glottal source through two moving formants.
  // The mouth opens (formants rise) as the pitch climbs, then closes.
  function catVoice(contour, formants, duration, level, { pan = 0, out = null } = {}) {
    const v = core.voice({ bus: "voice", pan, gain: 1 });
    if (!v) return null;
    const t = v.t;
    const osc = core.counted.createOscillator();
    osc.type = "sawtooth";
    contour.forEach(([u, hz], i) => (i === 0 ? osc.frequency.setValueAtTime(hz, t) : osc.frequency.exponentialRampToValueAtTime(hz, t + u * duration)));
    const vib = core.counted.createOscillator();
    vib.frequency.value = 5.5 + core.random() * 2;
    const depth = core.counted.createGain();
    depth.gain.value = 9;
    vib.connect(depth).connect(osc.frequency);
    const env = core.counted.createGain();
    env.gain.value = 0;
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(level, t + 0.05);
    env.gain.setValueAtTime(level, t + duration * 0.7);
    env.gain.exponentialRampToValueAtTime(level * 1e-3, t + duration);
    env.gain.linearRampToValueAtTime(0, t + duration + 0.01);
    v.add(osc, vib, depth, env);
    for (const track of formants) {
      const f = core.filter("bandpass", track.path[0][1], track.q);
      track.path.forEach(([u, hz], i) => (i === 0 ? f.frequency.setValueAtTime(hz, t) : f.frequency.linearRampToValueAtTime(hz, t + u * duration)));
      const g = core.counted.createGain();
      g.gain.value = track.gain;
      osc.connect(f).connect(g).connect(env);
      v.add(f, g);
    }
    env.connect(v.input);
    if (out) env.connect(out);
    osc.start(t);
    vib.start(t);
    osc.stop(t + duration + 0.05);
    vib.stop(t + duration + 0.05);
    v.reach(t + duration + 0.05);
    core.noise(v, { colour: "white", type: "bandpass", f: 2800, q: 0.8, gain: level * 0.12, attack: 0.04, tail: duration * 0.8 });
    return v.done();
  }

  // The long call ("mi-aow"), or with `short` the quick greeting (an
  // animal is near). Returns its length.
  function meow({ short = false, out = null } = {}) {
    const pitch = 0.9 + core.random() * 0.25;
    if (short) {
      const d = 0.35;
      catVoice([[0, 480 * pitch], [0.35, 620 * pitch], [1, 430 * pitch]], [{ q: 5, gain: 1.4, path: [[0, 650], [0.4, 1050], [1, 700]] }, { q: 7, gain: 0.9, path: [[0, 1600], [0.4, 2300], [1, 1500]] }], d, 0.14, { out });
      return d;
    }
    const d = 0.55 + core.random() * 0.35;
    catVoice(
      [[0, 430 * pitch], [0.25, 760 * pitch], [0.55, 690 * pitch], [1, 360 * pitch]],
      [
        { q: 5, gain: 1.4, path: [[0, 600], [0.3, 1100], [0.7, 950], [1, 650]] },
        { q: 7, gain: 0.9, path: [[0, 1500], [0.3, 2500], [0.7, 1900], [1, 1300]] },
      ],
      d,
      0.16,
      { out },
    );
    return d;
  }

  // "mrrp?": greeting or spotting something.
  function chirrup() {
    catVoice([[0, 330], [0.6, 440], [1, 560]], [{ q: 4, gain: 1.2, path: [[0, 500], [1, 900]] }, { q: 6, gain: 0.6, path: [[0, 1400], [1, 2100]] }], 0.26, 0.11);
  }

  // Purr: ~26 Hz pulses of low noise, louder on the out-breath; a second
  // band at 110 Hz so small speakers carry something.
  function setPurr(on) {
    if (on && !purr) {
      const src = core.counted.createBufferSource();
      src.buffer = core.buffers.brown;
      src.loop = true;
      const low = core.filter("lowpass", 420, 0);
      const band = core.filter("bandpass", 110, 3);
      const bandGain = core.counted.createGain();
      bandGain.gain.value = 0.5 * 3;
      const pulse = core.counted.createGain();
      pulse.gain.value = 0.5;
      const rate = core.counted.createOscillator();
      rate.type = "triangle";
      rate.frequency.value = 26;
      const depth = core.counted.createGain();
      depth.gain.value = 0.5;
      rate.connect(depth).connect(pulse.gain);
      const breath = core.counted.createGain();
      breath.gain.value = 0.6;
      const lung = core.counted.createOscillator();
      lung.frequency.value = 0.45;
      const lungDepth = core.counted.createGain();
      lungDepth.gain.value = 0.35;
      lung.connect(lungDepth).connect(breath.gain);
      const level = core.counted.createGain();
      level.gain.value = 0;
      level.gain.setTargetAtTime(0.1, ctx.currentTime, 1.2);
      src.connect(low).connect(pulse);
      src.connect(band).connect(bandGain).connect(pulse);
      pulse.connect(breath).connect(level).connect(core.mix.input("voice"));
      src.start();
      rate.start();
      lung.start();
      core.stats.loops++;
      const nodes = [src, low, band, bandGain, pulse, rate, depth, breath, lung, lungDepth, level];
      purr = {
        stop() {
          level.gain.setTargetAtTime(0, ctx.currentTime, 0.3);
          for (const n of [src, rate, lung]) n.stop(ctx.currentTime + 1.5);
          src.onended = () => nodes.forEach((n) => n.disconnect());
          core.stats.loops--;
        },
      };
    } else if (!on && purr) {
      purr.stop();
      purr = null;
    }
  }

  return {
    step,
    splash,
    swim,
    drip,
    shake,
    jump,
    land,
    brush,
    meow,
    chirrup,
    setPurr,
    get purring() {
      return !!purr;
    },
    get wet() {
      return wet;
    },
    // While inside the boiler: metal steps also ring its drum.
    set boiler(send) {
      boilerSend = send;
    },
    get rustling() {
      return !!rustle;
    },
  };
}
