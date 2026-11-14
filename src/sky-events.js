// Sky events: the rare, real moments a patient observer at the Cape sees.
// This module decides WHEN and WHERE they happen; the shaders draw them
// (src/shaders/phenomena.wgsl, gated on the uniforms built here, so each
// costs nothing on the GPU while it is not happening).
//
// Everything is a pure function of the reload seed, the event clock (the
// app's animation seconds, `state.time`), the real sun/moon (astronomy.js)
// and the weather. Nothing is moved into frame: a rainbow sits 42° from the
// antisolar point, a halo 22° from the sun, a shower meteor flies away from
// its real radiant. Only the *rates* of random events are compressed (see
// LINGER) so someone who stays a few minutes sees one.
//
// API
//   skyConditions({ celestial, weather, sunlit, date })  -> strengths 0..1
//   skyEventFrame({ seed, time, date, celestial, weather, sunlit, lighting,
//                   force, view, frameSeconds }) -> { uniforms, flash,
//                   landFlash, strikes, meteor, satellite, conditions }
//   createSkyEvents({ seed, force }) -> { update(input) -> frame, on(fn) }
//     The live wrapper: eases strengths over a few seconds (a rainbow fades
//     in as the sun comes out) and publishes discrete events to listeners:
//       { type: "lightning", at, strength, bearing, distanceKm, kind,
//         thunderDelay }                         (at: event-clock seconds;
//                                               thunder at at + thunderDelay)
//       { type: "meteor", at, bearing, elevation, fireball, magnitude }
//   skySpectacles({ date, celestial, weather, seed, sunlit }) -> what is
//     visible now or due soon, for a "look up" hint:
//       [{ id, title, active, bearing, elevation, until, at, strength }]
//     bearing/elevation in degrees (bearing clockwise from north), until/at
//     Dates (or null when unknown). Sorted most striking first.
//
// Debug (only with ?perf): ?sky=rainbow|moonbow|lightning|meteor|fireball|
//   satellite|halo|corona|rays|green-flash|zodiacal forces that event's
//   conditions; positions stay real (a forced rainbow still needs a sun
//   lower than 42°; use the time slider). Forced meteors, satellites and
//   strikes are placed in front of the camera.

import { skyAt } from "./astronomy.js";

const DEG = Math.PI / 180;

// The event clock compresses real rates by this factor: a dark site sees
// ~10 sporadic meteors an hour over the whole sky, of which a 70° view
// catches one in eight. Positions and directions are never compressed.
export const LINGER = 4;
const SPORADIC_PER_HOUR = 10;

// Real annual showers visible from 34° S (IMO working list). Peak as
// [month, day]; ZHR at peak; FWHM in days; radiant RA/Dec (degrees);
// entry speed km/s; share of fireballs among their meteors.
export const SHOWERS = [
  { id: "alpha-centaurids", title: "Alpha Centaurids", peak: [2, 8], zhr: 6, width: 4, ra: 210, dec: -59, speed: 56, fireballs: 0.05 },
  { id: "eta-aquariids", title: "Eta Aquariids", peak: [5, 6], zhr: 50, width: 8, ra: 338, dec: -1, speed: 66, fireballs: 0.01 },
  { id: "southern-delta-aquariids", title: "Southern Delta Aquariids", peak: [7, 30], zhr: 25, width: 10, ra: 340, dec: -16, speed: 41, fireballs: 0.01 },
  { id: "perseids", title: "Perseids", peak: [8, 12], zhr: 100, width: 5, ra: 48, dec: 58, speed: 59, fireballs: 0.02 },
  { id: "orionids", title: "Orionids", peak: [10, 21], zhr: 20, width: 6, ra: 95, dec: 16, speed: 66, fireballs: 0.01 },
  { id: "southern-taurids", title: "Southern Taurids", peak: [10, 10], zhr: 5, width: 20, ra: 32, dec: 9, speed: 27, fireballs: 0.08 },
  { id: "northern-taurids", title: "Northern Taurids", peak: [11, 12], zhr: 5, width: 16, ra: 58, dec: 22, speed: 29, fireballs: 0.08 },
  { id: "leonids", title: "Leonids", peak: [11, 17], zhr: 15, width: 3, ra: 152, dec: 22, speed: 71, fireballs: 0.02 },
  { id: "geminids", title: "Geminids", peak: [12, 14], zhr: 150, width: 2.5, ra: 112, dec: 33, speed: 35, fireballs: 0.02 },
];

export const FORCEABLE = ["rainbow", "moonbow", "lightning", "meteor", "fireball", "satellite", "halo", "corona", "rays", "green-flash", "zodiacal"];

// ---------------------------------------------------------------- utilities

