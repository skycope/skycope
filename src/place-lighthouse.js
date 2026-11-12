import * as THREE from "three";
import { groundHeight } from "./terrain.js";
import { part, merge, place, lathe, smooth01, srgb, staticMesh } from "./place-kit.js";

// A small whitewashed lighthouse on the point, as on the Cape's own
// headlands: a tapering masonry tower on a dressed granite plinth, a
// corbelled gallery with an iron railing, a glazed lantern under a red
// cupola, a ventilator ball and a lightning rod; behind it the keeper's
// cottage and a low limewashed wall round the yard. By night the lamp
// turns: places.js draws its beams and flash.
//
// Built in the place's local frame: x, z relative to its centre (coast
// metres), y absolute. +u is seaward (`facing`), +v to its right.

const WHITE = srgb("#d8d3c6");
const RED = srgb("#8a2a1f");
const IRON = srgb("#1b1b1a");
const DOOR = srgb("#2c4535");
const DECK = srgb("#77736b");
const ROOF = srgb("#6b4237");
const LAMP = new THREE.Color(2.6, 2.15, 1.45);
const WINDOW = new THREE.Color(1.25, 0.6, 0.2);

export const TOWER = { height: 12.6, base: 2.25, top: 1.5, plinth: 3.0 };

export function buildLighthouse(p, materials, { light = false } = {}) {
  const φ = p.facing;
  const fx = Math.sin(φ), fz = Math.cos(φ);
  const rx = Math.cos(φ), rz = -Math.sin(φ);
  // Local (u seaward, v right) → offset from the centre in coast x, z.
  const at = (u, v) => [u * fx + v * rx, u * fz + v * rz];
  const ground = (lx, lz) => groundHeight(p.x + lx, p.z + lz);
  const groundUV = (u, v) => ground(...at(u, v));
  const range = (cu, cv, hu, hv) => {
    let lo = Infinity, hi = -Infinity;
    for (let i = -4; i <= 4; i++)
      for (let j = -4; j <= 4; j++) {
        const h = groundUV(cu + (i / 4) * hu, cv + (j / 4) * hv);
        lo = Math.min(lo, h);
        hi = Math.max(hi, h);
      }
    return [lo, hi];
  };
  const frame = (u, y, v, extra = {}) => {
    const [x, z] = at(u, v);
    return place(x, y, z, { ...extra, yaw: φ + (extra.yaw ?? 0) });
  };
  const anchor = (q) => ground(q.x, q.z);

  const [lo, hi] = range(0, 0, TOWER.plinth, TOWER.plinth);
  const yP = hi + 0.45; // plinth top
  const yT = yP + TOWER.height; // tower top (gallery floor)
  const radiusAt = (y) => TOWER.top + (TOWER.base - TOWER.top) * Math.pow(1 - smooth01(yP, yT, y) * 0.999, 1.7);
  const yLamp = yT + 0.22 + 0.73 + 0.75;
  const near = [], far = [];
  const paint = { near: [], far: [] };
  const glow = { near: [], far: [] };
  const stone = { near: [], far: [] };
  const both = (list, make) => {
    list.near.push(make(true));
    list.far.push(make(false));
  };
  const nearOnly = (list, geometry) => list.near.push(geometry);

  // Granite plinth: an octagon of dressed blocks, sunk into the rock.
  both(stone, () => part(new THREE.CylinderGeometry(TOWER.plinth - 0.12, TOWER.plinth, yP - lo + 0.8, 8), {
    matrix: place(0, (yP + lo - 0.8) / 2, 0, { yaw: φ + Math.PI / 8 }),
    colour: srgb("#77706a"),
    anchor,
  }));
  // Two steps up to the door.
  for (let s = 0; s < 2; s++)
    nearOnly(stone, part(new THREE.BoxGeometry(1.6, yP - lo + 0.4 - s * 0.22, 0.55), {
      matrix: frame(-TOWER.plinth - 0.25 - (1 - s) * 0.5, (lo - 0.4 + yP - s * 0.22) / 2 - 0.02, 0),
      colour: srgb("#7a736b"),
      anchor,
    }));

  // The tower and gallery in one lathe: base moulding, the tapering shaft,
  // corbelling out to the gallery deck, and the watch room under the lantern.
  const profile = (rings) => {
    const pts = [[2.45, yP - 0.05], [2.45, yP + 0.3], [radiusAt(yP) + 0.04, yP + 0.38]];
    for (let i = 1; i <= rings; i++) {
      const y = yP + 0.38 + (yT - 0.65 - yP - 0.38) * (i / rings);
      pts.push([radiusAt(y), y]);
    }
    pts.push([1.62, yT - 0.42], [1.86, yT - 0.18], [2.18, yT - 0.02], [2.4, yT], [2.4, yT + 0.2], [1.32, yT + 0.22], [1.32, yT + 0.95], [1.38, yT + 0.98]);
    return pts;
  };
  const towerColour = (q, n, out) => {
    const y = q.y;
    if (y > yT - 0.01 && y < yT + 0.23 && n.y > 0.5) out.copy(DECK);
    else out.copy(WHITE);
  };
  const towerShade = (q) => 0.45 * (1 - smooth01(yP, yP + 0.9, q.y)) + 0.3 * smooth01(yT - 1.2, yT - 0.1, q.y) * (1 - smooth01(yT, yT + 0.1, q.y));
  paint.near.push(part(lathe(profile(16), light ? 20 : 32), { colour: towerColour, shade: towerShade, anchor }));
  paint.far.push(part(lathe(profile(5), 12), { colour: towerColour, shade: towerShade, anchor }));

  // Gallery railing: iron stanchions and two rails.
  const posts = light ? 16 : 24;
  for (let i = 0; i < posts; i++) {
    const a = (i / posts) * Math.PI * 2;
    nearOnly(paint, part(new THREE.BoxGeometry(0.05, 1.0, 0.05), {
      matrix: place(Math.cos(a) * 2.33, yT + 0.2 + 0.5, Math.sin(a) * 2.33),
      colour: IRON,
    }));
  }
  for (const [h, t] of [[1.02, 0.035], [0.52, 0.02]])
    both(paint, (n) => part(new THREE.TorusGeometry(2.33, t, n ? 5 : 3, n ? 48 : 20), {
      matrix: place(0, yT + 0.2 + h, 0, { pitch: Math.PI / 2 }),
      colour: IRON,
    }));

  // The lantern: storm panes (they glow with the lamp at night), astragals,
  // and the cupola, ventilator ball, rod and vane.
  const yG = yT + 0.95;
  const glazing = 1.5;
  both(glow, (n) => part(new THREE.CylinderGeometry(1.24, 1.24, glazing, n ? 12 : 8, 1, true), {
    matrix: place(0, yG + glazing / 2, 0, { yaw: φ }),
    colour: LAMP,
  }));
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + φ;
    nearOnly(paint, part(new THREE.BoxGeometry(0.06, glazing, 0.06), {
      matrix: place(Math.cos(a) * 1.25, yG + glazing / 2, Math.sin(a) * 1.25),
      colour: IRON,
    }));
  }
  both(paint, (n) => part(new THREE.TorusGeometry(1.26, 0.05, 4, n ? 32 : 12), { matrix: place(0, yG + glazing * 0.55, 0, { pitch: Math.PI / 2 }), colour: IRON }));
  const yC = yG + glazing;
  const cupola = [[1.5, yC - 0.02], [1.5, yC + 0.06], [1.32, yC + 0.3], [1.0, yC + 0.62], [0.55, yC + 0.86], [0.2, yC + 0.96], [0.0, yC + 0.98]];
  both(paint, (n) => part(lathe(cupola, n ? 24 : 10), { colour: RED }));
  both(paint, (n) => part(new THREE.SphereGeometry(0.24, n ? 12 : 6, n ? 8 : 4), { matrix: place(0, yC + 1.18, 0), colour: RED }));
  nearOnly(paint, part(new THREE.CylinderGeometry(0.1, 0.12, 0.2, 8), { matrix: place(0, yC + 0.99, 0), colour: IRON }));
  nearOnly(paint, part(new THREE.CylinderGeometry(0.018, 0.025, 1.3, 5), { matrix: place(0, yC + 1.95, 0), colour: IRON }));
  nearOnly(paint, part(new THREE.BoxGeometry(0.03, 0.12, 0.7), { matrix: place(0, yC + 1.75, 0, { yaw: φ + 0.8 }), colour: IRON }));
  nearOnly(paint, part(new THREE.BoxGeometry(0.02, 0.2, 0.22), { matrix: place(Math.sin(φ + 0.8) * 0.3, yC + 1.75, Math.cos(φ + 0.8) * 0.3, { yaw: φ + 0.8 }), colour: IRON }));

  // Door (landward) and the stair windows climbing round the shaft.
  const doorR = radiusAt(yP + 1);
  both(paint, () => part(new THREE.BoxGeometry(1.05, 2.05, 0.5), { matrix: frame(-doorR + 0.2, yP + 1.02, 0), colour: DOOR, anchor }));
  nearOnly(paint, part(new THREE.BoxGeometry(1.45, 0.14, 0.62), { matrix: frame(-doorR + 0.22, yP + 2.15, 0), colour: WHITE }));
  const windows = [[yP + 4.0, 0.45], [yP + 7.3, -0.55], [yP + 10.4, Math.PI - 0.2], [yP + 2.2, Math.PI + 0.9]];
  for (const [y, a] of windows) {
    const r = radiusAt(y);
    const u = Math.cos(a + Math.PI) * (r - 0.2), v = Math.sin(a + Math.PI) * (r - 0.2);
    const yaw = a + Math.PI;
    both(glow, () => part(new THREE.BoxGeometry(0.42, 0.82, 0.45), { matrix: frame(u, y, v, { yaw }), colour: WINDOW }));
    nearOnly(paint, part(new THREE.BoxGeometry(0.58, 0.08, 0.5), {
      matrix: frame(Math.cos(a + Math.PI) * (r - 0.15), y - 0.46, Math.sin(a + Math.PI) * (r - 0.15), { yaw }),
      colour: WHITE,
    }));
  }

  // The keeper's cottage, beside the tower and facing the sea: limewashed,
  // a corrugated-iron roof, a chimney, sash windows, a rainwater tank.
  const cu = -6.5, cv = 4.6, depth = 4.4, width = 7.2;
  const [clo, chi] = range(cu, cv, depth / 2, width / 2);
  const floor = chi + 0.12;
  const wallTop = floor + 2.55;
  const wallShade = (q) => 0.4 * (1 - smooth01(floor - 0.2, floor + 0.7, q.y));
  both(paint, () => part(new THREE.BoxGeometry(width, wallTop - clo + 0.3, depth), {
    matrix: frame(cu, (wallTop + clo - 0.3) / 2, cv),
    colour: WHITE, shade: wallShade, anchor,
  }));
  const pitch = 0.62, overhang = 0.35;
  const slope = (depth / 2 + overhang) / Math.cos(pitch);
  const rise = Math.tan(pitch) * (depth / 2);
  for (const side of [-1, 1]) {
    const m = () => frame(cu + side * (depth / 2 + overhang) / 2, wallTop + rise / 2 - Math.tan(pitch) * overhang / 2 + 0.04, cv, { pitch: side * pitch });
    paint.near.push(part(corrugated(width + 0.6, slope, light ? 0.15 : 0.076, 0.018), { matrix: m(), colour: ROOF }));
    paint.far.push(part(new THREE.BoxGeometry(width + 0.6, 0.05, slope), { matrix: m(), colour: ROOF }));
    // Barge boards along the eaves.
    nearOnly(paint, part(new THREE.BoxGeometry(width + 0.62, 0.16, 0.04), {
      matrix: frame(cu + side * (depth / 2 + overhang - 0.02), wallTop - Math.tan(pitch) * overhang - 0.02, cv),
      colour: WHITE,
    }));
  }
  const gable = new THREE.BufferGeometry();
  gable.setAttribute("position", new THREE.Float32BufferAttribute([-depth / 2, 0, 0, depth / 2, 0, 0, 0, rise, 0, depth / 2, 0, 0, -depth / 2, 0, 0, 0, rise, 0], 3));
  gable.computeVertexNormals();
  for (const side of [-1, 1])
    both(paint, () => part(gable.clone(), { matrix: frame(cu, wallTop, cv + side * width / 2, { yaw: -Math.PI / 2 }), colour: WHITE }));
  gable.dispose();
  both(paint, () => part(new THREE.BoxGeometry(0.75, 1.9, 0.6), { matrix: frame(cu - 0.4, wallTop + 0.7, cv + width / 2 - 0.55), colour: WHITE }));
  nearOnly(paint, part(new THREE.BoxGeometry(0.85, 0.1, 0.7), { matrix: frame(cu - 0.4, wallTop + 1.68, cv + width / 2 - 0.55), colour: srgb("#4a4744") }));
  // Door and sash windows, front (seaward) and back.
  nearOnly(paint, part(new THREE.BoxGeometry(0.95, 2.0, 0.12), { matrix: frame(cu + depth / 2, floor + 1.0, cv + 0.3), colour: DOOR }));
  for (const [u, v] of [[depth / 2, -1.9], [depth / 2, 2.3], [-depth / 2, -1.2], [-depth / 2, 1.6]]) {
    const out = u > 0 ? 1 : -1;
    both(glow, () => part(new THREE.BoxGeometry(0.85, 1.1, 0.12), { matrix: frame(cu + u, floor + 1.45, cv + v), colour: WINDOW.clone().multiplyScalar(0.8) }));
    // Frame, meeting rail and glazing bar, painted white; the sill below.
    for (const [w, h, dv, dy, du] of [[1.0, 0.08, 0, 0.58, 0.02], [1.08, 0.1, 0, -0.6, 0.07], [0.08, 1.2, 0.46, 0, 0.02], [0.08, 1.2, -0.46, 0, 0.02], [0.9, 0.05, 0, 0, 0.03], [0.04, 1.1, 0, 0, 0.03]])
      nearOnly(paint, part(new THREE.BoxGeometry(w, h, 0.14), {
        matrix: frame(cu + u + out * du, floor + 1.45 + dy, cv + v + dv),
        colour: WHITE,
      }));
  }
  // A galvanised rainwater tank on a brick stand at the gable end.
  {
    const tv = cv - width / 2 - 0.95, tu = cu - 0.6;
    const g0 = groundUV(tu, tv);
    nearOnly(paint, part(new THREE.CylinderGeometry(0.62, 0.66, 0.9, 10), { matrix: frame(tu, g0 + 0.18, tv), colour: srgb("#7d5242"), anchor }));
    const rings = [];
    for (let i = 0; i <= 18; i++) rings.push([0.7 + (i % 2 ? 0.025 : 0), g0 + 0.63 + (i / 18) * 1.45]);
    rings.push([0.4, g0 + 2.18], [0.06, g0 + 2.26]);
    both(paint, (n) => part(lathe(rings, n ? 16 : 8), { matrix: frame(tu, 0, tv), colour: srgb("#8d918f") }));
  }

  // The yard wall: limewashed rubble, a rounded coping, following the
  // ground; a gap for the gate on the landward side.
  const wall = yardWall((u, v) => groundUV(u, v), at, { u0: 3.9, u1: -10.6, half: 7.6, cv: 2.1, corner: 3.2 });
  paint.near.push(part(wall.geometry, { colour: WHITE, shade: (q) => 0.35 * (1 - smooth01(ground(q.x, q.z), ground(q.x, q.z) + 0.5, q.y)), anchor }));
  paint.far.push(part(wall.geometry.clone(), { colour: WHITE, anchor }));

  const meshes = (lists) => {
    const group = new THREE.Group();
    const g = merge(lists.paint);
    if (g) group.add(staticMesh(g, materials.paint));
    const s = merge(lists.stone);
    if (s) group.add(staticMesh(s, materials.stone));
    const l = merge(lists.glow);
    if (l) group.add(staticMesh(l, materials.glow, { cast: false }));
    return group;
  };
  const nearGroup = meshes({ paint: paint.near, stone: stone.near, glow: glow.near });
  const farGroup = meshes({ paint: paint.far, stone: stone.far, glow: glow.far });

  // Collision: the plinth stands as a trunk; walls and cottage as one
  // height tile the cat can hop onto (the wall) or not (the cottage).
  const trunks = [{ x: p.x, z: p.z, r: TOWER.plinth + 0.05 }];
  const centre = at(-3.4, 2.1);
  const domes = [heightTile(p.x + centre[0], p.z + centre[1], 10.5, 0.1, (x, z) => {
    const lx = x - p.x, lz = z - p.z;
    const u = lx * fx + lz * fz, v = lx * rx + lz * rz;
    if (Math.abs(u - cu) < depth / 2 && Math.abs(v - cv) < width / 2) {
      return wallTop + rise * (1 - Math.abs(u - cu) / (depth / 2));
    }
    const top = wall.top(u, v);
    return top;
  })];
  return {
    near: nearGroup,
    far: farGroup,
    lamp: { x: p.x, y: yLamp, z: p.z, radius: 1.24 },
    obstacles: { trunks, domes },
  };
}

