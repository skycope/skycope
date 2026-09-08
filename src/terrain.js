// Shared world layout in metres: x right, y up, z toward the horizon.
// Smooth functions keep the shoreline and vegetation placement deterministic.
export function shoreline(z) {
  return 4 + z * 0.075 + Math.sin(z * 0.026) * 7;
}

export function terrainHeight(x, z) {
  const inland = Math.max(0, x - shoreline(z));
  const beach = Math.min(inland, 5) * 0.075;
  const rise = smoothstep(4, 28, inland);
  const hills =
    4 + noise2(x * 0.033, z * 0.026) * 9 + noise2(x * 0.08, z * 0.07) * 1.2;
  return inland === 0 ? (x - shoreline(z)) * 0.15 : beach + rise * hills;
}

export function noise2(x, y) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = smoothstep(0, 1, x - ix);
  const fy = smoothstep(0, 1, y - iy);
  const a = hash(ix, iy) * (1 - fx) + hash(ix + 1, iy) * fx;
  const b = hash(ix, iy + 1) * (1 - fx) + hash(ix + 1, iy + 1) * fx;
  return a * (1 - fy) + b * fy;
}

function hash(x, y) {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

export function smoothstep(a, b, x) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
