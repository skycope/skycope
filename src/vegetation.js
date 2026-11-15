import * as THREE from "three";
import {
  terrainHeight,
  shoreDistance,
  ISLAND,
  islandPoint,
  noise2,
  smoothstep,
} from "./terrain.js";
import { seededRandom } from "./random.js";
import { createHabitat, sampleHabitat, graniteAt } from "./habitat.js";
import { groundCover, shoreClear } from "./ground-detail.js";
import { foliageDemand, demandRadius } from "./plant-growth.js";
import { MATERIAL_HEX } from "./material-palette.js";
import { plantClear } from "./place-layout.js"; // places:

// Plant colours are chosen as sRGB hue/saturation/lightness, as a painter
// would pick them. (three's setHSL defaults to the linear working space,
// which made every leaf three to four times too bright: pastel lime, not
// the 5–12% albedo of real foliage.)
const hslColour = (h, s, l) => new THREE.Color().setHSL(h, s, l, THREE.SRGBColorSpace);

// Prevailing south-easter blows onshore. Exposure "flags" coastal crowns: they
// lean and grow away from the wind, strongest at the beach edge.
const PREVAILING = new THREE.Vector3(0.9, 0, -0.436);
const GOLDEN_ANGLE = 2.39996;
const DEAD_WOOD = new THREE.Color(MATERIAL_HEX.deadGrowth);

// Growth archetypes span the coastal gradient. A tree blends wind-sheared
// scrub toward canopy with interior shelter; saplings and dead snags are
// discrete picks. These scale the seed-derived community traits, they do not
// replace them, so groves stay individually varied.
const SCRUB = {
  height: 0.5,
  spread: 1.5,
  lift: 0.06,
  flag: 1.0,
  droop: 0.3,
  flatten: 0.48,
  points: 0.7,
};
const CANOPY = {
  height: 1.0,
  spread: 1.0,
  lift: 0.35,
  flag: 0.22,
  droop: 0.55,
  flatten: 0.74,
  points: 1.0,
};

