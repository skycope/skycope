import * as THREE from "three";
import { groundHeight } from "./terrain.js";
import { box, capsule } from "./blockers.js";
import { seededRandom } from "./random.js";
import { part, merge, sweep, place, smooth01, srgb, hash, staticMesh, prop, heightTile } from "./place-kit.js";

// The landward bones of a wooden coaster, driven bow-first up the beach
// above the tide line: the sea has taken everything aft of midships. What
// is left is what lasts on the Cape's wreck beaches: the keel and keelson,
// a line of doubled frames 25 cm square standing in the hull's curve,
// broken at their own heights (lowest toward the sea), the stem rising at
// the bow, a few sprung strakes on the high side, and the riveted Scotch
// boiler of its little steam engine, rolled out of the hull onto the sand
// with its furnace mouth open: a cat-sized way in, where footsteps ring.
//
// Local frame: x, z relative to the centre; u along the keel (+ bow), v to
// starboard; y absolute.

const TIMBER = srgb("#8a8378");
const DARK_TIMBER = srgb("#655d52");
const RUST = srgb("#4a2c1e");
const SOOT = srgb("#1a1310");

export const WRECK = { length: 9, breadth: 4.6, depth: 2.0, frames: 7, frameSize: 0.25, boiler: 1.2, furnace: 0.46 };

