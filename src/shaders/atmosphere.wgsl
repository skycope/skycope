// Physically based single scattering for a clear Earth atmosphere: Rayleigh
// (air molecules), Mie (aerosol/sea salt) and ozone absorption over a
// spherical planet. Shared by the sky pass (sky colour, cloud lighting) and the
// water pass (sunlight colour on the sea), so every surface is lit by the same
// sun the sky shows. Units are metres; radiance is relative to a unit-ish sun.

const EARTH_RADIUS: f32 = 6360000.0;
const ATMOSPHERE_RADIUS: f32 = 6420000.0;
const RAYLEIGH: vec3f = vec3f(5.802e-6, 13.558e-6, 33.1e-6);
const RAYLEIGH_HEIGHT: f32 = 8000.0;
// Coastal air carries more sea-salt aerosol than the textbook 3.996e-6. Its
// scattering falls gently with wavelength (Ångström exponent ~0.7 for marine
// aerosol), so the horizon haze is white-blue, not cream.
const MIE: vec3f = vec3f(3.1e-6, 3.6e-6, 4.2e-6);
const MIE_HEIGHT: f32 = 1200.0;
const OZONE: vec3f = vec3f(0.650e-6, 1.881e-6, 0.085e-6);
const SUN_INTENSITY: f32 = 20.0;
const VIEW_HEIGHT: f32 = 30.0;

// Distance from a point at height h (above the surface) along direction d
// (d.y = cosine of the zenith angle) to the top of the atmosphere.
fn atmosphere_exit(h: f32, mu: f32) -> f32 {
  let r = EARTH_RADIUS + h;
  let b = r * mu;
  let c = r * r - ATMOSPHERE_RADIUS * ATMOSPHERE_RADIUS;
  return -b + sqrt(max(b * b - c, 0.0));
}

// Density of each constituent at height h: (rayleigh, mie, ozone).
fn densities(h: f32) -> vec3f {
  let ozone = max(0.0, 1.0 - abs(h - 25000.0) / 15000.0);
  return vec3f(exp(-h / RAYLEIGH_HEIGHT), exp(-h / MIE_HEIGHT), ozone);
}

fn extinction(depth: vec3f) -> vec3f {
  return exp(-(RAYLEIGH * depth.x + MIE * 1.11 * depth.y + OZONE * depth.z));
}

// Transmittance from height h toward a direction with zenith cosine mu.
// A sun below the geometric horizon is smoothly occluded by the planet.
fn transmittance(h: f32, mu: f32) -> vec3f {
  let r = EARTH_RADIUS + h;
  let horizon_mu = -sqrt(max(0.0, 1.0 - (EARTH_RADIUS / r) * (EARTH_RADIUS / r)));
  let length_to_top = atmosphere_exit(h, mu);
  var depth = vec3f(0.0);
  let steps = 6;
  for (var i = 0; i < steps; i++) {
    // Squared spacing: most of the optical depth is in the first kilometres.
    let a = f32(i) / f32(steps);
    let b = f32(i + 1) / f32(steps);
    let t = length_to_top * (a * a + b * b) * 0.5;
    let dt = length_to_top * (b * b - a * a);
    let height = sqrt(r * r + t * t + 2.0 * r * t * mu) - EARTH_RADIUS;
    depth += densities(max(height, 0.0)) * dt;
  }
  return extinction(depth) * smoothstep(horizon_mu - 0.01, horizon_mu + 0.004, mu);
}

// Direct sunlight arriving at the viewer, before exposure.
export fn sun_radiance(sun: vec3f) -> vec3f {
  return transmittance(VIEW_HEIGHT, sun.y) * SUN_INTENSITY;
}

fn rayleigh_phase(mu: f32) -> f32 {
  return 0.0596831 * (1.0 + mu * mu);
}

// Cornette-Shanks: a forward-peaked aerosol lobe with a physical backscatter.
fn mie_phase(mu: f32, g: f32) -> f32 {
  let g2 = g * g;
  return 0.1193662 * (1.0 - g2) * (1.0 + mu * mu)
    / ((2.0 + g2) * pow(max(1.0 + g2 - 2.0 * g * mu, 0.0001), 1.5));
}

