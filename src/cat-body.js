import * as THREE from "three";
import { HEAD, TAIL_BONES, TAIL_LENGTH, TAIL_ROOT } from "./cat-rig.js";

// The cat's body is one closed, seamless surface: an anatomical signed
// distance field (skull, cheeks and whisker pads, ribcage, loin and rump,
// shoulder blades, haunches, forearms, hocks, toes, a tapering tail) blended
// with smooth unions, meshed once with surface nets, and skinned to the rig.
// Each primitive belongs to a bone, so a vertex's weights come from how close
// it sits to each primitive: where muscles blend into the trunk, the skin
// blends between the bones too. The face and paws are refined a level finer.
//
// Per vertex it also bakes what the coat shader needs: the bind-pose position
// (the pattern is painted in that space, so stripes ride the skin), region
// weights (head, leg, tail, paw), the direction the fur lies, fur length,
// ambient occlusion from the field, and where the lips part.

// Materials in coat.w.
export const FUR = 0;
export const EYE = 1;
export const EAR = 2;

const BIG = 1;

// Two levels of detail, as grid cells (m) for the field surface. Every pass
// of the body is bound by skinned vertices, not pixels, so each gets the
// coarsest mesh that holds up for it: the body itself (its vertices lie on
// the true surface and its normals come from the field, so even at the
// closest camera the silhouette is within ~0.2 mm), and a coarse one for
// the fur shells, the shadow map and the see-through silhouette. The face,
// paws and tail tip are refined a level at both sizes.
const LODS = { mid: 0.0066, far: 0.0115 };
const LIGHT_LODS = { mid: 0.0085, far: 0.013 };

