import * as THREE from "three";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { terrainHeight, islandPoint, noise2, ISLAND, shoreDistance } from "./terrain.js";

// Granite: the rock layout, its shapes, and what the sea needs to know about
// the boulders at the waterline. No three.js scene objects here, so the
// offline water renderer (scripts/render-sky.mjs) can build the same rocks.

// Corestone shapes. Boulder fields read as one repeated blob when every rock
// shares a mesh, so there are several, each with its own joints, clefts and
// weathering pits.
export const ROCK_VARIANTS = 5;
// The scattered shore stones take one shape per ground chunk (forest.js
// CHUNK), so each chunk still draws them in one call.
const SCATTER_CELL = 20;

export function rockLayout(random) {
  const rocks = [];
  for (let i = 0; i < 230; i++) {
    const { x, z } = islandPoint(random() * Math.PI * 2, random() * 7 - 2);
    const size = 0.15 + random() ** 3 * 1.2;
    const sy = size * (0.55 + random() * 0.3);
    // Half sunk in the sand, a joint face roughly down: stones on a beach
    // settle onto their flattest side and the sand drifts up round them.
    rocks.push({
      position: new THREE.Vector3(x, terrainHeight(x, z) + sy * (0.1 + random() * 0.35), z),
      scale: new THREE.Vector3(size, sy, size * (0.75 + random() * 0.3)),
      rotation: new THREE.Euler((random() - 0.5) * 0.7, random() * Math.PI * 2, (random() - 0.5) * 0.7),
      color: new THREE.Color().setHSL(0.08 + random() * 0.02, 0.06, 0.27 + random() * 0.12),
      ground: terrainHeight(x, z),
      variant: scatterVariant(x, z),
    });
  }
  // Granite boulder fields, as on the Cape Peninsula's shores: outcrops of
  // corestones straddling the waterline. Each outcrop weathered out of one
  // jointed block, so its stones share a joint direction and a mineral
  // colour; they grow outward from the biggest, touching, leaning on one
  // another, some stacked on top.
  const clusters = 5 + Math.floor(random() * 3);
  for (let c = 0; c < clusters; c++) {
    const theta = random() * Math.PI * 2;
    const count = 6 + Math.floor(random() * 8);
    const jointYaw = random() * Math.PI * 2;
    const mineralGrey = 0.27 + random() * 0.1;
    const mineralHue = 0.065 + random() * 0.025;
    const centre = islandPoint(theta, random() * 5 - 2.5);
    // Along the shore, where the outcrop strings out.
    const alongX = -Math.sin(theta);
    const alongZ = Math.cos(theta);
    const sizes = Array.from({ length: count }, () => 0.85 + random() ** 1.6 * 3.5).sort((a, b) => b - a);
    const members = [];
    for (let i = 0; i < count; i++) {
      const size = sizes[i];
      const sy = size * (0.55 + random() * 0.35);
      const sz = size * (0.72 + random() * 0.4);
      const reach = (size + sz) * 0.5 * 0.86;
      let x = centre.x;
      let z = centre.z;
      let base = null;
      let tiltX = (random() - 0.5) * 0.12;
      let tiltZ = (random() - 0.5) * 0.12;
      const parent = members.length ? members[Math.floor(random() ** 1.5 * members.length)] : null;
      const stack = parent && i > 2 && size < parent.reach * 0.75 && random() < 0.3;
      if (parent && stack) {
        // Perched on a bigger stone, off its crown, leaning away.
        const a = random() * Math.PI * 2;
        const off = parent.reach * (0.2 + random() * 0.3);
        x = parent.x + Math.cos(a) * off;
        z = parent.z + Math.sin(a) * off;
        base = parent.top - parent.sy * (0.12 + random() * 0.1);
        tiltX = Math.sin(a) * 0.25;
        tiltZ = -Math.cos(a) * 0.25;
      } else if (parent) {
        // Shouldered against its neighbour, mostly along the shore.
        const a = Math.atan2(alongZ, alongX) + (random() < 0.5 ? Math.PI : 0) + (random() - 0.5) * 1.8;
        const gap = (parent.reach + reach) * (0.72 + random() * 0.18);
        x = parent.x + Math.cos(a) * gap;
        z = parent.z + Math.sin(a) * gap;
        // Leaning into it, as the smaller stones of a field do.
        const lean = random() < 0.5 ? 0.12 + random() * 0.25 : 0;
        tiltX = -Math.sin(a) * lean + (random() - 0.5) * 0.08;
        tiltZ = Math.cos(a) * lean + (random() - 0.5) * 0.08;
      }
      const ground = Math.max(terrainHeight(x, z), -0.6);
      // Sunk up to half its height in sand or the seabed; stacked ones
      // sit in the saddle of the stone below.
      const y = base !== null
        ? Math.max(base, ground) + sy * 0.52
        : ground + sy * (0.18 + random() * 0.32);
      const grey = mineralGrey + (random() - 0.5) * 0.035;
      const member = {
        position: new THREE.Vector3(x, y, z),
        scale: new THREE.Vector3(size, sy, sz),
        rotation: new THREE.Euler(tiltX, jointYaw + (random() - 0.5) * 0.22, tiltZ),
        cluster: c,
        jointYaw,
        ground: base !== null ? Math.max(base, ground) : ground,
        // Weathered mineral colour belongs to the parent block.
        color: new THREE.Color().setHSL(mineralHue, 0.05 + random() * 0.035, grey),
        variant: (c * 2 + i) % ROCK_VARIANTS,
      };
      rocks.push(member);
      members.push({ x, z, reach, sy, top: y + sy * 0.8 });
    }
  }
  // Loose stones near an outcrop are its fragments: its mineral colour.
  const parents = rocks.filter((rock) => rock.cluster !== undefined);
  for (const fragment of rocks.slice(0, 230)) {
    let nearest = null;
    let distance = 12;
    for (const parent of parents) {
      const d = Math.hypot(fragment.position.x - parent.position.x, fragment.position.z - parent.position.z);
      if (d < distance) { distance = d; nearest = parent; }
    }
    if (nearest) fragment.color.lerp(nearest.color, 0.65);
  }
  return rocks;
}

