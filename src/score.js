// The score: quiet, sparse, generative music under the sea and wind. One
// tonal centre (D) whose mode shifts with the light and weather: lydian and
// open at noon, mixolydian and warm at golden hour, ionian at dawn, dorian
// under grey skies and rain, a slow aeolian hush at night, almost nothing in a
// storm, and silence while the cat sleeps. A seeded random walk picks chords
// and notes beat by beat, so it never loops audibly; the composer is pure
// (no audio), and `createScore` turns its events into short-lived voices.

export const MODES = {
  noon: { scale: [0, 2, 4, 6, 7, 9, 11], beat: 1.55, density: 0.3, register: [62, 86], pad: 48, level: 1, chords: [0, 1, 4, 5, 3] },
  golden: { scale: [0, 2, 4, 5, 7, 9, 10], beat: 1.8, density: 0.28, register: [57, 81], pad: 48, level: 1, chords: [0, 6, 3, 4, 5] },
  dawn: { scale: [0, 2, 4, 5, 7, 9, 11], beat: 1.9, density: 0.22, register: [60, 84], pad: 48, level: 0.85, chords: [0, 3, 5, 4] },
  grey: { scale: [0, 2, 3, 5, 7, 9, 10], beat: 2.1, density: 0.18, register: [57, 79], pad: 36, level: 0.75, chords: [0, 3, 6, 4] },
  rain: { scale: [0, 2, 3, 5, 7, 9, 10], beat: 2.2, density: 0.2, register: [62, 84], pad: 36, level: 0.7, chords: [0, 3, 6, 2] },
  night: { scale: [0, 2, 3, 5, 7, 8, 10], beat: 2.7, density: 0.13, register: [55, 77], pad: 36, level: 0.7, chords: [0, 5, 3, 6] },
  storm: { scale: [0, 1, 3, 5, 7, 8, 10], beat: 3.4, density: 0.035, register: [50, 69], pad: 36, level: 0.4, chords: [0, 5] },
  sleep: { scale: [0, 2, 3, 5, 7, 8, 10], beat: 3, density: 0, register: [50, 70], pad: 36, level: 0, chords: [0] },
};
export const ROOT = 2; // D
const PAD_LEVEL = 0.026;
const PLUCK_LEVEL = 0.04;

// Which mode the moment calls for. `sunAltitude` in degrees, `sunAzimuth`
// clockwise from north (afternoon > 180), cover 0…1, rain mm/h.
export function moodFor({ sunAltitude = 30, sunAzimuth = 0, cover = 0, rain = 0, asleep = false } = {}) {
  if (asleep) return "sleep";
  if (rain >= 5) return "storm";
  if (rain > 0.5) return "rain";
  if (sunAltitude < -6) return "night";
  if (cover > 0.85) return "grey";
  if (sunAltitude < 12) return sunAzimuth > 180 ? "golden" : "dawn";
  return "noon";
}

