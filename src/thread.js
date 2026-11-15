// The thread, the score and the keepsake, joined up for main.js: discoveries
// and their field notes, the score's inputs, photo mode, the arrival title,
// sit-and-watch, sleeping through to dawn and the hint that teaches by doing.
// main.js calls it from a few marked hooks; it reads main's `state` but only
// writes the few things it owns (the preview minutes, through `preview`).
//
// For other modules (via state.thread):
//   discoveries.add(pois)        { id, title, x, z, r, kind?, scope?, when?, hold? }
//   hear(name, { x, z, y? }, options?)  sound.play with distance and pan from the cat
//   setSpectacles(fn)            fn() → [{ id, title?, visible 0…1, direction? [e,u,n] }]
import { createDiscoveries, islandDiscoveries } from "./discoveries.js";
import { createPhotoMode } from "./photo-mode.js";
import { createArrival, createLapse, createFindLine, createGiftCard, createLessons, createNotesPanel, createWatch } from "./moments.js";
import { createJourney } from "./journey.js";
import { capeTime, capeMinutes } from "./astronomy.js";

const TICK = 0.25;

export function createThread({ state, signal, reduced, capture, preview, light = false }) {
  const $ = (selector) => document.querySelector(selector);
  const touch = matchMedia("(pointer: coarse)").matches;
  const isReduced = () => reduced.matches;
  const body = document.body;
  let tick = 0;
  let clock = 0;
  const seconds = () => performance.now() / 1000;
  let lastInput = performance.now();
  let spectacles = () => [];
  let gaze = null;
  const wakingGaze = { x: 0, y: 0, z: 0, near: false, kind: "light" }; // waking: the kindled light
  let nextGaze = 12;
  let attached = false;
  let walkFrom = null;
  // How long the cat has been moving about at the pool's rim or the
  // milkwood's limb (the sit lesson).
  let perchFor = 0;

  const findLine = createFindLine($("#find-line"), { reduced: isReduced });
  const discoveries = createDiscoveries({
    seed: state.seed,
    signal,
    onFind(found) {
      notes.changed();
      // A line only when the world has just answered something the cat did,
      // saying what happened (story-and-wow.md 1: `the boiler rings`, `the
      // seal wins`…): a find that carries its own `line`. Everything else
      // goes quietly into the notes.
      if (!found.line) return;
      state.sound.play("discover");
      findLine.show(found.line);
    },
  });
  const notes = createNotesPanel({
    toggle: $("#notes-toggle"),
    panel: $("#notes-panel"),
    list: () => discoveries.list(),
    signal,
    // The real clock's time of each find; none while the world shows a
    // previewed hour (they would disagree with it).
    time: (at) => (state.debugMinutes === null ? capeTime(new Date(at)) : ""),
    lit: () => journey.lit,
    onBeginAgain: () => journey.beginAgain(),
  });
  // The story: the fallen star, the lights and the ending (journey.js).
  // (sky: the ending's lapse, through the dawn lapse's machinery.)
  const sky = {
    run: (keys, options) => lapse?.run(keys, options),
    running: () => Boolean(lapse?.scripted),
    live: () => lapse?.live(),
    nowMinutes: () => nowMinutes(),
    liveMinutes: () => {
      const now = new Date();
      return capeMinutes(now) + now.getSeconds() / 60;
    },
  };
  const journey = createJourney({ state, card: createGiftCard($("#gift-card"), { reduced: isReduced }), findLine, now: () => seconds(), onChange: (quiet) => (quiet ? notes.refresh() : notes.changed()), sky, reduced: isReduced });
  const lessons = createLessons({ el: $("#hint"), touch, reduced: isReduced });
  const arrival = createArrival($("#arrival"), { reduced: isReduced });
  // No WebGPU, or reduced motion: the header is simply there.
  if (!navigator.gpu || isReduced()) arrival.skip();
  else findLine.pause(true);

  const photo = createPhotoMode({
    bar: $("#photo-bar"),
    button: $("#photo"),
    guide: $("#photo-guide"),
    flash: $("#photo-flash"),
    signal,
    reduced: isReduced,
    touch,
    capture,
    caption() {
      const weather = state.weather?.description;
      return ["cape town", `${capeTime(state.date)} sast`, weather].filter(Boolean).join(" · ");
    },
    onChange({ active }) {
      state.walker?.freeCamera(active);
      findLine.pause(active || body.dataset.arrival !== "done");
      if (active) {
        watch?.stop();
        lapse?.stop("photo");
        lessons.did("photo");
      }
    },
  });

  // Built once the walker exists.
  let watch = null;
  let lapse = null;

  const music = $("#music");
  const sync = () => {
    $("#sound")?.setAttribute("aria-pressed", String(state.sound.enabled));
    music?.setAttribute("aria-pressed", String(state.sound.music));
    if (music) music.disabled = !state.sound.enabled;
  };
  sync();
  $("#sound")?.addEventListener("click", () => queueMicrotask(sync), { signal });
  music?.addEventListener(
    "click",
    () => {
      state.sound.start();
      state.sound.setMusic(!state.sound.music);
      sync();
    },
    { signal },
  );

  return {
    discoveries,
    photo,
    // The world is built: seed the island's own discoveries and the
    // walker-driven moments.
    attach() {
      if (attached || !state.walker) return;
      attached = true;
      discoveries.add(islandDiscoveries());
      journey.attach();
      watch = createWatch({ walker: state.walker });
      lapse = createLapse({
        preview,
        onStart: () => {
          watch.stop();
          findLine.show("dreaming of dawn");
        },
      });
    },
    // The loading veil has lifted.
    arrive() {
      arrival.play(() => {
        findLine.pause(photo.active);
        lessons.begin(seconds());
        journey.meet();
      });
      if (body.dataset.arrival === "done") {
        lessons.begin(seconds());
        journey.meet();
      }
    },
    fallback() {
      arrival.skip();
      findLine.pause(false);
      $("#photo")?.setAttribute("hidden", "");
    },
    // Time stands still while a photo is paused (the camera does not).
    get timeScale() {
      return photo.paused ? 0 : journey.timeScale;
    },
    // The cat ignores walking input in photo mode.
    get holdsCat() {
      return photo.active || journey.holdsCat;
    },
    journey,
    // What the cat's head follows: a critter if there is one, or now and
    // then, while it sits, the direction of the nearest place not yet found.
    interest(critter) {
      // waking: for its first five seconds the cat watches the light being
      // kindled (not near: it does not crouch or stalk it).
      const w = state.magic?.waking;
      if (w && w.age < 5) {
        wakingGaze.x = w.x; wakingGaze.y = w.y; wakingGaze.z = w.z;
        return wakingGaze;
      }
      return critter ?? gaze;
    },
    // Keys first come here; true means taken.
    key(event) {
      const key = event.key.toLowerCase();
      if (photo.key(key)) return true;
      if (photo.active && (key === "+" || key === "=" || key === "-")) {
        state.walker?.zoom(key === "-" ? 1.15 : 1 / 1.15);
        return true;
      }
      return false;
    },
    // Any input: hand the view back, wake from the dream.
    input(kind) {
      lastInput = performance.now();
      journey.nudge(); // the first input brings the fall
      watch?.stop();
      if (lapse?.active) lapse.stop("woke");
      if (kind) lessons.did(kind, seconds());
    },
    did(kind) {
      lessons.did(kind, seconds());
      if (kind === "meow") journey.call();
    },
    // From main's updateCat, after the walker. dt is scene time (0 while a
    // photo is paused), realDt the wall clock.
    update(dt, realDt) {
      const cat = state.walker?.cat;
      if (!cat) return;
      // Wall-clock seconds: holds and lessons should not slow with the frame rate.
      clock = seconds();
      if (photo.active) orbitWithKeys(realDt);
      journey.update(realDt, { celestial: state.celestial, interest: state.landscape?.interest, blocked: photo.active || body.dataset.arrival !== "done", trying: performance.now() - lastInput < 1500 });
      // The lapse runs smoothly (its sky is per frame; labels throttled).
      lapse?.update(
        {
          asleep: cat.sit > 0.95 && cat.sleepy > 0.3,
          sunAltitude: state.celestial.sunAltitude,
          nowMinutes: nowMinutes(),
          date: new Date(),
          blocked: photo.active || isReduced(),
        },
        realDt,
      );
      tick += realDt;
      if (tick < TICK) return;
      const step = tick;
      tick = 0;
      journey.tick();
      const visible = spectacles() ?? [];
      const context = { celestial: state.celestial, weather: state.weather, interest: state.landscape?.interest, spectacles: visible };
      discoveries.update(cat, clock, context);
      const idleInput = (performance.now() - lastInput) / 1000;
      watch?.update({ cat, idleInput, celestial: state.celestial, spectacles: visible, blocked: photo.active || lapse?.active || isReduced() || Boolean(journey.ceremony) });
      updateGaze(cat, step);
      walkFrom ??= { x: cat.x, z: cat.z };
      if (Math.hypot(cat.x - walkFrom.x, cat.z - walkFrom.z) > 1.5) lessons.did("walk", clock);
      if (cat.running) lessons.did("run", clock);
      const scene = state.celestial.scene;
      perchFor = perchedAt(cat) && Math.abs(cat.speed) > 0.1 ? perchFor + step : perchedAt(cat) ? perchFor : 0;
      lessons.update({
        now: clock,
        moving: Math.abs(cat.speed) > 0.3,
        landed: journey.landed,
        answers: answersMeow(cat),
        perch: perchFor > 8,
        lights: journey.quest?.count ?? 0,
        golden: scene > 0.4 && scene < 1.4,
        hidden: photo.active || watch?.watching || lapse?.active || body.dataset.arrival !== "done",
      });
      state.sound.setScore({
        sunAltitude: state.celestial.sunAltitude,
        sunAzimuth: state.celestial.sunAzimuth,
        cover: state.weather?.cover ?? 0,
        rain: state.weather?.rain ?? 0,
        asleep: cat.sit > 0.95 && cat.sleepy > 0.3,
        spectacle: visible.reduce((m, s) => Math.max(m, s?.visible ?? 0), 0),
      });
    },
    // A sound from somewhere on (or off) the island, heard from the cat.
    hear(name, at = {}, options = {}) {
      const cat = state.walker?.cat;
      if (!cat || !Number.isFinite(at.x) || !Number.isFinite(at.z)) return state.sound.play(name, options);
      const dx = at.x - cat.x;
      const dz = at.z - cat.z;
      const flat = Math.hypot(dx, dz);
      const yaw = state.walker.camera.yaw;
      const pan = flat > 0.01 ? (dx * Math.cos(yaw) - dz * Math.sin(yaw)) / flat : 0;
      return state.sound.play(name, { distance: Math.hypot(flat, (at.y ?? cat.y) - cat.y), pan: pan * 0.8, ...options });
    },
    setSpectacles(fn) {
      spectacles = typeof fn === "function" ? fn : () => [];
    },
    dispose() {
      findLine.dispose();
    },
  };

  function nowMinutes() {
    if (state.debugMinutes !== null) return state.debugMinutes;
    const now = new Date();
    return capeMinutes(now) + now.getSeconds() / 60;
  }

  // Somewhere that answers a meow (the meow lesson): the wreck's boiler,
  // within 40 m of the lighthouse, on the boat's hull.
  function answersMeow(cat) {
    const near = (id, r) => {
      const p = state.landscape?.pois?.find((q) => q.id === id);
      return p && Math.hypot(cat.x - p.x, cat.z - p.z) < r;
    };
    return Boolean(near("wreck", 4) || near("lighthouse", 40) || near("boat", 3));
  }
  // At the pool's rim or under the milkwood's low limb (the sit lesson).
  function perchedAt(cat) {
    const near = (id, r) => {
      const p = state.landscape?.pois?.find((q) => q.id === id);
      return p && Math.hypot(cat.x - p.x, cat.z - p.z) < r;
    };
    return Boolean(near("pool", 4) || near("milkwood", 5));
  }

  // Photo mode: arrow keys orbit and tilt.
  function orbitWithKeys(dt) {
    const keys = state.keys;
    const x = (keys.has("arrowright") ? 1 : 0) - (keys.has("arrowleft") ? 1 : 0);
    const y = (keys.has("arrowup") ? 1 : 0) - (keys.has("arrowdown") ? 1 : 0);
    if (x || y) state.walker.orbit(-x * dt * 1.1, y * dt * 0.6);
  }

  // Now and then, while it sits, the cat's head turns toward the nearest
  // place it has not found yet, as if it had heard something there.
  function updateGaze(cat, step) {
    nextGaze -= step;
    const near = discoveries.nearest();
    const settled = cat.sit > 0.8 && cat.idle > 6 && cat.sleepy < 0.2 && !photo.active;
    if (!settled || !near || near.distance > 140) {
      gaze = null;
      nextGaze = Math.max(nextGaze, 6);
      return;
    }
    if (gaze && nextGaze < -3.5) {
      gaze = null;
      nextGaze = 18 + Math.random() * 14;
    } else if (!gaze && nextGaze <= 0) {
      const dx = near.x - cat.x;
      const dz = near.z - cat.z;
      const d = Math.hypot(dx, dz) || 1;
      gaze = { x: cat.x + (dx / d) * 3, y: cat.y + 0.55, z: cat.z + (dz / d) * 3, near: false, kind: "" };
    }
  }
}
