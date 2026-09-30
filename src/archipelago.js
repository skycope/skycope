import * as THREE from 'three';
import { ISLAND } from './terrain.js';

// The distant archipelago: four or five seeded islands 1–6 km out, each a
// procedural height field with its own silhouette and cover — a dark
// forested dome, a long grey-green scrub ridge, bare granite knuckles, a
// pale dune spit. The land layer draws them as real geometry (sharp,
// antialiased, lit by the same sun and sky as the island, fading into the
// horizon haze). archipelago.wgsl is this file's twin, line for line: the sea
// traces the same height fields for their reflections and for the sun they
// hide. Keep the two in step.

export const FOREST = 0, SCRUB = 1, GRANITE = 2, DUNE = 3;
export const ARCHIPELAGO_BOUNDS = Object.freeze({ minDistance: 800, maxDistance: 6000, maxHeight: 360, maxRadius: 2200 });

// Heights reach at most PEAK × height (the detail terms lift a few crests).
export const PEAK = 1.3;
// Near edge and spread of each biome's distance (m).
const DISTANCE = [[1300, 1300], [2800, 2700], [1100, 1100], [1200, 1000]];
// Normalized footprint half-extents: |u| ≤ EXTENT_U, |v| ≤ EXTENT_V.
export const EXTENT_U = 1.2, EXTENT_V = 1.5;

export function archipelagoLayout(seed) {
  const s = seed & 65535;
  const count = 4 + hash(s) % 2;
  // Every biome once, in a seeded order; a fifth island repeats one.
  const biomes = [FOREST, SCRUB, GRANITE, DUNE];
  for (let i = 3; i > 0; i--) {
    const j = hash(s * 7 + i) % (i + 1);
    [biomes[i], biomes[j]] = [biomes[j], biomes[i]];
  }
  biomes.push(hash(s * 13 + 5) % 3);
  const start = random(s, 9, 0) * Math.PI * 2;
  return Array.from({ length: count }, (_, id) => {
    const r = (channel) => random(s, id, channel);
    const biome = biomes[id];
    const bearing = start + id * (Math.PI * 2 / count) + (r(0) - 0.5) * 0.5;
    // The small and low islands lie close enough to read; long ridges and
    // any fifth island sit far out, blue with distance.
    const distance = id === 4 ? 4000 + r(1) * 2000 : DISTANCE[biome][0] + r(1) * DISTANCE[biome][1];
    // Farther islands are bigger, or they would shrink to specks.
    const grow = 0.75 + distance / 6000 * 0.6;
    let width, depth, height;
    if (biome === FOREST) { width = 380 + r(2) * 270; depth = width * (0.55 + r(3) * 0.3); height = 120 + r(4) * 100; }
    else if (biome === SCRUB) { width = 700 + r(2) * 600; depth = width * (0.25 + r(3) * 0.15); height = 80 + r(4) * 80; }
    else if (biome === GRANITE) { width = 180 + r(2) * 160; depth = width * (0.6 + r(3) * 0.35); height = 45 + r(4) * 50; }
    else { width = 450 + r(2) * 350; depth = width * (0.18 + r(3) * 0.12); height = 14 + r(4) * 16; }
    width *= grow; depth *= grow; height *= Math.sqrt(grow);
    return {
      id, biome, distance, bearing, width, depth, height,
      x: ISLAND.x + Math.sin(bearing) * distance,
      z: ISLAND.z + Math.cos(bearing) * distance,
      yaw: r(5) * Math.PI * 2,
      asymmetry: r(6),
      // 24 bits, so the sea's uniform carries it exactly as a float.
      salt: hash(s * 31 + id * 977 + 11) & 0xffffff,
      radius: Math.hypot(width * EXTENT_U, depth * EXTENT_V),
    };
  });
}

// Island-local frame: u along the island's long axis, v across, both in
// units of its half-length and half-width.
export function localUV(island, x, z) {
  const dx = x - island.x, dz = z - island.z;
  const c = Math.cos(island.yaw), s = Math.sin(island.yaw);
  return [(dx * c + dz * s) / island.width, (-dx * s + dz * c) / island.depth];
}

