// Camera-relative metres: x right, y up, z toward the coast. Everything here is
// linear light in the sky pass's exposed units; water.wgsl tonemaps once.
export struct OceanSettings {
  time: f32,
  scene: f32,
  wind: vec2f,
  overcast: f32,
  resolution: vec2f,
  seed: f32,
  eye: vec3f,
  azimuth: f32,
  pitch: f32,
  sunlight: vec3f,
  skylight: vec3f,
};

// Coastal Atlantic water: pure-water absorption (red goes first) plus a little
// phytoplankton and dissolved organics, which push the shallows toward
// green-turquoise and the deep water toward ink blue.
const ABSORPTION: vec3f = vec3f(0.46, 0.085, 0.055);
const SCATTERING: f32 = 0.018;

// Camera basis in coast-local coordinates (x offshore-to-inland, z along the
// shore): the world heading rotated 45°, used for footprint filtering and the
// screen-space sky-texture lookups.
fn coast_forward(azimuth: f32, pitch: f32) -> vec3f {
  let hx = (sin(azimuth) + cos(azimuth)) * 0.707107;
  let hz = (cos(azimuth) - sin(azimuth)) * 0.707107;
  return vec3f(hx * cos(pitch), sin(pitch), hz * cos(pitch));
}

export fn ocean_view(
  ray: vec3f, sunlight: vec3f, sky: vec3f,
  settings: OceanSettings, noise: texture_3d<f32>, filtering: sampler, sky_texture: texture_2d<f32>,
) -> vec3f {
  let right = vec3f(0.707107, 0.0, 0.707107);
  let forward = vec3f(-0.707107, 0.0, 0.707107);
  let direction = vec3f(dot(ray, right), ray.y, dot(ray, forward));
  // The ocean is boundless: every ray below the horizon meets water. The
  // island's terrain mesh covers the sea surface it stands on.
  if (direction.y >= -0.0001) { return sky; }
  let light = vec3f(dot(sunlight, right), sunlight.y, dot(sunlight, forward));
  let eye = settings.eye;
  if (eye.y <= 0.2) { return sky; }
  var distance = -eye.y / direction.y;
  // Only broad swells displace the intersection. Fine waves shade its normal;
  // tracing them with Newton steps produces discontinuous roots and dotted bands.
  // A ray covers more sea at grazing angles. Filter before sampling, not afterwards:
  // averaging already-aliased normals cannot remove distant stripes or sparkles.
  let forward_c = coast_forward(settings.azimuth, settings.pitch);
  let right_c = normalize(vec3f(forward_c.z, 0.0, -forward_c.x));
  let up_c = cross(forward_c, right_c);
  let pixel_angle = max(dot(direction, forward_c), 0.05) / (settings.resolution.y * 0.9);
  let horizontal = right_c.xz * distance * pixel_angle;
  let vertical = (up_c.xz - direction.xz * up_c.y / direction.y) * distance * pixel_angle;
  let footprint = mat2x2f(horizontal, vertical);
  let displacement = smoothstep(0.10, 0.28, -direction.y);
  for (var i = 0; i < 3; i++) {
    let p = eye + direction * distance;
    let wave = wave_surface(p.xz, footprint, settings, true) * displacement;
    let derivative = min(direction.y - dot(wave.yz, direction.xz), -0.035);
    let correction = clamp((p.y - wave.x) / derivative, -distance * 0.12, distance * 0.12);
    distance -= correction;
  }
  let p = eye + direction * distance;
  var waves = wave_surface(p.xz, footprint, settings, false);
  waves += ripple_surface(p.xz, footprint, settings, noise, filtering);
  return ocean(p, direction, light, sky, waves, footprint, distance, settings, noise, filtering, sky_texture);
}

