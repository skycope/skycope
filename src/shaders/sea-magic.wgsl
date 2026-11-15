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
// Its two tones: where the water burns brightest an electric blue-green
// core; where it glows faintly a deep teal (saturated, so it stays teal
// through the night tonemap's rod-vision greying).
export const TIDEGLOW_CORE: vec3f = vec3f(0.02, 1.0, 0.8);
export const TIDEGLOW_DEEP: vec3f = vec3f(0.0, 0.22, 0.8);
// Warm gold: an oil-lamp's colour (and a filament's, through old glass).
// Lamp gold. The night grade (atmosphere.wgsl tonemap) leaves warm light to
// the cones, so it stays gold against the blue sea.
const LAMP_COLOUR: vec3f = vec3f(1.0, 0.66, 0.26);
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
export fn tideglow(s: SeaPoint, level: f32, night: f32, time: f32, rain: f32, ambient: f32) -> vec3f {
  var light = vec3f(0.0);
  let offshore = max(s.metrics.x, 0.0);
  let cover = s.foam.x;
  if (night > 0.01) {
    // Churned water: the roller, the uprush, the surge round a rock, a
    // whitecap, the swash's front, glowing from within the foam.
    var fire = s.foam.z * (0.4 + 1.1 * cover) + s.foam.y * 0.15;
    // The breaking crest: a running line of light, brightest in knots that
    // peel along it as the break runs down the wave, in a wide soft halo
    // of lit water before and behind it.
    let lip = exp(-s.phase * s.phase * 160.0) * smoothstep(0.12, 0.55, s.breaking);
    let crest_halo = exp(-s.phase * s.phase * 6.0) * smoothstep(0.05, 0.5, s.breaking);
    if (lip + crest_halo > 0.001) {
      let knots = pow(0.5 + 0.5 * sin(s.metrics.w * 0.31 - time * 2.4 + sin(s.metrics.w * 0.07) * 3.0), 6.0);
      fire += lip * (0.35 + 1.2 * knots) + crest_halo * (0.08 + 0.12 * knots);
    }
    // The waterline: light spilling up the wet edge of the beach and into
    // the shallows behind each uprush.
    fire += exp(-abs(s.metrics.x + 0.4) / 1.8) * s.foam.z * 0.6;
    // Rings round every boulder, sent out with each surge and fading as
    // they go; its foot burns, and the water round it glows.
    // (rocks.wgsl knows a waterline only within its 3.2 m REACH.)
    if (s.rock_edge < 3.2) {
      let e = max(s.rock_edge, 0.0);
      // Broken into beads and arcs, as plankton light unevenly.
      let beads = 0.35 + 0.65 * smoothstep(0.25, 0.75, noise2(s.p.xz * 1.7 + vec2f(time * 0.2, 0.0)));
      let ring = pow(0.5 + 0.5 * cos(e * 5.2 - time * 2.6 + noise2(s.p.xz * 0.6) * 2.0), 12.0) * beads;
      let width_ok = 1.0 - smoothstep(0.08, 0.3, s.pixel);
      let fade = 1.0 - smoothstep(1.6, 3.1, e);
      // Only while a surge stirs it (the rock's own foam and bubbles).
      let surge = smoothstep(0.05, 0.5, s.foam.z + s.foam.y);
      fire += (ring * (0.25 + 0.75 * width_ok) * 0.6 * exp(-e * 0.5) + exp(-e * 5.0) * 0.7 + exp(-e * 0.9) * 0.15) * fade * surge;
    }
    // The cat: its collar, its comet of a trail, every paw a flash.
    fire += s.stir * 2.6;
    // Rain: every drop draws a ring of light that spreads and dies.
    if (rain > 0.05 && s.pixel < 0.09) {
      fire += rain_rings(s.p.xz, time, s.pixel, rain) * (1.0 - smoothstep(0.045, 0.09, s.pixel));
    }
    // The bloom drifts in slow patches along the coast: brighter and dimmer
    // stretches of shore, never one even stroke.
    // Blooms are patchy: long stretches of shore stay dark.
    let bloom = smoothstep(0.35, 0.8, noise2(vec2f(s.metrics.w * 0.025 + time * 0.01, s.metrics.x * 0.04)));
    fire *= 0.15 + 0.85 * bloom;
    // The cat is always in a bloom: what it stirs always answers.
    fire += s.stir * 2.6 * (0.85 - 0.85 * bloom);
    // Light from under the surface leaves less at grazing angles.
    let f = fire * level * night * (1.0 - s.fresnel * 0.5);
    // Soft saturation under the tonemap's shoulder, so the brightest water
    // keeps its colour instead of clipping white; the colour deepens with
    // the light: deep blue body, teal, an electric blue-green core.
    let body = 1.0 - exp(-f * 1.1);
    let tint = mix(TIDEGLOW_DEEP, TIDEGLOW_CORE, smoothstep(0.08, 0.8, body));
    light += tint * body * 0.62;
    // Points of light over it (single cells, fish): sparkle that flares
    // and fades, allowed past the ceiling because they are tiny.
    // Single cells flash only in stirred water.
    let stirred = min(s.foam.z + s.foam.y * 0.5 + s.stir, 1.0);
    var sparks = plankton(s.p.xz, time, s.pixel) * stirred * (0.3 + 0.7 * bloom);
    if (s.pixel < 0.12 && offshore > 2.0) {
      sparks += fish_sparks(s.p.xz, time, s.pixel) * smoothstep(1.0, 3.0, s.depth);
    }
    light += mix(TIDEGLOW_CORE, vec3f(0.7, 1.0, 1.0), 0.3) * sparks * level * night * 0.5;
  }
  if (night < 0.99) {
    // By day: turquoise light from within the shallows, and fine sparkle.
    let shallow = (1.0 - smoothstep(0.3, 2.6, s.depth)) * smoothstep(-0.6, 1.5, s.metrics.x) * (1.0 - cover);
    let veins = 0.6 + 0.4 * noise2(s.p.xz * 0.35 + vec2f(time * 0.05, 0.0));
    // A subtle clarity, not a colour of its own.
    var day = vec3f(0.05, 0.6, 0.5) * shallow * 0.07 * veins * ambient;
    day += vec3f(0.75, 1.0, 0.95) * plankton(s.p.xz * 1.7, time * 1.6, s.pixel) * ambient * 0.35 * shallow;
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
  // The beam leaves the lamp ~15 m up and nearly level: it passes over the
  // water at the tower's foot and only its spread meets the sea farther out.
  let falloff = smoothstep(6.0, 40.0, reach) / (1.0 + reach * reach / 6400.0);
  // Faces turned to the lamp (the beam grazes the sea, so this is the swell
  // and chop catching it), foam lit outright.
  let facing = max(dot(s.normal, l), 0.0);
  // Only the faces of the swell turned to the lamp take its light, so the
  // path is ribbed with the waves, never a flat sheet.
  let ribs = pow(facing, 5.0);
  let diffuse = ribs * 0.35 + s.foam.x * 0.3 + 0.0015;
  // Crests mirroring the lamp toward the eye: a tight lobe, sparkled.
  let nh = max(dot(s.normal, h), 0.0);
  let spec = pow(nh, 900.0) * 40.0 + pow(nh, 160.0) * 0.8;
  let sparkle = 0.4 + 1.6 * hash22m(floor(s.p.xz * 3.0) + floor(lamp.w * 40.0)).x;
  let strength = level * (0.25 + 0.75 * night) * 7.0;
  // The broad path saturates softly below the tonemap's shoulder, so it
  // stays gold; the crest glints on top of it are small and may flare.
  let path = falloff * strength * (beam + spill) * diffuse;
  let glints = falloff * strength * beam * spec * sparkle * s.fresnel * 4.0;
  return LAMP_COLOUR * ((1.0 - exp(-path * 14.0)) * 1.05 + min(glints, 3.0) * 0.6);
}

// ---- waking: a gift's kindled light reaching the water (src/waking.js). ----
// A small light over the water: its broken road of glints toward the eye,
// and the faint pool it spreads on faces and foam turned to it. `core`: its
// size (m).
fn point_light_on_sea(s: SeaPoint, at: vec3f, colour: vec3f, core: f32) -> vec3f {
  let to = at - s.p;
  let d2 = dot(to, to);
  let l = to * inverseSqrt(max(d2, 1e-4));
  let h = normalize(l - s.ray);
  let nh = max(dot(s.normal, h), 0.0);
  let cell = hash22m(floor(s.p.xz * 6.0)).x;
  let spec = (pow(nh, 600.0) * (1.5 + 5.0 * cell * cell) + pow(nh, 60.0) * 0.35 + pow(nh, 12.0) * 0.05) * s.fresnel * 4.0;
  let pool = max(dot(s.normal, l), 0.0) * (0.03 + 0.35 * s.foam.x);
  let light = colour * (spec + pool) * (core * core / (d2 + core * core));
  return light / (1.0 + max(light.r, max(light.g, light.b)) * 0.6);
}

// A waking's light on the sea. waking: source x, z (coast metres), how far
// its light has reached on the water (m), the front's glints F.
// light: tint × the lit water's strength (rgb), source height (w).
// Behind the front the water is lit by the point (its glitter road and
// pool); the front itself is crests and foam turned to the source catching
// it, and cells flaring; lit water keeps a few glints as it fades. By day
// the front is the sun's own glitter switched on in a line.
export fn waking_on_sea(s: SeaPoint, waking: vec4f, light: vec4f, time: f32, daylight: f32) -> vec3f {
  let at = vec3f(waking.x, light.w, waking.y);
  let d = length(s.p.xz - at.xz);
  let width = 0.6 + 0.05 * waking.z;
  if (d > waking.z + 3.0 * width) { return vec3f(0.0); }
  let reached = 1.0 - smoothstep(waking.z - width, waking.z, d);
  let peak = max(light.r, max(light.g, light.b));
  let tint = light.rgb / max(peak, 1e-4);
  var out = point_light_on_sea(s, at, light.rgb * 1.5, 2.2) * reached;
  let fb = (d - waking.z) / width;
  let band = exp(-fb * fb) * waking.w;
  let l = normalize(at - s.p);
  let crest = pow(max(dot(s.normal, l), 0.0), 3.0) * 0.5 + s.foam.x * 0.4;
  let scale = max(0.4, s.pixel * 1.5);
  let g = s.p.xz / scale;
  let pace = time * 2.5 + hash22m(floor(g)).y * 9.0;
  let hh = hash22m(floor(g) + floor(pace) * 0.37);
  let spot = 1.0 - smoothstep(0.08, 0.25, length(fract(g) - 0.25 - hh * 0.5));
  let flare = (1.0 - fract(pace)) * (1.0 - fract(pace));
  let glitter = step(0.93, hh.x) * spot * flare;
  out += mix(tint, vec3f(1.0), 0.5 * daylight) * band * (crest + glitter * 2.0) * (0.5 + daylight);
  // (Near the source only: lit water, not a bay of confetti.)
  out += tint * peak * reached * glitter * 0.3 * exp(-d / 10.0);
  return out;
}

// The wave (src/waking.js waveAt) on the sea: a travelling line of the
// gift's light riding the swell. Faces of the swell turned to the source
// catch it, crests and foam flare, it glitters toward the eye, and behind it
// a short tail of single cells sparkles out like plankton. Then a fainter
// echo runs back home. at: the source (coast metres). wave: radius (m),
// tail (m), strength, echo radius; tint: rgb, echo strength (w). By day the
// line is the sun's own glitter switched on.
export fn wave_on_sea(s: SeaPoint, at: vec3f, wave: vec4f, tint: vec4f, time: f32, daylight: f32) -> vec3f {
  let d = length(s.p.xz - at.xz);
  let lead = 1.6 + 0.02 * wave.x;                       // = waveAt().lead
  let wf = d - wave.x;
  let width = 2.5 + 0.02 * wave.w;                       // the echo's half-width
  let ef = d - wave.w;
  let inWave = wave.z > 0.0 && wf < 3.0 * lead && wf > -2.5 * wave.y;
  let inEcho = tint.w > 0.0 && abs(ef) < 3.0 * width;
  if (!(inWave || inEcho)) { return vec3f(0.0); }
  let to = normalize(at - s.p);
  let vv = normalize(to + vec3f(0.0, 0.4, 0.0));
  let face = pow(max(dot(s.normal, vv), 0.0), 3.0);
  let h = normalize(vv - s.ray);
  let nh = max(dot(s.normal, h), 0.0);
  let spec = (pow(nh, 300.0) * 3.0 + pow(nh, 40.0) * 0.3) * s.fresnel * 4.0;
  // Single cells, fixed in place, twinkling slowly (< 0.3 Hz): the tail
  // passing over them is what makes them run.
  let scale = max(0.35, s.pixel * 1.4);
  let g = s.p.xz / scale;
  let hh = hash22m(floor(g));
  let spot = 1.0 - smoothstep(0.06, 0.22, length(fract(g) - 0.2 - hh * 0.6));
  let sparks = step(0.9, hh.x) * spot * (0.6 + 0.4 * sin(time * 1.8 + hh.y * 40.0));
  var out = vec3f(0.0);
  if (inWave) {
    let crest = exp(-wf * wf / (lead * lead));
    let tail = select(0.0, exp(wf / wave.y), wf < 0.0);
    let ahead = select(0.0, crest, wf > 0.0);
    let hue = 0.55 + 0.45 * cos(6.2832 * (wf / (lead * 3.0) + vec3f(0.0, 0.33, 0.67)));
    let peak = max(tint.r, max(tint.g, tint.b));
    let col = mix(mix(tint.rgb, hue * peak, 0.35 * ahead), vec3f(peak), 0.5 * daylight);
    out += col * wave.z * (crest * (face * 0.5 + s.foam.x * 0.6 + spec + sparks * 1.5) + tail * tail * (sparks * 1.2 * tail + face * 0.08));
  }
  if (inEcho) {
    let back = exp(-ef * ef / (width * width));
    out += tint.rgb * tint.w * back * (sparks * 1.5 + spec * 0.5 + face * 0.1);
  }
  return out / (1.0 + max(out.r, max(out.g, out.b)) * 0.4);
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

// ---- boat: the hurricane lantern over the bow (src/boat.js). ------------------
// A warm oil flame a metre over the water: its broken path of glints toward
// the eye (a tight lobe that sparkles where the facets catch it, and a wide
// one that lays a soft gold road across the swell), and the faint pool of
// light it spreads on the surface and the foam round the hull.
export fn lantern_on_sea(s: SeaPoint, lantern: vec4f, night: f32) -> vec3f {
  let to = lantern.xyz - s.p;
  let d2 = dot(to, to);
  if (d2 > 1600.0) { return vec3f(0.0); }
  let l = to * inverseSqrt(d2);
  let h = normalize(l - s.ray);
  let nh = max(dot(s.normal, h), 0.0);
  let glint = hash22m(floor(s.p.xz * 6.0)).x;
  let spec = (pow(nh, 600.0) * (1.5 + 5.0 * glint * glint) + pow(nh, 60.0) * 0.35 + pow(nh, 12.0) * 0.05) * s.fresnel * 4.0;
  let facing = max(dot(s.normal, l), 0.0);
  let pool = facing * (0.03 + 0.35 * s.foam.x);
  let flame = vec3f(1.0, 0.5, 0.16);
  // Falls off with distance like the light it is; a glint never clips.
  let light = flame * lantern.w * (spec + pool) / (1.0 + d2 * 0.3) * (0.4 + 0.6 * night);
  return light / (1.0 + max(light.r, 0.0) * 0.6);
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
