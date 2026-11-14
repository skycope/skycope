import { shoreRadius, shoreDistance, islandPoint, terrainHeight, ISLAND } from "./terrain.js";
import { seededRandom } from "./random.js";

// Where the island's landmarks stand. Pure data, no three.js: vegetation,
// rocks and tests read it, and createPlaces (places.js) builds from it.
//
// The island's shape is fixed, so its headlands, coves and summits are too;
// the seed chooses among them and places each landmark so they spread round
// the island, every one visible from somewhere else.

const TAU = Math.PI * 2;
const HOME_THETA = Math.atan2(0 - ISLAND.z, 6 - ISLAND.x);
// Where the cat starts (walker.js home()): nothing is built on top of it.
const HOME = islandPoint(HOME_THETA, 3.2);

let features = null;
function islandFeatures() {
  if (features) return features;
  const N = 720;
  const radius = Array.from({ length: N }, (_, i) => shoreRadius((i / N) * TAU));
  const headlands = [];
  const coves = [];
  for (let i = 0; i < N; i++) {
    const a = radius[(i + N - 1) % N];
    const b = radius[(i + 1) % N];
    const theta = (i / N) * TAU;
    if (radius[i] > a && radius[i] >= b) headlands.push({ theta, radius: radius[i] });
    if (radius[i] < a && radius[i] <= b) coves.push({ theta, radius: radius[i] });
  }
  headlands.sort((p, q) => q.radius - p.radius);
  // Summits: the highest ground on a 2 m grid, at least 20 m apart.
  const cells = [];
  for (let x = ISLAND.x - 90; x <= ISLAND.x + 90; x += 2)
    for (let z = ISLAND.z - 90; z <= ISLAND.z + 90; z += 2)
      if (shoreDistance(x, z) > 12) cells.push({ x, z, y: terrainHeight(x, z) });
  cells.sort((p, q) => q.y - p.y);
  const summits = [];
  for (const c of cells) {
    if (summits.every((s) => Math.hypot(s.x - c.x, s.z - c.z) > 20)) summits.push(c);
    if (summits.length >= 4) break;
  }
  features = { headlands, coves, summits };
  return features;
}

function pick(list, weights, random) {
  const total = weights.reduce((a, b) => a + b, 0);
  let t = random() * total;
  for (let i = 0; i < list.length; i++) {
    t -= weights[i];
    if (t <= 0) return list[i];
  }
  return list[list.length - 1];
}

// The keeper's cottage, in the lighthouse's frame (u seaward, v to the side).
export const COTTAGE = { u: -1.4, v: 9.4 };

// (Chosen so seed 1847, the island everyone knows, keeps its boat and pool
// where they were.)
const SHORE_SALT = 107;

const WRECK_NAMES = ["Seaflower", "Kowie Lass", "Good Intent", "Thistle", "Maria Stella", "Albatross", "Star of Hope", "Wanderer"];