fn ocean(
  p: vec3f, ray: vec3f, light: vec3f, sky: vec3f, waves: vec4f,
  footprint: mat2x2f, distance: f32, settings: OceanSettings,
  noise: texture_3d<f32>, filtering: sampler, sky_texture: texture_2d<f32>,
) -> vec3f {
  // Keep most wave slope even at grazing angles: distant water must stay
  // textured so the sun path breaks into streaks instead of a smooth band.
  let grazing = smoothstep(0.002, 0.04, -ray.y) * (0.55 + 0.45 * smoothstep(0.01, 0.09, -ray.y));
  let normal = normalize(vec3f(-waves.y * grazing, 1.0, -waves.z * grazing));
  let view = -ray;
  let nv = max(dot(normal, view), 0.01);
  let reflected = reflect(ray, normal);
  let fresnel = 0.02 + 0.98 * pow(1.0 - nv, 5.0);
  let night = smoothstep(1.0, 2.0, settings.scene);
  let sun_up = smoothstep(-0.02, 0.04, light.y);
  let direct = settings.sunlight * (1.0 - settings.overcast * 0.8);
  let metrics = shore_metrics(p.xz);
  let offshore = max(0.0, metrics.x);
  let depth = seabed_depth(offshore);

  // ---- Reflection: the sky pass, sampled along the reflected ray. ----------
  // Off-screen reflections fall back to the sky sampled at the horizon along
  // this ray's azimuth, so the sunset gradient carries across the whole sea.
  let forward_c = coast_forward(settings.azimuth, settings.pitch);
  let right_c = normalize(vec3f(forward_c.z, 0.0, -forward_c.x));
  let up_c = cross(forward_c, right_c);
  let aspect = settings.resolution.y / settings.resolution.x;
  let horizon_dir = normalize(vec3f(ray.x, 0.05, ray.z));
  let horizon_depth = max(dot(horizon_dir, forward_c), 0.2);
  let horizon_uv = clamp(vec2f(
    0.5 + dot(horizon_dir, right_c) * 0.9 / horizon_depth * aspect,
    0.5 - dot(horizon_dir, up_c) * 0.9 / horizon_depth,
  ), vec2f(0.001), vec2f(0.999));
  let horizon_sky = textureSampleLevel(sky_texture, filtering, horizon_uv, 0.0).rgb;
  var reflection = mix(horizon_sky, settings.skylight * 1.1, smoothstep(0.0, 0.45, reflected.y));
  let reflected_depth = dot(reflected, forward_c);
  let reflected_uv = vec2f(0.5 + dot(reflected, right_c) * 0.9 / max(reflected_depth, 0.01) * aspect,
    0.5 - dot(reflected, up_c) * 0.9 / max(reflected_depth, 0.01));
  if (reflected_depth > 0.0 && all(reflected_uv > vec2f(0.0)) && all(reflected_uv < vec2f(1.0))) {
    // Blur grows with sub-pixel roughness: a calm sea mirrors clouds sharply,
    // a choppy one smears them into vertical streaks.
    let spread = 0.004 + sqrt(waves.w) * 0.05;
    let blur = vec2f(spread * aspect, spread * 2.2);
    let lo = vec2f(0.001);
    let hi = vec2f(0.999);
    let blurred = (textureSampleLevel(sky_texture, filtering, clamp(reflected_uv + blur * vec2f(-0.7, -0.3), lo, hi), 0.0).rgb
      + textureSampleLevel(sky_texture, filtering, clamp(reflected_uv + blur * vec2f(0.3, -0.7), lo, hi), 0.0).rgb
      + textureSampleLevel(sky_texture, filtering, clamp(reflected_uv + blur * vec2f(0.7, 0.3), lo, hi), 0.0).rgb
      + textureSampleLevel(sky_texture, filtering, clamp(reflected_uv + blur * vec2f(-0.3, 0.7), lo, hi), 0.0).rgb) * 0.25;
    let edge = min(min(reflected_uv.x, reflected_uv.y), min(1.0 - reflected_uv.x, 1.0 - reflected_uv.y));
    reflection = mix(reflection, blurred, smoothstep(0.0, 0.08, edge));
  }

  // ---- Transmission: refract into the water column and onto the seabed. ----
  let refracted = refract(ray, normal, 0.7519);
  let down = max(-refracted.y, 0.05);
  let path = min(depth / down, 60.0);
  let bed = p.xz + refracted.xz * path;
  let bed_depth = seabed_depth(max(0.0, shore_metrics(bed).x));
  let light_down = max(-refract(-light, vec3f(0.0, 1.0, 0.0), 0.7519).y, 0.2);
  // Light reaching the seabed: the sun through the column plus diffuse sky.
  // Lambertian: irradiance / π. Sky irradiance is roughly π × zenith radiance.
  let bed_light = (direct * sun_up * max(light.y, 0.0) * 0.3183 * exp(-ABSORPTION * bed_depth / light_down)
      * caustics(bed, settings.time, noise, filtering, bed_depth)
    + settings.skylight * exp(-ABSORPTION * bed_depth * 1.2)) * seabed_shadows(bed, settings, noise, filtering);
  let bed_colour = seabed(bed, offshore, settings, noise, filtering) * bed_light;
  let column = exp(-(ABSORPTION + SCATTERING) * path);
  // Single scattering in the water column: sunlight scattered back toward the
  // eye, tinted by the absorption it survived. This is the colour of deep water.
  let sigma_t = ABSORPTION + SCATTERING;
  let inscatter_light = (direct * sun_up * (0.4 + 0.6 * max(light.y, 0.0)) * 0.3183 + settings.skylight)
    * (SCATTERING / sigma_t) * 0.5;
  var transmitted = bed_colour * column + inscatter_light * (1.0 - column);

  // Kelp: Ecklonia beds float their fronds at the surface a little offshore.
  let kelp = kelp_canopy(p.xz, offshore, settings, noise, filtering);
  let kelp_colour = vec3f(0.06, 0.045, 0.014) * (direct * sun_up * max(normal.y * light.y, 0.0) * 0.3183 + settings.skylight);
  transmitted = mix(transmitted, kelp_colour, kelp * 0.85);

  // Backlit crests: light passing through thin wave tops glows green-blue.
  let backlit = pow(max(dot(-view.xz, light.xz) / max(length(light.xz), 0.001), 0.0), 2.0)
    * smoothstep(-0.02, 0.1, waves.x) * sun_up * (1.0 - smoothstep(0.1, 0.6, light.y));
  transmitted += vec3f(0.06, 0.42, 0.34) * direct * backlit * 0.035;

  var color = mix(transmitted, reflection, fresnel * (1.0 - kelp * 0.6));

  // ---- Sun glitter. ---------------------------------------------------------
  // Unresolved waves become microfacet roughness: the broad path's width and
  // length come from real slope variance, so it stretches from the horizon to
  // the viewer at low sun and tightens at noon.
  let wind = min(length(settings.wind), 14.0);
  let alpha = sqrt(0.004 + waves.w * 3.0 + wind * 0.0012);
  let half_vector = normalize(light + view);
  let nh = max(dot(normal, half_vector), 0.0);
  let nl = max(dot(normal, light), 0.0);
  let vh = max(dot(view, half_vector), 0.0);
  let reflection_fresnel = 0.02 + 0.98 * pow(1.0 - vh, 5.0);
  let specular = ggx(nh, nv, nl, alpha * alpha) * reflection_fresnel;
  // A rougher tail for the scattered fringe of the path.
  let a2_tail = min(0.3, alpha * alpha * 9.0);
  let tail = ggx(nh, nv, nl, a2_tail) * reflection_fresnel;
  // Patchy energy: real paths are sparkle fields crossed by dark troughs.
  let glitter_patch = field(p.xz * vec2f(0.33, 0.11) + vec2f(settings.time * 0.03, 0.0), noise, filtering) * 0.6
    + field(p.xz * vec2f(0.071, 0.052) - vec2f(settings.time * 0.012, 0.0), noise, filtering) * 0.4;
  let sun_disc = direct * sun_up * (1.0 - night * 0.2);
  // Squared patchiness: bright sparkle fields separated by genuinely dark troughs.
  let patchy = glitter_patch * glitter_patch;
  color += sun_disc * (specular * (0.12 + patchy * 2.2) + tail * 0.1 * patchy) * 0.9;
  // Glints: individual sub-pixel facets that catch the sun's disc outright.
  // Each world-space cell (scaled to the pixel footprint) draws a random facet
  // from the unresolved slope distribution; those mirror-aligned with the sun
  // flash far past white and twinkle as the facets re-roll. HDR plus the
  // filmic shoulder turns them into the hot, deep sparkle of a real sea.
  color += sun_disc * glints(p.xz, ray, light, normal, waves.w + wind * 0.0004, footprint, settings.time) * fresnel_glint(nv);

  // ---- Foam and whitewater. -------------------------------------------------
  let foam = surf_foam(p.xz, offshore, waves, footprint, settings, noise, filtering);
  let foam_light = direct * sun_up * max(light.y, 0.08) * 0.3183 + settings.skylight * 1.1;
  color = mix(color, vec3f(0.82, 0.86, 0.88) * foam_light, foam);

  // Aerial perspective: air, not a wall of fog. The horizon stays crisp.
  return mix(color, sky, 1.0 - exp(-distance * 0.00022));
}

