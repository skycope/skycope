import * as THREE from "three";
import { groundHeight, shoreDistance, noise2, smoothstep } from "./terrain.js";
import { MATERIAL_HEX } from "./material-palette.js";

// The ground you could kneel on. Between the tufts and shrubs the ground
// mesh is paint; close to the cat that reads as a smooth slope. A carpet of
// small instanced clumps follows the camera instead: short grass where the
// sward is, low fynbos sprigs under the painted scrub, sour-fig fingers on
// the dune band, and fallen leaves lying flat in the litter under crowns. It
// is placed on a world-snapped grid (every cell's contents come from its own
// hash and the ground's baked masks), so nothing changes as the window moves:
// cells only enter and leave at its faded rim. Two windows: a dense one round
// the cat, a coarser one out to where the painted cover takes over.
//
// The CPU fills a cell when it enters a window (a row or column at a time);
// the vertex shader grows the clump from its few numbers. No textures.

export const NEAR_GROUND = {
  // cell (m), radius (m) and how far ahead of the cat the window sits (m):
  // a dense window round the cat, a coarse one out to ~9 m. Phones get
  // coarser cells and three blades per clump instead of four.
  desktop: [
    { cell: 0.15, radius: 3.4, ahead: 1.0 },
    { cell: 0.27, radius: 7.5, ahead: 1.5 },
  ],
  light: [
    { cell: 0.22, radius: 3.2, ahead: 1.0 },
    { cell: 0.36, radius: 7.0, ahead: 1.5 },
  ],
};

// Instances per window: the grid's side, squared.
export function nearGroundInstances(light = false) {
  return (light ? NEAR_GROUND.light : NEAR_GROUND.desktop).map((w) => Math.ceil((2 * w.radius) / w.cell) ** 2);
}

export const NEAR_KIND = { none: -1, grass: 0, sprig: 1, fig: 2, litter: 3 };

const LITTER = [new THREE.Color(MATERIAL_HEX.litter), new THREE.Color(MATERIAL_HEX.dryThatch), new THREE.Color("#5b4a2f"), new THREE.Color("#3f3a24")];
const SPRIG = [new THREE.Color("#3d4a2c"), new THREE.Color("#4c5338"), new THREE.Color("#33402a"), new THREE.Color("#5a5236")];
const FIG = [new THREE.Color("#3f5a28"), new THREE.Color("#6a4a2a")];
const GRASS = new THREE.Color("#556b33");
const GRASS_FRESH = new THREE.Color("#6f8a3a"); // land-look

// The ground shader's value noise (forest.js dHash/dNoise), so geometry can
// follow what the shader paints.
const fract = (v) => v - Math.floor(v);
function dHash(x, y) {
  let qx = fract(x * 0.1031), qy = fract(y * 0.1031), qz = fract(x * 0.1031);
  const d = qx * (qy + 33.33) + qy * (qz + 33.33) + qz * (qx + 33.33);
  qx += d; qy += d; qz += d;
  return fract((qx + qy) * qz);
}
export function dNoise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = dHash(ix, iy) + (dHash(ix + 1, iy) - dHash(ix, iy)) * ux;
  const b = dHash(ix, iy + 1) + (dHash(ix + 1, iy + 1) - dHash(ix, iy + 1)) * ux;
  return a + (b - a) * uy;
}
// Whether a point lies inside one of the painted sour-fig mats
// (GROUND_COLOUR_GLSL), 0-1.
function figMat(x, z, sourfig) {
  const lobes = dNoise(x * 5 + 1, z * 5 + 1);
  const matN = dNoise(x * 0.8 + 21, z * 0.8 + 21) * 0.62 + dNoise(x * 2.1 + 3, z * 2.1 + 3) * 0.26 + lobes * 0.12;
  const edge = 0.84 + (0.66 - 0.84) * sourfig;
  return smoothstep(edge - 0.02, edge + 0.04, matN + (lobes - 0.5) * 0.06);
}

function hash(x, z, k) {
  const n = Math.sin(x * 127.1 + z * 311.7 + k * 74.7) * 43758.5453;
  return n - Math.floor(n);
}

