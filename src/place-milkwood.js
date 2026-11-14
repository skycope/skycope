import * as THREE from "three";
import { groundHeight } from "./terrain.js";
import { capsule, roof } from "./blockers.js";
import { heightTile, timberTile } from "./place-kit.js";
import { seededRandom } from "./random.js";
import { part, merge, sweep, smooth01, srgb, hsl, staticMesh, prop, crossfade } from "./place-kit.js";

// One ancient white milkwood (Sideroxylon inerme), the kind that is a
// landmark in its own right on the Cape coast: low and immensely wide, a
// short fluted bole splitting into a few massive, twisting limbs that run
// out nearly level, sag under their own weight until their elbows rest on
// the ground, and turn up again; a dense dome of small, dark, leathery
// leaves over a hollow you can walk into; and old man's beard (Usnea)
// hanging in grey-green tresses from the shaded limbs.
//
// Local frame: x, z relative to the trunk; y absolute.

const BARK = srgb("#5d5850");
const BARK_DARK = srgb("#433f39");

export function buildMilkwood(p, materials, { light = false, seed = 1 } = {}) {
  const random = seededRandom((seed ^ 0x6d1c0) >>> 0 || 1);
  const ground = (x, z) => groundHeight(p.x + x, p.z + z);
  const g0 = ground(0, 0);
  const limbs = []; // { points, radii, depth }
  const spots = []; // twig ends and outer shoots, where leaves gather
  const beards = []; // where lichen hangs
  // solid: the bole's core stops the cat; its buttress roots (out to 1.6 m,
  // past the old 1.15 m circle the cat walked through) are a surface.
  const trunks = [{ x: p.x, z: p.z, r: 0.95 }];

  // The bole: a short, buttressed column (fluted by the limbs it carries).
  const boleTop = g0 + 1.7;
  // Grows a limb by stepping a direction that sags with length, wanders
  // (gnarl), and bounces off the ground where an elbow comes to rest.
  const grow = (start, dir, length, r0, depth, { droop, gnarl, step, rise = 0 }) => {
    const points = [start.clone()];
    const radii = [r0];
    const d = dir.clone().normalize();
    const p0 = start.clone();
    const n = Math.max(2, Math.round(length / step));
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      d.y -= droop * smooth01(0.15, 0.6, t) * step;
      d.y += rise * step;
      d.x += (random() - 0.5) * gnarl;
      d.y += (random() - 0.5) * gnarl * 0.6;
      d.z += (random() - 0.5) * gnarl;
      d.normalize();
      p0.addScaledVector(d, step);
      const floor = ground(p0.x, p0.z) + 0.18 + r0 * 0.6;
      if (p0.y < floor) {
        // An elbow on the ground: the limb rests, then turns up again.
        // (A resting limb stops the cat by its body capsule below, which a
        // jump clears; a trunk here was a wall of no height.)
        p0.y = floor;
        d.y = Math.abs(d.y) * 0.4 + 0.35;
        d.normalize();
      }
      points.push(p0.clone());
      radii.push(Math.max(0.025, r0 * Math.pow(1 - t * 0.92, 0.85)));
    }
    limbs.push({ points, radii, depth });
    return { points, radii };
  };

  const main = light ? 5 : 6;
  let ramp = null; // the limb a cat walks up
  const azimuth0 = random() * Math.PI * 2;
  for (let i = 0; i < main; i++) {
    const az = azimuth0 + (i / main) * Math.PI * 2 + (random() - 0.5) * 0.5;
    const el = 0.3 + random() * 0.3;
    const base = new THREE.Vector3(Math.cos(az) * 0.35, boleTop - 0.4 - random() * 0.5, Math.sin(az) * 0.35);
    const dir = new THREE.Vector3(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el));
    const length = 9 + random() * 3.5;
    const limb = grow(base, dir, length, 0.42 + random() * 0.1, 0, { droop: 0.15, gnarl: 0.24, step: 0.5 });
    // The first limb comes down to the ground as a ramp: an even slope from
    // the fork to an elbow sunk in the leaf litter 4.5 m out, which a cat
    // walks up to sit in the fork.
    if (i === 0) {
      const e = limb.points.findIndex((q) => Math.hypot(q.x, q.z) >= 4.5);
      if (e > 2) {
        const q = limb.points[e];
        const yE = ground(q.x, q.z) + limb.radii[e] * 0.45;
        const y0 = limb.points[0].y;
        for (let k = 1; k <= e; k++) limb.points[k].y = y0 + (yE - y0) * (k / e);
        // Past the elbow it rises again from there, as it grew.
        const lift = limb.points[e + 1] ? limb.points[e + 1].y - yE : 0;
        for (let k = e + 1; k < limb.points.length; k++) limb.points[k].y = Math.max(limb.points[k].y - Math.max(0, lift - 0.25), ground(limb.points[k].x, limb.points[k].z) + limb.radii[k] * 0.6);
        ramp = { limb: limbs[limbs.length - 1], end: e, start: 1 };
      }
    }
    // Side branches: alternate, reaching up and out toward the light.
    let along = 1.0 + random() * 0.5;
    let side = random() < 0.5 ? -1 : 1;
    const total = limb.points.length;
    while (along < length - 0.6) {
      const k = Math.min(total - 2, Math.round((along / length) * (total - 1)));
      const at = limb.points[k];
      const parentDir = limb.points[k + 1].clone().sub(at).normalize();
      const turn = side * (0.7 + random() * 0.6);
      const c = Math.cos(turn), s = Math.sin(turn);
      const dir2 = new THREE.Vector3(parentDir.x * c - parentDir.z * s, 0, parentDir.x * s + parentDir.z * c);
      dir2.y = 0.55 + random() * 0.7;
      const len2 = (2.6 + random() * 2.6) * (1 - (along / length) * 0.4);
      const r2 = Math.min(limb.radii[k] * 0.62, 0.2);
      const branch = grow(at.clone(), dir2, len2, r2, 1, { droop: 0.05, gnarl: 0.3, step: 0.42, rise: 0.02 });
      // Twigs off each branch, and the leaves at their ends.
      const twigs = 3 + Math.floor(random() * 3);
      for (let j = 0; j < twigs; j++) {
        const kk = Math.min(branch.points.length - 2, 1 + Math.floor(random() * (branch.points.length - 1)));
        const from = branch.points[kk];
        const bd = branch.points[kk + 1].clone().sub(from).normalize();
        const tw = new THREE.Vector3(bd.x + (random() - 0.5) * 1.4, bd.y + 0.3 + random() * 0.5, bd.z + (random() - 0.5) * 1.4);
        const twig = grow(from.clone(), tw, 0.9 + random() * 1.1, Math.min(branch.radii[kk] * 0.6, 0.05), 2, { droop: 0.02, gnarl: 0.35, step: 0.35 });
        spots.push(twig.points[twig.points.length - 1], twig.points[Math.max(0, twig.points.length - 3)]);
      }
      spots.push(branch.points[branch.points.length - 1]);
      for (let m = Math.floor(branch.points.length * 0.4); m < branch.points.length; m += 2) spots.push(branch.points[m]);
      // Lichen hangs from the undersides of the inner branches.
      for (let m = 0; m < branch.points.length - 1; m++) if (random() < 0.5) beards.push({ at: branch.points[m], r: branch.radii[m] });
      along += 0.55 + random() * 0.5;
      side = -side;
    }
    // Leaves along the limb's outer reach too.
    for (let m = Math.floor(total * 0.5); m < total; m++) spots.push(limb.points[m]);
    for (let m = 2; m < total * 0.7; m++) if (random() < 0.6) beards.push({ at: limb.points[m], r: limb.radii[m] });
  }

  // ---- Wood --------------------------------------------------------------
  const anchor = (q) => ground(q.x, q.z);
  const barkColour = (q, n, out) => {
    // Darker, mossier low down and in the forks.
    out.copy(BARK).lerp(BARK_DARK, 1 - smooth01(anchor(q), anchor(q) + 1.5, q.y));
  };
  // Inside the dome little sky reaches the wood.
  const barkShade = (q) => 0.55 * (1 - smooth01(9, 12, Math.hypot(q.x, q.z)));
  const woodNear = [];
  const woodFar = [];
  // The bole: a fluted lathe, flared at the foot into buttress roots.
  const boleY = (t) => g0 - 0.4 + t * (boleTop - g0 + 0.6);
  {
    const rings = 9, radial = light ? 12 : 15;
    const positions = [];
    const index = [];
    for (let j = 0; j <= rings; j++) {
      const t = j / rings;
      const y = boleY(t);
      for (let i = 0; i < radial; i++) {
        const a = (i / radial) * Math.PI * 2;
        positions.push(Math.cos(a) * boleRadius(t, a), y, Math.sin(a) * boleRadius(t, a));
      }
    }
    for (let j = 0; j < rings; j++)
      for (let i = 0; i < radial; i++) {
        const a = j * radial + i, b = j * radial + ((i + 1) % radial), c = a + radial, d = b + radial;
        index.push(a, c, b, b, c, d);
      }
    const bole = new THREE.BufferGeometry();
    bole.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    bole.setIndex(index);
    bole.computeVertexNormals();
    woodNear.push(part(bole.clone(), { colour: barkColour, shade: 0.45, anchor }));
    woodFar.push(part(bole, { colour: barkColour, shade: 0.45, anchor }));
  }
  // The ramp limb's back is worn pale where paws go (its hint).
  const wornColour = (q, n, out) => { barkColour(q, n, out); if (n.y > 0.55) out.lerp(srgb("#8f897d"), smooth01(0.55, 0.9, n.y) * 0.7); };
  for (const limb of limbs) {
    const radialNear = limb.depth === 0 ? 7 : limb.depth === 1 ? 5 : 3;
    woodNear.push(part(sweep(limb.points, limb.radii, radialNear), { colour: limb === ramp?.limb ? wornColour : barkColour, shade: barkShade, anchor }));
    if (limb.depth < 2) {
      const keep = limb.points.map((_, k) => k).filter((k) => k % 2 === 0 || k === limb.points.length - 1);
      woodFar.push(part(sweep(keep.map((k) => limb.points[k]), keep.map((k) => limb.radii[k]), limb.depth === 0 ? 6 : 4), { colour: barkColour, shade: barkShade, anchor }));
    }
  }

  // ---- Leaves --------------------------------------------------------------
  const clumps = [];
  // Fewer, fuller shoots (178k triangles near became under 60k).
  const per = light ? 2 : 3;
  let top = g0;
  for (const s of spots) top = Math.max(top, s.y);
  const centre = new THREE.Vector3(0, g0 + (top - g0) * 0.35, 0);
  for (const s of spots)
    for (let k = 0; k < per; k++) {
      const q = s.clone().add(new THREE.Vector3((random() - 0.5) * 1.1, (random() - 0.2) * 0.7, (random() - 0.5) * 1.1));
      if (q.y < ground(q.x, q.z) + 0.6) continue;
      clumps.push(q);
    }
  // A ceiling on the crown: the shoots spread evenly over a few more than
  // 2,500, whatever the limbs grew (the near level stays under 60k).
  const cap = light ? 1500 : 2550;
  if (clumps.length > cap) { const step = clumps.length / cap; const kept = Array.from({ length: cap }, (_, i) => clumps[Math.floor(i * step)]); clumps.length = 0; clumps.push(...kept); }
  // Shade within the dome: deep inside and low, little sky.
  let maxReach = 0;
  for (const q of clumps) maxReach = Math.max(maxReach, Math.hypot(q.x, q.z));
  const leafColour = new THREE.Color();
  const toInstances = (list, grow = 1) => list.map((q, i) => {
    const out = q.clone().sub(centre).normalize();
    const reach = Math.hypot(q.x, q.z) / maxReach;
    const height = (q.y - g0) / Math.max(1, top - g0);
    const exposure = Math.min(1, reach * 0.7 + height * 0.5);
    const variation = Math.sin(i * 12.9898) * 43758.5453 % 1;
    leafColour.copy(hsl(0.25 + Math.abs(variation) * 0.04, 0.42 + exposure * 0.08, 0.14 + exposure * 0.05 + Math.abs(variation) * 0.03));
    return {
      position: q,
      scale: new THREE.Vector3(1, 1, 1).multiplyScalar((1.1 + Math.abs(variation) * 0.3) * grow),
      rotation: new THREE.Euler((Math.abs(variation) - 0.5) * 1.2, Math.atan2(out.x, out.z) + variation * 2, (Math.abs(variation * 7) % 1 - 0.5) * 0.9),
      color: leafColour.clone(),
      ground: q.y - 1.0,
      bend: out,
      shade: Math.min(0.85, 0.75 * (1 - exposure) + 0.1),
    };
  });
  const near = toInstances(clumps);
  const far = toInstances(clumps.filter((_, i) => i % 3 === 0), 1.7);
  const leafNear = instanced(shootGeometry(7, 1), materials.foliage, near, true);
  const leafFar = instanced(shootGeometry(3, 0), materials.foliage, far, true);

  // ---- Old man's beard -------------------------------------------------------
  const strands = [];
  for (const b of beards) {
    const count = 1 + Math.floor(random() * 3);
    for (let k = 0; k < count; k++) {
      // solid: short, fine and lichen-grey-green (long pale strips read as
      // flat untextured quads hanging from the tree).
      const len = 0.15 + random() ** 1.5 * 0.35;
      strands.push({
        position: b.at.clone().add(new THREE.Vector3((random() - 0.5) * 0.3, -b.r * 0.8, (random() - 0.5) * 0.3)),
        scale: new THREE.Vector3(0.6 + random() * 0.6, len, 1),
        rotation: new THREE.Euler(0, random() * Math.PI, 0),
        color: hsl(0.2 + random() * 0.05, 0.12 + random() * 0.06, 0.34 + random() * 0.1),
      });
    }
  }
  const beardMesh = instanced(beardGeometry(), materials.lichen, strands.slice(0, light ? 150 : 260), false);

  const rootTile = heightTile(p.x, p.z, 2.4, 0.08, (x, z) => {
    const lx = x - p.x, lz = z - p.z;
    const r = Math.hypot(lx, lz), a = Math.atan2(lz, lx);
    // The bole narrows upward: the highest ring still reaching out to r.
    let top = -Infinity;
    for (let k = 0; k <= 40; k++) if (boleRadius(k / 40, a) >= r) top = boleY(k / 40);
    // Low root flanks are a step to stand on; higher up the bole is a wall
    // (standing there put the cat's back inside the lowest limbs).
    const g = ground(lx, lz);
    if (top <= g + 0.02) return -Infinity;
    return top - g < 0.4 ? top : g + 3;
  });
  // solid: the camera keeps out of the limbs (capsules, a couple of metres
  // each; the cat ducks under them or meets them where they rest low) and
  // out of the leafy crown (a coarse roof: per metre cell, solid between
  // the lowest and highest leaf clump over it), so it stays under the dome
  // with the cat or outside it, never in the leaves.
  const blockers = [];
  const at = (q) => ({ x: p.x + q.x, y: q.y, z: p.z + q.z });
  for (const limb of limbs) {
    if (limb.depth > 1) continue;
    const every = limb.depth === 0 ? 4 : 6;
    for (let k = 0; k + 1 < limb.points.length; k += every) {
      const e = Math.min(limb.points.length - 1, k + every);
      // (The ramp is walked on: its tile carries the cat, not its body.)
      const onRamp = limb === ramp?.limb;
      // Nor are the limbs' roots in the fork: the bole stops the cat there,
      // and a body round each root caught a cat stepping off the ramp.
      const inFork = k === 0;
      blockers.push(capsule(at(limb.points[k]), at(limb.points[e]), Math.max(0.08, (limb.radii[k] + limb.radii[e]) / 2), { body: limb.depth === 0 && !onRamp && !inFork }));
    }
  }
  blockers.push(capsule(at(new THREE.Vector3(0, g0 - 0.5, 0)), at(new THREE.Vector3(0, boleTop, 0)), 1.0, { body: false }));
  {
    const cell = 1;
    const n = Math.ceil((maxReach + 1.5) * 2 / cell);
    const x0 = -n * cell / 2, z0 = -n * cell / 2;
    const under = new Float32Array(n * n).fill(Infinity);
    const over = new Float32Array(n * n).fill(-Infinity);
    for (const q of clumps)
      for (let i = Math.floor((q.x - 0.6 - x0) / cell); i <= Math.floor((q.x + 0.6 - x0) / cell); i++)
        for (let j = Math.floor((q.z - 0.6 - z0) / cell); j <= Math.floor((q.z + 0.6 - z0) / cell); j++) {
          if (i < 0 || j < 0 || i >= n || j >= n) continue;
          under[j * n + i] = Math.min(under[j * n + i], q.y - 0.7);
          over[j * n + i] = Math.max(over[j * n + i], q.y + 0.7);
        }
    blockers.push(roof(p.x + x0, p.z + z0, cell, n, under, over));
  }

  // The ramp to walk up, and the seat at its top by the fork.
  const rampTiles = [];
  let perch = null;
  if (ramp) {

    // The whole limb, out past the elbow and up again (as one surface it
    // cannot be walked under; low past the elbow it is stepped over).
    const pts = ramp.limb.points.slice(ramp.start).map((q) => ({ x: p.x + q.x, y: q.y, z: p.z + q.z }));
    const r = ramp.limb.radii.slice(0, ramp.end + 1).reduce((a, b) => a + b, 0) / (ramp.end + 1);
    rampTiles.push(timberTile(pts, r));
    // The seat: just clear of the bole, where the limb leaves the fork.
    const k = Math.max(1, ramp.limb.points.findIndex((q) => Math.hypot(q.x, q.z) >= 1.3));
    const q = ramp.limb.points[k];
    const d = ramp.limb.points[0].clone().sub(q);
    perch = { x: p.x + q.x, y: q.y + ramp.limb.radii[k], z: p.z + q.z, facing: Math.atan2(-d.x, -d.z) };
  }
  const nearGroup = new THREE.Group();
  nearGroup.add(staticMesh(merge(woodNear), materials.bark), leafNear, beardMesh);
  const farGroup = new THREE.Group();
  farGroup.add(staticMesh(merge(woodFar), materials.bark), leafFar);
  // Near to far at 34 m, dithered across 8 m (a hard swap changed 2% of
  // the picture in one frame).
  const levels = crossfade(nearGroup, farGroup, { at: 34, band: 8 });
  levels.update(0);
  return prop({
    lod: { near: levels.group },
    levels,
    update({ eye }) {
      if (eye) levels.update(Math.hypot(eye[0] - p.x, eye[1] - (g0 + 4), eye[2] - p.z));
    },
    surfaces: { trunks, tiles: [rootTile, ...rampTiles], solids: blockers },
    affordances: perch ? [{ id: "milkwood-fork", kind: "perch", ...perch, r: 0.5, hint: "bark worn pale along the top of one low limb" }] : [],
    covers: [{ kind: "crown", x: p.x, z: p.z, r: maxReach * 0.8, y: g0 + 2.5 }],
    crown: { radius: maxReach, top, ground: g0 }, // land-magic: the fireflies' home
  });
}

