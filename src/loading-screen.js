// The loading veil: the first moment of the place. A soft painting of the
// view the world opens on (the home beach, from the camera the walker will
// use), lit by the real Cape Town sky of the moment: the same scattering
// model (sunlight.js) and tone curve (tone.wgsl) as the renderer, the same
// weather. Over it drifts the wisp, a small living light that follows a
// pointer or a touch and grows brighter as the world builds (main.js reports
// its milestones). On the first real frame the painting dissolves into the
// picture it was an impression of, and the wisp settles to the sand where
// the real one will rise (wisp-mind.js appear).
//
// Cheap on purpose: index.html loads this before main.js, the painting is a
// small 2D canvas drawn once per change (and smoothed by the browser's
// upscale), and every motion is a CSS transform or opacity, so it keeps
// moving on the compositor while the main thread builds the island.
import { skyAt } from "./astronomy.js";
import { MATERIAL_LINEAR } from "./material-palette.js";
import { lightingAt, skyRadiance } from "./sunlight.js";
import { ISLAND, islandPoint, noise2, shoreDistance, smoothstep, terrainHeight } from "./terrain.js";
import { toneAdapt } from "./tone-glsl.js";
import { presetWeather } from "./weather-panel.js";

// How far along loading is at each of main.js's milestones, by how long the
// steps before them take (building the island and its plants is the long
// one).
export const STAGES = { start: 0.12, gpu: 0.2, island: 0.34, world: 0.76, shaders: 0.94, ready: 1 };

export function progressAt(stage, current = 0) {
  return Math.max(current, STAGES[stage] ?? 0);
}

// ---- The view --------------------------------------------------------------

// landscape.js's lens: the vertical half-angle's tangent.
const TAN = 0.5 / 0.9;
// walker.js home() and placeCamera(): the cat just up the beach, the follow
// camera behind it (tests/loading-screen.test.js holds them together).
const HOME_THETA = Math.atan2(-ISLAND.z, 6 - ISLAND.x);
const EYE = { inland: 3.2, turn: Math.PI / 2 + 0.35, distance: 3.4, elevation: 0.38, chest: 0.364, lift: 0.13 };

// The camera the world opens on, until main.js passes the real one.
export function homeView() {
  const cat = islandPoint(HOME_THETA, EYE.inland);
  const yaw = HOME_THETA + EYE.turn;
  const ty = terrainHeight(cat.x, cat.z) + EYE.chest;
  const across = Math.cos(EYE.elevation) * EYE.distance;
  const x = cat.x - Math.sin(yaw) * across;
  const z = cat.z - Math.cos(yaw) * across;
  const ground = shoreDistance(x, z) > -1 ? terrainHeight(x, z) + 0.45 : 0.9;
  const y = Math.max(ty + Math.sin(EYE.elevation) * EYE.distance, ground, 0.9);
  return { x, y, z, azimuth: yaw - Math.PI / 4, pitch: Math.atan2(ty - y, across) + EYE.lift };
}

// The camera's axes in coast metres (landscape.js: x right, z out to sea
// from the home view; the Three scene mirrors z, this does not).
function axes({ azimuth, pitch }) {
  const hx = (Math.sin(azimuth) + Math.cos(azimuth)) * Math.SQRT1_2;
  const hz = (Math.cos(azimuth) - Math.sin(azimuth)) * Math.SQRT1_2;
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  return { f: [hx * cp, sp, hz * cp], r: [hz, 0, -hx], u: [-sp * hx, cp, -sp * hz] };
}

// A point in coast metres to the screen (0…1 across, 0…1 down), or null
// behind the camera.
export function project(view, [x, y, z], aspect) {
  const { f, r, u } = axes(view);
  const d = [x - view.x, y - view.y, z - view.z];
  const depth = dot(d, f);
  if (depth < 0.05) return null;
  return [0.5 + (0.5 * dot(d, r)) / (depth * TAN * aspect), 0.5 - (0.5 * dot(d, u)) / (depth * TAN)];
}

