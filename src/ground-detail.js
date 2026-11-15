import * as THREE from "three";
import { seededRandom } from "./random.js";
import { groundHeight, shoreDistance, noise2, smoothstep } from "./terrain.js";
import { MATERIAL_HEX } from "./material-palette.js";

// Sparse opaque detail comes from local producers, not a repeated one-item
// lattice. Render LOD controls visibility; this seed-consistent data never
// changes when the camera, weather or quality changes. Fallen leaves are no
// longer placed here: the near-ground carpet (near-ground.js) lays them
// wherever the ground's litter is, round the cat, at no cost elsewhere.
export function groundDetailData(seed, producers, { light = false } = {}) {
  const random = seededRandom(seed ^ 0x47e1b39);
  const twigs = [], roots = [], stones = [];
  const caps = light ? [1100, 700, 800] : [2200, 1400, 1600];
  for (const p of producers) {
    if (shoreDistance(p.x, p.z) < 4) continue;
    const woody = ["tree", "shrub", "protea", "erica"].includes(p.kind);
    if (!woody) continue;
    const count = Math.min(9, Math.ceil((p.litter ?? 0.4) * 7));
    for (let i = 0; i < count; i++) {
      const angle = random() * Math.PI * 2;
      const radius = Math.sqrt(random()) * Math.min(4, p.radius ?? 1);
      // Prevailing transport leaves pockets downwind of the plant base.
      const x = p.x + Math.cos(angle) * radius + radius * 0.18;
      const z = p.z + Math.sin(angle) * radius - radius * 0.09;
      if (shoreDistance(x, z) < 3) continue;
      if (random() < 0.4 && twigs.length < caps[0])
        twigs.push(stick(x, z, 0.004 + random() * 0.006, 0.12 + random() * 0.25, random() * 6.283));
    }
    if (p.kind === "tree" && roots.length < caps[1]) {
      const rootRandom = seededRandom((Number(p.id) || Math.floor(p.x * 971 + p.z * 437)) ^ seed);
      const reach = Math.min(0.9, 0.18 + p.height * 0.06);
      for (let i = 0; i < 3 && roots.length < caps[1]; i++) {
        const a = i * 2.094 + rootRandom() * 0.8;
        const dx = Math.cos(a), dz = Math.sin(a);
        const x = p.x + dx * reach * 0.45, z = p.z + dz * reach * 0.45;
        const r = Math.min(0.025, 0.007 + p.height * 0.0015);
        roots.push(stick(x, z, r, reach, a));
      }
    }
  }
  // Pebbles collect in uneven sandy deposits, with open gaps and a mixture
  // of sizes. They are centimetres tall, independently of the ground bump.
  for (let i = 0; i < 5500 && stones.length < caps[2]; i++) {
    const x = -28 + random() * 180, z = -18 + random() * 178;
    const inland = shoreDistance(x, z);
    if (inland < 0.8 || inland > 12 || random() > noise2(x * 0.25 + 6, z * 0.23) ** 2 * 0.65) continue;
    const size = 0.015 + random() ** 3 * 0.07;
    const colour = new THREE.Color("#8d8980").lerp(new THREE.Color("#a18c73"), random());
    stones.push(part(x, z, size * 0.18, size, size * 0.55, size * (0.7 + random() * 0.5), random() * 6.283, colour));
  }
  return { twigs, roots, stones };
}

function part(x, z, lift, sx, sy, sz, yaw, color) {
  const h = groundHeight(x, z);
  const e = 0.15;
  const gx = (groundHeight(x + e, z) - groundHeight(x - e, z)) / (2 * e);
  const gz = (groundHeight(x, z + e) - groundHeight(x, z - e)) / (2 * e);
  return {
    position: new THREE.Vector3(x, h + lift, z),
    scale: new THREE.Vector3(sx, sy, sz),
    rotation: new THREE.Euler(Math.atan(gz), yaw, -Math.atan(gx)),
    ground: h,
    color,
  };
}

function stick(x, z, radius, length, yaw) {
  const h = groundHeight(x, z);
  // Cylinder local y follows the ground slope along this segment, leaving
  // only its upper half exposed. Decorative roots are at most 2.5 cm high.
  const dx = Math.cos(yaw), dz = Math.sin(yaw);
  const start = new THREE.Vector3(x - dx * length * 0.5, groundHeight(x - dx * length * 0.5, z - dz * length * 0.5), z - dz * length * 0.5);
  const end = new THREE.Vector3(x + dx * length * 0.5, groundHeight(x + dx * length * 0.5, z + dz * length * 0.5), z + dz * length * 0.5);
  const axis = end.sub(start).normalize();
  const rotation = new THREE.Euler().setFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis));
  return {
    position: new THREE.Vector3(x, h, z),
    scale: new THREE.Vector3(radius, length, radius * 0.8),
    rotation, ground: h, color: new THREE.Color(MATERIAL_HEX.bark),
  };
}

// Low cover the ground shader paints where no geometry could afford to go:
// `scrub` is strandveld and fynbos (grey-green bush bodies, bronze restio)
// over the hills, thinning into clearings and paths and giving way to leaf
// litter under the tree crowns; `sourfig` is the succulent mats that creep
// over the dune band behind the beach. `shade` is the canopy's sky
// occlusion (0 open, 1 under a crown).
export function groundCover(x, z, inland = shoreDistance(x, z), shade = 0) {
  const dither = noise2(x * 0.7 + 3.1, z * 0.7) * 3 - 1.5;
  const clearings = noise2(x * 0.075 + 17, z * 0.083 - 5) * 0.7 + noise2(x * 0.21, z * 0.19 + 9) * 0.3;
  const scrub = smoothstep(6, 14, inland + dither) *
    smoothstep(0.26, 0.5, clearings) *
    // Under a crown the scrub carries on as lower, sparser thicket.
    (1 - smoothstep(0.22, 0.6, shade) * 0.4);
  // Sour fig creeps over the dry dune sand, above the swash's reach, in
  // scattered mats.
  const sourfig = shoreClear(x, z, inland, 5.5, 8) *
    (1 - smoothstep(10, 14, inland + dither)) *
    smoothstep(0.5, 0.7, noise2(x * 0.09 + 40, z * 0.11 - 12));
  return { scrub, sourfig };
}

// Where anything may grow, 0-1: nothing on the wet sand or within the
// swash's reach (the run-up comes ~4.5 m up the beach, 0.35 m above the
// sea), fading in over the dry sand above it. `from`/`to`: the fade, in
// metres inland; heights follow (the beach rises ~7.5 cm a metre there).
export function shoreClear(x, z, inland = shoreDistance(x, z), from = 4.5, to = 7) {
  return smoothstep(from, to, inland) * smoothstep(0.35, 0.35 + (to - from) * 0.12, groundHeight(x, z));
}
