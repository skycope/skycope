import * as THREE from "three";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { terrainHeight, islandPoint, noise2, ISLAND, shoreDistance } from "./terrain.js";

// Granite: the rock layout, its shapes, and what the sea needs to know about
// the boulders at the waterline. No three.js scene objects here, so the
// offline water renderer (scripts/render-sky.mjs) can build the same rocks.

// Corestone shapes. Boulder fields read as one repeated blob when every rock
// shares a mesh, so there are a few, each with its own joints and sheeting.
export const ROCK_VARIANTS = 3;

export function rockLayout(random) {
  const rocks = [];
  for (let i = 0; i < 230; i++) {
    const { x, z } = islandPoint(random() * Math.PI * 2, random() * 7 - 2);
    const size = 0.15 + random() ** 3 * 1.2;
    rocks.push({
      position: new THREE.Vector3(x, terrainHeight(x, z) + size * 0.25, z),
      scale: new THREE.Vector3(size, size * 0.7, size * 0.85),
      rotation: new THREE.Euler(random(), random() * 6, random()),
      color: new THREE.Color().setHSL(0.09, 0.06, 0.27 + random() * 0.12),
      // Scattered all round the shore: one shape, so each ground chunk
      // keeps one draw for them. The boulder fields below get all three.
      variant: 0,
    });
  }
  // Granite boulder fields, as on the Cape Peninsula's shores: a few clusters
  // of big rounded corestones straddling the waterline, stacked and leaning.
  const clusters = 5 + Math.floor(random() * 3);
  for (let c = 0; c < clusters; c++) {
    const theta = random() * Math.PI * 2;
    const count = 5 + Math.floor(random() * 8);
    for (let i = 0; i < count; i++) {
      const { x, z } = islandPoint(
        theta + (random() - 0.5) * 0.12,
        random() * 9 - 4,
      );
      const size = 0.9 + random() ** 1.5 * 3.2;
      const grey = 0.3 + random() * 0.12;
      rocks.push({
        position: new THREE.Vector3(
          x,
          Math.max(terrainHeight(x, z), -0.6) + size * (0.2 + random() * 0.3),
          z,
        ),
        scale: new THREE.Vector3(size, size * (0.65 + random() * 0.3), size * (0.8 + random() * 0.3)),
        rotation: new THREE.Euler(random() * 0.6, random() * 6, random() * 0.6),
        // Cape granite weathers from pale grey to a warm, iron-stained buff.
        color: new THREE.Color().setHSL(0.07 + random() * 0.04, 0.07 + random() * 0.05, grey * 0.8),
        variant: (c + i) % ROCK_VARIANTS,
      });
    }
  }
  return rocks;
}

// Joint planes per variant: [normal x, y, z, distance]. Granite splits along
// near-orthogonal joint sets; corestones are what weathering rounds out of
// the blocks between them.
const JOINTS = [
  [[0, 1, 0, 0.92, -0.15], [0.8, 0, 0.6, 0.95, 0]],
  [[0.2, 1, -0.1, 0.84, -0.05], [-0.6, 0.1, 0.8, 0.9, 0.05], [0.75, 0, 0.66, 1.02, 0]],
  [[0, 1, 0.25, 0.97, -0.25], [0.95, 0.15, -0.3, 0.86, 0.1]],
];

