import * as THREE from "three";
import { groundHeight } from "./terrain.js";
import { capsule, cylinder } from "./blockers.js";
import { seededRandom } from "./random.js";
import { part, merge, sweep, lathe, place, smooth01, srgb, staticMesh, glowMaterial } from "./place-kit.js";
import { heightTile } from "./place-lighthouse.js";
import { CAIRN, POOL } from "./place-rocks.js";

// The smaller places: a fisherman's upturned boat with its gear and a
// lantern that burns at night; the trig beacon on the summit cairn; and a
// tidal rock pool in a granite shelf, alive with anemones, urchins,
// starfish and klipfish.
//
// Local frames: x, z relative to the place's centre; y absolute.

const frameOf = (φ) => {
  const fx = Math.sin(φ), fz = Math.cos(φ), rx = Math.cos(φ), rz = -Math.sin(φ);
  return { fx, fz, rx, rz, at: (u, v) => [u * fx + v * rx, u * fz + v * rz] };
};

// ---- The fisherman's boat ----------------------------------------------------

const ANTIFOUL = srgb("#6e3426");
const TOPSIDE = srgb("#2f5f7e");
const RUBBING = srgb("#c9c3b4");
const DRIFTWOOD = srgb("#80786c");
const LANTERN = new THREE.Color(3.2, 1.75, 0.6);