function rng(seed) {
  let s = seed >>> 0 || 0x9e3779b9;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

// Pure and deterministic: the same seed and the same sequence of moods give
// the same events. step(mood, swell) returns this beat's events:
//   { type: "pad", notes: [midi], beats } a chord held over `beats` beats;
//   { type: "pluck", midi, velocity, offset } offset in beats (0…1).
// and `beat`, this beat's length in seconds.
export function createComposer(seed = 1) {
  const random = rng(seed * 2654435761);
  let mood = null;
  let chord = 0;
  let chordLeft = 0;
  let melody = 3;
  let rest = 0;

  const pick = (list) => list[Math.floor(random() * list.length) % list.length];

  return {
    get mood() {
      return mood;
    },
    step(next, swell = 0) {
      const mode = MODES[next] ?? MODES.noon;
      const events = [];
      const beat = mode.beat * (0.92 + random() * 0.16);
      if (next !== mood) {
        mood = next;
        chordLeft = 0;
      }
      if (mode.density <= 0) return { beat, events };
      const scale = mode.scale;
      // A chord: a random walk over the mode's favoured degrees.
      if (chordLeft <= 0) {
        const choices = mode.chords.filter((d) => d !== chord);
        chord = choices.length ? pick(choices) : mode.chords[0];
        chordLeft = 8 + Math.floor(random() * 7);
        // Root, fifth, and a third or ninth: open voicings, low and soft.
        const degree = (i) => {
          const octave = Math.floor(i / scale.length);
          return mode.pad + ROOT + scale[i % scale.length] + 12 * octave;
        };
        const notes = [degree(chord), degree(chord + 4)];
        if (random() < 0.7) notes.push(degree(chord + (random() < 0.5 ? 2 : 8)));
        if (next === "storm") notes.length = 1;
        events.push({ type: "pad", notes, beats: chordLeft + 3 });
      }
      chordLeft--;
      // Plucks: a wandering line, leaning on the chord's tones, with breaths
      // of silence between phrases.
      if (rest > 0) {
        rest--;
        return { beat, events };
      }
      const density = Math.min(0.85, mode.density * (1 + swell * 1.5));
      if (random() < density) {
        const leap = random();
        melody += leap < 0.45 ? (random() < 0.5 ? -1 : 1) : leap < 0.8 ? (random() < 0.5 ? -2 : 2) : random() < 0.5 ? -4 : 3;
        // Pull toward a chord tone now and then.
        if (random() < 0.35) melody = chord + 7 * Math.round((melody - chord) / 7) + pick([0, 2, 4]);
        let midi = noteAt(scale, melody);
        while (midi < mode.register[0]) {
          melody += 7;
          midi = noteAt(scale, melody);
        }
        while (midi > mode.register[1]) {
          melody -= 7;
          midi = noteAt(scale, melody);
        }
        const velocity = 0.45 + random() * 0.4;
        events.push({ type: "pluck", midi, velocity, offset: random() < 0.3 ? 0.5 : 0 });
        // Sometimes a second note answers within the beat.
        if (random() < 0.18 + swell * 0.3) {
          const answer = noteAt(scale, melody + pick([-2, 2, 4, -3]));
          if (answer >= mode.register[0] - 5 && answer <= mode.register[1] + 5)
            events.push({ type: "pluck", midi: answer, velocity: velocity * 0.7, offset: 0.5 + random() * 0.4 });
        }
        if (random() < 0.12) rest = 2 + Math.floor(random() * 4);
      }
      return { beat, events };
    },
  };
}

// Scale index (any integer) → MIDI note, around D4.
function noteAt(scale, index) {
  const n = scale.length;
  const octave = Math.floor(index / n);
  return 60 + ROOT + scale[((index % n) + n) % n] + 12 * octave;
}

export const midiToHz = (midi) => 440 * 2 ** ((midi - 69) / 12);

// Whether a MIDI note belongs to a mode (relative to D).
export function inMode(midi, mood) {
  const scale = MODES[mood]?.scale ?? [];
  return scale.includes((((midi - ROOT) % 12) + 12) % 12);
}

// ---------------------------------------------------------------------------
// The ceremonies: when a gift wakes, the score swells into a phrase of its
// own over a held chord, all on D. Each is a few notes in the mode that
// suits the gift (`mode`); the finale gathers them up. Pure data:
// ceremonyEvents(gift) → { length, pads: [{ notes, at, length }],
// plucks: [{ midi, at, velocity }] }, seconds from the start of the dive
// (the phrase lands as the gift wakes, about two seconds in).
export const CEREMONIES = {
  // Lydian, high and quick: lights let go into the air.
  fireflies: { mode: "noon", beat: 0.26, chord: [50, 57, 64, 66], phrase: [74, 76, 78, 81, 0, 83, 86, 0, 0, 90, 88, 86] },
  // Dorian, rising and falling like a wave coming in.
  tideglow: { mode: "grey", beat: 0.38, chord: [50, 57, 65], phrase: [69, 72, 74, 77, 0, 76, 74, 0, 72, 74, 0, 0, 69] },
  // Mixolydian, warm and steady: a lamp brought up to full.
  lamp: { mode: "golden", beat: 0.44, chord: [50, 57, 66, 72], phrase: [62, 66, 69, 0, 72, 0, 74, 0, 0, 78, 74] },
  // Lydian, wide and slow: the sky leaning close.
  stars: { mode: "noon", beat: 0.62, chord: [50, 57, 64, 68], phrase: [86, 0, 81, 0, 88, 0, 93, 0, 0, 92, 88] },
  // Aeolian, low: a call and its answer from the water.
  seafolk: { mode: "night", beat: 0.42, chord: [38, 50, 57, 65], phrase: [62, 65, 69, 0, 67, 65, 0, 0, 62, 65, 62] },
  // Ionian, lilting: a boat on a swell.
  boat: { mode: "dawn", beat: 0.34, chord: [50, 57, 66], phrase: [66, 69, 71, 74, 0, 71, 69, 0, 66, 69, 0, 74] },
  // Everything at once, then home.
  finale: { mode: "noon", beat: 0.4, chord: [38, 50, 57, 64, 66, 69], phrase: [74, 78, 81, 86, 0, 88, 93, 0, 90, 88, 86, 0, 81, 0, 78, 81, 0, 74, 0, 0, 76, 74] },
};

export function ceremonyEvents(gift) {
  const motif = CEREMONIES[gift];
  if (!motif) return null;
  const lead = gift === "finale" ? 2.8 : 1.8;
  const plucks = [];
  motif.phrase.forEach((midi, i) => {
    if (!midi) return;
    // A little rubato: the first notes lean in, the last are let go.
    const at = lead + i * motif.beat + (i === motif.phrase.length - 1 ? motif.beat * 0.4 : 0);
    plucks.push({ midi, at, velocity: 0.75 + 0.25 * Math.sin((i / motif.phrase.length) * Math.PI) });
    // The finale's echoes, an octave down.
    if (gift === "finale" && i % 3 === 0) plucks.push({ midi: midi - 12, at: at + motif.beat * 0.5, velocity: 0.5 });
  });
  const end = lead + motif.phrase.length * motif.beat;
  const pads = [{ notes: motif.chord, at: 0.2, length: end + 1.5 }];
  if (gift === "finale") pads.push({ notes: [45, 52, 61, 64], at: end + 0.5, length: 5 }, { notes: [38, 50, 57, 66], at: end + 4.5, length: 7 });
  return { length: (gift === "finale" ? end + 12 : end + 4), pads, plucks };
}

// ---------------------------------------------------------------------------
// Audio. A small feedback-delay network reverb (eight lines through a
// Householder mix, damped in the loop): all the space the score needs.
export function createReverb(ctx, { seconds = 4.5, damping = 3200, predelay = 0.025 } = {}) {
  const input = ctx.createGain();
  const output = ctx.createGain();
  output.gain.value = 1;
  const pre = ctx.createDelay(0.2);
  pre.delayTime.value = predelay;
  input.connect(pre);
  const lengths = [0.0437, 0.0511, 0.0593, 0.0673, 0.0761, 0.0839, 0.0929, 0.1013];
  const mix = ctx.createGain();
  mix.gain.value = -2 / lengths.length;
  const merger = ctx.createChannelMerger(2);
  const lines = lengths.map((length, i) => {
    const sum = ctx.createGain();
    const delay = ctx.createDelay(0.2);
    delay.delayTime.value = length;
    const damp = ctx.createBiquadFilter();
    damp.type = "lowpass";
    damp.frequency.value = damping;
    // WebAudio's low-pass Q is in dB: anything above about −3 dB peaks
    // over unity at the corner and the loop would grow. −6 dB never does.
    damp.Q.value = -6;
    const feedback = ctx.createGain();
    // Each line loses 60 dB over `seconds`, whatever its length.
    feedback.gain.value = 10 ** ((-3 * length) / seconds);
    pre.connect(sum);
    sum.connect(delay).connect(damp).connect(feedback);
    feedback.connect(sum);
    feedback.connect(mix);
    feedback.connect(merger, 0, i % 2);
    return { sum, delay, damp, feedback };
  });
  for (const line of lines) mix.connect(line.sum);
  // The wet tail is quieter than the sum of eight lines.
  const trim = ctx.createGain();
  trim.gain.value = 0.35;
  merger.connect(trim).connect(output);
  return {
    input,
    output,
    dispose() {
      for (const node of [input, pre, mix, merger, trim, output, ...lines.flatMap((l) => [l.sum, l.delay, l.damp, l.feedback])]) node.disconnect();
    },
  };
}

// A held chord: two soft oscillators per note through a dark low-pass,
// breathing in over seconds and out over more. Released on its own.
function pad(ctx, out, send, notes, t, duration, level) {
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.Q.value = 0.4;
  filter.frequency.setValueAtTime(380, t);
  filter.frequency.linearRampToValueAtTime(900, t + duration * 0.5);
  filter.frequency.linearRampToValueAtTime(420, t + duration + 5);
  const env = ctx.createGain();
  const attack = Math.min(4, duration * 0.4);
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(level, t + attack);
  env.gain.setValueAtTime(level, t + duration);
  env.gain.linearRampToValueAtTime(0, t + duration + 5);
  filter.connect(env);
  env.connect(out);
  if (send) env.connect(send);
  const end = t + duration + 5.1;
  const oscillators = [];
  notes.forEach((midi, i) => {
    const hz = midiToHz(midi);
    for (const [type, detune, gain] of [["triangle", -4, 0.6], ["sine", 5, 0.5]]) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = hz;
      osc.detune.value = detune + (i - 1) * 1.5;
      const g = ctx.createGain();
      g.gain.value = gain / notes.length;
      osc.connect(g).connect(filter);
      osc.start(t);
      osc.stop(end);
      oscillators.push(osc);
    }
  });
  oscillators[0].onended = () => {
    filter.disconnect();
    env.disconnect();
  };
}