export function rockGeometry(detail = 4, variant = 0) {
  // Weathered granite: a rounded core (corestones erode spherically) with
  // flattened sides from jointing, sheeting shells peeling off the top and a
  // little surface roughness. The icosahedron arrives with separate vertices
  // per face; welding them first gives smooth normals instead of visible
  // triangles.
  const source = new THREE.IcosahedronGeometry(1, detail);
  source.deleteAttribute("normal");
  source.deleteAttribute("uv");
  const geometry = mergeVertices(source);
  source.dispose();
  const positions = geometry.attributes.position;
  const p = new THREE.Vector3();
  const o = variant * 17.3;
  for (let i = 0; i < positions.count; i++) {
    p.fromBufferAttribute(positions, i);
    let r =
      0.8 +
      noise2(p.x * 1.6 + p.y * 1.3 + 3 + o, p.z * 1.6 - p.y) * 0.3 +
      noise2(p.x * 4 + 7, p.z * 4 + p.y * 3 + o) * 0.08 +
      noise2(p.x * 11 + o, p.z * 11 + p.y * 7) * 0.025;
    // Joint planes: clamp the radius along a few directions, with a smooth
    // minimum so weathering rounds the edges instead of leaving creases.
    for (const [nx, ny, nz, d, shift] of JOINTS[variant % JOINTS.length]) {
      const len = Math.hypot(nx, ny, nz);
      const along = (p.x * nx + p.y * ny + p.z * nz) / len;
      r = softMin(r, d / Math.max(0.3, Math.abs(along + shift)));
    }
    // Sheeting: onion-skin shells a few centimetres thick, stepped where one
    // has flaked away, on the upper surface only.
    const up = Math.max(0, p.y);
    const sheet = noise2(p.x * 2.2 + o, p.z * 2.2 - o) - 0.55;
    r -= up * 0.035 * smoothstepJs(-0.04, 0.04, sheet);
    p.multiplyScalar(r);
    positions.setXYZ(i, p.x, p.y, p.z);
  }
  geometry.computeVertexNormals();
  return geometry;
}

function smoothstepJs(a, b, x) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export function softMin(a, b, k = 9) {
  return -Math.log(Math.exp(-k * a) + Math.exp(-k * b)) / k;
}

// ---- The sea's view of the rocks -------------------------------------------
// For the water pass (ocean.wgsl): every rock that reaches the sea, as
//  - its world-to-local transform (the unit corestone) and a bounding
//    sphere, for reflections,
//    shadows on the water and boulders seen through it;
//  - its true waterline, sliced from the mesh at sea level, as 16 radii
//    around its centre, so lapping ripples and the foam collar hug the rock;
// and a 2 m lookup grid of the (up to 8) rocks that can affect each cell.
export const SHORE_ROCK_FLOATS = 40;
export const SHORE_GRID = { cells: 100, cell: 2, x0: ISLAND.x - 100, z0: ISLAND.z - 100 };
export const SHORE_ROCK_MAX = 160;
// Metres beyond a rock's outline where its ripples, foam and reflection can reach.
const REACH = 3.2;

