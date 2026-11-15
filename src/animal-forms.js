import * as THREE from "three";
import { tileHeight } from "./walker.js";
import { SimplifyModifier } from "three/addons/modifiers/SimplifyModifier.js";
import { note } from "./stability-log.js"; // stability: `?perf` event log
import { groundHeight, shoreDistance, ISLAND } from "./terrain.js";

// Shared making and lighting for the island's animals (penguins.js,
// seals.js, whale.js, shore-life.js):
// - sculpt(): an anatomical signed-distance body (ellipsoids and tapered
//   capsules, smooth-blended) meshed once with surface nets, painted per
//   vertex (markings from position, normal and which part dominates), and
//   given per-vertex part weights the vertex shader animates by;
// - animalMaterial(): MeshStandardMaterial under the shared sky and sun,
//   with a GLSL deform hook (head, flippers, spine, gait), a per-instance
//   wet sheen and a per-instance waterline below which nothing is drawn
//   (the WebGPU sea is underneath, so a swimmer must not show through it);
// - createBlobs(): soft contact shadows (the sun shadow map only re-renders
//   when the light or the cat's anchor moves, so moving animals get these);
// - createSpray(): billboard mist and splash droplets (a whale's blow, the
//   crash of a breach, a seal sliding in), lit like everything else.
// Coordinates are coast metres in the z-mirrored land group.

// ---------------------------------------------------------------------------
// Signed-distance primitives. `tag` names the part for weights and paint.

export function ellipsoid(tag, c, r, { rot = null, k = 0.02, sub = false, blend } = {}) {
  return { kind: 0, tag, c, r, inv: rot ? inverseBasis(rot) : null, k, sub, blend, R: Math.max(...r) };
}

