import test from 'node:test';
import assert from 'node:assert/strict';
import { archipelagoLayout, archipelagoHit, archipelagoHorizonPossible, islandHeight, islandSpan, ARCHIPELAGO_BOUNDS, EXTENT_U, EXTENT_V, PEAK } from '../src/archipelago.js';
import { ISLAND } from '../src/terrain.js';

const direction = (origin, target) => { const d = target.map((v, c) => v - origin[c]); const l = Math.hypot(...d); return d.map((v) => v / l); };

test('archipelago is seeded, varied and bounded', () => {
  for (const seed of [0, 1, 1847, 31991, 65535]) {
    const islands = archipelagoLayout(seed);
    assert.deepEqual(islands, archipelagoLayout(seed));
    assert.ok(islands.length >= 4 && islands.length <= 5);
    assert.equal(new Set(islands.slice(0, 4).map((s) => s.biome)).size, 4, 'every biome appears');
    for (const s of islands) {
      assert.ok(s.distance >= ARCHIPELAGO_BOUNDS.minDistance && s.distance <= ARCHIPELAGO_BOUNDS.maxDistance);
      assert.ok(s.height * PEAK <= ARCHIPELAGO_BOUNDS.maxHeight);
      assert.ok(s.distance - s.radius > 150, 'clear of the home island');
      // Heights stay inside the box the tracer tests against.
      for (let k = 0; k < 400; k++) {
        const u = (k % 20 / 19 * 2 - 1) * EXTENT_U, v = (Math.floor(k / 20) / 19 * 2 - 1) * EXTENT_V;
        const c = Math.cos(s.yaw), n = Math.sin(s.yaw);
        const x = s.x + u * s.width * c - v * s.depth * n, z = s.z + u * s.width * n + v * s.depth * c;
        const h = islandHeight(s, x, z);
        assert.ok(h <= s.height * PEAK);
        if (Math.abs(u) === EXTENT_U || Math.abs(v) === EXTENT_V) assert.ok(h < 0, 'footprint edge is under water');
      }
    }
  }
  assert.notDeepEqual(archipelagoLayout(1847), archipelagoLayout(1));
});

test('rays toward each island hit its surface, and the horizon reject keeps them', () => {
  for (const seed of [1, 1847, 65535]) for (const origin of [[6, 4.5, 0], [200, 30, -100], [0, 250, 0]]) {
    for (const s of archipelagoLayout(seed)) {
      const top = islandHeight(s, s.x, s.z);
      if (top < 5) continue;
      const ray = direction(origin, [s.x, top * 0.4, s.z]);
      assert.ok(archipelagoHorizonPossible(origin, ray));
      assert.ok(islandSpan(s, origin, ray));
      const hit = archipelagoHit(origin, ray, seed);
      assert.ok(hit && hit.distance > 0 && Number.isFinite(hit.distance));
      assert.ok(Math.abs(Math.hypot(...hit.normal) - 1) < 1e-6);
    }
    assert.equal(archipelagoHorizonPossible(origin, [0, 1, 0]), false);
  }
});

test('straight down onto an island meets its height field', () => {
  const s = archipelagoLayout(1847)[0];
  const hit = archipelagoHit([s.x, 400, s.z], [0, -1, 0], 1847, 200);
  const h = islandHeight(s, s.x, s.z);
  if (h > 0) assert.ok(hit && Math.abs(hit.height - h) < 0.5);
  assert.equal(archipelagoHorizonPossible([ISLAND.x, 4.5, ISLAND.z], [0, -1, 0]), false);
});