fn ggx(nh: f32, nv: f32, nl: f32, a2: f32) -> f32 {
  let d = nh * nh * (a2 - 1.0) + 1.0;
  let distribution = a2 / max(3.141593 * d * d, 0.000001);
  return distribution * smith(nv, a2) * smith(nl, a2) / (4.0 * nv);
}

fn fresnel_glint(nv: f32) -> f32 {
  return 0.02 + 0.98 * pow(1.0 - nv, 5.0);
}

fn glints(p: vec2f, ray: vec3f, light: vec3f, normal: vec3f, variance: f32, footprint: mat2x2f, time: f32) -> f32 {
  let pixel = max(length(footprint[0]), length(footprint[1]));
  let sigma = sqrt(max(variance, 0.0004));
  var total = 0.0;
  var scale = max(pixel * 0.9, 0.035);
  for (var layer = 0; layer < 2; layer++) {
    let q = p / scale + f32(layer) * 17.3;
    let cell = floor(q);
    let local = fract(q) - 0.5;
    let seed = hash22(cell + f32(layer) * 41.0);
    // Facets re-roll at their own rate: twinkling, not a static speckle.
    let epoch = floor(time * (2.5 + seed.x * 3.0) + seed.y * 7.0);
    let r = hash22(cell * 1.37 + epoch * 0.61);
    // Box-Muller: a Gaussian slope from the unresolved wave spectrum.
    let radius = sqrt(-2.0 * log(max(r.x, 0.0001))) * sigma * 1.2;
    let slope = vec2f(cos(r.y * 6.283185), sin(r.y * 6.283185)) * radius;
    let facet = normalize(normal + vec3f(-slope.x, 0.0, -slope.y));
    let mirror = dot(reflect(ray, facet), light);
    // Hit the (slightly enlarged) sun disc; round, small flashes within the cell.
    let hit = smoothstep(0.9993, 0.99992, mirror);
    let shape = 1.0 - smoothstep(0.1, 0.42, length(local));
    // Weight so the average matches roughly what the smooth lobe already
    // shows; the point is concentration, not extra energy.
    total += hit * shape * 900.0 / (1.0 + sigma * 40.0);
    scale *= 0.43;
  }
  // Far away many glints share one pixel and average into the smooth path.
  return total * (1.0 - smoothstep(0.25, 1.2, pixel));
}