// `avoid(x, z, reach)`: true where nothing may root (a boulder: forest.js
// rockFootprints), for plants and turf alike.
export function createVegetation(seed, { avoid = null } = {}) {
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
  // Fynbos shrubs, each one rounded mass of foliage (plant-forms.js
  // shrubMassGeometry): the understory that closes the ground.
  const masses = [];
  const parts = { wood, leaves, clusters, flowers, turf, fronds, succulents, needles, reeds, masses };
  const lists = () => [wood, leaves, clusters, turf, fronds, succulents, needles, reeds, masses, ...Object.values(flowers)];
  const layout = vegetationLayout(seed);
  // move: nothing grows up through a boulder (a tree's trunk keeps clear
  // of one by its own girth and a little).
  if (avoid) {
    let n = 0;
    for (const p of layout) if (!avoid(p.x, p.z, p.kind === "tree" ? 0.25 + p.height * 0.034 : 0.05)) layout[n++] = p;
    layout.length = n;
  }
  const ecotypes = growthTraits(seed);
  const habitat = createHabitat(seed, layout);
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
    plant.habitat = sampleHabitat(habitat, plant.x, plant.z);
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
    else if (plant.kind === "shrub") growMass(plant, random, parts);
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
      for (let k = before[i]; k < list.length; k++) {
        const organ = list[k];
        organ.ground ??= root.y;
        organ.id = `${plant.id}:${i}:${k - before[i]}`;
        organ.patchId = plant.patchId;
        organ.materialClass ??= plant.kind === "aloe" || plant.kind === "protea" ? "waxy" : plant.form === "snag" ? "dead" : "live";
        if (i === 0 && organ.materialClass !== "dead") organ.materialClass = "bark";
        // Self-pruned twigs keep their bark but go grey. Colours are shared
        // between a plant's segments, so a dead one gets its own copy.
        if (organ.materialClass === "dead" && i === 0 && plant.form !== "snag")
          organ.color = organ.color.clone().lerp(DEAD_WOOD, 0.45);
      }
    });
  }
  growTurf(seed, layout, turf, masses);
  { let n = 0; for (const t of turf) if (plantClear(seed, "grass", t.position.x, t.position.z) && !avoid?.(t.position.x, t.position.z, 0)) turf[n++] = t; turf.length = n; } // places: move:
  return { ...parts, layout, habitat, producers: habitat.producers, plants: layout.length };
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
    // Groves and gaps: trees gather where a grove field is high (sheltered
    // hollows and kloofs) with open fynbos between them; the odd tree stands
    // alone in the heath. (An even scatter read as an orchard.)
    // Behind each beach, where the slope rises from the dunes, a belt of
    // coastal thicket trees (milkwood, sea guarrie) in clumps of a few with
    // fynbos between: the first trees a visitor sees from the sand.
    const belt = smoothstep(7, 10, inland) * (1 - smoothstep(18, 26, inland)) *
      smoothstep(0.45, 0.62, noise2(x * 0.13 + patch * 0.4, z * 0.13 - patch * 0.2));
    const grove = Math.max(noise2(x * 0.05 + patch * 0.7, z * 0.045 - patch * 0.3) * 0.75 + shelter * 0.25, belt * 0.72);
    const inGrove = smoothstep(0.42, 0.6, grove);
    if (random() > (0.3 + shelter * 0.8) * (0.3 + edge * 0.7) * (0.1 + 0.9 * inGrove)) continue;
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
    // Tallest at a grove's heart, lower toward its edge and alone; each
    // tree its own age.
    const height =
      traits.height *
      (0.5 + random() * 0.8) *
      (0.7 + 0.5 * smoothstep(0.5, 0.85, grove)) *
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
      // 1 at a grove's rim or alone: the crown is skirted down to the ground.
      rim: 1 - smoothstep(0.5, 0.7, grove),
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
      species: scrubby ? "dune" : undefined,
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
    // Ferns only in the shade of the groves (kloof forest), not out on
    // the fynbos slopes.
    const kind =
      choice < 0.24 && inland > 7 && noise2(x * 0.085 + patch, z * 0.06 + patch) > 0.55 && random() < 0.45
        ? "fern"
        : choice < 0.38 && inland > 9
          ? "moss"
          : choice < 0.58
            ? "shrub"
            : "grass";
    const height =
      kind === "shrub"
        ? 0.6 + random() * 0.7
        : kind === "moss"
          ? 0.08 + random() * 0.16
          : 0.25 + random() * 0.85;
    plants.push({
      kind,
      species: kind === "shrub" ? "blombos" : undefined,
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
  understoryLayout(seed, plants, patch);
  // Nothing below the dry-sand line or within the swash's reach; plants
  // thin in over the dry sand above it (dune grass first, then the rest).
  {
    const shore = seededRandom(seed ^ 0x5bd1e995);
    let n = 0;
    for (const p of plants) {
      const clear = p.kind === "grass" ? shoreClear(p.x, p.z, undefined, 4.5, 6.5) : shoreClear(p.x, p.z, undefined, 5.5, 9);
      if (shore() < clear) plants[n++] = p;
    }
    plants.length = n;
  }
  // places: nothing grows through a landmark (place-layout.js).
  { let n = 0; for (const p of plants) if (plantClear(seed, p.kind, p.x, p.z, p.height)) plants[n++] = p; plants.length = n; }
  // Stable identities and a regional age; every candidate keeps its kind, so
  // the understorey stays as dense as it grows (a community filter that
  // thinned open ground to 38% left the hills bare dirt).
  const habitat = createHabitat(seed, plants);
  plants.forEach((plant, i) => {
    const site = sampleHabitat(habitat, plant.x, plant.z);
    plant.id = `${seed}:plant:${i}`;
    plant.patchId = site.id;
    plant.age = plant.form === "sapling" ? 0.12 : site.age;
  });
  return plants;
}

// Fynbos shrub species, as the eye sorts them on a Cape hillside: by hue
// family and size. Colours are sRGB HSL (a painter's pick); `spread` is the
// mass's radius (m) and `tall` its height over its radius. Nothing
// saturated: grey-green renosterbos is the matrix, olive and deeper green
// shrubs stand in it, straw and ochre where plants are old or dry, and the
// few flowers are small and muted.
const SPECIES = {
  renoster: { hsl: [0.22, 0.16, 0.3], spread: [0.38, 0.75], tall: [0.66, 0.92] },
  erica: { hsl: [0.18, 0.25, 0.24], spread: [0.28, 0.52], tall: [0.72, 0.95], bloom: 0.4, flowers: [[0.87, 0.24, 0.6], [0.93, 0.22, 0.7], [0.12, 0.1, 0.86]] },
  pelargonium: { hsl: [0.25, 0.26, 0.24], spread: [0.38, 0.68], tall: [0.66, 0.92], bloom: 0.35, flowers: [[0.85, 0.28, 0.66], [0.9, 0.2, 0.74]] },
  blombos: { hsl: [0.29, 0.3, 0.18], spread: [0.5, 0.92], tall: [0.7, 0.98] },
  restiold: { hsl: [0.13, 0.22, 0.3], spread: [0.28, 0.52], tall: [0.66, 0.9] },
  dune: { hsl: [0.16, 0.13, 0.33], spread: [0.25, 0.5], tall: [0.6, 0.9] },
  sourfig: { hsl: [0.2, 0.3, 0.24], spread: [0.4, 0.85], tall: [0.18, 0.28], bloom: 0.25, flowers: [[0.86, 0.3, 0.62], [0.14, 0.42, 0.66]] },
};
// Drifts: one species holds a few metres of slope, as real fynbos does.
const HEATH = ["renoster", "renoster", "erica", "restiold", "renoster", "pelargonium", "renoster", "erica", "blombos", "restiold", "renoster", "erica"];
const THICKET = ["blombos", "blombos", "pelargonium", "renoster", "erica"];

// The understory: fynbos shrubs, one rounded mass each, closing the ground
// between the trees on every slope, so soil shows only on paths, in
// clearings and under the darkest crowns. Shrubs stand where the ground's
// painted scrub is (ground-detail.js groundCover), so near and far agree;
// they thin over granite and toward the sand, where sour-fig mats take
// over, and under a crown they grow sparse and low. Spacing is a jittered
// grid broken by a patch field, so they clump with gaps between them.
function understoryLayout(seed, plants, patch) {
  const random = seededRandom(seed ^ 0x3c6ef372);
  const cell = 0.72;
  // What is already rooted (trunks, rosettes, reeds): shrubs keep clear.
  const taken = new Map();
  const key = (x, z) => `${Math.floor(x / 2)},${Math.floor(z / 2)}`;
  for (const p of plants) {
    if (p.kind === "grass" || p.kind === "moss" || p.kind === "daisies") continue;
    const k = key(p.x, p.z);
    if (!taken.has(k)) taken.set(k, []);
    taken.get(k).push(p);
  }
  const trees = new Map();
  for (const p of plants) {
    if (p.kind !== "tree") continue;
    const k = `${Math.floor(p.x / 6)},${Math.floor(p.z / 6)}`;
    if (!trees.has(k)) trees.set(k, []);
    trees.get(k).push(p);
  }
  const shadeAt = (x, z) => {
    let shade = 0;
    const cx = Math.floor(x / 6), cz = Math.floor(z / 6);
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++)
        for (const t of trees.get(`${cx + dx},${cz + dz}`) ?? []) {
          const d2 = (x - t.x) ** 2 + (z - t.z) ** 2;
          shade += Math.exp(-d2 / Math.max(0.5, t.height * t.height * 0.1)) * (t.form === "snag" ? 0.2 : 0.7);
        }
    return Math.min(1, shade);
  };
  const crowded = (x, z, r) => {
    const cx = Math.floor(x / 2), cz = Math.floor(z / 2);
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++)
        for (const p of taken.get(`${cx + dx},${cz + dz}`) ?? []) {
          // Shrub masses may run into each other (a thicket is one mass of
          // many plants); trunks and rosettes keep a little room.
          const clear = p.kind === "tree" ? 0.25 + p.height * 0.034 : p.kind === "shrub" ? (p.spread ?? 0.4) * 0.55 : 0.35;
          if (Math.hypot(x - p.x, z - p.z) < clear + r * (p.kind === "shrub" ? 0.5 : 0.75)) return true;
        }
    return false;
  };
  const drift = random() * 100;
  const R = 70;
  for (let gz = -R; gz < R; gz += cell)
    for (let gx = -R; gx < R; gx += cell) {
      const x = ISLAND.x + gx + random() * cell;
      const z = ISLAND.z + gz + random() * cell;
      const roll = random();
      const inland = shoreDistance(x, z);
      // Nothing on the wet sand or in the swash's reach (shoreClear).
      const clear = shoreClear(x, z, inland, 5.5, 9);
      if (clear <= 0) continue;
      const shade = shadeAt(x, z);
      const { scrub } = groundCover(x, z, inland, shade * 0.4);
      const granite = graniteAt(x, z, inland);
      // Clumps and gaps at a few metres: a patch field thins the cover.
      const clump = noise2(x * 0.42 + patch, z * 0.38 - patch) * 0.7 + noise2(x * 1.1 - 3, z * 1.1 + 7) * 0.3;
      const open = smoothstep(0.14, 0.4, clump);
      // Closed fynbos well inland, sparse at the dune edge with sand and
      // grass between the bushes, rising to closed cover up the slope (by
      // ~18 m inland). Under the crowns
      // it carries on as thicket (shade-tolerant blombos and pelargonium,
      // lower and a little sparser), so the floor between trunks is cover,
      // not bare soil.
      const cover = Math.max(scrub * 0.8, smoothstep(7, 18, inland) * 0.95) * clear * open * (1 - granite * 0.8) * (1 - shade * 0.12);
      let species = null;
      if (roll < cover * 0.92) {
        const site = noise2(x * 0.06 + drift, z * 0.05 - drift);
        // (Value noise bunches round 0.5: spread it over the whole list.)
        const pick = smoothstep(0.22, 0.78, noise2(x * 0.23 + drift, z * 0.21 + drift * 0.5)) * 0.999;
        const list = site > 0.58 || shade > 0.3 ? THICKET : HEATH;
        species = list[Math.min(list.length - 1, Math.floor(pick * list.length))];
        if (inland < 10 && random() < 0.6) species = "dune";
      }
      // (Sour fig is not grown as a mass: a creeping mat must lie on the
      // sand, so it is painted on the ground: forest.js, groundCover.)
      if (!species) continue;
      const sp = SPECIES[species];
      // Smaller toward the sea wind and in the shade; neighbours alike.
      const size = (0.75 + noise2(x * 0.5 - drift, z * 0.5) * 0.5) * (0.6 + smoothstep(2.5, 9, inland) * 0.4) * (1 - shade * 0.15);
      const spread = (sp.spread[0] + random() * (sp.spread[1] - sp.spread[0])) * size;
      if (crowded(x, z, spread)) continue;
      const plant = {
        kind: "shrub",
        species,
        understory: true,
        dune: inland < 6,
        form: "blend",
        interior: smoothstep(7, 26, inland),
        exposure: 1 - smoothstep(4, 13, inland),
        ecotype: 0,
        x,
        z,
        spread,
        height: spread * (sp.tall[0] + random() * (sp.tall[1] - sp.tall[0])),
        seed: Math.max(1, Math.floor(random() * 0xffffffff)),
      };
      plants.push(plant);
      const k = key(x, z);
      if (!taken.has(k)) taken.set(k, []);
      taken.get(k).push(plant);
    }
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
      // Weathered bark is dark: grey-brown at 18–30% lightness.
      bark: hslColour(
        0.09 + random() * 0.06,
        0.08 + random() * 0.16,
        0.18 + random() * 0.12,
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
  arche.lift += (plant.habitat?.competition ?? 0) * .3;
  arche.flatten *= .82 + (plant.age ?? .5) * .28;
  if (habit.flatten) arche.flatten = habit.flatten;
  if (habit.droop) arche.droop = habit.droop;
  if (habit.lift) arche.lift = habit.lift;
  const height = plant.height;
  const bark = snag
    ? hslColour(0.1, 0.04, 0.4 + random() * 0.12)
    : new THREE.Color(traits.bark).multiplyScalar(0.7 + random() * 0.35);
  // Hue families, as a hillside of mixed evergreens reads at a distance:
  // the grove's own deep green, olive, and a silvery grey-green (wild olive,
  // sea guarrie); each tree a little lighter or darker than its neighbour.
  const family = random();
  const [dh, ds, dl] = family < 0.5 ? [0, 0, 0] : family < 0.78 ? [-0.065, -0.06, 0.03] : [-0.03, -0.15, 0.06];
  const color = hslColour(
    traits.hue + dh + (random() - 0.5) * 0.035,
    Math.max(0.1, traits.saturation + ds + random() * 0.08),
    traits.light + dl + (random() - 0.5) * 0.05,
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
  // A tree at a grove's rim or alone keeps its lower limbs: the crown
  // skirts down toward the ground instead of a lollipop on a bare stem.
  const rim = snag ? 0 : plant.rim ?? 0;
  arche.lift *= 1 - rim * 0.55;
  crownCenter.y = root.y + height * ((habit.center ?? 0.68) - rim * 0.12);
  const neighbours = crowns.filter(
    (c) =>
      (c.x !== plant.x || c.z !== plant.z) &&
      Math.hypot(c.x - crownCenter.x, c.z - crownCenter.z) < c.r + crownR,
  );
  colonizeCrown({
    seeds: rim > 0.5 ? [spine[2], spine[4], spine[6]] : [spine[4], spine[6]],
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
    age: plant.age,
    site: plant.habitat,
    vines: Boolean(habit.vines) && detail,
    random,
    wood,
    clusters,
  });
}

// A fynbos shrub: one rounded mass (shrubMassGeometry), seated in the
// slope (sunk to the lowest ground under its rim, leaning a little with
// the slope and away from the sea wind), in its species colour with its own
// variation in value and hue; old or dry ones go toward straw. Flowering
// ones carry a few small, muted heads on their upper surface.
function growMass(plant, random, { masses, flowers }) {
  const sp = SPECIES[plant.species] ?? SPECIES.blombos;
  const spread = plant.spread ?? Math.max(0.35, plant.height * 0.6);
  const height = plant.height;
  // Seated on a slope by leaning with most of it (three quarters: a bush
  // hugs the ground but grows up, not out) and sinking the rest, so the
  // downhill rim meets the ground and the uphill side is buried by only a
  // few centimetres. (Sat at the lowest ground under its rim and leaning
  // half the slope, a bush on the steep backslope of a beach was buried
  // to half its height uphill: a flat plate in the slope.)
  const gx = (terrainHeight(plant.x + 0.5, plant.z) - terrainHeight(plant.x - 0.5, plant.z));
  const gz = (terrainHeight(plant.x, plant.z + 0.5) - terrainHeight(plant.x, plant.z - 0.5));
  const slope = Math.hypot(gx, gz);
  const seat = terrainHeight(plant.x, plant.z) - 0.25 * slope * spread * 0.85 - 0.02;
  const flag = plant.exposure * 0.12;
  const up = new THREE.Vector3(-gx * 0.75 - PREVAILING.x * flag, 1, -gz * 0.75 - PREVAILING.z * flag).normalize();
  const yaw = random() * Math.PI * 2;
  const rotation = new THREE.Euler().setFromQuaternion(
    new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), up).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw)),
  );
  const age = plant.age ?? 0.5;
  const dry = smoothstep(0.55, 0.9, age) * 0.35 + (random() < 0.07 ? 0.5 : 0);
  const [h, s, l] = sp.hsl;
  // A slope is a mosaic at tens of metres, the thing the eye reads from
  // afar: damp hollows and seeps deeper and greener, dry rises and ridges
  // greyer and paler; and within it plant by plant a wider spread of value,
  // a few silver-green (helichrysum, a silvered renosterbos) among them,
  // still green enough not to read as a boulder.
  const moist = smoothstep(0.25, 0.75, noise2(plant.x * 0.045 + 7, plant.z * 0.05 - 3)) * 2 - 1;
  const silver = random() < 0.04 ? 1 : 0;
  const color = hslColour(
    // (Dry goes to straw and ochre, never to salmon or stone: hue held at
    // 0.13.)
    Math.max(0.13, h + (random() - 0.5) * 0.04 - dry * 0.07 + moist * 0.018 - silver * 0.03),
    (s * (0.8 + random() * 0.4) + dry * 0.08 + moist * 0.035) * (1 - silver * 0.35),
    l * (0.78 + random() * 0.44) + dry * 0.05 - moist * 0.03 + silver * 0.05,
  );
  const squash = 0.85 + random() * 0.3;
  // (forest.js coverFor paints the ground at its foot in this colour.)
  plant.tint = color;
  masses.push({
    position: new THREE.Vector3(plant.x, seat, plant.z),
    scale: new THREE.Vector3(spread * squash, height, spread / squash),
    rotation,
    color,
    ground: seat,
    bend: new THREE.Vector3(0, 1, 0),
    materialClass: dry > 0.4 ? "thatch" : "live",
  });
  if (!sp.flowers || random() > sp.bloom) return;
  const tint = sp.flowers[Math.floor(random() * sp.flowers.length)];
  const count = 3 + Math.floor(random() * 6);
  for (let i = 0; i < count; i++) {
    const a = random() * Math.PI * 2;
    const r = Math.sqrt(random()) * 0.8;
    const at = new THREE.Vector3(Math.cos(a) * r * spread, height * Math.sqrt(1 - r * r) * 0.98, Math.sin(a) * r * spread)
      .applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), up))
      .add(new THREE.Vector3(plant.x, seat, plant.z));
    head(flowers.bell, at, 0.018 + random() * 0.012, new THREE.Vector3((random() - 0.5) * 0.6, -1, (random() - 0.5) * 0.6), random() * 6.28,
      hslColour(tint[0] + (random() - 0.5) * 0.02, tint[1], tint[2] + (random() - 0.5) * 0.08));
  }
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
    age = .5,
    site = { light: 1, lightX: 0, lightZ: 0 },
    random,
    wood,
    clusters,
  } = options;
  const pointCount = Math.round((detail ? 150 : 95) * arche.points);
  // Lowest a branch may run above the soil beneath it.
  // Low enough that crowns reach down toward the ground, not lollipops on stilts.
  const clearance = Math.max(0.12, crownR * 0.08);
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
      a[0] += site.lightX * .65 + PREVAILING.x * flag * 0.3 + (random() - 0.5) * 0.35;
      a[2] += site.lightZ * .65 + PREVAILING.z * flag * 0.3 + (random() - 0.5) * 0.35;
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
  // Light-starved old lower shoots self-prune; retained dead twigs carry
  // no foliage demand. Demand is summed once from terminal leaf budgets.
  const hasChild = childCount.map(count => count > 0);
  const terminal = parent.map((_, n) => {
    if (hasChild[n] || snag) return 0;
    const lower = (ny[n] - crownCenter.y) / Math.max(.1, crownR * arche.flatten);
    const light = site.light * (.65 + Math.max(0, lower) * .35);
    return age > .45 && lower < -.25 && light < .5 ? 0 : .65 + light * .7;
  });
  const tips = foliageDemand(parent, terminal);
  const referenceDemand = Math.max(1, ...seeds.map((_, n) => tips[n]));
  const radiusFor = demand => demandRadius(demand, baseRadius, referenceDemand);
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
    if (tips[n] === 0) wood[wood.length - 1].materialClass = "dead";
    if (snag || tips[n] === 0 || tips[n] > 2.7) continue;
    // Terminal and near-terminal shoots carry leaf clusters in a golden-angle
    // spiral, sized to the plant's own crown. Each cluster is darkened by its
    // depth into the canopy — ambient occlusion baked at placement, since the
    // generator knows where the crown surface is.
    const direction = end.clone().sub(start).normalize();
    const phase = random() * Math.PI * 2;
    const count = (detail ? 3 : 2) + (hasChild[n] ? 0 : detail ? 3 : 2);
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
      // Deep in the crown a shoot is hidden by the ones round it from any
      // distance but underneath: forest.js draws it only near the eye.
      if (depth < 0.55) clusters[clusters.length - 1].inner = true;
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
  // Stiff grey-green leaves; heads in the dusty, muted colours real bracts
  // have in sun (old rose, blush, cream), never a saturated pink.
  const leafColour = hslColour(0.2 + random() * 0.05, 0.15, 0.24 + random() * 0.05);
  const bark = hslColour(0.06, 0.25, 0.2);
  const heart = root.clone().add(new THREE.Vector3(0, height * 0.5, 0));
  const headColour = pincushion
    ? hslColour(0.06 + random() * 0.05, 0.5, 0.52)
    : [
        hslColour(0.96 + random() * 0.03, 0.32, 0.6),
        hslColour(0.98, 0.26, 0.7),
        hslColour(0.11, 0.24, 0.8),
        hslColour(0.95, 0.24, 0.52),
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
    if (random() < 0.45) {
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
      succulents[succulents.length - 1].materialClass = "dead";
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
  const flame = hslColour(0.03 + random() * 0.06, 0.55, 0.5);
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
    hslColour(0.9, 0.32, 0.62),
    hslColour(0.87, 0.28, 0.5),
    hslColour(0.96, 0.3, 0.6),
    hslColour(0.1, 0.12, 0.86),
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
// Muted as they look in sun at a few metres: soft yellow, cream, white,
// mauve and a dusty apricot, not the saturated pinks and oranges of a
// seed packet.
const DAISY_COLOURS = [
  [0.13, 0.5, 0.62],
  [0.12, 0.3, 0.8],
  [0.1, 0.06, 0.88],
  [0.86, 0.28, 0.64],
  [0.07, 0.4, 0.6],
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
function growTurf(seed, layout, turf, masses = []) {
  const random = seededRandom(seed ^ 0x2545f491);
  // Grass grows between the shrubs, not under them.
  const shrubs = new Map();
  for (const m of masses) {
    const key = `${Math.floor(m.position.x / 2)},${Math.floor(m.position.z / 2)}`;
    if (!shrubs.has(key)) shrubs.set(key, []);
    shrubs.get(key).push(m);
  }
  const underShrub = (x, z) => {
    const cx = Math.floor(x / 2), cz = Math.floor(z / 2);
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++)
        for (const m of shrubs.get(`${cx + dx},${cz + dz}`) ?? [])
          if ((x - m.position.x) ** 2 + (z - m.position.z) ** 2 < (Math.max(m.scale.x, m.scale.z) * 0.8) ** 2) return true;
    return false;
  };
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
    if (random() >= shoreClear(x, z, inland, 4.5, 6.5)) continue;
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
    if (underShrub(x, z)) continue;
    const y = terrainHeight(x, z);
    const dune = 1 - smoothstep(3, 10, inland);
    // Sward colour drifts over metres (a damp hollow greener, a dry rise
    // olive), not tuft by tuft: neighbouring tufts agree, so the ground
    // reads as one sward instead of a speckle of green and straw.
    const sward = noise2(x * 0.15 + patch, z * 0.15 - patch);
    const colour = hslColour(
      0.19 + sward * 0.07 + random() * 0.015 - dune * 0.07,
      0.3 + sward * 0.06 - dune * 0.12,
      0.16 + random() * 0.03 + (1 - sward) * 0.03 + dune * 0.08,
    );
    const size = (0.28 + random() * 0.3) * (1 - dune * 0.2);
    turf.push({
      id: `${seed}:turf:${i}`, materialClass: dune > 0.5 ? "thatch" : "live",
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

