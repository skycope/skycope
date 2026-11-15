import { Atmosphere, view_ray, view_uv } from "./view.wgsl";
import { to_linear, sun_radiance } from "./atmosphere.wgsl";
import { lut_uv, overcast_sky, volume_noise } from "./skyview.wgsl";
import { equatorial_from_local, galactic_from_equatorial, milky_way } from "./night.wgsl";
import { rainbow, ice_halo, lunar_corona, zodiacal_light } from "./phenomena.wgsl";

// Pass 3 of the sky (1: sky-table.wgsl, 2: clouds.wgsl): at the full sky
// resolution, compose the sky behind the clouds (the table, airglow, ice
// veil, Milky Way, the ending's star and Cross) and rebuild the full-resolution
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
  // A heavy deck is not a blank sheet: the relief of its base, and at a low
  // sun the slot of clear sky under its edge. In the sky the water reads,
  // never in the cloud history.
  if (atmosphere.weather.w > 0.45 && ray.y > -0.02) {
    seen = deck_light(ray, seen, clouds.a, night);
  }
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

// The underside of a heavy deck: rolls and thinner seams in the cloud
// base (a plane ~1 km up, drifting with the wind), darker where it is thick
// and brighter where it thins; and when the sun is low, the band of clear
// sky under the deck's far edge glowing along the horizon, brightest toward
// the sun, ragged where the cloud base dips into it. Two noise taps and
// one table read per sky pixel, only under a heavy deck.
fn deck_light(ray: vec3f, seen: vec3f, transmission: f32, night: f32) -> vec3f {
  let cover = smoothstep(0.45, 0.9, atmosphere.weather.w);
  let up = max(ray.y, 0.0);
  let drift = atmosphere.wind * atmosphere.time * 0.0009;
  let q = ray.xz / (up + 0.06) * 1.6 + drift;
  let rolls = noise3(vec3f(q * vec2f(0.5, 1.1), 1.7)) * 0.6 + noise3(vec3f(q * 2.3 + 3.1, 5.3)) * 0.4;
  // Rolls with soft but definite edges, as stratocumulus has.
  let shaped = smoothstep(0.3, 0.7, rolls);
  let fade = smoothstep(0.01, 0.12, up);
  let relief = (shaped - 0.5) * 0.6 * fade * (1.0 - transmission) * cover;
  var light = seen * (1.0 + relief);
  // The low sun's slot under the deck (and its afterglow just after sunset).
  let sun = atmosphere.sun;
  let low = smoothstep(-0.12, -0.02, sun.y) * (1.0 - smoothstep(0.12, 0.3, sun.y)) * (1.0 - night);
  if (low > 0.0) {
    let flat = normalize(vec2f(ray.x, ray.z) + 1e-5);
    let toward = max(dot(flat, normalize(sun.xz + 1e-5)), 0.0);
    // The deck's ragged lower edge: the same rolls as its base, seen edge on.
    let azimuth = atan2(ray.x, ray.z);
    let ragged = noise3(vec3f(azimuth * 9.0, up * 12.0 + 2.3, atmosphere.time * 0.003)) * 0.6
      + noise3(vec3f(azimuth * 17.0, up * 40.0 + 7.1, atmosphere.time * 0.005)) * 0.4;
    let height = 0.008 + 0.03 * smoothstep(0.2, 0.8, ragged) * (0.4 + 0.6 * toward);
    let slot = exp(-up / height) * smoothstep(-0.006, 0.003, ray.y) * (0.15 + 0.85 * pow(toward, 2.0)) * low * cover;
    let clear = textureSampleLevel(skyTable, cloudSampler, lut_uv(vec3f(ray.x, max(ray.y, 0.004), ray.z)), 0.0).rgb * atmosphere.light.w;
    light = mix(light, clear * (1.2 + 0.8 * toward), min(slot, 1.0) * 0.9);
    // The deck's underside above the slot catches the low light: a warm
    // glow on the cloud base fading up the sky, strongest over the sun.
    let underlit = exp(-up / 0.12) * pow(toward, 3.0) * low * cover * (1.0 - transmission) * (0.6 + 0.8 * shaped * fade);
    light += clear * underlit * 0.35;
  }
  return light;
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
    // diffuse light, dimmed by extinction near the horizon (and, after the
    // ending, the south star).
    if (ray.y > -0.02) {
      let eq = equatorial_from_local(ray, atmosphere.celestial.x, atmosphere.celestial.y);
      // Star clouds are structured at every scale, down to a pixel or two.
      let gal = galactic_from_equatorial(eq) * 9.0;
      let clump = noise3(gal) * 0.4 + noise3(gal * 2.1 + 11.0) * 0.3 + noise3(gal * 4.3 + 3.0) * 0.2
        + noise3(gal * 8.9 + 7.0) * 0.1;
      let fine = noise3(gal * 17.0 + 5.0) * 0.6 + noise3(gal * 37.0 + 1.0) * 0.4;
      let extinction = exp(-0.3 / max(ray.y, 0.02)) * smoothstep(0.0, 0.08, ray.y);
      let galaxy = milky_way(eq, clump, fine);
      color += galaxy * extinction * night;
      // story: the south star and the Cross pointing to it (the ending).
      if (MAGIC_AWAKE && (atmosphere.magic.w > 0.0 || atmosphere.magic2.x > 0.0)) {
        color += the_ending(eq) * night * smoothstep(0.0, 0.05, ray.y);
      }
      // sky-events: the zodiacal light, on moonless nights far from twilight.
      if (atmosphere.optics.y > 0.0) {
        color += vec3f(1.0, 0.94, 0.84) * zodiacal_light(ray, eq, sun) * extinction * night * atmosphere.optics.y * 0.2;
      }
    }
  }
  return overcast_sky(color, atmosphere.weather.w, atmosphere.rain);
}

