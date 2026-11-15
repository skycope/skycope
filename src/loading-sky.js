// The loading veil's sky (src/loading-screen.js draws it): what the
// renderer is about to show in each direction, before the world exists.
// Only what can be right: the Cape Town sky of this moment (the scattering
// model and exposure the renderer uses, sunlight.js; the sky pass's night
// floor, moon and cloud greying, skyview.wgsl / sky.wgsl; a cloud deck's
// mean light, clouds.wgsl) and the sea's mean colour under it, framed by
// the camera the world opens on. No land: each visit is a new island.
// Pure (no DOM): tests/loading-screen.test.js checks it against the
// shaders' constants, and docs/review/loading/ against rendered pixels.
import { lightingAt, skyRadiance } from "./sunlight.js";
import { toneAdapt } from "./tone-glsl.js";

// How far along loading is at each of main.js's milestones, by how long the
// steps before them take (building the island and its plants is the long
// one).
export const STAGES = { start: 0.12, gpu: 0.2, island: 0.34, world: 0.76, shaders: 0.94, ready: 1 };

export function progressAt(stage, current = 0) {
  return Math.max(current, STAGES[stage] ?? 0);
}

// ---- The view --------------------------------------------------------------

// The camera the world opens on (walker.js home() and placeCamera(); the
// terrain is not seeded, so it is the same every visit). Coast metres, and
// the renderer's azimuth / pitch (tests/loading-screen.test.js holds it to
// the walker's). main.js passes the real one when the walker exists.
export const HOME_VIEW = { x: 13.806, y: 1.865, z: 6.27, azimuth: -1.0743121484013352, pitch: -0.25 };

// view.wgsl's lens: forward weighted 0.9 against a unit-high screen.
const LENS = 0.9;

// Where the horizon (a level ray) crosses the screen, 0 at the top, 1 at
// the bottom: view.wgsl view_ray solved for ray.y = 0 (the camera has no
// roll, so it is a level line).
export function horizonAt(view) {
  return 0.5 + LENS * Math.tan(view.pitch);
}

// The renderer's ray (east, up, north) through a screen point (u right,
// v down, 0…1): view.wgsl view_ray with the pointer centred.
export function viewRay(view, u, v, aspect) {
  const { forward, right, up } = basis(view);
  const sx = (u - 0.5) * aspect;
  const sy = 0.5 - v;
  return normalize([0, 1, 2].map((c) => forward[c] * LENS + right[c] * sx + up[c] * sy));
}

function basis({ azimuth, pitch }) {
  const heading = [Math.sin(azimuth), 0, Math.cos(azimuth)];
  const right = [heading[2], 0, -heading[0]];
  const forward = [heading[0] * Math.cos(pitch), Math.sin(pitch), heading[2] * Math.cos(pitch)];
  return { forward, right, up: cross(forward, right) };
}

// A point in coast metres to the screen (u, v), or null behind the camera.
// The renderer's frame (east, up, north) is the coast frame turned 45°.
export function project(view, [x, y, z], aspect) {
  const dx = x - view.x;
  const dz = z - view.z;
  const d = [(dx - dz) * Math.SQRT1_2, y - view.y, (dx + dz) * Math.SQRT1_2];
  const { forward, right, up } = basis(view);
  const depth = dot(d, forward);
  if (depth < 0.05) return null;
  return [0.5 + (dot(d, right) * LENS) / depth / aspect, 0.5 - (dot(d, up) * LENS) / depth];
}

// Where the wisp first rises (wisp-mind.js appear): out of the sand 5.5 m
// ahead of the cat.
export function wispRise(cat) {
  return [cat.x + Math.sin(cat.heading) * 5.5, (cat.y ?? 0) + 0.25, cat.z + Math.cos(cat.heading) * 5.5];
}

// ---- The light -------------------------------------------------------------

// tone.wgsl's tone_curve, for one colour (tests check the constants agree).
export const TONE = { gain: 1.6, vibrance: 0.04, overcastBalance: [0.94, 0.99, 1.08], overcastVibrance: 0.14 };

export function toneCurve(hdr, adapt) {
  return toneInto(hdr[0], hdr[1], hdr[2], adapt, [0, 0, 0]);
}