// An instanced set (one draw), with the per-instance attributes the forest's
// foliage shading reads: anchor height, bent normal, sky occlusion.
function instanced(geometry, material, list, cast) {
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, list.length));
  mesh.count = list.length;
  const o = new THREE.Object3D();
  const anchors = new Float32Array(list.length);
  const bends = new Float32Array(list.length * 3);
  const shades = new Float32Array(list.length);
  list.forEach((it, i) => {
    o.position.copy(it.position);
    o.scale.copy(it.scale);
    o.rotation.copy(it.rotation);
    o.updateMatrix();
    mesh.setMatrixAt(i, o.matrix);
    mesh.setColorAt(i, it.color);
    anchors[i] = it.ground ?? it.position.y;
    const b = it.bend ?? new THREE.Vector3(0, 1, 0);
    bends.set([b.x, b.y, b.z], i * 3);
    shades[i] = it.shade ?? 0;
  });
  geometry.setAttribute("anchorHeight", new THREE.InstancedBufferAttribute(anchors, 1));
  geometry.setAttribute("bendNormal", new THREE.InstancedBufferAttribute(bends, 3));
  geometry.setAttribute("canopyShade", new THREE.InstancedBufferAttribute(shades, 1));
  mesh.castShadow = cast;
  mesh.receiveShadow = true;
  mesh.computeBoundingSphere();
  mesh.matrixAutoUpdate = false;
  return mesh;
}

