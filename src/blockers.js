// Solid volumes the camera must not enter and the cat must not walk through:
// the landmarks' walls, towers, timbers and limbs (places.js), as a few
// cheap primitives in coast metres:
//
//   box(x, z, yaw, hu, hv, y0, y1)  – an upright box, half-lengths hu along
//                                      (sin yaw, cos yaw) and hv across it
//   cylinder(x, z, r, y0, y1)       – an upright cylinder
//   capsule(a, b, r)                – a sphere-swept segment ({ x, y, z } ends)
// `lens: false` keeps a primitive out of the camera's way (a penguin is too
// small to pull the arm in for).
//
//   roof(x0, z0, cell, n, under, over) – a coarse crown: per cell, solid
//                                      between `under` and `over` (the
//                                      milkwood's leaves and limbs)
//
// Each is a signed distance; the camera's spring arm sphere-traces its boom
// through them and the cat's body probes them (walker.js). Primitives with
// `body: false` stop only the camera (the cat stands on them through the
// height tiles, or walks under them). Bucketed in 4 m cells once; moving
// ones (`bodies`, rewritten in place by their owner, `live` when present)
// are few and are tested directly. Nothing allocates per query.

const CELL = 4;
const KEY = (i, j) => i * 4096 + j;

export function box(x, z, yaw, hu, hv, y0, y1, extra = {}) {
  return { k: 0, x, z, ux: Math.sin(yaw), uz: Math.cos(yaw), hu, hv, y0, y1, r: Math.hypot(hu, hv), mark: 0, ...extra };
}
export function cylinder(x, z, r, y0, y1, extra = {}) {
  return { k: 1, x, z, rad: r, y0, y1, r, mark: 0, ...extra };
}
export function capsule(a, b, r, extra = {}) {
  return setCapsule({ k: 2, mark: 0, ...extra }, a.x, a.y, a.z, b.x, b.y, b.z, r);
}
// Rewrites a capsule in place (moving bodies).
export function setCapsule(c, ax, ay, az, bx, by, bz, r) {
  c.ax = ax; c.ay = ay; c.az = az; c.bx = bx; c.by = by; c.bz = bz; c.rad = r;
  c.x = (ax + bx) / 2; c.z = (az + bz) / 2;
  c.y0 = Math.min(ay, by) - r; c.y1 = Math.max(ay, by) + r;
  c.r = Math.hypot(ax - bx, az - bz) / 2 + r;
  return c;
}
// A crown over an n×n grid of `cell` metres from (x0, z0): solid from
// under[i] to over[i] (under = Infinity where the cell is open).
export function roof(x0, z0, cell, n, under, over, extra = {}) {
  const half = (n * cell) / 2;
  let y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < under.length; i++) if (under[i] < over[i]) { y0 = Math.min(y0, under[i]); y1 = Math.max(y1, over[i]); }
  return { k: 3, x0, z0, cell, n, under, over, x: x0 + half, z: z0 + half, r: half * Math.SQRT2, y0, y1, body: false, mark: 0, ...extra };
}

// Signed distance from (x, y, z) to one primitive (a lower bound for the
// roof, whose steps are kept within a cell).
export function primitiveDistance(p, x, y, z) {
  if (p.k === 2) {
    const vx = p.bx - p.ax, vy = p.by - p.ay, vz = p.bz - p.az;
    const wx = x - p.ax, wy = y - p.ay, wz = z - p.az;
    const l2 = vx * vx + vy * vy + vz * vz;
    const t = l2 > 1e-9 ? Math.max(0, Math.min(1, (wx * vx + wy * vy + wz * vz) / l2)) : 0;
    return Math.hypot(wx - vx * t, wy - vy * t, wz - vz * t) - p.rad;
  }
  if (p.k === 3) {
    const u = (x - p.x0) / p.cell, v = (z - p.z0) / p.cell;
    const i = Math.floor(u), j = Math.floor(v);
    if (i < 0 || j < 0 || i >= p.n || j >= p.n) {
      // Outside the grid: the distance to its footprint.
      const ox = Math.max(p.x0 - x, x - (p.x0 + p.n * p.cell), 0);
      const oz = Math.max(p.z0 - z, z - (p.z0 + p.n * p.cell), 0);
      return Math.max(Math.hypot(ox, oz), p.cell * 0.25);
    }
    const k = j * p.n + i;
    const lo = p.under[k], hi = p.over[k];
    if (!(lo < hi)) return p.cell * 0.5;
    if (y < lo) return Math.min(lo - y, p.cell * 0.5);
    if (y > hi) return Math.min(y - hi, p.cell * 0.5);
    return -Math.min(y - lo, hi - y);
  }
  const hy = (p.y1 - p.y0) / 2;
  const qy = Math.abs(y - (p.y0 + p.y1) / 2) - hy;
  const dx = x - p.x, dz = z - p.z;
  if (p.k === 1) {
    const qr = Math.hypot(dx, dz) - p.rad;
    const ox = Math.max(qr, 0), oy = Math.max(qy, 0);
    return Math.hypot(ox, oy) + Math.min(Math.max(qr, qy), 0);
  }
  const qu = Math.abs(dx * p.ux + dz * p.uz) - p.hu;
  const qv = Math.abs(dx * p.uz - dz * p.ux) - p.hv;
  const ou = Math.max(qu, 0), ov = Math.max(qv, 0), oy = Math.max(qy, 0);
  return Math.hypot(ou, ov, oy) + Math.min(Math.max(qu, qv, qy), 0);
}

