import { band_variance, cascade_size, SEA_TILE } from "./spectrum.wgsl";
import { lut_uv, overcast_sky } from "./skyview.wgsl";
import { rock_slots, rock_sea, rock_traces, rock_hides, RockSea, RockHit, RockHits } from "./rocks.wgsl";
import { cat_near, cat_sea } from "./wake.wgsl";

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
  // Sky exposure and rain (mm/h), for the sky-view table in reflections.
  exposure: f32,
  rain: f32,
  // Whether to trace the island's reflection (off on the phone budget).
  mirror_land: f32,
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
  foam_layer: texture_2d<f32>, shore_rocks: texture_2d<f32>, shore_grid: texture_2d<u32>,
  sky_table: texture_2d<f32>, land_field: texture_2d<f32>, cat_wake: texture_2d<f32>,
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
  let calm = (eye + direction * distance).xz;
  let calm_metrics = shore_metrics(calm);
  if (calm_metrics.x < -1.5) { return sky; }
  // Sea behind a boulder is hidden by the rock mesh too.
  var slots = vec4u(0u);
  if (calm_metrics.x < 14.0) {
    slots = rock_slots(calm, shore_grid);
    if (slots.x != 0u && rock_hides(eye, direction, distance, slots, shore_rocks)) { return sky; }
  }
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
  var sea = wave_surface(p.xz, metrics, footprint, settings, false, waves0, waves1, waves2, waves3, filtering);
  // Near the eye, the capillary ripples themselves (a few centimetres, too
  // fine for the cascades), riding the wind; elsewhere they stay roughness.
  let near_pixel = max(length(footprint[0]), length(footprint[1]));
  if (near_pixel < 0.03) {
    sea = capillaries(p.xz, near_pixel, sea, settings, waves3, filtering);
  }
  // Boulders at the waterline: lapping rings, a calm lee, a foam collar.
  // The displaced hit is usually in the calm hit's grid cell: reuse its list.
  var rock: RockSea;
  rock.edge = 99.0;
  if (metrics.x > -1.6 && metrics.x < 14.0) {
    if (any(floor(p.xz * 0.5) != floor(calm * 0.5))) { slots = rock_slots(p.xz, shore_grid); }
    if (slots.x != 0u) {
      let pixel = max(length(footprint[0]), length(footprint[1]));
      rock = rock_sea(p.xz, pixel, settings.time, length(settings.wind), settings.swell, slots, shore_rocks);
      let calm = 1.0 - rock.shelter * 0.7;
      sea.slope = sea.slope * calm + rock.slope;
      sea.height += rock.height;
      sea.variance = sea.variance * calm + rock.variance;
    }
  }
  // The cat swimming or wading: its collar, trail, ripples and splashes.
  if (cat_near(p.xz, cat_wake)) {
    let cat = cat_sea(p.xz, near_pixel, settings.time, cat_wake);
    sea.height += cat.height;
    sea.slope += cat.slope;
    sea.variance += cat.variance;
    if (cat.foam > rock.foam) {
      rock.foam = cat.foam;
      rock.lace = cat.lace;
    }
    rock.bubbles = max(rock.bubbles, cat.bubbles);
    rock.occlusion = max(rock.occlusion, cat.occlusion);
  }
  return ocean(p, metrics, direction, light, sky, sea, footprint, distance, settings, noise, filtering, sky_texture,
    waves1, waves2, waves3, foam_layer, rock, slots, shore_rocks, sky_table, land_field);
}

