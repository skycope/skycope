import * as THREE from "three";
import { seededRandom } from "./random.js";

// Unit plant organs, built once and instanced thousands of times (forest.js).
// Each is grown the way the organ grows, not modelled as a shape: blades
// arch from a crown, pinnae shorten along a rachis, succulent leaves keel and
// recurve, needles spiral up a shoot. Vertex colour carries the organ's own
// gradients (a dark sheath, a dry tip, a pale bract base) and multiplies the
// instance colour; `leafFlutter` (phase, hinge weight) lets every blade or
// leaflet flutter on its own stalk. No textures.

const GOLDEN_ANGLE = 2.39996;

function mesher() {
  const positions = [];
  const colours = [];
  const flutter = [];
  const indices = [];
  return {
    indices,
    vertex(p, colour, phase = 0, hinge = 0) {
      positions.push(p.x, p.y, p.z);
      colours.push(colour[0], colour[1], colour[2]);
      flutter.push(phase, hinge);
      return positions.length / 3 - 1;
    },
    tri(a, b, c) {
      indices.push(a, b, c);
    },
    finish() {
      return finish(positions, indices, colours, flutter);
    },
  };
}

export function finish(positions, indices, colours = null, flutter = null) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  if (colours) geometry.setAttribute("color", new THREE.Float32BufferAttribute(colours, 3));
  if (flutter) geometry.setAttribute("leafFlutter", new THREE.Float32BufferAttribute(flutter, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

// A grass tuft grown from one crown. Tillers rise close together; the inner
// ones stand, the outer ones arch out and over under their own weight, and
// each twists a little. Blades are 4–7 mm wide at cat scale, sheathed dark
// at the base, green through the middle, and a third dry to straw at the
// tip. Some tufts carry flowering culms: a straight stem with a nodding
// panicle of spikelets. `levels` rows per blade.
export function tuftGeometry(blades = 24, levels = 3, heads = 0) {
  const m = mesher();
  const random = seededRandom(11);
  const widen = Math.sqrt(24 / blades);
  const v = new THREE.Vector3();
  for (let b = 0; b < blades; b++) {
    const azimuth = b * GOLDEN_ANGLE + random() * 0.5;
    const outer = b / blades;
    const lean = 0.05 + Math.pow(outer, 1.3) * 0.75 + random() * 0.15;
    const height = (0.45 + random() * 0.6) * (1 - outer * 0.3);
    const width = (0.009 + random() * 0.006) * widen;
    const twist = (random() - 0.5) * 1.8;
    const dry = random() < 0.3 ? 0.6 + random() * 0.4 : 0;
    const phase = random();
    const out = new THREE.Vector3(Math.cos(azimuth), 0, Math.sin(azimuth));
    const across = new THREE.Vector3(-out.z, 0, out.x);
    const base = out.clone().multiplyScalar(0.01 + outer * 0.05);
    const at = (t) =>
      v.copy(base).addScaledVector(out, lean * height * t * t).setY(height * (t - lean * 0.55 * t * t)).clone();
    const colour = (t) => {
      const k = 0.3 + 0.52 * Math.min(1, t * 1.7);
      const straw = dry * Math.max(0, (t - 0.5) / 0.5);
      return [k * (1 + straw * 1.0), k * (1 + straw * 0.4), k * (1 - straw * 0.2)];
    };
    const first = [];
    for (let i = 0; i < levels; i++) {
      const t = i / levels;
      const p = at(t);
      const a = across.clone().multiplyScalar(Math.cos(twist * t)).addScaledVector(out, Math.sin(twist * t));
      const w = width * (1 - t * 0.7);
      first.push(
        m.vertex(p.clone().addScaledVector(a, -w), colour(t), phase, t * t),
        m.vertex(p.clone().addScaledVector(a, w), colour(t), phase, t * t),
      );
    }
    const tip = m.vertex(at(1), colour(1), phase, 1);
    for (let i = 0; i < levels - 1; i++) {
      const [a, b1, c, d] = [first[i * 2], first[i * 2 + 1], first[i * 2 + 2], first[i * 2 + 3]];
      m.tri(a, c, b1);
      m.tri(b1, c, d);
    }
    m.tri(first[(levels - 1) * 2], tip, first[(levels - 1) * 2 + 1]);
  }
  for (let h = 0; h < heads; h++) {
    // A flowering culm: straight, a little taller than the leaves, with a
    // loose panicle of straw spikelets nodding from its top.
    const azimuth = h * 2.1 + random();
    const lean = 0.08 + random() * 0.12;
    const top = new THREE.Vector3(Math.cos(azimuth) * lean, 1.2 + random() * 0.35, Math.sin(azimuth) * lean);
    const across = new THREE.Vector3(-Math.sin(azimuth), 0, Math.cos(azimuth)).multiplyScalar(0.005);
    const stem = [0.62, 0.6, 0.45];
    const phase = random();
    const a = m.vertex(across.clone().negate(), stem, phase, 0);
    const b1 = m.vertex(across.clone(), stem, phase, 0);
    const t = m.vertex(top, [0.9, 0.85, 0.6], phase, 1);
    m.tri(a, t, b1);
    for (let s = 0; s < 9; s++) {
      // Spikelets on fine branches down the top of the culm, nodding.
      const angle = azimuth + s * GOLDEN_ANGLE;
      const at = top.clone().lerp(new THREE.Vector3(0, 0, 0), s * 0.022);
      const hang = new THREE.Vector3(Math.cos(angle) * 0.05, -0.05 - random() * 0.05, Math.sin(angle) * 0.05);
      const start = at.clone().addScaledVector(hang, 0.3);
      const side = new THREE.Vector3(-Math.sin(angle), 0, Math.cos(angle)).multiplyScalar(0.005);
      const straw = [0.95, 0.85, 0.55];
      const p0 = m.vertex(start.clone().sub(side), straw, phase, 1);
      const p1 = m.vertex(start.clone().add(side), straw, phase, 1);
      const p2 = m.vertex(at.clone().add(hang), straw, phase, 1);
      m.tri(p0, p2, p1);
    }
  }
  return m.finish();
}

// Restio (Cape reed): a dense clump of fine, leafless culms. The centre
// culms stand straight, the outer ones lean; each has a dark sheathed base,
// grey-green length and a tan tip, and a third end in brown spikelet
// clusters.
export function reedGeometry(culms = 30, detail = 1) {
  const m = mesher();
  const random = seededRandom(23);
  for (let c = 0; c < culms; c++) {
    const azimuth = random() * Math.PI * 2;
    const lean = Math.sqrt(random()) * 0.38;
    const length = (0.6 + random() * 0.4) * (1 - lean * 0.45);
    const dir = new THREE.Vector3(Math.cos(azimuth) * Math.sin(lean), Math.cos(lean), Math.sin(azimuth) * Math.sin(lean));
    const side = new THREE.Vector3(-Math.sin(azimuth), 0, Math.cos(azimuth)).multiplyScalar(0.0055);
    const base = new THREE.Vector3(Math.cos(azimuth), 0, Math.sin(azimuth)).multiplyScalar(0.03 * random());
    const phase = random();
    const sheath = [0.42, 0.32, 0.22];
    const culm = [0.85, 0.9, 0.8];
    const tan = [1.3, 1.05, 0.7];
    const mid = base.clone().addScaledVector(dir, length * 0.5);
    const tip = base.clone().addScaledVector(dir, length);
    if (detail) {
      const a = m.vertex(base.clone().sub(side), sheath, phase, 0);
      const b = m.vertex(base.clone().add(side), sheath, phase, 0);
      const e = m.vertex(mid.clone().sub(side), culm, phase, 0.25);
      const f = m.vertex(mid.clone().add(side), culm, phase, 0.25);
      const t = m.vertex(tip, tan, phase, 1);
      m.tri(a, e, b);
      m.tri(b, e, f);
      m.tri(e, t, f);
    } else {
      const a = m.vertex(base.clone().addScaledVector(side, -1.6), sheath, phase, 0);
      const b = m.vertex(base.clone().addScaledVector(side, 1.6), sheath, phase, 0);
      const t = m.vertex(tip, culm, phase, 1);
      m.tri(a, t, b);
    }
    if (detail && random() < 0.35) {
      // Spikelets: a few small brown scales clustered at the culm's tip.
      const brown = [0.75, 0.48, 0.28];
      for (let s = 0; s < 3; s++) {
        const up = tip.clone().addScaledVector(dir, -0.02 - s * 0.03);
        const spread = new THREE.Vector3(Math.cos(azimuth + s * 2.1), 0, Math.sin(azimuth + s * 2.1)).multiplyScalar(0.018);
        const p0 = m.vertex(up.clone().addScaledVector(dir, -0.025), brown, phase, 1);
        const p1 = m.vertex(up.clone().add(spread), brown, phase, 1);
        const p2 = m.vertex(up.clone().addScaledVector(dir, 0.025), brown, phase, 1);
        const p3 = m.vertex(up.clone().sub(spread), brown, phase, 1);
        m.tri(p0, p1, p2);
        m.tri(p0, p2, p3);
      }
    }
  }
  return m.finish();
}

// A pinnate frond, unit length, rising from the origin along +z and arching
// over under its own weight. Paired pinnae stand out from the rachis in a
// shallow V, longest a third of the way up and shortening to the tip (the
// lanceolate outline of a fern frond); near pinnae are lobed into pinnules,
// the youngest near the tip are yellower. `detail` 2: lobed pinnae; 1: leaf
// cards; 0: one triangle per pinna. Palms use it stretched sideways.
export function frondGeometry(pairs = 16, detail = 2) {
  const m = mesher();
  const random = seededRandom(31);
  const rachis = (t) => new THREE.Vector3(0, 0.62 * Math.sin(2.0 * t) - 0.34 * t * t, t * 0.8);
  const tangent = (t) => rachis(t + 0.01).sub(rachis(t - 0.01)).normalize();
  const up = new THREE.Vector3(0, 1, 0);
  // The rachis: a thin tapering ribbon.
  const rows = detail ? 6 : 3;
  const stalk = [0.62, 0.55, 0.38];
  let previous = null;
  for (let i = 0; i <= rows; i++) {
    const t = i / rows;
    const p = rachis(t);
    const w = 0.011 * (1 - t * 0.8);
    const pair = [m.vertex(p.clone().setX(-w), stalk, 0, t * 0.3), m.vertex(p.clone().setX(w), stalk, 0, t * 0.3)];
    if (previous) {
      m.tri(previous[0], pair[0], previous[1]);
      m.tri(previous[1], pair[0], pair[1]);
    }
    previous = pair;
  }
  for (let i = 0; i < pairs; i++) {
    const t = 0.1 + 0.88 * (i + 0.5) / pairs;
    const base = rachis(t);
    const along = tangent(t);
    const length = 0.3 * Math.sin(Math.PI * Math.pow(t, 0.72)) * (0.9 + random() * 0.2);
    const young = Math.max(0, (t - 0.72) / 0.28);
    for (const sign of [-1, 1]) {
      const dir = new THREE.Vector3(sign, 0, 0)
        .addScaledVector(along, 0.5)
        .addScaledVector(up, -0.12 - 0.22 * t)
        .normalize();
      // Pinna plane: its own direction and the frond's surface across it.
      const face = new THREE.Vector3().crossVectors(along, dir).multiplyScalar(sign).normalize();
      const side = new THREE.Vector3().crossVectors(face, dir).normalize();
      const phase = random();
      const colour = (s) => {
        const k = 0.7 + 0.3 * s;
        return [k * (1 + young * 0.25), k * (1 + young * 0.1), k * (1 - young * 0.3)];
      };
      const hinge = (s) => s * (0.4 + 0.6 * t);
      const point = (s, across) => base.clone().addScaledVector(dir, length * s).addScaledVector(side, across).addScaledVector(face, -0.06 * length * s * s);
      if (detail === 2) {
        // Three lobes a side: the pinna's pinnules.
        const mid = [0, 0.33, 0.66, 1].map((s) => m.vertex(point(s, 0), colour(s), phase, hinge(s)));
        for (let k = 0; k < 3; k++) {
          const s = 0.2 + k * 0.3;
          const w = 0.3 * length * (1 - s * 0.65);
          const l = m.vertex(point(s + 0.06, -w), colour(s), phase, hinge(s));
          const r = m.vertex(point(s + 0.06, w), colour(s), phase, hinge(s));
          m.tri(mid[k], l, mid[k + 1]);
          m.tri(mid[k], mid[k + 1], r);
        }
      } else if (detail === 1) {
        const w = 0.22 * length;
        const b = m.vertex(point(0, 0), colour(0), phase, 0);
        const l = m.vertex(point(0.4, -w), colour(0.4), phase, hinge(0.4));
        const r = m.vertex(point(0.4, w), colour(0.4), phase, hinge(0.4));
        const tip = m.vertex(point(1, 0), colour(1), phase, hinge(1));
        m.tri(b, l, r);
        m.tri(l, tip, r);
      } else {
        const w = 0.2 * length;
        const l = m.vertex(point(0.1, -w), colour(0.1), phase, 0);
        const r = m.vertex(point(0.1, w), colour(0.1), phase, 0);
        const tip = m.vertex(point(1, 0), colour(1), phase, hinge(1));
        m.tri(l, tip, r);
      }
    }
  }
  return m.finish();
}

// A succulent (aloe) leaf, unit length along +y, its upper face toward +z:
// thick at the base and tapering to a point, the upper face channelled and
// the underside keeled, recurving away from the face toward the tip. The
// toothed margins and the tip flush red-brown; the base is paler where the
// leaf was shaded by its neighbours.
export function succulentGeometry(detail = 1) {
  const m = mesher();
  const rows = detail ? [0, 0.18, 0.4, 0.62, 0.82] : [0, 0.4, 0.75];
  const ring = [];
  for (const t of rows) {
    const width = 0.11 * (t < 0.15 ? 0.8 + (t / 0.15) * 0.2 : Math.pow((1 - t) / 0.85, 0.9));
    const thick = 0.07 * Math.pow(1 - t, 0.7) + 0.008;
    const bow = -0.32 * t * t;
    const base = 0.85 + 0.25 * Math.min(1, t * 2);
    const flush = Math.max(0, (t - 0.65) / 0.35);
    const face = [base * (1 + flush * 0.25), base * (1 - flush * 0.1), base * (1 - flush * 0.25)];
    const margin = [base * 1.05, base * 0.72, base * 0.55];
    const under = [base * 1.05, base * 1.08, base * 1.02];
    ring.push([
      m.vertex(new THREE.Vector3(-width, t, bow), margin),
      m.vertex(new THREE.Vector3(0, t, bow - thick * 0.25), face),
      m.vertex(new THREE.Vector3(width, t, bow), margin),
      m.vertex(new THREE.Vector3(0, t, bow - thick), under),
    ]);
  }
  const tip = m.vertex(new THREE.Vector3(0, 1, -0.32), [1.15, 0.7, 0.55]);
  for (let i = 0; i < ring.length - 1; i++) {
    const [L, U, R, K] = ring[i];
    const [L1, U1, R1, K1] = ring[i + 1];
    m.tri(L, U, L1);
    m.tri(U, U1, L1);
    m.tri(U, R, U1);
    m.tri(R, R1, U1);
    m.tri(L, L1, K);
    m.tri(K, L1, K1);
    m.tri(K, K1, R);
    m.tri(R, K1, R1);
  }
  const [L, U, R, K] = ring[ring.length - 1];
  m.tri(L, U, tip);
  m.tri(U, R, tip);
  m.tri(L, tip, K);
  m.tri(K, tip, R);
  return m.finish();
}

// A heath shoot (erica, fine-leaved fynbos): needle leaves in a tight spiral
// up a short twig, splayed at the base and hugging it toward the tip.
export function needleGeometry(count = 26) {
  const m = mesher();
  const random = seededRandom(41);
  const enlarge = Math.sqrt(26 / count);
  for (let i = 0; i < count; i++) {
    const t = (i + 0.5) / count;
    const azimuth = i * GOLDEN_ANGLE;
    const tilt = 1.0 - t * 0.65 + (random() - 0.5) * 0.2;
    const dir = new THREE.Vector3(Math.sin(tilt) * Math.cos(azimuth), Math.cos(tilt), Math.sin(tilt) * Math.sin(azimuth));
    const side = new THREE.Vector3(-Math.sin(azimuth), 0, Math.cos(azimuth)).multiplyScalar(0.02 * enlarge);
    const base = new THREE.Vector3(0, 0.05 + t * 0.7, 0);
    const length = 0.26 * (1 - t * 0.4) * enlarge;
    const phase = random();
    const shade = 0.75 + t * 0.3;
    const a = m.vertex(base.clone().sub(side), [shade * 0.85, shade * 0.85, shade * 0.85], phase, 0);
    const b = m.vertex(base.clone().add(side), [shade * 0.85, shade * 0.85, shade * 0.85], phase, 0);
    const tip = m.vertex(base.clone().addScaledVector(dir, length), [shade * (1 + t * 0.15), shade, shade * (1 - t * 0.2)], phase, 0.5);
    m.tri(a, tip, b);
  }
  return m.finish();
}

// A pincushion (Leucospermum) head: a small dome bristling with long styles
// that curve up and in, each ending in a knobbed yellow tip.
export function pincushionGeometry(styles = 36, detail = 1) {
  const m = mesher();
  const random = seededRandom(53);
  const dome = new THREE.SphereGeometry(0.28, detail ? 8 : 5, detail ? 4 : 3, 0, Math.PI * 2, 0, Math.PI / 2);
  const dp = dome.attributes.position;
  const offset = [];
  for (let i = 0; i < dp.count; i++) offset.push(m.vertex(new THREE.Vector3(dp.getX(i), dp.getY(i) * 0.8, dp.getZ(i)), [0.7, 0.45, 0.35]));
  for (let i = 0; i < dome.index.count; i += 3)
    m.tri(offset[dome.index.getX(i)], offset[dome.index.getX(i + 1)], offset[dome.index.getX(i + 2)]);
  dome.dispose();
  for (let s = 0; s < styles; s++) {
    const azimuth = s * GOLDEN_ANGLE;
    const polar = Math.acos(1 - (s + 0.5) / styles * 1.15);
    const out = new THREE.Vector3(Math.sin(polar) * Math.cos(azimuth), Math.cos(polar), Math.sin(polar) * Math.sin(azimuth));
    const base = out.clone().multiplyScalar(0.26);
    const length = 0.75 + random() * 0.2;
    // Styles curve upward and inward, like the fingers of a cupped hand.
    const tip = base.clone().addScaledVector(out, length * 0.8).add(new THREE.Vector3(-out.x * 0.25, 0.35, -out.z * 0.25).multiplyScalar(length));
    const side = new THREE.Vector3(-out.z, 0, out.x).normalize().multiplyScalar(0.018);
    const phase = random();
    const a = m.vertex(base.clone().sub(side), [1, 0.9, 0.85], phase, 0);
    const b = m.vertex(base.clone().add(side), [1, 0.9, 0.85], phase, 0);
    const t = m.vertex(tip, [1.05, 1.0, 0.9], phase, 0.4);
    m.tri(a, t, b);
    if (detail) {
      const knob = [1.5, 1.35, 0.5];
      const k0 = m.vertex(tip.clone().addScaledVector(side, -1.6), knob, phase, 0.4);
      const k1 = m.vertex(tip.clone().add(new THREE.Vector3(0, 0.07, 0)), knob, phase, 0.4);
      const k2 = m.vertex(tip.clone().addScaledVector(side, 1.6), knob, phase, 0.4);
      m.tri(k0, k1, k2);
    }
  }
  return m.finish();
}

// A king protea head: three rows of pointed, cupped bracts rising from a
// cup around a domed, silky centre; pale at the base, deepening to the
// instance's rose or cream at the tips.
export function proteaGeometry(detail = 1) {
  const m = mesher();
  const rowsSpec = detail
    ? [{ count: 13, tilt: 0.9, length: 0.9 }, { count: 11, tilt: 0.55, length: 1.0 }, { count: 9, tilt: 0.28, length: 0.85 }]
    : [{ count: 9, tilt: 0.75, length: 0.95 }, { count: 7, tilt: 0.35, length: 0.9 }];
  rowsSpec.forEach(({ count, tilt, length }, row) => {
    for (let i = 0; i < count; i++) {
      const a = ((i + row * 0.5) / count) * Math.PI * 2;
      const out = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      const across = new THREE.Vector3(-out.z, 0, out.x);
      const dir = out.clone().multiplyScalar(Math.sin(tilt)).add(new THREE.Vector3(0, Math.cos(tilt), 0));
      const w = (Math.PI * 0.62) / count;
      const base = out.clone().multiplyScalar(0.22 + row * 0.02);
      const cupOut = out.clone().multiplyScalar(0.05);
      const pale = [1, 0.97, 0.9];
      const mid = [0.95, 0.85, 0.85];
      const deep = [0.85, 0.7, 0.75];
      const b0 = m.vertex(base.clone().addScaledVector(across, -w * 0.6), pale);
      const b1 = m.vertex(base.clone().addScaledVector(across, w * 0.6), pale);
      const midPoint = base.clone().addScaledVector(dir, length * 0.55).add(cupOut);
      const m0 = m.vertex(midPoint.clone().addScaledVector(across, -w * 1.5), mid);
      const m1 = m.vertex(midPoint.clone().addScaledVector(across, w * 1.5), mid);
      const tip = m.vertex(base.clone().addScaledVector(dir, length).addScaledVector(out, -0.04), deep);
      m.tri(b0, m0, b1);
      m.tri(b1, m0, m1);
      m.tri(m0, tip, m1);
    }
  });
  const dome = new THREE.SphereGeometry(0.34, detail ? 9 : 6, detail ? 5 : 3, 0, Math.PI * 2, 0, Math.PI / 2);
  const dp = dome.attributes.position;
  const offset = [];
  for (let i = 0; i < dp.count; i++) {
    const y = dp.getY(i);
    // Silky white-tipped florets over a rosy base.
    offset.push(m.vertex(new THREE.Vector3(dp.getX(i), y * 1.25 + 0.04, dp.getZ(i)), y > 0.25 ? [1.15, 1.12, 1.05] : [0.95, 0.8, 0.8]));
  }
  for (let i = 0; i < dome.index.count; i += 3)
    m.tri(offset[dome.index.getX(i)], offset[dome.index.getX(i + 1)], offset[dome.index.getX(i + 2)]);
  dome.dispose();
  return m.finish();
}

// A daisy: a ring of slender ray petals, slightly cupped, around a raised
// dark disc.
export function daisyGeometry() {
  const m = mesher();
  const disc = [0.26, 0.17, 0.07];
  const centre = m.vertex(new THREE.Vector3(0, 0.24, 0), disc);
  const ring = [];
  const petals = 12;
  for (let i = 0; i < petals; i++) {
    const a = (i / petals) * Math.PI * 2;
    ring.push(m.vertex(new THREE.Vector3(Math.cos(a) * 0.22, 0.14, Math.sin(a) * 0.22), disc));
  }
  for (let i = 0; i < petals; i++) m.tri(centre, ring[(i + 1) % petals], ring[i]);
  for (let i = 0; i < petals; i++) {
    const a = ((i + 0.5) / petals) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const w = 0.12;
    const phase = i / petals;
    const base = [0.75, 0.72, 0.6];
    const p0 = m.vertex(new THREE.Vector3(c * 0.18 - s * w * 0.6, 0.12, s * 0.18 + c * w * 0.6), base, phase, 0);
    const p1 = m.vertex(new THREE.Vector3(c * 0.18 + s * w * 0.6, 0.12, s * 0.18 - c * w * 0.6), base, phase, 0);
    const p2 = m.vertex(new THREE.Vector3(c * 0.72 - s * w * 1.3, 0.17, s * 0.72 + c * w * 1.3), [1, 1, 1], phase, 0.6);
    const p3 = m.vertex(new THREE.Vector3(c * 0.72 + s * w * 1.3, 0.17, s * 0.72 - c * w * 1.3), [1, 1, 1], phase, 0.6);
    const p4 = m.vertex(new THREE.Vector3(c * 1.0, 0.1, s * 1.0), [0.95, 0.95, 0.95], phase, 1);
    m.tri(p0, p2, p1);
    m.tri(p1, p2, p3);
    m.tri(p2, p4, p3);
  }
  return m.finish();
}
