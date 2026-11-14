import test from 'node:test';
import assert from 'node:assert/strict';
import { rockLayout } from '../src/rocks.js';
import { placeRocks } from '../src/place-rocks.js';
import { seededRandom } from '../src/random.js';
import { rockHang, rockBuried } from './grounding.js';

// Every rock, the layout's and the landmarks' stones, sits in the ground:
// no underside hangs over the ground (a lit gap under a stone on a slope),
// none is buried past sense.
test('no rock floats or is swallowed by the ground, on any seed', () => {
  for (const seed of [1847, 1, 99999, 42, 7, 123456]) {
    const rocks = placeRocks(seed, rockLayout(seededRandom(seed)));
    const floating = rocks.filter((r) => rockHang(r) > 0.04);
    assert.deepEqual(floating.map((r) => `${r.position.x.toFixed(1)},${r.position.z.toFixed(1)} +${rockHang(r).toFixed(2)}`), [], `seed ${seed} floating rocks`);
    const buried = rocks.filter((r) => rockBuried(r) > 0.92);
    assert.equal(buried.length, 0, `seed ${seed}: ${buried.length} rocks buried`);
  }
});
