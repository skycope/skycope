import { Atmosphere, view_ray, view_uv } from "./view.wgsl";
import { to_linear, sun_radiance } from "./atmosphere.wgsl";
import { lut_uv, overcast_sky, volume_noise } from "./skyview.wgsl";
import { equatorial_from_local, galactic_from_equatorial, milky_way } from "./night.wgsl";
import { rainbow, ice_halo, lunar_corona, zodiacal_light } from "./phenomena.wgsl";

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
  // The sea covers everything below the horizon; just under it the far sea
  // fades into this colour, a cloud deck's underside when there is one.
  if (ray.y >= -0.12) { clouds = reconstruct_clouds(floor(position.xy), ray); }
  var out: SkyOutput;
  // The distant archipelago is geometry in the land layer (archipelago.js),
  // drawn over this at full resolution; the sea traces it for reflections.
  var seen = clouds.rgb + sky * clouds.a;
  // sky-events: showers under broken cloud hang as grey curtains of rain
  // from the cloud base (under a full deck the whole sky is the shower).
  var curtain = 0.0;
  if (atmosphere.rain > 0.05 && atmosphere.weather.w < 0.985 && ray.y > -0.03) {
    curtain = rain_curtain(ray);
    let grey = dot(seen, vec3f(0.2126, 0.7152, 0.0722)) * vec3f(0.78, 0.8, 0.84);
    seen = mix(seen, grey, curtain * smoothstep(0.05, 1.5, atmosphere.rain) * 0.55);
  }
  // sky-events: light in front of the clouds. Added to the sky only, never
  // to the cloud history, so a flash cannot ghost into later frames.
  if (ray.y > -0.12 && any(vec4f(atmosphere.events.xyz, atmosphere.optics.x) > vec4f(0.0))) {
    seen += sky_events(ray, clouds.a, night, curtain);
  }
  if (atmosphere.events.w > 0.0 && ray.y > -0.12) {
    seen = sun_shafts(uv, ray, seen, clouds.a);
  }
  out.sky = vec4f(seen, clouds.a);
  out.clouds = clouds;
  return out;
}

// sky-events: crepuscular rays. Hazy air toward a low sun scatters its
// light forward, unless a cloud between it and the sun shades it. Seen
// toward the sun, those shadows are lines radiating from it: here, the
// cloud layer's transmission averaged along the line from each pixel to
// the sun on screen (16 taps of the quarter-resolution layer), lighting
// the haze in the gaps and darkening it in the cloud shadows.
fn sun_shafts(uv: vec2f, ray: vec3f, seen: vec3f, transmission: f32) -> vec3f {
  let mu = dot(ray, atmosphere.sun);
  if (mu < 0.55) { return seen; }
  let sun = view_uv(atmosphere.sun, atmosphere.resolution, atmosphere.pointer, atmosphere.flight.w, atmosphere.pitch);
  let offscreen = max(abs(sun.x - 0.5), abs(sun.y - 0.5)) * 2.0;
  let presence = sun.z * (1.0 - smoothstep(1.0, 1.6, offscreen));
  if (presence <= 0.0) { return seen; }
  // Up to the cloud edges near the sun, not into the glare behind them:
  // when the sun hides behind a cloud the beams leave from its edges.
  let step = (sun.xy - uv) * 0.8 / 16.0;
  var lit = 0.0;
  var weight = 0.0;
  for (var i = 0; i < 16; i++) {
    let p = uv + step * (f32(i) + 0.5);
    // Off screen the cloud layer is unknown: count it neither way.
    if (all(p >= vec2f(0.0)) && all(p <= vec2f(1.0))) {
      lit += textureSampleLevel(cloudLayer, cloudSampler, p, 0.0).a;
      weight += 1.0;
    }
  }
  if (weight < 1.0) { return seen; }
  lit = smoothstep(0.1, 0.75, lit / weight);
  // The aerosol's forward lobe sets how much of the sky is near air's
  // scattered sunlight.
  let forward = pow(max(mu, 0.0), 12.0) + 0.25 * pow(max(mu, 0.0), 3.0);
  let strength = atmosphere.events.w * presence * forward;
  // Shafts show in the air, against sky and haze: over a cloud's own face
  // only the lit beams, not their shadows.
  let shade = 1.0 - strength * (1.0 - lit) * 0.6 * transmission;
  let glow = atmosphere.light.rgb * strength * lit * lit * 0.08 * (0.4 + 0.6 * transmission);
  return seen * shade + glow;
}

