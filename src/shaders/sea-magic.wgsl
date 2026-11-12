// sea-sky-magic: what the island's awakened gifts do to the sea (called from
// ocean.wgsl at its marked hooks). Everything here is gated by the caller on
// its Atmosphere field (src/sea-sky-magic.js): asleep, none of it runs.
// Coast metres, linear light in the sky pass's exposed units.
//
// Constants other layers may mirror:
//   TIDEGLOW_COLOUR  the tideglow's cold fire (= TIDEGLOW.colour in
//                    src/sea-sky-magic.js, for the wet sand on the land).
//   LAMP_BEAM_SIGMA  the beam's half-width on the sea, radians.

export const TIDEGLOW_COLOUR: vec3f = vec3f(0.08, 0.62, 1.0);
const LAMP_COLOUR: vec3f = vec3f(1.0, 0.86, 0.62);
export const LAMP_BEAM_SIGMA: f32 = 0.07;
const ISLAND_CENTRE: vec2f = vec2f(58.0, 70.0);
const PI: f32 = 3.141593;

// What the sea knows at the point, for the gifts.
export struct SeaPoint {
  p: vec3f,
  // shore_metrics: offshore metres (x), radial unit (yz), arc metres (w).
  metrics: vec4f,
  ray: vec3f,
  normal: vec3f,
  // The breaking train: crest phase and how depth-limited it is.
  phase: f32,
  breaking: f32,
  height: f32,
  // surf_foam: coverage, bubbles, agitation.
  foam: vec3f,
  // Metres to the nearest boulder waterline (large when none).
  rock_edge: f32,
  // The cat's stir: its collar, trail and paw ripples (0…~1).
  stir: f32,
  pixel: f32,
  depth: f32,
  fresnel: f32,
};

