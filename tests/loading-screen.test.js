import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { register } from "node:module";
import {
  HALF, HOME_VIEW, SKY, STAGES, TABLE_W, TONE, cssSky, horizonAt, progressAt, project, skyColour, skyTable, tableColour,
  toneCurve, viewRay, wispRise,
} from "../src/loading-sky.js";
import { skyAt } from "../src/astronomy.js";
import { createWalker } from "../src/walker.js";
import { presetWeather } from "../src/weather-panel.js";

// The veil's controller imports tone.wgsl as text (Vite's `?raw`): the
// same here, so it loads in node.
register(
  "data:text/javascript," +
    encodeURIComponent(`
import { readFileSync } from "node:fs";
export async function resolve(specifier, context, next) {
  if (specifier.endsWith(".wgsl?raw")) return { url: new URL(specifier, context.parentURL).href, shortCircuit: true };
  return next(specifier, context);
}
export async function load(url, context, next) {
  if (url.includes(".wgsl?raw")) {
    const text = readFileSync(new URL(url.split("?")[0]), "utf8");
    return { format: "module", source: "export default " + JSON.stringify(text), shortCircuit: true };
  }
  return next(url, context);
}`),
);
const { createLoadingScreen } = await import("../src/loading-screen.js");

// Cape Town minutes on 15 Nov 2026 (UTC+2), as scripts/loading-capture.mjs.
const at = (minutes) => skyAt(new Date(Date.UTC(2026, 10, 15, 0, minutes) - 2 * 3600000));
const shader = (name) => readFileSync(new URL(`../src/shaders/${name}`, import.meta.url), "utf8");
const numbers = (text) => text.match(/-?[\d.]+/g).map(Number);

test("progress only moves forward, through the milestones, to 1", () => {
  let p = 0;
  let last = 0;
  for (const stage of ["start", "gpu", "island", "world", "shaders", "ready"]) {
    p = progressAt(stage, p);
    assert.ok(p > last, stage);
    last = p;
  }
  assert.equal(p, 1);
  assert.equal(progressAt("gpu", 0.5), 0.5, "a late milestone never moves it back");
  assert.equal(progressAt("unknown", 0.3), 0.3);
  assert.ok(Object.values(STAGES).every((v) => v > 0 && v <= 1));
});

test("the veil frames the camera the walker opens on", () => {
  const camera = createWalker({ trunks: [], domes: [] }).camera;
  for (const k of ["x", "y", "z"]) assert.ok(Math.abs(HOME_VIEW[k] - camera[k]) < 0.01, `${k}: ${HOME_VIEW[k]} vs ${camera[k]}`);
  assert.ok(Math.abs(HOME_VIEW.azimuth - camera.azimuth) < 1e-6);
  assert.ok(Math.abs(HOME_VIEW.pitch - camera.pitch) < 1e-6);
});

test("the horizon line sits where the renderer's level ray crosses the screen", () => {
  for (const pitch of [-0.4, -0.279, -0.25, 0, 0.2])
    for (const aspect of [375 / 812, 16 / 10, 21 / 9]) {
      const view = { azimuth: 0.7, pitch };
      const h = horizonAt(view);
      // view.wgsl view_ray: level exactly on the line, up above it, down below.
      for (const u of [0.05, 0.5, 0.95]) {
        assert.ok(Math.abs(viewRay(view, u, h, aspect)[1]) < 1e-9, `pitch ${pitch} u ${u}`);
        assert.ok(viewRay(view, u, h - 0.01, aspect)[1] > 0);
        assert.ok(viewRay(view, u, h + 0.01, aspect)[1] < 0);
      }
    }
  // The home view's horizon is in the upper third of the frame.
  assert.ok(horizonAt(HOME_VIEW) > 0.2 && horizonAt(HOME_VIEW) < 0.33);
});

test("projection: straight ahead is the centre, the wisp's rise is in view", () => {
  // azimuth -π/4 looks along coast +z.
  const view = { x: 0, y: 2, z: 0, azimuth: -Math.PI / 4, pitch: 0 };
  const [u, v] = project(view, [0, 2, 50], 16 / 9);
  assert.ok(Math.abs(u - 0.5) < 1e-9 && Math.abs(v - 0.5) < 1e-9);
  assert.ok(project(view, [3, 2, 50], 16 / 9)[0] > 0.5, "+x is to the right");
  assert.ok(project(view, [0, 4, 50], 16 / 9)[1] < 0.5, "up is up");
  assert.equal(project(view, [0, 2, -5], 1), null);
  const walker = createWalker({ trunks: [], domes: [] });
  const rise = project(walker.camera, wispRise(walker.cat), 16 / 10);
  assert.ok(rise && rise[0] > 0 && rise[0] < 1 && rise[1] > horizonAt(walker.camera) && rise[1] < 1, String(rise));
});

