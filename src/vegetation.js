import * as THREE from "three";
import {
  terrainHeight,
  shoreDistance,
  islandPoint,
  noise2,
  smoothstep,
} from "./terrain.js";
import { seededRandom } from "./random.js";

// Prevailing south-easter blows onshore. Exposure "flags" coastal crowns: they
// lean and grow away from the wind, strongest at the beach edge.
const PREVAILING = new THREE.Vector3(0.9, 0, -0.436);
const GOLDEN_ANGLE = 2.39996;

// Growth archetypes span the coastal gradient. A tree blends wind-sheared
// scrub toward canopy with interior shelter; saplings and dead snags are
// discrete picks. These scale the seed-derived community traits, they do not
// replace them, so groves stay individually varied.
const SCRUB = {
  height: 0.5,
  spread: 1.5,
  lift: 0.16,
  flag: 1.0,
  droop: 0.3,
  flatten: 0.48,
  points: 0.7,
};
const CANOPY = {
  height: 1.0,
  spread: 1.0,
  lift: 0.55,
  flag: 0.22,
  droop: 0.55,
  flatten: 0.74,
  points: 1.0,
};

export function createVegetation(seed) {
  const wood = [];
  const leaves = [];
  const clusters = [];
  const layout = vegetationLayout(seed);
  const ecotypes = growthTraits(seed);
  // Known crown volumes let neighbouring buds compete for space (crown shyness).
  const crowns = layout
    .filter((p) => p.kind === "tree" && p.form !== "snag")
    .map((p) => ({
      x: p.x,
      z: p.z,
      y: terrainHeight(p.x, p.z) + p.height * 0.72,
      r: crownRadius(p, ecotypes[p.ecotype]),
    }));
  for (const plant of layout) {
    const random = seededRandom(plant.seed);
    const root = new THREE.Vector3(
      plant.x,
      terrainHeight(plant.x, plant.z),
      plant.z,
    );
    if (plant.kind === "fern") growFern(root, plant.height, random, wood, leaves);
    else if (plant.kind === "grass")
      growGrass(root, plant.height, plant.dune, random, leaves);
    else if (plant.kind === "moss") growMoss(root, plant.height, random, clusters);
    else if (plant.kind === "shrub")
      growShrub(root, plant, ecotypes[plant.ecotype], random, wood, clusters);
    else
      growTree(
        root,
        plant,
        ecotypes[plant.ecotype],
        crowns,
        random,
        wood,
        clusters,
        leaves,
      );
  }
  return { wood, leaves, clusters, plants: layout.length };
}