// story: the ending (story-and-wow.md 5). The fallen star, home: a point
// at the south celestial pole, white and steady, about as bright as the
// Pointers (magic.w), with one soft swell as it arrives (wispColour.w); and
// the pen (magic2.x): 0…1 the Southern Cross draws itself from the atlas
// (its figure only), 1…2 a thin line runs on from its foot along its long
// axis to the star, 2…3 both fade. Directions are the catalogue's frame
// (equatorial unit vectors, as catalog_stars reads them): the pole is
// (0, 0, −1), so its altitude is the latitude's, due south, wherever and
// whenever the sky is drawn. Only inside MAGIC_AWAKE (compiled out until
// the ending) and only while either is non-zero: per sky fragment, two
// dot products and an exp for the star, one atlas sample and a few more
// for the pen while it draws.
// Acrux (α Crucis, the foot) and its right ascension, declination (rad,
// J2000; star-catalog.js CRUX); the Cross's figure id in the atlas (its
// blue channel, star-catalog.js CRUX.atlas).
const ACRUX: vec2f = vec2f(3.2576501, -1.1012871);
const CRUX_FIGURE: f32 = 0.9098039;
const SOUTH_POLE: vec3f = vec3f(0.0, 0.0, -1.0);
const HOME_STAR: vec3f = vec3f(1.0, 0.97, 0.92);
const PEN_LIGHT: vec3f = vec3f(1.0, 0.86, 0.62);
const FIGURE_LIGHT: vec3f = vec3f(0.74, 0.8, 1.0);
fn the_ending(eq: vec3f) -> vec3f {
  let pixel = 1.0 / (0.9 * min(atmosphere.resolution.y, 1300.0));
  var light = vec3f(0.0);
  // The star: a point a pixel or so wide carrying a magnitude-0.6 star's
  // light (as catalog_stars spreads it), a faint scattered halo, a gentle
  // twinkle; the swell a thumbnail of light (0.6°) round it, once.
  let d = length(eq - SOUTH_POLE);
  let star = atmosphere.magic.w;
  if (star > 0.0 && d < 0.05) {
    let sigma = pixel * 0.8;
    let twinkle = 1.0 + 0.08 * sin(atmosphere.time * 11.3) * sin(atmosphere.time * 6.1);
    let core = exp(-(d * d) / (2.0 * sigma * sigma)) * 3.9;
    let halo = exp(-d / (pixel * 3.5)) * 0.05;
    let swell = exp(-d / 0.0105) * atmosphere.wispColour.w * 0.35;
    // A meow (magic2.y, seconds since it) brightens it for a second.
    let called = select(0.0, 1.5 * exp(-atmosphere.magic2.y * 1.6), atmosphere.magic2.y > 0.0);
    light += HOME_STAR * ((core + halo) * twinkle * star * (1.0 + called) + swell);
  }
  let pen = atmosphere.magic2.x;
  if (pen > 0.0) {
    let fade = 1.0 - smoothstep(2.0, 3.0, pen);
    // The Cross, from the atlas: its own figure only, drawn star to star.
    let coordinates = vec2f(fract(atan2(eq.y, eq.x) / 6.283185), 0.5 - asin(clamp(eq.z, -1.0, 1.0)) / 3.141593);
    let atlas = textureSampleLevel(starAtlas, cloudSampler, coordinates, 0.0);
    if (abs(atlas.b - CRUX_FIGURE) < 0.5 / 255.0 && (atlas.r > 0.0 || atlas.a > 0.0)) {
      let ahead = min(pen, 1.0) - atlas.g;
      let drawn = clamp(ahead * 60.0, 0.0, 1.0);
      let head = exp(-ahead * ahead * 900.0) * select(0.0, 1.0, pen < 1.01);
      let thread = smoothstep(0.42, 0.95, atlas.r) + atlas.r * 0.22;
      light += (FIGURE_LIGHT * thread * drawn * 0.05 + PEN_LIGHT * thread * head * 0.12 + PEN_LIGHT * atlas.a * head * 0.2) * fade;
    }
    // The pointer: the great circle from Acrux to the pole, drawn as the
    // pen runs on from the foot (1…2), ending exactly at the star.
    if (pen > 1.0) {
      let a = vec3f(cos(ACRUX.y) * cos(ACRUX.x), cos(ACRUX.y) * sin(ACRUX.x), sin(ACRUX.y));
      let n = normalize(cross(a, SOUTH_POLE));
      let perp = abs(dot(eq, n));
      let width = pixel * 0.9;
      if (perp < width * 6.0) {
        let onto = normalize(eq - n * dot(eq, n));
        let total = acos(clamp(dot(a, SOUTH_POLE), -1.0, 1.0));
        let t = atan2(dot(onto, cross(n, a)), dot(onto, a)) / total;
        let reach = min(pen - 1.0, 1.0);
        let along = smoothstep(-0.01, 0.01, t) * (1.0 - smoothstep(reach - 0.004, reach + 0.004, t));
        let line = exp(-perp * perp / (width * width)) * along;
        let tip = exp(-pow((t - reach) * total / (pixel * 2.0), 2.0)) * select(0.0, 1.0, pen < 2.0) * exp(-perp * perp / (width * width * 4.0));
        light += (PEN_LIGHT * line * 0.035 + PEN_LIGHT * tip * 0.25) * fade;
      }
    }
  }
  return light;
}