function toneInto(r, g, b, adapt, out) {
  const rods = clamp01(adapt);
  const overcast = clamp01(-adapt);
  r = Math.max(0, r * TONE.gain * (1 + (TONE.overcastBalance[0] - 1) * overcast));
  g = Math.max(0, g * TONE.gain * (1 + (TONE.overcastBalance[1] - 1) * overcast));
  b = Math.max(0, b * TONE.gain * (1 + (TONE.overcastBalance[2] - 1) * overcast));
  const scotopic = r * 0.06 + g * 0.56 + b * 0.38;
  const warm = clamp01((r - b) / Math.max(r, 1e-4));
  const cones = smoothstep(0.18, 0.55, warm) * smoothstep(0.08, 0.3, scotopic);
  const k = rods * 0.6 * (1 - smoothstep(0.25, 1.5, scotopic)) * (1 - 0.9 * cones);
  r += (0.72 * scotopic - r) * k;
  g += (0.9 * scotopic - g) * k;
  b += (1.35 * scotopic - b) * k;
  const low = Math.min(r, g, b);
  const lift = low < 0.08 ? low - 6.25 * low * low : 0.04;
  r -= lift;
  g -= lift;
  b -= lift;
  const peak = Math.max(r, g, b);
  if (peak >= 0.76) {
    const top = 1 - 0.0576 / (peak - 0.52);
    const white = 1 - 1 / (0.15 * (peak - top) + 1);
    const scale = top / peak;
    r = r * scale + (top - r * scale) * white;
    g = g * scale + (top - g * scale) * white;
    b = b * scale + (top - b * scale) * white;
  }
  const luma = r * 0.2126 + g * 0.7152 + b * 0.0722;
  const most = Math.max(r, g, b);
  const chroma = (most - Math.min(r, g, b)) / Math.max(most, 1e-4);
  const vibrance = 1 + (TONE.vibrance + (TONE.overcastVibrance - TONE.vibrance) * overcast) * (1 - chroma) * (1 - rods);
  out[0] = Math.max(0, luma + (r - luma) * vibrance);
  out[1] = Math.max(0, luma + (g - luma) * vibrance);
  out[2] = Math.max(0, luma + (b - luma) * vibrance);
  return out;
}

const srgb = (v) => {
  v = clamp01(v);
  return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
};

// The sky pass's own numbers (tests/loading-screen.test.js reads them out
// of the shaders): skyview.wgsl MOON_TINT and overcast_sky's grey; sky.wgsl
// atmosphere_color's night floor (airglow and starlight) and moon aureole.
export const SKY = {
  moonTint: [0.9, 1.01, 1.19],
  airglow: [0.004, 0.007, 0.014],
  aureole: [0.05, 0.08, 0.14],
  overcastGrey: [0.92, 0.96, 1],
};
const { moonTint: MOON_TINT, airglow: AIRGLOW } = SKY;

// The symmetric half of the clear sky about a light's vertical: rows by
// elevation (square-root spaced, crowding the horizon), columns by angle
// from the light's azimuth (squared, crowding the light).
const ROWS = 20;
const COLS = 25;
function lobeTable(light, samples) {
  const table = new Float32Array(ROWS * COLS * 3);
  const az = Math.atan2(light[0], light[2]);
  for (let j = 0; j < ROWS; j++) {
    const el = (j / (ROWS - 1)) ** 2 * (Math.PI / 2);
    for (let i = 0; i < COLS; i++) {
      const a = az + (i / (COLS - 1)) ** 2 * Math.PI;
      const c = skyRadiance([Math.cos(el) * Math.sin(a), Math.sin(el), Math.cos(el) * Math.cos(a)], light, samples);
      table.set(c, (j * COLS + i) * 3);
    }
  }
  return { table, az };
}

function lobeAt({ table, az }, ray, out) {
  const el = Math.asin(clamp(ray[1], 0, 1));
  let rel = Math.abs(Math.atan2(ray[0], ray[2]) - az) % (Math.PI * 2);
  if (rel > Math.PI) rel = Math.PI * 2 - rel;
  const fj = Math.sqrt(el / (Math.PI / 2)) * (ROWS - 1);
  const fi = Math.sqrt(rel / Math.PI) * (COLS - 1);
  const j = Math.min(ROWS - 2, Math.floor(fj));
  const i = Math.min(COLS - 2, Math.floor(fi));
  const tj = fj - j;
  const ti = fi - i;
  for (let c = 0; c < 3; c++) {
    const a = table[(j * COLS + i) * 3 + c] * (1 - ti) + table[(j * COLS + i + 1) * 3 + c] * ti;
    const b = table[((j + 1) * COLS + i) * 3 + c] * (1 - ti) + table[((j + 1) * COLS + i + 1) * 3 + c] * ti;
    out[c] = a * (1 - tj) + b * tj;
  }
  return out;
}