// A plucked note: a kalimba-like tine (fundamental, a soft octave and a
// faint inharmonic overtone, each dying at its own rate).
export function pluck(ctx, out, send, midi, t, velocity, { decay = 1.4, bright = 1 } = {}) {
  const hz = midiToHz(midi);
  const env = ctx.createGain();
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = Math.min(9000, hz * 5 * bright);
  filter.Q.value = 0.3;
  env.connect(filter);
  filter.connect(out);
  if (send) filter.connect(send);
  env.gain.value = velocity;
  const end = t + decay * 4.6 + 0.05;
  const partials = [
    [1, "triangle", 1, decay],
    [2, "sine", 0.28, decay * 0.45],
    [5.43, "sine", 0.05, decay * 0.12],
  ];
  let first = null;
  for (const [ratio, type, gain, tau] of partials) {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = hz * ratio;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.006);
    g.gain.setTargetAtTime(0, t + 0.006, tau);
    osc.connect(g).connect(env);
    osc.start(t);
    osc.stop(end);
    first ??= osc;
  }
  first.onended = () => {
    env.disconnect();
    filter.disconnect();
  };
}

// The score's player: look-ahead scheduling from the composer into voices.
// `out` is the music bus; `send` its reverb send.
export function createScore(ctx, { out, send, seed = 1 } = {}) {
  const composer = createComposer(seed);
  let nextBeat = 0;
  let mood = "noon";
  let pending = mood;
  let pendingSince = 0;
  let swell = 0;
  let swellAt = -Infinity;
  let hushUntil = -Infinity;
  const level = ctx.createGain();
  level.gain.value = 0;
  level.connect(out);
  const sendLevel = ctx.createGain();
  sendLevel.gain.value = 0;
  level.connect(sendLevel);
  sendLevel.connect(send);
  // Voices play into `level` (the mood's loudness), which feeds both the
  // dry bus and the reverb send, so a hush silences the tail as well.
  let target = -1;
  return {
    get mood() {
      return mood;
    },
    // Swell a little for ~20 s (a discovery, a sky event in view).
    swell(amount = 1, now = ctx.currentTime) {
      swell = Math.max(swell, amount);
      swellAt = now;
    },
    // A gift waking: its own phrase over a held chord (CEREMONIES), the
    // wandering line hushed while it plays, then a swell.
    ceremony(gift, now = ctx.currentTime) {
      const events = ceremonyEvents(gift);
      if (!events) return 0;
      const t = now + 0.05;
      for (const p of events.pads) pad(ctx, level, null, p.notes, t + p.at, p.length, PAD_LEVEL * 2);
      for (const p of events.plucks) pluck(ctx, level, null, p.midi, t + p.at, PLUCK_LEVEL * 2.2 * p.velocity, { decay: 2.2, bright: 1.1 });
      hushUntil = t + events.length;
      swell = Math.max(swell, 1);
      swellAt = t + events.length * 0.5;
      return events.length;
    },
    // Called often (each frame is fine): schedules up to `ahead` seconds.
    update(next, now = ctx.currentTime, ahead = 0.5) {
      // A mood must hold a few seconds before the music follows (scrubbing
      // the time slider should not whip it through every mode).
      if (next !== pending) {
        pending = next;
        pendingSince = now;
      }
      if (pending !== mood && (now - pendingSince > 3 || pending === "sleep")) mood = pending;
      const fade = Math.max(0, 1 - (now - swellAt) / 20);
      const lift = swell * fade;
      if (fade === 0) swell = 0;
      const want = (MODES[mood]?.level ?? 1) * (1 + lift * 0.35);
      if (Math.abs(want - target) > 0.01) {
        target = want;
        level.gain.setTargetAtTime(want, now, mood === "sleep" ? 1.5 : 3);
        sendLevel.gain.setTargetAtTime(0.55 + lift * 0.2, now, 2);
      }
      if (nextBeat < now) nextBeat = now + 0.05;
      while (nextBeat < now + ahead) {
        const { beat, events } = composer.step(mood, lift);
        for (const e of events) {
          // A ceremony's phrase has the stage to itself.
          if (nextBeat < hushUntil) continue;
          if (e.type === "pad") pad(ctx, level, null, e.notes, nextBeat, e.beats * beat, PAD_LEVEL);
          else pluck(ctx, level, null, e.midi, nextBeat + e.offset * beat, PLUCK_LEVEL * e.velocity, { bright: mood === "night" ? 0.6 : 1 });
        }
        nextBeat += beat;
      }
    },
    dispose() {
      level.disconnect();
      sendLevel.disconnect();
    },
  };
}
