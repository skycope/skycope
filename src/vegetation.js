import * as THREE from "three";
import { terrainHeight, shoreline, noise2 } from "./terrain.js";
import { seededRandom } from "./random.js";

export function createVegetation(seed) {
  const random = seededRandom(seed);
  const wood = [];
  const leaves = [];
  const layout = vegetationLayout(seed);
  const ecotypes = growthTraits(seed);
  for (const plant of layout) {
    const root = new THREE.Vector3(
      plant.x,
      terrainHeight(plant.x, plant.z),
      plant.z,
    );
    const detail =
      plant.kind === "tree" && Math.hypot(plant.x - 6, plant.z) < 75;
    if (plant.kind === "fern")
      growFern(root, plant.height, random, wood, leaves);
    else if (plant.kind === "grass")
      growGrass(root, plant.height, random, leaves);
    else
      growTree(
        root,
        plant.height,
        ecotypes[plant.ecotype],
        detail,
        random,
        wood,
        leaves,
      );
  }
  return { wood, leaves, plants: layout.length };
}

// Random groves and clearings replace rows. Taller trees favour the sheltered interior;
// exposed edges carry low, spreading plants. A coarse occupancy map prevents collisions.
export function vegetationLayout(seed) {
  const random = seededRandom(seed);
  const plants = [];
  const occupied = new Map();
  const patch = random() * 1000;
  const ecotypes = growthTraits(seed);
  for (let i = 0; i < 1300; i++) {
    const z = 7 + random() * 205;
    const inland = 5 + random() * 58;
    const x = shoreline(z) + inland;
    const shelter = noise2(x * 0.085 + patch, z * 0.06 + patch);
    if (random() > 0.22 + shelter * 0.75) continue;
    // A spatial habitat field selects related traits across a grove, not per-row models.
    const ecotype = Math.min(
      ecotypes.length - 1,
      Math.floor(noise2(x * 0.06 + patch, z * 0.04 - patch) * ecotypes.length),
    );
    const traits = ecotypes[ecotype];
    const exposure = Math.min(1, inland / 18);
    const height =
      traits.height * (0.6 + random() * 0.6) * (0.6 + exposure * 0.4);
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
    const plant = { kind: "tree", ecotype, x, z, height };
    plants.push(plant);
    const key = `${cellX},${cellZ}`;
    if (!occupied.has(key)) occupied.set(key, []);
    occupied.get(key).push(plant);
  }
  // Lower layers occur in patches, leaving some visible soil and paths between them.
  for (let i = 0; i < 1500; i++) {
    const z = 4 + random() * 155;
    const inland = 3.5 + random() * 30;
    const x = shoreline(z) + inland;
    if (noise2(x * 0.2 + patch, z * 0.16) < 0.32) continue;
    const choice = random();
    const kind =
      choice < 0.32 && inland > 6 ? "fern" : choice < 0.6 ? "shrub" : "grass";
    const height =
      kind === "shrub" ? 0.7 + random() * 1.6 : 0.25 + random() * 0.85;
    plants.push({
      kind,
      ecotype: Math.floor(random() * ecotypes.length),
      x,
      z,
      height,
    });
  }
  return plants;
}

// Seed-derived communities occupy a continuous trait space. These ranges constrain
// growth, rather than selecting authored species meshes or fixed species recipes.
function growthTraits(seed) {
  const random = seededRandom(seed ^ 0x6a09e667);
  return Array.from({ length: 8 }, () => {
    const slender = random();
    const waxy = random();
    return {
      height: 3.5 + slender * 5.5 + random() * 2,
      spread: 0.6 - slender * 0.3,
      lift: 0.25 + slender * 0.6,
      forks: 4 + Math.floor(random() * 5),
      leaf: [0.17 + (1 - slender) * 0.32, 0.16 + random() * 0.18],
      hue: 0.22 + random() * 0.1,
      light: 0.16 + (1 - waxy) * 0.12,
      bark: new THREE.Color().setHSL(
        0.09 + random() * 0.06,
        0.08 + random() * 0.18,
        0.25 + random() * 0.17,
      ),
    };
  });
}

