// Camera-relative metres: x right, y up, z toward the coast.
export struct OceanSettings {
  time: f32,
  scene: f32,
  wind: vec2f,
  overcast: f32,
  resolution: vec2f,
  seed: f32,
};

export fn ocean_view(
  ray: vec3f, sunlight: vec3f, sky: vec3f,
  settings: OceanSettings, noise: texture_3d<f32>, filtering: sampler, sky_texture: texture_2d<f32>,
) -> vec3f {
  let right = vec3f(0.707107, 0.0, 0.707107);
  let forward = vec3f(-0.707107, 0.0, 0.707107);
  let direction = vec3f(dot(ray, right), ray.y, dot(ray, forward));
  if (direction.z <= 0.0 || direction.y >= -0.0001) { return sky; }
  let light = vec3f(dot(sunlight, right), sunlight.y, dot(sunlight, forward));
  let eye = vec3f(6.0, 4.5, 0.0);
  var distance = -eye.y / direction.y;
  // Only broad swells displace the intersection. Fine waves shade its normal;
  // tracing them with Newton steps produces discontinuous roots and dotted bands.
  // A ray covers more sea at grazing angles. Filter before sampling, not afterwards:
  // averaging already-aliased normals cannot remove distant stripes or sparkles.
  let pixel_angle = dot(direction, vec3f(0.0, 0.104528, 0.994522)) / (settings.resolution.y * 0.9);
  let horizontal = vec2f(distance * pixel_angle, 0.0);
  let vertical = (vec2f(0.0, -0.104528) - direction.xz * 0.994522 / direction.y) * distance * pixel_angle;
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
  waves += ripple_surface(p.xz, footprint, settings.time, noise, filtering);
  return ocean(p, direction, light, sky, waves, footprint, distance, settings, noise, filtering, sky_texture);
}

