import { terrainHeight, shoreDistance, ISLAND } from "./terrain.js";

// The island as the sea sees it in reflection: a 256² height field over a
// 200 m square round the island (coast metres), holding the top of the land
// (terrain, or the foliage above it) and that top's albedo. The water pass
// ray-marches reflected rays through it, so trees, dunes and the beach
// mirror in the water near the shore; the sky pass alone knows nothing of
// the land. Built once from the same seeded shoots the mesh layer draws.
// Texels hold (height in metres, −1 at sea; tint 0 sand … 1 leaf; albedo
// luminance; horizontal distance to the nearest land, metres). The last
// lets a ray over open water leap to the shore in one read.
// Keep LAND_FIELD, SAND_TINT and LEAF_TINT in step with ocean.wgsl.
export const LAND_FIELD = { size: 256, span: 200, x0: ISLAND.x - 100, z0: ISLAND.z - 100 };

// Linear albedo of open ground: sand, dune, litter and moss, as forest.js's
// ground colours (#a99c7c sand, #968a64 dune, #4a3d28 litter, #354b26 moss).
const SAND = [0.4, 0.33, 0.2];
const DUNE = [0.3, 0.25, 0.13];
const LITTER = [0.068, 0.047, 0.021];
const MOSS = [0.036, 0.07, 0.019];

// Albedo is stored as luminance and a tint between two chromaticities (each
// normalised to unit luminance), which covers sand, litter, moss and leaves.
const LUMA = [0.2126, 0.7152, 0.0722];
const luma = (c) => c[0] * LUMA[0] + c[1] * LUMA[1] + c[2] * LUMA[2];
export const SAND_TINT = [1.24, 0.97, 0.6];
export const LEAF_TINT = [0.56, 1.21, 0.31];
const TINT_AXIS = SAND_TINT.map((v, i) => LEAF_TINT[i] - v);
const TINT_NORM = TINT_AXIS.reduce((a, v) => a + v * v, 0);
function tintOf(rgb) {
  const l = Math.max(luma(rgb), 1e-5);
  let t = 0;
  for (let i = 0; i < 3; i++) t += (rgb[i] / l - SAND_TINT[i]) * TINT_AXIS[i];
  return [Math.min(1, Math.max(0, t / TINT_NORM)), l];
}
function encode(data, k, rgb) {
  const [t, l] = tintOf(rgb);
  data[k + 1] = t;
  data[k + 2] = l;
}

const smooth = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const lerp3 = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

// `shoots`: the foliage clusters (and other leafy parts), each with
// position, scale, colour and sky occlusion. Returns RGBA float data:
// height in metres (−1 at sea), then albedo.
export function landFieldData(shoots) {
  const { size, span, x0, z0 } = LAND_FIELD;
  const cell = span / size;
  const data = new Float32Array(size * size * 4);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const x = x0 + (i + 0.5) * cell;
      const z = z0 + (j + 0.5) * cell;
      const inland = shoreDistance(x, z);
      const k = (j * size + i) * 4;
      if (inland < -0.3) {
        data[k] = -1;
        continue;
      }
      let colour = lerp3(SAND, DUNE, smooth(2.5, 6.5, inland) * 0.7);
      colour = lerp3(colour, LITTER, smooth(5.5, 11, inland));
      colour = lerp3(colour, MOSS, smooth(9, 17, inland) * 0.6);
      data[k] = Math.max(terrainHeight(x, z), 0);
      encode(data, k, colour);
    }
  }
  // Splat each shoot as a small dome: the crown's outer surface is what a
  // reflected ray meets. Deep shoots are darker (the crown shades itself).
  for (const s of shoots) {
    const r = Math.max(cell * 0.75, Math.max(s.scale.x, s.scale.z) * 0.55);
    const top = s.position.y + s.scale.y * 0.35;
    const ci = (s.position.x - x0) / cell - 0.5;
    const cj = (s.position.z - z0) / cell - 0.5;
    const reach = Math.ceil(r / cell);
    const shade = 1 - (s.shade ?? 0) * 0.6;
    const [tint, lum] = s.color ? tintOf([s.color.r, s.color.g, s.color.b]) : [1, 0.06];
    for (let dj = -reach; dj <= reach; dj++) {
      for (let di = -reach; di <= reach; di++) {
        const i = Math.round(ci) + di;
        const j = Math.round(cj) + dj;
        if (i < 0 || j < 0 || i >= size || j >= size) continue;
        const dx = (i - ci) * cell;
        const dz = (j - cj) * cell;
        const d2 = (dx * dx + dz * dz) / (r * r);
        if (d2 >= 1) continue;
        const h = top - r * 0.5 * d2;
        const k = (j * size + i) * 4;
        if (h <= data[k]) continue;
        data[k] = h;
        data[k + 1] = tint;
        data[k + 2] = lum * shade;
      }
    }
  }
  // Distance to land (two-pass chamfer, 1 and √2 steps), in metres.
  const far = 1e6;
  const d = new Float32Array(size * size);
  for (let i = 0; i < size * size; i++) d[i] = data[i * 4] > -0.5 ? 0 : far;
  const pass = (j0, j1, dj, i0, i1, di) => {
    for (let j = j0; j !== j1; j += dj)
      for (let i = i0; i !== i1; i += di) {
        const k = j * size + i;
        let v = d[k];
        const pi = i - di;
        const pj = j - dj;
        if (pi >= 0 && pi < size) v = Math.min(v, d[k - di] + 1);
        if (pj >= 0 && pj < size) {
          v = Math.min(v, d[k - dj * size] + 1);
          if (pi >= 0 && pi < size) v = Math.min(v, d[k - dj * size - di] + Math.SQRT2);
          const ni = i + di;
          if (ni >= 0 && ni < size) v = Math.min(v, d[k - dj * size + di] + Math.SQRT2);
        }
        d[k] = v;
      }
  };
  pass(0, size, 1, 0, size, 1);
  pass(size - 1, -1, -1, size - 1, -1, -1);
  for (let i = 0; i < size * size; i++) data[i * 4 + 3] = Math.min(d[i] * cell, 60);
  return data;
}

// Coarser levels for the texture's mip chain: the tallest thing in each
// cell (so a ray above it can cross the whole cell in one step), the
// nearest land, and mean tint and albedo. Returns [level 1, 2, 3].
export function landFieldLevels(data, levels = 3) {
  const out = [];
  let src = data;
  let size = LAND_FIELD.size;
  for (let l = 0; l < levels; l++) {
    const half = size / 2;
    const dst = new Float32Array(half * half * 4);
    for (let j = 0; j < half; j++)
      for (let i = 0; i < half; i++) {
        const o = (j * half + i) * 4;
        let top = -Infinity;
        let near = Infinity;
        let tint = 0;
        let lum = 0;
        for (const [di, dj] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
          const k = ((j * 2 + dj) * size + i * 2 + di) * 4;
          top = Math.max(top, src[k]);
          near = Math.min(near, src[k + 3]);
          tint += src[k + 1] / 4;
          lum += src[k + 2] / 4;
        }
        dst[o] = top;
        dst[o + 1] = tint;
        dst[o + 2] = lum;
        dst[o + 3] = near;
      }
    out.push(dst);
    src = dst;
    size = half;
  }
  return out;
}
