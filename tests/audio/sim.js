// A small Web Audio renderer in plain JS, so the sound code can be rendered
// and measured under `node --test` (node has no Web Audio). It implements
// the subset src/sound uses, following the Web Audio spec where it matters
// for measurement:
//
//   - AudioParam automation (setValueAtTime, linear and exponential ramps,
//     setTargetAtTime, cancelScheduledValues, cancelAndHoldAtTime), a-rate,
//     plus audio-rate modulation from connected nodes;
//   - BiquadFilter with the spec's coefficient formulas (lowpass/highpass Q
//     in dB, bandpass Q linear, shelves, peaking, notch, allpass), per-sample
//     coefficients while automated;
//   - oscillators (sine exact; sawtooth, square and triangle band-limited
//     with polyBLEP, standing in for Chrome's wavetables);
//   - channel up-mixing (mono → both), StereoPanner's equal-power law for
//     mono and stereo inputs, ChannelMerger;
//   - DelayNode (any delay; inside feedback loops the delay is at least one
//     128-frame quantum, as in browsers);
//   - DynamicsCompressor with the spec's static curve, its automatic makeup
//     gain and a 6 ms look-ahead (attack/release are a simple one-pole on
//     the gain reduction, so its transient shape is an approximation).
//
// Not implemented: HRTF PannerNode, ConvolverNode, WaveShaper, worklets
// (src/sound uses none of them). Rendering is in 128-frame quanta pulled
// from the destination; nodes nobody can reach cost nothing.

const QUANTUM = 128;

export class OfflineAudioContext {
  constructor(a, b, c) {
    const o = typeof a === "object" ? a : { numberOfChannels: a, length: b, sampleRate: c };
    this.sampleRate = o.sampleRate ?? 48000;
    this.length = o.length;
    this.numberOfChannels = o.numberOfChannels ?? 2;
    this.frame = 0;
    this.block = 0;
    this.state = "suspended";
    this.destination = new Destination(this);
    this.output = [new Float32Array(this.length), new Float32Array(this.length)];
    this.sources = new Set();
    this.delays = new Set();
    this.created = 0;
    this.listener = {};
  }
  get currentTime() {
    return this.frame / this.sampleRate;
  }
  createGain() { return new Gain(this); }
  createBiquadFilter() { return new Biquad(this); }
  createOscillator() { return new Oscillator(this); }
  createBufferSource() { return new BufferSource(this); }
  createConstantSource() { return new ConstantSource(this); }
  createStereoPanner() { return new StereoPanner(this); }
  createDelay(max = 1) { return new Delay(this, max); }
  createChannelMerger(n = 6) { return new Merger(this, n); }
  createDynamicsCompressor() { return new Compressor(this); }
  createBuffer(channels, length, sampleRate) { return new AudioBuffer(channels, length, sampleRate); }
  resume() { return Promise.resolve(); }
  suspend() { return Promise.resolve(); }
  close() { return Promise.resolve(); }

  // Non-standard: render up to `seconds` (absolute), so a script can
  // interleave updates with rendering, as a page does between frames.
  renderUntil(seconds) {
    const end = Math.min(this.length, Math.round(seconds * this.sampleRate));
    while (this.frame < end) this.renderQuantum(Math.min(QUANTUM, end - this.frame));
  }
  async startRendering() {
    this.renderUntil(this.length / this.sampleRate);
    const buffer = new AudioBuffer(2, this.length, this.sampleRate);
    buffer.channels = this.output;
    return buffer;
  }
  renderQuantum(n) {
    this.block++;
    this.n = n;
    const out = this.destination.pull();
    for (let pass = 0; pass < 8; pass++) {
      // Delay lines write their input after the graph has been pulled.
      const pending = [...this.delays].filter((d) => d.wroteBlock !== this.block && d.pulledBlock === this.block);
      if (!pending.length) break;
      for (const d of pending) d.write();
    }
    const L = out.channels[0];
    const R = out.channels.length > 1 ? out.channels[1] : L;
    this.output[0].set(L.subarray(0, n), this.frame);
    this.output[1].set(R.subarray(0, n), this.frame);
    this.frame += n;
    // Ended sources fire onended after their quantum, as a browser would.
    for (const s of this.sources) {
      if (s.stopFrame !== null && this.frame >= s.stopFrame && !s.ended) {
        s.ended = true;
        this.sources.delete(s);
        s.onended?.();
      }
    }
  }
}

