// The waking light: the moment a gift wakes, as light behaving like light
// (docs/design/waking-light.md). "A lamp is lit, and you watch its light
// arrive": one real point of light at the keepsake catches like a wick,
// reaches outward as a decelerating front (the world behind it stays lit,
// nothing ahead of it is), glints where it passes, lingers, and resolves
// into the gift's small steady light.
//
// Pure: no three.js, no DOM. The land (land-magic.js), the sea
// (sea-sky-magic.js), the kindled point (kindle.js) and the ceremony
// (journey.js) all read the same curves from here, so they cannot drift.
//
// The record (magic.waking, magic.js): null, or the one waking in progress
//   { gift, x, y, z,     source, coast metres (re-read each frame from `follow`)
//     age,               WALL seconds since the gift woke (a ceremony slows
//                        scene time; the light must not crawl)
//     follow,            null | () => [x, y, z]  (the boat's lantern moves)
//     frozen }           QA: age does not advance

export const WAKING = { start: 0.35, tau: 1.5, hold: 3.0, fade: 3.0, end: 16 };

// One row per gift. tint: the light's own colour (linear RGB; surfaces
// multiply it by their albedo). core: its soft-core radius (m). reach: how
// far the front runs on land (m). night/day: the body light's peak, in the
// land shader's exposed units (the scale of magicGlowColour). front /
// frontDay: the front's glints. glint: the lingering glints. rest: what is
// left in this term once settled (0: the practical takes over). sea: how far
// it runs on the water (0: not at all), seaHold: how long the lit water
// keeps glinting. catch: the catch curve's speed (lamp 1: its real 4 s
// catch; others 2). tau: the front's time constant. up: light from above
// (the stars). ripple: light from under moving water (seafolk). body: how
// far the body light carries (m) before it is windowed out: a lamp's light
// lights its own place, not the island (only the glints run on to `reach`).
// Calibrated by eye at night and noon (docs/review/waking/): the design's
// first values were about five times too dim to read against the night
// exposure, and an unwindowed inverse square washed whole beaches.
export const WAKE_LIGHT = {
  fireflies: { tint: [1.0, 0.74, 0.28], body: 10, core: 1.8, reach: 24, night: 3.4, day: 0.9, front: 0.5, frontDay: 0.25, glint: 0.5, rest: 0, sea: 0 },
  tideglow: { tint: [0.1, 0.55, 1.0], body: 5, core: 1.2, reach: 30, night: 1.4, day: 0.5, front: 0.7, frontDay: 0.35, glint: 0.8, rest: 0, sea: 120, seaHold: 8 },
  lamp: { tint: [1.0, 0.66, 0.26], body: 24, core: 5.0, reach: 46, night: 5.5, day: 0.8, front: 0.45, frontDay: 0.2, glint: 0.3, rest: 0, sea: 150, catch: 1, tau: 2.2 },
  stars: { tint: [0.62, 0.72, 1.0], body: 20, core: 1.2, reach: 60, night: 1.5, day: 0.2, front: 0.35, frontDay: 0.3, glint: 1.0, rest: 0, sea: 0, up: 1 },
  seafolk: { tint: [0.2, 0.8, 0.6], body: 6, core: 1.4, reach: 14, night: 3.0, day: 0.5, front: 0.4, frontDay: 0.2, glint: 0.4, rest: 0, sea: 90, ripple: 0.4 },
  boat: { tint: [1.0, 0.5, 0.16], body: 9, core: 1.5, reach: 26, night: 4.0, day: 0.7, front: 0.5, frontDay: 0.25, glint: 0.4, rest: 0, sea: 80 },
  finale: { tint: [1.0, 0.9, 0.72], body: 20, core: 3.0, reach: 60, night: 4.5, day: 0.8, front: 0.5, frontDay: 0.3, glint: 0.6, rest: 0, sea: 150 },
  // story: the home lantern on the beach, the first light: the boat's row
  // at 0.4 of its reach, and none of it on the sea (story-and-wow.md 7.1).
  home: { tint: [1.0, 0.5, 0.16], wave: 0.5, body: 3.6, core: 1.2, reach: 10.4, night: 3.0, day: 0.6, front: 0.5, frontDay: 0.25, glint: 0.4, rest: 0, sea: 0 },
};