// A point far out on the sea straight ahead of a camera.
function ahead(view) {
  const turn = view.azimuth + Math.PI / 4;
  return [view.x + Math.sin(turn) * 4000, 0, view.z + Math.cos(turn) * 4000];
}

// Where the wisp first rises: out of the sand ahead of the cat.
export function wispRise(cat) {
  const x = cat.x + Math.sin(cat.heading) * 5.5;
  const z = cat.z + Math.cos(cat.heading) * 5.5;
  return [x, Math.max(terrainHeight(x, z), 0) + 0.6, z];
}

// ---- The light -------------------------------------------------------------

// tone.wgsl's tone_curve, for one colour (tests check the constants agree).
export const TONE = { gain: 1.35, vibrance: 0.04, overcastBalance: [0.94, 0.99, 1.08], overcastVibrance: 0.14 };

export function toneCurve(hdr, adapt) {
  return toneInto(hdr[0], hdr[1], hdr[2], adapt, [0, 0, 0]);
}

// The same, scalar and in place (it runs per pixel).
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

// sRGB encoding, 0…1 to 0…255, by table.
const SRGB = Float32Array.from({ length: 4097 }, (_, i) => {
  const v = i / 4096;
  return (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055) * 255;
});
const encode = (v) => SRGB[Math.round(clamp01(v) * 4096)];

// The sky the renderer will draw, as a function of direction (coast
// metres): exposed linear light, from a small table of the scattering
// integral (it is symmetric about the sun's vertical), greyed by cloud.
export function skyModel(celestial, weather = null) {
  const light = lightingAt(celestial, weather);
  const cover = weather?.cover ?? 0;
  const night = light.night;
  const sunAz = Math.atan2(celestial.sun[0], celestial.sun[2]);
  const moonLit = 0.5 - 0.5 * Math.cos(celestial.moonPhase * Math.PI * 2);
  const moonK = 0.003 * moonLit * smoothstep(-0.02, 0.05, celestial.moon[1]) * 0.6;
  const ROWS = 18;
  const COLS = 13;
  const table = new Float32Array(ROWS * COLS * 3);
  const elevationAt = (j) => (j / (ROWS - 1)) ** 2 * (Math.PI / 2);
  for (let j = 0; j < ROWS; j++)
    for (let i = 0; i < COLS; i++) {
      const el = elevationAt(j);
      const az = sunAz + (i / (COLS - 1)) * Math.PI;
      const view = [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)];
      const sun = skyRadiance(view, celestial.sun, 6);
      const moon = moonK > 0 ? luminance(skyRadiance(view, celestial.moon, 4)) * moonK : 0;
      for (let c = 0; c < 3; c++)
        table[(j * COLS + i) * 3 + c] =
          (sun[c] + moon * [0.9, 1.01, 1.19][c]) * light.exposure + [0.004, 0.007, 0.014][c] * night;
    }
  // Under cloud the dome goes the grey of its own light (lightingAt's
  // skylight does the same), darker in rain.
  const grey = Math.min(1, cover * 0.85);
  const gloom = light.gloom;
  const out = [0, 0, 0];
  const at = (d) => {
    // Coast metres to celestial east / up / north (landscape.js's frame).
    const east = (d[0] - d[2]) * Math.SQRT1_2;
    const north = (d[0] + d[2]) * Math.SQRT1_2;
    const el = Math.asin(Math.max(0, Math.min(1, d[1])));
    let rel = Math.abs(Math.atan2(east, north) - sunAz) % (Math.PI * 2);
    if (rel > Math.PI) rel = Math.PI * 2 - rel;
    const fj = Math.sqrt(el / (Math.PI / 2)) * (ROWS - 1);
    const fi = (rel / Math.PI) * (COLS - 1);
    const j = Math.min(ROWS - 2, Math.floor(fj));
    const i = Math.min(COLS - 2, Math.floor(fi));
    const tj = fj - j;
    const ti = fi - i;
    for (let c = 0; c < 3; c++) {
      const a = table[(j * COLS + i) * 3 + c] * (1 - ti) + table[(j * COLS + i + 1) * 3 + c] * ti;
      const b = table[((j + 1) * COLS + i) * 3 + c] * (1 - ti) + table[((j + 1) * COLS + i + 1) * 3 + c] * ti;
      out[c] = a * (1 - tj) + b * tj;
    }
    const y = luminance(out);
    for (let c = 0; c < 3; c++) out[c] = (out[c] + (y * [0.96, 0.99, 1.05][c] - out[c]) * grey) * gloom;
    return out;
  };
  return { light, at, adapt: toneAdapt(night, cover), cover, night };
}