// A capsule whose radius runs from ra at a to rb at b; `squash` flattens it
// across its own axis ([across, up] scale), for flippers and fins.
export function capsule(tag, a, b, ra, rb, { k = 0.02, sub = false, squash = null, blend } = {}) {
  const c = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const axis = [(b[0] - a[0]) / len, (b[1] - a[1]) / len, (b[2] - a[2]) / len];
  // A frame round the axis: `across` is the axis × up (or × x when vertical).
  const ref = Math.abs(axis[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const across = normalise(cross(axis, ref));
  const up = cross(across, axis);
  return { kind: 1, tag, a, b, ra, rb, len, axis, across, up, squash, c, k, sub, blend, R: len / 2 + Math.max(ra, rb) };
}

function inverseBasis([x, y, z]) {
  const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(x, y, z, "XYZ"));
  const e = m.elements;
  // Transpose of the rotation (column-major → rows).
  return [e[0], e[4], e[8], e[1], e[5], e[9], e[2], e[6], e[10]];
}

function primDistance(p, x, y, z) {
  if (p.kind === 0) {
    let qx = x - p.c[0];
    let qy = y - p.c[1];
    let qz = z - p.c[2];
    if (p.inv) {
      const m = p.inv;
      const tx = m[0] * qx + m[3] * qy + m[6] * qz;
      const ty = m[1] * qx + m[4] * qy + m[7] * qz;
      const tz = m[2] * qx + m[5] * qy + m[8] * qz;
      qx = tx; qy = ty; qz = tz;
    }
    const [rx, ry, rz] = p.r;
    const k0 = Math.sqrt((qx / rx) ** 2 + (qy / ry) ** 2 + (qz / rz) ** 2);
    const k1 = Math.sqrt((qx / (rx * rx)) ** 2 + (qy / (ry * ry)) ** 2 + (qz / (rz * rz)) ** 2);
    if (k1 < 1e-9) return -Math.min(rx, ry, rz);
    return (k0 * (k0 - 1)) / k1;
  }
  const dx = x - p.a[0];
  const dy = y - p.a[1];
  const dz = z - p.a[2];
  const along = dx * p.axis[0] + dy * p.axis[1] + dz * p.axis[2];
  const t = Math.max(0, Math.min(1, along / p.len));
  let ox = dx - p.axis[0] * t * p.len;
  let oy = dy - p.axis[1] * t * p.len;
  let oz = dz - p.axis[2] * t * p.len;
  let scale = 1;
  if (p.squash) {
    // Off-axis offset in the capsule's own frame, squashed.
    const u = (ox * p.across[0] + oy * p.across[1] + oz * p.across[2]) / p.squash[0];
    const v = (ox * p.up[0] + oy * p.up[1] + oz * p.up[2]) / p.squash[1];
    const w = ox * p.axis[0] + oy * p.axis[1] + oz * p.axis[2];
    ox = u; oy = v; oz = w;
    scale = Math.min(p.squash[0], p.squash[1], 1);
  }
  return (Math.sqrt(ox * ox + oy * oy + oz * oz) - (p.ra + (p.rb - p.ra) * t)) * scale;
}

function smin(a, b, k) {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

function fieldOf(prims) {
  const each = new Float64Array(prims.length);
  const evaluate = (x, y, z, record = false) => {
    let d = 1;
    for (let i = 0; i < prims.length; i++) {
      const p = prims[i];
      const cx = x - p.c[0], cy = y - p.c[1], cz = z - p.c[2];
      const bound = Math.sqrt(cx * cx + cy * cy + cz * cz) - p.R;
      const di = bound > 0.05 + p.k ? bound : primDistance(p, x, y, z);
      if (record) each[i] = di;
      d = p.sub ? -smin(-d, di, p.k) : smin(d, di, p.k);
    }
    return d;
  };
  const gradient = (x, y, z, out, e) => {
    out[0] = evaluate(x + e, y, z) - evaluate(x - e, y, z);
    out[1] = evaluate(x, y + e, z) - evaluate(x, y - e, z);
    out[2] = evaluate(x, y, z + e) - evaluate(x, y, z - e);
    const l = Math.sqrt(out[0] * out[0] + out[1] * out[1] + out[2] * out[2]) || 1;
    out[0] /= l; out[1] /= l; out[2] /= l;
    return out;
  };
  return { evaluate, gradient, each };
}

// Mesh the body: naive surface nets on a uniform grid of `cell` metres, each
// vertex Newton-projected onto the surface. `paint(p, n, w)` returns an sRGB
// colour; `attributes` are { name: { size, value(p, n, w) } }; w maps each
// tag to its weight (soft, by distance to each primitive, `blend` metres).
// `extras` are small explicit parts (bills, eyes, claws) too thin for the
// grid: { geometry, colour | paint, weights }.
// `triangles` caps the body's count: the fine mesh (thin flippers and bills
// need a fine grid) is decimated by quadric edge collapse before painting,
// so silhouettes keep their detail and flat flanks lose theirs.
export function sculpt({ prims, cell, blend = 0.015, paint = () => [1, 1, 1], attributes = {}, extras = [], triangles = Infinity, aoRadius = 0.03 }) {
  triangles = Math.min(triangles, triangleCap);
  const field = fieldOf(prims);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const p of prims) {
    if (p.sub) continue;
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i], p.c[i] - p.R - p.k);
      max[i] = Math.max(max[i], p.c[i] + p.R + p.k);
    }
  }
  const h = cell;
  const n = [0, 1, 2].map((i) => Math.ceil((max[i] - min[i]) / h) + 4);
  const origin = [0, 1, 2].map((i) => min[i] - 2 * h);
  const [nx, ny, nz] = n;
  const values = new Float32Array(nx * ny * nz);
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++)
        values[i + nx * (j + ny * k)] = field.evaluate(origin[0] + i * h, origin[1] + j * h, origin[2] + k * h);
  const cellVertex = new Int32Array(nx * ny * nz).fill(-1);
  let verts = [];
  const corner = new Float32Array(8);
  const EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const g = [0, 0, 0];
  for (let k = 0; k < nz - 1; k++)
    for (let j = 0; j < ny - 1; j++)
      for (let i = 0; i < nx - 1; i++) {
        let inside = 0;
        for (let c = 0; c < 8; c++) {
          const v = values[i + (c & 1) + nx * (j + ((c >> 1) & 1) + ny * (k + (c >> 2)))];
          corner[c] = v;
          if (v < 0) inside++;
        }
        if (inside === 0 || inside === 8) continue;
        let sx = 0, sy = 0, sz = 0, count = 0;
        for (const [a, b] of EDGES) {
          const va = corner[a];
          const vb = corner[b];
          if (va < 0 === vb < 0) continue;
          const t = va / (va - vb);
          sx += (a & 1) + ((b & 1) - (a & 1)) * t;
          sy += ((a >> 1) & 1) + (((b >> 1) & 1) - ((a >> 1) & 1)) * t;
          sz += (a >> 2) + ((b >> 2) - (a >> 2)) * t;
          count++;
        }
        const v = [origin[0] + (i + sx / count) * h, origin[1] + (j + sy / count) * h, origin[2] + (k + sz / count) * h];
        for (let s = 0; s < 3; s++) {
          const d = field.evaluate(v[0], v[1], v[2]);
          if (Math.abs(d) < 1e-5) break;
          field.gradient(v[0], v[1], v[2], g, h * 0.05);
          // Never further than a cell: thin parts would collapse.
          const step = Math.max(-h, Math.min(h, d));
          v[0] -= g[0] * step; v[1] -= g[1] * step; v[2] -= g[2] * step;
        }
        cellVertex[i + nx * (j + ny * k)] = verts.length;
        verts.push(v);
      }
  let tris = [];
  const at = (i, j, k) => cellVertex[i + nx * (j + ny * k)];
  const quad = (a, b, c, d, flip) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) [b, d] = [d, b];
    if (dist2(verts[a], verts[c]) < dist2(verts[b], verts[d])) tris.push(a, b, c, a, c, d);
    else tris.push(a, b, d, b, c, d);
  };
  for (let k = 1; k < nz - 1; k++)
    for (let j = 1; j < ny - 1; j++)
      for (let i = 1; i < nx - 1; i++) {
        const inside = values[i + nx * (j + ny * k)] < 0;
        if (inside !== values[i + 1 + nx * (j + ny * k)] < 0) quad(at(i, j - 1, k - 1), at(i, j, k - 1), at(i, j, k), at(i, j - 1, k), inside);
        if (inside !== values[i + nx * (j + 1 + ny * k)] < 0) quad(at(i - 1, j, k - 1), at(i - 1, j, k), at(i, j, k), at(i, j, k - 1), inside);
        if (inside !== values[i + nx * (j + ny * (k + 1))] < 0) quad(at(i - 1, j - 1, k), at(i, j - 1, k), at(i, j, k), at(i - 1, j, k), inside);
      }
  // Normals from the field; orient every triangle to agree with them.
  let normals = verts.map((v) => field.gradient(v[0], v[1], v[2], [0, 0, 0], h * 0.25));
  for (let t = 0; t < tris.length; t += 3) {
    const [a, b, c] = [verts[tris[t]], verts[tris[t + 1]], verts[tris[t + 2]]];
    const fn = cross([b[0] - a[0], b[1] - a[1], b[2] - a[2]], [c[0] - a[0], c[1] - a[1], c[2] - a[2]]);
    const vn = normals[tris[t]];
    if (fn[0] * vn[0] + fn[1] * vn[1] + fn[2] * vn[2] < 0) {
      const s = tris[t + 1];
      tris[t + 1] = tris[t + 2];
      tris[t + 2] = s;
    }
  }
  if (tris.length / 3 > triangles) {
    const fine = new THREE.BufferGeometry();
    fine.setAttribute("position", new THREE.Float32BufferAttribute(verts.flat(), 3));
    fine.setIndex(tris);
    // Each collapse removes one vertex and about two triangles.
    const coarse = new SimplifyModifier().modify(fine, Math.floor((tris.length / 3 - triangles) / 2));
    const q = coarse.attributes.position;
    verts = Array.from({ length: q.count }, (_, i) => [q.getX(i), q.getY(i), q.getZ(i)]);
    tris = Array.from(coarse.index.array);
    normals = verts.map((v) => field.gradient(v[0], v[1], v[2], [0, 0, 0], h * 0.25));
    fine.dispose();
    coarse.dispose();
  }
  const tags = [...new Set(prims.map((p) => p.tag))];
  const weightsAt = (v) => {
    field.evaluate(v[0], v[1], v[2], true);
    let best = Infinity;
    for (let i = 0; i < prims.length; i++) if (!prims[i].sub) best = Math.min(best, field.each[i]);
    const w = Object.fromEntries(tags.map((t) => [t, 0]));
    let sum = 0;
    for (let i = 0; i < prims.length; i++) {
      if (prims[i].sub) continue;
      const e = Math.exp(-(field.each[i] - best) / (prims[i].blend ?? blend));
      w[prims[i].tag] += e;
      sum += e;
    }
    for (const t of tags) w[t] /= sum;
    return w;
  };
  const positions = [];
  const normalOut = [];
  const colours = [];
  const extra = Object.fromEntries(Object.keys(attributes).map((name) => [name, []]));
  const emit = (p, nrm, w, colour) => {
    positions.push(p[0], p[1], p[2]);
    normalOut.push(nrm[0], nrm[1], nrm[2]);
    const c = colour ?? paint(p, nrm, w);
    colours.push(c[0] ** 2.2, c[1] ** 2.2, c[2] ** 2.2);
    for (const [name, spec] of Object.entries(attributes)) {
      const value = spec.value(p, nrm, w);
      if (spec.size === 1) extra[name].push(value);
      else extra[name].push(...value);
    }
  };
  // Baked ambient occlusion for paint's 4th argument: how far the surface
  // leaves a point's neighbourhood open along its normal (armpits, the
  // crease under a flipper, between the legs).
  const occlusion = (v, nrm) => {
    let open = 0;
    for (const r of [aoRadius * 0.5, aoRadius]) open += clamp(field.evaluate(v[0] + nrm[0] * r, v[1] + nrm[1] * r, v[2] + nrm[2] * r) / r, 0, 1);
    return 0.45 + 0.55 * (open / 2);
  };
  verts.forEach((v, i) => {
    const w = weightsAt(v);
    w.ao = occlusion(v, normals[i]);
    emit(v, normals[i], w);
  });
  const index = tris.slice();
  for (const part of extras) {
    const geometry = part.geometry.index ? part.geometry.toNonIndexed() : part.geometry;
    geometry.computeVertexNormals();
    const p = geometry.attributes.position;
    const q = geometry.attributes.normal;
    const base = positions.length / 3;
    const w = Object.fromEntries(tags.map((t) => [t, 0]));
    w.ao = 1;
    Object.assign(w, part.weights);
    for (let i = 0; i < p.count; i++) {
      const v = [p.getX(i), p.getY(i), p.getZ(i)];
      const nv = [q.getX(i), q.getY(i), q.getZ(i)];
      emit(v, nv, part.weightsAt ? part.weightsAt(v) : w, part.paint ? part.paint(v, nv) : part.colour);
      index.push(base + i);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normalOut, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colours, 3));
  for (const [name, spec] of Object.entries(attributes)) geometry.setAttribute(name, new THREE.Float32BufferAttribute(extra[name], spec.size));
  geometry.setIndex(index);
  geometry.computeBoundingSphere();
  return geometry;
}