// Poisson-style dart throwing modulated by a clustering field: trees clump into
// groves and leave clearings. Density and height fall toward the shore, and an
// ecotone band of dune grass and low scrub blends the beach into the forest.
export function vegetationLayout(seed) {
  const random = seededRandom(seed);
  const plants = [];
  const occupied = new Map();
  const patch = random() * 1000;
  const ecotypes = growthTraits(seed);
  for (let i = 0; i < 1400; i++) {
    const theta = random() * Math.PI * 2;
    const inland = 5 + random() * 58;
    const { x, z } = islandPoint(theta, inland);
    const shelter = noise2(x * 0.085 + patch, z * 0.06 + patch);
    const edge = smoothstep(4, 13, inland);
    if (random() > (0.16 + shelter * 0.8) * (0.25 + edge * 0.75)) continue;
    // A spatial habitat field selects related traits across a grove, not per-row models.
    const ecotype = Math.min(
      ecotypes.length - 1,
      Math.floor(noise2(x * 0.06 + patch, z * 0.04 - patch) * ecotypes.length),
    );
    const traits = ecotypes[ecotype];
    const exposure = Math.min(1, inland / 18);
    // Shelter from the sea wind: blend scrub toward canopy with distance and
    // the same habitat noise, so a grove shares a growth habit.
    const interior =
      smoothstep(7, 30, inland) * (0.55 + shelter * 0.55) * (0.7 + random() * 0.5);
    const roll = random();
    const form =
      roll < 0.025 ? "snag" : roll < 0.12 && interior > 0.35 ? "sapling" : "blend";
    const scale = form === "sapling" ? 0.3 + random() * 0.2 : 1;
    const height =
      traits.height *
      (0.6 + random() * 0.6) *
      (0.55 + exposure * 0.45) *
      mix(SCRUB.height, CANOPY.height, Math.min(1, interior)) *
      scale;
    const cellX = Math.floor(x / 4);
    const cellZ = Math.floor(z / 4);
    let crowded = false;
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++) {
        for (const other of occupied.get(`${cellX + dx},${cellZ + dz}`) ?? []) {
          if (
            Math.hypot(x - other.x, z - other.z) <
            1.1 + (height + other.height) * 0.09
          )
            crowded = true;
        }
      }
    if (crowded) continue;
    const plant = {
      kind: "tree",
      ecotype,
      x,
      z,
      height,
      form,
      interior: Math.min(1, interior),
      exposure: 1 - edge,
      seed: Math.max(1, Math.floor(random() * 0xffffffff)),
    };
    plants.push(plant);
    const key = `${cellX},${cellZ}`;
    if (!occupied.has(key)) occupied.set(key, []);
    occupied.get(key).push(plant);
  }
  // Ecotone: dune grass and sparse low scrub soften the beach-forest line.
  for (let i = 0; i < 550; i++) {
    const theta = random() * Math.PI * 2;
    const inland = 2.2 + random() * 7;
    const { x, z } = islandPoint(theta, inland);
    if (noise2(x * 0.3 + patch, z * 0.22) < 0.36) continue;
    const scrubby = random() < 0.16 && inland > 4;
    plants.push({
      kind: scrubby ? "shrub" : "grass",
      dune: true,
      form: "blend",
      interior: 0,
      exposure: 1,
      ecotype: Math.floor(random() * ecotypes.length),
      x,
      z,
      height: scrubby ? 0.5 + random() * 0.8 : 0.28 + random() * 0.5,
      seed: Math.max(1, Math.floor(random() * 0xffffffff)),
    });
  }
  // Lower layers occur in patches, leaving some visible soil and paths between them.
  for (let i = 0; i < 2300; i++) {
    const theta = random() * Math.PI * 2;
    const inland = 3.5 + random() * 30;
    const { x, z } = islandPoint(theta, inland);
    if (noise2(x * 0.2 + patch, z * 0.16) < 0.27) continue;
    const choice = random();
    const kind =
      choice < 0.24 && inland > 7
        ? "fern"
        : choice < 0.38 && inland > 9
          ? "moss"
          : choice < 0.58
            ? "shrub"
            : "grass";
    const height =
      kind === "shrub"
        ? 0.7 + random() * 1.4
        : kind === "moss"
          ? 0.08 + random() * 0.16
          : 0.25 + random() * 0.85;
    plants.push({
      kind,
      dune: false,
      form: "blend",
      interior: smoothstep(7, 26, inland),
      exposure: 1 - smoothstep(4, 13, inland),
      ecotype: Math.floor(random() * ecotypes.length),
      x,
      z,
      height,
      seed: Math.max(1, Math.floor(random() * 0xffffffff)),
    });
  }
  return plants;
}

// Growth habits reshape the colonized crown volume and its growth biases, so
// one mechanism produces visibly different species-like forms. Weeping crowns
// also hang vines; palms grow arched fronds instead of a colonized crown.
const HABITS = {
  canopy: {},
  umbrella: { flatten: 0.4, droop: 1.0, lift: 0.78, center: 0.8 },
  weeping: { droop: 1.35, flatten: 0.9, vines: true },
  columnar: { spread: 0.55, flatten: 1.45, lift: 0.85 },
  palm: {},
};
const HABIT_CHOICES = [
  "canopy",
  "canopy",
  "canopy",
  "umbrella",
  "umbrella",
  "weeping",
  "columnar",
  "palm",
];

// Seed-derived communities occupy a continuous trait space. These ranges constrain
// growth, rather than selecting authored species meshes or fixed species recipes.
function growthTraits(seed) {
  const random = seededRandom(seed ^ 0x6a09e667);
  return Array.from({ length: 8 }, () => {
    const slender = random();
    const waxy = random();
    return {
      habit: HABIT_CHOICES[Math.floor(random() * HABIT_CHOICES.length)],
      density: 0.85 + random() * 0.6,
      height: 3.5 + slender * 6.5 + random() * 2.5,
      spread: 0.6 - slender * 0.22,
      lift: 0.25 + slender * 0.6,
      leaf: [0.17 + (1 - slender) * 0.3, 0.16 + random() * 0.18],
      hue: 0.18 + random() * 0.17,
      light: 0.15 + (1 - waxy) * 0.14,
      bark: new THREE.Color().setHSL(
        0.09 + random() * 0.06,
        0.08 + random() * 0.18,
        0.25 + random() * 0.17,
      ),
    };
  });
}