export const buildStats = {};
export function buildCatGeometry(rig, { light = false } = {}) {
  const prims = anatomy(rig);
  const field = createField(prims);
  const out = {};
  for (const [name, cell] of Object.entries(light ? LIGHT_LODS : LODS)) {
    const t0 = performance.now();
    const mesh = surfaceNets(field, cell);
    refine(mesh, field, (v) => prims[field.dominant(v)].fine);
    const sdf = bake(mesh, field, prims, rig);
    const detail = name === "mid" ? 0.8 : 0.45;
    out[name] = assemble([sdf, ...eyes(rig, detail), ...ears(rig, detail)]);
    buildStats[name] = { ms: Math.round(performance.now() - t0), vertices: out[name].attributes.position.count };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Anatomy

function anatomy(rig) {
  const { bones } = rig;
  const prims = [];
  const world = (bone, p) => new THREE.Vector3(...p).applyMatrix4(bone.matrixWorld);
  const basisOf = (bone) => {
    const m = new THREE.Matrix4().extractRotation(bone.matrixWorld);
    return new THREE.Matrix3().setFromMatrix4(m).transpose().elements;
  };
  const defaults = { k: 0.02, region: [0, 0, 0, 0], fur: 1, comb: [0, -0.3, -1], fine: false, sub: false, sx: 1 };
  // Ellipsoid: centre and radii in the bone's frame (`axis: true`) or the
  // body frame (default).
  const ell = (bone, centre, radii, o = {}) => {
    const b = bones[bone];
    const c = o.axis ? world(b, centre) : new THREE.Vector3(...centre);
    prims.push({ ...defaults, ...o, kind: 0, bone, c, r: radii, basis: o.axis ? basisOf(b) : o.basis ?? null, R: Math.max(...radii) });
  };
  // Round cone between two points (bone frame), radius ra → rb, flattened
  // across the body by sx.
  const cone = (bone, a, bEnd, ra, rb, o = {}) => {
    const b = bones[bone];
    const A = o.body ? new THREE.Vector3(...a) : world(b, a);
    const B = o.body ? new THREE.Vector3(...bEnd) : world(b, bEnd);
    prims.push({ ...defaults, ...o, kind: 1, bone, a: A, b: B, ra, rb, c: A.clone().add(B).multiplyScalar(0.5), R: A.distanceTo(B) / 2 + Math.max(ra, rb) });
  };
  const H = (p) => [p[0] + HEAD[0], p[1] + HEAD[1], p[2] + HEAD[2]];
  const head = [1, 0, 0, 0];
  const leg = [0, 1, 0, 0];
  const paw = [0, 0, 0, 1];

  // Trunk: rump, loin, a slim waist, the deep ribcage and the keel of the
  // chest. Deep and narrow, as a cat is: ~13 cm deep, ~10 cm wide.
  ell("hips", [0, 0.018, -0.13], [0.048, 0.057, 0.058], { k: 0 });
  ell("hips", [0, 0.032, -0.077], [0.042, 0.045, 0.064], { k: 0.03 });
  ell("spine", [0, 0.028, -0.02], [0.043, 0.048, 0.07], { k: 0.03 });
  ell("ribs", [0, 0.006, 0.05], [0.05, 0.069, 0.084], { k: 0.035 });
  ell("chest", [0, -0.012, 0.11], [0.041, 0.061, 0.052], { k: 0.03, comb: [0, -1, -0.2], fur: 1.15 });
  // The belly pouch hangs loose between the hind legs, and swings.
  ell("pouch", [0, -0.02, -0.07], [0.034, 0.028, 0.055], { k: 0.03, comb: [0, -0.2, -1], fur: 1.3 });
  // Neck and ruff.
  cone("neck", [0, 0.03, 0.138], [0, 0.082, 0.2], 0.045, 0.041, { body: true, k: 0.03, comb: [0, -0.4, -1], fur: 1.2 });
  ell("neck", [0, 0.026, 0.172], [0.041, 0.043, 0.04], { k: 0.025, comb: [0, -1, -0.1], fur: 1.25 });

  // Shoulder blades: flat plates on the withers, rolling as the legs swing.
  for (const leg of rig.legs.filter((l) => l.spec.front)) {
    const scapula = leg.scapula;
    const shoulder = leg.upper.position.toArray();
    cone(scapula.name, [0, 0, 0], shoulder, 0.011, 0.02, { k: 0.022, sx: 0.55, comb: [0, -0.6, -0.8] });
  }

  // Legs.
  for (const l of rig.legs) {
    const [a, b, c] = l.spec.bones;
    const n = l.spec.name;
    const s = l.spec.side;
    const down = (bone) => {
      const top = world(bones[bone], [0, 0, 0]);
      const end = world(bones[bone], [0, -1, 0]);
      return end.sub(top).normalize().toArray();
    };
    if (l.spec.front) {
      // Upper arm with the triceps behind; the forearm, tapering to the wrist.
      cone(`${n}Upper`, [0, 0, 0], [0, -a, 0], 0.023, 0.016, { k: 0.02, sx: 0.8, region: [0, 0.6, 0, 0], comb: down(`${n}Upper`), fur: 0.85 });
      ell(`${n}Upper`, [0, -a * 0.45, -0.011], [0.016, a * 0.5, 0.019], { axis: true, k: 0.012, region: [0, 0.6, 0, 0], comb: down(`${n}Upper`), fur: 0.85 });
      cone(`${n}Lower`, [0, 0, 0], [0, -b, 0], 0.0192, 0.0132, { k: 0.012, sx: 0.85, region: leg, comb: down(`${n}Lower`), fur: 0.6 });
      ell(`${n}Lower`, [0, -b * 0.28, 0.002], [0.0135, b * 0.3, 0.015], { axis: true, k: 0.01, region: leg, comb: down(`${n}Lower`), fur: 0.6 });
      cone(`${n}Foot`, [0, 0, 0], [0, -c, 0], 0.0132, 0.0128, { k: 0.008, sx: 0.9, region: leg, comb: down(`${n}Foot`), fur: 0.5 });
      // The carpal pad on the back of the wrist.
      ell(`${n}Foot`, [0, -0.006, -0.0105], [0.0048, 0.0055, 0.0045], { axis: true, k: 0.004, region: paw, fur: 0.4, fine: true });
    } else {
      // Thigh: the femur inside a broad, flat haunch muscle. Shin with the
      // calf behind, the heel's point at the hock, then the long hock.
      cone(`${n}Upper`, [0, 0, 0], [0, -a, 0], 0.028, 0.019, { k: 0.02, sx: 0.8, region: [0, 0.4, 0, 0], comb: down(`${n}Upper`) });
      ell(`${n}Upper`, [0, -a * 0.36, -0.004], [0.027, a * 0.64, 0.047], { axis: true, k: 0.025, region: [0, 0.35, 0, 0], comb: [0, -0.6, -0.8] });
      cone(`${n}Lower`, [0, 0, 0], [0, -b, 0], 0.021, 0.0122, { k: 0.012, sx: 0.8, region: leg, comb: down(`${n}Lower`), fur: 0.75 });
      ell(`${n}Lower`, [0, -b * 0.3, -0.008], [0.014, b * 0.32, 0.017], { axis: true, k: 0.012, region: leg, comb: down(`${n}Lower`), fur: 0.75 });
      ell(`${n}Foot`, [0, 0.005, -0.008], [0.0075, 0.009, 0.0085], { axis: true, k: 0.008, region: leg, comb: [0, -1, 0], fur: 0.6 });
      cone(`${n}Foot`, [0, 0, 0], [0, -c, 0], 0.0122, 0.0118, { k: 0.008, sx: 0.85, region: leg, comb: down(`${n}Foot`), fur: 0.5 });
    }
    // Paw: a rounded pad of a foot and four toes in an arc (the middle two
    // leading), soles flat on the ground.
    const w = l.spec.front ? 1 : 0.9;
    const len = l.spec.front ? 1 : 1.06;
    ell(`${n}Paw`, [0, -0.0045, 0.006 * len], [0.0155 * w, 0.0092, 0.018 * len], { axis: true, k: 0.01, region: paw, comb: [0, -0.3, 1], fur: 0.4, fine: true });
    for (const [x, z] of [[-0.0102, 0.0185], [-0.0036, 0.0238], [0.0036, 0.0238], [0.0102, 0.0185]])
      ell(`${n}Paw`, [x * w, -0.0068, z * len], [0.0058, 0.0062, 0.0062], { axis: true, k: 0.0045, region: paw, comb: [0, -0.3, 1], fur: 0.35, fine: true });
    void s;
  }

  // Head (in the head's frame): a round cranium, the brow, broad cheeks,
  // a short muzzle with whisker pads, the nose leather, and the jaw hinged
  // beneath. Eye sockets are carved out for the eyes to sit in.
  ell("head", H([0, 0.007, -0.008]), [0.042, 0.037, 0.042], { k: 0.03, region: head, comb: [0, 0.2, -1], fur: 0.6 });
  ell("head", H([0, 0.0135, 0.013]), [0.029, 0.024, 0.027], { k: 0.016, region: head, comb: [0, 0.5, -0.9], fur: 0.5 });
  for (const side of [1, -1]) {
    ell("head", H([0.025 * side, -0.012, 0.004]), [0.027, 0.024, 0.027], { k: 0.014, region: head, comb: [side * 0.9, -0.3, -0.5], fur: 0.85 });
    ell("head", H([0.0088 * side, -0.0185, 0.0375]), [0.0108, 0.009, 0.0102], { k: 0.007, region: head, comb: [side, -0.35, -0.25], fur: 0.35, fine: true });
  }
  ell("head", H([0, -0.0085, 0.032]), [0.0125, 0.0118, 0.0148], { k: 0.011, region: head, comb: [0, 0.4, -1], fur: 0.3, fine: true });
  ell("head", H([0, -0.0064, 0.0452]), [0.0058, 0.0042, 0.0032], { k: 0.0042, region: head, comb: [0, 0.4, -1], fur: 0, fine: true, nose: true });
  ell("jaw", H([0, -0.0235, 0.012]), [0.0178, 0.0092, 0.024], { k: 0.01, region: head, comb: [0, -0.3, -1], fur: 0.5, fine: true });
  ell("jaw", H([0, -0.0272, 0.0245]), [0.0092, 0.0062, 0.0095], { k: 0.006, region: head, comb: [0, -0.4, -1], fur: 0.35, fine: true });
  for (const side of [1, -1]) {
    const socket = new THREE.Matrix4()
      .makeRotationFromEuler(new THREE.Euler(0.05, side * 0.3, side * 0.16, "YXZ"))
      .invert();
    ell("head", H([0.0184 * side, 0.0084, 0.0346]), [0.0108, 0.0112, 0.009], {
      sub: true,
      k: 0.0035,
      basis: new THREE.Matrix3().setFromMatrix4(socket).elements,
      region: head,
      fine: true,
    });
  }

  // Tail: a root that blends into the rump, then tapering segments, one
  // per bone, the tip rounded.
  const radius = (s) => 0.0148 * (1 - s * 0.4) - Math.max(0, s - 0.93) * 0.05;
  cone("tail0", [0, 0.034, -0.138], [TAIL_ROOT[0], TAIL_ROOT[1], TAIL_ROOT[2] - 0.03], 0.019, radius(0.1), { body: true, k: 0.02, region: [0, 0, 0.6, 0], comb: [0, 0.1, -1], fur: 1.1 });
  for (let i = 0; i < TAIL_BONES; i++) {
    const s0 = i / TAIL_BONES;
    const s1 = (i + 1) / TAIL_BONES;
    const z0 = TAIL_ROOT[2] - s0 * TAIL_LENGTH;
    const z1 = TAIL_ROOT[2] - s1 * TAIL_LENGTH;
    cone(`tail${i}`, [TAIL_ROOT[0], TAIL_ROOT[1], z0], [TAIL_ROOT[0], TAIL_ROOT[1], z1], radius(s0), Math.max(0.0042, radius(s1)), {
      body: true,
      k: 0.006,
      region: [0, 0, 1, 0],
      comb: [0, 0, -1],
      fur: 1.15 + s1 * 0.25,
      fine: s1 > 0.85,
    });
  }
  prims.forEach((p, i) => (p.index = i));
  return prims;
}

// ---------------------------------------------------------------------------
// Field

function ellipsoidDistance(p, x, y, z) {
  let qx = x - p.c.x;
  let qy = y - p.c.y;
  let qz = z - p.c.z;
  if (p.basis) {
    const m = p.basis;
    const tx = m[0] * qx + m[3] * qy + m[6] * qz;
    const ty = m[1] * qx + m[4] * qy + m[7] * qz;
    const tz = m[2] * qx + m[5] * qy + m[8] * qz;
    qx = tx;
    qy = ty;
    qz = tz;
  }
  const [rx, ry, rz] = p.r;
  const k0 = Math.sqrt((qx / rx) ** 2 + (qy / ry) ** 2 + (qz / rz) ** 2);
  const k1 = Math.sqrt((qx / (rx * rx)) ** 2 + (qy / (ry * ry)) ** 2 + (qz / (rz * rz)) ** 2);
  if (k1 < 1e-9) return -Math.min(rx, ry, rz);
  return (k0 * (k0 - 1)) / k1;
}

// Inigo Quilez's round cone, flattened across the body by sx.
function coneDistance(p, x, y, z) {
  const ax = p.a.x, ay = p.a.y, az = p.a.z;
  const px = ax + (x - ax) / p.sx - ax;
  const py = y - ay;
  const pz = z - az;
  const bax = p.b.x - ax, bay = p.b.y - ay, baz = p.b.z - az;
  const l2 = bax * bax + bay * bay + baz * baz;
  const rr = p.ra - p.rb;
  const a2 = l2 - rr * rr;
  const il2 = 1 / l2;
  const yy = px * bax + py * bay + pz * baz;
  const zz = yy - l2;
  const xvx = px * l2 - bax * yy, xvy = py * l2 - bay * yy, xvz = pz * l2 - baz * yy;
  const x2 = xvx * xvx + xvy * xvy + xvz * xvz;
  const y2 = yy * yy * l2;
  const z2 = zz * zz * l2;
  const k = Math.sign(rr) * rr * rr * x2;
  let d;
  if (Math.sign(zz) * a2 * z2 > k) d = Math.sqrt(x2 + z2) * il2 - p.rb;
  else if (Math.sign(yy) * a2 * y2 < k) d = Math.sqrt(x2 + y2) * il2 - p.ra;
  else d = (Math.sqrt((x2 * a2) * il2) + yy * rr) * il2 - p.ra;
  return d * Math.min(1, p.sx);
}

function smin(a, b, k) {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

function createField(prims) {
  const each = new Float64Array(prims.length);
  const primDistance = (p, x, y, z) => {
    const dx = x - p.c.x, dy = y - p.c.y, dz = z - p.c.z;
    const bound = Math.sqrt(dx * dx + dy * dy + dz * dz) - p.R;
    if (bound > 0.03) return bound;
    return p.kind === 0 ? ellipsoidDistance(p, x, y, z) : coneDistance(p, x, y, z);
  };
  const evaluate = (x, y, z, list = prims, record = false) => {
    let d = BIG;
    for (const p of list) {
      const di = primDistance(p, x, y, z);
      if (record) each[p.index] = di;
      d = p.sub ? -smin(-d, di, p.k) : smin(d, di, p.k);
    }
    return d;
  };
  // Primitives that can matter within r of a point.
  const near = (x, y, z, r = 0.05) => prims.filter((p) => Math.hypot(x - p.c.x, y - p.c.y, z - p.c.z) - p.R < r);
  return {
    prims,
    evaluate,
    near,
    each,
    // Distances to every primitive at a point (for weights).
    measure(x, y, z) {
      evaluate(x, y, z, prims, true);
      return each;
    },
    dominant([x, y, z]) {
      evaluate(x, y, z, prims, true);
      let best = 0;
      for (let i = 1; i < prims.length; i++) if (!prims[i].sub && each[i] < each[best]) best = i;
      return best;
    },
    gradient(x, y, z, out, list = prims, e = 0.0004) {
      out[0] = evaluate(x + e, y, z, list) - evaluate(x - e, y, z, list);
      out[1] = evaluate(x, y + e, z, list) - evaluate(x, y - e, z, list);
      out[2] = evaluate(x, y, z + e, list) - evaluate(x, y, z - e, list);
      const l = Math.hypot(out[0], out[1], out[2]) || 1;
      out[0] /= l;
      out[1] /= l;
      out[2] /= l;
      return out;
    },
    // Newton steps onto the zero set.
    project(v, list = near(v[0], v[1], v[2], 0.03)) {
      const g = [0, 0, 0];
      for (let i = 0; i < 4; i++) {
        const d = evaluate(v[0], v[1], v[2], list);
        if (Math.abs(d) < 2e-6) break;
        this.gradient(v[0], v[1], v[2], g, list);
        v[0] -= g[0] * d;
        v[1] -= g[1] * d;
        v[2] -= g[2] * d;
      }
      return v;
    },
  };
}

// ---------------------------------------------------------------------------
// Meshing: naive surface nets on a sparse grid. Only 8³ blocks near the
// surface are evaluated (the field is ~1-Lipschitz), each against only the
// primitives that can reach it.

function surfaceNets(field, h) {
  const { prims } = field;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const p of prims) {
    if (p.sub) continue;
    for (let i = 0; i < 3; i++) {
      const c = p.c.getComponent(i);
      min[i] = Math.min(min[i], c - p.R);
      max[i] = Math.max(max[i], c + p.R);
    }
  }
  const n = [0, 1, 2].map((i) => Math.ceil((max[i] - min[i]) / h) + 5);
  const origin = [0, 1, 2].map((i) => min[i] - 2 * h);
  const [nx, ny, nz] = n;
  const values = new Float32Array(nx * ny * nz);
  const B = 8;
  const blockRadius = (B * h * Math.sqrt(3)) / 2;
  for (let bk = 0; bk < nz; bk += B)
    for (let bj = 0; bj < ny; bj += B)
      for (let bi = 0; bi < nx; bi += B) {
        const cx = origin[0] + (bi + B / 2) * h;
        const cy = origin[1] + (bj + B / 2) * h;
        const cz = origin[2] + (bk + B / 2) * h;
        const near = prims.filter((p) => Math.hypot(cx - p.c.x, cy - p.c.y, cz - p.c.z) - p.R < blockRadius + 0.03);
        const centre = near.length ? field.evaluate(cx, cy, cz, near) : BIG;
        const skip = Math.abs(centre) > blockRadius * 1.3 + h;
        for (let k = bk; k < Math.min(nz, bk + B); k++)
          for (let j = bj; j < Math.min(ny, bj + B); j++)
            for (let i = bi; i < Math.min(nx, bi + B); i++) {
              const at = i + nx * (j + ny * k);
              values[at] = skip ? Math.sign(centre) * BIG : field.evaluate(origin[0] + i * h, origin[1] + j * h, origin[2] + k * h, near);
            }
      }
  // One vertex per cell that the surface crosses, at the mean of its edge
  // crossings, then projected onto the true surface.
  const cellVertex = new Int32Array(nx * ny * nz).fill(-1);
  const verts = [];
  const corner = new Float32Array(8);
  const EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
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
        field.project(v);
        cellVertex[i + nx * (j + ny * k)] = verts.length;
        verts.push(v);
      }
  // A quad across every grid edge with a sign change, joining the four
  // cells around it.
  const tris = [];
  const cellAt = (i, j, k) => cellVertex[i + nx * (j + ny * k)];
  const quad = (a, b, c, d) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    // Split along the shorter diagonal.
    const ac = dist2(verts[a], verts[c]);
    const bd = dist2(verts[b], verts[d]);
    if (ac < bd) tris.push(a, b, c, a, c, d);
    else tris.push(a, b, d, b, c, d);
  };
  for (let k = 1; k < nz - 1; k++)
    for (let j = 1; j < ny - 1; j++)
      for (let i = 1; i < nx - 1; i++) {
        const at = values[i + nx * (j + ny * k)] < 0;
        if (at !== values[i + 1 + nx * (j + ny * k)] < 0) quad(cellAt(i, j - 1, k - 1), cellAt(i, j, k - 1), cellAt(i, j, k), cellAt(i, j - 1, k));
        if (at !== values[i + nx * (j + 1 + ny * k)] < 0) quad(cellAt(i - 1, j, k - 1), cellAt(i, j, k - 1), cellAt(i, j, k), cellAt(i - 1, j, k));
        if (at !== values[i + nx * (j + ny * (k + 1))] < 0) quad(cellAt(i - 1, j - 1, k), cellAt(i, j - 1, k), cellAt(i, j, k), cellAt(i - 1, j, k));
      }
  return { verts, tris };
}