// A wall along a rounded rectangle in (u, v): returns its geometry (local
// x, z; absolute y) and a height lookup for collision.
function yardWall(groundUV, at, { u0, u1, half, cv = 0, corner }) {
  const thick = 0.42, height = 0.78, gate = 1.1;
  // Perimeter points, every ~0.5 m, counter-clockwise from the gate.
  const path = [];
  const cu = (u0 + u1) / 2, hu = (u0 - u1) / 2;
  const L = 2 * (hu - corner) + 2 * (half - corner) + 2 * Math.PI * corner;
  const n = Math.ceil(L / 0.5);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    // Superellipse-ish rounded rectangle by angle.
    const a = -Math.PI + t * Math.PI * 2;
    const c = Math.cos(a), s = Math.sin(a);
    const k = 6;
    const r = 1 / Math.pow(Math.pow(Math.abs(c) / hu, k) + Math.pow(Math.abs(s) / half, k), 1 / k);
    const u = cu + c * r, v = cv + s * r;
    // The gate: on the landward end, either side of v = 0.
    path.push({ u, v, gap: c < -0.9 && Math.abs(v) < gate });
  }
  const positions = [];
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i], b = path[i + 1];
    if (a.gap || b.gap) continue;
    const du = b.u - a.u, dv = b.v - a.v;
    const len = Math.hypot(du, dv) || 1;
    const nu = -dv / len * thick / 2, nv = du / len * thick / 2;
    const ga = groundUV(a.u, a.v), gb = groundUV(b.u, b.v);
    const ta = ga + height, tb = gb + height;
    // Outer face, inner face, coping (two slopes).
    const quad = (p0, p1, p2, p3) => { positions.push(...p0, ...p1, ...p2, ...p0, ...p2, ...p3); };
    const P = (u, y, v) => { const [x, z] = at(u, v); return [x, y, z]; };
    quad(P(a.u + nu, ga - 0.35, a.v + nv), P(b.u + nu, gb - 0.35, b.v + nv), P(b.u + nu, tb, b.v + nv), P(a.u + nu, ta, a.v + nv));
    quad(P(b.u - nu, gb - 0.35, b.v - nv), P(a.u - nu, ga - 0.35, a.v - nv), P(a.u - nu, ta, a.v - nv), P(b.u - nu, tb, b.v - nv));
    quad(P(a.u + nu, ta, a.v + nv), P(b.u + nu, tb, b.v + nv), P(b.u, tb + 0.1, b.v), P(a.u, ta + 0.1, a.v));
    quad(P(a.u, ta + 0.1, a.v), P(b.u, tb + 0.1, b.v), P(b.u - nu, tb, b.v - nv), P(a.u - nu, ta, a.v - nv));
  }
  // Ends of the gate piers.
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return {
    geometry,
    top(u, v) {
      // Distance to the perimeter in (u, v), coarse: nearest path point.
      let best = Infinity, gap = false;
      for (const q of path) {
        const d = (q.u - u) ** 2 + (q.v - v) ** 2;
        if (d < best) { best = d; gap = q.gap; }
      }
      if (gap || best > (thick / 2 + 0.04) ** 2) return -Infinity;
      return groundUV(u, v) + height + 0.05;
    },
  };
}

// A corrugated sheet: x across (the corrugations run along z), y up.
function corrugated(width, length, pitch, depth) {
  const n = Math.max(2, Math.round(width / (pitch / 2)));
  const positions = [];
  const index = [];
  for (let i = 0; i <= n; i++) {
    const x = -width / 2 + (i / n) * width;
    const y = Math.sin((x / pitch) * Math.PI * 2) * depth;
    positions.push(x, y, -length / 2, x, y, length / 2);
    if (i < n) index.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

// A collision height tile in walker.js's dome format, sampled from fn(x, z)
// (−Infinity where there is nothing to stand on).
export function heightTile(cx, cz, half, cell, fn) {
  const nx = Math.ceil((half * 2) / cell) + 1;
  const nz = nx;
  const x0 = cx - half, z0 = cz - half;
  const heights = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) heights[j * nx + i] = fn(x0 + i * cell, z0 + j * cell);
  return { x0, z0, cell, nx, nz, heights, x: cx, z: cz, r: half };
}
