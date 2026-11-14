// The journey: the wisp, the quest and the ceremonies, staged for the
// thread. thread.js builds it, calls it every frame and a few times a
// second, and asks it whether the cat is held and how fast time runs.
//
// It writes the shared record (magic.js) the other layers read:
//   magic.wisp   updated in place every frame (position, glow, colour, visible)
//   magic.waking a new record at each waking (its kindled light, waking.js)
//   magic.call   a new object at each meow
// and wakes gifts through the quest (quest.js → magic.wake).
import { createQuest } from "./quest.js";
import { createWispMind } from "./wisp-mind.js";
import { GIFT_COLOURS } from "./magic.js";
import { WAKE_LIGHT, createWaking, wakingSource, frontArrival } from "./waking.js";
import { SWIM_LIMIT } from "./walker.js";
import { groundHeight } from "./terrain.js";

// One line of type per gift, in the site's voice.
export const GIFT_LINES = {
  fireflies: "the old tree lets its lights go",
  tideglow: "the tide remembers light",
  lamp: "the lamp is lit again",
  stars: "the sky leans close",
  seafolk: "the sea comes close to listen",
  boat: "the boat remembers the water",
};
const FINALE = { small: "six gifts · one island", big: "the island is awake", after: "stay as long as you like" };

// Seconds into a ceremony (wall clock), from the moment the wisp is gone
// into the keepsake: when the card shows, when time runs again, when the
// camera comes home and the cat is let go.
// (The card waits until the light has arrived; time slows a little, for a
// moment: the light itself runs on wall time, waking.js.)
const WAKE = { card: 2.4, cardHold: 3.4, hold: 1.2, slow: 0.6, release: 4, camHome: 5, end: 6.5 };
const FINALE_TIME = { wake: 2.4, card: 3.8, cardHold: 6.5, hold: 4.5, camHome: 13, end: 16 };
const WHITE = [1, 0.95, 0.85];
// Each ceremony's camera: low behind the cat while the wisp dives (elevation,
// distance), then easing wider to take in the place (`wide`). Under the
// milkwood's canopy it stays low; at the lighthouse it stands well back.
export const SHOTS = {
  default: { elevation: 0.32, distance: 7, wide: [0.4, 8.5] },
  fireflies: { elevation: 0.22, distance: 6, wide: [0.26, 7] },
  // Low and far, so the lit lantern at the top of the tower is in the frame.
  lamp: { elevation: 0.08, distance: 11, wide: [0.08, 14] },
  // The sky is the picture: the camera comes down level with the cat so
  // the upper half of the frame is the sky leaning close.
  stars: { elevation: 0.16, distance: 8.5, wide: [0.1, 10.5], camHome: 6.5, end: 8 },
  // Above the scrub behind the pool, looking out to where the sea's folk come.
  seafolk: { elevation: 0.62, distance: 8, wide: [0.75, 10] },
  // The boat rises off its logs and glides down to its cove (8 s): the
  // camera stands back and turns with the hull, and holds longer.
  boat: { elevation: 0.3, distance: 8, wide: [0.36, 12], follow: true, camHome: 8.5, end: 10 },
};

// move: a ceremony's dive and wide shots, searched for a clear view
// (walker.frameShot): the place's foot and top (the lantern, the crown) as
// the subject, every plant crown (and the milkwood's) as something to keep
// the lens out of and look past. Exported for tests/movement.test.js.
export function ceremonyFrames(walker, { place, gift, ground, shot, yaw, crown = null, canopies = [], fov = 1 }) {
  const tops = { lamp: 17.6, fireflies: crown ? crown.top - ground : 7, stars: 3, tideglow: 2.6, boat: 1.4, seafolk: 0.8 };
  // (r: how far out from its centre its own solids reach: a line to its
  // top may end anywhere inside that.)
  const radii = { lamp: 3.5, fireflies: crown ? crown.radius : 6, stars: 1.5, tideglow: 4, boat: 2.5, seafolk: 2 };
  const subject = { x: place.x, z: place.z, y0: ground, y1: ground + (tops[gift] ?? 2), r: radii[gift] ?? 2 };
  const all = crown ? [...canopies, { x: crown.x, z: crown.z, y: crown.top - crown.radius * 0.45, r: crown.radius }] : canopies;
  const frame = (elevation, distance) => walker.frameShot({ subject, yaw, elevation, distance, canopies: all, fov });
  return { subject, dive: frame(shot.elevation, shot.distance), wide: frame(shot.wide[0], shot.wide[1]) };
}