function scatterVariant(x, z) {
  const i = Math.floor(x / SCATTER_CELL);
  const j = Math.floor(z / SCATTER_CELL);
  return Math.floor(fract(Math.sin(i * 91.7 + j * 47.3) * 9631.7) * ROCK_VARIANTS);
}

// Per variant: joint planes [normal x, y, z, distance, shift] (granite
// splits along near-orthogonal joint sets; corestones are what weathering
// rounds out of the blocks between them), clefts [normal x, z, offset,
// depth, width] (open vertical joints, V-shaped, deepest on top), weathering
// pits on the crown [x, y, z, radius, depth], and the undercut notch that
// salt spray and sand scour cut round the foot.
const SHAPES = [
  // A squat, blocky corestone split by one open joint.
  { joints: [[0, 1, 0, 0.74, -0.12], [0.8, 0, 0.6, 0.78, 0.05], [-0.6, 0.05, 0.8, 0.8, -0.06]],
    clefts: [[0.6, -0.8, 0.18, 0.12, 0.04]], pits: [[0.15, 1, 0.1, 0.32, 0.05]], notch: 0.05, lean: [0.1, 0, -0.06] },
  // Tall and tilted, jointed three ways, one face steep and one sloping.
  { joints: [[0.2, 1, -0.1, 0.8, -0.1], [-0.6, 0.1, 0.8, 0.74, 0.08], [0.75, 0, 0.66, 0.78, -0.04]],
    clefts: [[0.95, 0.3, -0.2, 0.1, 0.035]], pits: [], notch: 0.04, lean: [-0.08, 0.04, 0.1] },
  // A tabular slab, sheeted flat on top.
  { joints: [[0, 1, 0.1, 0.7, -0.1], [0.95, 0.15, -0.3, 0.78, 0.08], [0.3, 0, 0.95, 0.84, 0]],
    clefts: [[0.3, 0.95, 0.05, 0.08, 0.03], [0.95, -0.3, 0.32, 0.07, 0.03]], pits: [[-0.2, 1, 0.15, 0.28, 0.035], [0.3, 1, -0.3, 0.2, 0.03]], notch: 0.06, lean: [0.12, 0, 0.04] },
  // A dome with sheeting shells and a hollow on the crown.
  { joints: [[0, 1, 0.25, 0.78, -0.2], [0.5, 0, -0.87, 0.76, 0.04], [0.87, 0.1, 0.5, 0.82, -0.05]],
    clefts: [], pits: [[0.1, 1, -0.2, 0.36, 0.07]], notch: 0.07, lean: [-0.1, 0, 0.08] },
  // A split boulder: a deep open joint through the middle.
  { joints: [[0.1, 1, 0, 0.74, -0.12], [0.7, 0, 0.7, 0.8, 0.02], [-0.7, 0, 0.7, 0.84, 0.06]],
    clefts: [[0.7, -0.7, 0.02, 0.2, 0.05], [0.6, 0.8, 0.35, 0.07, 0.03]], pits: [], notch: 0.04, lean: [0.06, 0, 0.12] },
];

// Value noise in 3D (a unit lattice of hashed corners, smoothly blended):
// the corestone's surface wants true 3D noise, not 2D noise smeared round it.
function noise3(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  const h = (a, b, c) => fract(Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453);
  const lerp = (a, b, t) => a + (b - a) * t;
  return lerp(
    lerp(lerp(h(ix, iy, iz), h(ix + 1, iy, iz), u), lerp(h(ix, iy + 1, iz), h(ix + 1, iy + 1, iz), u), v),
    lerp(lerp(h(ix, iy, iz + 1), h(ix + 1, iy, iz + 1), u), lerp(h(ix, iy + 1, iz + 1), h(ix + 1, iy + 1, iz + 1), u), v),
    w,
  );
}

