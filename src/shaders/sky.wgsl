import { Atmosphere, view_ray, view_uv } from "./view.wgsl";
import { to_linear } from "./atmosphere.wgsl";
import { lut_uv, overcast_sky, volume_noise } from "./skyview.wgsl";
import { equatorial_from_local, galactic_from_equatorial, milky_way } from "./night.wgsl";

// Pass 3 of the sky (1: sky-table.wgsl, 2: clouds.wgsl): at the full sky
// resolution, compose the sky behind the clouds (the table, airglow, ice
// veil, Milky Way, constellation figures) and rebuild the full-resolution
// cloud layer from the quarter-resolution march plus the previous frames.
// Output 0 is the sky the water pass reads (exposed linear HDR, cloud
// transmission in alpha); output 1 is the cloud layer, kept as history.
@group(0) @binding(0) var<uniform> atmosphere: Atmosphere;
@group(0) @binding(1) var cloudNoise: texture_3d<f32>;
@group(0) @binding(2) var cloudSampler: sampler;
@group(0) @binding(3) var starAtlas: texture_2d<f32>;
@group(0) @binding(4) var skyTable: texture_2d<f32>;
@group(0) @binding(5) var cloudLayer: texture_2d<f32>;
@group(0) @binding(6) var cloudHistory: texture_2d<f32>;

struct SkyOutput {
  @location(0) sky: vec4f,
  @location(1) clouds: vec4f,
};

@fragment
fn fs_main(@builtin(position) position: vec4f, @location(0) uv: vec2f) -> SkyOutput {
  let ray = view_ray(uv, atmosphere.resolution, atmosphere.pointer, atmosphere.flight.w, atmosphere.pitch);
  let night = smoothstep(1.0, 2.0, atmosphere.scene);
  let sky = atmosphere_color(ray, atmosphere.sun, atmosphere.moon, night, atmosphere.light.w);
  var clouds = vec4f(0.0, 0.0, 0.0, 1.0);
  // The sea covers everything below the horizon: no clouds there, just the
  // horizon colour that distant water fades into.
  if (ray.y >= -0.02) { clouds = reconstruct_clouds(floor(position.xy), ray); }
  var out: SkyOutput;
  out.sky = vec4f(clouds.rgb + sky * clouds.a, clouds.a);
  out.clouds = clouds;
  return out;
}

// Temporal upsampling. The texel of this pixel's 2x2 block traced exactly
// this pixel if its jitter matches: take it. Otherwise reproject the pixel's
// ray into last frame's view and read the history there, clamped to the
// range of the fresh samples around it so moving or changing cloud never
// leaves ghosts. With no usable history, fall back to smooth upsampling.
fn reconstruct_clouds(pixel: vec2f, ray: vec3f) -> vec4f {
  let size = vec2i(textureDimensions(cloudLayer));
  let block = vec2i(pixel * 0.5);
  let jitter = atmosphere.temporal.xy;
  let fresh = textureLoad(cloudLayer, min(block, size - 1), 0);
  if (all(pixel - vec2f(block) * 2.0 == jitter)) { return fresh; }
  // Smooth estimate: the quarter-resolution image sampled where this pixel
  // falls among the jittered sample positions.
  let texel = 1.0 / vec2f(size);
  let at = clamp(((pixel - jitter) * 0.5 + 0.5) * texel, texel * 0.5, 1.0 - texel * 0.5);
  let spatial = textureSampleLevel(cloudLayer, cloudSampler, at, 0.0);
  if (atmosphere.temporal.z < 0.5) { return spatial; }
  let previous = view_uv(ray, atmosphere.resolution, atmosphere.previous.zw, atmosphere.previous.x, atmosphere.previous.y);
  let edge = 0.5 / atmosphere.resolution;
  if (previous.z < 0.5 || any(previous.xy < edge) || any(previous.xy > 1.0 - edge)) { return spatial; }
  var low = fresh;
  var high = fresh;
  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      let s = textureLoad(cloudLayer, clamp(block + vec2i(dx, dy), vec2i(0), size - 1), 0);
      low = min(low, s);
      high = max(high, s);
    }
  }
  let history = textureSampleLevel(cloudHistory, cloudSampler, previous.xy, 0.0);
  let margin = (high - low) * 0.1;
  return clamp(history, low - margin, high + margin);
}