// Seabed depth below the surface for a given offshore distance: a gentle
// sandy shelf near the beach, then a steeper drop into blue water.
fn seabed_depth(offshore: f32) -> f32 {
  return offshore * 0.12 + max(0.0, offshore - 14.0) * 0.22 + max(0.0, offshore - 45.0) * 0.4;
}

// Sand with wave-formed ripples, granite outcrops, seagrass, and scattered
// shells, graded by depth. Colours are linear albedo.
fn seabed(p: vec2f, offshore: f32, settings: OceanSettings, noise: texture_3d<f32>, filtering: sampler) -> vec3f {
  let metrics = shore_metrics(p);
  let along = metrics.w;
  let ripple_warp = field(p * 0.35, noise, filtering) * 3.0;
  let ripples = 0.5 + 0.5 * sin(metrics.x * 5.5 + ripple_warp + along * 0.15);
  var sand = mix(vec3f(0.3, 0.26, 0.18), vec3f(0.42, 0.37, 0.27), field(p * 0.9, noise, filtering));
  sand *= 0.82 + ripples * 0.22;
  // Granite boulders and reef: a patch field, dark and lichen-flecked.
  let reef = smoothstep(0.62, 0.7, field(p * 0.11 + 7.0, noise, filtering) * 0.7 + field(p * 0.5, noise, filtering) * 0.3)
    * smoothstep(3.0, 10.0, offshore);
  let rock = mix(vec3f(0.09, 0.08, 0.07), vec3f(0.2, 0.17, 0.13), field(p * 2.1, noise, filtering));
  // Seagrass meadows in the calmer mid-shelf.
  let grass = smoothstep(0.55, 0.66, field(p * 0.16 - 3.0, noise, filtering))
    * smoothstep(5.0, 12.0, offshore) * (1.0 - smoothstep(30.0, 45.0, offshore));
  let blades = 0.6 + 0.4 * field(p * vec2f(6.0, 1.3) + settings.time * vec2f(0.15, 0.0), noise, filtering);
  var colour = mix(sand, vec3f(0.05, 0.1, 0.03) * blades, grass);
  colour = mix(colour, rock, reef);
  // Scattered shell grit and darker pebbles: soft, round and sub-metre.
  let cell = floor(p * 2.0);
  let spot = hash22(cell);
  let round = 1.0 - smoothstep(0.08, 0.2, length(fract(p * 2.0) - 0.3 - spot * 0.4));
  colour *= 1.0 - round * select(0.0, 0.4, spot.x > 0.9) * (1.0 - reef);
  return colour;
}