// ---- Tideglow (the wreck's gift). -------------------------------------------
// The sea keeps light. At night everything that stirs the water writes in
// cold fire: each breaking roller a running line, the swash a lace, rings
// round every boulder, the cat's wake a comet, rain a field of glowing rings,
// fish darting sparks under the surface, and over the whole bay single cells
// twinkling as the swell lifts them. By day: a turquoise inner glow in the
// shallows and a little extra sparkle. `ambient` is the light the water
// column already receives (for the day glow's scale).
export fn tideglow(s: SeaPoint, level: f32, finale: f32, night: f32, time: f32, rain: f32, ambient: f32) -> vec3f {
  var light = vec3f(0.0);
  let offshore = max(s.metrics.x, 0.0);
  let cover = s.foam.x;
  if (night > 0.01) {
    // Churned water: the roller, the uprush, the surge round a rock, a
    // whitecap, the swash's front, glowing from within the foam.
    var fire = s.foam.z * (0.35 + 1.1 * cover) + s.foam.y * 0.45 + cover * 0.12;
    // The breaking crest's lip: a running line of light, brightest in knots
    // that peel along it as the break runs down the wave.
    let lip = exp(-s.phase * s.phase * 160.0) * smoothstep(0.12, 0.55, s.breaking);
    if (lip > 0.001) {
      let knots = pow(0.5 + 0.5 * sin(s.metrics.w * 0.31 - time * 2.4 + sin(s.metrics.w * 0.07) * 3.0), 6.0);
      fire += lip * (0.45 + 2.2 * knots);
    }
    // Rings round every boulder, sent out with each surge and fading as
    // they go; its contact line burns.
    // (rocks.wgsl knows a waterline only within its 3.2 m REACH.)
    if (s.rock_edge < 3.2) {
      let e = max(s.rock_edge, 0.0);
      let ring = pow(0.5 + 0.5 * cos(e * 5.2 - time * 2.6), 12.0);
      let width_ok = 1.0 - smoothstep(0.08, 0.3, s.pixel);
      let fade = 1.0 - smoothstep(1.6, 3.1, e);
      fire += (ring * (0.25 + 0.75 * width_ok) * 1.1 * exp(-e * 0.5) + exp(-e * 6.0) * 0.9) * fade * smoothstep(0.0, 0.08, e);
    }
    // The cat: its collar, its comet of a trail, every paw a flash.
    fire += s.stir * 2.6;
    // Rain: every drop draws a ring of light that spreads and dies.
    if (rain > 0.05 && s.pixel < 0.09) {
      fire += rain_rings(s.p.xz, time, s.pixel, rain) * (1.0 - smoothstep(0.045, 0.09, s.pixel));
    }
    // The bay itself: single cells flashing as the swell lifts and drops
    // them, a starfield on the water that thickens toward the surf.
    let lift = smoothstep(-0.05, 0.25, s.height) + 0.3;
    let bloom = smoothstep(0.3, 0.8, noise2(s.p.xz * 0.06 + vec2f(time * 0.004, 1.3)));
    fire += plankton(s.p.xz, time, s.pixel) * lift * (0.3 + 1.2 * exp(-offshore / 25.0)) * (0.25 + 0.75 * bloom);
    // Fish under the surface: darting sparks, dimmed by the water above.
    if (s.pixel < 0.12 && offshore > 2.0) {
      fire += fish_sparks(s.p.xz, time, s.pixel) * smoothstep(1.0, 3.0, s.depth);
    }
    // A faint steady glow over the shallows, as though the bay held light.
    fire += 0.02 * exp(-offshore / 18.0) + 0.004;
    // The finale: slow spirals of light turning round the island.
    if (finale > 0.0) {
      fire += spirals(s.p.xz, time) * finale;
    }
    // Light from under the surface leaves less at grazing angles.
    light += TIDEGLOW_COLOUR * fire * level * night * (1.0 - s.fresnel * 0.5) * 0.85;
  }
  if (night < 0.99) {
    // By day: turquoise light from within the shallows, and fine sparkle.
    let shallow = (1.0 - smoothstep(0.3, 2.6, s.depth)) * smoothstep(-0.6, 1.5, s.metrics.x) * (1.0 - cover);
    let veins = 0.6 + 0.4 * noise2(s.p.xz * 0.35 + vec2f(time * 0.05, 0.0));
    var day = vec3f(0.05, 0.6, 0.5) * shallow * 0.32 * veins * ambient;
    day += vec3f(0.75, 1.0, 0.95) * plankton(s.p.xz * 1.7, time * 1.6, s.pixel) * ambient * 2.2 * (0.3 + shallow);
    light += day * level * (1.0 - night);
  }
  return light;
}

// Raindrops on the sea: two layers of cells, each with a drop landing at a
// random time in every period; its ring spreads at ~0.3 m/s and fades.
fn rain_rings(q: vec2f, time: f32, pixel: f32, rain: f32) -> f32 {
  var total = 0.0;
  var scale = 0.55;
  let density = smoothstep(0.1, 4.0, rain);
  for (var layer = 0; layer < 2; layer++) {
    let g = q / scale + f32(layer) * 13.7;
    let cell = floor(g);
    let h = hash22m(cell + f32(layer) * 29.0);
    let period = 0.9 + h.x * 0.8;
    let t = time / period + h.y;
    let epoch = floor(t);
    let age = fract(t);
    let r = hash22m(cell * 1.31 + epoch * 0.73);
    if (r.x < density * 0.85) {
      let centre = (vec2f(0.3) + r * 0.4) ;
      let d = length(fract(g) - centre) * scale;
      let radius = age * 0.17 * scale / 0.55;
      let width = max(pixel * 0.8, 0.008);
      let ring = exp(-pow((d - radius) / width, 2.0)) * (1.0 - age) * (1.0 - age);
      let splash = exp(-d * d / 0.0004) * (1.0 - smoothstep(0.0, 0.1, age)) * 3.0;
      total += ring * 1.6 + splash;
    }
    scale *= 0.61;
  }
  return total;
}

