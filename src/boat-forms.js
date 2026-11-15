import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { part, merge, sweep, lathe, place, srgb, hash, smooth01 } from "./place-kit.js";
import { BOAT } from "./boat-dynamics.js";

// The fisherman's boat, upright and afloat: a clinker-built rowing boat
// grown from one hull function, in its own frame (x across, starboard +;
// y up, 0 at the design waterline amidships; z along, bow +). Pure
// geometry and the deck's height field; boat.js draws and moves it.
//
// Seven lapped strakes a side (each plank's lower edge proud of the one
// below, so every land throws a fine shadow line), painted Cape blue over a
// cream boot-top and red antifouling, a varnished gunwale and rubbing
// strake; inside, buff paint over steam-bent frames, a stem and keelson,
// bare floorboards over a dark bilge, three thwarts and the bow sheets the
// cat stands on, a breasthook, rowlocks, two oars shipped along the
// thwarts, a coil of rope and an orange float. A hurricane lantern hangs
// from a bent iron pole over the stem (a separate piece, so it swings).

export const HULL = {
  half: BOAT.length / 2,
  beam: BOAT.beam,
  // Floorboards and the bilge below them, the thwarts, the bow sheets the
  // cat stands on and the breasthook its front paws rest on (local y).
  floor: 0.07,
  thwart: 0.3,
  sheets: 0.3,
  hook: 0.42,
  strakes: 7,
  plank: 0.016,
};
const H = HULL.half;

// Gunwale height, keel height (outside the planking, at the centreline)
// and half-breadth at the sheer, for s = z / H in [−1, 1].
export function sheer(s) {
  return 0.45 + 0.07 * s * s + 0.11 * Math.max(0, s) ** 3;
}
export function keel(s) {
  return -BOAT.draft + 0.06 * s * s + 0.95 * Math.max(0, s - 0.6) ** 2;
}
export function halfBreadth(s) {
  return (HULL.beam / 2) * (s > 0 ? Math.max(0, 1 - s * s) ** 0.55 : 1 - 0.3 * (-s) ** 2.5);
}
// A point on the hull's outer skin at station s, girth t (0 keel … 1
// gunwale), side ±1. Round bilge amidships, finer and more V toward the bow.
export function hullPoint(s, t, side, out = [0, 0, 0]) {
  const a = t * Math.PI / 2;
  const vee = 1 - 0.45 * Math.max(0, s) ** 2;
  const y = keel(s) + (sheer(s) - keel(s)) * Math.pow(1 - Math.cos(a), vee);
  const v = halfBreadth(s) * Math.pow(Math.sin(a), 0.85) * (1 + 0.03 * t * t);
  out[0] = v * side;
  out[1] = y;
  out[2] = s * H;
  return out;
}
// The skin's half-breadth at height y (local) at station s, inner face.
export function breadthAt(s, y) {
  if (y <= keel(s)) return 0;
  if (y >= sheer(s)) return halfBreadth(s) - HULL.plank;
  let lo = 0, hi = 1;
  const p = [0, 0, 0];
  for (let i = 0; i < 18; i++) {
    const m = (lo + hi) / 2;
    hullPoint(s, m, 1, p);
    if (p[1] < y) lo = m;
    else hi = m;
  }
  hullPoint(s, lo, 1, p);
  return Math.max(0, p[0] - HULL.plank);
}

// The deck the cat stands on (local x, z → local y, or −∞ outside the
// hull): floorboards, thwarts, the bow sheets and the breasthook; the
// gunwale's top round the rim, so a cat cannot walk out over it.
export const THWARTS = [
  { z: 0.15, w: 0.24 },
  { z: -0.95, w: 0.24 },
];
export function deckHeight(x, z) {
  const s = z / H;
  if (s <= -1 || s >= 0.985) return -Infinity;
  const half = halfBreadth(s);
  const ax = Math.abs(x);
  if (ax > half) return -Infinity;
  if (ax > half - 0.06) return sheer(s) + 0.03;
  // Stern sheets: a bench round the transom.
  if (s < -0.72) return HULL.thwart - 0.02;
  if (z > H * 0.78) return HULL.hook;
  if (z > H * 0.5) return HULL.sheets;
  for (const t of THWARTS) if (Math.abs(z - t.z) < t.w / 2) return HULL.thwart;
  return HULL.floor + 0.012;
}

