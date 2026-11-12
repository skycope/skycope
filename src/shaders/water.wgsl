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
    // sea-sky-magic: the finale's storm of falling stars.
    if (MAGIC_AWAKE && atmosphere.magic.w > 0.0 && night > 0.01 && ray.y > 0.0) {
      color += meteor_storm(ray) * night * sky_sample.a * above_sea * atmosphere.magic.w;
    }
  } else if (MAGIC_AWAKE && atmosphere.magic.y > 0.0 && night > 0.01) {
    // sea-sky-magic: the stars gift on a calm night: bright stars mirrored
    // in the sea as a broken path, each row of swell tilting them aside.
    color += star_path(ray, night, sky_sample.a);
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
    // sea-sky-magic: the stars gift makes the day moon a little more present.
    let moonlight = sun_radiance(atmosphere.moon) * min(atmosphere.light.w, 0.95) * (1.0 + select(0.0, atmosphere.magic.y * 0.6 * (1.0 - night), MAGIC_AWAKE));
    let moon = moon_disc(ray, atmosphere.moon, atmosphere.sun, sidereal, latitude, pixel, 0.019, moonlight);
    light = moon.rgb * moon.a * clear;
    moon_cover = moon.a;
  }
  if (night > 0.001) {
    let eq = equatorial_from_local(ray, sidereal, latitude);
    let airmass = 1.0 / max(ray.y, 0.02);
    let extinction = exp(-0.28 * (airmass - 1.0)) * smoothstep(0.0, 0.05, ray.y);
    let lean = select(0.0, atmosphere.magic.y + atmosphere.magic.w * 0.5, MAGIC_AWAKE);
    var axis_u = vec3f(0.0);
    var axis_v = vec3f(0.0);
    if (lean > 0.0) {
      let heading = vec3f(sin(atmosphere.flight.w), 0.0, cos(atmosphere.flight.w));
      let right = vec3f(heading.z, 0.0, -heading.x);
      let forward = heading * cos(atmosphere.pitch) + vec3f(0.0, sin(atmosphere.pitch), 0.0);
      axis_u = equatorial_from_local(right, sidereal, latitude);
      axis_v = equatorial_from_local(cross(forward, right), sidereal, latitude);
    }
    let stars = catalog_stars(eq, starCatalog, pixel, atmosphere.time, airmass, background, lean, axis_u, axis_v)
      + faint_stars(eq, pixel, background) * (1.0 + lean * 0.5);
    light += stars * extinction * night * clear * (1.0 - moon_cover);
  }
  return light;
}