function dist2(a, b) {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
}

// Red-green refinement: triangles touching fine features split in four;
// their neighbours split just the shared edges, so no cracks open. New
// vertices are projected onto the field.
function refine(mesh, field, isFine) {
  const { verts, tris } = mesh;
  const fine = verts.map((v) => isFine(v));
  const split = new Map();
  const key = (a, b) => (a < b ? a * 4194304 + b : b * 4194304 + a);
  for (let t = 0; t < tris.length; t += 3) {
    const [a, b, c] = [tris[t], tris[t + 1], tris[t + 2]];
    if (!(fine[a] || fine[b] || fine[c])) continue;
    for (const [p, q] of [[a, b], [b, c], [c, a]]) {
      const k = key(p, q);
      if (split.has(k)) continue;
      const m = [(verts[p][0] + verts[q][0]) / 2, (verts[p][1] + verts[q][1]) / 2, (verts[p][2] + verts[q][2]) / 2];
      field.project(m);
      split.set(k, verts.length);
      verts.push(m);
    }
  }
  const out = [];
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t], b = tris[t + 1], c = tris[t + 2];
    const m0 = split.get(key(a, b));
    const m1 = split.get(key(b, c));
    const m2 = split.get(key(c, a));
    const s = (m0 !== undefined) + (m1 !== undefined) * 2 + (m2 !== undefined) * 4;
    switch (s) {
      case 0: out.push(a, b, c); break;
      case 1: out.push(a, m0, c, m0, b, c); break;
      case 2: out.push(a, b, m1, a, m1, c); break;
      case 4: out.push(a, b, m2, m2, b, c); break;
      case 3: out.push(m0, b, m1, a, m0, m1, a, m1, c); break;
      case 6: out.push(m2, m1, c, a, b, m1, a, m1, m2); break;
      case 5: out.push(a, m0, m2, m0, b, c, m0, c, m2); break;
      default: out.push(a, m0, m2, m0, b, m1, m2, m1, c, m0, m1, m2);
    }
  }
  mesh.tris = out;
}