// The parts of the picture the renderer draws with noise (the cloud
// march, the waves) as their means: fitted against its rendered pixels for
// dawn, noon, golden hour, dusk and night, clear and overcast
// (scripts/loading-capture.mjs agree; docs/review/loading/).
export const MEAN = {
  // clouds.wgsl: a deck's light, from the skylight above, the sky behind it
  // and the sun through it (a forward lobe), brighter overhead.
  deckSky: 0.55,
  deckBase: 0.3,
  deckSun: 0.088,
  deckLobe: 0.73,
  deckUp: 0.51,
  // water.wgsl: the sea mirrors sky tilted up by the waves (more as it
  // nears), by Fresnel, over the water's own colour.
  seaTilt: 0,
  seaSlope: 1.95,
  seaWater: 5.7,
  seaSun: 0,
  seaGloss: 0.61,
};
const WATER = [0.012, 0.03, 0.036];

// What the renderer will show in each direction, in exposed linear light:
// `sky(ray)` above the horizon (sky.wgsl atmosphere_color without the
// stars, a cloud deck's mean where there is one, deck_light's slot of low
// sun under its edge) and `sea(ray)` below.
export function skyField(celestial, weather = null, mean = MEAN) {
  const light = lightingAt(celestial, weather);
  const { exposure, night } = light;
  const cover = weather?.cover ?? 0;
  const rain = weather?.rain ?? 0;
  const sunDir = celestial.sun;
  const sun = lobeTable(sunDir, 12);
  const moonLit = 0.5 - 0.5 * Math.cos(celestial.moonPhase * Math.PI * 2);
  const moonK = 0.003 * moonLit * smoothstep(-0.02, 0.05, celestial.moon[1]) * 0.6;
  const moon = night > 0.001 && moonK > 0 ? lobeTable(celestial.moon, 6) : null;
  const moonVisible = smoothstep(-0.01, 0.02, celestial.moon[1]) * moonLit;
  // skyview.wgsl overcast_sky.
  const overcast = smoothstep(0.55, 1, cover);
  const gloom = 1 - overcast * 0.25 - smoothstep(0.2, 4, rain) * 0.35;
  // How much of the dome a deck hides, and how dark it is underneath.
  const decks = Math.max(weather?.low ?? 0, (weather?.mid ?? 0) * 0.9);
  const hidden = smoothstep(0.35, 0.95, Math.max(decks, cover * 0.95));
  const dim = (1 - (weather?.low ?? 0) * cover * 0.25) * (1 - smoothstep(0.3, 8, rain) * 0.4);
  // sky.wgsl deck_light: the low sun's slot under a heavy deck.
  const heavy = smoothstep(0.45, 0.9, cover) * (cover > 0.45 ? 1 : 0);
  const low = smoothstep(-0.12, -0.02, sunDir[1]) * (1 - smoothstep(0.12, 0.3, sunDir[1])) * (1 - night);
  const sunFlat = Math.hypot(sunDir[0], sunDir[2]) || 1;
  const scratch = [0, 0, 0];
  const clearSky = (ray, out) => {
    lobeAt(sun, ray, out);
    for (let c = 0; c < 3; c++) out[c] *= exposure;
    return out;
  };
  const behind = (ray, out) => {
    clearSky(ray, out);
    const y = clamp01(ray[1]);
    for (let c = 0; c < 3; c++) out[c] += AIRGLOW[c] * night * (1 + (1 - y) * 1.5);
    if (moon) {
      const m = luminance(lobeAt(moon, ray, scratch)) * moonK * exposure;
      const d = Math.hypot(ray[0] - celestial.moon[0], ray[1] - celestial.moon[1], ray[2] - celestial.moon[2]);
      const aureole = Math.exp(-d * 14) * night * moonVisible;
      for (let c = 0; c < 3; c++) out[c] += m * MOON_TINT[c] + SKY.aureole[c] * aureole;
    }
    const grey = luminance(out);
    for (let c = 0; c < 3; c++) out[c] = (out[c] + (grey * SKY.overcastGrey[c] - out[c]) * overcast * 0.75) * gloom;
    return out;
  };
  const deck = (ray, base, out) => {
    const mu = dot(ray, sunDir) * (1 - night) + dot(ray, celestial.moon) * night;
    const lobe = 0.6 * hg(mu, mean.deckLobe) + 0.4 * hg(mu, -0.18);
    const up = 1 + mean.deckUp * Math.max(0, ray[1]);
    for (let c = 0; c < 3; c++)
      out[c] = (light.sky[c] * mean.deckSky + base[c] * mean.deckBase + light.direct[c] * lobe * mean.deckSun * (1 - cover * 0.6)) * dim * up;
    return out;
  };
  const deckOut = [0, 0, 0];
  const slotSky = [0, 0, 0];
  const sky = (ray, out = [0, 0, 0]) => {
    behind(ray, out);
    if (hidden > 0.001) {
      deck(ray, out, deckOut);
      for (let c = 0; c < 3; c++) out[c] += (deckOut[c] - out[c]) * hidden;
    }
    if (heavy > 0 && low > 0) {
      const up = Math.max(ray[1], 0);
      const flat = Math.hypot(ray[0], ray[2]) || 1;
      const toward = Math.max(0, (ray[0] * sunDir[0] + ray[2] * sunDir[2]) / (flat * sunFlat));
      // The ragged edge at its mean height.
      const height = 0.008 + 0.015 * (0.4 + 0.6 * toward);
      const slot = Math.exp(-up / height) * smoothstep(-0.006, 0.003, ray[1]) * (0.15 + 0.85 * toward * toward) * low * heavy;
      clearSky([ray[0], Math.max(ray[1], 0.004), ray[2]], slotSky);
      const k = Math.min(slot, 1) * 0.9;
      const fade = smoothstep(0.01, 0.12, up);
      const underlit = Math.exp(-up / 0.12) * toward ** 3 * low * heavy * hidden * (0.6 + 0.4 * fade) * 0.35;
      for (let c = 0; c < 3; c++) out[c] += (slotSky[c] * (1.2 + 0.8 * toward) - out[c]) * k + slotSky[c] * underlit;
    }
    return out;
  };
  const sunUp = Math.max(0, sunDir[1]) * (1 - cover * 0.7);
  const body = [0, 1, 2].map((c) => WATER[c] * mean.seaWater * (light.sky[c] * 2.2 + light.direct[c] * sunUp * mean.seaSun));
  const sea = (ray, out = [0, 0, 0]) => {
    const tilt = Math.max(0, -ray[1]) * mean.seaSlope + mean.seaTilt;
    const mirrored = normalize([ray[0], tilt, ray[2]]);
    const fresnel = (0.02 + 0.98 * (1 - Math.min(1, tilt + 0.02)) ** 5) * mean.seaGloss;
    sky(mirrored, out);
    for (let c = 0; c < 3; c++) out[c] = out[c] * fresnel + body[c] * (1 - fresnel);
    return out;
  };
  return { light, sky, sea, adapt: toneAdapt(night, cover), cover, night, hidden };
}

