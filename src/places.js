import * as THREE from "three";
import { placesLayout, placeClearance } from "./place-layout.js";
import { createMaterials, glowMaterial, smooth01 } from "./place-kit.js";
import { buildLighthouse } from "./place-lighthouse.js";
import { buildWreck } from "./place-wreck.js";
import { buildMilkwood } from "./place-milkwood.js";
import { buildBoat, buildBeacon, buildPool, haloMesh } from "./place-shore.js";
import { markSolid, SOLID_ORDER } from "./cat-coat.js";

// Places worth walking to: a handful of real Cape-coast landmarks, placed
// by the seed round the island so each can be seen from another and pulls
// the cat on (place-layout.js). Every one is procedural geometry merged into
// a few meshes per material, with a cheap far level. By night the lamp
// turns on the point and a lantern burns by the boat: warm lights in the
// blue night are the strongest "come here" the island has.
//
//   createPlaces(group, seed, { light, shared }) → {
//     pois: [{ id, title, x, z, r }],
//     obstacles: { trunks, domes },   // walker.js formats
//     blockers: [...],                // camera/body solids (blockers.js)
//     update({ time, night, wind, eye, pose }), dispose() }

export { placesLayout, placeClearance };

export const BUILDERS = { lighthouse: buildLighthouse, wreck: buildWreck, milkwood: buildMilkwood, boat: buildBoat, beacon: buildBeacon, pool: buildPool };

export function createPlaces(group, seed, { light = false, shared } = {}) {
  const layout = placesLayout(seed);
  const root = new THREE.Group();
  root.name = "places";
  root.matrixAutoUpdate = false;
  group.add(root);
  const materials = createMaterials(shared);
  const obstacles = { trunks: [], domes: [] };
  const blockers = [];
  const built = [];
  for (const p of layout) {
    const build = BUILDERS[p.kind];
    if (!build) continue;
    // Every builder returns the prop contract (place-kit.js prop()).
    const b = build(p, materials, { light, seed });
    const lod = new THREE.LOD();
    lod.position.set(p.x, 0, p.z);
    lod.addLevel(b.lod.near, 0);
    if (b.lod.far) lod.addLevel(b.lod.far, b.lod.farDistance, 0.1);
    // Small places are a few pixels across the island: gone past cullDistance.
    if (b.lod.cullDistance) lod.addLevel(new THREE.Object3D(), b.lod.cullDistance, 0.1);
    lod.updateMatrix();
    lod.matrixAutoUpdate = false;
    root.add(lod);
    for (const child of [b.lod.near, b.lod.far]) child?.traverse((o) => { o.matrixAutoUpdate = false; o.updateMatrix(); });
    if (b.extra) root.add(b.extra);
    obstacles.trunks.push(...b.surfaces.trunks);
    obstacles.domes.push(...b.surfaces.tiles);
    blockers.push(...b.surfaces.solids);
    built.push({ place: p, ...b });
  }

  // solid: walls, timbers, iron and bark hide the cat outright: no
  // see-through silhouette through them (cat-coat.js markSolid).
  const solids = new Set([materials.limewash, materials.rubble, materials.timber, materials.iron, materials.rust, materials.bark]);
  for (const m of solids) markSolid(m);
  root.traverse((o) => { if (o.isMesh && solids.has(o.material)) o.renderOrder = SOLID_ORDER; });

  const allLights = built.flatMap((b) => b.lights);
  const lampLight = allLights.find((l) => l.kind === "lamp");
  const beam = lampLight ? lampLights(lampLight) : null;
  if (beam) root.add(beam.group);
  // land-magic: the island's other lamps (coast metres), which light the
  // land round them once the lighthouse's gift wakes (land-magic.js slot 3).
  const lamps = allLights.filter((l) => l.kind !== "lamp").map((h) => ({ x: h.x, y: h.y, z: h.z, colour: h.colour, reach: h.reach ?? 3.2, power: h.power ?? 0.8 }));
  const haloList = allLights.filter((l) => l.kind === "lantern");
  const halos = haloList.length ? haloMesh(haloList) : null;
  if (halos) root.add(halos.mesh);
  paintGround(group, layout);
  const eyeWorld = new THREE.Vector3();
  const crownOf = built.find((b) => b.crown);

  return {
    group: root,
    layout,
    pois: layout.map(({ id, title, x, z, r }) => ({ id, title, x, z, r })),
    obstacles,
    blockers,
    // The prop contracts' data, for the systems that will read it:
    // covers for precipitation.js, affordances for affordances.js.
    covers: built.flatMap((b) => b.covers.map((c) => ({ place: b.place.id, ...c }))),
    affordances: built.flatMap((b) => b.affordances.map((a) => ({ place: b.place.id, ...a }))),
    // boat: the fisherman's boat's hull ({ launch() }, place-shore.js).
    boatHull: built.find((b) => b.hull)?.hull ?? null,
    // land-magic: the lighthouse lamp (coast metres) and the island's lamps.
    beacon: lampLight ? { x: lampLight.x, y: lampLight.y, z: lampLight.z, radius: lampLight.radius } : null,
    lamps,
    // land-magic: the old milkwood's crown (coast x, z; radius; top y), the
    // fireflies' home.
    crown: crownOf ? { x: crownOf.place.x, z: crownOf.place.z, radius: crownOf.crown.radius, top: crownOf.crown.top, ground: crownOf.crown.ground ?? crownOf.crown.top - 10 } : null,
    // land-magic: `lamp` is land-magic.js's lamp state ({ lit, angle,
    // strength }) and `lights` the other lamps' level: everything here is
    // dark until the lighthouse's gift wakes (without them, it stays dark).
    update({ time = 0, night = 0, wind = [0, 0], eye = null, pose = null, lamp = null, lights = 0 } = {}) {
      // Glow is a night thing: panes, lanterns and the beam are dark by
      // day (a lamp lit at noon reads as a glowing prop), coming up through
      // dusk.
      const dark = smooth01(0.05, 0.5, night);
      const lit = lights * dark;
      materials.lights.value = lit;
      if (eye) eyeWorld.set(eye[0], eye[1], -eye[2]);
      beam?.update(lamp, night, eyeWorld, dark);
      halos?.update(time, lit);
      for (const b of built) b.update?.({ time, night, wind, eye, pose, lit });
    },
    dispose() {
      root.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
      });
      for (const m of Object.values(materials)) if (m?.isMaterial) m.dispose();
      beam?.dispose();
      halos?.dispose();
      group.remove(root);
    },
  };
}

