// One-shots other modules trigger by name (sound.play(name, options)): a
// discovery's chime, thunder, and the Cape's larger animals. Synthesized:
// noise through moving filters for breath, water and weather; buzzy
// oscillators through formants for voices. Each call builds its own short
// chain and lets it go when it ends. Common options:
//   distance (metres; quieter, duller and wetter far off; thunder is also
//   delayed by the speed of sound), pan (−1…1), gain (× the call's level).

const SPEED_OF_SOUND = 343;

// Every call's typical distance (metres) when none is given.
const NEAR = { discover: 0, thunder: 3000, "penguin-bray": 25, "seal-bark": 25, "whale-blow": 90, owl: 25, "splash-big": 25, wisp: 4 };
// Calls heard the same wherever they come from (music-like, not of the place).
const EVERYWHERE = new Set(["discover", "thunder"]);
// Which bus each call plays on (src/sound/mix.js).
export const CALL_BUS = { discover: "magic", wisp: "magic", thunder: "weather" };
// Seeded when the sound engine passes `io.random` (repeatable renders).
let random = Math.random;

export const CALLS = Object.keys(NEAR);

export function playCall(io, name, options = {}) {
  const make = SYNTHS[name];
  if (!make || !io?.ctx) return false;
  random = io.random ?? Math.random;
  const ctx = io.ctx;
  const distance = Math.max(0, Number.isFinite(options.distance) ? options.distance : NEAR[name]);
  const delay = name === "thunder" ? Math.min(20, distance / SPEED_OF_SOUND) : 0;
  const t = ctx.currentTime + 0.02 + delay + (options.delay ?? 0);
  const chain = outChain(io, {
    t,
    pan: Math.max(-1, Math.min(1, options.pan ?? 0)),
    // Inverse distance past a reference, gentler than 1/r so far calls
    // stay audible. The wisp is silent beyond 25 m: a reply you cannot
    // see is confusing.
    // `placed` ({ gain, cutoff, sendA }) replaces this law: the animals'
    // own, steeper one (src/sound/fauna.js).
    gain: (options.gain ?? 1) * (options.placed ? options.placed.gain : (EVERYWHERE.has(name) ? 1 : Math.min(1, (NEAR[name] / Math.max(1, distance)) ** 0.8)) * (name === "wisp" ? Math.max(0, 1 - Math.max(0, distance - 15) / 10) : 1)),
    // Air takes the highs first.
    cutoff: options.placed ? options.placed.cutoff : name === "discover" ? 18000 : Math.max(500, 16000 * Math.exp(-distance / 450)),
    reverb: options.placed ? options.placed.sendA : name === "discover" || name === "wisp" ? 0.4 : Math.min(0.5, 0.05 + distance / 300),
  });
  const length = make(io, chain.input, t, distance, options);
  chain.release(t + length + 0.3);
  return true;
}

// pan, distance filter, level and reverb send for one call.
function outChain(io, { t, pan, gain, cutoff, reverb }) {
  const { ctx } = io;
  const input = ctx.createGain();
  input.gain.value = gain;
  const air = ctx.createBiquadFilter();
  air.type = "lowpass";
  air.frequency.value = cutoff;
  air.Q.value = 0.5;
  const panner = ctx.createStereoPanner();
  panner.pan.value = pan;
  input.connect(air).connect(panner).connect(io.out);
  let send = null;
  if (io.reverb && reverb > 0) {
    send = ctx.createGain();
    send.gain.value = reverb;
    panner.connect(send).connect(io.reverb);
  }
  return {
    input,
    release(end) {
      // A silent source scheduled to end then tidies the chain away.
      const clock = ctx.createConstantSource();
      clock.offset.value = 0;
      clock.connect(input);
      clock.start(t);
      clock.stop(end);
      clock.onended = () => [clock, input, air, panner, send].forEach((n) => n?.disconnect());
    },
  };
}

function noise(io, buffer, t, length) {
  const source = io.ctx.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  source.start(t, random() * 1.8);
  source.stop(t + length + 0.05);
  return source;
}

