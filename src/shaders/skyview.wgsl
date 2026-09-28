// Sky-view lookup: the clear-sky scattering integral is smooth, so it is
// evaluated once per frame into a small table (azimuth x elevation) instead
// of per pixel (Hillaire 2020). Elevation is stored with a square-root
// mapping, so rows crowd toward the horizon where the colour changes fastest.
// Shared by the table pass, the cloud march and the sky resolve.

import { sky_radiance } from "./atmosphere.wgsl";

export const LUT_SIZE: vec2f = vec2f(256.0, 128.0);

// Moonlight is scotopic: the eye sees only its luminance, cool-tinted. Keep
// equal to MOON_TINT in src/sunlight.js.
export const MOON_TINT: vec3f = vec3f(0.90, 1.01, 1.19);

// Moonlight is sunlight scaled by distance and phase (~1/400000 of the sun at
// full moon); it is lifted far above that here, with src/sunlight.js, so a
// moonlit sky reads as deep blue, not black. `phase` is 0-1 (0 = new).
export fn moonlight(moon: vec3f, phase: f32) -> f32 {
  let lit = 0.5 - 0.5 * cos(phase * 6.283185);
  return 0.003 * lit * smoothstep(-0.02, 0.05, moon.y);
}

// Local direction (east, up, north) for a table coordinate, and back.
export fn lut_direction(uv: vec2f) -> vec3f {
  let azimuth = uv.x * 6.283185;
  let s = uv.y * 2.0 - 1.0;
  let elevation = sign(s) * s * s * 1.570796;
  return vec3f(sin(azimuth) * cos(elevation), sin(elevation), cos(azimuth) * cos(elevation));
}

export fn lut_uv(ray: vec3f) -> vec2f {
  let azimuth = atan2(ray.x, ray.z);
  let elevation = asin(clamp(ray.y, -1.0, 1.0));
  let s = sign(elevation) * sqrt(abs(elevation) / 1.570796);
  // Half a texel inside the rows so the repeating sampler never wraps
  // zenith into nadir; columns wrap around the compass on purpose.
  let v = clamp(s * 0.5 + 0.5, 0.5 / LUT_SIZE.y, 1.0 - 0.5 / LUT_SIZE.y);
  return vec2f(fract(azimuth / 6.283185), v);
}

// Unexposed sky radiance toward `ray` from the sun and, at night, the
// scotopic moon.
export fn sky_view(ray: vec3f, sun: vec3f, moon: vec3f, night: f32, moon_phase: f32) -> vec3f {
  var radiance = sky_radiance(ray, sun, 12);
  if (night > 0.001) {
    let moonlit = sky_radiance(ray, moon, 6) * moonlight(moon, moon_phase) * 0.6;
    radiance += dot(moonlit, vec3f(0.2126, 0.7152, 0.0722)) * MOON_TINT;
  }
  return radiance;
}

// Smooth value noise from the repeating 64³ volume.
export fn volume_noise(p: vec3f, volume: texture_3d<f32>, filtering: sampler) -> f32 {
  let cell = floor(p);
  let f = fract(p);
  let blend = f * f * (3.0 - 2.0 * f);
  return textureSampleLevel(volume, filtering, (cell + blend + 0.5) / 64.0, 0.0).r;
}

// Thick cloud and rain grey and dim the whole sky, not just desaturate it.
// Applied to the finished background and to the sky colour the cloud march
// hazes toward, so both agree. `cover` is total cloud cover, `rain` mm/h.
export fn overcast_sky(color: vec3f, cover: f32, rain: f32) -> vec3f {
  let overcast = smoothstep(0.55, 1.0, cover);
  let gray = dot(color, vec3f(0.2126, 0.7152, 0.0722));
  let gloom = 1.0 - overcast * 0.25 - smoothstep(0.2, 4.0, rain) * 0.35;
  return mix(color, vec3f(gray) * vec3f(0.92, 0.96, 1.0), overcast * 0.75) * gloom;
}
