import { seededRandom } from "./random.js";

const volumes = new Map();

// A 256 KiB repeating volume replaces procedural hashes inside the raymarch.
export function createCloudNoise(device, seed = 1847) {
  const size = 64;
  const data = cloudNoiseData(seed);

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

// CPU transmission uses precisely the bytes uploaded to the visible cloud
// march. Keep at most two scene seeds, avoiding a retained volume per reload.
export function cloudNoiseData(seed = 1847) {
  if (volumes.has(seed)) return volumes.get(seed);
  const data = new Uint8Array(64 ** 3);
  const random = seededRandom(seed);
  for (let i = 0; i < data.length; i++) data[i] = Math.floor(random() * 256);
  if (volumes.size >= 2) volumes.delete(volumes.keys().next().value);
  volumes.set(seed, data);
  return data;
}