// What grows in one world cell: a kind, a jittered position on the ground
// and the clump's size and colour. Pure and seed-stable: a cell's contents
// depend only on the cell and the ground's masks (`field.sample`).
export function nearCell(field, ix, iz, cell, layer, out = {}) {
  const jx = hash(ix, iz, 1 + layer * 7), jz = hash(ix, iz, 2 + layer * 7);
  const x = (ix + 0.15 + jx * 0.7) * cell;
  const z = (iz + 0.15 + jz * 0.7) * cell;
  out.x = x;
  out.z = z;
  out.kind = NEAR_KIND.none;
  const inland = shoreDistance(x, z);
  if (inland < 1.6) return out;
  const m = field.sample(x, z);
  if (m.rocky > 0.45) return out;
  // Plants grow in clumps with gaps between them, not as an even sprinkle:
  // a patch field ~0.6 m across thins every kind but the fallen leaves.
  const patch = noise2(x * 1.7 + 31.7, z * 1.7 - 12.1) * 0.65 + noise2(x * 4.1 - 5.3, z * 4.1 + 8.8) * 0.35;
  // A closed sward has no gaps; thin cover breaks into clumps.
  const clumped = Math.max(smoothstep(0.34, 0.6, patch), smoothstep(0.45, 0.85, m.grass + m.moss * 0.5));
  // Dry dune grass thins out over the open sand of the dune band.
  const dune = (1 - smoothstep(2.5, 8, inland)) * smoothstep(1.6, 2.8, inland);
  const sandy = 1 - smoothstep(4, 9, inland);
  const weights = [
    // On the dune sand only right round the tufts (where their splat is
    // strong): the beach stays open sand between them.
    Math.min(1, m.grass * 1.8 + m.moss * 1.2) * clumped * (1 - sandy * (1 - smoothstep(0.55, 0.72, patch) * smoothstep(0.3, 0.8, m.tufted))),
    m.scrub * 0.85 * clumped,
    // Sour fig only inside its painted mats, and densely there.
    // (Off: as separate little rosettes the fingers read as rows of stamped
    // stars on the sand, worse than the painted mat alone. figMat stays for
    // when they can be grown as one creeping mat.)
    0 * figMat(x, z, m.sourfig),
    m.litter * (1 - m.grass * 0.5),
  ];
  const total = weights[0] + weights[1] + weights[2] + weights[3];
  if (hash(ix, iz, 3 + layer * 7) > Math.min(1, total) * (1 - m.rocky)) return out;
  let pick = hash(ix, iz, 4 + layer * 7) * total;
  let kind = 0;
  while (kind < 3 && pick > weights[kind]) pick -= weights[kind++];
  out.kind = kind;
  // land-look: grass grows in tussocks, not as an even sprinkle of blades.
  // Each grass cell's clump is drawn toward the nearest tussock centre on a
  // jittered ~0.5 m lattice, so the same instances bunch into tufts with
  // bare ground between them; tussocks are taller at the heart, and each
  // has its own tone (fresh green, sun-bleached, or gone to straw).
  let heart = 0, tussock = 0;
  if (kind === NEAR_KIND.grass) {
    const T = 0.5;
    const tx = Math.floor(x / T), tz = Math.floor(z / T);
    const cx = (tx + 0.3 + hash(tx, tz, 21) * 0.4) * T, cz = (tz + 0.3 + hash(tx, tz, 22) * 0.4) * T;
    out.x = x + (cx - x) * 0.6;
    out.z = z + (cz - z) * 0.6;
    heart = 1 - Math.min(1, Math.hypot(out.x - cx, out.z - cz) / (T * 0.45));
    tussock = hash(tx, tz, 23);
  }
  out.y = groundHeight(out.x, out.z);
  out.yaw = hash(ix, iz, 5) * Math.PI * 2;
  out.seed = hash(ix, iz, 6 + layer);
  out.shade = m.shade;
  const v = 0.8 + hash(ix, iz, 8) * 0.4;
  const c = (out.colour ??= new THREE.Color());
  if (kind === NEAR_KIND.grass) {
    // The local tufts' own colour (forest.js coverFor), so the sward and
    // the tufts standing in it agree; straw on the dunes.
    c.copy(m.tint ?? GRASS).lerp(LITTER[1], dune * 0.6).multiplyScalar(v * 0.9);
    // land-look: each tussock its own tone; taller at its heart.
    if (tussock < 0.22) c.lerp(LITTER[1], 0.55);
    else if (tussock > 0.78) c.multiplyScalar(1.18).lerp(GRASS_FRESH, 0.25);
    out.size = (0.75 + hash(ix, iz, 9) * 0.6) * (0.6 + Math.min(1, m.grass + m.moss * 0.5) * 0.4) * (0.6 + clumped * 0.4) * (0.75 + heart * 0.6);
  } else if (kind === NEAR_KIND.sprig) {
    c.copy(SPRIG[Math.floor(hash(ix, iz, 10) * 4)]).multiplyScalar(v * 0.9);
    out.size = (0.6 + hash(ix, iz, 9) * 0.6) * (0.6 + clumped * 0.4);
  } else if (kind === NEAR_KIND.fig) {
    c.copy(FIG[0]).lerp(FIG[1], hash(Math.floor(ix / 6), Math.floor(iz / 6), 11) ** 2).multiplyScalar(v);
    out.size = 0.7 + hash(ix, iz, 9) * 0.5;
  } else {
    // Fallen leaves darken fast: mostly litter brown, a few still pale.
    c.copy(LITTER[Math.floor(hash(ix, iz, 10) * 4)]).lerp(LITTER[1], hash(ix, iz, 12) ** 3 * 0.4).multiplyScalar(v * 0.75);
    out.size = 0.7 + hash(ix, iz, 9) * 0.6;
  }
  return out;
}