// Height above the sea (m) at normalized (u, v). Negative is under water.
export function islandShape(island, u, v) {
  const salt = island.salt;
  let shape = 0;
  if (island.biome === FOREST) {
    // A rounded dome with a lower shoulder, its outline warped by noise.
    const wu = u + (vnoise(u * 1.7, v * 1.7, salt) - 0.5) * 0.5;
    const wv = v + (vnoise(u * 1.7 + 7.3, v * 1.7 + 2.1, salt) - 0.5) * 0.5;
    const main = Math.max(0, 1 - wu * wu - wv * wv);
    const side = island.asymmetry > 0.5 ? 1 : -1;
    const su = (wu - side * 0.5) / 0.55, sv = (wv + 0.15) / 0.7;
    const shoulder = Math.max(0, 1 - su * su - sv * sv);
    shape = Math.max(Math.pow(main, 1.25), 0.55 * Math.pow(shoulder, 1.1));
    shape *= 0.82 + 0.36 * fbm(u * 3.5, v * 3.5, salt + 1);
    // The canopy's own skyline: crowns ~20 m across.
    shape += 0.03 * vnoise(u * island.width / 20, v * island.depth / 20, salt + 6) * Math.min(1, shape * 8);
  } else if (island.biome === SCRUB) {
    // A long spine of uneven peaks, gullies running down its flanks.
    const meander = (vnoise(u * 1.3, 5.1, salt) - 0.5) * 0.5;
    const vv = v - meander;
    const spine = Math.pow(Math.max(0, 1 - u * u), 0.6) * (0.5 + 0.5 * fbm(u * 2.4, 3.3, salt + 2));
    const across = Math.max(0, 1 - vv * vv);
    shape = spine * Math.pow(across, 1.3) * (0.78 + 0.4 * vnoise(u * 11, vv * 1.6, salt + 3));
    shape += 0.02 * vnoise(u * island.width / 30, v * island.depth / 30, salt + 6) * Math.min(1, shape * 8);
  } else if (island.biome === GRANITE) {
    // A cluster of steep bare knobs, cracked into crags.
    for (let k = 0; k < 4; k++) {
      const kx = (random(salt, k, 0) - 0.5) * 1.1 * (k ? 1 : 0.4);
      const kz = (random(salt, k, 1) - 0.5) * 1.0 * (k ? 1 : 0.4);
      const kr = 0.38 + random(salt, k, 2) * 0.3;
      const kh = k ? 0.45 + random(salt, k, 3) * 0.45 : 1;
      const du = (u - kx) / kr, dv = (v - kz) / kr;
      shape = Math.max(shape, kh * Math.pow(Math.max(0, 1 - du * du - dv * dv), 0.7));
    }
    shape *= 0.72 + 0.5 * ridged(u * 4.5, v * 4.5, salt + 4);
  } else {
    // A low crescent spit of dunes.
    const bend = island.asymmetry * 2 - 1;
    const vv = v - bend * 0.6 * (u * u - 0.3);
    shape = Math.pow(Math.max(0, 1 - u * u), 0.8) * Math.pow(Math.max(0, 1 - vv * vv), 2)
      * (0.72 + 0.4 * vnoise(u * 6, vv * 3, salt + 5));
  }
  // Taper into the sea before the box the tracer tests against.
  const taper = Math.max(0, Math.min(1, (EXTENT_U - Math.abs(u)) / 0.2, (EXTENT_V - Math.abs(v)) / 0.2));
  return island.height * (shape * taper - 0.06);
}

export function islandHeight(island, x, z) {
  const [u, v] = localUV(island, x, z);
  if (Math.abs(u) > EXTENT_U || Math.abs(v) > EXTENT_V) return -island.height * 0.06;
  return islandShape(island, u, v);
}