// One direction's display colour (sRGB 0…255), as the veil paints it.
export function skyColour(celestial, weather, direction) {
  const field = skyField(celestial, weather);
  const d = normalize(direction);
  const hdr = d[1] >= 0 ? field.sky(d) : field.sea(d);
  return toneCurve(hdr, field.adapt).map((v) => Math.round(srgb(v) * 255));
}

// The veil's colour table: TABLE_W azimuth columns (texel centres at
// (i + ½) / TABLE_W of a turn from north through east) by 2 × HALF rows:
// the sky from the horizon (row 0) to the zenith (HALF − 1), square-root
// spaced, then the sea from the horizon down. Exposed linear light, RGBA,
// as floats (`hdr`) and as half floats for the GPU (`half`); the shader
// tones it with tone.wgsl's own curve.
export const TABLE_W = 128;
export const HALF = 32;

export function skyTable(celestial, weather = null) {
  const field = skyField(celestial, weather);
  const hdr = new Float32Array(TABLE_W * HALF * 2 * 4);
  const c3 = [0, 0, 0];
  for (let j = 0; j < HALF * 2; j++) {
    const below = j >= HALF;
    const s = (j % HALF) / (HALF - 1);
    // A hair off the horizon on either side, as the renderer's own rays.
    const el = (below ? -1 : 1) * Math.max(0.0015, s * s * (Math.PI / 2));
    const ce = Math.cos(el);
    for (let i = 0; i < TABLE_W; i++) {
      const az = ((i + 0.5) / TABLE_W) * Math.PI * 2;
      (below ? field.sea : field.sky)([ce * Math.sin(az), Math.sin(el), ce * Math.cos(az)], c3);
      hdr.set(c3, (j * TABLE_W + i) * 4);
      hdr[(j * TABLE_W + i) * 4 + 3] = 1;
    }
  }
  // The sun's disc and aureole (water.wgsl composites them over the sky):
  // hidden by a deck and by night.
  const clear = (1 - field.hidden) * (1 - field.night) * smoothstep(-0.01, 0.01, celestial.sun[1]);
  const disc = field.light.direct.map((v) => v * 60 * clear);
  const glow = field.light.direct.map((v) => v * 0.12 * clear);
  return { hdr, half: toHalf(hdr), sun: celestial.sun, disc, glow, adapt: field.adapt, field };
}