// Refracted sunlight focused by the surface: sharp bright webs that swim with
// the waves, blurred by depth as the focus spreads.
fn caustics(p: vec2f, time: f32, noise: texture_3d<f32>, filtering: sampler, depth: f32) -> f32 {
  let a = volume(vec3f(p * 0.9 + vec2f(time * 0.05, time * 0.03), time * 0.11), noise, filtering);
  let b = volume(vec3f(p * 1.3 - vec2f(time * 0.04, -time * 0.05), 13.0 + time * 0.09), noise, filtering);
  let sharp = 1.0 / (1.0 + depth * 0.25);
  let web = pow(1.0 - abs(a - b), mix(3.0, 14.0, sharp));
  return 0.6 + web * mix(0.35, 1.7, sharp);
}

// Kelp canopy shadows and passing fish schools darken the seabed.
fn seabed_shadows(p: vec2f, settings: OceanSettings, noise: texture_3d<f32>, filtering: sampler) -> f32 {
  let offshore = max(0.0, shore_metrics(p).x);
  let kelp = kelp_canopy(p + vec2f(1.5, 0.8), offshore, settings, noise, filtering);
  // A school circles slowly in the shallows; individual fish flicker within it.
  let t = settings.time * 0.05;
  let centre = vec2f(58.0, 70.0) + vec2f(cos(t), sin(t)) * (78.0 + 6.0 * sin(t * 3.1));
  let school = 1.0 - smoothstep(2.0, 6.0, length(p - centre));
  // Fish: small elongated shadows heading round the school's circuit.
  let heading = vec2f(-sin(t), cos(t));
  let side = vec2f(heading.y, -heading.x);
  let q = vec2f(dot(p, heading), dot(p, side)) * vec2f(1.6, 3.2) + vec2f(settings.time * 0.8, 0.0);
  let jitter = hash22(floor(q)) - 0.5;
  let body = length((fract(q) - 0.5 - jitter * 0.4) * vec2f(1.0, 2.4));
  let fish = (1.0 - smoothstep(0.12, 0.2, body)) * step(0.45, hash22(floor(q) + 3.0).x) * school;
  return (1.0 - kelp * 0.6) * (1.0 - fish * 0.5);
}