// Nearest island surface along a ray (coast metres), or null. A slab test
// against each island's box, then a march of the height field with a secant
// refinement: the same algorithm the sea runs in archipelago.wgsl.
export function archipelagoHit(origin, ray, seed, steps = 48) {
  let best = null;
  for (const island of archipelagoLayout(seed)) {
    const span = islandSpan(island, origin, ray);
    if (!span) continue;
    let [t0, t1] = span;
    if (best && t0 >= best.distance) continue;
    const dt = (t1 - t0) / steps;
    let tPrev = t0;
    let fPrev = origin[1] + ray[1] * t0 - islandHeight(island, origin[0] + ray[0] * t0, origin[2] + ray[2] * t0);
    for (let i = 1; i <= steps; i++) {
      const t = t0 + dt * i;
      const f = origin[1] + ray[1] * t - islandHeight(island, origin[0] + ray[0] * t, origin[2] + ray[2] * t);
      if (f < 0 && fPrev >= 0) {
        let a = tPrev, fa = fPrev, b = t, fb = f;
        for (let k = 0; k < 4; k++) {
          const m = a + (b - a) * fa / (fa - fb);
          const fm = origin[1] + ray[1] * m - islandHeight(island, origin[0] + ray[0] * m, origin[2] + ray[2] * m);
          if (fm < 0) { b = m; fb = fm; } else { a = m; fa = fm; }
        }
        const hit = b;
        if (!best || hit < best.distance) {
          const p = [origin[0] + ray[0] * hit, origin[1] + ray[1] * hit, origin[2] + ray[2] * hit];
          best = { distance: hit, normal: islandNormal(island, p[0], p[2]), island: island.id, height: p[1] };
        }
        break;
      }
      tPrev = t; fPrev = f;
    }
  }
  return best;
}

export function islandNormal(island, x, z) {
  const e = Math.max(1.5, island.width * 0.006);
  const hx = islandHeight(island, x + e, z) - islandHeight(island, x - e, z);
  const hz = islandHeight(island, x, z + e) - islandHeight(island, x, z - e);
  const n = [-hx, 2 * e, -hz];
  const l = Math.hypot(...n);
  return n.map((c) => c / l);
}

// The ray's parameter range inside the island's local box, above the sea.
export function islandSpan(island, origin, ray) {
  const c = Math.cos(island.yaw), s = Math.sin(island.yaw);
  const dx = origin[0] - island.x, dz = origin[2] - island.z;
  const p = [dx * c + dz * s, origin[1], -dx * s + dz * c];
  const d = [ray[0] * c + ray[2] * s, ray[1], -ray[0] * s + ray[2] * c];
  const half = [island.width * EXTENT_U, island.height * PEAK, island.depth * EXTENT_V];
  let t0 = 0, t1 = Infinity;
  for (let a = 0; a < 3; a++) {
    const lo = a === 1 ? 0 : -half[a], hi = half[a];
    if (Math.abs(d[a]) < 1e-9) {
      if (p[a] < lo || p[a] > hi) return null;
      continue;
    }
    let ta = (lo - p[a]) / d[a], tb = (hi - p[a]) / d[a];
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    if (t0 > t1) return null;
  }
  return [t0, t1];
}

export function archipelagoHorizonPossible(origin, ray) {
  // As archipelago.wgsl: nothing rises above maxHeight, nor lies within
  // 150 m of the island's centre.
  const closest = Math.max(0, 150 - Math.hypot(origin[0] - ISLAND.x, origin[2] - ISLAND.z));
  const top = ARCHIPELAGO_BOUNDS.maxHeight;
  const horizontal = Math.hypot(ray[0], ray[2]);
  if (ray[1] >= 0 && (origin[1] >= top || horizontal < 1e-6 || ray[1] * closest > (top - origin[1]) * horizontal)) return false;
  if (ray[1] < 0 && (origin[1] < 0 || -ray[1] * closest > origin[1] * horizontal)) return false;
  return true;
}

// The sea's view of the archipelago (Atmosphere.islands in view.wgsl). The
// sea never marches the height fields: each island is baked into its
// silhouette as seen from `origin` at sea level — 24 elevation tangents
// across its angular span — which archipelago.wgsl reprojects from any
// nearby water point. Layout: [0] = (count, sun visibility, nearest land,
// steepest skyline); then
// eight vec4s per island: (centre x, centre z, distance from origin,
// angular half-span), (albedo rgb, -), and six vec4s of profile.
export const ISLAND_SLOTS = 48;
const COVER = [[0.035, 0.06, 0.028], [0.11, 0.115, 0.08], [0.26, 0.245, 0.215], [0.42, 0.37, 0.28]];

