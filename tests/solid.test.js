import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createPlaces } from '../src/places.js';
import { createWalker } from '../src/walker.js';
import { box, cylinder, capsule, roof, createBlockers, primitiveDistance } from '../src/blockers.js';
import { groundHeight } from '../src/terrain.js';
import { buildLighthouse } from '../src/place-lighthouse.js';
import { createMaterials } from '../src/place-kit.js';
import { placesLayout } from '../src/place-layout.js';

const SEEDS = [1847, 1, 99999];
const NO_INPUT = { move: [0, 0], run: false, jump: false };

test('blocker primitives are signed distances', () => {
  const b = box(0, 0, 0.3, 1, 0.5, 0, 2);
  assert.ok(primitiveDistance(b, 0, 1, 0) < 0);
  assert.ok(Math.abs(primitiveDistance(b, 0, 3, 0) - 1) < 1e-9);
  const c = cylinder(5, 5, 1, 0, 1);
  assert.ok(Math.abs(primitiveDistance(c, 7, 0.5, 5) - 1) < 1e-9);
  const k = capsule({ x: 0, y: 0, z: 0 }, { x: 0, y: 2, z: 0 }, 0.5);
  assert.ok(Math.abs(primitiveDistance(k, 1, 1, 0) - 0.5) < 1e-9);
  const r = roof(0, 0, 1, 2, new Float32Array([1, Infinity, 1, 1]), new Float32Array([3, -Infinity, 3, 3]));
  assert.ok(primitiveDistance(r, 0.5, 2, 0.5) < 0, 'inside the crown');
  assert.ok(primitiveDistance(r, 1.5, 2, 0.5) > 0, 'open cell');
  // A trace stops short of a wall and says which it was.
  const solids = createBlockers([b]);
  const f = solids.trace(-5, 1, 0, 5, 1, 0, 0.3);
  assert.ok(f > 0.3 && f < 0.5, `trace ${f}`);
  assert.equal(solids.hit.prim, b);
  assert.equal(solids.trace(-5, 5, 0, 5, 5, 0, 0.3), 1, 'clear above it');
});

// The places alone (no forest): their trunks, tiles and solids.
function placesWalker(seed) {
  const places = createPlaces(new THREE.Group(), seed, { shared: {} });
  const obstacles = { trunks: places.obstacles.trunks, domes: places.obstacles.domes, blockers: places.blockers };
  return { places, walker: createWalker(obstacles) };
}

test('the camera never ends up inside a landmark, orbiting or walking round it', () => {
  for (const seed of SEEDS) {
    const { places, walker } = placesWalker(seed);
    const { cat, camera, solids } = walker;
    for (const p of places.layout) {
      let worst = Infinity, where = "";
      for (const ring of [p.r * 0.45, p.r * 0.8, p.r * 1.2]) {
        for (let k = 0; k < 16; k++) {
          const a = (k / 16) * Math.PI * 2;
          cat.x = p.x + Math.sin(a) * ring;
          cat.z = p.z + Math.cos(a) * ring;
          cat.y = walker.surface(cat.x, cat.z);
          cat.speed = cat.vy = cat.air = 0;
          // Somewhere a cat can be: not inside a wall or on a roof.
          if (solids.distance(cat.x, cat.y + 0.3, cat.z, 1) < 0.1 || cat.y > groundHeight(cat.x, cat.z) + 0.5) continue;
          // Camera on the landmark's side, low and far: the case that clipped.
          camera.yaw = a;
          camera.elevation = 0.2;
          camera.distance = 5;
          camera.targetY = cat.y;
          for (let f = 0; f < 40; f++) {
            walker.update(1 / 30, NO_INPUT, null);
            // Swing the camera round as a viewer dragging would.
            if (f > 20) walker.orbit(0.06, 0);
            const d = solids.distance(camera.x, camera.y, camera.z, 1);
            if (d < worst) {
              worst = d;
              where = `cat ${cat.x.toFixed(1)},${cat.y.toFixed(1)},${cat.z.toFixed(1)} lens ${camera.x.toFixed(1)},${camera.y.toFixed(1)},${camera.z.toFixed(1)} k${solids.hit.prim?.k} frame ${f}`;
            }
          }
        }
      }
      assert.ok(worst > 0.02, `seed ${seed} ${p.id}: lens ${worst.toFixed(3)} m inside a solid: ${where}`);
    }
  }
});

test('the cat cannot walk through the keeper\'s tank or into the cottage', () => {
  for (const seed of SEEDS) {
    const { places, walker } = placesWalker(seed);
    const { cat, solids } = walker;
    const p = places.layout.find((q) => q.kind === 'lighthouse');
    // Walk straight at the tower from all round: never inside a body solid.
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      cat.x = p.x + Math.sin(a) * 9;
      cat.z = p.z + Math.cos(a) * 9;
      cat.y = walker.surface(cat.x, cat.z);
      cat.heading = a + Math.PI;
      walker.camera.yaw = a + Math.PI;
      if (cat.y > groundHeight(cat.x, cat.z) + 0.5) continue; // started on the roof
      for (let f = 0; f < 150; f++) {
        walker.update(1 / 30, { move: [0, 1], run: false, jump: false }, null);
        const body = solids.list.filter((q) => q.body !== false);
        for (const q of body) {
          const d = primitiveDistance(q, cat.x, cat.y + 0.17, cat.z);
          assert.ok(d > -0.05, `seed ${seed}: cat inside a solid (${d.toFixed(2)}) walking in from ${k}: k${q.k} body ${q.body} at ${q.x.toFixed(1)},${q.z.toFixed(1)} y ${q.y0.toFixed(1)}..${q.y1.toFixed(1)} cat ${cat.x.toFixed(2)},${cat.y.toFixed(2)},${cat.z.toFixed(2)} frame ${f}`);
        }
      }
    }
  }
});

test('the lighthouse foundations reach into the ground at every footprint corner', () => {
  const materials = createMaterials({});
  for (const seed of SEEDS) {
    const p = placesLayout(seed).find((q) => q.kind === 'lighthouse');
    const built = buildLighthouse(p, materials, { seed });
    // Every upright solid (plinth, cottage, tank, wall runs) starts below
    // the ground all round its footprint.
    for (const b of built.surfaces.solids) {
      if (b.k === 2 || b.k === 3 || b.above) continue;
      const corners = [];
      if (b.k === 1) for (let i = 0; i < 12; i++) corners.push([b.x + Math.cos(i / 2) * b.rad, b.z + Math.sin(i / 2) * b.rad]);
      else for (const su of [-1, 1]) for (const sv of [-1, 1]) corners.push([b.x + b.ux * b.hu * su + b.uz * b.hv * sv, b.z + b.uz * b.hu * su - b.ux * b.hv * sv]);
      for (const [x, z] of corners) {
        assert.ok(b.y0 < groundHeight(x, z) + 0.01, `seed ${seed}: footing ${(b.y0 - groundHeight(x, z)).toFixed(2)} m above the ground`);
      }
    }
  }
});
