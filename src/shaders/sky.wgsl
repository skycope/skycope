import { Atmosphere, view_ray } from "./view.wgsl";
import { sky_radiance, to_linear } from "./atmosphere.wgsl";

@group(0) @binding(0) var<uniform> atmosphere: Atmosphere;
@group(0) @binding(1) var cloudNoise: texture_3d<f32>;
@group(0) @binding(2) var cloudSampler: sampler;
@group(0) @binding(3) var starAtlas: texture_2d<f32>;

@fragment
fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let lean = (atmosphere.pointer - 0.5) * vec2f(0.014, 0.009);
  // Flight shifts the cloud volume gently: the miniature cloud space maps tens
  // of metres of travel to fractions of its 44-unit ray range.
  let eye = vec3f(
    lean.x * 1.6 + atmosphere.flight.x * 0.012,
    max(0.4, 1.6 + (atmosphere.flight.y - 4.5) * 0.02),
    lean.y - atmosphere.flight.z * 0.012,
  );
  let ray = view_ray(uv, atmosphere.resolution, atmosphere.pointer, atmosphere.flight.w, atmosphere.pitch);
  let night = smoothstep(1.0, 2.0, atmosphere.scene);
  let sun = atmosphere.sun;
  let moon = atmosphere.moon;
  // Output is exposed linear HDR; the water pass owns the single tonemap.
  let exposure = atmosphere.light.w;
  let sky = atmosphere_color(ray, sun, moon, night, exposure);
  // The sea covers everything below the horizon: no clouds there, just the
  // horizon colour that distant water fades into.
  if (ray.y < -0.02) { return vec4f(sky, 1.0); }
  return render_clouds(eye, ray, sun, moon, sky, night, exposure);
}

// Moonlight is sunlight scaled by distance and phase (~1/400000 of the sun at
// full moon); it is lifted far above that here, with src/sunlight.js, so a moonlit sky reads as deep blue, not black.
fn moonlight(moon: vec3f) -> f32 {
  let lit = 0.5 - 0.5 * cos(atmosphere.celestial.z * 6.283185);
  return 0.003 * lit * smoothstep(-0.02, 0.05, moon.y);
}

fn atmosphere_color(ray: vec3f, sun: vec3f, moon: vec3f, night: f32, exposure: f32) -> vec3f {
  var radiance = sky_radiance(ray, sun, 12);
  if (night > 0.001) {
    radiance += sky_radiance(ray, moon, 6) * moonlight(moon) * 0.6;
  }
  var color = radiance * exposure;
  // Airglow and scattered starlight: the darkest sky is never pure black.
  color += vec3f(0.004, 0.007, 0.014) * night * (1.0 + (1.0 - clamp(ray.y, 0.0, 1.0)) * 1.5);

  // Thin ice-cloud veil at a distant altitude: different perspective and drift.
  let high_position = ray.xz * (18.0 / max(ray.y + 0.23, 0.07));
  let wisps = noise3(vec3f(high_position * vec2f(0.065, 0.22), 7.0) + vec3f(atmosphere.time * 0.004, 0.0, 0.0))
    * 0.7 + noise3(vec3f(high_position * vec2f(0.21, 0.5), 3.0)) * 0.3;
  let veil = smoothstep(0.52, 0.85, wisps) * smoothstep(0.03, 0.3, ray.y) * atmosphere.weather.z;
  let veil_light = atmosphere.light.rgb * (0.012 + 0.05 * pow(max(dot(ray, sun), 0.0), 8.0))
    + atmosphere.ambient.rgb * 0.8;
  color = mix(color, veil_light, veil * 0.45);

  if (night > 0.001) {
    let moon_distance = length(ray - moon);
    let moon_disc = 1.0 - smoothstep(0.010, 0.012, moon_distance);
    let moon_right = normalize(cross(vec3f(0.0, 1.0, 0.0), moon));
    let moon_up = cross(moon, moon_right);
    let moon_uv = vec2f(dot(ray - moon, moon_right), dot(ray - moon, moon_up)) / 0.012;
    let phase_angle = atmosphere.celestial.z * 6.283185;
    let limb = vec2f(sin(atmosphere.celestial.w), cos(atmosphere.celestial.w));
    let face = sqrt(max(0.0, 1.0 - dot(moon_uv, moon_uv)));
    let illumination = smoothstep(-0.06, 0.06, dot(moon_uv, limb) * abs(sin(phase_angle)) - face * cos(phase_angle));
    // Maria: large dark basins plus fine craters, not uniform speckle.
    let maria = smoothstep(0.45, 0.7, noise3(vec3f(moon_uv * 2.2 + 5.0, 1.0)));
    let crater = noise3((ray - moon) * 320.0 + 21.0);
    let moon_visibility = smoothstep(-0.01, 0.02, moon.y);
    let albedo = (0.85 - maria * 0.35) * (0.85 + crater * 0.15);
    color += vec3f(1.0, 0.97, 0.9) * 1.6 * moon_disc * (0.02 + illumination * 0.98) * albedo * night * moon_visibility;
    color += vec3f(0.05, 0.08, 0.14) * exp(-moon_distance * 14.0) * night * moon_visibility * (0.5 - 0.5 * cos(phase_angle));
    color += to_linear(star_field(ray)) * night * 0.8;
  }
  let overcast = smoothstep(0.55, 1.0, atmosphere.weather.w);
  let gray = dot(color, vec3f(0.2126, 0.7152, 0.0722));
  // Thick cloud and rain dim the whole sky, not just desaturate it.
  let gloom = 1.0 - overcast * 0.25 - smoothstep(0.2, 4.0, atmosphere.rain) * 0.35;
  return mix(color, vec3f(gray) * vec3f(0.92, 0.96, 1.0), overcast * 0.75) * gloom;
}