export class AudioBuffer {
  constructor(channels, length, sampleRate) {
    if (typeof channels === "object") ({ numberOfChannels: channels, length, sampleRate } = channels);
    this.numberOfChannels = channels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.duration = length / sampleRate;
    this.channels = Array.from({ length: channels }, () => new Float32Array(length));
  }
  getChannelData(c) {
    return this.channels[c];
  }
}

class Param {
  constructor(ctx, value, { min = -3.4e38, max = 3.4e38 } = {}) {
    this.ctx = ctx;
    this.defaultValue = value;
    this.current = value;
    this.min = min;
    this.max = max;
    this.events = [];
    this.inputs = [];
    this.buffer = new Float32Array(QUANTUM);
    this.cursor = 0;
    this.startValue = value;
    this.startTime = 0;
  }
  get value() {
    return this.current;
  }
  set value(v) {
    if (!this.events.length) {
      this.current = v;
      this.startValue = v;
    } else this.setValueAtTime(v, this.ctx.currentTime);
  }
  insert(e) {
    let i = this.events.length;
    while (i > 0 && this.events[i - 1].time > e.time) i--;
    // Same time: a later call replaces an earlier one of the same type.
    if (i > 0 && this.events[i - 1].time === e.time && this.events[i - 1].type === e.type) this.events[i - 1] = e;
    else this.events.splice(i, 0, e);
    if (i < this.cursor) this.cursor = i;
    return this;
  }
  setValueAtTime(value, time) { return this.insert({ type: "set", value, time }); }
  linearRampToValueAtTime(value, time) { return this.insert({ type: "linear", value, time }); }
  exponentialRampToValueAtTime(value, time) {
    if (value === 0) throw new RangeError("exponential ramp to 0");
    return this.insert({ type: "exp", value, time });
  }
  setTargetAtTime(value, time, constant) { return this.insert({ type: "target", value, time, constant: Math.max(1e-6, constant) }); }
  cancelScheduledValues(time) {
    this.events = this.events.filter((e) => e.time < time);
    this.cursor = Math.min(this.cursor, this.events.length);
    return this;
  }
  cancelAndHoldAtTime(time) {
    const v = this.valueAt(time);
    this.cancelScheduledValues(time);
    return this.setValueAtTime(v, time);
  }
  // The automation value at time t (does not move the cursor).
  valueAt(t) {
    const save = [this.cursor, this.startValue, this.startTime, this.current];
    const v = this.advance(t);
    [this.cursor, this.startValue, this.startTime, this.current] = save;
    return v;
  }
  // Value at time t, for t non-decreasing between calls.
  advance(t) {
    const ev = this.events;
    // Retire events that have fully begun when the next one has too.
    while (this.cursor < ev.length && ev[this.cursor].time <= t) {
      const e = ev[this.cursor];
      const next = ev[this.cursor + 1];
      if (e.type === "linear" || e.type === "exp" || e.type === "set") {
        this.startValue = e.value;
        this.startTime = e.time;
        this.current = e.value;
        this.cursor++;
        continue;
      }
      // target: holds until the next event begins.
      if (next && next.time <= t) {
        const v = e.value + (this.startValue - e.value) * Math.exp(-(next.time - e.time) / e.constant);
        // A ramp after a target starts from the target's value at the ramp's own previous point.
        this.startValue = v;
        this.startTime = next.type === "linear" || next.type === "exp" ? e.time : next.time;
        this.cursor++;
        continue;
      }
      break;
    }
    if (this.cursor < ev.length) {
      const e = ev[this.cursor];
      if (e.time <= t && e.type === "target") {
        this.current = e.value + (this.startValue - e.value) * Math.exp(-(t - e.time) / e.constant);
        return this.current;
      }
      if (e.time > t) {
        const t0 = this.startTime;
        const v0 = this.startValue;
        if (e.type === "linear" && t >= t0) {
          this.current = e.time <= t0 ? e.value : v0 + ((e.value - v0) * (t - t0)) / (e.time - t0);
          return this.current;
        }
        if (e.type === "exp" && t >= t0) {
          if (v0 === 0 || v0 * e.value < 0) this.current = v0;
          else this.current = e.time <= t0 ? e.value : v0 * (e.value / v0) ** ((t - t0) / (e.time - t0));
          return this.current;
        }
        this.current = this.startValue;
        return this.current;
      }
    }
    return this.current;
  }
  // Fills this.buffer for the current quantum and returns it.
  compute() {
    const ctx = this.ctx;
    const n = ctx.n;
    const sr = ctx.sampleRate;
    const t0 = ctx.frame / sr;
    const out = this.buffer;
    if (this.automationConstant()) out.fill(this.advance(t0), 0, n);
    else for (let i = 0; i < n; i++) out[i] = this.advance(t0 + i / sr);
    for (const node of this.inputs) {
      const sig = node.pull();
      const c0 = sig.channels[0];
      const c1 = sig.channels.length > 1 ? sig.channels[1] : null;
      if (c1) for (let i = 0; i < n; i++) out[i] += 0.5 * (c0[i] + c1[i]);
      else for (let i = 0; i < n; i++) out[i] += c0[i];
    }
    for (let i = 0; i < n; i++) out[i] = out[i] < this.min ? this.min : out[i] > this.max ? this.max : out[i];
    return out;
  }
  // True when the param holds one value through this quantum.
  constantNow() {
    return !this.inputs.length && this.automationConstant();
  }
  automationConstant() {
    const t0 = this.ctx.frame / this.ctx.sampleRate;
    const t1 = t0 + this.ctx.n / this.ctx.sampleRate;
    const ev = this.events;
    if (this.cursor >= ev.length) return true;
    const e = ev[this.cursor];
    if (e.type === "target" && e.time <= t1) return false;
    if ((e.type === "linear" || e.type === "exp") && this.startTime <= t1) return false;
    return e.time > t1;
  }
}