fn ocean(
  p: vec3f, metrics: vec4f, ray: vec3f, light: vec3f, sky: vec3f, sea: Sea,
  footprint: mat2x2f, distance: f32, settings: OceanSettings,
  noise: texture_3d<f32>, filtering: sampler, sky_texture: texture_2d<f32>,
  waves1: texture_2d<f32>, waves2: texture_2d<f32>, waves3: texture_2d<f32>, foam_layer: texture_2d<f32>,
  rock: RockSea, slots: vec4u, shore_rocks: texture_2d<f32>, sky_table: texture_2d<f32>,
  land_field: texture_2d<f32>,
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
  let foam = surf_foam(p.xz, metrics, sea, pixel, settings, noise, filtering, foam_layer, rock);
  // Rocks shade the water: the sun behind a boulder leaves no glitter and no
  // light in the water, and the sky is partly hidden right at its foot.
  let near_rocks = slots.x != 0u;
  var traced: RockHits;
  if (near_rocks) {
    traced = rock_traces(p, light, reflected, refract(ray, normal, 0.7519), sqrt(sea.variance), slots, shore_rocks);
  }
  let sun_seen = 1.0 - traced.shadow;
  let sky_seen = 1.0 - rock.occlusion * 0.5;
  let cover = foam.x;

  // ---- Reflection: the sky pass, sampled along the reflected ray. ----------
  // It holds the clouds as seen; where the reflected ray leaves the screen,
  // the sky-view table (the same scattering integral the sky is drawn from)
  // gives the true sky in that direction, greyed by cloud cover.
  let forward_c = coast_forward(settings.azimuth, settings.pitch);
  let right_c = normalize(vec3f(forward_c.z, 0.0, -forward_c.x));
  let up_c = cross(forward_c, right_c);
  let aspect = settings.resolution.y / settings.resolution.x;
  let reflected_depth = dot(reflected, forward_c);
  let reflected_uv = vec2f(0.5 + dot(reflected, right_c) * 0.9 / max(reflected_depth, 0.01) * aspect,
    0.5 - dot(reflected, up_c) * 0.9 / max(reflected_depth, 0.01));
  let on_screen = reflected_depth > 0.0 && all(reflected_uv > vec2f(0.0)) && all(reflected_uv < vec2f(1.0));
  let edge = min(min(reflected_uv.x, reflected_uv.y), min(1.0 - reflected_uv.x, 1.0 - reflected_uv.y));
  let seen = select(0.0, smoothstep(0.0, 0.08, edge), on_screen && cover < 0.98);
  var reflection = vec3f(0.0);
  if (seen < 1.0) {
    // Coast axes back to east / up / north.
    let world = normalize(vec3f(0.707107 * (reflected.x - reflected.z), max(reflected.y, 0.01), 0.707107 * (reflected.x + reflected.z)));
    let table = textureSampleLevel(sky_table, filtering, lut_uv(world), 0.0).rgb * settings.exposure
      + vec3f(0.004, 0.007, 0.014) * night;
    let clear = overcast_sky(table, settings.overcast, settings.rain);
    let grey = dot(clear, vec3f(0.2126, 0.7152, 0.0722));
    reflection = mix(clear, vec3f(grey) * vec3f(0.95, 0.98, 1.02), settings.overcast * 0.5);
  }
  if (seen > 0.0) {
    // Blur grows with sub-pixel roughness: a calm sea mirrors clouds sharply,
    // a choppy one smears them into vertical streaks.
    let spread = 0.004 + sqrt(sea.variance) * 0.05;
    let blur = vec2f(spread * aspect, spread * 2.2);
    let lo = vec2f(0.001);
    let hi = vec2f(0.999);
    // Three bilinear taps on a triangle cover the kernel about as well as four.
    let blurred = (textureSampleLevel(sky_texture, filtering, clamp(reflected_uv + blur * vec2f(0.0, -0.75), lo, hi), 0.0).rgb
      + textureSampleLevel(sky_texture, filtering, clamp(reflected_uv + blur * vec2f(0.65, 0.375), lo, hi), 0.0).rgb
      + textureSampleLevel(sky_texture, filtering, clamp(reflected_uv + blur * vec2f(-0.65, 0.375), lo, hi), 0.0).rgb) * 0.33333;
    reflection = mix(reflection, blurred, seen);
  }
  // The island in the water: dunes, the beach and the tree line mirrored
  // near the shore, traced through its height field. Rough water blurs the
  // edge by the slope spread of the reflected lobe.
  // Skipped where it cannot show: seen steeply the sea reflects under 4% and
  // the column's own colour hides it; far offshore the island is a sliver
  // on the horizon the sky reflection already carries.
  if (settings.mirror_land > 0.5 && reflected.y > 0.0 && reflected.y < 0.6 && fresnel > 0.035 && cover < 0.98 && metrics.x < 70.0) {
    let land = land_reflection(p, reflected, sqrt(sea.variance), light, direct * sun_up, settings.skylight, land_field, filtering);
    if (land.a > 0.0) {
      reflection = mix(reflection, land.rgb, land.a * smoothstep(0.035, 0.06, fresnel));
    }
  }
  // The rocks themselves in the water, traced: the sky pass knows nothing of
  // the land, so without this calm water round a boulder mirrors only sky.
  if (near_rocks) {
    if (traced.mirrored.cover > 0.0) {
      reflection = mix(reflection, rock_radiance(traced.mirrored, light, direct * sun_up, settings.skylight), traced.mirrored.cover);
    }
  }

  // ---- Transmission: refract into the water column and onto the seabed. ----
  let refracted = refract(ray, normal, 0.7519);
  let down = max(-refracted.y, 0.05);
  let path = min(depth / down, 60.0);
  let column = exp(-(ABSORPTION + SCATTERING) * path);
  var bed_colour = vec3f(0.0);
  var column_path = path;
  // Boulders under the surface, seen through it before the bed.
  var sunk = traced.sunk;
  if (near_rocks) {
    if (sunk.cover > 0.0 && sunk.t < path) {
      let hit_depth = max(-sunk.y, 0.0);
      let sun_down = refract(-light, vec3f(0.0, 1.0, 0.0), 0.7519);
      let lit = direct * sun_up * sun_seen * max(dot(sunk.normal, light), 0.0) * 0.3183 * exp(-ABSORPTION * hit_depth / max(-sun_down.y, 0.2))
        + settings.skylight * sky_seen * (0.55 + 0.45 * sunk.normal.y) * exp(-ABSORPTION * hit_depth * 1.2);
      // Submerged granite: dark, slimed with algae.
      let albedo = mix(sunk.albedo * 0.5, vec3f(0.035, 0.05, 0.02), smoothstep(0.05, 0.6, hit_depth));
      bed_colour = albedo * lit;
      column_path = mix(path, sunk.t, sunk.cover);
    } else {
      sunk.cover = 0.0;
    }
  }
  // Deep water hides the bottom: when less than ~0.1% of the seabed's light
  // could survive the round trip (blue, the most penetrating), its texture,
  // caustics and shadows cannot show, so they are not evaluated. Thick foam
  // hides it too.
  if (column.b * exp(-ABSORPTION.b * depth * 1.2) > 0.0012 && cover < 0.97 && sunk.cover < 0.99) {
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
        * (1.0 - foam.y * 0.5) * sun_seen;
    }
    let bed_light = (sun_bed + settings.skylight * sky_seen * exp(-ABSORPTION * bed_depth * 1.2)) * seabed_shadows(bed, bed_metrics, settings, noise, filtering);
    bed_colour = mix(seabed(bed, bed_metrics, offshore, settings, noise, filtering) * bed_light, bed_colour, sunk.cover);
  }
  let column_t = exp(-(ABSORPTION + SCATTERING) * column_path);
  // Single scattering in the water column: sunlight scattered back toward the
  // eye, tinted by the absorption it survived. This is the colour of deep water.
  let sigma_t = ABSORPTION + SCATTERING;
  let ambient_light = direct * sun_up * sun_seen * (0.4 + 0.6 * max(light.y, 0.0)) * 0.3183 + settings.skylight * sky_seen;
  let inscatter_light = ambient_light * (SCATTERING / sigma_t) * 0.5;
  var transmitted = bed_colour * column_t + inscatter_light * (1.0 - column_t);
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
  // Steep, thin crest faces pass the most light; shallow water tints it
  // toward the sand's gold-green.
  let steep = smoothstep(0.08, 0.35, length(sea.slope));
  let crest_tint = mix(vec3f(0.06, 0.42, 0.34), vec3f(0.18, 0.46, 0.22), 1.0 - smoothstep(0.5, 3.0, depth));
  transmitted += crest_tint * direct * sun_seen * backlit * (0.03 + 0.09 * steep);

  var color = mix(transmitted, reflection, fresnel * (1.0 - kelp * 0.6));

  // ---- Sun glitter. ---------------------------------------------------------
  // Unresolved waves become microfacet roughness: the broad path's width and
  // length come from real slope variance, so it stretches from the horizon to
  // the viewer at low sun and tightens at noon.
  let sun_disc = direct * sun_up * (1.0 - night * 0.2) * sun_seen;
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
    let foam_light = direct * sun_up * sun_seen * max(light.y, 0.08) * 0.3183 * facing + settings.skylight * 1.1 * sky_seen;
    let thin = cover * (1.0 - cover) * 4.0;
    let foam_colour = vec3f(0.9, 0.93, 0.95) * foam_light;
    color = mix(color, foam_colour, cover);
    color += ambient_light * vec3f(0.05, 0.2, 0.18) * thin * 0.12;
  }

  // ---- Bioluminescence. ------------------------------------------------------
  // Cape waters bloom with dinoflagellates (Noctiluca, Lingulodinium) that
  // flash blue when the water is churned. At night the breaking roller, the
  // uprush, the surge round each rock and breaking whitecaps glow cyan-blue
  // from within the foam and just under it, with single cells sparking in
  // freshly stirred water. Blooms drift in patches along the coast.
  if (night > 0.01 && foam.z > 0.01) {
    let bloom = smoothstep(0.25, 0.7, value_noise(p.xz * 0.018 + vec2f(settings.time * 0.003, 3.7)));
    let glow = foam.z * bloom * night;
    let body = glow * (0.1 + 0.9 * cover) + glow * foam.y * 0.3;
    var sparks = 0.0;
    if (pixel < 0.06) {
      let q = p.xz * 22.0;
      let cell = floor(q);
      let h = hash22(cell + floor(settings.time * 6.0 + hash22(cell).x * 6.0));
      let spot = 1.0 - smoothstep(0.08, 0.3, length(fract(q) - 0.2 - h * 0.6));
      sparks = step(0.95, h.y) * spot * (0.3 + 0.7 * fract(h.x * 37.1)) * glow * (1.0 - smoothstep(0.02, 0.06, pixel));
    }
    color += vec3f(0.05, 0.42, 0.95) * (body * 0.16 + sparks * 1.2);
  }

  // Aerial perspective: air, not a wall of fog. The horizon stays crisp.
  return mix(color, sky, 1.0 - exp(-distance * 0.00022));
}

