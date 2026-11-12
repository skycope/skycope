// Atmospheric optics and sky events (src/sky-events.js decides when; every
// caller gates on its uniform before calling, so none of this runs while it
// is not happening). Directions are local east / up / north unit vectors.
//
// Soft optics (rainbow, halo, corona, zodiacal light) are evaluated in the
// low-resolution sky resolve (sky.wgsl), so the sea reflects them through
// its usual sky lookup; sharp things (the lightning channel, meteors,
// satellites) in the full-resolution composite (water.wgsl).

const TAU: f32 = 6.283185;

// Ten wavelengths across the visible (nm), and the linear-sRGB weight of
// each: the CIE 1931 2° observer (Wyman, Sloan & Shirley 2013 fit) through
// the XYZ -> sRGB matrix, normalised so the ten sum to white. Spectral
// colours lie outside sRGB, hence the negative lobes; sums are clamped.
const LAMBDA = array<f32, 10>(415.0, 445.0, 475.0, 505.0, 535.0, 565.0, 595.0, 625.0, 655.0, 685.0);
const SPECTRUM = array<vec3f, 10>(
  vec3f(0.0206, -0.0183, 0.1295), vec3f(0.0549, -0.0671, 0.6094),
  vec3f(-0.0519, 0.0336, 0.3509), vec3f(-0.1652, 0.2274, 0.0439),
  vec3f(-0.1664, 0.4478, -0.0461), vec3f(0.1699, 0.3444, -0.0509),
  vec3f(0.5364, 0.0885, -0.0272), vec3f(0.4565, -0.0420, -0.0072),
  vec3f(0.1319, -0.0147, -0.0017), vec3f(0.0134, 0.0005, -0.0004),
);
// Rainbow angles from the antisolar point (degrees) for water,
// n(λ) = 1.3238 + 3141 nm² / λ² (Cauchy fit to 486/589/656 nm): Descartes'
// minimum deviation after one internal reflection (primary, red outside)
// and two (secondary, red inside).
const PRIMARY = array<f32, 10>(40.782, 41.119, 41.396, 41.627, 41.821, 41.985, 42.126, 42.247, 42.352, 42.444);
const SECONDARY = array<f32, 10>(53.232, 52.622, 52.121, 51.704, 51.355, 51.058, 50.805, 50.586, 50.397, 50.232);
// Ice, n(λ) = 1.30148 + 2723 nm² / λ²: minimum deviation through the 60°
// prism of a hexagonal crystal (the 22° halo, red inside), and the index
// itself for the parhelia's skew rays.
const HALO = array<f32, 10>(22.393, 22.237, 22.109, 22.003, 21.915, 21.840, 21.776, 21.722, 21.675, 21.633);
const ICE = array<f32, 10>(1.3173, 1.3152, 1.3135, 1.3122, 1.3110, 1.3100, 1.3092, 1.3085, 1.3078, 1.3073);

// The Airy function Ai(-z): Maclaurin series near the caustic, asymptotic
// forms beyond (both within ~1% of the integral).
fn airy(z: f32) -> f32 {
  if (z < -2.0) {
    let x = -z;
    return exp(-0.6666667 * x * sqrt(x)) * 0.2820948 / sqrt(sqrt(x));
  }
  if (z < 2.6) {
    let x = -z;
    let x3 = x * x * x;
    var tf = 1.0;
    var tg = x;
    var f = 1.0;
    var g = x;
    tf *= x3 / 6.0; tg *= x3 / 12.0; f += tf; g += tg;
    tf *= x3 / 30.0; tg *= x3 / 42.0; f += tf; g += tg;
    tf *= x3 / 72.0; tg *= x3 / 90.0; f += tf; g += tg;
    tf *= x3 / 132.0; tg *= x3 / 156.0; f += tf; g += tg;
    tf *= x3 / 210.0; tg *= x3 / 240.0; f += tf; g += tg;
    return 0.3550281 * f - 0.2588194 * g;
  }
  let zeta = 0.6666667 * z * sqrt(z);
  let p = zeta + 0.7853982;
  return (sin(p) - 0.0694444 / zeta * cos(p)) * 0.5641896 / sqrt(sqrt(z));
}

// Airy's rainbow: intensity Ai²(-z) across the bow, normalised to its peak.
// Inside the bow the supernumerary fringes wash into their mean (the
// geometric 1/sqrt brightening) as drops grow larger and more varied.
fn airy_bow(z: f32, washout: f32) -> f32 {
  let a = airy(z);
  let mean = 0.1591549 / sqrt(max(z, 1.0));
  // Even drizzle has a spread of sizes: only the first two or three
  // fringes survive it, and none with large drops.
  return mix(a * a, mean, smoothstep(mix(5.5, 1.6, washout), mix(10.0, 3.4, washout), z)) * 3.484;
}