fn kelp_canopy(p: vec2f, offshore: f32, settings: OceanSettings, noise: texture_3d<f32>, filtering: sampler) -> f32 {
  let band = smoothstep(14.0, 20.0, offshore) * (1.0 - smoothstep(38.0, 55.0, offshore));
  if (band <= 0.0) { return 0.0; }
  let beds = smoothstep(0.52, 0.64, field(p * 0.045 + 31.0, noise, filtering));
  // Fronds stream with the swell's surge: elongated, slowly swaying strands.
  let sway = sin(settings.time * 0.35 + p.x * 0.05) * 0.6;
  let strands = field(vec2f(p.x * 0.9 + sway, p.y * 0.25) + 11.0, noise, filtering) * 0.65
    + field(p * 1.7 + sway, noise, filtering) * 0.35;
  return band * beds * smoothstep(0.52, 0.7, strands);
}

// Broken water along the shore and whitecaps offshore. Foam is lacy: the
// breaker line is textured, and its residue decays into streaks and cells.
fn surf_foam(p: vec2f, offshore: f32, waves: vec4f, footprint: mat2x2f, settings: OceanSettings,
  noise: texture_3d<f32>, filtering: sampler) -> f32 {
  let pixel = max(length(footprint[0]), length(footprint[1]));
  let lace = field(p * 1.4 + vec2f(settings.time * 0.04, 0.0), noise, filtering) * 0.55
    + field(p * 3.7 - vec2f(0.0, settings.time * 0.05), noise, filtering) * 0.3
    + field(p * 9.0, noise, filtering) * 0.15;
  let bubbles = mix(lace, 0.55, smoothstep(0.08, 0.6, pixel));
  // Breakers: bands travelling shoreward whose phase shares the swell clock.
  let metrics = shore_metrics(p);
  let depth = seabed_depth(offshore);
  let surge = settings.time * 0.13 + field(vec2f(metrics.w * 0.05, 0.0), noise, filtering) * 2.0;
  let breaker_phase = fract(offshore * 0.11 + surge);
  // Waves break in sets, and a crest breaks along only part of its length.
  let set_strength = smoothstep(0.35, 0.7, field(vec2f(metrics.w * 0.04 - settings.time * 0.02, offshore * 0.05), noise, filtering));
  let breaking = smoothstep(0.84, 0.93, breaker_phase) * (1.0 - smoothstep(0.95, 1.0, breaker_phase)) * set_strength;
  let residue = (1.0 - smoothstep(0.0, 0.8, breaker_phase)) * 0.5 * set_strength;
  let surf_zone = 1.0 - smoothstep(0.6, 2.4, depth);
  // Swash: a thin, broken lace line where each wave runs up the sand.
  let run_up = 0.35 + 0.3 * sin(settings.time * 0.4 + metrics.w * 0.08);
  let swash = (1.0 - smoothstep(0.0, run_up, abs(offshore - run_up * 0.5)));
  var foam = (breaking * 0.85 + residue * smoothstep(0.52, 0.8, bubbles)) * surf_zone;
  foam = max(foam, swash * smoothstep(0.5, 0.7, bubbles));
  foam *= smoothstep(0.42, 0.68, bubbles + breaking * 0.25);
  // Whitecaps: wind above ~5 m/s breaks the steepest crests offshore.
  let wind = length(settings.wind);
  let crest = smoothstep(0.05, 0.14, waves.x) * smoothstep(0.6, 0.75, lace);
  foam = max(foam, crest * smoothstep(5.0, 11.0, wind) * smoothstep(8.0, 20.0, offshore) * 0.8);
  return clamp(foam, 0.0, 1.0) * 0.92;
}