// The island as reflected rays meet it (src/land-field.js): a 256² field of
// the land's top (terrain or foliage) over a 200 m square: (height, tint
// from sand to leaf, albedo luminance, distance to the nearest land).
const LAND_ORIGIN: vec2f = vec2f(-42.0, -30.0);
const LAND_SPAN: f32 = 200.0;
const LAND_TEXELS: f32 = 256.0;
// Mip level 3: 32² cells holding each cell's tallest point.
const LAND_COARSE: f32 = 32.0;
// Nothing on the island stands higher than this (hilltop crowns reach ~22 m).
const LAND_TOP: f32 = 23.0;
// Unit-luminance chromaticities of sand and leaves; keep equal to land-field.js.
const SAND_TINT: vec3f = vec3f(1.24, 0.97, 0.6);
const LEAF_TINT: vec3f = vec3f(0.56, 1.21, 0.31);

fn land_sample(q: vec2f, land: texture_2d<f32>, filtering: sampler) -> vec4f {
  // Clamped: the field's border is open sea, so nothing wraps back in.
  let uv = clamp((q - LAND_ORIGIN) / LAND_SPAN, vec2f(0.5 / LAND_TEXELS), vec2f(1.0 - 0.5 / LAND_TEXELS));
  return textureSampleLevel(land, filtering, uv, 0.0);
}

