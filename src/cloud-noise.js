import { seededRandom } from "./random.js";

// A 256 KiB repeating volume replaces procedural hashes inside the raymarch.
export function createCloudNoise(device, seed = 1847) {
  const size = 64;
  const data = new Uint8Array(size ** 3);
  const random = seededRandom(seed);
  for (let i = 0; i < data.length; i++) {
    data[i] = Math.floor(random() * 256);
  }

  const texture = device.createTexture({
    label: "skycope-cloud-noise",
    size: [size, size, size],
    dimension: "3d",
    format: "r8unorm",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  device.queue.writeTexture(
    { texture },
    data,
    { bytesPerRow: size, rowsPerImage: size },
    [size, size, size],
  );
  return texture;
}