// The lighthouse's light: two opposed beams sweeping round (a long quad
// each, turned about its own axis to face the eye, brightest near the lamp
// and fading out over the island and sea), and the flash when a beam
// swings across the viewer. World-space shaders, no fog: a light carries
// through the haze that greys everything it lights.
const BEAM_VERTEX = /* glsl */ `
attribute vec3 beam;
uniform vec3 lamp;
uniform float angle;
uniform float reach;
varying vec2 vBeam;
varying float vSide;
varying float vClear;
void main() {
  float a = angle + beam.z * 3.14159265;
  vec3 dir = normalize( vec3( cos( a ), -0.015, sin( a ) ) );
  vec3 axis = lamp + dir * ( 0.6 + beam.x * reach );
  vec3 toEye = cameraPosition - axis;
  vec3 side = cross( dir, normalize( toEye ) );
  float s = length( side );
  side /= max( s, 1e-4 );
  float width = 0.35 + beam.x * reach * 0.075;
  vBeam = beam.xy;
  // Seen end-on the sheet is edge-on to the eye: the flash takes over.
  vSide = smoothstep( 0.05, 0.35, s );
  vec3 world = axis + side * beam.y * width;
  // land-magic: the sheet thins out low over the land and close to the eye,
  // so where it would cut into sand, rock or hillside (a hard pale wedge)
  // it has already faded: soft edges, as the haze would give.
  vClear = smoothstep( 5.0, 11.0, world.y ) * smoothstep( 6.0, 24.0, length( axis - cameraPosition ) );
  gl_Position = projectionMatrix * viewMatrix * vec4( world, 1.0 );
}`;
const BEAM_FRAGMENT = /* glsl */ `
uniform vec3 glowColour;
uniform float strength;
varying vec2 vBeam;
varying float vSide;
varying float vClear;
void main() {
  float t = vBeam.x;
  float across = exp( -vBeam.y * vBeam.y * 4.0 ) * ( 1.0 - vBeam.y * vBeam.y );
  float along = pow( 1.0 - t, 1.8 ) * ( 0.35 + 0.65 * exp( -t * 7.0 ) );
  gl_FragColor = vec4( glowColour * strength * across * along * vSide * vClear, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
const FLASH_VERTEX = /* glsl */ `
uniform vec3 lamp;
uniform float size;
varying vec2 vUv2;
void main() {
  vUv2 = position.xy;
  vec3 toEye = normalize( cameraPosition - lamp );
  // Pulled toward the eye so the lantern glass never clips the glow.
  vec3 centre = lamp + toEye * 1.7;
  vec3 right = vec3( viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0] );
  vec3 up = vec3( viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1] );
  float d = length( cameraPosition - lamp );
  // Grows a little with distance, so a far flash still reads.
  float s = size * ( 0.6 + d * 0.012 );
  gl_Position = projectionMatrix * viewMatrix * vec4( centre + ( right * position.x + up * position.y ) * s, 1.0 );
}`;
const FLASH_FRAGMENT = /* glsl */ `
uniform vec3 glowColour;
uniform float strength;
uniform float flash;
varying vec2 vUv2;
void main() {
  float r2 = dot( vUv2, vUv2 );
  float core = exp( -r2 * 60.0 );
  float halo = exp( -r2 * 7.0 ) * 0.35;
  float streak = exp( -vUv2.y * vUv2.y * 600.0 ) * exp( -abs( vUv2.x ) * 3.5 ) * 0.5;
  float glow = strength * ( core * ( 0.6 + flash * 6.0 ) + ( halo + streak ) * ( 0.15 + flash * 2.5 ) );
  gl_FragColor = vec4( glowColour * glow, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function lampLights(lamp) {
  const group = new THREE.Group();
  // Three world space: the land group mirrors coast z.
  const lampWorld = new THREE.Vector3(lamp.x, lamp.y, -lamp.z);
  const uniforms = {
    lamp: { value: lampWorld },
    angle: { value: 0 },
    reach: { value: 95 },
    strength: { value: 0 },
  };
  const segments = 20;
  const attr = [];
  const index = [];
  for (let k = 0; k < 2; k++)
    for (let i = 0; i <= segments; i++) {
      const t = (i / segments) ** 1.6;
      attr.push(t, -1, k, t, 1, k);
      const b = k * (segments + 1) * 2 + i * 2;
      if (i < segments) index.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
    }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(attr.length), 3));
  geometry.setAttribute("beam", new THREE.Float32BufferAttribute(attr, 3));
  geometry.setIndex(index);
  const beamMaterial = glowMaterial({ colour: [1.0, 0.66, 0.3], vertex: BEAM_VERTEX, fragment: BEAM_FRAGMENT, uniforms });
  beamMaterial.side = THREE.DoubleSide;
  const beams = new THREE.Mesh(geometry, beamMaterial);
  beams.frustumCulled = false;
  beams.renderOrder = 10;
  const flashUniforms = { lamp: uniforms.lamp, size: { value: 2.6 }, strength: uniforms.strength, flash: { value: 0 } };
  const flashGeometry = new THREE.PlaneGeometry(2, 2);
  const flashMaterial = glowMaterial({ colour: [1.0, 0.88, 0.66], vertex: FLASH_VERTEX, fragment: FLASH_FRAGMENT, uniforms: flashUniforms });
  const flash = new THREE.Mesh(flashGeometry, flashMaterial);
  flash.frustumCulled = false;
  flash.renderOrder = 11;
  group.add(beams, flash);
  group.matrixAutoUpdate = false;
  group.visible = false;
  // One revolution in 12 s (land-magic.js): a flash every 6 s anywhere.
  const toEye = new THREE.Vector3();
  return {
    group,
    // land-magic: dark until the lamp's gift wakes; the angle comes from
    // land-magic.js so the light on the land and the visible beams agree.
    update(lamp, night, eye, dark = 1) {
      group.visible = !!lamp && lamp.lit * dark > 0.01;
      if (!group.visible) return;
      const a = lamp.angle;
      uniforms.angle.value = a;
      uniforms.strength.value = lamp.lit * dark * (0.1 + 0.26 * night);
      // Warm gold by day; deeper amber by night, where the tonemap's night
      // vision would otherwise grey it to blue-white.
      beamMaterial.uniforms.glowColour.value.setRGB(1.0, 0.8 - 0.1 * night, 0.55 - 0.22 * night);
      flashMaterial.uniforms.glowColour.value.setRGB(1.0, 0.86 - 0.08 * night, 0.62 - 0.2 * night);
      // The flash: a beam swinging across the eye (either of the pair).
      toEye.subVectors(eye, lampWorld).setY(0).normalize();
      const facing = Math.abs(Math.cos(a) * toEye.x + Math.sin(a) * toEye.z);
      flashUniforms.flash.value = Math.pow(facing, 60);
    },
    dispose() {
      geometry.dispose();
      beamMaterial.dispose();
      flashGeometry.dispose();
      flashMaterial.dispose();
    },
  };
}

