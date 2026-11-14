// Measurements on rendered audio (Float32Array channels), for the sound
// tests and the evidence script: loudness (ITU-R BS.1770-4, K-weighted,
// gated), true peak (4x oversampled), spectrum (centroid, 85 % roll-off,
// peaks), envelope (attack, T60), clicks (largest sample step) and DC.

export const db = (x) => (x > 0 ? 20 * Math.log10(x) : -Infinity);

// K-weighting: the spec's two biquads, designed for any sample rate.
function kFilters(sr) {
  // Stage 1: high shelf, +4 dB above ~1.5 kHz (head effect).
  const f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196;
  let K = Math.tan((Math.PI * f0) / sr);
  const Vh = 10 ** (G / 20), Vb = Vh ** 0.4996667741545416;
  let a0 = 1 + K / Q + K * K;
  const shelf = {
    b: [(Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0],
    a: [(2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0],
  };
  // Stage 2: high pass at ~38 Hz.
  const f1 = 38.13547087602444, Q1 = 0.5003270373238773;
  K = Math.tan((Math.PI * f1) / sr);
  a0 = 1 + K / Q1 + K * K;
  const hp = { b: [1, -2, 1], a: [(2 * (K * K - 1)) / a0, (1 - K / Q1 + K * K) / a0] };
  return [shelf, hp];
}

function biquad(x, { b, a }) {
  const y = new Float64Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b[0] * x[i] + b[1] * x1 + b[2] * x2 - a[0] * y1 - a[1] * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v;
    y[i] = v;
  }
  return y;
}

function kWeighted(channels, sr) {
  const [s, h] = kFilters(sr);
  return channels.map((c) => biquad(biquad(c, s), h));
}

// Mean-square power of K-weighted blocks of `window` s every `hop` s.
function blockPowers(channels, sr, window, hop) {
  const k = kWeighted(channels, sr);
  const n = Math.round(window * sr);
  const step = Math.round(hop * sr);
  const out = [];
  for (let start = 0; start + n <= k[0].length; start += step) {
    let sum = 0;
    for (const c of k) {
      let s = 0;
      for (let i = start; i < start + n; i++) s += c[i] * c[i];
      sum += s / n;
    }
    out.push(sum);
  }
  return out;
}

const lufsOf = (power) => (power > 0 ? -0.691 + 10 * Math.log10(power) : -Infinity);

// Integrated loudness (LUFS): 400 ms blocks, 75 % overlap, absolute gate
// −70 LUFS, relative gate −10 LU.
export function integratedLoudness(channels, sr) {
  const powers = blockPowers(channels, sr, 0.4, 0.1);
  if (!powers.length) return lufsOf(meanSquare(channels));
  const abs = powers.filter((p) => lufsOf(p) > -70);
  if (!abs.length) return -Infinity;
  const gate = lufsOf(abs.reduce((a, b) => a + b, 0) / abs.length) - 10;
  const rel = abs.filter((p) => lufsOf(p) > gate);
  return lufsOf(rel.reduce((a, b) => a + b, 0) / rel.length);
}

function meanSquare(channels) {
  const k = channels;
  let sum = 0;
  for (const c of k) {
    let s = 0;
    for (const v of c) s += v * v;
    sum += s / Math.max(1, c.length);
  }
  return sum;
}

// Short-term loudness (3 s windows), one value per `hop` s.
export function shortTermCurve(channels, sr, hop = 0.5) {
  return blockPowers(channels, sr, 3, hop).map(lufsOf);
}
// Momentary loudness (400 ms windows), one value per `hop` s.
export function momentaryCurve(channels, sr, hop = 0.1) {
  return blockPowers(channels, sr, 0.4, hop).map(lufsOf);
}
// Loudness of a short sound: the loudest 400 ms window (LUFS).
export function maxMomentary(channels, sr) {
  const powers = blockPowers(channels, sr, 0.4, 0.05);
  if (!powers.length) return lufsOf(meanSquare(kWeighted(channels, sr)));
  return lufsOf(Math.max(...powers));
}

export function samplePeak(channels) {
  let m = 0;
  for (const c of channels) for (const v of c) m = Math.max(m, Math.abs(v));
  return m;
}

// True peak: 4x oversampling through a windowed-sinc interpolator.
export function truePeak(channels) {
  const taps = 12;
  const kernels = [1, 2, 3].map((phase) => {
    const k = [];
    for (let j = -taps; j < taps; j++) {
      const x = j + 1 - phase / 4;
      const sinc = Math.abs(x) < 1e-9 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
      const w = 0.5 + 0.5 * Math.cos((Math.PI * x) / (taps + 1));
      k.push(sinc * w);
    }
    return k;
  });
  let m = samplePeak(channels);
  for (const c of channels) {
    for (let i = taps; i < c.length - taps; i++) {
      if (Math.abs(c[i]) < m * 0.5) continue;
      for (const k of kernels) {
        let s = 0;
        for (let j = 0; j < k.length; j++) s += c[i - taps + j] * k[j];
        m = Math.max(m, Math.abs(s));
      }
    }
  }
  return m;
}

// The largest sample-to-sample step in either channel (a click shows here).
export function maxStep(channels) {
  let m = 0;
  for (const c of channels) for (let i = 1; i < c.length; i++) m = Math.max(m, Math.abs(c[i] - c[i - 1]));
  return m;
}

export function dcOffset(channels) {
  let worst = 0;
  for (const c of channels) {
    let s = 0;
    for (const v of c) s += v;
    worst = Math.max(worst, Math.abs(s / c.length));
  }
  return worst;
}

export function mono(channels) {
  const out = new Float32Array(channels[0].length);
  for (const c of channels) for (let i = 0; i < out.length; i++) out[i] += c[i] / channels.length;
  return out;
}

// In-place radix-2 FFT on (re, im).
export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

// Power spectrum averaged over Hann frames whose level is within 40 dB of
// the loudest frame (so silence around a one-shot does not dilute it).
export function spectrum(signal, sr, size = 2048) {
  const hop = size / 2;
  const win = Float64Array.from({ length: size }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size));
  const frames = [];
  for (let start = 0; start + size <= signal.length; start += hop) {
    const re = new Float64Array(size), im = new Float64Array(size);
    let e = 0;
    for (let i = 0; i < size; i++) {
      re[i] = signal[start + i] * win[i];
      e += re[i] * re[i];
    }
    frames.push({ start, e, re, im });
  }
  if (!frames.length) {
    const re = new Float64Array(size), im = new Float64Array(size);
    for (let i = 0; i < Math.min(size, signal.length); i++) re[i] = signal[i] * win[i];
    frames.push({ e: 1, re, im });
  }
  const top = Math.max(...frames.map((f) => f.e));
  const power = new Float64Array(size / 2);
  let used = 0;
  for (const f of frames) {
    if (f.e < top * 1e-4) continue;
    fft(f.re, f.im);
    for (let k = 0; k < size / 2; k++) power[k] += f.re[k] * f.re[k] + f.im[k] * f.im[k];
    used++;
  }
  for (let k = 0; k < power.length; k++) power[k] /= Math.max(1, used);
  return { power, binHz: sr / size };
}

