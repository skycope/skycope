import { hash2 } from "@vgpu/wgsl-std/hash";
import { fbmPerlin2d, perlin2d } from "@vgpu/wgsl-std/noise/perlin";

struct Atmosphere {
  resolution: vec2f,
  pointer: vec2f,
  time: f32,
  scene: f32,
};

@group(0) @binding(0) var<uniform> atmosphere: Atmosphere;

fn palette(day: vec3f, dusk: vec3f, night: vec3f) -> vec3f {
  if (atmosphere.scene < 1.0) {
    return mix(day, dusk, smoothstep(0.0, 1.0, atmosphere.scene));
  }
  return mix(dusk, night, smoothstep(1.0, 2.0, atmosphere.scene));
}

fn cloud_field(position: vec2f, offset: vec2f, speed: f32) -> f32 {
  let drift = position + offset + vec2f(atmosphere.time * speed, 0.0);
  let warp_amount = fbmPerlin2d(drift * 0.82, 2, 2.07, 0.5);
  let warp = vec2f(warp_amount, -warp_amount) * 0.38;
  let body = fbmPerlin2d(drift * 1.18 + warp, 3, 2.13, 0.5);
  let detail = perlin2d(drift * 5.2 + warp);
  return body * 0.88 + detail * 0.12;
}

fn cloud_wisp(position: vec2f, offset: vec2f, speed: f32) -> f32 {
  let drift = position + offset + vec2f(atmosphere.time * speed, 0.0);
  return fbmPerlin2d(drift, 2, 2.11, 0.5);
}

fn stars(sky_uv: vec2f) -> f32 {
  let star_grid = sky_uv * vec2f(178.0, 106.0);
  let star_id = floor(star_grid);
  let star_cell = fract(star_grid) - 0.5;
  let random = hash2(star_id);
  let core = select(
    0.0,
    1.0 - smoothstep(0.012, 0.11, length(star_cell)),
    random.x > 0.987,
  );
  let twinkle = 0.58 + 0.42 * sin(
    atmosphere.time * (0.8 + random.y * 2.7) + random.x * 24.0
  );
  return core * twinkle * smoothstep(0.25, 0.92, sky_uv.y);
}

fn aurora(p: vec2f, sky_uv: vec2f) -> f32 {
  let distortion = fbmPerlin2d(
    vec2f(p.x * 0.72 + atmosphere.time * 0.018, p.y * 1.8),
    3,
    2.08,
    0.5,
  );
  let center = 0.43
    + sin(p.x * 1.45 + atmosphere.time * 0.14) * 0.08
    + distortion * 0.16;
  let ribbon = exp(-pow(abs(p.y - center) * 4.8, 2.0));
  return ribbon * smoothstep(0.38, 0.9, sky_uv.y);
}

