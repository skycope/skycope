// Vegetation level of detail by instance (forest.js addInstances). No
// three.js here, so it is tested on its own (tests/instance-lod.test.js).
//
// Each set of instances (shoots, tufts, fronds, rocks...) has levels, nearest
// first: `{ start, grow }`, where `start` is how far (metres, from the eye to
// the instance's nearest extent) the level begins and `grow` scales the
// instance to cover the same area with fewer, larger parts. An instance can
// be left out of a level (`kept` bit clear), so far levels keep a subset.
//
// Ground chunks still group instances for culling and draw calls, but the
// level is chosen per instance, by its own distance.
//
// Nothing may be seen to swap. Over a band before each boundary an instance
// is drawn at BOTH levels: the coarser one already there, just inside (90%
// of its size, growing to full), the finer one shrinking away round it, so
// the plant's outline never jumps and the change is spread over metres.
// An instance a coarser level drops shrinks to nothing over the band; one
// that first appears at a level (a far level keeping a subset, or none
// before) grows in from nothing. The vertex shader evaluates all of this
// from the live eye (`lodFade`; forest.js LOD_FADE_GLSL), and an instance is
// packed into every level it could be in before the next re-pack (a margin
// as large as the eye may move meanwhile), so a late re-pack is never seen.

// The fade band before a level's start: a tenth of the distance, 1–4 m.
// (Both levels are drawn across it: wider costs triangles.)
export function fadeWidth(start) {
  return Math.min(4, Math.max(1, start * 0.1));
}

// The margin every level's window is packed with: more than the eye may
// move before a per-instance chunk is re-packed (packUrgency, 60% of it).
// Instances in the margins are drawn at nothing: a wider one costs vertices,
// a narrower one re-packs more often.
export function packMargin(near) {
  return 0.45 + 0.02 * near;
}

// The level an instance this far away draws at (the finest one it is
// fully in). `bias` (≤ 1) pulls every level in (the render budget's knob,
// quality.js lodBias).
export function levelAt(distance, levels, bias = 1) {
  let level = 0;
  for (let i = 1; i < levels.length; i++) {
    if (distance >= levels[i].start * bias) level = i;
    else break;
  }
  return level;
}

// One chunk's instances, as flat arrays. `fields` are the per-instance
// attributes to copy ({ name, size, data }); the one named "matrix" (16
// floats, column-major) is scaled by each level's `grow`.
export function createLodChunk({ positions, radii, kept, fields, levels }) {
  const count = radii.length;
  let maxRadius = 0;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < count; i++) {
    maxRadius = Math.max(maxRadius, radii[i]);
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a], positions[i * 3 + a]);
      max[a] = Math.max(max[a], positions[i * 3 + a]);
    }
  }
  const capacity = levels.map((_, level) => {
    let n = 0;
    for (let i = 0; i < count; i++) if (kept[i] & (1 << level)) n++;
    return n;
  });
  return {
    count, positions, radii, kept, fields, levels, capacity, maxRadius, min, max,
    // What is packed: never (-2), a whole-chunk level (≥ 0) or per instance
    // (-1), from which eye and bias.
    state: -2, eye: [0, 0, 0], bias: 1,
  };
}

// Nearest and farthest the chunk's instances can be (their extents
// included), into `out` (no allocation: it runs per chunk per frame).
const RANGE = [0, 0];
export function chunkRange(chunk, eye, out = RANGE) {
  let near = 0, far = 0;
  for (let a = 0; a < 3; a++) {
    const lo = chunk.min[a] - chunk.maxRadius, hi = chunk.max[a] + chunk.maxRadius;
    const d = eye[a] < lo ? lo - eye[a] : eye[a] > hi ? eye[a] - hi : 0;
    near += d * d;
    const f = Math.max(Math.abs(eye[a] - chunk.min[a]), Math.abs(eye[a] - chunk.max[a]));
    far += f * f;
  }
  out[0] = Math.sqrt(near);
  out[1] = Math.sqrt(far);
  return out;
}

// The level the whole chunk draws at when every instance is well inside
// it (in no fade band, by more than the eye can move before the chunk is
// checked again), else -1 (choose per instance).
export function chunkLevel(chunk, eye, bias = 1) {
  const range = chunkRange(chunk, eye);
  const near = range[0], far = range[1];
  const levels = chunk.levels;
  const level = levelAt(near, levels, bias);
  const m = packMargin(near);
  if (level > 0 && near < levels[level].start * bias + m) return -1;
  const next = levels[level + 1];
  if (!next) return level;
  const boundary = next.start * bias;
  return far < boundary - fadeWidth(boundary) - m ? level : -1;
}