export function centroid({ power, binHz }, from = 20) {
  let a = 0, b = 0;
  for (let k = Math.ceil(from / binHz); k < power.length; k++) {
    a += k * binHz * power[k];
    b += power[k];
  }
  return b > 0 ? a / b : 0;
}

export function rolloff({ power, binHz }, share = 0.85) {
  const total = power.reduce((s, p) => s + p, 0);
  let acc = 0;
  for (let k = 0; k < power.length; k++) {
    acc += power[k];
    if (acc >= total * share) return k * binHz;
  }
  return power.length * binHz;
}

// Local maxima of the spectrum, strongest first: [{ hz, db }].
export function peaks({ power, binHz }, { count = 8, min = 20 } = {}) {
  const out = [];
  for (let k = Math.max(2, Math.ceil(min / binHz)); k < power.length - 2; k++) {
    const p = power[k];
    if (p > power[k - 1] && p >= power[k + 1] && p > power[k - 2] && p >= power[k + 2]) {
      // Parabolic interpolation on the log magnitude.
      const a = Math.log(power[k - 1] + 1e-30), b = Math.log(p + 1e-30), c = Math.log(power[k + 1] + 1e-30);
      const shift = (0.5 * (a - c)) / (a - 2 * b + c || 1);
      out.push({ hz: (k + shift) * binHz, db: 10 * Math.log10(p + 1e-30) });
    }
  }
  out.sort((x, y) => y.db - x.db);
  return out.slice(0, count);
}

