import { writeFile, mkdir } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import assert from "node:assert/strict";
import { PNG } from "pngjs";
import { resolveShader } from "@vgpu/wgsl/runtime";
import { fileURLToPath } from "node:url";
import { init, effect, frame, target, sampler, timer } from "vgpu/node";
import { createCloudNoise } from "../src/cloud-noise.js";
import { skyAt } from "../src/astronomy.js";
import { lightingAt } from "../src/sunlight.js";
import { readFile } from "node:fs/promises";
import { CATALOG_SIZE, starCatalogCells, halfFloats } from "../src/star-catalog.js";

// Offline visual fixtures. They never override the live site's weather.
const outputDirectory = process.argv[2] ?? "/tmp/skycope-qa";
await mkdir(outputDirectory, { recursive: true });
const gpu = await init({ requiredFeatures: ["timestamp-query"] });
const errors = [];
gpu.onError((error) => errors.push(error));
const noise = createCloudNoise(gpu.gpu);
const stars = gpu.gpu.createTexture({
  size: [1, 1],
  format: "rgba8unorm",
  usage: GPUTextureUsage.TEXTURE_BINDING,
});
// The real star catalog, so night fixtures show true stars. The constellation
// figure atlas stays black.
const catalog = JSON.parse(await readFile(new URL("../src/data/stars.json", import.meta.url), "utf8"));
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
const skyTarget = target(gpu, { size: [700, 490], format: "rgba16float" });
const shader = effect(
  gpu,
  (
    await resolveShader({
      entry: fileURLToPath(new URL("../src/shaders/sky.wgsl", import.meta.url)),
      validate: "off",
    })
  ).wgsl,
  {
    set: {
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
  },
);
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
      skyTexture: skyTarget.color,
      starCatalog: starCatalog.createView(),
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
const gpuTimer = timer(gpu);
const timings = [];
gpuTimer.onResults((spans) => timings.push(spans.sky + spans.water));
await shader.compile(skyTarget);
await water.compile(output);
// Optional view: [heading in degrees, pitch in radians]; default is home.
for (const [name, time, weather, rain, view] of [
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
  ["horizon", "2026-09-08T16:32:00Z", [0, 0, 0, 0], 0],
  ["after-sunset", "2026-09-08T16:36:00Z", [0, 0, 0, 0], 0],
]) {
  if (name === "horizon" || name === "after-sunset") {
    output.resize([1600, 900]);
    skyTarget.resize([1000, 562]);
    water.set({ skyTexture: skyTarget.color });
  }
  const sky = skyAt(new Date(time));
  const light = lightingAt(sky);
  const atmosphere = {
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
    wind: [2, 1],
    rain,
    flight: [6, 4.5, 0, ((view?.[0] ?? 315) * Math.PI) / 180],
    pitch: view?.[1] ?? 0.10472,
  };
  shader.set({ atmosphere: { ...atmosphere, resolution: skyTarget.size } });
  water.set({ atmosphere });
  timings.length = 0;
  const start = performance.now();
  for (let i = 0; i < 24; i++) {
    frame(gpu, (f) => {
      f.pass({ target: skyTarget, timer: gpuTimer.span("sky") }, shader);
      f.pass({ target: output, timer: gpuTimer.span("water") }, water);
    });
    await gpu.gpu.queue.onSubmittedWorkDone();
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
  console.log(
    `${name}: GPU median ${sorted[Math.floor(sorted.length / 2)]?.toFixed(2)} ms, max ${Math.max(...sorted).toFixed(2)} ms; ${(performance.now() - start).toFixed(0)} ms total`,
  );
}
gpu.dispose();
