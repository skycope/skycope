import test from 'node:test';
import assert from 'node:assert/strict';
import { island, walkerFor, run } from './interaction-harness.js';
import { createPlaces } from '../src/places.js';
import { createWalker } from '../src/walker.js';
import * as THREE from 'three';

const SEEDS = [1847, 1, 99999];

// Walk, run and jump at every landmark from eight sides: the cat is never
// inside a body solid, never floats above or sinks below what it stands on,
// is never flung.
test('the cat meets every landmark solidly: walking, running and jumping at it', () => {
  for (const seed of SEEDS) {
    const { places } = island(seed);
    const walker = walkerFor(seed);
    for (const p of places.layout) {
      const ring = { lighthouse: 11, wreck: 6, milkwood: 8, boat: 4, pool: 6, beacon: 4 }[p.id] ?? 5;
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        const from = { x: p.x + Math.sin(a) * ring, z: p.z + Math.cos(a) * ring };
        for (const mode of [{ runs: true }, { jumps: [0.6, 1.4, 2.2] }]) {
          const r = run(walker, { from, heading: a + Math.PI, seconds: 3, ...mode });
          assert.deepEqual(r.problems.slice(0, 2), [], `seed ${seed} ${p.id} from ${k} ${JSON.stringify(mode)}`);
        }
      }
    }
  }
});

// Low things are surfaces: a jump lands on top of a crayfish trap and the
// cat stands at the trap's height, not inside it or on the sand under it.
test('a cat jumping onto a crayfish trap stands on it', () => {
  const walker = walkerFor(1847);
  const { places } = island(1847);
  const boat = places.layout.find((p) => p.id === 'boat');
  // The traps' tiles: the boat's domes past the hull's.
  const traps = island(1847).obstacles.domes.filter((d) => Math.hypot(d.x - boat.x, d.z - boat.z) < 4 && d.r < 0.6);
  assert.ok(traps.length >= 2, 'trap tiles');
  for (const t of traps) {
    // (A stack: the top trap's.)
    const top = Math.max(...traps.filter((u) => Math.hypot(u.x - t.x, u.z - t.z) < 0.1).flatMap((u) => [...u.heights]));
    assert.ok(Math.abs(walker.surface(t.x, t.z) - top) < 0.02, 'standing height is the trap top');
  }
  // Jump at the lone trap from a metre off: the cat ends on it or past it,
  // never inside its footprint below its top.
  const lone = traps.find((t) => traps.filter((u) => Math.hypot(u.x - t.x, u.z - t.z) < 0.1).length === 1);
  const top = Math.max(...lone.heights);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const r = run(walker, { from: { x: lone.x + Math.sin(a) * 1.2, z: lone.z + Math.cos(a) * 1.2 }, heading: a + Math.PI, seconds: 1.5, jumps: [0.2] });
    const e = r.end;
    if (Math.hypot(e.x - lone.x, e.z - lone.z) < 0.4) assert.ok(e.y > top - 0.03, `on the trap, not in it (${(e.y - top).toFixed(2)})`);
  }
});

// The launched hull leaves nothing behind: no camera solid, no standing tile.
test('the launched boat leaves no blocker and no tile on the beach', () => {
  for (const seed of SEEDS) {
    const land = new THREE.Group();
    const places = createPlaces(land, seed, { shared: {} });
    const boat = places.layout.find((p) => p.id === 'boat');
    const walker = createWalker({ trunks: places.obstacles.trunks, domes: places.obstacles.domes, blockers: places.blockers });
    const hullTop = walker.surface(boat.x, boat.z);
    assert.ok(hullTop > walker.surface(boat.x + 30, boat.z + 30) - 50, 'finite');
    places.boatHull.launch();
    // Along the keel line, the hull's solids are gone.
    for (let s = -2; s <= 2; s += 0.25) {
      const x = boat.x + Math.sin(boat.facing) * s, z = boat.z + Math.cos(boat.facing) * s;
      const d = walker.solids.distance(x, hullTop - 0.3, z, 1);
      assert.ok(d > 0.3, `seed ${seed}: a hull solid remains at ${s} (${d})`);
    }
    assert.ok(walker.surface(boat.x, boat.z) < hullTop - 0.3, `seed ${seed}: the hull's tile remains`);
  }
});
