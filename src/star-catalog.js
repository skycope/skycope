// Packs the star catalog for the composite pass. No JSON import or DOM here,
// so the offline renderer (scripts/render-sky.mjs) shares it with the site.

// The catalog as an equirectangular grid of cells (0.35° each), one star per
// cell: its exact offset within the cell, flux relative to magnitude 0 and
// B-V colour index. The composite pass draws each as a pixel-sharp point
// source at its true position instead of sampling painted, filtered dots.
// Where two stars share a cell, the fainter moves to an empty neighbour and
// keeps its true position through an offset outside 0-1 (the shader searches
// neighbouring cells anyway), so close pairs survive.
export const CATALOG_SIZE = [1024, 512];

export function starCatalogCells(list, [width, height] = CATALOG_SIZE) {
  const cells = new Float32Array(width * height * 4);
  const stars = list
    .map(([ra, dec, magnitude, colorIndex]) => ({
      x: ((((ra % 360) + 360) % 360) / 360) * width,
      y: Math.min(height - 1e-4, Math.max(0, (0.5 - dec / 180) * height)),
      flux: Math.pow(10, -0.4 * magnitude),
      colour: Number(colorIndex) || 0.6,
    }))
    .sort((a, b) => b.flux - a.flux);
  for (const star of stars) {
    const cx = Math.floor(star.x);
    const cy = Math.floor(star.y);
    for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = (cx + dx + width) % width;
      const y = cy + dy;
      if (y < 0 || y >= height) continue;
      const i = (y * width + x) * 4;
      if (cells[i + 2] > 0) continue;
      cells[i] = star.x - (cx + dx);
      cells[i + 1] = star.y - y;
      cells[i + 2] = star.flux;
      cells[i + 3] = star.colour;
      break;
    }
  }
  return cells;
}

export function halfFloats(values) {
  const half = new Uint16Array(values.length);
  for (let i = 0; i < values.length; i++) half[i] = toHalf(values[i]);
  return half;
}

// IEEE 754 binary16, round to nearest (values here are small and positive).
const scratch = new DataView(new ArrayBuffer(4));
export function toHalf(value) {
  scratch.setFloat32(0, value);
  const bits = scratch.getUint32(0);
  const sign = (bits >>> 16) & 0x8000;
  const exponent = ((bits >>> 23) & 0xff) - 127 + 15;
  const mantissa = bits & 0x7fffff;
  if (exponent <= 0) {
    if (exponent < -10) return sign;
    const m = (mantissa | 0x800000) >> (1 - exponent);
    return sign + ((m + 0x1000) >> 13);
  }
  if (exponent >= 31) return sign | 0x7c00;
  // Addition, not OR: a rounding carry must propagate into the exponent.
  return sign + (exponent << 10) + ((mantissa + 0x1000) >> 13);
}
