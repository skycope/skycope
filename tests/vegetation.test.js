import assert from "node:assert/strict";
import { test } from "node:test";
import { vegetationLayout, createVegetation } from "../src/vegetation.js";
import { shoreline } from "../src/terrain.js";

test("seeded habitats contain multiple growth layers without planting in the sea", () => {
  for (const seed of [1, 1847, 4294967295]) {
    const plants = vegetationLayout(seed);
    assert.deepEqual(
      new Set(plants.map((p) => p.kind)),
      new Set(["tree", "fern", "shrub", "grass"]),
    );
    assert.ok(new Set(plants.map((p) => p.ecotype)).size >= 3);
    assert.ok(plants.every((p) => p.x > shoreline(p.z) && p.height > 0));
    assert.deepEqual(plants, vegetationLayout(seed));
    assert.notDeepEqual(plants, vegetationLayout(seed + 1));
  }
});

test("procedural growth stays finite and within the instancing budget", () => {
  const plants = createVegetation(1847);
  assert.ok(plants.wood.length < 100000);
  assert.ok(plants.leaves.length < 350000);
  for (const instance of [...plants.wood, ...plants.leaves]) {
    assert.ok(instance.position.toArray().every(Number.isFinite));
    assert.ok(
      instance.scale.toArray().every((v) => Number.isFinite(v) && v > 0),
    );
  }
});
