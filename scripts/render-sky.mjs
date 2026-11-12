import { writeFile, mkdir, readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import assert from "node:assert/strict";
import { PNG } from "pngjs";
import { resolveShader } from "@vgpu/wgsl/runtime";
import { fileURLToPath } from "node:url";
import { init, effect, frame, target, sampler, timer, pingPong, storage } from "vgpu/node";
import { createCloudNoise } from "../src/cloud-noise.js";
import { skyAt } from "../src/astronomy.js";
import { lightingAt } from "../src/sunlight.js";
import { swellUniform } from "../src/swell.js";
import { createWaveModes } from "../src/wave-modes.js";
import { rockLayout, shoreRockData } from "../src/rocks.js";
import { seededRandom } from "../src/random.js";
import { archipelagoUniform, ISLAND_SLOTS } from "../src/archipelago.js";
import { createShoreTextures, createLandTexture } from "../src/shore-textures.js";
import { landFieldData } from "../src/land-field.js";
import { createVegetation } from "../src/vegetation.js";
import { cloudTransmission } from "../src/cloud-transmission.js";
import { CATALOG_SIZE, starCatalogCells, halfFloats, constellationAtlas } from "../src/star-catalog.js";
import { skyEventFrame, quietSkyUniforms } from "../src/sky-events.js";
// sea-sky-magic: the awakened gifts' sea and sky (src/sea-sky-magic.js).
import { magicUniforms, magicFixture } from "../src/sea-sky-magic.js";
import { placesLayout } from "../src/place-layout.js";
import { groundHeight } from "../src/terrain.js";

// Offline visual fixtures. They never override the live site's weather.
const outputDirectory = process.argv[2] ?? "/tmp/skycope-qa";
await mkdir(outputDirectory, { recursive: true });
const gpu = await init({ requiredFeatures: ["timestamp-query"] });
const errors = [];
gpu.onError((error) => errors.push(error));
const noise = createCloudNoise(gpu.gpu);
// The real star catalog, so night fixtures show true stars, and the
// constellation figure atlas exactly as the site builds it.
const catalog = JSON.parse(await readFile(new URL("../src/data/stars.json", import.meta.url), "utf8"));
const stars = gpu.gpu.createTexture({
  size: [2048, 1024],
  format: "rgba8unorm",
  usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
});
gpu.gpu.queue.writeTexture({ texture: stars }, constellationAtlas(catalog.constellations), { bytesPerRow: 2048 * 4 }, [2048, 1024]);
const starCatalog = gpu.gpu.createTexture({
  size: CATALOG_SIZE,
  format: "rgba16float",
  usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
});
gpu.gpu.queue.writeTexture(
  { texture: starCatalog },
  halfFloats(starCatalogCells(catalog.stars)),
  { bytesPerRow: CATALOG_SIZE[0] * 8 },
  CATALOG_SIZE,
);
const output = target(gpu, { size: [1000, 700], format: "rgba8unorm" });
// sea-sky-magic: the seed's lighthouse lamp, as main.js lampPosition puts it.
const tower = placesLayout(1847).find((p) => p.id === "lighthouse");
const LAMP = { x: tower.x, y: groundHeight(tower.x, tower.z) + 15.2, z: tower.z };
// The site's sky passes (see src/main.js): scattering table, quarter-
// resolution cloud march, and the resolve with its cloud history.
const wgsl = async (name) =>
  (
    await resolveShader({
      entry: fileURLToPath(new URL(`../src/shaders/${name}`, import.meta.url)),
      validate: "off",
    })
  ).wgsl;
const skySampler = sampler(gpu, {
  minFilter: "linear",
  magFilter: "linear",
  addressModeU: "repeat",
  addressModeV: "repeat",
  addressModeW: "repeat",
});
const skyColors = { colors: [{ format: "rgba16float" }, { format: "rgba16float" }] };
const skyTarget = pingPong(gpu, 700, 490, skyColors);
const tableTarget = target(gpu, { size: [256, 128], format: "rgba16float" });
const cloudTarget = target(gpu, { size: [350, 245], format: "rgba16float" });
const table = effect(gpu, await wgsl("sky-table.wgsl"), { set: {} });
const clouds = effect(gpu, await wgsl("clouds.wgsl"), {
  set: { cloudNoise: noise.createView(), cloudSampler: skySampler, skyTable: tableTarget.color },
});
const shader = effect(gpu, await wgsl("sky.wgsl"), {
  set: {
    cloudNoise: noise.createView(),
    starAtlas: stars.createView(),
    cloudSampler: skySampler,
    skyTable: tableTarget.color,
    cloudLayer: cloudTarget.color,
    cloudHistory: skyTarget.read.colors[1],
  },
});
const JITTER = [[0, 0], [1, 1], [1, 0], [0, 1]];
let benchSea = null;
// The wind-sea cascades and the whitecap history (see src/main.js).
const wavesFormat = { format: "rgba16float" };
const wavesTarget = target(gpu, { size: [128, 128], colors: [wavesFormat, wavesFormat, wavesFormat, wavesFormat] });
const foamTarget = pingPong(gpu, 512, 512, { format: "rgba16float" });
const waveModes = createWaveModes(1847);
const modes = storage(gpu, waveModes.data.byteLength, "read");
const waves = effect(gpu, await wgsl("waves.wgsl"), { set: { modes } });
const foam = effect(gpu, await wgsl("foam.wgsl"), {
  set: {
    waves0: wavesTarget.colors[0],
    waves1: wavesTarget.colors[1],
    waves2: wavesTarget.colors[2],
    foamHistory: foamTarget.read.color,
    filtering: skySampler,
  },
});
// The seed's boulders, exactly as the site places them (forest.js).
const shore = createShoreTextures(gpu.gpu, shoreRockData(rockLayout(seededRandom(1847))));
// And the island's reflection field, from the seed's own shoots.
const land = createLandTexture(gpu.gpu, landFieldData(createVegetation(1847).clusters));
// The seed's distant islands, as the site bakes them for the sea.
const islandTable = gpu.gpu.createTexture({
  size: [ISLAND_SLOTS, 1],
  format: "rgba32float",
  usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
});
gpu.gpu.queue.writeTexture({ texture: islandTable }, new Float32Array(archipelagoUniform(1847).flat()), { bytesPerRow: ISLAND_SLOTS * 16 }, [ISLAND_SLOTS, 1]);
// No cat in the fixtures: an empty wake.
const catWake = gpu.gpu.createTexture({
  size: [64, 1],
  format: "rgba32float",
  usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
});
const water = effect(
  gpu,
  (
    await resolveShader({
      entry: fileURLToPath(
        new URL("../src/shaders/water.wgsl", import.meta.url),
      ),
      validate: "off",
    })
  ).wgsl,
  {
    set: {
      cloudNoise: noise.createView(),
      skyTexture: skyTarget.write.color,
      starCatalog: starCatalog.createView(),
      waves0: wavesTarget.colors[0],
      waves1: wavesTarget.colors[1],
      waves2: wavesTarget.colors[2],
      waves3: wavesTarget.colors[3],
      foamLayer: foamTarget.write.color,
      shoreRocks: shore.rocks.createView(),
      shoreGrid: shore.grid.createView(),
      landField: land.createView(),
      catWake: catWake.createView(),
      islandTable: islandTable.createView(),
      skyTable: tableTarget.color,
      filtering: sampler(gpu, {
        minFilter: "linear",
        magFilter: "linear",
        addressModeU: "repeat",
        addressModeV: "repeat",
        addressModeW: "repeat",
      }),
    },
  },
);
// BASE_WATER=path/to/water.wgsl: a second water shader (an older checkout's)
// benched against this one, interleaved in the same process (BENCH=1).
const baseWater = process.env.BASE_WATER
  ? effect(gpu, (await resolveShader({ entry: process.env.BASE_WATER, validate: "off" })).wgsl, {
      set: {
        cloudNoise: noise.createView(),
        skyTexture: skyTarget.write.color,
        starCatalog: starCatalog.createView(),
        waves0: wavesTarget.colors[0],
        waves1: wavesTarget.colors[1],
        waves2: wavesTarget.colors[2],
        waves3: wavesTarget.colors[3],
        foamLayer: foamTarget.write.color,
        shoreRocks: shore.rocks.createView(),
        shoreGrid: shore.grid.createView(),
        landField: land.createView(),
        catWake: catWake.createView(),
        islandTable: islandTable.createView(),
        skyTable: tableTarget.color,
        filtering: sampler(gpu, { minFilter: "linear", magFilter: "linear", addressModeU: "repeat", addressModeV: "repeat", addressModeW: "repeat" }),
      },
    })
  : null;
const gpuTimer = timer(gpu);
const timings = [];
const waterTimings = [];
const seaTimings = [];
gpuTimer.onResults((spans) => {
  timings.push(spans.table + spans.clouds + spans.sky + spans.waves + spans.foam + spans.water);
  waterTimings.push(spans.waves + spans.foam + spans.water);
  seaTimings.push([spans.waves, spans.foam, spans.table, spans.clouds, spans.sky, spans.water]);
});
await table.compile(tableTarget);
await clouds.compile(cloudTarget);
await shader.compile(skyTarget.write);
await waves.compile(wavesTarget);
await foam.compile(foamTarget.write);
await water.compile(output);
if (baseWater) await baseWater.compile(output);
// Optional view: [heading in degrees, pitch in radians, optional [x, y, z]
// coast metres]; default is home.
for (const [name, time, weather, rain, view, windOverride, skyOptions] of [
  ["clouds", "2026-09-08T12:00:00Z", [0.6, 0.08, 0.4, 0.62], 0],
  ["dusk", "2026-09-08T16:25:00Z", [0.6, 0.08, 0.3, 0.62], 0],
  ["rain", "2026-09-08T12:00:00Z", [0.95, 0.75, 0.8, 1], 3],
  ["night", "2026-09-08T21:00:00Z", [0.6, 0.08, 0.3, 0.62], 0],
  ["clear", "2026-09-08T12:00:00Z", [0, 0, 0, 0], 0],
  ["glint", "2026-09-08T13:50:00Z", [0, 0, 0, 0], 0],
  // Moonless: the galactic centre high in the west, Scorpius and Sagittarius.
  ["milky-way", "2026-09-10T18:45:00Z", [0, 0, 0, 0], 0, [250, 0.75]],
  ["southern-cross", "2026-09-10T18:45:00Z", [0, 0, 0, 0], 0, [200, 0.35]],
  // Waxing crescent in the west with earthshine; full moon; a low moonrise
  // that must stay cool, never sunrise-coloured.
  ["crescent", "2026-09-15T18:45:00Z", [0, 0, 0, 0], 0, [261, 0.45]],
  ["full-moon", "2026-09-25T18:45:00Z", [0, 0, 0, 0], 0, [64, 0.55]],
  ["moonrise", "2026-09-27T18:45:00Z", [0.3, 0.05, 0.2, 0.3], 0, [69, 0.12]],
  // The surf zone from above and low along the beach: breakers, whitewater,
  // swash and caustics over the sandy shelf.
  ["surf", "2026-09-08T12:00:00Z", [0, 0, 0, 0], 0, [351, -0.6, [3.6, 10, -4.8]]],
  ["surf-low", "2026-09-08T14:30:00Z", [0.2, 0.05, 0.1, 0.2], 0, [44, -0.1, [8.3, 2, 1.7]]],
  // Standing on the beach looking out to sea, as the cat's camera does.
  ["beach", "2026-09-08T11:00:00Z", [0, 0, 0, 0], 0, [138, -0.2, [13.2, 1.9, 14.1]]],
  ["whitecaps", "2026-09-08T12:00:00Z", [0.3, 0.1, 0.2, 0.3], 0, [171, -0.08, [-4, 6, -20]], [11, 5]],
  // Boulders at the waterline (seed 1847's eastern cluster): lapping rings,
  // the foam collar, rocks mirrored in and seen through the water.
  ["rocks", "2026-09-08T12:00:00Z", [0, 0, 0, 0], 0, [123.4, -0.24, [127.8, 2.2, 59.8]]],
  ["rocks-above", "2026-09-08T14:30:00Z", [0.2, 0.05, 0.1, 0.2], 0, [104.7, -0.6, [126, 5, 56]]],
  // A full moon over the surf: the moon path and moonlit foam.
  ["moon-beach", "2026-09-25T18:45:00Z", [0, 0, 0, 0], 0, [64, -0.06, [8.3, 2, 1.7]]],
  // Moonless, over the surf and the rocks: bioluminescence in the breakers.
  ["glow", "2026-09-10T19:30:00Z", [0, 0, 0, 0], 0, [44, -0.12, [8.3, 2, 1.7]]],
  ["glow-rocks", "2026-09-10T19:30:00Z", [0, 0, 0, 0], 0, [104.7, -0.6, [126, 5, 56]]],
  // sky-events (src/sky-events.js). The last element: { force, time (event
  // clock), sunlit, preset }. Unforced fixtures must show their event from
  // the real geometry and weather alone.
  // Showers with the sun out, behind you: a high arch, and a low wide one.
  ["rainbow", "2026-09-08T15:50:00Z", [0.45, 0.15, 0.2, 0.5], 1.5, [102, 0.3], null, { sunlit: 0.9 }],
  ["rainbow-low", "2026-09-08T14:30:00Z", [0.45, 0.15, 0.2, 0.5], 0.4, [115, 0.12], null, { sunlit: 0.9 }],
  // Thin cirrostratus: the 22° halo and sundogs round a 24° sun.
  ["halo", "2026-09-08T14:30:00Z", [0.05, 0.05, 0.45, 0.35], 0, [295, 0.41]],
  // Broken cloud and a low sun: crepuscular rays.
  ["rays", "2026-09-08T15:50:00Z", [0.55, 0.2, 0.2, 0.6], 0, [282, 0.12], null, { sunlit: 0.5 }],
  ["rays2", "2026-09-08T16:05:00Z", [0.4, 0.3, 0.1, 0.5], 0, [279, 0.15], [9, -14], { sunlit: 0.5 }],
  ["rays3", "2026-09-08T16:05:00Z", [0.4, 0.3, 0.1, 0.5], 0, [279, 0.15], [-20, 6], { sunlit: 0.5 }],
  // A night storm at a stroke's peak, and a stormy afternoon.
  ["lightning", "2026-09-10T19:30:00Z", [1, 0.9, 0.9, 1], 8, [200, 0.12], null, { force: "lightning", time: 24.27, preset: "storm" }],
  ["lightning-day", "2026-09-08T12:00:00Z", [1, 0.9, 0.9, 1], 8, [200, 0.12], null, { force: "lightning", time: 24.27, preset: "storm" }],
  // A moonless night: a shooting star, and a fireball mid-flight.
  ["meteor", "2026-09-10T19:30:00Z", [0, 0, 0, 0], 0, [200, 0.45], null, { force: "meteor", time: 24.55 }],
  ["fireball", "2026-09-10T19:30:00Z", [0, 0, 0, 0], 0, [200, 0.45], null, { force: "fireball", time: 25.6 }],
  ["satellite", "2026-09-08T17:20:00Z", [0, 0, 0, 0], 0, [200, 0.45], null, { force: "satellite", time: 24 }],
  // Full moon: a moonbow in a night shower, and a corona in thin cloud.
  ["moonbow", "2026-09-26T19:00:00Z", [0.4, 0.1, 0.1, 0.45], 1.5, [244, 0.2], null, { sunlit: 0.9 }],
  ["corona", "2026-09-26T19:00:00Z", [0.15, 0.4, 0.1, 0.45], 0, [64, 0.44]],
  // April evening, moonless: the zodiacal light up the western sky.
  ["zodiacal", "2026-04-16T17:55:00Z", [0, 0, 0, 0], 0, [270, 0.3]],
  // Wide views from here on (the output stays resized).
  ["horizon", "2026-09-08T16:32:00Z", [0, 0, 0, 0], 0],
  ["after-sunset", "2026-09-08T16:36:00Z", [0, 0, 0, 0], 0],
  // The last sliver of the sun over a clean sea horizon.
  ["green-flash", "2026-09-08T16:32:40Z", [0, 0, 0, 0.05], 0, [276.2, 0.0], null, { sunlit: 1 }],
  // sea-sky-magic: the gifts awake. skyOptions.magic: { gifts, age (s since
  // they woke), pulse, call, time (the scene clock) }. MAGIC=0 renders any
  // of them asleep, for side-by-side A/B.
  ["tideglow", "2026-09-10T19:30:00Z", [0, 0, 0, 0], 0, [44, -0.12, [8.3, 2, 1.7]], null, { magic: { gifts: ["tideglow"] } }],
  ["tideglow-rocks", "2026-09-10T19:30:00Z", [0, 0, 0, 0], 0, [104.7, -0.6, [126, 5, 56]], null, { magic: { gifts: ["tideglow"] } }],
  ["tideglow-rain", "2026-09-10T19:30:00Z", [0.7, 0.4, 0.3, 0.8], 2.5, [44, -0.25, [8.3, 3, 1.7]], null, { magic: { gifts: ["tideglow"] } }],
  ["tideglow-day", "2026-09-08T12:00:00Z", [0, 0, 0, 0], 0, [351, -0.6, [3.6, 10, -4.8]], null, { magic: { gifts: ["tideglow"] } }],
  ["stars-drawing", "2026-09-10T18:45:00Z", [0, 0, 0, 0], 0, [200, 0.35], null, { magic: { gifts: ["stars"], age: 5 } }],
  ["stars-drawn", "2026-09-10T18:45:00Z", [0, 0, 0, 0], 0, [200, 0.35], null, { magic: { gifts: ["stars"], age: 40 } }],
  ["stars-sea", "2026-09-10T19:30:00Z", [0, 0, 0, 0], 0, [200, 0.12, [8.3, 3, 1.7]], null, { magic: { gifts: ["stars"], age: 40 } }],
  ["stars-day", "2026-09-08T12:00:00Z", [0, 0, 0, 0], 0, [200, 0.35], null, { magic: { gifts: ["stars"], age: 40 } }],
  ["lamp", "2026-09-10T19:30:00Z", [0, 0, 0, 0], 0, [123.4, -0.1, [127.8, 4, 40]], null, { magic: { gifts: ["lamp"], time: 26.6 } }],
  ["lamp-far", "2026-09-10T19:30:00Z", [0, 0, 0, 0], 0, [60, -0.06, [8.3, 3, 1.7]], null, { magic: { gifts: ["lamp"], time: 28.3 } }],
  ["pulse", "2026-09-10T19:30:00Z", [0, 0, 0, 0], 0, [292, -0.12, [8.3, 4, 1.7]], null, { magic: { gifts: [], pulse: { x: -9.4, z: 43.8, at: 22.2, gift: "tideglow", speed: 18, reach: 150 } } }],
  ["pulse-day", "2026-09-08T15:00:00Z", [0, 0, 0, 0], 0, [292, -0.12, [8.3, 4, 1.7]], null, { magic: { gifts: [], pulse: { x: -9.4, z: 43.8, at: 22.2, gift: "lamp", speed: 18, reach: 150 } } }],
  ["finale", "2026-09-10T19:30:00Z", [0, 0, 0, 0], 0, [200, 0.3, [8.3, 3, 1.7]], null, { magic: { gifts: ["fireflies", "tideglow", "lamp", "stars", "seafolk", "boat", "finale"], age: 40 } }],
  ["finale-sea", "2026-09-10T19:30:00Z", [0, 0, 0, 0], 0, [44, -0.15, [8.3, 6, 1.7]], null, { magic: { gifts: ["fireflies", "tideglow", "lamp", "stars", "seafolk", "boat", "finale"], age: 40 } }],
]) {
  // ONLY=name,name: render just those fixtures (quick A/B runs).
  if (process.env.ONLY && !process.env.ONLY.split(",").includes(name)) continue;
  if (name === "horizon" || name === "after-sunset" || name === "green-flash") {
    output.resize([1600, 900]);
    skyTarget.read.resize([1000, 562]);
    skyTarget.write.resize([1000, 562]);
    cloudTarget.resize([500, 281]);
  }
  const sky = skyAt(new Date(time));
  const light = lightingAt(sky);
  const wind = windOverride ?? [2, 1];
  const eye = view?.[2] ?? [6, 4.5, 0];
  // The direct beam through the cloud, as the land layer hands it to the sea
  // (landscape.js): ocean.w. Left at 0, the sea had no sunlight or glitter.
  const night = Math.min(1, Math.max(0, sky.scene - 1));
  const beam = sky.sun.map((v, i) => v + (sky.moon[i] - v) * night * night * (3 - 2 * night));
  const beamLength = Math.hypot(...beam) || 1;
  const cloudBeam = 0.07 + 0.93 * cloudTransmission(1847, {
    low: weather[0], mid: weather[1], high: weather[2],
    x: eye[0], y: eye[1], z: eye[2], sun: beam.map((v) => v / beamLength), wind, time: 24,
  });
  const atmosphere = {
    swell: swellUniform(1847, wind),
    ocean: [0, 0, 1, cloudBeam],
    light: [...light.direct, light.exposure],
    ambient: [...light.sky, light.night],
    resolution: output.size,
    pointer: [0.5, 0.5],
    time: 24,
    scene: sky.scene,
    steps: 56,
    seed: 1847 / 65536,
    sun: sky.sun,
    moon: sky.moon,
    celestial: [sky.sidereal, sky.latitude, sky.moonPhase, sky.moonAngle],
    weather,
    wind,
    rain,
    flight: [...eye, ((view?.[0] ?? 315) * Math.PI) / 180],
    pitch: view?.[1] ?? 0.10472,
  };
  // sky-events: the same scheduler the site runs, at the fixture's moment.
  const events = skyEventFrame({
    seed: 1847,
    time: skyOptions?.time ?? 24,
    date: new Date(time),
    celestial: sky,
    weather: { low: weather[0], mid: weather[1], high: weather[2], cover: weather[3], rain, wind, preset: skyOptions?.preset },
    sunlit: skyOptions?.sunlit ?? null,
    lighting: light,
    force: skyOptions?.force ?? null,
    view: { azimuth: atmosphere.flight[3], pitch: atmosphere.pitch },
  });
  // NO_EVENTS=1: the same fixture with every sky event off, to cost them.
  if (!process.env.NO_EVENTS) Object.assign(atmosphere, events.uniforms);
  else Object.assign(atmosphere, quietSkyUniforms());
  if (process.env.EVENTS) console.log(name, JSON.stringify(events.uniforms));
  // sea-sky-magic: asleep unless the fixture wakes gifts (MAGIC=0: asleep).
  const magicOptions = process.env.MAGIC === "0" ? null : skyOptions?.magic;
  if (magicOptions?.time) atmosphere.time = magicOptions.time;
  const magicRecord = magicFixture({ ...magicOptions, clock: atmosphere.time });
  Object.assign(atmosphere, magicUniforms(magicRecord, { time: atmosphere.time, lamp: LAMP }));
  if (process.env.EVENTS && magicOptions) console.log(name, JSON.stringify(magicUniforms(magicRecord, { time: atmosphere.time, lamp: LAMP })));
  timings.length = 0;
  waterTimings.length = 0;
  seaTimings.length = 0;
  const start = performance.now();
  // A still camera: the clouds' history converges after four frames, one
  // per jitter, exactly as on the site.
  for (let i = 0; i < 64; i++) {
    const [jx, jy] = JITTER[i % 4];
    const skyAtmosphere = {
      ...atmosphere,
      resolution: skyTarget.write.size,
      temporal: [jx, jy, i > 0 ? 1 : 0, 0],
      previous: [atmosphere.flight[3], atmosphere.pitch, 0.5, 0.5],
    };
    table.set({ atmosphere: skyAtmosphere });
    clouds.set({ atmosphere: skyAtmosphere });
    shader.set({ atmosphere: skyAtmosphere, cloudLayer: cloudTarget.color, cloudHistory: skyTarget.read.colors[1] });
    // The sea steps at 60 Hz, ending on the fixture's time, so the whitecap
    // history has built up as it would have on the site.
    const sea = {
      ...atmosphere,
      time: atmosphere.time - (63 - i) / 60,
      ocean: [1 / 60, i > 0 ? 1 : 0, 1, cloudBeam],
      temporal: [0, 0, 0, 0],
      previous: [0, 0, 0, 0],
    };
    modes.write(waveModes.update(sea.time, sea.wind));
    foam.set({ atmosphere: sea, foamHistory: foamTarget.read.color });
    water.set({ atmosphere: sea, skyTexture: skyTarget.write.color, foamLayer: foamTarget.write.color });
    benchSea = sea;
    frame(gpu, (f) => {
      f.pass({ target: wavesTarget, timer: gpuTimer.span("waves") }, waves);
      f.pass({ target: foamTarget.write, timer: gpuTimer.span("foam") }, foam);
      f.pass({ target: tableTarget, timer: gpuTimer.span("table") }, table);
      f.pass({ target: cloudTarget, timer: gpuTimer.span("clouds") }, clouds);
      f.pass({ target: skyTarget.write, timer: gpuTimer.span("sky") }, shader);
      f.pass({ target: output, timer: gpuTimer.span("water") }, water);
    });
    await gpu.gpu.queue.onSubmittedWorkDone();
    skyTarget.swap();
    foamTarget.swap();
  }
  // BENCH=1: throughput per pass, 120 back-to-back frames of each alone.
  // Timestamp spans on tiled GPUs are noisy for small passes; this is not.
  if (process.env.BENCH) {
    const bench = {};
    foam.set({ foamHistory: foamTarget.read.color });
    // The cloud march too.
    for (const [label, t, e] of [["waves", wavesTarget, waves], ["foam", foamTarget.write, foam], ["clouds", cloudTarget, clouds], ["water", output, water]]) {
      await gpu.gpu.queue.onSubmittedWorkDone();
      const begin = performance.now();
      frame(gpu, (f) => { for (let i = 0; i < 120; i++) f.pass(t, e); });
      await gpu.gpu.queue.onSubmittedWorkDone();
      bench[label] = ((performance.now() - begin) / 120).toFixed(3);
    }
    console.log(`${name} bench ms/frame:`, JSON.stringify(bench));
    if (baseWater) {
      baseWater.set({ atmosphere: benchSea, skyTexture: skyTarget.write.color, foamLayer: foamTarget.write.color });
      const best = { base: Infinity, water: Infinity };
      // Each round's ratio too: other work on a shared GPU slows neighbouring
      // runs alike, so their median holds where the minima drift.
      const ratios = [];
      for (let k = 0; k < (+process.env.AB_ROUNDS || 16); k++) {
        const round = {};
        for (const [label, e] of k % 2 ? [["base", baseWater], ["water", water]] : [["water", water], ["base", baseWater]]) {
          await gpu.gpu.queue.onSubmittedWorkDone();
          const begin = performance.now();
          frame(gpu, (f) => { for (let i = 0; i < 24; i++) f.pass(output, e); });
          await gpu.gpu.queue.onSubmittedWorkDone();
          round[label] = (performance.now() - begin) / 24;
          best[label] = Math.min(best[label], round[label]);
        }
        ratios.push(round.water / round.base);
      }
      ratios.sort((a, b) => a - b);
      const ratio = ratios[Math.floor(ratios.length / 2)];
      console.log(`${name} ab base ${best.base.toFixed(3)} new ${best.water.toFixed(3)} ${((best.water / best.base - 1) * 100).toFixed(1)}%, median ratio ${((ratio - 1) * 100).toFixed(1)}%`);
    }
  }
  await gpu.settled();
  const pixels = await output.read();
  assert.equal(errors.length, 0, errors.map(String).join("\n"));
  assert.ok(
    // A true night sky is dark, and this fixture's star atlas is black.
    pixels.some((v, i) => i % 4 !== 3 && v > (sky.scene > 1.5 ? 6 : 20)),
    `${name} must not be blank`,
  );
  const png = new PNG({ width: output.size[0], height: output.size[1] });
  png.data.set(pixels);
  await writeFile(`${outputDirectory}/${name}.png`, PNG.sync.write(png));
  const sorted = timings.slice(4).sort((a, b) => a - b);
  const waterSorted = waterTimings.slice(4).sort((a, b) => a - b);
  const median = (values) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)]?.toFixed(2);
  const spectrum = median(seaTimings.slice(4).map((t) => t[0]));
  const history = median(seaTimings.slice(4).map((t) => t[1]));
  const passes = ["table", "clouds", "sky", "water"].map((p, k) => `${p} ${median(seaTimings.slice(4).map((t) => t[k + 2]))}`).join(", ");
  console.log(
    `${name}: GPU median ${sorted[Math.floor(sorted.length / 2)]?.toFixed(2)} ms (sea ${waterSorted[Math.floor(waterSorted.length / 2)]?.toFixed(2)} ms: waves ${spectrum}, foam ${history}; ${passes}), max ${Math.max(...sorted).toFixed(2)} ms; ${(performance.now() - start).toFixed(0)} ms total`,
  );
}
gpu.dispose();