// sea-sky-magic: the finale. A storm of falling stars from one radiant
// almost overhead, each streaking away from it along its great circle
// (short near it, long far from it): a bright head, a fading green-white
// trail. The sky round the radiant is cut into STORM_SECTORS wedges, each
// dealing three meteors on their own clocks, each kept inside its wedge
// with a margin wider than the line, so a pixel tests only its own wedge
// (three line tests), and only while the finale is awake: ~180 meteors
// round the sky, a dozen or more in any view.
const STORM_SECTORS: f32 = 60.0;
const STORM_RADIANT: vec3f = vec3f(0.17, 0.97, 0.17);
fn meteor_storm(ray: vec3f) -> vec3f {
  let pixel = 1.0 / (0.9 * min(atmosphere.resolution.y, 1300.0));
  let radiant = normalize(STORM_RADIANT);
  let east = normalize(cross(vec3f(0.0, 0.0, 1.0), radiant));
  let north = cross(radiant, east);
  let rho = acos(clamp(dot(ray, radiant), -1.0, 1.0));
  let az = atan2(dot(ray, north), dot(ray, east));
  let airmass = 1.0 / max(ray.y, 0.02);
  let extinction = exp(-0.28 * (airmass - 1.0)) * smoothstep(0.0, 0.06, ray.y);
  let wedge = 6.283185 / STORM_SECTORS;
  let sector = floor(az / wedge);
  let width = pixel * 0.9;
  var light = vec3f(0.0);
  let index = sector;
  {
    for (var layer = 0; layer < 3; layer++) {
      let lane = index * 3.0 + f32(layer) + 200.0;
      let period = 2.2 + fract(lane * 0.618) * 2.4;
      let t = atmosphere.time / period + fract(lane * 0.377);
      let slot = floor(t);
      let age = fract(t);
      let h = hash2(vec2f(slot * 1.7 + lane * 13.1, lane * 3.3));
      let g = hash2(vec2f(slot * 2.9 - lane * 7.7, 41.0 + lane));
      // Not every wedge has one burning at once.
      if (g.y < 0.2) { continue; }
      let phi = (index + 0.2 + 0.6 * h.x) * wedge;
      // Mostly where an eye on the horizon sees them: 20-75° from the radiant.
      let start = 0.35 + h.y * 0.95;
      let span = (0.1 + g.x * 0.28) * sin(min(start + 0.3, 1.5));
      let flight = smoothstep(0.0, 0.3, age);
      let head = start + span * flight;
      let tail = start + span * max(flight - 0.5, 0.0);
      var d_az = az - phi;
      d_az = d_az - 6.283185 * round(d_az / 6.283185);
      let perp = abs(sin(rho) * d_az);
      if (perp > width * 6.0 || rho > head + width * 3.0 || rho < tail - width * 3.0) { continue; }
      let along = clamp((rho - tail) / max(head - tail, 1e-4), 0.0, 1.0);
      let line = exp(-perp * perp / (width * width)) * smoothstep(tail - width, tail + width * 2.0, rho) * (1.0 - smoothstep(head, head + width * 2.0, rho));
      // Burns for ~a third of its period, the train glowing on a little.
      let brightness = (0.4 + 3.0 * (g.y - 0.2) * (g.y - 0.2)) * (1.0 - smoothstep(0.3, 0.6, age)) * smoothstep(0.0, 0.03, age);
      let head_glow = exp(-(perp * perp + (rho - head) * (rho - head)) / (width * width * 2.5)) * 3.0 * (1.0 - smoothstep(0.28, 0.34, age));
      let colour = mix(vec3f(0.75, 1.0, 0.85), vec3f(1.0, 0.95, 0.85), along);
      light += colour * (line * along * along + head_glow) * brightness;
    }
  }
  return light * extinction * 0.9;
}

// sea-sky-magic: the star path. A calm sea mirrors the brightest stars,
// broken by the swell into short wavering dashes, row by row.
fn star_path(ray: vec3f, night: f32, clear: f32) -> vec3f {
  let calm = 1.0 - smoothstep(3.0, 9.0, length(atmosphere.wind));
  if (calm <= 0.0) { return vec3f(0.0); }
  let pixel = 1.0 / (0.9 * min(atmosphere.resolution.y, 1300.0));
  let rows = floor(-ray.y * atmosphere.resolution.y * 0.45);
  let h = hash2(vec2f(rows, floor(atmosphere.time * 3.0 + rows * 0.13)));
  // Each row of swell tilts the mirror a little sideways.
  let tilt = (h.x - 0.5) * (0.004 + 0.06 * -ray.y);
  let c = cos(tilt);
  let s = sin(tilt);
  let mirror = normalize(vec3f(ray.x * c - ray.z * s, -ray.y, ray.x * s + ray.z * c));
  let eq = equatorial_from_local(mirror, atmosphere.celestial.x, atmosphere.celestial.y);
  let airmass = 1.0 / max(mirror.y, 0.02);
  let extinction = exp(-0.28 * (airmass - 1.0)) * smoothstep(0.0, 0.05, mirror.y);
  let stars = catalog_stars(eq, starCatalog, pixel * 2.0, atmosphere.time, airmass, 0.0, 0.0, vec3f(0.0), vec3f(0.0));
  let fresnel = 0.02 + 0.98 * pow(1.0 - min(-ray.y * 1.2, 1.0), 5.0);
  return stars * extinction * fresnel * (0.4 + 2.2 * h.y * h.y) * night * calm * atmosphere.magic.y * 3.0;
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