function archetype(plant) {
  const t = plant.form === "sapling" ? 0.85 : plant.interior;
  return {
    spread: mix(SCRUB.spread, CANOPY.spread, t),
    lift: mix(SCRUB.lift, CANOPY.lift, t),
    flag: mix(SCRUB.flag, CANOPY.flag, t),
    droop: mix(SCRUB.droop, CANOPY.droop, t),
    flatten: mix(SCRUB.flatten, CANOPY.flatten, t),
    points: plant.form === "snag" ? 0.45 : mix(SCRUB.points, CANOPY.points, t),
  };
}

function crownRadius(plant, traits) {
  return Math.max(
    0.7,
    plant.height *
      traits.spread *
      archetype(plant).spread *
      0.55 *
      (HABITS[traits.habit]?.spread ?? 1),
  );
}

function mix(a, b, t) {
  return a + (b - a) * t;
}

function growTree(root, plant, traits, crowns, random, wood, clusters, leaves) {
  const snag = plant.form === "snag";
  if (traits.habit === "palm" && !snag) {
    growPalm(root, plant, traits, random, wood, leaves);
    return;
  }
  const habit = HABITS[traits.habit] ?? {};
  const arche = { ...archetype(plant) };
  if (habit.flatten) arche.flatten = habit.flatten;
  if (habit.droop) arche.droop = habit.droop;
  if (habit.lift) arche.lift = habit.lift;
  const height = plant.height;
  const bark = snag
    ? new THREE.Color().setHSL(0.1, 0.04, 0.4 + random() * 0.12)
    : new THREE.Color(traits.bark).multiplyScalar(0.55 + random() * 0.35);
  const color = new THREE.Color().setHSL(
    traits.hue + (random() - 0.5) * 0.035,
    0.24 + random() * 0.18,
    traits.light + random() * 0.05,
  );
  // Flagging: crowns lean away from the prevailing onshore wind, hardest at
  // the exposed edge, plus each individual's own asymmetry.
  const flag = arche.flag * (0.35 + plant.exposure * 0.65);
  const lean = new THREE.Vector3(
    (random() - 0.4) * 0.42 + PREVAILING.x * flag * 0.3,
    1,
    (random() - 0.5) * 0.38 + PREVAILING.z * flag * 0.3,
  ).multiplyScalar(height);
  const detail = Math.hypot(plant.x - 6, plant.z) < 75;
  // The trunk ends inside the crown; colonized branches carry all further
  // height, so no bare mast pokes through the foliage.
  const spine = [root];
  for (let i = 1; i <= 3; i++) {
    const point = root.clone().addScaledVector(lean, (i / 3) * 0.62);
    point.x += Math.sin(i * 1.7 + height) * height * 0.045;
    point.z += Math.sin(i * 2.3 + height) * height * 0.04;
    branch(wood, spine[i - 1], point, height * 0.034 * (1 - i * 0.22), bark);
    spine.push(point);
  }
  const crownR = crownRadius(plant, traits);
  const crownCenter = spine[3]
    .clone()
    .addScaledVector(PREVAILING, flag * crownR * 0.4);
  crownCenter.y = root.y + height * (habit.center ?? 0.68);
  const neighbours = crowns.filter(
    (c) =>
      (c.x !== plant.x || c.z !== plant.z) &&
      Math.hypot(c.x - crownCenter.x, c.z - crownCenter.z) < c.r + crownR,
  );
  colonizeCrown({
    seeds: [spine[2], spine[3]],
    crownCenter,
    crownR,
    arche,
    traits,
    flag,
    detail,
    snag,
    baseRadius: height * 0.02,
    color,
    bark,
    neighbours,
    vines: Boolean(habit.vines) && detail,
    floor: root.y,
    random,
    wood,
    clusters,
  });
}