class Node {
  constructor(ctx, { inputs = 1, channels = 2 } = {}) {
    this.ctx = ctx;
    ctx.created++;
    this.inputs = Array.from({ length: Math.max(1, inputs) }, () => []);
    this.outputsTo = [];
    this.channelCount = channels;
    this.pulledBlock = -1;
    this.result = null;
    this.computing = false;
  }
  connect(dest, output = 0, input = 0) {
    if (dest instanceof Param) {
      dest.inputs.push(this);
      this.outputsTo.push({ param: dest });
      return dest;
    }
    dest.inputs[input].push(this);
    this.outputsTo.push({ node: dest, input });
    return dest;
  }
  disconnect() {
    for (const o of this.outputsTo) {
      if (o.param) o.param.inputs = o.param.inputs.filter((n) => n !== this);
      else o.node.inputs[o.input] = o.node.inputs[o.input].filter((n) => n !== this);
    }
    this.outputsTo = [];
  }
  // This quantum's output, computed once.
  pull() {
    if (this.pulledBlock === this.ctx.block) return this.result;
    if (this.computing) throw new Error("cycle without a DelayNode");
    this.computing = true;
    this.result = this.process();
    this.computing = false;
    this.pulledBlock = this.ctx.block;
    return this.result;
  }
  // Sum of the inputs on input `i`, up-mixed to the widest (1 or 2 channels).
  mixInput(i = 0, scratch = (this.scratch ??= [new Float32Array(QUANTUM), new Float32Array(QUANTUM)])) {
    const n = this.ctx.n;
    const sigs = this.inputs[i].map((node) => node.pull());
    let channels = 1;
    for (const s of sigs) channels = Math.max(channels, s.channels.length);
    if (!sigs.length) channels = 1;
    const out = scratch.slice(0, channels);
    for (const c of out) c.fill(0, 0, n);
    for (const s of sigs) {
      for (let c = 0; c < channels; c++) {
        const src = s.channels[Math.min(c, s.channels.length - 1)];
        const dst = out[c];
        for (let k = 0; k < n; k++) dst[k] += src[k];
      }
    }
    return { channels: out, silent: !sigs.length };
  }
}

class Destination extends Node {
  process() {
    return this.mixInput(0);
  }
}

class Gain extends Node {
  constructor(ctx) {
    super(ctx);
    this.gain = new Param(ctx, 1);
    this.out = [new Float32Array(QUANTUM), new Float32Array(QUANTUM)];
  }
  process() {
    const input = this.mixInput(0);
    const n = this.ctx.n;
    const g = this.gain.compute();
    const outs = this.out.slice(0, input.channels.length);
    for (let c = 0; c < outs.length; c++) {
      const a = input.channels[c];
      const o = outs[c];
      for (let k = 0; k < n; k++) o[k] = a[k] * g[k];
    }
    return { channels: outs };
  }
}

