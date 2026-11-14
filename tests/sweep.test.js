import test from 'node:test';
import assert from 'node:assert/strict';
import { sweep, startPoints } from './sweep.js';

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
