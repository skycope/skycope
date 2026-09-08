import {
  clock,
  effect,
  frame,
  frameLoop,
  init,
  sampler,
  surface,
  target,
} from "vgpu";
import skyShader from "./shaders/sky.wgsl";
import waterShader from "./shaders/water.wgsl";
import { createCloudNoise } from "./cloud-noise.js";
import { createStarAtlas } from "./stars.js";
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

const canvas = document.querySelector("#sky");
const slider = document.querySelector("#time");
const liveButton = document.querySelector("#live");
const timeLabel = document.querySelector("#time-label");
const weatherLabel = document.querySelector("#conditions");
const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
const events = new AbortController();
const state = {
  seed: sceneSeed(window.location.search),
  date: new Date(),
  debugMinutes: null,
  celestial: null,
  pointer: [0.5, 0.5],
  targetPointer: [0.5, 0.5],
  weather: null,
  weatherRequest: null,
  weatherTimer: null,
  clockTimer: null,
  landscape: null,
  gpu: null,
  output: null,
  skyTarget: null,
  atmosphere: null,
  water: null,
  loop: null,
  renderFrame: null,
  time: 24,
  frameMs: 16.7,
  quality: 1,
  sampleCount: 0,
  lastQualityChange: 0,
  disposed: false,
};

start();

async function start() {
  connectControls();
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
      updateTime();
    },
    options,
  );
  liveButton.addEventListener(
    "click",
    () => {
      state.debugMinutes = null;
      updateTime();
    },
    options,
  );
  window.addEventListener(
    "pointermove",
    (event) => {
      if (event.pointerType === "touch" || motionPreference.matches) return;
      state.targetPointer = [
        event.clientX / window.innerWidth,
        1 - event.clientY / window.innerHeight,
      ];
    },
    { ...options, passive: true },
  );
  document.documentElement.addEventListener(
    "pointerleave",
    () => {
      state.targetPointer = [0.5, 0.5];
    },
    options,
  );
  window.addEventListener("resize", resizeAtmosphere, options);
  document.addEventListener(
    "visibilitychange",
    () => {
      updateTime();
      syncLoop();
      if (
        !document.hidden &&
        (!state.weather ||
          Date.now() - state.weather.observedAt > WEATHER_REFRESH_MS)
      )
        refreshWeather();
    },
    options,
  );
  motionPreference.addEventListener(
    "change",
    () => {
      state.pointer = [0.5, 0.5];
      state.targetPointer = [0.5, 0.5];
      syncLoop();
    },
    options,
  );
}

function updateTime() {
  const live = state.debugMinutes === null;
  state.date = live ? new Date() : dateAtCapeMinutes(state.debugMinutes);
  state.celestial = skyAt(state.date);
  timeLabel.textContent = capeTime(state.date);
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
    state.weather = await fetchWeather(request.signal);
    weatherLabel.textContent = `${state.weather.temperature}° · ${state.weather.description}`;
    weatherLabel.title = `Cape Town weather model, updated ${capeTime(new Date(state.weather.observedAt))} SAST · Open-Meteo`;
    document.body.dataset.weather = "live";
  } catch (error) {
    if (state.disposed) return;
    const fresh =
      state.weather &&
      Date.now() - state.weather.observedAt < WEATHER_MAX_AGE_MS;
    weatherLabel.textContent = fresh
      ? `${state.weather.temperature}° · weather delayed`
      : "weather unavailable";
    if (!fresh) state.weather = null;
    document.body.dataset.weather = fresh ? "delayed" : "unavailable";
    console.warn("Cape Town weather:", error.message);
  } finally {
    clearTimeout(timeout);
    state.weatherRequest = null;
    renderStill();
  }
}