export function createBlockers(list = [], bodies = []) {
  const cells = new Map();
  for (const p of list) {
    const pad = 1;
    for (let i = Math.floor((p.x - p.r - pad) / CELL); i <= Math.floor((p.x + p.r + pad) / CELL); i++)
      for (let j = Math.floor((p.z - p.r - pad) / CELL); j <= Math.floor((p.z + p.r + pad) / CELL); j++) {
        const key = KEY(i, j);
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(p);
      }
  }
  // The primitives near a segment's footprint, gathered once per query.
  const near = [];
  let count = 0;
  let stamp = 0;
  const gather = (x0, z0, x1, z1, margin, bodyOnly = false) => {
    stamp++;
    count = 0;
    const i0 = Math.floor((Math.min(x0, x1) - margin) / CELL), i1 = Math.floor((Math.max(x0, x1) + margin) / CELL);
    const j0 = Math.floor((Math.min(z0, z1) - margin) / CELL), j1 = Math.floor((Math.max(z0, z1) + margin) / CELL);
    for (let i = i0; i <= i1; i++)
      for (let j = j0; j <= j1; j++) {
        const c = cells.get(KEY(i, j));
        if (!c) continue;
        for (const p of c) {
          if (p.mark === stamp || (bodyOnly ? p.body === false : p.lens === false)) continue;
          p.mark = stamp;
          near[count++] = p;
        }
      }
    for (const p of bodies) {
      if (p.live === false || (bodyOnly ? p.body === false : p.lens === false)) continue;
      if (Math.abs(p.x - (x0 + x1) / 2) > Math.abs(x1 - x0) / 2 + p.r + margin) continue;
      if (Math.abs(p.z - (z0 + z1) / 2) > Math.abs(z1 - z0) / 2 + p.r + margin) continue;
      near[count++] = p;
    }
    return count;
  };
  const hit = { prim: null, nx: 0, nz: 0, top: Infinity };
  const nearestGathered = (x, y, z) => {
    let best = Infinity;
    for (let n = 0; n < count; n++) {
      const d = primitiveDistance(near[n], x, y, z);
      if (d < best) { best = d; hit.prim = near[n]; }
    }
    return best;
  };
  return {
    list,
    bodies,
    hit,
    // Signed distance to the nearest solid from (x, y, z) (∞ when none is
    // within `reach`); `hit.prim` is the one.
    distance(x, y, z, reach = 1) {
      if (!gather(x, z, x, z, reach)) return Infinity;
      return nearestGathered(x, y, z);
    },
    // Whether a body of `radius` centred at (x, y, z) touches a solid it
    // cannot pass (`body` primitives). On contact `hit` holds the outward
    // horizontal normal and the solid's top (∞ where it is no place to stand).
    touches(x, y, z, radius) {
      if (!gather(x, z, x, z, radius + 0.5, true)) return false;
      const d = nearestGathered(x, y, z);
      if (d >= radius) return false;
      const p = hit.prim;
      const e = 0.05;
      const nx = nearestGathered(x + e, y, z) - nearestGathered(x - e, y, z);
      const nz = nearestGathered(x, y, z + e) - nearestGathered(x, y, z - e);
      hit.prim = p;
      const n = Math.hypot(nx, nz);
      // Straight down onto a primitive (no horizontal gradient): away from its centre.
      hit.nx = n > 1e-6 ? nx / n : x - p.x;
      hit.nz = n > 1e-6 ? nz / n : z - p.z;
      const m = Math.hypot(hit.nx, hit.nz) || 1;
      hit.nx /= m;
      hit.nz /= m;
      hit.top = p.stand ? p.y1 : Infinity;
      return true;
    },
    // How far (0…1) a sphere of radius `pad` gets along the segment from o
    // to e before it touches a solid (1: all the way); `hit.prim` is what
    // stopped it. The pad shrinks to stay clear of a solid the start is
    // already close to, so a cat pressed to a wall still gets a camera.
    // Sphere-traced, with a minimum step and bisection back to the surface.
    trace(ox, oy, oz, ex, ey, ez, pad) {
      hit.prim = null;
      if (!gather(ox, oz, ex, ez, pad + 0.5)) return 1;
      const dx = ex - ox, dy = ey - oy, dz = ez - oz;
      const length = Math.hypot(dx, dy, dz);
      if (length < 1e-4) return 1;
      const start = nearestGathered(ox, oy, oz);
      if (start <= 0) return 1;
      const r = Math.min(pad, start * 0.7);
      const minStep = Math.min(0.05, r * 0.5 + 0.01) / length;
      let t = 0;
      let previous = 0;
      for (let i = 0; i < 160 && t < 1; i++) {
        const d = nearestGathered(ox + dx * t, oy + dy * t, oz + dz * t) - r;
        if (d <= 1e-3) {
          const prim = hit.prim;
          // Back to the surface between the last clear point and here.
          let lo = previous, hi = t;
          for (let k = 0; k < 7; k++) {
            const mid = (lo + hi) / 2;
            if (nearestGathered(ox + dx * mid, oy + dy * mid, oz + dz * mid) - r > 0) lo = mid;
            else hi = mid;
          }
          hit.prim = prim;
          return lo;
        }
        previous = t;
        t += Math.max(d / length, minStep);
      }
      // Check the end itself (the last step may have jumped over it).
      if (nearestGathered(ex, ey, ez) - r > 0) {
        hit.prim = null;
        return 1;
      }
      return previous;
    },
  };
}
