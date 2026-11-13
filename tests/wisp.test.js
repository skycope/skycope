import test from "node:test";
import assert from "node:assert/strict";
import { createWispMind, WISP } from "../src/wisp-mind.js";
import { groundHeight, shoreDistance } from "../src/terrain.js";
import { placesLayout } from "../src/place-layout.js";
import { seededRandom } from "../src/random.js";

const SWIM_LIMIT = 24;
const HOME = { x: 12.906, z: 9.297 };
const places = placesLayout(1847);
const place = (id) => places.find((p) => p.id === id);

// A wood of trunks and a scatter of boulders over the island (not on the
// home beach), as forest.js would give: walker.js obstacle formats.
function woods(seed = 11) {
  const random = seededRandom(seed);
  const trunks = [];
  const domes = [];
  for (let i = 0; i < 900; i++) {
    const x = -20 + random() * 160;
    const z = -10 + random() * 160;
    if (shoreDistance(x, z) < 4 || Math.hypot(x - HOME.x, z - HOME.z) < 6) continue;
    if (random() < 0.85) trunks.push({ x, z, r: 0.08 + random() * 0.25 });
    else domes.push({ x, z, r: 0.6 + random() * 1.4, top: groundHeight(x, z) + 0.4 + random() * 1.2 });
  }
  return { trunks, domes };
}
const obstacles = woods();
function surface(x, z) {
  let h = groundHeight(x, z);
  for (const d of obstacles.domes) {
    const q = Math.hypot(x - d.x, z - d.z) / d.r;
    if (q < 1) h = Math.max(h, d.top - (d.top - groundHeight(d.x, d.z)) * q * q);
  }
  return h;
}

// A cat that walks straight at whatever it is given, sliding round trunks.
function makeCat(at = HOME) {
  return { x: at.x, z: at.z, y: surface(at.x, at.z), heading: 0.6, speed: 0, running: false, sit: 0, idle: 0, swim: 0 };
}
function walkCat(cat, to, dt, speed = 0.95) {
  const dx = to.x - cat.x;
  const dz = to.z - cat.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.5) {
    cat.speed = 0;
    cat.idle += dt;
    return;
  }
  cat.idle = 0;
  cat.heading = Math.atan2(dx, dz);
  let nx = cat.x + (dx / d) * speed * dt;
  let nz = cat.z + (dz / d) * speed * dt;
  for (const t of obstacles.trunks) {
    const ox = nx - t.x;
    const oz = nz - t.z;
    const o = Math.hypot(ox, oz);
    if (o < t.r + 0.1) {
      nx = t.x + (ox / o) * (t.r + 0.1);
      nz = t.z + (oz / o) * (t.r + 0.1);
    }
  }
  if (shoreDistance(nx, nz) < -SWIM_LIMIT) return;
  cat.x = nx;
  cat.z = nz;
  cat.y = surface(nx, nz);
  cat.speed = speed;
  cat.running = speed > 2;
}

function makeWisp(seed = 1847) {
  return createWispMind({ seed, obstacles, surface, swimLimit: SWIM_LIMIT });
}

// Every frame: never inside a trunk below its top, never under the ground
// or a boulder, never past the swim limit.
function assertClear(mind, label) {
  const b = mind.body;
  for (const t of obstacles.trunks) {
    const d = Math.hypot(b.x - t.x, b.z - t.z);
    assert.ok(d >= t.r + WISP.clear - 0.02 || b.y > groundHeight(t.x, t.z) + 2, `${label}: inside a trunk (${d.toFixed(2)} < ${t.r.toFixed(2)})`);
  }
  assert.ok(b.y >= surface(b.x, b.z) + 0.04, `${label}: under the surface`);
  assert.ok(shoreDistance(mind.position.x, mind.position.z) > -SWIM_LIMIT, `${label}: out past the cat's reach`);
}

const DT = 1 / 30;

