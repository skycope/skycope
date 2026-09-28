// CPU twin of src/shaders/atmosphere.wgsl. It evaluates the same Rayleigh /
// Mie / ozone model once per frame, so exposure, sun colour and skylight are
// uniforms rather than per-pixel work, and the Three.js lights and fog match
// the sky the WebGPU pass draws. Change both files together.
const EARTH_RADIUS = 6360000;
const ATMOSPHERE_RADIUS = 6420000;
const RAYLEIGH = [5.802e-6, 13.558e-6, 33.1e-6];
const RAYLEIGH_HEIGHT = 8000;
const MIE = 3.6e-6;
const MIE_HEIGHT = 1200;
const OZONE = [0.65e-6, 1.881e-6, 0.085e-6];
const SUN_INTENSITY = 20;
const VIEW_HEIGHT = 30;

function atmosphereExit(h, mu) {
  const r = EARTH_RADIUS + h;
  const b = r * mu;
  const c = r * r - ATMOSPHERE_RADIUS * ATMOSPHERE_RADIUS;
  return -b + Math.sqrt(Math.max(b * b - c, 0));
}

function densities(h) {
  return [
    Math.exp(-h / RAYLEIGH_HEIGHT),
    Math.exp(-h / MIE_HEIGHT),
    Math.max(0, 1 - Math.abs(h - 25000) / 15000),
  ];
}

function extinction(d) {
  return [0, 1, 2].map((c) =>
    Math.exp(-(RAYLEIGH[c] * d[0] + MIE * 1.11 * d[1] + OZONE[c] * d[2])),
  );
}

function smoothstep(a, b, x) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function transmittance(h, mu) {
  const r = EARTH_RADIUS + h;
  const horizonMu = -Math.sqrt(
    Math.max(0, 1 - (EARTH_RADIUS / r) * (EARTH_RADIUS / r)),
  );
  const top = atmosphereExit(h, mu);
  const depth = [0, 0, 0];
  const steps = 6;
  for (let i = 0; i < steps; i++) {
    const a = i / steps;
    const b = (i + 1) / steps;
    const t = (top * (a * a + b * b)) / 2;
    const dt = top * (b * b - a * a);
    const height = Math.sqrt(r * r + t * t + 2 * r * t * mu) - EARTH_RADIUS;
    const d = densities(Math.max(height, 0));
    for (let c = 0; c < 3; c++) depth[c] += d[c] * dt;
  }
  const occlusion = smoothstep(horizonMu - 0.01, horizonMu + 0.004, mu);
  return extinction(depth).map((v) => v * occlusion);
}

export function sunRadiance(sun) {
  return transmittance(VIEW_HEIGHT, sun[1]).map((v) => v * SUN_INTENSITY);
}

// Single scattering plus the same cheap multiple-scattering fill as the shader.
export function skyRadiance(view, sun, samples = 12) {
  const len = Math.hypot(view[0], Math.max(view[1], 0.0015), view[2]);
  const ray = [view[0] / len, Math.max(view[1], 0.0015) / len, view[2] / len];
  const mu = ray[0] * sun[0] + ray[1] * sun[1] + ray[2] * sun[2];
  const path = atmosphereExit(VIEW_HEIGHT, ray[1]);
  const r = EARTH_RADIUS + VIEW_HEIGHT;
  const rayleigh = [0, 0, 0];
  const mie = [0, 0, 0];
  const multiple = [0, 0, 0];
  const depth = [0, 0, 0];
  for (let i = 0; i < samples; i++) {
    const a = i / samples;
    const b = (i + 1) / samples;
    const t = (path * (a * a + b * b)) / 2;
    const dt = path * (b * b - a * a);
    const p = [ray[0] * t, r + ray[1] * t, ray[2] * t];
    const radius = Math.hypot(p[0], p[1], p[2]);
    const height = radius - EARTH_RADIUS;
    const d = densities(Math.max(height, 0));
    for (let c = 0; c < 3; c++) depth[c] += d[c] * dt;
    const sunMu = (p[0] * sun[0] + p[1] * sun[1] + p[2] * sun[2]) / radius;
    const tr = transmittance(height, sunMu);
    const ex = extinction(depth);
    const lifted = transmittance(height, sunMu + 0.06);
    for (let c = 0; c < 3; c++) {
      const light = tr[c] * ex[c];
      rayleigh[c] += light * d[0] * dt;
      mie[c] += light * d[1] * dt;
      multiple[c] += lifted[c] * ex[c] * (d[0] * RAYLEIGH[c] + d[1] * MIE) * dt;
    }
  }
  const g = 0.8;
  const rPhase = 0.0596831 * (1 + mu * mu);
  const mPhase =
    (0.1193662 * (1 - g * g) * (1 + mu * mu)) /
    ((2 + g * g) * Math.pow(Math.max(1 + g * g - 2 * g * mu, 0.0001), 1.5));
  return [0, 1, 2].map(
    (c) =>
      (rayleigh[c] * RAYLEIGH[c] * rPhase + mie[c] * MIE * mPhase) *
        SUN_INTENSITY +
      multiple[c] * SUN_INTENSITY * 0.3,
  );
}