export function createJourney({ state, card, findLine, now, onChange = () => {} }) {
  const magic = state.magic;
  let quest = null;
  let mind = null;
  let meetAt = Infinity;
  let ceremony = null;
  let scale = 1;
  let meowAt = -Infinity;
  let answered = true;
  let meteorUntil = -Infinity;
  let listening = false;
  let last = null;
  // A breath between one ceremony and the next (stars at the summit, then the finale).
  let restUntil = 0;
  // The wisp carries the colour of the last gift it woke.
  let carry = null;
  const ctx = { cat: null, target: null, night: 0, call: false, interest: null, meteor: false, sunset: false, gifts: 0 };

  function colourFor(gift) {
    const c = GIFT_COLOURS[gift] ?? WHITE;
    const k = gift === "finale" ? 0.3 : 0.6;
    for (let i = 0; i < 3; i++) magic.wisp.colour[i] = WHITE[i] * (1 - k) + c[i] * k;
  }

  // The follow camera, eased toward a framing while a ceremony plays
  // (walker.freeCamera's goal, steered by orbit/zoom deltas we track).
  const cam = { yaw: 0, elevation: 0, distance: 0, home: null, free: false };
  function camStart() {
    const c = state.walker.camera;
    cam.home = { yaw: c.yaw, elevation: c.elevation, distance: c.distance };
    cam.yaw = c.yaw;
    cam.elevation = c.elevation;
    cam.distance = c.distance;
    state.walker.freeCamera(true);
    cam.free = true;
  }
  function camAim(yaw, elevation, distance, rate, dt) {
    if (!cam.free) return;
    const k = 1 - Math.exp(-dt * rate);
    const dy = wrap(yaw - cam.yaw) * k;
    const de = (elevation - cam.elevation) * k;
    const target = cam.distance + (distance - cam.distance) * k;
    state.walker.orbit(dy, de);
    state.walker.zoom(target / cam.distance);
    cam.yaw += dy;
    cam.elevation += de;
    cam.distance = target;
  }
  function camEnd() {
    state.walker.lookAt?.(null);
    if (!cam.free) return;
    cam.free = false;
    state.walker.freeCamera(false);
  }

  function start(event) {
    const place = event.place;
    const surface = state.walker.surface;
    const ground = surface(place.x, place.z);
    const cat = state.walker.cat;
    // waking: where the gift's light is kindled (the hollow, the furnace
    // mouth, the lantern room…): the wisp dives into it.
    const source = event.type === "finale" ? null : wakingSourceFor(state, place.gift);
    ceremony = {
      type: event.type,
      place,
      gift: place.gift,
      at: now(),
      goneAt: null,
      source,
      y: source ? source[1] : ground + (event.type === "finale" ? 2 : 1.1),
      // The sky only leans close in the dark: by day the stars shot is the usual one.
      shot: (place.gift === "stars" && (state.celestial?.scene ?? 0) < 1.5 ? null : SHOTS[event.type === "finale" ? "finale" : place.gift]) ?? SHOTS.default,
      // Look from the cat toward the place, so it stands beyond the cat.
      yaw: Math.atan2(place.x - cat.x, place.z - cat.z),
      carded: false,
      woke: false,
    };
    // move: each shot moved to where it has a clear view of the place.
    ceremony.frames = event.type === "finale" ? null : frameShots(ceremony, ground);
    findLine.pause(true);
    if (globalThis.document) document.body.dataset.ceremony = "true";
    camStart();
    // The finale: the wisp circles up round the cat itself, in frame.
    if (event.type === "finale") mind.soar(cat.x, cat.y + 0.7, cat.z);
    else mind.dive(source ? source[0] : place.x, ceremony.y, source ? source[2] : place.z);
    state.sound.ceremony?.(event.type === "finale" ? "finale" : place.gift);
  }

  // move: the dive and the wide shot, each searched near the one asked for
  // (walker.frameShot) so the lens is not in a bush, a hull or a trunk, the
  // place is seen past the plants and the rock, and its top (the lantern,
  // the crown) is in the frame with the cat. Subjects: foot and top.
  function frameShots(c, ground) {
    if (!state.walker.frameShot) return null;
    return ceremonyFrames(state.walker, {
      place: c.place, gift: c.gift, ground, shot: c.shot, yaw: c.yaw,
      crown: state.landscape?.places?.crown, canopies: state.landscape?.obstacles?.canopies ?? [],
      fov: ((state.landscape?.camera?.fov ?? 58) * Math.PI) / 180,
    });
  }

  function wakeNow() {
    const c = ceremony;
    const gift = quest.wake();
    if (!gift) return;
    c.woke = true;
    carry = gift;
    colourFor(gift);
    onChange();
    // waking: the gift's light is kindled at its source and reaches out
    // (waking.js). Not the finale (no blast from the wisp) and not the stars
    // (the beacon has no waking of its own; its light is the ending's, story-and-wow.md 9).
    if (gift !== "finale" && gift !== "stars" && c.source) {
      magic.waking = createWaking(gift, c.source, { follow: gift === "boat" ? boatLantern : null });
      cues = wakingCues(gift, c.source);
    }
  }

  // The boat's lantern while it floats (boat.js), so the light moves with it.
  function boatLantern() {
    const l = state.boat?.lantern;
    return l && l[3] > 0.001 ? [l[0], l[1], l[2]] : null;
  }

  // waking: the diegetic sound cues, scheduled from the same curves as the
  // light (so they cannot drift), fired as the waking's wall clock passes
  // each. Named hooks only: sound.js decides what each sounds like
  // (waking-light.md section 6); a missing hook is silent.
  let cues = [];
  function wakingCues(gift, at) {
    const spec = WAKE_LIGHT[gift];
    const cat = state.walker?.cat;
    const dCat = cat ? Math.hypot(cat.x - at[0], (cat.y ?? at[1]) - at[1], cat.z - at[2]) : Infinity;
    const list = [
      { t: 0, cue: "hush" },
      { t: 0.35, cue: "kindle" },
      ...(gift === "lamp" ? [0.8, 1.5] : [0.55, 0.75]).map((t) => ({ t, cue: "gutter" })),
      { t: 0.35, cue: "reach" },
      { t: frontArrival(dCat, spec), cue: "arrive" },
      { t: 1, cue: "glints", count: { fireflies: 12, tideglow: 10, boat: 4 }[gift] ?? 0, until: 7 },
      { t: 6, cue: "settle" },
    ];
    if (gift === "seafolk") list.push({ t: 4, cue: "answer" });
    if (gift === "lamp") list.push({ t: 2.2, cue: "clockwork" });
    // (About when the front meets the swash: the light goes into the water.)
    if (gift === "tideglow") list.push({ t: 2, cue: "enter" });
    return list.filter((c) => Number.isFinite(c.t)).sort((a, b) => a.t - b.t);
  }
  function playCues() {
    const w = magic.waking;
    if (!w || !cues.length) return;
    while (cues.length && w.age >= cues[0].t) {
      const { cue, ...rest } = cues.shift();
      state.sound?.[cue]?.({ gift: w.gift, x: w.x, y: w.y, z: w.z, ...rest });
    }
  }

  function stage(dt) {
    const c = ceremony;
    const t = now() - c.at;
    const cat = state.walker.cat;
    if (c.type === "finale") {
      if (!c.woke && t > FINALE_TIME.wake) wakeNow();
      if (!c.carded && t > FINALE_TIME.card) {
        c.carded = true;
        card?.show(FINALE.small, FINALE.big, FINALE_TIME.cardHold, true);
      }
      // A slow rise and turn over the island, then home.
      // Wide and low enough to hold the sky and the bay, turning slowly.
      if (t < FINALE_TIME.camHome) camAim(c.yaw + Math.PI + t * 0.11, 0.3 + Math.min(0.2, t * 0.02), 11, 0.4, dt);
      else camAim(cam.home.yaw, cam.home.elevation, cam.home.distance, 1.4, dt);
      const held = t > FINALE_TIME.wake && t < FINALE_TIME.wake + FINALE_TIME.hold;
      scale += ((held ? 0.45 : 1) - scale) * Math.min(1, dt * (held ? 1.5 : 0.8));
      if (t > FINALE_TIME.end) finish();
      return;
    }
    if (c.goneAt === null && mind.stage === "gone") {
      c.goneAt = now();
      wakeNow();
    }
    // Safety: a dive that never got there still wakes.
    if (c.goneAt === null && t > 5) {
      c.goneAt = now();
      wakeNow();
    }
    const g = c.goneAt === null ? -1 : now() - c.goneAt;
    // (Seafolk: the card waits for the sea to answer, not before.)
    if (!c.carded && g > (c.gift === "seafolk" ? 4.2 : WAKE.card)) {
      c.carded = true;
      card?.show(c.place.title?.toLowerCase?.() ?? "", GIFT_LINES[c.gift] ?? "", WAKE.cardHold, false);
    }
    // Ease back, low, to take it in (the place beyond the cat), then home.
    const s = c.shot;
    let yaw = c.yaw;
    // The boat: keep the hull in the picture as it glides to its cove.
    const ride = s.follow ? state.boat?.ride : null;
    if (ride?.cove && g >= 0) {
      const k = ride.ride?.state === "launching" ? ride.ride.launch : ride.ride?.state === "ready" ? 0 : 1; // boat: ready on its logs until the cat launches it
      const hx = c.place.x + (ride.cove.x - c.place.x) * k;
      const hz = c.place.z + (ride.cove.z - c.place.z) * k;
      yaw = Math.atan2(hx - cat.x, hz - cat.z);
    }
    const f = c.frames ? (g < 0 ? c.frames.dive : c.frames.wide) : null;
    if (g < (s.camHome ?? WAKE.camHome)) {
      // (The searched shot's turn from the straight-on one, kept as the
      // boat glides and the straight-on yaw follows it.)
      const turn = f ? f.yaw - c.yaw : 0;
      camAim(yaw + turn, f ? f.elevation : g < 0 ? s.elevation : s.wide[0], f ? f.distance : g < 0 ? s.distance : s.wide[1], g < 0 ? 1.6 : s.follow ? 0.9 : 0.45, dt);
      if (f) state.walker.lookAt?.(f.look, 1);
    } else {
      camAim(cam.home.yaw, cam.home.elevation, cam.home.distance, 1.8, dt);
      state.walker.lookAt?.(null);
    }
    // Time holds its breath, then runs again.
    const held = g >= 0 && g < WAKE.hold;
    scale += ((held ? WAKE.slow : 1) - scale) * Math.min(1, dt * (held ? 3 : 1));
    if (g > (s.end ?? WAKE.end)) finish();
    void cat;
  }

  function finish() {
    const c = ceremony;
    ceremony = null;
    restUntil = now() + 4;
    camEnd();
    scale = 1;
    mind.end();
    findLine.pause(false);
    if (globalThis.document) delete document.body.dataset.ceremony;
    if (c?.type === "finale") findLine.show(FINALE.after);
  }

  return {
    // The world is built.
    attach() {
      quest = createQuest({ seed: state.seed, places: state.landscape?.pois ?? [], magic });
      mind = createWispMind({ seed: state.seed, obstacles: state.landscape?.obstacles, surface: state.walker.surface, swimLimit: SWIM_LIMIT });
      state.landscape?.wisp?.follow(magic.wisp, state.walker.surface, magic);
      const restored = [...quest.keepsakes.map((k) => k.gift), "finale"].filter((g) => magic.isAwake(g));
      carry = restored.at(-1) ?? null;
      colourFor(carry);
      onChange(true);
    },
    get quest() {
      return quest;
    },
    get mind() {
      return mind;
    },
    get ceremony() {
      return ceremony;
    },
    // The arrival title has gone: the wisp comes a few seconds later.
    meet(delay = 3) {
      meetAt = Math.min(meetAt, now() + delay);
    },
    call() {
      const cat = state.walker?.cat;
      if (!cat) return;
      magic.call = { at: magic.clock, x: cat.x, z: cat.z };
      meowAt = now();
      answered = false;
      ctx.call = true;
    },
    // A discovery of this keepsake is covered by its ceremony (no line).
    covers(id) {
      return Boolean(ceremony && ceremony.place.id === id) || Boolean(quest?.pending?.id === id);
    },
    get holdsCat() {
      if (!ceremony) return false;
      const t = now() - ceremony.at;
      return ceremony.type === "finale" ? t < FINALE_TIME.camHome : ceremony.goneAt === null || now() - ceremony.goneAt < WAKE.release;
    },
    get timeScale() {
      return scale;
    },
    // Every frame (wall-clock dt).
    update(dt, { celestial, interest, blocked = false, trying = false }) {
      const cat = state.walker?.cat;
      if (!cat || !mind) return;
      if (!listening && state.skyEvents) {
        listening = true;
        state.skyEvents.on((e) => {
          if (e.type === "meteor") meteorUntil = now() + 3.5;
        });
      }
      if (mind.mode === "hidden" && now() > meetAt && !blocked) mind.appear(cat);
      if (ceremony) stage(dt);
      playCues(); // waking: its sound cues
      ctx.cat = cat;
      ctx.target = ceremony ? null : quest.target(cat.x, cat.z);
      if (ctx.target !== last) last = ctx.target;
      ctx.night = smooth(1, 2, celestial?.scene ?? 0);
      ctx.interest = interest?.near ? interest : null;
      ctx.meteor = now() < meteorUntil;
      const sun = celestial?.sunAltitude ?? 30;
      ctx.sunset = sun < 6 && sun > -4 && (celestial?.sunAzimuth ?? 0) > 180;
      ctx.gifts = quest.count;
      ctx.trying = trying;
      // Towing the boat, the wisp is where the boat put it (boat.js afterThread).
      if (magic.afloat && mind.visible) mind.place(magic.wisp.position[0], magic.wisp.position[1], magic.wisp.position[2]);
      mind.update(dt, ctx);
      ctx.call = false;
      // The wisp answers a meow with a little chime once it is close.
      if (!answered && now() - meowAt > 0.25 && (mind.distanceTo(cat.x, cat.z) < 1.8 || now() - meowAt > 1.6)) {
        answered = true;
        if (mind.visible) {
          const p = mind.position;
          state.thread?.hear?.("wisp", { x: p.x, z: p.z, y: p.y });
        }
      }
      const w = magic.wisp;
      const p = mind.position;
      w.position[0] = p.x;
      w.position[1] = p.y;
      w.position[2] = p.z;
      w.glow = mind.glow;
      w.visible = mind.visible;
    },
    // A few times a second.
    tick() {
      const cat = state.walker?.cat;
      if (!cat || !quest) return;
      const event = quest.update(cat, { busy: Boolean(ceremony) || now() < restUntil });
      if (event) start(event);
    },
    // The field notes' marks: each gift, awake or not, its line and colour.
    gifts() {
      if (!quest) return [];
      return quest.keepsakes.map((k) => ({ gift: k.gift, awake: magic.isAwake(k.gift), line: GIFT_LINES[k.gift], colour: GIFT_COLOURS[k.gift] }));
    },
    beginAgain() {
      if (ceremony) finish();
      quest?.beginAgain();
      magic.waking = null;
      cues = [];
      mind?.reset();
      carry = null;
      colourFor(null);
      meetAt = now() + 2;
    },
  };
}