// RMS envelope in `window` s steps (dB), from the mono sum.
export function envelope(signal, sr, window = 0.005) {
  const n = Math.max(1, Math.round(window * sr));
  const out = [];
  for (let i = 0; i + n <= signal.length; i += n) {
    let s = 0;
    for (let j = i; j < i + n; j++) s += signal[j] * signal[j];
    out.push(Math.sqrt(s / n));
  }
  return { values: out, step: n / sr };
}

// Attack: time from 10 % to 90 % of the envelope's peak (s), measured on a
// 1 ms envelope.
export function attackTime(signal, sr) {
  const { values, step } = envelope(signal, sr, 0.001);
  const peak = Math.max(...values);
  const i10 = values.findIndex((v) => v >= peak * 0.1);
  const i90 = values.findIndex((v) => v >= peak * 0.9);
  return Math.max(0, (i90 - i10) * step);
}

// T60 from a line fitted to the log envelope between −5 and −35 dB below
// its peak (after the peak), extrapolated to 60 dB.
export function decayT60(signal, sr) {
  const { values, step } = envelope(signal, sr, 0.005);
  const dbv = values.map((v) => db(v));
  const top = Math.max(...dbv);
  const ip = dbv.indexOf(top);
  const pts = [];
  for (let i = ip; i < dbv.length; i++) {
    const d = top - dbv[i];
    if (d >= 5 && d <= 35) pts.push([i * step, dbv[i]]);
    if (d > 40) break;
  }
  if (pts.length < 3) return 0;
  const mx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const my = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  let num = 0, den = 0;
  for (const [x, y] of pts) {
    num += (x - mx) * (y - my);
    den += (x - mx) ** 2;
  }
  const slope = num / (den || 1);
  return slope < 0 ? -60 / slope : Infinity;
}

// Duration above −50 dB re the envelope's peak (s): the audible length.
export function audibleLength(signal, sr) {
  const { values, step } = envelope(signal, sr, 0.005);
  const peak = Math.max(...values);
  let last = 0;
  values.forEach((v, i) => {
    if (v > peak * 10 ** (-50 / 20)) last = i;
  });
  return (last + 1) * step;
}

// Inter-channel level difference L − R (dB).
export function channelBalance([L, R]) {
  let a = 0, b = 0;
  for (let i = 0; i < L.length; i++) {
    a += L[i] * L[i];
    b += R[i] * R[i];
  }
  return 10 * Math.log10((a + 1e-30) / (b + 1e-30));
}

// Energy (dB) in a band, from a spectrum.
export function bandLevel({ power, binHz }, lo, hi) {
  let s = 0;
  for (let k = Math.ceil(lo / binHz); k <= Math.min(power.length - 1, Math.floor(hi / binHz)); k++) s += power[k];
  return 10 * Math.log10(s + 1e-30);
}

// Onset times (s) where the 5 ms envelope jumps by `rise` dB over its
// level 20 ms before and is above `floor` dB.
export function onsets(signal, sr, { rise = 12, floor = -70 } = {}) {
  const { values, step } = envelope(signal, sr, 0.005);
  const out = [];
  let last = -1;
  for (let i = 4; i < values.length; i++) {
    const now = db(values[i]);
    const before = db(Math.max(1e-9, values[i - 4]));
    if (now > floor && now - before > rise && i - last > 10) {
      out.push(i * step);
      last = i;
    }
  }
  return out;
}
