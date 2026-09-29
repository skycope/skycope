// Every sound is synthesized with WebAudio (no recordings), like the scene:
// looping noise beds for sea, wind, leaves and rain, scheduled one-shots for
// breaking waves, gulls, crickets and thunder, and the cat's own paws, meows
// and purr. The context starts on the first user gesture (browser policy).

export function createSound() {
  let ctx = null;
  let master = null;
  let enabled = true;
  let beds = null;
  let purr = null;
  let nextWave = 0;
  let nextGull = 4;
  let nextCricket = 0;
  let nextThunder = 12;
  let nextDrip = 0;
  let nextPaddle = 0;
  let noise = null;
  let pink = null;
  let brown = null;
  const conditions = { sea: 0.5, seaPan: 0, wind: 0, rain: 0, night: 0, trees: 0, underwater: 0 };

  function start() {
    if (ctx) {
      if (ctx.state === "suspended") ctx.resume();
      return;
    }
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    ctx = new AudioContext();
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.ratio.value = 3;
    master = ctx.createGain();
    master.gain.value = enabled ? 0.9 : 0;
    master.connect(compressor).connect(ctx.destination);
    noise = noiseBuffer("white");
    pink = noiseBuffer("pink");
    brown = noiseBuffer("brown");
    beds = {
      sea: bed(brown, "lowpass", 480, 0.7),
      surf: bed(pink, "bandpass", 900, 0.6),
      wind: bed(pink, "bandpass", 520, 1.2),
      leaves: bed(noise, "highpass", 2600, 0.5),
      rain: bed(noise, "highpass", 1400, 0.4),
    };
    // Slow swells breathe through the sea bed.
    for (const [rate, depth] of [[0.09, 0.25], [0.037, 0.2]]) {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = rate;
      const amount = ctx.createGain();
      amount.gain.value = depth;
      lfo.connect(amount).connect(beds.sea.swell.gain);
      lfo.start();
    }
    const windLfo = ctx.createOscillator();
    windLfo.frequency.value = 0.13;
    const windDepth = ctx.createGain();
    windDepth.gain.value = 180;
    windLfo.connect(windDepth).connect(beds.wind.filter.frequency);
    windLfo.start();
    nextWave = ctx.currentTime + 1;
  }

  function noiseBuffer(colour) {
    const length = ctx.sampleRate * 3;
    const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const data = buffer.getChannelData(c);
      let b0 = 0, b1 = 0, b2 = 0, last = 0;
      for (let i = 0; i < length; i++) {
        const w = Math.random() * 2 - 1;
        if (colour === "white") data[i] = w * 0.5;
        else if (colour === "pink") {
          b0 = 0.997 * b0 + w * 0.029;
          b1 = 0.985 * b1 + w * 0.032;
          b2 = 0.95 * b2 + w * 0.048;
          data[i] = (b0 + b1 + b2 + w * 0.05) * 1.6;
        } else {
          last = (last + 0.02 * w) / 1.02;
          data[i] = last * 3.5;
        }
      }
      // Crossfade the loop seam.
      const fade = 2000;
      for (let i = 0; i < fade; i++) {
        const t = i / fade;
        data[length - fade + i] = data[length - fade + i] * (1 - t) + data[i] * t;
      }
    }
    return buffer;
  }

  function bed(buffer, type, frequency, q) {
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.loopStart = 0;
    source.playbackRate.value = 0.9 + Math.random() * 0.2;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    filter.Q.value = q;
    const swell = ctx.createGain();
    swell.gain.value = 1;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const pan = ctx.createStereoPanner();
    source.connect(filter).connect(swell).connect(gain).connect(pan).connect(master);
    source.start(0, Math.random() * 2.5);
    return { source, filter, swell, gain, pan };
  }

  function burst({ buffer = noise, type = "bandpass", frequency = 1000, q = 1, to = null, gain = 0.2, attack = 0.005, length = 0.08, pan = 0, at = 0, rate = 1 }) {
    const t = Math.max(ctx.currentTime, at || ctx.currentTime);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(frequency, t);
    if (to) filter.frequency.exponentialRampToValueAtTime(to, t + length);
    filter.Q.value = q;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(gain, t + attack);
    env.gain.exponentialRampToValueAtTime(0.0005, t + attack + length);
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    source.connect(filter).connect(env).connect(panner).connect(master);
    source.start(t, Math.random() * 2);
    source.stop(t + attack + length + 0.05);
  }

  function set(param, value, time = 0.4) {
    param.setTargetAtTime(value, ctx.currentTime, time);
  }

  // A cat's voice: a buzzy glottal source through two moving formants. The
  // mouth opens (formants rise) as the pitch climbs, then closes: "mi-aow".
  function voice(contour, formants, duration, level = 0.22) {
    const t = ctx.currentTime + 0.01;
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    contour.forEach(([at, hz], i) =>
      i === 0 ? osc.frequency.setValueAtTime(hz, t) : osc.frequency.exponentialRampToValueAtTime(hz, t + at * duration),
    );
    const vibrato = ctx.createOscillator();
    vibrato.frequency.value = 5.5 + Math.random() * 2;
    const vibratoDepth = ctx.createGain();
    vibratoDepth.gain.value = 9;
    vibrato.connect(vibratoDepth).connect(osc.frequency);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(level, t + 0.05);
    env.gain.setValueAtTime(level, t + duration * 0.7);
    env.gain.exponentialRampToValueAtTime(0.0005, t + duration);
    const out = ctx.createGain();
    out.gain.value = 1;
    for (const track of formants) {
      const f = ctx.createBiquadFilter();
      f.type = "bandpass";
      f.Q.value = track.q;
      track.path.forEach(([at, hz], i) =>
        i === 0 ? f.frequency.setValueAtTime(hz, t) : f.frequency.linearRampToValueAtTime(hz, t + at * duration),
      );
      const g = ctx.createGain();
      g.gain.value = track.gain;
      osc.connect(f).connect(g).connect(env);
    }
    env.connect(out).connect(master);
    osc.start(t);
    vibrato.start(t);
    osc.stop(t + duration + 0.05);
    vibrato.stop(t + duration + 0.05);
    // A little breath under the voice.
    burst({ type: "bandpass", frequency: 2800, q: 0.8, gain: level * 0.12, attack: 0.04, length: duration * 0.8 });
  }

  function gull(pan) {
    // Kelp gull: a falling, nasal "kee-ow", often in a short series.
    const calls = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < calls; i++) {
      const t = ctx.currentTime + i * (0.32 + Math.random() * 0.1);
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      const base = 1500 + Math.random() * 400;
      osc.frequency.setValueAtTime(base * 0.8, t);
      osc.frequency.linearRampToValueAtTime(base, t + 0.06);
      osc.frequency.exponentialRampToValueAtTime(base * 0.55, t + 0.28);
      const f = ctx.createBiquadFilter();
      f.type = "bandpass";
      f.frequency.value = 2200;
      f.Q.value = 2.5;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(0.035, t + 0.03);
      env.gain.exponentialRampToValueAtTime(0.0005, t + 0.3);
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      osc.connect(f).connect(env).connect(p).connect(master);
      osc.start(t);
      osc.stop(t + 0.35);
    }
  }

  function crickets() {
    // Three-pulse chirps near 4.5 kHz, from a few directions.
    const t0 = ctx.currentTime;
    const pan = Math.random() * 1.6 - 0.8;
    const pitch = 4300 + Math.random() * 600;
    for (let c = 0; c < 3; c++) {
      const t = t0 + c * 0.05;
      const osc = ctx.createOscillator();
      osc.frequency.value = pitch;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(0.012, t + 0.008);
      env.gain.linearRampToValueAtTime(0, t + 0.03);
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      osc.connect(env).connect(p).connect(master);
      osc.start(t);
      osc.stop(t + 0.04);
    }
  }

  return {
    start,
    get started() {
      return !!ctx;
    },
    get enabled() {
      return enabled;
    },
    setEnabled(on) {
      enabled = on;
      if (!ctx) return;
      if (on) start();
      set(master.gain, on ? 0.9 : 0, 0.15);
    },
    // Per frame: what the scene sounds like from where the cat stands.
    update(next) {
      Object.assign(conditions, next);
      if (!ctx || !enabled || ctx.state !== "running") return;
      const c = conditions;
      set(beds.sea.gain.gain, 0.05 + c.sea * 0.3);
      set(beds.sea.pan.pan, c.seaPan * 0.6);
      set(beds.surf.gain.gain, c.sea * c.sea * 0.1);
      set(beds.surf.pan.pan, c.seaPan * 0.7);
      set(beds.wind.gain.gain, Math.min(0.2, 0.012 + c.wind * 0.012));
      set(beds.wind.filter.Q, 0.8 + c.wind * 0.05);
      set(beds.leaves.gain.gain, c.trees * Math.min(0.06, 0.004 + c.wind * 0.005));
      set(beds.rain.gain.gain, Math.min(0.2, c.rain * 0.035));
      const now = ctx.currentTime;
      // A wave breaks every several seconds: a rush that falls in pitch.
      if (now > nextWave) {
        nextWave = now + 5 + Math.random() * 5;
        const level = 0.02 + c.sea * c.sea * 0.18;
        burst({ buffer: pink, type: "lowpass", frequency: 2200, to: 300, q: 0.6, gain: level, attack: 0.5, length: 2.8, pan: c.seaPan * 0.6 });
        burst({ buffer: noise, type: "highpass", frequency: 3000, q: 0.5, gain: level * 0.25, attack: 0.9, length: 1.8, pan: c.seaPan * 0.6, at: now + 0.4 });
      }
      if (now > nextGull) {
        nextGull = now + 6 + Math.random() * 16;
        if (c.night < 0.5 && c.rain < 3) gull(Math.random() * 1.6 - 0.8);
      }
      if (c.night > 0.6 && c.rain < 1 && now > nextCricket) {
        nextCricket = now + 0.25 + Math.random() * 0.6;
        crickets();
      }
      if (c.rain > 0.3 && now > nextDrip) {
        nextDrip = now + 0.02 + Math.random() * (0.3 / c.rain);
        burst({ type: "bandpass", frequency: 2500 + Math.random() * 3000, q: 8, gain: 0.02 + Math.random() * 0.03, length: 0.03, pan: Math.random() * 2 - 1 });
      }
      if (c.rain > 4 && now > nextThunder) {
        nextThunder = now + 15 + Math.random() * 30;
        burst({ buffer: brown, type: "lowpass", frequency: 400, to: 60, q: 0.5, gain: 0.35, attack: 0.08, length: 4.5, pan: Math.random() - 0.5 });
      }
    },
    // A paw landing. Surface: 0 rock, 1 wet sand, 2 dry sand, 3 scrub, 4 forest floor.
    step(surface, running, pan) {
      if (!ctx || !enabled) return;
      const g = (running ? 0.07 : 0.035) * (0.7 + Math.random() * 0.6);
      if (surface === 0) burst({ type: "bandpass", frequency: 1800 + Math.random() * 600, q: 3, gain: g * 0.6, length: 0.02, pan });
      else if (surface === 1) burst({ buffer: pink, type: "lowpass", frequency: 700, q: 2, gain: g * 1.3, attack: 0.01, length: 0.07, pan });
      else if (surface === 2) burst({ type: "lowpass", frequency: 1300, to: 500, q: 0.7, gain: g, attack: 0.012, length: 0.09, pan });
      else {
        // Leaves and twigs: a few tiny crackles.
        const count = surface === 4 ? 3 : 2;
        for (let i = 0; i < count; i++)
          burst({ type: "bandpass", frequency: 2500 + Math.random() * 2500, q: 2, gain: g * 0.7, length: 0.015 + Math.random() * 0.02, pan, at: ctx.currentTime + i * 0.012 + Math.random() * 0.01 });
      }
    },
    meow() {
      if (!ctx || !enabled) return;
      const pitch = 0.9 + Math.random() * 0.25;
      const d = 0.55 + Math.random() * 0.35;
      voice(
        [[0, 430 * pitch], [0.25, 760 * pitch], [0.55, 690 * pitch], [1, 360 * pitch]],
        [
          { q: 5, gain: 1.4, path: [[0, 600], [0.3, 1100], [0.7, 950], [1, 650]] },
          { q: 7, gain: 0.9, path: [[0, 1500], [0.3, 2500], [0.7, 1900], [1, 1300]] },
        ],
        d,
      );
    },
    // A short questioning trill, "mrrp?", when greeting or spotting prey.
    chirrup() {
      if (!ctx || !enabled) return;
      voice(
        [[0, 330], [0.6, 440], [1, 560]],
        [{ q: 4, gain: 1.2, path: [[0, 500], [1, 900]] }, { q: 6, gain: 0.6, path: [[0, 1400], [1, 2100]] }],
        0.26,
        0.13,
      );
    },
    // A paw or a whole cat hitting the water: a plunge, then droplets
    // pattering back.
    splash(strength, pan = 0) {
      if (!ctx || !enabled) return;
      const g = 0.03 + strength * 0.09;
      burst({ buffer: pink, type: "bandpass", frequency: 900 + Math.random() * 400, to: 350, q: 1.2, gain: g, attack: 0.006, length: 0.08 + strength * 0.2, pan });
      burst({ type: "highpass", frequency: 2600, q: 0.7, gain: g * 0.45, attack: 0.01, length: 0.1 + strength * 0.25, pan });
      const drops = Math.round(1 + strength * 5);
      for (let i = 0; i < drops; i++)
        burst({ type: "bandpass", frequency: 1800 + Math.random() * 2600, q: 9, gain: g * 0.35, length: 0.02, pan: pan + Math.random() * 0.4 - 0.2, at: ctx.currentTime + 0.12 + Math.random() * 0.35 });
    },
    // Paddling: soft slops, one per stroke, quicker when it hurries.
    setSwim(swim, speed) {
      if (!ctx || !enabled || swim < 0.5) return;
      const now = ctx.currentTime;
      if (now < nextPaddle) return;
      nextPaddle = now + 0.5 - Math.min(speed, 0.8) * 0.25;
      burst({ buffer: pink, type: "lowpass", frequency: 700 + Math.random() * 300, q: 1.5, gain: 0.025 + speed * 0.02, attack: 0.02, length: 0.12, pan: Math.random() * 0.4 - 0.2 });
    },
    // A shake: a rapid flutter of fur throwing off spray.
    shake() {
      if (!ctx || !enabled) return;
      for (let i = 0; i < 9; i++)
        burst({ buffer: pink, type: "bandpass", frequency: 1500, q: 0.8, gain: 0.03 * Math.sin((i / 8) * Math.PI) + 0.008, attack: 0.02, length: 0.06, at: ctx.currentTime + 0.15 + i * 0.09 });
    },
    jump() {
      if (!ctx || !enabled) return;
      burst({ buffer: pink, type: "bandpass", frequency: 600, to: 1400, q: 0.8, gain: 0.05, attack: 0.03, length: 0.15 });
    },
    land(speed) {
      if (!ctx || !enabled) return;
      burst({ buffer: brown, type: "lowpass", frequency: 260, q: 1, gain: Math.min(0.25, 0.05 + speed * 0.04), length: 0.12 });
    },
    // Purr: ~26 Hz pulses of low noise, louder on the out-breath.
    setPurr(on) {
      if (!ctx) return;
      if (on && !purr && enabled) {
        const source = ctx.createBufferSource();
        source.buffer = brown;
        source.loop = true;
        const filter = ctx.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.value = 320;
        const pulse = ctx.createGain();
        pulse.gain.value = 0.5;
        const rate = ctx.createOscillator();
        rate.type = "triangle";
        rate.frequency.value = 26;
        const depth = ctx.createGain();
        depth.gain.value = 0.5;
        rate.connect(depth).connect(pulse.gain);
        const breath = ctx.createGain();
        breath.gain.value = 0.6;
        const lung = ctx.createOscillator();
        lung.frequency.value = 0.45;
        const lungDepth = ctx.createGain();
        lungDepth.gain.value = 0.35;
        lung.connect(lungDepth).connect(breath.gain);
        const level = ctx.createGain();
        level.gain.value = 0;
        level.gain.setTargetAtTime(0.35, ctx.currentTime, 1.2);
        source.connect(filter).connect(pulse).connect(breath).connect(level).connect(master);
        source.start();
        rate.start();
        lung.start();
        purr = { level, stop: () => [source, rate, lung].forEach((n) => n.stop(ctx.currentTime + 1.5)) };
      } else if (!on && purr) {
        purr.level.gain.setTargetAtTime(0, ctx.currentTime, 0.3);
        purr.stop();
        purr = null;
      }
    },
    dispose() {
      ctx?.close();
      ctx = null;
    },
  };
}
