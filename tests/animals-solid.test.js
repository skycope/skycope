import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createForest } from '../src/forest.js';
import { createWildlife } from '../src/wildlife.js';
import { createWalker } from '../src/walker.js';
import { primitiveDistance } from '../src/blockers.js';

// The cat among the animals: it walks, runs and jumps through the penguin
// colony and at the seals; it is never inside an animal, penguins step
// aside out of its way, and no two animals overlap.
test('animals are solid to the cat and to each other', () => {
  const land = new THREE.Group();
  const forest = createForest(land, 1847, {});
  const wild = createWildlife(land, 1847, { obstacles: forest.obstacles });
  forest.obstacles.bodies = wild.bodies;
  const walker = createWalker(forest.obstacles);
  const { cat } = walker;
  const pose = { x: 0, z: 0, y: 0, speed: 0, air: 0, sit: 0, swim: 0, heading: 0 };
  let time = 0, worstInside = 0, worstOverlap = 0;
  const step = (input) => {
    walker.update(1 / 30, input, null);
    Object.assign(pose, { x: cat.x, z: cat.z, y: cat.y, speed: cat.speed, air: cat.air, heading: cat.heading });
    time += 1 / 30;
    wild.update({ dt: 1 / 30, time, night: 0, wind: [2, 1], pose, water: null, eye: { x: cat.x, y: cat.y + 2, z: cat.z } });
    for (const b of wild.bodies) {
      if (b.live === false) continue;
      worstInside = Math.min(worstInside, primitiveDistance(b, cat.x, cat.y + 0.17, cat.z) + 0.12);
    }
    const birds = wild.penguins.birds.filter((b) => b.swim < 0.5);
    for (let i = 0; i < birds.length; i++)
      for (let j = i + 1; j < birds.length; j++)
        worstOverlap = Math.max(worstOverlap, 0.3 - Math.hypot(birds[i].x - birds[j].x, birds[i].z - birds[j].z));
  };
  for (const target of [wild.penguins.centre, wild.seals.rock]) {
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + 0.3;
      cat.x = target.x + Math.sin(a) * 6; cat.z = target.z + Math.cos(a) * 6; cat.y = walker.surface(cat.x, cat.z);
      cat.heading = a + Math.PI; walker.camera.yaw = cat.heading; cat.speed = cat.vy = cat.air = 0;
      for (let f = 0; f < 150; f++) step({ move: [0, 1], run: k % 2 === 1, jump: k === 2 && f % 25 === 3 });
    }
  }
  assert.ok(worstInside > -0.06, `the cat was ${(-worstInside).toFixed(2)} m inside an animal`);
  assert.ok(worstOverlap < 0.06, `two penguins overlapped by ${worstOverlap.toFixed(2)} m`);
});
