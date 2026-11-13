// Routes for the wisp: a way across the island a cat can actually walk,
// round trunks, fences and big rocks, up slopes it can climb, and over the
// sea only within reach. A coarse grid (1.5 m cells) built once, lazily, and
// searched with A* when the wisp's target changes; the path is then pulled
// straight wherever the straight way is clear. Pure: no three.js, no DOM.
import { groundHeight, shoreDistance, ISLAND } from "./terrain.js";

const CELL = 1.5;
const HALF = 96;
const N = Math.ceil((HALF * 2) / CELL);
// The steepest step between neighbouring cells a cat takes (metres per cell).
const CLIMB = 1.1;
// A boulder top (or wall) this far above the ground is a rock to go round;
// lower ones (the lighthouse yard's wall) the cat hops onto.
const ROCK = 0.85;

export function createRoutes({ obstacles = null, surface = groundHeight, reach = 21 } = {}) {
  let blocked = null;
  let height = null;
  const ox = ISLAND.x - HALF;
  const oz = ISLAND.z - HALF;
  const cellOf = (x, z) => {
    const i = Math.floor((x - ox) / CELL);
    const j = Math.floor((z - oz) / CELL);
    return i < 0 || j < 0 || i >= N || j >= N ? -1 : j * N + i;
  };
  const centreX = (k) => ox + ((k % N) + 0.5) * CELL;
  const centreZ = (k) => oz + (Math.floor(k / N) + 0.5) * CELL;

  function build() {
    blocked = new Uint8Array(N * N);
    height = new Float32Array(N * N);
    for (let k = 0; k < N * N; k++) {
      const x = centreX(k);
      const z = centreZ(k);
      if (shoreDistance(x, z) < -reach) {
        blocked[k] = 1;
        continue;
      }
      const h = surface(x, z);
      height[k] = h;
      if (h - groundHeight(x, z) > ROCK) blocked[k] = 1;
    }
    // Trunks (and fence posts, the lighthouse): every cell whose centre is
    // within the trunk plus a cat's half-width.
    for (const t of obstacles?.trunks ?? []) {
      const r = t.r + 0.3 + CELL * 0.35;
      for (let i = Math.floor((t.x - r - ox) / CELL); i <= Math.floor((t.x + r - ox) / CELL); i++)
        for (let j = Math.floor((t.z - r - oz) / CELL); j <= Math.floor((t.z + r - oz) / CELL); j++) {
          if (i < 0 || j < 0 || i >= N || j >= N) continue;
          const k = j * N + i;
          if (Math.hypot(centreX(k) - t.x, centreZ(k) - t.z) < r) blocked[k] = 1;
        }
    }
  }

  // Nearest open cell to (x, z) within a few cells.
  function open(x, z) {
    let k = cellOf(x, z);
    if (k >= 0 && !blocked[k]) return k;
    let best = -1;
    let bestD = Infinity;
    const i0 = Math.floor((x - ox) / CELL);
    const j0 = Math.floor((z - oz) / CELL);
    for (let r = 1; r <= 4 && best < 0; r++)
      for (let i = i0 - r; i <= i0 + r; i++)
        for (let j = j0 - r; j <= j0 + r; j++) {
          if (i < 0 || j < 0 || i >= N || j >= N) continue;
          k = j * N + i;
          if (blocked[k]) continue;
          const d = Math.hypot(centreX(k) - x, centreZ(k) - z);
          if (d < bestD) [best, bestD] = [k, d];
        }
    return best;
  }

  const g = new Float32Array(N * N);
  const from = new Int32Array(N * N);
  const seen = new Uint32Array(N * N);
  let stamp = 0;
  const heap = [];
  const NEIGHBOURS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];

  return {
    // A walkable way from (ax, az) to (bx, bz): [x0, z0, x1, z1, …] (coast
    // metres, starting at a, ending at or near b), or null if none.
    find(ax, az, bx, bz) {
      if (!blocked) build();
      const start = open(ax, az);
      const goal = open(bx, bz);
      if (start < 0 || goal < 0) return null;
      stamp++;
      heap.length = 0;
      const gx = goal % N;
      const gz = Math.floor(goal / N);
      const h = (k) => Math.hypot((k % N) - gx, Math.floor(k / N) - gz);
      g[start] = 0;
      from[start] = -1;
      seen[start] = stamp;
      push(heap, start, h(start));
      let best = start;
      let bestH = h(start);
      let steps = 0;
      while (heap.length && steps++ < N * N) {
        const k = pop(heap);
        if (k === goal) {
          best = k;
          break;
        }
        const hk = h(k);
        if (hk < bestH) [best, bestH] = [k, hk];
        const i = k % N;
        const j = Math.floor(k / N);
        for (const [di, dj, w] of NEIGHBOURS) {
          const ni = i + di;
          const nj = j + dj;
          if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
          const n = nj * N + ni;
          if (blocked[n]) continue;
          // No squeezing diagonally between two blocked cells.
          if (di && dj && (blocked[j * N + ni] || blocked[nj * N + i])) continue;
          const rise = Math.abs(height[n] - height[k]);
          if (rise > CLIMB * w) continue;
          const cost = g[k] + w * (1 + rise * 1.5);
          if (seen[n] === stamp && cost >= g[n]) continue;
          seen[n] = stamp;
          g[n] = cost;
          from[n] = k;
          push(heap, n, cost + h(n));
        }
      }
      const cells = [];
      for (let k = best; k >= 0; k = from[k]) cells.push(k);
      cells.reverse();
      const out = [ax, az];
      for (let c = 1; c < cells.length; c++) out.push(centreX(cells[c]), centreZ(cells[c]));
      if (best === goal) out.push(bx, bz);
      return out;
    },
    // Walkable straight segment between two points (no blocked cell crossed).
    clear(ax, az, bx, bz) {
      if (!blocked) build();
      const length = Math.hypot(bx - ax, bz - az);
      const steps = Math.max(1, Math.ceil(length / (CELL * 0.5)));
      for (let s = 1; s < steps; s++) {
        const k = cellOf(ax + ((bx - ax) * s) / steps, az + ((bz - az) * s) / steps);
        if (k < 0 || blocked[k]) return false;
      }
      return true;
    },
  };
}

// A binary min-heap of cell indices keyed by f, in a plain array of pairs.
function push(heap, k, f) {
  heap.push(k, f);
  let i = heap.length / 2 - 1;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (heap[p * 2 + 1] <= f) break;
    heap[i * 2] = heap[p * 2];
    heap[i * 2 + 1] = heap[p * 2 + 1];
    i = p;
  }
  heap[i * 2] = k;
  heap[i * 2 + 1] = f;
}
function pop(heap) {
  const top = heap[0];
  const lastK = heap[heap.length - 2];
  const lastF = heap[heap.length - 1];
  heap.length -= 2;
  const n = heap.length / 2;
  if (n === 0) return top;
  let i = 0;
  for (;;) {
    let c = i * 2 + 1;
    if (c >= n) break;
    if (c + 1 < n && heap[(c + 1) * 2 + 1] < heap[c * 2 + 1]) c++;
    if (heap[c * 2 + 1] >= lastF) break;
    heap[i * 2] = heap[c * 2];
    heap[i * 2 + 1] = heap[c * 2 + 1];
    i = c;
  }
  heap[i * 2] = lastK;
  heap[i * 2 + 1] = lastF;
  return top;
}
