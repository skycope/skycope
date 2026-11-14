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
// level is chosen per instance: a chunk straddling a boundary draws its near
// instances at one level and its far ones at the next, instead of the whole
// 20 m chunk at the level of its centre. No pops: over a band before each
// boundary the vertex shader shrinks an instance the next level drops, and
// grows one it keeps toward the next level's size (`lodFade`: band start,
// band width, scale at start, scale at end; forest.js LOD_FADE_GLSL), so the
// swap itself happens between two parts of the same size.

// The fade band before a level's start: a fifth of the distance, 1.5–8 m.
export function fadeWidth(start) {
  return Math.min(8, Math.max(1.5, start * 0.2));
}

// The level an instance this far away draws at. `bias` (≤ 1) pulls every
// level in (the render budget's knob, quality.js lodBias).
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

// Nearest and farthest the chunk's instances can be (their extents included).
export function chunkRange(chunk, eye) {
  let near = 0, far = 0;
  for (let a = 0; a < 3; a++) {
    const lo = chunk.min[a] - chunk.maxRadius, hi = chunk.max[a] + chunk.maxRadius;
    const d = eye[a] < lo ? lo - eye[a] : eye[a] > hi ? eye[a] - hi : 0;
    near += d * d;
    const f = Math.max(Math.abs(eye[a] - chunk.min[a]), Math.abs(eye[a] - chunk.max[a]));
    far += f * f;
  }
  return [Math.sqrt(near), Math.sqrt(far)];
}

// The level the whole chunk draws at when no instance can be in another
// level or in a fade band, else -1 (choose per instance).
export function chunkLevel(chunk, eye, bias = 1) {
  const [near, far] = chunkRange(chunk, eye);
  const levels = chunk.levels;
  const level = levelAt(near, levels, bias);
  const next = levels[level + 1];
  if (!next) return level;
  const boundary = next.start * bias;
  return far < boundary - fadeWidth(boundary) ? level : -1;
}

// Does the chunk need packing again for this eye and bias?
export function packDue(chunk, eye, bias) {
  if (chunk.state === -2 || chunk.bias !== bias) return true;
  const level = chunkLevel(chunk, eye, bias);
  if (level >= 0) return level !== chunk.state;
  if (chunk.state !== -1) return true;
  // Per instance: again once the eye has moved a fraction of the distance
  // (the fade bands hide the lag).
  const [near] = chunkRange(chunk, eye);
  const moved = Math.hypot(eye[0] - chunk.eye[0], eye[1] - chunk.eye[1], eye[2] - chunk.eye[2]);
  return moved > 0.5 + 0.03 * near;
}

// Writes each level's instances into `outputs[level]` (an object of
// Float32Arrays by field name, plus `fade`, 4 per instance) and returns how
// many each level draws.
export function packChunk(chunk, eye, bias = 1) {
  const { count, positions, radii, kept, fields, levels } = chunk;
  const outputs = chunk.outputs;
  const whole = chunkLevel(chunk, eye, bias);
  const counts = levels.map(() => 0);
  const starts = levels.map((l) => l.start * bias);
  for (let i = 0; i < count; i++) {
    let level = whole;
    if (level < 0) {
      const dx = positions[i * 3] - eye[0], dy = positions[i * 3 + 1] - eye[1], dz = positions[i * 3 + 2] - eye[2];
      level = levelAt(Math.sqrt(dx * dx + dy * dy + dz * dz) - radii[i], levels, bias);
    }
    if (!(kept[i] & (1 << level))) continue;
    const out = outputs[level];
    const k = counts[level]++;
    const grow = levels[level].grow;
    for (const field of fields) {
      const { name, size, data } = field;
      const target = out[name];
      if (name === "matrix") {
        for (let c = 0; c < 16; c++) target[k * 16 + c] = data[i * 16 + c] * (c < 12 && c % 4 !== 3 ? grow : 1);
      } else {
        for (let c = 0; c < size; c++) target[k * size + c] = data[i * size + c];
      }
    }
    // The fade toward the next level, in centre distance (radius added).
    const fade = out.fade;
    const next = levels[level + 1];
    if (next) {
      const boundary = starts[level + 1];
      const width = fadeWidth(boundary);
      fade[k * 4] = boundary - width + radii[i];
      fade[k * 4 + 1] = width;
      fade[k * 4 + 2] = 1;
      fade[k * 4 + 3] = kept[i] & (1 << (level + 1)) ? next.grow / grow : 0;
    } else {
      fade[k * 4] = 1e9;
      fade[k * 4 + 1] = 1;
      fade[k * 4 + 2] = 1;
      fade[k * 4 + 3] = 1;
    }
  }
  chunk.state = whole;
  chunk.eye[0] = eye[0];
  chunk.eye[1] = eye[1];
  chunk.eye[2] = eye[2];
  chunk.bias = bias;
  return counts;
}

// The scale the vertex shader gives an instance at centre distance `d`
// (mirrors LOD_FADE_GLSL in forest.js; used by tests).
export function fadeScale(fade, d) {
  const t = Math.min(1, Math.max(0, (d - fade[0]) / Math.max(fade[1], 1e-3)));
  const s = t * t * (3 - 2 * t);
  return fade[2] + (fade[3] - fade[2]) * s;
}