function growTree(root, height, traits, detail, random, wood, leaves) {
  const bark = new THREE.Color(traits.bark).multiplyScalar(
    0.8 + random() * 0.4,
  );
  const color = new THREE.Color().setHSL(
    traits.hue + (random() - 0.5) * 0.035,
    0.24 + random() * 0.18,
    traits.light + random() * 0.05,
  );
  const lean = new THREE.Vector3(
    (random() - 0.25) * height * 0.23,
    height,
    (random() - 0.5) * height * 0.2,
  );
  const spine = [root];
  for (let i = 1; i <= 3; i++) {
    const point = root.clone().addScaledVector(lean, i / 3);
    point.x += Math.sin(i * 1.7 + height) * height * 0.045;
    point.z += Math.sin(i * 2.3 + height) * height * 0.04;
    branch(wood, spine[i - 1], point, height * 0.034 * (1 - i * 0.22), bark);
    spine.push(point);
  }
  const forks =
    Math.ceil(traits.forks * (detail ? 1 : 0.65)) + Math.floor(random() * 3);
  const phase = random() * Math.PI * 2;
  for (let i = 0; i < forks; i++) {
    const fraction = 0.24 + random() * 0.66;
    const segment = Math.min(2, Math.floor(fraction * 3));
    const start = spine[segment]
      .clone()
      .lerp(spine[segment + 1], fraction * 3 - segment);
    const angle = phase + i * 2.39996 + (random() - 0.5) * 1.3;
    const reach =
      height *
      traits.spread *
      (1.1 - fraction * 0.55) *
      (0.65 + random() * 0.6);
    const direction = new THREE.Vector3(
      Math.cos(angle),
      traits.lift + random() * 0.35,
      Math.sin(angle),
    ).normalize();
    growLimb(
      start,
      direction,
      reach,
      height * 0.014,
      detail ? 2 : 1,
      traits,
      color,
      bark,
      random,
      wood,
      leaves,
    );
  }
}

function growLimb(
  start,
  direction,
  length,
  radius,
  depth,
  traits,
  color,
  bark,
  random,
  wood,
  leaves,
) {
  const bend = direction
    .clone()
    .add(
      new THREE.Vector3((random() - 0.5) * 0.45, 0.15, (random() - 0.5) * 0.45),
    )
    .normalize();
  const elbow = start.clone().addScaledVector(direction, length * 0.55);
  const end = elbow.clone().addScaledVector(bend, length * 0.45);
  branch(wood, start, elbow, radius, bark);
  branch(wood, elbow, end, radius * 0.65, bark);
  if (depth > 0) {
    for (let i = 0; i < 3; i++) {
      const child = bend
        .clone()
        .applyAxisAngle(
          new THREE.Vector3(0, 1, 0),
          (i - 1) * (0.6 + random() * 0.65),
        );
      child.y = 0.1 + random() * 0.7;
      growLimb(
        elbow.clone().lerp(end, 0.35 + random() * 0.65),
        child.normalize(),
        length * (0.48 + random() * 0.2),
        radius * 0.45,
        depth - 1,
        traits,
        color,
        bark,
        random,
        wood,
        leaves,
      );
    }
  } else {
    // Paired leaves attach along the final shoot; no detached crown particles.
    for (let i = 0; i < 12; i++) {
      const attachment = elbow.clone().lerp(end, i / 11);
      const azimuth =
        Math.atan2(bend.x, bend.z) + (i % 2 ? 1 : -1) * (0.65 + random() * 0.6);
      const size = Math.min(1, length * 2.5) * (0.75 + random() * 0.5);
      leaf(
        leaves,
        attachment,
        traits.leaf[0] * size,
        traits.leaf[1] * size,
        new THREE.Euler(0.4 + random() * 1.4, azimuth, (random() - 0.5) * 1.2),
        color,
        random,
      );
    }
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

function growGrass(root, height, random, leaves) {
  const color = new THREE.Color().setHSL(
    0.18 + random() * 0.09,
    0.3,
    0.2 + random() * 0.12,
  );
  for (let i = 0; i < 7; i++) {
    leaf(
      leaves,
      root,
      0.025 + random() * 0.035,
      height * (0.3 + random() * 0.35),
      new THREE.Euler(
        (random() - 0.5) * 1.5,
        random() * 6.28,
        (random() - 0.5) * 1.5,
      ),
      color,
      random,
    );
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