fn noise3(p: vec3f) -> f32 {
  return volume_noise(p, cloudNoise, cloudSampler);
}

fn atmosphere_color(ray: vec3f, sun: vec3f, moon: vec3f, night: f32, exposure: f32) -> vec3f {
  // Sun and scotopic moon scattering, from the sky-view table.
  var color = textureSampleLevel(skyTable, cloudSampler, lut_uv(ray), 0.0).rgb * exposure;
  // Airglow and scattered starlight: the darkest sky is never pure black.
  color += vec3f(0.004, 0.007, 0.014) * night * (1.0 + (1.0 - clamp(ray.y, 0.0, 1.0)) * 1.5);

  // Thin ice-cloud veil at a distant altitude: different perspective and drift.
  if (atmosphere.weather.z > 0.001) {
    let high_position = ray.xz * (18.0 / max(ray.y + 0.23, 0.07));
    let wisps = noise3(vec3f(high_position * vec2f(0.065, 0.22), 7.0) + vec3f(atmosphere.time * 0.004, 0.0, 0.0))
      * 0.7 + noise3(vec3f(high_position * vec2f(0.21, 0.5), 3.0)) * 0.3;
    let veil = smoothstep(0.52, 0.85, wisps) * smoothstep(0.03, 0.3, ray.y) * atmosphere.weather.z;
    let veil_light = atmosphere.light.rgb * (0.012 + 0.05 * pow(max(dot(ray, sun), 0.0), 8.0))
      + atmosphere.ambient.rgb * 0.8;
    color = mix(color, veil_light, veil * 0.45);
  }

  if (night > 0.001) {
    // The Moon's disc is drawn sharp in the composite pass; its scattered
    // aureole belongs here, under the clouds.
    let moon_distance = length(ray - moon);
    let phase_angle = atmosphere.celestial.z * 6.283185;
    let moon_visibility = smoothstep(-0.01, 0.02, moon.y);
    color += vec3f(0.05, 0.08, 0.14) * exp(-moon_distance * 14.0) * night * moon_visibility * (0.5 - 0.5 * cos(phase_angle));
    // Point stars are also drawn in the composite pass. Here: the Milky Way's
    // diffuse light, dimmed by extinction near the horizon, and the faint
    // constellation figures.
    if (ray.y > -0.02) {
      let eq = equatorial_from_local(ray, atmosphere.celestial.x, atmosphere.celestial.y);
      // Star clouds are structured at every scale, down to a pixel or two.
      let gal = galactic_from_equatorial(eq) * 9.0;
      let clump = noise3(gal) * 0.4 + noise3(gal * 2.1 + 11.0) * 0.3 + noise3(gal * 4.3 + 3.0) * 0.2
        + noise3(gal * 8.9 + 7.0) * 0.1;
      let fine = noise3(gal * 17.0 + 5.0) * 0.6 + noise3(gal * 37.0 + 1.0) * 0.4;
      let extinction = exp(-0.3 / max(ray.y, 0.02)) * smoothstep(0.0, 0.08, ray.y);
      color += milky_way(eq, clump, fine) * extinction * night;
      color += to_linear(constellation_lines(ray)) * night * 0.8;
    }
  }
  return overcast_sky(color, atmosphere.weather.w, atmosphere.rain);
}

fn constellation_lines(ray: vec3f) -> vec3f {
  let latitude = atmosphere.celestial.y;
  let declination = asin(clamp(ray.z * cos(latitude) + ray.y * sin(latitude), -1.0, 1.0));
  let hour_angle = atan2(-ray.x, ray.y * cos(latitude) - ray.z * sin(latitude));
  let ra = atmosphere.celestial.x - hour_angle;
  let coordinates = vec2f(fract(ra / 6.283185), 0.5 - declination / 3.141593);
  let stars = textureSampleLevel(starAtlas, cloudSampler, coordinates, 0.0).rgb;
  return stars * smoothstep(0.0, 0.10, ray.y);
}