fn ocean(
  p: vec3f, ray: vec3f, light: vec3f, sky: vec3f, waves: vec4f,
  footprint: mat2x2f, distance: f32, settings: OceanSettings,
  noise: texture_3d<f32>, filtering: sampler, sky_texture: texture_2d<f32>,
) -> vec3f {
  let grazing = smoothstep(0.015, 0.10, -ray.y);
  let normal = normalize(vec3f(-waves.y * grazing, 1.0, -waves.z * grazing));
  let view = -ray;
  let nv = max(dot(normal, view), 0.01);
  let reflected = reflect(ray, normal);
  let fresnel = 0.02 + 0.98 * pow(1.0 - nv, 5.0);
  let deep = coast_palette(vec3f(0.035, 0.19, 0.22), vec3f(0.055, 0.12, 0.14), vec3f(0.008, 0.023, 0.038), settings.scene);
  let shallow = coast_palette(vec3f(0.11, 0.33, 0.27), vec3f(0.17, 0.24, 0.18), vec3f(0.018, 0.055, 0.058), settings.scene);
  // Match terrain.js. The beach stays fixed; trees, noise and wave phases change by seed.
  let shore = 4.0 + p.z * 0.075 + sin(p.z * 0.026) * 7.0;
  let depth = max(0.0, (shore - p.x) * 0.15);
  let water = mix(shallow, deep, smoothstep(0.1, 1.8, depth));
  var reflection = mix(sky, coast_palette(vec3f(0.19, 0.38, 0.52), vec3f(0.32, 0.24, 0.31), vec3f(0.020, 0.04, 0.08), settings.scene), smoothstep(0.0, 0.65, reflected.y));
  let reflected_depth = dot(reflected, vec3f(0.0, 0.104528, 0.994522));
  let reflected_uv = vec2f(0.5 + reflected.x * 0.9 / max(reflected_depth, 0.01) * settings.resolution.y / settings.resolution.x,
    0.5 - dot(reflected, vec3f(0.0, 0.994522, -0.104528)) * 0.9 / max(reflected_depth, 0.01));
  if (reflected_depth > 0.0 && all(reflected_uv > vec2f(0.0)) && all(reflected_uv < vec2f(1.0))) {
    // Integrate a small reflection cone: sampling the sun disc at a single point
    // creates pinprick aliases even when the wave normals themselves are filtered.
    let blur = vec2f(0.006, 0.006 * settings.resolution.x / settings.resolution.y);
    let blurred = (textureSampleLevel(sky_texture, filtering, reflected_uv + blur * vec2f(-0.7, -0.3), 0.0).rgb
      + textureSampleLevel(sky_texture, filtering, reflected_uv + blur * vec2f(0.3, -0.7), 0.0).rgb
      + textureSampleLevel(sky_texture, filtering, reflected_uv + blur * vec2f(0.7, 0.3), 0.0).rgb
      + textureSampleLevel(sky_texture, filtering, reflected_uv + blur * vec2f(-0.3, 0.7), 0.0).rgb) * 0.25;
    let edge = min(min(reflected_uv.x, reflected_uv.y), min(1.0 - reflected_uv.x, 1.0 - reflected_uv.y));
    reflection = mix(reflection, blurred, smoothstep(0.0, 0.08, edge));
  }
  var color = mix(water * (0.85 + 0.15 * normal.y), reflection, fresnel);

  // Unresolved waves become surface roughness, conserving their broad reflection.
  // This keeps the sun path soft at the horizon without hard clipping or square glints.
  let alpha = sqrt(0.016 + waves.w * 2.0 + min(length(settings.wind), 12.0) * 0.0008);
  let half_vector = normalize(light + view);
  let nh = max(dot(normal, half_vector), 0.0);
  let nl = max(dot(normal, light), 0.0);
  let vh = max(dot(view, half_vector), 0.0);
  let a2 = alpha * alpha;
  let denominator = nh * nh * (a2 - 1.0) + 1.0;
  let distribution = a2 / max(3.141593 * denominator * denominator, 0.000001);
  let masking = smith(nv, a2) * smith(nl, a2);
  let reflection_fresnel = 0.02 + 0.98 * pow(1.0 - vh, 5.0);
  let specular = distribution * masking * reflection_fresnel / (4.0 * nv);
  let sun_up = smoothstep(-0.03, 0.08, light.y);
  let sunlight = coast_palette(vec3f(1.0, 0.90, 0.72), vec3f(1.0, 0.59, 0.30), vec3f(0.20, 0.30, 0.44), settings.scene);
  let energy = specular * sun_up * (1.0 - settings.overcast * 0.85) * 3.2;
  // Bounded exposure rolls highlights toward the light colour, never a clipped plateau.
  color = mix(color, sunlight, 1.0 - exp(-energy));

  let shore_noise = field(p.xz * 0.85, noise, filtering);
  let breaker = sin(depth * 11.0 + settings.time * 0.22 + shore_noise * 1.5);
  let edge_width = clamp(length(footprint[1]) * 1.4, 0.12, 1.0);
  let foam = smoothstep(0.65 - edge_width, 0.65 + edge_width, breaker)
    * (1.0 - smoothstep(0.12, 0.75, depth)) * smoothstep(0.2, 0.65, shore_noise);
  color = mix(color, coast_palette(vec3f(0.78, 0.83, 0.76), vec3f(0.64, 0.56, 0.43), vec3f(0.10, 0.15, 0.17), settings.scene), foam * 0.7);
  return mix(color, sky, 1.0 - exp(-distance * 0.0018));
}