// One direction's display colour (sRGB, 0…255): what the veil paints there.
export function skyColour(celestial, weather, direction) {
  const sky = skyModel(celestial, weather);
  const d = normalize(direction);
  return toneCurve(sky.at(d), sky.adapt).map((v) => Math.round(encode(v)));
}

// ---- The painting ----------------------------------------------------------

// The land's own reflectances (material-palette.js); a crown of leaves
// shades most of itself.
const { sand: SAND, wetSand: WET_SAND, dryThatch: THATCH, moss: MOSS, leaf: LEAF } = MATERIAL_LINEAR;
const SCRUB = THATCH.map((v, i) => v * 0.55 + MOSS[i] * 0.45);
const CANOPY = LEAF.map((v) => v * 0.45);
const DEEP = [0.01, 0.04, 0.055];
const SHALLOW = [0.16, 0.2, 0.17];

// The view at `width` × `height` pixels (RGBA): sky with soft cloud, then
// the land and sea marched column by column front to back (a heightfield
// seen from a level-ish camera), each lit by this hour's light, fogged into
// the horizon, toned and dithered.
export function paint(width, height, { celestial, weather = null, view = homeView(), seed = 1 }) {
  const sky = skyModel(celestial, weather);
  const { light, adapt, cover } = sky;
  const { f, r, u } = axes(view);
  const aspect = width / height;
  const hdr = new Float32Array(width * height * 3);
  const sun = celestial.sun;
  // Celestial (east, up, north) to coast metres.
  const sunCoast = [(sun[0] + sun[2]) * Math.SQRT1_2, sun[1], (sun[2] - sun[0]) * Math.SQRT1_2];
  // Lambert, as the land layer lights itself: the sun's share over π (less
  // the trees' and boulders' shade), the sky's whole.
  const lit = light.direct.map((v) => (v * Math.max(0, sunCoast[1]) * (1 - 0.85 * cover) * 0.8) / Math.PI);
  // By night the land layer adds a cool key from the sky's bright side.
  const ambient = light.sky.map((v) => v * (1 + 2.5 * light.night));
  // The pixel's ray, into `d`.
  const d = [0, 0, 0];
  const ray = (i, j) => {
    const a = ((2 * (i + 0.5)) / width - 1) * TAN * aspect;
    const b = (1 - (2 * (j + 0.5)) / height) * TAN;
    const x = f[0] + a * r[0] + b * u[0];
    const y = f[1] + a * r[1] + b * u[1];
    const z = f[2] + a * r[2] + b * u[2];
    const n = Math.sqrt(x * x + y * y + z * z);
    d[0] = x / n;
    d[1] = y / n;
    d[2] = z / n;
  };

  // Land and sea, column by column: march out along the column's bearing,
  // and fill each sample's rows up to where the last nearer one reached.
  const fog = 0.0032;
  const skyline = new Int32Array(width);
  for (let i = 0; i < width; i++) {
    ray(i, (height - 1) / 2);
    const across = Math.hypot(d[0], d[2]) || 1;
    const dx = d[0] / across;
    const dz = d[2] / across;
    d[0] = dx;
    d[1] = 0.02;
    d[2] = dz;
    const horizon = sky.at(d).slice();
    let reached = height;
    // Each column starts at its own fraction of a step, so the steps do not
    // line up into stairs.
    for (let s = 0.3 + 0.3 * hash01(i); s < 6000 && reached > 0; s = s * 1.03 + 0.03) {
      const x = view.x + dx * s;
      const z = view.z + dz * s;
      // Past the farthest shore it is all open sea.
      const open = Math.hypot(x - ISLAND.x, z - ISLAND.z) > 100;
      const inland = open ? -40 : shoreDistance(x, z);
      const ground = inland > -12 ? terrainHeight(x, z) : -2;
      const canopy = inland > 6 ? smoothstep(7, 14, inland) * (3.4 + 3.2 * noise2(x * 0.19, z * 0.21)) : 0;
      const top = Math.max(ground, 0) + canopy;
      const ex = x - view.x;
      const ey = top - view.y;
      const ez = z - view.z;
      const depth = ex * f[0] + ey * f[1] + ez * f[2];
      if (depth < 0.05) continue;
      const row = Math.floor((0.5 - (0.5 * (ex * u[0] + ey * u[1] + ez * u[2])) / (depth * TAN)) * height);
      if (row >= reached) continue;
      const haze = 1 - Math.exp(-((fog * s) ** 2));
      // The land is one colour per sample; the sea varies by row.
      const sea = ground < 0;
      const shallow = Math.exp(ground / 1.4);
      const trees = canopy > 0.4;
      // The wood's first, low trees fade in from the scrub (no comb of
      // single-sample spikes along its edge).
      const ground0 = inland < 1.4 ? WET_SAND : mixColour(SAND, SCRUB, smoothstep(3.5, 10, inland));
      const albedo = sea ? null : trees ? mixColour(ground0, CANOPY, smoothstep(0.4, 3, canopy)) : ground0;
      // Crowns: lit on top, dappled, dark beneath.
      const dapple = trees ? 0.65 + 0.7 * noise2(x * 0.35, z * 0.35) : 1;
      for (let j = Math.max(0, row); j < reached; j++) {
        const k = (j * width + i) * 3;
        let reflected = null;
        let fresnel = 0;
        if (sea) {
          // The sky's reflection by Fresnel, over the water's own colour
          // (paler where sand shows through the shallows).
          // Waves tilt it toward higher, bluer sky than a mirror would.
          ray(i, j);
          const cos = Math.max(0, -d[1]) + 0.1;
          fresnel = 0.02 + 0.98 * (1 - Math.min(1, cos)) ** 5;
          d[1] = cos;
          reflected = sky.at(normalize(d));
        }
        const sunlit = trees ? dapple * (1.2 - 0.6 * Math.min(1, (j - row) / 8)) : 1;
        for (let q = 0; q < 3; q++) {
          const c = sea
            ? reflected[q] * fresnel + (DEEP[q] + (SHALLOW[q] - DEEP[q]) * shallow) * (ambient[q] + lit[q]) * (1 - fresnel)
            : albedo[q] * (ambient[q] * (trees ? dapple : 1) + lit[q] * sunlit);
          hdr[k + q] = c + (horizon[q] - c) * haze;
        }
      }
      reached = Math.min(reached, Math.max(0, row));
    }
    skyline[i] = reached;
  }

  // The sky above it, with clouds on a deck 1.5 km up, placed by the seed.
  const shiftX = (seed % 997) * 0.37;
  const cloudAmount = Math.max(cover, weather?.low ?? 0, weather?.mid ?? 0);
  const cloudLit = [0, 1, 2].map((c) => (light.direct[c] * Math.max(0.05, sunCoast[1] + 0.1) * 0.35 + ambient[c] * 1.4) * (1 - 0.5 * cover));
  for (let i = 0; i < width; i++)
    for (let j = 0; j < skyline[i]; j++) {
      ray(i, j);
      const c = sky.at(d);
      if (cloudAmount > 0.02 && d[1] > 0.004) {
        const t = 1.5 / d[1];
        const px = d[0] * t + shiftX;
        const pz = d[2] * t;
        const n = noise2(px * 0.9, pz * 0.9) * 0.65 + noise2(px * 2.7, pz * 2.4) * 0.35;
        const edge = 1 - cloudAmount;
        const density = smoothstep(edge - 0.08, edge + 0.3, n) * (0.35 + 0.65 * smoothstep(0, 0.25, d[1])) * Math.min(1, cloudAmount * 2.5);
        const shade = 0.75 + 0.5 * n;
        for (let k = 0; k < 3; k++) c[k] += (cloudLit[k] * shade - c[k]) * density;
      }
      hdr.set(c, (j * width + i) * 3);
    }

  // Toned, encoded and dithered (a triangular ±1 step, so the smooth
  // upscale shows no bands).
  const pixels = new Uint8ClampedArray(width * height * 4);
  let noise = seed >>> 0 || 1;
  const random = () => {
    noise ^= noise << 13;
    noise ^= noise >>> 17;
    noise ^= noise << 5;
    return (noise >>> 0) / 4294967296;
  };
  const c = [0, 0, 0];
  for (let p = 0; p < width * height; p++) {
    toneInto(hdr[p * 3], hdr[p * 3 + 1], hdr[p * 3 + 2], adapt, c);
    for (let q = 0; q < 3; q++) pixels[p * 4 + q] = encode(c[q]) + random() - random() + 0.5;
    pixels[p * 4 + 3] = 255;
  }
  return pixels;
}

