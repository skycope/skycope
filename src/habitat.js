import { noise2, terrainHeight, shoreDistance, smoothstep } from './terrain.js';

// One regional descriptor per 8m cell; crown queries use the same bounded
// neighbourhood rather than scanning every plant for every growth bud.
export function createHabitat(seed, layout = []) {
  const habitat = { seed, regions: new Map(), crowns: new Map(), producers: groundProducers(layout) };
  for (const plant of layout) {
    if (plant.kind !== 'tree' || plant.form === 'snag') continue;
    const crown = { x: plant.x, z: plant.z, y: terrainHeight(plant.x, plant.z) + plant.height * .72,
      r: Math.min(7.5, plant.height * .48), id: plant.id };
    const key = cellKey(plant.x, plant.z);
    if (!habitat.crowns.has(key)) habitat.crowns.set(key, []);
    habitat.crowns.get(key).push(crown);
  }
  return habitat;
}

export function sampleHabitat(habitat, x, z) {
  const key = cellKey(x, z);
  let region = habitat.regions.get(key);
  if (!region) {
    const cx = Math.floor(x / 8), cz = Math.floor(z / 8);
    const rx = (cx + .5) * 8, rz = (cz + .5) * 8;
    const inland = shoreDistance(rx, rz);
    const slopeX = (terrainHeight(rx + 1, rz) - terrainHeight(rx - 1, rz)) * .5;
    const slopeZ = (terrainHeight(rx, rz + 1) - terrainHeight(rx, rz - 1)) * .5;
    const slope = Math.hypot(slopeX, slopeZ);
    const phase = habitat.seed * .013;
    const moisture = noise2(rx * .045 + phase, rz * .045 - phase);
    const age = noise2(rx * .031 - phase, rz * .037 + phase);
    const exposure = 1 - smoothstep(3, 22, inland);
    const patch = noise2(rx * .07 + phase, rz * .055);
    const community = exposure > .65 ? 'dune' : moisture > .57 && slope < .7 ? 'thicket' : patch > .48 ? 'heath' : 'opening';
    region = { id: `${habitat.seed}:${key}`, age, moisture, slope, slopeX, slopeZ, exposure, community, patch,
      litter: community === 'thicket' ? .7 : .2, thatch: community === 'heath' ? .65 : .2 };
    habitat.regions.set(key, region);
  }
  let competition = 0, lightX = 0, lightZ = 0;
  const cx = Math.floor(x / 8), cz = Math.floor(z / 8);
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++)
    for (const crown of habitat.crowns.get(`${cx + dx},${cz + dz}`) ?? []) {
      const vx = x - crown.x, vz = z - crown.z;
      const d2 = vx * vx + vz * vz;
      const density = Math.exp(-d2 / Math.max(1, crown.r * crown.r)) * .55;
      competition += density;
      lightX += vx * density / Math.max(1, Math.sqrt(d2));
      lightZ += vz * density / Math.max(1, Math.sqrt(d2));
    }
  return { ...region, competition: Math.min(1, competition), light: Math.exp(-competition), lightX, lightZ };
}

export function groundProducers(layout) {
  return layout.filter(p => p.kind === 'tree' || p.kind === 'shrub' || p.kind === 'restio').map(p => ({
    id: p.id ?? p.seed, kind: p.kind, materialClass: p.kind === 'restio' ? 'thatch' : 'litter', seed: p.seed, x: p.x, z: p.z, radius: Math.min(7.5, p.height * .48), height: p.height,
    litter: p.kind === 'tree' ? .65 + (p.age ?? .5) * .3 : .25,
    roots: p.kind === 'tree' ? p.height * .12 : 0,
    thatch: p.kind === 'restio' ? .9 : .15,
  }));
}

function cellKey(x, z) { return `${Math.floor(x / 8)},${Math.floor(z / 8)}`; }