// The landmarks: [{ id, title, kind, x, z, y, r, zone, … }], coast metres.
// `r`: the radius within which the cat has found it. `zone`: a capsule
// (a → b, radius `clear` for trees, shrubs and boulders, `bare` for grass
// and low plants) that nothing else grows through.
export function placesLayout(seed) {
  const random = seededRandom((seed ^ 0x51a7e5) >>> 0 || 1);
  const { headlands, coves, summits } = islandFeatures();
  const places = [];
  const farFrom = (x, z, d, list = places) =>
    Math.hypot(x - HOME.x, z - HOME.z) > 18 && list.every((p) => Math.hypot(x - p.x, z - p.z) > d);
  const circle = (x, z, clear, bare) => ({ ax: x, az: z, bx: x, bz: z, clear, bare });

  // The lighthouse: on the most seaward headland that is clear of the
  // landing beach, a little back from its point.
  {
    const eligible = headlands
      .slice(0, 4)
      .filter((h) => {
        const p = islandPoint(h.theta, 9);
        return Math.hypot(p.x - HOME.x, p.z - HOME.z) > 30;
      });
    const h = pick(eligible.slice(0, 3), [0.55, 0.3, 0.15].slice(0, Math.min(3, eligible.length)), random);
    const theta = h.theta + (random() - 0.5) * 0.03;
    // On the first level-ish ground above the shore: the headlands climb
    // steeply from the beach, and every metre further back is a taller
    // cut and fill for the pad the tower stands on (place-lighthouse.js).
    const inland = 6.5;
    const { x, z } = islandPoint(theta, inland);
    // Faces the sea: the door and the keeper's cottage are on the lee side.
    const seaward = Math.atan2(Math.cos(theta), Math.sin(theta));
    const fx = Math.sin(seaward), fz = Math.cos(seaward), rx = Math.cos(seaward), rz = -Math.sin(seaward);
    // The keeper's cottage stands beside the tower along the contour (behind
    // it, up the slope, it needed a two-metre podium), on whichever side
    // the ground is more nearly level.
    const spread = (side) => {
      let lo = Infinity, hi = -Infinity;
      for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) {
        const u = COTTAGE.u + (i / 3) * 2.4, v = side * COTTAGE.v + (j / 3) * 3.8;
        const h = terrainHeight(x + u * fx + v * rx, z + u * fz + v * rz);
        lo = Math.min(lo, h); hi = Math.max(hi, h);
      }
      return hi - lo;
    };
    const side = spread(1) <= spread(-1) ? 1 : -1;
    const bx = x + COTTAGE.u * fx + side * COTTAGE.v * rx;
    const bz = z + COTTAGE.u * fz + side * COTTAGE.v * rz;
    places.push({
      id: "lighthouse", title: "The lighthouse on the point", kind: "lighthouse",
      x, z, y: terrainHeight(x, z), r: 10, theta, inland, facing: seaward, side,
      zone: { ax: x, az: z, bx, bz, clear: 7, bare: 5.5 },
    });
  }

  // The trig beacon: on one of the two highest summits.
  {
    const s = pick(summits.slice(0, 2), [0.6, 0.4], random);
    places.push({
      id: "beacon", title: "Trig beacon on the summit", kind: "beacon",
      x: s.x, z: s.z, y: terrainHeight(s.x, s.z), r: 6, facing: random() * TAU,
      zone: circle(s.x, s.z, 8.5, 2.8),
    });
  }

  // The ancient milkwood: deep in the interior, on gentle ground, away
  // from the summit and the light.
  {
    let best = null;
    for (let i = 0; i < 60; i++) {
      const theta = random() * TAU;
      const inland = 24 + random() * 18;
      const { x, z } = islandPoint(theta, inland);
      if (!farFrom(x, z, 30)) continue;
      const slope = Math.hypot(terrainHeight(x + 3, z) - terrainHeight(x - 3, z), terrainHeight(x, z + 3) - terrainHeight(x, z - 3)) / 6;
      const score = -slope - Math.abs(inland - 30) * 0.01 + random() * 0.05;
      if (!best || score > best.score) best = { x, z, theta, score };
    }
    const { x, z } = best;
    places.push({
      id: "milkwood", title: "The old milkwood", kind: "milkwood",
      x, z, y: terrainHeight(x, z), r: 11, facing: random() * TAU,
      zone: circle(x, z, 14, 8),
    });
  }

  // The wreck: the landward bones of a coaster on a beach across the island
  // from the light, wholly above the tide line (the sea has taken the rest),
  // its bow driven up the sand.
  {
    const light = places[0];
    let wreck = null;
    for (let i = 0; i < 40 && !wreck; i++) {
      const theta = light.theta + Math.PI + (random() - 0.5) * (1.2 + i * 0.05);
      const centre = islandPoint(theta, 4.8);
      if (!farFrom(centre.x, centre.z, 32)) continue;
      // Shore tangent, then turned 17–34° so the bow points up the beach.
      // The shore's own normal (the radius is not: the shore winds), from
      // the gradient of the shore distance.
      const turn = (0.3 + random() * 0.3) * (random() < 0.5 ? -1 : 1);
      const gx = shoreDistance(centre.x + 0.5, centre.z) - shoreDistance(centre.x - 0.5, centre.z);
      const gz = shoreDistance(centre.x, centre.z + 0.5) - shoreDistance(centre.x, centre.z - 0.5);
      const gl = Math.hypot(gx, gz) || 1;
      const nx = gx / gl, nz = gz / gl; // inland
      // Heading in the coast frame: (sin h, cos h).
      const tx = -nz, tz = nx;
      const c = Math.cos(Math.abs(turn)), s = Math.sin(Math.abs(turn));
      let dx = tx * c + nx * s, dz = tz * c + nz * s;
      if (turn < 0) { dx = -tx * c + nx * s; dz = -tz * c + nz * s; }
      const half = 4.5;
      const bow = { x: centre.x + dx * half, z: centre.z + dz * half };
      const stern = { x: centre.x - dx * half, z: centre.z - dz * half };
      wreck = {
        id: "wreck", title: `Wreck of the ${WRECK_NAMES[Math.floor(random() * WRECK_NAMES.length)]}`, kind: "wreck",
        x: centre.x, z: centre.z, y: terrainHeight(centre.x, centre.z), r: 10, theta,
        heading: Math.atan2(dx, dz), bow, stern, list: (random() - 0.5) * 0.3 + (turn > 0 ? 0.12 : -0.12),
        zone: { ax: bow.x, az: bow.z, bx: stern.x, bz: stern.z, clear: 7.2, bare: 6.4 },
      };
    }
    places.push(wreck);
  }

  // The shore places draw from their own stream, so that moving or
  // reworking a landmark above does not move the boat and the pool.
  const shore = seededRandom(((seed ^ SHORE_SALT) >>> 0) || 1);
  // The fisherman's boat: drawn up in a cove above the tide line.
  {
    const order = coves.map((c) => ({ ...c, key: shore() })).sort((a, b) => a.key - b.key);
    let boat = null;
    for (const c of order) {
      const theta = c.theta + (shore() - 0.5) * 0.04;
      const p = islandPoint(theta, 6.5);
      if (!farFrom(p.x, p.z, 30)) continue;
      boat = {
        id: "boat", title: "The fisherman's boat", kind: "boat",
        x: p.x, z: p.z, y: terrainHeight(p.x, p.z), r: 6, theta,
        // Hauled up stern first, the bow toward the sea it came out of.
        facing: Math.atan2(Math.cos(theta), Math.sin(theta)) + (shore() - 0.5) * 0.6,
        zone: circle(p.x, p.z, 5.5, 4.2),
        lane: launchLane(p.x, p.z),
      };
      break;
    }
    if (!boat) {
      const theta = shore() * TAU;
      const p = islandPoint(theta, 6.5);
      boat = { id: "boat", title: "The fisherman's boat", kind: "boat", x: p.x, z: p.z, y: terrainHeight(p.x, p.z), r: 6, theta,
        facing: Math.atan2(Math.cos(theta), Math.sin(theta)), zone: circle(p.x, p.z, 5.5, 4.2), lane: launchLane(p.x, p.z) };
    }
    places.push(boat);
  }

  // The rock pool: a granite shelf at the top of the shore, wherever the
  // others are not.
  {
    let pool = null;
    for (let i = 0; i < 80 && !pool; i++) {
      const theta = shore() * TAU;
      const p = islandPoint(theta, 1.4);
      if (!farFrom(p.x, p.z, 28 - Math.min(10, i * 0.2))) continue;
      pool = {
        id: "pool", title: "The rock pool", kind: "pool",
        x: p.x, z: p.z, y: terrainHeight(p.x, p.z), r: 4.5, theta, facing: shore() * TAU,
        zone: circle(p.x, p.z, 4.6, 4.2),
      };
    }
    places.push(pool);
  }
  return places;
}

