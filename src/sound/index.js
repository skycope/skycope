// Every sound is synthesised with Web Audio (no recordings), like the
// scene. This is the engine's front: createSound() builds the mix (mix.js),
// the building blocks (core.js) and the families (beds, foley, weather,
// world, cues), and keeps the public API main.js, thread.js and journey.js
// call. The context starts on the first user gesture (browser policy).
// Pass `context` (an OfflineAudioContext, or tests/audio/sim.js's) to build
// the same graph off-line.
//
// Silence costs nothing: with sound off every entry point returns before
// making a node and the context is suspended; a hidden tab suspends it too.
import { createScore, createReverb, moodFor } from "../score.js";
import { playCall, CALL_BUS } from "../calls.js";
import { createMix } from "./mix.js";
import { createCore } from "./core.js";
import { listenerFrom, placeSource } from "./space.js";
import { createBeds } from "./beds.js";
import { createFoley } from "./foley.js";
import { createWeather } from "./weather.js";
import { createWorld } from "./world.js";
import { createCues, WAKING_CUES, STORY_CUES, camel } from "./cues.js";
import { SURFACE } from "./patches.js";
import { sampleHabitat } from "../habitat.js";

const PREFS = { sound: "skycope.sound", music: "skycope.music" };
export { WAKING_CUES, STORY_CUES };