// waking: where a gift's light is kindled on this island (coast metres),
// from what the land exposes (landscape.js wakingPlaces). The boat's is its
// lantern while it floats.
export function wakingSourceFor(state, gift) {
  const land = state.landscape;
  if (!land) return null;
  if (gift === "boat") {
    const l = state.boat?.lantern;
    if (l && l[3] > 0.001) return [l[0], l[1], l[2]];
  }
  // (The hollow faces the cat; the furnace mouth faces inland, since the
  // practical it resolves into must stay put.)
  const cat = state.walker?.cat;
  return wakingSource(gift, {
    pois: land.pois ?? [], crown: land.wakingPlaces?.crown, beacon: land.wakingPlaces?.beacon, blockers: land.obstacles?.blockers ?? [],
    surface: groundHeight, toward: gift === "fireflies" && cat ? [cat.x, cat.z] : undefined,
  });
}

// `?perf` QA (waking-light.md section 9): skycope.waking.
//   freeze(gift, age)  hold that gift's waking at `age` wall seconds (its
//                      level held where it would be then); age < 0: asleep
//   play(gift)         run it live, without the ceremony camera
//   clear()            no waking; the frozen gift back to sleep
export function createWakingQA(state) {
  const magic = state.magic;
  let held = null;
  const rest = (next = null) => {
    if (held && held !== next) {
      magic.sleep(held);
      magic.levels[held] = 0;
    }
    held = null;
    magic.waking = null;
    magic.qaAsleep = null;
  };
  const start = (gift, age, frozen) => {
    rest(gift);
    const at = wakingSourceFor(state, gift);
    if (!at || !WAKE_LIGHT[gift]) return null;
    // (Awake to the quest throughout, so no ceremony starts under the QA.)
    magic.wake(gift, { quiet: true });
    held = gift;
    if (age < 0) {
      magic.qaAsleep = gift;
      magic.levels[gift] = 0;
      return null;
    }
    magic.levels[gift] = frozen ? 1 - Math.exp(-age / 2.5) : 0;
    magic.wakeAt[gift] = magic.clock - age;
    magic.waking = createWaking(gift, at, { age, frozen, follow: null });
    return magic.waking;
  };
  return {
    freeze: (gift, age) => start(gift, age, true),
    play: (gift) => start(gift, 0, false),
    clear: () => rest(),
    // (The live table, for calibration from the console.)
    table: WAKE_LIGHT,
    get now() {
      return magic.waking;
    },
  };
}

function wrap(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

function smooth(a, b, x) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