// The whole-chunk level for the eye and, if given, a second eye (the
// shadow pass's, held through a sliced refresh): -1 unless both agree.
function wholeLevel(chunk, eye, bias, eye2) {
  const level = chunkLevel(chunk, eye, bias);
  if (level < 0 || !eye2) return level;
  return chunkLevel(chunk, eye2, bias) === level ? level : -1;
}

// How urgently the chunk needs packing again for this eye and bias: 0 not
// due; from 0.6, the share of its packing margin the eye has used up (at 1
// an instance could be drawn at a level it was not packed into). One never
// packed is 1, and so is a whole chunk that has come within its margin of a
// band (a fast eye may already be past the margin). A bias step is 0.7: until packed,
// the chunk keeps the old boundaries, which is still a consistent picture.
// `eye2`: a second eye the packing must also serve (see packChunk). A
// chunk not re-packed while it is held already serves it: it was packed
// within its margin of where the eye was when the hold began.
export function packUrgency(chunk, eye, bias, eye2 = null, lead = 0) {
  if (chunk.state === -2) return 1;
  if (chunk.bias !== bias) return 0.7;
  const level = wholeLevel(chunk, eye, bias, eye2);
  if (level >= 0) return level !== chunk.state ? 1 : 0;
  if (chunk.state !== -1) return 1;
  // Per instance: again once the eye has moved part of the margin the
  // windows were packed with.
  const m = packMargin(chunkRange(chunk, chunk.eye)[0]);
  const dx = eye[0] - chunk.eye[0], dy = eye[1] - chunk.eye[1], dz = eye[2] - chunk.eye[2];
  // (`lead`: how far the eye moved last frame, so a fast eye is packed a
  // frame before it would outrun the margin, not a frame after.)
  const used = (Math.sqrt(dx * dx + dy * dy + dz * dz) + lead) / m;
  return used > 0.6 ? used : 0;
}

// Does the chunk need packing again for this eye and bias?
export function packDue(chunk, eye, bias, eye2 = null) {
  return packUrgency(chunk, eye, bias, eye2) > 0;
}

