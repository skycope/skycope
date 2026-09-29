import { RockSea } from "./rocks.wgsl";

// The cat in the sea (src/wake.js packs it, one row of texels): the collar
// of froth where its body cuts the surface and the bow wave it pushes, the
// churned trail it leaves (froth along the flanks, bubbles down the middle,
// spreading and thinning as it ages), the ripples each stroke sends out,
// whose overlapping rings behind a moving cat make its V, tiny collars round
// wading legs, and the rings and froth of every splash. Everything is gated
// by one bounding circle, so the rest of the sea pays a single texel load.
// Returned as a RockSea so it joins the rocks' foam, lace, bubbles and the
// night's bioluminescence.

const TRAIL: i32 = 28;
const PAWS: i32 = 31;
const RINGS: i32 = 35;

export fn cat_near(p: vec2f, wake: texture_2d<f32>) -> bool {
  let bound = textureLoad(wake, vec2i(2, 0), 0);
  let d = p - bound.xy;
  return bound.z > 0.0 && dot(d, d) < bound.z * bound.z;
}

// Outward ripple packet at distance r from its source: capillary-gravity
// waves (~15 cm) leaving at c, fading by the footprint. Adds to out.
fn ripple(out: ptr<function, RockSea>, q: vec2f, front: f32, width: f32, amp: f32, k: f32, pixel: f32) {
  let r = max(length(q), 0.001);
  let y = (r - front) / width;
  if (abs(y) > 3.0) { return; }
  let a = amp * exp(-y * y);
  let keep = exp(-0.65 * (k * pixel) * (k * pixel));
  let phase = k * (r - front);
  (*out).height += a * cos(phase) * keep;
  (*out).slope -= q / r * (a * k * sin(phase) * keep);
  (*out).variance += 0.5 * (a * k) * (a * k) * (1.0 - keep * keep);
}

