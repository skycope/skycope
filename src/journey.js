// The journey: the story (docs/design/story-and-wow.md), staged for the
// thread. A small light falls out of the sky onto the home beach and cannot
// climb home alone; it leads the cat from light to light, and each one lit
// lifts it a little higher; when the last is lit it goes home to the one
// empty place in the southern sky. thread.js builds this, calls it every
// frame and a few times a second, and asks it whether the cat is held and
// how fast time runs.
//
// It writes the shared record (magic.js) the other layers read:
//   magic.wisp    updated in place every frame (position, glow, colour, visible)
//   magic.waking  a new record at each light lit (its kindled light, waking.js)
//   magic.ending  the ending's sky while it plays and after (the south star)
//   magic.call    a new object at each meow
// and lights things through the quest (quest.js → magic.wake).
import { createQuest } from "./quest.js";
import { createWispMind } from "./wisp-mind.js";
import { WAKE_LIGHT, createWaking, wakingSource, frontArrival } from "./waking.js";
import { SWIM_LIMIT } from "./walker.js";
import { groundHeight } from "./terrain.js";
import { homeLandingPoint } from "./place-home.js";
import { dawnMinutes, duskMinutes } from "./moments.js";

// The ending's beats, seconds from the sit (story-and-wow.md 5): the light
// at the cat's nose; (by day) waiting high while the day runs down; the
// rise; the star; the Cross; the cat free; the card; the sky turning
// (`turn`, the lapse: `hours` of sky by night; by day dusk, night and dawn
// round to the same minute tomorrow); the last line.
export const ENDING = {
  night: { nose: 3, rise: 5, arrive: 13, cross: 14, free: 16, card: 16, turn: [18, 48], hours: 2, after: 48 },
  day: { nose: 3, wait: 5, dusk: [5, 20], rise: 20, arrive: 30, cross: 31, free: 24, card: 33, turn: [36, 56], dawn: [56, 66], after: 66 },
};
// After the night lapse, seconds per hour of sky to drift back to live.
const DRIFT = 46;

// One line of type per light, in the site's voice (story-and-wow.md 1).
export const GIFT_LINES = {
  boat: "a lantern for the water",
  fireflies: "the old tree lets its lights go",
  tideglow: "the tide remembers light",
  seafolk: "the sea comes close",
  lamp: "the lamp is lit again",
};
// Lights whose day face is weak: by day their card says to come back.
export const AFTER_DARK = { fireflies: "after dark", tideglow: "after dark" };
// Every other line the story writes.
export const LINES = {
  stillOn: "the lights are still on",
  stillUp: "it is still up there",
  stay: "stay as long as you like",
  calls: "it comes when you call",
  home: "home",
};

