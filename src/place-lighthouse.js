import * as THREE from "three";
import { groundHeight } from "./terrain.js";
import { COTTAGE } from "./place-layout.js";
import { part, merge, place, lathe, between, smooth01, srgb, staticMesh, prop, pad, heightTile } from "./place-kit.js";
import { box, cylinder } from "./blockers.js";

// A small whitewashed lighthouse on the point, as the Cape's own (Slangkop,
// Danger Point): a tapering masonry tower on a whitewashed apron, on a pad
// levelled into the slope; a corbelled gallery on six brackets with an iron
// rail; a lantern with diagonal astragals under a red dome, ventilator ball
// and lightning rod; a plank door in a deep reveal up two stone steps. Rust
// weeps from the gallery and the window bars, and the sea side is
// salt-grey to head height (the material kit's weathering).
//
// Beside it along the contour, the keeper's cottage: limewashed walls on a
// rubble footing, a red-oxide corrugated roof, a stoep on posts under a
// lean-to on the sea side, sash windows with deep sills (a cat's seat),
// and the galvanised rainwater tank on its stone plinth at the far gable,
// under the downpipe. Two short drystone garden walls stand inland of the
// yard. By night the lamp turns (places.js) and the windows are lit.
//
// Built in the place's local frame: x, z relative to its centre (coast
// metres), y absolute. +u is seaward (`facing`), +v to its right.

const WHITE = srgb("#d8d3c6");
const SILL = srgb("#cfc9bb");
const WORN = srgb("#9c968a"); // paint rubbed off a sill a cat sits on
const RED = srgb("#8a2a1f");
const IRON = srgb("#1d1b1a");
const DOOR = srgb("#2c4535");
const DECK = srgb("#77736b");
const ROOF = srgb("#7a3a2c");
const GALV = srgb("#8d918f");
const STONE = srgb("#77706a");
const PIPE = srgb("#3d3b38");
const LAMP = new THREE.Color(2.6, 2.15, 1.45);
const WINDOW = new THREE.Color(1.0, 0.5, 0.18);

export const TOWER = { height: 12.6, base: 2.25, top: 1.5, apron: 2.6 };

