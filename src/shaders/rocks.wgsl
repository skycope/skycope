// Where the sea meets the boulders (src/rocks.js packs them). Each rock is a
// row of ten texels in shore_rocks: its world-to-local transform (0..2, the
// unit corestone), its waterline centre, reach radius and phase (3), sixteen
// waterline radii (4..7), its albedo with the radius its grid entries
// reach (8), and a bounding sphere (9). shore_grid
// lists up to eight rocks per 2 m cell as 16-bit (index + 1) pairs.

const TAU: f32 = 6.283185;
const GRID_ORIGIN: vec2f = vec2f(-42.0, -30.0);
const GRID_CELLS: f32 = 100.0;
const GRID_CELL: f32 = 2.0;
// The unit corestone's mean radius, for traced reflections and shadows.
const CORE: f32 = 0.93;
// How far the lapping ripples, foam and shelter reach beyond the waterline.
const REACH: f32 = 3.2;

export fn rock_slots(p: vec2f, grid: texture_2d<u32>) -> vec4u {
  let c = floor((p - GRID_ORIGIN) / GRID_CELL);
  if (any(c < vec2f(0.0)) || any(c >= vec2f(GRID_CELLS))) { return vec4u(0u); }
  return textureLoad(grid, vec2i(c), 0);
}

export fn rock_index(slots: vec4u, s: i32) -> i32 {
  return i32((slots[s >> 1u] >> (u32(s & 1) * 16u)) & 0xffffu) - 1;
}

// The waterline's radius at an angle round the rock, from its sixteen samples.
fn waterline(rocks: texture_2d<f32>, n: i32, angle: f32) -> f32 {
  let f = fract(angle / TAU + 1.0) * 16.0;
  let i0 = i32(floor(f)) % 16;
  let i1 = (i0 + 1) % 16;
  let r0 = textureLoad(rocks, vec2i(4 + i0 / 4, n), 0)[i0 % 4];
  let r1 = textureLoad(rocks, vec2i(4 + i1 / 4, n), 0)[i1 % 4];
  let t = fract(f);
  return mix(r0, r1, t * t * (3.0 - 2.0 * t));
}

// The broken swell reaching a rock: 0 while the water is low, rising to 1 as
// each bore surges up it. The same clock as the beach swash (ocean.wgsl
// swash, surf.js), so rocks and sand flood together.
fn surge(along: f32, time: f32, swell: vec4f) -> f32 {
  let psi = along * swell.x - swell.y * time + swell.z;
  let psi1 = psi - 0.65 * cos(psi);
  var theta = psi1 + 0.75 * sin(psi1);
  theta = psi1 + 0.75 * sin(theta);
  let s = fract(-theta / TAU) / 0.82;
  if (s >= 1.0) { return 0.0; }
  let x = sin(3.141593 * pow(s, 0.65));
  return x * x;
}

export struct RockSea {
  height: f32,
  slope: vec2f,
  variance: f32,
  // Foam density and bubble cloud from the collar and lapping crests.
  foam: f32,
  bubbles: f32,
  // Calm in each rock's lee (0..1), and skylight blocked near its base.
  shelter: f32,
  occlusion: f32,
  // Metres to the nearest waterline (large when none is near), and the
  // coordinates foam lace uses round it: (along the waterline, out from it).
  edge: f32,
  lace: vec2f,
};

