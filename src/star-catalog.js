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
  // Empty cells within a star's search window get flux -1: the shader reads
  // its own cell first and, finding exactly 0, knows no star can touch the
  // pixel and skips the neighbourhood search (most of the sky).
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (cells[(y * width + x) * 4 + 2] <= 0) continue;
      for (let dy = -1; dy <= 1; dy++) {
        const row = y + dy;
        if (row < 0 || row >= height) continue;
        const reach = searchReach(row, height);
        for (let dx = -reach; dx <= reach; dx++) {
          const i = (row * width + ((x + dx + width) % width)) * 4 + 2;
          if (cells[i] === 0) cells[i] = -1;
        }
      }
    }
  }
  return cells;
}

// Cells searched either side in right ascension; must match catalog_stars
// in night.wgsl (wider toward the poles, where cells narrow).
function searchReach(row, height) {
  const dec = (0.5 - (row + 0.5) / height) * Math.PI;
  return Math.min(5, Math.max(1, Math.ceil(1.2 / Math.max(Math.cos(dec), 0.2))));
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

// The constellation figures as an equirectangular atlas (RGBA8, sampled by
// sky.wgsl after rotating the local sky into right ascension/declination):
//   r  line coverage, about a pixel and a half wide
//   g  where along its figure the line lies, 0…1, in drawing order: the
//      figure is drawn stroke by stroke from its first star (the stars gift
//      draws each figure by sweeping a pen through g)
//   b  which figure (a scrambled id in 0.08…0.98), so each draws in turn
//   a  a soft node at every star the lines join
// g and b reach a pixel or two past the line so filtering never mixes them
// with the empty sky. Pure (no DOM): the site and render-sky.mjs share it.
export function constellationAtlas(constellations, width = 2048, height = 1024) {
  const data = new Uint8Array(width * height * 4);
  const own = new Float32Array(width * height);
  const point = (ra, dec) => [((((ra % 360) + 360) % 360) / 360) * width, (0.5 - dec / 180) * height];
  const angle = ([ra1, dec1], [ra2, dec2]) => {
    const r = Math.PI / 180;
    const c = Math.sin(dec1 * r) * Math.sin(dec2 * r) + Math.cos(dec1 * r) * Math.cos(dec2 * r) * Math.cos((ra1 - ra2) * r);
    return Math.acos(Math.min(1, Math.max(-1, c)));
  };
  constellations.forEach((figure, index) => {
    const id = 0.08 + ((index * 0.6180339887) % 1) * 0.9;
    let total = 0;
    for (const line of figure) for (let i = 1; i < line.length; i++) total += angle(line[i - 1], line[i]);
    let done = 0;
    for (const line of figure) {
      for (let i = 1; i < line.length; i++) {
        const length = angle(line[i - 1], line[i]);
        if (i === 1) node(point(...line[0]), done / total, id);
        // Along the great circle, in pieces of about a degree: straight on
        // the sky, where the equirectangular atlas would bend them.
        const pieces = Math.max(1, Math.ceil(length / (Math.PI / 180)));
        let previous = line[i - 1];
        for (let k = 1; k <= pieces; k++) {
          const next = k === pieces ? line[i] : slerpRaDec(line[i - 1], line[i], k / pieces);
          const a = point(...previous);
          const b = point(...next);
          if (b[0] - a[0] > width / 2) b[0] -= width;
          if (a[0] - b[0] > width / 2) b[0] += width;
          stroke(a, b, (done + (length * (k - 1)) / pieces) / total, (done + (length * k) / pieces) / total, id);
          previous = next;
        }
        done += length;
        node(point(...line[i]), done / total, id);
      }
    }
  });
  return data;

  function put(x, y, coverage, wide, order, id, glow) {
    if (y < 0 || y >= height) return;
    const i = y * width + (((x % width) + width) % width);
    const o = i * 4;
    if (coverage * 255 > data[o]) data[o] = Math.round(coverage * 255);
    if (glow * 255 > data[o + 3]) data[o + 3] = Math.round(glow * 255);
    if (wide > own[i]) {
      own[i] = wide;
      data[o + 1] = Math.round(Math.min(1, Math.max(0, order)) * 255);
      data[o + 2] = Math.round(id * 255);
    }
  }
  function stroke(a, b, from, to, id) {
    const pad = 3;
    const [x0, x1] = [Math.floor(Math.min(a[0], b[0]) - pad), Math.ceil(Math.max(a[0], b[0]) + pad)];
    const [y0, y1] = [Math.floor(Math.min(a[1], b[1]) - pad), Math.ceil(Math.max(a[1], b[1]) + pad)];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l2 = Math.max(dx * dx + dy * dy, 1e-6);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5 - a[0];
        const py = y + 0.5 - a[1];
        const t = Math.min(1, Math.max(0, (px * dx + py * dy) / l2));
        const d = Math.hypot(px - dx * t, py - dy * t);
        if (d > 2.8) continue;
        const coverage = 1 - smooth(0.3, 1.05, d);
        const wide = 1 - smooth(1.0, 2.8, d);
        put(x, y, coverage, wide, from + (to - from) * t, id, 0);
      }
    }
  }
  function node(p, order, id) {
    for (let y = Math.floor(p[1] - 3); y <= Math.ceil(p[1] + 3); y++) {
      for (let x = Math.floor(p[0] - 3); x <= Math.ceil(p[0] + 3); x++) {
        const d = Math.hypot(x + 0.5 - p[0], y + 0.5 - p[1]);
        if (d > 3) continue;
        put(x, y, 0, 1 - smooth(1.5, 3, d), order, id, Math.exp(-d * d / 1.6));
      }
    }
  }
}

function slerpRaDec([ra1, dec1], [ra2, dec2], t) {
  const r = Math.PI / 180;
  const v = (ra, dec) => [Math.cos(dec * r) * Math.cos(ra * r), Math.cos(dec * r) * Math.sin(ra * r), Math.sin(dec * r)];
  const a = v(ra1, dec1);
  const b = v(ra2, dec2);
  const p = a.map((x, i) => x + (b[i] - x) * t);
  const n = Math.hypot(...p) || 1;
  return [Math.atan2(p[1], p[0]) / r, Math.asin(p[2] / n) / r];
}

function smooth(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
