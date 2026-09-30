import { cloudNoiseData } from './cloud-noise.js';

// Coarse direct transmission along the actual visible cloud density. One
// 16-sample CPU ray, cached by the caller at 4 Hz, costs no readback or pass.
export function cloudTransmission(seed, { x = 0, y = 4.5, z = 0, sun = [0, 1, 0], wind = [0, 0], time = 0, low = 0, mid = 0, high = 0 } = {}) {
  if (Math.max(low, mid, high) < .01 || sun[1] <= -.02) return 1;
  const data = cloudNoiseData(seed);
  const eye = [x * .012, Math.max(.4, 1.6 + (y - 4.5) * .02), -z * .012];
  let opticalDepth = 0;
  for (let i = 0; i < 16; i++) {
    const distance = 1 + ((i + .5) / 16) ** 2 * 44;
    const width = 2 * ((i + .5) / 16) * 44 / 16;
    opticalDepth += cloudDensity(data, eye.map((v, j) => v + sun[j] * distance), { wind, time, low, mid, high }) * width * 1.9;
    if (opticalDepth > 8) break;
  }
  // Multiple scattering retains diffuse illumination; this is only the
  // direct beam, and must never multiply the already-clouded sky dome.
  return Math.exp(-opticalDepth);
}

export function cloudDensity(data, position, { wind = [0, 0], time = 0, low = 0, mid = 0, high = 0 } = {}) {
  const p = [position[0] - wind[0] * time * .012, position[1], position[2] + wind[1] * time * .012];
  const lower = smooth(-3.8, -1.6, p[1]) * (1 - smooth(1, 3.2, p[1]));
  const upper = smooth(4, 5.1, p[1]) * (1 - smooth(5.6, 7.5, p[1]));
  const middle = smooth(1.5, 2.8, p[1]) * (1 - smooth(3.5, 4.6, p[1]));
  const profile = Math.max(lower, upper * .92, middle);
  const coverage = Math.max(lower * low, upper * high, middle * mid);
  if (profile < .01 || coverage < .01) return 0;
  const q = [p[0] * .29 + 3.1, p[1] * .4 + 8.4, p[2] * .29 + 1.7];
  const body = volumeNoise(data, q) * .57 + volumeNoise(data, q.map(v => v * 2.03 + 13.7)) * .28 + volumeNoise(data, q.map(v => v * 4.11 + 7.3)) * .15;
  const erosion = volumeNoise(data, q.map(v => v * 8.2)) * .07;
  return Math.max((body * profile - (.66 + (.18 - .66) * coverage ** .65) - erosion) * 3.8, 0);
}

export function volumeNoise(data, p) {
  const cell = p.map(Math.floor), f = p.map((v, i) => v - cell[i]);
  const blend = f.map(v => v * v * (3 - 2 * v));
  let value = 0;
  for (let z = 0; z <= 1; z++) for (let y = 0; y <= 1; y++) for (let x = 0; x <= 1; x++) {
    const at = ((cell[2] + z) & 63) * 4096 + ((cell[1] + y) & 63) * 64 + ((cell[0] + x) & 63);
    value += data[at] / 255 * (x ? blend[0] : 1 - blend[0]) * (y ? blend[1] : 1 - blend[1]) * (z ? blend[2] : 1 - blend[2]);
  }
  return value;
}

function smooth(a, b, x) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