// Where the cat stands aboard (local x, z): on the bow sheets, its front
// paws up on the breasthook, under the lantern.
export const STATION = { x: 0, z: H * 0.66 };
// The lantern's pivot (the pole's hook) and where its flame hangs below it.
export const LANTERN = { pivot: [0, 1.12, H + 0.34], drop: 0.3 };

const TOPSIDE = srgb("#285a7a");
const SHEER_STRAKE = srgb("#1f4b68");
const BOOT = srgb("#d9d2bf");
const ANTIFOUL = srgb("#7a3527");
const VARNISH = srgb("#6b4c32");
const RUBBING = srgb("#c8bfa8");
const BUFF = srgb("#b3a88e");
const FRAME = srgb("#6e4a2a");
const FLOORBOARD = srgb("#8a7a62");
const BILGE = srgb("#2a241c");
const IRON = srgb("#24221e");
const BRASS = srgb("#8f6c2c");
const ROPE = srgb("#9b8a63");
const FLOAT = srgb("#c45a24");
const OAR = srgb("#a99372");

const c1 = new THREE.Color();

// Paint and timber colour for the outer skin at girth t, strake k, height
// y: antifouling below the waterline, a cream boot-top, blue topsides
// (each plank its own slight shade), the darker sheer strake.
export function outerColour(t, k, y, s, out) {
  const n = (hash(k * 7.1, s * 3.3) - 0.5) * 0.06 + (hash(k * 13.7) - 0.5) * 0.1;
  if (y < -0.035) out.copy(ANTIFOUL);
  else if (y < 0.02) out.copy(BOOT);
  else if (k === HULL.strakes - 1) out.copy(SHEER_STRAKE);
  else out.copy(TOPSIDE);
  out.multiplyScalar(1 + n);
  return out;
}

// Baked occlusion for the inside: deep near the keel, open at the gunwale,
// shaded under the thwarts' lee.
function insideShade(y, s) {
  const depth = 1 - smooth01(HULL.floor - 0.05, sheer(s) - 0.05, y);
  return 0.15 + 0.45 * depth;
}

