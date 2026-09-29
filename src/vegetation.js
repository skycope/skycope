import * as THREE from "three";
import {
  terrainHeight,
  shoreDistance,
  islandPoint,
  noise2,
  smoothstep,
} from "./terrain.js";
import { seededRandom } from "./random.js";

// Plant colours are chosen as sRGB hue/saturation/lightness, as a painter
// would pick them. (three's setHSL defaults to the linear working space,
// which made every leaf three to four times too bright: pastel lime, not
// the 5–12% albedo of real foliage.)
const hslColour = (h, s, l) => new THREE.Color().setHSL(h, s, l, THREE.SRGBColorSpace);

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
  // Flower heads by geometry: daisy discs, protea cups, pincushion balls,
  // aloe candles and erica bells. Colour is per instance.
  const flowers = { daisy: [], protea: [], pincushion: [], spike: [], bell: [] };
  // Ground-cover grass clumps, one instance per clump.
  const turf = [];
  // Whole organs: fern and palm fronds, aloe leaves, heath shoots, reed clumps.
  const fronds = [];
  const succulents = [];
  const needles = [];
  const reeds = [];
  const parts = { wood, leaves, clusters, flowers, turf, fronds, succulents, needles, reeds };
  const lists = () => [wood, leaves, clusters, turf, fronds, succulents, needles, reeds, ...Object.values(flowers)];
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
    const before = lists().map((list) => list.length);
    if (plant.kind === "fern") growFern(root, plant.height, random, parts);
    else if (plant.kind === "protea") growProtea(root, plant, random, parts);
    else if (plant.kind === "aloe") growAloe(root, plant.height, random, parts);
    else if (plant.kind === "restio") growRestio(root, plant.height, random, parts);
    else if (plant.kind === "erica") growErica(root, plant.height, random, parts);
    else if (plant.kind === "daisies")
      growDaisies(root, plant.height, random, leaves, flowers, plant.palette);
    else if (plant.kind === "grass")
      growGrass(root, plant.height, plant.dune, random, leaves, turf);
    // Moss is a velvet on the soil (forest.js ground cover), not geometry.
    else if (plant.kind === "moss") continue;
    else if (plant.kind === "shrub")
      growShrub(root, plant, ecotypes[plant.ecotype], random, wood, plant.dune ? needles : clusters);
    else
      growTree(
        root,
        plant,
        ecotypes[plant.ecotype],
        crowns,
        random,
        wood,
        clusters,
        fronds,
      );
    // Every part remembers its plant's ground height: wind bends a plant from
    // its own base, so trunks and stems stay anchored on any slope.
    lists().forEach((list, i) => {
      for (let k = before[i]; k < list.length; k++) list[k].ground = root.y;
    });
  }
  growTurf(seed, layout, turf);
  return { ...parts, layout, plants: layout.length };
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
  for (let i = 0; i < 2400; i++) {
    const theta = random() * Math.PI * 2;
    const inland = 5 + random() * 58;
    const { x, z } = islandPoint(theta, inland);
    const shelter = noise2(x * 0.085 + patch, z * 0.06 + patch);
    const edge = smoothstep(4, 13, inland);
    if (random() > (0.3 + shelter * 0.8) * (0.3 + edge * 0.7)) continue;
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
            0.9 + (height + other.height) * 0.075
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
  for (let i = 0; i < 900; i++) {
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
  for (let i = 0; i < 3800; i++) {
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
  // Fynbos: the Cape's own heathland fills open, sunny ground between groves.
  // Proteas and ericas stand as shrubs, restios in reed tufts, aloes on rocky
  // slopes, and spring daisies carpet clearings in drifts of one colour.
  const drift = random() * 100;
  for (let i = 0; i < 2200; i++) {
    const theta = random() * Math.PI * 2;
    const inland = 3 + random() * 40;
    const { x, z } = islandPoint(theta, inland);
    const open = 1 - noise2(x * 0.085 + patch, z * 0.06 + patch);
    if (random() > open * 1.1) continue;
    const choice = random();
    const kind =
      choice < 0.12 && inland > 6
        ? "protea"
        : choice < 0.22 && inland > 10
          ? "aloe"
          : choice < 0.42
            ? "restio"
            : choice < 0.58 && inland > 5
              ? "erica"
              : "daisies";
    const height =
      kind === "protea"
        ? 0.8 + random() * 0.9
        : kind === "aloe"
          ? 0.6 + random() * 1.4
          : kind === "restio"
            ? 0.5 + random() * 0.9
            : kind === "erica"
              ? 0.35 + random() * 0.5
              : 0.12 + random() * 0.22;
    plants.push({
      kind,
      dune: false,
      form: "blend",
      interior: smoothstep(7, 26, inland),
      exposure: 1 - smoothstep(4, 13, inland),
      ecotype: Math.floor(random() * ecotypes.length),
      // Daisy drifts share a colour over tens of metres.
      palette: Math.floor(noise2(x * 0.05 + drift, z * 0.05) * 5),
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
      // Cape coastal evergreens: deep olive to bottle green, never lime.
      // Real leaf albedo is low (about 0.05–0.1 in green) but clearly green
      // (red and blue near 0.03): the sun, sky sheen and translucency supply
      // the brightness. Greyer picks read as dusty olive in every light.
      hue: 0.25 + random() * 0.08,
      saturation: 0.3 + waxy * 0.16,
      light: 0.15 + (1 - waxy) * 0.1,
      bark: hslColour(
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

function growTree(root, plant, traits, crowns, random, wood, clusters, fronds) {
  const snag = plant.form === "snag";
  if (traits.habit === "palm" && !snag) {
    growPalm(root, plant, traits, random, wood, fronds);
    return;
  }
  const habit = HABITS[traits.habit] ?? {};
  const arche = { ...archetype(plant) };
  if (habit.flatten) arche.flatten = habit.flatten;
  if (habit.droop) arche.droop = habit.droop;
  if (habit.lift) arche.lift = habit.lift;
  const height = plant.height;
  const bark = snag
    ? hslColour(0.1, 0.04, 0.4 + random() * 0.12)
    : new THREE.Color(traits.bark).multiplyScalar(0.55 + random() * 0.35);
  const color = hslColour(
    traits.hue + (random() - 0.5) * 0.035,
    traits.saturation + random() * 0.1,
    traits.light + random() * 0.04,
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
  const trunkRadius = height * 0.034;
  const bend = random() * 6.28;
  for (let i = 1; i <= 6; i++) {
    const t = i / 6;
    const point = root.clone().addScaledVector(lean, t * 0.62);
    // A smooth S-curve, not a kinked polyline.
    point.x += Math.sin(t * 2.6 + bend) * height * 0.035;
    point.z += Math.cos(t * 2.1 + bend) * height * 0.03;
    // Each segment tapers from where the last one ended: one continuous stem.
    branch(wood, spine[i - 1], point, trunkRadius * (1 - (t - 1 / 6) * 0.55), bark, trunkRadius * (1 - t * 0.55));
    spine.push(point);
  }
  // Root flare and surface roots: the trunk swells into the soil instead of
  // ending at a line, and a few buttress roots run out and dive under.
  if (!snag || random() < 0.5) {
    const flareTop = root.clone().addScaledVector(lean, 0.05);
    branch(wood, root.clone().add(new THREE.Vector3(0, -0.15, 0)), flareTop, trunkRadius * 1.9, bark, trunkRadius);
    const roots = 4 + Math.floor(random() * 3);
    for (let r = 0; r < roots; r++) {
      const angle = (r / roots) * Math.PI * 2 + random() * 0.6;
      const reach = height * (0.07 + random() * 0.08);
      const out = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
      const start = root.clone().add(new THREE.Vector3(0, trunkRadius * 0.6, 0)).addScaledVector(out, trunkRadius * 0.5);
      const end = root.clone().addScaledVector(out, reach + trunkRadius);
      end.y = terrainHeight(end.x, end.z) - trunkRadius * 0.5;
      branch(wood, start, end, trunkRadius * (0.45 + random() * 0.2), bark, trunkRadius * 0.12);
    }
  }
  const crownR = crownRadius(plant, traits);
  const crownCenter = spine[6]
    .clone()
    .addScaledVector(PREVAILING, flag * crownR * 0.4);
  crownCenter.y = root.y + height * (habit.center ?? 0.68);
  const neighbours = crowns.filter(
    (c) =>
      (c.x !== plant.x || c.z !== plant.z) &&
      Math.hypot(c.x - crownCenter.x, c.z - crownCenter.z) < c.r + crownR,
  );
  colonizeCrown({
    seeds: [spine[4], spine[6]],
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
    random,
    wood,
    clusters,
  });
}

function growShrub(root, plant, traits, random, wood, clusters) {
  // (Dune shrubs pass the heath `needles` list: fine-leaved coastal fynbos.)
  const arche = archetype(plant);
  const height = plant.height;
  const bark = new THREE.Color(traits.bark).multiplyScalar(0.7 + random() * 0.4);
  const color = hslColour(
    traits.hue + (random() - 0.5) * 0.04,
    traits.saturation + random() * 0.1,
    traits.light + random() * 0.04,
  );
  const flag = (0.5 + plant.exposure) * (plant.dune ? 1 : 0.5);
  const crownR = Math.max(0.45, height * 0.9);
  const crownCenter = root
    .clone()
    .add(new THREE.Vector3(PREVAILING.x * flag * 0.3, height * 0.75, 0));
  // A short stem carries the upper seed: without it, the branches grown
  // from there started in mid-air.
  const stem = root.clone().add(new THREE.Vector3(0, height * 0.3, 0));
  branch(wood, root, stem, height * 0.02, bark, height * 0.017);
  colonizeCrown({
    seeds: [root, stem],
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
    random,
    wood,
    clusters,
  } = options;
  const pointCount = Math.round((detail ? 150 : 95) * arche.points);
  // Lowest a branch may run above the soil beneath it.
  const clearance = Math.max(0.12, crownR * 0.16);
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
    // The crown is placed from the root's height, but on a slope the ground
    // under its downhill side falls away and its uphill side is buried: only
    // points clear of the ground where they are attract growth.
    if (worldY < terrainHeight(x, z) + clearance) continue;
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
  const cap = detail ? 380 : 220;
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
      const x = nx[n] + (a[0] / length) * step;
      const z = nz[n] + (a[2] / length) * step;
      // Drooping limbs level out above the ground instead of diving into it.
      nx.push(x);
      ny.push(Math.max(ny[n] + (a[1] / length) * step, terrainHeight(x, z) + clearance * 0.6));
      nz.push(z);
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
  // Smooth the growth path: colonization steps zig-zag, real shoots curve.
  const childCount = new Array(nx.length).fill(0);
  const firstChild = new Array(nx.length).fill(-1);
  for (let n = seeds.length; n < nx.length; n++) {
    childCount[parent[n]]++;
    if (firstChild[parent[n]] < 0) firstChild[parent[n]] = n;
  }
  for (let pass = 0; pass < 2; pass++) {
    for (let n = seeds.length; n < nx.length; n++) {
      const c = firstChild[n];
      if (childCount[n] !== 1 || c < 0) continue;
      const p = parent[n];
      nx[n] = nx[n] * 0.5 + (nx[p] + nx[c]) * 0.25;
      ny[n] = ny[n] * 0.5 + (ny[p] + ny[c]) * 0.25;
      nz[n] = nz[n] * 0.5 + (nz[p] + nz[c]) * 0.25;
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
  // A segment narrows to its thickest child, so stems taper continuously
  // through every fork instead of stepping down at each node.
  const radiusFor = (tipCount) => Math.min(baseRadius, baseRadius * 0.2 * Math.pow(tipCount, 0.45));
  const thickestChild = new Array(nx.length).fill(0);
  for (let n = seeds.length; n < nx.length; n++)
    thickestChild[parent[n]] = Math.max(thickestChild[parent[n]], tips[n]);
  const start = new THREE.Vector3();
  const end = new THREE.Vector3();
  for (let n = seeds.length; n < nx.length; n++) {
    const p = parent[n];
    start.set(nx[p], ny[p], nz[p]);
    end.set(nx[n], ny[n], nz[n]);
    const radius = radiusFor(tips[n]);
    const endRadius = hasChild[n] ? radiusFor(thickestChild[n]) : radius * 0.45;
    branch(wood, start, end, radius, bark, endRadius);
    if (snag || tips[n] > 3) continue;
    // Terminal and near-terminal shoots carry leaf clusters in a golden-angle
    // spiral, sized to the plant's own crown. Each cluster is darkened by its
    // depth into the canopy — ambient occlusion baked at placement, since the
    // generator knows where the crown surface is.
    const direction = end.clone().sub(start).normalize();
    const phase = random() * Math.PI * 2;
    const count = (detail ? 4 : 3) + (hasChild[n] ? 0 : detail ? 3 : 2);
    // Shoots of many small leaves (10–20 cm), not a few giant ones.
    const leafScale =
      (traits.leaf[0] + traits.leaf[1]) *
      Math.min(1.1, 0.35 + crownR * 0.28) *
      0.85;
    for (let j = 0; j < count; j++) {
      const along = end
        .clone()
        .addScaledVector(direction, (j / count - 0.3) * step * 1.3)
        .addScaledVector(
          new THREE.Vector3(random() - 0.5, random() - 0.5, random() - 0.5),
          step * 0.55,
        );
      along.y = Math.max(along.y, terrainHeight(along.x, along.z) + 0.06);
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
      // Deeper inside the crown and lower down sees less sky: baked
      // occlusion, applied to skylight (and to sun beyond the shadow map),
      // not to the leaf's albedo, so lit interior leaves keep their colour.
      const occlusion =
        (0.32 + depth * 0.68) *
        (0.75 + 0.25 * THREE.MathUtils.clamp((along.y - crownCenter.y) / (crownR * arche.flatten) + 0.5, 0, 1));
      // Sun leaves on the outside are smaller, thicker and yellower; shade
      // leaves inside are larger, thinner and bluer.
      cluster(
        clusters,
        along,
        leafScale * (0.6 + random() * 0.55) * (1.15 - depth * 0.3),
        0.7 + random() * 0.6,
        outward,
        roll,
        color
          .clone()
          .offsetHSL((random() - 0.5) * 0.05 + (depth - 0.6) * 0.03, (random() - 0.5) * 0.08, 0)
          .multiplyScalar(0.8 + random() * 0.4),
        crownCenter,
        occlusion,
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
        if (next.y < terrainHeight(next.x, next.z) + 0.4) break;
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
            crownCenter,
          );
        previous = next;
      }
    }
  }
}

// Palms skip crown colonization: a curved, ringed trunk carries a crown of
// pinnate fronds (frondGeometry, stretched), the young ones rising from the
// centre and the old ones arching and drooping below them.
function growPalm(root, plant, traits, random, wood, fronds) {
  const height = plant.height * (1.05 + random() * 0.25);
  const bark = hslColour(
    0.09 + random() * 0.03,
    0.12,
    0.3 + random() * 0.1,
  );
  const color = hslColour(
    traits.hue + (random() - 0.5) * 0.03,
    0.3 + random() * 0.12,
    traits.light + 0.02,
  );
  const lean = new THREE.Vector3(
    (random() - 0.4) * 0.3 + PREVAILING.x * plant.exposure * 0.2,
    1,
    (random() - 0.5) * 0.3,
  ).multiplyScalar(height);
  let previous = root;
  for (let i = 1; i <= 5; i++) {
    const point = root.clone().addScaledVector(lean, i / 5);
    point.x += Math.sin(i * 1.1 + height) * height * 0.03;
    branch(wood, previous, point, height * 0.024 * (1 - (i - 1) * 0.08), bark, height * 0.024 * (1 - i * 0.08));
    previous = point;
  }
  const count = 11 + Math.floor(random() * 6);
  for (let f = 0; f < count; f++) {
    const azimuth = f * GOLDEN_ANGLE + random() * 0.3;
    const age = f / count;
    const length = height * (0.36 + random() * 0.12) * (0.75 + age * 0.35);
    frond(fronds, previous, azimuth, -0.6 + age * 1.5, length, 1.35, color.clone().multiplyScalar(0.8 + random() * 0.35).offsetHSL((1 - age) * 0.02, 0, 0));
  }
}



// Ferns unfurl from a crown: arching fronds, youngest standing upright in
// the middle, the oldest splayed low (frondGeometry: lobed paired pinnae
// shortening to the tip). One organ instance per frond.
function growFern(root, height, random, { fronds }) {
  const color = hslColour(0.24 + random() * 0.05, 0.4, 0.16 + random() * 0.05);
  const count = 6 + Math.floor(random() * 5);
  for (let f = 0; f < count; f++) {
    const age = f / count;
    frond(
      fronds,
      root,
      f * GOLDEN_ANGLE + random() * 0.4,
      -0.5 + age * 0.85 + (random() - 0.5) * 0.2,
      height * (0.85 + random() * 0.35) * (0.8 + age * 0.3),
      0.9 + random() * 0.25,
      color.clone().multiplyScalar(0.75 + random() * 0.4).offsetHSL((1 - age) * 0.02, 0, 0),
    );
  }
}

// A frond (frondGeometry) rooted at `base`, pointing out along `azimuth`,
// tilted down by `tilt` (negative stands it up), `width` stretching its
// pinnae.
function frond(fronds, base, azimuth, tilt, length, width, color) {
  fronds.push({
    position: base.clone(),
    scale: new THREE.Vector3(length * width, length, length),
    rotation: new THREE.Euler(tilt, Math.PI / 2 - azimuth, 0, "YXZ"),
    color,
    bend: new THREE.Vector3(Math.cos(azimuth) * 0.4, 1, Math.sin(azimuth) * 0.4).normalize(),
  });
}

// A grass plant is a tuft: tillers rise from one crown and arch outward
// (the tuft geometry in forest.js), so it grows out of a point in the soil
// instead of bristling like a star. Dune grass is paler, taller and combed
// inland by the sea wind.
function growGrass(root, height, dune, random, leaves, turf) {
  const color = dune
    ? hslColour(0.12 + random() * 0.04, 0.26, 0.3 + random() * 0.1)
    : hslColour(0.19 + random() * 0.07, 0.36, 0.17 + random() * 0.07);
  const size = height * (0.9 + random() * 0.3);
  const tilt = dune ? 0.28 : 0.08;
  turf.push({
    position: root.clone().add(new THREE.Vector3(0, -0.02, 0)),
    scale: new THREE.Vector3(size * (dune ? 0.75 : 0.9), size * (dune ? 1.15 : 0.95), size * (dune ? 0.75 : 0.9)),
    rotation: new THREE.Euler(PREVAILING.z * tilt * -1, random() * 6.28, PREVAILING.x * tilt * -1, "YXZ"),
    color,
    ground: root.y,
    bend: new THREE.Vector3(0, 1, 0),
    far: random() < 0.5,
  });
  // Some interior tufts send up taller pale seed stalks.
  if (!dune && random() < 0.35) {
    const pale = color.clone().offsetHSL(-0.05, -0.12, 0.1);
    for (let s = 0; s < 2; s++) {
      const up = new THREE.Vector3((random() - 0.5) * 0.35, 1, (random() - 0.5) * 0.35).normalize();
      leaf(
        leaves,
        root,
        0.01 + random() * 0.006,
        height * (0.9 + random() * 0.7),
        orient(up, new THREE.Vector3(up.z, 0, -up.x)),
        pale,
        random,
      );
    }
  }
}

// `radius` at the start, `endRadius` at the end: the instance carries the
// ratio (taper) and the wood shader narrows the unit cylinder along it.
function branch(wood, start, end, radius, color, endRadius = radius * 0.75) {
  const direction = end.clone().sub(start);
  // Segments overlap a little at both ends so joints read as continuous wood
  // instead of notched tubes.
  wood.push({
    taper: Math.min(1.5, endRadius / radius),
    position: start.clone().add(end).multiplyScalar(0.5),
    scale: new THREE.Vector3(radius, direction.length() + radius * 1.4, radius),
    rotation: new THREE.Euler().setFromQuaternion(
      new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        direction.normalize(),
      ),
    ),
    color,
  });
}

// `centre` is the middle of the foliage mass this shoot belongs to: its
// direction becomes the leaf's bent normal, so the crown shades as one soft
// volume rather than a heap of flat cards.
function cluster(clusters, position, size, squash, direction, roll, color, centre = null, occlusion = undefined) {
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
    bend: bentNormal(position, centre),
    // Sky occlusion (forest.js canopyShade): 0 open sky, 1 buried in leaves.
    shade: occlusion === undefined ? undefined : 1 - THREE.MathUtils.clamp(occlusion, 0, 1),
  });
}

function bentNormal(position, centre) {
  if (!centre) return new THREE.Vector3(0, 1, 0);
  const n = position.clone().sub(centre);
  n.y = n.y * 1.2 + n.length() * 0.35;
  return n.lengthSq() > 1e-8 ? n.normalize() : new THREE.Vector3(0, 1, 0);
}

// The rotation that points a unit leaf (y from base to tip, its face +z)
// along `direction`, its face turned as far toward `face` as it can.
function orient(direction, face) {
  const y = direction.clone().normalize();
  const z = face.clone().addScaledVector(y, -face.dot(y));
  if (z.lengthSq() < 1e-6) z.set(1, 0, 0).addScaledVector(y, -y.x);
  z.normalize();
  const x = new THREE.Vector3().crossVectors(y, z);
  return new THREE.Euler().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
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

// King and sugarbush proteas: a leathery shrub of curving stems that branch
// below each old flower head, clothed in stiff grey-green leaves up to the
// large cup-shaped heads of rose, pink or cream bracts at their tips. Some
// are pincushions (Leucospermum), whose heads bristle with orange styles.
function growProtea(root, plant, random, { wood, clusters, flowers }) {
  const height = plant.height;
  const pincushion = random() < 0.35;
  const leafColour = hslColour(0.19 + random() * 0.07, 0.2, 0.2 + random() * 0.05);
  const bark = hslColour(0.06, 0.25, 0.2);
  const heart = root.clone().add(new THREE.Vector3(0, height * 0.5, 0));
  const headColour = pincushion
    ? hslColour(0.03 + random() * 0.07, 0.85, 0.5)
    : [
        hslColour(0.95 + random() * 0.03, 0.55, 0.62),
        hslColour(0.98, 0.45, 0.72),
        hslColour(0.1, 0.35, 0.82),
        hslColour(0.95, 0.42, 0.5),
      ][Math.floor(random() * 4)];
  const grow = (start, direction, length, radius, depth) => {
    // A stem bends toward the light as it grows, wandering a little.
    let point = start;
    let dir = direction.clone();
    const segments = 3;
    for (let s = 1; s <= segments; s++) {
      dir.lerp(new THREE.Vector3(0, 1, 0), 0.14).add(new THREE.Vector3((random() - 0.5) * 0.3, 0, (random() - 0.5) * 0.3)).normalize();
      const next = point.clone().addScaledVector(dir, length / segments);
      branch(wood, point, next, radius * (1 - (s - 1) * 0.2), bark, radius * (1 - s * 0.2));
      // Stiff leaves clothe the stem all the way up, spiralling densely.
      for (let l = 0; l < 3; l++)
        cluster(clusters, point.clone().lerp(next, 0.2 + l * 0.3), height * (0.15 - s * 0.012) * (depth ? 0.8 : 1), 1.1, dir, random() * 6.28,
          leafColour.clone().multiplyScalar(0.8 + random() * 0.35), heart, 0.7 + s * 0.1);
      point = next;
    }
    // Sympodial: new stems sprout just below the old head, so the bush
    // thickens outward and upward year on year.
    if (depth < 2 && random() < (depth ? 0.3 : 0.7)) {
      for (let k = 0; k < 2; k++) {
        const side = dir.clone().add(new THREE.Vector3(random() - 0.5, 0.2, random() - 0.5).multiplyScalar(1.2)).normalize();
        grow(point.clone().addScaledVector(dir, -length * 0.2), side, length * 0.55, radius * 0.6, depth + 1);
      }
    }
    if (random() < 0.8) {
      const size = height * (pincushion ? 0.07 : 0.085) * (0.8 + random() * 0.45);
      const face = dir.clone().lerp(new THREE.Vector3(0, 1, 0), 0.4).normalize();
      head(flowers[pincushion ? "pincushion" : "protea"], point, size, face, random() * 6.28,
        headColour.clone().offsetHSL((random() - 0.5) * 0.02, 0, (random() - 0.5) * 0.06));
    }
  };
  // A vase of stems from the rootstock, spreading and then turning up.
  const stems = 4 + Math.floor(random() * 4);
  for (let s = 0; s < stems; s++) {
    const angle = s * GOLDEN_ANGLE + random() * 0.5;
    const lean = 0.55 + random() * 0.5;
    const direction = new THREE.Vector3(Math.cos(angle) * lean, 1, Math.sin(angle) * lean).normalize();
    grow(root, direction, height * (0.45 + random() * 0.25), height * 0.022, 0);
  }
}

// Aloes: a spiral rosette of thick, channelled, recurving leaves
// (succulentGeometry) with red-brown teeth. Tree aloes (A. ferox) lift it on
// a stem wrapped in a skirt of dry old leaves; in winter bloom, branched
// candelabra spikes of orange-red tubular flowers rise from the centre.
function growAloe(root, height, random, { wood, leaves, succulents, flowers }) {
  const colour = hslColour(0.28 + random() * 0.1, 0.2, 0.2 + random() * 0.05);
  const stemmed = random() < 0.55;
  const stemHeight = stemmed ? height * (0.4 + random() * 0.35) : 0;
  const crown = root.clone().add(new THREE.Vector3((random() - 0.5) * 0.1, stemHeight, (random() - 0.5) * 0.1));
  const up = new THREE.Vector3(0, 1, 0);
  if (stemmed) {
    const bark = hslColour(0.08, 0.15, 0.22);
    branch(wood, root.clone().add(new THREE.Vector3(0, -0.05, 0)), crown, height * 0.06, bark, height * 0.05);
    // The skirt: last years' leaves hang dead and grey-brown down the stem.
    const dead = hslColour(0.07 + random() * 0.03, 0.22, 0.26);
    const count = 10 + Math.floor(random() * 8);
    for (let i = 0; i < count; i++) {
      const azimuth = i * GOLDEN_ANGLE;
      const out = new THREE.Vector3(Math.cos(azimuth), 0, Math.sin(azimuth));
      const at = root.clone().lerp(crown, 0.45 + (i / count) * 0.5).addScaledVector(out, height * 0.04);
      const hang = out.clone().multiplyScalar(0.35).add(new THREE.Vector3(0, -1, 0)).normalize();
      organ(succulents, at, hang, out, height * (0.28 + random() * 0.08), dead.clone().multiplyScalar(0.75 + random() * 0.4));
    }
  }
  const count = 18 + Math.floor(random() * 10);
  for (let i = 0; i < count; i++) {
    // Youngest leaves stand in the centre; older ones splay out and down.
    const azimuth = i * GOLDEN_ANGLE;
    const age = 1 - i / count;
    const tilt = 0.25 + age * 1.15;
    const out = new THREE.Vector3(Math.cos(azimuth) * Math.sin(tilt), Math.cos(tilt), Math.sin(azimuth) * Math.sin(tilt));
    organ(
      succulents,
      crown.clone().add(new THREE.Vector3(0, height * 0.03 * (1 - age), 0)),
      out,
      up,
      height * (0.3 + age * 0.18) * (0.9 + random() * 0.2),
      colour.clone().offsetHSL(0, 0, (age - 0.5) * -0.04).multiplyScalar(0.85 + random() * 0.3),
    );
  }
  const spikes = 1 + Math.floor(random() * 3);
  const flame = hslColour(0.02 + random() * 0.07, 0.9, 0.5);
  for (let s = 0; s < spikes; s++) {
    const angle = s * 2.2 + random();
    const top = crown.clone().add(
      new THREE.Vector3(Math.cos(angle) * height * 0.25, height * (0.75 + random() * 0.4), Math.sin(angle) * height * 0.25),
    );
    const stalk = top.clone().sub(crown).normalize();
    leaf(leaves, crown, 0.02, top.distanceTo(crown) * 0.47,
      orient(stalk, new THREE.Vector3(stalk.z, 0, -stalk.x)), colour.clone().offsetHSL(-0.2, 0.1, -0.04), random);
    head(flowers.spike, top, height * 0.15, new THREE.Vector3(0, 1, 0), random() * 6.28,
      flame.clone().offsetHSL((random() - 0.5) * 0.03, 0, (random() - 0.5) * 0.08));
  }
}

// An organ whose unit geometry runs along +y with its face toward +z.
function organ(list, position, direction, face, size, color) {
  list.push({
    position: position.clone(),
    scale: new THREE.Vector3(size, size, size),
    rotation: orient(direction, face),
    color,
    bend: direction.clone().add(new THREE.Vector3(0, 0.5, 0)).normalize(),
  });
}

// Restios: Cape reeds in dense clumps of fine leafless culms with brown
// spikelets (reedGeometry), a main clump and a satellite or two where the
// rhizome has spread.
function growRestio(root, height, random, { reeds }) {
  const stem = hslColour(0.17 + random() * 0.06, 0.26, 0.24 + random() * 0.08);
  const clumps = 1 + Math.floor(random() * 3);
  for (let c = 0; c < clumps; c++) {
    const at = c === 0 ? root.clone() : root.clone().add(new THREE.Vector3((random() - 0.5) * height * 0.8, 0, (random() - 0.5) * height * 0.8));
    at.y = terrainHeight(at.x, at.z) - 0.02;
    const size = height * (c === 0 ? 1 : 0.55 + random() * 0.3);
    reeds.push({
      position: at,
      scale: new THREE.Vector3(size * 0.8, size, size * 0.8),
      rotation: new THREE.Euler(0, random() * 6.28, 0),
      color: stem.clone().multiplyScalar(0.85 + random() * 0.3),
      bend: new THREE.Vector3(0, 1, 0),
    });
  }
}

// Ericas: dense, rounded heath shrubs of fine twigs clothed in needle
// leaves (needleGeometry), hung near the shoot tips with clusters of tiny
// pink, magenta or white bells.
function growErica(root, height, random, { wood, needles, flowers }) {
  const green = hslColour(0.24 + random() * 0.04, 0.32, 0.15 + random() * 0.05);
  const bark = hslColour(0.07, 0.25, 0.2);
  const bloom = [
    hslColour(0.92, 0.7, 0.6),
    hslColour(0.88, 0.6, 0.45),
    hslColour(0.97, 0.75, 0.5),
    hslColour(0.1, 0.2, 0.9),
  ][Math.floor(random() * 4)];
  const heart = root.clone().add(new THREE.Vector3(0, height * 0.4, 0));
  const sprigs = 14 + Math.floor(random() * 8);
  for (let s = 0; s < sprigs; s++) {
    const angle = s * GOLDEN_ANGLE;
    const tilt = 0.15 + Math.sqrt((s + 0.5) / sprigs) * 1.1;
    let dir = new THREE.Vector3(Math.cos(angle) * Math.sin(tilt), Math.cos(tilt), Math.sin(angle) * Math.sin(tilt));
    let point = root;
    const length = height * (0.75 + random() * 0.35) * (1 - tilt * 0.25);
    for (let k = 1; k <= 2; k++) {
      dir = dir.clone().lerp(new THREE.Vector3(0, 1, 0), 0.2).normalize();
      const next = point.clone().addScaledVector(dir, length / 2);
      branch(wood, point, next, 0.009 * (1.3 - k * 0.4), bark, 0.009 * (1.3 - (k + 1) * 0.4));
      const outer = k === 2;
      cluster(needles, next, height * (outer ? 0.34 : 0.28), 1, dir, random() * 6.28,
        green.clone().multiplyScalar(0.75 + random() * 0.4), heart, outer ? 1 : 0.6);
      if (!outer) cluster(needles, point.clone().lerp(next, 0.5), height * 0.26, 1, dir, random() * 6.28,
        green.clone().multiplyScalar(0.7 + random() * 0.3), heart, 0.5);
      point = next;
    }
    for (let b = 0; b < 3; b++) {
      const at = point.clone().addScaledVector(dir, -height * (0.05 + random() * 0.15)).add(
        new THREE.Vector3((random() - 0.5) * height * 0.12, 0, (random() - 0.5) * height * 0.12),
      );
      head(flowers.bell, at, 0.016 + random() * 0.012, new THREE.Vector3(0, -1, 0), random() * 6.28,
        bloom.clone().offsetHSL(0, 0, (random() - 0.5) * 0.1));
    }
  }
}

// Namaqualand-style daisy drifts: many small heads on slender stems, turned
// toward the sun, in the drift's shared colour.
const DAISY_COLOURS = [
  [0.08, 0.95, 0.52],
  [0.13, 0.95, 0.55],
  [0.0, 0.0, 0.95],
  [0.87, 0.65, 0.55],
  [0.04, 0.85, 0.5],
];
function growDaisies(root, height, random, leaves, flowers, palette) {
  const [h, sat, l] = DAISY_COLOURS[(palette ?? Math.floor(random() * 5)) % 5];
  const stem = hslColour(0.26, 0.4, 0.2);
  const count = 5 + Math.floor(random() * 8);
  for (let i = 0; i < count; i++) {
    const base = root.clone().add(new THREE.Vector3((random() - 0.5) * 0.9, 0, (random() - 0.5) * 0.9));
    base.y = terrainHeight(base.x, base.z);
    const stalk = height * (0.6 + random() * 0.6);
    const up = new THREE.Vector3((random() - 0.5) * 0.2, 1, (random() - 0.5) * 0.2).normalize();
    leaf(leaves, base, 0.01, stalk * 0.5, orient(up, new THREE.Vector3(up.z, 0, -up.x)), stem, random);
    // A small basal rosette of narrow leaves at the foot of each stem.
    if (i % 2 === 0)
      for (let l = 0; l < 3; l++) {
        const a = random() * 6.28;
        const out = new THREE.Vector3(Math.cos(a), 0.45, Math.sin(a)).normalize();
        leaf(leaves, base, 0.016, stalk * 0.18, orient(out, new THREE.Vector3(0, 1, 0)), stem.clone().multiplyScalar(0.85), random);
      }
    // Heads face north-ish and up: toward the southern-hemisphere sun.
    const face = new THREE.Vector3((random() - 0.5) * 0.4, 1, -0.45 + (random() - 0.5) * 0.3).normalize();
    head(flowers.daisy, base.clone().add(new THREE.Vector3(0, stalk, 0)), 0.035 + random() * 0.03, face,
      random() * 6.28, hslColour(h + (random() - 0.5) * 0.02, sat, l + (random() - 0.5) * 0.06));
  }
}

function head(list, position, size, direction, roll, color) {
  const align = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize());
  const spin = new THREE.Quaternion().setFromAxisAngle(direction.clone().normalize(), roll);
  list.push({
    position: position.clone(),
    scale: new THREE.Vector3(size, size, size),
    rotation: new THREE.Euler().setFromQuaternion(spin.multiply(align)),
    color,
  });
}

// Turf: a continuous layer of grass clumps so soil shows only in paths,
// dune blowouts and deep shade. Straw-coloured on the exposed dunes, green
// and lusher inland; sparser under dense canopy.
function growTurf(seed, layout, turf) {
  const random = seededRandom(seed ^ 0x2545f491);
  const trees = layout.filter((p) => p.kind === "tree");
  const grid = new Map();
  for (const t of trees) {
    const key = `${Math.floor(t.x / 6)},${Math.floor(t.z / 6)}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(t);
  }
  const patch = random() * 500;
  for (let i = 0; i < 30000; i++) {
    const theta = random() * Math.PI * 2;
    const inland = 1.6 + Math.pow(random(), 0.85) * 55;
    const { x, z } = islandPoint(theta, inland);
    // Bare patches: paths and blowouts where the field dips.
    const field = noise2(x * 0.12 + patch, z * 0.1 - patch) * 0.7 + noise2(x * 0.5, z * 0.5) * 0.3;
    if (field < 0.3 + (1 - smoothstep(2, 6, inland)) * 0.25) continue;
    let shade = 0;
    const cx = Math.floor(x / 6);
    const cz = Math.floor(z / 6);
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++)
        for (const t of grid.get(`${cx + dx},${cz + dz}`) ?? []) {
          const d = Math.hypot(x - t.x, z - t.z);
          if (d < 0.35) shade = 2;
          shade += Math.exp(-(d * d) / (t.height * t.height * 0.12)) * 0.5;
        }
    if (shade > 1 || random() < shade * 0.7) continue;
    const y = terrainHeight(x, z);
    const dune = 1 - smoothstep(3, 10, inland);
    const colour = hslColour(
      0.21 + random() * 0.08 - dune * 0.08,
      0.38 - dune * 0.14,
      0.15 + random() * 0.07 + dune * 0.09,
    );
    const size = (0.28 + random() * 0.3) * (1 - dune * 0.2);
    turf.push({
      position: new THREE.Vector3(x, y - 0.02, z),
      scale: new THREE.Vector3(size, size * (0.8 + random() * 0.6), size),
      rotation: new THREE.Euler((random() - 0.5) * 0.2, random() * 6.28, (random() - 0.5) * 0.2),
      color: colour,
      ground: y,
      bend: new THREE.Vector3(0, 1, 0),
      far: random() < 0.22,
    });
  }
}
