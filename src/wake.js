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
      now = time;
    },
    // The body each frame (walker.js). A trail point is dropped every
    // quarter metre, or every stroke-length of time while treading water.
    move(x, z, heading, immersion, speed, strength, radius) {
      Object.assign(body, { x, z, heading, immersion, speed, strength, radius });
      if (strength < 0.03) return;
      const last = trail[0];
      if (!last || Math.hypot(x - last[0], z - last[1]) > 0.25 || now - last[2] > 0.45) {
        trail.unshift([x, z, now, strength]);
        if (trail.length > WAKE.trail) trail.pop();
      }
    },
    paw(i, x, z, depth) {
      const p = paws[i];
      p[0] = x;
      p[1] = z;
      p[2] = depth;
    },
    ring(x, z, strength) {
      rings.unshift([x, z, now, strength]);
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
      // Bound: foam spreads and rings run outward from every source.
      let reach = 0.6;
      for (const t of trail) reach = Math.max(reach, Math.hypot(t[0] - body.x, t[1] - body.z) + 0.2 + 0.3 * Math.min(now - t[2], 5) + body.radius * 4);
      for (const r of rings) reach = Math.max(reach, Math.hypot(r[0] - body.x, r[1] - body.z) + 0.3 + 0.4 * (now - r[2]));
      for (const p of paws) if (p[2] > 0.005) reach = Math.max(reach, Math.hypot(p[0] - body.x, p[1] - body.z) + 0.2 + 0.25 * Math.min(Math.hypot(body.flow[0], body.flow[1]), 2.5));
      data.set([body.x, body.z, reach, rings.length], 8);
      trail.forEach((t, i) => data.set(t, (3 + i) * 4));
      paws.forEach((p, i) => data.set([p[0], p[1], p[2], 0], (PAWS + i) * 4));
      rings.forEach((r, i) => data.set(r, (RINGS + i) * 4));
      data.set([body.flow[0], body.flow[1], 0, 0], FLOW * 4);
      return data;
    },
  };
}
