// sea-sky-magic: what the island's awakened gifts (src/magic.js) do to the
// sea and the sky, packed into eight Atmosphere fields (the eighth, `lantern`, is the boat's) at the end of the
// struct (src/shaders/view.wgsl). Filled in main.js createUniforms and
// scripts/render-sky.mjs. ALL ZERO = every gift asleep, no pulse, no wisp:
// every shader branch gates on these before doing any work.
//
//   magic       x tideglow, y stars, z lamp, w finale: eased levels 0…1.
//   magic2      x seconds since the stars woke (the constellation figures
//               draw themselves over FIGURE_DRAW_SECONDS from then; a gift
//               awake at load draws from load), y seconds since the latest
//               meow (0 = none yet), z seafolk, w boat (levels).
//   pulse       the latest waking's wave of light: x, z (coast metres), its
//               ring radius in metres now, w strength (0 = none).
//   pulseColour rgb its gift's colour (GIFT_COLOURS), w its `reach`.
//   lamp        the lighthouse lamp: x, y, z (coast metres) and its beam
//               bearing in w (radians, see lampAngle). Zero while asleep.
//   wisp        the guiding light: x, y, z (coast metres), w glow (0 hidden).
//   wispColour  rgb, w unused.
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
import { GIFT_COLOURS, PULSE } from "./magic.js";

export const MAGIC_FIELDS = ["magic", "magic2", "pulse", "pulseColour", "lamp", "wisp", "wispColour", "lantern"];

export const LAMP_PERIOD = 12;
export function lampAngle(time) {
  return (((time % LAMP_PERIOD) + LAMP_PERIOD) % LAMP_PERIOD) / LAMP_PERIOD * Math.PI * 2;
}

// The constellation figures draw themselves over this many seconds after
// the stars wake (each figure its own few seconds within it, staggered).
export const FIGURE_DRAW_SECONDS = 14;

// Tideglow, for the land's ground shader to match on the sand: the cold
// blue-green the sea glows (linear RGB, before exposure; the sea adds it
// at night scaled by its agitation), and the e-folding seconds a stirred
// patch of wet sand keeps glowing after the swash or a paw leaves it.
export const TIDEGLOW = { colour: [0.08, 0.62, 1.0], sandSeconds: 2.5 };

// After `reach` the sea lets the ring run on toward the horizon, fading
// out by this many reaches.
export const PULSE_SEA_REACH = 3.2;

// The sky and water shaders carry `@id(7301) override MAGIC_AWAKE` (view.wgsl).
// magicVariant(source, false) compiles every gift's code out; main.js and
// render-sky.mjs run that while magicActive() is false.
export const MAGIC_OVERRIDE_ID = 7301;
const OVERRIDE = /(@id\(\s*7301\s*\)\s*override\s+\w+\s*:\s*bool\s*=\s*)(true|false)/;
export function magicVariant(source, awake) {
  const wgsl = typeof source === "string" ? source : source.wgsl;
  if (!OVERRIDE.test(wgsl)) throw new Error("sea-sky-magic: MAGIC_AWAKE override not found in shader");
  const out = wgsl.replace(OVERRIDE, `$1${awake ? "true" : "false"}`);
  return typeof source === "string" ? out : { ...source, wgsl: out };
}
export function magicActive(uniforms) {
  return MAGIC_FIELDS.some((k) => uniforms[k]?.some((v) => v !== 0));
}

export function quietMagicUniforms() {
  return Object.fromEntries(MAGIC_FIELDS.map((k) => [k, [0, 0, 0, 0]]));
}

// magic: the shared record (createMagic); lamp: { x, y, z } of the lamp in
// coast metres, or null; time: the scene clock (state.time = magic.clock).
export function magicUniforms(magic, { time = magic?.clock ?? 0, lamp = null, lantern = null } = {}) {
  const u = quietMagicUniforms();
  if (!magic) return u;
  const level = (g) => {
    const v = magic.levels?.[g] ?? 0;
    return v > 0.001 ? Math.min(1, v) : 0;
  };
  const clock = magic.clock ?? time;
  u.magic = [level("tideglow"), level("stars"), level("lamp"), level("finale")];
  if (u.magic[1] > 0) {
    const woke = magic.wakeAt?.stars;
    u.magic2[0] = Math.max(0, Number.isFinite(woke) ? clock - woke : clock) + 1e-3;
  }
  const call = magic.call;
  if (call && Number.isFinite(call.at) && clock >= call.at) u.magic2[1] = clock - call.at + 1e-3;
  u.magic2[2] = level("seafolk");
  u.magic2[3] = level("boat");
  const pulse = magic.pulse;
  if (pulse && Number.isFinite(pulse.at) && clock >= pulse.at) {
    const speed = pulse.speed ?? PULSE.speed;
    const reach = pulse.reach ?? PULSE.reach;
    const radius = (clock - pulse.at) * speed;
    // Up to full strength in its first metres; spent at `reach` on land, on
    // the sea it runs on, fading, toward the horizon.
    const strength = Math.min(1, radius / 3) * (radius < reach ? 1 : Math.max(0, 1 - (radius - reach) / (reach * (PULSE_SEA_REACH - 1))));
    if (strength > 0.001) {
      u.pulse = [pulse.x, pulse.z, radius, strength];
      const colour = pulse.colour ?? GIFT_COLOURS[pulse.gift] ?? GIFT_COLOURS.finale;
      u.pulseColour = [colour[0], colour[1], colour[2], reach];
    }
  }
  if (u.magic[2] > 0 && lamp) u.lamp = [lamp.x, lamp.y, lamp.z, lampAngle(time)];
  const wisp = magic.wisp;
  if (wisp?.visible && wisp.glow > 0.001) {
    u.wisp = [wisp.position[0], wisp.position[1], wisp.position[2], wisp.glow];
    u.wispColour = [...wisp.colour.slice(0, 3), 0];
  }
  // boat: [x, y, z, strength] from boat.js while it floats.
  if (lantern && lantern[3] > 0.001) u.lantern = [lantern[0], lantern[1], lantern[2], lantern[3]];
  // Never NaN into a uniform: a bad record silences the field.
  for (const k of MAGIC_FIELDS) if (!u[k].every(Number.isFinite)) u[k] = [0, 0, 0, 0];
  return u;
}

// `?perf&magic=…&pulse=x,z` etc. are QA only; fixtures build a record with
// this (render-sky.mjs): levels for the given gifts, figures drawn `age`
// seconds ago.
export function magicFixture({ gifts = [], clock = 24, age = 60, pulse = null, call = null, wisp = null } = {}) {
  const levels = {};
  const wakeAt = {};
  for (const g of ["fireflies", "tideglow", "lamp", "stars", "seafolk", "boat", "finale"]) {
    levels[g] = gifts.includes(g) ? 1 : 0;
    wakeAt[g] = gifts.includes(g) ? clock - age : Infinity;
  }
  return { levels, wakeAt, clock, pulse, call, wisp: wisp ?? { position: [0, -100, 0], glow: 0, colour: [1, 1, 1], visible: false } };
}
