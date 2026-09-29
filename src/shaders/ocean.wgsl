import { band_variance, cascade_size, SEA_TILE } from "./spectrum.wgsl";

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
  // The breaking swell train from src/swell.js: shore-arc wavenumber,
  // angular frequency, phase, deep-water amplitude.
  swell: vec4f,
};

// Coastal Atlantic water: pure-water absorption (red goes first) plus a little
// phytoplankton and dissolved organics, which push the shallows toward
// green-turquoise and the deep water toward ink blue.
const ABSORPTION: vec3f = vec3f(0.46, 0.085, 0.055);
const SCATTERING: f32 = 0.018;
const TAU: f32 = 6.283185;

// The surface at one point: the sum of the refracted shore swell, open-sea
// groundswell and the four wind-sea cascades, plus what foam needs to know
// about the breaking train.
struct Sea {
  height: f32,
  slope: vec2f,
  // Slope variance the pixel cannot resolve: microfacet roughness.
  variance: f32,
  // The breaking train alone: its height, its crest phase (0 at the crest,
  // positive ahead of it, in [-π, π]), how depth-limited it is (0 offshore,
  // 1 in the surf zone) and its shallow-water orbital excursion in metres.
  swell: f32,
  phase: f32,
  breaking: f32,
  excursion: f32,
};

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
  waves0: texture_2d<f32>, waves1: texture_2d<f32>, waves2: texture_2d<f32>, waves3: texture_2d<f32>,
  foam_layer: texture_2d<f32>,
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
  // Sea the island stands on is hidden by its terrain mesh on the land
  // layer (terrain is above sea level everywhere inland), so a ray whose
  // calm-sea hit lies clearly inland is never seen: skip its shading. The
  // margin keeps the soft waterline band, where the ground fades out, shaded.
  if (shore_metrics((eye + direction * distance).xz).x < -1.5) { return sky; }
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
  // Grazing rays (most of the distant sea) take no displacement at all.
  for (var i = 0; i < select(0, 3, displacement > 0.0); i++) {
    let p = eye + direction * distance;
    let wave = wave_surface(p.xz, shore_metrics(p.xz), footprint, settings, true, waves0, waves1, waves2, waves3, filtering);
    let derivative = min(direction.y - dot(wave.slope * displacement, direction.xz), -0.035);
    let correction = clamp((p.y - wave.height * displacement) / derivative, -distance * 0.12, distance * 0.12);
    distance -= correction;
  }
  let p = eye + direction * distance;
  let metrics = shore_metrics(p.xz);
  let sea = wave_surface(p.xz, metrics, footprint, settings, false, waves0, waves1, waves2, waves3, filtering);
  return ocean(p, metrics, direction, light, sky, sea, footprint, distance, settings, noise, filtering, sky_texture,
    waves1, waves2, waves3, foam_layer);
}

