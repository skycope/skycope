import test from 'node:test';
import assert from 'node:assert/strict';
import { placesLayout, placeClearance, plantClear, PLACES_HOME } from '../src/place-layout.js';
import { placeRocks } from '../src/place-rocks.js';
import { rockLayout } from '../src/rocks.js';
import { seededRandom } from '../src/random.js';
import { shoreDistance, terrainHeight } from '../src/terrain.js';

const SEEDS = [1847, 1, 42, 7, 99999, 123456, 0xfffffff0];
const finite = (v) => typeof v === 'number' && Number.isFinite(v);

test('landmark layout is seed-stable and finite', () => {
  for (const seed of SEEDS) {
    const a = placesLayout(seed);
    assert.deepEqual(a, placesLayout(seed), `seed ${seed} reproduces`);
    assert.equal(a.length, 6);
    assert.deepEqual(a.map((p) => p.id).sort(), ['beacon', 'boat', 'lighthouse', 'milkwood', 'pool', 'wreck']);
    for (const p of a) {
      for (const k of ['x', 'z', 'y', 'r']) assert.ok(finite(p[k]), `${p.id}.${k} finite (seed ${seed})`);
      for (const k of ['ax', 'az', 'bx', 'bz', 'clear', 'bare']) assert.ok(finite(p.zone[k]), `${p.id}.zone.${k} finite`);
      assert.ok(p.r > 0 && p.zone.clear >= p.zone.bare);
      assert.equal(typeof p.title, 'string');
    }
  }
  assert.notDeepEqual(placesLayout(1847), placesLayout(42), 'the seed moves things');
});

test('landmarks sit where they belong: on land, at the shore, apart', () => {
  for (const seed of SEEDS) {
    const places = Object.fromEntries(placesLayout(seed).map((p) => [p.id, p]));
    const inland = (p) => shoreDistance(p.x, p.z);
    // The light is back from its point, the milkwood and beacon deep inland.
    assert.ok(inland(places.lighthouse) > 5 && inland(places.lighthouse) < 9, `lighthouse ${inland(places.lighthouse)}`);
    assert.ok(inland(places.milkwood) > 20, `milkwood ${inland(places.milkwood)}`);
    assert.ok(inland(places.beacon) > 20, `beacon ${inland(places.beacon)}`);
    // The beacon is on one of the island's highest summits.
    assert.ok(terrainHeight(places.beacon.x, places.beacon.z) > 11);
    // Shore places: the wreck above the tide (bow up the beach), the
    // boat is above the tide line, the pool at the top of the shore.
    assert.ok(inland(places.wreck) > 3 && inland(places.wreck) < 6, `wreck centre ${inland(places.wreck)}`);
    assert.ok(shoreDistance(places.wreck.stern.x, places.wreck.stern.z) > 1.2, 'the wreck lies above the tide line');
    assert.ok(shoreDistance(places.wreck.bow.x, places.wreck.bow.z) > shoreDistance(places.wreck.stern.x, places.wreck.stern.z));
    assert.ok(inland(places.boat) > 4 && inland(places.boat) < 9, `boat ${inland(places.boat)}`);
    assert.ok(inland(places.pool) > 0.5 && inland(places.pool) < 3, `pool ${inland(places.pool)}`);
    // Apart from one another, and off the cat's landing beach.
    const list = Object.values(places);
    for (let i = 0; i < list.length; i++) {
      assert.ok(Math.hypot(list[i].x - PLACES_HOME.x, list[i].z - PLACES_HOME.z) > 18, `${list[i].id} clear of home`);
      for (let j = i + 1; j < list.length; j++) {
        const d = Math.hypot(list[i].x - list[j].x, list[i].z - list[j].z);
        assert.ok(d > 17, `${list[i].id}–${list[j].id} ${d.toFixed(1)} m apart (seed ${seed})`);
      }
    }
  }
});

test('nothing grows or lies inside a landmark', () => {
  const seed = 1847;
  const layout = placesLayout(seed);
  for (const p of layout) {
    assert.ok(placeClearance(layout, p.x, p.z) < 0, `${p.id} centre is inside its zone`);
    assert.equal(plantClear(seed, 'tree', p.x, p.z, 6), false);
    assert.equal(plantClear(seed, 'grass', p.x, p.z), false);
  }
  assert.ok(placeClearance(layout, -500, -500) > 100);
  const original = rockLayout(seededRandom(seed));
  const rocks = placeRocks(seed, original);
  const added = rocks.filter((r) => !original.includes(r));
  assert.ok(added.length > 20, 'cairn and pool stones are added');
  for (const r of rocks) {
    assert.ok([r.position.x, r.position.y, r.position.z, r.scale.x, r.scale.y, r.scale.z, r.ground].every(finite));
  }
  // Scattered boulders are kept out of every zone.
  const scattered = rocks.filter((r) => original.includes(r));
  assert.ok(scattered.length > 150 && scattered.length < original.length);
  for (const r of scattered) assert.ok(placeClearance(layout, r.position.x, r.position.z, 'clear') > 0);
});
