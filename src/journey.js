// The journey: the wisp, the quest and the ceremonies, staged for the
// thread. thread.js builds it, calls it every frame and a few times a
// second, and asks it whether the cat is held and how fast time runs.
//
// It writes the shared record (magic.js) the other layers read:
//   magic.wisp   updated in place every frame (position, glow, colour, visible)
//   magic.pulse  a new object at each waking (the wave of light)
//   magic.call   a new object at each meow
// and wakes gifts through the quest (quest.js → magic.wake).
import { createQuest } from "./quest.js";
import { createWispMind } from "./wisp-mind.js";
import { GIFT_COLOURS, PULSE } from "./magic.js";
import { SWIM_LIMIT } from "./walker.js";

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
const WAKE = { card: 0.7, cardHold: 4.6, hold: 2.6, release: 5, camHome: 6.2, end: 8 };
const FINALE_TIME = { wake: 2.8, card: 4.5, cardHold: 9, hold: 6, camHome: 17, end: 20.5 };
const WHITE = [1, 0.95, 0.85];
// Each ceremony's camera: low behind the cat while the wisp dives (elevation,
// distance), then easing wider to take in the place (`wide`). Under the
// milkwood's canopy it stays low; at the lighthouse it stands well back.
const SHOTS = {
  default: { elevation: 0.32, distance: 7, wide: [0.42, 9.5] },
  fireflies: { elevation: 0.22, distance: 6, wide: [0.27, 7.5] },
  lamp: { elevation: 0.12, distance: 10, wide: [0.16, 13] },
  stars: { elevation: 0.3, distance: 7, wide: [0.48, 10] },
  // The boat rises off its logs and glides down to its cove (8 s): the
  // camera stands back and turns with the hull, and holds longer.
  boat: { elevation: 0.3, distance: 8, wide: [0.36, 12], follow: true, camHome: 10, end: 11.5 },
};

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
    if (!cam.free) return;
    cam.free = false;
    state.walker.freeCamera(false);
  }

  function start(event) {
    const place = event.place;
    const surface = state.walker.surface;
    const ground = surface(place.x, place.z);
    const cat = state.walker.cat;
    ceremony = {
      type: event.type,
      place,
      gift: place.gift,
      at: now(),
      goneAt: null,
      // The lighthouse's gift is its lamp: the wisp goes in at the top.
      y: ground + (event.type === "finale" ? 2 : place.gift === "lamp" ? 16.4 : 1.1),
      shot: SHOTS[event.type === "finale" ? "finale" : place.gift] ?? SHOTS.default,
      // Look from the cat toward the place, so it stands beyond the cat.
      yaw: Math.atan2(place.x - cat.x, place.z - cat.z),
      carded: false,
      woke: false,
    };
    findLine.pause(true);
    if (globalThis.document) document.body.dataset.ceremony = "true";
    camStart();
    // The finale: the wisp circles up round the cat itself, in frame.
    if (event.type === "finale") mind.soar(cat.x, cat.y + 0.7, cat.z);
    else mind.dive(place.x, ceremony.y, place.z);
    state.sound.ceremony?.(event.type === "finale" ? "finale" : place.gift);
  }

  function wakeNow() {
    const c = ceremony;
    const gift = quest.wake();
    if (!gift) return;
    c.woke = true;
    carry = gift;
    colourFor(gift);
    onChange();
    magic.pulse = {
      x: c.place.x,
      y: c.y,
      z: c.place.z,
      at: magic.clock,
      gift,
      colour: GIFT_COLOURS[gift],
      speed: PULSE.speed,
      reach: gift === "finale" ? PULSE.reach * 1.6 : PULSE.reach,
    };
    state.thread?.hear?.("wake", { x: c.place.x, z: c.place.z, y: c.y }, { gift });
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
    if (!c.carded && g > WAKE.card) {
      c.carded = true;
      card?.show(c.place.title?.toLowerCase?.() ?? "", GIFT_LINES[c.gift] ?? "", WAKE.cardHold, false);
    }
    // Ease back, low, to take it in (the place beyond the cat), then home.
    const s = c.shot;
    let yaw = c.yaw;
    // The boat: keep the hull in the picture as it glides to its cove.
    const ride = s.follow ? state.boat?.ride : null;
    if (ride?.cove && g >= 0) {
      const k = ride.ride?.state === "launching" ? ride.ride.launch : 1;
      const hx = c.place.x + (ride.cove.x - c.place.x) * k;
      const hz = c.place.z + (ride.cove.z - c.place.z) * k;
      yaw = Math.atan2(hx - cat.x, hz - cat.z);
    }
    if (g < (s.camHome ?? WAKE.camHome)) camAim(yaw, g < 0 ? s.elevation : s.wide[0], g < 0 ? s.distance : s.wide[1], g < 0 ? 1.6 : s.follow ? 0.9 : 0.45, dt);
    else camAim(cam.home.yaw, cam.home.elevation, cam.home.distance, 1.8, dt);
    // Time holds its breath, then runs again.
    const held = g >= 0 && g < WAKE.hold;
    scale += ((held ? 0.3 : 1) - scale) * Math.min(1, dt * (held ? 3 : 1));
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
      mind?.reset();
      carry = null;
      colourFor(null);
      meetAt = now() + 2;
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
