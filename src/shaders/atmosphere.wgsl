// Physically based single scattering for a clear Earth atmosphere: Rayleigh
// (air molecules), Mie (aerosol/sea salt) and ozone absorption over a
// spherical planet. Shared by the sky pass (sky colour, cloud lighting) and the
// water pass (sunlight colour on the sea), so every surface is lit by the same
// sun the sky shows. Units are metres; radiance is relative to a unit-ish sun.

const EARTH_RADIUS: f32 = 6360000.0;
const ATMOSPHERE_RADIUS: f32 = 6420000.0;
const RAYLEIGH: vec3f = vec3f(5.802e-6, 13.558e-6, 33.1e-6);
const RAYLEIGH_HEIGHT: f32 = 8000.0;
// Coastal air carries more sea-salt aerosol than the textbook 3.996e-6.
const MIE: f32 = 3.6e-6;
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
    depth += density * dt;
    let sun_mu = dot(position / radius, sun);
    let light = transmittance(height, sun_mu) * extinction(depth);
    rayleigh += light * density.x * dt;
    mie += light * density.y * dt;
    // Multiply scattered light arrives as if from a sun a few degrees higher:
    // it keeps the anti-solar twilight sky (Earth shadow, Belt of Venus) lit.
    let lifted = transmittance(height, sun_mu + 0.06) * extinction(depth);
    multiple += lifted * (density.x * RAYLEIGH + density.y * MIE) * dt;
  }
  let single = (rayleigh * RAYLEIGH * rayleigh_phase(mu) + mie * MIE * mie_phase(mu, 0.8)) * SUN_INTENSITY;
  let fill = multiple * SUN_INTENSITY * 0.3;
  return single + fill;
}

// Filmic shoulder (ACES fit) then sRGB encoding, applied once in the final
// pass: highlights roll off instead of clipping, and every blend before it
// happens in linear light.
export fn tonemap(hdr: vec3f) -> vec3f {
  let x = max(hdr, vec3f(0.0));
  let mapped = clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), vec3f(0.0), vec3f(1.0));
  return select(1.055 * pow(mapped, vec3f(1.0 / 2.4)) - 0.055, mapped * 12.92, mapped <= vec3f(0.0031308));
}

export fn to_linear(srgb: vec3f) -> vec3f {
  return pow(max(srgb, vec3f(0.0)), vec3f(2.2));
}