// ---------------------------------------------------------------------------
// Material: standard PBR under the shared sky, with
//  - `pars`: GLSL declarations (attributes, uniforms) and a
//    `void animalDeform( inout vec3 p, inout vec3 n )` that moves a vertex
//    and its normal in the body's own frame;
//  - per-instance `wet` (0…1: darker, glossier) and `waterline` (world y,
//    below which fragments are dropped; use −1e4 on land).
//  - optional `paint`: GLSL `vec3 animalPaint( vec3 p, vec3 n, vec4 tags )`
//    giving linear albedo per fragment from the rest-pose position, normal
//    and the vec4 `tags` attribute, for markings finer than the mesh (the
//    vertex colour multiplies it).
export function animalMaterial({ name, uniforms = {}, pars, paint = null, roughness = 0.75, sheen = 0.3 }) {
  // Double-sided: thin flippers and fins can fold a facet the wrong way.
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness, metalness: 0, side: THREE.DoubleSide });
  material.customProgramCacheKey = () => `animal-${name}`;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        "void main() {",
        `attribute float wet;
        attribute float waterline;
        varying float vWet;
        varying float vWaterline;
        varying float vWorldY;
        ${paint ? "attribute vec4 tags;\nvarying vec3 vRest;\nvarying vec3 vRestN;\nvarying vec4 vTags;" : ""}
        ${pars}
        void main() {
        ${paint ? "vRest = position;\nvRestN = normal;\nvTags = tags;" : ""}`,
      )
      .replace(
        "#include <beginnormal_vertex>",
        `vec3 objectNormal = vec3( normal );
        vec3 animP = position;
        animalDeform( animP, objectNormal );
        vWet = wet;
        vWaterline = waterline;`,
      )
      .replace("#include <begin_vertex>", "vec3 transformed = animP;")
      .replace(
        "#include <project_vertex>",
        `#include <project_vertex>
        #ifdef USE_INSTANCING
          vWorldY = ( modelMatrix * instanceMatrix * vec4( transformed, 1.0 ) ).y;
        #else
          vWorldY = ( modelMatrix * vec4( transformed, 1.0 ) ).y;
        #endif`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "void main() {",
        `varying float vWet;
        varying float vWaterline;
        varying float vWorldY;
        ${paint ? `varying vec3 vRest;\nvarying vec3 vRestN;\nvarying vec4 vTags;\n${PAINT_GLSL}\n${paint}` : ""}
        void main() {
          if ( vWorldY < vWaterline ) discard;`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        ${paint ? "diffuseColor.rgb *= animalPaint( vRest, normalize( vRestN ), vTags );" : ""}
        // Wet fur and feathers darken (water fills the gaps between hairs).
        diffuseColor.rgb *= mix( 1.0, 0.55, vWet );
        // A thin film at the waterline.
        diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * 0.6 + 0.02, smoothstep( 0.04, 0.0, vWorldY - vWaterline ) * step( -1e3, vWaterline ) );`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
        roughnessFactor = mix( roughnessFactor, ${sheen.toFixed(3)}, vWet );`,
      );
  };
  return material;
}