// A table entry's display colour (sRGB 0…255) through the JS twin of the
// tone curve: the CSS sky and the tests.
export function tableColour(table, row, column) {
  const k = (row * TABLE_W + column) * 4;
  return toneCurve([table.hdr[k], table.hdr[k + 1], table.hdr[k + 2]], table.adapt).map((v) => Math.round(srgb(v) * 255));
}

// The table down the centre of a view as a CSS gradient (sky stops above
// the horizon, sea below, a hard step between).
export function cssSky(table, view, aspect = 16 / 10) {
  const stops = cssStops(table, view, aspect).map(({ at, colour }) => `#${colour} ${(at * 100).toFixed(2)}%`);
  return `linear-gradient(${stops.join(", ")})`;
}

// The stops: `sky` + 1 from the top to the horizon, `sea` + 1 from there to
// the bottom; { at (0…1 down), colour (hex) }.
export function cssStops(table, view, aspect = 16 / 10, sky = 8, sea = 6) {
  const h = horizonAt(view);
  const stop = (v) => {
    const ray = viewRay(view, 0.5, v, aspect);
    const u = (((Math.atan2(ray[0], ray[2]) / (Math.PI * 2)) % 1) + 1) % 1;
    const s = Math.sqrt(Math.min(Math.abs(Math.asin(clamp(ray[1], -1, 1))), Math.PI / 2) / (Math.PI / 2));
    const row = Math.round(s * (HALF - 1)) + (ray[1] < 0 ? HALF : 0);
    const colour = tableColour(table, row, Math.min(TABLE_W - 1, Math.floor(u * TABLE_W)));
    return { at: v, colour: colour.map((c) => c.toString(16).padStart(2, "0")).join("") };
  };
  const stops = [];
  // Crowded toward the horizon, where the sky changes fastest (a low sun's
  // glow is a thin band there).
  if (h > 0) for (let k = 0; k <= sky; k++) stops.push(stop(Math.min(1, h - 0.0005) * (1 - (1 - k / sky) ** 2)));
  if (h < 1) for (let k = 0; k <= sea; k++) stops.push(stop(Math.max(0, h + 0.0005) + (1 - Math.max(0, h + 0.0005)) * (k / sea)));
  return stops;
}

const F32 = new Float32Array(1);
const U32 = new Uint32Array(F32.buffer);
function toHalf(values) {
  const out = new Uint16Array(values.length);
  for (let i = 0; i < values.length; i++) {
    F32[0] = values[i];
    const x = U32[0];
    const sign = (x >>> 16) & 0x8000;
    const e = ((x >>> 23) & 0xff) - 112;
    const m = x & 0x7fffff;
    if (e <= 0) out[i] = e < -10 ? sign : sign | (((m | 0x800000) >> (1 - e)) + 0x1000) >> 13;
    else out[i] = e >= 31 ? sign | 0x7c00 : sign | ((e << 10) + ((m + 0x1000) >> 13));
  }
  return out;
}

// Henyey-Greenstein, normalised so an isotropic scatterer averages 1.
function hg(mu, g) {
  return (1 - g * g) / Math.pow(Math.max(1 + g * g - 2 * g * mu, 1e-4), 1.5);
}

function luminance(c) {
  return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function normalize(v) {
  const n = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / n, v[1] / n, v[2] / n];
}

function smoothstep(a, b, x) {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function clamp01(v) {
  return clamp(v, 0, 1);
}