// light: fewer segments (phones).
export function buildBoatForms({ light = false } = {}) {
  const ns = light ? 26 : 40;
  const perStrake = light ? 2 : 3;
  const hull = [];
  const p = [0, 0, 0], q = [0, 0, 0];
  const normalAt = (s, t, side, out) => {
    // The section's outward normal (in the x–y plane, tilted a touch fore
    // and aft by the hull's taper).
    const e = 0.002;
    hullPoint(s, Math.min(1, t + e), side, p);
    hullPoint(s, Math.max(0, t - e), side, q);
    const dx = p[0] - q[0], dy = p[1] - q[1];
    const l = Math.hypot(dx, dy) || 1;
    out[0] = dy / l * side;
    out[1] = -dx / l * side;
    // Sign so it points away from the centreline.
    if (out[0] * side < 0 || (Math.abs(out[0]) < 1e-3 && out[1] > 0)) {
      out[0] = -out[0];
      out[1] = -out[1];
    }
    return out;
  };
  const nrm = [0, 0, 0];
  // The skin the sea meets (outer planking, keel, stem, transom's face,
  // rubbing strake, gunwale): the hull's shader cuts it at the water. The
  // rest is inside a dry hull (see boat.js).
  const outer = [];
  // The lantern's pole: inside the hull, and faded out of the way when it
  // stands between the camera and the cat (boat.js).
  const pole = [];

  // ---- Outer skin: strake by strake, lapped.
  for (const side of [-1, 1]) {
    for (let k = 0; k < HULL.strakes; k++) {
      const positions = [], colours = [], index = [];
      const t0 = k / HULL.strakes, t1 = (k + 1) / HULL.strakes;
      const rows = perStrake + 1;
      for (let i = 0; i <= ns; i++) {
        const s = -1 + (2 * i) / ns;
        for (let j = 0; j <= rows; j++) {
          // Row 0 is the plank's lower edge face (from the plank below's
          // skin out to this plank's face); rows 1… run up the plank.
          const t = j === 0 ? t0 : t0 + ((t1 - t0) * (j - 1)) / (rows - 1);
          const lap = j === 0 ? 0.002 : HULL.plank * (1 - (t - t0) / (t1 - t0)) * 0.8 + 0.002;
          hullPoint(s, t, side, p);
          normalAt(s, t, side, nrm);
          // Planks taper out to nothing at the stem.
          const fade = s > 0.92 ? Math.max(0, (1 - s) / 0.08) : 1;
          positions.push(p[0] + nrm[0] * lap * fade, p[1] + nrm[1] * lap * fade, p[2]);
          outerColour(t, k, p[1], s, c1);
          if (j === 0) c1.multiplyScalar(0.55);
          colours.push(c1.r, c1.g, c1.b);
        }
      }
      for (let i = 0; i < ns; i++)
        for (let j = 0; j < rows; j++) {
          const a = i * (rows + 1) + j, b = a + 1, c = a + rows + 1, d = c + 1;
          if (side < 0) index.push(a, c, b, b, c, d);
          else index.push(a, b, c, b, d, c);
        }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      g.setIndex(index);
      g.computeVertexNormals();
      const cols = colours;
      outer.push(part(g, { colour: indexedColour(g, cols), shade: 0 }));
    }
  }

  // ---- Inner skin: buff paint, the lands drawn as fine darker lines.
  for (const side of [-1, 1]) {
    const nt = HULL.strakes * 3;
    const positions = [], index = [];
    for (let i = 0; i <= ns; i++) {
      const s = -1 + (2 * i) / ns;
      for (let j = 0; j <= nt; j++) {
        const t = j / nt;
        hullPoint(s, t, side, p);
        normalAt(s, t, side, nrm);
        positions.push(p[0] - nrm[0] * HULL.plank, p[1] - nrm[1] * HULL.plank, p[2]);
      }
    }
    for (let i = 0; i < ns; i++)
      for (let j = 0; j < nt; j++) {
        const a = i * (nt + 1) + j, b = a + 1, c = a + nt + 1, d = c + 1;
        if (side < 0) index.push(a, b, c, b, d, c);
        else index.push(a, c, b, b, c, d);
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    g.setIndex(index);
    g.computeVertexNormals();
    hull.push(part(g, {
      colour: (v, n, out) => {
        const s = v.z / H;
        const t = girthOf(s, v.y);
        const land = Math.abs(((t * HULL.strakes) % 1) - 0.02) < 0.05 ? 0.78 : 1;
        out.copy(BUFF).multiplyScalar(land * (0.95 + 0.1 * hash(Math.floor(t * HULL.strakes), 3.1)));
      },
      shade: (v) => insideShade(v.y, v.z / H),
    }));
  }

  // ---- Transom: outside blue (antifouling low), inside buff.
  {
    const outside = [], inside = [];
    const n = 10;
    const z = -H;
    for (let j = 0; j < n; j++) {
      const a0 = hullPoint(-1, j / n, -1, [0, 0, 0]), a1 = hullPoint(-1, j / n, 1, [0, 0, 0]);
      const b0 = hullPoint(-1, (j + 1) / n, -1, [0, 0, 0]), b1 = hullPoint(-1, (j + 1) / n, 1, [0, 0, 0]);
      // Outside face (toward −z), then the inside face a plank further in.
      outside.push(...a0, ...b0, ...a1, ...a1, ...b0, ...b1);
      const i0 = [a0[0], a0[1], z + 0.03], i1 = [a1[0], a1[1], z + 0.03], j0 = [b0[0], b0[1], z + 0.03], j1 = [b1[0], b1[1], z + 0.03];
      inside.push(...i0, ...i1, ...j0, ...i1, ...j1, ...j0);
    }
    const face = (positions) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      g.computeVertexNormals();
      return g;
    };
    outer.push(part(face(outside), { colour: (v, n2, out) => out.copy(v.y < -0.035 ? ANTIFOUL : v.y < 0.02 ? BOOT : TOPSIDE) }));
    hull.push(part(face(inside), { colour: BUFF, shade: (v) => insideShade(v.y, -1) }));
    // A varnished capping on the transom's top edge.
    const pts = [];
    for (let k = 0; k <= 8; k++) {
      const pp = hullPoint(-1, 1, -1 + (2 * k) / 8 < 0 ? -1 : 1, [0, 0, 0]);
      pts.push(new THREE.Vector3(pp[0] * Math.abs(-1 + (2 * k) / 8), sheer(-1) + 0.012, -H + 0.012));
    }
    hull.push(part(sweep(pts, pts.map(() => [0.022, 0.016]), 4), { colour: VARNISH }));
  }

  // ---- Keel, stem and the bilge's floor under the boards.
  {
    const keelPts = [];
    for (let k = 0; k <= 16; k++) {
      const s = -1 + (k / 16) * 1.97;
      keelPts.push(new THREE.Vector3(0, keel(s) - 0.02, s * H));
    }
    outer.push(part(sweep(keelPts, keelPts.map(() => [0.03, 0.035]), 5), { colour: ANTIFOUL }));
    // The stem: from the forefoot up past the sheer, a little raked.
    const stem = [];
    for (let k = 0; k <= 8; k++) {
      const f = k / 8;
      const y = keel(0.985) - 0.01 + (sheer(1) + 0.08 - keel(0.985)) * f;
      stem.push(new THREE.Vector3(0, y, H * 0.985 + 0.04 * f * f + 0.02));
    }
    outer.push(part(sweep(stem, stem.map((v, i) => [0.026, i > 6 ? 0.03 : 0.04]), 6), { colour: (v, n, out) => out.copy(v.y < -0.035 ? ANTIFOUL : v.y < 0.02 ? BOOT : v.y > sheer(1) - 0.02 ? VARNISH : TOPSIDE) }));
    // The bilge: a dark floor just under the boards, so the sea never shows
    // between them.
    const positions = [];
    const nb = 18;
    for (let i = 0; i < nb; i++) {
      const s0 = -0.97 + (i / nb) * 1.6, s1 = -0.97 + ((i + 1) / nb) * 1.6;
      const w0 = breadthAt(s0, HULL.floor - 0.03), w1 = breadthAt(s1, HULL.floor - 0.03);
      const y = HULL.floor - 0.03;
      positions.push(-w0, y, s0 * H, w0, y, s0 * H, -w1, y, s1 * H, w0, y, s0 * H, w1, y, s1 * H, -w1, y, s1 * H);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    g.computeVertexNormals();
    hull.push(part(g, { colour: BILGE, shade: 0.8 }));
  }

  // ---- Frames: steam-bent ribs inside, keel to gunwale.
  const frameCount = light ? 9 : 14;
  for (let f = 0; f < frameCount; f++) {
    const s = -0.9 + (f / (frameCount - 1)) * 1.62;
    for (const side of [-1, 1]) {
      const pts = [];
      for (let j = 0; j <= 7; j++) {
        const t = 0.06 + (j / 7) * 0.92;
        hullPoint(s, t, side, p);
        normalAt(s, t, side, nrm);
        const inset = HULL.plank + 0.012;
        pts.push(new THREE.Vector3(p[0] - nrm[0] * inset, p[1] - nrm[1] * inset, p[2]));
      }
      hull.push(part(sweep(pts, pts.map(() => [0.014, 0.022]), 4, { cap: false }), { colour: FRAME, shade: (v) => insideShade(v.y, s) * 0.8 }));
    }
  }

  // ---- Gunwale, inwale and the rubbing strake.
  for (const side of [-1, 1]) {
    const out = [], inw = [], rub = [];
    for (let k = 0; k <= 24; k++) {
      const s = -0.995 + (k / 24) * 1.975;
      hullPoint(s, 1, side, p);
      const fade = s > 0.9 ? Math.max(0.2, (1 - s) / 0.1) : 1;
      out.push(new THREE.Vector3(p[0] + side * 0.012 * fade, p[1] + 0.012, p[2]));
      inw.push(new THREE.Vector3(p[0] - side * 0.035 * fade, p[1] - 0.012, p[2]));
      hullPoint(s, 0.9, side, q);
      rub.push(new THREE.Vector3(q[0] + side * 0.022 * fade, q[1], q[2]));
    }
    outer.push(part(sweep(out, out.map(() => [0.02, 0.026]), 5), { colour: VARNISH }));
    hull.push(part(sweep(inw, inw.map(() => [0.016, 0.03]), 4), { colour: VARNISH, shade: 0.2 }));
    outer.push(part(sweep(rub, rub.map(() => [0.014, 0.022]), 4), { colour: RUBBING }));
  }

  // ---- Floorboards: five boards with fine gaps, over the bilge.
  {
    const boards = 5;
    const z0 = -H * 0.74, z1 = H * 0.52;
    for (let b = 0; b < boards; b++) {
      const positions = [];
      const steps = 12;
      for (let i = 0; i < steps; i++) {
        const za = z0 + ((z1 - z0) * i) / steps, zb = z0 + ((z1 - z0) * (i + 1)) / steps;
        const wa = breadthAt(za / H, HULL.floor) * 0.96, wb = breadthAt(zb / H, HULL.floor) * 0.96;
        const xa0 = -wa + (2 * wa * b) / boards + 0.006, xa1 = -wa + (2 * wa * (b + 1)) / boards - 0.006;
        const xb0 = -wb + (2 * wb * b) / boards + 0.006, xb1 = -wb + (2 * wb * (b + 1)) / boards - 0.006;
        const y = HULL.floor;
        positions.push(xa0, y, za, xb0, y, zb, xa1, y, za, xa1, y, za, xb0, y, zb, xb1, y, zb);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      g.computeVertexNormals();
      const tone = 0.9 + 0.2 * hash(b * 3.7, 1.1);
      hull.push(part(g, { colour: (v, n, out) => out.copy(FLOORBOARD).multiplyScalar(tone * (0.92 + 0.08 * Math.sin(v.z * 9 + b))), shade: (v) => insideShade(v.y, v.z / H) }));
    }
  }

  // ---- Thwarts, stern sheets, bow sheets and the breasthook.
  const plankBox = (x0, x1, z0, z1, y, thick, colour, shade = 0.3) => {
    const g = new THREE.BoxGeometry(x1 - x0, thick, z1 - z0);
    hull.push(part(g, { matrix: place((x0 + x1) / 2, y - thick / 2, (z0 + z1) / 2), colour, shade }));
  };
  for (const t of THWARTS) {
    const w = breadthAt(t.z / H, HULL.thwart) - 0.005;
    plankBox(-w, w, t.z - t.w / 2, t.z + t.w / 2, HULL.thwart, 0.035, VARNISH, 0.25);
    // A knee under each end, and a pillar to the keelson.
    for (const side of [-1, 1]) plankBox(side * w - 0.05 * side - 0.025, side * w - 0.05 * side + 0.025, t.z - 0.05, t.z + 0.05, HULL.thwart - 0.035, 0.12, FRAME, 0.5);
    plankBox(-0.025, 0.025, t.z - 0.025, t.z + 0.025, HULL.thwart - 0.035, HULL.thwart - HULL.floor - 0.035, FRAME, 0.6);
  }
  // Stern sheets: a bench round the transom, from the transom forward.
  {
    const positions = [];
    const n = 6;
    const za = -H * 0.995, zb = -H * 0.72;
    const y = HULL.thwart - 0.02;
    for (let i = 0; i < n; i++) {
      const z0 = za + ((zb - za) * i) / n, z1 = za + ((zb - za) * (i + 1)) / n;
      const w0 = breadthAt(z0 / H, y), w1 = breadthAt(z1 / H, y);
      positions.push(-w0, y, z0, -w1, y, z1, w0, y, z0, w0, y, z0, -w1, y, z1, w1, y, z1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    g.computeVertexNormals();
    hull.push(part(g, { colour: VARNISH, shade: 0.25 }));
    const w = breadthAt(zb / H, y);
    plankBox(-w, w, zb - 0.02, zb, y - 0.01, 0.16, VARNISH, 0.45);
  }
  // Bow sheets: a triangular seat in the bow, and the breasthook above it.
  {
    const deckPlate = (za, zb, y, colour, shade) => {
      const positions = [];
      const n = 6;
      for (let i = 0; i < n; i++) {
        const z0 = za + ((zb - za) * i) / n, z1 = za + ((zb - za) * (i + 1)) / n;
        const w0 = breadthAt(z0 / H, y), w1 = breadthAt(z1 / H, y);
        positions.push(-w0, y, z0, -w1, y, z1, w0, y, z0, w0, y, z0, -w1, y, z1, w1, y, z1);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      g.computeVertexNormals();
      hull.push(part(g, { colour, shade }));
    };
    deckPlate(H * 0.5, H * 0.79, HULL.sheets, VARNISH, 0.2);
    // Its front edge: a board down to the floor.
    const w = breadthAt(0.5, HULL.sheets);
    plankBox(-w, w, H * 0.5, H * 0.5 + 0.02, HULL.sheets - 0.01, HULL.sheets - HULL.floor, VARNISH, 0.5);
    deckPlate(H * 0.78, H * 0.975, HULL.hook, VARNISH, 0.1);
    const w2 = breadthAt(0.78, HULL.hook);
    plankBox(-w2, w2, H * 0.78, H * 0.78 + 0.02, HULL.hook - 0.005, HULL.hook - HULL.sheets, VARNISH, 0.45);
  }

  // ---- Rowlocks on the gunwale by the main thwart.
  for (const side of [-1, 1]) {
    const z = THWARTS[0].z + 0.28;
    hullPoint(z / H, 1, side, p);
    hull.push(part(new THREE.CylinderGeometry(0.012, 0.012, 0.07, 6), { matrix: place(p[0], p[1] + 0.05, z), colour: BRASS }));
    hull.push(part(new THREE.TorusGeometry(0.03, 0.008, 4, 10, Math.PI), { matrix: place(p[0], p[1] + 0.085, z, { yaw: Math.PI / 2 }), colour: BRASS }));
  }

  // ---- Two oars shipped: looms along the thwarts, blades over the stern.
  for (const side of [-1, 1]) {
    const x0 = side * 0.3;
    const a = new THREE.Vector3(x0, HULL.thwart + 0.025, H * 0.42);
    const b = new THREE.Vector3(side * 0.36, sheer(-1) + 0.05, -H - 0.55);
    const d = new THREE.Vector3().subVectors(b, a);
    hull.push(part(sweep([a, a.clone().addScaledVector(d, 0.2), a.clone().addScaledVector(d, 0.8), b], [0.022, 0.026, 0.024, 0.016], 6), { colour: OAR }));
    const m = new THREE.Matrix4().lookAt(b, a, new THREE.Vector3(0, 1, 0)).setPosition(a.clone().addScaledVector(d, 0.93));
    hull.push(part(new THREE.BoxGeometry(0.13, 0.014, 0.5), { matrix: m, colour: srgb("#b19c78") }));
  }

  // ---- A coil of rope abaft the main thwart, and an orange float.
  {
    const cx = -0.22, cz = THWARTS[0].z - 0.42;
    const pts = [];
    const turns = 4;
    for (let k = 0; k <= turns * 14; k++) {
      const a = (k / 14) * Math.PI * 2;
      const r = 0.16 - (k / (turns * 14)) * 0.08;
      pts.push(new THREE.Vector3(cx + Math.cos(a) * r, HULL.floor + 0.02 + (k / (turns * 14)) * 0.03, cz + Math.sin(a) * r));
    }
    hull.push(part(sweep(pts, pts.map(() => 0.015), 4), { colour: ROPE, shade: 0.35 }));
    hull.push(part(new THREE.SphereGeometry(0.1, 10, 7), { matrix: place(0.25, HULL.floor + 0.09, -H * 0.55), colour: FLOAT, shade: 0.3 }));
  }

  // ---- The lantern pole: iron, from the stem head up and forward.
  {
    const base = new THREE.Vector3(0, sheer(1) + 0.02, H * 0.97);
    const pts = [base, new THREE.Vector3(0, base.y + 0.3, H + 0.04), new THREE.Vector3(0, LANTERN.pivot[1] - 0.02, H + 0.16), new THREE.Vector3(0, LANTERN.pivot[1] + 0.02, LANTERN.pivot[2] - 0.04), new THREE.Vector3(0, LANTERN.pivot[1] - 0.03, LANTERN.pivot[2] + 0.02)];
    pole.push(part(sweep(pts, [0.016, 0.014, 0.013, 0.012, 0.01], 5), { colour: IRON }));
    // Lashed to the stem with a few turns of line.
    for (let k = 0; k < 4; k++) pole.push(part(new THREE.TorusGeometry(0.03, 0.007, 3, 8), { matrix: place(0, base.y + 0.02 + k * 0.025, H * 0.985, { pitch: Math.PI / 2 }), colour: ROPE }));
  }

  // ---- The hurricane lantern itself (its own piece: it swings). Local
  // frame: the pivot at the origin, hanging along −y.
  const lamp = [], glass = [];
  {
    const d = LANTERN.drop;
    // Bail handle.
    const bail = [];
    for (let k = 0; k <= 8; k++) {
      const a = Math.PI * (k / 8);
      bail.push(new THREE.Vector3(Math.cos(a) * 0.07, -0.02 - Math.sin(a) * 0.05 - (d - 0.16) * (1 - Math.sin(a)), 0));
    }
    lamp.push(part(sweep(bail.reverse(), bail.map(() => 0.004), 3), { colour: IRON }));
    // Cap, chimney, guards and the font (the oil tank) below.
    const y0 = -d;
    lamp.push(part(lathe([[0.01, 0.12], [0.03, 0.11], [0.075, 0.07], [0.08, 0.055], [0.06, 0.05]], 14), { matrix: place(0, y0, 0), colour: IRON }));
    lamp.push(part(new THREE.TorusGeometry(0.02, 0.004, 3, 8), { matrix: place(0, y0 + 0.13, 0, { pitch: Math.PI / 2 }), colour: BRASS }));
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + 0.4;
      const pts = [new THREE.Vector3(Math.cos(a) * 0.055, y0 + 0.055, Math.sin(a) * 0.055), new THREE.Vector3(Math.cos(a) * 0.075, y0 - 0.03, Math.sin(a) * 0.075), new THREE.Vector3(Math.cos(a) * 0.06, y0 - 0.1, Math.sin(a) * 0.06)];
      lamp.push(part(sweep(pts, [0.004, 0.004, 0.004], 3), { colour: IRON }));
    }
    lamp.push(part(lathe([[0.001, -0.17], [0.06, -0.165], [0.085, -0.14], [0.08, -0.115], [0.055, -0.105]], 14), { matrix: place(0, y0, 0), colour: BRASS }));
    // The globe: a fat glass bulb round the flame.
    glass.push(part(lathe([[0.04, -0.105], [0.062, -0.08], [0.066, -0.045], [0.056, -0.0], [0.035, 0.035], [0.03, 0.05]], 16), { matrix: place(0, y0, 0), colour: 0xffffff }));
  }

  return {
    hull: skins(merge(outer), merge(hull), merge(pole)),
    lamp: merge(lamp),
    glass: merge(glass),
  };
}

// The cove's mooring post: a weathered timber pile driven into the bottom
// (world y from `bottom` to POST.top, its own frame at the post), leaning a
// little, weed-dark below the tide line, a few turns of line at its ring.
// `skin` 2: cut at the sea's level at the post (boat.js).
export const POST = { top: 0.88, ring: 0.45, radius: 0.075 };
export function buildPost(bottom, seed = 1) {
  const lean = 0.04 + 0.03 * hash(seed, 3.1);
  const dir = hash(seed, 7.7) * Math.PI * 2;
  const at = (y) => (y - bottom) / (POST.top - bottom);
  const pts = [];
  for (let k = 0; k <= 6; k++) {
    const y = bottom + ((POST.top - bottom) * k) / 6;
    pts.push(new THREE.Vector3(Math.cos(dir) * lean * at(y), y, Math.sin(dir) * lean * at(y)));
  }
  const parts = [];
  const timber = srgb("#77705f"), weed = srgb("#2f3322");
  parts.push(part(sweep(pts, pts.map((q, k) => POST.radius * (1 - 0.12 * (k / 6))), 7), {
    colour: (v, n, out) => out.copy(timber).lerp(weed, 1 - smooth01(-0.05, 0.25, v.y)).multiplyScalar(0.85 + 0.3 * hash(Math.floor(v.y * 9), 2.2)),
  }));
  const ringAt = POST.ring;
  const off = new THREE.Vector3(Math.cos(dir) * lean * at(ringAt), 0, Math.sin(dir) * lean * at(ringAt));
  for (let k = 0; k < 3; k++)
    parts.push(part(new THREE.TorusGeometry(POST.radius + 0.008, 0.009, 3, 9), { matrix: place(off.x, ringAt - 0.02 + k * 0.02, off.z, { pitch: Math.PI / 2 }), colour: ROPE }));
  const g = merge(parts);
  g.setAttribute("skin", new THREE.BufferAttribute(new Float32Array(g.attributes.position.count).fill(2), 1));
  return g;
}

// One geometry with a per-vertex `skin`: 1 outside (the sea meets it), 0
// inside,
// −1: inside, and fades when it would hide the cat (the lantern's pole).
function skins(outside, inside, fading) {
  for (const [g, v] of [[outside, 1], [inside, 0], [fading, -1]]) g.setAttribute("skin", new THREE.BufferAttribute(new Float32Array(g.attributes.position.count).fill(v), 1));
  const merged = mergeGeometries([outside, inside, fading], false);
  outside.dispose();
  inside.dispose();
  fading.dispose();
  merged.computeBoundingSphere();
  return merged;
}

// The hull's half-breadth where it meets the water (local y = 0, outside
// the planking) at stations s = −1 … 1 in WATERPLANE.length steps: the
// shader's test of whether a ray reached the inside from above the water.
export const WATERPLANE = Array.from({ length: 9 }, (_, i) => {
  const s = -1 + i / 4;
  return s >= 0.985 ? 0 : breadthAt(Math.min(s, 0.98), 0) + HULL.plank;
});

// The girth parameter of the skin at (s, y): inverse of hullPoint's height.
function girthOf(s, y) {
  let lo = 0, hi = 1;
  const p = [0, 0, 0];
  for (let i = 0; i < 14; i++) {
    const m = (lo + hi) / 2;
    hullPoint(s, m, 1, p);
    if (p[1] < y) lo = m;
    else hi = m;
  }
  return lo;
}

// part() colours by position; an indexed strip's colours come per vertex,
// so look each one up by its position (rounded) in a small map.
function indexedColour(g, colours) {
  const pos = g.attributes.position;
  const map = new Map();
  for (let i = 0; i < pos.count; i++) map.set(key(pos.getX(i), pos.getY(i), pos.getZ(i)), i);
  return (v, n, out) => {
    const i = map.get(key(v.x, v.y, v.z));
    if (i === undefined) return out.copy(TOPSIDE);
    return out.setRGB(colours[i * 3], colours[i * 3 + 1], colours[i * 3 + 2]);
  };
}
function key(x, y, z) {
  return `${Math.round(x * 2e4)},${Math.round(y * 2e4)},${Math.round(z * 2e4)}`;
}
