import { HULL, hullPoint, keel, sheer, halfBreadth } from "./boat-forms.js";

// The launch, without any drawing: the boat lies upturned on its two logs
// (places' prop) until the cat pushes at it or hops onto it; then it rocks
// on the logs, rolls over onto its keel down off them and scrapes down the
// sand, bow or stern first (whichever end already points that way), into
// the water, where it floats off and the dynamics take over with the way it
// carries. At every moment some part of it bears on the logs, the sand or
// the water: its height is the highest of those contacts, never more.
//
// pose(t, out): out = { x, y, z, heading, pitch, roll, vx, vz, phase,
// floating }; phase "rock" | "roll" | "slide"; floating once the water
// under its keel holds it (ride.js hands it to the dynamics).

export const LAUNCH = {
  // Seconds rocking on the logs, then rolling over.
  rock: 0.8,
  roll: 1.7,
  // The slide: acceleration down the sand (m/s²), top speed, the logs'
  // height under the gunwale.
  push: 0.7,
  top: 1.4,
  logs: 0.2,
};

const H = HULL.half;
// The midship section's outline (across, up), for its lowest point at any
// roll; and the keel's contact stations along the hull.
const SECTION = [];
for (let i = 0; i <= 10; i++) for (const side of [-1, 1]) {
  const p = hullPoint(0, i / 10, side);
  SECTION.push([p[0], p[1]]);
}
const KEEL = [-0.92, -0.45, 0, 0.45, 0.8].map((s) => [s * H, keel(s) - 0.02]);

