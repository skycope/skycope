// sea-sky-magic: what the island's awakened gifts (src/magic.js) do to the
// sea and the sky, packed into eight Atmosphere fields (the eighth, `lantern`, is the boat's) at the end of the
// struct (src/shaders/view.wgsl). Filled in main.js createUniforms and
// scripts/render-sky.mjs. ALL ZERO = every gift asleep, no waking, no wisp:
// every shader branch gates on these before doing any work.
//
//   magic       x tideglow, y 0 (the sky no longer leans close: it is the
//               real sky), z lamp: eased levels 0…1; w the south star's
//               brightness 0…1 (story-and-wow.md 5: the ending's star at
//               the south celestial pole; 1 for good once the ending has
//               happened).
//   magic2      x the ending's pen (0…1 the Southern Cross draws itself,
//               1…2 its pointer runs on to the star, 2…3 both fade; 0 when
//               not drawing), y seconds since the latest meow (0 = none
//               yet), z seafolk, w boat (levels).
//   waking      a waking's kindled light on the water (waking.js): x, z
//               the source (coast metres), how far its light has reached
//               on the water (m; 0 = none), w the front's glints.
//   wakingLight rgb its tint × the lit water's strength, w the source's
//               height (m).
//   lamp        the lighthouse lamp: x, y, z (coast metres) and its beam
//               bearing in w (radians, see lampAngle). Zero while asleep.
//   wisp        the guiding light: x, y, z (coast metres), w glow (0 hidden).
//   wispColour  rgb; w the south star's arrival swell 0…1 (the ending).
//   lantern     boat: the boat's hurricane lantern afloat: flame x, y, z
//               (coast metres), w strength (0 = no boat on the water).
//
// For the land layer (another engineer's): mirror these constants.
//   LAMP_PERIOD / lampAngle: places.js turns its beams once every 12 s of
//     scene time, a = (time mod 12) / 12 · 2π, two opposed beams. In coast
//     metres a beam points along (cos a, −sin a) in (x, z) (Three world
//     mirrors coast z). The sea's beam uses the same angle from `lamp.w`.
//   TIDEGLOW: the tideglow colour and how long the glow lingers on wet sand
//     where the swash and the cat's paws stirred it (see its comment).
import { WAKE_LIGHT, wakingSea, waveAt } from "./waking.js";

// The wave on the sea, relative to its strength on the land (the sea pass's
// exposed units; calibrated by eye).
export const WAVE_SEA = 0.5;

export const MAGIC_FIELDS = ["magic", "magic2", "waking", "wakingLight", "lamp", "wisp", "wispColour", "lantern", "wakingWave", "wakingTint"];

export const LAMP_PERIOD = 12;
export function lampAngle(time) {
  return (((time % LAMP_PERIOD) + LAMP_PERIOD) % LAMP_PERIOD) / LAMP_PERIOD * Math.PI * 2;
}

// Tideglow, for the land's ground shader to match on the sand: the cold
// blue-green the sea glows (linear RGB, before exposure; the sea adds it
// at night scaled by its agitation), and the e-folding seconds a stirred
// patch of wet sand keeps glowing after the swash or a paw leaves it.
export const TIDEGLOW = { colour: [0.08, 0.62, 1.0], sandSeconds: 2.5 };

// The sky and water shaders carry `@id(7301) override MAGIC_AWAKE` (view.wgsl).
// magicVariant(source, false) compiles every gift's code out; main.js runs
// that per pass while magicPasses() says the pass shows no gift, and
// render-sky.mjs while magicActive() is false.
export const MAGIC_OVERRIDE_ID = 7301;
const OVERRIDE = /(@id\(\s*7301\s*\)\s*override\s+\w+\s*:\s*bool\s*=\s*)(true|false)/;
export function magicVariant(source, awake) {
  const wgsl = typeof source === "string" ? source : source.wgsl;
  if (!OVERRIDE.test(wgsl)) throw new Error("sea-sky-magic: MAGIC_AWAKE override not found in shader");
  const out = wgsl.replace(OVERRIDE, `$1${awake ? "true" : "false"}`);
  return typeof source === "string" ? out : { ...source, wgsl: out };
}
// Which passes need their awake pipeline, gift by gift: the sky only for
// the south star and the Cross (the ending); the water for the tideglow,
// the lamp, a waking's ring, the wisp's or the lantern's light on the sea.
export function magicPasses(uniforms) {
  const on = (field, i) => (uniforms[field]?.[i] ?? 0) !== 0;
  const sky = on("magic", 1) || on("magic", 3) || on("magic2", 0);
  const water = [0, 1, 2].some((i) => on("magic", i)) || on("waking", 2) || on("wakingWave", 2) || on("wakingTint", 3) || on("wisp", 3) || on("lantern", 3);
  return { sky, water };
}
export function magicActive(uniforms) {
  const passes = magicPasses(uniforms);
  return passes.sky || passes.water;
}

