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