// The ground round each landmark, painted into the ground mesh's own
// vertex data (forest.js addGround): trodden yards, wet sand round the
// wreck, leaf litter and deep shade under the milkwood, bare granite on
// the summit. Scrub and sour-fig paint is cleared where things stand.
function paintGround(group, layout) {
  let mesh = null;
  group.traverse((o) => { if (!mesh && o.isMesh && o.geometry?.attributes?.groundMask) mesh = o; });
  if (!mesh) return;
  const g = mesh.geometry;
  const position = g.attributes.position;
  const colour = g.attributes.color;
  const shade = g.attributes.canopyShade;
  const mask = g.attributes.groundMask;
  const mask2 = g.attributes.groundMask2;
  if (!position || !colour || !shade || !mask) return;
  const c = new THREE.Color();
  const target = new THREE.Color();
  const stains = layout.flatMap(stainsFor);
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const z = position.getZ(i);
    for (const s of stains) {
      const dx = x - s.x, dz = z - s.z;
      if (Math.abs(dx) > s.r || Math.abs(dz) > s.r) continue;
      const d = Math.hypot(dx, dz);
      if (d >= s.r) continue;
      const w = 1 - smooth01(s.r * (s.soft ?? 0.5), s.r, d);
      if (s.colour) {
        c.fromBufferAttribute(colour, i);
        target.set(s.colour);
        c.lerp(target, w * (s.amount ?? 1));
        colour.setXYZ(i, c.r, c.g, c.b);
      }
      if (s.shade) shade.setX(i, Math.max(shade.getX(i), s.shade * w));
      if (s.grass !== undefined) mask.setW(i, mask.getW(i) * (1 - w) + s.grass * w);
      if (s.litter !== undefined) mask.setZ(i, mask.getZ(i) * (1 - w) + s.litter * w);
      if (s.rocky !== undefined) mask.setY(i, mask.getY(i) * (1 - w) + s.rocky * w);
      if (mask2 && s.scrub !== undefined) {
        mask2.setX(i, mask2.getX(i) * (1 - w) + s.scrub * w);
        mask2.setY(i, mask2.getY(i) * (1 - w) + s.scrub * w);
      }
    }
  }
  for (const a of [colour, shade, mask, mask2]) if (a) a.needsUpdate = true;
}