// ---------------------------------------------------------------------------
// Per-vertex attributes for the field surface.

function bake(mesh, field, prims, rig) {
  const { verts, tris } = mesh;
  const count = verts.length;
  const boneIndex = new Map(rig.list.map((b, i) => [b.name, i]));
  const jaw = boneIndex.get("jaw");
  const out = part(count);
  const g = [0, 0, 0];
  const weights = new Map();
  const region = [0, 0, 0, 0];
  const comb = [0, 0, 0];
  const AO_STEPS = [0.004, 0.009, 0.016, 0.026, 0.04];
  const AO_WEIGHTS = [0.32, 0.26, 0.2, 0.14, 0.08];
  for (let v = 0; v < count; v++) {
    const [x, y, z] = verts[v];
    const list = field.near(x, y, z, 0.06);
    field.gradient(x, y, z, g, list);
    const each = field.measure(x, y, z);
    let dmin = Infinity;
    for (const p of prims) if (!p.sub) dmin = Math.min(dmin, each[p.index]);
    weights.clear();
    region.fill(0);
    comb.fill(0);
    let fur = 0;
    let total = 0;
    let nose = 0;
    for (const p of prims) {
      if (p.sub) continue;
      const blend = Math.max(0.005, p.k * 0.7);
      const t = 1 - (each[p.index] - dmin) / blend;
      if (t <= 0) continue;
      const w = t * t;
      const bone = boneIndex.get(p.bone);
      weights.set(bone, Math.max(weights.get(bone) ?? 0, w));
      for (let i = 0; i < 4; i++) region[i] += p.region[i] * w;
      const cl = Math.hypot(...p.comb) || 1;
      for (let i = 0; i < 3; i++) comb[i] += (p.comb[i] / cl) * w;
      fur += p.fur * w;
      if (p.nose) nose += w;
      total += w;
    }
    // Four strongest bones.
    const top = [...weights].sort((a, b) => b[1] - a[1]).slice(0, 4);
    const sum = top.reduce((s, [, w]) => s + w, 0);
    for (let i = 0; i < 4; i++) {
      out.skinIndex[v * 4 + i] = top[i] ? top[i][0] : 0;
      out.skinWeight[v * 4 + i] = top[i] ? top[i][1] / sum : 0;
    }
    // Fur lies along the skin: project the comb onto the tangent plane.
    const dot = comb[0] * g[0] + comb[1] * g[1] + comb[2] * g[2];
    let cx = comb[0] - g[0] * dot, cy = comb[1] - g[1] * dot, cz = comb[2] - g[2] * dot;
    const cl = Math.hypot(cx, cy, cz) || 1;
    cx /= cl;
    cy /= cl;
    cz /= cl;
    // Occlusion from the field: how much of the space just outside the skin
    // is taken up by the cat's own body (armpits, under the chin, between
    // the legs, the base of the ears).
    let occ = 0;
    for (let i = 0; i < AO_STEPS.length; i++) {
      const hgt = AO_STEPS[i];
      const d = field.evaluate(x + g[0] * hgt, y + g[1] * hgt, z + g[2] * hgt, list);
      occ += (Math.max(0, hgt - d) / hgt) * AO_WEIGHTS[i];
    }
    const ao = Math.max(0.42, 1 - occ * 1.3);
    // The lip line: where the skin is shared between the head and the jaw.
    const jw = top.find(([b]) => b === jaw)?.[1] / sum || 0;
    const mouth = Math.max(0, 1 - Math.abs(jw - 0.5) * 2.4) * (z > HEAD[2] + 0.02 ? 1 : 0);
    out.position.set([x, y, z], v * 3);
    out.normal.set(g, v * 3);
    out.coat.set([x, y, z, FUR], v * 4);
    out.region.set(region.map((r) => r / total), v * 4);
    // Fur is very short round the eyes, so it never grows over them.
    let nearEye = 1;
    for (const side of [1, -1]) {
      const e = eyeCentre(side);
      const d = Math.hypot(x - e[0] - HEAD[0], y - e[1] - HEAD[1], z - e[2] - HEAD[2]);
      nearEye = Math.min(nearEye, THREE.MathUtils.smoothstep(d, EYE_RADIUS * 1.05, EYE_RADIUS * 1.9));
    }
    out.furInfo.set([ao, (fur / total) * nearEye, mouth, nose / total], v * 4);
    out.comb.set([cx, cy, cz], v * 3);
  }
  // Wind triangles to face along the field's gradient.
  const index = [];
  for (let t = 0; t < tris.length; t += 3) {
    const [a, b, c] = [tris[t], tris[t + 1], tris[t + 2]];
    const A = verts[a], Bv = verts[b], C = verts[c];
    const ux = Bv[0] - A[0], uy = Bv[1] - A[1], uz = Bv[2] - A[2];
    const wx = C[0] - A[0], wy = C[1] - A[1], wz = C[2] - A[2];
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const gn = out.normal;
    const along = nx * (gn[a * 3] + gn[b * 3] + gn[c * 3]) + ny * (gn[a * 3 + 1] + gn[b * 3 + 1] + gn[c * 3 + 1]) + nz * (gn[a * 3 + 2] + gn[b * 3 + 2] + gn[c * 3 + 2]);
    if (along >= 0) index.push(a, b, c);
    else index.push(a, c, b);
  }
  out.index = index;
  return out;
}

