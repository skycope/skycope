// The floor everything sits on (bus `amb`): the sea and the surf panned
// toward the nearest shore, the swash close by, wind with gusts, leaves
// that follow the real wind, breaking waves, a gull now and then from
// over the shore, and crickets at night from fixed spots in the grass
// round the cat that hush as it walks near.

export function createBeds(core) {
  const { ctx } = core;
  const beds = {
    sea: core.bed({ colour: "brown", type: "lowpass", f: 480, q: 0 }),
    surf: core.bed({ colour: "pink", type: "bandpass", f: 900, q: 0.6 }),
    swash: core.bed({ colour: "pink", type: "bandpass", f: 2500, q: 0.5 }),
    wind: core.bed({ colour: "pink", type: "bandpass", f: 520, q: 0.8, stereo: true }),
    leaves: core.bed({ colour: "white", type: "highpass", f: 2600, q: 0, stereo: true }),
  };
  // Slow swells breathe through the sea.
  for (const [rate, depth] of [[0.09, 0.25], [0.037, 0.2]]) {
    const lfo = core.counted.createOscillator();
    lfo.frequency.value = rate;
    const amount = core.counted.createGain();
    amount.gain.value = depth;
    lfo.connect(amount).connect(beds.sea.swell.gain);
    lfo.start();
  }
  // The swash's run-up and back (a 0.11 Hz raised cosine: the surf
  // shader's phase is not on the CPU).
  const swashLfo = core.counted.createOscillator();
  swashLfo.frequency.value = 0.11;
  const swashDepth = core.counted.createGain();
  swashDepth.gain.value = 0.5;
  beds.swash.swell.gain.value = 0.5;
  swashLfo.connect(swashDepth).connect(beds.swash.swell.gain);
  swashLfo.start();
  const windLfo = core.counted.createOscillator();
  windLfo.frequency.value = 0.13;
  const windDepth = core.counted.createGain();
  windDepth.gain.value = 180;
  windLfo.connect(windDepth).connect(beds.wind.filter.frequency);
  windLfo.start();

  let nextWave = ctx.currentTime + 1;
  let nextGull = ctx.currentTime + 8;
  let nextGust = ctx.currentTime + 6;
  let nextChirp = 0;
  const swashPhase0 = ctx.currentTime;
  let lastFizz = -Infinity;
  let crickets = [];
  let lastCat = null;
  const set = (param, value, time = 0.4) => param.setTargetAtTime(value, ctx.currentTime, time);

  // Five to seven cricket spots in the grass round the cat, re-seeded as
  // it moves on. Each keeps a `quiet` clock: hushed while the cat moves
  // within 6 m, back 4–8 s after it has passed (10 s after it sits).
  function seedCrickets(cat) {
    const n = 5 + Math.floor(core.random() * 3);
    crickets = Array.from({ length: n }, () => {
      const a = core.random() * Math.PI * 2;
      const r = 5 + core.random() * 20;
      return { x: cat.x + Math.cos(a) * r, z: cat.z + Math.sin(a) * r, quiet: 0, hz: 4300 + core.random() * 600 };
    });
  }

  const chirps = [];
  function chirp(c) {
    chirps.push({ t: ctx.currentTime, x: c.x, z: c.z });
    core.noteHeard("crickets:chirp", c);
    if (chirps.length > 400) chirps.shift();
    const v = core.voice({ bus: "amb", at: { x: c.x, z: c.z }, ref: 4 });
    for (let i = 0; i < 3; i++) core.tone(v, { hz: c.hz, attack: 0.008, tail: 0.022, gain: 0.008, at: i * 0.05 });
    v?.done();
  }

  const api = {
    beds,
    // c: { sea 0…1, seaPan, wind m/s, trees 0…1, night 0…1, rain mm/h,
    //      shore (m inland, negative in the water), cat { x, z, speed, sit },
    //      dt, sheltered 0…1 }
    update(c) {
      const now = ctx.currentTime;
      const sea = c.sea ?? 0;
      set(beds.sea.gain.gain, 0.05 + sea * 0.3);
      set(beds.sea.pan.pan, (c.seaPan ?? 0) * 0.6);
      set(beds.surf.gain.gain, sea * sea * 0.1);
      set(beds.surf.pan.pan, (c.seaPan ?? 0) * 0.7);
      // The swash: brighter and closer at the edge, not just louder.
      const shore = Math.abs(c.shore ?? 30);
      const nearSwash = 1 - Math.min(1, Math.max(0, shore / 6)) ** 2 * (3 - 2 * Math.min(1, Math.max(0, shore / 6)));
      set(beds.swash.gain.gain, 0.05 * nearSwash);
      set(beds.swash.pan.pan, (c.seaPan ?? 0) * 0.5);
      const wind = c.wind ?? 0;
      set(beds.wind.gain.gain, Math.min(0.2, 0.012 + wind * 0.012) * (1 - 0.37 * (c.sheltered ?? 0)));
      set(beds.wind.filter.Q, 0.8 + wind * 0.05);
      // Wind in leaves scales with the real wind, under the trees.
      set(beds.leaves.gain.gain, (c.trees ?? 0) * Math.min(0.06, 0.003 + wind * 0.005));
      // The fizz at the top of each run-up, close to the swash.
      if (nearSwash > 0.2) {
        const phase = ((now - swashPhase0) * 0.11) % 1;
        if (phase > 0.48 && phase < 0.52 && now - lastFizz > 5) {
          lastFizz = now;
          const v = core.voice({ bus: "amb", pan: (c.seaPan ?? 0) * 0.5 });
          core.noise(v, { colour: "white", type: "highpass", f: 5000, q: 0, attack: 0.3, tail: 1.4, gain: 0.012 * nearSwash });
          v?.done();
        }
      }
      // A wave breaks every several seconds, timed with the swash run-up.
      if (now > nextWave) {
        nextWave = now + 5 + core.random() * 5;
        const level = 0.02 + sea * sea * 0.18;
        if (level > 0.025) {
          const v = core.voice({ bus: "amb", pan: (c.seaPan ?? 0) * 0.6 });
          core.noise(v, { colour: "pink", type: "lowpass", f: 2200, to: 300, q: 0, attack: 0.5, tail: 2.8, gain: level });
          core.noise(v, { colour: "white", type: "highpass", f: 3000, q: 0, attack: 0.9, tail: 1.8, gain: level * 0.25, at: 0.4 });
          v?.done();
        }
      }
      // A gust through the grass: a band sweeping up, 2–4 s.
      if (now > nextGust) {
        nextGust = now + 6 + core.random() * 14;
        if (wind > 3) {
          const v = core.voice({ bus: "amb", pan: core.rand(-0.5, 0.5) });
          const len = core.rand(2, 4);
          core.noise(v, { colour: "pink", type: "bandpass", f: 350, to: 900, q: 0.9, attack: len * 0.45, tail: len * 0.55, gain: Math.min(0.03, (0.02 * wind) / 10) });
          v?.done();
        }
      }
      // A gull from over the shore (day, by the sea).
      if (now > nextGull) {
        nextGull = now + 15 + core.random() * 25;
        if ((c.night ?? 0) < 0.5 && (c.rain ?? 0) < 3 && sea > 0.3 && c.cat) api.gull(c.cat, c.seaPan ?? 0);
      }
      // Crickets at night, hushing round a moving cat.
      const cat = c.cat;
      if (cat && (c.night ?? 0) > 0.6 && (c.rain ?? 0) < 1 && (c.trees ?? 0) > 0.2) {
        if (!crickets.length || !lastCat || Math.hypot(cat.x - lastCat.x, cat.z - lastCat.z) > 15) {
          seedCrickets(cat);
          lastCat = { x: cat.x, z: cat.z };
        }
        const moving = Math.abs(cat.speed ?? 0) > 0.3;
        for (const k of crickets) {
          const d = Math.hypot(k.x - cat.x, k.z - cat.z);
          if (d < 6 && moving) k.quiet = 4 + core.random() * 4;
          else if (d < 6 && (cat.sit ?? 0) > 0.9) k.quiet = Math.min(k.quiet, 10);
          else k.quiet = Math.max(0, k.quiet - (c.dt ?? 1 / 30));
        }
        if (now > nextChirp) {
          // At most four chirps a second in all.
          nextChirp = now + 0.25 + core.random() * 0.6;
          const awake = crickets.filter((k) => k.quiet <= 0);
          if (awake.length) chirp(awake[Math.floor(core.random() * awake.length)]);
        }
      }
    },
    gull(cat, seaPan = 0) {
      // Kelp gull: a falling, nasal "kee-ow", 1–3 calls, 30–60 m seaward.
      const bearing = Math.atan2(seaPan, 1) + core.rand(-0.6, 0.6);
      const d = core.rand(30, 60);
      const at = { x: cat.x + Math.sin(bearing) * d, z: cat.z + Math.cos(bearing) * d, y: (cat.y ?? 0) + 15 };
      core.noteHeard("gull:idle", at);
      const v = core.voice({ bus: "world", at, ref: 8 });
      const calls = 1 + Math.floor(core.random() * 3);
      for (let i = 0; i < calls; i++) {
        const base = core.rand(1500, 1900);
        core.voiced(v, { contour: [[0, base * 0.8], [0.2, base], [1, base * 0.55]], formants: [[2200, 2.5, 1]], length: 0.28, gain: 0.035, attack: 0.03, release: 0.04, at: i * core.rand(0.32, 0.42) });
      }
      return v?.done();
    },
    // The cricket spots and the chirps so far (tests).
    get crickets() {
      return crickets;
    },
    chirps,
  };
  return api;
}