// Single cells flashing on the water: sparse points that light and fade.
fn plankton(q: vec2f, time: f32, pixel: f32) -> f32 {
  let scale = max(0.35, pixel * 1.4);
  let g = q / scale;
  let cell = floor(g);
  let h = hash22m(cell);
  let epoch = floor(time * (0.6 + h.x) + h.y * 5.0);
  let r = hash22m(cell * 0.71 + epoch * 1.37);
  let flash = 1.0 - fract(time * (0.6 + h.x) + h.y * 5.0);
  let spot = 1.0 - smoothstep(0.05, 0.22, length(fract(g) - 0.2 - r * 0.6));
  let lit = step(0.95, r.x) * spot * flash * flash * 3.0;
  // Where a cell is smaller than the pixel its flashes average into a glow.
  let blend = smoothstep(0.35, 1.2, pixel);
  return mix(lit, 0.012, blend);
}

// Fish: a few per 4 m cell, each darting in short bursts and resting, a
// spark with a short tail.
fn fish_sparks(q: vec2f, time: f32, pixel: f32) -> f32 {
  let scale = 4.0;
  let cell = floor(q / scale);
  let h = hash22m(cell + 71.0);
  if (h.x > 0.45) { return 0.0; }
  let pace = time * (0.5 + h.y * 0.4) + h.x * 11.0;
  let leg = floor(pace);
  let f = fract(pace);
  let dart = smoothstep(0.0, 0.25, f);
  let a = hash22m(cell + leg * 3.1);
  let b = hash22m(cell + (leg + 1.0) * 3.1);
  let start = (cell + 0.15 + a * 0.7) * scale;
  let to = (cell + 0.15 + b * 0.7) * scale;
  let at = mix(start, to, dart);
  let heading = normalize(to - start + 1e-4);
  let rel = q - at;
  let along = dot(rel, heading);
  let across = rel.x * heading.y - rel.y * heading.x;
  let blur = max(pixel, 0.03);
  // Brightest as it darts; a tail behind.
  let moving = 1.0 - smoothstep(0.2, 0.45, f);
  let head = exp(-dot(rel, rel) / (blur * blur * 4.0 + 0.004));
  let tail = exp(-across * across / (blur * blur * 2.0 + 0.002)) * smoothstep(-0.9 * moving - 0.01, 0.0, along) * (1.0 - smoothstep(-0.02, 0.0, along)) * step(along, 0.0);
  return (head * (0.6 + 1.6 * moving) + tail * 0.8 * moving) * 1.4;
}

// Slow spiral arms of light turning round the island (the finale).
fn spirals(q: vec2f, time: f32) -> f32 {
  let d = q - ISLAND_CENTRE;
  let r = max(length(d), 1.0);
  let theta = atan2(d.y, d.x);
  let arm = 0.5 + 0.5 * sin(theta * 3.0 - log(r) * 9.0 + time * 0.22);
  let ripple = 0.5 + 0.5 * sin(theta * 13.0 - log(r) * 31.0 + time * 0.5);
  return pow(arm, 3.0) * (0.45 + 0.55 * ripple) * smoothstep(64.0, 80.0, r) * 0.9;
}

// ---- The lamp (the lighthouse's gift). --------------------------------------
// Two opposed beams sweep round once in 12 s (places.js): where one crosses
// the sea it lights a path across the swell, wave faces turned to it catch
// it, foam flares, and crests that mirror it toward the eye glint.
export fn lamp_on_sea(s: SeaPoint, lamp: vec4f, level: f32, night: f32) -> vec3f {
  let to_lamp = lamp.xyz - s.p;
  let flat = s.p.xz - lamp.xz;
  let reach = length(flat);
  if (reach < 1.0) { return vec3f(0.0); }
  let bearing = vec2f(cos(lamp.w), -sin(lamp.w));
  let dir = flat / reach;
  // Both beams: the sine of the angle off either one's axis.
  let off = dir.x * bearing.y - dir.y * bearing.x;
  // The beam spreads like the land's quads (~0.075 rad), a little more on
  // the water so its path reads.
  let beam = exp(-off * off / (LAMP_BEAM_SIGMA * LAMP_BEAM_SIGMA));
  // Its spill: light scattered off the beam's edges sweeps a broad, soft
  // fan across the swell with it.
  let spill = exp(-off * off / 0.03) * 0.22;
  if (beam + spill < 0.002) { return vec3f(0.0); }
  let l = normalize(to_lamp);
  let v = -s.ray;
  let h = normalize(l + v);
  let falloff = 1.0 / (1.0 + reach * reach / 6400.0);
  // Faces turned to the lamp (the beam grazes the sea, so this is the swell
  // and chop catching it), foam lit outright.
  let facing = max(dot(s.normal, l), 0.0);
  let diffuse = pow(facing, 2.0) * 0.25 + s.foam.x * 0.9 + 0.005;
  // Crests mirroring the lamp toward the eye: a tight lobe, sparkled.
  let nh = max(dot(s.normal, h), 0.0);
  let spec = pow(nh, 900.0) * 30.0 + pow(nh, 120.0) * 1.2;
  let sparkle = 0.4 + 1.6 * hash22m(floor(s.p.xz * 3.0) + floor(lamp.w * 40.0)).x;
  let strength = level * (0.25 + 0.75 * night) * 16.0;
  return LAMP_COLOUR * falloff * strength * ((beam + spill) * diffuse + beam * spec * sparkle * s.fresnel * 4.0);
}