function growShrub(root, plant, traits, random, wood, clusters) {
  const arche = archetype(plant);
  const height = plant.height;
  const bark = new THREE.Color(traits.bark).multiplyScalar(0.7 + random() * 0.4);
  const color = new THREE.Color().setHSL(
    traits.hue + (random() - 0.5) * 0.04,
    0.26 + random() * 0.18,
    traits.light + random() * 0.05,
  );
  const flag = (0.5 + plant.exposure) * (plant.dune ? 1 : 0.5);
  const crownR = Math.max(0.45, height * 0.9);
  const crownCenter = root
    .clone()
    .add(new THREE.Vector3(PREVAILING.x * flag * 0.3, height * 0.75, 0));
  colonizeCrown({
    seeds: [root, root.clone().add(new THREE.Vector3(0, height * 0.3, 0))],
    crownCenter,
    crownR,
    arche: { ...arche, flatten: 0.55, points: 0.4 },
    traits,
    flag,
    detail: false,
    snag: false,
    baseRadius: height * 0.02,
    color,
    bark,
    neighbours: [],
    random,
    wood,
    clusters,
  });
}

// Space colonization (Runions et al.): attraction points scatter through the
// crown volume and branches grow toward them, so asymmetry, early termination
// and competition for space emerge from the mechanism instead of injected
// jitter. Neighbouring crowns steal the points they overlap — crown shyness.
function colonizeCrown(options) {
  const {
    seeds,
    crownCenter,
    crownR,
    arche,
    traits,
    flag,
    detail,
    snag,
    baseRadius,
    color,
    bark,
    neighbours,
    vines = false,
    floor = -1000,
    random,
    wood,
    clusters,
  } = options;
  const pointCount = Math.round((detail ? 130 : 80) * arche.points);
  const px = [];
  const py = [];
  const pz = [];
  for (let i = 0; i < pointCount * 3 && px.length < pointCount; i++) {
    const u = random() * 2 - 1;
    const v = random() * 2 - 1;
    const w = random() * 2 - 1;
    if (u * u + v * v + w * w > 1) continue;
    // Ellipsoidal crown, flattened per archetype, sheared downwind (flagging).
    const y = v * crownR * arche.flatten;
    const x = crownCenter.x + u * crownR + (y / crownR) * flag * crownR * 0.5 +
      PREVAILING.x * flag * crownR * 0.2;
    const z = crownCenter.z + w * crownR + PREVAILING.z * flag * crownR * 0.2;
    const worldY = crownCenter.y + y;
    let shy = false;
    for (const n of neighbours) {
      const dx = x - n.x;
      const dy = worldY - n.y;
      const dz = z - n.z;
      if (dx * dx + dy * dy + dz * dz < n.r * n.r * 0.8) shy = true;
    }
    if (shy) continue;
    px.push(x);
    py.push(worldY);
    pz.push(z);
  }
  const step = crownR / 5.5;
  const influence2 = crownR * crownR * 0.9;
  const kill2 = step * step * 2.6;
  const cap = detail ? 320 : 190;
  // Flat arrays and a cached nearest node per point keep growth O(points × new
  // nodes): nodes never move, so only fresh nodes can become a point's nearest.
  const nx = [];
  const ny = [];
  const nz = [];
  const parent = [];
  for (const s of seeds) {
    nx.push(s.x);
    ny.push(s.y);
    nz.push(s.z);
    parent.push(-1);
  }
  const nearest = new Array(px.length).fill(-1);
  const nearestD2 = new Array(px.length).fill(Infinity);
  let fresh = 0;
  for (let iteration = 0; iteration < 30 && nx.length < cap; iteration++) {
    // Update each point's nearest node against nodes added since last pass.
    for (let p = 0; p < px.length; p++) {
      if (nearest[p] === -2) continue;
      for (let n = fresh; n < nx.length; n++) {
        const dx = px[p] - nx[n];
        const dy = py[p] - ny[n];
        const dz = pz[p] - nz[n];
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < nearestD2[p]) {
          nearestD2[p] = d2;
          nearest[p] = n;
        }
      }
    }
    fresh = nx.length;
    // Accumulate growth directions per attracting node.
    const acc = new Map();
    for (let p = 0; p < px.length; p++) {
      const n = nearest[p];
      if (n < 0 || nearestD2[p] > influence2) continue;
      const inv = 1 / Math.sqrt(nearestD2[p]);
      let a = acc.get(n);
      if (!a) acc.set(n, (a = [0, 0, 0]));
      a[0] += (px[p] - nx[n]) * inv;
      a[1] += (py[p] - ny[n]) * inv;
      a[2] += (pz[p] - nz[n]) * inv;
    }
    if (acc.size === 0) break;
    for (const [n, a] of acc) {
      const horizontal = Math.hypot(nx[n] - crownCenter.x, nz[n] - crownCenter.z);
      // Gravity droops long reaches; the prevailing wind keeps pushing growth.
      a[1] -= arche.droop * (horizontal / crownR) * 0.8 - arche.lift * 0.25;
      a[0] += PREVAILING.x * flag * 0.3 + (random() - 0.5) * 0.35;
      a[2] += PREVAILING.z * flag * 0.3 + (random() - 0.5) * 0.35;
      const length = Math.hypot(a[0], a[1], a[2]) || 1;
      nx.push(nx[n] + (a[0] / length) * step);
      ny.push(ny[n] + (a[1] / length) * step);
      nz.push(nz[n] + (a[2] / length) * step);
      parent.push(n);
      if (nx.length >= cap) break;
    }
    // Reached points stop attracting; growth terminates where space runs out.
    for (let p = 0; p < px.length; p++) {
      if (nearest[p] === -2) continue;
      for (let n = fresh; n < nx.length; n++) {
        const dx = px[p] - nx[n];
        const dy = py[p] - ny[n];
        const dz = pz[p] - nz[n];
        if (dx * dx + dy * dy + dz * dz < kill2) {
          nearest[p] = -2;
          break;
        }
      }
    }
  }
  // Pipe-model radii: a branch supports the tips above it.
  const tips = new Array(nx.length).fill(1);
  const hasChild = new Array(nx.length).fill(false);
  for (let n = nx.length - 1; n >= 0; n--) {
    if (parent[n] >= 0) {
      tips[parent[n]] += tips[n];
      hasChild[parent[n]] = true;
    }
  }
  const start = new THREE.Vector3();
  const end = new THREE.Vector3();
  for (let n = seeds.length; n < nx.length; n++) {
    const p = parent[n];
    start.set(nx[p], ny[p], nz[p]);
    end.set(nx[n], ny[n], nz[n]);
    const radius = Math.min(
      baseRadius,
      baseRadius * 0.2 * Math.pow(tips[n], 0.45),
    );
    branch(wood, start, end, radius, bark);
    if (snag || tips[n] > 3) continue;
    // Terminal and near-terminal shoots carry leaf clusters in a golden-angle
    // spiral, sized to the plant's own crown. Each cluster is darkened by its
    // depth into the canopy — ambient occlusion baked at placement, since the
    // generator knows where the crown surface is.
    const direction = end.clone().sub(start).normalize();
    const phase = random() * Math.PI * 2;
    const count = (detail ? 4 : 3) + (hasChild[n] ? 0 : detail ? 3 : 2);
    const leafScale =
      (traits.leaf[0] + traits.leaf[1]) *
      Math.min(1.1, 0.35 + crownR * 0.28);
    for (let j = 0; j < count; j++) {
      const along = end
        .clone()
        .addScaledVector(direction, (j / count - 0.3) * step * 1.3)
        .addScaledVector(
          new THREE.Vector3(random() - 0.5, random() - 0.5, random() - 0.5),
          step * 0.55,
        );
      const roll = phase + j * GOLDEN_ANGLE;
      const outward = new THREE.Vector3(
        Math.cos(roll) * 0.8,
        0.15 + random() * 0.5 - arche.droop * 0.3,
        Math.sin(roll) * 0.8,
      )
        .add(direction)
        .normalize();
      const depth = Math.min(
        1,
        Math.hypot(
          (along.x - crownCenter.x) / crownR,
          (along.y - crownCenter.y) / (crownR * arche.flatten),
          (along.z - crownCenter.z) / crownR,
        ),
      );
      cluster(
        clusters,
        along,
        leafScale * (0.6 + random() * 0.55) * (0.85 + depth * 0.3),
        0.7 + random() * 0.6,
        outward,
        roll,
        color
          .clone()
          .offsetHSL((random() - 0.5) * 0.045, (random() - 0.5) * 0.08, 0)
          .multiplyScalar((0.5 + depth * 0.5) * (0.8 + random() * 0.4)),
      );
    }
  }
  // Weeping crowns hang leafy vines from their upper branches.
  if (vines) {
    const strands = 2 + Math.floor(random() * 3);
    for (let v = 0; v < strands; v++) {
      const pick =
        seeds.length +
        Math.floor(random() * Math.max(1, nx.length - seeds.length));
      if (pick >= nx.length || ny[pick] < crownCenter.y) continue;
      let previous = new THREE.Vector3(nx[pick], ny[pick], nz[pick]);
      const drift = new THREE.Vector3(
        (random() - 0.5) * 0.3,
        0,
        (random() - 0.5) * 0.3,
      );
      const drop = (1.2 + random() * 2.2) / 5;
      const vineColor = color.clone().offsetHSL(0.02, 0.06, -0.02);
      for (let s = 1; s <= 5; s++) {
        const next = previous
          .clone()
          .add(drift)
          .add(
            new THREE.Vector3(
              (random() - 0.5) * 0.25,
              -drop,
              (random() - 0.5) * 0.25,
            ),
          );
        if (next.y < floor + 0.4) break;
        branch(wood, previous, next, 0.012, bark);
        if (s > 1)
          cluster(
            clusters,
            next,
            0.16 + random() * 0.14,
            0.6,
            new THREE.Vector3(random() - 0.5, -0.7, random() - 0.5).normalize(),
            random() * 6.28,
            vineColor.clone().multiplyScalar(0.7 + random() * 0.4),
          );
        previous = next;
      }
    }
  }
}