// The vertex stage: grows a clump of blades (or lays them flat as leaves)
// from the instance's numbers. Runs before three's own chunks, which then
// take ringPosition and ringNormal as the model-space vertex.
const RING_VERTEX_GLSL = /* glsl */ `
attribute vec4 ringA;   // x, y, z (coast metres, on the ground), yaw
attribute vec4 ringB;   // kind (+ 8 in the coarse window), size, seed, canopy shade
attribute vec3 ringTint;
attribute vec4 blade;   // t along the blade, across (-1..1), azimuth, lean
attribute vec2 blade2;  // length scale, root radius
uniform vec3 ringInner; // the dense window's centre (x, z) and radius
uniform vec3 ringOuter; // the coarse window's
uniform vec3 ringEye;   // the camera, coast metres
vec3 ringPosition;
vec3 ringNormal;
float ringWind;
float bladeHash( float n ) { return fract( sin( n ) * 43758.5453 ); }
void ringSetup() {
  float coarse = step( 7.5, ringB.x );
  float kind = ringB.x - coarse * 8.0;
  vec2 base = ringA.xz;
  // Window rims: the clump shrinks to nothing as its cell leaves; the
  // coarse window grows in where the dense one fades out.
  float dInner = distance( base, ringInner.xy );
  float grow = coarse > 0.5
    ? ( 1.0 - smoothstep( ringOuter.z * 0.72, ringOuter.z, distance( base, ringOuter.xy ) ) ) * smoothstep( ringInner.z * 0.55, ringInner.z * 0.9, dInner )
    : 1.0 - smoothstep( ringInner.z * 0.72, ringInner.z, dInner );
  // Past ~9 m the painted cover carries it alone.
  float eyeD = distance( base, ringEye.xz );
  grow *= 1.0 - smoothstep( 6.5, 9.5, eyeD );
  if ( kind < 0.0 ) grow = 0.0;
  float size = ringB.y * grow;
  float seed = ringB.z;
  float t = blade.x;
  float across = blade.y;
  float az = blade.z + ringA.w;
  float lean = blade.w;
  float h = bladeHash( seed * 91.7 + blade.z * 3.1 );
  vec3 out1 = vec3( cos( az ), 0.0, sin( az ) );
  vec3 side = vec3( -out1.z, 0.0, out1.x );
  vec3 up = vec3( 0.0, 1.0, 0.0 );
  vec3 root = vec3( base.x, ringA.y, base.y ) + out1 * blade2.y * size;
  if ( kind > 2.5 ) {
    // Fallen leaf: a pointed oval lying on the ground, edges curling up,
    // turned its own way, a few millimetres of air under its tip.
    float len = ( 0.035 + h * 0.045 ) * size * blade2.x;
    // A rounded outline from five points: the base pair close at the
    // petiole, the widest pair a little past the middle.
    float lt = t < 0.01 ? 0.08 : t;
    float width = len * ( 0.3 + h * 0.16 ) * ( t < 0.01 ? 0.25 : t < 0.9 ? 1.0 : 0.0 );
    t = lt;
    vec3 axis = vec3( cos( az * 1.7 + h * 6.0 ), 0.0, sin( az * 1.7 + h * 6.0 ) );
    vec3 across3 = vec3( -axis.z, 0.0, axis.x );
    vec3 c = root + out1 * ( 0.02 + h * 0.05 ) * size;
    ringPosition = c + axis * ( t - 0.5 ) * len + across3 * across * width
      + up * ( 0.003 + across * across * width * 0.35 + t * t * len * 0.12 );
    ringNormal = normalize( up - across3 * across * 0.35 );
    ringWind = 0.0;
  } else {
    // A blade (grass), a leafy sprig (fynbos) or a fleshy finger (sour fig),
    // rising from the clump's root and arching out under its own weight.
    float height = kind < 0.5 ? 0.08 + h * 0.15 : kind < 1.5 ? 0.09 + h * 0.1 : 0.06 + h * 0.05;
    height *= size * blade2.x;
    // Sour-fig leaves: fleshy fingers splayed from a creeping stem, curving
    // up at the tip.
    float bend = kind < 0.5 ? lean * 0.7 : kind < 1.5 ? 0.2 + lean * 0.4 : 0.55 + lean * 0.3;
    float width = kind < 0.5 ? 0.0045 + h * 0.003 : kind < 1.5 ? 0.0045 + h * 0.003 : 0.011 + h * 0.004;
    width *= ( kind < 1.5 ? 1.0 - t * 0.8 : 1.0 - t * 0.4 );
    float twist = ( h - 0.5 ) * 1.6 * t;
    vec3 across3 = side * cos( twist ) + out1 * sin( twist );
    ringPosition = root + out1 * ( bend * height * t * t ) + up * ( height * ( t - bend * 0.55 * t * t ) )
      + across3 * across * width;
    vec3 along = normalize( out1 * ( 2.0 * bend * t ) + up * ( 1.0 - bend * 1.1 * t ) );
    ringNormal = normalize( cross( across3, along ) );
    ringWind = kind < 0.5 ? 1.0 : kind < 1.5 ? 0.5 : 0.25;
  }
  // Leaves on the ground are lit as the ground is, not darkened as the
  // root of a tuft.
  anchorHeight = kind > 2.5 ? ringA.y - 0.1 : ringA.y;
  canopyShade = ringB.w;
  // Colour along the organ: dark at the root, a dry straw tip on some grass
  // blades, figs reddening at the tips, leaves mottled.
  float k = 0.42 + 0.58 * smoothstep( 0.0, 0.6, t );
  vec3 tint = ringTint * k;
  if ( kind < 0.5 ) tint = mix( tint, vec3( 0.36, 0.3, 0.17 ) * k, step( 0.62, h ) * smoothstep( 0.45, 1.0, t ) * 0.8 );
  else if ( kind > 1.5 && kind < 2.5 ) tint = mix( tint, vec3( 0.2, 0.06, 0.04 ), smoothstep( 0.6, 1.0, t ) * 0.5 );
  else if ( kind > 2.5 ) tint *= 0.8 + 0.4 * h;
  vColor.rgb = tint;
}
`;

