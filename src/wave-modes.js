// The wind sea's modes, once per frame on the CPU: 32 per cascade, each a
// wavevector, amplitude and phase at this frame's time, uploaded as one 2 KiB
// storage buffer that waves.wgsl sums per texel. 128 modes are nothing for the
// CPU, and a render pass for them cost more in pass overhead than the work.
//
// Each cascade is a band of a directional wind-wave spectrum on its tile's
// periodic lattice (spectrum.wgsl: 160 m to 2.5 m tiles, wavelengths
// L/4..L/16). Energy: the Cox–Munk mean-square slope, 0.003 + 0.00512 U, is
// spread evenly over log wavenumber (the saturation range) from the
// wind-dependent peak to capillaries; waves longer than the peak are
// suppressed, so a light breeze carries only ripples and a gale builds sea.
// Keep SEA_TILE and bandVariance in step with spectrum.wgsl.
export const SEA_TILE = 160;
export const MODES = 32;
export const CASCADES = 4;

export function bandVariance(wind) {
  const u = Math.max(wind, 3);
  return ((0.003 + 0.00512 * u) / 8.3) * 1.386;
}

// The presentation clock is slowed for swell but less so for ripples, which
// look like syrup when they crawl.
const SPEEDS = [0.22, 0.3, 0.42, 0.58];

// Static per seed and wind; only the phases move with time.
export function createWaveModes(seed) {
  const data = new Float32Array(MODES * CASCADES * 4);
  const omega = new Float64Array(MODES * CASCADES);
  const start = new Float64Array(MODES * CASCADES);
  let key = "";
  return {
    data,
    update(time, wind) {
      const next = `${wind[0].toFixed(2)},${wind[1].toFixed(2)}`;
      if (next !== key) {
        key = next;
        build(seed, wind, data, omega, start);
      }
      for (let i = 0; i < omega.length; i++) {
        const phase = (start[i] - omega[i] * time) % (2 * Math.PI);
        data[i * 4 + 3] = phase < 0 ? phase + 2 * Math.PI : phase;
      }
      return data;
    },
  };
}

function build(seed, wind, data, omega, start) {
  // Even a calm day carries a little developed sea from further out.
  const u = Math.max(Math.hypot(wind[0], wind[1]), 4);
  const windAngle = Math.atan2(wind[1] + 0.01, wind[0] + 0.01);
  // Fetch-limited peak (about twice the fully developed wavenumber).
  const peak = (1.5 * 9.81) / (u * u);
  const variance = bandVariance(u) / MODES;
  for (let c = 0; c < CASCADES; c++) {
    const size = SEA_TILE / 4 ** c;
    for (let i = 0; i < MODES; i++) {
      const r = hash4(i, c, seed % 65536);
      // Stratified in log wavenumber across the band.
      const magnitude = 4 * 4 ** ((i + r[0]) / MODES);
      // Directional spreading around the wind, wider for short waves; a few
      // weaker trains run against it (reflection, older seas).
      const x = r[1] * 2 - 1;
      let angle = windAngle + x * Math.abs(x) * (1.1 + 0.25 * c);
      let weight = 1;
      if (r[2] < 0.14) {
        angle += Math.PI;
        weight = 0.12;
      }
      // Snap to the tile's lattice so the cascade tiles seamlessly.
      const kx = (Math.round(Math.cos(angle) * magnitude) * 2 * Math.PI) / size;
      const kz = (Math.round(Math.sin(angle) * magnitude) * 2 * Math.PI) / size;
      const k = Math.max(Math.hypot(kx, kz), 1e-4);
      const develop = Math.exp(-1.25 * (peak / k) ** 2);
      const index = c * MODES + i;
      data.set([kx, kz, Math.sqrt(2 * variance * weight * develop) / k], index * 4);
      omega[index] = Math.sqrt(9.81 * k) * SPEEDS[c];
      start[index] = r[3] * 2 * Math.PI;
    }
  }
}

// Integer hash (PCG-style) of three unsigned ints to four uniform floats.
function hash4(a, b, c) {
  let x = (Math.imul(a, 1664525) + 1013904223) >>> 0;
  let y = (Math.imul(b, 1013904223) + 1664525) >>> 0;
  let z = (Math.imul(c, 2654435769) + 747796405) >>> 0;
  for (let round = 0; round < 2; round++) {
    x = (x + Math.imul(y, z)) >>> 0;
    y = (y + Math.imul(z, x)) >>> 0;
    z = (z + Math.imul(x, y)) >>> 0;
    if (round === 0) {
      x = (x ^ (x >>> 16)) >>> 0;
      y = (y ^ (y >>> 16)) >>> 0;
      z = (z ^ (z >>> 16)) >>> 0;
    }
  }
  const w = (x ^ y ^ Math.imul(z, 747796405)) >>> 0;
  return [x, y, z, w].map((v) => (v >>> 8) / 16777216);
}