class Biquad extends Node {
  constructor(ctx) {
    super(ctx);
    this.type = "lowpass";
    this.frequency = new Param(ctx, 350, { min: 0, max: ctx.sampleRate / 2 });
    this.Q = new Param(ctx, 1);
    this.gain = new Param(ctx, 0);
    this.detune = new Param(ctx, 0);
    this.state = [new Float64Array(4), new Float64Array(4)];
    this.out = [new Float32Array(QUANTUM), new Float32Array(QUANTUM)];
    this.key = "";
    this.c = new Float64Array([1, 0, 0, 0, 0]);
  }
  coefficients(f, q, gain, detune) {
    const sr = this.ctx.sampleRate;
    const f0 = Math.min(sr / 2, Math.max(0, f * 2 ** (detune / 1200)));
    const w0 = (2 * Math.PI * f0) / sr;
    const cos = Math.cos(w0);
    const sin = Math.sin(w0);
    const A = 10 ** (gain / 40);
    const aQ = sin / (2 * Math.max(1e-4, q));
    const aQdB = sin / (2 * 10 ** (q / 20));
    const aS = (sin / 2) * Math.SQRT2;
    let b0, b1, b2, a0, a1, a2;
    switch (this.type) {
      case "lowpass": b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = b0; a0 = 1 + aQdB; a1 = -2 * cos; a2 = 1 - aQdB; break;
      case "highpass": b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = b0; a0 = 1 + aQdB; a1 = -2 * cos; a2 = 1 - aQdB; break;
      case "bandpass": b0 = aQ; b1 = 0; b2 = -aQ; a0 = 1 + aQ; a1 = -2 * cos; a2 = 1 - aQ; break;
      case "notch": b0 = 1; b1 = -2 * cos; b2 = 1; a0 = 1 + aQ; a1 = -2 * cos; a2 = 1 - aQ; break;
      case "allpass": b0 = 1 - aQ; b1 = -2 * cos; b2 = 1 + aQ; a0 = 1 + aQ; a1 = -2 * cos; a2 = 1 - aQ; break;
      case "peaking": b0 = 1 + aQ * A; b1 = -2 * cos; b2 = 1 - aQ * A; a0 = 1 + aQ / A; a1 = -2 * cos; a2 = 1 - aQ / A; break;
      case "lowshelf": {
        const s = 2 * Math.sqrt(A) * aS;
        b0 = A * (A + 1 - (A - 1) * cos + s); b1 = 2 * A * (A - 1 - (A + 1) * cos); b2 = A * (A + 1 - (A - 1) * cos - s);
        a0 = A + 1 + (A - 1) * cos + s; a1 = -2 * (A - 1 + (A + 1) * cos); a2 = A + 1 + (A - 1) * cos - s;
        break;
      }
      case "highshelf": {
        const s = 2 * Math.sqrt(A) * aS;
        b0 = A * (A + 1 + (A - 1) * cos + s); b1 = -2 * A * (A - 1 + (A + 1) * cos); b2 = A * (A + 1 + (A - 1) * cos - s);
        a0 = A + 1 - (A - 1) * cos + s; a1 = 2 * (A - 1 - (A + 1) * cos); a2 = A + 1 - (A - 1) * cos - s;
        break;
      }
      default: throw new Error(`biquad type ${this.type}`);
    }
    const c = this.c;
    c[0] = b0 / a0; c[1] = b1 / a0; c[2] = b2 / a0; c[3] = a1 / a0; c[4] = a2 / a0;
  }
  process() {
    const input = this.mixInput(0);
    const n = this.ctx.n;
    const constant = this.frequency.constantNow() && this.Q.constantNow() && this.gain.constantNow() && this.detune.constantNow();
    const f = this.frequency.compute();
    const q = this.Q.compute();
    const g = this.gain.compute();
    const d = this.detune.compute();
    const chans = input.channels.length;
    const outs = this.out.slice(0, chans);
    if (constant) {
      const key = `${this.type}${f[0]},${q[0]},${g[0]},${d[0]}`;
      if (key !== this.key) {
        this.key = key;
        this.coefficients(f[0], q[0], g[0], d[0]);
      }
    }
    for (let c = 0; c < chans; c++) {
      const s = this.state[c];
      const x = input.channels[c];
      const o = outs[c];
      let [x1, x2, y1, y2] = s;
      for (let k = 0; k < n; k++) {
        if (!constant) this.coefficients(f[k], q[k], g[k], d[k]);
        const cf = this.c;
        const y = cf[0] * x[k] + cf[1] * x1 + cf[2] * x2 - cf[3] * y1 - cf[4] * y2;
        x2 = x1; x1 = x[k]; y2 = y1; y1 = Math.abs(y) < 1e-25 ? 0 : y;
        o[k] = y;
      }
      s[0] = x1; s[1] = x2; s[2] = y1; s[3] = y2;
    }
    if (!constant) this.key = "";
    return { channels: outs };
  }
}

