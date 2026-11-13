import { shoreDistance, groundHeight, ISLAND } from "./terrain.js";
import { seabedDepth, shoreAlong } from "./sea-surface.js";

// The fisherman's boat on the water, without any drawing: a small clinker
// rowing boat's motion in coast metres (x right, z out, heading φ along
// (sin φ, cos φ)). Pure, so node tests can sail it for minutes.
//
// Who drives it: the wisp. While the cat is aboard the little light flies
// a few metres ahead of the bow and tows it on a thread of light (boat.js
// draws the thread and moves the wisp). Here that is a force on the stem
// toward where the cat wants to go, so the boat carries its way, turns
// with its stern swinging out, and pulls itself round from a standstill.
// Water resists sideways far more than lengthways (the keel), the sea's own
// flow carries it (the swell's orbital motion, the bores in the surf), and
// it pitches, rolls and heaves on the real swell (sea-surface.js), sampled
// at the bow, stern and either side.
//
// It stops against boulders and landmarks (a bump, a little rebound),
// grounds on sand (the keel slides up the beach and holds), cannot cross
// land, and past `outerSoft` the sea turns it gently home: no tow carries it
// beyond `outer`.

export const BOAT = {
  length: 4.6,
  beam: 1.55,
  // Keel bottom below the waterline amidships, and how far the keel rises
  // toward bow and stern (rocker).
  draft: 0.22,
  rocker: 0.1,
  mass: 240,
  // The wisp's pull on the stem (N): an easy glide, and hurrying.
  tow: 80,
  hurry: 190,
  // Offshore metres (−shoreDistance): the sea starts to turn it home, and
  // the farthest it goes. The whale ranges 95–120 m out.
  outerSoft: 118,
  outer: 138,
};

// The hull's outline for contact, in the boat's frame: [along, across,
// keel height above the keel's lowest point].
const HALF = BOAT.length / 2;
const CONTACT = [
  [HALF, 0, 0.12],
  [HALF * 0.62, 0.55, 0.12],
  [HALF * 0.62, -0.55, 0.12],
  [0, 0.74, 0.14],
  [0, -0.74, 0.14],
  [-HALF * 0.62, 0.68, 0.12],
  [-HALF * 0.62, -0.68, 0.12],
  [-HALF, 0.5, 0.1],
  [-HALF, -0.5, 0.1],
  [0, 0, 0],
  [HALF * 0.5, 0, 0.03],
  [-HALF * 0.5, 0, 0.03],
];
// Where the swell is sampled for heave, pitch and roll.
const SAMPLE = { bow: HALF * 0.8, side: 0.62 };