test("following the light from home reaches the keepsake it leads to", () => {
  for (const id of ["milkwood", "wreck", "boat"]) {
    const target = place(id);
    const mind = makeWisp();
    const cat = makeCat();
    mind.appear(cat);
    let reached = -1;
    for (let i = 0; i < 30 * 400; i++) {
      // The visitor follows the light itself.
      walkCat(cat, mind.position, DT, 1.6);
      mind.update(DT, { cat, target, night: 0 });
      assertClear(mind, `${id} frame ${i}`);
      if (Math.hypot(cat.x - target.x, cat.z - target.z) < target.r) {
        reached = i * DT;
        break;
      }
    }
    assert.ok(reached > 0, `${id} not reached`);
  }
});

test("it waits ahead, within sight, for a cat that stops", () => {
  const target = place("lighthouse");
  const mind = makeWisp();
  const cat = makeCat();
  mind.appear(cat);
  // Follow a while, then stand still at a few places along the way.
  for (let leg = 0; leg < 4; leg++) {
    for (let i = 0; i < 30 * 25; i++) {
      walkCat(cat, mind.position, DT, 1.2);
      mind.update(DT, { cat, target });
    }
    for (let i = 0; i < 30 * 12; i++) {
      cat.speed = 0;
      cat.idle = 0;
      mind.update(DT, { cat, target });
      assertClear(mind, `wait ${leg}`);
    }
    const d = mind.distanceTo(cat.x, cat.z);
    assert.ok(d < WISP.stray, `leg ${leg}: ${d.toFixed(1)} m away`);
    assert.ok(mind.seenFrom(cat.x, cat.z), `leg ${leg}: hidden behind a trunk`);
    // And it is ahead of the cat, toward the keepsake.
    const toTarget = Math.hypot(target.x - cat.x, target.z - cat.z);
    const wispToTarget = Math.hypot(target.x - mind.position.x, target.z - mind.position.z);
    assert.ok(wispToTarget < toTarget, `leg ${leg}: not ahead`);
  }
});

test("it never leads out past where the cat can swim", () => {
  // A target far out to sea, beyond the kelp.
  const target = { x: HOME.x - 80, z: HOME.z - 80 };
  const mind = makeWisp();
  const cat = makeCat();
  mind.appear(cat);
  for (let i = 0; i < 30 * 120; i++) {
    walkCat(cat, mind.position, DT, 1.5);
    mind.update(DT, { cat, target, night: 1 });
    assertClear(mind, `sea ${i}`);
  }
});

test("it comes back to a cat that ignores it, and keeps it company", () => {
  const target = place("lighthouse");
  const mind = makeWisp();
  const cat = makeCat();
  mind.appear(cat);
  for (let i = 0; i < 30 * 6; i++) mind.update(DT, { cat, target });
  // Walk the other way along the beach for a long while.
  const away = { x: HOME.x - 60, z: HOME.z + 40 };
  let near = 0;
  for (let i = 0; i < 30 * 120; i++) {
    walkCat(cat, away, DT, 0.95);
    mind.update(DT, { cat, target });
    assertClear(mind, `ignored ${i}`);
    if (i > 30 * 60 && mind.distanceTo(cat.x, cat.z) < 6) near++;
  }
  assert.ok(near > 30 * 45, `only near for ${(near / 30).toFixed(1)} s of the last minute`);
});