class Scheduled extends Node {
  constructor(ctx) {
    super(ctx, { inputs: 0 });
    this.startFrame = null;
    this.stopFrame = null;
    this.ended = false;
    this.onended = null;
    this.out = [new Float32Array(QUANTUM), new Float32Array(QUANTUM)];
    this.silence = { channels: [new Float32Array(QUANTUM)] };
  }
  start(when = 0, offset = 0) {
    if (this.startFrame !== null) throw new Error("start called twice");
    this.startFrame = Math.max(this.ctx.frame, Math.round(when * this.ctx.sampleRate));
    this.startOffset = offset;
    this.ctx.sources.add(this);
  }
  stop(when = 0) {
    this.stopFrame = Math.max(this.startFrame ?? 0, Math.round(when * this.ctx.sampleRate));
  }
  // [from, to) frames of this quantum that sound.
  window() {
    const f0 = this.ctx.frame;
    const n = this.ctx.n;
    if (this.startFrame === null || this.ended) return null;
    const a = Math.max(0, this.startFrame - f0);
    const b = Math.min(n, this.stopFrame === null ? n : this.stopFrame - f0);
    return a < b ? [a, b] : null;
  }
}

class Oscillator extends Scheduled {
  constructor(ctx) {
    super(ctx);
    this.type = "sine";
    this.frequency = new Param(ctx, 440);
    this.detune = new Param(ctx, 0);
    this.phase = 0;
  }
  process() {
    const f = this.frequency.compute();
    const d = this.detune.compute();
    const w = this.window();
    if (!w) return this.silence;
    const o = this.out[0];
    const n = this.ctx.n;
    o.fill(0, 0, n);
    const sr = this.ctx.sampleRate;
    let p = this.phase;
    for (let k = w[0]; k < w[1]; k++) {
      const hz = f[k] * (d[k] ? 2 ** (d[k] / 1200) : 1);
      const dt = Math.min(0.5, Math.abs(hz) / sr);
      let v;
      switch (this.type) {
        case "sine": v = Math.sin(2 * Math.PI * p); break;
        case "sawtooth": v = 2 * p - 1 - blep(p, dt); break;
        case "square": v = (p < 0.5 ? 1 : -1) + blep(p, dt) - blep((p + 0.5) % 1, dt); break;
        case "triangle": v = p < 0.25 ? 4 * p : p < 0.75 ? 2 - 4 * p : 4 * p - 4; break;
        default: v = Math.sin(2 * Math.PI * p);
      }
      o[k] = v;
      p += hz / sr;
      p -= Math.floor(p);
    }
    this.phase = p;
    return { channels: [o] };
  }
}

function blep(t, dt) {
  if (dt <= 0) return 0;
  if (t < dt) {
    t /= dt;
    return t + t - t * t - 1;
  }
  if (t > 1 - dt) {
    t = (t - 1) / dt;
    return t * t + t + t + 1;
  }
  return 0;
}

class ConstantSource extends Scheduled {
  constructor(ctx) {
    super(ctx);
    this.offset = new Param(ctx, 1);
  }
  start(when = 0) {
    super.start(when, 0);
  }
  process() {
    const v = this.offset.compute();
    const w = this.window();
    if (!w) return this.silence;
    const o = this.out[0];
    o.fill(0, 0, this.ctx.n);
    for (let k = w[0]; k < w[1]; k++) o[k] = v[k];
    return { channels: [o] };
  }
}

