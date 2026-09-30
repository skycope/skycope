// The distant archipelago, for the sea. The land layer draws the islands as
// geometry (src/archipelago.js); the sea only needs their reflections and
// the sun they hide. Each island arrives baked as its skyline — 24
// elevation tangents across its angular span, seen from the island's centre
// at sea level (archipelagoUniform) — reprojected here from the water point
// by distance. No marching, no noise: per island a bearing test, and for the
// few rays inside a span one profile lookup. Coordinates are coast metres.
export struct ArchipelagoHit {
  distance: f32,
  normal: vec3f,
  albedo: vec3f,
  // Soft coverage: a rippled mirror smears the skyline over `blur` radians.
  cover: f32,
};

// The fraction of the sun's disc the islands leave visible from the camera
// (computed once per frame on the CPU).
export fn archipelago_sun(islands: texture_2d<f32>) -> f32 {
  return textureLoad(islands, vec2u(0u, 0u), 0).y;
}

// Nearest island along `ray` from `origin` (just above the sea), covering it
// by more than `blur` radians of its skyline, within `max_distance`.
export fn archipelago_hit(origin: vec3f, ray: vec3f, islands: texture_2d<f32>, max_distance: f32) -> ArchipelagoHit {
  var best = ArchipelagoHit(0.0, vec3f(0.0, 1.0, 0.0), vec3f(0.0), 0.0);
  let header = textureLoad(islands, vec2u(0u, 0u), 0);
  let count = u32(header.x);
  let level = length(ray.xz);
  // Most rays leave early: above every skyline, or meeting the sea before
  // the nearest island.
  if (level < 1e-4 || ray.y > header.w * level || max_distance * level < header.z) { return best; }
  let across = ray.xz / level;
  let rise = ray.y / level;
  for (var k = 0u; k < count; k++) {
    let base = 1u + k * 8u;
    let head = textureLoad(islands, vec2u(base, 0u), 0);
    let toward = head.xy - origin.xz;
    let distance = length(toward);
    if (distance * 0.7 > max_distance * level) { continue; }
    // Bearing off the island's centre, scaled back to the baked view.
    let scale = head.z / max(distance, 1.0);
    let angle = atan2(toward.x * across.y - toward.y * across.x, dot(toward, across)) / scale;
    let s = angle / head.w;
    if (abs(s) >= 1.0) { continue; }
    let x = (s * 0.5 + 0.5) * 23.0;
    let i = u32(floor(x));
    let j = min(i + 1u, 23u);
    let a = textureLoad(islands, vec2u(base + 2u + (i >> 2u), 0u), 0)[i & 3u];
    let b = textureLoad(islands, vec2u(base + 2u + (j >> 2u), 0u), 0)[j & 3u];
    // The skyline's elevation from here: nearer means taller, and a raised
    // eye looks down on it.
    let top = mix(a, b, x - f32(i)) * scale - origin.y / distance;
    let edge = 0.6 / 23.0;
    let taper = smoothstep(0.0, edge, 1.0 - abs(s));
    let covered = top - rise;
    if (covered <= 0.0 || taper <= 0.0) { continue; }
    if (best.cover == 0.0 || distance < best.distance) {
      best = ArchipelagoHit(distance, vec3f(0.0, 1.0, 0.0), textureLoad(islands, vec2u(base + 1u, 0u), 0).rgb, taper);
      // Carry the clearance for the soft edge in normal.x.
      best.normal = vec3f(covered, top, 0.0);
    }
  }
  return best;
}

export fn archipelago_radiance(origin: vec3f, ray: vec3f, islands: texture_2d<f32>, blur: f32,
    light: vec3f, direct: vec3f, sky: vec3f, horizon: vec3f) -> vec4f {
  // Search the skyline widened by the blur, then soften across it.
  let lifted = normalize(vec3f(ray.x, ray.y - blur * length(ray.xz), ray.z));
  let hit = archipelago_hit(origin, lifted, islands, 1e9);
  if (hit.cover <= 0.0) { return vec4f(0.0); }
  let clearance = hit.normal.x - blur;
  let cover = smoothstep(-blur, blur, clearance) * hit.cover;
  if (cover <= 0.0) { return vec4f(0.0); }
  // A slope facing the viewer, tipped toward the sky; flanks lit by a low
  // sun, crests brighter than the shore.
  let level = normalize(vec3f(-ray.x, 0.0, -ray.z) + vec3f(1e-5, 0.0, 0.0));
  let height = saturate(1.0 - clearance / max(hit.normal.y, 1e-4));
  let normal = normalize(level * 0.7 + vec3f(0.0, 0.7, 0.0));
  let diffuse = max(dot(normal, light), 0.0) * (0.75 + 0.5 * height);
  let irradiance = direct * diffuse * 0.3183099 + sky * 0.9;
  // Clear maritime air: blue fades first, as in the land layer.
  let transmit = exp(-hit.distance * vec3f(5e-5, 6e-5, 8e-5));
  var colour = hit.albedo * irradiance;
  colour = mix(colour, vec3f(dot(colour, vec3f(0.2126, 0.7152, 0.0722))), (1.0 - transmit.g) * 0.4);
  return vec4f(colour * transmit + horizon * (1.0 - transmit), cover);
}