// Height, x/z slopes, and variance of subpixel waves. Work in shoreline coordinates:
// shorter wavelengths in shallow water turn crests toward the beach. A weaker mirrored
// wave travels back offshore with the same frequency/phase and decays away from land.
fn wave_surface(p: vec2f, footprint: mat2x2f, settings: OceanSettings, geometry: bool) -> vec4f {
  let shore = 4.0 + p.y * 0.075 + sin(p.y * 0.026) * 7.0;
  let shore_slope = 0.075 + cos(p.y * 0.026) * 0.182;
  let offshore = max(0.0, shore - p.x);
  let shallows = exp(-offshore / 12.0);
  let refracted_distance = offshore + 9.0 * (1.0 - shallows);
  let distance_gradient = vec2f(-1.0, shore_slope) * (1.0 + 0.75 * shallows);
  let envelope = smoothstep(0.0, 2.5, offshore);
  let return_strength = 0.22 * exp(-offshore / 18.0);
  let speed = length(settings.wind);
  let wind_angle = atan2(settings.wind.y + 0.01, settings.wind.x + 0.01);
  var frequency = 0.4;
  var amplitude = 0.075 + min(speed * 0.003, 0.035);
  var result = vec4f(0.0);
  for (var i = 0; i < 6; i++) {
    if (geometry && i >= 3) { break; }
    let index = f32(i);
    let angle = sin(index * 2.39996 + settings.seed * 6.283185) * 0.65 + sin(wind_angle) * 0.18;
    let along = sin(angle);
    let across = cos(angle);
    let random = fract(sin(index * 91.345 + settings.seed * 451.123 + 0.71) * 47453.5453);
    let offset = random * 6.283185;
    // A deliberately calm presentation clock; weather still controls amplitude/direction.
    let travel = settings.time * 0.22 * sqrt(9.81 * frequency);
    let incoming_phase = (-refracted_distance * across + p.y * along) * frequency - travel + offset;
    let returning_phase = (refracted_distance * across + p.y * along) * frequency - travel + offset;
    let incoming_gradient = (-distance_gradient * across + vec2f(0.0, along)) * frequency;
    let returning_gradient = (distance_gradient * across + vec2f(0.0, along)) * frequency;
    let projected = max(abs(dot(incoming_gradient, footprint[0])), abs(dot(incoming_gradient, footprint[1])));
    let retained = exp(-0.65 * projected * projected);
    let reflected = return_strength / (1.0 + index * 0.3);
    let height = sin(incoming_phase) + reflected * sin(returning_phase);
    let slope = incoming_gradient * cos(incoming_phase) + reflected * returning_gradient * cos(returning_phase);
    result += vec4f(height, slope, 0.0) * amplitude * retained * envelope;
    result.w += pow(amplitude * frequency, 2.0) * (1.0 - retained * retained) * 0.5;
    frequency *= 1.19 + random * 0.08;
    amplitude *= 0.79;
  }
  return result;
}

// Fine structure is an advected noise gradient, not more periodic sine waves.
// Rotated scales avoid aligned texture cells. Subpixel energy becomes roughness.
fn ripple_surface(p: vec2f, footprint: mat2x2f, time: f32, noise: texture_3d<f32>, filtering: sampler) -> vec4f {
  var rotation = mat2x2f(vec2f(0.8, 0.6), vec2f(-0.6, 0.8));
  var frequency = 0.75;
  var amplitude = 0.07;
  var slope = vec2f(0.0);
  var variance = 0.0;
  let pixel_size = max(length(footprint[0]), length(footprint[1]));
  for (var i = 0; i < 4; i++) {
    let retained = exp(-0.7 * pow(frequency * pixel_size, 2.0));
    let q = rotation * p * frequency + vec2f(time * 0.018, time * 0.009);
    let z = 11.3 + f32(i) * 9.17 + time * 0.012;
    let dx = volume(vec3f(q + vec2f(0.2, 0.0), z), noise, filtering)
      - volume(vec3f(q - vec2f(0.2, 0.0), z), noise, filtering);
    let dz = volume(vec3f(q + vec2f(0.0, 0.2), z), noise, filtering)
      - volume(vec3f(q - vec2f(0.0, 0.2), z), noise, filtering);
    slope += transpose(rotation) * vec2f(dx, dz) * amplitude * retained / 0.4;
    variance += amplitude * amplitude * (1.0 - retained * retained) * 0.25;
    rotation = rotation * mat2x2f(vec2f(0.36, 0.932952), vec2f(-0.932952, 0.36));
    frequency *= 2.43;
    amplitude *= 0.72;
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

fn coast_palette(day: vec3f, dusk: vec3f, night: vec3f, scene: f32) -> vec3f {
  if (scene < 1.0) { return mix(day, dusk, smoothstep(0.0, 1.0, scene)); }
  return mix(dusk, night, smoothstep(1.0, 2.0, scene));
}