test("the tone curve and the sky's constants are the shaders'", () => {
  const tone = shader("tone.wgsl");
  const constant = (name) => tone.match(new RegExp(`const ${name}: \\w+ = ([^;]+);`))[1];
  assert.equal(Number(constant("TONE_GAIN")), TONE.gain);
  assert.equal(Number(constant("VIBRANCE")), TONE.vibrance);
  assert.equal(Number(constant("OVERCAST_VIBRANCE")), TONE.overcastVibrance);
  assert.deepEqual(numbers(constant("OVERCAST_BALANCE").replace(/^\w+\(/, "")), TONE.overcastBalance);
  assert.deepEqual(toneCurve([0, 0, 0], 0), [0, 0, 0]);
  assert.ok(toneCurve([20, 20, 20], 0).every((v) => v > 0.9 && v <= 1));
  const view = shader("skyview.wgsl");
  assert.deepEqual(numbers(view.match(/MOON_TINT: vec3f = vec3f\(([^)]+)\)/)[1]), SKY.moonTint);
  assert.deepEqual(numbers(view.match(/vec3f\(gray\) \* vec3f\(([^)]+)\)/)[1]), SKY.overcastGrey);
  const sky = shader("sky.wgsl");
  assert.deepEqual(numbers(sky.match(/color \+= vec3f\(([^)]+)\) \* night \* \(1\.0 \+/)[1]), SKY.airglow);
  assert.deepEqual(numbers(sky.match(/color \+= vec3f\(([^)]+)\) \* exp\(-moon_distance \* 14\.0\)/)[1]), SKY.aureole);
  // The painter tones on the GPU with the same block, translated (tone-glsl.js).
  const screen = readFileSync(new URL("../src/loading-screen.js", import.meta.url), "utf8");
  assert.match(screen, /wgslToGlsl\(toneBlock\(toneSource\)\)/);
});

test("the sky follows the hour and the weather", () => {
  const up = [0, 1, 0];
  const noon = skyColour(at(750), null, up);
  const night = skyColour(at(1320), null, up);
  assert.ok(noon[2] > noon[0] + 40, `noon zenith is blue: ${noon}`);
  assert.ok(night.reduce((a, b) => a + b) < noon.reduce((a, b) => a + b) / 3, `night is dark: ${night}`);
  const grey = skyColour(at(750), presetWeather("overcast"), [0.6, 0.2, 0.6]);
  const clear = skyColour(at(750), presetWeather("clear"), [0.6, 0.2, 0.6]);
  assert.ok(Math.abs(grey[2] - grey[0]) < Math.abs(clear[2] - clear[0]), `${grey} vs ${clear}`);
  // Sea below the horizon is darker than the sky above it.
  const sum = (c) => c[0] + c[1] + c[2];
  assert.ok(sum(skyColour(at(750), null, [0.7, -0.08, 0.7])) < sum(skyColour(at(750), null, [0.7, 0.02, 0.7])));
});

// The rendered pixels the veil was fitted against (docs/review/loading/,
// scripts/loading-capture.mjs agree): the WebGPU sky and sea canvases for
// the same camera, ten scenes. The model must stay close to them.
const AGREEMENT = new URL("../docs/review/loading/after-colour-agreement.json", import.meta.url);
test("the veil's colours agree with the rendered sky", { skip: !existsSync(AGREEMENT) }, () => {
  const rows = JSON.parse(readFileSync(AGREEMENT, "utf8"));
  const MIN = { dawn: 350, noon: 750, golden: 1145, dusk: 1188, night: 1320 };
  const lab = (rgb) => {
    const l = rgb.map((v) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    const x = f((0.4124 * l[0] + 0.3576 * l[1] + 0.1805 * l[2]) / 0.95047);
    const y = f(0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2]);
    const z = f((0.0193 * l[0] + 0.1192 * l[1] + 0.9505 * l[2]) / 1.08883);
    return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
  };
  const deltaE = (a, b) => Math.hypot(...lab(a).map((v, i) => v - lab(b)[i]));
  const errors = { clearSky: [], firstView: [] };
  for (const r of rows) {
    const [time, weather] = r.scene.split("-");
    const e = deltaE(skyColour(at(MIN[time]), presetWeather(weather), r.ray), r.world);
    if (weather === "clear" && r.ray[1] > 0) errors.clearSky.push(e);
    // What the first frame shows: the home view, horizon to 15°, sea at −1°.
    if (r.view === "home") errors.firstView.push(e);
  }
  const median = (v) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)];
  assert.ok(Math.max(...errors.clearSky) < 4, `clear sky ΔE max ${Math.max(...errors.clearSky).toFixed(1)}`);
  assert.ok(median(errors.firstView) < 3, `first view ΔE median ${median(errors.firstView).toFixed(1)}`);
  assert.ok(errors.firstView.filter((e) => e > 8).length <= errors.firstView.length * 0.1, "first view: few samples off by more than ΔE 8");
});

