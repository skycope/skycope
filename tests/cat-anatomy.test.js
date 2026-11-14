import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createCat } from "../src/cat.js";
import { CAT_SCALE as S } from "../src/cat-rig.js";

// The cat's proportions, measured on the skinned mesh as it is drawn
// (standing on level ground), against a domestic shorthair's. Model metres
// (before CAT_SCALE). Ranges are a real adult's, with the coat.

function pose(extra = {}) {
  return { x: 0, z: 0, y: 0, heading: 0, speed: 0, turn: 0, gaitAmp: 0, running: false, vy: 0, air: 0, airPitch: 0, sit: 0, sleepy: 0, idle: 0, look: 0, lookUp: 0, tilt: 0, swish: 0, meowing: 0, waterY: -Infinity, water: 0, wade: 0, swim: 0, waterSlope: [0, 0], flow: [0, 0], rising: 0, soak: -1, shake: 0, ...extra };
}
// No triangle low on the legs may stretch past this (model metres) in any
// gait: longer means skin webbing between paws that touched in the bind pose.
const STRETCH = 0.025;
const LIGHT = { night: 0, direct: 1, sunX: 0.3, sunZ: 0.4, sun: new THREE.Vector3(0.3, 0.85, 0.4).normalize() };

// One cat for the whole file (meshing it takes a second); each check
// drives a fresh pose for `frames` at 60 Hz on level ground (step(i, pose))
// and calls sample() on the frames listed in `at` (default: the last).
const cat = createCat(new THREE.Group(), { sync: true });
function posed(frames, step = () => {}, at = [frames - 1]) {
  const p = pose();
  const out = [];
  for (let i = 0; i < frames; i++) {
    step(i, p);
    cat.update(p, 1 / 60, i / 60, () => 0, () => 0, LIGHT);
    if (at.includes(i)) out.push(sample(p));
  }
  return at.length === 1 ? out[0] : out;
}
function sample(p) {
  const mesh = cat.debug.meshes[0];
  cat.root.updateMatrixWorld(true);
  const g = mesh.geometry;
  const v = new THREE.Vector3();
  const points = [];
  for (let i = 0; i < g.attributes.position.count; i++) {
    mesh.getVertexPosition(i, v).applyMatrix4(mesh.matrixWorld);
    const r = g.attributes.region;
    points.push({
      x: (v.x - p.x) / S, y: v.y / S, z: (v.z - p.z) / S,
      head: r.getX(i), leg: r.getY(i), tail: r.getZ(i), paw: r.getW(i),
      part: Math.round(g.attributes.coat.getW(i)),
    });
  }
  const paws = ["lf", "rf", "lh", "rh"].map((name) => {
    const at = cat.root.getObjectByName(`${name}Paw`).getWorldPosition(v);
    return [(at.x - p.x) / S, (at.z - p.z) / S];
  });
  // The longest triangle edge low on the legs (below 6 cm): skin stretched
  // into a web between paws that touched in the bind pose. (The inner
  // thighs share skin under the belly by design; that stretch is hidden.)
  const index = g.index.array;
  let stretch = 0;
  for (let t = 0; t < index.length; t += 3)
    for (let e = 0; e < 3; e++) {
      const a = points[index[t + e]], b = points[index[t + ((e + 1) % 3)]];
      if (a.y > 0.06 || b.y > 0.06) continue;
      stretch = Math.max(stretch, Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z));
    }
  return { paws, points, stretch };
}
const span = (list, k) => {
  let lo = Infinity, hi = -Infinity;
  for (const p of list) { lo = Math.min(lo, p[k]); hi = Math.max(hi, p[k]); }
  return hi - lo;
};
const top = (list, k) => Math.max(...list.map((p) => p[k]));
const bottom = (list, k) => Math.min(...list.map((p) => p[k]));
const within = (value, [lo, hi], what) => assert.ok(value >= lo && value <= hi, `${what}: ${(value * 100).toFixed(1)} cm not in ${lo * 100}–${hi * 100}`);