function part(count) {
  return {
    count,
    position: new Float32Array(count * 3),
    normal: new Float32Array(count * 3),
    skinIndex: new Uint16Array(count * 4),
    skinWeight: new Float32Array(count * 4),
    coat: new Float32Array(count * 4),
    region: new Float32Array(count * 4),
    furInfo: new Float32Array(count * 4),
    comb: new Float32Array(count * 3),
    index: [],
  };
}

// ---------------------------------------------------------------------------
// Eyes: globes set into the sockets, gazing forward and a little out. The
// coat coordinates are the eye's own (+z along the gaze, x outward), so the
// iris and pupil are drawn per pixel.

export const EYE_RADIUS = 0.0102;
export function eyeCentre(side) {
  return [0.0184 * side, 0.0066, 0.027];
}
export const EYE_GAZE = { yaw: 0.26, pitch: -0.04 };

function eyes(rig, detail = 1) {
  const head = rig.list.findIndex((b) => b.name === "head");
  return [1, -1].map((side) => {
    const g = new THREE.SphereGeometry(EYE_RADIUS, Math.round(22 * detail), Math.round(16 * detail));
    const out = part(g.attributes.position.count);
    const c = eyeCentre(side);
    const toGaze = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(EYE_GAZE.pitch, side * EYE_GAZE.yaw, 0, "YXZ")).invert();
    const q = new THREE.Vector3();
    for (let i = 0; i < out.count; i++) {
      q.fromBufferAttribute(g.attributes.position, i);
      const local = q.clone().applyMatrix4(toGaze);
      out.position.set([q.x + c[0] + HEAD[0], q.y + c[1] + HEAD[1], q.z + c[2] + HEAD[2]], i * 3);
      const nrm = q.clone().normalize();
      out.normal.set(nrm.toArray(), i * 3);
      // coat.w carries the side (1 left, 1.25 right) for the lids.
      out.coat.set([local.x, local.y, local.z, EYE + (side < 0 ? 0.25 : 0)], i * 4);
      out.skinIndex[i * 4] = head;
      out.skinWeight[i * 4] = 1;
      out.region.set([1, 0, 0, 0], i * 4);
      out.furInfo.set([1, 0, 0, 0], i * 4);
      out.comb.set([0, 1, 0], i * 3);
    }
    out.index = Array.from(g.index.array);
    g.dispose();
    return out;
  });
}