// Writes each level's instances into `outputs[level]` (an object of
// Float32Arrays by field name, plus `fade`, 4 per instance) and returns how
// many each level draws (`chunk.counts`, reused).
//
// `fade` per instance, in centre distance from the eye: the band over which
// it grows in (start, width: negative grows from nothing, positive from 90%),
// and the band over which it shrinks away (end, width; end 0: never). A mesh
// without the attribute reads (0, 0, 0, 1): full size.
//
// `eye2`, if given, is a second eye whose levels must be packed too: the
// shadow pass's eye, held fixed through a sliced shadow refresh, so every
// instance the shadow map needs stays in the same level's mesh (so in the
// same slice) from the first slice to the last, whatever the camera does.
export function packChunk(chunk, eye, bias = 1, eye2 = null) {
  const { count, positions, radii, kept, fields, levels } = chunk;
  const outputs = chunk.outputs;
  const whole = wholeLevel(chunk, eye, bias, eye2);
  const L = levels.length;
  const counts = (chunk.counts ??= new Array(L));
  counts.fill(0);
  const m = packMargin(Math.min(chunkRange(chunk, eye)[0], eye2 ? chunkRange(chunk, eye2)[0] : Infinity));
  // Per level: its window (instance distance, margin included), its band
  // edges and growth, and where each field goes. (It runs for thousands of
  // instances a frame: no per-instance lookups by name.)
  const plan = (chunk.plan ??= makePlan(chunk));
  const { from, to, inAt, inWidth, outAt, outWidth } = plan;
  for (let l = 0; l < L; l++) {
    const start = levels[l].start * bias, width = fadeWidth(start);
    from[l] = l > 0 ? start - width - m : -Infinity;
    inAt[l] = l > 0 ? start - width : 0;
    inWidth[l] = l > 0 ? width : 0;
    if (l + 1 < L) {
      const next = levels[l + 1].start * bias;
      to[l] = next + m;
      outAt[l] = next;
      outWidth[l] = fadeWidth(next);
    } else {
      to[l] = Infinity;
      outAt[l] = 0;
      outWidth[l] = 1;
    }
    if (whole >= 0) { from[l] = l === whole ? -Infinity : Infinity; to[l] = l === whole ? Infinity : -Infinity; }
  }
  const { matrixData, otherData, otherSize, otherOut } = plan;
  const F = otherData.length;
  const e2 = !!eye2 && whole < 0;
  for (let i = 0; i < count; i++) {
    let d = 0, d2 = 0;
    if (whole < 0) {
      const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
      d = Math.sqrt((x - eye[0]) ** 2 + (y - eye[1]) ** 2 + (z - eye[2]) ** 2) - radii[i];
      if (e2) d2 = Math.sqrt((x - eye2[0]) ** 2 + (y - eye2[1]) ** 2 + (z - eye2[2]) ** 2) - radii[i];
    }
    const keep = kept[i], r = radii[i];
    for (let level = 0; level < L; level++) {
      // Its window: from the start of the band into it to the end of the
      // band out of it, with the margin (for either eye).
      if (!(keep & (1 << level))) continue;
      if ((d < from[level] || d > to[level]) && (!e2 || d2 < from[level] || d2 > to[level])) continue;
      const out = outputs[level];
      const k = counts[level]++;
      if (matrixData) {
        const g = levels[level].grow, t = out.matrix, s = i * 16, o = k * 16;
        t[o] = matrixData[s] * g; t[o + 1] = matrixData[s + 1] * g; t[o + 2] = matrixData[s + 2] * g; t[o + 3] = matrixData[s + 3];
        t[o + 4] = matrixData[s + 4] * g; t[o + 5] = matrixData[s + 5] * g; t[o + 6] = matrixData[s + 6] * g; t[o + 7] = matrixData[s + 7];
        t[o + 8] = matrixData[s + 8] * g; t[o + 9] = matrixData[s + 9] * g; t[o + 10] = matrixData[s + 10] * g; t[o + 11] = matrixData[s + 11];
        t[o + 12] = matrixData[s + 12]; t[o + 13] = matrixData[s + 13]; t[o + 14] = matrixData[s + 14]; t[o + 15] = matrixData[s + 15];
      }
      const targets = otherOut[level];
      for (let f = 0; f < F; f++) {
        const size = otherSize[f], data = otherData[f], target = targets[f];
        for (let c = 0; c < size; c++) target[k * size + c] = data[i * size + c];
      }
      const fade = out.fade;
      if (level > 0) {
        // In over the band before this level's start: from 90% where the
        // finer level drew it too, from nothing where it did not.
        fade[k * 4] = inAt[level] + r;
        fade[k * 4 + 1] = keep & (1 << (level - 1)) ? inWidth[level] : -inWidth[level];
      } else {
        fade[k * 4] = 0;
        fade[k * 4 + 1] = 0;
      }
      fade[k * 4 + 2] = level + 1 < L ? outAt[level] + r : 0;
      fade[k * 4 + 3] = outWidth[level];
    }
  }
  chunk.state = whole;
  chunk.eye[0] = eye[0];
  chunk.eye[1] = eye[1];
  chunk.eye[2] = eye[2];
  chunk.bias = bias;
  return counts;
}

// What packChunk needs per chunk that does not change: scratch per level,
// and each field's source and per-level target, the matrix apart.
function makePlan(chunk) {
  const L = chunk.levels.length;
  const others = chunk.fields.filter((f) => f.name !== "matrix");
  return {
    from: new Float64Array(L), to: new Float64Array(L),
    inAt: new Float64Array(L), inWidth: new Float64Array(L), outAt: new Float64Array(L), outWidth: new Float64Array(L),
    matrixData: chunk.fields.find((f) => f.name === "matrix")?.data ?? null,
    otherData: others.map((f) => f.data),
    otherSize: others.map((f) => f.size),
    otherOut: chunk.outputs.map((out) => out && others.map((f) => out[f.name])),
  };
}

// The scale the vertex shader gives an instance at centre distance `d`
// (mirrors LOD_FADE_GLSL in forest.js; used by tests).
// Coming in beside a finer level, an instance swells from nothing to 90%
// over the first quarter of the band, hidden inside the finer one (which
// holds its size until a fifth of the way in), then to full as the finer
// one shrinks away over the rest.
export function fadeScale(fade, d) {
  const smooth = (t) => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };
  const t = (d - fade[0]) / Math.max(Math.abs(fade[1]), 1e-3);
  const grown = fade[1] === 0 ? 1 : fade[1] < 0 ? smooth(t) : smooth(t * 4) * (0.9 + 0.1 * smooth(t));
  const shrunk = fade[2] > 0 ? 1 - smooth((d - (fade[2] - fade[3] * 0.8)) / Math.max(fade[3] * 0.8, 1e-3)) : 1;
  return grown * shrunk;
}

// The bias the packer follows toward the render budget's: in small steps a
// few frames apart, so a budget change moves every boundary by a few
// percent at a time (each step a slight shift inside the fade bands)
// instead of moving them all at once.
export function easeBias(current, target) {
  if (current === undefined || Math.abs(target - current) <= 0.02) return target;
  return current + Math.sign(target - current) * 0.02;
}