export function quietMagicUniforms() {
  return Object.fromEntries(MAGIC_FIELDS.map((k) => [k, [0, 0, 0, 0]]));
}

// magic: the shared record (createMagic); lamp: { x, y, z } of the lamp in
// coast metres, or null; time: the scene clock (state.time = magic.clock).
export function magicUniforms(magic, { time = magic?.clock ?? 0, lamp = null, lantern = null, night = 0, reduced = false } = {}) {
  const u = quietMagicUniforms();
  if (!magic) return u;
  const level = (g) => {
    const v = magic.levels?.[g] ?? 0;
    return v > 0.001 ? Math.min(1, v) : 0;
  };
  const clock = magic.clock ?? time;
  // story: the south star, from the ending as it plays (journey.js writes
  // magic.ending), else steady once the ending has happened.
  const ending = magic.ending;
  u.magic = [level("tideglow"), 0, level("lamp"), ending ? clamp01(ending.star) : level("finale")];
  if (ending) {
    u.magic2[0] = Math.max(0, Math.min(3, ending.pen ?? 0));
    u.wispColour[3] = clamp01(ending.swell);
  }
  const call = magic.call;
  if (call && Number.isFinite(call.at) && clock >= call.at) u.magic2[1] = clock - call.at + 1e-3;
  u.magic2[2] = level("seafolk");
  u.magic2[3] = level("boat");
  // waking: the kindled light on the water, with the sea's own reach and
  // longer tail (waking.js wakingSea). Zero for a gift whose light does not
  // reach the sea.
  const waking = magic.waking;
  const spec = waking ? WAKE_LIGHT[waking.gift] : null;
  if (spec?.sea) {
    const w = wakingSea(waking.age, spec, night, reduced);
    if (w.inside + w.front > 1e-4) {
      u.waking = [waking.x, waking.z, w.radius, w.front];
      u.wakingLight = [spec.tint[0] * w.inside, spec.tint[1] * w.inside, spec.tint[2] * w.inside, waking.y];
    }
  }
  // The wave across the bay (waking.js waveAt), for every gift with one:
  // its source in waking.xy / wakingLight.w (set here too when the gift's
  // own light stays ashore).
  if (spec) {
    const v = waveAt(waking.age, spec, night, reduced);
    if (v.strength + v.echoStrength > 1e-4) {
      u.waking[0] = waking.x;
      u.waking[1] = waking.z;
      u.wakingLight[3] = waking.y;
      u.wakingWave = [v.radius, v.tail, v.strength * WAVE_SEA, v.echo];
      u.wakingTint = [spec.tint[0], spec.tint[1], spec.tint[2], v.echoStrength * WAVE_SEA];
    }
  }
  // land-magic: when the land's lamp state is passed (landscape.lamp: its
  // own angle, with the slow start after waking, and `lit`, with the catch's
  // flicker) the sea's beam is the same beam; otherwise the plain 12 s turn.
  if (lamp && Number.isFinite(lamp.lit)) u.magic[2] = Math.min(u.magic[2], Math.max(0, lamp.lit));
  if (u.magic[2] > 0 && lamp) u.lamp = [lamp.x, lamp.y, lamp.z, Number.isFinite(lamp.angle) ? lamp.angle : lampAngle(time)];
  const wisp = magic.wisp;
  if (wisp?.visible && wisp.glow > 0.001) {
    u.wisp = [wisp.position[0], wisp.position[1], wisp.position[2], wisp.glow];
    u.wispColour = [...wisp.colour.slice(0, 3), u.wispColour[3]];
  }
  // boat: [x, y, z, strength] from boat.js while it floats.
  if (lantern && lantern[3] > 0.001) u.lantern = [lantern[0], lantern[1], lantern[2], lantern[3]];
  // Never NaN into a uniform: a bad record silences the field.
  for (const k of MAGIC_FIELDS) if (!u[k].every(Number.isFinite)) u[k] = [0, 0, 0, 0];
  return u;
}

function clamp01(v) {
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;
}

// `?perf&magic=…` etc. are QA only; fixtures build a record with
// this (render-sky.mjs): levels for the given gifts, figures drawn `age`
// seconds ago.
export function magicFixture({ gifts = [], clock = 24, age = 60, waking = null, call = null, wisp = null } = {}) {
  const levels = {};
  const wakeAt = {};
  for (const g of ["fireflies", "tideglow", "lamp", "stars", "seafolk", "boat", "finale"]) {
    levels[g] = gifts.includes(g) ? 1 : 0;
    wakeAt[g] = gifts.includes(g) ? clock - age : Infinity;
  }
  return { levels, wakeAt, clock, waking, call, wisp: wisp ?? { position: [0, -100, 0], glow: 0, colour: [1, 1, 1], visible: false } };
}