// Rain shafts: vertical streaks drifting with the showers, densest near
// the sea, fading up into the cloud base.
fn rain_curtain(ray: vec3f) -> f32 {
  let azimuth = atan2(ray.x, ray.z);
  let drift = atmosphere.time * 0.004;
  let shafts = noise3(vec3f(azimuth * 2.6 + drift, ray.y * 1.4, 4.7)) * 0.65
    + noise3(vec3f(azimuth * 9.0 - drift, ray.y * 2.0, 9.1)) * 0.35;
  return smoothstep(0.34, 0.64, shafts) * (1.0 - smoothstep(0.12, 0.5, ray.y)) * smoothstep(-0.03, 0.0, ray.y);
}

// sky-events: the rainbow in sunlit rain, the lightning flash lighting the
// storm from inside, and the corona in thin cloud round the Moon.
fn sky_events(ray: vec3f, transmission: f32, night: f32, curtain: f32) -> vec3f {
  var light = vec3f(0.0);
  let source = select(atmosphere.moon, atmosphere.sun, atmosphere.sun.y > -0.017);
  if (atmosphere.events.x > 0.0 && ray.y > -0.01) {
    let bow = rainbow(ray, source, atmosphere.rain);
    if (any(bow > vec3f(0.0))) {
      // The bow is wherever sunlit drops are: in the shafts (the rain
      // falling here lights a fainter bow everywhere), fading into the
      // haze at the horizon.
      let horizon = smoothstep(-0.004, 0.025, ray.y);
      let drops = 0.35 + 0.65 * smoothstep(0.0, 0.5, curtain);
      light += bow * atmosphere.light.rgb * (atmosphere.events.x * 0.075 * drops * horizon);
    }
  }
  if (atmosphere.events.z > 0.0 && ray.y > -0.02) {
    // The 22° halo and sundogs, in the thin ice cloud itself: through its
    // thinner parts the halo is crisp, in thicker parts it fades (the
    // gate in sky-events.js keeps lower decks thin).
    let halo = ice_halo(ray, source);
    if (any(halo > vec3f(0.0))) {
      let ice = (0.5 + 0.5 * transmission) * smoothstep(-0.02, 0.06, ray.y);
      light += halo * atmosphere.light.rgb * (atmosphere.events.z * ice * 0.08);
    }
  }
  if (atmosphere.events.y > 0.0) {
    // The flash lights the cloud it is in and spreads through the deck;
    // the cloud's own lumps catch it unevenly.
    let foot = normalize(vec3f(atmosphere.bolt.x, 0.0, atmosphere.bolt.z));
    let lift = atmosphere.bolt.y * 1.5;
    let centre = normalize(foot * cos(lift) + vec3f(0.0, sin(lift), 0.0));
    let apart = acos(clamp(dot(ray, centre), -1.0, 1.0));
    let spread = exp(-apart * apart / 0.12) + 0.3 * exp(-apart / 0.8);
    let seed = atmosphere.optics.w * 37.0;
    let lumps = noise3(ray * 9.0 + seed) * 0.6 + noise3(ray * 23.0 - seed) * 0.4;
    let body = (1.0 - transmission) * (0.35 + 1.3 * smoothstep(0.3, 0.8, lumps));
    // A little lights the rain and air below the cloud too.
    let air = 0.12 * (1.0 - smoothstep(0.0, 0.3, ray.y));
    light += vec3f(0.78, 0.84, 1.0) * atmosphere.events.y * atmosphere.light.w * spread * (body + air);
  }
  if (atmosphere.optics.x > 0.0 && night > 0.3) {
    // Diffraction needs the thin edge of a cloud: none through clear air,
    // none through a thick one.
    let thin = 4.0 * transmission * (1.0 - transmission);
    if (thin > 0.01) {
      // Relative to the Moon's own disc (as water.wgsl draws it): the
      // diffraction peak is enormous, its rings a percent of it.
      let disc = dot(sun_radiance(atmosphere.moon), vec3f(0.2126, 0.7152, 0.0722)) * min(atmosphere.light.w, 0.95);
      light += lunar_corona(ray, atmosphere.moon) * (disc * atmosphere.optics.x * thin * 0.07);
    }
  }
  return light;
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
  // sea-sky-magic: by day the stars gift deepens the zenith a little.
  if (atmosphere.magic.y > 0.0) {
    let up = smoothstep(0.15, 0.9, ray.y) * atmosphere.magic.y * (1.0 - night);
    color *= mix(vec3f(1.0), vec3f(0.74, 0.84, 1.0), up);
  }
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
      var galaxy = milky_way(eq, clump, fine);
      // sea-sky-magic: the stars gift deepens the Milky Way: brighter star
      // clouds, darker lanes between them, a warmer core; the finale more.
      let lean = atmosphere.magic.y + atmosphere.magic.w;
      if (lean > 0.0) {
        let lum = dot(galaxy, vec3f(0.2126, 0.7152, 0.0722));
        let depth = mix(0.7, 1.6, smoothstep(0.35, 0.75, clump * 0.7 + fine * 0.3));
        let warm = mix(vec3f(0.85, 0.9, 1.15), vec3f(1.2, 1.0, 0.8), smoothstep(0.004, 0.02, lum));
        galaxy = mix(galaxy, galaxy * depth * warm * 1.5, min(lean, 1.5) * 0.66);
      }
      color += galaxy * extinction * night;
      color += constellation_lines(ray) * night;
      // sky-events: the zodiacal light, on moonless nights far from twilight.
      if (atmosphere.optics.y > 0.0) {
        color += vec3f(1.0, 0.94, 0.84) * zodiacal_light(ray, eq, sun) * extinction * night * atmosphere.optics.y * 0.2;
      }
    }
  }
  return overcast_sky(color, atmosphere.weather.w, atmosphere.rain);
}