test("the table: whole, finite, half floats that read back", () => {
  const table = skyTable(at(1188), presetWeather("overcast"));
  assert.equal(table.hdr.length, TABLE_W * HALF * 2 * 4);
  assert.ok(table.hdr.every(Number.isFinite));
  const fromHalf = (h) => {
    const e = (h >> 10) & 31;
    const m = h & 1023;
    return (h >> 15 ? -1 : 1) * (e ? (1 + m / 1024) * 2 ** (e - 15) : m * 2 ** -24);
  };
  for (let i = 0; i < table.hdr.length; i += 97)
    assert.ok(Math.abs(fromHalf(table.half[i]) - table.hdr[i]) <= Math.abs(table.hdr[i]) * 1e-3 + 1e-7, `${i}`);
  // Row 0 is the sky at the horizon, row HALF the sea there.
  assert.equal(tableColour(table, 0, 0).length, 3);
  assert.match(cssSky(table, HOME_VIEW), /^linear-gradient\(rgb/);
});

// A DOM just big enough for the controller (no WebGL: the CSS sky).
function fakePage({ reduced = false } = {}) {
  const frames = [];
  const attrs = () => new Proxy({}, {});
  const element = (extra = {}) => ({ dataset: attrs(), style: { setProperty() {}, backgroundImage: "" }, hidden: false, ...extra });
  const canvas = element({ getContext: () => null });
  const wisp = element();
  const root = element({ querySelector: (s) => (s === "canvas" ? canvas : s === ".wisp" ? wisp : null) });
  const marks = [];
  const view = {
    innerWidth: 1440, innerHeight: 900, devicePixelRatio: 2,
    location: { search: "?weather=clear" },
    matchMedia: () => ({ matches: reduced }),
    addEventListener() {},
    requestAnimationFrame: (f) => frames.push(f),
    cancelAnimationFrame() {},
    performance: { mark: (name) => marks.push(name) },
  };
  const body = element({ offsetWidth: 0 });
  const document = { defaultView: view, body, querySelector: (s) => (s === "#loading-screen" ? root : null) };
  return { document, root, body, wisp, frames, marks, flush: () => frames.splice(0).forEach((f) => f(0)) };
}

test("the hand-over: out of focus under the veil first, no blank frame, everything stopped after", async () => {
  const page = fakePage();
  const veil = createLoadingScreen({ document: page.document, storage: null });
  assert.ok(page.marks.includes("loading:painted"), "the sky paints at once");
  assert.match(page.root.style.backgroundImage, /linear-gradient/);
  veil.progress("world");
  const walker = createWalker({ trunks: [], domes: [] });
  veil.ready({ view: walker.camera, cat: walker.cat });
  // Until the world's first frame is drawn (a fence on the land canvas;
  // none here) and two more frames, the veil holds.
  assert.equal(page.body.dataset.focus, undefined);
  assert.equal(page.root.dataset.state, undefined);
  veil.scene({ celestial: at(1320) });
  page.flush();
  assert.equal(page.root.dataset.state, undefined);
  page.flush();
  assert.ok(page.marks.includes("loading:shown"));
  // The world goes soft before the veil starts to fade, in the same task.
  assert.equal(page.body.dataset.focus, "soft");
  assert.equal(page.root.dataset.state, "leaving");
  assert.equal(page.root.hidden, false, "the veil stays until the pull is done");
  page.flush();
  assert.equal(page.body.dataset.focus, "pull");
  // Once begun, nothing repaints the veil.
  const before = page.root.style.backgroundImage;
  veil.scene({ celestial: at(1320) });
  assert.equal(page.root.style.backgroundImage, before);
  await new Promise((r) => setTimeout(r, 1700));
  assert.equal(page.root.hidden, true);
  assert.equal(page.body.dataset.focus, undefined, "the blur is gone, not left at zero");
  assert.equal(page.frames.length, 0, "no frames left running");
  // The CSS keeps the order: the veil's sky fades before the pull ends,
  // and the pull ends before the veil is put away (1.6 s).
  const css = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const fade = Number(css.match(/\.loading-screen::after \{ transition: opacity ([\d.]+)s/)[1]);
  const [pull, delay] = css.match(/transition: filter ([\d.]+)s cubic-bezier\([^)]+\) ([\d.]+)s,/).slice(1).map(Number);
  assert.ok(fade < pull + delay && pull + delay < 1.6, `${fade} ${pull} ${delay}`);
  assert.match(css, /body\[data-focus="soft"\] #landscape \{ filter: blur\(\d+px\)/);
  // Behind the blurred canvases, the veil's sky, not the fallback picture.
  assert.match(css, /body\[data-focus\] \.fallback \{ visibility: hidden; \}/);
});

test("reduced motion: a plain cross-fade, no focus pull", async () => {
  const page = fakePage({ reduced: true });
  const veil = createLoadingScreen({ document: page.document, storage: null });
  veil.ready();
  page.flush();
  page.flush();
  assert.equal(page.body.dataset.focus, undefined);
  assert.equal(page.root.dataset.state, "leaving");
  veil.dispose();
});

test("without its markup the veil is a quiet no-op", () => {
  const absent = createLoadingScreen({ document: { querySelector: () => null } });
  absent.progress("gpu");
  absent.scene({});
  absent.ready();
  absent.fail();
  absent.dispose();
});
