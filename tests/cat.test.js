import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createForest } from "../src/forest.js";
import { createCat } from "../src/cat.js";
import { createCritters } from "../src/critters.js";
import { createWalker } from "../src/walker.js";
import { groundHeight, shoreDistance } from "../src/terrain.js";

// The cat's world builds without WebGL: walk, run, jump and turn for ten
// seconds and check it stays on land, on the ground, and leaves prints.
test("the cat walks the island", () => {
  const land = new THREE.Group();
  land.scale.z = -1;
  const forest = createForest(land, 1847);
  const cat = createCat(land);
  const critters = createCritters(land, 1847, forest.obstacles.flowers);
  const walker = createWalker(forest.obstacles);
  let steps = 0;
  for (let i = 0; i < 600; i++) {
    const pose = walker.update(1 / 60, { move: [i > 300 ? 1 : 0, 1], run: i > 400, jump: i === 200 }, null);
    cat.update(pose, 1 / 60, i / 60, walker.surface, () => steps++, { night: 0, direct: 1, sunX: 0, sunZ: 0 });
    critters.update(1 / 60, i / 60, pose, 0);
    for (const v of [pose.x, pose.y, pose.z, walker.camera.x, walker.camera.y, walker.camera.pitch])
      assert.ok(Number.isFinite(v), `finite at frame ${i}`);
  }
  const c = walker.cat;
  assert.ok(shoreDistance(c.x, c.z) > 0.3, "stays out of the sea");
  assert.ok(c.y >= groundHeight(c.x, c.z) - 1e-6, "not under the ground");
  assert.ok(steps > 10, `paws land (${steps})`);
  assert.ok(walker.camera.y > c.y, "camera above the cat");
});
