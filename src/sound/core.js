// The building blocks every sound is made of: seeded noise buffers, a
// counted node factory, voices with a polyphony pool, envelopes, and a
// few layer types (filtered noise, tones with glides and partials, modal
// rings, bubbles, formant voices). A voice is one short-lived chain:
//
//   layers → input (level) → [air low-pass] → [behind shelf] → pan → bus
//                                                              └→ send A / B
//
// It tidies itself away when its last layer ends (a silent clock source
// scheduled to stop then disconnects every node it made), and the pool
// caps how many are alive: `voice` and `magic` are never stolen; then the
// nearest `world`, then `foley`; `weather` drops first.
import { placeSource, CULL } from "./space.js";

export const PRIORITY = { weather: 0, amb: 1, foley: 2, world: 3, music: 4, magic: 4, voice: 5 };
export const POLY = { cap: 40, typical: 24, perBus: { foley: 12, weather: 14, amb: 6, world: 16 } };

export function rngFrom(seed = 1) {
  let a = (seed * 2654435761) >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Mono noise, 2 s, seeded, DC removed, RMS 0.25, loop seam crossfaded.
export function noiseData(colour, length, random) {
  const data = new Float32Array(length);
  let b0 = 0, b1 = 0, b2 = 0, last = 0;
  for (let i = 0; i < length; i++) {
    const w = random() * 2 - 1;
    if (colour === "white") data[i] = w;
    else if (colour === "pink") {
      b0 = 0.997 * b0 + w * 0.029;
      b1 = 0.985 * b1 + w * 0.032;
      b2 = 0.95 * b2 + w * 0.048;
      data[i] = b0 + b1 + b2 + w * 0.05;
    } else {
      last = (last + 0.02 * w) / 1.02;
      data[i] = last;
    }
  }
  const fade = Math.min(2000, length >> 3);
  for (let i = 0; i < fade; i++) {
    const t = i / fade;
    data[length - fade + i] = data[length - fade + i] * (1 - t) + data[i] * t;
  }
  let mean = 0;
  for (const v of data) mean += v;
  mean /= length;
  let ms = 0;
  for (let i = 0; i < length; i++) {
    data[i] -= mean;
    ms += data[i] * data[i];
  }
  const k = 0.25 / Math.sqrt(ms / length || 1);
  for (let i = 0; i < length; i++) data[i] *= k;
  return data;
}

export function createCore(ctx, mix, { seed = 1 } = {}) {
  const random = rngFrom(seed);
  const stats = { created: 0, voices: 0, peak: 0, refused: 0, stolen: 0, culled: 0, loops: 0, window: [] };
  // Every node made through `make` (and `counted`, for calls.js) is counted.
  const counted = new Proxy(ctx, {
    get(target, prop) {
      const value = target[prop];
      if (typeof prop === "string" && prop.startsWith("create") && typeof value === "function")
        return (...args) => {
          stats.created++;
          return value.apply(target, args);
        };
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const buffers = {};
  for (const colour of ["white", "pink", "brown"]) {
    const length = Math.round(ctx.sampleRate * 2);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    buffer.getChannelData(0).set(noiseData(colour, length, random));
    buffers[colour] = buffer;
  }
  const live = new Set();
  let listener = null;

  const rand = (a = 0, b = 1) => a + random() * (b - a);
  // ±share of x, never the same draw twice running (a fresh draw each call).
  const vary = (x, share) => x * (1 + (random() * 2 - 1) * share);

  function filter(type, f, q = 1) {
    const n = counted.createBiquadFilter();
    n.type = type;
    n.frequency.value = f;
    n.Q.value = q;
    return n;
  }

  // Linear attack, exponential tail to −60 dB, then 10 ms to zero (so a
  // voice never stops on a step).
  function shape(param, t, { attack = 0.005, hold = 0, tail = 0.1, peak = 1 }) {
    param.setValueAtTime(0, t);
    param.linearRampToValueAtTime(peak, t + Math.max(0.0005, attack));
    if (hold > 0) param.setValueAtTime(peak, t + attack + hold);
    param.exponentialRampToValueAtTime(Math.max(1e-6, peak * 1e-3), t + attack + hold + tail);
    param.linearRampToValueAtTime(0, t + attack + hold + tail + 0.01);
    return t + attack + hold + tail + 0.01;
  }

  function steal(priority, level, bus) {
    const perBus = POLY.perBus[bus];
    let busCount = 0;
    if (perBus) for (const v of live) if (v.bus === bus) busCount++;
    const full = live.size >= POLY.cap || (perBus && busCount >= perBus);
    if (!full) return true;
    // The quietest of the lowest priority (that may be stolen) goes.
    let victim = null;
    for (const v of live) {
      if (v.priority >= 4) continue;
      if (perBus && busCount >= perBus && v.bus !== bus) continue;
      if (v.priority > priority || (v.priority === priority && v.level > level)) continue;
      if (!victim || v.priority < victim.priority || (v.priority === victim.priority && v.level < victim.level)) victim = v;
    }
    if (victim) {
      victim.kill();
      stats.stolen++;
      return true;
    }
    if (priority >= 4) return true;
    stats.refused++;
    return false;
  }

  // A voice on `bus`, at time `t` (default now + 10 ms), at `gain`.
  // Positioned with `at` ({ x, z, y }) and `ref` (m), or panned with `pan`.
  // Returns null when culled or refused (layers then do nothing).
  function voice({ bus = "world", t = null, gain = 1, pan = 0, at = null, ref = 10, sendA = 0, sendB = 0, priority = PRIORITY[bus] ?? 2 } = {}) {
    const start = Math.max(ctx.currentTime, t ?? ctx.currentTime + 0.01);
    let cutoff = 20000;
    let behind = false;
    if (at) {
      const p = placeSource(listener, at, ref);
      gain *= p.gain;
      pan = p.pan;
      cutoff = p.cutoff;
      behind = p.behind;
      sendA = Math.max(sendA, p.sendA);
    }
    if (gain < CULL) {
      stats.culled++;
      return null;
    }
    if (!steal(priority, gain, bus)) return null;
    const nodes = [];
    const input = counted.createGain();
    input.gain.value = gain;
    nodes.push(input);
    let tail = input;
    if (cutoff < 15000) {
      const air = filter("lowpass", cutoff, -3);
      tail = tail.connect(air);
      nodes.push(air);
    }
    if (behind) {
      const shelf = filter("highshelf", 5000, 0);
      shelf.gain.value = -4;
      tail = tail.connect(shelf);
      nodes.push(shelf);
    }
    const panner = counted.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    tail.connect(panner).connect(mix.input(bus));
    nodes.push(panner);
    for (const [amount, into] of [[sendA, mix.sendA], [sendB, mix.sendB]]) {
      if (!(amount > 0)) continue;
      const send = counted.createGain();
      send.gain.value = amount;
      panner.connect(send).connect(into);
      nodes.push(send);
    }
    const v = {
      t: start,
      bus,
      priority,
      level: gain,
      input,
      nodes,
      end: start,
      ended: false,
      add(...n) {
        nodes.push(...n);
      },
      reach(time) {
        v.end = Math.max(v.end, time);
      },
      kill() {
        if (v.ended) return;
        input.gain.cancelScheduledValues(ctx.currentTime);
        input.gain.setTargetAtTime(0, ctx.currentTime, 0.008);
        live.delete(v);
      },
      // Schedules the tidy-up once every layer is in.
      done() {
        const clock = counted.createConstantSource();
        clock.offset.value = 0;
        clock.connect(input);
        clock.start(start);
        clock.stop(v.end + 0.1);
        clock.onended = () => {
          v.ended = true;
          live.delete(v);
          for (const n of nodes) n.disconnect();
          clock.disconnect();
        };
        return v;
      },
    };
    live.add(v);
    stats.voices = live.size;
    stats.peak = Math.max(stats.peak, live.size);
    return v;
  }

  // Filtered noise: colour white | pink | brown; type a biquad type or "none".
  function noise(v, { colour = "white", type = "bandpass", f = 1000, to = null, q = 1, attack = 0.005, hold = 0, tail = 0.08, gain = 0.02, at = 0, rate = 1, out = null }) {
    if (!v) return 0;
    const t = v.t + at;
    const src = counted.createBufferSource();
    src.buffer = buffers[colour];
    src.loop = true;
    src.playbackRate.value = rate;
    const env = counted.createGain();
    const end = shape(env.gain, t, { attack, hold, tail, peak: gain });
    let head = src;
    if (type !== "none") {
      const flt = filter(type, f, q);
      if (to) {
        flt.frequency.setValueAtTime(f, t);
        flt.frequency.exponentialRampToValueAtTime(to, end);
      }
      head = src.connect(flt);
      v.add(flt);
    }
    head.connect(env).connect(out ?? v.input);
    src.start(t, random() * 1.8);
    src.stop(end + 0.02);
    v.add(src, env);
    v.reach(end);
    return end;
  }

  // An oscillator note: `to` glides exponentially over `glide` s (default
  // the whole note); `partials` [[ratio, gain, tailScale]] ring above it.
  function tone(v, { type = "sine", hz = 440, to = null, glide = null, attack = 0.005, hold = 0, tail = 0.2, gain = 0.02, at = 0, partials = null, detune = 0, out = null }) {
    if (!v) return 0;
    const t = v.t + at;
    let end = t;
    for (const [ratio, g, tailScale] of [[1, 1, 1], ...(partials ?? [])]) {
      const osc = counted.createOscillator();
      osc.type = ratio === 1 ? type : "sine";
      osc.frequency.setValueAtTime(hz * ratio, t);
      if (detune) osc.detune.value = detune;
      const env = counted.createGain();
      const e = shape(env.gain, t, { attack, hold, tail: tail * (tailScale ?? 1), peak: gain * g });
      if (to) osc.frequency.exponentialRampToValueAtTime(to * ratio, t + (glide ?? attack + hold + tail));
      osc.connect(env).connect(out ?? v.input);
      osc.start(t);
      osc.stop(e + 0.02);
      v.add(osc, env);
      end = Math.max(end, e);
    }
    v.reach(end);
    return end;
  }

  // A struck body: sine modes [hz, t60 (s), gain], each with its own decay,
  // a little detuned per strike, plus an optional noise tick.
  function modes(v, { modes: list, gain = 0.02, at = 0, attack = 0.0015, spread = 0.012, tick = null, out = null }) {
    if (!v) return 0;
    let end = v.t + at;
    for (const [hz, t60, g] of list) {
      const f = hz * (1 + (random() * 2 - 1) * spread);
      end = Math.max(end, tone(v, { hz: f, attack, tail: t60, gain: gain * g, at, out }));
    }
    if (tick) end = Math.max(end, noise(v, { at, ...tick, out }));
    return end;
  }

  // A bubble: a sine sweeping up (f → ratio × f) as it closes.
  function bubble(v, { f = 900, ratio = 1.6, attack = 0.002, tail = 0.03, gain = 0.008, at = 0, out = null }) {
    return tone(v, { hz: f, to: f * ratio, glide: attack + tail, attack, tail, gain, at, out });
  }

  // A voiced call: a buzzy source (contour [[0…1, Hz]]) through formants
  // [[Hz, Q, gain]], with optional roughness (amplitude flutter).
  function voiced(v, { type = "sawtooth", contour, formants, length, gain, attack = 0.02, release = 0.08, rough = 0, roughRate = 35, vibrato = 0, at = 0, out = null }) {
    if (!v) return 0;
    const t = v.t + at;
    const osc = counted.createOscillator();
    osc.type = type;
    contour.forEach(([u, hz], i) => (i === 0 ? osc.frequency.setValueAtTime(hz, t) : osc.frequency.exponentialRampToValueAtTime(hz, t + u * length)));
    const end = t + length + release + 0.02;
    const env = counted.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(gain, t + attack);
    env.gain.setValueAtTime(gain, t + Math.max(attack, length - release));
    env.gain.exponentialRampToValueAtTime(gain * 1e-3, t + length + release);
    env.gain.linearRampToValueAtTime(0, end);
    let source = osc;
    v.add(osc, env);
    if (vibrato) {
      const lfo = counted.createOscillator();
      lfo.frequency.value = 5 + random() * 2;
      const depth = counted.createGain();
      depth.gain.value = vibrato;
      lfo.connect(depth).connect(osc.frequency);
      lfo.start(t);
      lfo.stop(end);
      v.add(lfo, depth);
    }
    if (rough) {
      const am = counted.createGain();
      am.gain.value = 1 - rough / 2;
      const lfo = counted.createOscillator();
      lfo.type = "square";
      lfo.frequency.value = roughRate;
      const depth = counted.createGain();
      depth.gain.value = rough / 2;
      lfo.connect(depth).connect(am.gain);
      lfo.start(t);
      lfo.stop(end);
      osc.connect(am);
      source = am;
      v.add(am, lfo, depth);
    }
    for (const [hz, q, g] of formants) {
      const f = filter("bandpass", hz, q);
      const level = counted.createGain();
      level.gain.value = g;
      source.connect(f).connect(level).connect(env);
      v.add(f, level);
    }
    env.connect(out ?? v.input);
    osc.start(t);
    osc.stop(end);
    v.reach(end);
    return end;
  }

  // A looping source for a bed: noise through a filter into a gain (0),
  // panned, on `bus`. Two sources at different offsets when `stereo`.
  function bed({ colour = "pink", type = "bandpass", f = 1000, q = 0.7, bus = "amb", stereo = false }) {
    const out = counted.createGain();
    out.gain.value = 0;
    const flt = filter(type, f, q);
    const swell = counted.createGain();
    const pan = counted.createStereoPanner();
    const sources = [];
    if (stereo) {
      const merger = counted.createChannelMerger(2);
      for (const side of [0, 1]) {
        const src = counted.createBufferSource();
        src.buffer = buffers[colour];
        src.loop = true;
        src.playbackRate.value = 0.93 + random() * 0.14;
        src.connect(merger, 0, side);
        src.start(0, random() * 1.9);
        sources.push(src);
      }
      merger.connect(flt);
    } else {
      const src = counted.createBufferSource();
      src.buffer = buffers[colour];
      src.loop = true;
      src.playbackRate.value = 0.93 + random() * 0.14;
      src.connect(flt);
      src.start(0, random() * 1.9);
      sources.push(src);
    }
    flt.connect(swell).connect(out).connect(pan).connect(mix.input(bus));
    stats.loops += sources.length;
    return { gain: out, filter: flt, swell, pan, sources };
  }

  return {
    ctx,
    counted,
    mix,
    random,
    rand,
    vary,
    buffers,
    stats,
    live,
    filter,
    shape,
    voice,
    noise,
    tone,
    modes,
    bubble,
    voiced,
    bed,
    // Where a source sits from the listener (space.js placeSource).
    place(at, ref = 10) {
      return placeSource(listener, at, ref);
    },
    get listener() {
      return listener;
    },
    set listener(l) {
      listener = l;
    },
    // Node creations per second over the last 10 s, for the budget.
    tick(now) {
      stats.window.push([now, stats.created]);
      while (stats.window.length > 2 && now - stats.window[0][0] > 10) stats.window.shift();
      const [t0, c0] = stats.window[0];
      stats.rate = now > t0 ? (stats.created - c0) / (now - t0) : 0;
      stats.voices = live.size;
    },
  };
}
