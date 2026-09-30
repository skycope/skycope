import {
  clock,
  effect,
  frame,
  init,
  pingPong,
  sampler,
  storage,
  surface,
  target,
} from "vgpu";
import skyTableShader from "./shaders/sky-table.wgsl";
import cloudShader from "./shaders/clouds.wgsl";
import skyShader from "./shaders/sky.wgsl";
import waterShader from "./shaders/water.wgsl";
import wavesShader from "./shaders/waves.wgsl";
import foamShader from "./shaders/foam.wgsl";
import { createWaveModes } from "./wave-modes.js";
import { swellUniform } from "./swell.js";
import { createShoreTextures, createLandTexture } from "./shore-textures.js";
import { createCloudNoise } from "./cloud-noise.js";
import { createStarAtlas, createStarCatalog } from "./stars.js";
import { sceneSeed } from "./random.js";
import {
  capeTime,
  capeMinutes,
  dateAtCapeMinutes,
  skyAt,
} from "./astronomy.js";
import {
  fetchWeather,
  WEATHER_REFRESH_MS,
  WEATHER_MAX_AGE_MS,
} from "./weather.js";
import { groundHeight, shoreDistance, ISLAND } from "./terrain.js";
import { lightingAt } from "./sunlight.js";
import { archipelagoUniform, archipelagoSunVisibility, ISLAND_SLOTS } from "./archipelago.js";
import { createWeatherPanel } from "./weather-panel.js";
import { createWalker, surfaceKind, SWIM_LIMIT } from "./walker.js";
import { createSea } from "./sea-surface.js";
import { createWake } from "./wake.js";
import { createSound } from "./sound.js";
import { CAT_SCALE } from "./cat-rig.js";
import { reviewFixture, applyReviewFixture } from "./review-fixtures.js";
import { createLoadingScreen } from "./loading-screen.js";

const review = reviewFixture(window.location.search);
const PERF = new URLSearchParams(window.location.search).has("perf");
const loading = createLoadingScreen();

// You are a cat: WASD/arrows walk (relative to the camera), shift runs,
// space jumps, M meows. Click or tap the ground to walk there; drag orbits
// the follow camera; scroll or pinch zooms.
const WALK_KEYS = new Set([
  "w", "a", "s", "d", " ", "shift", "m",
  "arrowup", "arrowdown", "arrowleft", "arrowright",
]);

// Phones and small or low-core machines get a lighter budget throughout.
const LIGHT =
  window.matchMedia("(pointer: coarse)").matches ||
  (navigator.hardwareConcurrency ?? 8) <= 4 ||
  Math.min(window.screen.width, window.screen.height) < 700;
// Pixel budgets. The old free-flight camera needed 3.5 MP of sea and 1 MP of
// sky; the follow camera frames a small cat, and the sky and sea upscale
// smoothly, so these are 2–4× fewer pixels.
const WATER_PIXELS = LIGHT ? 650000 : 1500000;
const SKY_PIXELS = LIGHT ? 220000 : 450000;
const MAX_DPR = LIGHT ? 1.25 : 1.5;
// Frame pacing: 60 fps at most (a 120 Hz display otherwise renders twice
// as often for no visible gain), 30 once the cat has settled and nothing is
// being pressed. The small tolerance keeps vsync jitter from skipping frames.
const ACTIVE_FPS = 60;
// The reveal's resolution steps (fraction of full) and how long each holds.
const REVEAL = [1 / 32, 1 / 16, 1 / 8, 1 / 4, 1 / 2, 1];
const REVEAL_STEP_MS = 260;
const IDLE_FPS = 30;


const canvas = document.querySelector("#sky");
const slider = document.querySelector("#time");
const timeToggle = document.querySelector("#time-toggle");
const timePanel = document.querySelector("#time-panel");
const soundButton = document.querySelector("#sound");
const hint = document.querySelector("#hint");
const liveButton = document.querySelector("#live");
const timeLabel = document.querySelector("#time-label");
const weatherLabel = document.querySelector("#conditions");
const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
const events = new AbortController();
const state = {
  seed: sceneSeed(window.location.search),
  date: new Date(),
  debugMinutes: review?.minutes ?? null,
  celestial: null,
  pointer: [0.5, 0.5],
  // The camera the WebGPU passes and Three.js share (walker.camera).
  flight: null,
  walker: null,
  sound: createSound(),
  keys: new Set(),
  jump: false,
  dragging: false,
  pointers: new Map(),
  pinch: 0,
  lastInput: 0,
  lastFrame: 0,
  weatherFrame: 0,
  firstFrame: false,
  // The world sharpens in from coarse pixels: a fraction of full
  // resolution that steps up to 1 after the first frame (see REVEAL).
  reveal: matchMedia("(prefers-reduced-motion: reduce)").matches ? 1 : REVEAL[0],
  revealTimer: 0,
  loadingRaf: 0,
  lastChirp: -10,
  // How wet the cat's paws are (from wet sand); they print on rock.
  pawWet: 0,
  // The sea under the cat (CPU twin of the water pass) and its wake.
  sea: null,
  wake: createWake(),
  wakeTexture: null,
  hintShown: true,
  // The renderer reads `weather`: the live forecast, or the panel's override.
  weather: null,
  liveWeather: null,
  weatherOverride: null,
  weatherPanel: null,
  weatherRequest: null,
  weatherTimer: null,
  clockTimer: null,
  landscape: null,
  gpu: null,
  output: null,
  skyTarget: null,
  // Sky passes (see sky.wgsl): the scattering table, the quarter-resolution
  // cloud march, and the resolve's history ping-pong. skyFrames counts frames
  // since the history was last invalidated.
  skyTable: null,
  cloudTarget: null,
  skyFrames: 0,
  previousView: null,
  // The sea: wind-sea cascades, recomputed every frame, and the whitecap
  // history. foamFrames counts frames since it was last invalidated; calm
  // counts seconds without whitecap-strength wind (the history pass sleeps).
  foamFrames: 0,
  // Seconds of sea time since the whitecap history last stepped.
  foamStep: 0,
  calm: 0,
  atmosphere: null,
  water: null,
  loop: null,
  raf: 0,
  renderFrame: null,
  time: 24,
  frameMs: 16.7,
  quality: 1,
  sampleCount: 0,
  lastQualityChange: 0,
  disposed: false,
};

