// What the cat does to the sea, packed for the water pass (wake.wgsl) as one
// row of RGBA32F texels, uploaded only while something is happening:
//   0  the body at the waterline: x, z, heading, immersion (0 dry … 1 afloat)
//   1  speed, half length and radius of the body's waterline capsule, trail count
//   2  a bounding circle of everything below (x, z, radius; 0 = nothing), ring count
//   3… the trail, newest first: x, z, birth time, strength
//   …  four paws: x, z, depth in the water
//   …  splash rings: x, z, birth time, strength
//   …  the water's velocity past the cat: x, z
//   boat (boat.js; its own texels, so a cat can swim beside it):
//   52 its bounding circle (x, z, radius; 0 = none), trail count
//   53 the hull: x, z, heading, its waterline's height
//   54 speed through the water, sideways speed, chop (0…1), heave rate
//   55… its path, newest first: x, z, birth time, strength
// Coast metres, on the sea's clock (main.js state.time).
export const WAKE = { width: 64, trail: 28, paws: 4, rings: 16, boatTrail: 9 };
const PAWS = 3 + WAKE.trail;
const RINGS = PAWS + WAKE.paws;
const FLOW = RINGS + WAKE.rings;
const BOAT = FLOW + 1;
const BOAT_TRAIL = BOAT + 3;
// The boat drops a point of its path every this many metres or seconds;
// its wake lives as long.
const BOAT_STEP = 1.6;
const BOAT_EVERY = 1.4;
const BOAT_LIFE = 14;
// How long foam and ripples outlive their source.
const TRAIL_LIFE = 11;
const RING_LIFE = 3;