test("the standing cat has a shorthair's proportions", () => {
  const { points } = posed(90);
  for (const p of points) assert.ok(Number.isFinite(p.x + p.y + p.z), "finite");
  const coat = points.filter((p) => p.part === 0);
  const trunk = coat.filter((p) => p.head + p.leg + p.tail + p.paw < 0.35);
  const at = (list, z0, z1) => list.filter((p) => p.z >= z0 && p.z <= z1);
  const widest = (z0, z1) => {
    let w = 0;
    for (let z = z0; z <= z1; z += 0.01) w = Math.max(w, span(at(coat, z - 0.005, z + 0.005).filter((p) => p.y > 0.08), "x"));
    return w;
  };
  const withers = top(at(trunk, 0.06, 0.11), "y");
  const chest = at(trunk, 0.03, 0.08);
  const brisket = bottom(chest, "y");
  // The chest is about half the height at the withers, the legs the rest.
  within((withers - brisket) / withers, [0.42, 0.52], "chest depth / withers");
  // A cat's head is big for its body: about a fifth of its length (nose to
  // rump), two thirds as deep as its chest, a little narrower than its
  // ribs, and it sits close to the shoulders on a short neck.
  const head = coat.filter((p) => p.head > 0.6);
  const body = coat.filter((p) => p.tail < 0.5);
  const length = top(body, "z") - bottom(body, "z");
  const chestDepth = withers - brisket;
  // Nose tip to the back of the skull, measured over its upper half (below
  // that the head's skin runs on into the throat).
  const mid = (top(head, "y") + bottom(head, "y")) / 2;
  const headLength = top(head, "z") - bottom(head.filter((p) => p.y > mid), "z");
  within(headLength / length, [0.19, 0.235], "head length / body length");
  within(span(head, "y") / chestDepth, [0.6, 0.78], "head depth / chest depth");
  within(span(head, "x"), [0.09, 0.108], "head width");
  // The visible neck: from the top of the shoulders to the back of the
  // skull along the top line.
  const skull = bottom(head.filter((p) => p.y > withers - 0.01), "z");
  const neck = skull - 0.1;
  within(neck, [0.02, 0.065], "visible neck");
  // From above: shoulders, a ribcage, a waist and hips, not a log; from
  // behind, the haunches no wider than the chest.
  const ribs = widest(0.0, 0.06);
  const waist = widest(-0.045, -0.035);
  const haunch = widest(-0.2, -0.06);
  const shoulders = widest(0.09, 0.12);
  within(ribs, [0.1, 0.125], "ribcage width");
  assert.ok(waist < ribs * 0.8, `a waist (${(waist * 100).toFixed(1)} cm) behind the ribs (${(ribs * 100).toFixed(1)} cm)`);
  assert.ok(shoulders < ribs, "shoulders narrower than the ribcage");
  assert.ok(haunch <= ribs + 0.003, `haunches (${(haunch * 100).toFixed(1)} cm) no wider than the chest`);
  // Slender legs and a tail that tapers.
  const forearm = coat.filter((p) => p.leg > 0.5 && p.x > 0 && p.z > 0.02 && p.y > 0.06 && p.y < 0.09);
  within(span(forearm, "z"), [0.022, 0.036], "forearm thickness");
  const tail = coat.filter((p) => p.tail > 0.7);
  const tailAt = (z) => span(tail.filter((p) => Math.abs(p.z - z) < 0.006), "x");
  within(tailAt(-0.21), [0.026, 0.036], "tail at the root");
  assert.ok(tailAt(-0.4) < tailAt(-0.21) * 0.8, "the tail tapers");
});

// Every paw meets the ground (within the sand it presses into) standing,
// sitting and lying, and no paw sinks through it mid-stride.
test("the cat's paws reach the ground in every pose", () => {
  // The lowest point of each paw: the coat's paw vertices round its bone.
  const soles = ({ paws, points }) =>
    paws.map(([x, z]) => bottom(points.filter((q) => q.part === 0 && q.paw > 0.5 && Math.hypot(q.x - x, q.z - z) < 0.04), "y"));
  for (const [name, frames, step] of [
    ["stand", 90, () => {}],
    ["sit", 240, (i, p) => { p.sit = Math.min(1, i / 60); p.idle = 6; }],
    ["lie", 600, (i, p) => { p.sit = 1; p.sleepy = 0.6; p.idle = 30; }],
  ]) {
    soles(posed(frames, step)).forEach((y, k) => within(y, [-0.004, 0.004], `${name} paw ${k} sole height`));
  }
  // Walking and running: paws in stance stay on the ground, none below it.
  for (const speed of [0.55, 1.5, 3.2])
    for (const frame of posed(150, (i, p) => { p.speed = speed; p.gaitAmp = 1; p.running = speed > 2; p.z += speed / 60; }, [119, 126, 132, 140, 149])) {
      // The back line, rump to withers, is a smooth curve: no hump or
      // spike (a shoulder blade lifting through the skin).
      const line = new Map();
      for (const q of frame.points)
        if (q.part === 0 && q.head < 0.3 && q.tail < 0.3 && Math.abs(q.x) < 0.045) {
          const z = Math.round(q.z * 100);
          line.set(z, Math.max(line.get(z) ?? -1, q.y));
        }
      for (let z = -12; z <= 11; z++) {
        const bump = line.get(z) - (line.get(z - 3) + line.get(z + 3)) / 2;
        assert.ok(bump < 0.006, `${speed} m/s: back line bump ${(bump * 100).toFixed(1)} cm at ${z} cm`);
      }
      const s = soles(frame);
      assert.ok(frame.stretch < STRETCH, `${speed} m/s: no skin web (longest edge ${(frame.stretch * 100).toFixed(1)} cm)`);
      for (const y of s) assert.ok(y > -0.006, `${speed} m/s: no paw through the ground (${(y * 100).toFixed(1)} cm)`);
      assert.ok(Math.min(...s) < 0.004, `${speed} m/s: some paw on the ground`);
    }
});
