import * as THREE from "three";
import { terrainHeight, groundHeight } from "./terrain.js";
import { seededRandom } from "./random.js";
import { layoutFor, placeClearance } from "./place-layout.js";
import { ROCK_VARIANTS, bedHeight, bedRocks } from "./rocks.js";

// The landmarks' granite, in rocks.js's layout format so the forest draws,
// shades and collides with it like any boulder (the sea laps the waterline
// ones): scattered rocks are kept out of each landmark's zone, and the
// rock pool's boulders are added. (The beacon's cairn is cut stone now,
// place-shore.js: rounded boulders piled in courses hovered and read as a
// heap of river cobbles.)
export function placeRocks(seed, rocks) {
  const layout = layoutFor(seed);
  const kept = rocks.filter((r) => placeClearance(layout, r.position.x, r.position.z, "clear") > Math.max(r.scale.x, r.scale.z) * 0.8);
  const random = seededRandom((seed ^ 0x3c6ef372) >>> 0 || 1);
  for (const p of layout) {
    if (p.kind === "pool") kept.push(...poolBoulders(p, random));
  }
  // The pool's boulders bedded like any stone
  // (the layout's own are already).
  bedRocks(kept.filter((r) => !rocks.includes(r) && (r.cluster !== undefined || r.onGround)));
  return kept;
}

const grey = (random, l = 0.33) => new THREE.Color().setHSL(0.075 + random() * 0.02, 0.05 + random() * 0.03, l + (random() - 0.5) * 0.09);

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
    const ground = Math.max(bedHeight(x, z, size), -0.6);
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