// Signed shore geometry for the island, matching terrain.js: (offshore
// distance, unit radial x, unit radial z, tangential arc coordinate).
// Offshore is positive out at sea and negative inland.
fn shore_metrics(p: vec2f) -> vec4f {
  let d = p - vec2f(58.0, 70.0);
  let r = max(length(d), 0.001);
  let theta = atan2(d.y, d.x);
  let radius = 62.0 + 14.0 * sin(2.0 * theta + 0.8)
    + 7.0 * sin(3.0 * theta + 2.1) + 3.5 * sin(7.0 * theta + 4.5);
  return vec4f(r - radius, d.x / r, d.y / r, theta * 62.0);
}

// Height, x/z slopes, and variance of subpixel waves. Work in shore-relative
// coordinates: shorter wavelengths in shallow water turn crests toward the
// beach all around the island. A weaker mirrored wave travels back offshore
// with the same frequency/phase and decays away from land.
fn wave_surface(p: vec2f, footprint: mat2x2f, settings: OceanSettings, geometry: bool) -> vec4f {
  let metrics = shore_metrics(p);
  let offshore = max(0.0, metrics.x);
  let radial = metrics.yz;
  let tangent = vec2f(-metrics.z, metrics.y);
  let along_coord = metrics.w;
  let shallows = exp(-offshore / 12.0);
  let refracted_distance = offshore + 9.0 * (1.0 - shallows);
  let distance_gradient = radial * (1.0 + 0.75 * shallows);
  let envelope = smoothstep(0.0, 2.5, offshore);
  let return_strength = 0.22 * exp(-offshore / 18.0);
  let speed = length(settings.wind);
  let wind_angle = atan2(settings.wind.y + 0.01, settings.wind.x + 0.01);
  var frequency = 0.4;
  var amplitude = 0.09 + min(speed * 0.003, 0.035);
  var result = vec4f(0.0);
  for (var i = 0; i < 7; i++) {
    if (geometry && i >= 3) { break; }
    let index = f32(i);
    let angle = sin(index * 2.39996 + settings.seed * 6.283185) * 0.65 + sin(wind_angle) * 0.18;
    let along = sin(angle);
    let across = cos(angle);
    let random = fract(sin(index * 91.345 + settings.seed * 451.123 + 0.71) * 47453.5453);
    let offset = random * 6.283185;
    // A deliberately calm presentation clock; weather still controls amplitude/direction.
    let travel = settings.time * 0.22 * sqrt(9.81 * frequency);
    let incoming_phase = (-refracted_distance * across + along_coord * along) * frequency - travel + offset;
    let returning_phase = (refracted_distance * across + along_coord * along) * frequency - travel + offset;
    let incoming_gradient = (-distance_gradient * across + tangent * along) * frequency;
    let returning_gradient = (distance_gradient * across + tangent * along) * frequency;
    let projected = max(abs(dot(incoming_gradient, footprint[0])), abs(dot(incoming_gradient, footprint[1])));
    let retained = exp(-0.65 * projected * projected);
    let reflected = return_strength / (1.0 + index * 0.3);
    // Slightly trochoidal: sharper crests and broader troughs, as real swell.
    let s = sin(incoming_phase);
    let height = s + 0.18 * (s * s - 0.5) + reflected * sin(returning_phase);
    let slope = incoming_gradient * cos(incoming_phase) * (1.0 + 0.36 * s) + reflected * returning_gradient * cos(returning_phase);
    result += vec4f(height, slope, 0.0) * amplitude * retained * envelope;
    result.w += pow(amplitude * frequency, 2.0) * (1.0 - retained * retained) * 0.5;
    frequency *= 1.19 + random * 0.08;
    amplitude *= 0.8;
  }
  // Open-ocean swell: plane waves spread around the wind direction. Near the
  // island the refracted shore-relative waves dominate; offshore these take
  // over, so the sea doesn't form concentric rings around the island.
  let open_sea = smoothstep(8.0, 70.0, offshore);
  if (open_sea > 0.001) {
    result *= 1.0 - open_sea * 0.65;
    var f = 0.33;
    var a = (0.1 + min(speed * 0.004, 0.05)) * open_sea;
    for (var j = 0; j < 6; j++) {
      if (geometry && j >= 3) { break; }
      let index = f32(j);
      let spread = sin(index * 3.883 + settings.seed * 17.0) * 0.8;
      let angle = wind_angle + spread;
      let k = vec2f(cos(angle), sin(angle)) * f;
      let phase = dot(k, p) - settings.time * 0.22 * sqrt(9.81 * f) + index * 1.7 + settings.seed * 40.0;
      let projected = max(abs(dot(k, footprint[0])), abs(dot(k, footprint[1])));
      let retained = exp(-0.65 * projected * projected);
      let s = sin(phase);
      result += vec4f(s + 0.18 * (s * s - 0.5), k * cos(phase) * (1.0 + 0.36 * s), 0.0) * a * retained;
      result.w += pow(a * f, 2.0) * (1.0 - retained * retained) * 0.5;
      f *= 1.27;
      a *= 0.74;
    }
  }
  return result;
}