export function shoreRockData(rocks) {
  const geometries = Array.from({ length: ROCK_VARIANTS }, (_, v) => rockGeometry(3, v));
  const matrix = new THREE.Matrix4();
  const inverse = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const v = new THREE.Vector3();
  const selected = [];
  for (const rock of rocks) {
    const bottom = rock.position.y - rock.scale.y * 1.05;
    const top = rock.position.y + rock.scale.y * 1.05;
    const horizontal = Math.max(rock.scale.x, rock.scale.z) * 1.1;
    // Rocks the sea can touch, see through to or mirror: in the water, or
    // on the sand within reach of it, and not too small to show.
    if (horizontal < 0.25 || bottom > 0.6) continue;
    if (shoreDistance(rock.position.x, rock.position.z) - horizontal > REACH) continue;
    selected.push(rock);
  }
  selected.sort((a, b) => b.scale.x - a.scale.x);
  selected.length = Math.min(selected.length, SHORE_ROCK_MAX);
  const data = new Float32Array(Math.max(1, selected.length) * SHORE_ROCK_FLOATS);
  const reach = [];
  selected.forEach((rock, n) => {
    matrix.compose(rock.position, quaternion.setFromEuler(rock.rotation), rock.scale);
    inverse.copy(matrix).invert();
    const e = inverse.elements; // column-major
    const base = n * SHORE_ROCK_FLOATS;
    for (let row = 0; row < 3; row++)
      data.set([e[row], e[row + 4], e[row + 8], e[row + 12]], base + row * 4);
    // Waterline: where the mesh's edges cross y = 0, binned by angle.
    const geometry = geometries[rock.variant ?? 0];
    const position = geometry.attributes.position;
    const index = geometry.index.array;
    const ys = new Float32Array(position.count);
    const xs = new Float32Array(position.count);
    const zs = new Float32Array(position.count);
    for (let i = 0; i < position.count; i++) {
      v.fromBufferAttribute(position, i).applyMatrix4(matrix);
      xs[i] = v.x;
      ys[i] = v.y;
      zs[i] = v.z;
    }
    const points = [];
    for (let t = 0; t < index.length; t += 3)
      for (let k = 0; k < 3; k++) {
        const a = index[t + k];
        const b = index[t + ((k + 1) % 3)];
        if (a > b || (ys[a] > 0) === (ys[b] > 0)) continue;
        const f = ys[a] / (ys[a] - ys[b]);
        points.push([xs[a] + (xs[b] - xs[a]) * f, zs[a] + (zs[b] - zs[a]) * f]);
      }
    const radii = new Float32Array(16);
    let cx = rock.position.x;
    let cz = rock.position.z;
    if (points.length >= 6) {
      cx = points.reduce((s, q) => s + q[0], 0) / points.length;
      cz = points.reduce((s, q) => s + q[1], 0) / points.length;
      const filled = new Uint8Array(16);
      for (const [px, pz] of points) {
        const angle = Math.atan2(pz - cz, px - cx);
        const bin = ((Math.round((angle / (Math.PI * 2)) * 16) % 16) + 16) % 16;
        radii[bin] = Math.max(radii[bin], Math.hypot(px - cx, pz - cz));
        filled[bin] = 1;
      }
      // Bins no edge crossed borrow from their neighbours.
      for (let pass = 0; pass < 8; pass++)
        for (let i = 0; i < 16; i++)
          if (!filled[i]) {
            const l = radii[(i + 15) % 16];
            const r = radii[(i + 1) % 16];
            if (l > 0 || r > 0) radii[i] = l > 0 && r > 0 ? (l + r) / 2 : Math.max(l, r);
          }
    }
    const waterline = Math.max(...radii);
    const phase = fract(Math.sin(rock.position.x * 12.9898 + rock.position.z * 78.233) * 43758.5453) * 6.283;
    data.set([cx, cz, waterline, phase], base + 12);
    data.set(radii, base + 16);
    const height = Math.max(0, rock.position.y + rock.scale.y);
    const r = Math.max(rock.scale.x, rock.scale.z) + Math.min(REACH + height * 2.2, 10);
    // Long enough for a boulder's shadow in a low sun. The reach goes to the
    // shader too: shadows and reflections fade out
    // before it ends, or they would stop dead at the edge of a grid cell.
    const c = rock.color;
    data.set([c.r, c.g, c.b, r], base + 32);
    // A bounding sphere round the corestone, so rays can skip it cheaply.
    const bound = Math.max(rock.scale.x, rock.scale.y, rock.scale.z) * 1.02;
    data.set([rock.position.x, rock.position.y, rock.position.z, bound], base + 36);
    reach.push({ x: rock.position.x, z: rock.position.z, r });
  });
  for (const g of geometries) g.dispose();
  // The grid: each cell lists the nearest 8 rocks whose reach overlaps it,
  // as 16-bit (index + 1) pairs; 0 is empty.
  const { cells, cell, x0, z0 } = SHORE_GRID;
  const grid = new Uint32Array(cells * cells * 4);
  const lists = new Map();
  reach.forEach(({ x, z, r }, n) => {
    const i0 = Math.max(0, Math.floor((x - r - x0) / cell));
    const i1 = Math.min(cells - 1, Math.floor((x + r - x0) / cell));
    const j0 = Math.max(0, Math.floor((z - r - z0) / cell));
    const j1 = Math.min(cells - 1, Math.floor((z + r - z0) / cell));
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        // Distance from the rock to the nearest point of the cell.
        const dx = Math.max(x0 + i * cell - x, 0, x - (x0 + (i + 1) * cell));
        const dz = Math.max(z0 + j * cell - z, 0, z - (z0 + (j + 1) * cell));
        const d = Math.hypot(dx, dz);
        if (d > r) continue;
        const key = j * cells + i;
        if (!lists.has(key)) lists.set(key, []);
        lists.get(key).push([d - r, n]);
      }
  });
  for (const [key, list] of lists) {
    list.sort((a, b) => a[0] - b[0]);
    for (let s = 0; s < Math.min(8, list.length); s++) {
      const word = key * 4 + (s >> 1);
      grid[word] |= (list[s][1] + 1) << ((s & 1) * 16);
    }
  }
  return { rocks: data, grid, count: selected.length };
}

function fract(x) {
  return x - Math.floor(x);
}