const luminance = (c) => c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;

// Moonlight: sunlight scaled by phase, lifted so a moonlit scene is readable.
function moonScale(moon, phase) {
  const lit = 0.5 - 0.5 * Math.cos(phase * Math.PI * 2);
  return 0.003 * lit * smoothstep(-0.02, 0.05, moon[1]);
}

// Everything the renderers need about light this frame, in exposed linear units.
// Weather shapes the skylight: a cloud deck turns the blue zenith into grey
// diffuse light, and rain thickens it into gloom. The direct sun stays
// unattenuated here (clouds' sunlit sides need it); each surface applies the
// cloud cover to its own direct term.
export function lightingAt(celestial, weather = null) {
  const night = smoothstep(1, 2, celestial.scene);
  const zenith = skyRadiance([0, 1, 0], celestial.sun, 5);
  // Adapt like an eye: hold the zenith steady through the golden hour, then
  // let the sky genuinely darken through civil twilight into night.
  const target =
    0.13 *
    (1 - 0.85 * smoothstep(0, -0.105, celestial.sun[1])) *
    (1 - 0.8 * smoothstep(-0.08, -0.2, celestial.sun[1]));
  // Dark adaptation is limited: deep twilight gets darker, not re-amplified.
  const cap = 1 + 7 * smoothstep(-0.05, -0.21, celestial.sun[1]);
  const exposure = Math.min(cap, Math.max(0.08, target / Math.max(luminance(zenith), 1e-6)));
  const moonK = moonScale(celestial.moon, celestial.moonPhase);
  const sun = sunRadiance(celestial.sun);
  const moon = sunRadiance(celestial.moon).map((v) => v * moonK * 0.6);
  const direct = sun.map((v, c) => (v + (moon[c] - v) * night) * exposure);
  const moonSky = skyRadiance([0, 1, 0], celestial.moon, 4);
  const sky = zenith.map(
    (v, c) => (v + moonSky[c] * moonK * 0.6) * exposure + [0.004, 0.007, 0.014][c] * night,
  );
  const cover = weather?.cover ?? 0;
  const rain = weather?.rain ?? 0;
  const gloom = 1 - 0.45 * smoothstep(0.3, 8, rain) - 0.12 * smoothstep(0.6, 1, cover);
  const grey = luminance(sky);
  const overcastSky = sky.map(
    (v, c) => (v + (grey * [0.96, 0.99, 1.05][c] - v) * Math.min(1, cover * 0.85)) * gloom,
  );
  return { exposure, direct, sky: overcastSky, night, gloom, cover };
}

// Horizon colour toward a heading, for fog and distant haze on the land layer.
export function horizonRadiance(celestial, direction, exposure) {
  const h = skyRadiance([direction[0], 0.02, direction[2]], celestial.sun, 8);
  return h.map((v) => v * exposure);
}
