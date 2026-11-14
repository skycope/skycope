// The trap sweep (tests/sweep.test.js and QA): drop the cat all over the
// island and the shallows, drive it about, and list every place it ends up
// unable to get away from, inside a solid, under the ground or standing on
// nothing.
import { island, walkerFor } from './interaction-harness.js';
import { groundHeight, shoreDistance, ISLAND } from '../src/terrain.js';
import { primitiveDistance } from '../src/blockers.js';
import { SWIM_LIMIT } from '../src/walker.js';

const DT = 1 / 30;
const BODY = 0.35;

function place(walker, x, z, heading) {
  const { cat, camera } = walker;
  cat.x = x; cat.z = z; cat.y = walker.surface(x, z);
  cat.heading = heading; camera.yaw = heading;
  cat.speed = cat.vy = cat.air = cat.turn = 0; cat.sit = cat.idle = 0;
  cat.swim = cat.wade = cat.water = 0;
}

function drive(walker, heading, seconds, jump = false) {
  const { cat } = walker;
  const x0 = cat.x, z0 = cat.z;
  let worst = null;
  const frames = Math.round(seconds / DT);
  for (let f = 0; f < frames; f++) {
    walker.update(DT, { move: [0, 1], run: false, jump: jump && f % 20 === 2 }, null);
    worst ??= wrong(walker);
  }
  return { moved: Math.hypot(cat.x - x0, cat.z - z0), worst };
}

// What is physically wrong where the cat is now, or null.
function wrong(walker) {
  const { cat, solids } = walker;
  const s = walker.surface(cat.x, cat.z);
  if (cat.y < groundHeight(cat.x, cat.z) - 0.05 && cat.water <= 0) return 'below terrain';
  if (cat.air === 0 && cat.water <= 0 && cat.y > s + 0.04) return 'on nothing';
  for (const q of solids.list) {
    if (q.body === false) continue;
    if (Math.abs(q.x - cat.x) > q.r + 0.5 || Math.abs(q.z - cat.z) > q.r + 0.5) continue;
    if (primitiveDistance(q, cat.x, cat.y + 0.17, cat.z) < -0.06) return 'inside solid';
  }
  return null;
}

// Can the cat get a body length away from where it stands, walking or
// jumping, in some direction?
function escapes(walker) {
  const { cat } = walker;
  const x = cat.x, z = cat.z;
  for (const jump of [false, true])
    for (let k = 0; k < 8; k++) {
      place(walker, x, z, (k / 8) * Math.PI * 2);
      if (drive(walker, (k / 8) * Math.PI * 2, 1.2, jump).moved > BODY) return true;
    }
  return false;
}

// Start points: a grid over the island and its shallows, and denser rings
// round every landmark, boulder cluster and the animals' homes.
export function startPoints(seed, { step = 1.5, dense = 0.75 } = {}) {
  const { places, rocks } = island(seed);
  const out = [];
  for (let x = ISLAND.x - 80; x <= ISLAND.x + 80; x += step)
    for (let z = ISLAND.z - 80; z <= ISLAND.z + 80; z += step) {
      const d = shoreDistance(x, z);
      if (d < -6 || d > 200) continue;
      out.push({ x, z, near: 'island' });
    }
  const features = places.layout.map((p) => ({ x: p.x, z: p.z, r: (p.r ?? 6) * 0.8 + 3, id: p.id }));
  for (const r of rocks) if (Math.max(r.scale.x, r.scale.z) > 0.8) features.push({ x: r.position.x, z: r.position.z, r: Math.max(r.scale.x, r.scale.z) + 2, id: 'boulder' });
  for (const f of features)
    for (let x = f.x - f.r; x <= f.x + f.r; x += dense)
      for (let z = f.z - f.r; z <= f.z + f.r; z += dense)
        if (Math.hypot(x - f.x, z - f.z) <= f.r && shoreDistance(x, z) > -6) out.push({ x, z, near: f.id });
  return out;
}

export function sweep(seed, { points = startPoints(seed), headings = 8, seconds = 1.5 } = {}) {
  const { places, obstacles } = island(seed);
  const walker = walkerFor(seed);
  const found = [];
  const seen = new Set();
  const report = (x, z, kind, near) => {
    const key = `${kind}:${Math.round(x)},${Math.round(z)}`;
    if (seen.has(key)) return;
    seen.add(key);
    const nearest = places.layout.map((p) => ({ id: p.id, d: Math.hypot(p.x - x, p.z - z) })).sort((a, b) => a.d - b.d)[0];
    const trunk = obstacles.trunks.find((t) => Math.hypot(t.x - x, t.z - z) < t.r + 0.6);
    found.push({ kind, x: +x.toFixed(2), z: +z.toFixed(2), near, place: `${nearest.id} ${nearest.d.toFixed(1)} m`, trunk: trunk ? `trunk r${trunk.r.toFixed(2)}` : '' });
  };
  for (const p of points) {
    const s = walker.surface(p.x, p.z);
    // Not a place a cat can be: inside a trunk, a solid, or past the kelp.
    if (shoreDistance(p.x, p.z) < -SWIM_LIMIT) continue;
    if (obstacles.trunks.some((t) => Math.abs(t.x - p.x) < t.r + 0.2 && Math.abs(t.z - p.z) < t.r + 0.2 && Math.hypot(t.x - p.x, t.z - p.z) < t.r + 0.17)) continue;
    if (walker.solids.distance(p.x, s + 0.17, p.z, 1) < 0.17) continue;
    for (let k = 0; k < headings; k++) {
      const h = (k / headings) * Math.PI * 2 + (p.x * 0.37 + p.z * 0.11);
      place(walker, p.x, p.z, h);
      const r = drive(walker, h, seconds, k % 2 === 1);
      if (r.worst) report(walker.cat.x, walker.cat.z, r.worst, p.near);
      const { x, z } = walker.cat;
      if (r.moved < BODY && !escapes(walker)) report(x, z, 'trap', p.near);
    }
  }
  return found;
}