// The boat's launch lane: no boulder between its logs and open water, out
// along the island's radius (where boat-dynamics.js findMooring looks).
function launchLane(x, z) {
  const a = Math.atan2(z - ISLAND.z, x - ISLAND.x);
  return { ax: x, az: z, bx: x + Math.cos(a) * 24, bz: z + Math.sin(a) * 24, clear: 2.6, bare: 0 };
}

// Metres outside the nearest landmark's zone (negative inside). `kind`:
// "clear" for trees, shrubs and boulders, "bare" for grass and low plants.
export function placeClearance(layout, x, z, kind = "clear") {
  let best = Infinity;
  for (const p of layout)
    for (const zone of p.lane ? [p.zone, p.lane] : [p.zone]) {
      const { ax, az, bx, bz } = zone;
      const vx = bx - ax, vz = bz - az;
      const l2 = vx * vx + vz * vz;
      const t = l2 > 1e-9 ? Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / l2)) : 0;
      const d = Math.hypot(x - ax - vx * t, z - az - vz * t) - zone[kind];
      if (d < best) best = d;
    }
  return best;
}

// Memoized per seed: vegetation and rocks ask once per plant.
const cache = new Map();
export function layoutFor(seed) {
  if (!cache.has(seed)) {
    if (cache.size > 4) cache.clear();
    cache.set(seed, placesLayout(seed));
  }
  return cache.get(seed);
}

// Whether a plant of this kind and height may grow at (x, z).
export function plantClear(seed, kind, x, z, height = 0) {
  const layout = layoutFor(seed);
  if (kind === "tree") return placeClearance(layout, x, z, "clear") > height * 0.3;
  if (kind === "shrub" || kind === "protea") return placeClearance(layout, x, z, "clear") > 0;
  return placeClearance(layout, x, z, "bare") > 0;
}

export { HOME as PLACES_HOME };