// Fine structure is an advected noise gradient, not more periodic sine waves.
// Rotated scales avoid aligned texture cells. Subpixel energy becomes roughness;
// wind strengthens the capillary ripples that carry the glitter.
fn ripple_surface(p: vec2f, footprint: mat2x2f, settings: OceanSettings, noise: texture_3d<f32>, filtering: sampler) -> vec4f {
  let time = settings.time;
  var rotation = mat2x2f(vec2f(0.8, 0.6), vec2f(-0.6, 0.8));
  var frequency = 0.75;
  var amplitude = 0.08 + min(length(settings.wind), 12.0) * 0.004;
  var slope = vec2f(0.0);
  var variance = 0.0;
  let pixel_size = max(length(footprint[0]), length(footprint[1]));
  for (var i = 0; i < 5; i++) {
    let retained = exp(-0.7 * pow(frequency * pixel_size, 2.0));
    let q = rotation * p * frequency + vec2f(time * 0.018, time * 0.009) * (1.0 + f32(i) * 0.4);
    let z = 11.3 + f32(i) * 9.17 + time * (0.012 + f32(i) * 0.01);
    let dx = volume(vec3f(q + vec2f(0.2, 0.0), z), noise, filtering)
      - volume(vec3f(q - vec2f(0.2, 0.0), z), noise, filtering);
    let dz = volume(vec3f(q + vec2f(0.0, 0.2), z), noise, filtering)
      - volume(vec3f(q - vec2f(0.0, 0.2), z), noise, filtering);
    slope += transpose(rotation) * vec2f(dx, dz) * amplitude * retained / 0.4;
    variance += amplitude * amplitude * (1.0 - retained * retained) * 0.25;
    rotation = rotation * mat2x2f(vec2f(0.36, 0.932952), vec2f(-0.932952, 0.36));
    frequency *= 2.3;
    amplitude *= 0.7;
  }
  return vec4f(0.0, slope, variance);
}

fn volume(p: vec3f, noise: texture_3d<f32>, filtering: sampler) -> f32 {
  let cell = floor(p);
  let f = fract(p);
  let blend = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  return textureSampleLevel(noise, filtering, fract((cell + blend + 0.5) / 64.0), 0.0).r;
}

fn smith(cosine: f32, a2: f32) -> f32 {
  return 2.0 * cosine / max(cosine + sqrt(a2 + (1.0 - a2) * cosine * cosine), 0.0001);
}

fn field(p: vec2f, noise: texture_3d<f32>, filtering: sampler) -> f32 {
  let cell = floor(p);
  let f = fract(p);
  let blend = f * f * (3.0 - 2.0 * f);
  return textureSampleLevel(noise, filtering, vec3f((cell + blend + 0.5) / 64.0, 0.37), 0.0).r;
}

fn hash22(p: vec2f) -> vec2f {
  var q = fract(vec3f(p.x, p.y, p.x) * vec3f(0.1031, 0.1030, 0.0973));
  q += dot(q, q.yzx + 33.33);
  return fract((q.xx + q.yz) * q.zy);
}