// ---------------------------------------------------------------------------
// Ears: thin cupped shells, tall and wide at the base with rounded tips,
// the inner face pink skin with pale furnishings. coat.xyz = (u across,
// v up, 1 on the inner face).

export const EAR_HEIGHT = 0.05;
export function earPose(side) {
  return new THREE.Euler(-0.1, side * 0.14, -side * 0.3, "YXZ");
}

function ears(rig, detail = 1) {
  const index = new Map(rig.list.map((b, i) => [b.name, i]));
  const head = index.get("head");
  const U = Math.max(4, Math.round(12 * detail));
  const V = Math.max(5, Math.round(14 * detail));
  return [1, -1].map((side) => {
    const bone = rig.bones[side > 0 ? "earL" : "earR"];
    const base = bone.getWorldPosition(new THREE.Vector3());
    const pose = new THREE.Matrix4().makeRotationFromEuler(earPose(side));
    const width = (v) => 0.0195 * (1 - v) * (1 + 1.2 * v);
    const cup = (u, v) => -0.0085 * (1 - u * u) * (1 - 0.55 * v);
    const sheets = [];
    for (const inner of [1, 0])
      for (let j = 0; j <= V; j++)
        for (let i = 0; i <= U; i++) {
          const u = (i / U) * 2 - 1;
          const v = j / V;
          const thick = 0.0021 * (1 - 0.6 * v) + 0.0016 * (1 - u * u) * (1 - v);
          const p = new THREE.Vector3(u * width(v), v * EAR_HEIGHT - 0.005, cup(u, v) - (inner ? 0 : thick));
          sheets.push({ p: p.applyMatrix4(pose).add(base), u, v, inner });
        }
    const out = part(sheets.length);
    sheets.forEach((s, i) => {
      out.position.set(s.p.toArray(), i * 3);
      out.coat.set([s.u * side, s.v, s.inner, EAR], i * 4);
      // Rooted in the skull at the base, the ear bone above.
      const w = THREE.MathUtils.smoothstep(s.v, 0.02, 0.25);
      out.skinIndex.set([index.get(bone.name), head, 0, 0], i * 4);
      out.skinWeight.set([w, 1 - w, 0, 0], i * 4);
      out.region.set([1, 0, 0, 0], i * 4);
      out.furInfo.set([s.inner ? 0.45 + s.v * 0.5 : 0.8 + s.v * 0.2, s.inner ? 0.7 * (1 - s.v) : 0.4, 0, 0], i * 4);
    });
    const at = (inner, i, j) => (inner ? 0 : (U + 1) * (V + 1)) + j * (U + 1) + i;
    const tri = [];
    for (let j = 0; j < V; j++) {
      for (let i = 0; i < U; i++) {
        tri.push(at(1, i, j), at(1, i + 1, j), at(1, i, j + 1), at(1, i + 1, j), at(1, i + 1, j + 1), at(1, i, j + 1));
        tri.push(at(0, i, j), at(0, i, j + 1), at(0, i + 1, j), at(0, i + 1, j), at(0, i, j + 1), at(0, i + 1, j + 1));
      }
      // The rim joins the two faces along both edges.
      tri.push(at(1, U, j), at(0, U, j), at(1, U, j + 1), at(0, U, j), at(0, U, j + 1), at(1, U, j + 1));
      tri.push(at(1, 0, j), at(1, 0, j + 1), at(0, 0, j), at(0, 0, j), at(1, 0, j + 1), at(0, 0, j + 1));
    }
    out.index = tri;
    // Normals from the faces; fur lies up toward the tip.
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(out.position, 3));
    g.setIndex(tri);
    g.computeVertexNormals();
    out.normal.set(g.attributes.normal.array);
    const up = new THREE.Vector3(0, 1, 0).applyMatrix4(pose);
    for (let i = 0; i < out.count; i++) out.comb.set(up.toArray(), i * 3);
    g.dispose();
    return out;
  });
}