// The constellation figures (atlas channels: see constellationAtlas in
// src/star-catalog.js). Asleep: a faint blue-grey line, as they always were.
// sea-sky-magic, the stars gift: each figure draws itself, a pen of light
// running star to star over a few seconds (figures in turn), the lines
// holding softly after with a shimmer running along them; strongest where
// the camera looks. The finale lights every figure fully.
const FIGURE_LINE: vec3f = vec3f(0.0324, 0.047, 0.0559);
const FIGURE_LIGHT: vec3f = vec3f(0.78, 0.8, 1.0);
fn constellation_lines(ray: vec3f) -> vec3f {
  let latitude = atmosphere.celestial.y;
  let declination = asin(clamp(ray.z * cos(latitude) + ray.y * sin(latitude), -1.0, 1.0));
  let hour_angle = atan2(-ray.x, ray.y * cos(latitude) - ray.z * sin(latitude));
  let ra = atmosphere.celestial.x - hour_angle;
  let coordinates = vec2f(fract(ra / 6.283185), 0.5 - declination / 3.141593);
  let atlas = textureSampleLevel(starAtlas, cloudSampler, coordinates, 0.0);
  let horizon = smoothstep(0.0, 0.10, ray.y);
  var light = to_linear(atlas.r * FIGURE_LINE) * 0.8;
  let gift = max(atmosphere.magic.y, atmosphere.magic.w);
  if (gift > 0.0 && (atlas.r > 0.0 || atlas.a > 0.0)) {
    // Each figure starts in turn over the first seconds, and takes ~4 s.
    let start = 0.6 + atlas.b * 8.0;
    let progress = clamp((atmosphere.magic2.x - start) / 4.0, 0.0, 1.2);
    let ahead = progress - atlas.g;
    let drawn = clamp(ahead * 60.0, 0.0, 1.0);
    // The pen's head: a bright bead with a short glowing wake.
    let pen = exp(-ahead * ahead * 900.0) * select(0.0, 1.0, progress < 1.01) + exp(-max(ahead, 0.0) * 30.0) * drawn * 0.6 * select(0.0, 1.0, progress < 1.1);
    let shimmer = 0.75 + 0.25 * sin(atlas.g * 70.0 - atmosphere.time * 2.2 + atlas.b * 40.0);
    let forward = vec3f(sin(atmosphere.flight.w) * cos(atmosphere.pitch), sin(atmosphere.pitch), cos(atmosphere.flight.w) * cos(atmosphere.pitch));
    let look = 0.45 + 0.55 * smoothstep(0.55, 0.97, dot(ray, forward));
    let hold = (0.05 + 0.07 * atmosphere.magic.w) * shimmer * mix(look, 1.0, atmosphere.magic.w * 0.6);
    let lines = atlas.r * (drawn * hold + pen * 0.9);
    let nodes = atlas.a * drawn * (0.04 + pen * 1.2) * look;
    light = mix(light, FIGURE_LIGHT * (lines + nodes), gift);
  }
  return light * horizon;
}