// `?perf` QA exposes live state, e.g. to aim the camera at the sun.
if (PERF) window.skycope = state;

start();

async function start() {
  connectControls();
  // `?weather=clear|cloudy|overcast|rain|storm` opens on that preset.
  state.weatherPanel = createWeatherPanel({
    toggle: document.querySelector("#weather-toggle"),
    panel: document.querySelector("#weather-panel"),
    initial: new URLSearchParams(window.location.search).get("weather"),
    signal: events.signal,
    onChange(override) {
      state.weatherOverride = override;
      applyWeather();
    },
  });
  state.weatherOverride = state.weatherPanel.initial;
  applyWeather();
  updateTime();
  refreshWeather();
  state.clockTimer = setInterval(updateTime, 1000);
  state.weatherTimer = setInterval(refreshWeather, WEATHER_REFRESH_MS);
  try {
    await startAtmosphere();
  } catch (error) {
    useFallback(error);
  }
}

function connectControls() {
  const options = { signal: events.signal };
  slider.addEventListener(
    "input",
    () => {
      state.debugMinutes = Number(slider.value);
      resetSkyHistory();
      updateTime();
    },
    options,
  );
  liveButton.addEventListener(
    "click",
    () => {
      state.debugMinutes = null;
      resetSkyHistory();
      updateTime();
    },
    options,
  );
  // Panels: the time slider lives tucked away under the clock, top right.
  timeToggle.addEventListener("click", () => showTime(timePanel.hidden), options);
  window.addEventListener(
    "pointerdown",
    (event) => {
      if (!timePanel.hidden && !timePanel.contains(event.target) && !timeToggle.contains(event.target))
        showTime(false);
    },
    options,
  );
  soundButton.addEventListener(
    "click",
    () => {
      state.sound.start();
      state.sound.setEnabled(!state.sound.enabled);
      soundButton.setAttribute("aria-pressed", String(state.sound.enabled));
    },
    options,
  );
  const scene = (event) => !event.target.closest("button, input, a, .weather-panel, .time-panel");
  window.addEventListener(
    "pointerdown",
    (event) => {
      state.sound.start();
      if (motionPreference.matches || !scene(event)) return;
      state.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, at: performance.now() });
      state.dragging = true;
      state.lastInput = performance.now();
      if (state.pointers.size === 2) state.pinch = pinchDistance();
    },
    options,
  );
  window.addEventListener(
    "pointermove",
    (event) => {
      const p = state.pointers.get(event.pointerId);
      if (!p || !state.walker) return;
      const dx = event.clientX - p.x;
      const dy = event.clientY - p.y;
      p.x = event.clientX;
      p.y = event.clientY;
      state.lastInput = performance.now();
      if (state.pointers.size === 2) {
        const d = pinchDistance();
        if (state.pinch > 0 && d > 0) state.walker.zoom(state.pinch / d);
        state.pinch = d;
        return;
      }
      // Drag the world: orbit the cat.
      if (Math.hypot(event.clientX - p.startX, event.clientY - p.startY) > 6)
        state.walker.orbit(-dx * 0.006, dy * 0.004);
    },
    { ...options, passive: true },
  );
  for (const end of ["pointerup", "pointercancel"])
    window.addEventListener(
      end,
      (event) => {
        const p = state.pointers.get(event.pointerId);
        state.pointers.delete(event.pointerId);
        state.dragging = state.pointers.size > 0;
        state.pinch = 0;
        // A tap, not a drag: walk there (or pet the cat).
        if (p && end === "pointerup" && Math.hypot(event.clientX - p.startX, event.clientY - p.startY) < 8 && performance.now() - p.at < 500)
          tap(event.clientX, event.clientY);
      },
      options,
    );
  window.addEventListener(
    "wheel",
    (event) => {
      if (!state.walker || !scene(event)) return;
      state.walker.zoom(Math.exp(event.deltaY * 0.0012));
      state.lastInput = performance.now();
      event.preventDefault();
    },
    { ...options, passive: false },
  );
  window.addEventListener(
    "keydown",
    (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key.toLowerCase();
      state.sound.start();
      // Sliders keep their arrow keys; a focused button gives up space.
      if (event.target.closest?.("input, select, textarea")) return;
      if (key === " " && event.target.closest?.("button")) event.target.blur();
      if (key === "h") {
        state.walker?.home();
        resetSkyHistory();
        renderStill();
        return;
      }
      if (!WALK_KEYS.has(key) || motionPreference.matches) return;
      if (key === " " && !event.repeat) state.jump = true;
      if (key === "m" && !event.repeat) meow();
      state.keys.add(key);
      state.lastInput = performance.now();
      event.preventDefault();
    },
    options,
  );
  window.addEventListener(
    "keyup",
    (event) => state.keys.delete(event.key.toLowerCase()),
    options,
  );
  window.addEventListener("blur", () => state.keys.clear(), options);
  window.addEventListener("resize", resizeAtmosphere, options);
  document.addEventListener(
    "visibilitychange",
    () => {
      state.weatherFrame = performance.now();
      updateTime();
      syncLoop();
      if (
        !document.hidden &&
        (!state.liveWeather ||
          Date.now() - state.liveWeather.observedAt > WEATHER_REFRESH_MS)
      )
        refreshWeather();
    },
    options,
  );
  motionPreference.addEventListener(
    "change",
    () => syncLoop(),
    options,
  );
}

