import { Atmosphere, view_ray } from "./view.wgsl";

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
  let light = normalize(mix(sun, moon, night));

  let sky = atmosphere_color(ray, sun, moon, night);
  let clouds = render_clouds(eye, ray, light, sky, night);
  return clouds;
}

fn atmosphere_color(ray: vec3f, sun: vec3f, moon: vec3f, night: f32) -> vec3f {
  let horizon = palette(vec3f(0.67, 0.81, 0.83), vec3f(0.84, 0.62, 0.51), vec3f(0.14, 0.22, 0.38));
  let zenith = palette(vec3f(0.16, 0.39, 0.58), vec3f(0.20, 0.26, 0.40), vec3f(0.018, 0.035, 0.095));
  var color = mix(horizon, zenith, pow(clamp(ray.y * 1.8 + 0.18, 0.0, 1.0), 0.7));
  let sun_distance = length(ray - sun);
  let warm = palette(vec3f(1.0, 0.77, 0.43), vec3f(1.0, 0.53, 0.28), vec3f(0.32, 0.46, 0.8));
  let glow = exp(-sun_distance * 6.0) * 0.18 + exp(-sun_distance * 22.0) * 0.12;
  color += (warm * glow) * (1.0 - night) * smoothstep(-0.02, 0.005, sun.y);

  // Thin ice-cloud veil at a distant altitude: different perspective and drift.
  let high_position = ray.xz * (18.0 / max(ray.y + 0.23, 0.07));
  let wisps = noise3(vec3f(high_position * vec2f(0.065, 0.22), 7.0) + vec3f(atmosphere.time * 0.004, 0.0, 0.0));
  let veil = smoothstep(0.58, 0.85, wisps) * smoothstep(0.08, 0.4, ray.y);
  color = mix(color, palette(vec3f(0.87, 0.94, 1.0), vec3f(0.93, 0.57, 0.55), vec3f(0.24, 0.32, 0.47)), veil * 0.38 * atmosphere.weather.z);

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
    let crater = noise3((ray - moon) * 320.0 + 21.0);
    let moon_visibility = smoothstep(-0.01, 0.02, moon.y);
    color += vec3f(0.86, 0.91, 0.79) * moon_disc * (0.03 + illumination * 0.97) * (0.82 + crater * 0.18) * night * moon_visibility;
    color += vec3f(0.13, 0.21, 0.34) * exp(-moon_distance * 16.0) * night * moon_visibility * (0.5 - 0.5 * cos(phase_angle));
    color += star_field(ray) * night;

  }
  let overcast = smoothstep(0.55, 1.0, atmosphere.weather.w);
  let gray = dot(color, vec3f(0.25, 0.55, 0.2));
  return mix(color, vec3f(gray) * vec3f(0.86, 0.93, 1.0), overcast * 0.62);
}

fn render_clouds(eye: vec3f, ray: vec3f, light: vec3f, sky: vec3f, night: f32) -> vec4f {
  var radiance = vec3f(0.0);
  var transmission = 1.0;
  let sunlight = palette(vec3f(1.06, 1.01, 0.90), vec3f(1.25, 0.64, 0.35), vec3f(0.48, 0.62, 0.76));
  let shadow = palette(vec3f(0.27, 0.43, 0.65), vec3f(0.29, 0.22, 0.40), vec3f(0.045, 0.08, 0.17));
  let ambient = palette(vec3f(0.52, 0.68, 0.82), vec3f(0.55, 0.34, 0.48), vec3f(0.13, 0.21, 0.34));
  let light_visibility = smoothstep(-0.035, 0.08, light.y);
  let alignment = max(dot(ray, light), 0.0);
  let silver = pow(alignment, 18.0) * (1.0 - night * 0.35) * light_visibility;
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
    let direct = exp(-optical_depth * 1.7);
    let powder = 1.0 - exp(-density * 2.4);
    let sky_light = smoothstep(-2.0, 2.0, position.y) * 0.20;
    var lighting = shadow * (0.5 + powder * 0.25) + ambient * (0.16 + sky_light);
    lighting += sunlight * direct * (0.70 + silver * 0.8) * (1.0 - atmosphere.weather.w * 0.35) * light_visibility;
    lighting += sunlight * silver * exp(-density * 2.0) * 0.18;
    let haze = 1.0 - exp(-distance * 0.019);
    lighting = mix(lighting, sky, haze * 0.72);
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

fn palette(day: vec3f, dusk: vec3f, night: vec3f) -> vec3f {
  if (atmosphere.scene < 1.0) {
    return mix(day, dusk, smoothstep(0.0, 1.0, atmosphere.scene));
  }
  return mix(dusk, night, smoothstep(1.0, 2.0, atmosphere.scene));
}

fn noise3(p: vec3f) -> f32 {
  let cell = floor(p);
  let f = fract(p);
  let blend = f * f * (3.0 - 2.0 * f);
  return textureSampleLevel(cloudNoise, cloudSampler, (cell + blend + 0.5) / 64.0, 0.0).r;
}