// Primary and secondary rainbow, Alexander's dark band between them and the
// supernumeraries inside the primary, opposite `source` (the sun, or the
// Moon for a moonbow). Unit: the source's direct radiance; the caller
// scales by how much sunlit rain there is. `rain` (mm/h) sets the drop size.
export fn rainbow(ray: vec3f, source: vec3f, rain: f32) -> vec3f {
  let theta = degrees(acos(clamp(-dot(ray, source), -1.0, 1.0)));
  if (theta < 24.0 || theta > 62.0) { return vec3f(0.0); }
  // Drizzle has 0.15 mm drops (pale bow, clear supernumeraries); showers
  // ~0.7 mm (vivid, the fringes smeared out by the size spread).
  let radius = mix(0.15, 0.7, smoothstep(0.1, 6.0, rain));
  let washout = smoothstep(0.2, 0.5, radius);
  // Airy's angular unit, (h/12)^(1/3) (ka)^(-2/3): 0.141° for 0.5 mm drops
  // at 600 nm; the secondary's caustic is flatter.
  let unit = 0.141 * pow(radius / 0.5, -0.6667);
  var light = vec3f(0.0);
  for (var i = 0; i < 10; i++) {
    let s = unit * pow(LAMBDA[i] / 600.0, 0.6667);
    var p = 0.0;
    var q = 0.0;
    // The sun's 0.53° disc blurs every band: three taps across it.
    for (var k = -1; k <= 1; k++) {
      let t = theta + f32(k) * 0.17;
      p += airy_bow((PRIMARY[i] - t) / s, washout);
      q += airy_bow((t - SECONDARY[i]) / (s * 1.4), washout);
    }
    // The secondary returns ~43% of the primary's light (two reflections).
    light += SPECTRUM[i] * (p + 0.43 * q);
  }
  let fade = smoothstep(24.0, 36.0, theta) * (1.0 - smoothstep(56.0, 62.0, theta));
  return max(light, vec3f(0.0)) * fade * 0.3333;
}

// The 22° halo and the parhelia (sundogs) of thin cirrostratus: refraction
// through the 60° prisms of hexagonal ice crystals, red on the inside edge
// where minimum deviation cuts the light off, fading outward. Sundogs come
// from horizontally floating plates: at the source's elevation, farther
// out as the sun climbs, gone above ~60°. Unit: the source's radiance.
export fn ice_halo(ray: vec3f, source: vec3f) -> vec3f {
  let theta = degrees(acos(clamp(dot(ray, source), -1.0, 1.0)));
  let elevation = asin(clamp(source.y, -1.0, 1.0));
  let rise = degrees(asin(clamp(ray.y, -1.0, 1.0)) - elevation);
  var turn = atan2(ray.x, ray.z) - atan2(source.x, source.z);
  turn = abs(turn - TAU * round(turn / TAU));
  let away = degrees(turn);
  let ring = theta > 21.0 && theta < 40.0;
  let dogs = abs(rise) < 5.0 && away > 18.0 && away < 70.0 && degrees(elevation) < 58.0;
  if (!ring && !dogs) { return vec3f(0.0); }
  let se = sin(elevation);
  let ce = cos(elevation);
  var light = vec3f(0.0);
  for (var i = 0; i < 10; i++) {
    var amount = 0.0;
    if (ring) {
      let x = theta - HALO[i];
      if (x > 0.0) { amount += exp(-x / 2.4) * (1.0 - exp(-x / 0.35)); }
    }
    if (dogs) {
      // Skew rays through a plate's side faces see an effective index
      // sqrt(n² - sin²e) / cos e (Bravais).
      let n = ICE[i];
      let effective = sqrt(n * n - se * se) / ce;
      let offset = degrees(2.0 * asin(min(effective * 0.5, 1.0))) - 60.0;
      let x = (away - offset) * ce;
      if (x > 0.0) {
        let height = 0.7 + 1.6 * smoothstep(5.0, 40.0, degrees(elevation));
        amount += (exp(-x / 0.9) * (1.0 - exp(-x / 0.12)) * 4.5 + exp(-x / 9.0) * 0.08)
          * exp(-rise * rise / (2.0 * height * height));
      }
    }
    light += SPECTRUM[i] * amount;
  }
  return max(light, vec3f(0.0));
}