function showTime(open) {
  timePanel.hidden = !open;
  timeToggle.setAttribute("aria-expanded", String(open));
}

function pinchDistance() {
  const [a, b] = [...state.pointers.values()];
  return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
}

function meow() {
  state.walker?.meow();
  state.sound.meow();
}

// Tap the cat to hear it; tap the ground to walk there. The ray is marched
// against the walkable surface (ground mesh and boulder tops).
function tap(clientX, clientY) {
  if (!state.landscape || !state.walker) return;
  const { origin, direction } = state.landscape.pick(
    (clientX / window.innerWidth) * 2 - 1,
    1 - (clientY / window.innerHeight) * 2,
  );
  const cat = state.walker.cat;
  // Distance from the cat's middle to the ray.
  const cx = cat.x - origin[0];
  const cy = cat.y + 0.15 * CAT_SCALE - origin[1];
  const cz = cat.z - origin[2];
  const along = cx * direction[0] + cy * direction[1] + cz * direction[2];
  const miss = Math.hypot(cx - direction[0] * along, cy - direction[1] * along, cz - direction[2] * along);
  if (along > 0 && miss < 0.25 + along * 0.02) {
    meow();
    return;
  }
  let previous = 0;
  for (let t = 0.3; t < 90; t += Math.max(0.05, t * 0.02)) {
    const x = origin[0] + direction[0] * t;
    const y = origin[1] + direction[1] * t;
    const z = origin[2] + direction[2] * t;
    // The sea surface: swim there (not past the kelp).
    if (y < 0 && shoreDistance(x, z) < 0) {
      state.walker.walkTo(...(shoreDistance(x, z) > -SWIM_LIMIT + 1 ? [x, z] : pullInland(x, z, SWIM_LIMIT - 1)));
      dismissHint();
      return;
    }
    if (y < state.walker.surface(x, z)) {
      // Bisect for the crossing.
      let lo = previous;
      let hi = t;
      for (let i = 0; i < 8; i++) {
        const mid = (lo + hi) / 2;
        const my = origin[1] + direction[1] * mid;
        if (my < state.walker.surface(origin[0] + direction[0] * mid, origin[2] + direction[2] * mid)) hi = mid;
        else lo = mid;
      }
      const hx = origin[0] + direction[0] * hi;
      const hz = origin[2] + direction[2] * hi;
      if (shoreDistance(hx, hz) > 0.3) state.walker.walkTo(hx, hz);
      else state.walker.walkTo(...pullInland(hx, hz));
      dismissHint();
      return;
    }
    if (y < -1) break;
    previous = t;
  }
}

// A tap beyond reach brings the target back toward the island, to `offshore`
// metres out.
function pullInland(x, z, offshore = -0.6) {
  const dx = ISLAND.x - x;
  const dz = ISLAND.z - z;
  const r = Math.hypot(dx, dz) || 1;
  const pull = -offshore - shoreDistance(x, z);
  return [x + (dx / r) * pull, z + (dz / r) * pull];
}

function dismissHint() {
  if (!state.hintShown) return;
  state.hintShown = false;
  hint.dataset.hidden = "true";
}

function updateTime() {
  const live = state.debugMinutes === null;
  state.date = live ? new Date() : dateAtCapeMinutes(state.debugMinutes, review?.date ?? new Date());
  state.celestial = skyAt(state.date);
  timeLabel.textContent = capeTime(state.date);
  timeToggle.querySelector("span").textContent = `${capeTime(state.date)}${live ? "" : " · preview"}`;
  slider.value = String(live ? capeMinutes(state.date) : state.debugMinutes);
  slider.setAttribute(
    "aria-valuetext",
    `${capeTime(state.date)} Cape Town time${live ? ", live" : ", preview"}`,
  );
  liveButton.setAttribute("aria-pressed", String(live));
  liveButton.textContent = live ? "live" : "back to live";
  document.body.dataset.preview = String(!live);
  document.body.dataset.scene = String(Math.round(state.celestial.scene));
  document.querySelector('meta[name="theme-color"]').content = [
    "#8fc4e3",
    "#a9819c",
    "#132039",
  ][Math.round(state.celestial.scene)];
  canvas.dataset.sunAltitude = state.celestial.sunAltitude.toFixed(2);
  canvas.dataset.sunAzimuth = state.celestial.sunAzimuth.toFixed(2);
  canvas.dataset.time = state.date.toISOString();
  canvas.dataset.frameMs = state.frameMs.toFixed(1);
  canvas.dataset.seed = String(state.seed);
  renderStill();
}