// Palms skip crown colonization: a curved trunk carries a whorl of arching
// pinnate fronds, grown with the fern's paired-leaflet logic at tree scale.
function growPalm(root, plant, traits, random, wood, leaves) {
  const height = plant.height * (1.05 + random() * 0.25);
  const bark = new THREE.Color().setHSL(
    0.09 + random() * 0.03,
    0.12,
    0.3 + random() * 0.1,
  );
  const color = new THREE.Color().setHSL(
    traits.hue + (random() - 0.5) * 0.03,
    0.3 + random() * 0.15,
    traits.light + 0.02,
  );
  const lean = new THREE.Vector3(
    (random() - 0.4) * 0.3 + PREVAILING.x * plant.exposure * 0.2,
    1,
    (random() - 0.5) * 0.3,
  ).multiplyScalar(height);
  let previous = root;
  for (let i = 1; i <= 4; i++) {
    const point = root.clone().addScaledVector(lean, i / 4);
    point.x += Math.sin(i * 1.3 + height) * height * 0.03;
    branch(wood, previous, point, height * 0.022 * (1 - i * 0.12), bark);
    previous = point;
  }
  const top = previous;
  const fronds = 8 + Math.floor(random() * 5);
  for (let f = 0; f < fronds; f++) {
    const azimuth = f * GOLDEN_ANGLE + random() * 0.4;
    let direction = new THREE.Vector3(
      Math.cos(azimuth),
      0.85 + random() * 0.5,
      Math.sin(azimuth),
    ).normalize();
    let point = top.clone();
    const frondLength = height * (0.34 + random() * 0.16);
    for (let s = 1; s <= 5; s++) {
      const next = point.clone().addScaledVector(direction, frondLength / 5);
      branch(wood, point, next, height * 0.006 * (1 - s * 0.14), bark);
      const t = s / 5;
      for (const side of [-1, 1]) {
        leaf(
          leaves,
          next,
          frondLength * 0.05 * (1 - t * 0.6),
          frondLength * 0.22 * (1 - t * 0.55),
          new THREE.Euler(1.15, -azimuth + side * 1.25, side * (0.35 + t * 0.3)),
          color,
          random,
        );
      }
      direction = direction.clone();
      direction.y -= 0.4;
      direction.normalize();
      point = next;
    }
  }
}

