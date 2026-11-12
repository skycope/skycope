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
    const inland = 8.5;
    const { x, z } = islandPoint(theta, inland);
    // Faces the sea: the door and the keeper's cottage are on the lee side.
    const seaward = Math.atan2(Math.cos(theta), Math.sin(theta));
    // The compound runs inland from the tower: the keeper's cottage behind it.
    const bx = x - Math.sin(seaward) * 6.5 + Math.cos(seaward) * 4.6;
    const bz = z - Math.cos(seaward) * 6.5 - Math.sin(seaward) * 4.6;
    places.push({
      id: "lighthouse", title: "The lighthouse on the point", kind: "lighthouse",
      x, z, y: terrainHeight(x, z), r: 10, theta, inland, facing: seaward,
      zone: { ax: x, az: z, bx, bz, clear: 9.5, bare: 7.5 },
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

  // The wreck: on a beach across the island from the light, lying across
  // the swash with its bow driven up the sand.
  {
    const light = places[0];
    let wreck = null;
    for (let i = 0; i < 40 && !wreck; i++) {
      const theta = light.theta + Math.PI + (random() - 0.5) * (1.2 + i * 0.05);
      const centre = islandPoint(theta, 1.6);
      if (!farFrom(centre.x, centre.z, 32)) continue;
      // Shore tangent, then turned 20–45° so the bow points up the beach.
      const along = Math.atan2(-Math.sin(theta), Math.cos(theta));
      const turn = (0.35 + random() * 0.4) * (random() < 0.5 ? -1 : 1);
      // Heading in the coast frame: (sin h, cos h).
      const tx = Math.cos(along), tz = Math.sin(along);
      const nx = -Math.cos(theta), nz = -Math.sin(theta); // inland
      const c = Math.cos(Math.abs(turn)), s = Math.sin(Math.abs(turn));
      let dx = tx * c + nx * s, dz = tz * c + nz * s;
      if (turn < 0) { dx = -tx * c + nx * s; dz = -tz * c + nz * s; }
      const half = 8.5;
      const bow = { x: centre.x + dx * half, z: centre.z + dz * half };
      const stern = { x: centre.x - dx * half, z: centre.z - dz * half };
      wreck = {
        id: "wreck", title: `Wreck of the ${WRECK_NAMES[Math.floor(random() * WRECK_NAMES.length)]}`, kind: "wreck",
        x: centre.x, z: centre.z, y: terrainHeight(centre.x, centre.z), r: 10, theta,
        heading: Math.atan2(dx, dz), bow, stern, list: (random() - 0.5) * 0.3 + (turn > 0 ? 0.12 : -0.12),
        zone: { ax: bow.x, az: bow.z, bx: stern.x, bz: stern.z, clear: 4.8, bare: 4.2 },
      };
    }
    places.push(wreck);
  }

  // The fisherman's boat: drawn up in a cove above the tide line.
  {
    const order = coves.map((c) => ({ ...c, key: random() })).sort((a, b) => a.key - b.key);
    let boat = null;
    for (const c of order) {
      const theta = c.theta + (random() - 0.5) * 0.04;
      const p = islandPoint(theta, 6.5);
      if (!farFrom(p.x, p.z, 30)) continue;
      boat = {
        id: "boat", title: "The fisherman's boat", kind: "boat",
        x: p.x, z: p.z, y: terrainHeight(p.x, p.z), r: 6, theta,
        // Hauled up stern first, the bow toward the sea it came out of.
        facing: Math.atan2(Math.cos(theta), Math.sin(theta)) + (random() - 0.5) * 0.6,
        zone: circle(p.x, p.z, 5.5, 4.2),
      };
      break;
    }
    if (!boat) {
      const theta = random() * TAU;
      const p = islandPoint(theta, 6.5);
      boat = { id: "boat", title: "The fisherman's boat", kind: "boat", x: p.x, z: p.z, y: terrainHeight(p.x, p.z), r: 6, theta,
        facing: Math.atan2(Math.cos(theta), Math.sin(theta)), zone: circle(p.x, p.z, 5.5, 4.2) };
    }
    places.push(boat);
  }

  // The rock pool: a granite shelf at the top of the shore, wherever the
  // others are not.
  {
    let pool = null;
    for (let i = 0; i < 80 && !pool; i++) {
      const theta = random() * TAU;
      const p = islandPoint(theta, 1.4);
      if (!farFrom(p.x, p.z, 28 - Math.min(10, i * 0.2))) continue;
      pool = {
        id: "pool", title: "The rock pool", kind: "pool",
        x: p.x, z: p.z, y: terrainHeight(p.x, p.z), r: 4.5, theta, facing: random() * TAU,
        zone: circle(p.x, p.z, 4.6, 4.2),
      };
    }
    places.push(pool);
  }
  return places;
}

// Metres outside the nearest landmark's zone (negative inside). `kind`:
// "clear" for trees, shrubs and boulders, "bare" for grass and low plants.
export function placeClearance(layout, x, z, kind = "clear") {
  let best = Infinity;
  for (const p of layout) {
    const { ax, az, bx, bz } = p.zone;
    const vx = bx - ax, vz = bz - az;
    const l2 = vx * vx + vz * vz;
    const t = l2 > 1e-9 ? Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / l2)) : 0;
    const d = Math.hypot(x - ax - vx * t, z - az - vz * t) - p.zone[kind];
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
