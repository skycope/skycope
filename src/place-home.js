import * as THREE from "three";
import { groundHeight, shoreDistance, islandPoint, ISLAND } from "./terrain.js";
import { cylinder } from "./blockers.js";
import { part, merge, sweep, place, srgb, staticMesh, prop } from "./place-kit.js";
import { haloMesh } from "./place-shore.js";
import { lampCatch } from "./waking.js";

// The home lantern (story-and-wow.md shot 1): a storm lantern hung from a
// driftwood post on the home beach, cold until the fallen star and the cat
// light it together. It is the first light, the lesson: from then on it
// is a warm point on the beach, the way home, seen from the hilltop. Built
// through the prop contract (place-kit.js prop()); about 300 triangles,
// two draws (wood and tin, the globe) and a halo by night.
//
//   homeLanternSite(obstacles) → { x, z, ground, facing } in coast metres
//   buildHomeLantern(site) → prop() plus { lamp: { x, y, z }, update(...) }

// Where the cat starts (walker.js home()), and the way it faces.
const HOME_THETA = Math.atan2(0 - ISLAND.z, 6 - ISLAND.x);
export const HOME_START = (() => {
  const p = islandPoint(HOME_THETA, 3.2);
  return { x: p.x, z: p.z, heading: HOME_THETA + Math.PI / 2 + 0.35 };
})();
// How far from the start it stands, and how high the lamp hangs.
export const HOME_LANTERN = { distance: 8, post: 1.15, lamp: 0.82, colour: [1.0, 0.6, 0.24], reach: 2.6, power: 0.6 };

const DRIFTWOOD = srgb("#80786c");
const TIN = srgb("#26241f");
const GLASS = srgb("#3a3d36");

// A clear, level patch of sand 8 m from the cat's start, ahead of it (so
// the first view looks over it), on the beach above the swash, clear of
// rock and trunk. Pure: obstacles is walker.js's { trunks, domes }.
export function homeLanternSite(obstacles = { trunks: [], domes: [] }, { ground = groundHeight, start = HOME_START } = {}) {
  const turns = [0.18, -0.12, 0.42, -0.36, 0.7, -0.62, 1.0, -0.9];
  const clear = (x, z) => {
    for (const d of obstacles.domes ?? []) if (Math.hypot(x - d.x, z - d.z) < (d.r ?? 1) + 1.1) return false;
    for (const t of obstacles.trunks ?? []) if (Math.hypot(x - t.x, z - t.z) < (t.r ?? 0.2) + 0.9) return false;
    return true;
  };
  const level = (x, z) => {
    const h = ground(x, z);
    return Math.max(...[[0.6, 0], [-0.6, 0], [0, 0.6], [0, -0.6]].map(([dx, dz]) => Math.abs(ground(x + dx, z + dz) - h))) < 0.22;
  };
  for (const pass of [0, 1])
    for (const turn of turns) {
      const a = start.heading + turn;
      const x = start.x + Math.sin(a) * HOME_LANTERN.distance;
      const z = start.z + Math.cos(a) * HOME_LANTERN.distance;
      const inland = shoreDistance(x, z);
      if (inland < 2.2 || inland > 14) continue;
      if (!clear(x, z)) continue;
      if (pass === 0 && !level(x, z)) continue;
      return { x, z, ground: ground(x, z), facing: a };
    }
  // (Never expected: every candidate fouled.) Straight ahead, a little inland.
  const p = islandPoint(HOME_THETA + 0.1, 4);
  return { x: p.x, z: p.z, ground: ground(p.x, p.z), facing: start.heading };
}

// Where the star lands: a few metres beyond the lantern, seen past it from
// the start (the lantern stands between the cat and the fallen star).
export function homeLandingPoint(site, start = HOME_START) {
  const a = Math.atan2(site.x - start.x, site.z - start.z) + 0.28;
  for (const r of [3.2, 2.6, 2]) {
    const x = site.x + Math.sin(a) * r;
    const z = site.z + Math.cos(a) * r;
    if (shoreDistance(x, z) > 0.8) return { x, z };
  }
  return { x: site.x + 1.5, z: site.z };
}

