import { Atmosphere, view_ray } from "./view.wgsl";
import { ocean_view, OceanSettings } from "./ocean.wgsl";
import { tonemap, sun_radiance } from "./atmosphere.wgsl";
import { equatorial_from_local, catalog_stars, faint_stars, moon_disc } from "./night.wgsl";
import { lightning_bolt, meteor_light, satellite_light } from "./phenomena.wgsl";

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
// The island's height and albedo (src/land-field.js), for its reflection.
@group(0) @binding(13) var landField: texture_2d<f32>;
// The cat's wake, collar and splashes (src/wake.js).
@group(0) @binding(14) var catWake: texture_2d<f32>;
// The distant islands' skylines (src/archipelago.js, archipelago.wgsl).
@group(0) @binding(15) var islandTable: texture_2d<f32>;

@fragment
fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let ray = view_ray(uv, atmosphere.resolution, atmosphere.pointer, atmosphere.flight.w, atmosphere.pitch);
  let night = smoothstep(1.0, 2.0, atmosphere.scene);
  let light_sum = mix(atmosphere.sun, atmosphere.moon, night);
  let light = light_sum / max(length(light_sum), 0.00001);
  let sky_sample = textureSampleLevel(skyTexture, filtering, uv, 0.0);
  let sky = sky_sample.rgb;
  let settings = OceanSettings(atmosphere.time, atmosphere.scene, atmosphere.wind,
    atmosphere.weather.w, atmosphere.resolution, atmosphere.seed,
    atmosphere.flight.xyz, atmosphere.flight.w, atmosphere.pitch,
    atmosphere.light.rgb, atmosphere.ambient.rgb, atmosphere.swell, atmosphere.light.w, atmosphere.rain,
    atmosphere.ocean.z, atmosphere.ocean.w, atmosphere.pointer,
    // sea-sky-magic: the awakened gifts (view.wgsl).
    atmosphere.magic, atmosphere.pulse, atmosphere.pulseColour, atmosphere.lamp, atmosphere.wisp, atmosphere.wispColour);
  var color = ocean_view(ray, light, sky, settings, cloudNoise, filtering, skyTexture,
    waves0, waves1, waves2, waves3, foamLayer, shoreRocks, shoreGrid, skyTable, landField, catWake, islandTable);
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
  var sun_colour = atmosphere.light.rgb * 60.0;
  // sky-events: the green flash. Air is a weak prism: low on the horizon
  // it lifts the sun's green image a little above its red one, so the
  // upper limb wears a green rim and the last sliver over a clean sea
  // horizon turns green before it goes (scaled with the enlarged disc).
  if (atmosphere.optics.z > 0.0 && disc > 0.0) {
    let limb = smoothstep(0.0044, 0.0057, ray.y - atmosphere.sun.y);
    // The last ~10 s: only the green image is left above the sea.
    let sliver = 1.0 - smoothstep(0.0017, 0.0034, atmosphere.sun.y + 0.006);
    // Faint beside the full disc: a green that the tonemap keeps green.
    let green = vec3f(0.06, 1.0, 0.3) * 3.0;
    sun_colour = mix(sun_colour, green, atmosphere.optics.z * max(limb * 0.6 * sliver, sliver * sliver));
  }
  color = mix(color, sun_colour, disc * above_sea * sky_sample.a * (1.0 - night));
  // A soft aureole around the disc: forward scattering in hazy coastal air.
  color += atmosphere.light.rgb * exp(-sun_distance * 90.0) * 0.12 * above_sea * sky_sample.a * (1.0 - night);
  if (ray.y > -0.001) {
    color += night_sky(ray, night, sky_sample.a * above_sea, dot(sky, vec3f(0.2126, 0.7152, 0.0722)));
  }
  // sky-events: sharp transient lights, each skipped unless it is happening.
  if (atmosphere.bolt.w > 0.0 || atmosphere.meteor.w > 0.0 || atmosphere.trail.w > 0.0 || atmosphere.satellite.w > 0.0) {
    color += sky_events(ray, sky_sample.a * above_sea);
  }
  // Rain streaks, vignette and film grain are one lens pass over both
  // layers, drawn last by the land layer (landscape.js). This keeps only a
  // one-level dither against banding in the sky's gradients.
  let dither = (hash2(floor(uv * atmosphere.resolution)).x - 0.5) / 255.0;
  return vec4f(tonemap(color, night) + dither, 1.0);
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

// sky-events: a lightning bolt (and its smeared reflection in the sea),
// meteors and satellites, at full resolution like the stars.
fn sky_events(ray: vec3f, clear: f32) -> vec3f {
  let pixel = 1.0 / (0.9 * min(atmosphere.resolution.y, 1300.0));
  var light = vec3f(0.0);
  if (atmosphere.bolt.w > 0.0) {
    let foot = normalize(vec3f(atmosphere.bolt.x, 0.0, atmosphere.bolt.z));
    // The channel outshines everything: far past white whatever the exposure.
    let brightness = atmosphere.bolt.w * 60.0 * max(atmosphere.light.w, 0.6);
    if (ray.y >= 0.0) {
      light += lightning_bolt(ray, foot, atmosphere.bolt.y, atmosphere.optics.w, pixel) * brightness;
    } else {
      // The sea's slopes smear its mirror image into a broken, wavering
      // column of glints.
      let mirror = vec3f(ray.x, -ray.y, ray.z);
      let rows = hash2(vec2f(floor(-ray.y * atmosphere.resolution.y * 0.6), 7.0)).x;
      light += lightning_bolt(mirror, foot, atmosphere.bolt.y, atmosphere.optics.w, pixel * 5.0) * brightness
        * 0.03 * (0.25 + rows * rows * 1.5);
    }
  }
  if (ray.y > 0.0) {
    let airmass = 1.0 / max(ray.y, 0.02);
    let extinction = exp(-0.28 * (airmass - 1.0)) * smoothstep(0.0, 0.05, ray.y) * clear;
    if (atmosphere.meteor.w > 0.0 || atmosphere.trail.w > 0.0) {
      light += meteor_light(ray, atmosphere.meteor.xyz, atmosphere.meteor.w, atmosphere.trail.xyz, atmosphere.trail.w,
        atmosphere.streak.x, atmosphere.streak.y, pixel) * extinction;
    }
    if (atmosphere.satellite.w > 0.0) {
      light += satellite_light(ray, atmosphere.satellite.xyz, atmosphere.satellite.w, pixel) * extinction;
    }
  }
  return light;
}

// For the dither and the bolt's broken reflection (rain streaks moved to the
// lens pass, src/lens.js).
fn hash2(p: vec2f) -> vec2f {
  var q = fract(vec3f(p.x, p.y, p.x) * vec3f(0.1031, 0.1030, 0.0973));
  q += dot(q, q.yzx + 33.33);
  return fract((q.xx + q.yz) * q.zy);
}
