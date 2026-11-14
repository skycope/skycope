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
const FLOW: i32 = 51;

export fn cat_near(p: vec2f, wake: texture_2d<f32>) -> bool {
  let bound = textureLoad(wake, vec2i(2, 0), 0);
  let d = p - bound.xy;
  return bound.z > 0.0 && dot(d, d) < bound.z * bound.z;
}

// Outward ripple packet at distance r from its source: capillary-gravity
// waves (~15 cm) leaving at c, fading by the footprint. Adds to out.
fn ripple(out: ptr<function, RockSea>, q: vec2f, front: f32, width: f32, amp: f32, k: f32, pixel: f32) {
  let r = max(length(q), 0.001);
  let y = (r - front) / max(width, 0.001);
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
  let speed = max(motion.x, 0.0);
  let radius = max(motion.z, 0.008);
  // The water past the cat: its own motion, or a wash running by a cat
  // standing still. Froth and furrows follow it downstream.
  let flow = textureLoad(wake, vec2i(FLOW, 0), 0).xy;
  let rush = length(flow);
  var foam = 0.0;
  var bubbles = 0.0;

  // The trail, segment by segment from the cat backward.
  let head = textureLoad(wake, vec2i(3, 0), 0);
  var prev = select(head.xy, body.xy, body.w > 0.01);
  var prev_age = select(max(time - head.z, 0.0), 0.0, body.w > 0.01);
  let n = clamp(i32(motion.w), 0, TRAIL);
  for (var i = 0; i < n; i++) {
    let t = textureLoad(wake, vec2i(3 + i, 0), 0);
    let age = time - t.z;
    if (age < 0.0 || t.w <= 0.0) { continue; }
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
    let cling = exp(-out_edge / (0.025 + rush * 0.05)) * smoothstep(-0.03, 0.0, edge) * body.w;
    foam = max(foam, cling * (0.4 + 0.45 * min(rush / 0.6, 1.0)));
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
  let downstream = select(-vec2f(sin(body.z), cos(body.z)), flow / max(rush, 1e-4), rush > 0.02);
  let across = vec2f(downstream.y, -downstream.x);
  let pace = min(rush, 2.5);
  for (var j = 0; j < 4; j++) {
    let paw = textureLoad(wake, vec2i(PAWS + j, 0), 0);
    if (paw.z <= 0.005) { continue; }
    let q = p - paw.xy;
    let edge = length(q) - 0.025;
    if (edge > 0.9) { continue; }
    let wet = smoothstep(0.0, 0.03, paw.z);
    let cling = exp(-max(edge, 0.0) / (0.02 + pace * 0.03 + min(pace, 0.6) * 0.05)) * wet;
    foam = max(foam, cling * (0.55 + 0.25 * min(pace, 1.0)));
    bubbles = max(bubbles, cling * 0.7);
    // Downstream of the leg (u > 0), a froth furrow widening as it goes.
    let u = dot(q, downstream);
    let v = dot(q, across);
    let w = 0.02 + max(u, 0.0) * 0.28;
    let furrow = exp(-v * v / (w * w)) * exp(-max(u, 0.0) / (0.06 + 0.2 * pace)) * smoothstep(-0.02, 0.03, u) * smoothstep(0.08, 0.6, pace) * wet;
    foam = max(foam, furrow * 0.7);
    bubbles = max(bubbles, furrow * 0.8);
    let heap = exp(-max(edge, 0.0) / 0.05) * (pace + min(pace, 0.6)) * 0.008 * wet * clamp(-u / 0.04, -1.0, 1.0);
    out.height += heap;
    out.slope -= q / max(length(q), 0.001) * heap / 0.05 * step(0.0, edge);
    ripple(&out, q, 0.05 + fract(time * 2.3 + f32(j) * 0.37) * 0.3, 0.05, (0.0015 + 0.003 * pace) * min(paw.z * 20.0, 1.0), 55.0, pixel);
  }

  // Splashes: rings running outward and a burst of froth.
  let m = clamp(i32(counts.w), 0, 16);
  for (var k = 0; k < m; k++) {
    let s = textureLoad(wake, vec2i(RINGS + k, 0), 0);
    let age = time - s.z;
    if (age < 0.0 || age > 3.0 || s.w <= 0.0) { continue; }
    let q = p - s.xy;
    let front = 0.4 * age;
    ripple(&out, q, front, 0.04 + 0.1 * age, 0.009 * s.w * exp(-age / 1.1) * sqrt(0.1 / (0.1 + front)), 50.0, pixel);
    let spread = 0.05 + 0.22 * sqrt(age) * (0.5 + s.w * 0.5);
    let r2 = dot(q, q) / (spread * spread);
    let burst = exp(-age / (0.7 + 0.3 * min(s.w, 2.0))) * min(s.w, 1.2) * exp(-r2);
    // Froth pushed out to the first crest as it leaves.
    let rim_distance = (length(q) - front) / 0.04;
    let rim = exp(-age / 0.5) * s.w * exp(-rim_distance * rim_distance) * 0.5;
    foam = max(foam, max(burst * 0.9, rim));
    bubbles = max(bubbles, burst);
  }

  out.foam = min(foam, 1.0);
  out.bubbles = min(bubbles, 1.0);
  // Finer lace than the surf's: a cat's froth is small bubbles.
  out.lace = p * 2.6;
  return out;
}

// ---- boat: the fisherman's boat in the water (src/boat.js packs it). ------
// Its own texels (52…63), inside the same bounding circle as the cat's: the
// froth clinging round its waterline, the bow wave it pushes and the
// quarter wave at its transom, and along its path the Kelvin wake (feathered
// divergent crests strongest on the cusp lines 19.5° either side, the
// transverse waves between them, both the length a wave travelling with the
// boat must have, g/U²) over a churned, fading band of bubbles and foam.
// The hull itself, for the rest of the water: what the mirror sees of its
// topsides, the dark body under the surface, and its shadow on the sand.
const BOAT: i32 = 52;
const BOAT_PATH: i32 = 55;
const BOAT_HALF: f32 = 2.3;
// The waterline's half-breadth along the hull (boat-forms.js WATERPLANE).
fn hull_breadth(s: f32) -> f32 {
  if (s <= 0.0) { return 0.606 - 0.23 * s * s; }
  return 0.606 * pow(max(1.0 - s * s, 0.0), 0.9);
}

export struct Hull {
  // x, z, heading, the waterline's height (below -50: no hull here).
  pose: vec4f,
  // Speed through the water, sideways, chop, heave rate.
  motion: vec4f,
  // 1 inside the boat's bounding circle; points on its path.
  near: f32,
  count: f32,
};

export fn boat_hull(p: vec2f, wake: texture_2d<f32>) -> Hull {
  var h: Hull;
  h.pose = vec4f(0.0, 0.0, 0.0, -100.0);
  let bound = textureLoad(wake, vec2i(BOAT, 0), 0);
  let d = p - bound.xy;
  if (bound.z <= 0.0 || dot(d, d) > bound.z * bound.z) { return h; }
  h.near = 1.0;
  h.count = bound.w;
  h.pose = textureLoad(wake, vec2i(BOAT + 1, 0), 0);
  h.motion = textureLoad(wake, vec2i(BOAT + 2, 0), 0);
  return h;
}

// Into the hull's frame: (along, across), starboard +.
fn hull_local(p: vec2f, hull: Hull) -> vec2f {
  let fwd = vec2f(sin(hull.pose.z), cos(hull.pose.z));
  let q = p - hull.pose.xy;
  return vec2f(dot(q, fwd), dot(q, vec2f(fwd.y, -fwd.x)));
}

// Metres outside the waterline (negative inside).
fn hull_edge(q: vec2f) -> f32 {
  let s = clamp(q.x / BOAT_HALF, -1.0, 1.0);
  let side = abs(q.y) - hull_breadth(s);
  let end = abs(q.x) - BOAT_HALF;
  if (end > 0.0) { return length(vec2f(end, max(side, 0.0))); }
  return max(side, end);
}

export fn boat_sea(p: vec2f, pixel: f32, time: f32, wake: texture_2d<f32>, hull: Hull) -> RockSea {
  var out: RockSea;
  out.edge = 99.0;
  var foam = 0.0;
  var bubbles = 0.0;
  let speed = max(hull.motion.x, 0.0);
  let chop = hull.motion.z;
  let fwd = vec2f(sin(hull.pose.z), cos(hull.pose.z));
  let side = vec2f(fwd.y, -fwd.x);
  if (hull.pose.w > -50.0) {
    let q = hull_local(p, hull);
    let e = hull_edge(q);
    let oe = max(e, 0.0);
    let s = clamp(q.x / BOAT_HALF, -1.0, 1.0);
    // Froth at the waterline: a thin lace at rest, a white collar under way
    // and when the swell works it.
    let width = 0.03 + 0.05 * min(speed, 2.0) + 0.05 * chop;
    let cling = exp(-oe / width) * smoothstep(-0.05, 0.0, e);
    foam = cling * (0.22 + 0.3 * min(speed / 1.5, 1.0) + 0.3 * chop + 0.4 * min(abs(hull.motion.w), 0.5));
    bubbles = cling * 0.6;
    // Water heaped against the stem and the forward flanks, drawn down
    // amidships, and the quarter wave rising off the transom.
    let push = min(speed, 2.5);
    let fore = smoothstep(0.15, 0.95, s);
    let aft = smoothstep(-0.6, -1.0, s);
    let reach = 0.15 + 0.14 * push;
    let falloff = exp(-oe / reach);
    let heap = (fore * 0.026 - (1.0 - fore) * (1.0 - aft) * 0.008 + aft * 0.012) * push * push * falloff;
    let outward = normalize(side * select(-1.0, 1.0, q.y > 0.0) + fwd * (max(s - 0.4, 0.0) * 2.0 - max(-s - 0.85, 0.0) * 5.0));
    out.height += heap;
    out.slope -= outward * heap / reach * step(0.0, e);
    // The bow wave breaks white once it is going.
    let bow = fore * exp(-oe / (0.08 + 0.16 * push)) * smoothstep(0.5, 1.5, speed);
    foam = max(foam, bow * 0.85);
    bubbles = max(bubbles, bow);
    // Small rings lapping off the hull as the swell lifts and drops it.
    let lap = 0.002 + 0.006 * chop + 0.006 * min(abs(hull.motion.w), 0.4);
    ripple(&out, vec2f(oe + 0.3, 0.0), 0.3 + fract(time * 0.45) * 1.4, 0.12, lap * (1.0 - smoothstep(0.3, 1.2, speed)), 30.0, pixel);
    // The hull hides part of the sky from the water at its side.
    out.occlusion = exp(-oe / 0.2) * 0.5;
    out.edge = e;
  }
  // The wake: the nearest point on the boat's path, how far astern it was
  // left and how far to one side of it this water lies.
  let n = clamp(i32(hull.count), 0, 9);
  if (n > 0) {
    let first = textureLoad(wake, vec2i(BOAT_PATH, 0), 0);
    let afloat = hull.pose.w > -50.0;
    var prev = select(first.xy, hull.pose.xy - fwd * 2.2, afloat);
    var prev_age = select(max(time - first.z, 0.0), 0.0, afloat);
    var prev_strength = select(first.w, min(speed / 1.5, 1.5), afloat);
    var walked = 0.0;
    var best = 1e9;
    var a = 0.0;
    var d = 0.0;
    var age = 0.0;
    var strength = 0.0;
    var dir = -fwd;
    for (var i = 0; i < n; i++) {
      let t = textureLoad(wake, vec2i(BOAT_PATH + i, 0), 0);
      let seg = t.xy - prev;
      let len = length(seg);
      if (len > 0.01) {
        let sd = seg / len;
        let h = clamp(dot(p - prev, sd), 0.0, len);
        let off = p - prev - sd * h;
        let dist = dot(off, off);
        if (dist < best) {
          best = dist;
          let k = h / len;
          a = walked + h;
          d = dot(off, vec2f(-sd.y, sd.x));
          age = mix(prev_age, max(time - t.z, 0.0), k);
          strength = mix(prev_strength, t.w, k);
          dir = sd;
        }
        walked += len;
      }
      prev = t.xy;
      prev_age = max(time - t.z, 0.0);
      prev_strength = t.w;
    }
    // Beyond the last point astern the wake has gone.
    let u = max(strength * 1.5, 0.05);
    let fade = exp(-age / 6.0) * min(strength * 1.4, 1.2) * smoothstep(walked + 0.5, walked - 1.5, a);
    if (fade > 0.002) {
      let x = abs(d);
      let wedge = 0.354 * a + 0.35;
      let cross = select(-1.0, 1.0, d > 0.0) * vec2f(-dir.y, dir.x);
      // Divergent crests at 50° to the track: k = g / (U cos θ)².
      let kd = clamp(9.81 / (u * u * 0.413), 2.0, 9.0);
      let phase_d = kd * (a * 0.643 + x * 0.766);
      let cusp = exp(-pow((x - 0.354 * a) / (0.25 + 0.09 * a), 2.0)) * smoothstep(0.0, 0.6, a);
      let amp_d = 0.03 * fade * min(u / 1.2, 1.4) / sqrt(1.0 + a * 0.25);
      let keep_d = exp(-0.65 * (kd * pixel) * (kd * pixel));
      out.height += amp_d * cusp * cos(phase_d) * keep_d;
      out.slope -= (dir * 0.643 + cross * 0.766) * (amp_d * cusp * kd * sin(phase_d) * keep_d);
      out.variance += 0.5 * (amp_d * cusp * kd) * (amp_d * cusp * kd) * (1.0 - keep_d * keep_d);
      // Transverse waves across the track, inside the wedge.
      let kt = clamp(9.81 / (u * u), 1.8, 8.0);
      let phase_t = kt * a;
      let between = (1.0 - smoothstep(wedge * 0.6, wedge, x)) * smoothstep(0.2, 1.2, a);
      let amp_t = amp_d * 0.55;
      let keep_t = exp(-0.65 * (kt * pixel) * (kt * pixel));
      out.height += amp_t * between * cos(phase_t) * keep_t;
      out.slope -= dir * (amp_t * between * kt * sin(phase_t) * keep_t);
      // The churned band astern: bubbles and foam widening and thinning,
      // and a little white on the divergent crests close behind at speed.
      let w = 0.55 + 0.1 * a;
      let band = exp(-(x / w) * (x / w)) * exp(-age / 4.0) * min(strength * 1.5, 1.0);
      foam = max(foam, band * (0.5 - 0.2 * smoothstep(0.3, 0.8, x / w)));
      bubbles = max(bubbles, band * 0.9);
      let caps = pow(max(cos(phase_d), 0.0), 6.0) * cusp * smoothstep(1.0, 2.2, u) * exp(-a / 4.0) * fade;
      foam = max(foam, caps * 0.5);
      // The bow wave's foam trailing out along the arms of the V, broken
      // into crests and thinning as it spreads.
      let arm = exp(-pow((x - 0.354 * a) / (0.1 + 0.035 * a), 2.0)) * pow(max(cos(phase_d), 0.0), 2.0);
      foam = max(foam, arm * fade * smoothstep(0.4, 1.2, u) * exp(-age / 5.0) * 0.45);
      bubbles = max(bubbles, arm * fade * exp(-age / 3.0) * 0.5);
    }
  }
  out.foam = min(foam, 1.0);
  out.bubbles = min(bubbles, 1.0);
  out.lace = p * 2.2;
  return out;
}

// The topsides in the mirror: an elliptic cylinder over the waterline up
// to the gunwale. Returns (cover, height up the topsides 0…1, outward
// normal x, z).
export fn hull_mirror(p: vec3f, r: vec3f, hull: Hull) -> vec4f {
  if (hull.pose.w < -50.0 || r.y <= 0.0) { return vec4f(0.0); }
  let fwd = vec2f(sin(hull.pose.z), cos(hull.pose.z));
  let side = vec2f(fwd.y, -fwd.x);
  let axes = vec2f(2.3, 0.64);
  let o = hull_local(p.xz, hull) / axes;
  let dd = vec2f(dot(r.xz, fwd), dot(r.xz, side)) / axes;
  let a = dot(dd, dd);
  let b = dot(o, dd);
  let c = dot(o, o) - 1.0;
  let disc = b * b - a * c;
  if (c < 0.0 || disc <= 0.0 || b >= 0.0 || a < 1e-6) { return vec4f(0.0); }
  let t = (-b - sqrt(disc)) / a;
  let hit = o + dd * t;
  let rise = p.y + r.y * t - hull.pose.w;
  let free = 0.47 + 0.09 * hit.x * hit.x;
  if (rise > free) { return vec4f(0.0); }
  let n = normalize(hit / axes);
  let normal = n.x * fwd + n.y * side;
  return vec4f(smoothstep(free, free - 0.03, rise), clamp(rise / free, 0.0, 1.0), normal);
}

// The topsides' light: blue paint, a cream boot-top at the water, the
// pale rubbing strake and the varnished gunwale.
export fn hull_radiance(m: vec4f, light: vec3f, sun: vec3f, sky: vec3f) -> vec3f {
  var albedo = vec3f(0.021, 0.1, 0.19);
  if (m.y < 0.07) { albedo = vec3f(0.62, 0.58, 0.48); }
  if (m.y > 0.74 && m.y < 0.8) { albedo = vec3f(0.55, 0.5, 0.4); }
  if (m.y > 0.9) { albedo = vec3f(0.13, 0.07, 0.035); }
  let n = vec3f(m.z, 0.0, m.w);
  return albedo * (sun * max(dot(n, light), 0.0) * 0.3183 + sky * 0.55);
}

// The body under the water: the lower half of an ellipsoid (2.3 × 0.62 ×
// 0.25 m). Returns (cover, distance along the ray, depth of the hit).
export fn hull_sunk(p: vec3f, r: vec3f, hull: Hull) -> vec3f {
  if (hull.pose.w < -50.0) { return vec3f(0.0); }
  let fwd = vec2f(sin(hull.pose.z), cos(hull.pose.z));
  let side = vec2f(fwd.y, -fwd.x);
  let axes = vec3f(2.3, 0.25, 0.62);
  let q = hull_local(p.xz, hull);
  let o = vec3f(q.x, p.y - hull.pose.w, q.y) / axes;
  let d = vec3f(dot(r.xz, fwd), r.y, dot(r.xz, side)) / axes;
  let a = dot(d, d);
  let b = dot(o, d);
  let c = dot(o, o) - 1.0;
  let disc = b * b - a * c;
  if (disc <= 0.0 || b >= 0.0) { return vec3f(0.0); }
  let t = (-b - sqrt(disc)) / a;
  if (t <= 0.0) { return vec3f(0.0); }
  return vec3f(smoothstep(0.0, 0.02 * a, disc), t, max(hull.pose.w - (p.y + r.y * t), 0.0));
}

// The hull's shadow on the sand: 0 under it, 1 in the open. `bed` is the
// sand's point and depth, `up` the way back to the sun through the water.
export fn hull_shade(bed: vec2f, depth: f32, up: vec3f, hull: Hull) -> f32 {
  if (hull.pose.w < -50.0) { return 1.0; }
  let rise = depth + hull.pose.w;
  let s = bed + up.xz * (rise / max(up.y, 0.15));
  let e = hull_edge(hull_local(s, hull));
  let soft = 0.06 + 0.05 * rise;
  return mix(0.08, 1.0, smoothstep(-soft, soft, e));
}