// The one colour table: each gift's light (the wisp's ribbon, the field
// notes' marks and the waking all use it).
export const GIFT_COLOURS = Object.fromEntries(Object.entries(WAKE_LIGHT).map(([g, s]) => [g, s.tint]));

const smooth = (x, a, b) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// How a wick catches: s wall seconds after lighting, its light (0…1). A
// spark, two gutters, then the light swells and holds. `speed` runs the
// catch faster (the gifts at 2, the lamp at its own 1) but never the
// gutters: they stay at 2.7 dips a second of wall time, under the 3 Hz
// photosensitivity limit, whatever the speed (at speed 2 the old curve
// flickered at 6 Hz).
export function lampCatch(s, speed = 1) {
  if (!(s >= 0)) return s < 0 ? 0 : 1;
  const u = s * speed;
  if (u > 4) return 1;
  const spark = Math.min(1, u / 0.25) * 0.35;
  const gutter = u < 1.6 ? 0.55 + 0.45 * Math.abs(Math.sin(s * 8.5)) * (1 - u / 1.6) : 1;
  const swell = smooth(u, 1.0, 3.6);
  return Math.min(1, spark * gutter + swell * 0.9 + 0.1 * swell * swell);
}

// The lighthouse beams' angular speed s seconds after waking: still while
// the lamp catches, then the clockwork takes up.
export function lampSpin(s) {
  if (!(s >= 0)) return s < 0 ? 0 : 1;
  return smooth(s, 2.2, 7.5);
}

export const ZERO = Object.freeze({ radius: 0, width: 0, inside: 0, front: 0, glint: 0, caught: 0 });

// The curves at s wall seconds. spec: a row of WAKE_LIGHT. night 0…1.
// reduced (prefers-reduced-motion): no travelling front, no flicker; the
// light eases up in place.
//   radius  how far the light has reached (m)
//   width   the front's half-width (m)
//   inside  I, the body light behind the front
//   front   F, the front's glint strength
//   glint   G, the lingering glints
//   caught  the catch alone (0…1, with its flicker), for the kindled point
export function wakingAt(s, spec, night = 0, reduced = false) {
  if (!spec || !(s >= 0) || s > WAKING.end) return ZERO;
  const k = spec.catch ?? 2;
  const caught = reduced ? smooth(s, 0, 1.5) : lampCatch(s, k);
  const settle = spec.rest + (1 - spec.rest) * Math.exp(-Math.max(s - WAKING.hold, 0) / WAKING.fade);
  // The last second eases to exactly nothing, so the end is not a step.
  const tail = 1 - smooth(s, WAKING.end - 1.5, WAKING.end);
  const peak = spec.day + (spec.night - spec.day) * night;
  const radius = reduced ? spec.reach : spec.reach * (1 - Math.exp(-Math.max(s - WAKING.start, 0) / (spec.tau ?? WAKING.tau)));
  const spent = 1 - radius / spec.reach;
  const frontPeak = spec.frontDay + (spec.front - spec.frontDay) * night;
  return {
    radius,
    width: 0.6 + 0.05 * radius,
    inside: peak * caught * settle * tail,
    front: reduced ? 0 : frontPeak * smooth(s, WAKING.start, WAKING.start + 0.3) * spent ** 1.5,
    glint: spec.glint * smooth(s, 0.8, 2.2) * Math.exp(-Math.max(s - 4, 0) / 4) * tail,
    caught,
  };
}

// When the front reaches a point d metres from the source (wall seconds;
// Infinity if it never does). The inverse of wakingAt's radius.
export function frontArrival(d, spec) {
  if (!spec || !(d >= 0)) return Infinity;
  if (d >= spec.reach) return Infinity;
  return WAKING.start - (spec.tau ?? WAKING.tau) * Math.log(1 - d / spec.reach);
}