// landmark { x, z, facing }; to { x, z } where it is going (the cove);
// bed(x, z): the sand, seabed or a boulder's top; water(x, z): the sea's
// surface as drawn (−∞ on dry land).
export function createLaunch({ landmark, to, bed, water }) {
  const dx = to.x - landmark.x, dz = to.z - landmark.z;
  const run = Math.hypot(dx, dz) || 1;
  const ux = dx / run, uz = dz / run;
  // Bow first if it already points down the beach, else stern first.
  const down = Math.atan2(ux, uz);
  const bowFirst = Math.cos(down - landmark.facing) >= 0;
  const slideHeading = bowFirst ? down : down + Math.PI;
  const turn = wrap(slideHeading - landmark.facing);
  // Upturned on its logs: each end's gunwale on the sand under it, plus the
  // logs (as places' prop lies, place-shore.js).
  const fx0 = Math.sin(landmark.facing), fz0 = Math.cos(landmark.facing);
  const endRest = (s0, s1) => {
    let g = -Infinity;
    for (let s = s0; s <= s1 + 1e-6; s += 0.125)
      for (const v of [-0.8, 0, 0.8]) g = Math.max(g, bed(landmark.x + fx0 * s * H + fz0 * v, landmark.z + fz0 * s * H - fx0 * v));
    return g;
  };
  const sternRest = endRest(-1, -0.4), bowRest = endRest(0.4, 1);
  const logPitch = Math.atan2(bowRest - sternRest, 1.4 * H);
  const logY = (sternRest + bowRest) / 2;

  // The lowest point of the midship section rolled by `roll`.
  function lowest(roll) {
    const c = Math.cos(roll), s = Math.sin(roll);
    let low = Infinity;
    for (const [v, y] of SECTION) low = Math.min(low, y * c - v * s);
    return low;
  }
  // Resting on its keel at (x, z, heading): height and pitch from the sand
  // under its keel stations (and the logs while it is still on them).
  const rest = { y: 0, pitch: 0 };
  function onKeel(x, z, heading, lift = 0) {
    const fx = Math.sin(heading), fz = Math.cos(heading);
    // Each keel station's height were the hull level there (sand less its
    // keel's own height), the pitch that lays it on both ends, and the
    // height that keeps every station on or above its sand.
    const h = KEEL.map(([u, k]) => bed(x + fx * u, z + fz * u) + lift - k);
    const first = KEEL[0][0], last = KEEL[KEEL.length - 1][0];
    const tan = Math.max(-0.25, Math.min(0.25, (h[h.length - 1] - h[0]) / (last - first)));
    let y = -Infinity;
    for (let i = 0; i < KEEL.length; i++) y = Math.max(y, h[i] - KEEL[i][0] * tan);
    rest.pitch = Math.atan(tan);
    rest.y = y;
    return rest;
  }
  // The water's hold: the surface at the hull's middle and ends.
  function afloatAt(x, z, heading) {
    const fx = Math.sin(heading), fz = Math.cos(heading);
    let level = Infinity;
    for (const u of [-0.8 * H, 0, 0.8 * H]) level = Math.min(level, water(x + fx * u, z + fz * u));
    return level;
  }

  let slideFrom = 0;
  return {
    bowFirst,
    slideHeading,
    // The pose `t` seconds after the cat's push.
    pose(t, out) {
      const rockEnd = LAUNCH.rock, rollEnd = LAUNCH.rock + LAUNCH.roll;
      out.vx = out.vz = 0;
      out.floating = false;
      if (t < rockEnd) {
        // Knocked on its logs: it rocks, still upside down.
        const k = t / rockEnd;
        out.phase = "rock";
        out.x = landmark.x;
        out.z = landmark.z;
        out.heading = landmark.facing;
        out.roll = Math.PI + Math.sin(t * 15) * 0.07 * (1 - k) * Math.min(1, t * 6);
        out.pitch = logPitch;
        out.y = logY + LAUNCH.logs - lowest(out.roll);
        return out;
      }
      if (t < rollEnd) {
        // Over onto its keel, sliding off the logs as it goes.
        const k = smooth01((t - rockEnd) / LAUNCH.roll);
        out.phase = "roll";
        out.roll = Math.PI * (1 - k);
        out.heading = landmark.facing + turn * k;
        // A little way down the beach as it comes over.
        const along = 0.6 * k;
        out.x = landmark.x + ux * along;
        out.z = landmark.z + uz * along;
        const logs = LAUNCH.logs * (1 - smooth01(k * 1.6));
        const sand = onKeel(out.x, out.z, out.heading);
        out.pitch = logPitch * (1 - k) + sand.pitch * k;
        // Its lowest point on the logs or the sand beneath it; coming onto
        // its keel, the keel's own rest.
        const support = Math.max(logY + logs, bed(out.x, out.z));
        out.y = Math.max(support - lowest(out.roll), k > 0.7 ? sand.y - 0.3 * (1 - smooth01((k - 0.7) / 0.3)) : -Infinity);
        slideFrom = 0.6;
        return out;
      }
      // Down the sand: pushed, then running with the slope, then afloat.
      const ts = t - rollEnd;
      const tTop = LAUNCH.top / LAUNCH.push;
      const along = slideFrom + (ts < tTop ? 0.5 * LAUNCH.push * ts * ts : 0.5 * LAUNCH.push * tTop * tTop + LAUNCH.top * (ts - tTop));
      const speed = Math.min(LAUNCH.top, LAUNCH.push * ts);
      out.phase = "slide";
      out.heading = slideHeading;
      out.roll = 0;
      out.x = landmark.x + ux * along;
      out.z = landmark.z + uz * along;
      out.vx = ux * speed;
      out.vz = uz * speed;
      const sand = onKeel(out.x, out.z, out.heading);
      const level = afloatAt(out.x, out.z, out.heading);
      out.pitch = sand.pitch;
      out.y = sand.y;
      // The sea lifts it once its surface is above where the sand holds it.
      if (Number.isFinite(level) && level > sand.y - 0.03) {
        const lift = Math.min(1, (level - sand.y + 0.03) / 0.08);
        out.y = Math.max(sand.y, level);
        out.pitch *= 1 - lift;
        out.floating = lift >= 1 || along > run + 2;
      }
      if (along > run + 6) out.floating = true;
      return out;
    },
  };
}

// Whether a cat at (x, y, z) is pushing at or standing on the upturned hull
// on its logs: within `reach` of its outline (pushing toward it), or over
// it and above the logs.
export function touchesUpturned(landmark, cat, wantX, wantZ, reach = 0.45) {
  const fx = Math.sin(landmark.facing), fz = Math.cos(landmark.facing);
  const dx = cat.x - landmark.x, dz = cat.z - landmark.z;
  const u = dx * fx + dz * fz, v = dx * fz - dz * fx;
  const s = Math.max(-1, Math.min(1, u / H));
  const gap = Math.hypot(Math.max(0, Math.abs(u) - H), Math.max(0, Math.abs(v) - halfBreadth(s)));
  if (gap === 0) return true;
  const pushing = Math.hypot(wantX, wantZ) > 0.3 && wantX * -dx + wantZ * -dz > 0;
  return gap < reach && pushing;
}

function smooth01(x) {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
}
function wrap(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}
export { sheer };
