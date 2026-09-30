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
  // Broad hummocks and shallow scours have real silhouette and paw contact.
  // Keep the swash/beach slope unchanged; the 0.5 m mesh resolves these
  // metre-scale features, and groundHeight samples the same triangles.
  const relief = smoothstep(5, 10, inland) * (
    (noise2(x * 0.48, z * 0.43) - 0.5) * 0.25 +
    (noise2(x * 0.21 + 17, z * 0.3 - 4) - 0.5) * 0.16
  );
  return beach + rise * hills + relief;
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

// The ground mesh (forest.js) samples terrainHeight on this grid. Anything
// that stands on the ground (the cat, its paw prints) uses groundHeight: the
// mesh's own piecewise-linear surface, so feet neither float nor sink.
export const GROUND = { size: 190, segments: 380 };

export function groundHeight(x, z) {
  const cell = GROUND.size / GROUND.segments;
  const u = (x - ISLAND.x + GROUND.size / 2) / cell;
  const v = (z - ISLAND.z + GROUND.size / 2) / cell;
  const i = Math.floor(u);
  const j = Math.floor(v);
  const fu = u - i;
  const fv = v - j;
  const x0 = ISLAND.x - GROUND.size / 2 + i * cell;
  const z0 = ISLAND.z - GROUND.size / 2 + j * cell;
  // PlaneGeometry splits each cell along the (0,1)-(1,0) diagonal.
  const h01 = terrainHeight(x0, z0 + cell);
  const h10 = terrainHeight(x0 + cell, z0);
  if (fu + fv <= 1) {
    const h00 = terrainHeight(x0, z0);
    return h00 + fu * (h10 - h00) + fv * (h01 - h00);
  }
  const h11 = terrainHeight(x0 + cell, z0 + cell);
  return h11 + (1 - fu) * (h01 - h11) + (1 - fv) * (h10 - h11);
}