// The prop. Local frame: the post at the site; y absolute (coast metres).
export function buildHomeLantern(site, { light = false } = {}) {
  const wood = [];
  const tin = [];
  const g = site.ground;
  const lean = 0.06;
  const base = new THREE.Vector3(0, g - 0.3, 0);
  const top = new THREE.Vector3(lean * 0.6, g + HOME_LANTERN.post, lean * 0.3);
  wood.push(part(sweep([base, top.clone().lerp(base, 0.5).add(new THREE.Vector3(0.02, 0, -0.01)), top], [0.075, 0.064, 0.05], 6), { colour: DRIFTWOOD }));
  // The arm, toward the sea side, and the lantern hung from it.
  const out = Math.atan2(ISLAND.x - site.x, ISLAND.z - site.z) + Math.PI;
  const ax = Math.sin(out) * 0.3, az = Math.cos(out) * 0.3;
  const arm = new THREE.Vector3(top.x + ax, top.y - 0.05, top.z + az);
  wood.push(part(sweep([top.clone().add(new THREE.Vector3(0, -0.09, 0)), arm], [0.03, 0.024], 4), { colour: DRIFTWOOD }));
  const lamp = new THREE.Vector3(arm.x, g + HOME_LANTERN.lamp, arm.z);
  // The tin: a vented cap, the font below, four guard wires, the bail.
  tin.push(part(new THREE.CylinderGeometry(0.035, 0.1, 0.08, 8), { matrix: place(lamp.x, lamp.y + 0.15, lamp.z), colour: TIN }));
  tin.push(part(new THREE.CylinderGeometry(0.105, 0.1, 0.06, 8), { matrix: place(lamp.x, lamp.y - 0.13, lamp.z), colour: TIN }));
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + 0.4;
    tin.push(part(new THREE.CylinderGeometry(0.005, 0.005, 0.27, 3, 1, true), { matrix: place(lamp.x + Math.cos(a) * 0.108, lamp.y, lamp.z + Math.sin(a) * 0.108), colour: TIN }));
  }
  tin.push(part(new THREE.TorusGeometry(0.06, 0.006, 3, 8), { matrix: place(lamp.x, lamp.y + 0.24, lamp.z, { pitch: Math.PI / 2 }), colour: TIN }));
  // The chain from the arm to the bail.
  tin.push(part(new THREE.CylinderGeometry(0.004, 0.004, arm.y - lamp.y - 0.26, 3, 1, true), { matrix: place(lamp.x, (arm.y + lamp.y + 0.26) / 2, lamp.z), colour: TIN }));
  const frame = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
  // The globe: salt-hazed glass, cold; lit, the flame behind it warms it
  // from inside (emissive), a small live thing by day and a lamp by night.
  const globeMaterial = new THREE.MeshStandardMaterial({ color: GLASS, roughness: 0.25, metalness: 0, emissive: new THREE.Color(...HOME_LANTERN.colour), emissiveIntensity: 0 });
  const globe = new THREE.Mesh(new THREE.SphereGeometry(0.095, 10, 7), globeMaterial);
  globe.position.copy(lamp);
  globe.scale.set(1, 1.25, 1);
  globe.castShadow = false;
  globe.matrixAutoUpdate = false;
  globe.updateMatrix();
  const near = new THREE.Group();
  near.add(staticMesh(merge([...wood, ...tin]), frame, { cast: !light }), globe);
  const world = { x: site.x + lamp.x, y: lamp.y, z: site.z + lamp.z };
  const halos = haloMesh([{ x: world.x, y: world.y, z: world.z, size: 1.3, colour: HOME_LANTERN.colour }]);
  return {
    ...prop({
      lod: { near, cullDistance: 160 },
      surfaces: {
        trunks: [{ x: site.x, z: site.z, r: 0.09 }],
        solids: [cylinder(site.x, site.z, 0.09, g - 0.3, g + HOME_LANTERN.post, { body: false })],
      },
      lights: [{ kind: "lantern", ...world, size: 1.3, colour: HOME_LANTERN.colour, reach: HOME_LANTERN.reach, power: HOME_LANTERN.power, flicker: true }],
      affordances: [{ id: "home-lantern", kind: "sit-near", ...world, y: g, r: 2, hint: "a cold lantern on a driftwood post" }],
    }),
    extra: halos.mesh,
    lamp: world,
    // lit: magic.levels.home (0…1); since: seconds since it was lit (its
    // wick catches), or Infinity; night 0…1.
    update({ time = 0, lit = 0, since = Infinity, night = 0 }) {
      const caught = lit > 0 ? lampCatch(since) * Math.min(1, lit * 1.4) : 0;
      const flicker = 1 + 0.05 * Math.sin(time * 13.1) + 0.03 * Math.sin(time * 29.7);
      globeMaterial.emissiveIntensity = caught * flicker * (0.55 + 1.6 * night);
      halos.update(time, caught * smooth(0.05, 0.5, night));
      return caught;
    },
    dispose() {
      near.traverse((o) => o.geometry?.dispose());
      frame.dispose();
      globeMaterial.dispose();
      halos.dispose();
    },
  };
}

function smooth(a, b, x) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
