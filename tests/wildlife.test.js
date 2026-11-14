import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createForest } from "../src/forest.js";
import { createWildlife } from "../src/wildlife.js";
import { islandPoint, shoreDistance, groundHeight as groundHeightAt } from "../src/terrain.js";

// The island's animals build without WebGL (geometry is meshed in place when
// there are no workers) and behave toward a scripted cat: they notice it,
// get out of its way, and come back once it has gone.
const land = new THREE.Group();
land.scale.z = -1;
const forest = createForest(land, 1847);
// A calm sea at y = 0 offshore, dry land.
const water = (x, z) => ({ level: shoreDistance(x, z) < 0 ? 0 : -Infinity });

function world() {
  const group = new THREE.Group();
  const wild = createWildlife(group, 1847, { obstacles: forest.obstacles });
  const pose = { x: -500, z: -500, y: 0, speed: 0, air: 0, sit: 0, swim: 0 };
  let time = 0;
  const events = [];
  const run = (seconds, move = () => {}) => {
    for (let i = 0; i < seconds * 30; i++) {
      time += 1 / 30;
      move(time);
      wild.update({ dt: 1 / 30, time, night: 0, wind: [3, 1], pose, water, eye: { x: pose.x, y: 2, z: pose.z } });
      events.push(...wild.events);
    }
  };
  return { group, wild, pose, run, events };
}

function finiteMatrices(group) {
  group.traverse((o) => {
    if (!o.isInstancedMesh) return;
    for (const v of o.instanceMatrix.array) assert.ok(Number.isFinite(v), `${o.material.customProgramCacheKey?.()} matrix finite`);
  });
}

test("every encounter has a place, and the animals build within budget", () => {
  const { wild, group } = world();
  assert.deepEqual(wild.pois.map((p) => p.id).sort(), ["oystercatchers", "penguins", "seals", "tortoise"]);
  for (const p of wild.pois) for (const v of [p.x, p.z, p.r]) assert.ok(Number.isFinite(v), p.id);
  let triangles = 0;
  group.traverse((o) => {
    if (o.isInstancedMesh && o.geometry.attributes.part) {
      triangles += (o.geometry.index.count / 3) * o.count;
      assert.ok(o.geometry.userData.ready, "geometry built");
    }
  });
  assert.ok(triangles < 60000, `all animals ${triangles} triangles`);
});

test("penguins shuffle off from a cat, then come home", () => {
  const { wild, pose, run, events, group } = world();
  const p = wild.penguins;
  run(5);
  assert.ok(p.birds.every((b) => b.mode === "colony"));
  // The cat walks into the middle of the colony.
  pose.speed = 0.9;
  run(12, (t) => {
    const k = Math.min(1, (t - 5) / 10);
    pose.x = p.centre.x + 12 * (1 - k);
    pose.z = p.centre.z;
  });
  pose.speed = 0;
  const moved = p.birds.filter((b) => b.mode !== "colony" || Math.hypot(b.x - b.home.x, b.z - b.home.z) > 0.6);
  assert.ok(moved.length >= 3, `${moved.length} penguins got out of the way`);
  assert.ok(events.some((e) => e.type === "honk" || e.type === "threat"), "an alarm call");
  for (const b of p.birds) {
    if (b.mode !== "sea" && b.mode !== "flee" && b.mode !== "back") assert.ok(shoreDistance(b.x, b.z) > -0.5, "standing birds stay on land");
    assert.ok(Math.hypot(b.x - pose.x, b.z - pose.z) > 1.2, "none under the cat's paws");
  }
  // The cat goes away; within two minutes they are all home again.
  pose.x = p.centre.x + 40;
  pose.z = p.centre.z + 30;
  run(120);
  const home = p.birds.filter((b) => b.mode === "colony" || b.mode === "outing" || b.mode === "sea");
  assert.ok(home.length >= p.birds.length - 1, `${home.length}/${p.birds.length} back`);
  finiteMatrices(group);
});

test("seals slide into the sea from a cat and haul out after", () => {
  const { wild, pose, run, events } = world();
  const s = wild.seals;
  const hauled = s.seals.filter((x) => !x.player);
  run(3);
  assert.ok(hauled.every((x) => x.state === "haul"));
  pose.x = s.rock.x + Math.cos(0.3) * 3;
  pose.z = s.rock.z + Math.sin(0.3) * 3;
  pose.y = 0.6;
  run(8);
  assert.ok(hauled.every((x) => x.state === "swim" || x.state === "leap"), hauled.map((x) => x.state).join());
  assert.ok(events.some((e) => e.type === "splash" && e.source === "seals"), "a splash");
  for (const x of hauled) if (x.state === "swim") assert.ok(shoreDistance(x.x, x.z) < 0, "in the sea");
  pose.x = s.rock.x - 60;
  pose.z = s.rock.z - 60;
  pose.y = 0;
  run(150);
  assert.ok(hauled.filter((x) => x.state === "haul").length >= hauled.length - 1, hauled.map((x) => x.state).join());
});

test("the whale stays offshore and blows", () => {
  const { wild, pose, run, events, group } = world();
  const w = wild.whale.whale;
  ({ x: pose.x, z: pose.z } = islandPoint(w.along, 1.5));
  run(240, () => assert.ok(shoreDistance(w.x, w.z) < -80, "offshore"));
  assert.ok(events.filter((e) => e.type === "blow").length >= 2, "blows");
  finiteMatrices(group);
});

test("the tortoise withdraws from a pounce and comes out again", () => {
  const { wild, pose, run, events } = world();
  const t = wild.tortoise.tortoise;
  run(2);
  pose.x = t.x + 0.8;
  pose.z = t.z;
  pose.air = 0.2;
  run(1);
  assert.ok(t.in > 0.9, "in its shell");
  assert.ok(events.some((e) => e.type === "hiss"));
  pose.air = 0;
  pose.x = t.x + 10;
  run(25);
  assert.ok(t.in < 0.1, "out again");
});

// solid: penguins stand on sand or a low flat stone, never up a boulder
// (they walked up the flanks in a stutter of hops and stood on the tops).
test("penguins never climb the boulders", () => {
  const { wild, pose, run } = world();
  const p = wild.penguins;
  let worst = 0, where = "";
  const check = () => {
    for (const b of p.birds) {
      // (Afloat, or standing at the sea's edge on a submerged ledge.)
      if (b.swim > 0.5 || b.y < 0.15) continue;
      const up = b.y - groundHeightAt(b.x, b.z);
      if (up > worst) { worst = up; where = `${b.mode} at ${b.x.toFixed(1)},${b.z.toFixed(1)} home ${b.home.x.toFixed(1)},${b.home.z.toFixed(1)} speed ${b.speed.toFixed(2)} vy ${b.vy.toFixed(2)}`; }
    }
  };
  run(5, check);
  pose.speed = 1.6;
  for (const [dx, dz] of [[12, 0], [-12, 0], [0, 12], [0, -12]])
    run(10, (t) => {
      pose.x = p.centre.x + dx * (1 - ((t % 10) / 10));
      pose.z = p.centre.z + dz * (1 - ((t % 10) / 10));
      check();
    });
  pose.x = p.centre.x + 40;
  run(60, check);
  assert.ok(worst < 0.4, `a penguin stood ${worst.toFixed(2)} m above the sand: ${where}`);
});