// The waking on the sea: its own reach (spec.sea) and a longer tail
// (spec.seaHold): the lit water keeps glinting after the land has gone dark.
//   radius  m; 0 when this gift does not reach the sea
//   inside  the lit water's strength
//   front   the front's crest-glints
export function wakingSea(s, spec, night = 0, reduced = false) {
  if (!spec || !spec.sea || !(s >= 0) || s > WAKING.end) return { radius: 0, inside: 0, front: 0 };
  const k = spec.catch ?? 2;
  const caught = reduced ? smooth(s, 0, 1.5) : lampCatch(s, k);
  const u = Math.max(s - WAKING.start, 0) / (spec.tau ?? WAKING.tau);
  const radius = reduced ? spec.sea : spec.sea * (1 - Math.exp(-u));
  const tail = 1 - smooth(s, WAKING.end - 1.5, WAKING.end);
  const peak = spec.day + (spec.night - spec.day) * night;
  const inside = peak * caught * Math.exp(-Math.max(s - (spec.seaHold ?? 3), 0) / 3) * tail;
  const frontPeak = spec.frontDay + (spec.front - spec.frontDay) * night;
  const front = reduced ? 0 : frontPeak * smooth(s, WAKING.start, WAKING.start + 0.3) * (1 - radius / spec.sea) ** 1.5;
  return { radius: Math.max(radius, 1e-3), inside, front };
}

// The wave: after the catch, one front of the gift's light leaves the source
// and crosses the whole island and the bay, decelerating (about 33 m/s at
// first; past the island's far shore in six or seven seconds). It is light
// catching on things as it passes, brightest at its leading edge, with a
// tail a second or so long that breaks into glints, and nothing behind it.
// When it has reached the shore all round, a fainter echo runs back to the
// source over two seconds and the gift's own light settles (out, answer,
// home). All over by 7.8 s.
//   reach/tau  how far it could run (m) and its time constant (s)
//   lead       its leading edge's half-width (m) at radius 0, growing 2%
//   tail       how many seconds of travel its tail holds
//   night/day  its peak, in the land's exposed units (× the gift's `wave`)
export const WAVE = { start: 0.6, reach: 190, tau: 5.5, lead: 1.6, tail: 1.1, fadeFrom: 5.8, fadeTo: 7.4, echoAt: 5.4, echoFor: 2.4, night: 6, day: 8 };
export const WAVE_ZERO = Object.freeze({ radius: 0, lead: 1, tail: 1, strength: 0, presence: 0, echo: 0, echoStrength: 0, speed: 0 });

// The wave at s wall seconds. presence: its envelope alone (0…1), for the
// effects that are not light (the plants' lean, the sun-glints by day).
// Reduced motion: no wave.
export function waveAt(s, spec, night = 0, reduced = false) {
  if (!spec || reduced || spec.wave === 0 || !(s >= WAVE.start) || s > WAVE.echoAt + WAVE.echoFor) return WAVE_ZERO;
  const u = (s - WAVE.start) / WAVE.tau;
  const radius = WAVE.reach * (1 - Math.exp(-u));
  const speed = (WAVE.reach / WAVE.tau) * Math.exp(-u);
  const presence = smooth(s, WAVE.start, WAVE.start + 0.35) * (1 - smooth(s, WAVE.fadeFrom, WAVE.fadeTo));
  const peak = (WAVE.day + (WAVE.night - WAVE.day) * night) * (spec.wave ?? 1);
  const echoAt = WAVE.reach * (1 - Math.exp(-(WAVE.echoAt - WAVE.start) / WAVE.tau));
  const e = smooth(s, WAVE.echoAt, WAVE.echoAt + WAVE.echoFor);
  const echoPresence = smooth(s, WAVE.echoAt, WAVE.echoAt + 0.5) * (1 - smooth(s, WAVE.echoAt + WAVE.echoFor - 0.7, WAVE.echoAt + WAVE.echoFor));
  return {
    radius,
    lead: WAVE.lead + 0.02 * radius,
    tail: Math.max(2.5, speed * WAVE.tail),
    strength: peak * presence,
    presence,
    echo: echoAt * (1 - e),
    echoStrength: peak * 0.3 * echoPresence,
    speed,
  };
}

// When the wave reaches a point d metres from the source (wall seconds).
export function waveArrival(d, spec = null) {
  if (spec?.wave === 0 || !(d >= 0) || d >= WAVE.reach) return Infinity;
  return WAVE.start - WAVE.tau * Math.log(1 - d / WAVE.reach);
}

