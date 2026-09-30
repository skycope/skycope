import test from "node:test";
import assert from "node:assert/strict";
import { groundDetailData } from "../src/ground-detail.js";
import { groundHeight, terrainHeight, islandPoint, shoreDistance, smoothstep, noise2 } from "../src/terrain.js";

test("ground relief preserves the beach and has bounded inland height", () => {
  let changed = 0;
  for (let angle = 0; angle < 6.28; angle += .21) for (const inland of [1, 3, 5, 8, 15, 30]) {
    const { x, z } = islandPoint(angle, inland), d = shoreDistance(x, z);
    const original = Math.min(d, 5) * .075 + smoothstep(4, 28, d) * (4 + noise2(x * .033, z * .026) * 9 + noise2(x * .08, z * .07) * 1.2);
    const delta = terrainHeight(x, z) - original;
    assert.ok(Math.abs(delta) <= .205 + 1e-10);
    if (inland <= 5) assert.ok(Math.abs(delta) < 1e-10);
    else changed += Math.abs(delta) > .005;
  }
  assert.ok(changed > 30, "relief changes actual contact geometry inland");
});

test("opaque debris is seed-stable, grounded and respects both quality budgets", () => {
  const p = islandPoint(-2.2, 18);
  const producers = Array.from({length: 1900}, (_, i) => ({ id: `plant-${i}`, seed: i * 71, kind: "tree", x: p.x + i % 12 * .1, z: p.z + i % 10 * .1, height: 8, radius: 2, litter: 1 }));
  const a = groundDetailData(1847, producers), b = groundDetailData(1847, producers);
  assert.deepEqual(a, b);
  const light = groundDetailData(1847, producers, { light: true });
  for (const [name, cap] of Object.entries({leaves: 4600, twigs: 2200, roots: 1400, stones: 1600})) {
    assert.ok(a[name].length <= cap);
    assert.ok(light[name].length <= cap / 2);
    for (const part of a[name]) {
      assert.ok([...part.position, ...part.scale, part.rotation.x, part.rotation.y, part.rotation.z].every(Number.isFinite));
      assert.ok(part.scale.x > 0 && part.scale.y > 0 && part.scale.z > 0);
      assert.equal(part.ground, groundHeight(part.position.x, part.position.z));
      assert.ok(part.position.y >= part.ground);
    }
  }
  assert.ok(a.roots.every(p => p.scale.x <= .025));
  assert.notDeepEqual(a.stones, groundDetailData(1848, producers).stones);
});
