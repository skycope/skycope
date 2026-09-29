import { Atmosphere, view_ray } from "./view.wgsl";
import { ocean_view, OceanSettings } from "./ocean.wgsl";
import { tonemap, sun_radiance } from "./atmosphere.wgsl";
import { equatorial_from_local, catalog_stars, faint_stars, moon_disc } from "./night.wgsl";

@group(0) @binding(0) var<uniform> atmosphere: Atmosphere;
@group(0) @binding(1) var cloudNoise: texture_3d<f32>;
@group(0) @binding(2) var filtering: sampler;
@group(0) @binding(3) var skyTexture: texture_2d<f32>;
@group(0) @binding(4) var starCatalog: texture_2d<f32>;
// The wind-sea cascades (waves.wgsl) and the whitecap history (foam.wgsl).
@group(0) @binding(5) var waves0: texture_2d<f32>;
@group(0) @binding(6) var waves1: texture_2d<f32>;
@group(0) @binding(7) var waves2: texture_2d<f32>;
@group(0) @binding(8) var waves3: texture_2d<f32>;
@group(0) @binding(9) var foamLayer: texture_2d<f32>;
// The boulders at the waterline and their lookup grid (src/rocks.js).
@group(0) @binding(10) var shoreRocks: texture_2d<f32>;
@group(0) @binding(11) var shoreGrid: texture_2d<u32>;
// The sky-view table (sky-table.wgsl), for reflections of sky off screen.
@group(0) @binding(12) var skyTable: texture_2d<f32>;

@fragment
fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let ray = view_ray(uv, atmosphere.resolution, atmosphere.pointer, atmosphere.flight.w, atmosphere.pitch);
  let night = smoothstep(1.0, 2.0, atmosphere.scene);
  let light = normalize(mix(atmosphere.sun, atmosphere.moon, night));
  let sky_sample = textureSampleLevel(skyTexture, filtering, uv, 0.0);
  let sky = sky_sample.rgb;
  let settings = OceanSettings(atmosphere.time, atmosphere.scene, atmosphere.wind,
    atmosphere.weather.w, atmosphere.resolution, atmosphere.seed,
    atmosphere.flight.xyz, atmosphere.flight.w, atmosphere.pitch,
    atmosphere.light.rgb, atmosphere.ambient.rgb, atmosphere.swell, atmosphere.light.w, atmosphere.rain);
  var color = ocean_view(ray, light, sky, settings, cloudNoise, filtering, skyTexture,
    waves0, waves1, waves2, waves3, foamLayer, shoreRocks, shoreGrid, skyTable);
  // The direct disc is composited through cloud transmission. Water uses its
  // integrated BRDF instead of reflecting a low-resolution disc a second time.
  let sun_distance = length(ray - atmosphere.sun);
  let edge = max(fwidth(sun_distance), 0.00001);
  let disc = 1.0 - smoothstep(0.006 - edge, 0.006 + edge, sun_distance);
  // Clip each point of the disc against the actual sea horizon, not its centre.
  let horizon_edge = max(fwidth(ray.y), 0.00001);
  let above_sea = smoothstep(-horizon_edge * 0.5, horizon_edge * 0.5, ray.y);
  // The disc is the sun's true radiance through the air and clouds; the
  // filmic shoulder turns it white-hot at noon and deep orange at sunset.
  let sun_colour = atmosphere.light.rgb * 60.0;
  color = mix(color, sun_colour, disc * above_sea * sky_sample.a * (1.0 - night));
  // A soft aureole around the disc: forward scattering in hazy coastal air.
  color += atmosphere.light.rgb * exp(-sun_distance * 90.0) * 0.12 * above_sea * sky_sample.a * (1.0 - night);
  if (ray.y > -0.001) {
    color += night_sky(ray, night, sky_sample.a * above_sea, dot(sky, vec3f(0.2126, 0.7152, 0.0722)));
  }
  if (atmosphere.rain > 0.01) {
    color += rain_streaks(uv) * (atmosphere.ambient.rgb * 0.8 + vec3f(0.01));
  }
  let screen = uv - 0.5;
  let vignette = 1.0 - dot(screen, screen) * 0.18;
  let grain = (hash2(floor(uv * atmosphere.resolution)).x - 0.5) / 255.0;
  return vec4f(tonemap(color * vignette) + grain, 1.0);
}

// The Moon and stars need full-resolution pixels: the cloud pass is
// upscaled, which smeared them. One pixel's angle sets their sharpness;
// on dense displays it stays a CSS-pixel-ish size so stars don't vanish.
fn night_sky(ray: vec3f, night: f32, clear: f32, background: f32) -> vec3f {
  let pixel = 1.0 / (0.9 * min(atmosphere.resolution.y, 1300.0));
  let sidereal = atmosphere.celestial.x;
  let latitude = atmosphere.celestial.y;
  // Sunlight reaching the Moon, reddened on its way down to us; the
  // exposure is capped so the disc keeps its maria at night instead of
  // burning to white, and it shows pale by day as the real Moon does. The
  // disc is drawn about four times its true 0.26° radius, like the sun,
  // so its face reads.
  var light = vec3f(0.0);
  var moon_cover = 0.0;
  if (length(ray - atmosphere.moon) < 0.019 + pixel * 2.0) {
    let moonlight = sun_radiance(atmosphere.moon) * min(atmosphere.light.w, 0.95);
    let moon = moon_disc(ray, atmosphere.moon, atmosphere.sun, sidereal, latitude, pixel, 0.019, moonlight);
    light = moon.rgb * moon.a * clear;
    moon_cover = moon.a;
  }
  if (night > 0.001) {
    let eq = equatorial_from_local(ray, sidereal, latitude);
    let airmass = 1.0 / max(ray.y, 0.02);
    let extinction = exp(-0.28 * (airmass - 1.0)) * smoothstep(0.0, 0.05, ray.y);
    let stars = catalog_stars(eq, starCatalog, pixel, atmosphere.time, airmass, background)
      + faint_stars(eq, pixel, background);
    light += stars * extinction * night * clear * (1.0 - moon_cover);
  }
  return light;
}

// Rain: thin slanted streaks. Each column falls at its own speed and phase,
// so drops never line up into rows; two depths give parallax.
fn rain_streaks(uv: vec2f) -> f32 {
  var total = 0.0;
  for (var layer = 0; layer < 2; layer++) {
    let scale = select(vec2f(3.0, 26.0), vec2f(5.0, 44.0), layer == 1);
    let p = uv * atmosphere.resolution / scale;
    let slant = atmosphere.wind.x * 0.012;
    let x = p.x + p.y * slant;
    let column = floor(x);
    let lane = hash2(vec2f(column, f32(layer) * 7.0));
    let y = p.y + atmosphere.time * (2.2 + lane.y * 1.6) * (1.0 + f32(layer) * 0.6) + lane.x * 40.0;
    let cell = floor(y);
    let random = hash2(vec2f(column, cell));
    let local = vec2f(fract(x), fract(y));
    total += step(random.x, min(0.5, atmosphere.rain * 0.1)) * (1.0 - smoothstep(0.08, 0.2, abs(local.x - 0.5 - (random.y - 0.5) * 0.6)))
      * smoothstep(0.0, 0.4, local.y) * (1.0 - smoothstep(0.5, 1.0, local.y)) * (0.6 + f32(layer) * 0.4);
  }
  return total;
}

fn hash2(p: vec2f) -> vec2f {
  var q = fract(vec3f(p.x, p.y, p.x) * vec3f(0.1031, 0.1030, 0.0973));
  q += dot(q, q.yzx + 33.33);
  return fract((q.xx + q.yz) * q.zy);
}
