import test from 'node:test';
import assert from 'node:assert/strict';
import { rockGeometry, rockLayout, shoreRockData, ROCK_VARIANTS, ROCK_CORE, SHORE_ROCK_FLOATS } from '../src/rocks.js';
import { terrainHeight } from '../src/terrain.js';

const random = (seed) => () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };

test('jointed rock LODs remain finite inside reflection bounds', () => {
  for (let variant = 0; variant < ROCK_VARIANTS; variant++) for (const detail of [1, 2, 3, 5, 9, 16]) {
    const g = rockGeometry(detail, variant);
    const p = g.attributes.position, n = g.attributes.normal;
    for (let i = 0; i < p.count; i++) {
      const r = Math.hypot(p.getX(i), p.getY(i), p.getZ(i));
      assert.ok(r <= 1.00001);
      // rock_hides (rocks.wgsl) treats a 0.7 core as solid above the foot.
      if (p.getY(i) / r > -0.4) assert.ok(r >= ROCK_CORE - 1e-6);
      assert.ok([n.getX(i), n.getY(i), n.getZ(i)].every(Number.isFinite));
    }
    g.dispose();
  }
});

test('outcrop fragments inherit bedding and shoreline descriptors follow geometry', () => {
  const rocks = rockLayout(random(1847));
  assert.deepEqual(rocks, rockLayout(random(1847)));
  const groups = new Map();
  for (const rock of rocks.slice(230)) {
    const expected = groups.get(rock.cluster);
    if (expected) assert.equal(rock.jointYaw, expected);
    else groups.set(rock.cluster, rock.jointYaw);
    assert.ok(Math.abs(rock.rotation.y - rock.jointYaw) < .12);
    assert.ok(rock.position.y - rock.scale.y * .6 < rock.ground, 'base embedded in the sand or the stone below');
    assert.ok(rock.ground >= Math.max(terrainHeight(rock.position.x, rock.position.z), -.6) - 1e-9);
  }
  // Scattered stones share one shape per 20 m ground chunk (one draw each).
  const cells = new Map();
  for (const rock of rocks.slice(0, 230)) {
    const key = `${Math.floor(rock.position.x / 20)},${Math.floor(rock.position.z / 20)}`;
    if (cells.has(key)) assert.equal(rock.variant, cells.get(key));
    else cells.set(key, rock.variant);
  }
  assert.ok(new Set(cells.values()).size > 2, 'scattered stones use several shapes');
  const shore = shoreRockData(rocks);
  assert.ok(shore.count > 0);
  assert.ok([...shore.rocks].every(Number.isFinite));
  for (let i = 0; i < shore.count; i++) {
    const base = i * SHORE_ROCK_FLOATS;
    const outline = shore.rocks.slice(base + 16, base + 32);
    assert.ok(Math.max(...outline) <= shore.rocks[base + 36 + 3] * 1.01, 'waterline lies within bounding sphere');
  }
});