export function createWake() {
  const data = new Float32Array(WAKE.width * 4);
  const trail = [];
  const rings = [];
  const bound = new Float64Array(3);
  const paws = Array.from({ length: WAKE.paws }, () => [0, 0, 0]);
  // boat: trailBack drops the trail that many metres behind the body's
  // middle (a boat's transom), so its foam starts where the water leaves it.
  const body = { x: 0, z: 0, heading: 0, immersion: 0, speed: 0, half: 0.2, radius: 0.08, strength: 0, flow: [0, 0], trailBack: 0 };
  // The boat afloat (boat.js `boat(...)` each frame it floats; `on` false
  // once it is out of the water).
  const boat = { on: false, x: 0, z: 0, heading: 0, level: 0, speed: 0, sway: 0, chop: 0, heave: 0 };
  const boatTrail = [];
  let now = 0;
  let idle = false;

  return {
    body,
    // Where each paw stands and how deep in the water (x, z, depth).
    paws,
    get now() {
      return now;
    },
    tick(time) {
      if (!Number.isFinite(time)) return;
      // A preview/reset clock must not expose future events to sqrt/decay.
      if (time < now) {
        trail.length = rings.length = 0;
        body.immersion = body.speed = body.strength = 0;
        paws.forEach((p) => { p[2] = 0; });
      }
      now = time;
    },
    // The body each frame (walker.js). A trail point is dropped every
    // quarter metre, or every stroke-length of time while treading water.
    move(x, z, heading, immersion, speed, strength, radius) {
      if (![x, z, heading, immersion, speed, strength, radius].every(Number.isFinite)) return;
      immersion = Math.max(0, Math.min(1, immersion));
      speed = Math.max(0, speed);
      strength = Math.max(0, Math.min(2, strength));
      radius = Math.max(0.008, Math.min(1, radius));
      Object.assign(body, { x, z, heading, immersion, speed, strength, radius });
      if (strength < 0.03) return;
      // boat: from the transom.
      if (body.trailBack) {
        x -= Math.sin(heading) * body.trailBack;
        z -= Math.cos(heading) * body.trailBack;
      }
      const last = trail[0];
      // boat: a wider body drops its points further apart (a boat's
      // 0.5 m waterline every 0.6 m), so the trail keeps its seconds.
      if (!last || Math.hypot(x - last[0], z - last[1]) > Math.max(0.25, radius * 1.2) || now - last[2] > 0.45) {
        trail.unshift([x, z, now, strength]);
        if (trail.length > WAKE.trail) trail.pop();
      }
    },
    // The boat each frame it floats (coast metres; speed through the water
    // along and across its heading, m/s): its hull in the water and its
    // path, which the water pass turns into its wake.
    boat(x, z, heading, level, speed, sway, chop, heave) {
      if (![x, z, heading, level, speed, sway, chop, heave].every(Number.isFinite)) return;
      Object.assign(boat, { on: true, x, z, heading, level, speed, sway, chop: Math.max(0, Math.min(1, chop)), heave });
      // The path from the transom.
      const sx = x - Math.sin(heading) * 2.2, sz = z - Math.cos(heading) * 2.2;
      const strength = Math.min(1.5, Math.max(0, speed) / 1.5);
      const last = boatTrail[0];
      if (!last || Math.hypot(sx - last[0], sz - last[1]) > BOAT_STEP || now - last[2] > BOAT_EVERY) {
        boatTrail.unshift([sx, sz, now, strength]);
        if (boatTrail.length > WAKE.boatTrail) boatTrail.pop();
      }
    },
    // Out of the water (ashore or asleep): its wake still fades out.
    noBoat() {
      boat.on = false;
    },
    paw(i, x, z, depth) {
      if (!Number.isInteger(i) || i < 0 || i >= WAKE.paws || ![x, z, depth].every(Number.isFinite)) return;
      depth = Math.max(0, depth);
      const p = paws[i];
      p[0] = x;
      p[1] = z;
      p[2] = depth;
    },
    ring(x, z, strength) {
      if (![x, z, strength].every(Number.isFinite) || strength <= 0) return;
      rings.unshift([x, z, now, Math.min(strength, 2)]);
      if (rings.length > WAKE.rings) rings.pop();
    },
    // The texels, or null when nothing has changed since an empty upload.
    pack() {
      while (trail.length && now - trail[trail.length - 1][2] > TRAIL_LIFE) trail.pop();
      while (rings.length && now - rings[rings.length - 1][2] > RING_LIFE) rings.pop();
      while (boatTrail.length && now - boatTrail[boatTrail.length - 1][2] > BOAT_LIFE) boatTrail.pop();
      const wading = paws.some((p) => p[2] > 0.005);
      const active = body.immersion > 0.01 || wading || trail.length || rings.length || boat.on || boatTrail.length;
      if (!active) {
        if (idle) return null;
        idle = true;
        data.fill(0);
        return data;
      }
      idle = false;
      data.fill(0);
      data.set([body.x, body.z, body.heading, body.immersion, body.speed, body.half, body.radius, trail.length], 0);
      // Enclose active sources, rather than centring a broad disk on the cat.
      // Three Gaussian widths retain >99.9% of the visible ripple packet;
      // bounds include the expanding foam as well as its advancing front.
      bound[2] = -1;
      if (body.immersion > 0.01) encloseSource(bound, body.x, body.z, body.half + body.radius + 0.9);
      for (const t of trail) {
        const age = Math.max(0, now - t[2]);
        const foam = 3 * (body.radius * (1 + age * 0.5) + 0.03);
        const ripple = age < 4.5 ? body.radius + 0.32 * age + 3 * (0.08 + 0.09 * age) : 0;
        encloseSource(bound, t[0], t[1], Math.max(foam, ripple));
      }
      for (const r of rings) {
        const age = Math.max(0, now - r[2]);
        encloseSource(bound, r[0], r[1], Math.max(0.4 * age + 3 * (0.04 + 0.1 * age), 3 * (0.05 + 0.22 * Math.sqrt(age) * (0.5 + r[3] * 0.5))));
      }
      // Paws in a passing wash trail froth downstream, farther the faster it runs.
      const rush = Math.min(Math.hypot(body.flow[0], body.flow[1]), 2.5);
      for (const p of paws) if (p[2] > 0.005) encloseSource(bound, p[0], p[1], 0.925 + 0.25 * rush);
      // The boat: its hull and reflection reach, and its wake's wedge
      // (spreading ~0.35 m a side per metre astern) out to where it fades.
      const boatBound = BOAT_BOUND;
      boatBound[2] = -1;
      if (boat.on) encloseSource(boatBound, boat.x, boat.z, 2.3 + 2.4 + Math.min(Math.abs(boat.speed), 3) * 0.6);
      let along = 0;
      for (let i = 0; i < boatTrail.length; i++) {
        const t = boatTrail[i];
        const prev = i ? boatTrail[i - 1] : boat.on ? [boat.x - Math.sin(boat.heading) * 2.2, boat.z - Math.cos(boat.heading) * 2.2] : t;
        along += Math.hypot(t[0] - prev[0], t[1] - prev[1]);
        if (t[3] > 0.02) encloseSource(boatBound, t[0], t[1], 1.6 + along * 0.4);
      }
      if (boatBound[2] > 0) {
        if (bound[2] < 0) bound.set(boatBound);
        else encloseSource(bound, boatBound[0], boatBound[1], boatBound[2]);
        data.set([boatBound[0], boatBound[1], boatBound[2], boatTrail.length], BOAT * 4);
        data.set([boat.x, boat.z, boat.heading, boat.on ? boat.level : -100], (BOAT + 1) * 4);
        data.set([boat.speed, boat.sway, boat.chop, boat.heave], (BOAT + 2) * 4);
        boatTrail.forEach((t, i) => data.set(t, (BOAT_TRAIL + i) * 4));
      }
      data.set(bound, 8);
      data[11] = rings.length;
      trail.forEach((t, i) => data.set(t, (3 + i) * 4));
      paws.forEach((p, i) => data.set([p[0], p[1], p[2], 0], (PAWS + i) * 4));
      rings.forEach((r, i) => data.set(r, (RINGS + i) * 4));
      data.set([body.flow[0], body.flow[1], 0, 0], FLOW * 4);
      return data;
    },
  };
}

const BOAT_BOUND = new Float64Array(3);

// Conservative circle union using one reusable CPU scratch buffer.
function encloseSource(bound, x, z, radius) {
  if (bound[2] < 0) { bound[0] = x; bound[1] = z; bound[2] = radius; return; }
  const d = Math.hypot(x - bound[0], z - bound[1]);
  if (d + radius <= bound[2]) return;
  if (d + bound[2] <= radius) { bound[0] = x; bound[1] = z; bound[2] = radius; return; }
  const grown = (bound[2] + d + radius) * 0.5;
  const shift = (grown - bound[2]) / Math.max(d, 1e-6);
  bound[0] += (x - bound[0]) * shift;
  bound[1] += (z - bound[1]) * shift;
  bound[2] = grown;
}
