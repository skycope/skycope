import { Atmosphere, view_ray } from "./view.wgsl";
import { lut_uv, overcast_sky, volume_noise } from "./skyview.wgsl";

// Pass 2 of the sky: the cloud march, at a quarter of the sky's pixels. Each
// texel traces one pixel of its 2x2 block, rotating through all four over
// four frames (atmosphere.temporal.xy); the resolve pass rebuilds full
// resolution from these fresh samples plus the reprojected history. Output
// is the cloud layer alone: in-scattered light (rgb) and transmission (a).
@group(0) @binding(0) var<uniform> atmosphere: Atmosphere;
@group(0) @binding(1) var cloudNoise: texture_3d<f32>;
@group(0) @binding(2) var cloudSampler: sampler;
@group(0) @binding(3) var skyTable: texture_2d<f32>;

@fragment
fn fs_main(@builtin(position) position: vec4f) -> @location(0) vec4f {
  // atmosphere.resolution is the full sky resolution.
  let pixel = floor(position.xy) * 2.0 + atmosphere.temporal.xy + 0.5;
  let uv = pixel / atmosphere.resolution;
  let ray = view_ray(uv, atmosphere.resolution, atmosphere.pointer, atmosphere.flight.w, atmosphere.pitch);
  // The sea covers everything below the horizon; a clear forecast has no
  // cloud to march through at all.
  let cover = max(max(atmosphere.weather.x, atmosphere.weather.y), atmosphere.weather.z);
  if (ray.y < -0.02 || cover < 0.01) { return vec4f(0.0, 0.0, 0.0, 1.0); }
  let lean = (atmosphere.pointer - 0.5) * vec2f(0.014, 0.009);
  // Flight shifts the cloud volume gently: the miniature cloud space maps tens
  // of metres of travel to fractions of its 44-unit ray range.
  let eye = vec3f(
    lean.x * 1.6 + atmosphere.flight.x * 0.012,
    max(0.4, 1.6 + (atmosphere.flight.y - 4.5) * 0.02),
    lean.y - atmosphere.flight.z * 0.012,
  );
  let night = smoothstep(1.0, 2.0, atmosphere.scene);
  // The sky behind this ray, as the resolve pass finishes it: scattering,
  // airglow and the moon's aureole, which lights the haze around the moon
  // (not the faint veil and night-sky detail, which the haze cannot show).
  var behind = textureSampleLevel(skyTable, cloudSampler, lut_uv(ray), 0.0).rgb * atmosphere.light.w
    + vec3f(0.004, 0.007, 0.014) * night * (1.0 + (1.0 - clamp(ray.y, 0.0, 1.0)) * 1.5);
  if (night > 0.001) {
    behind += vec3f(0.05, 0.08, 0.14) * exp(-length(ray - atmosphere.moon) * 14.0) * night
      * smoothstep(-0.01, 0.02, atmosphere.moon.y) * (0.5 - 0.5 * cos(atmosphere.celestial.z * 6.283185));
  }
  let sky = overcast_sky(behind, atmosphere.weather.w, atmosphere.rain);
  return render_clouds(eye, ray, atmosphere.sun, atmosphere.moon, sky, night);
}

fn noise3(p: vec3f) -> f32 {
  return volume_noise(p, cloudNoise, cloudSampler);
}

// Henyey-Greenstein lobe, scaled so an isotropic scatterer averages 1.
fn hg(mu: f32, g: f32) -> f32 {
  let g2 = g * g;
  return (1.0 - g2) / pow(max(1.0 + g2 - 2.0 * g * mu, 0.0001), 1.5);
}