export function archipelagoUniform(seed, origin = [ISLAND.x, 0, ISLAND.z]) {
  const islands = archipelagoLayout(seed);
  const out = Array.from({ length: ISLAND_SLOTS }, () => [0, 0, 0, 0]);
  out[0] = [islands.length, 1, 0, 0];
  islands.forEach((s, k) => {
    const base = 1 + k * 8;
    const dx = s.x - origin[0], dz = s.z - origin[2];
    const distance = Math.hypot(dx, dz);
    const bearing = Math.atan2(dx, dz);
    const c = Math.cos(s.yaw), n = Math.sin(s.yaw);
    const relative = (x, z) => {
      let a = Math.atan2(x - origin[0], z - origin[2]) - bearing;
      while (a > Math.PI) a -= 2 * Math.PI;
      while (a < -Math.PI) a += 2 * Math.PI;
      return a;
    };
    // The span of dry land, seen from the origin.
    let span = 0;
    for (let j = 0; j <= 48; j++) for (let i = 0; i <= 48; i++) {
      const u = (i / 48 * 2 - 1) * EXTENT_U, v = (j / 48 * 2 - 1) * EXTENT_V;
      if (islandShape(s, u, v) <= 0) continue;
      const x = s.x + u * s.width * c - v * s.depth * n, z = s.z + u * s.width * n + v * s.depth * c;
      span = Math.max(span, Math.abs(relative(x, z)));
    }
    span = Math.max(span * 1.04, 1e-4);
    out[base] = [s.x, s.z, distance, span];
    out[base + 1] = [...COVER[s.biome], 0];
    // The skyline: the steepest elevation along each of 24 bearings.
    const reach = s.radius;
    for (let q = 0; q < 24; q++) {
      const a = bearing + (q / 23 * 2 - 1) * span;
      const rx = Math.sin(a), rz = Math.cos(a);
      let top = 0;
      for (let m = 0; m <= 96; m++) {
        const t = Math.max(1, distance - reach + (m / 96) * reach * 2);
        top = Math.max(top, islandHeight(s, origin[0] + rx * t, origin[2] + rz * t) / t);
      }
      out[base + 2 + (q >> 2)][q & 3] = top;
      out[0][3] = Math.max(out[0][3], top);
    }
    out[0][2] = Math.min(out[0][2] || Infinity, distance - s.radius);
  });
  // Gates for the sea: the nearest land (m) and steepest skyline (tangent),
  // with room for the camera's wanderings around the origin.
  out[0][2] = Math.max(0, out[0][2] - 250);
  out[0][3] = out[0][3] * 1.5 + 0.01;
  return out;
}

// How much of the sun's disc (as drawn, ~0.35° across) the islands leave
// visible from `origin`, 0–1: five rays over the disc. For the sea's glitter
// and sunlight, once per frame rather than per pixel.
export function archipelagoSunVisibility(origin, sun, seed) {
  if (sun[1] > 0.4 || sun[1] < -0.02 || !archipelagoHorizonPossible(origin, sun)) return 1;
  const side = Math.hypot(sun[0], sun[2]) > 1e-6 ? [-sun[2], 0, sun[0]].map((v) => v / Math.hypot(sun[0], sun[2])) : [1, 0, 0];
  const up = [0, 1, 0];
  let seen = 0;
  for (const [a, b] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const ray = sun.map((v, i) => v + (side[i] * a + up[i] * b) * 0.005);
    const l = Math.hypot(...ray);
    if (!archipelagoHit(origin, ray.map((v) => v / l), seed, 24)) seen++;
  }
  return seen / 5;
}

// ---- The islands as geometry, for the land layer. -------------------------