fn bessel_j1(x: f32) -> f32 {
  if (x < 3.0) {
    let y = x * x;
    return x * (0.5 + y * (-0.0625 + y * (0.0026042 + y * (-0.0000543 + y * 6.78e-7))));
  }
  let w = x - 2.356194;
  return sqrt(0.6366198 / x) * (cos(w) - 0.375 / x * sin(w));
}

// Corona: moonlight diffracted round the droplets of thin water cloud, a
// bluish aureole hugging the Moon ringed with red-brown, then fainter
// coloured rings. Fraunhofer diffraction, [2 J1(x)/x]² with x = π d θ / λ,
// over three droplet diameters near 14 µm. Unit: the Moon's radiance.
export fn lunar_corona(ray: vec3f, moon: vec3f) -> vec3f {
  let theta = acos(clamp(dot(ray, moon), -1.0, 1.0));
  if (theta > 0.15) { return vec3f(0.0); }
  var light = vec3f(0.0);
  for (var i = 0; i < 10; i++) {
    var amount = 0.0;
    for (var k = 0; k < 3; k++) {
      let diameter = 11.0 + 3.5 * f32(k);
      let x = 3.141593 * diameter * 1000.0 * theta / LAMBDA[i] + 1e-4;
      let a = 2.0 * bessel_j1(x) / x;
      amount += a * a;
    }
    light += SPECTRUM[i] * amount;
  }
  return max(light, vec3f(0.0)) * 0.3333 * (1.0 - smoothstep(0.1, 0.15, theta));
}

// Zodiacal light: sunlight scattered by interplanetary dust in the plane of
// the planets, a cone along the ecliptic that rises from where the sun is
// below the horizon, brightest nearest the sun. `eq` is the ray in J2000
// equatorial coordinates.
export fn zodiacal_light(ray: vec3f, eq: vec3f, sun: vec3f) -> f32 {
  let elongation = acos(clamp(dot(ray, sun), -1.0, 1.0));
  let beta = asin(clamp(dot(eq, vec3f(0.0, -0.3978, 0.9175)), -1.0, 1.0));
  let width = 0.13 + 0.35 * smoothstep(0.6, 2.4, elongation);
  let band = pow(max(elongation, 0.42) / 0.6, -2.3) * exp(-abs(beta) / width);
  // The gegenschein: a faint glow at the antisolar point.
  let anti = 3.141593 - elongation;
  return band + 0.05 * exp(-(anti * anti + beta * beta) / 0.03);
}

// ---------------------------------------------------------------- lightning

fn bolt_hash(x: f32) -> f32 {
  return fract(sin(x * 127.1 + 311.7) * 43758.5453);
}

// Piecewise-linear noise: lightning's channel is a chain of straight steps
// with sharp kinks (the stepped leader), fractal across scales. Returns the
// sideways offset and its slope, in units of the bolt's height.
fn bolt_path(s: f32, seed: f32) -> vec2f {
  var x = 0.0;
  var slope = 0.0;
  var amplitude = 0.14;
  var frequency = 3.0;
  for (var octave = 0; octave < 5; octave++) {
    let p = s * frequency + f32(octave) * 7.31;
    let i = floor(p);
    let a = bolt_hash(i + seed + f32(octave) * 17.3) * 2.0 - 1.0;
    let b = bolt_hash(i + 1.0 + seed + f32(octave) * 17.3) * 2.0 - 1.0;
    x += amplitude * mix(a, b, p - i);
    slope += amplitude * frequency * (b - a);
    amplitude *= 0.5;
    frequency *= 2.2;
  }
  return vec2f(x, slope);
}

// The channel's cross-section: a white core about a pixel wide and a glow
// scattered by the rain around it (the wide glow is the sky pass's flash).
fn bolt_profile(distance: f32, pixel: f32) -> vec2f {
  let d = abs(distance);
  let core = exp(-d * d / (2.0 * pixel * pixel * 0.55));
  let glow = exp(-d * d / (18.0 * pixel * pixel)) * 0.1 + exp(-d * d / (200.0 * pixel * pixel)) * 0.006;
  return vec2f(core, glow);
}