export function createSound({ context = null, storage = defaultStorage(), seed = 1, perf = false } = {}) {
  let ctx = null;
  let enabled = readPref(storage, PREFS.sound, true);
  let musicOn = readPref(storage, PREFS.music, true);
  let mix, core, beds, foley, weather, world, cues, score, musicSend, reverb;
  let spectacleSeen = false;
  let externalThunder = -Infinity;
  let nextThunder = 12;
  let nextOwl = 0;
  let lastCeremony = -Infinity;
  let asleep = false;
  let inside = null;
  let lastPlace = 0;
  let lastWasWet = false;
  let lastUpdate = 0;
  let suspendTimer = null;
  const calls = []; // the named calls played (tests: who answered, when)
  const scoreInput = { sunAltitude: 30, sunAzimuth: 0, cover: 0, rain: 0, asleep: false, spectacle: 0 };
  const conditions = { sea: 0.5, seaPan: 0, wind: 0, rain: 0, night: 0, trees: 0, shore: 30 };
  // The world the sounds come from (setWorld): plants, roofs, places.
  const scene = { habitat: null, plants: null, roofs: [], pois: [], milkwood: null, wreck: null, boat: null, lighthouse: null, pool: null };

  // The context is made on the first gesture; the graph only once sound is
  // on (with sound off from the start, nothing is ever built).
  function start() {
    if (!ctx) {
      if (context) ctx = context;
      else {
        const AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext;
        if (!AudioContext) return;
        ctx = new AudioContext({ latencyHint: "playback" });
      }
    } else if (ctx.state === "suspended" && !context && !globalThis.document?.hidden && enabled) ctx.resume();
    if (enabled && !mix) build();
    else if (!enabled && !context && ctx.state === "running") ctx.suspend();
  }

  function build() {
    mix = createMix(ctx, { on: enabled });
    core = createCore(ctx, mix, { seed });
    // The score: its own reverb (4.8 s), on the music bus; its ceremony
    // phrases on the magic bus so they play with the music off.
    musicSend = core.counted.createGain();
    musicSend.gain.value = 1;
    reverb = createReverb(core.counted, { seconds: 4.8 });
    reverb.output.connect(mix.input("music"));
    musicSend.connect(reverb.input);
    mix.setLevel("music", musicOn ? 1 : 0, 0.01);
    score = createScore(core.counted, { out: mix.input("music"), send: musicSend, seed, ceremonyOut: mix.input("magic") });
    beds = createBeds(core);
    foley = createFoley(core);
    weather = createWeather(core);
    world = createWorld(core, { call });
    cues = createCues(core, { world, foley, call, mix, score, home: (n, gain) => score.home(n, ctx.currentTime, gain) });
  }

  const live = () => ctx && mix && enabled && (context || ctx.state === "running");

  // A named call (calls.js) on its bus; `at` places it from the listener.
  function call(name, options = {}) {
    if (!live()) return false;
    const opts = { ...options };
    if (opts.at && core.listener) {
      const p = placeSource(core.listener, opts.at, 25);
      opts.distance = p.distance;
      opts.pan = p.pan;
    }
    if (opts.t !== undefined && opts.delay === undefined) opts.delay = Math.max(0, opts.t - ctx.currentTime);
    calls.push({ name, at: ctx.currentTime + 0.02 + (opts.delay ?? 0) });
    if (calls.length > 200) calls.shift();
    const io = { ctx: core.counted, out: mix.input(CALL_BUS[name] ?? "world"), reverb: mix.sendA, noise: core.buffers.white, pink: core.buffers.pink, brown: core.buffers.brown, random: core.random };
    return playCall(io, name, opts);
  }

  // Refines the walker's surface kind (0 rock, 1 wet sand, 2 dry sand,
  // 3 scrub, 4 forest floor, 5 water) into the sound's surfaces.
  function surfaceFor(kind, { x, z, depth = 0 } = {}) {
    if (kind === 5) return SURFACE.shallows;
    if (inside === "boiler") return SURFACE.metal;
    if (!Number.isFinite(x)) return kind;
    if (kind === 0) {
      for (const p of [scene.wreck, scene.boat]) if (p && Math.hypot(x - p.x, z - p.z) < (p.r ?? 6) * 0.6) return SURFACE.timber;
      if (scene.milkwood && Math.hypot(x - scene.milkwood.x, z - scene.milkwood.z) < 5) return SURFACE.timber;
      return SURFACE.rock;
    }
    if ((kind === 3 || kind === 4) && scene.habitat) {
      const h = sampleHabitat(scene.habitat, x, z);
      if (h.competition > 0.3 || h.community === "thicket") return SURFACE.forest;
      if (kind === 3 && plantsAt(x, z, 0.6).density > 0.05) return SURFACE.scrub;
      return SURFACE.grass;
    }
    return kind;
  }

  // Plants the cat's body overlaps: density 0…1 and the dominant kind.
  function plantsAt(x, z, body = 0.25) {
    const grid = scene.plants;
    if (!grid) return { density: 0, kind: "shrub" };
    const i = Math.floor(x / 4), j = Math.floor(z / 4);
    let density = 0;
    let kind = "shrub";
    let best = 0;
    for (let di = -1; di <= 1; di++)
      for (let dj = -1; dj <= 1; dj++)
        for (const p of grid.get(`${i + di},${j + dj}`) ?? []) {
          const d = Math.hypot(x - p.x, z - p.z);
          const overlap = Math.max(0, 1 - d / (p.r + body));
          density += overlap;
          if (overlap > best) {
            best = overlap;
            kind = p.kind === "restio" ? "restio" : p.height > 1.2 ? "broad" : "shrub";
          }
        }
    return { density: Math.min(1, density), kind };
  }

  // Where the cat is sheltered: "eave", "tree", "boiler" or null; and the
  // canopy over it (0…1).
  function shelterAt(x, z, roofs = scene.roofs) {
    if (inside === "boiler") return { under: "boiler", canopy: 0 };
    for (const r of roofs) if (Math.hypot(x - r.x, z - r.z) < (r.r ?? 2.2)) return { under: "eave", canopy: 0 };
    let canopy = 0;
    if (scene.habitat) {
      const cx = Math.floor(x / 8), cz = Math.floor(z / 8);
      for (let dx = -1; dx <= 1; dx++)
        for (let dz = -1; dz <= 1; dz++)
          for (const c of scene.habitat.crowns.get(`${cx + dx},${cz + dz}`) ?? []) {
            const radial = ((x - c.x) ** 2 + (z - c.z) ** 2) / (c.r * c.r);
            if (radial < 1) canopy = Math.max(canopy, 1 - radial * 0.6);
          }
    }
    return { under: canopy > 0.55 ? "tree" : null, canopy };
  }

  function setInside(where) {
    if (where === inside || !ctx) return;
    inside = where;
    if (where === "boiler") {
      const drum = world.boilerDrum();
      foley.boiler = drum.input;
      mix.shade("amb", { dB: -6, lowpass: 900 });
    } else {
      foley.boiler = null;
      mix.shade("amb", asleep ? { dB: -3, lowpass: 3000 } : { dB: 0, lowpass: 20000 });
    }
  }

  function writeStats() {
    if (!perf || !globalThis.document) return;
    const el = globalThis.document.getElementById("landscape");
    if (!el) return;
    const s = core.stats;
    const cap = ctx.renderCapacity;
    el.dataset.audio = JSON.stringify({ voices: s.voices, peak: s.peak, loops: s.loops, rate: Math.round(s.rate ?? 0), created: s.created, refused: s.refused, stolen: s.stolen, reduction: +mix.reduction.toFixed(2), load: cap?.averageLoad ?? null });
  }

  const api = {
    start,
    get started() {
      return !!ctx;
    },
    get enabled() {
      return enabled;
    },
    setEnabled(on) {
      enabled = on;
      writePref(storage, PREFS.sound, enabled);
      if (!ctx) return;
      clearTimeout(suspendTimer);
      if (on) {
        if (!mix) build();
        if (!context && !globalThis.document?.hidden) ctx.resume();
        mix.setOn(true);
      } else {
        mix?.setOn(false);
        // Nothing runs while muted.
        if (!context) suspendTimer = setTimeout(() => !enabled && ctx?.suspend(), 400);
      }
    },
    // Per frame: what the scene sounds like from where the cat stands.
    // next: { sea, seaPan, wind, rain, night, trees, shore (m inland),
    //   cat { x, y, z, speed, sit, sleepy, swim, wade }, camera { x, z, yaw },
    //   boat { afloat, aboard, x, z, speed, roll, vr, stretch },
    //   interest { x, z, near, kind }, inside, lamp { lit } }
    update(next) {
      Object.assign(conditions, next);
      if (!live()) return;
      const c = conditions;
      const now = ctx.currentTime;
      const dt = Math.min(0.1, Math.max(0, now - lastUpdate) || 1 / 30);
      lastUpdate = now;
      core.listener = listenerFrom(c.cat, c.camera);
      if (c.inside !== undefined) setInside(c.inside);
      const cat = c.cat;
      const roofs = c.roofs ?? scene.roofs;
      const shelter = c.under !== undefined ? { under: c.under, canopy: c.under === "tree" ? 1 : 0 } : cat ? shelterAt(cat.x, cat.z, roofs) : { under: null, canopy: 0 };
      if (c.beds !== false) beds.update({ ...c, dt, sheltered: shelter.under ? 1 : 0 });
      weather.update({ rain: c.rain, sea: c.sea, trees: c.trees, dt, listener: core.listener, roofs, under: shelter.under, canopy: shelter.canopy });
      // Foliage the cat is pushing through.
      if (c.contact) foley.brush(c.contact, dt);
      else if (cat) foley.brush({ ...plantsAt(cat.x, cat.z), speed: (cat.air ?? 0) > 0.05 ? 0 : cat.speed }, dt);
      // Water by depth: swimming, and drips coming out.
      if (cat) {
        foley.swim(cat.swim ?? 0, Math.abs(cat.speed ?? 0));
        const wetNow = (cat.swim ?? 0) > 0.5 || (cat.wade ?? 0) > 0.15;
        if (lastWasWet && !wetNow) foley.drip(10);
        lastWasWet = wetNow;
      }
      world.updateBoat(c.boat ? { ...c.boat, dt } : null);
      // Asleep: the music stops (the score's own sleep), the bed dulls.
      const sleeping = !!scoreInput.asleep;
      if (sleeping !== asleep) {
        asleep = sleeping;
        if (inside !== "boiler") mix.shade("amb", asleep ? { dB: -3, lowpass: 3000, time: 2 } : { dB: 0, lowpass: 20000, time: 2 });
      }
      // The owl in the milkwood, every few minutes at night.
      if ((c.night ?? 0) > 0.6 && scene.milkwood && cat && now > nextOwl) {
        if (nextOwl > 0) call("owl", { at: owlAt(), gain: 0.8 });
        nextOwl = now + 180 + core.random() * 180;
      }
      // Places' own small sounds, every few seconds when near.
      if (cat && now - lastPlace > 4) {
        lastPlace = now;
        placeAmbience(cat, c);
      }
      // A storm grumbles on its own unless real thunder is coming through play().
      if ((c.rain ?? 0) > 4 && now > nextThunder) {
        nextThunder = now + 15 + core.random() * 30;
        if (now - externalThunder > 90) api.play("thunder", { distance: 2500 + core.random() * 7000, pan: core.random() - 0.5 });
      }
      if (musicOn && score) {
        const seen = scoreInput.spectacle > 0.5;
        if (seen && !spectacleSeen) score.swell(0.7, now);
        spectacleSeen = seen;
        score.update(moodFor(scoreInput), now);
      }
      core.tick(now);
      if (Math.floor(now) !== Math.floor(now - dt)) writeStats();
    },
    // What the world sounds come from (landscape.soundWorld): { habitat,
    // places } and the landmarks ({ id, x, z, r }).
    setWorld({ habitat = null, places = null, pois = [] } = {}) {
      scene.habitat = habitat;
      scene.pois = pois;
      const find = (id) => pois.find((p) => p.id === id) ?? null;
      scene.milkwood = places?.crown ? { x: places.crown.x, z: places.crown.z, y: places.crown.top - 2 } : find("milkwood");
      scene.wreck = find("wreck");
      scene.boat = find("boat");
      scene.lighthouse = places?.beacon ? { ...find("lighthouse"), lampY: places.beacon.y } : find("lighthouse");
      scene.pool = find("pool");
      // Roofs: the prop contract's covers when the places lane provides
      // them; until then the keeper's cottage, found by its window light.
      const covers = places?.covers?.filter((c) => c.kind === "roof" || c.roof);
      scene.roofs = covers?.length
        ? covers.map((c) => ({ x: c.x, z: c.z, y: c.y ?? 3, r: c.r ?? 2.2 }))
        : (places?.lamps ?? []).filter((l) => l.reach === 4.5 && l.power === 0.9).map((l) => ({ x: l.x, z: l.z, y: l.y + 1.5, r: 2.2 }));
      // Plants the cat can push through, bucketed in 4 m cells.
      if (habitat?.producers) {
        const grid = new Map();
        for (const p of habitat.producers) {
          if (p.kind === "tree") continue;
          const r = Math.min(1.6, (p.height ?? 1) * 0.42);
          const key = `${Math.floor(p.x / 4)},${Math.floor(p.z / 4)}`;
          if (!grid.has(key)) grid.set(key, []);
          grid.get(key).push({ x: p.x, z: p.z, r, kind: p.kind, height: p.height ?? 1 });
        }
        scene.plants = grid;
      }
    },
    // What the score plays to (a few times a second is plenty).
    setScore(next) {
      Object.assign(scoreInput, next);
    },
    get music() {
      return musicOn;
    },
    setMusic(on) {
      musicOn = Boolean(on);
      writePref(storage, PREFS.music, musicOn);
      if (!mix) return;
      mix.setLevel("music", musicOn ? 1 : 0, 0.6);
    },
    // A named one-shot (calls.js: "discover", "thunder", "penguin-bray",
    // "seal-bark", "whale-blow", "owl", "splash-big", "wisp"). Options:
    // distance (m), pan (−1…1), gain, delay (s), at ({ x, z, y }).
    play(name, options = {}) {
      if (!live()) return false;
      const now = ctx.currentTime;
      if (name === "thunder") {
        externalThunder = now;
        const d = options.distance ?? 3000;
        if (d < 2000) {
          mix.duck("amb", -3, { attack: d / 343, hold: 1.5, release: 1.5 });
          mix.duck("weather", -3, { attack: d / 343, hold: 1.5, release: 1.5 });
        }
      }
      // The discovery chime never within 8 s of a ceremony.
      if (name === "discover" && now - lastCeremony < 8) return false;
      if (name === "discover" && musicOn) score?.swell(1);
      return call(name, options);
    },
    // A named one-shot at a place in the world.
    playAt(name, at, options = {}) {
      return api.play(name, { ...options, at });
    },
    // A gift waking (journey.js): the score's phrase for it (score.js
    // CEREMONIES) on the magic bus, the music and the bed dipping under
    // it. With the music off: the phrase alone, 3 dB down. Returns its
    // length in seconds.
    ceremony(gift) {
      if (!live() || !score) return 0;
      lastCeremony = ctx.currentTime;
      const length = score.ceremony(gift, ctx.currentTime, musicOn ? {} : { pads: false, gain: 0.71 });
      mix.duck("music", -9, { attack: 0.4, hold: Math.max(0, length - 3), release: 2.5 });
      mix.duck("amb", -4, { attack: 0.4, hold: Math.min(6, length * 0.5), release: 2.5 });
      return length;
    },
    // The home phrase: the first n notes (n = lights lit, 0…6).
    home(n) {
      if (!live() || !score) return 0;
      return score.home(n, ctx.currentTime);
    },
    setHidden(hidden) {
      if (!ctx || context) return;
      if (hidden) ctx.suspend();
      else if (enabled) ctx.resume();
    },
    get mood() {
      return score?.mood ?? null;
    },
    get context() {
      return ctx;
    },
    // Live voices, loops, node creations per second, limiter reduction.
    get stats() {
      return core ? { ...core.stats, window: undefined, reduction: mix.reduction, rustling: foley.rustling, raining: weather.active, boat: world.boatChain } : null;
    },
    // A paw landing. surface: the walker's kind (0 rock, 1 wet sand, 2 dry
    // sand, 3 scrub, 4 forest floor, 5 water) or, with info.exact, a sound
    // surface (patches.js SURFACE). info: { x, z, front, depth, speed }.
    step(surface, running, pan = 0, info = {}) {
      if (!live()) return;
      const s = info.exact ? surface : surfaceFor(surface, info);
      foley.step(s, running, pan, info);
    },
    surfaceFor,
    meow() {
      if (!live()) return 0;
      const c = conditions;
      const near = c.interest?.near && c.cat && Math.hypot(c.interest.x - c.cat.x, c.interest.z - c.cat.z) < 4;
      // Inside the boiler the dry meow is 6 dB down and the drum answers.
      let out = null;
      if (inside === "boiler") out = world.boilerDrum().input;
      const length = foley.meow({ short: !!near, out });
      if (inside === "boiler") world.boilerBell(0.12 + length);
      // Answers: the owl from the milkwood at night; a penguin's haw.
      const cat = c.cat;
      if (cat && (c.night ?? 0) > 0.6 && scene.milkwood && Math.hypot(cat.x - scene.milkwood.x, cat.z - scene.milkwood.z) < 40) call("owl", { at: owlAt(), delay: 1.5, gain: 0.9 });
      if (cat && c.interest && /penguin/.test(c.interest.kind ?? "") && Math.hypot(c.interest.x - cat.x, c.interest.z - cat.z) < 10)
        world.haw({ at: { x: c.interest.x, z: c.interest.z }, ref: 8, t: ctx.currentTime + 0.6 + core.random() * 0.4 });
      // The lighthouse throws the meow back, late and dark.
      if (cat && scene.lighthouse) {
        const d = Math.hypot(cat.x - scene.lighthouse.x, cat.z - scene.lighthouse.z);
        if (d > 12 && d < 40) cues.towerEcho(d);
      }
      return length;
    },
    chirrup() {
      if (live()) foley.chirrup();
    },
    splash(strength, pan = 0) {
      if (live()) foley.splash(strength, pan);
    },
    // Swimming is driven from update (cat.swim); kept for main.js.
    setSwim() {},
    shake() {
      if (live()) foley.shake();
    },
    jump() {
      if (live()) foley.jump();
    },
    land(speed, surface = 2, info = {}) {
      if (!live()) return;
      foley.land(speed, info.exact ? surface : surfaceFor(surface, info));
    },
    setPurr(on) {
      if (!mix) return;
      foley.setPurr(on && enabled);
    },
    // A boat event (boat.js events) with the boat's state for placing it.
    boatEvent(e, b = {}) {
      if (live()) world.boatEvent(e, b);
    },
    // A wildlife event ({ source, type, x, z, gain }).
    wild(e) {
      if (live()) world.wild(e);
    },
    // Inside a place that changes how things sound ("boiler" or null).
    setInside(where) {
      if (mix) setInside(where);
    },
    // Tests and the audition page: the engine's parts.
    get _qa() {
      return mix ? { ctx, mix, core, beds, foley, weather, world, cues, score, calls } : null;
    },
    dispose() {
      if (!context) ctx?.close();
      ctx = null;
    },
  };

  // The waking-light and story cues, each `state.sound.<name>?.(...)`.
  for (const name of [...WAKING_CUES, ...STORY_CUES.map(camel), "cue"])
    api[name] = (...args) => (live() && cues ? cues[name]?.(...args) : null);

  function owlAt() {
    const m = scene.milkwood;
    return { x: m.x + 1.5, z: m.z - 1, y: m.y ?? 6 };
  }

  function placeAmbience(cat, c) {
    const near = (p, r) => p && Math.hypot(cat.x - p.x, cat.z - p.z) < r;
    const night = (c.night ?? 0) > 0.6;
    if (near(scene.wreck, 40) && core.random() < 0.35) cues.boilerHum({ x: scene.wreck.x, z: scene.wreck.z, y: 0.5 });
    if (near(scene.pool, 25) && core.random() < 0.5) cues.poolDrip({ x: scene.pool.x, z: scene.pool.z, y: 0 });
    if (near(scene.milkwood, 30) && (c.wind ?? 0) > 4 && core.random() < 0.4) cues.crownWind(scene.milkwood, { lit: night && (c.levels?.fireflies ?? 0) > 0.5 });
    if (near(scene.lighthouse, 15) && (c.lamp?.lit ?? 0) > 0.5) world.clockwork({ at: { x: scene.lighthouse.x, z: scene.lighthouse.z, y: 2 }, ref: 6 }, 4, 1);
    else if (near(scene.lighthouse, 40) && (c.wind ?? 0) > 6 && core.random() < 0.3 && scene.roofs[0]) cues.shutter(scene.roofs[0]);
  }

  return api;
}

function defaultStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function readPref(storage, key, fallback) {
  try {
    const value = storage?.getItem(key);
    return value === null || value === undefined ? fallback : value === "1";
  } catch {
    return fallback;
  }
}

function writePref(storage, key, on) {
  try {
    storage?.setItem(key, on ? "1" : "0");
  } catch {
    // Remembered for this visit only.
  }
}