// Lapping: every rock in reach sends small rings out from its waterline,
// strongest just after each bore hits it (the ring at distance d left the
// rock d / c ago), plus a finer train from the wind chop reflecting off it.
// Its lee is sheltered from the chop; foam clings to the contact line, is
// thrown out on the crests and drains round into the lee.
export fn rock_sea(p: vec2f, pixel: f32, time: f32, wind: f32, swell: vec4f,
  slots: vec4u, rocks: texture_2d<f32>) -> RockSea {
  var out: RockSea;
  out.edge = 99.0;
  for (var s = 0; s < 8; s++) {
    let n = rock_index(slots, s);
    if (n < 0) { break; }
    let info = textureLoad(rocks, vec2i(3, n), 0);
    if (info.z <= 0.0) { continue; }
    let d = p - info.xy;
    let dist = max(length(d), 0.001);
    if (dist - info.z > REACH) { continue; }
    let dir = d / dist;
    let angle = atan2(d.y, d.x);
    let contact = waterline(rocks, n, angle);
    let edge = dist - contact;
    if (edge > REACH) { continue; }
    let island = info.xy - vec2f(58.0, 70.0);
    let along = atan2(island.y, island.x) * 62.0;
    let now = surge(along, time, swell);
    // Rings are not perfect circles: the rock's own outline and the chop
    // bend them.
    let wobble = 0.7 * sin(angle * 3.0 + info.w) + 0.4 * sin(angle * 5.0 - info.w * 1.7);
    let spread = sqrt(contact / (contact + max(edge, 0.0)));
    let out_edge = max(edge, 0.0);
    // Surge rings: ~45 cm, at the gravity-wave speed for that length.
    let k1 = 14.0;
    let c1 = 0.84;
    let then = surge(along, time - out_edge / c1, swell);
    let a1 = (0.006 + 0.03 * then) * exp(-out_edge / 1.3) * spread;
    let phase1 = k1 * out_edge - k1 * c1 * time + info.w + wobble;
    // Chop reflected off the rock face: ~25 cm, capillary-gravity speed.
    let k2 = 25.0;
    let c2 = 0.62;
    let a2 = (0.003 + 0.0006 * min(wind, 12.0)) * exp(-out_edge / 0.7) * spread;
    let r1 = exp(-0.65 * (k1 * pixel) * (k1 * pixel));
    let r2 = exp(-0.65 * (k2 * pixel) * (k2 * pixel));
    // Far off the rings are only roughness.
    if (r1 > 0.01) {
      let phase2 = k2 * out_edge - k2 * c2 * time + info.w * 3.1 - wobble * 1.3;
      let inside = smoothstep(-0.05, 0.1, edge);
      out.height += (a1 * cos(phase1) * r1 + a2 * cos(phase2) * r2) * inside;
      out.slope -= dir * (a1 * k1 * sin(phase1) * r1 + a2 * k2 * sin(phase2) * r2) * inside;
    }
    out.variance += 0.5 * ((a1 * k1) * (a1 * k1) * (1.0 - r1 * r1) + (a2 * k2) * (a2 * k2) * (1.0 - r2 * r2));
    // The lee: the shoreward side of the rock, relative to the incoming sea.
    let seaward = normalize(island);
    let lee = smoothstep(-0.1, 0.8, -dot(dir, seaward));
    out.shelter = max(out.shelter, lee * exp(-out_edge / (0.9 * contact + 0.4)));
    out.occlusion = max(out.occlusion, exp(-out_edge / (0.25 + 0.2 * contact)) * 0.6);
    // Foam: a collar clinging to the contact line, fattening on the surge;
    // lace thrown out on each surge ring's crest; and drained foam trailing
    // round into the lee.
    let cling = exp(-out_edge / (0.05 + now * 0.3)) * smoothstep(-0.25, -0.02, edge);
    let crest = smoothstep(0.6, 1.0, cos(phase1)) * then * exp(-out_edge / 0.7) * 0.55;
    let trail = lee * exp(-out_edge / (0.4 + contact * 0.3)) * 0.3 * (0.3 + 0.7 * now);
    let foam = max(cling * (0.45 + 0.5 * now), max(crest, trail));
    out.bubbles = max(out.bubbles, max(cling * (0.5 + 0.5 * now), crest * 0.6));
    if (foam > out.foam) {
      out.foam = foam;
      out.lace = vec2f(angle * (contact + out_edge), out_edge * 1.6 - now * 0.5 + info.w);
    }
    out.edge = min(out.edge, edge);
  }
  return out;
}

export struct RockHit {
  // How much of the pixel the rock covers, how far along the ray, its
  // world normal and its albedo, and how high the hit is (for wetting).
  cover: f32,
  t: f32,
  normal: vec3f,
  albedo: vec3f,
  y: f32,
};

// The three rays the water needs from one surface point: toward the sun
// (shadow), the reflection, and the refraction into the water.
export struct RockHits {
  shadow: f32,
  mirrored: RockHit,
  sunk: RockHit,
};

// One ray against one corestone (an ellipsoid through the rock's transform,
// already in its local frame). cover is soft: it fades over `soft` of the
// corestone's radius at the silhouette, widening by `spread` per metre, for
// filtered reflections and penumbrae.
fn corestone(o: vec3f, d: vec3f, soft: f32, spread: f32, fade: f32, hit: ptr<function, RockHit>, m0: vec4f, m1: vec4f, m2: vec4f, albedo: vec3f, origin_y: f32, ray_y: f32) {
  let a = dot(d, d);
  let b = dot(o, d);
  let t_near = -b / a;
  if (t_near <= 0.0) { return; }
  let closest = sqrt(max(dot(o, o) - b * b / a, 0.0));
  let blur = soft + spread * t_near * sqrt(a);
  let cover = (1.0 - smoothstep(CORE - blur, CORE + blur * 0.5, closest)) * fade;
  if (cover <= 0.0) { return; }
  let half_chord = sqrt(max(CORE * CORE - closest * closest, 0.0)) / sqrt(a);
  let t = max(t_near - half_chord, 0.0);
  (*hit).cover = max((*hit).cover, cover);
  if (t < (*hit).t) {
    (*hit).t = t;
    let local = normalize(o + d * t);
    // World normal: the local normal through the inverse transform's transpose.
    (*hit).normal = normalize(m0.xyz * local.x + m1.xyz * local.y + m2.xyz * local.z);
    (*hit).albedo = albedo;
    (*hit).y = origin_y + ray_y * t;
  }
}

