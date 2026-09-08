import { Atmosphere, view_ray } from "./view.wgsl";
import { ocean_view, OceanSettings } from "./ocean.wgsl";

@group(0) @binding(0) var<uniform> atmosphere: Atmosphere;
@group(0) @binding(1) var cloudNoise: texture_3d<f32>;
@group(0) @binding(2) var filtering: sampler;
@group(0) @binding(3) var skyTexture: texture_2d<f32>;

@fragment
fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let ray = view_ray(uv, atmosphere.resolution, atmosphere.pointer);
  let night = smoothstep(1.0, 2.0, atmosphere.scene);
  let light = normalize(mix(atmosphere.sun, atmosphere.moon, night));
  let sky_sample = textureSampleLevel(skyTexture, filtering, uv, 0.0);
  let sky = sky_sample.rgb;
  let settings = OceanSettings(atmosphere.time, atmosphere.scene, atmosphere.wind,
    atmosphere.weather.w, atmosphere.resolution, atmosphere.seed);
  var color = ocean_view(ray, light, sky, settings, cloudNoise, filtering, skyTexture);
  // The direct disc is composited through cloud transmission. Water uses its
  // integrated BRDF instead of reflecting a low-resolution disc a second time.
  let sun_distance = length(ray - atmosphere.sun);
  let edge = max(fwidth(sun_distance), 0.00001);
  let disc = 1.0 - smoothstep(0.006 - edge, 0.006 + edge, sun_distance);
  // Clip each point of the disc against the actual sea horizon, not its centre.
  let horizon_edge = max(fwidth(ray.y), 0.00001);
  let above_sea = smoothstep(-horizon_edge * 0.5, horizon_edge * 0.5, ray.y);
  let sunset = 1.0 - smoothstep(0.0, 0.15, atmosphere.sun.y);
  let sun_colour = mix(vec3f(1.0, 0.96, 0.82), vec3f(1.0, 0.68, 0.37), sunset);
  color = mix(color, sun_colour, disc * above_sea * sky_sample.a * (1.0 - night));
  if (atmosphere.rain > 0.01) {
    color += rain_streaks(uv) * mix(vec3f(0.22, 0.27, 0.30), vec3f(0.07, 0.11, 0.16), night);
  }
  let grain = (hash2(floor(uv * atmosphere.resolution)).x - 0.5) / 255.0;
  let screen = uv - 0.5;
  let vignette = 1.0 - dot(screen, screen) * 0.12;
  color = pow(max(color * vignette, vec3f(0.0)), vec3f(0.96));
  return vec4f(clamp(color + grain, vec3f(0.0), vec3f(1.0)), 1.0);
}

fn rain_streaks(uv: vec2f) -> f32 {
  let p = uv * atmosphere.resolution / vec2f(4.0, 30.0);
  let slant = atmosphere.wind.x * 0.012;
  let cell = floor(vec2f(p.x + p.y * slant, p.y + atmosphere.time * 2.8));
  let random = hash2(cell);
  let local = fract(vec2f(p.x + p.y * slant, p.y + atmosphere.time * 2.8));
  return step(random.x, min(0.65, atmosphere.rain * 0.12)) * step(local.x, 0.18)
    * smoothstep(0.2, 0.5, local.y) * (1.0 - smoothstep(0.6, 0.95, local.y));
}

fn hash2(p: vec2f) -> vec2f {
  var q = fract(vec3f(p.x, p.y, p.x) * vec3f(0.1031, 0.1030, 0.0973));
  q += dot(q, q.yzx + 33.33);
  return fract((q.xx + q.yz) * q.zy);
}