// Henyey-Greenstein lobe, scaled so an isotropic scatterer averages 1.
fn hg(mu: f32, g: f32) -> f32 {
  let g2 = g * g;
  return (1.0 - g2) / pow(max(1.0 + g2 - 2.0 * g * mu, 0.0001), 1.5);
}

fn render_clouds(eye: vec3f, ray: vec3f, sun: vec3f, moon: vec3f, sky: vec3f, night: f32, exposure: f32) -> vec4f {
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
  // Empty space is cheap, and opaque rays terminate early.
  for (var i = 0u; i < 64u; i++) {
    if (i >= steps || transmission < 0.018) { break; }
    let fraction = (f32(i) + 0.5) / atmosphere.steps;
    let distance = 1.0 + fraction * fraction * 44.0;
    let step_size = (2.0 * fraction * 44.0) / atmosphere.steps;
    let position = eye + ray * distance;
    if (position.y < -4.0 || position.y > 8.0) { continue; }
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
    lighting *= 1.0 - atmosphere.weather.x * atmosphere.weather.w * 0.5 * (1.0 - height_light);
    let haze = 1.0 - exp(-distance * 0.021);
    lighting = mix(lighting, sky, haze * 0.75);
    let alpha = 1.0 - exp(-density * step_size * 1.9);
    radiance += lighting * alpha * transmission;
    transmission *= 1.0 - alpha;
  }
  return vec4f(radiance + sky * transmission, transmission);
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

fn star_field(ray: vec3f) -> vec3f {
  let latitude = atmosphere.celestial.y;
  let declination = asin(clamp(ray.z * cos(latitude) + ray.y * sin(latitude), -1.0, 1.0));
  let hour_angle = atan2(-ray.x, ray.y * cos(latitude) - ray.z * sin(latitude));
  let ra = atmosphere.celestial.x - hour_angle;
  let coordinates = vec2f(fract(ra / 6.283185), 0.5 - declination / 3.141593);
  let stars = textureSampleLevel(starAtlas, cloudSampler, coordinates, 0.0).rgb;
  let shimmer = 0.90 + 0.10 * sin(atmosphere.time * 0.6 + ra * 110.0);
  return stars * shimmer * smoothstep(0.0, 0.10, ray.y);
}

fn noise3(p: vec3f) -> f32 {
  let cell = floor(p);
  let f = fract(p);
  let blend = f * f * (3.0 - 2.0 * f);
  return textureSampleLevel(cloudNoise, cloudSampler, (cell + blend + 0.5) / 64.0, 0.0).r;
}