// Is this pixel's sea hidden behind a boulder? The eye ray passes well
// inside a corestone listed here (inside the mesh, whose radius never dips
// below ~0.7 of the unit corestone) and meets it above its see-through
// waterline band: the rock mesh on the land layer covers this pixel, so the
// water need not be shaded at all. Conservative: rocks far from the sea
// point are not listed, and those rays are shaded as usual.
export fn rock_hides(eye: vec3f, ray: vec3f, distance: f32, slots: vec4u, rocks: texture_2d<f32>) -> bool {
  for (var s = 0; s < 8; s++) {
    let n = rock_index(slots, s);
    if (n < 0) { break; }
    let sphere = textureLoad(rocks, vec2i(9, n), 0);
    if (!grazes(eye, ray, sphere)) { continue; }
    let m0 = textureLoad(rocks, vec2i(0, n), 0);
    let m1 = textureLoad(rocks, vec2i(1, n), 0);
    let m2 = textureLoad(rocks, vec2i(2, n), 0);
    let o = vec3f(dot(m0.xyz, eye) + m0.w, dot(m1.xyz, eye) + m1.w, dot(m2.xyz, eye) + m2.w);
    let d = vec3f(dot(m0.xyz, ray), dot(m1.xyz, ray), dot(m2.xyz, ray));
    let a = dot(d, d);
    let b = dot(o, d);
    let c = dot(o, o) - 0.49;
    let disc = b * b - a * c;
    if (disc <= 0.0) { continue; }
    let t = (-b - sqrt(disc)) / a;
    if (t > 0.0 && t < distance && eye.y + ray.y * t > 0.3) { return true; }
  }
  return false;
}

// Does a ray pass within a sphere? (The ray is unit length.)
fn grazes(origin: vec3f, ray: vec3f, sphere: vec4f) -> bool {
  let o = sphere.xyz - origin;
  let along = dot(o, ray);
  return along > -sphere.w && dot(o, o) - along * along < sphere.w * sphere.w;
}

// All three rays against every rock listed for this cell. Each rock is read
// once, and skipped after one read when no ray comes near its bounding
// sphere. Every rock fades out before the grid stops listing it, or shadows
// and reflections would stop dead at the edge of a grid cell.
export fn rock_traces(origin: vec3f, light: vec3f, reflected: vec3f, refracted: vec3f, roughness: f32,
  slots: vec4u, rocks: texture_2d<f32>) -> RockHits {
  var hits: RockHits;
  var shadow: RockHit;
  hits.mirrored.t = 1e6;
  hits.sunk.t = 1e6;
  shadow.t = 1e6;
  let lifted = origin + vec3f(0.0, 0.02, 0.0);
  for (var s = 0; s < 8; s++) {
    let n = rock_index(slots, s);
    if (n < 0) { break; }
    let sphere = textureLoad(rocks, vec2i(9, n), 0);
    let to_sun = light.y > 0.0 && grazes(lifted, light, sphere);
    let to_sky = grazes(origin, reflected, sphere);
    let to_bed = grazes(origin, refracted, sphere);
    if (!(to_sun || to_sky || to_bed)) { continue; }
    let m0 = textureLoad(rocks, vec2i(0, n), 0);
    let m1 = textureLoad(rocks, vec2i(1, n), 0);
    let m2 = textureLoad(rocks, vec2i(2, n), 0);
    let colour = textureLoad(rocks, vec2i(8, n), 0);
    let away = length(origin.xz - sphere.xz);
    let fade = 1.0 - smoothstep(colour.w - 3.0, colour.w - 0.3, away);
    let o = vec3f(dot(m0.xyz, origin) + m0.w, dot(m1.xyz, origin) + m1.w, dot(m2.xyz, origin) + m2.w);
    if (to_sun) {
      let ol = o + vec3f(m0.y, m1.y, m2.y) * 0.02;
      corestone(ol, vec3f(dot(m0.xyz, light), dot(m1.xyz, light), dot(m2.xyz, light)), 0.06, 0.035, fade, &shadow, m0, m1, m2, colour.rgb, lifted.y, light.y);
    }
    if (to_sky) {
      corestone(o, vec3f(dot(m0.xyz, reflected), dot(m1.xyz, reflected), dot(m2.xyz, reflected)), 0.03, roughness * 0.25, fade, &hits.mirrored, m0, m1, m2, colour.rgb, origin.y, reflected.y);
    }
    if (to_bed) {
      corestone(o, vec3f(dot(m0.xyz, refracted), dot(m1.xyz, refracted), dot(m2.xyz, refracted)), 0.04, 0.01, fade, &hits.sunk, m0, m1, m2, colour.rgb, origin.y, refracted.y);
    }
  }
  hits.shadow = shadow.cover;
  return hits;
}