function stainsFor(p) {
  if (p.kind === "lighthouse") {
    const fx = Math.sin(p.facing), fz = Math.cos(p.facing), rx = Math.cos(p.facing), rz = -Math.sin(p.facing);
    const side = p.side ?? 1;
    const at = (u, v) => ({ x: p.x + fx * u + rx * v, z: p.z + fz * u + rz * v });
    const yard = [];
    // A trodden yard of short turf along the contour from the tower to the
    // cottage, and a worn path from the tower's door to the cottage's.
    for (let v = 0; v <= 12; v += 2) yard.push({ ...at(-1, side * v), r: 5.5, scrub: 0, grass: 0.35, amount: 0 });
    for (let v = 3.2; v <= 5.6; v += 0.6) yard.push({ ...at(0.2, side * v), r: 0.9, soft: 0.4, colour: "#8e8676", amount: 0.45, grass: 0, scrub: 0 });
    // Contact shade at the apron's foot only.
    yard.push({ x: p.x, z: p.z, r: 3.3, soft: 0.8, shade: 0.22 });
    return yard;
  }
  if (p.kind === "beacon") {
    // The summit worn to bare granite round the cairn, a path trodden up.
    return [
      { x: p.x, z: p.z, r: 5, soft: 0.4, rocky: 0.85, grass: 0.15, scrub: 0, colour: "#7d756a", amount: 0.35 },
      { x: p.x, z: p.z, r: 2.2, soft: 0.5, shade: 0.3 },
    ];
  }
  if (p.kind === "boat") {
    // Sand trodden flat and darkened round the boat; deep shade beneath it.
    return [
      { x: p.x, z: p.z, r: 4.5, soft: 0.4, scrub: 0, grass: 0.1 },
      { x: p.x, z: p.z, r: 2.6, soft: 0.3, shade: 0.45, colour: "#8a7a5e", amount: 0.3 },
    ];
  }
  if (p.kind === "pool") {
    return [{ x: p.x, z: p.z, r: 4.2, soft: 0.6, scrub: 0, grass: 0, shade: 0.25 }];
  }
  if (p.kind === "milkwood") {
    // Deep shade and the tree's own leaf litter under the dome; a trodden
    // way in under the low side.
    return [
      { x: p.x, z: p.z, r: 12.5, soft: 0.55, colour: "#3b2f22", amount: 0.7, shade: 0.62, litter: 0.95, grass: 0.05, scrub: 0 },
      { x: p.x, z: p.z, r: 15, soft: 0.6, scrub: 0, grass: 0.3 },
      { x: p.x, z: p.z, r: 2.6, soft: 0.4, shade: 0.75 },
    ];
  }
  if (p.kind === "wreck") {
    // Damp, darker sand in the hull's lee, scoured hollows along it, and
    // drifts of dark kelp wrack about it.
    const out = [];
    for (let k = 0; k <= 10; k++) {
      const t = k / 10;
      const x = p.stern.x + (p.bow.x - p.stern.x) * t, z = p.stern.z + (p.bow.z - p.stern.z) * t;
      out.push({ x, z, r: 3.4, soft: 0.3, colour: "#7a6d55", amount: 0.45, shade: 0.22, scrub: 0, grass: 0 });
    }
    return out;
  }
  return [];
}