// ---- The veil --------------------------------------------------------------

const WEATHER_KEY = "skycope.veil-weather";
const WEATHER_AGE_MS = 3 * 3600 * 1000;
const PARTS = 8;
// The painting's size: about this many pixels, whatever the screen.
const PAINT_PIXELS = 52000;

export function createLoadingScreen({ document: doc = globalThis.document, storage = safeStorage() } = {}) {
  const root = doc?.querySelector?.("#loading-screen");
  const noop = { progress() {}, scene() {}, ready() {}, fail() {}, dispose() {} };
  if (!root) return noop;
  const view = doc.defaultView;
  const reduced = Boolean(view?.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
  const canvases = [...root.querySelectorAll("canvas")];
  const wisp = root.querySelector(".wisp");
  const params = new URLSearchParams(view?.location?.search ?? "");
  const scene = {
    celestial: skyAt(new Date()),
    // `?weather=` opens on that preset; otherwise the last live forecast
    // seen here, if it is recent, until main.js has the current one.
    weather: presetWeather(params.get("weather")) ?? recentWeather(storage),
    view: homeView(),
    seed: Number(params.get("seed")) || 1,
  };
  let key = "";
  let front = 0;
  let layer = 1;
  let progress = 0;
  let state = "loading";
  let anchor = [0.5, 0.6];
  let painted = null;
  let trackFrame = 0;
  let wanderTimer = 0;
  let pointerTimer = 0;
  const hideTimers = [0, 0];
  let lastPointer = 0;
  const timers = [];
  const events = new AbortController();

  // The wisp: a head and a tail of fainter lights that follow it, each
  // gliding to the same point a little more slowly (CSS transitions), so it
  // draws a comet's tail only while it moves.
  if (wisp) {
    for (let k = 0; k < PARTS; k++) {
      const part = doc.createElement("div");
      part.className = "wisp-part";
      part.style.setProperty("--k", String(k));
      part.innerHTML = '<div class="wisp-bob"><div class="wisp-size"><div class="wisp-light"></div></div></div>';
      wisp.append(part);
    }
  }
  const moveWisp = ([x, y], seconds) => {
    if (!wisp) return;
    wisp.style.setProperty("--move", `${reduced ? 0 : seconds}s`);
    wisp.style.setProperty("--x", `${(x * 100).toFixed(2)}vw`);
    wisp.style.setProperty("--y", `${(y * 100).toFixed(2)}vh`);
  };
  // Left alone, it wanders near the horizon.
  const wander = () => {
    clearTimeout(wanderTimer);
    if (reduced || state !== "loading") return;
    const x = clamp(anchor[0] + (Math.random() - 0.5) * 0.62, 0.12, 0.88);
    const y = clamp(anchor[1] + (Math.random() - 0.5) * 0.14, 0.08, 0.92);
    const seconds = 2.8 + Math.random() * 2.2;
    moveWisp([x, y], seconds);
    wanderTimer = setTimeout(wander, seconds * 1000 * (0.8 + Math.random() * 0.5));
  };
  // A pointer or a touch draws it over (not quite onto the finger).
  const follow = (event) => {
    if (reduced || state !== "loading") return;
    const now = performance.now();
    if (event.type === "pointermove" && now - lastPointer < 90) return;
    lastPointer = now;
    clearTimeout(wanderTimer);
    clearTimeout(pointerTimer);
    const x = event.clientX / Math.max(1, view.innerWidth);
    const y = event.clientY / Math.max(1, view.innerHeight);
    const touch = event.pointerType !== "mouse";
    moveWisp([x + (anchor[0] - x) * 0.08, y - (touch ? 0.06 : 0.025)], touch ? 1.3 : 0.9);
    pointerTimer = setTimeout(wander, touch ? 3500 : 2200);
  };
  root.addEventListener("pointermove", follow, { signal: events.signal, passive: true });
  root.addEventListener("pointerdown", follow, { signal: events.signal, passive: true });

  const draw = (fade) => {
    const index = 1 - front;
    const canvas = canvases[index];
    const context = canvas?.getContext?.("2d");
    if (!context) return;
    const width = Math.max(1, view.innerWidth);
    const height = Math.max(1, view.innerHeight);
    const scale = Math.sqrt(PAINT_PIXELS / (width * height));
    const w = Math.max(8, Math.round(width * scale));
    const h = Math.max(8, Math.round(height * scale));
    const pixels = paint(w, h, scene);
    // The new painting fades in over the old one (at once the first time),
    // which is put away once it is covered.
    clearTimeout(hideTimers[index]);
    canvas.style.transition = "none";
    delete canvas.dataset.shown;
    canvas.getBoundingClientRect();
    Object.assign(canvas, { width: w, height: h });
    context.putImageData(new ImageData(pixels, w, h), 0, 0);
    canvas.style.zIndex = String(++layer);
    if (fade) canvas.style.transition = "";
    canvas.dataset.shown = "";
    canvas.getBoundingClientRect();
    canvas.style.transition = "";
    const old = canvases[front];
    hideTimers[front] = setTimeout(() => delete old.dataset.shown, fade ? 1600 : 0);
    front = index;
    // The wisp keeps to just under the horizon.
    painted = { ...scene.view };
    anchor = [0.5, clamp((project(painted, ahead(painted), width / height)?.[1] ?? 0.4) + 0.1, 0.25, 0.75)];
  };
  const repaint = () => {
    if (state !== "loading") return;
    const { celestial, weather, view: v } = scene;
    const next = [
      ...celestial.sun.map((x) => x.toFixed(2)),
      celestial.moon[1].toFixed(2),
      ...["cover", "low", "mid", "rain"].map((w) => (weather?.[w] ?? 0).toFixed(2)),
      ...[v.x, v.y, v.z].map((x) => x.toFixed(0)),
      v.azimuth.toFixed(2),
      v.pitch.toFixed(2),
      view.innerWidth,
      view.innerHeight,
    ].join();
    if (next === key) return;
    const first = !key;
    draw(!first && !reduced);
    key = next;
    if (first) {
      moveWisp(anchor, 0);
      timers.push(setTimeout(wander, 600));
    }
  };
  let resizeTimer = 0;
  view.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(repaint, 200);
  }, { signal: events.signal });
  try {
    repaint();
  } catch (error) {
    // A painting is not worth a broken page: the CSS gradient stays.
    console.warn("loading veil:", error);
  }

  const setProgress = (value) => {
    progress = value;
    root.style.setProperty("--glow", progress.toFixed(3));
  };
  setProgress(0.04);
  const finish = (seconds) => {
    clearTimeout(wanderTimer);
    clearTimeout(pointerTimer);
    events.abort();
    timers.push(setTimeout(() => {
      root.hidden = true;
      root.dataset.state = "gone";
    }, seconds * 1000));
  };
  return {
    // A milestone (STAGES) reached.
    progress(stage) {
      if (state !== "loading") return;
      setProgress(progressAt(stage, progress));
      view.performance?.mark?.(`loading:${stage}`);
    },
    // What the world will show: { celestial, weather, view } (any of them).
    scene(next) {
      if (state !== "loading") return;
      if (next.celestial) scene.celestial = next.celestial;
      if (next.weather) {
        scene.weather = next.weather;
        if (next.weather.observedAt) remember(storage, next.weather);
      }
      if (next.view) scene.view = { ...next.view };
      try {
        repaint();
      } catch (error) {
        console.warn("loading veil:", error);
      }
    },
    // The first frame is up: dissolve into it. The wisp drifts to where the
    // real one will rise ({ view, cat }) and goes into the sand.
    ready({ view: camera = null, cat = null } = {}) {
      if (state !== "loading") return;
      state = "leaving";
      setProgress(1);
      root.dataset.state = "leaving";
      if (reduced) return finish(0.9);
      // The real camera still eases into place over the first frames: the
      // painting follows it as it fades, so the horizons stay together,
      // and the wisp's mark is re-aimed as it goes.
      const picture = root.querySelector(".veil-paint");
      const started = performance.now();
      let aimed = -1;
      const track = () => {
        const aspect = view.innerWidth / Math.max(1, view.innerHeight);
        const t = (performance.now() - started) / 1000;
        if (camera && painted && picture) {
          const was = project(painted, ahead(painted), aspect);
          const now = project(camera, ahead(painted), aspect);
          if (was && now) {
            const dx = now[0] - was[0];
            const dy = now[1] - was[1];
            picture.style.transformOrigin = `${(was[0] * 100).toFixed(1)}% ${(was[1] * 100).toFixed(1)}%`;
            picture.style.transform = `translate(${(dx * 100).toFixed(2)}vw, ${(dy * 100).toFixed(2)}vh) scale(${(1 + 2 * Math.max(Math.abs(dx), Math.abs(dy))).toFixed(3)})`;
          }
        }
        const rise = camera && cat && t < 1.4 && Math.floor(t / 0.35) > aimed ? project(camera, wispRise(cat), aspect) : null;
        if (rise && rise[0] > 0.02 && rise[0] < 0.98 && rise[1] > 0.02 && rise[1] < 0.98) {
          aimed = Math.floor(t / 0.35);
          moveWisp(rise, 1.7 - t);
        }
        if (t < 2.4) trackFrame = view.requestAnimationFrame(track);
      };
      track();
      timers.push(setTimeout(() => (root.dataset.state = "settling"), aimed >= 0 ? 1500 : 600));
      finish(3.4);
    },
    // No world after all: fade to the static fallback sky.
    fail() {
      if (state !== "loading") return;
      state = "failed";
      root.dataset.state = "failed";
      finish(reduced ? 0 : 0.9);
    },
    dispose() {
      state = "gone";
      events.abort();
      clearTimeout(wanderTimer);
      clearTimeout(pointerTimer);
      clearTimeout(resizeTimer);
      view.cancelAnimationFrame?.(trackFrame);
      timers.concat(hideTimers).forEach(clearTimeout);
      root.hidden = true;
    },
  };
}

function recentWeather(storage) {
  try {
    const saved = JSON.parse(storage?.getItem(WEATHER_KEY) ?? "null");
    return saved && Date.now() - saved.observedAt < WEATHER_AGE_MS ? saved : null;
  } catch {
    return null;
  }
}

function remember(storage, { low, mid, high, cover, rain, observedAt }) {
  try {
    storage?.setItem(WEATHER_KEY, JSON.stringify({ low, mid, high, cover, rain, observedAt }));
  } catch {
    // Private windows may refuse; the veil then guesses a clear sky.
  }
}

function safeStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function hash01(n) {
  const v = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return v - Math.floor(v);
}

function luminance(c) {
  return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
}

function mixColour(a, b, t) {
  return a.map((v, i) => v + (b[i] - v) * t);
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function normalize(v) {
  const n = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / n, v[1] / n, v[2] / n];
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function clamp01(v) {
  return clamp(v, 0, 1);
}

// The veil main.js and index.html share.
export const loading = createLoadingScreen();