export function buildWreck(p, materials, { light = false, seed = 1 } = {}) {
  const random = seededRandom((seed ^ 0x77ec4) >>> 0 || 1);
  const h = p.heading;
  const fx = Math.sin(h), fz = Math.cos(h);
  const rx = Math.cos(h), rz = -Math.sin(h);
  const L = WRECK.length, B = WRECK.breadth, D = WRECK.depth;
  const ground = (lx, lz) => groundHeight(p.x + lx, p.z + lz);
  const at = (u, v) => [u * fx + v * rx, u * fz + v * rz];
  const toUV = (lx, lz) => [lx * fx + lz * fz, lx * rx + lz * rz];
  const roll = p.list ?? 0.15;
  const groundAtU = (u) => ground(u * fx, u * fz);
  // The keel lies just under the sand all along, as the beach has settled
  // round it; the bow rides a little higher where it was driven up.
  const keelAt = (u) => groundAtU(u) - 0.32 + smooth01(0.2, 1, u / (L / 2)) * 0.25;
  // Half-breadth at station t (−1 broken midships … 1 the bow).
  const halfBreadth = (t) => (B / 2) * (t < 0.2 ? 1 : Math.pow(Math.max(0, 1 - ((t - 0.2) / 0.8) ** 2), 0.55));
  // Hull point at station t, girth g (0 keel … 1 gunwale), side ±1: the
  // round bilge and a little tumblehome, listed by `roll` about the keel.
  const hull = (t, g, side) => {
    const u = t * (L / 2);
    const b = halfBreadth(t);
    const a = g * Math.PI * 0.57;
    const v0 = b * Math.sin(a) * side;
    const y0 = D * (1 - Math.cos(a)) * (1 + Math.max(0, t - 0.5) * 0.5);
    const c = Math.cos(roll), sn = Math.sin(roll);
    const v = v0 * c - y0 * sn;
    const y = v0 * sn + y0 * c;
    const [x, z] = at(u, v);
    return new THREE.Vector3(x, keelAt(u) + y, z);
  };
  const anchor = (q) => ground(q.x, q.z);
  const wood = { near: [], far: [] };
  const iron = { near: [], far: [] };
  const trunks = [];
  const solids = [];
  const C = (q) => ({ x: p.x + q.x, y: q.y, z: p.z + q.z });
  const timberColour = (q, n, out) => out.copy(TIMBER).lerp(DARK_TIMBER, hash(Math.round(q.x * 3), Math.round(q.z * 3)) * 0.5);
  const hullShade = (q) => 0.3 * (1 - smooth01(anchor(q) - 0.1, anchor(q) + 0.8, q.y));
  const square = (points, size, list, radial = 4) => list.push(part(sweep(points, points.map(() => size * Math.SQRT1_2), radial, { roll: Math.PI / 4, flat: true }), { colour: timberColour, shade: hullShade, anchor }));

  // Frames: seven pairs, port and starboard, each a 25 cm square grown
  // timber following the hull's curve from the keel, broken off at its
  // own height.
  const highSide = roll > 0 ? 1 : -1;
  for (let i = 0; i < WRECK.frames; i++) {
    const t = -0.86 + (i / (WRECK.frames - 1)) * 1.62;
    for (const side of [-1, 1]) {
      // Lower toward the broken (seaward) end and on the low side; a few
      // snapped short.
      const seaward = 1 - smooth01(-0.8, 0.7, t);
      const low = side === highSide ? 0 : 0.12;
      let top = 0.98 - seaward * 0.35 - low - random() * 0.15;
      if (random() < 0.15) top = 0.5 + random() * 0.15;
      const lean = (random() - 0.5) * 0.06;
      const n = 8;
      const points = [];
      for (let k = 0; k <= n; k++) points.push(hull(t, (k / n) * top, side));
      // Grown frames lean a touch out of true with age.
      points.forEach((q, k) => { q.x += lean * rx * k / n; q.z += lean * rz * k / n; });
      // Where the sand has all but covered one, it is gone from view (a
      // stub reads as a wedge of debris).
      const out = points.findIndex((q) => q.y > ground(q.x, q.z) + 0.1);
      const tip = points[n];
      if (out < 0 || tip.y - ground(tip.x, tip.z) < 0.55) continue;
      square(points, WRECK.frameSize, wood.near);
      square(points.filter((_, k) => k % 2 === 0), WRECK.frameSize * 1.2, wood.far);
      // Where it comes out of the sand: a post the cat walks round.
      trunks.push({ x: p.x + points[out].x, z: p.z + points[out].z, r: 0.17 });
      // The camera keeps out of the standing timber.
      solids.push(capsule(C(points[Math.max(0, out - 1)]), C(tip), 0.18, { body: false }));
    }
  }

  // Keel and keelson: one 30 cm backbone a hand proud of the sand, a path
  // a cat walks along from the broken end to the stem.
  // It runs from the boiler's mouth (below) to the stem.
  const Rb = WRECK.boiler, Rf = WRECK.furnace, Lb = 2.6;
  const uB = -L / 2 + Lb / 2 + 0.25, uMouth = uB + Lb / 2;
  const keelTopAt = (u) => keelAt(u) + 0.32 + 0.2;
  {
    const points = [];
    for (let k = 0; k <= 10; k++) {
      const u = uMouth + 0.05 + (k / 10) * (0.93 * (L / 2) - uMouth - 0.05);
      const [x, z] = at(u, 0);
      points.push(new THREE.Vector3(x, keelTopAt(u) - 0.15, z));
    }
    wood.near.push(part(sweep(points, points.map(() => [0.21, 0.21]), 4, { roll: Math.PI / 4, flat: true }), { colour: timberColour, shade: hullShade, anchor }));
    wood.far.push(part(sweep(points.filter((_, k) => k % 2 === 0), points.filter((_, k) => k % 2 === 0).map(() => 0.21), 4, { roll: Math.PI / 4 }), { colour: timberColour, anchor }));
  }
  // The stem: rising and curving forward from the forefoot.
  {
    const points = [];
    const u0 = 0.96 * (L / 2);
    for (let k = 0; k <= 8; k++) {
      const s = k / 8;
      const [x, z] = at(u0 + Math.sin(s * 1.2) * 0.9, 0);
      points.push(new THREE.Vector3(x, keelAt(u0) + 0.2 + s * (D + 0.6), z));
    }
    for (const list of [wood.near, wood.far]) square(points, 0.28, list, 4);
    solids.push(capsule(C(points[0]), C(points[8]), 0.2, { body: false }));
    const [sx, sz] = at(u0 + 0.35, 0);
    trunks.push({ x: p.x + sx, z: p.z + sz, r: 0.22 });
  }
  // Two strakes of planking still on the high side of the bow, sprung off
  // the frames toward their ends.
  for (const [g, t0, t1] of [[0.78, 0.25, 0.86], [0.62, 0.35, 0.9]]) {
    const points = [];
    const n = 6;
    for (let k = 0; k <= n; k++) {
      const t = t0 + (k / n) * (t1 - t0);
      const q = hull(t, g, highSide);
      const out = new THREE.Vector3(highSide * rx, 0, highSide * rz).multiplyScalar(0.16 + (k / n) ** 3 * 0.1);
      points.push(q.add(out));
    }
    solids.push(capsule(C(points[0]), C(points[n]), 0.14, { body: false }));
    wood.near.push(part(sweep(points, points.map(() => [0.13, 0.03]), 4), { colour: (q, nn, o) => o.copy(DARK_TIMBER).lerp(TIMBER, 0.4), shade: hullShade, anchor }));
  }

  // ---- The boiler --------------------------------------------------------------
  // A Scotch marine boiler, 2.4 m across and 2.6 m long, still lying in the
  // hull where the engine room was, at the broken end on the flat of the
  // beach (beside the hull, up the slope, it was buried to its crown), its
  // furnace mouth facing up the keelson toward the bow: the shell, the
  // front plate with the mouth, the furnace tube going in (a cat walks in;
  // inside it is dark and rings), the back plate.
  const [ox, oz] = at(uB, 0);
  const centre = new THREE.Vector3(ox, 0, oz);
  const mouth = h;
  const ax = Math.sin(mouth), az = Math.cos(mouth);
  const lateral = [az, -ax];
  let gMin = Infinity;
  for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) {
    const g = ground(centre.x + ax * (i / 3) * Lb / 2 + lateral[0] * (j / 3) * Rb, centre.z + az * (i / 3) * Lb / 2 + lateral[1] * (j / 3) * Rb);
    gMin = Math.min(gMin, g);
  }
  // The furnace floor a hand above the sand at the mouth; the shell sunk
  // at least 15 cm into the sand everywhere under it.
  const gMouth = ground(centre.x + ax * Lb / 2, centre.z + az * Lb / 2);
  centre.y = Math.min(gMouth + 0.12 + Rf * 0.82 + 0.32, gMin + Rb - 0.15);
  const tubeY = centre.y - 0.32; // furnace axis, below the boiler's
  const floorY = tubeY - Rf * 0.82; // the flat of the furnace's sooty floor
  const boilerM = new THREE.Matrix4().compose(centre, new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(ax, 0, az)), new THREE.Vector3(1, 1, 1));
  const local = (m) => boilerM.clone().multiply(m);
  const seg = light ? 18 : 28;
  // Shell (open ends), and the far level's closed drum.
  iron.near.push(part(new THREE.CylinderGeometry(Rb, Rb, Lb, seg, 1, true), { matrix: boilerM, colour: RUST, anchor }));
  iron.far.push(part(new THREE.CylinderGeometry(Rb, Rb, Lb, 10, 1, false), { matrix: boilerM, colour: RUST, anchor }));
  // Riveted seams round the shell.
  for (const k of [-1.25, -0.42, 0.42, 1.25])
    iron.near.push(part(new THREE.TorusGeometry(Rb + 0.012, 0.025, 4, seg), { matrix: local(new THREE.Matrix4().makeTranslation(0, k, 0).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2))), colour: RUST }));
  // Back plate: closed.
  iron.near.push(part(new THREE.CircleGeometry(Rb, seg), { matrix: local(new THREE.Matrix4().makeTranslation(0, -Lb / 2 + 0.02, 0).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2))), colour: RUST }));
  // Front plate with the furnace mouth: a ring of triangles from the shell
  // in to the mouth's edge (the mouth sits below the axis).
  {
    const positions = [];
    const n = seg;
    const dy = (tubeY - centre.y); // the mouth's offset (local −z after the turn below)
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
      const o0 = [Math.cos(a0) * Rb, Math.sin(a0) * Rb], o1 = [Math.cos(a1) * Rb, Math.sin(a1) * Rb];
      const i0 = [Math.cos(a0) * Rf, Math.sin(a0) * Rf + dy], i1 = [Math.cos(a1) * Rf, Math.sin(a1) * Rf + dy];
      positions.push(o0[0], 0, -o0[1], i0[0], 0, -i0[1], o1[0], 0, -o1[1], o1[0], 0, -o1[1], i0[0], 0, -i0[1], i1[0], 0, -i1[1]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    g.computeVertexNormals();
    // Plate local: x across, z up becomes the boiler's up (see `up` below).
    const plate = new THREE.Matrix4().makeBasis(new THREE.Vector3(lateral[0], 0, lateral[1]), new THREE.Vector3(ax, 0, az), new THREE.Vector3(0, -1, 0));
    plate.setPosition(centre.x + ax * (Lb / 2 - 0.02), centre.y, centre.z + az * (Lb / 2 - 0.02));
    // Rust on the face that looks out of the boiler, soot on the inside.
    const outward = g.attributes.normal.getY(0) > 0;
    // Doubled for the inside face (one-sided material).
    const back = g.clone();
    const idx = back.attributes.position;
    for (let k = 0; k < idx.count; k += 3) {
      const tx = idx.getX(k + 1), ty = idx.getY(k + 1), tz = idx.getZ(k + 1);
      idx.setXYZ(k + 1, idx.getX(k + 2), idx.getY(k + 2), idx.getZ(k + 2));
      idx.setXYZ(k + 2, tx, ty, tz);
    }
    back.computeVertexNormals();
    iron.near.push(part(g, { matrix: plate, colour: outward ? RUST : SOOT, anchor }));
    iron.near.push(part(back, { matrix: plate, colour: outward ? SOOT : RUST, anchor }));
  }
  // The furnace: a tube 0.92 m across running 2.3 m in, sooty inside,
  // with a flattened floor of ash and sand to walk on.
  {
    const tube = new THREE.CylinderGeometry(Rf, Rf, Lb - 0.18, light ? 12 : 16, 1, true);
    // Inward-facing: flip the winding.
    tube.index.array.reverse();
    tube.computeVertexNormals();
    const m = new THREE.Matrix4().compose(new THREE.Vector3(centre.x + ax * 0.08, tubeY, centre.z + az * 0.08), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(ax, 0, az)), new THREE.Vector3(1, 1, 1));
    iron.near.push(part(tube, { matrix: m, colour: SOOT }));
    // The tube's back wall, seen from inside (the boiler's back plate faces
    // out, and from in here it was a hole onto the sea).
    const cap = new THREE.CircleGeometry(Rf, light ? 12 : 16);
    iron.near.push(part(cap, { matrix: m.clone().multiply(new THREE.Matrix4().makeTranslation(0, -(Lb - 0.18) / 2, 0)).multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2)), colour: SOOT }));
    const floor = new THREE.PlaneGeometry(Rf * 1.1, Lb - 0.3);
    const fm = new THREE.Matrix4().compose(new THREE.Vector3(centre.x + ax * 0.15, floorY, centre.z + az * 0.15), new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0)).premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), mouth)), new THREE.Vector3(1, 1, 1));
    iron.near.push(part(floor, { matrix: fm, colour: srgb("#2a2420") }));
  }

  const nearGroup = new THREE.Group();
  const farGroup = new THREE.Group();
  nearGroup.add(staticMesh(merge(wood.near), materials.timber), staticMesh(merge(iron.near), materials.rust));
  farGroup.add(staticMesh(merge(wood.far), materials.timber), staticMesh(merge(iron.far), materials.rust));

  // ---- Collision -----------------------------------------------------------------
  // The keelson's top to walk along; the boiler: its shell a wall (2 m up),
  // the furnace floor inside.
  const front = { x: centre.x + ax * Lb / 2, z: centre.z + az * Lb / 2 };
  const boilerTop = (lx, lz) => {
    const dx = lx - centre.x, dz = lz - centre.z;
    const along = dx * ax + dz * az, across = dx * lateral[0] + dz * lateral[1];
    if (Math.abs(along) > Lb / 2 + 0.03 || Math.abs(across) > Rb) return -Infinity;
    // In the furnace: its floor, from the mouth to the back of the tube.
    if (Math.abs(across) < Rf * 0.62 && along > -Lb / 2 + 0.3) return floorY;
    return centre.y + Math.sqrt(Math.max(0, Rb * Rb - across * across));
  };
  const keelTop = (lx, lz) => {
    const [u, v] = toUV(lx, lz);
    if (Math.abs(u) > (L / 2) * 0.95 || Math.abs(v) > 0.2) return -Infinity;
    return keelTopAt(u);
  };
  const tiles = [
    heightTile(p.x, p.z, L / 2 + 0.5, 0.1, (x, z) => keelTop(x - p.x, z - p.z)),
    heightTile(p.x + centre.x, p.z + centre.z, Math.hypot(Lb / 2, Rb) + 0.2, 0.08, (x, z) => boilerTop(x - p.x, z - p.z)),
  ];
  // The camera keeps out of the shell but not the furnace: a box over the
  // tube and one each side of it, along the boiler.
  {
    const yaw = mouth;
    const c = C(centre);
    const side = (Rb + Rf * 0.62) / 2;
    solids.push(box(c.x, c.z, yaw, Lb / 2, Rb, tubeY + Rf, centre.y + Rb, { body: false }));
    for (const s of [-1, 1]) solids.push(box(c.x + lateral[0] * s * side, c.z + lateral[1] * s * side, yaw, Lb / 2, (Rb - Rf * 0.62) / 2, gMin - 0.4, tubeY + Rf, { body: false }));
    solids.push(box(c.x - ax * (Lb / 2 - 0.15), c.z - az * (Lb / 2 - 0.15), yaw, 0.15, Rb, gMin - 0.4, centre.y + Rb, { body: false }));
  }

  const inside = { x: p.x + centre.x + ax * 0.2, z: p.z + centre.z + az * 0.2 };
  return prop({
    lod: { near: nearGroup, far: farGroup, farDistance: 40 },
    surfaces: { trunks, tiles, solids },
    covers: [{ kind: "roof", x: inside.x, z: inside.z, yaw: mouth, hu: Lb / 2 - 0.2, hv: Rf * 0.6, y: tubeY + Rf }],
    affordances: [
      { id: "wreck-boiler", kind: "inside", x: inside.x, y: floorY, z: inside.z, r: 0.9, facing: mouth, hint: "a dark cat-sized mouth faces the approach" },
      { id: "wreck-bell", kind: "meow-near", x: inside.x, y: floorY, z: inside.z, r: 0.9, hint: "a meow inside comes back as a bell" },
      { id: "wreck-keelson", kind: "on-top", x: p.x, y: keelTopAt(0), z: p.z, r: L / 2 },
    ],
  });
}
