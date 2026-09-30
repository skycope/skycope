import test from 'node:test';
import assert from 'node:assert/strict';
import { foliageDemand, demandRadius } from '../src/plant-growth.js';
import { createHabitat, sampleHabitat, groundProducers } from '../src/habitat.js';
import { vegetationLayout, createVegetation } from '../src/vegetation.js';

test('terminal demand and pipe radii ignore segmentation and conserve fork area', () => {
  const a = foliageDemand([-1, 0, 0], [0, 2, 3]);
  const b = foliageDemand([-1, 0, 1, 1], [0, 0, 2, 3]);
  assert.deepEqual([...a], [5, 2, 3]);
  assert.equal(a[0], b[0]);
  assert.equal(demandRadius(a[0], .1), demandRadius(b[1], .1));
  const radii = [...a].map(d => demandRadius(d, .1));
  assert.ok(Math.abs(radii[0] ** 2 - radii[1] ** 2 - radii[2] ** 2) < 1e-12);
});

test('habitat caches regional identity and preserves producer roles', () => {
  const layout = [{ kind: 'tree', id: 'a', x: 12, z: 12, height: 8 }, { kind: 'restio', id: 'b', x: 15, z: 13, height: 1 }];
  const habitat = createHabitat(1847, layout);
  const a = sampleHabitat(habitat, 12, 12), b = sampleHabitat(habitat, 13, 13);
  assert.equal(a.id, b.id);
  assert.equal(habitat.regions.size, 1);
  assert.ok(a.light > 0 && a.light <= 1);
  assert.ok(a.competition > 0);
  const producers = groundProducers(layout);
  assert.ok(producers[0].roots > 0);
  assert.equal(producers[1].roots, 0);
  assert.ok(producers[1].thatch > producers[0].thatch);
});

test('community layout is deterministic and includes intermediate layers', () => {
  const a = vegetationLayout(1847), b = vegetationLayout(1847);
  assert.deepEqual(a, b);
  assert.ok(a.some(p => p.kind === 'restio' && p.height > .5));
  assert.ok(a.some(p => p.kind === 'shrub' && p.height > 1));
  assert.ok(new Set(a.map(p => p.patchId)).size > 10);
  assert.equal(new Set(a.map(p => p.id)).size, a.length);
});

test('generated plants have finite bounded geometry and stable organ identities', () => {
  const plants = createVegetation(1847);
  assert.ok(plants.clusters.length < 216129);
  const ids = new Set();
  for (const list of [plants.wood, plants.clusters, plants.turf, plants.fronds, plants.succulents, plants.needles, plants.reeds]) {
    for (const organ of list) {
      assert.ok(organ.id && !ids.has(organ.id));
      ids.add(organ.id);
      assert.ok([organ.position.x, organ.position.y, organ.position.z, organ.scale.x, organ.scale.y, organ.scale.z].every(Number.isFinite));
      assert.ok(organ.scale.x > 0 && organ.scale.y > 0 && organ.scale.z > 0);
    }
  }
  assert.equal(plants.producers.length, groundProducers(plants.layout).length);
  // Turf keeps its full sward: no candidates are thinned out of open ground.
  assert.ok(plants.turf.length > 15000);
});

test('reed LOD preserves culm identity and positions when spikelets disappear', async () => {
  const { reedGeometry } = await import('../src/plant-forms.js');
  const near = reedGeometry(12, 1), far = reedGeometry(12, 0);
  assert.deepEqual(near.userData.organIds, far.userData.organIds);
  const a = near.getAttribute('position'), b = far.getAttribute('position');
  // Every far tip is a near tip, despite removing branch-specific geometry.
  for (let i = 2; i < b.count; i += 3) {
    assert.ok(Array.from({ length: a.count }, (_, j) => j).some(j =>
      a.getX(j) === b.getX(i) && a.getY(j) === b.getY(i) && a.getZ(j) === b.getZ(i)));
  }
  near.dispose(); far.dispose();
});