// The practical a waking hands over to: its level s seconds after waking
// (crossfades with the body light, which decays from WAKING.hold, so the
// sum never dips to dark and never doubles).
export function practicalLevel(s) {
  if (!Number.isFinite(s)) return s > 0 ? 1 : 0;
  return smooth(s, 3, 8);
}

// Where each gift's light is kindled (coast metres), from what places.js
// exposes: pois [{ id, x, z }], crown { x, z }, beacon (the lighthouse
// lamp { x, y, z }), blockers (its solids: the wreck's boiler drum is one).
// surface(x, z): the land's own ground height. toward [x, z]: where the
// visitor comes from (the cat), so a recess faces them. Until the prop
// contract gives each keepsake a `lights[0]`, these are the places' own
// anchors.
export const SOURCE_POI = { fireflies: "milkwood", tideglow: "wreck", lamp: "lighthouse", stars: "beacon", seafolk: "pool", boat: "boat" };
const ISLAND = [58, 70];
// anchors: places.wakingAnchors, the props' own points by place id (the
// guesses below were calibrated on the old props: the wreck's drum lookup
// missed the new walk-in boiler, the pool's light sat in its rock floor,
// the boat's inside its upturned hull).
export function wakingSource(gift, { pois = [], crown = null, beacon = null, blockers = [], surface = () => 0, toward = ISLAND, anchors = null } = {}) {
  if (gift === "lamp" && beacon) return [beacon.x, beacon.y, beacon.z];
  const anchor = anchors?.[SOURCE_POI[gift]];
  if (anchor && gift !== "fireflies" && gift !== "lamp") return [anchor[0], anchor[1], anchor[2]];
  // The milkwood's hollow: in the bole's face (~0.95 m round its centre,
  // place-milkwood.js) on the visitor's side, 1.6 m up.
  if (gift === "fireflies" && crown) {
    const dx = toward[0] - crown.x, dz = toward[1] - crown.z, d = Math.hypot(dx, dz);
    const x = crown.x + (d > 1.2 ? (dx / d) * 1.05 : 0), z = crown.z + (d > 1.2 ? (dz / d) * 1.05 : 0);
    return [x, surface(x, z) + 1.6, z];
  }
  const poi = pois.find((p) => p.id === SOURCE_POI[gift]);
  if (!poi) return null;
  // The wreck's ember: in the boiler's furnace mouth, the end of the iron
  // drum (the capsule of radius ~0.64 by the wreck) facing the visitor.
  if (gift === "tideglow") {
    const drum = blockers.find((b) => b.k === 2 && Math.abs(b.rad - 0.64) < 0.03 && Math.hypot(b.x - poi.x, b.z - poi.z) < 10);
    if (drum) {
      const far = (x, z) => Math.hypot(toward[0] - x, toward[1] - z);
      const [ex, ez, ox, oz] = far(drum.ax, drum.az) < far(drum.bx, drum.bz) ? [drum.ax, drum.az, drum.bx, drum.bz] : [drum.bx, drum.bz, drum.ax, drum.az];
      const ux = ex - ox, uz = ez - oz, ul = Math.hypot(ux, uz) || 1;
      return [ex + (ux / ul) * 0.42, (drum.ay + drum.by) / 2 + 0.22, ez + (uz / ul) * 0.42];
    }
  }
  const lift = { tideglow: 0.6, stars: 2.0, seafolk: -0.15, boat: 0.9 }[gift] ?? 1;
  return [poi.x, surface(poi.x, poi.z) + lift, poi.z];
}

// A new waking record.
export function createWaking(gift, at, { follow = null, age = 0, frozen = false } = {}) {
  if (!WAKE_LIGHT[gift] || !at) return null;
  return { gift, x: at[0], y: at[1], z: at[2], age, follow, frozen };
}

// Per frame: advance (wall seconds), follow a moving source; null once spent.
export function stepWaking(waking, realDt) {
  if (!waking) return null;
  if (!waking.frozen) waking.age += Math.max(0, Number.isFinite(realDt) ? realDt : 0);
  if (waking.follow) {
    const p = waking.follow();
    if (p && p.every(Number.isFinite)) [waking.x, waking.y, waking.z] = p;
  }
  return waking.age > WAKING.end ? null : waking;
}