class BufferSource extends Scheduled {
  constructor(ctx) {
    super(ctx);
    this.buffer = null;
    this.loop = false;
    this.loopStart = 0;
    this.loopEnd = 0;
    this.playbackRate = new Param(ctx, 1);
    this.detune = new Param(ctx, 0);
    this.pos = null;
  }
  process() {
    const rate = this.playbackRate.compute();
    this.detune.compute();
    const w = this.window();
    const b = this.buffer;
    if (!w || !b) return this.silence;
    const chans = b.numberOfChannels;
    const n = this.ctx.n;
    const outs = this.out.slice(0, Math.min(2, chans));
    for (const o of outs) o.fill(0, 0, n);
    if (this.pos === null) this.pos = (this.startOffset ?? 0) * b.sampleRate;
    const len = b.length;
    const ls = this.loop ? Math.round(this.loopStart * b.sampleRate) : 0;
    const le = this.loop && this.loopEnd > 0 ? Math.round(this.loopEnd * b.sampleRate) : len;
    const step = b.sampleRate / this.ctx.sampleRate;
    let p = this.pos;
    for (let k = w[0]; k < w[1]; k++) {
      if (p >= le) {
        if (!this.loop) {
          this.stopFrame = this.ctx.frame + k;
          break;
        }
        p = ls + ((p - ls) % (le - ls));
      }
      const i = Math.floor(p);
      const frac = p - i;
      const j = i + 1 >= le ? (this.loop ? ls : i) : i + 1;
      for (let c = 0; c < outs.length; c++) {
        const data = b.channels[c];
        outs[c][k] = data[i] + (data[j] - data[i]) * frac;
      }
      p += rate[k] * step;
    }
    this.pos = p;
    return { channels: outs };
  }
}

class StereoPanner extends Node {
  constructor(ctx) {
    super(ctx);
    this.pan = new Param(ctx, 0, { min: -1, max: 1 });
    this.out = [new Float32Array(QUANTUM), new Float32Array(QUANTUM)];
  }
  process() {
    const input = this.mixInput(0);
    const p = this.pan.compute();
    const n = this.ctx.n;
    const [L, R] = this.out;
    if (input.channels.length === 1) {
      const x = input.channels[0];
      for (let k = 0; k < n; k++) {
        const a = ((p[k] + 1) / 2) * (Math.PI / 2);
        L[k] = x[k] * Math.cos(a);
        R[k] = x[k] * Math.sin(a);
      }
    } else {
      const [xl, xr] = input.channels;
      for (let k = 0; k < n; k++) {
        if (p[k] <= 0) {
          const a = (p[k] + 1) * (Math.PI / 2);
          L[k] = xl[k] + xr[k] * Math.cos(a);
          R[k] = xr[k] * Math.sin(a);
        } else {
          const a = p[k] * (Math.PI / 2);
          L[k] = xl[k] * Math.cos(a);
          R[k] = xr[k] + xl[k] * Math.sin(a);
        }
      }
    }
    return { channels: this.out };
  }
}

class Delay extends Node {
  constructor(ctx, max) {
    super(ctx);
    this.delayTime = new Param(ctx, 0, { min: 0, max });
    this.size = Math.ceil(max * ctx.sampleRate) + 2 * QUANTUM + 2;
    this.ring = [new Float32Array(this.size), new Float32Array(this.size)];
    this.write_ = 0;
    this.wroteBlock = -1;
    this.chans = 1;
    this.out = [new Float32Array(QUANTUM), new Float32Array(QUANTUM)];
    ctx.delays.add(this);
  }
  // Reads first (so it can sit in a feedback loop), with at least one
  // quantum of delay; its input is written after the graph is pulled.
  process() {
    const d = this.delayTime.compute();
    const n = this.ctx.n;
    const sr = this.ctx.sampleRate;
    const outs = this.out.slice(0, this.chans);
    for (let c = 0; c < outs.length; c++) {
      const ring = this.ring[c];
      for (let k = 0; k < n; k++) {
        const ds = Math.max(QUANTUM, d[k] * sr);
        let p = this.write_ + k - ds;
        while (p < 0) p += this.size;
        const i = Math.floor(p);
        const frac = p - i;
        outs[c][k] = ring[i % this.size] * (1 - frac) + ring[(i + 1) % this.size] * frac;
      }
    }
    return { channels: outs };
  }
  write() {
    this.wroteBlock = this.ctx.block;
    const input = this.mixInput(0);
    const n = this.ctx.n;
    this.chans = input.channels.length;
    for (let c = 0; c < this.chans; c++) {
      const ring = this.ring[c];
      const x = input.channels[c];
      for (let k = 0; k < n; k++) ring[(this.write_ + k) % this.size] = x[k];
    }
    this.write_ = (this.write_ + n) % this.size;
  }
}