// A cloud-to-ground bolt: from the cloud base (`base`, its elevation in
// radians) down to the horizon toward `foot` (horizontal unit vector), with
// three branches. `pixel` is one pixel's angle (wider for the reflection).
export fn lightning_bolt(ray: vec3f, foot: vec3f, base: f32, shape: f32, pixel: f32) -> vec3f {
  let forward = dot(ray, foot);
  if (forward < 0.6) { return vec3f(0.0); }
  let right = vec3f(foot.z, 0.0, -foot.x);
  let height = tan(base);
  let u = dot(ray, right) / forward / height;
  let s = ray.y / forward / height;
  if (s < -0.01 || s > 1.05 || abs(u) > 0.9) { return vec3f(0.0); }
  let seed = shape * 97.0;
  let px = pixel / height;
  let main = bolt_path(s, seed);
  var profile = bolt_profile((u - main.x) / sqrt(1.0 + main.y * main.y), px);
  for (var b = 0; b < 3; b++) {
    let h = vec3f(bolt_hash(seed + f32(b) * 3.1), bolt_hash(seed + f32(b) * 5.7 + 1.0), bolt_hash(seed + f32(b) * 2.3 + 2.0));
    let start = 0.35 + 0.55 * h.x;
    let reach = 0.12 + 0.3 * h.y;
    let t = start - s;
    if (t > 0.0 && t < reach) {
      let drift = (h.z - 0.5) * 1.8;
      let wander = bolt_path(s * 1.6, seed + 31.0 + f32(b) * 13.0);
      let origin = bolt_path(start, seed).x - 0.4 * bolt_path(start * 1.6, seed + 31.0 + f32(b) * 13.0).x;
      let x = origin + drift * t + 0.4 * wander.x;
      let slope = -drift + 0.64 * wander.y;
      let fade = 1.0 - t / reach;
      profile += bolt_profile((u - x) / sqrt(1.0 + slope * slope), px) * 0.35 * fade * fade;
    }
  }
  // The top vanishes into the cloud base.
  let top = (1.0 - smoothstep(0.82, 1.02, s)) * (1.0 - smoothstep(0.55, 0.9, abs(u)));
  return (vec3f(1.0, 0.98, 1.05) * profile.x + vec3f(0.62, 0.68, 1.0) * profile.y) * top;
}

// ---------------------------------------------------------------- meteors

// A meteor: its head (a point) and the glowing line from `tail` to `head`.
// `flux` is the head's flux relative to magnitude 0, `train` a fireball's
// persistent train along the same line. Same point-source scale as the
// catalog stars (night.wgsl).
export fn meteor_light(ray: vec3f, head: vec3f, flux: f32, tail: vec3f, train: f32, green: f32, fireball: f32, pixel: f32) -> vec3f {
  var light = vec3f(0.0);
  let colour = mix(vec3f(1.0, 0.9, 0.78), vec3f(0.66, 1.0, 0.74), green);
  let axis = cross(tail, head);
  let span = length(axis);
  if (span > 1e-5) {
    let n = axis / span;
    let off = dot(ray, n);
    if (abs(off) < pixel * 16.0) {
      let arc = atan2(span, dot(tail, head));
      let p = ray - n * off;
      let f = atan2(dot(cross(tail, p), n), dot(tail, p)) / arc;
      if (f > -0.01 && f < 1.0) {
        let width = pixel * (0.75 + fireball * 0.15);
        let line = exp(-off * off / (2.0 * width * width));
        // Brightest just behind the head, dying away along the trail.
        light += colour * pow(flux, 0.75) * 3.2 * pow(clamp(f, 0.0, 1.0), 1.8) * line;
        if (train > 0.0) {
          let w = pixel * 2.2;
          let ends = smoothstep(0.0, 0.06, f) * (1.0 - smoothstep(0.94, 1.0, f));
          light += vec3f(0.55, 0.95, 0.62) * train * 22.0 * exp(-off * off / (2.0 * w * w)) * ends;
        }
      }
    }
  }
  if (flux > 0.0) {
    let d = length(ray - head);
    if (d < pixel * 60.0) {
      // The core carries the flux (a fireball burns a few pixels white);
      // the glow round it grows only with the square root.
      let sigma = pixel * 0.8;
      light += colour * (flux * 22.0 * exp(-d * d / (2.0 * sigma * sigma)) / (TAU * 0.64)
        + sqrt(flux) * exp(-d / (pixel * (2.0 + fireball * 2.5))) * 0.35);
    }
  }
  return light;
}

// A sunlit satellite crossing the twilight sky: a steady point of light.
export fn satellite_light(ray: vec3f, direction: vec3f, flux: f32, pixel: f32) -> vec3f {
  let d = length(ray - direction);
  if (d > pixel * 8.0) { return vec3f(0.0); }
  let sigma = pixel * 0.72;
  return vec3f(1.0, 0.97, 0.92) * flux * 22.0 * exp(-d * d / (2.0 * sigma * sigma)) / (TAU * 0.5184);
}
