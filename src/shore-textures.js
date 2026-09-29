import { LAND_FIELD, landFieldLevels } from "./land-field.js";
import { halfFloats } from "./star-catalog.js";
// The boulders at the waterline (src/rocks.js shoreRockData) as the two
// textures the water pass reads: ten RGBA32F texels per rock, and the 100²
// lookup grid of up to eight rock indices per 2 m cell.
export function createShoreTextures(device, shore) {
  const rows = Math.max(1, shore.count);
  const rocks = device.createTexture({
    label: "skycope-shore-rocks",
    size: [10, rows],
    format: "rgba32float",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  device.queue.writeTexture({ texture: rocks }, shore.rocks, { bytesPerRow: 10 * 16 }, [10, rows]);
  const grid = device.createTexture({
    label: "skycope-shore-grid",
    size: [100, 100],
    format: "rgba32uint",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  device.queue.writeTexture({ texture: grid }, shore.grid, { bytesPerRow: 100 * 16 }, [100, 100]);
  return { rocks, grid };
}

// The island's height and albedo field (src/land-field.js) for reflections.
// Levels 1–3 hold each cell's maximum height (land-field.js landFieldLevels),
// which the reflection march uses to cross empty cells in one step.
export function createLandTexture(device, data) {
  const { size } = LAND_FIELD;
  const levels = landFieldLevels(data);
  const texture = device.createTexture({
    label: "skycope-land-field",
    size: [size, size],
    mipLevelCount: levels.length + 1,
    format: "rgba16float",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  [data, ...levels].forEach((level, mipLevel) => {
    const s = size >> mipLevel;
    device.queue.writeTexture({ texture, mipLevel }, halfFloats(level), { bytesPerRow: s * 8 }, [s, s]);
  });
  return texture;
}