// sea: createSea (sea-surface.js). bed(x, z): the seabed, sand or boulder
// top under the water (walker.bed). solids: walker.solids (blockers.js).
export function createBoatDynamics({ sea, bed, solids = null } = {}) {
  const s = {
    x: 0,
    z: 0,
    heading: 0,
    // Velocity over the ground (world) and yaw rate (rad/s).
    vx: 0,
    vz: 0,
    r: 0,
    // Surge and sway through the water (boat frame), for the wake and feel.
    u: 0,
    v: 0,
    // Heave (the waterline's height at the hull's middle), pitch (bow up +)
    // and roll (starboard down +), with their rates.
    y: 0,
    vy: 0,
    pitch: 0,
    vp: 0,
    roll: 0,
    vr: 0,
    // The sea's surface under the hull as a plane: level at (x, z) and its
    // slope, for the waterline clip.
    level: 0,
    slopeX: 0,
    slopeZ: 0,
    // How hard the swell and wind are working the boat (0…1), breaking
    // water at the bow (0…1), and contact: grounded on sand (0…1), the
    // last bump's strength and when (seconds since).
    chop: 0,
    breaking: 0,
    grounded: 0,
    bowGrounded: false,
    bump: 0,
    bumpAge: 99,
    // Offshore metres at the hull's middle.
    offshore: 0,
    clock: 0,
  };
  const events = [];
  const good = { x: 0, z: 0, heading: 0 };
  // Scratch, reused every step.
  const water = { level: 0, fx: 0, fz: 0, breaking: 0 };

  function levelAt(x, z) {
    const b = bed(x, z);
    const w = sea ? sea.at(x, z, b) : STILL;
    water.level = Number.isFinite(w.level) ? w.level : b;
    water.fx = w.flowX;
    water.fz = w.flowZ;
    water.breaking = w.breaking;
    return water.level;
  }

  function place(x, z, heading = s.heading) {
    s.x = x;
    s.z = z;
    s.heading = heading;
    s.vx = s.vz = s.r = s.u = s.v = 0;
    s.vy = s.vp = s.vr = 0;
    s.y = levelAt(x, z);
    s.level = s.y;
    s.pitch = s.roll = 0;
    s.grounded = 0;
    good.x = x;
    good.z = z;
    good.heading = heading;
  }

  // A boat-frame point to world (x, z).
  const pt = { x: 0, z: 0 };
  function local(u, v, x = s.x, z = s.z, h = s.heading) {
    const fx = Math.sin(h), fz = Math.cos(h);
    pt.x = x + fx * u + fz * v;
    pt.z = z + fz * u - fx * v;
    return pt;
  }

  // Whether the base surface at (x, z) is a boulder (or a landmark's tile)
  // rather than the sand or seabed.
  function rocky(x, z, b) {
    const inland = shoreDistance(x, z);
    const sand = inland < 0 ? Math.max(groundHeight(x, z), -seabedDepth(-inland, shoreAlong(x, z))) : groundHeight(x, z);
    return b > sand + 0.03;
  }

  // One contact pass at a candidate pose: the deepest point in the bed or a
  // solid, its outward normal (world, horizontal) and kind. Returns depth
  // (m, ≤ 0 when clear).
  const contact = { depth: 0, nx: 0, nz: 0, rock: false, bow: false };
  function probe(x, z, h, keelY) {
    contact.depth = 0;
    contact.rock = false;
    contact.bow = false;
    for (let i = 0; i < CONTACT.length; i++) {
      const [u, v, lift] = CONTACT[i];
      local(u, v, x, z, h);
      const px = pt.x, pz = pt.z;
      const rockerLift = BOAT.rocker * (u / HALF) * (u / HALF);
      const keel = keelY + lift + rockerLift;
      const b = bed(px, pz);
      let depth = b - keel;
      // Never onto the land itself, whatever its height.
      const inland = shoreDistance(px, pz);
      if (inland > -0.4) depth = Math.max(depth, 0.05 + (inland + 0.4) * 0.5);
      let isRock = depth > 0 && rocky(px, pz, b);
      let nx = 0, nz = 0;
      if (depth > 0) {
        const e = 0.18;
        nx = bed(px - e, pz) - bed(px + e, pz);
        nz = bed(px, pz - e) - bed(px, pz + e);
      }
      // Landmarks in the water (a wreck's ribs, a jetty): their solids.
      if (solids && i < 9 && solids.touches(px, keelY + 0.5, pz, 0.32)) {
        const hit = solids.hit;
        const d = 0.2;
        if (d > depth) {
          depth = d;
          nx = hit.nx;
          nz = hit.nz;
          isRock = true;
        }
      }
      if (depth > contact.depth) {
        const n = Math.hypot(nx, nz);
        // No horizontal gradient (flat bed): push back toward open water.
        if (n < 1e-5) {
          nx = px - ISLAND.x;
          nz = pz - ISLAND.z;
        }
        const m = Math.hypot(nx, nz) || 1;
        contact.depth = depth;
        contact.nx = nx / m;
        contact.nz = nz / m;
        contact.rock = isRock;
        contact.bow = u > HALF * 0.5;
      }
    }
    return contact.depth;
  }

  // input: { dir: [x, z] world direction the cat wants (or null), throttle
  // 0…1, hurry, moor: { x, z, heading } to hold station at (or null) }.
  function step(dt, input = {}) {
    if (!(dt > 0)) return s;
    const n = Math.min(8, Math.ceil(dt / (1 / 60)));
    const h = Math.min(dt, 0.2) / n;
    for (let i = 0; i < n; i++) substep(h, input);
    return s;
  }

  function substep(dt, { dir = null, throttle = 0, hurry = false, moor = null, load = 0 } = {}) {
    s.clock += dt;
    s.bumpAge += dt;
    const fx = Math.sin(s.heading), fz = Math.cos(s.heading);
    const sx = fz, sz = -fx;
    // The water at the hull's middle: its flow carries the boat.
    const mid = levelAt(s.x, s.z);
    let flowX = water.fx, flowZ = water.fz;
    s.breaking += (water.breaking - s.breaking) * Math.min(1, dt * 4);
    // The swell's flow is strong in the surf; a hull feels it a little less
    // than a floating cat (it spans several of its metres).
    flowX *= 0.8;
    flowZ *= 0.8;
    s.offshore = -shoreDistance(s.x, s.z);
    // Past the soft limit the sea sets toward home.
    const outward = smooth(BOAT.outerSoft, BOAT.outer, s.offshore);
    const rx = s.x - ISLAND.x, rz = s.z - ISLAND.z;
    const rr = Math.hypot(rx, rz) || 1;
    const ox = rx / rr, oz = rz / rr;
    flowX -= ox * outward * 0.9;
    flowZ -= oz * outward * 0.9;

    // The tow: the wisp's pull on the stem, toward where the cat wants to go.
    let tx = 0, tz = 0;
    if (dir && throttle > 0) {
      let dx = dir[0], dz = dir[1];
      const dl = Math.hypot(dx, dz);
      if (dl > 1e-6) {
        dx /= dl;
        dz /= dl;
        // Dead astern: pull a little to one side, so it comes round.
        if (dx * fx + dz * fz < -0.94) {
          dx += sx * 0.35;
          dz += sz * 0.35;
        }
        // Outward past the soft limit, the thread will not pull.
        const out = Math.max(0, dx * ox + dz * oz);
        const pull = (hurry ? BOAT.hurry : BOAT.tow) * Math.min(1, throttle) * (1 - outward * out);
        tx = dx * pull;
        tz = dz * pull;
      }
    }
    // Held at a mooring: a soft spring to station and to its heading.
    let moorTorque = 0;
    if (moor) {
      const mx = moor.x - s.x, mz = moor.z - s.z;
      tx += mx * 40 - s.vx * 60;
      tz += mz * 40 - s.vz * 60;
      moorTorque = wrap(moor.heading - s.heading) * 60;
    }

    // Through the water.
    const wx = s.vx - flowX, wz = s.vz - flowZ;
    const wu = wx * fx + wz * fz;
    const wv = wx * sx + wz * sz;
    s.u = wu;
    s.v = wv;
    // Lengthways it slips through; sideways the keel holds it.
    const du = -(14 * wu + 22 * wu * Math.abs(wu));
    const dv = -(260 * wv + 420 * wv * Math.abs(wv));
    // Grounded: the sand holds it.
    const hold = 1 + s.grounded * 30;
    const Fx = tx + (du * fx + dv * sx) * hold;
    const Fz = tz + (du * fz + dv * sz) * hold;
    s.vx += (Fx / BOAT.mass) * dt;
    s.vz += (Fz / BOAT.mass) * dt;
    // Yaw: the tow's side pull on the stem swings the bow round (and the
    // stern out), the keel's lateral resistance aft of midships keeps it
    // running straight, and the water damps the turn.
    const towSide = tx * sx + tz * sz;
    const inertia = BOAT.mass * BOAT.length * BOAT.length / 14;
    const yaw = towSide * HALF * 0.95 + dv * -0.35 - 160 * s.r - 260 * s.r * Math.abs(s.r) + moorTorque - s.r * s.grounded * 400;
    s.r += (yaw / inertia) * dt;
    s.r = clamp(s.r, -1.2, 1.2);

    // Move, then resolve contact with the bed, boulders and landmarks.
    let nx = s.x + s.vx * dt;
    let nz = s.z + s.vz * dt;
    let nh = wrap(s.heading + s.r * dt);
    // Hard outer limit.
    const off = -shoreDistance(nx, nz);
    if (off > BOAT.outer) {
      const dx = nx - ISLAND.x, dz = nz - ISLAND.z;
      const d = Math.hypot(dx, dz) || 1;
      const back = (off - BOAT.outer) / d;
      nx -= dx * back;
      nz -= dz * back;
      const vo = s.vx * ox + s.vz * oz;
      if (vo > 0) {
        s.vx -= ox * vo;
        s.vz -= oz * vo;
      }
    }
    const keelY = mid - BOAT.draft + 0.02 * load;
    let depth = probe(nx, nz, nh, keelY);
    let groundedNow = 0;
    let bowNow = false;
    for (let k = 0; k < 4 && depth > 0.005; k++) {
      const cnx = contact.nx, cnz = contact.nz;
      const rock = contact.rock;
      bowNow = bowNow || contact.bow;
      // The slope of the bed lifts a keel on sand; it is pushed back along
      // the bed's normal by how far it went in (a beach is shallow, so a
      // little depth is a long way up it).
      const push = rock ? Math.min(0.3, depth * 2 + 0.01) : Math.min(0.2, depth * 3 + 0.005);
      nx += cnx * push;
      nz += cnz * push;
      const vn = s.vx * cnx + s.vz * cnz;
      if (vn < 0) {
        const impact = -vn;
        // Rock: a bump and a small rebound. Sand: the keel slides and stops.
        const bounce = rock ? 1.25 : 1.0;
        s.vx -= cnx * vn * bounce;
        s.vz -= cnz * vn * bounce;
        if (rock && impact > 0.15 && s.bumpAge > 0.4) {
          s.bump = Math.min(1, impact / 1.6);
          s.bumpAge = 0;
          events.push({ type: "bump", gain: s.bump });
        }
        if (!rock && impact > 0.25 && s.grounded < 0.2) events.push({ type: "ground", gain: Math.min(1, impact / 1.4) });
      }
      if (rock) s.r *= 0.6;
      else groundedNow = 1;
      depth = probe(nx, nz, nh, keelY);
    }
    if (depth > 0.02) {
      // Could not get clear: stay where it last was (turning back too).
      nx = s.x;
      nz = s.z;
      nh = s.heading;
      if (probe(nx, nz, nh, keelY) > 0.02) {
        nx = good.x;
        nz = good.z;
        nh = good.heading;
      }
      s.vx *= 0.3;
      s.vz *= 0.3;
      s.r *= 0.3;
    }
    s.grounded += (groundedNow - s.grounded) * Math.min(1, dt * (groundedNow ? 8 : 2));
    s.bowGrounded = bowNow && groundedNow > 0;
    s.x = nx;
    s.z = nz;
    s.heading = nh;
    if (probe(nx, nz, nh, keelY) <= 0.02) {
      good.x = nx;
      good.z = nz;
      good.heading = nh;
    }

    // Heave, pitch and roll on the swell.
    const fx2 = Math.sin(s.heading), fz2 = Math.cos(s.heading);
    const bowL = levelAt(s.x + fx2 * SAMPLE.bow, s.z + fz2 * SAMPLE.bow);
    const sternL = levelAt(s.x - fx2 * SAMPLE.bow, s.z - fz2 * SAMPLE.bow);
    const portL = levelAt(s.x - fz2 * SAMPLE.side, s.z + fx2 * SAMPLE.side);
    const stbdL = levelAt(s.x + fz2 * SAMPLE.side, s.z - fx2 * SAMPLE.side);
    const midL = levelAt(s.x, s.z);
    // Aground in a trough, it rests on the sand rather than sinking into it.
    const targetY = Math.max((bowL + sternL + portL + stbdL + 2 * midL) / 6, bed(s.x, s.z) + BOAT.draft - 0.03);
    const along = (bowL - sternL) / (2 * SAMPLE.bow);
    const across = (portL - stbdL) / (2 * SAMPLE.side);
    // The plane of the sea under the hull, in world slope terms.
    s.level = targetY;
    s.slopeX = along * fx2 - across * fz2;
    s.slopeZ = along * fz2 + across * fx2;
    s.chop += (clamp(Math.abs(bowL - sternL) * 2 + Math.abs(portL - stbdL) * 3, 0, 1) - s.chop) * Math.min(1, dt * 2);
    // Heels a little out of a turn, squats a touch with speed.
    const heel = clamp(-s.u * s.r * 0.12, -0.12, 0.12);
    const sit = -s.grounded * 0.04;
    const targetP = Math.atan(along) * 0.85 + clamp(s.u * 0.012, -0.02, 0.03) + sit;
    const targetR = Math.atan(across) * 0.8 + heel;
    s.vy += (32 * (targetY - s.y) - 7 * s.vy) * dt;
    s.y += s.vy * dt;
    s.vp += (24 * (targetP - s.pitch) - 5.5 * s.vp) * dt;
    s.pitch += s.vp * dt;
    s.vr += (15 * (targetR - s.roll) - 2.4 * s.vr) * dt;
    s.roll += s.vr * dt;
    // Never NaN out to the renderer: fall back to the last good pose.
    if (![s.x, s.z, s.heading, s.vx, s.vz, s.r, s.y, s.vy, s.pitch, s.vp, s.roll, s.vr].every(Number.isFinite)) {
      place(good.x, good.z, good.heading);
    }
  }

  // A shove (a cat landing aboard): drops the hull and rocks it.
  function nudge(down = 0.15, roll = 0, pitch = 0) {
    s.vy -= down;
    s.vr += roll;
    s.vp += pitch;
  }

  return { state: s, events, contact, place, step, nudge, local: (u, v) => ({ ...local(u, v) }), probe: (x, z, h) => probe(x, z, h, levelAt(x, z) - BOAT.draft) };
}