async function refreshWeather() {
  if (document.hidden || state.weatherRequest || state.disposed) return;
  const request = new AbortController();
  state.weatherRequest = request;
  const timeout = setTimeout(() => request.abort(), 12000);
  try {
    state.liveWeather = await fetchWeather(request.signal);
    state.liveStatus = "live";
  } catch (error) {
    if (state.disposed) return;
    const fresh =
      state.liveWeather &&
      Date.now() - state.liveWeather.observedAt < WEATHER_MAX_AGE_MS;
    if (!fresh) state.liveWeather = null;
    state.liveStatus = fresh ? "delayed" : "unavailable";
    console.warn("Cape Town weather:", error.message);
  } finally {
    clearTimeout(timeout);
    state.weatherRequest = null;
    state.weatherPanel?.setLive(state.liveWeather);
    applyWeather();
  }
}

// One place decides what the renderer sees and what the label says.
function applyWeather() {
  resetSkyHistory();
  const override = state.weatherOverride;
  const live = state.liveWeather;
  state.weather = override ?? live;
  // Rainy, heavy skies are dark enough to need light text.
  document.body.dataset.gloom = String(
    (state.weather?.rain ?? 0) > 1.5 || (state.weather?.cover ?? 0) > 0.97,
  );
  if (override) {
    const temperature = override.temperature ?? live?.temperature;
    weatherLabel.textContent = `${temperature != null ? `${temperature}° · ` : ""}${override.description} · set`;
    weatherLabel.title = "Chosen weather, not the live forecast. Open to return to live.";
    document.body.dataset.weather = "set";
  } else if (live) {
    const delayed = state.liveStatus === "delayed";
    weatherLabel.textContent = `${live.temperature}° · ${delayed ? "weather delayed" : live.description}`;
    weatherLabel.title = `Cape Town weather model, updated ${capeTime(new Date(live.observedAt))} SAST · Open-Meteo`;
    document.body.dataset.weather = state.liveStatus ?? "live";
  } else {
    weatherLabel.textContent = state.liveStatus === "unavailable" ? "weather unavailable" : "weather…";
    document.body.dataset.weather = state.liveStatus ?? "loading";
  }
  renderStill();
}