// The radius never dips below this fraction of the bounding sphere above the
// foot: the sea pass (rocks.wgsl rock_hides) treats a 0.7 core as solid.
export const ROCK_CORE = 0.71;

export function rockGeometry(detail = 4, variant = 0) {
  // Weathered granite: a rounded core (corestones erode spherically) cut by
  // joint planes into flatter faces with fairly crisp, weathered edges, open
  // vertical joints, pits on the crown, an undercut foot, sheeting shells
  // peeling off the top and a ridged, knobbly surface. The icosahedron
  // arrives with separate vertices per face; welding them first gives
  // smooth normals instead of visible triangles.
  const source = new THREE.IcosahedronGeometry(1, detail);
  source.deleteAttribute("normal");
  source.deleteAttribute("uv");
  const geometry = mergeVertices(source);
  source.dispose();
  const positions = geometry.attributes.position;
  const p = new THREE.Vector3();
  const o = variant * 17.3;
  const shape = SHAPES[variant % SHAPES.length];
  const radii = new Float32Array(positions.count);
  // Vertex spacing on the unit sphere. Features finer than the mesh can
  // carry are widened (clefts) or faded (fine knobbles), so each LOD shows
  // the same rock, softer, instead of an aliased different one.
  const edge = 1.05 / (detail + 1);
  const fine = smoothstepJs(0.11, 0.05, edge);
  for (let i = 0; i < positions.count; i++) {
    p.fromBufferAttribute(positions, i).normalize();
    // Broad lobes, then a ridged knobbliness a hand or two across.
    // Lopsided: weathered further on one side than the other.
    const [lx, ly, lz] = shape.lean;
    let r = 0.9 + (noise3(p.x * 1.4 + o, p.y * 1.4, p.z * 1.4 - o) - 0.5) * 0.22 + p.x * lx + p.y * ly + p.z * lz;
    const ridge = 1 - Math.abs(noise3(p.x * 4.2 - o, p.y * 4.2 + 3, p.z * 4.2) * 2 - 1);
    const ridgeFine = 1 - Math.abs(noise3(p.x * 9 + 5, p.y * 9 - o, p.z * 9) * 2 - 1);
    r += (ridge * ridge - 0.35) * 0.022 * smoothstepJs(0.2, 0.09, edge) + (ridgeFine * ridgeFine - 0.35) * 0.008 * fine;
    // Joint planes: clamp the radius along a few directions, with a tight
    // smooth minimum: flat faces meeting at weathered but definite edges.
    for (const [nx, ny, nz, d, shift] of shape.joints) {
      const len = Math.hypot(nx, ny, nz);
      const along = (p.x * nx + p.y * ny + p.z * nz) / len;
      r = softMin(r, d / Math.max(0.3, Math.abs(along + shift)), 22);
    }
    // Open joints: V-shaped clefts, deepest over the crown.
    for (const [nx, nz, offset, depth, width] of shape.clefts) {
      const len = Math.hypot(nx, nz);
      const across = Math.abs((p.x * nx + p.z * nz) / len - offset);
      const w = Math.max(width, edge * 0.7);
      r -= depth * Math.sqrt(width / w) * Math.exp(-across / w) * smoothstepJs(-0.55, 0.35, p.y);
    }
    // Weathering pits (gnammas): shallow bowls where rain water stands.
    for (const [cx, cy, cz, radius, depth] of shape.pits) {
      const l = Math.hypot(cx, cy, cz);
      const d = Math.hypot(p.x - cx / l, p.y - cy / l, p.z - cz / l);
      const bowl = smoothstepJs(radius, radius * 0.25, d);
      r -= depth * bowl;
    }
    // Sheeting: onion-skin shells a few centimetres thick, stepped where one
    // has flaked away, on the upper surface only.
    const up = Math.max(0, p.y);
    const sheet = noise3(p.x * 2.2 + o, p.y * 1.1, p.z * 2.2 - o) - 0.55;
    r -= up * 0.035 * smoothstepJs(-0.04, 0.04, sheet);
    // The undercut foot.
    const notch = (p.y + 0.52) / 0.12;
    r -= shape.notch * Math.exp(-notch * notch) * (0.6 + 0.8 * noise3(p.x * 3 + o, 0, p.z * 3));
    radii[i] = r;
  }
  // Fit the unit bounding sphere the sea pass assumes (shoreRockData).
  let max = 0;
  for (let i = 0; i < positions.count; i++) max = Math.max(max, radii[i]);
  for (let i = 0; i < positions.count; i++) {
    p.fromBufferAttribute(positions, i).normalize();
    let r = radii[i] / max;
    // Held off the core smoothly, so no crease shows where it bites.
    if (p.y > -0.4) r = -softMin(-r, -ROCK_CORE, 40);
    p.multiplyScalar(Math.min(1, r));
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
  const geometries = Array.from({ length: ROCK_VARIANTS }, (_, v) => rockGeometry(6, v));
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