// Seconds into a ceremony (wall clock), from the moment the wisp is gone
// into the keepsake: when the card shows, when time runs again, when the
// camera comes home and the cat is let go.
// (The card waits until the light has arrived; time slows a little, for a
// moment: the light itself runs on wall time, waking.js.)
const WAKE = { card: 2.4, cardHold: 3.4, hold: 1.2, slow: 0.6, release: 4, camHome: 5, end: 6.5 };
// The fall (story shot 1): how long after the arrival title it comes if
// nobody touches anything; where it hangs before it falls (`distance` m
// from the lens, `above` degrees over the middle of the view, `side`
// degrees round to the right of it, so negative is left: high in the
// frame, over the sea side); how
// bright it hangs; how long the view leans after it.
export const FALL = { wait: 6, distance: 120, above: 23, side: -30, glow: 2.4, lean: 0.32, leanAfter: 0.6 };
const STAR_WHITE = [1, 0.97, 0.92];
// Each ceremony's camera: low behind the cat while the wisp dives (elevation,
// distance), then easing wider to take in the place (`wide`). Under the
// milkwood's canopy it stays low; at the lighthouse it stands well back.
export const SHOTS = {
  default: { elevation: 0.32, distance: 7, wide: [0.4, 8.5] },
  fireflies: { elevation: 0.22, distance: 6, wide: [0.26, 7] },
  // Low and far, so the lit lantern at the top of the tower is in the frame.
  lamp: { elevation: 0.08, distance: 11, wide: [0.08, 14] },
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

// sky: the lapse (thread.js): { run(keys, { onDone }), running(), live(),
// nowMinutes(), liveMinutes() }. reduced(): prefers reduced motion.
export function createJourney({ state, card, findLine, now, onChange = () => {}, sky = {}, reduced = () => false }) {
  const isReduced = reduced;
  const magic = state.magic;
  let quest = null;
  let mind = null;
  // The meeting: armed when the arrival title clears; it falls at the first
  // input or FALL.wait seconds later (story shot 1).
  let armed = false;
  let met = false;
  let meetAt = Infinity;
  let ceremony = null;
  let scale = 1;
  let meowAt = -Infinity;
  let answered = true;
  let meteorUntil = -Infinity;
  let listening = false;
  // The fall as it plays: { leanUntil, landed, rose }.
  let falling = null;
  // A breath between one ceremony and the next.
  let restUntil = 0;
  let tickAt = now();
  const ctx = { cat: null, target: null, night: 0, call: false, interest: null, meteor: false, sunset: false, gifts: 0 };
  const sound = (name, ...args) => state.sound?.[name]?.(...args);

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

  // ---- The beginning ------------------------------------------------------

  // The first meeting: a fall onto the beach; or, returning with the lights
  // lit, the wisp waiting in the home lantern; or, after the ending, nothing
  // (it is in the sky; a meow calls it down).
  function begin() {
    met = true;
    const cat = state.walker.cat;
    const home = state.landscape?.home ?? null;
    if (quest.done) {
      mind.away();
      if (ctx.night > 0.5) findLine.show(LINES.stillUp);
      return;
    }
    if (magic.isAwake("home") && home) {
      const lamp = home.lamp;
      const since = now();
      // In the glass, a little brighter than the flame, until the cat comes.
      mind.place(lamp.x, lamp.y, lamp.z);
      mind.fly(() => {
        const near = Math.hypot(cat.x - lamp.x, cat.z - lamp.z) < 5;
        if (near || now() - since > 25) return null;
        return { x: lamp.x, y: lamp.y + 0.02, z: lamp.z, glow: 0.45 };
      }, "greet");
      findLine.show(LINES.stillOn);
      return;
    }
    fall();
  }

  // The fall: from far up along a fireball's track, down onto the sand just
  // beyond the cold lantern, the view leaning after it.
  function fallPath() {
    const cat = state.walker.cat;
    const camera = state.walker.camera;
    const home = state.landscape?.home ?? null;
    const land = home ? homeLandingPoint(home) : { x: cat.x + Math.sin(cat.heading) * 9, z: cat.z + Math.cos(cat.heading) * 9 };
    const eye = Number.isFinite(camera?.x) && (camera.x || camera.z) ? camera : { x: cat.x, y: cat.y + 1, z: cat.z };
    // (The view's own bearing and pitch: walker.js keeps the renderer's
    // azimuth, φ − 45° from the coast frame.)
    const look = Number.isFinite(camera?.azimuth) && (camera.azimuth || camera.pitch) ? { bearing: camera.azimuth + Math.PI / 4, pitch: camera.pitch } : { bearing: Math.atan2(land.x - eye.x, land.z - eye.z), pitch: -0.2 };
    const bearing = look.bearing + (FALL.side * Math.PI) / 180;
    const up = Math.max(0.08, look.pitch + (FALL.above * Math.PI) / 180);
    const from = {
      x: eye.x + Math.sin(bearing) * Math.cos(up) * FALL.distance,
      y: (eye.y ?? cat.y) + Math.sin(up) * FALL.distance,
      z: eye.z + Math.cos(bearing) * Math.cos(up) * FALL.distance,
    };
    return { from, land };
  }
  // Before it falls: a bright point hanging high in the sky where the
  // loading wisp was (story shot 1, beat 1).
  let hanging = null;
  function hang() {
    hanging = fallPath().from;
    mind.fly(() => (met || !hanging ? null : { x: hanging.x, y: hanging.y, z: hanging.z, glow: FALL.glow * (0.4 + 0.6 * ctx.night), calm: 0.1 }), "hidden"); // (by day a small bright point, not a second sun)
  }
  function fall() {
    const { from, land } = fallPath();
    if (hanging) Object.assign(from, hanging);
    hanging = null;
    const lens = state.walker.camera;
    mind.fall(from, land, { eye: Number.isFinite(lens?.x) && (lens.x || lens.z) ? lens : null });
    falling = { leanUntil: now() + 2.5, landed: false, rose: false };
    // The same fall drawn in the sky as a fireball's streak, from where it
    // hung to where it comes down, seen from the lens (sky-events.js
    // storyFall; the sky's bearings are the coast frame's less 45°).
    const camera = state.walker.camera;
    const eye = Number.isFinite(camera?.x) ? camera : { x: from.x, y: 0, z: from.z };
    const dir = (p) => {
      const dx = p.x - eye.x, dz = p.z - eye.z;
      const y = (p.y ?? groundHeight(p.x, p.z)) - eye.y;
      return [((Math.atan2(dx, dz) - Math.PI / 4) * 180) / Math.PI, (Math.atan2(y, Math.hypot(dx, dz)) * 180) / Math.PI];
    };
    const to = dir(land);
    magic.fall = { at: state.time ?? 0, from: dir(from), to };
    sound("starFall");
  }

  function stageFall() {
    magic.wisp.streak = mind.mode === "fall" ? 1 : 0;
    if (!falling) return;
    const p = mind.position;
    if (now() < falling.leanUntil && !falling.landed) state.walker.lookAt?.({ x: p.x, y: p.y, z: p.z }, FALL.lean);
    if (!falling.landed && Number.isFinite(mind.landedAt)) {
      falling.landed = true;
      falling.leanUntil = Math.min(falling.leanUntil, now() + FALL.leanAfter);
      // The embers and the puff where it landed (wisp.js draws them).
      magic.wisp.spark = [p.x, p.y, p.z, magic.clock];
      sound("starLand", { x: p.x, y: p.y, z: p.z });
    }
    if (falling.landed && now() > falling.leanUntil) state.walker.lookAt?.(null);
    if (!falling.rose && mind.mode === "rise") {
      falling.rose = true;
      sound("wispNote", 1, { x: p.x, y: p.y, z: p.z });
    }
    if (falling.rose && falling.landed && now() > falling.leanUntil) falling = null;
  }

  // The home lantern: the wisp waits at it; the cat comes within 2 m; the
  // wisp slips in and the wick catches. No card, no camera, nothing held.
  let homing = null;
  function homeCheck(cat) {
    const home = state.landscape?.home;
    if (!home || magic.isAwake("home") || homing || ceremony || !mind.visible) return;
    if (["fall", "landed", "rise", "dive", "script"].includes(mind.mode)) return;
    const lamp = home.lamp;
    if (Math.hypot(cat.x - home.x, cat.z - home.z) > 2.2 || mind.distanceTo(lamp.x, lamp.z) > 3.5) return;
    homing = { gone: null };
    mind.dive(lamp.x, lamp.y, lamp.z);
  }
  function stageHome() {
    if (!homing) return;
    if (homing.gone === null && (mind.stage === "gone" || mind.stage === "emerge")) {
      homing.gone = now();
      quest.lightHome();
      const lamp = state.landscape.home.lamp;
      magic.waking = createWaking("home", [lamp.x, lamp.y, lamp.z]);
      // sound: a wick's soft catch, the glass ticking as it warms (the
      // phrase's notes come with the climb).
      const at = { x: lamp.x, y: lamp.y, z: lamp.z };
      sound("wickCatch", at);
      sound("glassTick", at, { delay: 1 });
      onChange();
    }
    if (homing.gone !== null && now() - homing.gone > 3) {
      homing = null;
      mind.end();
      climb();
    }
  }

  // After each light: the wisp tries to rise again, a little higher, and
  // sings one note more of its phrase: n lit, n + 1 notes (the sound side's
  // `home(n)`, 0…6 notes; the score decides how they sound).
  function climb() {
    mind.reach(quest.lit);
    sound("home", Math.min(6, quest.lit + 1));
  }

  // ---- The lights ---------------------------------------------------------

  function start(event) {
    if (event.type === "ending") return startEnding(event);
    const place = event.place;
    const surface = state.walker.surface;
    const ground = surface(place.x, place.z);
    const cat = state.walker.cat;
    // waking: where the gift's light is kindled (the hollow, the furnace
    // mouth, the lantern room…): the wisp dives into it.
    const source = wakingSourceFor(state, place.gift);
    ceremony = {
      type: event.type,
      place,
      gift: place.gift,
      at: now(),
      goneAt: null,
      source,
      y: source ? source[1] : ground + 1.1,
      shot: SHOTS[place.gift] ?? SHOTS.default,
      // Look from the cat toward the place, so it stands beyond the cat.
      yaw: Math.atan2(place.x - cat.x, place.z - cat.z),
      carded: false,
      woke: false,
    };
    // move: each shot moved to where it has a clear view of the place.
    ceremony.frames = frameShots(ceremony, ground);
    findLine.pause(true);
    if (globalThis.document) document.body.dataset.ceremony = "true";
    camStart();
    mind.dive(source ? source[0] : place.x, ceremony.y, source ? source[2] : place.z);
    sound("ceremony", place.gift);
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
    onChange();
    // waking: the light is kindled at its source and reaches out (waking.js).
    if (c.source) {
      magic.waking = createWaking(gift, c.source, { follow: gift === "boat" ? boatLantern : null });
      // sound: every diegetic cue of the waking, scheduled by the sound side
      // from the moment the light is kindled (src/sound/cues.js `waking`);
      // tCat is when the light's front reaches the cat.
      const cat = state.walker?.cat;
      const dCat = cat ? Math.hypot(cat.x - c.source[0], (cat.y ?? c.source[1]) - c.source[1], cat.z - c.source[2]) : Infinity;
      const tCat = frontArrival(dCat, WAKE_LIGHT[gift]);
      state.sound?.waking?.(gift, { x: c.source[0], y: c.source[1], z: c.source[2] }, Number.isFinite(tCat) ? { tCat } : {});
    }
  }

  // The boat's lantern while it floats (boat.js), so the light moves with it.
  function boatLantern() {
    const l = state.boat?.lantern;
    return l && l[3] > 0.001 ? [l[0], l[1], l[2]] : null;
  }

  function stage(dt) {
    const c = ceremony;
    if (c.type === "ending") return stageEnding(dt);
    const t = now() - c.at;
    const cat = state.walker.cat;
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
    // One line, no place name; by day the two lights that wait for the dark
    // say so above it. (Seafolk: the card waits for the sea to answer.)
    if (!c.carded && g > (c.gift === "seafolk" ? 4.2 : WAKE.card)) {
      c.carded = true;
      card?.show(ctx.night < 0.5 ? AFTER_DARK[c.gift] ?? "" : "", GIFT_LINES[c.gift] ?? "", WAKE.cardHold, false);
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
    // The wisp comes out of the light it lit and tries to climb again.
    if (c?.woke) climb();
  }

  // ---- The ending (story-and-wow.md section 5) ----------------------------

  // The sky is the light's way home: it rises from the cairn to the south
  // celestial pole and becomes a star there; the Cross draws itself and
  // points to it; the real sky turns round it. By night from the sit; by
  // day the lapse first runs the day down to tonight. Seconds from the sit.
  function startEnding(event) {
    const cat = state.walker.cat;
    const sun = state.celestial?.sunAltitude ?? 30;
    const plan = ENDING[sun < -6 ? "night" : "day"];
    const reduced = isReduced();
    ceremony = { type: "ending", place: event.place, gift: "finale", at: now(), plan, night: plan === ENDING.night, reduced, beat: new Set(), carded: false, woke: false };
    // The light is going home: lit, remembered (the sky and the ending's
    // flag), and the star is not in the sky yet.
    quest.wake();
    ceremony.woke = true;
    magic.ending = { star: 0, swell: 0, pen: 0 };
    magic.litOrder = quest.order;
    onChange();
    findLine.pause(true);
    if (globalThis.document) document.body.dataset.ceremony = "true";
    sound("endingRise", { delay: plan.rise });
    // The way home: the pole, from Cape Town's latitude (due south, as high
    // as the latitude is south), in coast metres' directions.
    const lat = Math.abs(state.celestial?.latitude ?? (-33.92 * Math.PI) / 180);
    ceremony.pole = { x: -Math.cos(lat) * Math.SQRT1_2, y: Math.sin(lat), z: -Math.cos(lat) * Math.SQRT1_2 };
    ceremony.cat = { x: cat.x, y: cat.y, z: cat.z };
    if (!reduced) {
      camStart();
      // The look's yaw that faces true south (walker.js keeps the
      // renderer's azimuth, the coast bearing less 45°).
      const camera = state.walker.camera;
      const south = Math.atan2(ceremony.pole.x, ceremony.pole.z);
      ceremony.yaw = cam.yaw + wrap(south - ((camera.azimuth ?? 0) + Math.PI / 4));
    }
  }

  // The ending's frame: the wisp's scripted flight, the star, the pen, the
  // camera, the card and the lapse, from the plan's beats.
  function stageEnding(dt) {
    const c = ceremony;
    const p = c.plan;
    const t = now() - c.at;
    const cat = state.walker.cat;
    const once = (name, when) => {
      if (t < when || c.beat.has(name)) return false;
      c.beat.add(name);
      return true;
    };
    // The light comes down to the cat's nose, one last time.
    if (once("nose", p.nose)) {
      const from = { ...mind.position };
      const at = now();
      const nose = { x: cat.x + Math.sin(cat.heading) * 0.32, y: cat.y + 0.32, z: cat.z + Math.cos(cat.heading) * 0.32 };
      mind.fly(() => {
        const u = Math.min(1, (now() - at) / 1.6);
        const e = u * u * (3 - 2 * u);
        return { x: from.x + (nose.x - from.x) * e, y: from.y + (nose.y - from.y) * e, z: from.z + (nose.z - from.z) * e, glow: 0.9, calm: 0.15 };
      }, "script");
      sound("wispNote", 6, nose);
    }
    // By day it waits high over the cairn while the day runs down.
    if (p.wait !== undefined && once("wait", p.wait)) {
      const from = { ...mind.position };
      const at = now();
      mind.fly(() => {
        const u = Math.min(1, (now() - at) / 3);
        const e = u * u * (3 - 2 * u);
        return { x: from.x, y: from.y + 20 * e, z: from.z, glow: 1.2, calm: 0.4 };
      }, "script");
    }
    // It rises: straight up, then leaning south along the way to the pole,
    // shrinking to a point; as it leaves, the sky's cool light runs down
    // the summit grass (the waking table's `stars` row).
    if (once("rise", p.rise)) {
      const start = { ...mind.position };
      const eye = { ...state.walker.camera };
      const far = { x: eye.x + c.pole.x * 400, y: eye.y + c.pole.y * 400, z: eye.z + c.pole.z * 400 };
      const at = now();
      const span = p.arrive - p.rise;
      mind.fly(() => {
        const u = Math.min(1, (now() - at) / span);
        if (u >= 1) return { x: far.x, y: far.y, z: far.z, glow: 0, calm: 0 };
        // Up first (a fifth of the way), then toward the star, faster.
        const up = Math.min(1, u * 5);
        const lift = { x: start.x, y: start.y + 8 * (up * (2 - up)), z: start.z };
        const k = Math.max(0, (u - 0.2) / 0.8) ** 2.2;
        return { x: lift.x + (far.x - lift.x) * k, y: lift.y + (far.y - lift.y) * k, z: lift.z + (far.z - lift.z) * k, glow: 1.3 * (1 - smooth(0.7, 1, u)), calm: 0.2 };
      }, "script");
      if (!c.reduced) magic.waking = createWaking("stars", [c.cat.x, c.cat.y + 1.5, c.cat.z]);
    }
    // The star: it fades in as the light reaches it, swells once, holds.
    const e = magic.ending;
    e.star = smooth(p.arrive - 2, p.arrive, t);
    e.swell = t < p.arrive ? 0 : Math.exp(-(t - p.arrive) / 1.2) * smooth(p.arrive, p.arrive + 0.25, t);
    if (once("arrive", p.arrive)) {
      mind.away();
      sound("endingArrive");
    }
    // The Cross draws itself (1.6 s), its pointer runs on to the star
    // (1.4 s), they hold, and fade (1.5 s).
    const q = t - p.cross;
    e.pen = q < 0 ? 0 : q < 1.6 ? q / 1.6 : q < 3 ? 1 + (q - 1.6) / 1.4 : q < 5 ? 2 : q < 6.5 ? 2 + (q - 5) / 1.5 : 0;
    // The camera: low, turned to true south, the view lifted toward the
    // pole until the horizon sits low in the frame; free from `free`.
    if (!c.reduced && cam.free) {
      if (t < p.free + 0.5) {
        camAim(c.yaw, 0.04, 6.5, 0.8, dt);
        const lean = smooth(p.rise - 1, p.rise + 3, t) * 0.75;
        if (lean > 0) state.walker.lookAt?.({ x: cat.x + c.pole.x * 60, y: cat.y + c.pole.y * 60, z: cat.z + c.pole.z * 60 }, lean);
      } else if (!c.beat.has("camFree")) {
        // (The camera stays on the sky unless the visitor moves it.)
        c.beat.add("camFree");
      }
    }
    if (once("card", p.card)) card?.show("", LINES.home, 5, true);
    // The sky turns: the lapse (never with reduced motion).
    if (!c.reduced && once("turn", p.turn[0])) startLapse(c);
    if (once("after", p.after)) {
      sound("turn");
      findLine.pause(false);
      findLine.show(LINES.stay);
    }
    if (t > p.after + 1 && !lapseRunning()) finishEnding();
  }

  // The lapse: night, two hours in thirty seconds, then drifting back to
  // live time too slowly to see; day, tonight's dusk, the night through to
  // dawn, and on to the same minute tomorrow (story-and-wow.md 5).
  function startLapse(c) {
    const from = sky.nowMinutes?.();
    if (!Number.isFinite(from) || !sky.run) return;
    const p = c.plan;
    if (c.night) {
      const to = from + 60 * p.hours;
      sky.run([[0, from], [p.turn[1] - p.turn[0], to]], {
        onDone: () => sky.run([[0, to], [DRIFT * p.hours, (sky.liveMinutes?.() ?? from) + (DRIFT * p.hours) / 60]], { onDone: () => sky.live?.() }),
      });
      return;
    }
    // Day: from the sit, so its first leg is the dusk the lights answer.
    const date = state.date ?? new Date();
    const dusk = duskMinutes(from, date, -9) ?? from + 360;
    const dawn = dawnMinutes(dusk + 60, date, -9) ?? dusk + 600;
    const s0 = p.turn[0];
    sky.run([[0, from], [p.dusk[1] - s0, dusk], [p.turn[0] - s0 + 0.001, dusk + 45], [p.turn[1] - s0, dawn], [p.dawn[1] - s0, from + 1440]], {
      onDone: () => setTimeout(() => sky.live?.(), 10000),
    });
  }
  const lapseRunning = () => Boolean(sky.running?.());

  function finishEnding() {
    ceremony = null;
    camEnd();
    scale = 1;
    magic.ending = null;
    if (globalThis.document) delete document.body.dataset.ceremony;
    homeAt = Infinity;
  }

  // ---- Afterwards: call it down -------------------------------------------

  // A meow under open sky brings a small light down the sky to the cat (the
  // fall, gently, in about three seconds); it keeps company as before and
  // goes home when the cat sleeps or sits still for two minutes.
  let homeAt = Infinity;
  let calledOnce = false;
  function callDown() {
    const cat = state.walker.cat;
    const lat = Math.abs(state.celestial?.latitude ?? (-33.92 * Math.PI) / 180);
    const pole = { x: -Math.cos(lat) * Math.SQRT1_2, y: Math.sin(lat), z: -Math.cos(lat) * Math.SQRT1_2 };
    const from = { x: cat.x + pole.x * 160, y: cat.y + pole.y * 160, z: cat.z + pole.z * 160 };
    const to = { x: cat.x + Math.sin(cat.heading) * 1.4, z: cat.z + Math.cos(cat.heading) * 1.4 };
    mind.fall(from, to, { speed: 1 / 3 });
    sound("callDown");
    homeAt = Infinity;
    if (!calledOnce) {
      calledOnce = true;
      findLine.show(LINES.calls);
    }
  }
  function goHome() {
    const start = { ...mind.position };
    const cat = state.walker.cat;
    const lat = Math.abs(state.celestial?.latitude ?? (-33.92 * Math.PI) / 180);
    const far = { x: cat.x - Math.cos(lat) * Math.SQRT1_2 * 300, y: cat.y + Math.sin(lat) * 300, z: cat.z - Math.cos(lat) * Math.SQRT1_2 * 300 };
    const at = now();
    mind.fly(() => {
      const u = Math.min(1, (now() - at) / 6);
      if (u >= 1) return null;
      const k = u * u;
      return { x: start.x + (far.x - start.x) * k, y: start.y + (far.y - start.y) * k, z: start.z + (far.z - start.z) * k, glow: 1 - smooth(0.6, 1, u), calm: 0.3 };
    }, "hidden");
    homeAt = Infinity;
  }
  // Once called down: home when the cat sleeps, or sits still two minutes.
  function keepCompany(dt) {
    if (!quest?.done || ceremony || !mind.visible || mind.mode === "script" || mind.mode === "fall") return;
    const cat = state.walker.cat;
    const still = (cat.sit ?? 0) > 0.9 && Math.abs(cat.speed ?? 0) < 0.05;
    homeAt = still ? (Number.isFinite(homeAt) ? homeAt : now() + 120) : Infinity;
    if ((cat.sleepy ?? 0) > 0.3 || now() > homeAt) goHome();
    void dt;
  }

  return {
    // The world is built.
    attach() {
      quest = createQuest({ seed: state.seed, places: state.landscape?.pois ?? [], magic, home: state.landscape?.home ?? null });
      mind = createWispMind({ seed: state.seed, obstacles: state.landscape?.obstacles, surface: state.walker.surface, swimLimit: SWIM_LIMIT });
      mind.summit = quest.summit;
      state.landscape?.wisp?.follow(magic.wisp, state.walker.surface, magic);
      magic.wisp.colour.splice(0, 3, ...STAR_WHITE);
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
    // The arrival title has cleared: the star falls at the first input, or
    // `delay` seconds from now.
    meet(delay = FALL.wait) {
      armed = true;
      meetAt = Math.min(meetAt, now() + delay);
    },
    // Any input: the first one brings the fall.
    nudge() {
      if (armed && !met) meetAt = Math.min(meetAt, now() + 0.15);
    },
    call() {
      const cat = state.walker?.cat;
      if (!cat) return;
      // Afterwards: a meow under open sky calls the light down.
      if (quest?.done && !ceremony && !mind.visible && met) callDown();
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
      if (ceremony.type === "ending") return now() - ceremony.at < ceremony.plan.free;
      return ceremony.goneAt === null || now() - ceremony.goneAt < WAKE.release;
    },
    // `?perf` QA: start the ending now (five lit, the cat anywhere).
    endNow() {
      const event = quest?.act("beacon");
      if (event) start(event);
      return Boolean(event);
    },
    get timeScale() {
      return scale;
    },
    // The star has come down (or there was no fall this visit): the walk
    // lesson may show.
    get landed() {
      return met && (!falling || falling.landed);
    },
    // How many lights are lit (0…6, the home lantern included).
    get lit() {
      return quest?.lit ?? 0;
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
      ctx.night = smooth(1, 2, celestial?.scene ?? 0);
      // (Only a first visit sees the point hanging: returning, the wisp is in
      // the home lantern; after the ending, in the sky.)
      if (!met && armed && !hanging && mind.mode === "hidden" && !blocked && !magic.isAwake("home") && !quest.done) hang();
      if (!met && armed && now() >= meetAt && !blocked) begin();
      stageFall();
      if (ceremony) stage(dt);
      else keepCompany(dt); // afterwards: the called-down light goes home
      homeCheck(cat);
      stageHome();
      ctx.cat = cat;
      ctx.target = ceremony ? null : quest.target(cat.x, cat.z, ctx.night);
      ctx.interest = interest?.near ? interest : null;
      ctx.meteor = now() < meteorUntil;
      const sun = celestial?.sunAltitude ?? 30;
      ctx.sunset = sun < 6 && sun > -4 && (celestial?.sunAzimuth ?? 0) > 180;
      ctx.gifts = quest.lit;
      ctx.trying = trying;
      // Towing the boat, the wisp is where the boat put it (boat.js afterThread).
      if (magic.afloat && mind.visible && mind.mode !== "aloft") mind.place(magic.wisp.position[0], magic.wisp.position[1], magic.wisp.position[2]);
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
      const t = now();
      const dt = Math.min(1, t - tickAt);
      tickAt = t;
      const event = quest.update(cat, { busy: Boolean(ceremony) || Boolean(homing) || t < restUntil, dt });
      if (event) start(event);
    },
    beginAgain() {
      if (ceremony) finish();
      quest?.beginAgain();
      magic.waking = null;
      magic.ending = null;
      homing = null;
      falling = null;
      hanging = null;
      mind?.reset();
      met = false;
      armed = true;
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
    // (The pool's light is under its water: the walker's surface there.)
    surface: gift === "seafolk" && state.walker?.surface ? state.walker.surface : groundHeight, toward: gift === "fireflies" && cat ? [cat.x, cat.z] : undefined,
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
    // (The boat's light rides with its lantern once the hull is afloat.)
    const follow = gift === "boat" ? () => { const l = state.boat?.lantern; return l && l[3] > 0.001 ? [l[0], l[1], l[2]] : null; } : null;
    magic.waking = createWaking(gift, at, { age, frozen, follow });
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