// One merged mesh (one draw call). Vertices are spaced for about a quarter
// of a degree at the island's distance, so silhouettes stay smooth for
// ~15k triangles all told; the fragment shader adds everything finer.
export function createArchipelago(seed, { light = false } = {}) {
  const islands = archipelagoLayout(seed);
  const positions = [], normals = [], info = [], indices = [];
  for (const island of islands) {
    const spacing = island.distance * (light ? 0.0075 : 0.0048);
    const nu = Math.max(24, Math.min(light ? 96 : 200, Math.ceil(2 * island.width * EXTENT_U / spacing)));
    const nv = Math.max(12, Math.min(light ? 64 : 120, Math.ceil(2 * island.depth * EXTENT_V / spacing)));
    const base = positions.length / 3;
    const c = Math.cos(island.yaw), s = Math.sin(island.yaw);
    const heights = new Float32Array((nu + 1) * (nv + 1));
    for (let j = 0; j <= nv; j++) {
      for (let i = 0; i <= nu; i++) {
        const u = (i / nu * 2 - 1) * EXTENT_U, v = (j / nv * 2 - 1) * EXTENT_V;
        const a = u * island.width, b = v * island.depth;
        const x = island.x + a * c - b * s, z = island.z + a * s + b * c;
        const h = islandShape(island, u, v);
        heights[j * (nu + 1) + i] = h;
        // Under water the surface dives steeply, so the shoreline is where
        // the interpolated height crosses zero (the shader cuts it there).
        positions.push(x, h < 0 ? h * 4 : h, -z);
        const n = islandNormal(island, x, z);
        normals.push(n[0], n[1], -n[2]);
        info.push(u, v, island.biome + island.id * 4 + 0.5);
      }
    }
    for (let j = 0; j < nv; j++) {
      for (let i = 0; i < nu; i++) {
        const k = j * (nu + 1) + i;
        const q = [k, k + 1, k + nu + 1, k + nu + 2];
        if (q.every((m) => heights[m] < 0)) continue;
        // Counter-clockwise seen from above, after Three's mirrored z.
        indices.push(base + q[0], base + q[1], base + q[2], base + q[1], base + q[3], base + q[2]);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('island', new THREE.Float32BufferAttribute(info, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();

  const packed = new Float32Array(20);
  islands.forEach((island, k) => packed.set([island.height, island.salt % 4096, island.asymmetry, island.distance], k * 4));
  const uniforms = {
    sunDirection: { value: new THREE.Vector3(0, 1, 0) },
    sunLight: { value: new THREE.Color(1, 1, 1) },
    skyLight: { value: new THREE.Color(0.3, 0.4, 0.5) },
    bounceLight: { value: new THREE.Color(0.05, 0.05, 0.04) },
    hazeToward: { value: new THREE.Color(0.6, 0.7, 0.8) },
    hazeAway: { value: new THREE.Color(0.6, 0.7, 0.8) },
    extinction: { value: new THREE.Vector3(5e-5, 6e-5, 8e-5) },
    pixelAngle: { value: 0.001 },
    islands: { value: packed },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    fog: false,
    lights: false,
    toneMapped: true,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  const scene = new THREE.Scene();
  scene.add(mesh);
  scene.matrixWorldAutoUpdate = false;
  mesh.updateMatrixWorld(true);
  // Its own depth range: 150 m to 14 km, drawn before the island and
  // cleared from the depth buffer, so the near scene keeps its precision.
  const camera = new THREE.PerspectiveCamera(50, 1, 150, 14000);
  return { islands, scene, camera, uniforms, geometry, material };
}

const VERTEX = /* glsl */ `
attribute vec3 island;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vIsland;
void main() {
  vWorld = position;
  vNormal = normal;
  vIsland = island;
  gl_Position = projectionMatrix * viewMatrix * vec4( position, 1.0 );
}
`;

const FRAGMENT = /* glsl */ `
uniform vec3 sunDirection;
uniform vec3 sunLight;
uniform vec3 skyLight;
uniform vec3 bounceLight;
uniform vec3 hazeToward;
uniform vec3 hazeAway;
uniform vec3 extinction;
uniform float pixelAngle;
uniform vec4 islands[5];
varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vIsland;

float hash21( vec2 p ) {
  vec3 q = fract( vec3( p.xyx ) * 0.1031 );
  q += dot( q, q.yzx + 33.33 );
  return fract( ( q.x + q.y ) * q.z );
}
float vnoise( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = fract( p );
  vec2 w = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( hash21( i ), hash21( i + vec2( 1.0, 0.0 ) ), w.x ),
    mix( hash21( i + vec2( 0.0, 1.0 ) ), hash21( i + vec2( 1.0, 1.0 ) ), w.x ), w.y );
}

void main() {
  float height = vWorld.y;
  // The shoreline: the sea (the WebGPU layer below) shows where the
  // interpolated surface dips under it.
  if ( height < 0.0 ) discard;
  int id = int( vIsland.z ) / 4;
  int biome = int( vIsland.z ) - id * 4;
  vec4 info = islands[ id ];
  float peak = info.x;
  float salt = info.y;
  vec3 toEye = cameraPosition - vWorld;
  float distance = length( toEye );
  vec3 view = toEye / distance;
  // One pixel's footprint here, in metres: detail finer than ~3 px fades out
  // instead of shimmering.
  float footprint = distance * pixelAngle;
  vec2 p = vWorld.xz + salt * 1.37;
  float elevation = height / max( peak, 1.0 );
  vec3 n = normalize( vNormal );
  float slope = 1.0 - n.y;

  // Canopy and scrub texture: crowns ~12 m, clumps ~40 m.
  float crownFade = 1.0 - smoothstep( 3.0, 7.0, footprint );
  float clumps = vnoise( p / 38.0 );
  float crowns = mix( 0.5, vnoise( p / 11.0 ), crownFade );
  // Bump the normal with the crowns, so low sun rakes across the canopy.
  float e = 4.0;
  vec2 grad = vec2( vnoise( ( p + vec2( e, 0.0 ) ) / 11.0 ) - vnoise( ( p - vec2( e, 0.0 ) ) / 11.0 ),
    vnoise( ( p + vec2( 0.0, e ) ) / 11.0 ) - vnoise( ( p - vec2( 0.0, e ) ) / 11.0 ) ) * crownFade;

  vec3 albedo;
  float bump = 0.0;
  float rough = 1.0;
  if ( biome == 0 ) {
    // Forest: deep emerald canopy, darker in the gullies, with a pale
    // rocky fringe the waves keep bare.
    albedo = mix( vec3( 0.022, 0.048, 0.022 ), vec3( 0.05, 0.085, 0.035 ), clumps * 0.6 + crowns * 0.4 );
    albedo = mix( albedo, vec3( 0.2, 0.19, 0.16 ), smoothstep( 0.62, 0.8, slope + clumps * 0.2 ) * 0.7 );
    bump = 1.6;
  } else if ( biome == 1 ) {
    // Coastal scrub: grey-green heath with pale sand and rock showing through.
    albedo = mix( vec3( 0.075, 0.085, 0.055 ), vec3( 0.13, 0.13, 0.085 ), clumps );
    albedo = mix( albedo, vec3( 0.34, 0.31, 0.25 ), smoothstep( 0.55, 0.75, clumps + slope * 0.6 - crowns * 0.2 ) * 0.8 );
    albedo *= 0.85 + 0.3 * crowns;
    bump = 0.8;
  } else if ( biome == 2 ) {
    // Granite: weathered grey-tan rock streaked by runnels, a little green
    // in the hollows.
    float streak = vnoise( vec2( p.x / 7.0, p.y / 7.0 ) + vec2( 0.0, height / 5.0 ) );
    albedo = mix( vec3( 0.2, 0.19, 0.17 ), vec3( 0.36, 0.33, 0.29 ), clumps * 0.6 + streak * 0.4 * crownFade + 0.2 * ( 1.0 - crownFade ) );
    albedo = mix( albedo, vec3( 0.06, 0.08, 0.045 ), ( 1.0 - smoothstep( 0.12, 0.35, slope ) ) * smoothstep( 0.4, 0.7, clumps ) * 0.8 );
    bump = 0.6;
    rough = 0.8;
  } else {
    // Dunes: pale sand, marram on the crests.
    albedo = mix( vec3( 0.46, 0.4, 0.3 ), vec3( 0.56, 0.49, 0.37 ), crowns );
    albedo = mix( albedo, vec3( 0.1, 0.12, 0.07 ), smoothstep( 0.35, 0.6, elevation ) * smoothstep( 0.45, 0.7, clumps ) * 0.7 );
    bump = 0.3;
  }
  // Every shore has a bare band: wet dark rock and sand, then a thin line
  // of surf at the waterline.
  float band = 1.0 - smoothstep( 1.5, 4.0 + clumps * 4.0, height );
  albedo = mix( albedo, biome == 3 ? vec3( 0.34, 0.3, 0.23 ) : vec3( 0.13, 0.12, 0.105 ), band );
  float surf = ( 1.0 - smoothstep( 0.1, 0.5 + clumps * 0.6, height ) ) * ( 1.0 - smoothstep( 1.0, 4.0, footprint ) * 0.6 );
  albedo = mix( albedo, vec3( 0.6, 0.63, 0.65 ), surf );

  n = normalize( n + vec3( -grad.x, 0.0, -grad.y ) * bump );
  float sun = max( dot( n, sunDirection ), 0.0 );
  // Canopies self-shade: a sunlit slope is still half crown shadow.
  sun *= mix( 1.0, 0.55 + 0.45 * crowns, biome == 0 ? 1.0 : 0.4 );
  vec3 light = sunLight * sun * ( 1.0 / 3.14159 ) * rough
    + skyLight * ( 0.62 + 0.38 * n.y ) + bounceLight * ( 0.5 - 0.5 * n.y );
  vec3 colour = albedo * light;

  // Aerial perspective: the horizon sky along this line of sight, warm
  // toward the sun and cool away from it. Distant islands keep a trace of
  // their own darkness, bluing and greying as they go.
  vec3 transmit = exp( -distance * extinction );
  vec3 level = normalize( vec3( -view.x, 0.0, -view.z ) );
  vec3 sunFlat = normalize( vec3( sunDirection.x, 0.0, sunDirection.z ) + 1e-5 );
  vec3 haze = mix( hazeAway, hazeToward, pow( 0.5 + 0.5 * dot( level, sunFlat ), 2.5 ) );
  float luma = dot( colour, vec3( 0.2126, 0.7152, 0.0722 ) );
  colour = mix( colour, vec3( luma ), ( 1.0 - transmit.g ) * 0.4 );
  colour = colour * transmit + haze * ( 1.0 - transmit );
  gl_FragColor = vec4( colour, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// ---- Shared seeded noise (bit-exact with archipelago.wgsl). ----------------

export function vnoise(x, y, salt) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const wx = fx * fx * (3 - 2 * fx), wy = fy * fy * (3 - 2 * fy);
  const a = lattice(ix, iy, salt), b = lattice(ix + 1, iy, salt);
  const c = lattice(ix, iy + 1, salt), d = lattice(ix + 1, iy + 1, salt);
  return a + (b - a) * wx + (c - a) * wy + (a - b - c + d) * wx * wy;
}

export function fbm(x, y, salt) {
  return vnoise(x, y, salt) * 0.55 + vnoise(x * 2.03 + 3.1, y * 2.03 + 1.7, salt) * 0.3 + vnoise(x * 4.1 + 5.3, y * 4.1 + 2.9, salt) * 0.15;
}

export function ridged(x, y, salt) {
  const a = 1 - Math.abs(vnoise(x, y, salt) * 2 - 1);
  const b = 1 - Math.abs(vnoise(x * 2.1 + 4.7, y * 2.1 + 1.3, salt) * 2 - 1);
  return a * a * 0.65 + b * b * 0.35;
}

function lattice(ix, iy, salt) {
  return (hash((Math.imul(ix, 0x8da6b343) ^ Math.imul(iy, 0xd8163841) ^ salt) >>> 0) & 0xffffff) / 16777216;
}

function random(seed, id, channel) {
  return (hash((seed + Math.imul(id + 1, 0x9e3779b9) + Math.imul(channel + 1, 0x85ebca6b)) >>> 0) & 0xffffff) / 16777216;
}

function hash(value) {
  let h = value >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  return (h ^ h >>> 16) >>> 0;
}
