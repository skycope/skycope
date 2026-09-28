import assert from "node:assert/strict";
import { test } from "node:test";
import { vegetationLayout, createVegetation } from "../src/vegetation.js";
import { shoreDistance } from "../src/terrain.js";

test("seeded habitats contain multiple growth layers without planting in the sea", () => {
  for (const seed of [1, 1847, 4294967295]) {
    const plants = vegetationLayout(seed);
    assert.deepEqual(
      new Set(plants.map((p) => p.kind)),
      new Set([
        "tree",
        "fern",
        "shrub",
        "grass",
        "moss",
        "protea",
        "aloe",
        "restio",
        "erica",
        "daisies",
      ]),
    );
    assert.ok(new Set(plants.map((p) => p.ecotype)).size >= 3);
    assert.ok(
      plants.every((p) => shoreDistance(p.x, p.z) > 0 && p.height > 0),
    );
    // Coastal exposure keeps canopy interior: no full-height tree at the edge.
    const trees = plants.filter((p) => p.kind === "tree");
    assert.ok(trees.some((p) => p.form === "snag" || p.form === "sapling"));
    assert.ok(
      trees.every((p) => shoreDistance(p.x, p.z) > 12 || p.interior < 0.6),
    );
    assert.deepEqual(plants, vegetationLayout(seed));
    assert.notDeepEqual(plants, vegetationLayout(seed + 1));
  }
});

test("procedural growth stays finite and within the instancing budget", () => {
  const plants = createVegetation(1847);
  // Denser groves, six-segment trunks and root flares; LOD keeps draw cost bounded.
  assert.ok(plants.wood.length < 160000);
  assert.ok(plants.leaves.length < 120000);
  assert.ok(plants.clusters.length > 10000 && plants.clusters.length < 250000);
  assert.ok(plants.turf.length > 3000 && plants.turf.length < 30000);
  // Every plant part is anchored to its own ground height.
  assert.ok([...plants.wood, ...plants.clusters, ...plants.turf].every((p) => Number.isFinite(p.ground)));
  // Fynbos flowers are present in every family, and stay within budget.
  for (const kind of ["daisy", "protea", "pincushion", "spike", "bell"])
    assert.ok(plants.flowers[kind].length > 0, `${kind} flowers`);
  const flowers = Object.values(plants.flowers).flat();
  assert.ok(flowers.length < 40000);
  for (const instance of [
    ...plants.wood,
    ...plants.leaves,
    ...plants.clusters,
    ...flowers,
  ]) {
    assert.ok(instance.position.toArray().every(Number.isFinite));
    assert.ok(
      instance.scale.toArray().every((v) => Number.isFinite(v) && v > 0),
    );
  }
});