async function startAtmosphere() {
  loading.stage("graphics");
  // Low power: the sky and sea are cheap now, and a discrete GPU would spin
  // up fans for no visible gain.
  const gpu = await init({ powerPreference: "low-power" });
  if (state.disposed) {
    gpu.dispose();
    return;
  }
  state.gpu = gpu;
  const output = surface(gpu, canvas, {
    size: waterSize(),
    autoResize: false,
    dpr: 1,
    alphaMode: "opaque",
  });
  state.output = output;
  // The resolved sky alternates between two MRT targets: colour 0 is the sky
  // the water reads, colour 1 the cloud layer the next frame reprojects.
  const [skyWidth, skyHeight] = cloudSize();
  const skyTarget = pingPong(gpu, skyWidth, skyHeight, {
    colors: [{ format: "rgba16float" }, { format: "rgba16float" }],
  });
  state.skyTarget = skyTarget;
  const skyTable = target(gpu, { size: [256, 128], format: "rgba16float" });
  state.skyTable = skyTable;
  const cloudTarget = target(gpu, { size: quarterSize(cloudSize()), format: "rgba16float" });
  state.cloudTarget = cloudTarget;
  const noise = createCloudNoise(gpu.gpu, state.seed);
  // The wind sea: 128 modes from the CPU, summed into four 128² cascades,
  // and a 512² whitecap history over the largest tile (see waves.wgsl).
  const cascade = { format: "rgba16float" };
  const waveModes = createWaveModes(state.seed);
  const modes = storage(gpu, waveModes.data.byteLength, "read");
  const wavesTarget = target(gpu, { size: [128, 128], colors: [cascade, cascade, cascade, cascade] });
  const foamTarget = pingPong(gpu, 512, 512, { format: "rgba16float" });
  const stars = createStarAtlas(gpu.gpu);
  const starCatalog = createStarCatalog(gpu.gpu);
  const skySampler = sampler(gpu, {
    minFilter: "linear",
    magFilter: "linear",
    addressModeU: "repeat",
    addressModeV: "repeat",
    addressModeW: "repeat",
  });
  const tablePass = effect(gpu, skyTableShader, {
    label: "skycope-sky-table",
    set: { atmosphere: createUniforms() },
  });
  const cloudPass = effect(gpu, cloudShader, {
    label: "skycope-clouds",
    set: {
      atmosphere: createUniforms(),
      cloudNoise: noise.createView(),
      cloudSampler: skySampler,
      skyTable: skyTable.color,
    },
  });
  const atmosphere = effect(gpu, skyShader, {
    label: "skycope-cape-town",
    set: {
      atmosphere: createUniforms(),
      cloudNoise: noise.createView(),
      starAtlas: stars.createView(),
      cloudSampler: skySampler,
      skyTable: skyTable.color,
      cloudLayer: cloudTarget.color,
      cloudHistory: skyTarget.read.colors[1],
    },
  });
  state.atmosphere = atmosphere;
  const seaSampler = sampler(gpu, {
    minFilter: "linear",
    magFilter: "linear",
    addressModeU: "repeat",
    addressModeV: "repeat",
    addressModeW: "repeat",
  });
  const wavesPass = effect(gpu, wavesShader, { label: "skycope-waves", set: { modes } });
  const foamPass = effect(gpu, foamShader, {
    label: "skycope-foam",
    set: {
      atmosphere: createUniforms(),
      waves0: wavesTarget.colors[0],
      waves1: wavesTarget.colors[1],
      waves2: wavesTarget.colors[2],
      foamHistory: foamTarget.read.color,
      filtering: seaSampler,
    },
  });
  const water = effect(gpu, waterShader, {
    label: "skycope-water",
    set: {
      atmosphere: createUniforms(),
      cloudNoise: noise.createView(),
      skyTexture: skyTarget.write.color,
      starCatalog: starCatalog.createView(),
      waves0: wavesTarget.colors[0],
      waves1: wavesTarget.colors[1],
      waves2: wavesTarget.colors[2],
      waves3: wavesTarget.colors[3],
      foamLayer: foamTarget.write.color,
      skyTable: skyTable.color,
      // Repeat: the ocean tiles the noise volume and wave cascades across the
      // whole sea. Sky lookups clamp their own coordinates.
      filtering: seaSampler,
    },
  });
  state.water = water;
  loading.stage("world");
  // Let the new stage paint before synchronous seeded geometry preparation.
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const { createLandscape } = await import("./landscape.js");
  if (state.disposed) return;
  state.landscape = createLandscape(
    document.querySelector("#landscape"),
    state.seed,
    { light: LIGHT },
  );
  // The boulders the sea laps against, from the same seeded layout.
  const shore = createShoreTextures(gpu.gpu, state.landscape.shoreRocks);
  const land = createLandTexture(gpu.gpu, state.landscape.landField);
  // The cat's wake: one row of texels, written only while it is in the water.
  state.wakeTexture = gpu.gpu.createTexture({
    label: "skycope-cat-wake",
    size: [64, 1],
    format: "rgba32float",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  // The distant islands' skylines for the sea (archipelago.wgsl).
  const islandTable = gpu.gpu.createTexture({
    label: "skycope-islands",
    size: [ISLAND_SLOTS, 1],
    format: "rgba32float",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  updateIslandTable(islandTable, state.flight ?? FIRST_VIEW, state.celestial);
  water.set({ shoreRocks: shore.rocks.createView(), shoreGrid: shore.grid.createView(), landField: land.createView(), catWake: state.wakeTexture.createView(), islandTable: islandTable.createView() });
  state.sea = createSea(state.seed, waveModes.data);
  state.walker = createWalker(state.landscape.obstacles, state.sea, state.wake);
  applyReviewFixture(state.walker, review, state.landscape.obstacles);
  state.flight = state.walker.camera;
  state.landscape.resize(window.innerWidth, window.innerHeight, state.quality, state.reveal < 1 ? revealSize() : null);
  loading.stage("sky");
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  await tablePass.compile(skyTable);
  await cloudPass.compile(cloudTarget);
  await atmosphere.compile(skyTarget.write);
  await wavesPass.compile(wavesTarget);
  await foamPass.compile(foamTarget.write);
  await water.compile({ colors: [output.format] });
  if (state.disposed) return;
  gpu.onError(useFallback);
  gpu.gpu.lost.then((info) => {
    if (!state.disposed && state.gpu === gpu) useFallback(info.message);
  });
  const gpuClock = clock(gpu);
  state.renderFrame = (currentFrame) => {
    const cpuStarted = performance.now();
    const dt = Math.min(gpuClock.deltaTime, 0.05);
    const weatherDt = state.weatherFrame ? Math.max(0, Math.min(2, (cpuStarted - state.weatherFrame) / 1000)) : dt;
    state.weatherFrame = cpuStarted;
    if (!motionPreference.matches) {
      state.time += dt;
      const weather = state.weather;
      state.sea.set(state.time, swellUniform(state.seed, weather?.wind ?? [0, 0]), weather?.wind ?? [0, 0]);
      state.wake.tick(state.time);
      updateCat(dt);
      adaptQuality(gpuClock.deltaTime);
    }
    const uniforms = createUniforms();
    const wind = uniforms.wind;
    modes.write(waveModes.update(state.time, wind));
    // Whitecaps need wind; once the last foam has long decayed in a calm,
    // the history pass sleeps and the water skips its lookups.
    state.calm = Math.hypot(wind[0], wind[1]) > 3.5 ? 0 : state.calm + dt;
    const whitecaps = state.calm < 20;
    // Whitecap foam lives for seconds: stepping its history every other
    // frame, over both frames' time, looks the same and halves its cost.
    state.foamStep += motionPreference.matches ? 0 : dt;
    const stepFoam = whitecaps && (state.foamFrames === 0 || state.skyFrames % 2 === 0);
    const seaUniforms = {
      ...uniforms,
      // z: trace the island's reflection in the sea (not on the phone budget).
      ocean: [stepFoam ? state.foamStep : 0, state.foamFrames > 0 ? 1 : 0, LIGHT ? 0 : 1, state.landscape?.cloudTransmission ?? 1],
    };
    // Temporal clouds: each frame marches one pixel of every 2x2 block, in
    // turn; the resolve reprojects the rest from last frame's cloud layer.
    const jitter = JITTER[state.skyFrames % 4];
    const view = state.previousView ?? state.flight;
    const skyUniforms = {
      ...uniforms,
      resolution: skyTarget.write.size,
      temporal: [jitter[0], jitter[1], state.skyFrames > 0 ? 1 : 0, 0],
      previous: [view.azimuth, view.pitch, ...(view.pointer ?? state.pointer)],
    };
    tablePass.set({ atmosphere: skyUniforms });
    cloudPass.set({ atmosphere: skyUniforms });
    // Textures are rebound every frame: the history alternates, and a resize
    // replaces the cloud layer's texture.
    atmosphere.set({
      atmosphere: skyUniforms,
      cloudLayer: cloudTarget.color,
      cloudHistory: skyTarget.read.colors[1],
    });
    if (stepFoam) foamPass.set({ atmosphere: seaUniforms, foamHistory: foamTarget.read.color });
    // Between steps the water reads the history last written.
    water.set({ atmosphere: seaUniforms, skyTexture: skyTarget.write.color, foamLayer: stepFoam ? foamTarget.write.color : foamTarget.read.color });
    updateIslandTable(islandTable, state.flight, state.celestial);
    const wake = state.wake.pack();
    if (wake) gpu.gpu.queue.writeTexture({ texture: state.wakeTexture }, wake, { bytesPerRow: 64 * 16 }, [64, 1]);
    currentFrame.pass(wavesTarget, wavesPass);
    if (stepFoam) currentFrame.pass(foamTarget.write, foamPass);
    currentFrame.pass(skyTable, tablePass);
    currentFrame.pass(cloudTarget, cloudPass);
    currentFrame.pass(skyTarget.write, atmosphere);
    currentFrame.pass(output, water);
    skyTarget.swap();
    state.skyFrames++;
    if (stepFoam) {
      foamTarget.swap();
      state.foamFrames++;
      state.foamStep = 0;
    } else if (!whitecaps) {
      state.foamFrames = 0;
      state.foamStep = 0;
    }
    state.previousView = {
      azimuth: state.flight.azimuth,
      pitch: state.flight.pitch,
      pointer: [...state.pointer],
    };
    state.landscape.render({
      celestial: state.celestial,
      cover: state.weather?.cover ?? 0,
      time: state.time,
      wind: state.weather?.wind ?? [0, 0],
      rain: state.weather?.rain ?? 0,
      weather: state.weather,
      weatherDt,
      reducedMotion: motionPreference.matches,
      view: state.flight,
      lighting: state.lighting,
      pose: state.walker.cat,
      dt: motionPreference.matches ? 0 : dt,
      surface: state.walker.surface,
      water: state.walker.water,
      onStep: footstep,
      wake: state.wake,
    });
    if (PERF) {
      canvas.dataset.frameIntervalMs = (gpuClock.deltaTime * 1000).toFixed(2);
      canvas.dataset.cpuFrameMs = (performance.now() - cpuStarted).toFixed(2);
    }
    if (!state.firstFrame) {
      state.firstFrame = true;
      state.loadingRaf = requestAnimationFrame(() => {
        loading.ready();
        sharpen();
      });
    }
  };
  document.body.dataset.renderer = "webgpu";
  syncLoop();
}

// While revealing, every layer renders at the same coarse pixel grid, so
// sky, sea and land share their blocks as they sharpen.
function revealSize() {
  return [
    Math.max(1, Math.ceil(window.innerWidth * state.reveal)),
    Math.max(1, Math.ceil(window.innerHeight * state.reveal)),
  ];
}

// Steps the reveal up to full resolution, one resize per step.
function sharpen() {
  clearTimeout(state.revealTimer);
  if (state.reveal >= 1) document.body.classList.remove("revealing");
  if (state.reveal >= 1 || state.disposed) return;
  state.revealTimer = setTimeout(() => {
    state.reveal = REVEAL[REVEAL.indexOf(state.reveal) + 1] ?? 1;
    resizeAtmosphere();
    sharpen();
  }, REVEAL_STEP_MS);
}

function cloudSize() {
  if (state.reveal < 1) return revealSize();
  // Clouds tolerate smooth upscaling. Water has a separate, sharper budget.
  const width = window.innerWidth;
  const height = window.innerHeight;
  const scale =
    Math.min(1, Math.sqrt(SKY_PIXELS / (width * height))) * state.quality;
  return [
    Math.max(1, Math.round(width * scale)),
    Math.max(1, Math.round(height * scale)),
  ];
}

function waterSize() {
  if (state.reveal < 1) return revealSize();
  const width = window.innerWidth;
  const height = window.innerHeight;
  const scale =
    Math.min(window.devicePixelRatio || 1, MAX_DPR, Math.sqrt(WATER_PIXELS / (width * height))) *
    Math.max(0.75, Math.sqrt(state.quality));
  return [
    Math.max(1, Math.round(width * scale)),
    Math.max(1, Math.round(height * scale)),
  ];
}

// Until the walker exists (the landscape builds it), shaders compile against
// the old home view.
const FIRST_VIEW = { x: 6, y: 4.5, z: 0, azimuth: (315 * Math.PI) / 180, pitch: 0.10472 };

function createUniforms() {
  const view = state.flight ?? FIRST_VIEW;
  const sky = state.celestial;
  const weather = state.weather;
  const light = (state.lighting = lightingAt(sky, weather));
  return {
    resolution: state.output.size,
    pointer: state.pointer,
    time: state.time,
    scene: sky.scene,
    steps: LIGHT || state.quality < 0.85 ? 32 : 44,
    seed: (state.seed % 65536) / 65536,
    sun: sky.sun,
    moon: sky.moon,
    celestial: [sky.sidereal, sky.latitude, sky.moonPhase, sky.moonAngle],
    // A neutral clear atmosphere is used if the API is unavailable, and labelled as such.
    weather: [
      weather?.low ?? 0,
      weather?.mid ?? 0,
      weather?.high ?? 0,
      weather?.cover ?? 0,
    ],
    wind: weather?.wind ?? [0, 0],
    rain: weather?.rain ?? 0,
    flight: [view.x, view.y, view.z, view.azimuth],
    pitch: view.pitch,
    light: [...light.direct, light.exposure],
    ambient: [...light.sky, light.night],
    // Filled in per frame for the sky passes; unused by the water pass.
    temporal: [0, 0, 0, 0],
    previous: [0, 0, 0, 0],
    swell: swellUniform(state.seed, weather?.wind ?? [0, 0]),
    // Filled in per frame for the sea passes.
    ocean: [0, 0, 0, state.landscape?.cloudTransmission ?? 1],
  };
}

// The archipelago for the sea (archipelago.js), with the share of the sun
// (or moon) its islands leave visible from the camera, refreshed as either
// moves.
const islandCache = { seed: null, data: null, key: "", texels: new Float32Array(ISLAND_SLOTS * 4) };
function updateIslandTable(texture, view, sky) {
  if (islandCache.seed !== state.seed) {
    islandCache.seed = state.seed;
    islandCache.data = archipelagoUniform(state.seed);
    islandCache.key = "";
  }
  const night = smooth(1, 2, sky.scene);
  const l = sky.sun.map((v, i) => v * (1 - night) + sky.moon[i] * night);
  const n = Math.hypot(...l) || 1;
  const coast = [Math.SQRT1_2 * (l[0] + l[2]) / n, l[1] / n, Math.SQRT1_2 * (l[2] - l[0]) / n];
  const key = `${coast.map((v) => v.toFixed(4))}:${Math.round(view.x * 2)}:${Math.round(view.y * 2)}:${Math.round(view.z * 2)}`;
  if (key !== islandCache.key) {
    islandCache.key = key;
    islandCache.data[0][1] = archipelagoSunVisibility([view.x, view.y, view.z], coast, state.seed);
    islandCache.data.forEach((v, i) => islandCache.texels.set(v, i * 4));
    state.gpu.gpu.queue.writeTexture({ texture }, islandCache.texels, { bytesPerRow: ISLAND_SLOTS * 16 }, [ISLAND_SLOTS, 1]);
  }
}

// The cat walks; the camera follows. Keys are camera-relative.
function updateCat(dt) {
  const keys = state.keys;
  const held = (...names) => names.some((name) => keys.has(name));
  const move = [
    (held("d", "arrowright") ? 1 : 0) - (held("a", "arrowleft") ? 1 : 0),
    (held("w", "arrowup") ? 1 : 0) - (held("s", "arrowdown") ? 1 : 0),
  ];
  if (review?.run && state.time < 27) move[1] = 1;
  if (move[0] || move[1]) dismissHint();
  const walker = state.walker;
  const cat = walker.update(
    dt,
    { move, run: held("shift") || Boolean(review?.run && state.time < 27), jump: state.jump, rain: (state.weather?.rain ?? 0) > 0.5 },
    state.landscape.interest,
  );
  state.jump = false;
  for (const event of walker.events.splice(0)) {
    if (event.type === "jump") state.sound.jump();
    if (event.type === "shake") state.sound.shake();
    if (event.type === "splash") {
      // Leaping or bounding into the water.
      const strength = Math.min(1.5, event.speed / 3);
      state.sound.splash(strength, 0);
      state.wake.ring(cat.x, cat.z, 0.6 + strength);
      state.landscape.catSplashed(state.time, strength, cat.waterY);
    }
    if (event.type === "land") {
      state.sound.land(event.speed);
      let kind = 2;
      for (const front of [true, false])
        for (const side of [-1, 1]) {
          const across = side * 0.03 * CAT_SCALE;
          const along = (front ? 0.12 : -0.1) * CAT_SCALE;
          const sin = Math.sin(cat.heading);
          const cos = Math.cos(cat.heading);
          kind = footstep(side < 0 ? "l" : "r", cat.x + cos * across + sin * along, cat.z - sin * across + cos * along, cat.heading, front, { side: -side, speed: 1 }, true);
        }
      state.landscape.catLanded(state.time, Math.min(1.5, event.speed / 3), kind, walker.surface);
    }
  }
  state.sound.setSwim(cat.swim, Math.abs(cat.speed));
  // Purr once settled; chirrup at something new to watch.
  state.sound.setPurr(cat.sit > 0.9 && cat.idle > 8);
  const interest = state.landscape.interest;
  if (interest?.near && state.time - state.lastChirp > 12) {
    state.lastChirp = state.time;
    state.sound.chirrup();
  }
  // The soundscape from where the cat stands.
  const inland = shoreDistance(cat.x, cat.z);
  const seaX = cat.x - ISLAND.x;
  const seaZ = cat.z - ISLAND.z;
  const r = Math.hypot(seaX, seaZ) || 1;
  const yaw = state.flight.azimuth + Math.PI / 4;
  const wind = state.weather?.wind ?? [0, 0];
  state.sound.update({
    sea: 1 - smooth(0, 30, inland),
    // Afloat, the sea is all round the cat's ears.
    underwater: cat.swim,
    seaPan: (seaX / r) * Math.cos(yaw) - (seaZ / r) * Math.sin(yaw),
    wind: Math.hypot(wind[0], wind[1]),
    rain: state.weather?.rain ?? 0,
    night: smooth(1, 2, state.celestial.scene),
    trees: smooth(8, 16, inland),
  });
}

// A paw lands: a print in the ground and a step you can hear.
// Returns the surface kind (walker.surfaceKind), which the cat uses to
// decide whether sand flies.
function footstep(leg, x, z, heading, front, { side = 1, speed = 0, pace = speed } = {}, silent = false) {
  const cat = state.walker.cat;
  const ground = state.walker.surface;
  const onRock = ground(x, z) > groundHeight(x, z) + 0.03;
  // A paw set down in the water splashes instead of printing.
  const depth = state.walker.water(x, z).level - ground(x, z);
  const kind = surfaceKind(x, z, onRock, depth > 0.008);
  if (kind === 5) {
    state.pawWet = 1;
    // Rings and froth as big as the splash: deeper and faster, bigger.
    state.wake.ring(x, z, Math.min(2.5, 0.3 + depth * 6 + pace * 0.5));
    if (!silent) state.sound.splash(Math.min(1, 0.15 + depth * 3 + speed * 0.4), leg.startsWith("l") ? -0.15 : 0.15);
    return kind;
  }
  const inland = shoreDistance(x, z);
  const e = 0.03;
  const y = ground(x, z);
  const nx = ground(x - e, z) - ground(x + e, z);
  const nz = ground(x, z - e) - ground(x, z + e);
  const n = Math.hypot(nx, 2 * e, nz);
  const wet = 1 - smooth(0.6, 2, inland);
  // Wet sand wets the paws; each step elsewhere dries them a little.
  state.pawWet = kind === 1 ? 1 : state.pawWet * 0.88;
  state.landscape.addPrint({
    time: state.time,
    x,
    y,
    z,
    heading,
    front,
    side,
    normal: [nx / n, (2 * e) / n, nz / n],
    strength: kind === 0 ? state.pawWet * 0.9 : [0, 1, 0.9, 0.55, 0.3][kind],
    wet,
    // Dry sand crumbles; wet sand and soil hold a crisp edge.
    soft: [0, 0.1, 1, 0.7, 0.5][kind] * (1 - wet * 0.8),
    speed,
    rock: kind === 0,
  });
  if (!silent) state.sound.step(kind, cat.running, leg.startsWith("l") ? -0.15 : 0.15);
  return kind;
}

function smooth(a, b, x) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function adaptQuality(deltaTime) {
  // Settled 30fps pacing is intentional, not evidence of missed 60fps work.
  // Exclude that cadence and development fixture captures from adaptation.
  if (review || (state.keys.size === 0 && state.walker?.cat.idle > 6 && performance.now() - state.lastInput > 6000)) return;
  if (deltaTime <= 0 || deltaTime > 0.12) return;
  state.frameMs += (deltaTime * 1000 - state.frameMs) * 0.025;
  state.sampleCount++;
  if (state.sampleCount < 180 || state.time - state.lastQualityChange < 8)
    return;
  const previous = state.quality;
  if (state.frameMs > 24) state.quality = Math.max(0.5, state.quality - 0.12);
  else if (state.frameMs < 18)
    state.quality = Math.min(1, state.quality + 0.06);
  if (previous !== state.quality) {
    state.lastQualityChange = state.time;
    resizeAtmosphere();
  }
}

function resizeAtmosphere() {
  state.output?.resize(waterSize());
  state.skyTarget?.read.resize(cloudSize());
  state.skyTarget?.write.resize(cloudSize());
  state.cloudTarget?.resize(quarterSize(cloudSize()));
  resetSkyHistory();
  state.landscape?.resize(window.innerWidth, window.innerHeight, state.quality, state.reveal < 1 ? revealSize() : null);
  renderStill();
}

function syncLoop() {
  cancelAnimationFrame(state.raf);
  state.raf = 0;
  if (!state.gpu || !state.renderFrame || document.hidden) return;
  if (motionPreference.matches) renderStill();
  else state.raf = requestAnimationFrame(tick);
}

function tick(timestamp) {
  state.raf = requestAnimationFrame(tick);
  const cat = state.walker?.cat;
  const settled =
    cat && cat.idle > 6 && performance.now() - state.lastInput > 6000 && !state.keys.size;
  const interval = 1000 / (settled ? IDLE_FPS : ACTIVE_FPS);
  canvas.dataset.targetFps = String(settled ? IDLE_FPS : ACTIVE_FPS);
  if (timestamp - state.lastFrame < interval - 3) return;
  state.lastFrame = timestamp;
  frame(state.gpu, state.renderFrame);
}

function renderStill() {
  if (
    motionPreference.matches &&
    state.gpu &&
    state.renderFrame &&
    !document.hidden
  ) {
    // Four frames: one per cloud jitter, so a still has full-resolution clouds.
    resetSkyHistory();
    for (let i = 0; i < 4; i++) frame(state.gpu, state.renderFrame);
  }
}

// Sub-pixel order within each 2x2 block: diagonals first, so two frames
// already cover the block evenly.
const JITTER = [[0, 0], [1, 1], [1, 0], [0, 1]];

function quarterSize([width, height]) {
  return [Math.ceil(width / 2), Math.ceil(height / 2)];
}

// Discontinuities (time scrubbing, new weather, a resize, returning home)
// make last frame's clouds useless: rebuild them from fresh samples.
function resetSkyHistory() {
  state.skyFrames = 0;
  state.previousView = null;
}

function useFallback(error) {
  cancelAnimationFrame(state.loadingRaf);
  loading.fail(error);
  document.body.dataset.renderer = "fallback";
  cancelAnimationFrame(state.raf);
  const gpu = state.gpu;
  state.gpu = null;
  state.output = null;
  state.renderFrame = null;
  gpu?.dispose();
  state.landscape?.dispose();
  state.landscape = null;
  console.warn("Using the static sky fallback:", error);
}

function stopAtmosphere() {
  state.disposed = true;
  clearTimeout(state.revealTimer);
  events.abort();
  clearInterval(state.clockTimer);
  clearInterval(state.weatherTimer);
  state.weatherRequest?.abort();
  cancelAnimationFrame(state.raf);
  cancelAnimationFrame(state.loadingRaf);
  loading.dispose();
  state.sound.dispose();
  state.gpu?.dispose();
  state.landscape?.dispose();
}

if (import.meta.hot) import.meta.hot.dispose(stopAtmosphere);