// Moss grows as flattened cushions hugging the ground in shaded interior soil.
function growMoss(root, height, random, clusters) {
  const color = new THREE.Color().setHSL(
    0.26 + random() * 0.08,
    0.4,
    0.13 + random() * 0.08,
  );
  const cushions = 3 + Math.floor(random() * 3);
  for (let i = 0; i < cushions; i++) {
    const position = root
      .clone()
      .add(new THREE.Vector3((random() - 0.5) * 0.8, 0, (random() - 0.5) * 0.8));
    position.y = terrainHeight(position.x, position.z) + 0.01;
    cluster(
      clusters,
      position,
      0.1 + height * random(),
      0.2,
      new THREE.Vector3((random() - 0.5) * 0.3, 1, (random() - 0.5) * 0.3).normalize(),
      random() * 6.28,
      color.clone().multiplyScalar(0.8 + random() * 0.35),
    );
  }
}

function growFern(root, height, random, wood, leaves) {
  const color = new THREE.Color("#467331").multiplyScalar(0.7 + random() * 0.5);
  const count = 5 + Math.floor(random() * 4);
  for (let f = 0; f < count; f++) {
    const angle = (f * Math.PI * 2) / count + random() * 0.5;
    let previous = root;
    for (let i = 1; i <= 7; i++) {
      const t = i / 7;
      const point = root
        .clone()
        .add(
          new THREE.Vector3(
            Math.cos(angle) * height * t,
            height * Math.sin(t * 2.3) * 0.7,
            Math.sin(angle) * height * t,
          ),
        );
      branch(wood, previous, point, height * 0.008, color);
      for (const side of [-1, 1]) {
        leaf(
          leaves,
          point,
          height * 0.1 * (1 - t * 0.7),
          height * 0.27 * (1 - t * 0.85),
          new THREE.Euler(1.2, -angle + side * 1.1, side * 0.25),
          color,
          random,
        );
      }
      previous = point;
    }
  }
}