fn ocean(
  p: vec3f, metrics: vec4f, ray: vec3f, light: vec3f, sky: vec3f, sea: Sea,
  footprint: mat2x2f, distance: f32, settings: OceanSettings,
  noise: texture_3d<f32>, filtering: sampler, sky_texture: texture_2d<f32>,
  waves1: texture_2d<f32>, waves2: texture_2d<f32>, waves3: texture_2d<f32>, foam_layer: texture_2d<f32>,
) -> vec3f {
  // Keep most wave slope even at grazing angles: distant water must stay
  // textured so the sun path breaks into streaks instead of a smooth band.
  let grazing = smoothstep(0.002, 0.04, -ray.y) * (0.55 + 0.45 * smoothstep(0.01, 0.09, -ray.y));
  let normal = normalize(vec3f(-sea.slope.x * grazing, 1.0, -sea.slope.y * grazing));
  let view = -ray;
  let nv = max(dot(normal, view), 0.01);
  let reflected = reflect(ray, normal);
  let fresnel = 0.02 + 0.98 * pow(1.0 - nv, 5.0);
  let night = smoothstep(1.0, 2.0, settings.scene);
  let sun_up = smoothstep(-0.02, 0.04, light.y);
  let direct = settings.sunlight * (1.0 - settings.overcast * 0.8);
  let offshore = max(0.0, metrics.x);
  let depth = seabed_depth(offshore, metrics.w);
  let pixel = max(length(footprint[0]), length(footprint[1]));

  // ---- Foam first: it shades the seabed and hides the water under it. ----
  let foam = surf_foam(p.xz, metrics, sea, pixel, settings, noise, filtering, foam_layer);
  let cover = foam.x;

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
  if (reflected_depth > 0.0 && all(reflected_uv > vec2f(0.0)) && all(reflected_uv < vec2f(1.0)) && cover < 0.98) {
    // Blur grows with sub-pixel roughness: a calm sea mirrors clouds sharply,
    // a choppy one smears them into vertical streaks.
    let spread = 0.004 + sqrt(sea.variance) * 0.05;
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
  let column = exp(-(ABSORPTION + SCATTERING) * path);
  var bed_colour = vec3f(0.0);
  // Deep water hides the bottom: when less than ~0.1% of the seabed's light
  // could survive the round trip (blue, the most penetrating), its texture,
  // caustics and shadows cannot show, so they are not evaluated. Thick foam
  // hides it too.
  if (column.b * exp(-ABSORPTION.b * depth * 1.2) > 0.0012 && cover < 0.97) {
    let bed = p.xz + refracted.xz * path;
    let bed_metrics = shore_metrics(bed);
    let bed_depth = seabed_depth(max(0.0, bed_metrics.x), bed_metrics.w);
    let sun_down = refract(-light, vec3f(0.0, 1.0, 0.0), 0.7519);
    let light_down = max(-sun_down.y, 0.2);
    // Light reaching the seabed: the sun through the column, focused into
    // caustics by the real surface, plus diffuse sky. Foam overhead shades it.
    // Lambertian: irradiance / π. Sky irradiance is roughly π × zenith radiance.
    var sun_bed = vec3f(0.0);
    if (sun_up > 0.0) {
      sun_bed = direct * sun_up * max(light.y, 0.0) * 0.3183 * exp(-ABSORPTION * bed_depth / light_down)
        * caustics(bed, bed_depth, sun_down, sea, pixel, waves1, waves2, waves3, filtering)
        * (1.0 - foam.y * 0.5);
    }
    let bed_light = (sun_bed + settings.skylight * exp(-ABSORPTION * bed_depth * 1.2)) * seabed_shadows(bed, settings, noise, filtering);
    bed_colour = seabed(bed, offshore, settings, noise, filtering) * bed_light;
  }
  // Single scattering in the water column: sunlight scattered back toward the
  // eye, tinted by the absorption it survived. This is the colour of deep water.
  let sigma_t = ABSORPTION + SCATTERING;
  let ambient_light = direct * sun_up * (0.4 + 0.6 * max(light.y, 0.0)) * 0.3183 + settings.skylight;
  let inscatter_light = ambient_light * (SCATTERING / sigma_t) * 0.5;
  var transmitted = bed_colour * column + inscatter_light * (1.0 - column);
  // Bubbles and sand stirred up by breaking waves: a milky, bright turquoise
  // cloud under the surface, lingering after the foam on top has gone.
  // Bubbles scatter white; the water around them tints it by absorption.
  let turbid = (1.0 - smoothstep(0.4, 2.2, depth)) * 0.25;
  let milk = max(foam.y, turbid * sea.breaking);
  transmitted = mix(transmitted, ambient_light * exp(-ABSORPTION * (1.5 + depth * 0.5)) * mix(vec3f(0.7), vec3f(0.78, 0.72, 0.56), turbid * 2.0), milk * 0.6);

  // Kelp: Ecklonia beds float their fronds at the surface a little offshore.
  let kelp = kelp_canopy(p.xz, offshore, settings, noise, filtering);
  let kelp_colour = vec3f(0.06, 0.045, 0.014) * (direct * sun_up * max(normal.y * light.y, 0.0) * 0.3183 + settings.skylight);
  transmitted = mix(transmitted, kelp_colour, kelp * 0.85);

  // Backlit crests: light passing through thin wave tops glows green-blue,
  // strongest on the steep face of a wave about to break.
  let backlit = pow(max(dot(-view.xz, light.xz) / max(length(light.xz), 0.001), 0.0), 2.0)
    * smoothstep(-0.02, 0.1, sea.height) * sun_up * (1.0 - smoothstep(0.1, 0.6, light.y))
    * (1.0 + sea.breaking * smoothstep(-0.2, 0.0, sea.phase) * (1.0 - smoothstep(0.1, 0.9, sea.phase)) * 3.0);
  transmitted += vec3f(0.06, 0.42, 0.34) * direct * backlit * 0.035;

  var color = mix(transmitted, reflection, fresnel * (1.0 - kelp * 0.6));

  // ---- Sun glitter. ---------------------------------------------------------
  // Unresolved waves become microfacet roughness: the broad path's width and
  // length come from real slope variance, so it stretches from the horizon to
  // the viewer at low sun and tightens at noon.
  let sun_disc = direct * sun_up * (1.0 - night * 0.2);
  if (max(sun_disc.r, max(sun_disc.g, sun_disc.b)) > 0.00001) {
    let alpha = sqrt(0.002 + sea.variance * 2.0);
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
    // Squared patchiness: bright sparkle fields separated by genuinely dark troughs.
    let patchy = glitter_patch * glitter_patch;
    var glitter = specular * (0.12 + patchy * 2.2) + tail * 0.1 * patchy;
    // Glints: individual sub-pixel facets that catch the sun's disc outright.
    // Each world-space cell (scaled to the pixel footprint) draws a random facet
    // from the unresolved slope distribution; those mirror-aligned with the sun
    // flash far past white and twinkle as the facets re-roll. HDR plus the
    // filmic shoulder turns them into the hot, deep sparkle of a real sea.
    if (pixel < 1.2) {
      glitter += glints(p.xz, ray, light, normal, sea.variance, footprint, settings.time) * fresnel_glint(nv) / 0.9;
    }
    color += sun_disc * glitter * 0.9 * (1.0 - cover);
  }

  // ---- Foam and whitewater. -------------------------------------------------
  // Foam is a thick scatterer: lit by the sun on faces turned to it and by the
  // whole sky. Where it is thin the water glows through it, turquoise.
  if (cover > 0.001) {
    let facing = 0.55 + 0.45 * max(dot(normal, light), 0.0);
    let foam_light = direct * sun_up * max(light.y, 0.08) * 0.3183 * facing + settings.skylight * 1.1;
    let thin = cover * (1.0 - cover) * 4.0;
    let foam_colour = vec3f(0.9, 0.93, 0.95) * foam_light;
    color = mix(color, foam_colour, cover);
    color += ambient_light * vec3f(0.05, 0.2, 0.18) * thin * 0.12;
  }

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
    let slope = vec2f(cos(r.y * TAU), sin(r.y * TAU)) * radius;
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

// Seabed depth below the surface at an offshore distance and shore arc
// position: a gentle, dissipative sandy beach (about 1:16) with a longshore
// bar some 11 m out, cut by rip channels every ~40 m, then a steeper drop into
// blue water. The bar trips the swell into breaking well offshore; through
// the channels it breaks later and the foam has gaps.
fn seabed_depth(offshore: f32, along: f32) -> f32 {
  let rips = smoothstep(-0.3, 0.5, sin(along * 0.145161 + 0.7 * sin(along * 0.032258)));
  let x = (offshore - 11.0) / 2.6;
  let bar = 0.3 * exp(-x * x) * (0.3 + 0.7 * rips);
  return offshore * 0.06 + max(0.0, offshore - 13.0) * 0.16 + max(0.0, offshore - 30.0) * 0.3
    + max(0.0, offshore - 50.0) * 0.3 - bar;
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
  // Granite boulders and reef: a patch field, dark and lichen-flecked, in
  // broad blocky outcrops and gullies like the Cape's granite coasts.
  let reef = smoothstep(0.6, 0.68, field(p * 0.09 + 7.0, noise, filtering) * 0.62 + field(p * 0.37, noise, filtering) * 0.28
      + field(p * 1.6, noise, filtering) * 0.1)
    * smoothstep(3.0, 10.0, offshore);
  let rock = mix(vec3f(0.07, 0.075, 0.055), vec3f(0.2, 0.19, 0.12), field(p * 2.1, noise, filtering));
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
  colour *= 1.0 - round * select(0.0, 0.25, spot.x > 0.93) * (1.0 - reef);
  return colour;
}

// Caustics from the actual surface: each seabed point receives the sunlight
// that entered the surface up-sun of it, focused or spread by the surface's
// curvature there. For a thin lens the irradiance is 1 / (1 - d (1 - 1/n) ∇²h);
// the wave cascades give ∇²h ≈ -k Σ k·a·cos θ per band, so the webs come
// from the same waves that shade the surface, move with them, sharpen with
// depth where the ripples focus and blur beyond it. The three channels use
// the refractive index for red, green and blue, so focused lines fringe.
fn caustics(bed: vec2f, depth: f32, sun_down: vec3f, sea: Sea, pixel: f32,
  waves1: texture_2d<f32>, waves2: texture_2d<f32>, waves3: texture_2d<f32>, filtering: sampler) -> vec3f {
  let entry = bed - sun_down.xz / max(-sun_down.y, 0.2) * depth;
  // The 2.5 m tile would repeat visibly on a flat bed: a second rotated,
  // rescaled sample of it breaks the lattice without changing its statistics.
  let turned = mat2x2f(vec2f(0.799, 0.602), vec2f(-0.602, 0.799)) * entry * 1.31 + vec2f(1.7, 3.1);
  let fine = exp(-pow(pixel * 18.0, 2.0));
  let curvature = (textureSampleLevel(waves3, filtering, entry / cascade_size(3), 0.0).w
      + textureSampleLevel(waves3, filtering, turned / cascade_size(3), 0.0).w) * 0.707 * 20.1 * fine
    + textureSampleLevel(waves2, filtering, entry / cascade_size(2), 0.0).w * 5.03
    + textureSampleLevel(waves1, filtering, entry / cascade_size(1), 0.0).w * 1.26
    - sea.swell * 0.16;
  let focus = depth * 0.248 * 1.35 * curvature;
  let x = 1.0 - focus * vec3f(0.986, 1.0, 1.016);
  // The sun's disc and the pixel's footprint blur the focus.
  let blur = 0.09 + depth * 0.025 + pixel * 2.0;
  let irradiance = min(1.0 / sqrt(x * x + blur * blur), vec3f(7.0));
  // Keep the mean near one: spreading dims the cells as focusing lights the lines.
  return irradiance / (1.0 + 0.35 * smoothstep(0.2, 1.2, depth * 0.33 * abs(curvature)));
}

// Kelp canopy shadows and passing fish schools darken the seabed.
fn seabed_shadows(p: vec2f, settings: OceanSettings, noise: texture_3d<f32>, filtering: sampler) -> f32 {
  let offshore = max(0.0, shore_metrics(p).x);
  let kelp = kelp_canopy(p + vec2f(1.5, 0.8), offshore, settings, noise, filtering);
  // A school circles slowly in the shallows; individual fish flicker within it.
  let t = settings.time * 0.05;
  let centre = vec2f(58.0, 70.0) + vec2f(cos(t), sin(t)) * (78.0 + 6.0 * sin(t * 3.1));
  let school = 1.0 - smoothstep(2.0, 6.0, length(p - centre));
  if (school <= 0.0) { return 1.0 - kelp * 0.6; }
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
  if (beds <= 0.0) { return 0.0; }
  // Fronds stream with the swell's surge: elongated, slowly swaying strands.
  let sway = sin(settings.time * 0.35 + p.x * 0.05) * 0.6;
  let strands = field(vec2f(p.x * 0.9 + sway, p.y * 0.25) + 11.0, noise, filtering) * 0.65
    + field(p * 1.7 + sway, noise, filtering) * 0.35;
  return band * beds * smoothstep(0.52, 0.7, strands);
}

// Whitewater, as density (how much foam a place holds) turned into coverage
// through a lace of bubble walls: thin foam keeps only the walls, dense foam
// fills the cells, and as it decays the holes open. Three sources:
//  - the surf zone, from the breaking train itself: the roller spilling down
//    the front of each broken crest, and the residue of every earlier wave
//    decaying with the time since its crest passed;
//  - whitecaps offshore, from the foam simulation over the wind sea;
//  - the swash on the beach (shared with the ground shader).
// Returns (surface coverage, bubble cloud under the surface).
fn surf_foam(p: vec2f, metrics: vec4f, sea: Sea, pixel: f32, settings: OceanSettings,
  noise: texture_3d<f32>, filtering: sampler, foam_layer: texture_2d<f32>) -> vec2f {
  let offshore = max(0.0, metrics.x);
  var density = 0.0;
  var bubbles = 0.0;
  if (sea.breaking > 0.01) {
    let theta = sea.phase;
    // Whitewater starts at the crest's lip where the wave first breaks and
    // spreads down its face as the bore develops shoreward.
    let developed = sea.breaking * sea.breaking;
    let roller = smoothstep(-0.35, 0.02, theta) * (1.0 - smoothstep(0.05, 0.2 + 0.9 * developed, theta));
    let omega = settings.swell.y;
    let period = TAU / omega;
    let age = select(TAU - theta, -theta, theta <= 0.0) / omega;
    let tau = period * 0.55;
    // Every earlier wave's foam too: a geometric series of decays.
    let residue = exp(-age / tau) / (1.0 - exp(-period / tau));
    // Foam is born where the train starts to break and carried shoreward.
    let broken = smoothstep(0.1, 0.6, sea.breaking);
    // The residue lies in streaks and patches drawn out along the beach.
    let patches = 1.5 * smoothstep(0.22, 0.78, field(vec2f(metrics.w * 0.035, metrics.x * 0.14) + vec2f(settings.time * 0.004, 0.0), noise, filtering));
    density = broken * max(roller * (0.7 + 0.6 * patches), min(residue * patches * 1.2, 0.95));
    // Entrained bubbles: a turquoise cloud in each breaker's wake.
    bubbles = broken * max(roller * 0.9, exp(-age / (period * 0.3)) * 0.8);
  }
  let wind = length(settings.wind);
  if (wind > 3.5) {
    let whitecap = textureSampleLevel(foam_layer, filtering, p / SEA_TILE, 0.0).rg * smoothstep(6.0, 20.0, offshore);
    density = max(density, whitecap.x * 0.85);
    bubbles = max(bubbles, whitecap.y * 0.8);
  }
  var coords = vec2f(metrics.w * 0.7, -metrics.x);
  if (metrics.x < 2.5) {
    let s = swash(metrics.w, -metrics.x, settings.time, settings.swell);
    density = max(density, s.y);
    bubbles = max(bubbles, s.y * 0.6);
  }
  if (density < 0.01) { return vec2f(0.0, bubbles); }
  // Foam rides the orbital motion: it sloshes shoreward under each crest and
  // back under each trough. Offshore, lace follows the sea itself.
  coords.y -= sea.excursion * sin(sea.phase);
  if (offshore > 20.0) { coords = p; }
  let lace = foam_lace(coords, settings.time, pixel, noise, filtering);
  let coverage = smoothstep(1.0 - density - 0.08, 1.0 - density + 0.14, lace) * min(1.0, density * 2.5);
  return vec2f(coverage * 0.95, bubbles);
}

// The texture of foam in [0, 1]: warped clumps, crossed by bubble-wall
// filaments at two scales (Voronoi cell walls, where bubbles crowd) that
// break up where foam is thin. Thin foam keeps only filament pieces in its
// clumps; thick foam fills everything but the holes. Features finer than the
// pixel fade to their mean coverage. Keep in step with swashLace in surf.js.
fn foam_lace(q: vec2f, time: f32, pixel: f32, noise: texture_3d<f32>, filtering: sampler) -> f32 {
  // The flow tears and stretches foam: warp it so no two cells are alike.
  let warp = vec2f(field(q * 0.27 + 3.1, noise, filtering), field(q * 0.27 + 17.7, noise, filtering)) - 0.5;
  let w = q + warp * 2.2;
  // Stretched to use the whole range: summed value noise clusters near 0.5.
  let clumps = smoothstep(0.28, 0.72, field(w * 0.6 + vec2f(time * 0.02, 0.0), noise, filtering) * 0.6
    + field(w * 1.7 + 5.0, noise, filtering) * 0.4);
  let mask = field(w * 1.1 + 9.0, noise, filtering);
  // Bubble walls are never straight: bend the cells at their own scale.
  let bend = vec2f(field(w * 2.6 + 1.3, noise, filtering), field(w * 2.6 + 8.9, noise, filtering)) - 0.5;
  let v = w + bend * 0.45;
  let walls_big = mix(1.0 - smoothstep(0.0, 0.08 + 0.22 * clumps, voronoi_edge(v * 2.2)), 0.3, smoothstep(0.25, 0.8, pixel * 2.2));
  let walls_small = mix(1.0 - smoothstep(0.0, 0.2, voronoi_edge(v * 6.3 + 7.3)), 0.3, smoothstep(0.25, 0.8, pixel * 6.3));
  let filaments = max(walls_big * smoothstep(0.3, 0.6, mask), walls_small * smoothstep(0.45, 0.75, clumps));
  return clamp(clumps * 0.6 + filaments * 0.4 - 0.04, 0.0, 1.0);
}

// Distance to the nearest cell wall (F2 - F1) of a Voronoi diagram. The
// cells don't animate (that was 36 sines a pixel): the foam's own motion and
// its changing density re-form the lace instead.
fn voronoi_edge(q: vec2f) -> f32 {
  let cell = floor(q);
  let local = fract(q);
  var f1 = 8.0;
  var f2 = 8.0;
  for (var j = -1; j <= 1; j++) {
    for (var i = -1; i <= 1; i++) {
      let offset = vec2f(f32(i), f32(j));
      let point = offset + hash22(cell + offset) * 0.8 + 0.1 - local;
      let d = dot(point, point);
      if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) { f2 = d; }
    }
  }
  return sqrt(f2) - sqrt(f1);
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

// Swell sets: the breaking train's height swells and fades along the beach
// and in time. The arc coordinate wraps every 2π·62 m, so along-shore
// wavenumbers are whole multiples of 1/62. Keep in step with surf.js.
fn set_envelope(along: f32, time: f32) -> f32 {
  return 0.8 + 0.17 * sin(along * 0.032258 - time * 0.061 + 1.3) + 0.1 * sin(along * 0.016129 + time * 0.023);
}

// A shoaling crest: phase warped so the front face steepens (asymmetry,
// beta) and the crest sharpens into a trochoid (q). Returns the warped phase
// and d(warped)/d(phase). Keep in step with swashCycle in surf.js.
fn breaker_warp(psi: f32, beta: f32, q: f32) -> vec2f {
  let psi1 = psi - beta * cos(psi);
  var theta = psi1 + q * sin(psi1);
  theta = psi1 + q * sin(theta);
  return vec2f(theta, (1.0 + beta * sin(psi)) / (1.0 - q * cos(theta)));
}

// The swash on the beach, from the arrival of each bore: the film runs up
// the sand fast and drains back slowly, reach scalloped by beach cusps and
// set by the swell. inland is metres from the waterline (negative at sea).
// Returns (film, foam density, wetness of the sand, film depth).
// Keep in step with SWASH_GLSL in surf.js.
fn swash(along: f32, inland: f32, time: f32, swell: vec4f) -> vec4f {
  let psi = along * swell.x - swell.y * time + swell.z;
  let theta = breaker_warp(psi, 0.65, 0.75).x;
  let s = fract(-theta / TAU);
  let cusps = 1.0 + 0.2 * cos(along * 0.693548 + 0.9 * sin(along * 0.048387));
  let reach = (1.2 + swell.w * 6.0) * set_envelope(along, time) * cusps;
  let u = s / 0.82;
  let rise = pow(min(u, 1.0), 0.65);
  let front = select(-0.6, -0.6 + (reach + 0.6) * sin(3.141593 * rise), u < 1.0);
  let film = 1.0 - smoothstep(front - 0.1, front + 0.02, inland);
  let edge = smoothstep(front - 0.5, front - 0.02, inland) * film;
  let backwash = smoothstep(0.4, 0.6, rise);
  var foam = film * mix(max(edge * 0.95, 0.6 - 0.25 * rise), 0.5 * (1.0 - min(u, 1.0)) + edge * 0.25, backwash);
  // The swash mark: a line of bubbles stranded at the top of the run-up.
  let mark = exp(-pow((inland - reach) / 0.09, 2.0)) * backwash * max(1.0 - u, 0.0) * 0.7;
  foam = max(foam, mark);
  // Sand drains after the film leaves it: time since the backwash passed.
  let y = clamp((inland + 0.6) / (reach + 0.6), 0.0, 1.0);
  let exposed = pow(1.0 - asin(y) / 3.141593, 1.0 / 0.65);
  let period = TAU / swell.y;
  let age = select(99.0, (u - exposed) * 0.82 * period, inland < reach && u > exposed);
  let wet = max(film, exp(-age / 5.0));
  return vec4f(film, foam, wet, max(front - inland, 0.0));
}

// Height, x/z slopes and unresolved variance of the sea, and the breaking
// train's state. Shore swell works in shore-relative coordinates: shorter
// wavelengths in shallow water turn crests toward the beach all around the
// island; it shoals (Green's law, H ∝ h^-1/4) until it is depth-limited
// (H ≈ 0.78 h), then pitches forward and runs in as a bore. A weaker
// mirrored wave travels back offshore. Offshore, groundswell plane waves and
// the wind-sea cascades take over, so the sea never forms rings round the
// island. Everything is filtered by the pixel footprint before sampling.
fn wave_surface(p: vec2f, metrics: vec4f, footprint: mat2x2f, settings: OceanSettings, geometry: bool,
  waves0: texture_2d<f32>, waves1: texture_2d<f32>, waves2: texture_2d<f32>, waves3: texture_2d<f32>, filtering: sampler) -> Sea {
  let offshore = max(0.0, metrics.x);
  let radial = metrics.yz;
  let tangent = vec2f(-metrics.z, metrics.y);
  let along_coord = metrics.w;
  let depth = seabed_depth(offshore, along_coord);
  let shallows = exp(-offshore / 12.0);
  let refracted_distance = offshore + 9.0 * (1.0 - shallows);
  let distance_gradient = radial * (1.0 + 0.75 * shallows);
  let return_strength = 0.2 * exp(-offshore / 18.0);
  let speed = length(settings.wind);
  let wind_angle = atan2(settings.wind.y + 0.01, settings.wind.x + 0.01);
  let shoal = clamp(pow(3.7 / max(depth, 0.08), 0.25), 1.0, 2.6);
  let cap = 0.39 * depth + 0.012;
  let open_sea = smoothstep(8.0, 70.0, offshore);
  let shore_weight = 1.0 - open_sea * 0.65;
  // The weak wave reflected off the beach matters only near it, and not for
  // the intersection.
  let reflecting = !geometry && return_strength > 0.01;
  var sea: Sea;
  // The breaking train: shoals, pitches forward and breaks.
  {
    let k = 0.4;
    let along = settings.swell.x / k;
    let across = sqrt(max(1.0 - along * along, 0.0));
    let grown = settings.swell.w * set_envelope(along_coord, settings.time) * shoal;
    let a = min(grown, cap);
    let breaking = smoothstep(0.75, 1.0, grown / cap);
    let psi = (-refracted_distance * across + along_coord * along) * k - settings.swell.y * settings.time + settings.swell.z;
    let warp = breaker_warp(psi, 0.08 + 0.57 * breaking, 0.25 + 0.5 * breaking);
    let gradient = (-distance_gradient * across + tangent * along) * k;
    let projected = max(abs(dot(gradient, footprint[0])), abs(dot(gradient, footprint[1]))) * (1.0 + breaking);
    let retained = exp(-0.65 * projected * projected) * shore_weight;
    let c = cos(warp.x);
    var height = a * c;
    var slope = -a * sin(warp.x) * warp.y * gradient;
    if (reflecting) {
      let returning = (refracted_distance * across + along_coord * along) * k - settings.swell.y * settings.time + settings.swell.z;
      let reflected = return_strength * (1.0 - breaking) * a;
      height += reflected * sin(returning);
      slope += reflected * cos(returning) * (distance_gradient * across + tangent * along) * k;
    }
    sea.height = height * retained;
    sea.slope = slope * retained;
    sea.variance = pow(a * k * (1.0 + breaking), 2.0) * (shore_weight - retained * retained / shore_weight) * 0.5;
    sea.swell = a * c;
    sea.phase = warp.x - TAU * round(warp.x / TAU);
    sea.breaking = breaking * smoothstep(0.0, 0.05, grown);
    // Shallow-water particle excursion a / (k h), capped.
    sea.excursion = min(a / (k * max(depth, 0.25)), 1.1);
  }
  // Shorter shore-relative swell, slightly trochoidal.
  var ks = 0.4;
  var amplitude = 0.06 + min(speed * 0.003, 0.03);
  let wind_turn = sin(wind_angle) * 0.18;
  for (var i = 1; i < 4; i++) {
    if (geometry && i >= 3) { break; }
    let index = f32(i);
    let random = fract(sin(index * 91.345 + settings.seed * 451.123 + 0.71) * 47453.5453);
    ks *= 1.24;
    amplitude *= 0.72;
    let kk = ks * (1.0 + random * 0.05);
    // Whole multiples of 1/62 along the arc, so crests meet across its seam.
    let along = round((sin(index * 2.39996 + settings.seed * TAU) * 0.6 + wind_turn) * kk * 62.0) / (62.0 * kk);
    let across = sqrt(max(1.0 - along * along, 0.0));
    let a = min(amplitude * shoal, cap);
    let travel = 0.22 * sqrt(9.81 * kk) * settings.time - random * TAU;
    let phase = (-refracted_distance * across + along_coord * along) * kk - travel;
    let gradient = (-distance_gradient * across + tangent * along) * kk;
    let projected = max(abs(dot(gradient, footprint[0])), abs(dot(gradient, footprint[1])));
    let retained = exp(-0.65 * projected * projected) * shore_weight;
    let s = sin(phase);
    let c = cos(phase);
    var height = c + 0.18 * (c * c - 0.5);
    var slope = -s * (1.0 + 0.36 * c) * gradient;
    if (reflecting) {
      let returning = (refracted_distance * across + along_coord * along) * kk - travel;
      let reflected = return_strength / (1.0 + index * 0.3);
      height += reflected * sin(returning);
      slope += reflected * cos(returning) * (distance_gradient * across + tangent * along) * kk;
    }
    sea.height += height * a * retained;
    sea.slope += slope * a * retained;
    sea.variance += pow(a * kk, 2.0) * (shore_weight - retained * retained / shore_weight) * 0.5;
  }
  // Open-ocean groundswell: plane waves spread around the wind direction,
  // each modulated by its own slow group envelope: real swell arrives in
  // groups, and the varying amplitudes stop the trains locking into a lattice.
  if (open_sea > 0.001) {
    var f = 0.3;
    var amp = (0.08 + min(speed * 0.003, 0.03)) * open_sea;
    for (var j = 0; j < 3; j++) {
      let index = f32(j);
      let jitter = fract(sin(index * 12.9898 + settings.seed * 78.233) * 43758.5453);
      let spread = (fract(index * 0.618034 + settings.seed * 3.7) - 0.5) * 2.2;
      let angle = wind_angle + spread * (0.35 + 0.35 * jitter);
      let kv = vec2f(cos(angle), sin(angle)) * f;
      let phase = dot(kv, p) - settings.time * 0.22 * sqrt(9.81 * f) + jitter * TAU;
      let projected = max(abs(dot(kv, footprint[0])), abs(dot(kv, footprint[1])));
      let retained = exp(-0.65 * projected * projected);
      let group_p = p * (0.011 + jitter * 0.008) + vec2f(index * 7.31, index * 3.17) - kv * settings.time * 0.05;
      let group = 0.35 + 1.1 * smoothstep(0.2, 0.8, value_noise(group_p));
      let s = sin(phase);
      sea.height += (s + 0.18 * (s * s - 0.5)) * amp * group * retained;
      sea.slope += kv * cos(phase) * (1.0 + 0.36 * s) * amp * group * retained;
      sea.variance += pow(amp * group * f, 2.0) * (1.0 - retained * retained) * 0.5;
      f *= 1.3 + jitter * 0.16;
      amp *= 0.72;
    }
  }
  // The wind sea. Long bands feel the bottom and die in the shallows; short
  // ripples ride over everything. Each band fades by its footprint, and what
  // it loses becomes roughness, as does the capillary rest of the spectrum.
  let pixel = max(length(footprint[0]), length(footprint[1]));
  let felt = smoothstep(0.3, 3.5, depth);
  let band = band_variance(speed);
  var wind_slope = vec2f(0.0);
  var compression = 0.0;
  var weight = vec4f(felt, mix(0.35, 1.0, felt), 1.0, 1.0);
  for (var c = 0; c < 4; c++) {
    if (geometry && c > 0) { break; }
    let size = cascade_size(c);
    let k = TAU * 10.0 / size;
    let retained = exp(-0.65 * (k * pixel) * (k * pixel));
    sea.variance += band * (1.0 - retained * retained);
    if (retained > 0.01) {
      var w = vec4f(0.0);
      switch c {
        case 0: { w = textureSampleLevel(waves0, filtering, p / size, 0.0); }
        case 1: { w = textureSampleLevel(waves1, filtering, p / size, 0.0); }
        case 2: { w = textureSampleLevel(waves2, filtering, p / size, 0.0); }
        default: { w = textureSampleLevel(waves3, filtering, p / size, 0.0); }
      }
      let g = retained * weight[c];
      sea.height += w.x * g;
      wind_slope += w.yz * g;
      compression += w.w * g * select(1.0, 0.0, c == 3);
    }
  }
  // Choppy crests: horizontal (Gerstner) displacement crowds the surface
  // under each crest, steepening it by the Jacobian; troughs flatten.
  sea.slope += wind_slope / clamp(1.0 - compression * 0.9, 0.45, 1.6);
  sea.variance += (0.003 + 0.00512 * max(speed, 2.0)) * 0.332;
  return sea;
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

// Hash-based value noise: aperiodic, for large-scale modulation where the
// tiling noise texture would repeat.
fn value_noise(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = hash22(i).x;
  let b = hash22(i + vec2f(1.0, 0.0)).x;
  let c = hash22(i + vec2f(0.0, 1.0)).x;
  let d = hash22(i + vec2f(1.0, 1.0)).x;
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

fn hash22(p: vec2f) -> vec2f {
  var q = fract(vec3f(p.x, p.y, p.x) * vec3f(0.1031, 0.1030, 0.0973));
  q += dot(q, q.yzx + 33.33);
  return fract((q.xx + q.yz) * q.zy);
}