// ---------------------------------------------------------------------------

function assemble(parts) {
  const total = parts.reduce((s, p) => s + p.count, 0);
  const all = part(total);
  const index = [];
  let offset = 0;
  for (const p of parts) {
    for (const key of ["position", "normal", "comb"]) all[key].set(p[key], offset * 3);
    for (const key of ["skinIndex", "skinWeight", "coat", "region", "furInfo"]) all[key].set(p[key], offset * 4);
    for (const i of p.index) index.push(i + offset);
    offset += p.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(all.position, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(all.normal, 3));
  g.setAttribute("skinIndex", new THREE.BufferAttribute(all.skinIndex, 4));
  g.setAttribute("skinWeight", new THREE.BufferAttribute(all.skinWeight, 4));
  g.setAttribute("coat", new THREE.BufferAttribute(all.coat, 4));
  g.setAttribute("region", new THREE.BufferAttribute(all.region, 4));
  g.setAttribute("furInfo", new THREE.BufferAttribute(all.furInfo, 4));
  g.setAttribute("comb", new THREE.BufferAttribute(all.comb, 3));
  g.setIndex(total > 65535 ? new THREE.Uint32BufferAttribute(index, 1) : new THREE.Uint16BufferAttribute(index, 1));
  g.computeBoundingSphere();
  return g;
}