export function buildBoat(p, materials, { light = false, seed = 1 } = {}) {
  const random = seededRandom((seed ^ 0xb0a7) >>> 0 || 1);
  const { fx, fz, rx, rz, at } = frameOf(p.facing);
  const ground = (x, z) => groundHeight(p.x + x, p.z + z);
  const anchor = (q) => ground(q.x, q.z);
  const wood = [], woodFar = [], paint = [], net = [], glow = [];
  const trunks = [];
  // solid: the hull and traps the camera keeps out of (blockers.js).
  const blockers = [];
  const L = 4.6, B = 1.55, depth = 0.62;
  // The gunwale rests on two driftwood logs, so the boat lies along the
  // slope of the beach: its height at each end from the sand beneath.
  const endRest = (s0, s1) => {
    let g = -Infinity;
    for (let s = s0; s <= s1 + 1e-6; s += 0.125) for (const v of [-0.8, 0, 0.8]) g = Math.max(g, ground(...at(s * L / 2, v)));
    return g + 0.2;
  };
  const restStern = endRest(-1, -0.4), restBow = endRest(0.4, 1);
  const restAt = (s) => restStern + (restBow - restStern) * (s + 1) / 2;
  const keelAt = (s) => restAt(s) + depth;
  const half = (s) => (B / 2) * (s > 0 ? Math.pow(Math.max(0, 1 - s * s), 0.6) : 1 - 0.28 * Math.pow(-s, 3));
  // Upturned clinker hull: girth t from the keel (0) to the gunwale (1),
  // each of six strakes lapping the one above.
  const hullPoint = (s, t, side) => {
    const a = t * Math.PI / 2;
    const lap = 0.014 * ((t * 6) % 1);
    const v = (half(s) * Math.sin(a) + lap) * side;
    const sheer = 0.12 * s * s;
    const y = keelAt(s) + sheer * 0.4 - depth * (1 - Math.cos(a)) - sheer * t;
    const [x, z] = at(s * L / 2, v);
    return [x, y, z];
  };
  const hull = (ns, nt) => {
    const positions = [], index = [];
    for (const side of [-1, 1]) {
      const o = positions.length / 3;
      for (let i = 0; i <= ns; i++)
        for (let j = 0; j <= nt; j++) positions.push(...hullPoint(-1 + (2 * i) / ns, j / nt, side));
      for (let i = 0; i < ns; i++)
        for (let j = 0; j < nt; j++) {
          const a = o + i * (nt + 1) + j, b = a + 1, c = a + nt + 1, d = c + 1;
          if (side > 0) index.push(a, c, b, b, c, d);
          else index.push(a, b, c, b, d, c);
        }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    g.setIndex(index);
    g.computeVertexNormals();
    return g;
  };
  const hullColour = (q, n, out) => {
    // Bottom (now on top) in red antifouling to the waterline, then the
    // blue topsides and a pale rubbing strake at the gunwale.
    const t = (keelAt((q.x * fx + q.z * fz) / (L / 2)) - q.y) / depth;
    out.copy(t < 0.42 ? ANTIFOUL : t < 0.88 ? TOPSIDE : RUBBING);
  };
  const shadeUnder = (q) => 0.4 * (1 - smooth01(restAt((q.x * fx + q.z * fz) / (L / 2)) - 0.2, restAt((q.x * fx + q.z * fz) / (L / 2)) + 0.3, q.y));
  wood.push(part(hull(light ? 18 : 28, light ? 18 : 30), { colour: hullColour, shade: shadeUnder, anchor }));
  woodFar.push(part(hull(10, 6), { colour: hullColour, anchor }));
  // Transom: a flat board closing the stern.
  {
    const positions = [];
    const n = 8;
    for (let j = 0; j < n; j++) {
      const t0 = j / n, t1 = (j + 1) / n;
      const p0 = hullPoint(-1, t0, -1), p1 = hullPoint(-1, t0, 1), p2 = hullPoint(-1, t1, -1), p3 = hullPoint(-1, t1, 1);
      positions.push(...p0, ...p2, ...p1, ...p1, ...p2, ...p3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    g.computeVertexNormals();
    wood.push(part(g, { colour: hullColour, anchor }));
  }
  // Keel strip along the top, stem at the bow.
  {
    const pts = [];
    for (let k = 0; k <= 10; k++) {
      const [x, y, z] = hullPoint(-1 + k / 5, 0, 1);
      pts.push(new THREE.Vector3(x, y + 0.03, z));
    }
    wood.push(part(sweep(pts, pts.map(() => [0.035, 0.05]), 4), { colour: ANTIFOUL }));
  }
  // Two driftwood logs it rests on.
  for (const s of [-0.62, 0.55]) {
    const pts = [-1.3, -0.4, 0.4, 1.3].map((v) => {
      const [x, z] = at(s * L / 2 + v * 0.12, v);
      return new THREE.Vector3(x, Math.max(ground(x, z) + 0.06, restAt(s) - 0.13), z);
    });
    wood.push(part(sweep(pts, [0.12, 0.13, 0.12, 0.1], light ? 6 : 8), { colour: DRIFTWOOD, anchor }));
    woodFar.push(part(sweep(pts, [0.12, 0.13, 0.12, 0.1], 4), { colour: DRIFTWOOD, anchor }));
  }
  // Oars: one across the hull, one leaning on it.
  const oar = (a, b, list) => {
    const d = new THREE.Vector3().subVectors(b, a);
    list.push(part(sweep([a, a.clone().addScaledVector(d, 0.72), b], [0.026, 0.03, 0.022], 5), { colour: srgb("#9a8a70"), anchor }));
    const m = new THREE.Matrix4().lookAt(b, a, new THREE.Vector3(0, 1, 0)).setPosition(a.clone().addScaledVector(d, 0.88));
    list.push(part(new THREE.BoxGeometry(0.14, 0.018, 0.55), { matrix: m, colour: srgb("#a89a80"), anchor }));
  };
  {
    const [x0, z0] = at(-0.4, -1.4), [x1, z1] = at(0.6, 1.2);
    oar(new THREE.Vector3(x0, ground(x0, z0) + 0.03, z0), new THREE.Vector3(x1, keelAt(0.25) + 0.05, z1), wood);
    const [x2, z2] = at(1.2, 1.25), [x3, z3] = at(-1.3, 1.05);
    oar(new THREE.Vector3(x2, ground(x2, z2) + 0.04, z2), new THREE.Vector3(x3, ground(x3, z3) + 0.04, z3), wood);
  }
  // A coil of rope on the sand.
  {
    const [cx, cz] = at(-1.2, -1.6);
    const pts = [];
    const turns = 5;
    for (let k = 0; k <= turns * 14; k++) {
      const a = (k / 14) * Math.PI * 2;
      const r = 0.3 - (k / (turns * 14)) * 0.17;
      pts.push(new THREE.Vector3(cx + Math.cos(a) * r, ground(cx, cz) + 0.025 + (k / (turns * 14)) * 0.05, cz + Math.sin(a) * r));
    }
    paint.push(part(sweep(pts, pts.map(() => 0.022), 4), { colour: srgb("#8f7f5e"), anchor }));
  }
  // Crayfish traps: a slatted base ring, netting, a top hoop and the
  // entrance funnel; one stacked on another.
  const trap = (u, v, lift, tilt) => {
    const [x, z] = at(u, v);
    const y = ground(x, z) + lift;
    const m = place(x, y, z, { yaw: random() * Math.PI, roll: tilt });
    wood.push(part(new THREE.CylinderGeometry(0.42, 0.42, 0.06, 14, 1, false), { matrix: m.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0.03, 0)), colour: DRIFTWOOD, anchor }));
    paint.push(part(new THREE.TorusGeometry(0.4, 0.014, 4, 18), { matrix: m.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0.42, 0)).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)), colour: srgb("#3b3a36") }));
    net.push(part(lathe([[0.41, 0.05], [0.41, 0.42], [0.14, 0.44], [0.1, 0.3]], 14), { matrix: m, colour: srgb("#2c3a34") }));
    // solid: a coarse trap in the far level too: they vanished at 40 m.
    woodFar.push(part(lathe([[0.42, 0.0], [0.41, 0.42], [0.12, 0.44]], 6), { matrix: m, colour: srgb("#2c3a34"), anchor }));
    trunks.push({ x: p.x + x, z: p.z + z, r: 0.42 });
    if (lift === 0) blockers.push(cylinder(p.x + x, p.z + z, 0.44, y - 0.1, y + 0.95, { body: false }));
  };
  trap(-0.3, -2.0, 0, 0);
  trap(-0.3, -2.0, 0.47, 0.06);
  trap(1.0, -2.3, 0, 0.2);
  // Orange floats on a line.
  for (const [u, v] of [[0.3, -1.6], [0.55, -1.75]]) {
    const [x, z] = at(u, v);
    paint.push(part(new THREE.SphereGeometry(0.13, 10, 7), { matrix: place(x, ground(x, z) + 0.11, z), colour: srgb("#b4532a"), anchor }));
  }
  // The lantern: a hurricane lamp hung from a driftwood post.
  const [lx, lz] = at(-1.9, 1.2);
  const postBase = new THREE.Vector3(lx, ground(lx, lz) - 0.3, lz);
  const postTop = new THREE.Vector3(lx + 0.05, ground(lx, lz) + 1.55, lz + 0.03);
  wood.push(part(sweep([postBase, postTop.clone().lerp(postBase, 0.5), postTop], [0.07, 0.06, 0.05], 6), { colour: DRIFTWOOD, anchor }));
  const [ax, az] = at(-1.9 + 0.32, 1.2);
  wood.push(part(sweep([postTop.clone().add(new THREE.Vector3(0, -0.1, 0)), new THREE.Vector3(ax, postTop.y - 0.06, az)], [0.03, 0.025], 4), { colour: DRIFTWOOD }));
  const lamp = new THREE.Vector3(ax, postTop.y - 0.42, az);
  glow.push(part(new THREE.CylinderGeometry(0.09, 0.1, 0.22, 10), { matrix: place(lamp.x, lamp.y, lamp.z), colour: LANTERN }));
  paint.push(part(new THREE.CylinderGeometry(0.03, 0.1, 0.07, 10), { matrix: place(lamp.x, lamp.y + 0.12, lamp.z), colour: srgb("#26241f") }));
  paint.push(part(new THREE.CylinderGeometry(0.1, 0.1, 0.04, 10), { matrix: place(lamp.x, lamp.y - 0.105, lamp.z), colour: srgb("#26241f") }));
  paint.push(part(new THREE.TorusGeometry(0.06, 0.006, 3, 10), { matrix: place(lamp.x, lamp.y + 0.24, lamp.z, { pitch: Math.PI / 2 }), colour: srgb("#26241f") }));
  trunks.push({ x: p.x + lx, z: p.z + lz, r: 0.1 });
  // The lamp's pool of light on the sand and the boat's flank: a small
  // ground-hugging disc, additive, fading with distance from the lamp.
  const pool = lightPool(lamp, 3.2, ground);
  pool.place(p.x, p.z);

  const near = new THREE.Group();
  near.add(staticMesh(merge(wood), materials.wood), staticMesh(merge(paint), materials.paint), staticMesh(merge(net), materials.net), staticMesh(merge(glow), materials.glow, { cast: false }));
  const far = new THREE.Group();
  far.add(staticMesh(merge(woodFar), materials.wood));
  // The upturned hull to the camera: two capsules along the keel, as wide
  // as the beam and topped at the keel (the cat stands on it by the tile).
  {
    const keelPoint = (s) => {
      const [x, z] = at(s * L / 2, 0);
      return { x: p.x + x, y: keelAt(s) - 0.72, z: p.z + z };
    };
    blockers.push(capsule(keelPoint(-0.75), keelPoint(0), 0.74, { body: false }), capsule(keelPoint(0), keelPoint(0.75), 0.72, { body: false }));
  }
  // The hull's back to stand on; a cat will.
  const domes = [heightTile(p.x, p.z, L / 2 + 0.3, 0.08, (x, z) => {
    const lx2 = x - p.x, lz2 = z - p.z;
    const u = lx2 * fx + lz2 * fz, v = lx2 * rx + lz2 * rz;
    const s = u / (L / 2);
    if (Math.abs(s) > 1) return -Infinity;
    const b = half(s);
    if (Math.abs(v) > b) return -Infinity;
    const a = Math.asin(Math.min(1, Math.abs(v) / b));
    return keelAt(s) + 0.12 * s * s * 0.4 - depth * (1 - Math.cos(a)) - 0.12 * s * s * (a / (Math.PI / 2)) + 0.02;
  })];
  return {
    // solid: no cull. Gone at 80 m, the hull popped out of the cove in
    // plain view; its far level is one draw of a few hundred triangles.
    near, far, farDistance: 40,
    obstacles: { trunks, domes },
    blockers,
    halos: [{ x: p.x + lamp.x, y: lamp.y, z: p.z + lamp.z, size: 1.5, colour: [1.0, 0.6, 0.24], flicker: true }],
    extra: pool.mesh,
    update({ time, lit }) {
      pool.update(time, lit);
    },
  };
}

