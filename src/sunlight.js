// CPU twin of src/shaders/atmosphere.wgsl. It evaluates the same Rayleigh /
// Mie / ozone model once per frame, so exposure, sun colour and skylight are
// uniforms rather than per-pixel work, and the Three.js lights and fog match
// the sky the WebGPU pass draws. Change both files together.
const EARTH_RADIUS = 6360000;
const ATMOSPHERE_RADIUS = 6420000;
const RAYLEIGH = [5.802e-6, 13.558e-6, 33.1e-6];
const RAYLEIGH_HEIGHT = 8000;
// Marine aerosol, Ångström exponent ~0.7: keep equal to atmosphere.wgsl.
const MIE = [3.1e-6, 3.6e-6, 4.2e-6];
const MIE_HEIGHT = 1200;
const OZONE = [0.65e-6, 1.881e-6, 0.085e-6];
const SUN_INTENSITY = 20;
const VIEW_HEIGHT = 30;
// Unexposed ground illuminance (luminance) under a 40° sun; see lightingAt.
const GROUND_REFERENCE = 14.5;

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
    Math.exp(-(RAYLEIGH[c] * d[0] + MIE[c] * 1.11 * d[1] + OZONE[c] * d[2])),
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
    // Exact in-segment integration, as in atmosphere.wgsl.
    const ex = extinction(depth);
    for (let c = 0; c < 3; c++) depth[c] += d[c] * dt;
    const sunMu = (p[0] * sun[0] + p[1] * sun[1] + p[2] * sun[2]) / radius;
    const tr = transmittance(height, sunMu);
    const lifted = transmittance(height, sunMu + 0.06);
    for (let c = 0; c < 3; c++) {
      const tau = (RAYLEIGH[c] * d[0] + MIE[c] * 1.11 * d[1] + OZONE[c] * d[2]) * dt;
      const within = tau < 1e-4 ? 1 : (1 - Math.exp(-tau)) / tau;
      const light = tr[c] * ex[c] * within;
      rayleigh[c] += light * d[0] * dt;
      mie[c] += light * d[1] * dt;
      multiple[c] += lifted[c] * ex[c] * within * (d[0] * RAYLEIGH[c] + d[1] * MIE[c]) * dt;
    }
  }
  const g = 0.8;
  const rPhase = 0.0596831 * (1 + mu * mu);
  const mPhase =
    (0.1193662 * (1 - g * g) * (1 + mu * mu)) /
    ((2 + g * g) * Math.pow(Math.max(1 + g * g - 2 * g * mu, 0.0001), 1.5));
  return [0, 1, 2].map(
    (c) =>
      (rayleigh[c] * RAYLEIGH[c] * rPhase + mie[c] * MIE[c] * mPhase) *
        SUN_INTENSITY +
      multiple[c] * SUN_INTENSITY * 0.3,
  );
}

const luminance = (c) => c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;

