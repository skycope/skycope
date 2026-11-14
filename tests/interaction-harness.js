// Shared by tests/interaction.test.js and QA scripts: the island's full
// collision (forest + landmarks) and a scripted cat that walks, runs and
// jumps at things, recording anything physically wrong.
import * as THREE from 'three';
import { createForest } from '../src/forest.js';
import { createPlaces } from '../src/places.js';
import { createWalker } from '../src/walker.js';
import { groundHeight } from '../src/terrain.js';
import { primitiveDistance } from '../src/blockers.js';

const cache = new Map();
export function island(seed) {
  if (cache.has(seed)) return cache.get(seed);
  const land = new THREE.Group();
  const forest = createForest(land, seed, {});
  const places = createPlaces(land, seed, { shared: land.userData.forestShared });
  const obstacles = {
    trunks: [...forest.obstacles.trunks, ...places.obstacles.trunks],
    domes: [...forest.obstacles.domes, ...places.obstacles.domes],
    blockers: places.blockers,
  };
  const out = { forest, places, obstacles, rocks: forest.rocks };
  cache.set(seed, out);
  return out;
}

// One scripted run: put the cat at `from` facing `heading`, then for
// `seconds` hold `move` (forward 0..1), `run`, and jump at the times in
// `jumps`. Returns the problems seen: inside a body solid or trunk,
// standing above or below the surface, flung (a step faster than a run).
export function run(walker, { from, heading, seconds = 4, move = 1, runs = false, jumps = [], dt = 1 / 60 }) {
  const { cat, camera, solids } = walker;
  cat.x = from.x; cat.z = from.z; cat.y = walker.surface(cat.x, cat.z);
  cat.heading = heading; camera.yaw = heading;
  cat.speed = cat.vy = cat.air = 0; cat.sit = 0; cat.idle = 0; cat.swim = cat.wade = cat.water = 0;
  const problems = [];
  const body = solids.list.filter((q) => q.body !== false);
  let t = 0, px = cat.x, pz = cat.z, travelled = 0;
  const jumpAt = jumps.map((j) => Math.round(j / dt));
  for (let f = 0; t < seconds; f++, t += dt) {
    walker.update(dt, { move: [0, move], run: runs, jump: jumpAt.includes(f) }, null);
    const step = Math.hypot(cat.x - px, cat.z - pz);
    travelled += step;
    if (step > 3.4 * 1.6 * dt + 0.02) problems.push({ kind: 'flung', t, step });
    px = cat.x; pz = cat.z;
    const s = walker.surface(cat.x, cat.z);
    if (cat.air === 0 && cat.water <= 0 && Math.abs(cat.y - s) > 0.03) problems.push({ kind: cat.y > s ? 'floating' : 'sunk', t, by: cat.y - s });
    if (cat.y < s - 0.05) problems.push({ kind: 'below surface', t, by: cat.y - s });
    for (const q of body) {
      const d = primitiveDistance(q, cat.x, cat.y + 0.17, cat.z);
      if (d < -0.08) problems.push({ kind: 'inside solid', t, d, at: [q.x, q.z] });
    }
  }
  return { problems, travelled, end: { x: cat.x, y: cat.y, z: cat.z } };
}

export function walkerFor(seed) {
  return createWalker(island(seed).obstacles);
}
export { groundHeight };