const POOL_VERTEX = /* glsl */ `
varying float vFall;
uniform vec3 lamp;
void main() {
  vec4 world = modelMatrix * vec4( position, 1.0 );
  float d = length( world.xyz - lamp );
  vFall = 1.0 / ( 1.0 + d * d * 2.4 ) * ( 1.0 - smoothstep( 0.8, 3.1, length( world.xz - lamp.xz ) ) );
  gl_Position = projectionMatrix * viewMatrix * world;
}`;
const POOL_FRAGMENT = /* glsl */ `
uniform vec3 glowColour;
uniform float strength;
varying float vFall;
void main() {
  gl_FragColor = vec4( glowColour * vFall * strength, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// A pool of lamplight on the ground round `lamp` (local coast x, z; y
// absolute): a small grid draped 3 cm over the sand, in the land group.
function lightPool(lamp, radius, ground) {
  const n = 12;
  const positions = [];
  const index = [];
  for (let j = 0; j <= n; j++)
    for (let i = 0; i <= n; i++) {
      const x = lamp.x + (i / n - 0.5) * 2 * radius, z = lamp.z + (j / n - 0.5) * 2 * radius;
      positions.push(x, ground(x, z) + 0.035, z);
      if (i < n && j < n) {
        const a = j * (n + 1) + i;
        index.push(a, a + n + 1, a + 1, a + 1, a + n + 1, a + n + 2);
      }
    }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(index);
  const uniforms = { lamp: { value: new THREE.Vector3() }, strength: { value: 0 } };
  const material = glowMaterial({ colour: [1.0, 0.55, 0.2], vertex: POOL_VERTEX, fragment: POOL_FRAGMENT, uniforms });
  material.polygonOffset = true;
  material.polygonOffsetFactor = -2;
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 9;
  mesh.visible = false;
  return {
    mesh,
    place(px, pz) {
      // Into the land group's coordinates: offset by the place's centre.
      mesh.position.set(px, 0, pz);
      mesh.updateMatrix();
      mesh.updateMatrixWorld(true);
      uniforms.lamp.value.set(px + lamp.x, lamp.y, -(pz + lamp.z));
    },
    update(time, lit) {
      mesh.visible = lit > 0.01;
      uniforms.strength.value = lit * (0.55 + 0.04 * Math.sin(time * 13) + 0.03 * Math.sin(time * 31));
    },
  };
}

// ---- The trig beacon -----------------------------------------------------------

export function buildBeacon(p, materials) {
  const g0 = groundHeight(p.x, p.z);
  const paint = [];
  const top = g0 + CAIRN.height;
  // A galvanised mast out of the cairn, carrying the three-disc vane that
  // surveyors sighted on from the hills round about: black and white.
  paint.push(part(new THREE.CylinderGeometry(0.045, 0.06, 2.9, 8), { matrix: place(0, top + 1.1, 0), colour: srgb("#8a8d8c") }));
  for (let k = 0; k < 3; k++) {
    const yaw = p.facing + (k * Math.PI) / 3;
    // Each disc painted white above, black below: it reads against sky
    // or hillside from any side.
    const yc = top + 2.15;
    paint.push(part(new THREE.CylinderGeometry(0.42, 0.42, 0.025, 24), {
      matrix: place(0, yc, 0, { yaw, pitch: Math.PI / 2 }),
      colour: (q, n, out) => out.copy(q.y > yc ? srgb("#e1ddd2") : srgb("#151515")),
    }));
  }
  // Whitewash on the cairn's crown, where it is renewed: a painted collar.
  paint.push(part(new THREE.CylinderGeometry(0.2, 0.26, 0.35, 10), { matrix: place(0, top - 0.02, 0), colour: srgb("#d6d1c4") }));
  // The survey bolt: a concrete block with a bronze plate, at the foot.
  const [bx, bz] = [Math.sin(p.facing) * 1.9, Math.cos(p.facing) * 1.9];
  const bg = groundHeight(p.x + bx, p.z + bz);
  paint.push(part(new THREE.BoxGeometry(0.42, 0.3, 0.42), { matrix: place(bx, bg + 0.08, bz, { yaw: p.facing }), colour: srgb("#9b968c"), anchor: bg }));
  paint.push(part(new THREE.CylinderGeometry(0.07, 0.07, 0.02, 12), { matrix: place(bx, bg + 0.235, bz), colour: srgb("#6d5428") }));
  const near = new THREE.Group();
  near.add(staticMesh(merge(paint), materials.paint));
  return { near, obstacles: { trunks: [{ x: p.x, z: p.z, r: 0.25 }], domes: [] } };
}

// ---- The rock pool ---------------------------------------------------------------

export function buildPool(p, materials, { light = false, seed = 1 } = {}) {
  const random = seededRandom((seed ^ 0x9001) >>> 0 || 1);
  const ground = (x, z) => groundHeight(p.x + x, p.z + z);
  let gmax = -Infinity, gmin = Infinity;
  for (let a = 0; a < 16; a++) for (const r of [0, 1.5, 3]) {
    const h = ground(Math.cos(a / 16 * 6.283) * r, Math.sin(a / 16 * 6.283) * r);
    gmax = Math.max(gmax, h);
    gmin = Math.min(gmin, h);
  }
  const shelf = gmax + 0.48; // top of the granite shelf
  const floor = gmax + 0.12; // the basin's floor
  const level = shelf - 0.07; // still water
  const wob = (a, k) => Math.sin(a * 3 + k) * 0.18 + Math.sin(a * 5 + k * 2.3) * 0.1 + Math.sin(a * 9 + k) * 0.05;
  const basinR = (a) => POOL.basin + wob(a, 1.3);
  const outerR = (a) => POOL.shelf + wob(a, 4.1) * 1.2;
  // Height of the shelf at (r, a): the floor, the basin wall, the worn top,
  // and the outer flank running down under the sand.
  const height = (r, a) => {
    const rb = basinR(a), ro = outerR(a);
    if (r < rb - 0.12) return floor;
    if (r < rb + 0.12) return floor + (shelf - floor) * smooth01(rb - 0.12, rb + 0.12, r);
    if (r < ro - 0.5) return shelf + Math.sin(a * 7 + r * 3) * 0.04 - 0.06 * smooth01(rb, ro, r);
    return shelf - 0.06 + (gmin - 0.35 - shelf) * smooth01(ro - 0.5, ro + 0.25, r);
  };
  // The shelf: a polar grid from the basin wall outward.
  const radial = light ? 40 : 64, rings = 14;
  const positions = [], index = [];
  for (let i = 0; i <= rings; i++)
    for (let j = 0; j < radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const rb = basinR(a) - 0.2, ro = outerR(a) + 0.3;
      const r = rb + (ro - rb) * (i / rings) ** 0.9;
      positions.push(Math.cos(a) * r, height(r, a), Math.sin(a) * r);
    }
  for (let i = 0; i < rings; i++)
    for (let j = 0; j < radial; j++) {
      const a = i * radial + j, b = i * radial + ((j + 1) % radial), c = a + radial, d = b + radial;
      index.push(a, b, c, b, d, c);
    }
  const shelfGeometry = new THREE.BufferGeometry();
  shelfGeometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  shelfGeometry.setIndex(index);
  shelfGeometry.computeVertexNormals();
  const stone = [part(shelfGeometry, { colour: srgb("#6f6962"), anchor: (q) => ground(q.x, q.z), shade: (q) => 0.4 * (1 - smooth01(floor, shelf, q.y)) })];

  // The basin floor: sand in the hollows, crusts of pink coralline algae
  // on the rock, tufts of green sea lettuce.
  const floorPositions = [];
  const floorIndex = [];
  const fr = 10, fa = light ? 32 : 48;
  floorPositions.push(0, floor + 0.01, 0);
  for (let i = 1; i <= fr; i++)
    for (let j = 0; j < fa; j++) {
      const a = (j / fa) * Math.PI * 2;
      const r = (basinR(a) - 0.05) * (i / fr);
      floorPositions.push(Math.cos(a) * r, floor + 0.01 + Math.sin(a * 4 + r * 5) * 0.012, Math.sin(a) * r);
    }
  for (let j = 0; j < fa; j++) floorIndex.push(0, 1 + ((j + 1) % fa), 1 + j);
  for (let i = 1; i < fr; i++)
    for (let j = 0; j < fa; j++) {
      const a = 1 + (i - 1) * fa + j, b = 1 + (i - 1) * fa + ((j + 1) % fa), c = a + fa, d = b + fa;
      floorIndex.push(a, b, c, b, d, c);
    }
  const floorGeometry = new THREE.BufferGeometry();
  floorGeometry.setAttribute("position", new THREE.Float32BufferAttribute(floorPositions, 3));
  floorGeometry.setIndex(floorIndex);
  floorGeometry.computeVertexNormals();
  const coralline = srgb("#7d5a5a"), sandy = srgb("#7a705c"), lettuce = srgb("#37552a"), dark = srgb("#38342f");
  const life = [part(floorGeometry, {
    colour: (q, n, out) => {
      const k1 = Math.sin(q.x * 11.1 + q.z * 4.3) + Math.sin(q.z * 13.7 - q.x * 3.7) + Math.sin(q.x * 23.0 + q.z * 19.0) * 0.4;
      const k2 = Math.sin(q.x * 17.3 - q.z * 13.1) * 0.5 + Math.sin(q.z * 7.3 + q.x * 2.0 + 1.2);
      const wall = smooth01(0.55, 0.95, Math.hypot(q.x, q.z) / POOL.basin);
      out.copy(dark).lerp(sandy, smooth01(0.2, -0.6, k1) * (1 - wall)).lerp(coralline, smooth01(0.3, 1.2, k1) * 0.7).lerp(lettuce, smooth01(0.8, 1.3, k2) * 0.6);
      // Seen through the water column: bluer and darker.
      out.multiply(new THREE.Color(0.72, 0.86, 0.88));
    },
    shade: 0.3,
  })];
  // Anemones, urchins and starfish on the floor and the basin wall.
  const scatter = (count, fn) => {
    for (let i = 0; i < count; i++) {
      const a = random() * Math.PI * 2;
      const edge = random() < 0.6;
      const r = (basinR(a) - 0.05) * (edge ? 0.75 + random() * 0.2 : random() * 0.7);
      fn(Math.cos(a) * r, floor + 0.01, Math.sin(a) * r, a, i);
    }
  };
  scatter(light ? 7 : 11, (x, y, z, a, i) => {
    const colour = [srgb("#6e1a20"), srgb("#3a5a36"), srgb("#8c5a66"), srgb("#5e2a22")][i % 4];
    const s = 0.45 + random() * 0.4;
    const m = place(x, y, z, { yaw: random() * 6, sx: s, sy: s, sz: s });
    life.push(part(lathe([[0.05, 0], [0.055, 0.05], [0.06, 0.07], [0.03, 0.075], [0.001, 0.07]], 10), { matrix: m, colour }));
    for (let k = 0; k < 12; k++) {
      const t = (k / 12) * Math.PI * 2;
      const tip = new THREE.Vector3(Math.cos(t) * 0.1, 0.1 + (k % 2) * 0.02, Math.sin(t) * 0.1).applyMatrix4(m);
      const root = new THREE.Vector3(Math.cos(t) * 0.04, 0.07, Math.sin(t) * 0.04).applyMatrix4(m);
      life.push(part(sweep([root, tip], [0.012 * s, 0.004 * s], 3), { colour: colour.clone().lerp(srgb("#d9a0a8"), 0.25) }));
    }
  });
  scatter(light ? 8 : 12, (x, y, z) => {
    const urchin = new THREE.IcosahedronGeometry(0.05, 1);
    const pos = urchin.attributes.position;
    for (let k = 0; k < pos.count; k++) {
      const v = new THREE.Vector3().fromBufferAttribute(pos, k);
      const spike = (Math.sin(k * 12.9898) * 43758.5453) % 1;
      v.multiplyScalar(1 + Math.abs(spike) * 0.9);
      v.y *= 0.75;
      pos.setXYZ(k, v.x, v.y, v.z);
    }
    life.push(part(urchin, { matrix: place(x, y + 0.03, z), colour: random() < 0.5 ? srgb("#2b1b33") : srgb("#3b4a2a") }));
  });
  scatter(light ? 4 : 6, (x, y, z, a, i) => {
    const arms = 5, positions2 = [];
    const R = 0.07 + random() * 0.05, r0 = R * 0.38;
    for (let k = 0; k < arms; k++) {
      const t0 = (k / arms) * Math.PI * 2, t1 = t0 + Math.PI / arms, t2 = t0 + (2 * Math.PI) / arms;
      const c = [0, 0.018, 0];
      const p0 = [Math.cos(t0) * R, 0.004, Math.sin(t0) * R];
      const p1 = [Math.cos(t1) * r0, 0.01, Math.sin(t1) * r0];
      const p2 = [Math.cos(t2) * R, 0.004, Math.sin(t2) * R];
      positions2.push(...c, ...p1, ...p0, ...c, ...p2, ...p1);
    }
    const star = new THREE.BufferGeometry();
    star.setAttribute("position", new THREE.Float32BufferAttribute(positions2, 3));
    star.computeVertexNormals();
    life.push(part(star, { matrix: place(x, y, z, { yaw: random() * 6 }), colour: [srgb("#b9531d"), srgb("#6a2a5e"), srgb("#c27a2a")][i % 3] }));
  });
  // Limpets and a few periwinkles on the shelf top.
  for (let i = 0; i < (light ? 10 : 22); i++) {
    const a = random() * Math.PI * 2;
    const r = basinR(a) + 0.2 + random() * (outerR(a) - basinR(a) - 0.6);
    const y = height(r, a);
    life.push(part(new THREE.ConeGeometry(0.035, 0.025, 7), { matrix: place(Math.cos(a) * r, y + 0.01, Math.sin(a) * r), colour: srgb("#7d776a") }));
  }

  // Still, clear water.
  const waterPositions = [0, level, 0];
  const wa = light ? 32 : 48;
  for (let j = 0; j < wa; j++) {
    const a = (j / wa) * Math.PI * 2;
    const r = basinR(a) + 0.06;
    waterPositions.push(Math.cos(a) * r, level, Math.sin(a) * r);
  }
  const waterIndex = [];
  for (let j = 0; j < wa; j++) waterIndex.push(0, 1 + ((j + 1) % wa), 1 + j);
  const water = new THREE.BufferGeometry();
  water.setAttribute("position", new THREE.Float32BufferAttribute(waterPositions, 3));
  water.setIndex(waterIndex);
  water.computeVertexNormals();

  // Klipfish: small, mottled, darting.
  const fishCount = light ? 3 : 5;
  const fishGeometry = new THREE.BufferGeometry();
  fishGeometry.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0.06, 0.012, 0.006, 0, -0.012, 0.006, 0, 0, 0.012, 0.005, 0, -0.004, 0.0, 0, 0, -0.05, 0.016, 0.004, -0.065, -0.016, 0.004, -0.065], 3));
  fishGeometry.setIndex([0, 1, 3, 0, 3, 2, 0, 4, 1, 0, 2, 4, 1, 5, 3, 3, 5, 2, 1, 4, 5, 2, 5, 4, 5, 6, 7, 5, 7, 6]);
  fishGeometry.computeVertexNormals();
  const fishMaterial = materials.paint;
  const fish = new THREE.InstancedMesh(fishGeometry, fishMaterial, fishCount);
  fishGeometry.setAttribute("color", new THREE.Float32BufferAttribute(new Array(8).fill(0).flatMap(() => [0.34, 0.3, 0.2]), 3));
  fish.frustumCulled = false;
  const swimmers = Array.from({ length: fishCount }, (_, i) => ({
    a: random() * 6.28, r: 0.4 + random() * 0.8, speed: 0.3 + random() * 0.4, dart: 0, phase: random() * 10, dir: random() < 0.5 ? 1 : -1, y: floor + 0.06 + random() * 0.15, i,
  }));
  const o = new THREE.Object3D();

  const near = new THREE.Group();
  near.add(staticMesh(merge(stone), materials.stone), staticMesh(merge(life), materials.paint, { cast: false }), fish);
  near.add(staticMesh(water, materials.water, { cast: false, receive: false }));
  const far = new THREE.Group();
  far.add(staticMesh(part(shelfGeometry.clone(), { colour: srgb("#6f6962"), anchor: (q) => ground(q.x, q.z) }), materials.stone));

  const domes = [heightTile(p.x, p.z, POOL.shelf + 0.9, 0.08, (x, z) => {
    const lx = x - p.x, lz = z - p.z;
    const r = Math.hypot(lx, lz), a = Math.atan2(lz, lx);
    if (r > outerR(a) + 0.2) return -Infinity;
    return height(r, a);
  })];
  let last = 0;
  return {
    // solid: culled where the fog has the shelf (it popped at 70 m).
    near, far, farDistance: 30, cullDistance: 115,
    obstacles: { trunks: [], domes },
    update({ time, eye, pose }) {
      if (!eye || Math.hypot(eye[0] - p.x, eye[2] - p.z) > 22) return;
      const dt = Math.min(0.1, Math.max(0, time - last));
      last = time;
      // A cat at the rim scatters them to the far side.
      const cx = pose ? pose.x - p.x : 99, cz = pose ? pose.z - p.z : 99;
      const near2 = Math.hypot(cx, cz) < POOL.basin + 0.8;
      const away = Math.atan2(-cz, -cx);
      for (const f of swimmers) {
        f.phase -= dt;
        if (f.phase < 0) {
          f.dart = 1;
          f.phase = 1.5 + Math.sin(f.i * 7 + time) * 1.2 + 1.3;
          f.dir = Math.sin(time * 3.1 + f.i) > 0 ? 1 : -1;
        }
        f.dart = Math.max(0, f.dart - dt * 2.5);
        const speed = f.speed * (0.15 + f.dart * 3);
        f.a += (speed / f.r) * f.dir * dt;
        if (near2) f.a += Math.sin(away - f.a) * dt * 2;
        const rr = Math.min(f.r, basinR(f.a) - 0.25);
        o.position.set(Math.cos(f.a) * rr, f.y, Math.sin(f.a) * rr);
        o.rotation.set(0, -f.a - (f.dir > 0 ? 0 : Math.PI), Math.sin(time * 9 + f.i) * 0.15 * (0.3 + f.dart));
        o.updateMatrix();
        fish.setMatrixAt(f.i, o.matrix);
      }
      fish.instanceMatrix.needsUpdate = true;
    },
  };
}

// Lantern halos: a soft camera-facing glow round each lamp, flickering a
// little; additive, so it brightens the dark round it and nothing else.
const HALO_VERTEX = /* glsl */ `
attribute vec4 halo;
attribute vec3 haloColour;
uniform float time;
varying vec2 vUv2;
varying vec3 vColour;
void main() {
  vUv2 = position.xy;
  vec3 centre = halo.xyz;
  vec3 toEye = normalize( cameraPosition - centre );
  vec3 right = vec3( viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0] );
  vec3 up = vec3( viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1] );
  float flick = 0.88 + 0.08 * sin( time * 13.0 + halo.x ) + 0.05 * sin( time * 31.0 + halo.z );
  vColour = haloColour * flick;
  float d = length( cameraPosition - centre );
  float s = halo.w * ( 1.0 + d * 0.02 );
  gl_Position = projectionMatrix * viewMatrix * vec4( centre + toEye * 0.15 + ( right * position.x + up * position.y ) * s, 1.0 );
}`;
const HALO_FRAGMENT = /* glsl */ `
uniform float strength;
varying vec2 vUv2;
varying vec3 vColour;
void main() {
  float r2 = dot( vUv2, vUv2 );
  float glow = exp( -r2 * 40.0 ) * 2.0 + exp( -r2 * 9.0 ) * 0.45 + exp( -r2 * 2.5 ) * 0.12;
  gl_FragColor = vec4( vColour * glow * strength * ( 1.0 - smoothstep( 0.6, 1.0, r2 ) ), 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function haloMesh(list) {
  const quad = new THREE.PlaneGeometry(2, 2);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.index = quad.index;
  geometry.setAttribute("position", quad.attributes.position);
  geometry.setAttribute("halo", new THREE.InstancedBufferAttribute(new Float32Array(list.flatMap((h) => [h.x, h.y, -h.z, h.size])), 4));
  geometry.setAttribute("haloColour", new THREE.InstancedBufferAttribute(new Float32Array(list.flatMap((h) => h.colour)), 3));
  geometry.instanceCount = list.length;
  const uniforms = { time: { value: 0 }, strength: { value: 0 } };
  const material = glowMaterial({ vertex: HALO_VERTEX, fragment: HALO_FRAGMENT, uniforms });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  mesh.renderOrder = 12;
  mesh.visible = false;
  return {
    mesh,
    update(time, lit) {
      mesh.visible = lit > 0.01;
      uniforms.time.value = time;
      uniforms.strength.value = lit;
    },
    dispose() {
      quad.dispose();
      geometry.dispose();
      material.dispose();
    },
  };
}