// Bodies take 100–250 ms each to mesh and decimate, so in the browser they
// are built off the main thread (animal-worker.js), like the cat's. This
// returns an empty geometry at once and fills it when the worker answers
// (`userData.ready`); without workers (node tests) it builds in place.
// `kind` names a builder in animal-worker.js; `build` is the same builder.
// `options.coarse` (a triangle count) builds the same body decimated that
// far, for distance (herdBounds' `coarse`).
let worker = null;
const waiting = new Map();
export function formGeometry(kind, options, build) {
  const geometry = new THREE.BufferGeometry();
  geometry.userData.ready = false;
  if (typeof Worker === "undefined") {
    adopt(geometry, buildForm(build, options));
    return geometry;
  }
  if (!worker) {
    worker = new Worker(new URL("./animal-worker.js", import.meta.url), { type: "module" });
    worker.onmessage = ({ data }) => {
      const target = waiting.get(data.key);
      waiting.delete(data.key);
      if (target) adopt(target, data);
      if (!waiting.size) {
        worker.terminate();
        worker = null;
      }
    };
  }
  const key = `${kind}:${waiting.size}:${Math.random()}`;
  waiting.set(key, geometry);
  worker.postMessage({ key, kind, options });
  return geometry;
}

// Runs a body builder, capping every sculpt in it at `options.coarse`
// triangles when that is set (the builders keep their own fine budgets).
let triangleCap = Infinity;
export function buildForm(build, options) {
  if (!options?.coarse) return build(options);
  triangleCap = options.coarse;
  try {
    return build(options);
  } finally {
    triangleCap = Infinity;
  }
}