function smoothstep(a, b, x) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// A 32-bit integer hash of (seed, channel, index, salt) -> [0, 1).
export function hash(seed, channel, index, salt = 0) {
  let h = Math.imul((seed | 0) ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (channel | 0) ^ (h >>> 13), 0xc2b2ae35);
  h = Math.imul(h ^ (index | 0) ^ (h >>> 16), 0x27d4eb2f);
  h = Math.imul(h ^ (salt | 0) ^ (h >>> 15), 0x165667b1);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const CHANNEL = { strike: 11, cell: 12, meteor: 21, satellite: 31, crystal: 41 };

const altitude = (v) => Math.asin(Math.max(-1, Math.min(1, v[1]))) / DEG;
const bearingOf = (v) => ((Math.atan2(v[0], v[2]) / DEG) % 360 + 360) % 360;
const fromBearing = (bearing, elevation) => [
  Math.sin(bearing * DEG) * Math.cos(elevation * DEG),
  Math.sin(elevation * DEG),
  Math.cos(bearing * DEG) * Math.cos(elevation * DEG),
];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const scale = (a, k) => a.map((v) => v * k);
const add = (a, b) => a.map((v, i) => v + b[i]);
const normalize = (a) => scale(a, 1 / (Math.hypot(...a) || 1));

// J2000 equatorial unit vector -> local east/up/north; night.wgsl's
// local_from_equatorial.
export function localFromEquatorial(ra, dec, sidereal, latitude) {
  const eq = [Math.cos(dec * DEG) * Math.cos(ra * DEG), Math.cos(dec * DEG) * Math.sin(ra * DEG), Math.sin(dec * DEG)];
  const c = Math.cos(sidereal);
  const s = Math.sin(sidereal);
  const hx = c * eq[0] + s * eq[1];
  const hy = s * eq[0] - c * eq[1];
  const hz = eq[2];
  return [-hy, hx * Math.cos(latitude) + hz * Math.sin(latitude), hz * Math.cos(latitude) - hx * Math.sin(latitude)];
}

// Days from a shower's peak this year (wrapping round New Year).
function daysFromPeak(date, [month, day]) {
  const year = date.getUTCFullYear();
  let best = Infinity;
  for (const y of [year - 1, year, year + 1]) {
    const d = (date.getTime() - Date.UTC(y, month - 1, day)) / 86400000;
    if (Math.abs(d) < Math.abs(best)) best = d;
  }
  return best;
}

// ---------------------------------------------------------------- conditions

// Whether each phenomenon can occur now, 0..1, from geometry and weather
// alone. `sunlit` is the direct beam's transmission through the cloud field
// toward the sun (or moon at night) — landscape.js's cloudTransmission; it
// defaults to a cover-based estimate.
export function skyConditions({ celestial, weather = null, sunlit = null, date = null }) {
  const sunAlt = celestial.sunAltitude ?? altitude(celestial.sun);
  const moonAlt = altitude(celestial.moon);
  const moonLit = 0.5 - 0.5 * Math.cos(celestial.moonPhase * Math.PI * 2);
  const night = smoothstep(1, 2, celestial.scene);
  const low = weather?.low ?? 0;
  const mid = weather?.mid ?? 0;
  const high = weather?.high ?? 0;
  const cover = weather?.cover ?? 0;
  const rain = weather?.rain ?? 0;
  const beam = sunlit ?? 1 - Math.pow(cover, 1.5) * 0.93;
  // The rainbow's light: the sun while any of it is up, else a bright moon.
  const sunUp = celestial.sun[1] > -0.017;
  const sourceAlt = sunUp ? sunAlt : moonAlt;
  const moonGood = !sunUp ? smoothstep(0.55, 0.85, moonLit) * smoothstep(1, 4, moonAlt) * smoothstep(0.6, 0.95, night) : 0;
  const source = sunUp ? 1 : moonGood;
  // Sunlit rain: showers with the sun out, the bow's top below the horizon
  // once the sun is higher than 42°.
  const showers = smoothstep(0.05, 0.6, rain) * smoothstep(0.32, 0.6, beam) * (1 - smoothstep(0.985, 1, cover));
  const bowGeometry = (1 - smoothstep(40, 42.3, sourceAlt)) * smoothstep(-1, 0.3, sourceAlt);
  const rainbow = sunUp ? showers * bowGeometry : 0;
  const moonbow = sunUp ? 0 : showers * bowGeometry * moonGood;
  // Ice halos: thin high cloud the light shines through, not hidden by a
  // low or middle deck; crystals are not always good (a per-hour quality).
  const visibleHigh = smoothstep(0.18, 0.5, high) * (1 - smoothstep(0.45, 0.85, Math.max(low, mid))) * (1 - smoothstep(0.3, 1.5, rain));
  const hour = date ? Math.floor(date.getTime() / 3600000) : 0;
  const crystals = 0.35 + 0.65 * hash(1, CHANNEL.crystal, hour);
  const halo = visibleHigh * crystals * source * smoothstep(-1, 1, sourceAlt);
  // Lunar corona: moonlight diffracted by the droplets of thin, broken
  // water cloud (altocumulus, thin stratocumulus).
  const thin = Math.max(mid, low * 0.8);
  const corona = !sunUp ? smoothstep(0.08, 0.3, thin) * (1 - smoothstep(0.7, 0.95, cover)) * smoothstep(0.25, 0.6, moonLit) * smoothstep(0, 4, moonAlt) * (1 - smoothstep(0.5, 2, rain)) : 0;
  // Crepuscular rays: broken cloud and a low (or just set) sun. Clear sky
  // and full overcast have no shafts to show.
  const broken = smoothstep(0.12, 0.35, Math.max(low, mid)) * (1 - smoothstep(0.82, 0.96, cover));
  const rays = broken * smoothstep(-3, -0.5, sunAlt) * (1 - smoothstep(12, 28, sunAlt)) * (1 - smoothstep(2, 6, rain));
  // Thunderstorms: the forecast says so, or the rain and cloud are a storm's.
  const thunder = weather?.description === "thunderstorms" || weather?.preset === "storm";
  const storm = thunder || (rain >= 5 && cover >= 0.85) ? 1 : 0;
  const strikesPerMinute = storm ? 1.5 + 2.5 * smoothstep(4, 15, rain) : 0;
  // Meteors need a dark, clear sky; a bright moon hides the faint ones.
  const dark = smoothstep(-8, -13, sunAlt);
  const clear = 1 - smoothstep(0.3, 0.75, cover);
  const moonGlare = 1 - 0.6 * moonLit * smoothstep(-2, 25, moonAlt);
  let meteorRate = SPORADIC_PER_HOUR;
  let fireballShare = 0.01;
  let shower = null;
  if (date) {
    for (const s of SHOWERS) {
      const days = daysFromPeak(date, s.peak);
      const activity = Math.exp(-0.5 * (days / (s.width / 2.355)) ** 2);
      if (activity < 0.02) continue;
      const radiant = localFromEquatorial(s.ra, s.dec, celestial.sidereal, celestial.latitude);
      const up = Math.max(0, radiant[1]);
      const rate = s.zhr * activity * up;
      if (rate > 0.5) {
        meteorRate += rate;
        fireballShare = Math.max(fireballShare, s.fireballs * Math.min(1, rate / 3));
        if (!shower || rate > shower.rate) shower = { ...s, rate, radiant };
      }
    }
  }
  const meteorVisibility = dark * clear * moonGlare;
  // Satellites: twilight and early night, when sunlit orbits cross a dark
  // sky. Whether each is in the Earth's shadow is computed per pass.
  const satellites = smoothstep(-4, -7, sunAlt) * clear;
  // The green flash: a clear sea horizon under the setting or rising sun.
  const greenFlash = (1 - smoothstep(0.15, 0.4, low)) * (1 - smoothstep(0.4, 0.7, cover)) * (1 - smoothstep(0.02, 0.3, rain))
    * smoothstep(0.5, 0.85, beam) * smoothstep(-1.2, -0.6, sunAlt) * (1 - smoothstep(1.5, 3, sunAlt));
  // Zodiacal light: astronomical darkness, no moon, a clear sky.
  const zodiacal = smoothstep(-15, -18, sunAlt) * (1 - moonLit * smoothstep(-3, 3, moonAlt)) * (1 - smoothstep(0.15, 0.5, cover));
  return {
    sunAlt, moonAlt, moonLit, night, sunUp, beam,
    rainbow, moonbow, halo, corona, rays, storm, strikesPerMinute,
    meteorRate, meteorVisibility, fireballShare, shower, satellites, greenFlash, zodiacal,
  };
}

// ---------------------------------------------------------------- lightning

const STRIKE_SLOT = 1;
const STRIKE_LENGTH = 1.4;

// The strike (if any) that begins in event-clock slot `slot`.
export function strikeInSlot(seed, slot, perMinute, forced = null) {
  const r = (salt) => hash(seed, CHANNEL.strike, slot, salt);
  if (forced) {
    // Every fourth second, in front of the camera.
    if (slot % 4 !== 0) return null;
  } else if (r(0) >= 1 - Math.exp(-(perMinute / 60) * STRIKE_SLOT)) {
    return null;
  }
  const at = slot * STRIKE_SLOT + (forced ? 0.25 : r(1) * STRIKE_SLOT);
  // A storm is a cell: strikes cluster round its bearing, which wanders.
  const block = Math.floor(at / 600);
  const cell = hash(seed, CHANNEL.cell, block) * 360;
  const bearing = forced ? forced.bearing + (r(2) - 0.5) * 24 : (cell + (r(2) - 0.5) * 110 + 360) % 360;
  const distanceKm = forced ? 4 + r(3) * 5 : 2.5 + 22 * Math.pow(r(3), 1.5);
  const kind = forced || r(4) < 0.3 ? "ground" : "cloud";
  // Return strokes 40-120 ms apart; in-cloud flashes are slower pulses.
  const count = kind === "ground" ? 1 + Math.floor(r(5) * 4) : 1 + Math.floor(r(5) * 2);
  const strokes = [];
  let t = 0;
  for (let i = 0; i < count; i++) {
    strokes.push({ t, amplitude: i === 0 ? 1 : 0.45 + 0.4 * hash(seed, CHANNEL.strike, slot, 10 + i) });
    t += kind === "ground" ? 0.04 + 0.08 * hash(seed, CHANNEL.strike, slot, 20 + i) : 0.12 + 0.15 * hash(seed, CHANNEL.strike, slot, 20 + i);
  }
  // Light falls off with distance and the rain between.
  const strength = Math.min(2, Math.pow(6 / distanceKm, 1.3)) * Math.exp(-distanceKm / 30);
  return { type: "lightning", at, bearing, distanceKm, kind, strokes, strength, shape: r(6), thunderDelay: distanceKm / 0.343 };
}

// Mean brightness of a strike over the frame [t - frame, t] (a camera
// integrates the light; a 35 ms stroke must not fall between frames).
export function strikeBrightness(strike, t, frame = 1 / 60) {
  const t0 = t - frame - strike.at;
  const t1 = t - strike.at;
  if (t1 < -0.05 || t0 > STRIKE_LENGTH) return 0;
  const tau = strike.kind === "ground" ? 0.035 : 0.09;
  // ∫ exp(-(x - o)/τ) dx over [max(t0, o), t1].
  const pulse = (o, a, k) => {
    const lo = Math.max(t0, o);
    if (t1 <= lo) return 0;
    return a * k * (Math.exp(-(lo - o) / k) - Math.exp(-(t1 - o) / k));
  };
  let sum = 0;
  for (const s of strike.strokes) sum += pulse(s.t, s.amplitude, tau);
  // Continuing current after the last stroke, and the faint stepped leader.
  const last = strike.strokes[strike.strokes.length - 1].t;
  sum += pulse(last, 0.12, 0.16);
  const leader = Math.max(0, Math.min(t1, 0) - Math.max(t0, -0.03)) * 0.05;
  return ((sum + leader) / Math.max(frame, 1e-3)) * strike.strength;
}

// ---------------------------------------------------------------- meteors

const METEOR_SLOT = 3;
const METEOR_LONGEST = 7;

export function meteorInSlot(seed, slot, conditions, forced = null) {
  const r = (salt) => hash(seed, CHANNEL.meteor, slot, salt);
  const rate = (conditions.meteorRate * conditions.meteorVisibility * LINGER) / 3600;
  if (forced) {
    if (slot % 2 !== 0) return null;
  } else if (r(0) >= 1 - Math.exp(-rate * METEOR_SLOT)) {
    return null;
  }
  const at = slot * METEOR_SLOT + (forced ? 0.2 : r(1) * METEOR_SLOT);
  const fromShower = !forced && conditions.shower && r(2) < conditions.shower.rate / conditions.meteorRate;
  const fireball = forced?.fireball || r(3) < (fromShower ? conditions.shower.fireballs : conditions.fireballShare);
  // Where it appears: anywhere above ~12°, more often lower (meteors burn
  // ~100 km up, so a low line of sight crosses more of that layer).
  const elevation = forced ? forced.elevation + (r(4) - 0.5) * 8 : Math.asin(0.2 + 0.8 * Math.pow(r(4), 1.4)) / DEG;
  const bearing = forced ? forced.bearing + (r(5) - 0.5) * 20 : r(5) * 360;
  const start = fromBearing(bearing, elevation);
  // Direction of flight: away from the shower's radiant along the great
  // circle through it; sporadics come from anywhere but rarely climb.
  let tangent;
  if (fromShower) {
    tangent = normalize(add(scale(start, dot(start, conditions.shower.radiant)), scale(conditions.shower.radiant, -1)));
  } else {
    const east = normalize(cross([0, 1, 0], start));
    const up = cross(start, east);
    const angle = (r(6) - 0.5) * Math.PI * 1.6 - Math.PI / 2; // mostly downward
    tangent = normalize(add(scale(east, Math.cos(angle)), scale(up, Math.sin(angle))));
  }
  const speed = fromShower ? conditions.shower.speed : 25 + 45 * r(7);
  // Shower meteors near their radiant are foreshortened.
  const foreshorten = fromShower ? Math.sqrt(Math.max(0.05, 1 - dot(start, conditions.shower.radiant) ** 2)) : 1;
  const length = (fireball ? 18 + 22 * r(8) : 6 + 18 * r(8)) * foreshorten * DEG;
  const duration = (fireball ? 1.6 + 1.6 * r(9) : 0.35 + 0.7 * r(9)) * (45 / speed) ** 0.6;
  const end = normalize(add(scale(start, Math.cos(length)), scale(tangent, Math.sin(length))));
  // Population index ~2.5: faint ones are far more common.
  const magnitude = fireball ? -4.5 - 3 * r(10) : 4 - 5 * Math.pow(r(10), 0.55);
  return {
    type: "meteor", at, start, end, duration, magnitude, fireball, speed,
    bearing, elevation, shower: fromShower ? conditions.shower.id : null,
    // Fast meteors burn green (Mg, O); slow ones yellow-orange (Na, Fe).
    green: smoothstep(35, 65, speed) * (0.4 + 0.6 * r(11)),
    train: fireball ? 2.5 + 3 * r(12) : 0,
    // Persistent train brightness per unit flux.
    glow: 0.0004,
  };
}

// sea-sky-magic: with the stars gift a meow is answered, a moment later,
// by a falling star where the cat is looking.
export const CALL_ANSWER = { delay: 1.2, magnitude: -1.5 };

function slerp(a, b, f) {
  const angle = Math.acos(Math.max(-1, Math.min(1, dot(a, b))));
  if (angle < 1e-6) return a;
  const s = Math.sin(angle);
  return add(scale(a, Math.sin((1 - f) * angle) / s), scale(b, Math.sin(f * angle) / s));
}

// The meteor's appearance at event-clock time t: head, trail tail, fluxes.
export function meteorState(meteor, t) {
  const age = t - meteor.at;
  if (age < 0 || age > meteor.duration + meteor.train) return null;
  const flux = Math.pow(10, -0.4 * meteor.magnitude);
  if (age <= meteor.duration) {
    const f = age / meteor.duration;
    // Light curve: brightens as it digs into denser air, flares, dies.
    const curve = Math.pow(Math.sin(Math.PI * Math.min(1, f * 1.05)), 0.7) * (meteor.fireball ? 1 + 1.5 * smoothstep(0.6, 0.85, f) * (1 - smoothstep(0.85, 1, f)) : 1);
    const head = slerp(meteor.start, meteor.end, f);
    const tail = slerp(meteor.start, meteor.end, Math.max(0, f - (meteor.fireball ? 0.45 : 0.3)));
    const train = meteor.train > 0 ? flux * (meteor.glow ?? 0.0004) * smoothstep(0.2, 0.6, f) : 0;
    return { head, tail, flux: flux * curve, train, green: meteor.green };
  }
  // A fireball's persistent train: ionised air glowing along the path,
  // fading over seconds.
  const fade = Math.exp(-(age - meteor.duration) / (meteor.train * 0.4));
  return { head: meteor.end, tail: meteor.start, flux: 0, train: flux * (meteor.glow ?? 0.0004) * fade, green: meteor.green };
}

// ---------------------------------------------------------------- satellites

const SATELLITE_SLOT = 40;
const EARTH_KM = 6371;

export function satelliteInSlot(seed, slot, conditions) {
  const r = (salt) => hash(seed, CHANNEL.satellite, slot, salt);
  // ~One naked-eye satellite every couple of minutes after dusk.
  if (r(0) >= 0.32 * Math.min(1, conditions.satellites * 2)) return null;
  const centre = slot * SATELLITE_SLOT + r(1) * SATELLITE_SLOT;
  const altitudeKm = 420 + 330 * r(2);
  const heading = r(3) * 360;
  // Closest approach to the zenith, as an angle at the Earth's centre.
  const offset = (r(4) - 0.5) * 0.24;
  return { type: "satellite", centre, altitudeKm, heading, offset, flare: r(5) < 0.15 ? r(6) * 2 - 1 : null, magnitude: 2.2 + 2 * r(7) };
}

// The satellite's direction and flux at event-clock time t, lit by the sun
// unless inside the Earth's (cylindrical) shadow.
export function satelliteState(satellite, t, sun) {
  const radius = EARTH_KM + satellite.altitudeKm;
  const omega = 7.66 / radius;
  const theta = (t - satellite.centre) * omega;
  if (Math.abs(theta) > 0.5) return null;
  const h = satellite.heading * DEG;
  const across = [Math.cos(h), 0, -Math.sin(h)];
  const normal = normalize(add(scale(across, Math.cos(satellite.offset)), scale([0, 1, 0], Math.sin(satellite.offset))));
  const u = normalize(add([0, 1, 0], scale(normal, -normal[1])));
  const v = cross(normal, u);
  const position = add(scale(u, Math.cos(theta) * radius), scale(v, Math.sin(theta) * radius));
  const relative = add(position, [0, -EARTH_KM, 0]);
  const range = Math.hypot(...relative);
  const direction = scale(relative, 1 / range);
  if (direction[1] < 0.03) return null;
  const along = dot(position, sun);
  const axis = Math.hypot(...add(position, scale(sun, -along)));
  // Behind the Earth (along < 0) and within its radius of the axis: eclipsed,
  // with a penumbral fade of a few tens of km.
  const lit = along > 0 ? 1 : smoothstep(EARTH_KM - 30, EARTH_KM + 30, axis);
  if (lit <= 0) return null;
  let magnitude = satellite.magnitude + 5 * Math.log10(range / satellite.altitudeKm) * 0.6;
  if (satellite.flare !== null) magnitude -= 4 * Math.exp(-((((theta / 0.5) - satellite.flare) / 0.03) ** 2));
  return { direction, flux: Math.pow(10, -0.4 * magnitude) * lit, range };
}

// ---------------------------------------------------------------- the frame

const NONE = Object.freeze({ events: [0, 0, 0, 0], bolt: [0, 0, 1, 0], optics: [0, 0, 0, 0], meteor: [0, 0, 1, 0], trail: [0, 0, 1, 0], streak: [0, 0, 0, 0], satellite: [0, 1, 0, 0] });

// The uniforms for a frame with nothing happening (shaders skip all work).
export function quietSkyUniforms() {
  return Object.fromEntries(Object.entries(NONE).map(([k, v]) => [k, [...v]]));
}

const luminance = (c) => c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;

// Lit cloud radiance per unit strike brightness, before exposure (sunlight
// is ~20): a strike 5 km away lights the base of the storm ~40 lux, a
// moonless night's sky many times over, a stormy day's barely.
const FLASH_RADIANCE = 0.03;

export function skyEventFrame({ seed, time, date = null, celestial, weather = null, sunlit = null, lighting = null, force = null, view = null, frameSeconds = 1 / 60, conditions = null, magic = null }) {
  // The stars gift does not add meteors: the real rate is the point. It
  // answers a meow with one (callAnswer). `magic`: { stars, callAt }.
  const c = conditions ?? skyConditions({ celestial, weather, sunlit, date });
  const facing = view ? { bearing: ((view.azimuth / DEG) % 360 + 360) % 360, elevation: Math.max(15, (view.pitch / DEG) + 12) } : { bearing: 0, elevation: 35 };
  const forced = (name) => force === name || (Array.isArray(force) && force.includes(name));
  const u = quietSkyUniforms();
  u.events[0] = forced("rainbow") ? 1 : forced("moonbow") ? (c.sunUp ? 0 : 1) : c.sunUp ? c.rainbow : c.moonbow;
  u.events[2] = forced("halo") ? 1 : c.halo;
  u.events[3] = forced("rays") ? 1 : c.rays;
  u.optics[0] = forced("corona") ? 1 : c.corona;
  u.optics[1] = forced("zodiacal") ? 1 : c.zodiacal;
  u.optics[2] = forced("green-flash") ? 1 : c.greenFlash;
  // Below a visible trace, off: the shaders gate on exactly zero.
  for (const v of [u.events, u.optics]) for (let i = 0; i < 3 + (v === u.events ? 1 : 0); i++) if (v[i] < 0.002) v[i] = 0;
  // Lightning: the strikes overlapping this frame; the brightest drives the
  // uniforms (two at once are rare and the eye cannot tell).
  const strikes = [];
  const perMinute = forced("lightning") ? 15 : c.strikesPerMinute;
  if (perMinute > 0) {
    const lightningForce = forced("lightning") ? facing : null;
    for (let slot = Math.floor((time - STRIKE_LENGTH) / STRIKE_SLOT); slot <= Math.floor(time / STRIKE_SLOT); slot++) {
      const strike = strikeInSlot(seed, slot, perMinute, lightningForce);
      if (strike && strike.at <= time + 0.05) strikes.push(strike);
    }
  }
  let flash = 0;
  let brightest = null;
  for (const strike of strikes) {
    const b = strikeBrightness(strike, time, frameSeconds);
    if (b > 0) {
      flash += b;
      if (!brightest || b > brightest.b) brightest = { strike, b };
    }
  }
  const exposure = lighting?.exposure ?? 1;
  if (brightest) {
    const s = brightest.strike;
    const base = Math.atan2(1.4, s.distanceKm);
    u.events[1] = flash > 0.01 ? flash * FLASH_RADIANCE : 0;
    // The channel glows only while current flows (strokes and continuing
    // current); its faint exponential tail would otherwise hang in the sky.
    const channel = brightest.b > 0.04 ? brightest.b * Math.exp(-s.distanceKm / 20) : 0;
    u.bolt = [Math.sin(s.bearing * DEG), base, Math.cos(s.bearing * DEG), s.kind === "ground" ? channel : 0];
    u.optics[3] = s.shape;
  }
  // The land under the flash: skylight gain for landscape.js.
  const skyLum = lighting ? Math.max(luminance(lighting.sky), 1e-4) : 0.1;
  const landFlash = Math.min(12, (flash * FLASH_RADIANCE * exposure * 0.6) / skyLum);
  // Meteors.
  let meteorNow = null;
  const meteorForce = forced("meteor") || forced("fireball") ? { ...facing, fireball: forced("fireball") } : null;
  if (meteorForce || c.meteorVisibility > 0.01) {
    for (let slot = Math.floor((time - METEOR_LONGEST) / METEOR_SLOT); slot <= Math.floor(time / METEOR_SLOT); slot++) {
      const meteor = meteorInSlot(seed, slot, c, meteorForce);
      const state = meteor && meteorState(meteor, time);
      if (state && (!meteorNow || state.flux + state.train > meteorNow.state.flux + meteorNow.state.train)) meteorNow = { meteor, state };
    }
  }
  // sea-sky-magic: a meow answered by a falling star (night only).
  const answer = callAnswer(seed, time, c, facing, magic);
  if (answer && (!meteorNow || answer.state.flux + answer.state.train > meteorNow.state.flux + meteorNow.state.train)) meteorNow = answer;
  if (meteorNow) {
    // The glowing line runs from trail.xyz to meteor.xyz: the fresh trail
    // behind the head in flight, then a fireball's whole persistent train.
    const { head, tail, flux, train, green } = meteorNow.state;
    u.meteor = [...head, flux];
    u.trail = [...tail, train];
    u.streak = [green, meteorNow.meteor.fireball ? 1 : 0, 0, 0];
  }
  // Satellites.
  let satelliteNow = null;
  if (forced("satellite")) {
    // Drifts across the middle of the view at a satellite's ~0.7°/s.
    const drift = ((time % 30) - 15) * 0.7;
    satelliteNow = { satellite: { type: "satellite" }, state: { direction: fromBearing(facing.bearing + drift, facing.elevation), flux: Math.pow(10, -0.4 * 1.5) } };
  } else if (c.satellites > 0.01) {
    for (let slot = Math.floor((time - 70) / SATELLITE_SLOT); slot <= Math.floor((time + 70) / SATELLITE_SLOT); slot++) {
      const satellite = satelliteInSlot(seed, slot, c);
      const state = satellite && satelliteState(satellite, time, celestial.sun);
      if (state && (!satelliteNow || state.flux > satelliteNow.state.flux)) satelliteNow = { satellite, state };
    }
    if (satelliteNow) satelliteNow.state.flux *= Math.min(1, c.satellites * 1.5);
  }
  if (satelliteNow) u.satellite = [...satelliteNow.state.direction, satelliteNow.state.flux];
  return {
    uniforms: u,
    flash,
    landFlash,
    strikes,
    meteor: meteorNow?.meteor ?? null,
    satellite: satelliteNow ? { ...satelliteNow.satellite, ...satelliteNow.state } : null,
    conditions: c,
  };
}

function callAnswer(seed, time, c, facing, magic) {
  if (!(magic?.stars > 0) || !Number.isFinite(magic.callAt) || c.meteorVisibility <= 0.01) return null;
  const at = magic.callAt + CALL_ANSWER.delay;
  if (time < at || time > at + METEOR_LONGEST + 6) return null;
  const slot = 2 * (100000 + Math.floor(magic.callAt * 8));
  const meteor = { ...meteorInSlot(seed, slot, c, { ...facing, fireball: false }), at, magnitude: CALL_ANSWER.magnitude };
  const state = meteorState(meteor, time);
  return state ? { meteor, state } : null;
}

// ---------------------------------------------------------------- live wrapper

const EASED = [["events", 0], ["events", 2], ["events", 3], ["optics", 0], ["optics", 1], ["optics", 2]];

export function createSkyEvents({ seed, force = null } = {}) {
  const listeners = new Set();
  const eased = new Map();
  let lastTime = null;
  const announced = new Set();
  let last = null;
  return {
    update(input) {
      const frame = skyEventFrame({ seed, force, ...input });
      const dt = lastTime === null ? Infinity : input.time - lastTime;
      // Rainbows, halos and rays fade in and out over a few seconds as the
      // sun comes and goes, instead of popping with the 4 Hz cloud beam.
      const k = dt > 0 && dt < 5 ? 1 - Math.exp(-dt / 2.5) : 1;
      for (const [field, i] of EASED) {
        const key = `${field}${i}`;
        const target = frame.uniforms[field][i];
        const value = (eased.get(key) ?? target) + (target - (eased.get(key) ?? target)) * k;
        eased.set(key, value);
        frame.uniforms[field][i] = value < 1e-3 ? 0 : value;
      }
      // Publish each strike and meteor once, when its light starts.
      if (dt > 0 && dt < 5) {
        for (const strike of frame.strikes) {
          const id = `l${strike.at}`;
          if (!announced.has(id) && strike.at <= input.time) {
            announced.add(id);
            const { strokes, shape, ...event } = strike;
            listeners.forEach((fn) => fn(event));
          }
        }
        const m = frame.meteor;
        if (m && !announced.has(`m${m.at}`)) {
          announced.add(`m${m.at}`);
          listeners.forEach((fn) => fn({ type: "meteor", at: m.at, bearing: m.bearing, elevation: m.elevation, fireball: m.fireball, magnitude: m.magnitude, shower: m.shower }));
        }
        if (announced.size > 64) announced.clear();
      } else {
        announced.clear();
      }
      lastTime = input.time;
      last = frame;
      return frame;
    },
    // listener(event); returns an unsubscribe function.
    on(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    get last() {
      return last;
    },
  };
}

// ---------------------------------------------------------------- spectacles

const TITLES = {
  rainbow: "Rainbow",
  moonbow: "Moonbow",
  halo: "22° halo",
  sundogs: "Sundogs",
  "moon-halo": "Moon halo",
  corona: "Corona round the Moon",
  rays: "Sunbeams",
  lightning: "Lightning",
  meteors: "Shooting stars",
  satellites: "Satellites",
  "green-flash": "Green flash",
  "earth-shadow": "Earth's shadow and the Belt of Venus",
  zodiacal: "Zodiacal light",
  "milky-way": "The Milky Way's core",
};

// When the sun next crosses `altitudeDeg` (rising or setting), scanning
// forward up to `hours`; null if it does not.
function sunCrossing(date, altitudeDeg, hours = 14, step = 5) {
  const start = skyAt(date).sunAltitude - altitudeDeg;
  for (let m = step; m <= hours * 60; m += step) {
    const d = new Date(date.getTime() + m * 60000);
    const a = skyAt(d).sunAltitude - altitudeDeg;
    if (Math.sign(a) !== Math.sign(start)) {
      // Refine linearly within the step.
      const prev = skyAt(new Date(d.getTime() - step * 60000)).sunAltitude - altitudeDeg;
      return new Date(d.getTime() - step * 60000 * (a / (a - prev)));
    }
  }
  return null;
}

// What a "look up" hint could point at, now or soon. Pure: the same inputs
// always give the same list.
export function skySpectacles({ date, celestial = null, weather = null, seed = 1, sunlit = null }) {
  const sky = celestial ?? skyAt(date);
  const c = skyConditions({ celestial: sky, weather, sunlit, date });
  const out = [];
  const push = (id, strength, extra) => {
    if (strength > 0.05 || extra.active === false) out.push({ id, title: TITLES[id], active: true, strength: +strength.toFixed(2), bearing: null, elevation: null, until: null, at: null, ...extra });
  };
  const sunBearing = bearingOf(sky.sun);
  const moonBearing = bearingOf(sky.moon);
  const anti = (sunBearing + 180) % 360;
  if (c.rainbow > 0.05) {
    // Lasts while the sun stays below 42° (morning) or above the horizon.
    const rising = skyAt(new Date(date.getTime() + 600000)).sunAltitude > c.sunAlt;
    push("rainbow", c.rainbow, { bearing: anti, elevation: Math.max(0, 42 - c.sunAlt), until: rising ? sunCrossing(date, 42, 6) : sunCrossing(date, -0.8, 6) });
  }
  if (c.moonbow > 0.05) push("moonbow", c.moonbow, { bearing: (moonBearing + 180) % 360, elevation: Math.max(0, 42 - c.moonAlt) });
  if (c.halo > 0.05) {
    const lunar = !c.sunUp;
    push(lunar ? "moon-halo" : "halo", c.halo, { bearing: lunar ? moonBearing : sunBearing, elevation: (lunar ? c.moonAlt : c.sunAlt) + 22 });
    if (!lunar && c.sunAlt < 50) push("sundogs", c.halo * (1 - smoothstep(35, 55, c.sunAlt)), { bearing: (sunBearing + 23) % 360, elevation: c.sunAlt });
  }
  if (c.corona > 0.05) push("corona", c.corona, { bearing: moonBearing, elevation: c.moonAlt });
  if (c.rays > 0.05) {
    push("rays", c.rays, { bearing: sunBearing, elevation: Math.max(0, c.sunAlt) + 5, until: sunCrossing(date, -3, 4) });
  }
  if (c.storm) {
    const cell = hash(seed, CHANNEL.cell, Math.floor(date.getTime() / 600000)) * 360;
    push("lightning", 1, { bearing: cell, elevation: 8 });
  }
  if (c.meteorVisibility > 0.2) {
    const rate = c.meteorRate * c.meteorVisibility;
    push("meteors", Math.min(1, rate / 30), {
      title: c.shower ? `${c.shower.title} meteors` : TITLES.meteors,
      bearing: c.shower ? bearingOf(c.shower.radiant) : null,
      elevation: c.shower ? altitude(c.shower.radiant) : null,
      perHour: Math.round(rate),
    });
  }
  if (c.satellites > 0.2 && c.sunAlt > -25) push("satellites", c.satellites * 0.5, { until: sunCrossing(date, -25, 4) });
  // Twilight's Earth shadow, every clear dusk and dawn (the atmosphere
  // model draws it; this only points it out).
  const clearish = 1 - smoothstep(0.4, 0.75, weather?.cover ?? 0);
  if (c.sunAlt < 2 && c.sunAlt > -6 && clearish > 0.3) push("earth-shadow", 0.4 * clearish, { bearing: anti, elevation: 4, until: sunCrossing(date, c.sunAlt > -2 && skyAt(new Date(date.getTime() + 600000)).sunAltitude < c.sunAlt ? -6 : 3, 2) });
  // The green flash: now, or due at the next sunset/sunrise within 40 min.
  if (c.greenFlash > 0.05) push("green-flash", c.greenFlash, { bearing: sunBearing, elevation: 0 });
  else if (clearish > 0.5 && (weather?.low ?? 0) < 0.15 && c.sunAlt > -0.5) {
    const next = sunCrossing(date, -0.55, 0.7, 1);
    if (next) push("green-flash", 0.3 * clearish, { active: false, at: next, bearing: sunBearing, elevation: 0 });
  }
  if (c.zodiacal > 0.05) push("zodiacal", c.zodiacal * 0.4, { bearing: sunBearing, elevation: 20 });
  // The galactic centre in Sagittarius, high on a dark moonless night.
  const core = localFromEquatorial(266.4, -28.9, sky.sidereal, sky.latitude);
  const coreView = smoothstep(-12, -16, c.sunAlt) * smoothstep(0.15, 0.45, core[1]) * (1 - c.moonLit * smoothstep(-2, 5, c.moonAlt) * 0.8) * (1 - smoothstep(0.3, 0.7, weather?.cover ?? 0));
  if (coreView > 0.05) push("milky-way", coreView * 0.6, { bearing: bearingOf(core), elevation: altitude(core) });
  return out.sort((a, b) => (b.active - a.active) || b.strength - a.strength);
}

export function parseSkyForce(search) {
  const params = new URLSearchParams(search);
  if (!params.has("perf")) return null;
  const value = params.get("sky");
  if (!value) return null;
  const names = value.split(",").filter((n) => FORCEABLE.includes(n));
  return names.length ? names : null;
}