export function buildLighthouse(p, materials, { light = false } = {}) {
  const φ = p.facing;
  const side = p.side ?? 1;
  const fx = Math.sin(φ), fz = Math.cos(φ);
  const rx = Math.cos(φ), rz = -Math.sin(φ);
  // Local (u seaward, v right) → offset from the centre in coast x, z.
  const at = (u, v) => [u * fx + v * rx, u * fz + v * rz];
  const toUV = (lx, lz) => [lx * fx + lz * fz, lx * rx + lz * rz];
  const ground = (lx, lz) => groundHeight(p.x + lx, p.z + lz);
  const groundUV = (u, v) => ground(...at(u, v));
  const stats = (cu, cv, hu, hv, round = false) => {
    let lo = Infinity, hi = -Infinity, sum = 0, n = 0;
    for (let i = -5; i <= 5; i++)
      for (let j = -5; j <= 5; j++) {
        if (round && i * i + j * j > 25) continue;
        const h = groundUV(cu + (i / 5) * hu, cv + (j / 5) * hv);
        lo = Math.min(lo, h); hi = Math.max(hi, h); sum += h; n++;
      }
    return { lo, hi, mean: sum / n };
  };
  const frame = (u, y, v, extra = {}) => {
    const [x, z] = at(u, v);
    return place(x, y, z, { ...extra, yaw: φ + (extra.yaw ?? 0) });
  };
  const anchor = (q) => ground(q.x, q.z);

  const lists = () => ({ limewash: [], rubble: [], iron: [], rust: [], soil: [], glow: [] });
  const near = lists(), far = lists();
  const both = (kind, make) => { near[kind].push(make(true)); far[kind].push(make(false)); };

  // ---- The tower ---------------------------------------------------------
  const R = TOWER.apron;
  const site = stats(0, 0, R, R, true);
  // The apron's top: a hand above the mean ground, never more than a
  // shin's depth under the uphill side (the hill closes over it there).
  const yP = Math.max(site.mean + 0.2, site.hi - 0.4);
  const yT = yP + TOWER.height; // gallery floor
  const radiusAt = (y) => TOWER.top + (TOWER.base - TOWER.top) * Math.pow(1 - smooth01(yP, yT, y) * 0.999, 1.7);
  const yLamp = yT + 0.22 + 0.73 + 0.75;
  // Rust weeping from the gallery's iron down the top of the shaft, and
  // from each window's bars.
  const windows = [[yP + 4.0, 0.45], [yP + 7.3, -0.55], [yP + 10.4, Math.PI - 0.2], [yP + 2.6, Math.PI + 0.9]];
  const windowAt = windows.map(([y, a]) => ({ y, u: Math.cos(a + Math.PI), v: Math.sin(a + Math.PI) }));
  const towerWeep = (q) => {
    let w = 0.85 * smooth01(yT - 3.2, yT - 0.4, q.y) * (1 - smooth01(yT - 0.4, yT, q.y));
    const [u, v] = toUV(q.x, q.z);
    const len = Math.hypot(u, v) || 1;
    for (const k of windowAt) {
      const ang = Math.acos(Math.max(-1, Math.min(1, (u * k.u + v * k.v) / len)));
      if (ang < 0.32 && q.y < k.y - 0.3 && q.y > k.y - 2.6) w = Math.max(w, 0.7 * (1 - (k.y - 0.3 - q.y) / 2.3));
    }
    return w;
  };

  // The apron: a whitewashed ring round the tower's foot, its face carried
  // down below the lowest ground.
  both("limewash", (n) => part(lathe([[R, site.lo - 0.45], [R, yP - 0.05], [R - 0.04, yP], [TOWER.base - 0.05, yP]], n ? (light ? 24 : 36) : 14), { colour: WHITE, anchor, shade: (q) => 0.3 * (1 - smooth01(yP - 0.6, yP, q.y)) }));
  // The levelled pad: the slope graded up to just under the apron's top.
  const towerBank = pad(groundUV, at, { hu: R, hv: R, k: 2, top: yP - 0.3, reach: 2.8, rings: light ? 4 : 6, segments: light ? 28 : 40 });
  near.soil.push(part(towerBank.geometry, { colour: 0xffffff }));
  far.soil.push(part(towerBank.geometry.clone(), { colour: 0xffffff }));

  // The tower and gallery in one lathe: base moulding, the tapering shaft,
  // corbelling out to the gallery deck, and the watch room under the lantern.
  const profile = (rings) => {
    const b = radiusAt(yP);
    const pts = [[b + 0.1, yP - 0.02], [b + 0.1, yP + 0.28], [b + 0.01, yP + 0.36]];
    for (let i = 1; i <= rings; i++) {
      const y = yP + 0.36 + (yT - 0.65 - yP - 0.36) * (i / rings);
      pts.push([radiusAt(y), y]);
    }
    pts.push([1.62, yT - 0.42], [1.86, yT - 0.18], [2.18, yT - 0.02], [2.4, yT], [2.4, yT + 0.2], [1.32, yT + 0.22], [1.32, yT + 0.95], [1.38, yT + 0.98]);
    return pts;
  };
  const towerColour = (q, n, out) => out.copy(q.y > yT - 0.01 && q.y < yT + 0.23 && n.y > 0.5 ? DECK : WHITE);
  const towerShade = (q) => 0.4 * (1 - smooth01(yP, yP + 0.9, q.y)) + 0.3 * smooth01(yT - 1.2, yT - 0.1, q.y) * (1 - smooth01(yT, yT + 0.1, q.y));
  near.limewash.push(part(lathe(profile(18), light ? 20 : 32), { colour: towerColour, shade: towerShade, anchor, weep: towerWeep }));
  far.limewash.push(part(lathe(profile(5), 12), { colour: towerColour, shade: towerShade, anchor }));
  // Six cast brackets under the gallery's overhang.
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + φ + Math.PI / 6;
    const c = Math.cos(a), s = Math.sin(a);
    const r0 = radiusAt(yT - 1.15) - 0.04, r1 = 2.28;
    near.limewash.push(part(new THREE.BoxGeometry(1, 1, 1), {
      matrix: between(new THREE.Vector3(c * r0, yT - 1.15, s * r0), new THREE.Vector3(c * r1, yT - 0.04, s * r1), 0.16, 0.22),
      colour: WHITE, weep: 0.6,
    }));
  }

  // Gallery railing: iron stanchions and two rails.
  const posts = light ? 16 : 24;
  for (let i = 0; i < posts; i++) {
    const a = (i / posts) * Math.PI * 2;
    near.rust.push(part(new THREE.BoxGeometry(0.05, 1.0, 0.05), { matrix: place(Math.cos(a) * 2.33, yT + 0.7, Math.sin(a) * 2.33), colour: IRON }));
  }
  for (const [h, t] of [[1.02, 0.035], [0.52, 0.02]])
    both("rust", (n) => part(new THREE.TorusGeometry(2.33, t, n ? 5 : 3, n ? 48 : 20), { matrix: place(0, yT + 0.2 + h, 0, { pitch: Math.PI / 2 }), colour: IRON }));

  // The lantern: storm panes (lit by night), diagonal astragals, and the
  // dome, ventilator ball, rod and vane.
  const yG = yT + 0.95;
  const glazing = 1.5;
  both("glow", (n) => part(new THREE.CylinderGeometry(1.24, 1.24, glazing, n ? 12 : 8, 1, true), { matrix: place(0, yG + glazing / 2, 0, { yaw: φ }), colour: LAMP }));
  for (let i = 0; i < 10; i++)
    for (const turn of [-1, 1]) {
      const a0 = (i / 10) * Math.PI * 2 + φ, a1 = a0 + turn * (Math.PI / 5);
      near.rust.push(part(new THREE.BoxGeometry(1, 1, 1), {
        matrix: between(new THREE.Vector3(Math.cos(a0) * 1.3, yG, Math.sin(a0) * 1.3), new THREE.Vector3(Math.cos(a1) * 1.3, yG + glazing, Math.sin(a1) * 1.3), 0.045, 0.045),
        colour: IRON,
      }));
    }
  both("rust", (n) => part(new THREE.TorusGeometry(1.27, 0.05, 4, n ? 32 : 12), { matrix: place(0, yG + 0.02, 0, { pitch: Math.PI / 2 }), colour: IRON }));
  const yC = yG + glazing;
  const dome = [[1.5, yC - 0.02], [1.5, yC + 0.06], [1.32, yC + 0.3], [1.0, yC + 0.62], [0.55, yC + 0.86], [0.2, yC + 0.96], [0.0, yC + 0.98]];
  both("limewash", (n) => part(lathe(dome, n ? 24 : 10), { colour: RED }));
  both("limewash", (n) => part(new THREE.SphereGeometry(0.24, n ? 12 : 6, n ? 8 : 4), { matrix: place(0, yC + 1.18, 0), colour: RED }));
  near.rust.push(part(new THREE.CylinderGeometry(0.1, 0.12, 0.2, 8), { matrix: place(0, yC + 0.99, 0), colour: IRON }));
  near.rust.push(part(new THREE.CylinderGeometry(0.018, 0.025, 1.3, 5), { matrix: place(0, yC + 1.95, 0), colour: IRON }));
  near.rust.push(part(new THREE.BoxGeometry(0.03, 0.12, 0.7), { matrix: place(0, yC + 1.75, 0, { yaw: φ + 0.8 }), colour: IRON }));

  // The door, toward the cottage: a plank door in a 0.25 m reveal (jambs
  // and a lintel standing out from the curved wall), up two stone steps.
  const doorDir = side; // ±v
  const rD = radiusAt(yP + 1.2);
  const sill = yP + 0.34;
  const D = (out, y, along) => frame(along, y, doorDir * out, { yaw: Math.PI / 2 });
  both("limewash", () => part(new THREE.BoxGeometry(0.96, 2.0, 0.1), { matrix: D(rD - 0.02, sill + 1.0, 0), colour: DOOR }));
  for (const s of [-1, 1]) near.limewash.push(part(new THREE.BoxGeometry(0.22, 2.25, 0.42), { matrix: D(rD + 0.1, sill + 1.1, s * 0.59), colour: WHITE }));
  near.limewash.push(part(new THREE.BoxGeometry(1.4, 0.26, 0.46), { matrix: D(rD + 0.12, sill + 2.12, 0), colour: WHITE, weep: 0.5 }));
  const steps = [];
  for (let s = 0; s < 2; s++) {
    const out = rD + 0.32 + s * 0.3, top = sill - 0.17 * s;
    const g = groundUV(0, doorDir * out);
    const bottom = Math.min(g, yP) - 0.3;
    near.rubble.push(part(new THREE.BoxGeometry(1.25 + s * 0.2, top - bottom, 0.32), { matrix: D(out, (top + bottom) / 2, 0), colour: STONE, anchor }));
    steps.push({ out, top, half: (1.25 + s * 0.2) / 2 });
  }

  // Stair windows climbing round the shaft: a dark pane flush in the wall
  // inside a whitewashed reveal, a bar across it.
  for (const [y, a] of windows) {
    const r = radiusAt(y);
    const u = Math.cos(a + Math.PI), v = Math.sin(a + Math.PI);
    const yaw = Math.PI / 2 - (a + Math.PI);
    const W = (out, dy, dl, w, h, d, colour, list) => list.push(part(new THREE.BoxGeometry(w, h, d), { matrix: frame(u * (r + out) - v * dl, y + dy, v * (r + out) + u * dl, { yaw }), colour }));
    W(-0.02, 0, 0, 0.4, 0.8, 0.08, WINDOW, near.glow);
    W(-0.02, 0, 0, 0.4, 0.8, 0.08, WINDOW, far.glow);
    W(0.02, 0.47, 0, 0.62, 0.12, 0.2, WHITE, near.limewash);
    W(0.02, -0.47, 0, 0.62, 0.12, 0.24, WHITE, near.limewash);
    for (const s of [-1, 1]) W(0.02, 0, s * 0.26, 0.11, 0.84, 0.2, WHITE, near.limewash);
    W(0.03, 0, 0, 0.03, 0.8, 0.03, IRON, near.rust);
  }

  // ---- The keeper's cottage --------------------------------------------------
  const cu = COTTAGE.u, cv = side * COTTAGE.v, depth = 4.4, width = 7.2;
  const house = stats(cu, cv, depth / 2, width / 2);
  const floor = house.mean + 0.35;
  const wallTop = floor + 2.55;
  const stoepDepth = 1.3;
  const front = cu + depth / 2; // seaward face
  const back = cu - depth / 2;
  const stoep = stats(front + stoepDepth / 2, cv, stoepDepth / 2, width / 2 - 0.2);
  const stoepTop = floor - 0.08;
  const lowest = Math.min(house.lo, stoep.lo);
  const wallShade = (q) => 0.35 * (1 - smooth01(floor - 0.2, floor + 0.7, q.y));
  // Rust weeps from the window bars and the gutter brackets.
  const houseWeep = (q) => 0.45 * smooth01(floor + 1.0, wallTop - 0.1, q.y);
  // Walls on a rubble footing a hand proud of them, carried below the
  // lowest ground (no stone skirt hanging off the hill).
  both("limewash", () => part(new THREE.BoxGeometry(width, wallTop - floor + 0.1, depth), { matrix: frame(cu, (wallTop + floor - 0.1) / 2, cv), colour: WHITE, shade: wallShade, anchor, weep: houseWeep }));
  both("rubble", () => part(new THREE.BoxGeometry(width + 0.14, floor + 0.12 - (house.lo - 0.4), depth + 0.14), { matrix: frame(cu, (floor + 0.12 + house.lo - 0.4) / 2, cv), colour: STONE, shade: 0.15, anchor }));
  // The stoep: a rubble-faced platform the width of the front, with steps
  // down at the end nearest the tower.
  both("rubble", () => part(new THREE.BoxGeometry(width - 0.2, stoepTop - (stoep.lo - 0.4), stoepDepth), { matrix: frame(front + stoepDepth / 2, (stoepTop + stoep.lo - 0.4) / 2, cv), colour: STONE, anchor }));
  const stoepSteps = [];
  {
    const v0 = cv - side * (width / 2 - 0.85);
    let top = stoepTop, out = front + stoepDepth + 0.17;
    for (let s = 0; s < 6; s++) {
      top -= 0.18;
      const g = groundUV(out, v0);
      if (top < g + 0.06) break;
      const bottom = Math.min(g, groundUV(out + 0.2, v0)) - 0.3;
      near.rubble.push(part(new THREE.BoxGeometry(1.1, top - bottom, 0.34), { matrix: frame(out, (top + bottom) / 2, v0), colour: STONE, anchor }));
      stoepSteps.push({ u: out, v: v0, top });
      out += 0.32;
    }
  }
  // The main roof: two flat sheets of corrugated iron (the ribs are the
  // iron material's), barge boards, gables, a chimney at the far end.
  const pitch = 0.62, overhang = 0.35;
  const slope = (depth / 2 + overhang) / Math.cos(pitch);
  const rise = Math.tan(pitch) * (depth / 2);
  const eave = wallTop - Math.tan(pitch) * overhang;
  for (const s of [-1, 1]) {
    const m = frame(cu + s * (depth / 2 + overhang) / 2, wallTop + rise / 2 - Math.tan(pitch) * overhang / 2 + 0.04, cv, { pitch: s * pitch });
    both("iron", () => part(new THREE.BoxGeometry(width + 0.6, 0.03, slope), { matrix: m, colour: ROOF }));
    near.limewash.push(part(new THREE.BoxGeometry(width + 0.62, 0.16, 0.04), { matrix: frame(cu + s * (depth / 2 + overhang - 0.02), eave - 0.02, cv), colour: WHITE }));
  }
  {
    const gable = new THREE.BufferGeometry();
    gable.setAttribute("position", new THREE.Float32BufferAttribute([-depth / 2, 0, 0, depth / 2, 0, 0, 0, rise, 0, depth / 2, 0, 0, -depth / 2, 0, 0, 0, rise, 0], 3));
    gable.computeVertexNormals();
    for (const s of [-1, 1]) both("limewash", () => part(gable.clone(), { matrix: frame(cu, wallTop, cv + s * width / 2, { yaw: -Math.PI / 2 }), colour: WHITE }));
    gable.dispose();
  }
  const farEnd = cv + side * (width / 2 - 0.55);
  both("limewash", () => part(new THREE.BoxGeometry(0.75, 1.9, 0.6), { matrix: frame(cu - 0.4, wallTop + 0.7, farEnd), colour: WHITE, weep: 0.3 }));
  near.rubble.push(part(new THREE.BoxGeometry(0.85, 0.1, 0.7), { matrix: frame(cu - 0.4, wallTop + 1.68, farEnd), colour: srgb("#4a4744") }));
  // The stoep's lean-to: an iron sheet off the wall on four white posts.
  {
    const hi = wallTop - 0.25, lo = floor + 2.15;
    const run = Math.hypot(stoepDepth + 0.15, hi - lo), tilt = Math.atan2(hi - lo, stoepDepth + 0.15);
    both("iron", () => part(new THREE.BoxGeometry(width - 0.1, 0.03, run), { matrix: frame(front + (stoepDepth + 0.15) / 2, (hi + lo) / 2, cv, { pitch: tilt }), colour: ROOF }));
    for (let k = 0; k < 4; k++) {
      const v = cv + (k / 3 - 0.5) * (width - 0.5);
      near.limewash.push(part(new THREE.BoxGeometry(0.1, lo - stoepTop, 0.1), { matrix: frame(front + stoepDepth - 0.1, (lo + stoepTop) / 2, v), colour: WHITE }));
    }
    near.limewash.push(part(new THREE.BoxGeometry(width - 0.3, 0.12, 0.1), { matrix: frame(front + stoepDepth - 0.1, lo + 0.04, cv), colour: WHITE }));
  }
  // Sash windows on the stoep, with deep sills at a cat's hop: one worn
  // pale where a cat has sat (its hint). A small window high in the back
  // wall; the door on the gable nearest the tower.
  const sills = [];
  const sash = (u, v, out, bottom, h, w, seat) => {
    const F = (du, dy, dv, bw, bh, bd, colour) => near.limewash.push(part(new THREE.BoxGeometry(bw, bh, bd), { matrix: frame(u + out * du, bottom + dy, v + dv), colour }));
    both("glow", () => part(new THREE.BoxGeometry(w, h, 0.06), { matrix: frame(u + out * 0.01, bottom + h / 2, v), colour: WINDOW }));
    F(0.05, h + 0.05, 0, w + 0.16, 0.1, 0.12, WHITE);
    for (const s of [-1, 1]) F(0.05, h / 2, s * (w / 2 + 0.04), 0.08, h + 0.1, 0.12, WHITE);
    F(0.05, h / 2, 0, w, 0.05, 0.08, WHITE);
    F(0.05, h / 2, 0, 0.04, h, 0.08, WHITE);
    if (seat) {
      // The sill: 0.3 m deep, a hop up from the stoep.
      F(0.15, -0.03, 0, w + 0.3, 0.07, 0.32, seat === "worn" ? WORN : SILL);
      sills.push({ u: u + out * 0.15, v, top: bottom + 0.005, half: (w + 0.3) / 2 });
    }
  };
  const sillY = stoepTop + 0.48;
  sash(front, cv - side * 1.7, 1, sillY + 0.04, 1.1, 0.85, "worn");
  sash(front, cv + side * 1.9, 1, sillY + 0.04, 1.1, 0.85, "sill");
  sash(back, cv + side * 0.6, -1, floor + 1.45, 0.6, 0.7, false);
  // Door on the near gable, up a step from the yard.
  {
    const vEnd = cv - side * width / 2;
    near.limewash.push(part(new THREE.BoxGeometry(0.12, 2.0, 0.95), { matrix: frame(cu + 0.4, floor + 1.0, vEnd - side * 0.03), colour: DOOR }));
    const g = groundUV(cu + 0.4, vEnd - side * 0.35);
    if (floor - g > 0.12) near.rubble.push(part(new THREE.BoxGeometry(0.4, floor - 0.02 - (g - 0.3), 1.2), { matrix: frame(cu + 0.4, (floor - 0.02 + g - 0.3) / 2, vEnd - side * 0.27), colour: STONE, anchor }));
  }
  // The rainwater tank: galvanised corrugated iron on a stone plinth past
  // the far gable's back corner, under the downpipe from the gutter.
  const tank = { u: back + 0.3, v: cv + side * (width / 2 + 0.8), r: 0.72 };
  {
    const t = stats(tank.u, tank.v, 0.8, 0.8);
    const plinthTop = t.hi + 0.35;
    both("rubble", (n) => part(new THREE.CylinderGeometry(0.8, 0.86, plinthTop - (t.lo - 0.35), n ? 12 : 8), { matrix: frame(tank.u, (plinthTop + t.lo - 0.35) / 2, tank.v), colour: STONE, anchor }));
    const ring = [[0.02, plinthTop], [tank.r, plinthTop], [tank.r, plinthTop + 1.8], [0.42, plinthTop + 1.95], [0.06, plinthTop + 2.02]];
    both("iron", (n) => part(lathe(ring, n ? 18 : 8), { matrix: frame(tank.u, 0, tank.v), colour: GALV }));
    tank.top = plinthTop + 1.95;
    near.rust.push(part(new THREE.CylinderGeometry(0.04, 0.04, eave - tank.top, 6), { matrix: frame(back - 0.2, (eave + tank.top) / 2, cv + side * (width / 2 + 0.3)), colour: PIPE }));
  }

  // ---- Two drystone garden walls inland of the yard ------------------------
  // Stones in two courses and a cap, stepping with the ground (not a
  // ribbon riding the slope), 0.6 m high: a hop for a cat.
  const walls = [];
  const drystone = (u0, v0, u1, v1, seedK) => {
    const len = Math.hypot(u1 - u0, v1 - v0), du = (u1 - u0) / len, dv = (v1 - v0) / len;
    const yaw = Math.atan2(dv, du); // along the run, in the u, v frame
    const n = Math.round(len / 0.5);
    const seg = [];
    for (let i = 0; i < n; i++) {
      const s = (i + 0.5) * (len / n);
      const u = u0 + du * s, v = v0 + dv * s;
      const hs = [groundUV(u, v), groundUV(u + dv * 0.25, v - du * 0.25), groundUV(u - dv * 0.25, v + du * 0.25)];
      seg.push({ u, v, g: Math.max(...hs), lo: Math.min(...hs) });
    }
    // Stepped tops: the cap holds level until the ground moves 12 cm.
    let level = seg[0].g + 0.6;
    for (const q of seg) {
      if (Math.abs(q.g + 0.6 - level) > 0.12) level = q.g + 0.6;
      q.top = level;
    }
    const jitter = (i, k) => Math.abs(Math.sin(i * 12.9898 + k * 78.233 + seedK) * 43758.5453) % 1;
    const yaw2 = φ + Math.PI / 2 - yaw;
    seg.forEach((q, i) => {
      for (let c = 0; c < 3; c++) {
        const y0 = c === 0 ? q.lo - 0.25 : q.top - 0.6 + c * 0.24;
        const y1 = c === 0 ? q.top - 0.36 : c === 1 ? q.top - 0.12 : q.top;
        const j = jitter(i, c);
        const [x, z] = at(q.u, q.v);
        near.rubble.push(part(new THREE.BoxGeometry(0.52 + j * 0.06, Math.max(0.1, y1 - y0) - 0.015, c === 2 ? 0.34 : 0.46 - c * 0.04), {
          matrix: place(x, (y0 + y1) / 2, z, { yaw: yaw2 + (j - 0.5) * 0.12, roll: (j - 0.5) * 0.05 }),
          colour: STONE.clone().multiplyScalar(0.82 + j * 0.3), anchor,
        }));
      }
    });
    far.rubble.push(part(new THREE.BoxGeometry(len, 0.6, 0.45), { matrix: frame((u0 + u1) / 2, seg[Math.floor(n / 2)].top - 0.3, (v0 + v1) / 2, { yaw: Math.PI / 2 - yaw }), colour: STONE }));
    walls.push({ seg, u0, v0, len, yaw });
  };
  drystone(-4.0, side * 1.2, -4.0, side * 5.2, 1);
  drystone(back - 0.6, cv + side * (width / 2 - 0.3), back - 4.6, cv + side * (width / 2 - 0.3), 2);

  const meshes = (lists) => {
    const group = new THREE.Group();
    for (const kind of ["limewash", "rubble", "iron", "rust", "soil"]) {
      const g = merge(lists[kind]);
      if (g) group.add(staticMesh(g, materials[kind], { cast: kind !== "soil" }));
    }
    const l = merge(lists.glow);
    if (l) group.add(staticMesh(l, materials.glow, { cast: false }));
    return group;
  };
  const nearGroup = meshes(near);
  const farGroup = meshes(far);

  // ---- Collision ---------------------------------------------------------------
  // One surface for the compound: the apron and its pad, the door steps,
  // the cottage (its roof: a wall from the ground), stoep, steps, sills,
  // tank and the garden walls.
  const towerR = radiusAt(yP) + 0.1;
  const inBox = (a, b, ca, cb, ha, hb) => Math.abs(a - ca) <= ha && Math.abs(b - cb) <= hb;
  const heightUV = (u, v) => {
    let h = -Infinity;
    const r = Math.hypot(u, v);
    if (r < towerR) return yT; // the tower: a wall (its trunk stops the cat)
    if (r <= R) h = yP;
    h = Math.max(h, towerBank.height(u, v));
    for (const s of steps) if (inBox(v * doorDir, u, s.out, 0, 0.16, s.half)) h = Math.max(h, s.top);
    if (inBox(u, v, cu, cv, depth / 2 + 0.07, width / 2 + 0.07)) h = Math.max(h, wallTop + rise * (1 - Math.abs(u - cu) / (depth / 2)));
    if (inBox(u, v, front + stoepDepth / 2, cv, stoepDepth / 2, width / 2 - 0.1)) h = Math.max(h, stoepTop);
    for (const s of stoepSteps) if (inBox(u, v, s.u, s.v, 0.17, 0.55)) h = Math.max(h, s.top);
    for (const s of sills) if (inBox(u, v, s.u, s.v, 0.16, s.half)) h = Math.max(h, s.top);
    if (Math.hypot(u - tank.u, v - tank.v) < 0.86) h = Math.max(h, tank.top);
    for (const w of walls) {
      const du = Math.cos(w.yaw), dv = Math.sin(w.yaw);
      const t = (u - w.u0) * du + (v - w.v0) * dv;
      const across = Math.abs(-(u - w.u0) * dv + (v - w.v0) * du);
      if (t < 0 || t > w.len || across > 0.24) continue;
      const q = w.seg[Math.min(w.seg.length - 1, Math.floor((t / w.len) * w.seg.length))];
      h = Math.max(h, q.top);
    }
    return h;
  };
  const span = COTTAGE.v + width / 2 + 2.5;
  const [mx, mz] = at(-1.6, side * (span / 2 - 3.2));
  const tiles = [heightTile(p.x + mx, p.z + mz, span / 2 + 3.6, 0.1, (x, z) => heightUV(...toUV(x - p.x, z - p.z)))];
  const trunks = [{ x: p.x, z: p.z, r: towerR - 0.05 }];

  // What the camera keeps out of (blockers.js): apron, tower and lantern,
  // the cottage with its stoep roof and tank (one solid), the garden walls.
  const W = (u, v) => { const [x, z] = at(u, v); return { x: p.x + x, z: p.z + z }; };
  const solids = [
    cylinder(p.x, p.z, R, site.lo - 0.6, yP, { body: false }),
    cylinder(p.x, p.z, 2.45, yP, yC + 1.3, { above: true }),
  ];
  {
    const c = W(cu + stoepDepth / 2 - 0.15, cv + side * 0.65);
    solids.push(box(c.x, c.z, φ, (depth + stoepDepth) / 2 + overhang + 0.2, width / 2 + 1.05, lowest - 0.6, wallTop + rise + 0.15, { body: false }));
  }
  for (const w of walls) {
    const m = W(w.u0 + Math.cos(w.yaw) * w.len / 2, w.v0 + Math.sin(w.yaw) * w.len / 2);
    const [ax, az] = at(Math.cos(w.yaw), Math.sin(w.yaw));
    const lo = Math.min(...w.seg.map((q) => q.lo)), hi = Math.max(...w.seg.map((q) => q.top));
    solids.push(box(m.x, m.z, Math.atan2(ax, az), w.len / 2, 0.25, lo - 0.3, hi, { body: false }));
  }

  const [wx, wz] = at(front + stoepDepth / 2, cv);
  const seat = sills[0];
  const [sx, sz] = at(seat.u, seat.v);
  const [dx, dz] = at(0, doorDir * (rD + 0.9));
  const [cx, cz] = at(cu, cv);
  return prop({
    lod: { near: nearGroup, far: farGroup },
    // What a ceremony frames (journey.js): the apron the tower stands on
    // (the walk surface at its centre is the tower's own top) and the
    // ventilator ball on the dome.
    frame: { foot: yP, top: yC + 1.2 },
    surfaces: { trunks, tiles, solids },
    covers: [
      { kind: "roof", x: p.x + cx, z: p.z + cz, yaw: φ, hu: depth / 2 + overhang, hv: width / 2 + overhang, y: wallTop },
      { kind: "eave", x: p.x + wx, z: p.z + wz, yaw: φ, hu: stoepDepth / 2 + 0.1, hv: width / 2, y: floor + 2.1 },
    ],
    lights: [
      { kind: "lamp", x: p.x, y: yLamp, z: p.z, radius: 1.24, colour: [1.0, 0.8, 0.5] },
      // land-magic: the cottage's lit windows spill warm light on the stoep.
      { kind: "window", x: p.x + wx, y: floor + 1.2, z: p.z + wz, colour: [1.0, 0.62, 0.3], reach: 4.5, power: 0.9 },
    ],
    affordances: [
      { id: "lighthouse-light", kind: "meow-near", x: p.x, y: yP, z: p.z, r: 40, hint: "at night the beam crosses the cat every 12 s" },
      { id: "lighthouse-door", kind: "sit-near", x: p.x + dx, y: steps[1].top, z: p.z + dz, r: 1.2, facing: φ + doorDir * Math.PI / 2 },
      { id: "cottage-sill", kind: "perch", x: p.x + sx, y: seat.top, z: p.z + sz, r: 0.45, facing: φ, hint: "one sill is worn pale" },
      { id: "cottage-stoep", kind: "sit-near", x: p.x + wx, y: stoepTop, z: p.z + wz, r: 1.6, facing: φ, hint: "dry under the lean-to in rain" },
    ],
  });
}