// A milkwood shoot: small, oval, leathery leaves in opposite pairs, each
// pair turned a quarter from the last, folded on the midrib and curving
// down at the tip. `detail` 0: two broad cards for distance.
function shootGeometry(leaves = 8, detail = 1) {
  const positions = [];
  const colours = [];
  const flutter = [];
  const index = [];
  const random = seededRandom(31);
  const base = new THREE.Color();
  for (let i = 0; i < leaves; i++) {
    const pair = Math.floor(i / 2);
    const side = i % 2 ? 1 : -1;
    const az = pair * Math.PI / 2 + (side > 0 ? Math.PI : 0) + (random() - 0.5) * 0.4;
    const y = pair * 0.09 + 0.05;
    const length = (detail ? 0.34 : 0.62) * (1 - pair * 0.08) * (0.85 + random() * 0.3);
    const width = length * (detail ? 0.5 : 0.75);
    const tilt = 0.5 + random() * 0.4; // up from horizontal
    const dx = Math.cos(az), dz = Math.sin(az);
    const px = -dz, pz = dx;
    const o = positions.length / 3;
    const along = (t, lift) => [dx * length * t * Math.cos(tilt * (1 - t * 0.8)), y + length * t * Math.sin(tilt) * (1 - t * 0.7) + lift, dz * length * t * Math.cos(tilt * (1 - t * 0.8))];
    const fold = width * 0.18;
    const [ax, ay, az2] = along(0, 0);
    const [mx, my, mz] = along(0.45, fold);
    const [tx, ty, tz] = along(1, -length * 0.08);
    positions.push(ax, ay, az2, mx + px * width / 2, my - fold, mz + pz * width / 2, mx - px * width / 2, my - fold, mz - pz * width / 2, mx, my, mz, tx, ty, tz);
    const tone = 0.85 + random() * 0.3 + pair * 0.05;
    for (let k = 0; k < 5; k++) {
      base.setRGB(tone, tone * (1.02 + pair * 0.015), tone * 0.95);
      colours.push(base.r, base.g, base.b);
    }
    flutter.push(i / leaves, 0, i / leaves, 0.7, i / leaves, 0.7, i / leaves, 0.5, i / leaves, 1);
    // Two triangles folded along the midrib (the side points sit below
    // the base–tip line): the fold reads without a midrib vertex.
    if (detail) index.push(o, o + 1, o + 4, o, o + 4, o + 2);
    else index.push(o, o + 1, o + 4, o, o + 4, o + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(colours, 3));
  g.setAttribute("leafFlutter", new THREE.Float32BufferAttribute(flutter, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

// A tress of Usnea: two crossed, tapering ribbons hanging from y = 0 to
// y = −1 (scaled per instance), a little kinked.
function beardGeometry() {
  const positions = [];
  const colours = [];
  const index = [];
  for (let r = 0; r < 2; r++) {
    const a = r * Math.PI / 2;
    const ax = Math.cos(a), az = Math.sin(a);
    const o = positions.length / 3;
    const n = 4;
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const w = 0.028 * (1 - t * 0.7);
      const kink = Math.sin(t * 7 + r) * 0.03;
      positions.push(-ax * w + kink, -t, -az * w, ax * w + kink, -t, az * w);
      const shade = 0.85 + t * 0.2;
      colours.push(shade, shade, shade, shade, shade, shade);
      if (k < n) index.push(o + k * 2, o + k * 2 + 2, o + k * 2 + 1, o + k * 2 + 1, o + k * 2 + 2, o + k * 2 + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(colours, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

// The bole's radius at height fraction t (0 foot … 1 crown) and angle a:
// fluted, flared at the foot into buttress roots, closing over at the crown
// where the limbs take its girth.
function boleRadius(t, a) {
  const flute = 1 + 0.16 * Math.sin(a * 5 + t * 1.5) * (1 - t * 0.5) + 0.35 * Math.pow(Math.max(0, Math.sin(a * 5 + 0.7)), 4) * (1 - smooth01(0, 0.35, t));
  return (0.95 + (1 - smooth01(0, 0.3, t)) * 0.55 - t * 0.15) * flute * (1 - smooth01(0.75, 1, t) * 0.75);
}
