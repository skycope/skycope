// Rain as layers chosen by what is round the cat (bus `weather`), and
// shelter (sound-plan.md section 6). `r` is rain in mm/h, k = min(1, r/8).
//
//   open air   white, band 1.8–9 kHz         0.06 k        not under cover
//   on sand    pink, band-pass 1400 Hz         0.04 k (1 − trees)
//   on leaves  white, high-pass 2600 Hz        0.05 k trees, plus drips
//   on sea     white, band-pass 6500 Hz        0.04 k sea
//   iron roof  struck drops (240, 510, 1150 Hz modes), Poisson 8 + 60 k
//              per second, at the cottage roof (ref 10 m); a merging bed
//              in heavy rain; a gutter dripping into the tank
//   milkwood   big drips under the crown
//
// Drops cost no nodes: each family is one persistent chain (a noise loop
// through an exciter gain into its resonant filters) and a drop is a 2 ms
// bump on the exciter's gain. The chains are built when rain starts and
// torn down 5 s after it stops.
//
// Shelter (eased over 0.4 s): under the eave the open layers drop 12 dB
// behind a 1.5 kHz low-pass and the roof comes up 6 dB, overhead, with a
// little small-space; under the milkwood the open air drops 9 dB, the
// leaves rise 3 dB and big drips fall; in the boiler the open air drops
// 15 dB and the drum rings.
import { placeSource } from "./space.js";

const ROOF_MODES = [[240, 22, 1], [510, 18, 0.7], [1150, 14, 0.4]];