// March a reflected ray over the island's height field: steps grow with
// distance, the crossing is refined by bisection, and the land is lit by the
// sun and sky with the field's own normal. Near misses give a soft edge as
// wide as the rough lobe (sigma, radians) at that distance, so a choppy sea
// smears the tree line instead of aliasing it. Returns (radiance, cover).
fn land_reflection(p: vec3f, dir: vec3f, sigma: f32, light: vec3f, sun: vec3f, skylight: vec3f,
  land: texture_2d<f32>, filtering: sampler) -> vec4f {
  // Only rays that pass over the island within its height can meet it.
  let centre = vec2f(58.0, 70.0);
  let flat_len = max(length(dir.xz), 1e-4);
  let flat = dir.xz / flat_len;
  let to_centre = centre - p.xz;
  let along = dot(to_centre, flat);
  let miss = length(to_centre - flat * along);
  if (miss > 90.0) { return vec4f(0.0); }
  let half_chord = sqrt(max(90.0 * 90.0 - miss * miss, 0.0));
  // Distances along the 3D ray (t) where it enters and leaves the island's
  // circle, and where it climbs above everything on it.
  let t_enter = max((along - half_chord) / flat_len, 0.05);
  let t_exit = min(min((along + half_chord) / flat_len, (LAND_TOP - p.y) / max(dir.y, 1e-4)), 220.0);
  if (t_enter >= t_exit) { return vec4f(0.0); }
  var t = t_enter;
  var previous = t;
  var near = 1e9;
  var hit = false;
  var last_gap = 0.0;
  for (var i = 0; i < 16; i++) {
    if (t > t_exit) { break; }
    let q = p + dir * t;
    // The coarse level first: above the tallest thing in this 6.25 m cell,
    // cross the whole cell, or leap as far as the nearest land if that is
    // further (open water).
    let cuv = (q.xz - LAND_ORIGIN) / LAND_SPAN;
    if (any(cuv < vec2f(0.0)) || any(cuv >= vec2f(1.0))) { break; }
    let cell = floor(cuv * LAND_COARSE);
    let coarse = textureLoad(land, vec2i(cell), 3).r;
    if (q.y > coarse + 0.3) {
      let lo = LAND_ORIGIN + cell * (LAND_SPAN / LAND_COARSE);
      let bound = select(lo, lo + LAND_SPAN / LAND_COARSE, dir.xz > vec2f(0.0));
      let exits = select((bound - q.xz) / dir.xz, vec2f(1e9), abs(dir.xz) < vec2f(1e-5));
      // This texel's distance to land (less half its diagonal): a ray
      // heading away from the island leaps further each step and is out.
      let clear = textureLoad(land, vec2i(cuv * LAND_TEXELS), 0).a - 0.6;
      previous = t;
      t += max(max(min(exits.x, exits.y), 0.0) + 0.05, clear / flat_len);
      continue;
    }
    let s = land_sample(q.xz, land, filtering);
    let gap = q.y - s.r;
    if (gap < 0.0) {
      // Secant between the last two steps: no extra reads.
      t = mix(previous, t, clamp(last_gap / max(last_gap - gap, 1e-4), 0.0, 1.0));
      hit = true;
      break;
    }
    last_gap = gap;
    // How close the ray passes, in units of the lobe's footprint.
    near = min(near, gap / (0.12 + t * sigma * 0.8));
    previous = t;
    t += clamp(max(gap * 0.8, t * 0.08), 0.4, 6.0);
  }
  var cover = 0.0;
  if (hit) {
    cover = 1.0;
  } else {
    cover = 1.0 - smoothstep(0.0, 1.0, near);
    if (cover <= 0.0) { return vec4f(0.0); }
    t = previous;
  }
  let q = p + dir * t;
  let here = land_sample(q.xz, land, filtering);
  if (here.r < -0.5) { return vec4f(0.0); }
  let e = 0.9;
  let hx = land_sample(q.xz + vec2f(e, 0.0), land, filtering).r - here.r;
  let hz = land_sample(q.xz + vec2f(0.0, e), land, filtering).r - here.r;
  let normal = normalize(vec3f(-hx, e, -hz));
  let albedo = mix(SAND_TINT, LEAF_TINT, here.g) * here.b;
  // Foliage is a rough volume: its sun term wraps a little round the crown
  // and its interior shades itself; the ground takes plain Lambert.
  let leafy = smoothstep(0.4, 0.8, here.g);
  let wrap = mix(max(dot(normal, light), 0.0), clamp((dot(normal, light) + 0.3) / 1.3, 0.0, 1.0) * 0.75, leafy);
  var radiance = albedo * (sun * wrap * 0.3183 + skylight * (0.55 + 0.45 * normal.y));
  // The same clear coastal air the mesh layer's haze uses.
  let air = 1.0 - exp(-t * 0.0028);
  radiance = mix(radiance, skylight * 1.1, air * 0.5);
  return vec4f(radiance, cover);
}

