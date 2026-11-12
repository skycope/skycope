import * as THREE from "three";
import { groundHeight } from "./terrain.js";
import { capsule } from "./blockers.js";
import { seededRandom } from "./random.js";
import { part, merge, sweep, place, smooth01, srgb, hash, staticMesh } from "./place-kit.js";
import { heightTile } from "./place-lighthouse.js";

// The bones of a wooden coaster, driven bow-first up the beach and half
// swallowed by the sand: a keel, a stem post, doubled frames standing in
// pairs like ribs (broken lower toward the sea, where the surf has had them
// longest), a few strakes of planking still on the high side of the bow,
// and the rusted iron boiler of its little steam engine lying amidships, as
// on the Cape's own wreck beaches. The swash runs in between the ribs.
//
// Local frame: x, z relative to the centre; u along the keel (+ bow), v to
// starboard; y absolute.

const TIMBER = srgb("#6f675b");
const DARK_TIMBER = srgb("#4e463c");
const RUST = srgb("#4a2c1e");

export function buildWreck(p, materials, { light = false, seed = 1 } = {}) {
  const random = seededRandom((seed ^ 0x77ec4) >>> 0 || 1);
  const h = p.heading;
  const fx = Math.sin(h), fz = Math.cos(h);
  const rx = Math.cos(h), rz = -Math.sin(h);
  const L = 17, B = 5.2, D = 2.05;
  const ground = (lx, lz) => groundHeight(p.x + lx, p.z + lz);
  const roll = p.list ?? 0.15;
  // Hull point at station s (−1 stern … 1 bow) and girth t (0 keel … 1
  // gunwale), side ±1, after the hull has settled: listed by `roll` about
  // the keel, the bow lifted where it was driven up the sand.
  const groundAtU = (u) => ground(u * fx, u * fz);
  const keelAt = (u) => {
    const sand = groundAtU(u);
    // Sunk to the bilge amidships and at the stern, the bow riding higher.
    return Math.min(sand, groundAtU(0)) - 0.35 + smooth01(-0.2, 1, u / (L / 2)) * 0.4;
  };
  const halfBreadth = (s) => (B / 2) * Math.pow(Math.max(0, 1 - Math.pow(Math.abs(s), s > 0 ? 2.1 : 3.2)), 0.55);
  const hull = (s, t, side) => {
    const u = s * (L / 2);
    const b = halfBreadth(s);
    // Round bilge and a little tumblehome: the frames turn in at the top,
    // the wine-glass section of a wooden ship.
    const a = t * Math.PI * 0.57;
    const v0 = b * Math.sin(a) * side;
    const y0 = D * (1 - Math.cos(a)) * (1 + Math.max(0, s - 0.6) * 0.6);
    // List: rotate (v, y) about the keel.
    const c = Math.cos(roll), sn = Math.sin(roll);
    const v = v0 * c - y0 * sn;
    const y = v0 * sn + y0 * c;
    return new THREE.Vector3(u * fx + v * rx, keelAt(u) + y, u * fz + v * rz);
  };
  const anchor = (q) => ground(q.x, q.z);
  const wood = { near: [], far: [] };
  const iron = { near: [], far: [] };
  const trunks = [];
  // solid: the timbers the camera keeps out of (blockers.js).
  const blockers = [];
  const C = (q) => ({ x: p.x + q.x, y: q.y, z: p.z + q.z });
  const timberChain = (points, r, extra) => {
    for (let k = 0; k + 1 < points.length; k += 3) {
      const e = Math.min(points.length - 1, k + 3);
      blockers.push(capsule(C(points[k]), C(points[e]), r, extra));
    }
  };
  const timberColour = (q, n, out) => {
    out.copy(TIMBER).lerp(DARK_TIMBER, hash(Math.round(q.x * 3), Math.round(q.z * 3)) * 0.5);
  };
  // Inside the hull, below the sand line, little sky reaches.
  const hullShade = (q) => 0.35 * (1 - smooth01(anchor(q) - 0.1, anchor(q) + 0.8, q.y));

  // Frames: in pairs, every ~0.8 m, each broken off at its own height.
  const stations = 18;
  for (let i = 0; i < stations; i++) {
    const s = -0.93 + (i / (stations - 1)) * 1.8;
    if (random() < 0.12) continue; // long gone
    for (const side of [-1, 1]) {
      // The seaward (stern) half and the low side are worn down most.
      const seaward = 1 - smooth01(-0.6, 0.6, s);
      const low = side * roll < 0 ? 0.2 : 0;
      let top = 1 - seaward * 0.4 - low - random() ** 2 * 0.45;
      if (random() < 0.12) top = 0.08 + random() * 0.15; // a stump
      top = Math.max(0.12, top);
      const n = 7;
      const points = [];
      for (let k = 0; k <= n; k++) points.push(hull(s, (k / n) * top, side));
      const radii = points.map((_, k) => 0.15 * (1 - (k / n) * 0.3));
      const twist = (random() - 0.5) * 0.04;
      for (const q of points) { q.x += twist * rx; q.z += twist * rz; }
      wood.near.push(part(sweep(points, radii, light ? 4 : 5, { roll: Math.PI / 4 }), { colour: timberColour, shade: hullShade, anchor }));
      timberChain(points, 0.16, { body: false });
      wood.far.push(part(sweep(points.filter((_, k) => k % 2 === 0 || k === n), radii.filter((_, k) => k % 2 === 0 || k === n), 3), { colour: timberColour, anchor }));
      // Where it comes out of the sand: a post for the cat to weave round.
      for (let k = 1; k <= n; k++) {
        const q = points[k];
        if (q.y > ground(q.x, q.z) + 0.05) {
          trunks.push({ x: p.x + q.x, z: p.z + q.z, r: 0.14 });
          break;
        }
      }
    }
  }

  // Keel and keelson: a long backbone just breaking the sand.
  {
    const points = [];
    for (let k = 0; k <= 12; k++) points.push(hull(-0.95 + (k / 12) * 1.9, 0, 1).add(new THREE.Vector3(0, 0.12, 0)));
    timberChain(points, 0.2, { body: false });
    wood.near.push(part(sweep(points, points.map(() => [0.2, 0.17]), 4, { roll: Math.PI / 4 }), { colour: timberColour, shade: hullShade, anchor }));
    wood.far.push(part(sweep(points.filter((_, k) => k % 3 === 0), points.filter((_, k) => k % 3 === 0).map(() => 0.2), 3), { colour: timberColour, anchor }));
  }
  // The stem: rising and curving forward from the forefoot.
  {
    const points = [];
    for (let k = 0; k <= 8; k++) {
      const t = k / 8;
      const base = hull(0.95, 0, 1);
      points.push(new THREE.Vector3(base.x + fx * Math.sin(t * 1.2) * 1.0, base.y + 0.1 + t * (D + 1.2), base.z + fz * Math.sin(t * 1.2) * 1.0));
    }
    const radii = points.map((_, k) => 0.17 - k * 0.006);
    timberChain(points, 0.17);
    for (const list of [wood.near, wood.far]) list.push(part(sweep(points, radii, list === wood.near ? 5 : 3, { roll: Math.PI / 4 }), { colour: timberColour, anchor }));
  }
  // Sternpost, snapped off.
  {
    const base = hull(-0.95, 0, 1);
    const points = [base.clone().add(new THREE.Vector3(0, 0.1, 0)), base.clone().add(new THREE.Vector3(-fx * 0.25, 1.4, -fz * 0.25))];
    timberChain(points, 0.17);
    wood.near.push(part(sweep(points, [0.17, 0.14], 5, { roll: Math.PI / 4 }), { colour: timberColour, anchor }));
  }
  // A few strakes of planking still fastened high on the bow, sprung and
  // gapped; and one of the floor timbers' long stringers.
  const highSide = roll > 0 ? 1 : -1;
  const strakes = [[0.8, 0.5, 0.88, highSide], [0.68, 0.62, 0.86, highSide], [0.4, -0.3, 0.2, -highSide]];
  for (const [t, s0, s1, side] of strakes) {
    if (random() < 0.15) continue;
    const points = [];
    const n = Math.max(3, Math.round((s1 - s0) * 9));
    for (let k = 0; k <= n; k++) {
      const s = s0 + (k / n) * (s1 - s0);
      const q = hull(s, t, side);
      // Outside the frames, and sprung a little off them toward the end.
      const out = new THREE.Vector3(side * rx, 0, side * rz).multiplyScalar(0.13 + (k / n) ** 3 * 0.12);
      points.push(q.add(out));
    }
    blockers.push(capsule(C(points[0]), C(points[points.length - 1]), 0.14, { body: false }));
    wood.near.push(part(sweep(points, points.map(() => [0.12, 0.03]), 4, { roll: 0 }), { colour: (q, nn, o) => o.copy(DARK_TIMBER).lerp(TIMBER, 0.4), shade: hullShade, anchor }));
  }

  // The boiler: a riveted iron drum, rolled out of the hull and half sunk
  // in the sand above the swash.
  {
    const c = hull(0.25, 0, 1);
    const off = new THREE.Vector3(rx, 0, rz).multiplyScalar(highSide * 3.4);
    const centre = c.clone().add(off);
    centre.y = ground(centre.x, centre.z) + 0.08;
    const yaw = h + 0.5;
    const m = place(centre.x, centre.y, centre.z, { yaw, roll: Math.PI / 2, pitch: 0.08 });
    iron.near.push(part(new THREE.CylinderGeometry(0.62, 0.62, 2.1, light ? 14 : 20, 1, false), { matrix: m, colour: RUST, anchor }));
    iron.far.push(part(new THREE.CylinderGeometry(0.62, 0.62, 2.1, 8, 1, false), { matrix: m, colour: RUST, anchor }));
    for (const k of [-0.9, -0.3, 0.3, 0.9])
      iron.near.push(part(new THREE.TorusGeometry(0.625, 0.022, 4, light ? 14 : 20), {
        matrix: m.clone().multiply(new THREE.Matrix4().makeTranslation(0, k, 0)).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)),
        colour: RUST,
      }));
    // Fire-tube mouths in the end plate.
    for (const [a, r] of [[0, 0], [0, 0.3], [2.1, 0.3], [4.2, 0.3]])
      iron.near.push(part(new THREE.CylinderGeometry(0.09, 0.09, 0.08, 8), {
        matrix: m.clone().multiply(new THREE.Matrix4().makeTranslation(Math.cos(a) * r, 1.06, Math.sin(a) * r + 0.05)), colour: srgb("#1c120c"),
      }));
    trunks.push({ x: p.x + centre.x, z: p.z + centre.z, r: 0.55 });
    // Its axis: the cylinder's y turned by the roll, then the yaw.
    const ax = -Math.cos(yaw) * 0.75, az = Math.sin(yaw) * 0.75;
    blockers.push(capsule(C({ x: centre.x - ax, y: centre.y, z: centre.z - az }), C({ x: centre.x + ax, y: centre.y, z: centre.z + az }), 0.64, { body: false }));
  }
  // Drift bolts and an iron knee standing proud of the keel.
  for (let k = 0; k < 7; k++) {
    const s = -0.8 + random() * 1.5;
    const q = hull(s, 0, 1);
    const top = q.clone().add(new THREE.Vector3((random() - 0.5) * 0.1, 0.45 + random() * 0.35, (random() - 0.5) * 0.1));
    iron.near.push(part(sweep([q.clone().add(new THREE.Vector3(0, 0.1, 0)), top], [0.028, 0.022], 4), { colour: RUST, anchor }));
  }

  const nearGroup = new THREE.Group();
  const farGroup = new THREE.Group();
  nearGroup.add(staticMesh(merge(wood.near), materials.wood), staticMesh(merge(iron.near), materials.rough));
  farGroup.add(staticMesh(merge(wood.far), materials.wood), staticMesh(merge(iron.far), materials.rough));

  // The keel and boiler tops to stand on.
  const keelTop = (lx, lz) => {
    const u = lx * fx + lz * fz, v = lx * rx + lz * rz;
    if (Math.abs(u) > L / 2 * 0.95 || Math.abs(v) > 0.22) return -Infinity;
    const q = hull(u / (L / 2), 0, 1);
    return q.y + 0.12 + 0.17;
  };
  const domes = [heightTile(p.x, p.z, L / 2 + 0.5, 0.12, (x, z) => keelTop(x - p.x, z - p.z))];
  return { near: nearGroup, far: farGroup, farDistance: 40, obstacles: { trunks, domes }, blockers };
}