function growGrass(root, height, dune, random, leaves) {
  // Dune tufts are paler and lean inland with the sea wind.
  const color = dune
    ? new THREE.Color().setHSL(0.14 + random() * 0.05, 0.24, 0.3 + random() * 0.14)
    : new THREE.Color().setHSL(0.18 + random() * 0.09, 0.3, 0.2 + random() * 0.12);
  const lean = dune ? 0.5 : 0;
  for (let i = 0; i < 7; i++) {
    leaf(
      leaves,
      root,
      0.025 + random() * 0.035,
      height * (0.3 + random() * 0.35),
      new THREE.Euler(
        (random() - 0.5) * 1.5,
        random() * 6.28,
        (random() - 0.5) * 1.5 - lean,
      ),
      color,
      random,
    );
  }
  // Some interior tufts send up taller pale seed stalks.
  if (!dune && random() < 0.35) {
    const pale = color.clone().offsetHSL(-0.05, -0.12, 0.1);
    for (let s = 0; s < 2; s++) {
      leaf(
        leaves,
        root,
        0.012 + random() * 0.008,
        height * (0.9 + random() * 0.7),
        new THREE.Euler(
          (random() - 0.5) * 0.5,
          random() * 6.28,
          (random() - 0.5) * 0.5,
        ),
        pale,
        random,
      );
    }
  }
}

function branch(wood, start, end, radius, color) {
  const direction = end.clone().sub(start);
  wood.push({
    position: start.clone().add(end).multiplyScalar(0.5),
    scale: new THREE.Vector3(radius, direction.length(), radius),
    rotation: new THREE.Euler().setFromQuaternion(
      new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        direction.normalize(),
      ),
    ),
    color,
  });
}

function cluster(clusters, position, size, squash, direction, roll, color) {
  const align = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    direction,
  );
  const spin = new THREE.Quaternion().setFromAxisAngle(direction, roll);
  clusters.push({
    position: position.clone(),
    // Non-uniform squash varies each shoot's silhouette from one geometry.
    scale: new THREE.Vector3(size, size * squash, size),
    rotation: new THREE.Euler().setFromQuaternion(spin.multiply(align)),
    color,
  });
}

function leaf(leaves, attachment, width, length, rotation, color, random) {
  leaves.push({
    position: attachment
      .clone()
      .add(new THREE.Vector3(0, length, 0).applyEuler(rotation)),
    scale: new THREE.Vector3(width, length, width),
    rotation,
    color: color.clone().multiplyScalar(0.8 + random() * 0.4),
  });
}