// A filtered noise burst: attack, then an exponential tail.
function burst(io, out, { buffer, t, type = "bandpass", frequency, to = null, q = 1, gain, attack = 0.01, length }) {
  const { ctx } = io;
  const source = noise(io, buffer, t, attack + length);
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.setValueAtTime(frequency, t);
  if (to) filter.frequency.exponentialRampToValueAtTime(to, t + attack + length);
  filter.Q.value = q;
  const env = ctx.createGain();
  env.gain.value = 0;
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(gain, t + attack);
  env.gain.exponentialRampToValueAtTime(0.0003, t + attack + length);
  source.connect(filter).connect(env).connect(out);
  source.onended = () => [source, filter, env].forEach((n) => n.disconnect());
}

// A voiced call: a buzzy source with roughness through formant filters.
// contour: [[0…1, Hz]...]; formants: [[Hz, Q, gain]...].
function voiced(io, out, { t, length, contour, formants, gain, rough = 0, roughRate = 35, vibrato = 0, breath = 0.15, attack = 0.02, release = 0.08, type = "sawtooth" }) {
  const { ctx } = io;
  const osc = ctx.createOscillator();
  osc.type = type;
  contour.forEach(([at, hz], i) => (i === 0 ? osc.frequency.setValueAtTime(hz, t) : osc.frequency.exponentialRampToValueAtTime(hz, t + at * length)));
  const end = t + length + release + 0.05;
  const nodes = [osc];
  if (vibrato) {
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 5 + random() * 2;
    const depth = ctx.createGain();
    depth.gain.value = vibrato;
    lfo.connect(depth).connect(osc.frequency);
    lfo.start(t);
    lfo.stop(end);
    nodes.push(lfo, depth);
  }
  const env = ctx.createGain();
  env.gain.value = 0;
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(gain, t + attack);
  env.gain.setValueAtTime(gain, t + Math.max(attack, length - release));
  env.gain.exponentialRampToValueAtTime(0.0003, t + length + release);
  // Roughness: the voice's amplitude flutters, as a rasping throat does.
  let source = osc;
  if (rough) {
    const am = ctx.createGain();
    am.gain.value = 1 - rough / 2;
    const lfo = ctx.createOscillator();
    lfo.type = "square";
    lfo.frequency.value = roughRate;
    const depth = ctx.createGain();
    depth.gain.value = rough / 2;
    lfo.connect(depth).connect(am.gain);
    lfo.start(t);
    lfo.stop(end);
    osc.connect(am);
    source = am;
    nodes.push(am, lfo, depth);
  }
  for (const [hz, q, g] of formants) {
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = hz;
    f.Q.value = q;
    const level = ctx.createGain();
    level.gain.value = g;
    source.connect(f).connect(level).connect(env);
    nodes.push(f, level);
  }
  env.connect(out);
  nodes.push(env);
  osc.start(t);
  osc.stop(end);
  osc.onended = () => nodes.forEach((n) => n.disconnect());
  if (breath) burst(io, out, { buffer: io.pink, t, frequency: formants[0][0] * 2, q: 0.7, gain: gain * breath, attack: attack + 0.02, length: length * 0.9 });
}

function tone(io, out, { t, hz, to = null, length, gain, attack = 0.01, type = "sine" }) {
  const { ctx } = io;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(hz, t);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t + length);
  const env = ctx.createGain();
  env.gain.value = 0;
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(gain, t + attack);
  env.gain.exponentialRampToValueAtTime(0.0003, t + attack + length);
  osc.connect(env).connect(out);
  osc.start(t);
  osc.stop(t + attack + length + 0.05);
  osc.onended = () => [osc, env].forEach((n) => n.disconnect());
}

const rand = (a, b) => a + random() * (b - a);