// Single-scattered sky radiance along a view ray. Rays below the horizon are
// evaluated at the horizon: the sea covers them, and the horizon colour is
// what distant water fades into.
export fn sky_radiance(view: vec3f, sun: vec3f, samples: i32) -> vec3f {
  let ray = normalize(vec3f(view.x, max(view.y, 0.0015), view.z));
  let mu = dot(ray, sun);
  let path = atmosphere_exit(VIEW_HEIGHT, ray.y);
  let r = EARTH_RADIUS + VIEW_HEIGHT;
  var rayleigh = vec3f(0.0);
  var mie = vec3f(0.0);
  var multiple = vec3f(0.0);
  var depth = vec3f(0.0);
  for (var i = 0; i < samples; i++) {
    let a = f32(i) / f32(samples);
    let b = f32(i + 1) / f32(samples);
    let t = path * (a * a + b * b) * 0.5;
    let dt = path * (b * b - a * a);
    let position = vec3f(0.0, r, 0.0) + ray * t;
    let radius = length(position);
    let height = radius - EARTH_RADIUS;
    let density = densities(max(height, 0.0));
    // Each segment's in-scatter is integrated exactly against its own
    // extinction, (1 - e^-τ) / τ, not weighted by the transmittance at its
    // far end: the coarse horizon segments otherwise lose most of their blue
    // and the horizon turns cream instead of the white-blue of a real sky.
    let seg = density * dt;
    let tau = RAYLEIGH * seg.x + MIE * 1.11 * seg.y + OZONE * seg.z;
    let within = select((1.0 - exp(-tau)) / max(tau, vec3f(1e-6)), vec3f(1.0), tau < vec3f(1e-4));
    let seen = extinction(depth) * within;
    depth += seg;
    let sun_mu = dot(position / radius, sun);
    let light = transmittance(height, sun_mu) * seen;
    rayleigh += light * seg.x;
    mie += light * seg.y;
    // Multiply scattered light arrives as if from a sun a few degrees higher:
    // it keeps the anti-solar twilight sky (Earth shadow, Belt of Venus) lit.
    let lifted = transmittance(height, sun_mu + 0.06) * seen;
    multiple += lifted * (seg.x * RAYLEIGH + seg.y * MIE);
  }
  let single = (rayleigh * RAYLEIGH * rayleigh_phase(mu) + mie * MIE * mie_phase(mu, 0.8)) * SUN_INTENSITY;
  let fill = multiple * SUN_INTENSITY * 0.3;
  return single + fill;
}

// Khronos PBR Neutral, then sRGB encoding, applied once in the final pass:
// linear through the midtones (colours stay true, shadows stay open, as in a
// photograph), with a smooth shoulder so the sun disc and glints roll off
// to white instead of clipping. Every blend before it happens in linear
// light. TONE_GAIN matches the mesh layer's curve in landscape.js.
const TONE_GAIN: f32 = 1.35;
const VIBRANCE: f32 = 0.04;
// `night` 0–1 is the eye's dark adaptation: by moonlight the rods take over,
// colour fades and what is left shifts toward blue-green (their 507 nm
// peak; the Purkinje shift). Keep in step with landscape.js.
export fn tonemap(hdr: vec3f, night: f32) -> vec3f {
  var color = max(hdr * TONE_GAIN, vec3f(0.0));
  // Bright things (the Moon's disc, glints) still reach the cones.
  let scotopic = dot(color, vec3f(0.06, 0.56, 0.38));
  color = mix(color, vec3f(0.72, 0.9, 1.35) * scotopic, night * 0.6 * (1.0 - smoothstep(0.25, 1.5, scotopic)));
  let low = min(color.r, min(color.g, color.b));
  color -= select(0.04, low - 6.25 * low * low, low < 0.08);
  let peak = max(color.r, max(color.g, color.b));
  if (peak >= 0.76) {
    let new_peak = 1.0 - 0.0576 / (peak - 0.52);
    color *= new_peak / peak;
    color = mix(color, vec3f(new_peak), 1.0 - 1.0 / (0.15 * (peak - new_peak) + 1.0));
  }
  // A camera's picture profile: vibrance lifts muted colours and leaves
  // saturated ones be. Off by moonlight. VIBRANCE matches landscape.js.
  let luma = dot(color, vec3f(0.2126, 0.7152, 0.0722));
  let top = max(color.r, max(color.g, color.b));
  let chroma = select(0.0, (top - min(color.r, min(color.g, color.b))) / max(top, 1e-4), top > 1e-4);
  color = max(vec3f(luma) + (color - luma) * (1.0 + VIBRANCE * (1.0 - chroma) * (1.0 - night)), vec3f(0.0));
  let mapped = clamp(color, vec3f(0.0), vec3f(1.0));
  return select(1.055 * pow(mapped, vec3f(1.0 / 2.4)) - 0.055, mapped * 12.92, mapped <= vec3f(0.0031308));
}

export fn to_linear(srgb: vec3f) -> vec3f {
  let color = max(srgb, vec3f(0.0));
  return select(pow((color + 0.055) / 1.055, vec3f(2.4)), color / 12.92, color <= vec3f(0.04045));
}
