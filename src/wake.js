// What the cat does to the sea, packed for the water pass (wake.wgsl) as one
// row of RGBA32F texels, uploaded only while something is happening:
//   0  the body at the waterline: x, z, heading, immersion (0 dry … 1 afloat)
//   1  speed, half length and radius of the body's waterline capsule, trail count
//   2  a bounding circle of everything below (x, z, radius; 0 = nothing), ring count
//   3… the trail, newest first: x, z, birth time, strength
//   …  four paws: x, z, depth in the water
//   …  splash rings: x, z, birth time, strength
//   …  the water's velocity past the cat: x, z
// Coast metres, on the sea's clock (main.js state.time).
export const WAKE = { width: 64, trail: 28, paws: 4, rings: 16 };
const PAWS = 3 + WAKE.trail;
const RINGS = PAWS + WAKE.paws;
const FLOW = RINGS + WAKE.rings;
// How long foam and ripples outlive their source.
const TRAIL_LIFE = 11;
const RING_LIFE = 3;

export function createWake() {
  const data = new Float32Array(WAKE.width * 4);
  const trail = [];
  const rings = [];
  const bound = new Float64Array(3);
  const paws = Array.from({ length: WAKE.paws }, () => [0, 0, 0]);
  const body = { x: 0, z: 0, heading: 0, immersion: 0, speed: 0, half: 0.2, radius: 0.08, strength: 0, flow: [0, 0] };
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
      const last = trail[0];
      if (!last || Math.hypot(x - last[0], z - last[1]) > 0.25 || now - last[2] > 0.45) {
        trail.unshift([x, z, now, strength]);
        if (trail.length > WAKE.trail) trail.pop();
      }
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
      const wading = paws.some((p) => p[2] > 0.005);
      const active = body.immersion > 0.01 || wading || trail.length || rings.length;
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