// A clump: `blades` organs, each 5 vertices (two pairs and a tip, three
// triangles), round a common root.
export function clumpGeometry(blades = 3) {
  const bladeData = [];
  const blade2 = [];
  const indices = [];
  const golden = 2.39996;
  for (let b = 0; b < blades; b++) {
    const az = b * golden + 0.4 * Math.sin(b * 7.1);
    const lean = 0.12 + ((b * 0.618) % 1) * 0.5;
    const len = 0.75 + ((b * 0.382 + 0.2) % 1) * 0.5;
    const rootR = 0.008 + ((b * 0.77) % 1) * 0.02;
    const first = bladeData.length / 4;
    for (const [t, across] of [[0, -1], [0, 1], [0.55, -1], [0.55, 1], [1, 0]]) {
      bladeData.push(t, across, az, lean);
      blade2.push(len, rootR);
    }
    indices.push(first, first + 2, first + 1, first + 1, first + 2, first + 3, first + 2, first + 4, first + 3);
  }
  const geometry = new THREE.InstancedBufferGeometry();
  const count = bladeData.length / 4;
  // Positions are grown in the shader; this only sizes the buffers.
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(count * 3), 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(new Float32Array(count * 3), 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(new Float32Array(count * 3).fill(1), 3));
  geometry.setAttribute("blade", new THREE.Float32BufferAttribute(bladeData, 4));
  geometry.setAttribute("blade2", new THREE.Float32BufferAttribute(blade2, 2));
  geometry.setIndex(indices);
  return geometry;
}

