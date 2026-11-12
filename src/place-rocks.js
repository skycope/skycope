import * as THREE from "three";
import { terrainHeight, groundHeight } from "./terrain.js";
import { seededRandom } from "./random.js";
import { layoutFor, placeClearance } from "./place-layout.js";
import { ROCK_VARIANTS } from "./rocks.js";

// The landmarks' granite, in rocks.js's layout format so the forest draws,
// shades and collides with it like any boulder (the sea laps the waterline
// ones): scattered rocks are kept out of each landmark's zone, and the
// cairn's stones and the rock pool's boulders are added.
export function placeRocks(seed, rocks) {
  const layout = layoutFor(seed);
  const kept = rocks.filter((r) => placeClearance(layout, r.position.x, r.position.z, "clear") > Math.max(r.scale.x, r.scale.z) * 0.8);
  const random = seededRandom((seed ^ 0x3c6ef372) >>> 0 || 1);
  for (const p of layout) {
    if (p.kind === "beacon") kept.push(...cairn(p, random));
    if (p.kind === "pool") kept.push(...poolBoulders(p, random));
  }
  return kept;
}

const grey = (random, l = 0.33) => new THREE.Color().setHSL(0.075 + random() * 0.02, 0.05 + random() * 0.03, l + (random() - 0.5) * 0.09);

// A dry-stone cairn: courses of flat stones laid round and inward, each
// course stepped in, the gaps chinked with smaller ones. The beacon's mast
// rises from its top (places.js).
export const CAIRN = { base: 1.35, height: 1.45 };
function cairn(p, random) {
  const stones = [];
  const g = groundHeight(p.x, p.z);
  const courses = [
    { r: 1.18, count: 9, size: 0.42, y: 0.12 },
    { r: 0.86, count: 8, size: 0.38, y: 0.5 },
    { r: 0.55, count: 6, size: 0.34, y: 0.86 },
    { r: 0.22, count: 3, size: 0.3, y: 1.18 },
  ];
  courses.forEach((course, c) => {
    const offset = random() * Math.PI * 2;
    for (let i = 0; i < course.count; i++) {
      const a = offset + (i / course.count) * Math.PI * 2 + (random() - 0.5) * 0.25;
      const size = course.size * (0.68 + random() * 0.62);
      const x = p.x + Math.cos(a) * course.r;
      const z = p.z + Math.sin(a) * course.r;
      const base = Math.max(g, groundHeight(x, z));
      const sy = size * (0.42 + random() * 0.25);
      stones.push({
        position: new THREE.Vector3(x, g + course.y + sy * 0.2, z),
        scale: new THREE.Vector3(size, sy, size * (0.75 + random() * 0.25)),
        // Laid flat, tipped slightly inward so the pile locks together.
        rotation: new THREE.Euler(Math.sin(a) * 0.12 + (random() - 0.5) * 0.25, a + (random() - 0.5) * 1.2, -Math.cos(a) * 0.12 + (random() - 0.5) * 0.25),
        color: grey(random, 0.27),
        ground: c === 0 ? base : g + course.y - sy * 0.4,
        variant: (c * 3 + i) % ROCK_VARIANTS,
      });
    }
  });
  return stones;
}

// Granite boulders round the pool's shelf, lower toward the sea.
export const POOL = { shelf: 3.1, basin: 1.85 };
function poolBoulders(p, random) {
  const out = [];
  const count = 6;
  const seaward = Math.atan2(-(p.z - 70), -(p.x - 58));
  for (let i = 0; i < count; i++) {
    const a = seaward + Math.PI * 0.35 + (i / (count - 1)) * Math.PI * 1.3 + (random() - 0.5) * 0.3;
    const size = 0.9 + random() ** 1.5 * 1.1;
    const reach = POOL.shelf + size * (0.45 + random() * 0.2);
    const x = p.x + Math.cos(a) * reach;
    const z = p.z + Math.sin(a) * reach;
    const ground = Math.max(terrainHeight(x, z), -0.6);
    const sy = size * (0.55 + random() * 0.25);
    out.push({
      position: new THREE.Vector3(x, ground + sy * (0.25 + random() * 0.2), z),
      scale: new THREE.Vector3(size, sy, size * (0.75 + random() * 0.3)),
      rotation: new THREE.Euler((random() - 0.5) * 0.15, random() * Math.PI * 2, (random() - 0.5) * 0.15),
      color: grey(random, 0.32),
      ground,
      variant: i % ROCK_VARIANTS,
      cluster: 100 + i,
      jointYaw: 0,
    });
  }
  return out;
}