// Copy a built geometry (or the worker's arrays) into `geometry`.
export function adopt(geometry, source) {
  const attributes = source.isBufferGeometry
    ? Object.fromEntries(Object.entries(source.attributes).map(([name, a]) => [name, { array: a.array, itemSize: a.itemSize }]))
    : source.attributes;
  for (const [name, { array, itemSize }] of Object.entries(attributes)) geometry.setAttribute(name, new THREE.BufferAttribute(array, itemSize));
  const index = source.isBufferGeometry ? source.index.array : source.index;
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  geometry.computeBoundingSphere();
  geometry.userData.ready = true;
}

// The arrays of a built geometry, for posting from the worker.
export function packGeometry(geometry) {
  const attributes = {};
  const transfer = [];
  for (const [name, attribute] of Object.entries(geometry.attributes)) {
    attributes[name] = { array: attribute.array, itemSize: attribute.itemSize };
    transfer.push(attribute.array.buffer);
  }
  transfer.push(geometry.index.array.buffer);
  return { message: { attributes, index: geometry.index.array }, transfer };
}

// An instanced animal mesh with the per-instance attributes the material
// expects plus any `attributes` ({ name: size }), all zeroed.
export function animalMesh(parent, geometry, material, count, attributes = {}) {
  const attrs = {};
  for (const [name, size] of Object.entries({ wet: 1, waterline: 1, ...attributes })) {
    attrs[name] = new THREE.InstancedBufferAttribute(new Float32Array(count * size), size);
    attrs[name].setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute(name, attrs[name]);
  }
  attrs.waterline.array.fill(-1e4);
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  // No sun shadows: the map re-renders only when the light or the cat's
  // anchor moves (landscape.js), so a moving animal's shadow would stay
  // behind. Contact shadows come from createBlobs.
  parent.add(mesh);
  return { mesh, attrs };
}

// Frustum culling for an instanced herd: a sphere round every instance
// placed this frame (coast metres, the land group's frame), so a colony
// behind the camera costs no draw. Call begin(), add() per animal, end(eye).
// lod: with `coarse` (formGeometry(kind, { coarse }) of the same body), the
// herd draws that instead once its nearest member is more than `far` metres
// from `eye` (coast metres). Both geometries share every instance buffer,
// so the module writes one set and the switch costs nothing; a few metres
// of hysteresis keep it from flickering on the boundary. At that distance
// an animal is a few dozen pixels tall and the decimated body (its shape
// sculpted from the same field, normals from the field) reads the same.
export function herdBounds(mesh, { coarse = null, far = 20 } = {}) {
  mesh.frustumCulled = true;
  mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1);
  const fine = mesh.geometry;
  if (coarse) {
    for (const [name, attribute] of Object.entries(fine.attributes)) if (attribute.isInstancedBufferAttribute) coarse.setAttribute(name, attribute);
    // The module disposes the body it made; the coarse one goes with it.
    fine.addEventListener("dispose", () => coarse.dispose());
  }
  let distant = false;
  let x0, x1, y0, y1, z0, z1, pad;
  return {
    get coarse() {
      return mesh.geometry === coarse;
    },
    begin() {
      x0 = y0 = z0 = Infinity;
      x1 = y1 = z1 = -Infinity;
      pad = 0;
    },
    add(x, y, z, r) {
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      if (z < z0) z0 = z;
      if (z > z1) z1 = z;
      if (r > pad) pad = r;
    },
    end(eye = null) {
      if (x0 === Infinity) return;
      const s = mesh.boundingSphere;
      s.center.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
      s.radius = Math.hypot(x1 - x0, y1 - y0, z1 - z0) / 2 + pad;
      if (!coarse || !eye) return;
      const dx = eye.x - s.center.x, dy = eye.y - s.center.y, dz = eye.z - s.center.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) - s.radius;
      distant = d > (distant ? far - 3 : far);
      const next = distant && coarse.userData.ready ? coarse : fine;
      if (next !== mesh.geometry) note("animal-lod", { herd: mesh.name || "herd", coarse: next === coarse, distance: Math.round(d) });
      mesh.geometry = next;
    },
  };
}