// `patch(material)` applies forest.js's foliage shading; `field` is the
// ground's baked masks (forest.js addGround). Returns `setCat`, which the
// forest calls each frame; the windows follow the camera at draw time.
export function createNearGround(scene, field, patch, { light = false } = {}) {
  const makeMaterial = () => {
    const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, vertexColors: true, side: THREE.DoubleSide });
    patch(material);
    const baseCompile = material.onBeforeCompile;
    const baseKey = material.customProgramCacheKey();
    material.customProgramCacheKey = () => `${baseKey}-near-ground`;
    material.onBeforeCompile = (shader) => {
      baseCompile(shader);
      shader.vertexShader = shader.vertexShader
        .replace("attribute float anchorHeight;", "float anchorHeight;")
        .replace("attribute float canopyShade;", "float canopyShade;")
        .replace("attribute vec3 bendNormal;", "const vec3 bendNormal = vec3( 0.0, 1.0, 0.0 );")
        .replace("void main() {", `${RING_VERTEX_GLSL}\nvoid main() {`)
        .replace("#include <color_vertex>", "#include <color_vertex>\n  ringSetup();")
        .replace("#include <beginnormal_vertex>", "vec3 objectNormal = ringNormal;")
        .replace("#include <begin_vertex>", "vec3 transformed = ringPosition;")
        .replace("mvPosition.xyz += windOffset( mvPosition.xyz );", "mvPosition.xyz += windOffset( mvPosition.xyz ) * ringWind;");
      shader.uniforms.ringInner = material.userData.ringInner;
      shader.uniforms.ringOuter = material.userData.ringOuter;
      shader.uniforms.ringEye = material.userData.ringEye;
    };
    return material;
  };
  const eye = { value: new THREE.Vector3() };
  const centres = [{ value: new THREE.Vector3() }, { value: new THREE.Vector3() }];
  const specs = light ? NEAR_GROUND.light : NEAR_GROUND.desktop;
  const windows = specs.map((spec, layer) => {
    const n = Math.ceil((2 * spec.radius) / spec.cell);
    centres[layer].value.z = spec.radius;
    // Every cell of the window, by slot (CPU only).
    return { spec, layer, n, a: new Float32Array(n * n * 4), b: new Float32Array(n * n * 4).fill(-1), tint: new Float32Array(n * n * 3), ox: null, oz: null, cx: 0, cz: 0 };
  });
  // Both windows draw as one mesh, with only the clumps that grow packed
  // in: open sand and rock cost nothing, and triangles follow the cover.
  const total = windows.reduce((sum, w) => sum + w.n * w.n, 0);
  const geometry = clumpGeometry(light ? 3 : 4);
  const attrA = new THREE.InstancedBufferAttribute(new Float32Array(total * 4), 4).setUsage(THREE.DynamicDrawUsage);
  const attrB = new THREE.InstancedBufferAttribute(new Float32Array(total * 4), 4).setUsage(THREE.DynamicDrawUsage);
  const attrT = new THREE.InstancedBufferAttribute(new Float32Array(total * 3), 3).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("ringA", attrA);
  geometry.setAttribute("ringB", attrB);
  geometry.setAttribute("ringTint", attrT);
  // Nothing to draw until the first frame has shown where the camera is.
  // Zero instances issue no draw, and keep onBeforeRender (which learns
  // the camera) running.
  geometry.instanceCount = 0;
  const material = makeMaterial();
  Object.assign(material.userData, { ringInner: centres[0], ringOuter: centres[1], ringEye: eye });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  scene.add(mesh);
  const scratch = {};
  const fill = (w, ix, iz) => {
    const slot = (((iz % w.n) + w.n) % w.n) * w.n + (((ix % w.n) + w.n) % w.n);
    const c = nearCell(field, ix, iz, w.spec.cell, w.layer, scratch);
    w.a[slot * 4] = c.x;
    w.a[slot * 4 + 1] = c.y ?? 0;
    w.a[slot * 4 + 2] = c.z;
    w.a[slot * 4 + 3] = c.yaw ?? 0;
    w.b[slot * 4] = c.kind;
    w.b[slot * 4 + 1] = c.size ?? 0;
    w.b[slot * 4 + 2] = c.seed ?? 0;
    w.b[slot * 4 + 3] = c.shade ?? 0;
    if (c.kind >= 0) w.tint.set([c.colour.r, c.colour.g, c.colour.b], slot * 3);
  };
  const place = (w, cx, cz) => {
    const ox = Math.floor(cx / w.spec.cell) - (w.n >> 1);
    const oz = Math.floor(cz / w.spec.cell) - (w.n >> 1);
    if (ox === w.ox && oz === w.oz) return false;
    if (w.ox === null || Math.abs(ox - w.ox) >= w.n || Math.abs(oz - w.oz) >= w.n) {
      for (let iz = oz; iz < oz + w.n; iz++) for (let ix = ox; ix < ox + w.n; ix++) fill(w, ix, iz);
    } else {
      // Only cells that entered the window: new rows, then new columns.
      for (let iz = oz; iz < oz + w.n; iz++) {
        const newRow = iz < w.oz || iz >= w.oz + w.n;
        for (let ix = ox; ix < ox + w.n; ix++)
          if (newRow || ix < w.ox || ix >= w.ox + w.n) fill(w, ix, iz);
      }
    }
    w.ox = ox;
    w.oz = oz;
    return true;
  };
  // Pack the live clumps inside each window's disc (plus a cell of slack:
  // the disc's centre moves between repacks).
  const pack = () => {
    const pa = attrA.array, pb = attrB.array, pt = attrT.array;
    let live = 0;
    for (const w of windows) {
      const reach = (w.spec.radius + w.spec.cell * 1.5) ** 2;
      for (let slot = 0; slot < w.n * w.n; slot++) {
        if (w.b[slot * 4] < 0) continue;
        const dx = w.a[slot * 4] - w.cx, dz = w.a[slot * 4 + 2] - w.cz;
        if (dx * dx + dz * dz > reach) continue;
        for (let k = 0; k < 4; k++) {
          pa[live * 4 + k] = w.a[slot * 4 + k];
          pb[live * 4 + k] = w.b[slot * 4 + k];
        }
        pb[live * 4] += w.layer * 8;
        for (let k = 0; k < 3; k++) pt[live * 3 + k] = w.tint[slot * 3 + k];
        live++;
      }
    }
    for (const attr of [attrA, attrB, attrT]) {
      attr.clearUpdateRanges();
      attr.addUpdateRange(0, live * attr.itemSize);
      attr.needsUpdate = true;
    }
    geometry.instanceCount = live;
  };
  let cat = [0, 0];
  const forward = new THREE.Vector2();
  const update = (camera) => {
    // Coast metres: the land group mirrors z.
    const ex = camera.position.x, ez = -camera.position.z;
    eye.value.set(ex, camera.position.y, ez);
    forward.set(cat[0] - ex, cat[1] - ez);
    if (forward.lengthSq() < 1e-4) forward.set(0, 1);
    forward.normalize();
    let moved = false;
    for (const w of windows) {
      const cx = cat[0] + forward.x * w.spec.ahead;
      const cz = cat[1] + forward.y * w.spec.ahead;
      if (place(w, cx, cz)) {
        moved = true;
        w.cx = cx;
        w.cz = cz;
      }
      centres[w.layer].value.x = cx;
      centres[w.layer].value.y = cz;
    }
    if (moved) pack();
  };
  // The windows follow last frame's camera (only known at draw time), so
  // the cells they uncover are uploaded with this frame's draw; they enter
  // at the faded rim, so the lag is unseen.
  const lastCamera = { position: new THREE.Vector3(), seen: false };
  const remember = (renderer, s, camera) => {
    lastCamera.position.copy(camera.position);
    lastCamera.seen = true;
  };
  mesh.onBeforeRender = remember;
  return {
    windows,
    mesh,
    setCat(x, z) {
      cat[0] = x;
      cat[1] = z;
      if (lastCamera.seen) update(lastCamera);
    },
  };
}