export fn cat_sea(p: vec2f, pixel: f32, time: f32, wake: texture_2d<f32>) -> RockSea {
  var out: RockSea;
  out.edge = 99.0;
  let body = textureLoad(wake, vec2i(0, 0), 0);
  let motion = textureLoad(wake, vec2i(1, 0), 0);
  let counts = textureLoad(wake, vec2i(2, 0), 0);
  let speed = motion.x;
  let radius = motion.z;
  var foam = 0.0;
  var bubbles = 0.0;

  // The trail, segment by segment from the cat backward.
  var prev = body.xy;
  var prev_age = 0.0;
  let n = min(i32(motion.w), TRAIL);
  for (var i = 0; i < n; i++) {
    let t = textureLoad(wake, vec2i(3 + i, 0), 0);
    let age = time - t.z;
    let seg = t.xy - prev;
    let h = clamp(dot(p - prev, seg) / max(dot(seg, seg), 1e-6), 0.0, 1.0);
    let d = length(p - prev - seg * h);
    let a = mix(prev_age, age, h);
    let width = radius * (1.0 + a * 0.5) + 0.03;
    let x = d / width;
    if (x < 3.0) {
      let fade = exp(-a / 3.2) * t.w;
      // Churned at the flanks where the legs work, paler down the middle.
      let flank = exp(-(x - 0.85) * (x - 0.85) * 5.0);
      foam = max(foam, fade * max(flank * 0.62, exp(-x * x * 1.5) * 0.35));
      bubbles = max(bubbles, fade * exp(-x * x) * 0.85);
    }
    // Each point's ripples; together they draw the wake's V.
    if (age < 4.5) {
      let front = 0.32 * age + radius;
      ripple(&out, p - t.xy, front, 0.08 + 0.09 * age, 0.005 * t.w * exp(-age / 1.6) * sqrt(0.25 / (0.25 + front)), 42.0, pixel);
    }
    prev = t.xy;
    prev_age = age;
  }

  // The body where it cuts the water: a capsule from rump to chest.
  if (body.w > 0.01) {
    let fwd = vec2f(sin(body.z), cos(body.z));
    let side = vec2f(fwd.y, -fwd.x);
    let q = p - body.xy;
    let u = dot(q, fwd);
    let v = dot(q, side);
    let half = motion.y;
    let cu = clamp(u, -half, half);
    let off = vec2f(u - cu, v);
    let edge = length(off) - radius;
    let out_edge = max(edge, 0.0);
    // Froth clinging at the contact line, fatter with speed.
    let cling = exp(-out_edge / (0.025 + speed * 0.05)) * smoothstep(-0.03, 0.0, edge) * body.w;
    foam = max(foam, cling * (0.4 + 0.45 * min(speed / 0.6, 1.0)));
    bubbles = max(bubbles, cling * 0.75);
    // Bow wave: water heaped before the chest, drawn down along the flanks.
    let ahead = smoothstep(-0.3, 0.6, (u - half * 0.4) / (radius + 0.1)) * 1.6 - 0.6;
    // It grows with speed: a trot through the shallows heaps water high.
    let bump = exp(-out_edge / (0.08 + 0.03 * min(speed, 2.0))) * min(speed, 2.2) * 0.016 * body.w * ahead;
    let dir = (fwd * off.x + side * off.y) / max(length(off), 0.001);
    out.height += bump;
    out.slope -= dir * bump / 0.08 * step(0.0, edge);
    // Paddling stirs a small, lively chop round the body.
    ripple(&out, q, radius + 0.15 + fract(time * 1.9) * 0.35, 0.08, 0.003 * body.w, 38.0, pixel);
    out.occlusion = exp(-out_edge / 0.1) * 0.5 * body.w;
    out.edge = edge;
  }

  // Legs standing in the shallows: a collar of white water where each cuts
  // the surface, water heaped in front of it and drawn down behind, a
  // furrow of froth trailing it at speed, and a little V of ripples.
  let heading = vec2f(sin(body.z), cos(body.z));
  let across = vec2f(heading.y, -heading.x);
  let pace = min(speed, 2.5);
  for (var j = 0; j < 4; j++) {
    let paw = textureLoad(wake, vec2i(PAWS + j, 0), 0);
    if (paw.z <= 0.005) { continue; }
    let q = p - paw.xy;
    let edge = length(q) - 0.025;
    if (edge > 0.9) { continue; }
    let wet = smoothstep(0.0, 0.03, paw.z);
    let cling = exp(-max(edge, 0.0) / (0.02 + pace * 0.03)) * wet;
    foam = max(foam, cling * (0.55 + 0.25 * min(pace, 1.0)));
    bubbles = max(bubbles, cling * 0.7);
    // Behind the leg (u > 0), a froth furrow widening as it goes.
    let u = -dot(q, heading);
    let v = dot(q, across);
    let w = 0.02 + max(u, 0.0) * 0.28;
    let furrow = exp(-v * v / (w * w)) * exp(-max(u, 0.0) / (0.06 + 0.2 * pace)) * smoothstep(-0.02, 0.03, u) * smoothstep(0.2, 1.0, pace) * wet;
    foam = max(foam, furrow * 0.7);
    bubbles = max(bubbles, furrow * 0.8);
    let heap = exp(-max(edge, 0.0) / 0.05) * pace * 0.008 * wet * clamp(-u / 0.04, -1.0, 1.0);
    out.height += heap;
    out.slope -= normalize(q + 1e-5) * heap / 0.05 * step(0.0, edge);
    ripple(&out, q, 0.05 + fract(time * 2.3 + f32(j) * 0.37) * 0.3, 0.05, (0.0015 + 0.003 * pace) * min(paw.z * 20.0, 1.0), 55.0, pixel);
  }

  // Splashes: rings running outward and a burst of froth.
  let m = min(i32(counts.w), 16);
  for (var k = 0; k < m; k++) {
    let s = textureLoad(wake, vec2i(RINGS + k, 0), 0);
    let age = time - s.z;
    if (age > 3.0) { continue; }
    let q = p - s.xy;
    let front = 0.4 * age;
    ripple(&out, q, front, 0.04 + 0.1 * age, 0.009 * s.w * exp(-age / 1.1) * sqrt(0.1 / (0.1 + front)), 50.0, pixel);
    let spread = 0.05 + 0.22 * sqrt(age) * (0.5 + s.w * 0.5);
    let r2 = dot(q, q) / (spread * spread);
    let burst = exp(-age / (0.7 + 0.3 * min(s.w, 2.0))) * min(s.w, 1.2) * exp(-r2);
    // Froth pushed out to the first crest as it leaves.
    let rim = exp(-age / 0.5) * s.w * exp(-pow((sqrt(dot(q, q)) - front) / 0.04, 2.0)) * 0.5;
    foam = max(foam, max(burst * 0.9, rim));
    bubbles = max(bubbles, burst);
  }

  out.foam = min(foam, 1.0);
  out.bubbles = min(bubbles, 1.0);
  // Finer lace than the surf's: a cat's froth is small bubbles.
  out.lace = p * 2.6;
  return out;
}