// GLSL helpers for paint hooks: antialiased steps and value noise.
export const PAINT_GLSL = `
float aaStep( float edge, float x ) { float w = max( fwidth( x ), 1e-5 ); return smoothstep( edge - w, edge + w, x ); }
float hash31( vec3 p ) { p = fract( p * 0.3183099 + 0.1 ); p *= 17.0; return fract( p.x * p.y * p.z * ( p.x + p.y + p.z ) ); }
float vnoise( vec3 x ) {
  vec3 i = floor( x ); vec3 f = fract( x ); f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( mix( hash31( i ), hash31( i + vec3( 1, 0, 0 ) ), f.x ), mix( hash31( i + vec3( 0, 1, 0 ) ), hash31( i + vec3( 1, 1, 0 ) ), f.x ), f.y ),
              mix( mix( hash31( i + vec3( 0, 0, 1 ) ), hash31( i + vec3( 1, 0, 1 ) ), f.x ), mix( hash31( i + vec3( 0, 1, 1 ) ), hash31( i + vec3( 1, 1, 1 ) ), f.x ), f.y ), f.z );
}
vec3 srgb( vec3 c ) { return pow( c, vec3( 2.2 ) ); }
`;

// GLSL helpers for deform hooks.
export const DEFORM_GLSL = `
mat3 rotX( float a ) { float c = cos( a ), s = sin( a ); return mat3( 1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c ); }
mat3 rotY( float a ) { float c = cos( a ), s = sin( a ); return mat3( c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c ); }
mat3 rotZ( float a ) { float c = cos( a ), s = sin( a ); return mat3( c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0 ); }
// Rotate p and n about a pivot by m, blended by weight w.
void turnAbout( inout vec3 p, inout vec3 n, vec3 pivot, mat3 m, float w ) {
  if ( w < 0.001 ) return;
  p = mix( p, pivot + m * ( p - pivot ), w );
  n = normalize( mix( n, m * n, w ) );
}
`;

export const WORLD_SCALE = 1.4; // the island is drawn 1.4x life (the cat is CAT_SCALE 1.4): animals take the same
// One placement helper for every module (no allocation per call).
const _position = new THREE.Vector3();
const _quaternion = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _matrix = new THREE.Matrix4();
const _euler = new THREE.Euler(0, 0, 0, "YXZ");
// heading: yaw about +y, φ pointing along (sin φ, cos φ) like the cat;
// pitch dips the nose (+), roll banks to the right (+).
export function placeInstance(mesh, index, x, y, z, heading, pitch = 0, roll = 0, scale = 1) {
  _position.set(x, y, z);
  _euler.set(pitch, heading, roll);
  _quaternion.setFromEuler(_euler);
  _scale.setScalar(scale);
  _matrix.compose(_position, _quaternion, _scale);
  mesh.setMatrixAt(index, _matrix);
}

// ---------------------------------------------------------------------------
// Ground: sand from groundHeight, boulders from their rasterized tops (the
// same tiles the cat walks on, forest.obstacles.domes).

// One implementation of a tile's surface (walker.js).
export const domeHeight = tileHeight;

// The walkable top near a place: max of the sand and the listed rocks.
export function surfaceOf(domes) {
  return (x, z) => {
    let y = groundHeight(x, z);
    for (const d of domes) {
      if (Math.abs(x - d.x) > d.r + 0.1 || Math.abs(z - d.z) > d.r + 0.1) continue;
      const h = domeHeight(d, x, z);
      if (h > y) y = h;
    }
    return y;
  };
}

// Granite outcrops: the big stones grouped by touching, with where they sit
// round the island (theta) and how far inland (negative: in the sea).
export function boulderClusters(domes) {
  const big = domes.filter((d) => d.r > 0.9);
  const parent = big.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < big.length; i++)
    for (let j = i + 1; j < big.length; j++)
      if (Math.hypot(big[i].x - big[j].x, big[i].z - big[j].z) < big[i].r + big[j].r + 2.5) parent[find(i)] = find(j);
  const groups = new Map();
  big.forEach((d, i) => {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(d);
  });
  return [...groups.values()]
    .filter((members) => members.length >= 2)
    .map((members) => {
      const x = members.reduce((s, d) => s + d.x, 0) / members.length;
      const z = members.reduce((s, d) => s + d.z, 0) / members.length;
      return {
        members,
        x,
        z,
        theta: Math.atan2(z - ISLAND.z, x - ISLAND.x),
        inland: shoreDistance(x, z),
        top: Math.max(...members.map((d) => d.heights.reduce((m, h) => Math.max(m, h), -Infinity))),
      };
    });
}