@fragment
fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let sky_uv = vec2f(uv.x, 1.0 - uv.y);
  let aspect = atmosphere.resolution.x / atmosphere.resolution.y;
  let p = (sky_uv * 2.0 - 1.0) * vec2f(aspect, 1.0);
  let ambient_drift = vec2f(
    sin(atmosphere.time * 0.08) * 0.016,
    cos(atmosphere.time * 0.06) * 0.01,
  );
  let parallax = (atmosphere.pointer - 0.5) * vec2f(0.17, 0.085) + ambient_drift;
  let night_amount = smoothstep(0.96, 2.0, atmosphere.scene);

  let horizon = palette(
    vec3f(0.72, 0.94, 1.0),
    vec3f(1.0, 0.58, 0.42),
    vec3f(0.25, 0.36, 0.65),
  );
  let zenith = palette(
    vec3f(0.035, 0.46, 0.88),
    vec3f(0.22, 0.11, 0.52),
    vec3f(0.018, 0.035, 0.13),
  );
  var color = mix(horizon, zenith, smoothstep(0.02, 1.0, sky_uv.y));

  let sun_position = mix(
    vec2f(aspect * 0.35, 0.22),
    vec2f(aspect * 0.38, -0.18),
    smoothstep(0.0, 1.0, atmosphere.scene),
  );
  let sun_distance = length(p - sun_position - parallax * 0.5);
  let sun_glow = 0.026 / (sun_distance * sun_distance + 0.025);
  let sun_disc = 1.0 - smoothstep(0.045, 0.075, sun_distance);
  let sun_color = palette(
    vec3f(1.0, 0.82, 0.34),
    vec3f(1.0, 0.43, 0.18),
    vec3f(0.0),
  );
  color = color + sun_color
    * (sun_glow * 0.23 + sun_disc * 0.9)
    * (1.0 - night_amount);
  let sun_halo = exp(-sun_distance * 4.0) * (1.0 - night_amount);
  let prism_halo = exp(-pow((sun_distance - 0.22) * 13.0, 2.0))
    * (1.0 - night_amount);
  color = color
    + palette(
      vec3f(0.3, 0.15, 0.025),
      vec3f(0.38, 0.08, 0.18),
      vec3f(0.0),
    ) * sun_halo * 0.12
    + vec3f(0.24, 0.07, 0.2) * prism_halo * 0.055;

  let moon_position = vec2f(aspect * 0.35, 0.32) + parallax * 0.5;
  let moon_distance = length(p - moon_position);
  let moon_disc = 1.0 - smoothstep(0.045, 0.064, moon_distance);
  let moon_shade = smoothstep(
    -0.18,
    0.55,
    perlin2d((p - moon_position) * 42.0),
  );
  color = color
    + vec3f(0.68, 0.82, 1.0) * moon_disc * (0.68 + moon_shade * 0.29) * night_amount
    + vec3f(0.18, 0.38, 0.76)
      * (0.012 / (moon_distance * moon_distance + 0.018))
      * night_amount;

  let aurora_amount = aurora(p, sky_uv);
  let aurora_mix = 0.5 + 0.5 * sin(p.x * 1.4 + atmosphere.time * 0.07);
  let aurora_color = mix(
    vec3f(0.08, 0.9, 0.72),
    vec3f(0.65, 0.3, 1.0),
    aurora_mix,
  );
  color = color
    + vec3f(0.82, 0.9, 1.0) * stars(sky_uv) * night_amount
    + aurora_color * aurora_amount * night_amount * 0.32;

  let cloud_position = vec2f(p.x * 0.62, p.y * 1.16) + parallax;
  let cloud_main = cloud_field(cloud_position, vec2f(2.1, 4.7), 0.022);
  let cloud_far = cloud_wisp(
    vec2f(p.x * 0.44, p.y * 1.58) - parallax * 0.55,
    vec2f(12.4, -3.1),
    -0.01,
  );
  let cloud_band = smoothstep(0.03, 0.22, sky_uv.y)
    * (1.0 - smoothstep(0.8, 1.04, sky_uv.y));
  let cloud_shadow = smoothstep(-0.18, 0.29, cloud_main) * cloud_band;
  let cloud_light = smoothstep(0.08, 0.56, cloud_main) * cloud_band;
  let cloud_wisps = smoothstep(0.18, 0.54, cloud_far)
    * smoothstep(0.45, 0.74, sky_uv.y)
    * (1.0 - smoothstep(0.88, 1.0, sky_uv.y));
  let shadow_color = palette(
    vec3f(0.38, 0.65, 0.82),
    vec3f(0.55, 0.32, 0.56),
    vec3f(0.1, 0.17, 0.35),
  );
  let light_color = palette(
    vec3f(1.0, 0.99, 0.97),
    vec3f(1.0, 0.73, 0.65),
    vec3f(0.45, 0.55, 0.82),
  );
  color = mix(color, shadow_color, cloud_shadow * 0.36);
  color = mix(color, light_color, cloud_light * 0.76);
  color = mix(color, light_color, cloud_wisps * 0.2);

  let vignette = 1.0 - dot(sky_uv - 0.5, sky_uv - 0.5) * 0.34;
  let pixel = floor(sky_uv * atmosphere.resolution);
  let grain = (hash2(pixel).x - 0.5) / 255.0;
  color = clamp(color * vignette + grain, vec3f(0.0), vec3f(1.0));

  return vec4f(color, 1.0);
}