export function createWeather(core) {
  const { ctx } = core;
  let rig = null;
  let dryFor = 0;
  let nextGutter = 0;
  const set = (param, value, time = 0.4) => param.setTargetAtTime(value, ctx.currentTime, time);

  function chain(input, nodes) {
    nodes.reduce((a, b) => a.connect(b), input);
    return nodes[nodes.length - 1];
  }

  // A struck family: noise loop → exciter (bumped) → filters → out.
  function striker(filters, { colour = "white", click = 0 } = {}) {
    const src = core.counted.createBufferSource();
    src.buffer = core.buffers[colour];
    src.loop = true;
    const exciter = core.counted.createGain();
    exciter.gain.value = 0;
    const out = core.counted.createGain();
    src.connect(exciter);
    const made = [src, exciter, out];
    const bands = filters.map(([type, f, q, g]) => {
      const flt = core.filter(type, f, q);
      const level = core.counted.createGain();
      level.gain.value = g;
      exciter.connect(flt).connect(level).connect(out);
      made.push(flt, level);
      return flt;
    });
    if (click) {
      const hp = core.filter("highpass", 4000, 0);
      const level = core.counted.createGain();
      level.gain.value = click;
      exciter.connect(hp).connect(level).connect(out);
      made.push(hp, level);
    }
    src.start(0, core.random() * 1.8);
    core.stats.loops++;
    return {
      out,
      bands,
      made,
      src,
      strike(t, g, len = 0.002) {
        exciter.gain.setValueAtTime(0, t);
        exciter.gain.linearRampToValueAtTime(g, t + 0.0005);
        exciter.gain.linearRampToValueAtTime(0, t + len);
      },
    };
  }

  function build() {
    const out = core.counted.createGain();
    out.connect(core.mix.input("weather"));
    // The layers heard in the open, behind one shelter gain and low-pass.
    const open = core.counted.createGain();
    const openTone = core.filter("lowpass", 20000, -3);
    open.connect(openTone).connect(out);
    const layers = {
      air: core.bed({ colour: "white", type: "bandpass", f: 4000, q: 0.35, bus: "weather", stereo: true }),
      sand: core.bed({ colour: "pink", type: "bandpass", f: 1400, q: 0.5, bus: "weather" }),
      leaves: core.bed({ colour: "white", type: "highpass", f: 2600, q: 0, bus: "weather", stereo: true }),
      sea: core.bed({ colour: "white", type: "bandpass", f: 6500, q: 0.6, bus: "weather", stereo: true }),
      merge: core.bed({ colour: "white", type: "bandpass", f: 600, q: 2, bus: "weather" }),
    };
    // Re-route the open-air layers through the shelter stage.
    for (const name of ["air", "sand", "sea"]) {
      layers[name].pan.disconnect();
      layers[name].pan.connect(open);
    }
    const roof = striker(ROOF_MODES.map(([f, q, g]) => ["bandpass", f, q, g]), { click: 0.012 });
    const roofPan = core.counted.createStereoPanner();
    const roofAir = core.filter("lowpass", 16000, -3);
    const roofSend = core.counted.createGain();
    roofSend.gain.value = 0;
    roof.out.connect(roofAir).connect(roofPan).connect(out);
    roofPan.connect(roofSend).connect(core.mix.sendB);
    layers.merge.pan.disconnect();
    layers.merge.pan.connect(roofAir);
    const leafDrips = striker([["bandpass", 2500, 5, 1]]);
    leafDrips.out.connect(out);
    const bigDrips = striker([["lowpass", 900, 0, 1]], { colour: "brown" });
    bigDrips.out.connect(out);
    return { out, open, openTone, layers, roof, roofPan, roofAir, roofSend, leafDrips, bigDrips, credit: { roof: 0, leaf: 0, big: 0 } };
  }

  function teardown() {
    for (const l of Object.values(rig.layers)) {
      for (const s of l.sources) s.stop();
      core.stats.loops -= l.sources.length;
      l.pan.disconnect();
    }
    for (const s of [rig.roof, rig.leafDrips, rig.bigDrips]) {
      s.src.stop();
      core.stats.loops--;
      for (const n of s.made) n.disconnect();
    }
    rig.out.disconnect();
    rig = null;
  }

  // Poisson drops for one update step, bumping `s` (gain g() each).
  function rain(s, key, rate, dt, g, onDrop) {
    rig.credit[key] += rate * dt;
    const now = ctx.currentTime;
    while (rig.credit[key] >= 1) {
      rig.credit[key] -= 1;
      const t = now + 0.03 + core.random() * dt;
      onDrop?.(t);
      s.strike(t, g());
    }
  }

  return {
    // w: { rain, sea, trees, dt, listener, roofs: [{ x, z, y, r }], under
    //      ("eave" | "tree" | "boiler" | null), canopy 0…1 }
    update(w) {
      const r = w.rain ?? 0;
      const dt = Math.min(0.1, w.dt ?? 1 / 30);
      if (r < 0.05) {
        if (rig) {
          dryFor += dt;
          for (const l of Object.values(rig.layers)) set(l.gain.gain, 0, 1);
          if (dryFor > 5) teardown();
        }
        return;
      }
      dryFor = 0;
      if (!rig) rig = build();
      const k = Math.min(1, r / 8);
      const trees = Math.max(w.trees ?? 0, w.canopy ?? 0);
      const under = w.under ?? null;
      const L = rig.layers;
      set(L.air.gain.gain, 0.06 * k);
      set(L.sand.gain.gain, 0.04 * k * (1 - trees));
      set(L.sea.gain.gain, 0.04 * k * (w.sea ?? 0));
      set(L.leaves.gain.gain, 0.05 * k * trees * (under === "tree" ? 1.41 : 1));
      // Shelter: the open layers.
      const openDb = under === "eave" ? -12 : under === "tree" ? -9 : under === "boiler" ? -15 : 0;
      set(rig.open.gain, 10 ** (openDb / 20));
      set(rig.openTone.frequency, under === "eave" || under === "boiler" ? 1500 : under === "tree" ? 5000 : 20000);
      // The roof: positioned at the nearest roof, overhead under the eave.
      let roof = null;
      let roofGain = 0;
      for (const f of w.roofs ?? []) {
        const p = placeSource(w.listener, f, 10);
        if (p.distance < 60 && (!roof || p.gain > roofGain)) {
          roof = p;
          roofGain = p.gain;
        }
      }
      if (under === "eave") roof = { gain: 1, pan: 0, cutoff: 20000 };
      set(rig.roof.out.gain, roof ? roof.gain : 0);
      set(rig.roofPan.pan, roof?.pan ?? 0);
      set(rig.roofAir.frequency, roof?.cutoff ?? 20000);
      set(rig.roofSend.gain, under === "eave" ? 0.2 : 0);
      set(L.merge.gain.gain, roof && k > 0.7 ? 0.03 * (k - 0.7) / 0.3 : 0);
      if (roof) {
        // Above 40 drops a second, one in two at +3 dB; the bed merges the rest.
        let rate = 8 + 60 * k;
        let boost = 1;
        if (rate > 40) {
          rate /= 2;
          boost = 1.41;
        }
        rain(rig.roof, "roof", rate, dt, () => core.rand(0.01, 0.022) * boost * 60);
        // The gutter into the tank, close by.
        const now = ctx.currentTime;
        if (roof.gain > 0.3 && now > nextGutter) {
          nextGutter = now + core.rand(0.6, 1.4);
          const v = core.voice({ bus: "weather", gain: Math.min(1, roof.gain), pan: roof.pan });
          if (v) {
            const tank = core.filter("bandpass", 160, 10);
            const tankGain = core.counted.createGain();
            tankGain.gain.value = 0.3;
            tank.connect(tankGain).connect(v.input);
            v.add(tank, tankGain);
            const f = core.rand(850, 950);
            core.tone(v, { hz: f, to: f * 0.55, attack: 0.002, tail: 0.06, gain: 0.012 });
            core.tone(v, { hz: f, to: f * 0.55, attack: 0.002, tail: 0.06, gain: 0.04, out: tank });
            v.done();
          }
        }
      }
      // Drips through the leaves, and big ones under the crown.
      if (trees > 0.1)
        rain(rig.leafDrips, "leaf", 20 * k * trees, dt, () => 0.012 * 4, (t) => rig.leafDrips.bands[0].frequency.setValueAtTime(core.rand(1500, 3500), t));
      set(rig.leafDrips.out.gain, trees > 0.1 ? 1 : 0);
      if (under === "tree") rain(rig.bigDrips, "big", 0.5 + 3 * k, dt, () => 0.02 * 3);
      set(rig.bigDrips.out.gain, under === "tree" ? 1 : 0);
    },
    get active() {
      return !!rig;
    },
  };
}
