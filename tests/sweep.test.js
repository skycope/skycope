import test from 'node:test';
import assert from 'node:assert/strict';
import { sweep, startPoints } from './sweep.js';
import { placesLayout } from '../src/place-layout.js';
import { shoreDistance } from '../src/terrain.js';

// The trap sweep, coarse (the QA run uses 1.5 m / 0.75 m and eight
// headings): nowhere on the island or in the shallows does the cat end up
// unable to get a body length away walking or jumping, inside a solid,
// under the ground or standing on nothing.
for (const seed of [1847, 1, 99999]) {
  test(`no traps, no solids entered, nothing stood on air (seed ${seed})`, () => {
    const found = sweep(seed, { points: startPoints(seed, { step: 3, dense: 1.5 }), headings: 2, seconds: 1.5 });
    assert.deepEqual(found, []);
  });
}

// Denser round the landmarks (the coarse grid passes between a wreck
// frame's posts and a milkwood limb): 1 m starts within each place's reach,
// four headings, on the island everyone knows.
test('no traps round the landmarks at a 1 m grid (seed 1847)', () => {
  const points = [];
  for (const p of placesLayout(1847)) {
    const r = p.id === 'lighthouse' ? 16 : p.id === 'milkwood' ? 14 : 8;
    for (let x = p.x - r; x <= p.x + r; x += 1)
      for (let z = p.z - r; z <= p.z + r; z += 1)
        if (Math.hypot(x - p.x, z - p.z) <= r && shoreDistance(x, z) > -6) points.push({ x, z, near: p.id });
  }
  assert.deepEqual(sweep(1847, { points, headings: 4, seconds: 1.5 }), []);
});