async function startAtmosphere() {
  const gpu = await init();
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
  const skyTarget = target(gpu, { size: cloudSize(), format: "rgba16float" });
  state.skyTarget = skyTarget;
  const noise = createCloudNoise(gpu.gpu, state.seed);
  const stars = createStarAtlas(gpu.gpu);
  const atmosphere = effect(gpu, skyShader, {
    label: "skycope-cape-town",
    set: {
      atmosphere: createUniforms(),
      cloudNoise: noise.createView(),
      starAtlas: stars.createView(),
      cloudSampler: sampler(gpu, {
        minFilter: "linear",
        magFilter: "linear",
        addressModeU: "repeat",
        addressModeV: "repeat",
        addressModeW: "repeat",
      }),
    },
  });
  state.atmosphere = atmosphere;
  const water = effect(gpu, waterShader, {
    label: "skycope-water",
    set: {
      atmosphere: createUniforms(),
      cloudNoise: noise.createView(),
      skyTexture: skyTarget.color,
      filtering: sampler(gpu, { minFilter: "linear", magFilter: "linear" }),
    },
  });
  state.water = water;
  const { createLandscape } = await import("./landscape.js");
  if (state.disposed) return;
  state.landscape = createLandscape(
    document.querySelector("#landscape"),
    state.seed,
  );
  state.landscape.resize(window.innerWidth, window.innerHeight);
  await atmosphere.compile({ colors: [skyTarget.format] });
  await water.compile({ colors: [output.format] });
  if (state.disposed) return;
  gpu.onError(useFallback);
  gpu.gpu.lost.then((info) => {
    if (!state.disposed && state.gpu === gpu) useFallback(info.message);
  });
  const gpuClock = clock(gpu);
  state.renderFrame = (currentFrame) => {
    const dt = Math.min(gpuClock.deltaTime, 0.05);
    if (!motionPreference.matches) {
      state.time += dt;
      const easing = 1 - Math.exp(-dt * 2.5);
      state.pointer = state.pointer.map(
        (value, i) => value + (state.targetPointer[i] - value) * easing,
      );
      adaptQuality(gpuClock.deltaTime);
    }
    const uniforms = createUniforms();
    atmosphere.set({ atmosphere: { ...uniforms, resolution: skyTarget.size } });
    water.set({ atmosphere: uniforms, skyTexture: skyTarget.color });
    currentFrame.pass(skyTarget, atmosphere);
    currentFrame.pass(output, water);
    state.landscape.render(
      state.celestial,
      state.pointer,
      state.weather?.cover ?? 0,
      state.time,
      Math.hypot(...(state.weather?.wind ?? [0, 0])),
    );
  };
  document.body.dataset.renderer = "webgpu";
  syncLoop();
}

function cloudSize() {
  // Clouds tolerate smooth upscaling. Water has a separate, sharper budget.
  const width = window.innerWidth;
  const height = window.innerHeight;
  const scale =
    Math.min(1, Math.sqrt(1000000 / (width * height))) * state.quality;
  return [
    Math.max(1, Math.round(width * scale)),
    Math.max(1, Math.round(height * scale)),
  ];
}

function waterSize() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const scale = Math.min(
    window.devicePixelRatio || 1,
    2,
    Math.sqrt(3500000 / (width * height)),
  );
  return [
    Math.max(1, Math.round(width * scale)),
    Math.max(1, Math.round(height * scale)),
  ];
}

function createUniforms() {
  const sky = state.celestial;
  const weather = state.weather;
  return {
    resolution: state.output.size,
    pointer: state.pointer,
    time: state.time,
    scene: sky.scene,
    steps: state.quality < 0.85 ? 40 : 56,
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
  };
}

function adaptQuality(deltaTime) {
  if (deltaTime <= 0 || deltaTime > 0.12) return;
  state.frameMs += (deltaTime * 1000 - state.frameMs) * 0.025;
  state.sampleCount++;
  if (state.sampleCount < 180 || state.time - state.lastQualityChange < 8)
    return;
  const previous = state.quality;
  if (state.frameMs > 24) state.quality = Math.max(0.6, state.quality - 0.12);
  else if (state.frameMs < 18)
    state.quality = Math.min(1, state.quality + 0.06);
  if (previous !== state.quality) {
    state.lastQualityChange = state.time;
    resizeAtmosphere();
  }
}

function resizeAtmosphere() {
  state.output?.resize(waterSize());
  state.skyTarget?.resize(cloudSize());
  state.landscape?.resize(window.innerWidth, window.innerHeight, state.quality);
  renderStill();
}

function syncLoop() {
  state.loop?.stop();
  state.loop = null;
  if (!state.gpu || !state.renderFrame || document.hidden) return;
  if (motionPreference.matches) renderStill();
  else state.loop = frameLoop(state.gpu, state.renderFrame);
}

function renderStill() {
  if (
    motionPreference.matches &&
    state.gpu &&
    state.renderFrame &&
    !document.hidden
  ) {
    frame(state.gpu, state.renderFrame);
  }
}

function useFallback(error) {
  document.body.dataset.renderer = "fallback";
  state.loop?.stop();
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
  events.abort();
  clearInterval(state.clockTimer);
  clearInterval(state.weatherTimer);
  state.weatherRequest?.abort();
  state.loop?.stop();
  state.gpu?.dispose();
  state.landscape?.dispose();
}

if (import.meta.hot) import.meta.hot.dispose(stopAtmosphere);