// A boulder lit by the sun and sky: the Lambertian corestone, dark and wet
// where the sea reaches it.
fn rock_radiance(hit: RockHit, light: vec3f, sun: vec3f, skylight: vec3f) -> vec3f {
  let wet = 1.0 - smoothstep(0.1, 0.7, hit.y);
  let albedo = hit.albedo * mix(0.85, 0.4, wet);
  return albedo * (sun * max(dot(hit.normal, light), 0.0) * 0.3183 + skylight * (0.5 + 0.5 * hit.normal.y));
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
fn seabed(p: vec2f, metrics: vec4f, offshore: f32, settings: OceanSettings, noise: texture_3d<f32>, filtering: sampler) -> vec3f {
  let along = metrics.w;
  let ripple_warp = field(p * 0.35, noise, filtering) * 3.0;
  let ripples = 0.5 + 0.5 * sin(metrics.x * 5.5 + ripple_warp + along * 0.15);
  var sand = mix(vec3f(0.3, 0.26, 0.18), vec3f(0.42, 0.37, 0.27), field(p * 0.9, noise, filtering));
  sand *= 0.82 + ripples * 0.22;
  // Granite boulders and reef: a patch field, dark and lichen-flecked, in
  // broad blocky outcrops and gullies like the Cape's granite coasts.
  // Neither reaches the first metres of the shallows: skip their lookups there.
  var colour = sand;
  var reef = 0.0;
  if (offshore > 3.0) {
    reef = smoothstep(0.6, 0.68, field(p * 0.09 + 7.0, noise, filtering) * 0.62 + field(p * 0.37, noise, filtering) * 0.28
        + field(p * 1.6, noise, filtering) * 0.1)
      * smoothstep(3.0, 10.0, offshore);
    // Seagrass meadows in the calmer mid-shelf.
    if (offshore > 5.0 && offshore < 45.0) {
      let grass = smoothstep(0.55, 0.66, field(p * 0.16 - 3.0, noise, filtering))
        * smoothstep(5.0, 12.0, offshore) * (1.0 - smoothstep(30.0, 45.0, offshore));
      if (grass > 0.0) {
        let blades = 0.6 + 0.4 * field(p * vec2f(6.0, 1.3) + settings.time * vec2f(0.15, 0.0), noise, filtering);
        colour = mix(sand, vec3f(0.05, 0.1, 0.03) * blades, grass);
      }
    }
    if (reef > 0.0) {
      let rock = mix(vec3f(0.07, 0.075, 0.055), vec3f(0.2, 0.19, 0.12), field(p * 2.1, noise, filtering));
      colour = mix(colour, rock, reef);
    }
  }
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
fn seabed_shadows(p: vec2f, metrics: vec4f, settings: OceanSettings, noise: texture_3d<f32>, filtering: sampler) -> f32 {
  let offshore = max(0.0, metrics.x);
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
// Returns (surface coverage, bubble cloud under the surface, agitation).
fn surf_foam(p: vec2f, metrics: vec4f, sea: Sea, pixel: f32, settings: OceanSettings,
  noise: texture_3d<f32>, filtering: sampler, foam_layer: texture_2d<f32>, rock: RockSea) -> vec3f {
  let offshore = max(0.0, metrics.x);
  var density = 0.0;
  var bubbles = 0.0;
  // Agitation: water being churned right now (the roller, the uprush, the
  // surge round a rock, a whitecap breaking), where plankton light up.
  var agitation = 0.0;
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
    agitation = broken * max(roller, exp(-age / (period * 0.12)) * 0.6);
  }
  let wind = length(settings.wind);
  if (wind > 3.5) {
    let whitecap = textureSampleLevel(foam_layer, filtering, p / SEA_TILE, 0.0).rg * smoothstep(6.0, 20.0, offshore);
    density = max(density, whitecap.x * 0.85);
    bubbles = max(bubbles, whitecap.y * 0.8);
    agitation = max(agitation, whitecap.y * 0.5);
  }
  var coords = vec2f(metrics.w * 0.7, -metrics.x);
  if (metrics.x < 2.5) {
    let s = swash(metrics.w, -metrics.x, settings.time, settings.swell);
    density = max(density, s.y);
    bubbles = max(bubbles, s.y * 0.6);
    agitation = max(agitation, s.y * s.x * 0.8);
  }
  // Foam round the rocks, laced in coordinates wrapped round each one.
  let collar = rock.foam > density;
  density = max(density, rock.foam);
  bubbles = max(bubbles, rock.bubbles);
  agitation = max(agitation, rock.bubbles * 0.8);
  if (density < 0.01) { return vec3f(0.0, bubbles, agitation); }
  // Foam rides the orbital motion: it sloshes shoreward under each crest and
  // back under each trough. Offshore, lace follows the sea itself.
  coords.y -= sea.excursion * sin(sea.phase);
  if (offshore > 20.0) { coords = p; }
  if (collar) { coords = rock.lace; }
  let coverage = foam_cover(coords, density, settings.time, pixel, noise, filtering);
  return vec3f(coverage * 0.95, bubbles, agitation);
}

// Foam as it really decays: dense froth first, then holes open, each round
// its own seed and at its own rate, until they meet and leave a lace of
// irregular walls, thick where the holes are small, thread-thin where they
// have merged. Two scales of hole, warped by the flow so none are alike,
// and the local density varies in clumps and streaks. Where the holes are
// finer than the pixel, their mean coverage stands in. Keep in step with
// swashFoam in surf.js.
fn foam_cover(q_in: vec2f, density: f32, time: f32, pixel_in: f32, noise: texture_3d<f32>, filtering: sampler) -> f32 {
  // Metres to foam units: holes of ~50 cm and ~15 cm.
  let q = q_in * 1.6;
  let pixel = pixel_in * 1.6;
  let warp = vec2f(field(q * 0.25 + 3.1, noise, filtering), field(q * 0.25 + 17.7, noise, filtering)) - 0.5;
  let w = q + warp * 2.4;
  let clump = field(w * 0.5 + vec2f(time * 0.02, 0.0), noise, filtering) * 0.6 + field(w * 1.7 + 5.0, noise, filtering) * 0.4;
  // Frayed: finer noise tears the edges of every clump.
  let fray = mix(field(w * 6.1 + 2.2, noise, filtering), 0.5, smoothstep(0.3, 0.8, pixel * 6.1));
  let local = clamp(density * (0.2 + 1.9 * clump * clump) * (0.65 + 0.7 * fray), 0.0, 1.0);
  if (local < 0.02) { return 0.0; }
  let bend = vec2f(field(w * 2.3 + 1.3, noise, filtering), field(w * 2.3 + 8.9, noise, filtering)) - 0.5;
  let big = foam_holes(w * 1.3 + bend * 1.1, local, pixel * 1.3, fray);
  if (big < 0.005) { return 0.0; }
  let small = foam_holes(w * 4.1 + bend * 2.2 + 7.3, min(1.0, local * 1.15), pixel * 4.1, 1.0 - fray);
  // Thin foam is a film of bubbles, not solid white: speckled, see-through.
  let film = mix(0.45 + 0.55 * fray, 1.0, smoothstep(0.35, 0.85, local));
  return big * small * film * smoothstep(0.02, 0.2, local);
}

// Coverage of foam around holes of one scale (cells one unit across): each
// hole grows from its cell's seed as the foam thins (local 1 → 0).
fn foam_holes(q: vec2f, local: f32, cells_per_pixel: f32, warp: f32) -> f32 {
  let thin = 1.0 - local;
  let mean = 1.0 - min(0.92, 3.1 * thin * thin * 0.5);
  if (cells_per_pixel > 0.8) { return mean; }
  // Seeds stay within the middle 60% of their cells, so the nearest is
  // always among the four cells round the point's nearest corner.
  let base = floor(q - 0.5);
  var nearest = 8.0;
  var seed = 0.0;
  for (var j = 0; j <= 1; j++) {
    for (var i = 0; i <= 1; i++) {
      let cell = base + vec2f(f32(i), f32(j));
      let h = hash22(cell);
      let point = cell + 0.2 + h * 0.6 - q;
      let d = dot(point, point);
      if (d < nearest) { nearest = d; seed = h.y; }
    }
  }
  let radius = thin * (0.25 + 0.8 * pow(fract(seed * 7.13), 1.5));
  let soft = 0.05 + cells_per_pixel * 0.6;
  // Holes are torn, not round: the distance is bent by the fray noise.
  let open = smoothstep(radius - soft, radius + soft, sqrt(nearest) + (warp - 0.5) * 0.35 * thin);
  return mix(open, mean, smoothstep(0.3, 0.8, cells_per_pixel));
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

// Capillary ripples: the finest wind-sea cascade again, shrunk 7× and 17×
// and turned (1–5 cm ripples), drifting downwind, faded by the pixel
// footprint. One texture read an octave, since each texel already holds
// its slopes. What they resolve is taken out of the roughness, so the sheen
// neither doubles nor dims.
fn capillaries(p: vec2f, pixel: f32, sea_in: Sea, settings: OceanSettings, waves3: texture_2d<f32>, filtering: sampler) -> Sea {
  var sea = sea_in;
  let speed = length(settings.wind);
  let downwind = select(vec2f(0.8, 0.6), settings.wind / max(speed, 0.001), speed > 0.3);
  let strength = 0.35 + min(speed, 10.0) * 0.06;
  let size = cascade_size(3);
  var slope = vec2f(0.0);
  var resolved = 0.0;
  var scale = 7.3;
  var turn = mat2x2f(vec2f(0.6, 0.8), vec2f(-0.8, 0.6));
  for (var i = 0; i < select(1, 2, pixel < 0.012); i++) {
    // The cascade's shortest waves are size / 16; shrunk, size / (16 scale).
    let k = TAU * 16.0 * scale / size;
    let keep = exp(-0.65 * (k * pixel) * (k * pixel));
    if (keep > 0.02) {
      let q = turn * (p + downwind * settings.time * 0.06) * scale / size + f32(i) * 0.37;
      let w = textureSampleLevel(waves3, filtering, q, 0.0);
      // Shrunk by `scale` in both height and length: the same steepness.
      slope += transpose(turn) * w.yz * strength * keep;
      resolved += keep * keep;
    }
    scale *= 2.35;
    turn = turn * mat2x2f(vec2f(0.28, 0.96), vec2f(-0.96, 0.28));
  }
  sea.slope += slope;
  sea.variance = max(sea.variance * (1.0 - 0.2 * resolved), sea.variance * 0.6);
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
