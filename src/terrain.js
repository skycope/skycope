// Shared world layout in metres: x right, y up, z toward the horizon from the
// home view. The land is an island: a closed shore curve whose radius varies
// around the centre. One signed shore distance drives terrain height, wave
// refraction, foam and vegetation, so they always agree.
// The ocean shader repeats these formulas: change and test both together.
export const ISLAND = { x: 58, z: 70 };

export function shoreRadius(theta) {
  return (
    62 +
    14 * Math.sin(2 * theta + 0.8) +
    7 * Math.sin(3 * theta + 2.1) +
    3.5 * Math.sin(7 * theta + 4.5)
  );
}

// Positive inland, negative out at sea.
export function shoreDistance(x, z) {
  const dx = x - ISLAND.x;
  const dz = z - ISLAND.z;
  const r = Math.hypot(dx, dz) || 0.001;
  return shoreRadius(Math.atan2(dz, dx)) - r;
}

// Position a point a given distance inland from the shore at angle theta.
export function islandPoint(theta, inland) {
  const r = Math.max(0, shoreRadius(theta) - inland);
  return {
    x: ISLAND.x + Math.cos(theta) * r,
    z: ISLAND.z + Math.sin(theta) * r,
  };
}

export function terrainHeight(x, z) {
  const inland = shoreDistance(x, z);
  if (inland <= 0) return inland * 0.15;
  const beach = Math.min(inland, 5) * 0.075;
  const rise = smoothstep(4, 28, inland);
  const hills =
    4 + noise2(x * 0.033, z * 0.026) * 9 + noise2(x * 0.08, z * 0.07) * 1.2;
  return beach + rise * hills;
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