// Moonlight is sunlight at a tiny fraction of its intensity, too dim for
// colour vision: the eye sees only its luminance, cool-tinted (the Purkinje
// shift). Keep MOON_TINT equal to the one in sky.wgsl.
const MOON_TINT = [0.9, 1.01, 1.19];
const scotopic = (c) => MOON_TINT.map((t) => t * luminance(c));

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
  const sun = sunRadiance(celestial.sun);
  // The eye meters the scene, not just the sky: as the sun lowers, the land
  // it lights horizontally dims far faster than the zenith, and the land
  // went murky while the sky held. Partly adapt to the ground's
  // illuminance (sun plus ~π × zenith for the dome) relative to a 40° sun,
  // capped, and hand over to the twilight curve once the sun has set.
  const ground =
    luminance(sun) * Math.max(celestial.sun[1], 0) + Math.PI * 1.9 * luminance(zenith);
  const meter = Math.min(
    1.5,
    Math.pow(Math.max(1, GROUND_REFERENCE / Math.max(ground, 1e-6)), 0.4),
  );
  const adapt = 1 + (meter - 1) * smoothstep(-0.07, 0.03, celestial.sun[1]);
  const exposure = Math.min(cap, Math.max(0.08, (target / Math.max(luminance(zenith), 1e-6)) * adapt));
  const moonK = moonScale(celestial.moon, celestial.moonPhase);
  // Moonlit surfaces a little brighter than the sky ratio alone: the eye
  // adapts to the lit sand, and a full moon throws real shadows.
  const moon = scotopic(sunRadiance(celestial.moon)).map((v) => v * moonK * 0.95);
  const direct = sun.map((v, c) => (v + (moon[c] - v) * night) * exposure);
  const moonSky = scotopic(skyRadiance([0, 1, 0], celestial.moon, 4));
  // Airglow and starlight: the sky pass draws the dome at its floor
  // (0.004, 0.007, 0.014); the land takes 2.5× — the whole dome's worth,
  // seen by a fully dark-adapted eye — so a moonless beach still reads as
  // pale sand and dark scrub under a blue night, not black.
  const sky = zenith.map(
    (v, c) => (v + moonSky[c] * moonK * 0.6) * exposure + [0.01, 0.0175, 0.035][c] * night,
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

// Mean skylight a level surface receives (cosine-weighted over the whole
// dome) relative to the zenith radiance, per channel. The zenith alone
// underestimates it; blending in the horizon toward one heading badly
// overestimates it and tints it with that direction's haze. Exposure cancels,
// so it only needs recomputing when the sun moves.
export function skyIrradianceRatio(sun) {
  const zenith = skyRadiance([0, 1, 0], sun, 5);
  const mean = [0, 0, 0];
  const rings = 4;
  const around = 8;
  for (let i = 0; i < rings; i++) {
    // Equal-area rings in cos²: uniform samples of the cosine-weighted dome.
    const up = Math.sqrt(1 - (i + 0.5) / rings);
    const out = Math.sqrt(1 - up * up);
    for (let j = 0; j < around; j++) {
      const a = ((j + 0.5) / around) * Math.PI * 2;
      const radiance = skyRadiance([out * Math.cos(a), up, out * Math.sin(a)], sun, 5);
      for (let c = 0; c < 3; c++) mean[c] += radiance[c] / (rings * around);
    }
  }
  return mean.map((v, c) => Math.min(4, v / Math.max(zenith[c], 1e-9)));
}

// Horizon colour toward a heading, for fog and distant haze on the land layer.
export function horizonRadiance(celestial, direction, exposure) {
  const h = skyRadiance([direction[0], 0.02, direction[2]], celestial.sun, 8);
  return h.map((v) => v * exposure);
}

// The upper sky dome relative to the zenith radiance, per channel, on an
// equirectangular grid in the Three.js world frame (the land layer's frame:
// x = coast x, z = −coast y, see landscape.js). `width` columns and
// `width / 4` rows cover the sky from the horizon to the zenith, so the land
// layer can light itself from the whole sky (sun side warm, anti-sun blue),
// not one average colour. Exposure cancels: it is only recomputed when the
// sun moves. Returns a Float32Array of rows × width × 3.
export function skyDomeRatio(sun, width = 64) {
  const rows = width / 4;
  const zenith = skyRadiance([0, 1, 0], sun, 5);
  const out = new Float32Array(rows * width * 3);
  for (let j = 0; j < rows; j++) {
    // Rows from the horizon up, at texel centres of a width × width/2 map.
    const elevation = ((j + 0.5) / (rows * 2)) * Math.PI;
    const y = Math.sin(elevation);
    const across = Math.cos(elevation);
    for (let i = 0; i < width; i++) {
      // three's equirect: u = atan(z, x) / 2π + 0.5.
      const phi = ((i + 0.5) / width - 0.5) * Math.PI * 2;
      const wx = Math.cos(phi) * across;
      const wz = Math.sin(phi) * across;
      // World → celestial (east, up, north): the inverse of landscape.js's
      // updateDirection rotation.
      const localZ = -wz;
      const view = [(wx - localZ) * Math.SQRT1_2, y, (wx + localZ) * Math.SQRT1_2];
      const radiance = skyRadiance(view, sun, 5);
      const k = (j * width + i) * 3;
      for (let c = 0; c < 3; c++) out[k + c] = Math.min(12, radiance[c] / Math.max(zenith[c], 1e-9));
    }
  }
  return out;
}

// Cosine and solid-angle weights for an equirectangular upper hemisphere.
// Returns radiance-equivalent irradiance (E / pi), as used by the mesh and
// water Lambertian terms. CIE overcast is normalized to unit E / pi.
export function skyDomeMean(dome, width, uniform = 0) {
  if (!dome) return [1, 1, 1];
  const rows = width / 4;
  const mean = [0, 0, 0];
  let total = 0;
  for (let j = 0; j < rows; j++) {
    const elevation = ((j + 0.5) / (rows * 2)) * Math.PI;
    const weight = Math.sin(elevation) * Math.cos(elevation);
    for (let i = 0; i < width; i++) {
      const k = (j * width + i) * 3;
      for (let c = 0; c < 3; c++) mean[c] += weight * dome[k + c];
      total += weight;
    }
  }
  return mean.map((v) => (v / total) * (1 - uniform) + uniform);
}

// Cache only incident light in unexposed units. Camera position and shadow
// anchors cannot alter the sky dome; quantization bounds weather rebuilds.
export function skyEnvironmentKey(domeKey, uniform, sky, bounce) {
  return `${domeKey}:${uniform.toFixed(2)}:${[...sky, ...bounce].map((v) => v.toPrecision(3)).join()}`;
}