// ---- The pulse: a waking's wave of light running out across the sea. -------
// A ring of glow and glitter racing outward from the keepsake's shore, its
// wake a fading wash of the gift's colour. `brightness` lifts it to read by
// day (the sky's own luminance).
export fn pulse_on_sea(s: SeaPoint, pulse: vec4f, colour: vec4f, time: f32, brightness: f32) -> vec3f {
  let d = length(s.p.xz - pulse.xy);
  let behind = pulse.z - d;
  if (behind < -12.0 || behind > 60.0) { return vec3f(0.0); }
  let width = 1.6 + s.pixel * 2.0;
  // A bright leading edge, a second fainter ring just behind it, and the
  // wash of light it leaves.
  let ring = exp(-behind * behind / (width * width));
  let echo = exp(-pow(behind - 6.0, 2.0) / (width * width * 2.0)) * 0.35;
  let wake = select(0.0, exp(-behind / 16.0) * 0.18, behind > 0.0);
  // Glitter: sparks on the swell inside the ring, re-rolled many times a second.
  let scale = max(0.4, s.pixel * 1.5);
  let g = s.p.xz / scale;
  let h = hash22m(floor(g) + floor(time * 12.0) * 0.37);
  let spot = 1.0 - smoothstep(0.08, 0.25, length(fract(g) - 0.25 - h * 0.5));
  let glitter = step(0.82, h.x) * spot * (ring + echo) * 6.0;
  let crest = smoothstep(-0.05, 0.2, s.height) * 0.6 + 0.4;
  return colour.rgb * pulse.w * brightness * ((ring * 3.0 + echo + wake) * crest + glitter);
}

// ---- The wisp: the guiding light's reflection and pool on the water. --------
export fn wisp_on_sea(s: SeaPoint, wisp: vec4f, colour: vec3f) -> vec3f {
  let to = wisp.xyz - s.p;
  let d2 = dot(to, to);
  if (d2 > 900.0) { return vec3f(0.0); }
  let l = to * inverseSqrt(d2);
  let h = normalize(l - s.ray);
  let nh = max(dot(s.normal, h), 0.0);
  let spec = (pow(nh, 400.0) * 12.0 + pow(nh, 40.0) * 0.4) * s.fresnel * 4.0;
  let pool = max(dot(s.normal, l), 0.0) * 0.05;
  return colour * wisp.w * (spec + pool) / (1.0 + d2 * 0.08);
}

fn noise2(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash22m(i).x, hash22m(i + vec2f(1.0, 0.0)).x, u.x),
    mix(hash22m(i + vec2f(0.0, 1.0)).x, hash22m(i + vec2f(1.0, 1.0)).x, u.x), u.y);
}

fn hash22m(p: vec2f) -> vec2f {
  var q = fract(vec3f(p.x, p.y, p.x) * vec3f(0.1031, 0.1030, 0.0973));
  q += dot(q, q.yzx + 33.33);
  return fract((q.xx + q.yz) * q.zy);
}