const STILL = { level: 0, flowX: 0, flowZ: 0, breaking: 0 };

function clamp(v, a, b) {
  return Math.min(b, Math.max(a, v));
}
function smooth(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
function wrap(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

// Where the boat waits off a beach point (x, z): the nearest spot seaward
// of it, straight out or a little either side, with water enough under the
// whole keel and no boulder in reach; bow toward the beach, as if its
// painter were made fast ashore. null if there is none within 22 m.
export function findMooring(x, z, bed, { clear = 0.18 } = {}) {
  const theta = Math.atan2(z - ISLAND.z, x - ISLAND.x);
  for (let off = 4; off <= 22; off += 0.5)
    for (const turn of [0, 0.03, -0.03, 0.06, -0.06, 0.1, -0.1]) {
      const a = theta + turn;
      const r = Math.hypot(x - ISLAND.x, z - ISLAND.z);
      // Out along the radius until `off` metres from the shore.
      let px = 0, pz = 0;
      for (let k = 0; k < 6; k++) {
        px = ISLAND.x + Math.cos(a) * r;
        pz = ISLAND.z + Math.sin(a) * r;
        const d = -shoreDistance(px, pz);
        if (Math.abs(d - off) < 0.05) break;
        const grow = off - d;
        px = ISLAND.x + Math.cos(a) * (r + grow);
        pz = ISLAND.z + Math.sin(a) * (r + grow);
        x = px;
        z = pz;
        break;
      }
      const heading = Math.atan2(-Math.cos(a), -Math.sin(a));
      const fx = Math.sin(heading), fz = Math.cos(heading);
      let ok = true;
      for (const u of [-HALF - 1, -HALF, -HALF / 2, 0, HALF / 2, HALF, HALF + 0.8])
        for (const v of [-1.1, 0, 1.1]) {
          const qx = px + fx * u + fz * v, qz = pz + fz * u - fx * v;
          if (bed(qx, qz) > -BOAT.draft - clear || shoreDistance(qx, qz) > -1) ok = false;
        }
      if (ok) return { x: px, z: pz, heading };
    }
  return null;
}