fn render_clouds(eye: vec3f, ray: vec3f, sun: vec3f, moon: vec3f, sky: vec3f, night: f32) -> vec4f {
  var radiance = vec3f(0.0);
  var transmission = 1.0;
  let light = normalize(mix(sun, moon, night));
  // Sunlight and skylight come from the same scattering model as the sky, so
  // clouds turn gold, rose and grey with the real sun, not a palette.
  let direct_light = atmosphere.light.rgb;
  let sky_up = atmosphere.ambient.rgb;
  let sky_side = sky;
  let mu = dot(ray, light);
  // Dual-lobe phase: a strong forward silver lining plus soft backscatter.
  let phase = mix(hg(mu, 0.62), hg(mu, -0.18), 0.35);
  let dim = 1.0 - atmosphere.weather.w * 0.45;
  let steps = u32(atmosphere.steps);

  // Quadratic spacing resolves nearby billows; far clouds cost fewer samples.
  // Empty space is cheap, opaque rays terminate early, and a ray stops as
  // soon as it leaves the slab holding the three decks.
  for (var i = 0u; i < 64u; i++) {
    if (i >= steps || transmission < 0.018) { break; }
    let fraction = (f32(i) + 0.5) / atmosphere.steps;
    let distance = 1.0 + fraction * fraction * 44.0;
    let step_size = (2.0 * fraction * 44.0) / atmosphere.steps;
    let position = eye + ray * distance;
    if (position.y > 8.0 && ray.y >= 0.0) { break; }
    if (position.y < -4.0) {
      if (ray.y <= 0.0) { break; }
      continue;
    }
    let density = cloud_density(position);
    if (density < 0.012) { continue; }

    let optical_depth = cloud_density(position + light * 0.45) * 0.5
      + cloud_density(position + light * 1.25) * 0.85
      + cloud_density(position + light * 2.8) * 1.1;
    // Beer's law with a long multiple-scattering tail, and the "powder" term
    // that darkens thin sunward edges: the look of real cumulus.
    let beer = exp(-optical_depth * 1.7) * 0.75 + exp(-optical_depth * 0.35) * 0.25;
    let powder = 1.0 - exp(-density * 3.0);
    let height_light = smoothstep(-3.5, 6.0, position.y);
    var lighting = direct_light * beer * mix(1.0, powder, 0.5) * phase * 0.075 * dim;
    lighting += sky_up * (0.55 + height_light * 0.7) + sky_side * 0.25;
    // Deep, low decks are dark underneath: little light survives the column.
    lighting *= (1.0 - atmosphere.weather.x * atmosphere.weather.w * 0.5 * (1.0 - height_light))
      * (1.0 - smoothstep(0.3, 8.0, atmosphere.rain) * 0.4);
    let haze = 1.0 - exp(-distance * 0.021);
    lighting = mix(lighting, sky, haze * 0.75);
    let alpha = 1.0 - exp(-density * step_size * 1.9);
    radiance += lighting * alpha * transmission;
    transmission *= 1.0 - alpha;
  }
  return vec4f(radiance, transmission);
}

fn cloud_density(position: vec3f) -> f32 {
  let drift = -vec3f(atmosphere.wind.x, 0.0, atmosphere.wind.y) * atmosphere.time * 0.012;
  let p = position + drift;
  // Three cloud decks respond to the provider’s low, middle and high coverage.
  let lower = smoothstep(-3.8, -1.6, p.y) * (1.0 - smoothstep(-0.5, 2.0, p.y));
  let upper = smoothstep(4.0, 5.1, p.y) * (1.0 - smoothstep(5.6, 7.5, p.y));
  let middle = smoothstep(1.8, 3.0, p.y) * (1.0 - smoothstep(3.5, 4.6, p.y));
  let profile = max(max(lower, upper * 0.92), middle);
  let coverage = max(max(lower * atmosphere.weather.x, upper * atmosphere.weather.z), middle * atmosphere.weather.y);
  if (profile < 0.01 || coverage < 0.01) { return 0.0; }
  let q = p * vec3f(0.29, 0.40, 0.29) + vec3f(3.1, 8.4, 1.7);
  let body = noise3(q) * 0.57 + noise3(q * 2.03 + 13.7) * 0.28 + noise3(q * 4.11 + 7.3) * 0.15;
  let erosion = noise3(q * 8.2) * 0.07;
  let threshold = mix(0.66, 0.18, pow(coverage, 0.65));
  return max((body * profile - threshold - erosion) * 3.8, 0.0);
}