const SYNTHS = {
  // The wisp answering a meow: three glassy notes skipping up (D, A, D,
  // high), quick and quiet, with a breath of air.
  wisp(io, out, t) {
    const notes = [86, 93, 98];
    notes.forEach((midi, i) => {
      const hz = 440 * 2 ** ((midi - 69) / 12);
      const at = t + i * 0.07 + rand(0, 0.015);
      tone(io, out, { t: at, hz, length: 0.55 - i * 0.1, gain: 0.045 * (1 - i * 0.15), attack: 0.004 });
      tone(io, out, { t: at, hz: hz * 2.01, length: 0.18, gain: 0.008, attack: 0.003 });
    });
    burst(io, out, { buffer: io.noise, t, type: "highpass", frequency: 6500, q: 0.4, gain: 0.012, attack: 0.03, length: 0.3 });
    return 0.9;
  },

  // A soft glass chime: three notes rising through the fifth, in every mode
  // the score uses (D, A, E). Returns its length in seconds.
  discover(io, out, t, _d, { notes = [74, 81, 88] } = {}) {
    notes.forEach((midi, i) => {
      const hz = 440 * 2 ** ((midi - 69) / 12);
      const at = t + i * 0.13;
      const g = 0.06 * (1 - i * 0.18);
      tone(io, out, { t: at, hz, length: 2.6, gain: g, attack: 0.008 });
      tone(io, out, { t: at, hz: hz * 2, length: 1.1, gain: g * 0.22, attack: 0.006 });
      tone(io, out, { t: at, hz: hz * 2.76, length: 0.35, gain: g * 0.08, attack: 0.004 });
    });
    return notes.length * 0.13 + 2.7;
  },

  // Thunder: near, a ripping crack and then rolls; far, only a low grumble.
  thunder(io, out, t, distance) {
    const near = Math.exp(-distance / 1200);
    const level = 0.3 / (1 + distance / 2500);
    const top = 120 + 3800 * Math.exp(-distance / 1400);
    if (near > 0.2) {
      burst(io, out, { buffer: io.noise, t, type: "highpass", frequency: 1200, q: 0.5, gain: level * near * 0.9, attack: 0.003, length: 0.35 });
      burst(io, out, { buffer: io.pink, t: t + 0.02, type: "lowpass", frequency: top, to: top * 0.4, q: 0.6, gain: level * near, attack: 0.01, length: 0.9 });
    }
    const rolls = 3 + Math.floor(random() * 4);
    let at = t + 0.1 + (1 - near) * 0.4;
    for (let i = 0; i < rolls; i++) {
      const g = level * (0.9 - i * 0.12) * rand(0.6, 1);
      burst(io, out, { buffer: io.brown, t: at, type: "lowpass", frequency: Math.min(top, rand(260, 520)), to: 70, q: 0.7, gain: g, attack: rand(0.08, 0.35), length: rand(1.2, 2.6) });
      at += rand(0.35, 1.1);
    }
    // The long low tail under it all.
    burst(io, out, { buffer: io.brown, t: t + 0.2, type: "lowpass", frequency: Math.min(top, 160), to: 45, q: 0.5, gain: level * 0.7, attack: 0.6, length: at - t + 2.5 });
    return at - t + 3.2;
  },

  // African penguin: the "jackass" display, a few hiccuping honks and then
  // a long donkey bray.
  "penguin-bray"(io, out, t) {
    const f0 = rand(270, 330);
    const formants = [[750, 4, 1.4], [1350, 5, 0.9], [2600, 6, 0.35]];
    let at = t;
    const honks = 3 + Math.floor(random() * 3);
    for (let i = 0; i < honks; i++) {
      // Alternating in-breath (higher, thinner) and out-breath honks.
      const inhale = i % 2 === 1;
      const length = inhale ? 0.1 : 0.17;
      const f = f0 * (inhale ? 1.35 : 1);
      voiced(io, out, { t: at, length, contour: [[0, f * 0.9], [0.4, f], [1, f * 0.82]], formants, gain: inhale ? 0.05 : 0.08, rough: 0.6, roughRate: 42, breath: inhale ? 0.5 : 0.2, attack: 0.015, release: 0.04 });
      at += length + rand(0.07, 0.13);
    }
    const length = rand(0.8, 1.1);
    voiced(io, out, { t: at + 0.05, length, contour: [[0, f0 * 0.85], [0.2, f0 * 1.12], [0.75, f0], [1, f0 * 0.7]], formants, gain: 0.1, rough: 0.55, roughRate: 38, vibrato: 6, breath: 0.2, attack: 0.04, release: 0.15 });
    return at - t + length + 0.4;
  },

  // Cape fur seal: gruff, bleating barks, two to four.
  "seal-bark"(io, out, t) {
    const f0 = rand(150, 210);
    const formants = [[520, 4, 1.5], [1150, 5, 0.8], [2300, 6, 0.3]];
    const barks = 2 + Math.floor(random() * 3);
    let at = t;
    for (let i = 0; i < barks; i++) {
      const length = rand(0.22, 0.34);
      voiced(io, out, { t: at, length, contour: [[0, f0 * 1.1], [0.25, f0 * 1.25], [1, f0 * 0.8]], formants, gain: 0.11 * (1 - i * 0.1), rough: 0.7, roughRate: 26, breath: 0.25, attack: 0.02, release: 0.06 });
      at += length + rand(0.2, 0.36);
    }
    return at - t + 0.3;
  },

  // A southern right whale's blow: a deep, wet exhale, then a short in-breath.
  "whale-blow"(io, out, t) {
    burst(io, out, { buffer: io.pink, t, type: "bandpass", frequency: 520, to: 210, q: 0.6, gain: 0.22, attack: 0.05, length: 1.7 });
    burst(io, out, { buffer: io.noise, t, type: "highpass", frequency: 1600, q: 0.4, gain: 0.06, attack: 0.04, length: 1.2 });
    burst(io, out, { buffer: io.brown, t, type: "lowpass", frequency: 180, to: 60, q: 0.7, gain: 0.25, attack: 0.03, length: 0.9 });
    burst(io, out, { buffer: io.pink, t: t + 2.1, type: "bandpass", frequency: 900, to: 1500, q: 0.8, gain: 0.05, attack: 0.2, length: 0.45 });
    return 2.9;
  },

  // Spotted eagle-owl: a soft "hoo, hooo", the second note lower and longer.
  owl(io, out, t) {
    const f = rand(330, 370);
    const formants = [[f * 1.05, 2, 1.6], [f * 2.1, 3, 0.15]];
    voiced(io, out, { t, length: 0.28, contour: [[0, f * 0.9], [0.3, f], [1, f * 0.97]], formants, gain: 0.018, type: "triangle", breath: 0.12, attack: 0.05, release: 0.08 });
    voiced(io, out, { t: t + 0.55, length: 0.62, contour: [[0, f * 0.84], [0.3, f * 0.92], [1, f * 0.8]], formants, gain: 0.02, type: "triangle", breath: 0.12, attack: 0.07, release: 0.2 });
    return 1.5;
  },

  // A heavy body into the sea: a thump, a crash of water, the wash, the
  // patter of what was thrown up coming back down.
  "splash-big"(io, out, t, _d, { size = 1 } = {}) {
    const s = Math.max(0.3, Math.min(2, size));
    tone(io, out, { t, hz: 70, to: 32, length: 0.35, gain: 0.25 * s, attack: 0.004 });
    burst(io, out, { buffer: io.brown, t, type: "lowpass", frequency: 900, to: 180, q: 0.7, gain: 0.3 * s, attack: 0.006, length: 0.55 });
    burst(io, out, { buffer: io.pink, t: t + 0.02, type: "bandpass", frequency: 1300, to: 600, q: 0.6, gain: 0.16 * s, attack: 0.02, length: 1.3 * s });
    burst(io, out, { buffer: io.noise, t: t + 0.05, type: "highpass", frequency: 2800, q: 0.5, gain: 0.05 * s, attack: 0.05, length: 0.9 * s });
    const drops = Math.round(10 * s);
    for (let i = 0; i < drops; i++)
      burst(io, out, { buffer: io.noise, t: t + rand(0.35, 1.8 * s), type: "bandpass", frequency: rand(1500, 5200), q: 9, gain: rand(0.03, 0.07), attack: 0.002, length: 0.03 });
    return 1.9 * s + 0.2;
  },
};