export function angleBetween(a, b) {
  return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
}

// ---------------------------------------------------------------------------
// Contact shadows: soft dark ellipses on the ground under each animal.

export function createBlobs(parent, capacity) {
  const geometry = new THREE.PlaneGeometry(1, 1);
  geometry.rotateX(-Math.PI / 2);
  const material = new THREE.MeshBasicMaterial({
    color: 0x000000,
    transparent: true,
    depthWrite: false,
    // The land group mirrors z, which flips which way a plane faces.
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  material.customProgramCacheKey = () => "animal-blobs";
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("void main() {", "attribute float strength;\nvarying float vStrength;\nvarying vec2 vBlob;\nvoid main() {")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvBlob = position.xz * 2.0;\nvStrength = strength;");
    shader.fragmentShader = shader.fragmentShader
      .replace("void main() {", "varying float vStrength;\nvarying vec2 vBlob;\nvoid main() {")
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        float r = length( vBlob );
        diffuseColor.a = vStrength * ( 1.0 - smoothstep( 0.15, 1.0, r ) ) * 0.55;`,
      );
  };
  const strength = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
  strength.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("strength", strength);
  const mesh = new THREE.InstancedMesh(geometry, material, capacity);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.count = 0;
  mesh.renderOrder = 1;
  parent.add(mesh);
  const matrix = new THREE.Matrix4();
  return {
    mesh,
    begin() {
      mesh.count = 0;
    },
    // length along the heading, width across it, darkness 0…1.
    add(x, y, z, heading, length, width, dark) {
      if (mesh.count >= capacity || dark <= 0.01) return;
      const c = Math.cos(heading);
      const s = Math.sin(heading);
      // Columns: across (x) scaled by width, up, along (z) by length.
      matrix.set(
        c * width, 0, s * length, x,
        0, 1, 0, y + 0.012,
        -s * width, 0, c * length, z,
        0, 0, 0, 1,
      );
      mesh.setMatrixAt(mesh.count, matrix);
      strength.setX(mesh.count, dark);
      mesh.count++;
    },
    end() {
      mesh.instanceMatrix.needsUpdate = true;
      strength.needsUpdate = true;
      mesh.visible = mesh.count > 0;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      mesh.dispose();
    },
  };
}

// ---------------------------------------------------------------------------
// Spray: camera-facing puffs of mist and spray. Each puff grows, slows in
// the air, falls (droplets) or hangs and drifts downwind (mist), and fades.
// At night, churned water glows faintly blue, as the Cape sea does.

export function createSpray(parent, capacity, random) {
  const geometry = new THREE.PlaneGeometry(1, 1);
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 1,
    metalness: 0,
    transparent: true,
    depthWrite: false,
    // Billboards built in view space; the mirrored land group would cull them.
    side: THREE.DoubleSide,
  });
  const glow = { value: 0 };
  material.customProgramCacheKey = () => "animal-spray";
  material.onBeforeCompile = (shader) => {
    shader.uniforms.nightGlow = glow;
    shader.vertexShader = shader.vertexShader
      .replace("void main() {", "attribute vec2 puff;\nvarying vec4 vPuff;\nvoid main() {")
      .replace(
        "#include <defaultnormal_vertex>",
        `#include <defaultnormal_vertex>
        // A puff is lit as a rough ball facing the eye.
        transformedNormal = normalize( vec3( position.xy * 1.4, 1.0 ) );`,
      )
      .replace(
        "#include <project_vertex>",
        `vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4( 0.0, 0.0, 0.0, 1.0 );
        float size = length( instanceMatrix[ 0 ].xyz );
        mvPosition.xy += position.xy * size;
        gl_Position = projectionMatrix * mvPosition;
        vPuff = vec4( position.xy * 2.0, puff );`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("void main() {", "uniform float nightGlow;\nvarying vec4 vPuff;\nvoid main() {")
      // Always lit as facing the eye, whichever winding the mirror left it.
      .replace("#include <normal_fragment_begin>", "#include <normal_fragment_begin>\nnormal = normalize( vNormal );\nnonPerturbedNormal = normal;")
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        float fade = vPuff.z;
        float seed = vPuff.w;
        float r = length( vPuff.xy );
        // Ragged edge: a few lobes per puff, turned by its seed.
        float a = atan( vPuff.y, vPuff.x ) + seed * 1.7;
        float lobes = 0.82 + 0.12 * sin( a * 3.0 + seed ) + 0.06 * sin( a * 7.0 - seed * 2.3 );
        diffuseColor.a = fade * smoothstep( lobes, lobes * 0.35, r );`,
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += vec3( 0.12, 0.45, 0.9 ) * nightGlow * diffuseColor.a;`,
      );
  };
  // puff.x: fade 0…1, puff.y: a seed that turns each puff's ragged edge.
  const puff = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 2), 2);
  puff.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("puff", puff);
  const mesh = new THREE.InstancedMesh(geometry, material, capacity);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.count = 0;
  mesh.renderOrder = 2;
  parent.add(mesh);
  const particles = Array.from({ length: capacity }, () => ({
    live: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, age: 0, life: 1, size: 0.1, grow: 0, drag: 1, fall: 0, opacity: 1, seed: 0,
  }));
  const matrix = new THREE.Matrix4();
  let live = 0;
  return {
    mesh,
    get live() {
      return live;
    },
    // A burst of `count` puffs from (x, y, z): velocity (vx, vy, vz) with
    // `spread` m/s of scatter, each `size` m growing by `grow` m/s, living
    // `life` s; `fall` is gravity's share (1 droplets, ~0 mist), `drag` per s.
    emit({ x, y, z, count, vx = 0, vy = 0, vz = 0, spread = 1, size = 0.3, grow = 0.5, life = 2, fall = 1, drag = 0.5, opacity = 0.8 }) {
      for (const p of particles) {
        if (count <= 0) break;
        if (p.live) continue;
        count--;
        p.live = true;
        p.x = x + (random() - 0.5) * size;
        p.y = y + (random() - 0.5) * size * 0.5;
        p.z = z + (random() - 0.5) * size;
        const u = random() * 2 - 1;
        const a = random() * Math.PI * 2;
        const s = Math.sqrt(1 - u * u) * spread * random() ** 0.5;
        p.vx = vx + Math.cos(a) * s;
        p.vy = vy + u * spread * 0.5;
        p.vz = vz + Math.sin(a) * s;
        p.age = 0;
        p.life = life * (0.7 + random() * 0.6);
        p.size = size * (0.6 + random() * 0.8);
        p.grow = grow;
        p.fall = fall;
        p.drag = drag;
        p.opacity = opacity;
        p.seed = Math.floor(random() * 90);
      }
    },
    update(dt, wind, night) {
      glow.value = night * 0.6;
      live = 0;
      const wx = wind[0] * 0.6;
      const wz = wind[1] * 0.6;
      for (const p of particles) {
        if (!p.live) continue;
        p.age += dt;
        if (p.age >= p.life) {
          p.live = false;
          continue;
        }
        const k = Math.exp(-p.drag * dt);
        // Mist relaxes toward the wind; droplets keep their momentum.
        const air = 1 - p.fall;
        p.vx = p.vx * k + (wx - p.vx) * air * (1 - k);
        p.vz = p.vz * k + (wz - p.vz) * air * (1 - k);
        p.vy = p.vy * k - 9.8 * p.fall * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
        if (p.y < 0 && p.fall > 0.3) {
          p.live = false;
          continue;
        }
        p.size += p.grow * dt;
        const t = p.age / p.life;
        const fade = Math.min(1, p.age * 8) * (1 - t) * (1 - t) * p.opacity;
        matrix.makeScale(p.size, p.size, p.size);
        matrix.setPosition(p.x, p.y, p.z);
        mesh.setMatrixAt(live, matrix);
        puff.setXY(live, fade, p.seed);
        live++;
      }
      mesh.count = live;
      mesh.visible = live > 0;
      if (live) {
        mesh.instanceMatrix.needsUpdate = true;
        puff.needsUpdate = true;
      }
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      mesh.dispose();
    },
  };
}

// ---------------------------------------------------------------------------
// Small maths.

export function wrap(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}
export function clamp(v, a, b) {
  return Math.min(b, Math.max(a, v));
}
export function smooth(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
// Turn `from` toward `to` by at most `rate` radians.
export function turnToward(from, to, rate) {
  const d = wrap(to - from);
  return wrap(from + clamp(d, -rate, rate));
}
export function hash3(x, y, z) {
  const n = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return n - Math.floor(n);
}
// Value noise in 3D, 0…1.
export function noise3(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy), sz = fz * fz * (3 - 2 * fz);
  const l = (a, b, t) => a + (b - a) * t;
  const c = (i, j, k) => hash3(ix + i, iy + j, iz + k);
  return l(
    l(l(c(0, 0, 0), c(1, 0, 0), sx), l(c(0, 1, 0), c(1, 1, 0), sx), sy),
    l(l(c(0, 0, 1), c(1, 0, 1), sx), l(c(0, 1, 1), c(1, 1, 1), sx), sy),
    sz,
  );
}

function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function normalise(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
function dist2(a, b) {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
}