test("it circles a sitting cat and comes when meowed at", () => {
  const mind = makeWisp();
  const cat = makeCat();
  mind.appear(cat);
  const target = place("milkwood");
  for (let i = 0; i < 30 * 8; i++) mind.update(DT, { cat, target });
  cat.sit = 1;
  cat.idle = 5;
  for (let i = 0; i < 30 * 5; i++) mind.update(DT, { cat, target });
  assert.notEqual(mind.mode, "circle", "a cat that has only just sat is still being led");
  for (let i = 0; i < 30 * 9; i++) mind.update(DT, { cat, target });
  assert.equal(mind.mode, "circle");
  assert.ok(mind.distanceTo(cat.x, cat.z) < 1.3);
  cat.sit = 0;
  cat.idle = 0;
  for (let i = 0; i < 30 * 10; i++) mind.update(DT, { cat, target });
  assert.ok(mind.distanceTo(cat.x, cat.z) > 3, "gone ahead again");
  mind.update(DT, { cat, target, call: true });
  let came = Infinity;
  for (let i = 0; i < 30 * 3; i++) {
    mind.update(DT, { cat, target });
    if (mind.distanceTo(cat.x, cat.z) < 1.6) came = Math.min(came, i * DT);
  }
  assert.ok(came < 2.4, `answered after ${came} s`);
});

test("the dive goes into the keepsake and comes out again", () => {
  const mind = makeWisp();
  const cat = makeCat();
  mind.appear(cat);
  const p = place("wreck");
  const y = surface(p.x, p.z) + 1;
  for (let i = 0; i < 30 * 3; i++) mind.update(DT, { cat, target: p });
  mind.dive(p.x, y, p.z);
  let lowest = Infinity;
  let dark = 0;
  const stages = [];
  for (let i = 0; i < 30 * 7; i++) {
    mind.update(DT, { cat, target: p });
    if (stages.at(-1) !== mind.stage) stages.push(mind.stage);
    if (mind.stage === "gone") {
      lowest = Math.min(lowest, Math.hypot(mind.body.x - p.x, mind.body.z - p.z, mind.body.y - y));
      if (mind.glow < 0.15) dark++;
    }
  }
  assert.deepEqual(stages, ["approach", "plunge", "gone", "emerge"]);
  assert.ok(lowest < 0.8, `dived to within ${lowest.toFixed(2)} m`);
  assert.ok(dark > 10, "gone a moment");
  assert.ok(mind.glow > 0.8, "out again, bright");
  mind.end();
  assert.equal(mind.mode, "greet");
});

test("the same seed flies the same way; another seed differently", () => {
  const run = (seed) => {
    const mind = makeWisp(seed);
    const cat = makeCat();
    mind.appear(cat);
    const out = [];
    for (let i = 0; i < 30 * 30; i++) {
      walkCat(cat, mind.position, DT, 1.2);
      mind.update(DT, { cat, target: place("milkwood") });
      if (i % 30 === 0) out.push(mind.position.x.toFixed(4), mind.position.y.toFixed(4));
    }
    return out;
  };
  assert.deepEqual(run(1847), run(1847));
  assert.notDeepEqual(run(1847), run(9));
});

import { createRoutes } from "../src/wisp-route.js";

test("routes go round a fence through its gate, never through a post", () => {
  // A fence of posts 0.5 m apart across the way, with one gap far to the side.
  const trunks = [];
  for (let x = -40; x <= 160; x += 0.5) if (Math.abs(x - 52) > 1.5) trunks.push({ x, z: 60, r: 0.12 });
  const routes = createRoutes({ obstacles: { trunks, domes: [] }, surface: groundHeight, reach: 21 });
  const path = routes.find(30, 50, 30, 70);
  assert.ok(path && path.length >= 4);
  const end = [path.at(-2), path.at(-1)];
  assert.ok(Math.hypot(end[0] - 30, end[1] - 70) < 2, "reaches the far side");
  // Through the gate.
  let crossed = null;
  for (let i = 2; i < path.length; i += 2) if ((path[i - 1] - 60) * (path[i + 1] - 60) <= 0) crossed = path[i - 2];
  assert.ok(crossed !== null && Math.abs(crossed - 52) < 2.5, `crossed at x=${crossed}`);
  for (let i = 0; i < path.length; i += 2) for (const t of trunks) assert.ok(Math.hypot(path[i] - t.x, path[i + 1] - t.z) > t.r);
});