class Merger extends Node {
  constructor(ctx, n) {
    super(ctx, { inputs: n });
    this.out = Array.from({ length: n }, () => new Float32Array(QUANTUM));
  }
  process() {
    const n = this.ctx.n;
    const outs = this.out;
    for (let i = 0; i < outs.length; i++) {
      const input = this.mixInput(i, [new Float32Array(QUANTUM), new Float32Array(QUANTUM)]);
      const o = outs[i];
      if (input.channels.length === 1) o.set(input.channels[0].subarray(0, n));
      else for (let k = 0; k < n; k++) o[k] = 0.5 * (input.channels[0][k] + input.channels[1][k]);
    }
    return { channels: outs.slice(0, 2) };
  }
}

// DynamicsCompressor: the spec's static curve (threshold, knee, ratio),
// automatic makeup gain (1 / curve(1)) ^ 0.6, a 6 ms look-ahead, and a
// one-pole gain-reduction follower for attack and release.
class Compressor extends Node {
  constructor(ctx) {
    super(ctx);
    this.threshold = new Param(ctx, -24);
    this.knee = new Param(ctx, 30);
    this.ratio = new Param(ctx, 12);
    this.attack = new Param(ctx, 0.003);
    this.release = new Param(ctx, 0.25);
    this.reduction = 0;
    this.envelope = 0; // dB of reduction (≤ 0)
    this.look = Math.round(0.006 * ctx.sampleRate);
    this.ring = [new Float32Array(this.look + QUANTUM), new Float32Array(this.look + QUANTUM)];
    this.w = 0;
    this.out = [new Float32Array(QUANTUM), new Float32Array(QUANTUM)];
  }
  curveDb(xdB, T, K, R) {
    if (xdB <= T) return xdB;
    if (K > 0 && xdB < T + K) {
      // Quadratic knee from slope 1 to 1/R across [T, T + K].
      const u = xdB - T;
      return xdB + ((1 / R - 1) * u * u) / (2 * K);
    }
    const kneeEnd = T + K;
    const yKnee = K > 0 ? kneeEnd + ((1 / R - 1) * K) / 2 : T;
    return yKnee + (xdB - kneeEnd) / R;
  }
  makeup(T, K, R) {
    const y = this.curveDb(0, T, K, R);
    return 10 ** ((-y * 0.6) / 20);
  }
  process() {
    const input = this.mixInput(0);
    const n = this.ctx.n;
    const sr = this.ctx.sampleRate;
    const T = this.threshold.compute()[0];
    const K = this.knee.compute()[0];
    const R = Math.max(1, this.ratio.compute()[0]);
    const att = this.attack.compute()[0];
    const rel = this.release.compute()[0];
    const make = this.makeup(T, K, R);
    const ka = Math.exp(-1 / Math.max(1, att * sr));
    const kr = Math.exp(-1 / Math.max(1, rel * sr));
    const [L, Rr] = this.out;
    const xl = input.channels[0];
    const xr = input.channels[input.channels.length - 1];
    const size = this.ring[0].length;
    let maxRed = 0;
    for (let k = 0; k < n; k++) {
      const peak = Math.max(Math.abs(xl[k]), Math.abs(xr[k]));
      const xdB = peak > 1e-9 ? 20 * Math.log10(peak) : -180;
      const want = this.curveDb(xdB, T, K, R) - xdB; // ≤ 0
      const coeff = want < this.envelope ? ka : kr;
      this.envelope = want + (this.envelope - want) * coeff;
      maxRed = Math.min(maxRed, this.envelope);
      this.ring[0][this.w] = xl[k];
      this.ring[1][this.w] = xr[k];
      const r = (this.w - this.look + size) % size;
      const g = 10 ** (this.envelope / 20) * make;
      L[k] = this.ring[0][r] * g;
      Rr[k] = this.ring[1][r] * g;
      this.w = (this.w + 1) % size;
    }
    this.reduction = maxRed;
    return { channels: this.out };
  }
}

export const SIM = { QUANTUM };
