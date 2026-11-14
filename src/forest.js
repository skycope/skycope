import * as THREE from "three";
import {
  terrainHeight,
  shoreDistance,
  GROUND,
  ISLAND,
  noise2,
  smoothstep,
} from "./terrain.js";
import { seededRandom } from "./random.js";
import { createVegetation } from "./vegetation.js";
import { createSurf, SWASH_GLSL } from "./surf.js";
import { swellUniform } from "./swell.js";
import { rockLayout, rockGeometry, shoreRockData, ROCK_VARIANTS } from "./rocks.js";
import { landFieldData } from "./land-field.js";
import { placeRocks } from "./place-rocks.js"; // places:
import { markSolid, SOLID_ORDER } from "./cat-coat.js"; // solid:
import { bridgeCrevices } from "./walker.js"; // solid:
import { MATERIAL_HEX, MATERIAL_LINEAR } from "./material-palette.js";
import { groundDetailData, groundCover } from "./ground-detail.js";
import { createNearGround } from "./near-ground.js";
import { createLodChunk, packChunk, packDue, chunkRange } from "./instance-lod.js"; // lod:
import { magicUniforms, MAGIC_LIGHT_DECLARATIONS, MAGIC_LIGHT_GLSL } from "./land-magic.js"; // land-magic:
import {
  finish,
  tuftGeometry,
  reedGeometry,
  frondGeometry,
  succulentGeometry,
  needleGeometry,
  pincushionGeometry,
  proteaGeometry,
  daisyGeometry,
} from "./plant-forms.js";

// All assets are built from geometry. No downloaded or generated images/textures.
// Materials share one uniform set: three wind bands in the vertex stage, and
// translucency, sun glints and depth-graded fog in the fragment stage.
export function createForest(scene, seed, { light = false } = {}) {
  const shared = {
    breezeTime: { value: 0 },
    breezeStrength: { value: 0.4 },
    breezeDir: { value: new THREE.Vector2(0.9, -0.436) },
    sunDirView: { value: new THREE.Vector3(0, 1, 0) },
    // Lambert-lit white (sun/π + sky), set from the shared lighting model.
    foamLight: { value: new THREE.Color(1, 1, 1) },
    // Night (0–1), for bioluminescence in the swash.
    nightGlow: { value: 0 },
    // The breaking swell train (src/swell.js), for swash on sand and rocks.
    swell: { value: new THREE.Vector4(...swellUniform(seed, [0, 0])) },
    // Where the cat is (coast x, z), how far it pushes, how hard.
    catPush: { value: new THREE.Vector4(0, 0, 0.4, 0) },
    // The cat's legs in the swash film (x, z, depth), and the water past
    // them: downstream direction (x, z), speed, and whether any is wet.
    catLegs: { value: Array.from({ length: 4 }, () => new THREE.Vector4()) },
    catFlow: { value: new THREE.Vector4() },
    // Horizon haze toward and away from the sun (aerial perspective).
    hazeToward: { value: new THREE.Color(0.6, 0.7, 0.8) },
    hazeAway: { value: new THREE.Color(0.6, 0.7, 0.8) },
    // The sun shadow map's centre (Three world space): beyond its reach the
    // baked canopy occlusion stands in for sun shadows.
    shadowCentre: { value: new THREE.Vector3() },
    // The sky dome's radiance as nine SH coefficients (landscape.js).
    skySH: { value: Array.from({ length: 9 }, () => new THREE.Vector3()) },
    rainWetness: { value: 0 },
    rainFilm: { value: 0 },
    // land-look: the ground field (groundFieldTexture) and where it lies.
    groundField: { value: null },
    groundRect: { value: new THREE.Vector4() },
    // land-magic: the gifts' light on the land (land-magic.js).
    ...magicUniforms(),
  };
  // `?perf` QA: the console can read and tweak the shared lighting uniforms.
  scene.userData.forestShared = shared;
  const random = seededRandom(seed);
  const { wood: trunks, leaves, clusters, flowers, turf, fronds, succulents, needles, reeds, layout, habitat, producers = [] } = createVegetation(seed);
  const rocks = addRocks(scene, random, shared, placeRocks(seed, rockLayout(random))); // places:
  const surf = createSurf(scene, rocks, shared, { light });
  const obstacles = obstaclesFor(layout, rocks);
  const groundOccluders = occludersFor(layout, rocks);
  const groundCover = coverFor(layout, turf);
  const groundField = addGround(scene, shared, groundOccluders, groundCover, rocks);
  addGroundDetails(scene, shared, groundDetailData(seed, producers, { light }), groundOccluders);
  // Sward, sprigs and fallen leaves round the cat (near-ground.js).
  const nearGround = createNearGround(scene, groundField, (material) =>
    patchMaterial(material, shared, { sway: true, foliage: true, bent: 0.55, pliant: true, rooted: 0.06, sheen: 0.3 }), { light });
  // Sky occlusion for every plant part the generator did not bake one for:
  // the canopy field at its foot (trunks feel less of it than the grass).
  const visible = occlusionField(occludersFor(layout, []));
  const shadeFrom = (list, k = 1) => {
    for (const p of list) if (p.shade === undefined) p.shade = (1 - visible(p.position.x, p.position.z)) * k;
  };
  shadeFrom(trunks, 0.6);
  shadeFrom(leaves);
  shadeFrom(clusters, 0.8);
  shadeFrom(turf);
  for (const list of [fronds, succulents, needles, reeds]) shadeFrom(list);
  for (const list of Object.values(flowers)) shadeFrom(list);
  const woodMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 1,
  });
  patchMaterial(woodMaterial, shared, { sway: true, bark: true, taper: true });
  // Unit cylinders; each instance's taper narrows the top to where the next
  // segment starts. Wind bends each short segment as a whole, so one ring of
  // vertices per end is enough (the old two-ring tube cost 2.3× the triangles).
  // Twigs under ~1.2 cm radius (almost half the segments, and mostly hidden
  // in the leaves) are square in section: a few pixels wide, a seven-sided
  // tube reads no rounder, and it spent 14 triangles on each.
  const TWIG = 0.012;
  addInstances(
    scene,
    new THREE.CylinderGeometry(1, 1, 1, 7, 1, true),
    woodMaterial,
    trunks.filter((w) => w.scale.x >= TWIG),
    true,
    [
      // Seven sides only where a limb is wide enough on screen to show them.
      { geometry: new THREE.CylinderGeometry(1, 1, 1, 5, 1, true), keep: (w) => w.scale.x > 0.03, distance: 16 },
      { geometry: new THREE.CylinderGeometry(1, 1, 1, 3, 1, true), keep: (w) => w.scale.x > 0.07, distance: 90 },
    ],
  );
  addInstances(
    scene,
    new THREE.CylinderGeometry(1, 1, 1, 4, 1, true),
    woodMaterial,
    trunks.filter((w) => w.scale.x < TWIG),
    true,
    [
      { geometry: new THREE.CylinderGeometry(1, 1, 1, 3, 1, true), keep: (w) => w.scale.x > 0.006, distance: 18 },
      { keep: () => false, distance: 36 },
    ],
  );
  const clusterMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.6,
    vertexColors: true,
    side: THREE.DoubleSide,
  });
  patchMaterial(clusterMaterial, shared, {
    sway: true,
    flutter: 0.05,
    foliage: true,
    bent: 0.5,
  });
  // The island carries ~200k shoots, and past ~60 m each covers only a few
  // pixels: the layer was bound by vertex work on pixel-sized triangles, not
  // by fill. Far levels keep a half, then a third, of the shoots (a stable
  // per-shoot choice), grown so the canopy covers the same area. Near shoots
  // are 10 small folded leaves (60 triangles, 70 vertices; 14 cost 84 and
  // the extra four were hidden by their neighbours), only round the cat: past
  // ~11 m a leaf is a few pixels and its folds are invisible. Then 7, 3 and 1
  // larger leaf cards (28, 12, 4 vertices); from 24 m every shoot is three
  // cards (a shoot is ~10 px there), from 48 m half of them.
  addInstances(scene, shootGeometry(10, 1), clusterMaterial, clusters, true, [
    { geometry: shootGeometry(7, 0), grow: 1.12, distance: 11 },
    { geometry: shootGeometry(5, 0), grow: 1.2, distance: 22 },
    { geometry: shootGeometry(3, 0), grow: 1.35, distance: 38 },
    { geometry: shootGeometry(3, 0), grow: 1.35 * Math.SQRT2, keep: (c) => shootShare(c) < 0.5, distance: 60 },
    { geometry: shootGeometry(1, 0), grow: 1.9 * Math.sqrt(3), keep: (c) => shootShare(c) < 0.34, distance: 100 },
  ], { shadowGrow: SHADOW_GROW });
  const bladeMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.62,
    vertexColors: true,
    side: THREE.DoubleSide,
  });
  patchMaterial(bladeMaterial, shared, { sway: true, flutter: 0.08, foliage: true, bent: 0.45, pliant: true, rooted: 0.25, sheen: 0.3 });
  addInstances(scene, leafGeometry(1), bladeMaterial, leaves, true, [
    { geometry: leafGeometry(0), keep: (l) => l.scale.y > 0.18 || l.scale.x > 0.05, distance: 28 },
    { geometry: leafGeometry(0), keep: (l) => l.scale.y > 0.5, distance: 60 },
    { geometry: leafGeometry(0), keep: (l) => l.scale.y > 1.2, distance: 95 },
  ]);
  // Turf shades as a soft lawn (normals bent up) and only near clumps cast
  // shadows; far away a sparse subset stands in for the rest.
  const turfMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.7,
    vertexColors: true,
    side: THREE.DoubleSide,
  });
  patchMaterial(turfMaterial, shared, { sway: true, flutter: 0.06, foliage: true, bent: 0.55, pliant: true, rooted: 0.12 });
  // Full tufts (5 mm blades, flowering culms) only round the cat; past
  // ~10 m a blade is under a pixel wide. The near-ground carpet thickens
  // the sward between them, so a tuft needs fewer blades of its own.
  addInstances(scene, tuftGeometry(20, 3, 2), turfMaterial, turf, false, [
    { geometry: tuftGeometry(10, 2), distance: 10 },
    { geometry: tuftGeometry(5, 2), grow: 1.15, distance: 24 },
    { geometry: tuftGeometry(5, 2), keep: (t) => t.far, grow: 1.3, distance: 42 },
    { keep: () => false, distance: 75 },
  ]);
  // Restio clumps share the tufts' pliant, vertex-coloured material.
  addInstances(scene, reedGeometry(30, 1), turfMaterial, reeds, true, [
    { geometry: reedGeometry(14, 0), distance: 18 },
    { keep: () => false, distance: 90 },
  ], { chunk: 40 });
  // Fern and palm fronds: one organ per frond. Palms (tall anchors) stay
  // to the horizon; fern fronds drop out where they'd be a few pixels.
  addInstances(scene, frondGeometry(16, 2), bladeMaterial, fronds, true, [
    { geometry: frondGeometry(12, 1), distance: 13 },
    { geometry: frondGeometry(8, 0), keep: (f) => f.scale.y > 1.5 || shootShare(f) < 0.6, distance: 50 },
    { geometry: frondGeometry(6, 0), keep: (f) => f.scale.y > 1.5, distance: 95 },
  ]);
  // Heath shoots: needles, on the same foliage material as leafy shoots.
  addInstances(scene, needleGeometry(26), clusterMaterial, needles, true, [
    { geometry: needleGeometry(10), grow: 1.15, distance: 16 },
    { geometry: needleGeometry(4), grow: 1.3, distance: 30 },
    { geometry: needleGeometry(4), grow: 1.5, keep: (c) => shootShare(c) < 0.5, distance: 60 },
  ], { shadowGrow: SHADOW_GROW });
  // Aloe leaves are thick and waxy, not translucent: plain lit, a little
  // glossy, stiff in the wind.
  const succulentMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.5,
    vertexColors: true,
    side: THREE.DoubleSide,
  });
  patchMaterial(succulentMaterial, shared, { sway: true });
  addInstances(scene, succulentGeometry(1), succulentMaterial, succulents, true, [
    { geometry: succulentGeometry(0), distance: 18 },
    { keep: (s) => s.scale.y > 0.35, distance: 75 },
  ], { chunk: 40 });
  // Petals are thin and backlit like leaves; they share the flutter and the
  // translucency, with a satin sheen instead of a waxy one.
  const petalMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.5,
    vertexColors: true,
    side: THREE.DoubleSide,
  });
  patchMaterial(petalMaterial, shared, { sway: true, flutter: 0.04, foliage: true, bent: 0.35 });
  // Daisy and bell drifts: past ~22 m a head is a pixel or two, so half of
  // them, grown to keep the drift's colour, then none.
  const halfDrift = { keep: (f) => shootShare(f) < 0.5, grow: Math.SQRT2, distance: 22 };
  addInstances(scene, daisyGeometry(), petalMaterial, flowers.daisy, false, [halfDrift, { keep: () => false, distance: 45 }], { chunk: 40 });
  addInstances(scene, proteaGeometry(1), petalMaterial, flowers.protea, true, [{ geometry: proteaGeometry(0), distance: 20 }, { keep: () => false, distance: 85 }], { chunk: 40 });
  addInstances(scene, pincushionGeometry(36, 1), petalMaterial, flowers.pincushion, true, [{ geometry: pincushionGeometry(14, 0), distance: 20 }, { keep: () => false, distance: 85 }], { chunk: 40 });
  addInstances(scene, spikeGeometry(), petalMaterial, flowers.spike, true, [{ geometry: spikeGeometry(14), distance: 45 }, { keep: () => false, distance: 95 }], { chunk: 40 });
  addInstances(scene, white(bellGeometry()), petalMaterial, flowers.bell, false, [halfDrift, { keep: () => false, distance: 45 }], { chunk: 40 });
  return {
    habitat,
    // Trunks and boulders, for the cat to walk around (or climb).
    obstacles,
    // The boulders the sea touches, for the water pass (rocks.js).
    shoreRocks: shoreRockData(rocks),
    rocks, // solid: the one final rock list (landmark stones included), for critters.js
    // The island's top surface for reflections in the sea (land-field.js).
    landField: landFieldData(clusters),
    surf,
    // The cat's legs in the swash (wake.js), each frame.
    updateCatWater(paws, flow) {
      let wet = 0;
      paws.forEach((p, i) => {
        shared.catLegs.value[i].set(p[0], p[1], p[2], 0);
        if (p[2] > 0.003) wet = 1;
      });
      const pace = Math.hypot(flow[0], flow[1]);
      shared.catFlow.value.set(pace > 1e-3 ? flow[0] / pace : 0, pace > 1e-3 ? flow[1] / pace : 0, Math.min(pace, 2.5), wet);
    },
    // The surf's spray off the rocks (surf.js), each frame.
    updateSurf(time, eye, pixelScale, water) {
      surf.update(time, eye, pixelScale, water);
    },
    updateWind(time, wind) {
      shared.breezeTime.value = time;
      shared.swell.value.fromArray(swellUniform(seed, wind));
      const speed = Math.hypot(wind[0], wind[1]);
      shared.breezeStrength.value = Math.min(1.5, 0.15 + speed / 8);
      if (speed > 0.5)
        shared.breezeDir.value.set(wind[0] / speed, wind[1] / speed);
    },
    // Leaves and blades bend away from the cat as it brushes through.
    pushAt(x, z, strength) {
      nearGround.setCat(x, z);
      const push = shared.catPush.value;
      push.x = x;
      push.y = z;
      push.w += (strength - push.w) * 0.2;
    },
    updateNight(night) {
      shared.nightGlow.value = night;
    },
    updateWeather(surface) {
      shared.rainWetness.value = surface?.wetness ?? 0;
      shared.rainFilm.value = surface?.film ?? 0;
    },
    updateFoamLight(rgb) {
      shared.foamLight.value.setRGB(rgb[0], rgb[1], rgb[2]);
    },
    updateHaze(toward, away) {
      shared.hazeToward.value.setRGB(toward[0], toward[1], toward[2]);
      shared.hazeAway.value.setRGB(away[0], away[1], away[2]);
    },
    updateSkySH(coefficients, scale) {
      coefficients.forEach((c, i) => shared.skySH.value[i].copy(c).multiplyScalar(scale));
    },
    updateShadowCentre(x, z) {
      shared.shadowCentre.value.set(x, 0, -z);
    },
    updateSun(directionView) {
      shared.sunDirView.value.copy(directionView);
    },
    // land-look: contact shade on the ground round the landmarks' feet
    // (`roots` under the land group `land`), baked once they are built.
    groundContact(land, roots) {
      bakeGroundContact(shared, land, roots);
    },
    // lod: each frame, the eye (world space) and the render budget's LOD
    // bias (quality.js lodBias, ≤ 1 pulls every level in).
    updateLod(eye, bias = 1) {
      packLod(scene, eye, bias);
    },
  };
}

// Gust fronts: bands of stronger wind roll downwind across the island at
// about the wind's own speed, their fronts bent and broken up across the
// wind, so one gust visibly travels through the grass, then the shrubs, then
// the crowns. Shared by the vertex wind and the ground's grass sheen.
const GUST_GLSL = /* glsl */ `
uniform float breezeTime;
uniform float breezeStrength;
uniform vec2 breezeDir;
float gustAt( vec2 p ) {
  float along = dot( p, breezeDir );
  float across = dot( p, vec2( -breezeDir.y, breezeDir.x ) );
  float run = breezeTime * ( 2.0 + breezeStrength * 3.0 );
  float bendFront = 1.7 * sin( across * 0.045 + breezeTime * 0.06 );
  float front = sin( ( along - run ) * 0.16 + bendFront );
  float ripple = sin( ( along - run * 1.15 ) * 0.41 + across * 0.12 - bendFront * 1.4 );
  float g = clamp( 0.45 + front * 0.4 + ripple * 0.22, 0.0, 1.0 );
  return g * g * 1.4;
}
`;

// Post-instancing offset shared by every swaying vertex: because it is a
// continuous function of the world position, parent and child branch segments
// displace together and joints stay connected. Trees lean downwind as a gust
// passes and sway about that lean; a faster band bobs the branches. Pliant
// plants (grass, reeds, fronds) bend far more for their height, and keep
// their length by dipping as they bend.
const WIND_GLSL = /* glsl */ `
${GUST_GLSL}
uniform vec4 catPush;
// land-magic: a waking's ring (Three world x, z, radius, strength).
uniform vec4 magicPulse;
varying float vGlint;
// Height of the plant's base (per instance): wind bends from there, so a trunk
// or stem is rooted wherever it stands. Zero for non-instanced meshes.
attribute float anchorHeight;
varying float vAbove;
vec3 windOffset(vec3 p) {
  float h = max(p.y - anchorHeight, 0.0);
  float gust = gustAt( p.xz );
  float sway = sin(breezeTime * 0.8 + p.x * 0.11 + p.z * 0.09);
  float bob = sin(breezeTime * 2.3 + p.x * 0.9 + p.z * 0.7 + h * 0.6);
  // A gust front carries real weight: crowns heel over as it arrives and
  // rock back behind it. Soft caps keep the lean to tens of centimetres (a
  // tall crown a little more), so nothing whips unnaturally; every term is a
  // smooth function of position, so the joints stay joined.
  float amp = breezeStrength * (0.25 + 0.75 * gust) * (1.0 + gust * 1.5);
  float leanCap = 0.12 + h * 0.02;
  float lean = (sway * 0.7 + gust * 0.6) * h * h * 0.009 * amp;
  lean = leanCap * tanh(lean / leanCap);
  float bobAmp = bob * h * 0.02 * amp;
  bobAmp = 0.1 * tanh(bobAmp / 0.1);
  vec3 offset = vec3(breezeDir.x, 0.0, breezeDir.y) * lean
    + vec3(breezeDir.x, -0.25, breezeDir.y) * bobAmp;
  #ifdef PLIANT
    float blade = h * h / ( 0.25 + h ) * ( 1.0 - smoothstep( 1.2, 2.6, h ) );
    float lash = sin( breezeTime * 2.7 + p.x * 1.3 + p.z * 0.9 ) * ( 0.15 + 0.3 * gust );
    vec2 push = breezeDir * ( blade * breezeStrength * ( 0.12 + gust * 0.55 + lash ) );
    offset.xz += push;
    offset.y -= dot( push, push ) / max( h, 0.05 ) * 0.5;
  #endif
  // land-magic: as a waking's ring of light passes, everything that grows
  // bows away from the keepsake and rises again behind it.
  if ( magicPulse.w > 0.0 ) {
    vec2 pd = p.xz - vec2( magicPulse.x, -magicPulse.y );
    float pl = length( pd ) + 1e-3;
    float dd = pl - magicPulse.z;
    float wave = exp( -dd * dd * 0.08 ) * min( magicPulse.w, 1.0 );
    float bow = wave * h / ( 0.5 + h ) * ( 0.12 + 0.05 * min( h, 4.0 ) );
    offset.xz += pd / pl * bow;
    offset.y -= bow * 0.35;
  }
  return offset;
}
`;

// Low foliage parts round the cat: plants within reach lean away from it,
// more toward their tips, and pressed a little down. Each plant leans as one
// piece, away from where it is rooted (leaning each vertex away on its own
// smeared a flower's head into a ring round the cat). Tall plants' crowns
// are out of reach, so only the lower ~60 cm of any plant moves.
const PUSH_GLSL = /* glsl */ `
{
  #ifdef USE_INSTANCING
    vec2 away = instanceMatrix[3].xz - catPush.xy;
  #else
    vec2 away = mvPosition.xz - catPush.xy;
  #endif
  float d = length( away ) + 1e-4;
  float above = max( mvPosition.y - anchorHeight, 0.0 );
  float reach = catPush.z;
  float push = catPush.w * ( 1.0 - smoothstep( reach * 0.3, reach, d ) ) * smoothstep( 0.0, 0.25, above ) * ( 1.0 - smoothstep( 0.35, 0.65, above ) );
  mvPosition.xz += away / d * push * reach * 0.55;
  mvPosition.y -= push * above * 0.35;
}`;

// Foliage the camera noses into folds out of its way: leaves and blades
// within about a metre of the eye close up toward their own stem or base,
// the way a hand pushed into a bush parts it, instead of slicing through
// the lens as flat green planes. No discard: the geometry just moves.
const FOLD_GLSL = /* glsl */ `
{
  vec3 foldWorld = ( modelMatrix * vec4( mvPosition.xyz, 1.0 ) ).xyz;
  float fold = 1.0 - smoothstep( 0.3, 1.1, length( foldWorld - cameraPosition ) );
  if ( fold > 0.0 ) {
    #ifdef USE_INSTANCING
      vec3 foldAnchor = instanceMatrix[3].xyz;
    #else
      vec3 foldAnchor = mvPosition.xyz;
    #endif
    mvPosition.xyz = mix( mvPosition.xyz, foldAnchor, fold * 0.94 );
  }
}`;

const PROJECT_GLSL = /* glsl */ `
vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
  mvPosition = instanceMatrix * mvPosition;
#endif
mvPosition.xyz += windOffset( mvPosition.xyz );
vAbove = mvPosition.y - anchorHeight;
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;
`;

// Sky occlusion (canopyShade: 0 open sky, 1 buried in foliage), per vertex
// for the ground and per instance for plants. Unset attributes read as 0.
const OCCLUSION_VERTEX_GLSL = /* glsl */ `
attribute float canopyShade;
uniform vec3 shadowCentre;
varying float vShade;
varying float vShadowFar;
`;

// Occluded skylight: diffuse by the visible sky fraction, sky reflections
// more strongly (specular occlusion). Beyond the sun's shadow map the same
// occlusion stands in for the shadows of the canopy overhead, so distant
// woods keep their shaded depth instead of lighting up flat. Inside a crown
// the light that remains is mostly green: sunlight and skylight scattered
// and transmitted by the surrounding leaves.
function occlusionGlsl(foliage) {
  return /* glsl */ `
  {
    // land-look: by night the dome is the only light; a canopy hides less
    // of it from a dark-adapted eye, so the ground under trees stays a
    // deep blue instead of black.
    float skyVisible = 1.0 - vShade * ( 1.0 - 0.85 * landNightFill );
    reflectedLight.indirectDiffuse *= skyVisible;
    reflectedLight.indirectSpecular *= skyVisible * skyVisible;
    float farShade = 1.0 - vShade * 0.85 * vShadowFar;
    reflectedLight.directDiffuse *= farShade;
    reflectedLight.directSpecular *= farShade;
    ${
      foliage
        ? `vec3 canopyReflectance = vec3( 0.13, 0.20, 0.07 );
    reflectedLight.indirectDiffuse += foamLight * canopyReflectance * diffuseColor.rgb * vShade * 0.25;`
        : ""
    }
  }
`;
}

// Skylight for foliage and bark from the sky's spherical harmonics: the
// irradiance on the leaf's (bent) normal, and for its broad waxy sheen the
// SH radiance along the mirror direction, which at leaf roughness is as
// blurred as the prefiltered map would give. Replaces three's IBL lookups.
const SKY_SH_GLSL = /* glsl */ `
#if defined( RE_IndirectDiffuse )
  iblIrradiance += shGetIrradianceAt( inverseTransformDirection( geometryNormal, viewMatrix ), skySH );
#endif
#if defined( RE_IndirectSpecular )
  radiance += shGetIrradianceAt( inverseTransformDirection( reflect( -geometryViewDir, geometryNormal ), viewMatrix ), skySH ) * RECIPROCAL_PI;
#endif
`;

// Leaves are thin and translucent. Sunlight entering the far side of the
// crown exits yellow-green toward the viewer (a forward-scattering lobe plus
// a diffuse "thickness" term for leaves the sun lights from behind), and the
// shaded underside glows faintly with transmitted skylight. A shifting subset
// carries a tight specular lobe: sun-sparkles as they flutter.
//
// Everything is driven by `leafSun`: the sun's irradiance at this fragment
// after the shadow map (captured from three's light loop), so only leaves the
// sun actually reaches glow, and a crown lit from behind shows a bright rim
// over a dark, self-shadowed interior. Which side the sun is on uses the
// leaf's own normal (vLeafNormal), not the crown-bent shading normal.
const FOLIAGE_GLSL = /* glsl */ `
#include <lights_fragment_end>
{
  vec3 toEye = normalize( vViewPosition );
  vec3 leafN = normalize( vLeafNormal );
  leafN *= dot( leafN, toEye ) < 0.0 ? -1.0 : 1.0;
  // Sun on the far side of the leaf from the eye: the light passed through it.
  float behind = clamp( -dot( leafN, sunDirView ), 0.0, 1.0 );
  float facing = clamp( dot( leafN, sunDirView ), 0.0, 1.0 );
  // Leaf tissue scatters forward: brightest looking toward the sun.
  float forward = pow( clamp( -dot( toEye, sunDirView ), 0.0, 1.0 ), 6.0 );
  // A leaf transmits about as much as it reflects (PROSPECT: T ≈ 0.8 R in
  // the green), but the light has crossed the chlorophyll twice as far, so
  // it comes out deeper and yellower: red and blue absorbed on the way.
  vec3 transmit = min( diffuseColor.rgb * vec3( 1.0, 1.25, 0.45 ), vec3( 0.3 ) );
  reflectedLight.directDiffuse += leafSun * transmit * RECIPROCAL_PI
    * behind * ( 0.55 + forward * 0.4 );
  // Glossy leaves mirror the sky (SKY_SH_GLSL). Deep in a crown the leaves
  // around each one hide most of it (canopyShade), and duller organs (grass
  // blades) reflect less: SHEEN is relative to a leaf's 0.6.
  reflectedLight.indirectSpecular *= SHEEN / 0.6;
  // Skylight through the canopy: undersides glow faintly green.
  reflectedLight.indirectDiffuse += transmit / max( diffuseColor.rgb, vec3( 0.001 ) ) * reflectedLight.indirectDiffuse
    * clamp( -normal.y * 0.5 + 0.5, 0.0, 1.0 ) * 0.25;
  // A thin leaf can only mirror the sun from its sunlit face: lit from
  // behind, the light reaches the eye by transmission alone. Two-sided
  // shading otherwise lets three's sun specular glare off the shaded face,
  // and at a low sun a backlit bush bleached to white. Seen edge-on, the
  // leaves of a clump hide each other's glare too.
  // Duller organs (grass blades, fronds) mirror the sun less, too.
  reflectedLight.directSpecular *= smoothstep( 0.0, 0.25, facing ) * smoothstep( 0.0, 0.3, dot( leafN, toEye ) ) * ( SHEEN / 0.6 );
  // Waxy cuticle: each leaf mirrors the sun at its own angle, so a crown
  // shimmers leaf by leaf instead of carrying one broad highlight. A leaf
  // is drawn as a few flat facets, so a full-strength flash whitened whole
  // cards: keep it to a sheen on the few leaves at the mirror angle.
  vec3 sparkleRay = reflect( -sunDirView, leafN );
  float sparkle = pow( clamp( dot( sparkleRay, toEye ), 0.0, 1.0 ), 64.0 ) * facing;
  float gate = 0.2 + 0.8 * smoothstep( 0.7, 0.97, fract( vGlint * 9.173 + breezeTime * 0.11 ) );
  reflectedLight.directSpecular += leafSun * sparkle * gate * 0.2 * ( SHEEN / 0.6 );
  #ifdef ROOTED
    // Low plants grow out of their own shade: the base of a tuft or rosette
    // sees little sky or sun, so it darkens into the soil it stands in.
    float rootShade = mix( 0.4, 1.0, smoothstep( 0.0, ROOTED, vAbove ) );
    reflectedLight.indirectDiffuse *= rootShade;
    reflectedLight.directDiffuse *= mix( 0.6, 1.0, rootShade );
  #endif
}
`;

// Each glassy grain (one in ten) is a tiny mirror at its own tilt:
// those that reflect the sun toward the eye flash. Only near, where one
// grain is about a pixel; they twinkle as the eye moves.
const SAND_GLINT_GLSL = /* glsl */ `
#include <lights_fragment_end>
// A bush is a tangle of twigs and small leaves: its sheen is hidden in its
// own shade, and a dark shrub must not mirror the blue sky grey.
// Lit as foliage, not paint: a soft leaf sheen stays, and skylight through
// the outer leaves tints it green.
reflectedLight.indirectSpecular *= 1.0 - lowCover * 0.5;
reflectedLight.directSpecular *= 1.0 - lowCover * 0.5;
reflectedLight.indirectDiffuse *= 1.0 + lowCover * vec3( 0.1, 0.35, 0.0 );
reflectedLight.directDiffuse += leafSun * diffuseColor.rgb * vec3( 0.2, 0.3, 0.08 ) * lowCover * RECIPROCAL_PI;
if ( sandGlint > 0.01 && dHash( glintCell + 0.37 ) < 0.1 ) {
  vec3 tilt = vec3( dHash( glintCell + 1.1 ), dHash( glintCell + 2.3 ), dHash( glintCell + 3.7 ) ) - 0.5;
  vec3 facet = normalize( normal + tilt * 0.9 );
  float mirror = dot( reflect( -sunDirView, facet ), normalize( vViewPosition ) );
  float flash = smoothstep( 0.992, 0.999, mirror ) * sandGlint * ( 1.0 - swashFilm ) * ( 1.0 - swashCover );
  reflectedLight.directSpecular += leafSun * flash * 3.0;
}
`;

// three's directional-light loop with the shadowed sun irradiance kept for
// the foliage terms above (the scene has exactly one directional light).
const LEAF_LIGHTS_GLSL = (() => {
  const chunk = THREE.ShaderChunk.lights_fragment_begin;
  const marker = "#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )";
  const call =
    "RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );";
  const at = chunk.indexOf(marker);
  if (at < 0 || chunk.indexOf(call, at) < 0)
    throw new Error("three.js light loop changed; update LEAF_LIGHTS_GLSL");
  const head = chunk.slice(0, at);
  const tail = chunk.slice(at).replace(call, `${call}\n\t\tleafSun += directLight.color;`);
  return `vec3 leafSun = vec3( 0.0 );\n${head}${tail}`;
})();

// Distance should remove information, not just add white: far geometry loses
// saturation and contrast toward the sky tone before the fog blend itself.
const FOG_GLSL = /* glsl */ `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
  #endif
  // Clear coastal air: colour holds across the island and fades only
  // toward the far shore, so the near scene keeps its saturation.
  float fogFade = smoothstep( 40.0, 200.0, vFogDepth );
  // The haze is the horizon sky along this line of sight: bright and warm
  // toward the sun (forward-scattering aerosol), cool blue away from it.
  float hazeSun = dot( normalize( -vViewPosition ), sunDirView );
  vec3 hazeColour = mix( hazeAway, hazeToward, pow( 0.5 + 0.5 * hazeSun, 2.5 ) );
  float fogLuma = dot( gl_FragColor.rgb, vec3( 0.30, 0.55, 0.15 ) );
  vec3 fogFaded = mix( gl_FragColor.rgb, vec3( fogLuma ), fogFade * 0.3 );
  fogFaded = mix( fogFaded, hazeColour, fogFade * 0.15 );
  gl_FragColor.rgb = mix( fogFaded, hazeColour, fogFactor );
#endif
`;

// Procedural surface detail for the ground and rocks, evaluated per pixel in
// world space: vertex colours give the ecotone at metre scale, this adds the
// centimetre scale the eye reads as material. Dry sand gets grain and wind
// ripples, the swash zone darkens and turns glossy, steep ground exposes
// granite, and a derivative bump map makes all of it catch low sun.
// vWorld is Three world space; the land group mirrors z, so coast z = -vWorld.z.
const GROUND_COLOUR_GLSL = /* glsl */ `
#include <color_fragment>
// land-look: contact shade round the landmarks' feet (bakeGroundContact):
// a little darker and damper, and seeing less sky (after the lights).
float groundContact = texture2D( groundField, ( vec2( vWorld.x, -vWorld.z ) - groundRect.xy ) * groundRect.zw ).g;
diffuseColor.rgb *= 1.0 - 0.18 * groundContact;
// Metre-scale masks are baked per vertex (vGroundMask: mottling, exposed
// granite, leaf litter); only centimetre detail is evaluated per pixel.
vec2 coast = vec2( vWorld.x, -vWorld.z );
float inland = dShore( coast );
// Metres per pixel. Grain finer than ~2 pixels is replaced by its mean, not
// sampled: sampled, it shimmered as the camera moved.
float px = max( fwidth( coast.x ), fwidth( coast.y ) );
float grain = dNoiseFade( coast * 38.0, smoothstep( 0.2, 0.5, px * 38.0 ) ) * 0.6
  + dNoiseFade( coast * 90.0, smoothstep( 0.2, 0.5, px * 90.0 ) ) * 0.4;
float mottled = vGroundMask.x;
float rocky = vGroundMask.y;
float litter = vGroundMask.z;
// Wind ripples on dry sand, crests across the prevailing south-easter
// (only ever used scaled by \`dry\`).
float dry = smoothstep( 1.2, 3.0, inland ) * ( 1.0 - smoothstep( 6.0, 11.0, inland ) );
float ripple = dry > 0.0 ? sin( dot( coast, vec2( 0.44, 0.9 ) ) * 9.0 + dNoise( coast * 0.8 ) * 6.0 ) : 0.0;
float wet = 1.0 - smoothstep( 0.1, 1.6, inland + ( mottled - 0.5 ) * 0.8 );
diffuseColor.rgb *= 0.78 + grain * mix( 0.3, 0.08, wet ) + ( mottled - 0.5 ) * 0.35;
diffuseColor.rgb *= 1.0 + ripple * 0.06 * dry;
// land-look: fine wind ripples a hand apart over the dry sand, wandering
// and forking, their crests paler and their troughs holding darker grains;
// averaged away where they would shimmer.
float ripFade = 1.0 - smoothstep( 0.012, 0.03, px );
float fine = 0.0;
if ( ripFade * dry > 0.01 ) {
  float ph = dot( coast, vec2( 0.5, 0.87 ) ) * 48.0 + dNoise( coast * 2.2 ) * 7.0 + dNoise( coast * 0.6 ) * 9.0;
  fine = ( sin( ph ) * 0.5 + 0.5 );
  fine = fine * fine * ( 3.0 - 2.0 * fine ) * smoothstep( 0.25, 0.6, dNoise( coast * 0.9 + 4.0 ) );
  diffuseColor.rgb *= 1.0 + ( fine - 0.35 ) * 0.14 * dry * ripFade;
}
// The damp band above the swash: darker, a little cooler, with a soft sheen.
// (Zero below 1 m and, whatever the noise, beyond 4.8 m.)
float damp = inland > 1.0 && inland < 4.8
  ? smoothstep( 1.0, 1.8, inland ) * ( 1.0 - smoothstep( 2.4, 4.0, inland + ( dNoise( coast * 0.45 ) - 0.5 ) * 1.6 ) ) : 0.0;
diffuseColor.rgb *= mix( vec3( 1.0 ), vec3( 0.8, 0.8, 0.82 ), damp );
// The strandline: the last high tide's line of dry kelp, shell and sea-bean
// wrack, a ragged dark band that comes and goes along the beach.
// (The line wanders 3.4–5.8 m inland; beyond 0.75 m of that band the wrack
// is under the 0.01 it is drawn from.)
float strandWrack = 0.0;
if ( inland > 2.65 && inland < 6.55 ) {
  float strand = inland - ( 4.6 + ( dNoise( coast * 0.22 ) - 0.5 ) * 2.4 );
  strandWrack = exp( -strand * strand * 9.0 ) * smoothstep( 0.4, 0.62, dNoise( coast * 0.35 + 21.0 ) );
}
if ( strandWrack > 0.01 ) {
  float bitsFade = smoothstep( 0.01, 0.04, px );
  float bits = bitsFade < 1.0 ? mix( smoothstep( 0.55, 0.75, dNoise( coast * 9.0 ) ), 0.45, bitsFade ) : 0.45;
  float shellsFade = smoothstep( 0.004, 0.012, px );
  float shells = shellsFade < 1.0 ? mix( step( 0.9, dNoise( coast * 31.0 + 5.0 ) ), 0.08, shellsFade ) : 0.08;
  diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.13, 0.1, 0.06 ), strandWrack * bits * 0.8 );
  diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.78, 0.74, 0.68 ), strandWrack * shells * 0.6 );
}
// The vertex colour already carries most of wet sand's darkening (about
// half the dry albedo); water in the pores adds a little more.
diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 0.74, 0.72, 0.7 ), wet );
// Coarse granitic sand up close: black heavy minerals and biotite, white
// shell grit and quartz, pink feldspar, each a few millimetres, averaged
// away beyond a couple of metres.
float grainNear = ( 1.0 - smoothstep( 0.0025, 0.006, px ) ) * ( 1.0 - rocky );
if ( grainNear > 0.01 ) {
  float darkGrain = smoothstep( 0.8, 0.9, dNoise( coast * 210.0 + 3.0 ) );
  float paleGrain = smoothstep( 0.8, 0.88, dNoise( coast * 170.0 + 11.0 ) );
  float pinkGrain = smoothstep( 0.82, 0.9, dNoise( coast * 150.0 + 23.0 ) );
  diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * 0.35, darkGrain * grainNear * 0.8 );
  // Shell grit and quartz belong to the beach and dune sand; inland soil
  // under sward and litter keeps only a few pale grains, dulled by humus.
  float beachGrain = ( 1.0 - smoothstep( 4.0, 10.0, inland ) ) * ( 1.0 - litter ) * ( 1.0 - vGroundMask.w * 0.8 );
  float paleK = mix( 0.12, 0.6, beachGrain );
  diffuseColor.rgb = mix( diffuseColor.rgb, mix( mix( vec3( 0.8, 0.78, 0.74 ), diffuseColor.rgb * 1.6, 1.0 - beachGrain ), diffuseColor.rgb, wet * 0.6 ), paleGrain * grainNear * paleK );
  diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 1.25, 0.95, 0.88 ), pinkGrain * grainNear * 0.6 * beachGrain );
}
// Heavy-mineral laminae: the swash sorts dark grains into thin wavy bands
// along the beach, in patches, just above the waterline.
float laminaZone = smoothstep( 0.2, 0.7, inland ) * ( 1.0 - smoothstep( 1.6, 2.8, inland ) ) * ( 1.0 - rocky );
if ( laminaZone > 0.01 ) {
  float lamPhase = inland * 23.0 + dNoise( coast * 0.45 ) * 9.0 + dNoise( coast * 2.3 ) * 1.5;
  float laminae = smoothstep( 0.82, 0.99, sin( lamPhase ) ) * smoothstep( 0.55, 0.8, dNoise( coast * 0.3 + 9.0 ) )
    * ( 0.5 + 0.5 * dNoise( coast * 4.0 ) ) * laminaZone;
  laminae = mix( laminae, 0.04 * laminaZone, smoothstep( 0.01, 0.03, px ) );
  diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 0.5, 0.47, 0.49 ), laminae * 0.55 );
}
// Quartz sparkle: glassy grains that mirror the sun, lit in lights_fragment_end.
float sandGlint = ( 1.0 - smoothstep( 0.003, 0.008, px ) ) * ( 1.0 - rocky ) * ( 1.0 - litter ) * smoothstep( 0.3, 1.0, inland );
vec2 glintCell = floor( coast * 260.0 );
float strata = 0.0;
if ( rocky > 0.01 ) {
  strata = dNoise( coast * vec2( 2.0, 7.0 ) ) * 0.6 + dNoise( coast * vec2( 5.0, 15.0 ) ) * 0.4;
  vec3 granite = mix( vec3( 0.16, 0.15, 0.14 ), vec3( 0.34, 0.32, 0.29 ), strata );
  granite = mix( granite, vec3( 0.32, 0.3, 0.12 ), smoothstep( 0.62, 0.72, dNoise( coast * 5.0 ) ) * 0.6 );
  diffuseColor.rgb = mix( diffuseColor.rgb, granite, rocky );
}
diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.19, 0.12, 0.06 ) * ( 0.7 + grain * 0.6 ), litter * 0.55 );
// land-look: soil is never one flat brown. Over the inland ground: patches
// a metre or two across, darker where humus gathers and paler where it is
// dry and stony; and up close a speckle of pale pebbles, dark crumbs and
// bits of leaf, averaged to their mean where they would shimmer.
float soilZone = smoothstep( 4.0, 9.0, inland ) * ( 1.0 - rocky );
if ( soilZone > 0.01 ) {
  float soilPatch = dNoise( coast * 0.7 + 41.0 ) * 0.65 + dNoise( coast * 1.9 - 3.0 ) * 0.35;
  diffuseColor.rgb *= mix( vec3( 1.0 ), mix( vec3( 0.72, 0.68, 0.62 ), vec3( 1.2, 1.14, 1.04 ), smoothstep( 0.3, 0.75, soilPatch ) ), soilZone );
  float speckFade = 1.0 - smoothstep( 0.004, 0.01, px );
  if ( speckFade > 0.01 ) {
    float pebble = smoothstep( 0.84, 0.9, dNoise( coast * 34.0 + 7.0 ) ) * smoothstep( 0.4, 0.7, soilPatch );
    float crumb = smoothstep( 0.76, 0.84, dNoise( coast * 41.0 - 5.0 ) );
    float leafBit = smoothstep( 0.8, 0.88, dNoise( mat2( 0.8, -0.6, 0.6, 0.8 ) * coast * 17.0 + 13.0 ) ) * ( 0.3 + litter );
    float k = soilZone * speckFade;
    diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 1.5, 1.45, 1.4 ), pebble * k * 0.6 );
    diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * 0.45, crumb * k * 0.6 );
    diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.32, 0.2, 0.08 ), leafBit * k * 0.7 );
  }
}
// Sward: under and between the tufts, blades too fine and too many to model.
// Short strokes combed downwind, in clumps, over the thatch colour already
// baked per vertex; each stroke averages to its mean below ~2 pixels. A
// gust rolling through turns the blades' paler sides up, so grass visibly
// brightens in travelling bands, in step with the tufts' own bending.
float grassy = vGroundMask.w;
float sward = 0.0;
if ( grassy > 0.02 ) {
  vec2 wind = vec2( dot( coast, breezeDir ), dot( coast, vec2( -breezeDir.y, breezeDir.x ) ) );
  float strokes = dNoiseFade( wind * vec2( 55.0, 110.0 ), smoothstep( 0.2, 0.5, px * 110.0 ) );
  float tufts = dNoise( coast * 2.7 + 7.0 );
  float cover = smoothstep( 0.1, 0.6, grassy );
  sward = cover * ( 0.5 * strokes + 0.5 * tufts );
  diffuseColor.rgb *= mix( 1.0, 0.72 + strokes * 0.3 + tufts * 0.3, cover );
  diffuseColor.rgb *= 1.0 + cover * 0.25 * ( vGroundGust - 0.55 ) * breezeStrength;
}
// Strandveld and fynbos scrub over the hills (vGroundMask2.x): bush bodies
// about a metre across built of 30 cm clumps, dark grey-green (real fynbos
// is 5–10% albedo) with bronze restio stands, domed by the bump so each
// catches the sun on one side, the soil between them darkened as if by
// their shade. Close to the eye, where tufts and shrubs are real geometry,
// the painted bushes flatten into a low mat. A gust turns up the paler
// undersides of the leaves in travelling bands, like the sward's.
float scrub = vGroundMask2.x;
float sourfig = vGroundMask2.y;
float bushCover = 0.0;
float bushDome = 0.0;
float scrubFar = smoothstep( 0.0012, 0.005, px );
// Painted cover can only ever look flat up close: within ~6–10 m of the eye
// it thins away to the plain ground, where tufts and shrubs are geometry.
float coverNear = smoothstep( 5.5, 11.0, length( vViewPosition ) );
// (Nothing to draw within ~5.5 m, where most of the screen's ground is.)
if ( scrub > 0.02 && coverNear > 0.0 ) {
  // Individual bushes: a cellular field, one bush per 1.25 m cell (or a gap),
  // each its own size, species and tone, so a hillside reads as a mosaic of
  // rounded shrubs with dark crevices between them, not a painted blob.
  float body = dNoise( coast * 0.35 + 13.0 ) * 0.6 + dNoise( coast * 0.9 - 7.0 ) * 0.4;
  float density = clamp( scrub * ( 0.3 + body * 0.85 ), 0.0, 0.92 );
  // Each bush throws a shadow downsun of it, as a half-metre shrub would:
  // the cue that stands it up off the slope.
  vec3 sunW = inverseTransformDirection( sunDirView, viewMatrix );
  vec2 sunC = vec2( sunW.x, -sunW.z );
  vec2 throwC = -sunC / max( sunW.y, 0.3 ) * 0.36;
  float c1 = dNoiseFade( coast * 4.2 + 2.0, smoothstep( 0.25, 0.6, px * 4.2 ) );
  float c2 = dNoiseFade( mat2( 0.8, -0.6, 0.6, 0.8 ) * coast * 9.5 + 9.0, smoothstep( 0.25, 0.6, px * 9.5 ) );
  float c3 = dNoiseFade( coast * 21.0 + 5.0, smoothstep( 0.25, 0.6, px * 21.0 ) );
  float c4 = dNoiseFade( coast * 47.0 + 1.0, smoothstep( 0.25, 0.6, px * 47.0 ) );
  // Lobes: a bush's outline bulges and bites at the scale of its clumps.
  float lobe = ( dNoise( coast * 2.2 + 17.0 ) - 0.5 ) * 0.5 + ( c1 - 0.5 ) * 0.3;
  vec2 bg = coast * 0.8;
  vec2 bcell = floor( bg );
  vec2 bf = fract( bg );
  float d1 = 9.0;
  float edgeD = 9.0;
  float shadowD = 9.0;
  float bushSize = 1.0;
  vec2 bid = vec2( 0.0 );
  for ( int j = -1; j <= 1; j++ ) for ( int i = -1; i <= 1; i++ ) {
    vec2 o = vec2( float( i ), float( j ) );
    vec2 cid = bcell + o;
    if ( dHash( cid + 2.2 ) > density ) continue;
    float rad = 0.45 + 0.42 * dHash( cid + 8.1 );
    vec2 c = o + 0.2 + 0.6 * vec2( dHash( cid + 1.7 ), dHash( cid + 4.3 ) ) - bf;
    vec2 squash = vec2( 1.0, 0.8 + 0.4 * dHash( cid + 6.6 ) );
    float d = length( c * squash ) / rad + lobe;
    shadowD = min( shadowD, length( ( c + throwC * rad ) * squash ) / rad + lobe );
    edgeD = min( edgeD, d );
    if ( d < d1 ) { d1 = d; bid = cid; bushSize = rad; }
  }
  // Clumps, not blobs: several octaves break each outline, and the last
  // 20–40 cm is a sparse fringe of sprigs with sand and litter showing
  // between them. Every edge is antialiased by its own screen derivative.
  float ragged = d1 + ( c1 - 0.5 ) * 0.4 + ( c2 - 0.5 ) * 0.3 + ( c3 - 0.5 ) * 0.2;
  float fringe = 0.3 / ( 1.25 * bushSize );
  float sprigs = c3 * 0.55 + c4 * 0.45;
  float edgeAt = 1.0 - fringe * smoothstep( 0.35, 0.75, sprigs );
  float aa = fwidth( ragged ) * 1.5 + 0.02;
  bushCover = ( 1.0 - smoothstep( edgeAt - fringe * 0.5 - aa, edgeAt + aa, ragged ) ) * smoothstep( 0.02, 0.15, scrub ) * coverNear;
  float dome = sqrt( max( 0.0, 1.0 - d1 * d1 ) );
  // Clumps with dark hollows between them, sprigs within the clumps.
  // Up close, single sprigs of small leaves with dark gaps between them.
  float sprig = mix( smoothstep( 0.38, 0.62, c4 ), 0.5, smoothstep( 0.1, 0.3, px * 47.0 ) );
  float speck = smoothstep( 0.3, 0.7, c1 ) * 0.36 + c2 * 0.26 + smoothstep( 0.3, 0.7, c3 ) * 0.18 + sprig * 0.2;
  // Species by bush: olive, dark bottle, grey-green, bronze restio.
  float kind = dHash( bid + 5.5 );
  vec3 bush = kind < 0.38 ? vec3( 0.06, 0.08, 0.032 )
    : kind < 0.66 ? vec3( 0.042, 0.062, 0.027 )
    : kind < 0.86 ? vec3( 0.068, 0.076, 0.052 )
    : vec3( 0.085, 0.07, 0.04 );
  bush *= 0.8 + 0.4 * dHash( bid + 9.9 );
  // Darker low on the dome, in the hollows and on the side away from the
  // sun; outer sprigs catch the light. A gust turns up paler undersides.
  bush *= ( 0.6 + 0.4 * dome ) * ( 0.5 + speck * 1.0 );
  bush *= 1.0 + ( vGroundGust - 0.55 ) * 0.3 * breezeStrength;
  // The soil round each bush lies in its shade, and in its cast shadow.
  float scrubOn = smoothstep( 0.02, 0.15, scrub );
  float rim = ( 1.0 - smoothstep( 0.9, 1.5, edgeD ) ) * ( 1.0 - bushCover ) * coverNear;
  float castShade = ( 1.0 - smoothstep( 0.8, 1.05, shadowD ) ) * ( 1.0 - bushCover ) * smoothstep( 0.05, 0.25, sunW.y ) * coverNear;
  diffuseColor.rgb *= ( 1.0 - rim * 0.3 * scrubOn ) * ( 1.0 - castShade * 0.4 * scrubOn );
  diffuseColor.rgb = mix( diffuseColor.rgb, bush, bushCover );
  sandGlint *= 1.0 - bushCover;
  // Relief for the bump: each bush a dome that lights on its sunward side,
  // its clumps and sprigs in smaller relief.
  // Relief rises over a band inside the outline, not in a step at it: a
  // step there beaded every edge with spiky bump normals.
  float reliefCover = ( 1.0 - smoothstep( 0.5, 1.0, ragged ) ) * scrubOn * coverNear;
  bushDome = reliefCover * ( dome * bushSize * 0.18 * mix( 0.5, 1.0, scrubFar ) + c1 * 0.03 + c2 * 0.015 + c3 * 0.006 + sprig * 0.003 );
}
// Sour fig on the dune band: fleshy finger leaves in creeping mats, green
// going red-bronze where they are stressed, starred with magenta flowers.
float figCover = 0.0;
float figRelief = 0.0;
if ( sourfig > 0.02 && coverNear > 0.0 ) {
  // Rosettes of finger leaves with dark gaps between them.
  float f1Fade = smoothstep( 0.2, 0.5, px * 16.0 );
  float f1 = f1Fade < 1.0 ? mix( smoothstep( 0.35, 0.65, dNoise( coast * 16.0 + 4.0 ) ), 0.5, f1Fade ) : 0.5;
  float f2Fade = smoothstep( 0.15, 0.4, px * 37.0 );
  float f2 = f2Fade < 1.0 ? mix( smoothstep( 0.4, 0.6, dNoise( coast * 37.0 - 2.0 ) ), 0.5, f2Fade ) : 0.5;
  float fingers = f1 * 0.6 + f2 * 0.4;
  float lobes = dNoiseFade( coast * 5.0 + 1.0, smoothstep( 0.25, 0.6, px * 5.0 ) );
  float matN = dNoise( coast * 0.8 + 21.0 ) * 0.62 + dNoise( coast * 2.1 + 3.0 ) * 0.26 + lobes * 0.12;
  float figEdge = mix( 0.84, 0.66, sourfig );
  float figN = matN + ( fingers - 0.5 ) * 0.08 + ( lobes - 0.5 ) * 0.06;
  float figAA = fwidth( figN ) * 1.5 + 0.01;
  figCover = smoothstep( figEdge - figAA, figEdge + 0.06 + figAA, figN ) * ( 1.0 - bushCover ) * smoothstep( 0.02, 0.2, sourfig ) * coverNear;
  vec3 fig = mix( vec3( 0.045, 0.07, 0.024 ), vec3( 0.1, 0.052, 0.03 ), smoothstep( 0.62, 0.85, dNoise( coast * 0.9 + 8.0 ) ) );
  fig *= ( 0.35 + fingers * 1.1 ) * ( 0.6 + lobes * 0.8 ) * 0.85;
  vec2 fg = coast * 6.0;
  vec2 fid = floor( fg );
  float bloom = step( 0.92, dHash( fid + 17.0 ) ) * ( 1.0 - smoothstep( 0.03, 0.05, length( fract( fg ) - 0.3 - 0.4 * vec2( dHash( fid + 2.0 ), dHash( fid + 5.0 ) ) ) ) );
  bloom = mix( bloom, 0.015, smoothstep( 0.006, 0.02, px ) );
  fig = mix( fig, vec3( 0.5, 0.05, 0.28 ), bloom );
  diffuseColor.rgb *= 1.0 - smoothstep( figEdge - 0.1, figEdge, matN ) * ( 1.0 - figCover ) * 0.15 * sourfig * coverNear;
  diffuseColor.rgb = mix( diffuseColor.rgb, fig, figCover );
  sandGlint *= 1.0 - figCover;
  figRelief = smoothstep( figEdge - 0.04, figEdge + 0.12, figN ) * ( 1.0 - bushCover ) * ( 0.012 + fingers * 0.008 ) * coverNear;
}
float lowCover = max( bushCover, figCover );
// Cat-scale clutter, one object per cell: pebbles and shells on the sand
// (thickest along the wrack line, with stranded kelp), fallen leaves and
// twigs under the trees. It fades out where an object would span less than
// a few pixels, so distant ground costs no more than before.
float nearDetail = 1.0 - smoothstep( 0.006, 0.014, px );
float clutterHeight = 0.0;
float clutterGloss = 0.0;
if ( nearDetail > 0.01 ) {
  float wrack = smoothstep( 0.7, 1.2, inland ) * ( 1.0 - smoothstep( 2.2, 3.4, inland ) );
  float sandy = smoothstep( 0.35, 0.9, inland ) * ( 1.0 - smoothstep( 6.0, 9.5, inland ) ) * ( 1.0 - rocky );
  if ( sandy > 0.01 ) {
    vec2 g = coast * 9.0;
    vec2 id = floor( g );
    vec2 f = fract( g );
    // Pebbles and shells gather in drifts; sizes are mostly small, a few large.
    float drift = dNoise( coast * 0.5 + 4.0 );
    if ( dHash( id + 3.7 ) < mix( 0.04, 0.24, wrack ) * drift * drift * 2.4 ) {
      vec2 c = 0.3 + 0.4 * vec2( dHash( id + 1.3 ), dHash( id + 7.9 ) );
      float ang = dHash( id + 5.1 ) * 6.283;
      vec2 q = mat2( cos( ang ), -sin( ang ), sin( ang ), cos( ang ) ) * ( f - c );
      float size = 0.04 + pow( dHash( id + 9.2 ), 2.5 ) * 0.26;
      float shell = step( 0.78, dHash( id + 2.2 ) );
      vec2 e = q / ( size * vec2( 1.0, mix( 0.72, 0.85, shell ) ) );
      float d = length( e );
      float cover = ( 1.0 - smoothstep( 0.82, 1.0, d ) ) * sandy * nearDetail * ( 1.0 - lowCover );
      // Beach pebbles: granite greys, iron browns, the odd pale quartz.
      float kind = dHash( id + 4.4 );
      vec3 pebble = kind < 0.45 ? mix( vec3( 0.22, 0.21, 0.2 ), vec3( 0.4, 0.38, 0.35 ), dHash( id + 8.8 ) )
        : kind < 0.85 ? mix( vec3( 0.3, 0.22, 0.15 ), vec3( 0.46, 0.36, 0.25 ), dHash( id + 8.8 ) )
        : vec3( 0.5, 0.48, 0.44 );
      pebble *= 0.85 + dNoise( g * 9.0 ) * 0.3;
      // Shells: a ribbed fan, cream to pink, darker at the hinge.
      float ribs = 0.78 + 0.22 * sin( atan( e.y, e.x + 1.2 ) * 22.0 );
      vec3 shellColour = mix( vec3( 0.86, 0.8, 0.7 ), vec3( 0.82, 0.56, 0.5 ), dHash( id + 6.6 ) ) * ribs * ( 0.75 + 0.25 * smoothstep( -1.0, 0.2, e.x ) );
      // A soft contact shadow round each one.
      diffuseColor.rgb *= 1.0 - ( 1.0 - smoothstep( 1.0, 1.35, d ) ) * step( 0.82, d ) * 0.3 * sandy * nearDetail;
      diffuseColor.rgb = mix( diffuseColor.rgb, mix( pebble, shellColour, shell ), cover );
      // Half-buried: a low dome, matte when dry.
      clutterHeight = cover * sqrt( max( 0.0, 1.0 - d * d ) ) * size * 0.025;
      clutterGloss = cover * mix( 0.0, 0.12, shell );
    }
  }
  float floorMix = max( litter, smoothstep( 9.0, 15.0, inland ) * 0.35 ) * ( 1.0 - rocky ) * ( 1.0 - grassy * 0.6 ) * ( 1.0 - lowCover ) * nearDetail;
  if ( floorMix > 0.02 ) {
    // Fallen leaves: pointed ovals, veined, in autumn browns to fresh green.
    vec2 g = coast * 13.0;
    vec2 id = floor( g );
    vec2 f = fract( g );
    if ( dHash( id + 8.1 ) < 0.6 ) {
      vec2 c = 0.3 + 0.4 * vec2( dHash( id + 2.9 ), dHash( id + 6.3 ) );
      float ang = dHash( id + 1.7 ) * 6.283;
      vec2 q = mat2( cos( ang ), -sin( ang ), sin( ang ), cos( ang ) ) * ( f - c );
      float len = 0.18 + dHash( id + 3.3 ) * 0.2;
      float halfWidth = len * 0.42 * ( 1.0 - pow( abs( q.x ) / len, 2.0 ) );
      float leaf = ( 1.0 - smoothstep( halfWidth * 0.8, halfWidth, abs( q.y ) ) ) * step( abs( q.x ), len ) * floorMix;
      float vein = 1.0 - smoothstep( 0.0, 0.012, abs( q.y ) ) * 0.25;
      vec3 leafColour = mix( mix( vec3( 0.12, 0.087, 0.055 ), vec3( 0.25, 0.21, 0.15 ), dHash( id + 4.8 ) ), vec3( 0.11, 0.14, 0.07 ), step( 0.92, dHash( id + 9.9 ) ) );
      diffuseColor.rgb = mix( diffuseColor.rgb, leafColour * vein * ( 0.8 + grain * 0.3 ), leaf * 0.9 );
      clutterHeight += leaf * 0.002;
    }
    // Twigs: one thin, slightly bent stick per 25 cm cell, sometimes none.
    vec2 t = coast * 4.0;
    vec2 tid = floor( t );
    vec2 tf = fract( t ) - 0.5;
    if ( dHash( tid + 12.3 ) < 0.45 ) {
      float ang = dHash( tid + 4.1 ) * 3.1416;
      vec2 axis = vec2( cos( ang ), sin( ang ) );
      float along = clamp( dot( tf, axis ), -0.38, 0.38 );
      vec2 nearest = axis * along + vec2( -axis.y, axis.x ) * along * along * 0.4;
      float width = 0.016 + dHash( tid + 7.7 ) * 0.02;
      float twig = ( 1.0 - smoothstep( width * 0.6, width, length( tf - nearest ) ) ) * floorMix;
      diffuseColor.rgb = mix( diffuseColor.rgb * ( 1.0 - ( 1.0 - smoothstep( width, width * 2.5, length( tf - nearest ) ) ) * 0.25 * floorMix ), vec3( 0.2, 0.13, 0.08 ), twig );
      clutterHeight += twig * 0.006;
    }
  }
}
float detailHeight = grain * 0.004 + ( ripple * 0.012 + fine * 0.006 * ripFade ) * dry * ( 1.0 - grassy ) * ( 1.0 - lowCover ) + mottled * 0.03 * ( 1.0 - wet ) + rocky * strata * 0.08 + clutterHeight + sward * 0.02
  + bushDome + figRelief;
float detailRoughness = mix( mix( mix( mix( 0.95, 0.9, rocky ), 0.8, bushCover ), 0.28, wet ), 0.35, clutterGloss );
detailRoughness = mix( detailRoughness, 0.55, damp ); // land-look: the damp band's sheen
detailRoughness = mix( detailRoughness, 0.55, figCover );
// The swash (surf.js, on the sea's clock): each bore's film runs up the sand
// and drains back, froth at its front and lace left in the backwash, little
// bubbles popping in it, the swash mark at the top, and sand that stays dark
// and glossy for a few seconds as it drains. The film mirrors the sky.
float swashFilm = 0.0;
float swashCover = 0.0;
float swashGlow = 0.0;
if ( inland < 4.5 ) {
  float along = shoreAlong( coast );
  float pixel = length( fwidth( coast ) );
  vec4 sw = swash( along, inland, breezeTime, pixel );
  swashFilm = sw.x;
  // land-look: foam is not an even web. Thick and creamy in a band at the
  // running edge; behind it, as the film thins and drains back, it breaks
  // into rafts and drawn-out streaks along the backwash, with open water
  // between them.
  float foamLead = exp( -sw.w * 7.0 );
  float foamRafts = smoothstep( 0.32, 0.72, swashValue( vec2( along * 0.32, inland * 0.55 ) + vec2( breezeTime * 0.04, 0.0 ) ) * 0.7
    + swashValue( vec2( along * 1.1, inland * 1.6 ) + 9.0 ) * 0.3 );
  float foamStreaks = swashValue( vec2( along * 5.0, inland * 0.45 - breezeTime * 0.25 ) + 3.0 );
  float foamDensity = sw.y * mix( ( 0.15 + 1.05 * foamRafts ) * ( 0.45 + 0.8 * foamStreaks ), 1.35, foamLead );
  swashCover = swashFoam( vec2( along * 0.7, inland ), foamDensity, breezeTime, pixel );
  // Bubbles ride in the froth and just behind the front, and dot the film.
  vec2 bubbles = swashBubbles( coast, breezeTime, pixel, smoothstep( 0.04, 0.35, sw.y + sw.x * 0.12 ) );
  // Sand the swash has soaked darkens like the band below it, no further:
  // a few centimetres of clear film over it barely absorb, and only tint
  // it toward aqua where the film thickens behind the front.
  diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 0.55, 0.55, 0.53 ), sw.z * ( 1.0 - wet ) * 0.9 );
  diffuseColor.rgb *= mix( vec3( 1.0 ), vec3( 0.9, 0.98, 1.0 ), swashFilm * smoothstep( 0.0, 0.8, sw.w ) );
  swashCover = max( swashCover, bubbles.x );
  // The cat standing in the film: froth collars each wet leg and trails
  // downstream as the water runs past (wake.wgsl draws the same in the sea,
  // but here the sand covers it).
  if ( catFlow.w > 0.5 && swashFilm > 0.05 && distance( coast, catLegs[ 0 ].xy ) < 1.4 ) {
    float pace = catFlow.z;
    for ( int j = 0; j < 4; j++ ) {
      vec4 leg = catLegs[ j ];
      if ( leg.z <= 0.003 ) continue;
      vec2 q = coast - leg.xy;
      float edge = length( q ) - 0.025;
      float cling = exp( -max( edge, 0.0 ) / ( 0.02 + pace * 0.03 + min( pace, 0.6 ) * 0.05 ) );
      float u = dot( q, catFlow.xy );
      float v = dot( q, vec2( catFlow.y, -catFlow.x ) );
      float w = 0.02 + max( u, 0.0 ) * 0.28;
      float furrow = exp( -v * v / ( w * w ) ) * exp( -max( u, 0.0 ) / ( 0.06 + 0.2 * pace ) ) * smoothstep( -0.02, 0.03, u ) * smoothstep( 0.08, 0.6, pace );
      swashCover = max( swashCover, swashFilm * max( cling * 0.8, furrow * 0.75 ) );
    }
  }
  // The crisp white roll of froth at the bore's leading edge. It rides the
  // film smoothly: no bump, or its thin edges would shade it grey.
  float lace = swashCover;
  swashCover = max( swashCover, swashLine( along, inland, sw, breezeTime, pixel ) );
  // At night the uprush lights the plankton it carries (ocean.wgsl).
  if ( nightGlow > 0.01 ) {
    float bloom = smoothstep( 0.25, 0.7, dNoise( coast * 0.018 + vec2( breezeTime * 0.003, 3.7 ) ) );
    // Single cells flashing: round points, each at its own moment.
    vec2 gq = coast * 22.0;
    vec2 gc = floor( gq );
    float flick = dHash( gc + floor( breezeTime * 6.0 + dHash( gc ) * 6.0 ) );
    vec2 at = vec2( dHash( gc + 3.1 ), dHash( gc + 7.7 ) );
    float spot = 1.0 - smoothstep( 0.05, 0.2, length( fract( gq ) - 0.2 - at * 0.6 ) );
    float spark = step( 0.965, flick ) * spot * ( 0.3 + 0.7 * fract( flick * 37.1 ) ) * ( 1.0 - smoothstep( 0.015, 0.05, pixel ) );
    swashGlow = sw.y * sw.x * bloom * nightGlow * ( 0.1 + 0.9 * swashCover + spark * 7.0 );
  }
  // Fresh foam is the brightest thing on the beach: bubbles scatter nearly
  // all the light they take.
  diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.8, 0.82, 0.83 ), swashCover );
  detailHeight *= 1.0 - swashFilm * 0.9;
  // The film's own wavelets, a few millimetres high: they break its mirror
  // into moving sparkles. Only where a pixel resolves them.
  float nearFilm = swashFilm * ( 1.0 - smoothstep( 0.01, 0.04, pixel ) );
  if ( nearFilm > 0.0 ) detailHeight += nearFilm * dNoise( vec2( along * 6.0, inland * 9.0 + breezeTime * 1.3 ) ) * 0.0025;
  // No relief from the lace: its threads are near a pixel wide, and the
  // derivative bump turned them into stair-stepped dashes on the mirror.
  // Freshly drained sand is glassy for a few seconds (a film in the pores
  // mirrors the sky), then dulls as it drains while staying dark.
  float glassy = sw.z * sw.z * sw.z * sw.z;
  detailRoughness = mix( detailRoughness, 0.25, sw.z );
  detailRoughness = mix( detailRoughness, 0.07, glassy );
  detailRoughness = mix( detailRoughness, 0.04, swashFilm * ( 1.0 - swashCover ) );
  // Froth is a rough scatterer, not a mirror: only its bubbles glint.
  detailRoughness = mix( detailRoughness, 0.7, swashCover );
  detailRoughness = mix( detailRoughness, 0.02, bubbles.y );
}
`;

// Cape granite, in true 3D noise (2D noise projected onto a boulder smears
// into streaks). Tone: broad weathering patches, iron stain running down
// from joints, a dark patina in the hollows, fine cracks. Grain up close:
// pale feldspar crystals, glassy grey quartz and black biotite flecks.
// Above the spray, grey-green and orange lichen crusts; lower down the
// shore's zonation: a black splash band, barnacles, and green algae where
// the sea covers it, the wet line rising and draining with each swell on
// the swash clock (surf.js). Everything finer than the pixel is averaged.
const ROCK_COLOUR_GLSL = /* glsl */ `
#include <color_fragment>
vec3 q = vec3( vWorld.x, vWorld.y, -vWorld.z );
vec2 coast = q.xz;
float footprint = max( max( fwidth( q.x ), fwidth( q.y ) ), fwidth( q.z ) );
float up = max( ( vec4( normalize( vNormal ), 0.0 ) * viewMatrix ).y, 0.0 );
// One stack of noise octaves: the first two are the broad weathering tone,
// the next two the mid-scale detail. Each fades to its mean once finer than
// ~2 pixels.
mat3 turn3 = mat3( 0.0, 0.8, 0.6, -0.8, 0.36, -0.48, -0.6, -0.48, 0.64 );
float macro = dNoise3( q * 0.45 ) * 0.65 + dNoise3( turn3 * q * 0.93 + 1.7 ) * 0.35;
float mid = mix( dNoise3( q * 2.1 + 5.0 ), 0.5, smoothstep( 0.2, 0.5, footprint * 2.1 ) ) * 0.6
  + mix( dNoise3( turn3 * q * 4.3 + 3.3 ), 0.5, smoothstep( 0.2, 0.5, footprint * 4.3 ) ) * 0.4;
// Weathered, pitted relief at a few centimetres: the surface a hand feels.
// Only within ~10 m, where it can be seen.
float relief = 0.5;
if ( footprint < 0.02 ) {
  relief = mix( dNoise3( q * 9.0 + 2.0 ) * 0.6 + dNoise3( turn3 * q * 19.0 ) * 0.4, 0.5, smoothstep( 0.2, 0.5, footprint * 19.0 ) );
}
diffuseColor.rgb *= 0.66 + macro * 0.6 + ( mid - 0.5 ) * 0.24 + ( relief - 0.5 ) * 0.12;
// Iron-oxide staining: warm streaks drawn down the flanks from above.
float iron = smoothstep( 0.52, 0.78, dNoise3( vec3( q.x * 1.3, q.y * 0.3, q.z * 1.3 ) + 3.0 ) ) * smoothstep( 0.35, 0.65, macro );
diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 1.3, 0.98, 0.72 ), iron * 0.45 );
// Dark water streaks: rain draining off the crown leaves grey-black runs of
// cyanobacteria down the steep flanks, a hand wide, ragged at the ends.
float drip = smoothstep( 0.56, 0.86, dNoise3( vec3( q.x * 2.1 + q.z * 1.5, q.y * 0.22, q.z * 2.1 - q.x * 1.5 ) + 8.0 ) + ( mid - 0.5 ) * 0.2 )
  * ( 1.0 - smoothstep( 0.35, 0.8, up ) );
diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 0.6, 0.6, 0.6 ), drip * 0.5 );
// Patina: undersides and hollows darken where rain and light don't reach.
diffuseColor.rgb *= mix( 0.72, 1.0, smoothstep( 0.0, 0.5, up + mid * 0.3 ) );
// land-look: granite character at the boulder's own scale (its macro tone
// was one blotch per stone, so every boulder read as one smooth grey):
// weathered blotches a hand to a metre across, some warmer and buff where
// feldspar has rotted, some cooler and grey; dark rain streaks fanning down
// every steep flank from the crown; a damp, darker skirt at the foot.
{
  float blot = dNoise3( turn3 * q * 1.4 + 9.0 ) * 0.6 + mix( dNoise3( q * 3.3 + 2.0 ), 0.5, smoothstep( 0.2, 0.5, footprint * 3.3 ) ) * 0.4;
  diffuseColor.rgb *= 0.58 + blot * 0.84;
  float hue = dNoise3( q * 0.8 + 21.0 );
  diffuseColor.rgb *= mix( vec3( 0.93, 0.96, 1.02 ), vec3( 1.1, 1.0, 0.86 ), smoothstep( 0.3, 0.75, hue ) );
  vec3 runQ = vec3( q.x * 3.4 + q.z * 1.1, q.y * 0.28, q.z * 3.4 - q.x * 1.1 );
  float runs = smoothstep( 0.42, 0.78, mix( dNoise3( runQ + 13.0 ), 0.5, smoothstep( 0.2, 0.5, footprint * 3.4 ) ) )
    * ( 1.0 - smoothstep( 0.25, 0.75, up ) );
  diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 0.48, 0.47, 0.45 ), runs * 0.75 );
  // Crustose lichen: pale grey rosettes a few centimetres across on the
  // upper faces, the speckle that makes granite read as stone at a glance.
  float crust = smoothstep( 0.66, 0.72, mix( dNoise3( q * 12.0 + 31.0 ), 0.5, smoothstep( 0.2, 0.5, footprint * 12.0 ) ) );
  diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 1.25, 1.25, 1.18 ), crust * 0.5 * smoothstep( 0.3, 0.7, up ) );
  float skirt = 1.0 - smoothstep( 0.04, 0.5 + ( blot - 0.5 ) * 0.4, vRockAbove );
  diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 0.6, 0.62, 0.56 ), skirt * 0.75 );
}
// Joint cracks and exfoliation seams: thin dark lines, faded with distance.
float seam = 0.0;
if ( footprint < 0.04 ) {
  float crackWidth = 0.0035 + footprint * 0.6;
  seam = 1.0 - smoothstep( 0.0, crackWidth, abs( dNoise3( q * 0.8 + 11.0 ) + ( mid - 0.5 ) * 0.08 - 0.5 ) );
  // Broken into short runs, not endless arcs.
  seam *= smoothstep( 0.5, 0.6, mid ) * ( 1.0 - smoothstep( 0.015, 0.04, footprint ) ) * smoothstep( 0.5, 0.62, macro * 0.7 + mid * 0.3 ) * smoothstep( 0.3, 0.6, relief + mid * 0.3 );
}
diffuseColor.rgb *= 1.0 - seam * 0.16;
// Grain: coarse porphyritic granite, feldspar crystals a centimetre or two.
float grainFade = 1.0 - smoothstep( 0.006, 0.018, footprint ); // land-look: crisper, further
float feldspar = 0.0;
float biotite = 0.0;
float quartz = 0.0;
if ( grainFade > 0.01 ) {
  // Pale feldspar: soft, weathered crystals a couple of centimetres
  // across (two rotated lattices averaged: one alone leaves square ones).
  float g1 = dNoise3( q * 38.0 );
  float g2 = dNoise3( turn3 * q * 38.0 + 1.3 );
  float f2 = 0.5 + ( g1 + g2 - 1.0 ) * 0.85;
  feldspar = smoothstep( 0.55, 0.85, f2 ) * grainFade;
  // Glassy grey quartz grains (~8 mm) and black biotite flakes (~3 mm):
  // one rounded grain at a random spot in each small cell, so they read as
  // salt-and-pepper crystals, not as thresholded noise (that printed a
  // camouflage of worm-shaped blotches centimetres across).
  quartz = rockGrain( turn3 * q * 70.0, 2.7, 0.3, 0.6, footprint * 70.0 ) * grainFade;
  biotite = rockGrain( q * 120.0, 5.3, 0.2, 0.45, footprint * 120.0 ) * grainFade;
  diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 1.09, 1.07, 1.04 ), feldspar );
  diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 0.8, 0.82, 0.86 ), quartz );
  diffuseColor.rgb *= 1.0 - biotite * 0.6;
}
// Far away the grain's mean: the crystals lighten the rock a little overall.
diffuseColor.rgb *= mix( 1.03, 1.0, grainFade );
// The shore's zones, by height above the sea, and only where the sea
// reaches: a boulder up the beach is above the spray, not wet granite
// with barnacles. Inland its zones climb out of reach, leaving lichen.
float rockInland = dShore( coast );
float seaReach = 1.0 - smoothstep( 1.2, 4.5, rockInland + ( macro - 0.5 ) * 0.8 );
float y = q.y + ( mid - 0.5 ) * 0.25 + ( 1.0 - seaReach ) * 1.8;
// Lichen crusts above the spray: grey-green crusts and orange Xanthoria.
// Crusts: ragged-edged patches a hand or two across. Xanthoria grows in
// lobed, fuzzy-edged colonies where birds perch and the crusts are, each
// thinning at its margin; far off they average to a faint warm tint.
float lichenZone = smoothstep( 0.9, 1.6, y ) * smoothstep( 0.3, 0.8, up );
float lichen = 0.0;
float orange = 0.0;
float fray = 0.5;
if ( lichenZone > 0.01 ) {
  float rosette = mid * 0.7 + macro * 0.3;
  fray = mix( dNoise3( q * 17.0 ), 0.5, smoothstep( 0.2, 0.5, footprint * 17.0 ) );
  lichen = smoothstep( 0.57, 0.66, rosette + ( fray - 0.5 ) * 0.16 ) * lichenZone;
  float colonies = smoothstep( 0.45, 0.75, rosette ) * lichenZone;
  float lobes = mix( dNoise3( q * 5.0 + 7.0 ), 0.5, smoothstep( 0.2, 0.5, footprint * 5.0 ) ) * 0.6
    + mix( dNoise3( turn3 * q * 11.0 + 2.0 ), 0.5, smoothstep( 0.2, 0.5, footprint * 11.0 ) ) * 0.28
    + ( fray - 0.5 ) * 0.24;
  float margin = 0.03 + footprint * 2.0;
  orange = smoothstep( 0.72 - colonies * 0.12, 0.72 - colonies * 0.12 + margin, lobes + 0.12 ) * colonies;
  // Thin, patchy thallus toward the margin: the rock shows through.
  orange *= 0.55 + 0.45 * smoothstep( 0.35, 0.65, fray );
}
diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.38, 0.4, 0.33 ) * ( 0.8 + mid * 0.4 ), lichen * 0.28 );
diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.5, 0.31, 0.1 ) * ( 0.85 + fray * 0.3 ), orange * 0.55 );
// Black splash-zone lichen (Verrucaria): a dark band of nearly even tone
// whose top edge is ragged, not a print of blotches.
float splash = smoothstep( 0.15, 0.45, y ) * ( 1.0 - smoothstep( 0.75, 1.1, y + ( macro - 0.5 ) * 0.5 + ( mid - 0.5 ) * 0.15 ) );
diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.05, 0.05, 0.045 ), splash * ( 0.35 + 0.2 * macro ) );
// Barnacles: pale, rough, crowded just above the low-water line.
float barnacleZone = smoothstep( 0.0, 0.12, y ) * ( 1.0 - smoothstep( 0.35, 0.6, y ) );
float barnacles = 0.0;
if ( barnacleZone > 0.01 && footprint < 0.02 ) {
  barnacles = smoothstep( 0.58, 0.8, dNoise3( q * 55.0 ) ) * smoothstep( 0.35, 0.6, dNoise3( q * 4.0 + 1.0 ) )
    * barnacleZone * ( 1.0 - smoothstep( 0.005, 0.015, footprint ) );
}
diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.46, 0.44, 0.4 ), barnacleZone * 0.25 );
diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.62, 0.6, 0.55 ), barnacles * 0.35 );
// Green algae and weed at and below the waterline, thinning upward.
float algae = ( 1.0 - smoothstep( -0.1, 0.3, y ) ) * smoothstep( 0.3, 0.55, mid + relief * 0.3 );
diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.09, 0.12, 0.05 ) * ( 0.7 + mid * 0.6 ), algae * 0.6 );
// Swash on the rock, on the sea's clock: a sheet of water running up and
// draining, and damp rock below the highest run-up.
float surgeS = fract( -swashPhase( shoreAlong( coast ), breezeTime ) / 6.283185 ) / 0.82;
float surgeNow = surgeS < 1.0 ? pow( sin( 3.141593 * pow( surgeS, 0.65 ) ), 2.0 ) : 0.0;
// The sheet runs up no more than ~0.6 m even in a storm (the spray above is
// the surf's), and only its lower part is continuous: higher up it drains
// at once, lingering in hollows and running off in streaks.
float runup = min( 0.12 + ( 0.22 + swell.w * 1.2 ) * surgeNow, 0.6 );
float sheet = 1.0 - smoothstep( runup - 0.15, runup + 0.05, y + ( relief - 0.5 ) * 0.1 );
float hollow = 1.0 - smoothstep( 0.32, 0.58, mid * 0.55 + relief * 0.45 );
float streak = y < runup + 0.1 ? smoothstep( 0.5, 0.8, dNoise3( vec3( q.x * 5.6 + q.z * 4.2, q.y * 0.7, q.z * 5.6 - q.x * 4.2 ) + 4.0 ) ) * ( 1.0 - up ) : 0.0;
sheet *= mix( 1.0, max( hollow, streak ), smoothstep( 0.08, 0.3, y ) );
// Damp rock below the highest recent run-up, a ragged line.
float damp = 1.0 - smoothstep( 0.2, min( 0.55 + swell.w * 1.2, 0.95 ), y + ( macro - 0.5 ) * 0.2 );
diffuseColor.rgb *= mix( 1.0, 0.8, damp * ( 1.0 - sheet ) );
diffuseColor.rgb *= mix( 1.0, 0.65, sheet );
// Sand drifted against the foot: the beach laps a few centimetres up every
// boulder, highest on the side the prevailing wind piles it, with a soft
// ragged edge, so the stone sits in the sand instead of on it.
float rockSandy = smoothstep( 0.6, 1.8, rockInland ) * ( 1.0 - smoothstep( 8.0, 12.0, rockInland ) );
float drift = 0.0;
if ( rockSandy > 0.01 && vRockAbove < 0.3 ) {
  vec3 nWorld = ( vec4( normalize( vNormal ), 0.0 ) * viewMatrix ).xyz;
  vec2 nCoast = vec2( nWorld.x, -nWorld.z );
  float windward = clamp( -dot( nCoast, breezeDir ) / max( length( nCoast ), 0.05 ), 0.0, 1.0 );
  float driftTop = 0.012 + 0.045 * windward * windward + ( relief - 0.5 ) * 0.02 + ( mid - 0.5 ) * 0.02
    + ( mix( dNoise3( q * 23.0 ), 0.5, smoothstep( 0.2, 0.5, footprint * 23.0 ) ) - 0.5 ) * 0.015;
  drift = ( 1.0 - smoothstep( driftTop - 0.015, driftTop + 0.004, vRockAbove ) ) * rockSandy;
  vec3 sandTone = mix( vec3( 0.41, 0.36, 0.26 ), vec3( 0.29, 0.24, 0.16 ), smoothstep( 4.0, 9.0, rockInland ) );
  diffuseColor.rgb = mix( diffuseColor.rgb, sandTone * ( 0.85 + relief * 0.3 ), drift );
}
float detailHeight = macro * 0.05 + mid * 0.018 + relief * 0.022 + feldspar * 0.0006 - biotite * 0.0004 - seam * 0.006 + barnacles * 0.0015 + lichen * 0.002;
float detailRoughness = mix( mix( mix( 0.82, 0.95, max( barnacles, lichen ) ), 0.55, damp ), 0.32, sheet );
detailRoughness = mix( detailRoughness, 0.95, drift );
detailHeight = mix( detailHeight, relief * 0.006, drift );
detailHeight *= 1.0 - sheet * 0.3;
`;

// Bark: vertical fissures between corky plates, the plates' faces paler
// and weathered, the fissures dark and deep; world-space, so a tree's
// branches share one continuous pattern. Moss and green algae grow on the
// upper, damper side of limbs and up the trunk's shaded foot; pale lichen
// crusts patch the rest. Detail finer than a pixel averages out.
const BARK_COLOUR_GLSL = /* glsl */ `
#include <color_fragment>
// In trunk space (vBark: the point on the stem's circle, in metres, and the
// distance along its axis), in 3D noise so the pattern wraps round the stem
// without a seam. The old world-plane projection drew white rings and
// chevrons wherever a limb crossed the plane's stripes.
vec3 barkP = vBark;
float barkPx = max( length( fwidth( barkP.xy ) ), fwidth( barkP.z ) );
// Fissures run along the stem: narrow round it, long along it.
float fissure = dNoise3( vec3( barkP.xy * 24.0, barkP.z * 3.2 ) ) * 0.62
  + mix( dNoise3( vec3( barkP.xy * 55.0 + 3.0, barkP.z * 9.0 ) ), 0.5, smoothstep( 0.2, 0.5, barkPx * 55.0 ) ) * 0.38;
float plates = smoothstep( 0.34, 0.6, fissure );
float crack = 1.0 - smoothstep( 0.2, 0.34, fissure );
diffuseColor.rgb *= 0.62 + plates * 0.5;
diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * 0.4, crack * 0.75 );
// Weathered plate faces go a little grey.
diffuseColor.rgb = mix( diffuseColor.rgb, vec3( dot( diffuseColor.rgb, vec3( 0.33 ) ) ), plates * 0.12 );
vec3 barkUp = ( vec4( normalize( vNormal ), 0.0 ) * viewMatrix ).xyz;
float moss = smoothstep( 0.25, 0.8, barkUp.y + ( dNoise3( vec3( barkP.xy * 4.0, barkP.z * 1.2 ) + 9.0 ) - 0.5 ) * 0.9 )
  * smoothstep( 0.35, 0.65, dNoise3( vec3( barkP.xy * 1.5, barkP.z * 0.5 ) + 3.0 ) );
diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.06, 0.09, 0.03 ) * ( 0.7 + fissure * 0.6 ), moss * 0.55 );
// Crustose lichen in ragged patches on about a quarter of the bark: grey-
// green, only a little paler than the bark itself.
float lichenPatch = dNoise3( vec3( barkP.xy * 7.0, barkP.z * 2.2 ) + 5.0 ) * 0.7
  + mix( dNoise3( vec3( barkP.xy * 30.0, barkP.z * 9.0 ) ), 0.5, smoothstep( 0.2, 0.5, barkPx * 30.0 ) ) * 0.3;
float bark_lichen = smoothstep( 0.55, 0.64, lichenPatch ) * ( 1.0 - moss ) * ( 1.0 - crack * 0.7 );
diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.13, 0.14, 0.11 ) * ( 0.85 + fissure * 0.3 ), bark_lichen * 0.55 );
float detailHeight = plates * 0.01 - crack * 0.006 + moss * 0.003 + bark_lichen * 0.0015;
float detailRoughness = 0.92;
`;

const DETAIL_GLSL = /* glsl */ `
varying vec3 vWorld;
${GUST_GLSL}
float dHash( vec2 p ) {
  vec3 q = fract( vec3( p.xyx ) * 0.1031 );
  q += dot( q, q.yzx + 33.33 );
  return fract( ( q.x + q.y ) * q.z );
}
float dNoise( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = fract( p );
  vec2 u = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( dHash( i ), dHash( i + vec2( 1.0, 0.0 ) ), u.x ),
    mix( dHash( i + vec2( 0.0, 1.0 ) ), dHash( i + vec2( 1.0, 1.0 ) ), u.x ), u.y );
}
// perf: noise faded to its mean (0.5) by \`fade\` (1 = averaged away) is
// only evaluated where some of it still shows: far ground skips the octaves
// it would have blended out anyway, with the same result.
float dNoiseFade( vec2 p, float fade ) {
  return fade < 1.0 ? mix( dNoise( p ), 0.5, fade ) : 0.5;
}
float dHash3( vec3 p ) {
  p = fract( p * 0.1031 );
  p += dot( p, p.zyx + 31.32 );
  return fract( ( p.x + p.y ) * p.z );
}
float dNoise3( vec3 p ) {
  vec3 i = floor( p );
  vec3 f = fract( p );
  vec3 u = f * f * ( 3.0 - 2.0 * f );
  return mix(
    mix( mix( dHash3( i ), dHash3( i + vec3( 1, 0, 0 ) ), u.x ), mix( dHash3( i + vec3( 0, 1, 0 ) ), dHash3( i + vec3( 1, 1, 0 ) ), u.x ), u.y ),
    mix( mix( dHash3( i + vec3( 0, 0, 1 ) ), dHash3( i + vec3( 1, 0, 1 ) ), u.x ), mix( dHash3( i + vec3( 0, 1, 1 ) ), dHash3( i + vec3( 1, 1, 1 ) ), u.x ), u.y ),
    u.z );
}
// One rounded grain per unit cell at a random spot, kept in a share
// (keep) of cells; cycles is cells per pixel, which blurs it to its mean.
float rockGrain( vec3 p, float seed, float radius, float keep, float cycles ) {
  vec3 cell = floor( p );
  vec3 at = vec3( dHash3( cell + seed ), dHash3( cell + seed + 7.1 ), dHash3( cell + seed + 3.3 ) ) - 0.5;
  float d = length( fract( p ) - 0.5 - at * 0.4 );
  // Crystals come in all sizes: a few large, many small.
  radius *= 0.45 + 1.1 * dHash3( cell + seed + 5.7 ) * dHash3( cell + seed + 9.1 ) * 2.0;
  float aa = 0.04 + cycles * 1.5;
  float on = step( dHash3( cell + seed + 1.9 ), keep );
  return mix( on * ( 1.0 - smoothstep( radius - aa, radius + aa, d ) ), keep * 3.0 * radius * radius, smoothstep( 0.25, 0.6, cycles ) );
}
// Signed shore distance, matching terrain.js (positive inland).
float dShore( vec2 p ) {
  vec2 d = p - vec2( 58.0, 70.0 );
  float t = atan( d.y, d.x );
  return 62.0 + 14.0 * sin( 2.0 * t + 0.8 ) + 7.0 * sin( 3.0 * t + 2.1 ) + 3.5 * sin( 7.0 * t + 4.5 ) - length( d );
}
`;

// land-look: grounding, shared by the landmarks and the animals. One read of
// the ground field (groundFieldTexture) at the start of the fragment gives
// the height above the real terrain (groundingH, for any material's own
// use) and the ground's colour; before the lights:
// - drift: sand or soil banked a few centimetres up the foot, its edge
//   ragged, so a thing sits in the ground rather than on it;
// - dust: the ground's colour picked up a hand's breadth higher;
// - contact: the foot's sides see little sky (indirect light only; the
//   sun's shadow is the shadow map's);
// - bounce: the ground's own brightness lighting sides and undersides;
// and with GROUNDING_SEA (landmarks, not animals, which carry their own
// wet coats) the sea's reach from the real sea level: a dark, glossy wet
// band with weed low down, and where a thing stands in the water a thin
// broken lace of foam at the surface.
// The ground's albedo is stored as luminance and a soil-to-sand mix.
const chromaticity = (c) => {
  const l = c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
  return c.map((v) => v / l);
};
const SOIL_TINT = chromaticity(MATERIAL_LINEAR.litter);
const SAND_GROUND_TINT = chromaticity(MATERIAL_LINEAR.sand);
const GROUNDING_PARS_GLSL = /* glsl */ `
uniform sampler2D groundField;
uniform vec4 groundRect;
varying vec3 vGrounding;
float groundingHash( vec3 p ) {
  p = fract( p * 0.1031 );
  p += dot( p, p.zyx + 31.32 );
  return fract( ( p.x + p.y ) * p.z );
}
float groundingNoise( vec3 p ) {
  vec3 i = floor( p );
  vec3 f = fract( p );
  vec3 u = f * f * ( 3.0 - 2.0 * f );
  return mix(
    mix( mix( groundingHash( i ), groundingHash( i + vec3( 1, 0, 0 ) ), u.x ), mix( groundingHash( i + vec3( 0, 1, 0 ) ), groundingHash( i + vec3( 1, 1, 0 ) ), u.x ), u.y ),
    mix( mix( groundingHash( i + vec3( 0, 0, 1 ) ), groundingHash( i + vec3( 1, 0, 1 ) ), u.x ), mix( groundingHash( i + vec3( 0, 1, 1 ) ), groundingHash( i + vec3( 1, 1, 1 ) ), u.x ), u.y ),
    u.z );
}
`;
const GROUNDING_FETCH_GLSL = /* glsl */ `
  vec4 groundingField = texture2D( groundField, ( vec2( vGrounding.x, -vGrounding.z ) - groundRect.xy ) * groundRect.zw );
  float groundingH = vGrounding.y - groundingField.r;
  float groundingAO = 1.0;
  float groundingBounce = 1.0;
`;
const GROUNDING_SURFACE_GLSL = /* glsl */ `
{
  float gPx = max( length( fwidth( vGrounding ) ), 1e-4 );
  float gFine = mix( groundingNoise( vGrounding * 9.0 ), 0.5, smoothstep( 0.25, 0.6, gPx * 9.0 ) );
  float gBroad = groundingNoise( vGrounding * vec3( 1.6, 0.7, 1.6 ) + 3.0 );
  vec3 gAlbedo = mix( vec3( ${SOIL_TINT.map((v) => v.toFixed(3)).join(", ")} ), vec3( ${SAND_GROUND_TINT.map((v) => v.toFixed(3)).join(", ")} ), groundingField.a ) * groundingField.b;
  vec3 gNormal = normalize( ( vec4( normal, 0.0 ) * viewMatrix ).xyz );
  float gTop = 0.005 + 0.09 * gBroad * gBroad + ( gFine - 0.5 ) * 0.05;
  float gDrift = ( 1.0 - smoothstep( gTop - 0.025, gTop + 0.006, groundingH ) ) * 0.85;
  float gDust = ( 1.0 - smoothstep( 0.0, 0.22 + 0.2 * gBroad, groundingH ) ) * 0.3;
  diffuseColor.rgb = mix( diffuseColor.rgb, mix( diffuseColor.rgb, gAlbedo, 0.6 ), gDust );
  diffuseColor.rgb = mix( diffuseColor.rgb, gAlbedo * ( 0.7 + 0.35 * gFine ), gDrift );
  roughnessFactor = mix( roughnessFactor, 0.95, gDrift );
  // Contact: faces turned up still see the sky; the sides and undersides
  // of the foot do not.
  groundingAO = mix( 1.0, mix( 0.5, 1.0, smoothstep( 0.0, 0.45, groundingH ) ), 1.0 - 0.8 * max( gNormal.y, 0.0 ) );
  groundingAO = mix( groundingAO, max( groundingAO, 0.85 ), gDrift );
  // Bounce: the land's ambient assumes the island's mean albedo (~0.2)
  // below the horizon; pale sand returns two or three times that onto the
  // sides and undersides of whatever stands on it, dark soil less.
  groundingBounce = 1.0 + ( clamp( groundingField.b / 0.2, 0.4, 3.0 ) - 1.0 ) * 0.6 * ( 0.5 - 0.5 * gNormal.y );
  #ifdef GROUNDING_SEA
    float gSea = vGrounding.y + ( gBroad - 0.5 ) * 0.2;
    float gWet = ( 1.0 - smoothstep( 0.15, 0.45, gSea ) ) * ( 1.0 - gDrift );
    float gWeed = smoothstep( 0.55, 0.7, gBroad + ( gFine - 0.5 ) * 0.3 ) * ( 1.0 - smoothstep( 0.05, 0.35, gSea ) ) * gWet;
    diffuseColor.rgb *= mix( 1.0, 0.62, gWet );
    diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.05, 0.08, 0.03 ), gWeed * 0.55 );
    roughnessFactor = mix( roughnessFactor, 0.42, gWet * ( 1.0 - gWeed * 0.5 ) );
    float gLine = abs( vGrounding.y - 0.07 - 0.03 * sin( breezeTime * 1.1 + vGrounding.x * 0.9 - vGrounding.z * 0.7 ) );
    float gLace = ( 1.0 - smoothstep( 0.012, 0.045, gLine ) ) * smoothstep( 0.35, 0.6, gFine ) * ( 1.0 - smoothstep( -0.05, 0.1, groundingField.r ) );
    diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.78, 0.8, 0.8 ), gLace * 0.85 );
    roughnessFactor = mix( roughnessFactor, 0.7, gLace );
  #endif
}
`;
const GROUNDING_LIGHT_GLSL = /* glsl */ `
reflectedLight.indirectDiffuse *= groundingAO * groundingBounce;
reflectedLight.indirectSpecular *= mix( 1.0, groundingAO, 0.6 );
`;

// Adds the grounding to a material's shader (inside onBeforeCompile).
function groundShader(shader, shared, sea) {
  shader.uniforms.groundField = shared.groundField;
  shader.uniforms.groundRect = shared.groundRect;
  shader.vertexShader = shader.vertexShader
    .replace("void main() {", "varying vec3 vGrounding;\nvoid main() {")
    .replace(
      "#include <worldpos_vertex>",
      `#include <worldpos_vertex>
      {
        vec4 groundingWorld = vec4( transformed, 1.0 );
        #ifdef USE_INSTANCING
          groundingWorld = instanceMatrix * groundingWorld;
        #endif
        vGrounding = ( modelMatrix * groundingWorld ).xyz;
      }`,
    );
  shader.fragmentShader = (sea ? "#define GROUNDING_SEA\n" : "") + shader.fragmentShader
    .replace("void main() {", `${GROUNDING_PARS_GLSL}\nvoid main() {\n${GROUNDING_FETCH_GLSL}`)
    .replace("#include <emissivemap_fragment>", `${GROUNDING_SURFACE_GLSL}\n#include <emissivemap_fragment>`)
    .replace("#include <lights_fragment_end>", `#include <lights_fragment_end>\n${GROUNDING_LIGHT_GLSL}`);
}

// The animals (animal-forms.js animalMaterial, recognised by their program
// key) take the same grounding, without the sea's (their coats carry their
// own wet). Wraps each material's onBeforeCompile once.
export function groundAnimals(root, shared) {
  root.traverse((o) => {
    const m = o.material;
    // Bodies only: not their contact blobs or spray (transparent).
    if (!m || Array.isArray(m) || m.userData.grounded || m.transparent || !m.isMeshStandardMaterial || !m.customProgramCacheKey?.call(m).startsWith("animal-")) return;
    m.userData.grounded = true;
    const before = m.onBeforeCompile;
    const key = m.customProgramCacheKey;
    m.onBeforeCompile = function (shader, renderer) {
      before.call(this, shader, renderer);
      groundShader(shader, shared, false);
    };
    m.customProgramCacheKey = function () {
      return `${key.call(this)}|grounded`;
    };
    m.needsUpdate = true;
  });
}

// places: exported so the landmarks (place-kit.js) share fog, haze and light.
// `grounded`: the shared grounding (groundShader), with the sea's reach.
export function patchMaterial(material, shared, { sway = false, flutter = 0, foliage = false, ground = false, rock = false, bark = false, bent = 0, fade = false, taper = false, pliant = false, rooted = 0, sheen = 0.6, grounded = false } = {}) {
  // three caches programs by onBeforeCompile's source text, which is the same
  // for every patched material: key them by their options, or a material
  // silently runs another's shader (blades with the clusters' flutter).
  const key = JSON.stringify({ sway, flutter, foliage, ground, rock, bark, bent, fade, taper, pliant, rooted, sheen, grounded });
  material.customProgramCacheKey = () => key;
  material.userData.magicLit = true; // land-magic: already carries the light
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shared);
    const defines = (pliant ? "#define PLIANT\n" : "") + (rooted ? `#define ROOTED ${rooted.toFixed(3)}\n` : "") + `#define SHEEN ${sheen.toFixed(2)}\n`;
    shader.vertexShader = defines + OCCLUSION_VERTEX_GLSL + WIND_GLSL +
      shader.vertexShader.replace(
        "#include <begin_vertex>",
        /* glsl */ `
        #include <begin_vertex>
        #ifdef USE_INSTANCING
          vec2 windAnchor = vec2( instanceMatrix[3].x, instanceMatrix[3].z );
          vGlint = fract( sin( dot( windAnchor, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
        #else
          vGlint = 0.0;
        #endif
        ${taper ? "transformed.xz *= mix( 1.0, taper, clamp( position.y + 0.5, 0.0, 1.0 ) );" : ""}
        ${
          flutter
            ? /* glsl */ `
        #ifdef USE_INSTANCING
          // Every leaf (or blade) flutters on its own stalk: its own phase
          // and rate, hinged at its base (leafFlutter.y = 0) and swinging
          // across its face.
          float leafPhase = leafFlutter.x * 6.2832 + vGlint * 37.0;
          float leafRate = 3.0 + leafFlutter.x * 2.5 + vGlint * 1.5;
          float flap = sin( breezeTime * leafRate + leafPhase ) * 0.7
            + sin( breezeTime * leafRate * 2.37 + leafPhase * 1.9 ) * 0.3;
          float leafAmp = ${flutter.toFixed(3)} * ( 0.2 + breezeStrength );
          transformed += normal * ( flap * leafFlutter.y * leafAmp );
          // In a gust, leaves flipped over by their flutter show their paler
          // undersides: bands of lighter foliage run through the crowns.
          vFlip = smoothstep( 0.55, 1.25, gustAt( windAnchor ) ) * min( 1.0, breezeStrength * 1.5 ) * smoothstep( 0.15, 0.85, flap );
        #else
          vFlip = 0.0;
        #endif`
            : ""
        }`,
      );
    shader.vertexShader = shader.vertexShader.replace(
      "void main() {",
      `${flutter ? "attribute vec2 leafFlutter;\nvarying float vFlip;\n" : ""}${taper ? "attribute float taper;\n" : ""}void main() {`,
    );
    if (sway)
      shader.vertexShader = shader.vertexShader.replace(
        "#include <project_vertex>",
        foliage ? PROJECT_GLSL.replace("vAbove =", `${PUSH_GLSL}\n${FOLD_GLSL}\nvAbove =`) : PROJECT_GLSL,
      );
    shader.vertexShader = shader.vertexShader.replace(
      "#include <worldpos_vertex>",
      `#include <worldpos_vertex>
      {
        vec4 shadeWorld = vec4( transformed, 1.0 );
        #ifdef USE_INSTANCING
          shadeWorld = instanceMatrix * shadeWorld;
        #endif
        shadeWorld = modelMatrix * shadeWorld;
        vShade = canopyShade;
        vShadowFar = smoothstep( 24.0, 30.0, length( shadeWorld.xyz - shadowCentre ) );
      }`,
    );
    shader.fragmentShader = defines +
      "uniform vec3 sunDirView;\nuniform float breezeTime;\nuniform float rainWetness;\nuniform float rainFilm;\nvarying float vGlint;\n" +
      "uniform vec3 hazeToward;\nuniform vec3 hazeAway;\nuniform vec3 foamLight;\nvarying float vShade;\nvarying float vShadowFar;\n" +
      shader.fragmentShader
        .replace("#include <fog_fragment>", FOG_GLSL)
        .replace("#include <lights_fragment_end>", `#include <lights_fragment_end>\n${occlusionGlsl(foliage)}`)
        // land-magic: fireflies, the lamp's beams, a waking's ring, starlight.
        .replace("#include <aomap_fragment>", `${MAGIC_LIGHT_GLSL}\n#include <aomap_fragment>`)
        .replace("void main() {", `${MAGIC_LIGHT_DECLARATIONS}\nvoid main() {`);
    if (foliage)
      // solid: leaves and blades the lens is in (the spring arm keeps to
      // trunks and solids, not shrubs) thin out to nothing over the last
      // 0.6 m, dithered, instead of a wall of leaf filling the view.
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <clipping_planes_fragment>",
        `#include <clipping_planes_fragment>
        {
          float lensD = length( vViewPosition );
          if ( lensD < 0.7 ) {
            float h = fract( sin( dot( floor( gl_FragCoord.xy ), vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
            if ( h > smoothstep( 0.15, 0.7, lensD ) ) discard;
          }
        }`,
      );
    if (ground)
      // Plankton the uprush lights at night (the sky's reflection in the
      // swash film comes from the environment map now).
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += vec3( 0.05, 0.42, 0.95 ) * swashGlow * 0.12;`,
      );
    if (ground || rock || bark) {
      shader.vertexShader = shader.vertexShader
        .replace(
          "void main() {",
          ground
            ? "varying vec3 vWorld;\nattribute vec4 groundMask;\nvarying vec4 vGroundMask;\nattribute vec2 groundMask2;\nvarying vec2 vGroundMask2;\nvarying float vGroundGust;\nvoid main() {\n  vGroundMask = groundMask;\n  vGroundMask2 = groundMask2;\n  // Gust bands are metres wide: the 0.5 m ground grid resolves them.\n  vGroundGust = gustAt( position.xz );"
            : "varying vec3 vWorld;\nvoid main() {",
        )
        .replace(
          "#include <worldpos_vertex>",
          `#include <worldpos_vertex>
          vec4 detailWorld = vec4( transformed, 1.0 );
          #ifdef USE_INSTANCING
            detailWorld = instanceMatrix * detailWorld;
          #endif
          vWorld = ( modelMatrix * detailWorld ).xyz;`,
        );
      if (bark)
        // Trunk space for the bark: the unit cylinder's circle scaled to the
        // stem's radius, and distance along its axis, which carries across
        // joints between segments of one limb. Each plant's own base height
        // shifts the pattern, so neighbours don't share it.
        shader.vertexShader = shader.vertexShader
          .replace("void main() {", "varying vec3 vBark;\nvoid main() {")
          .replace(
            "vWorld = ( modelMatrix * detailWorld ).xyz;",
            `vWorld = ( modelMatrix * detailWorld ).xyz;
            #ifdef USE_INSTANCING
              float barkR = length( instanceMatrix[0].xyz );
              vec3 barkAxis = normalize( instanceMatrix[1].xyz );
            #else
              float barkR = 1.0;
              vec3 barkAxis = vec3( 0.0, 1.0, 0.0 );
            #endif
            vBark = vec3( position.x * barkR, position.z * barkR, dot( detailWorld.xyz, barkAxis ) + anchorHeight * 7.31 );`,
          );
      shader.fragmentShader = shader.fragmentShader
        .replace("uniform float breezeTime;\n", "")
        .replace("void main() {", (bark ? "varying vec3 vBark;\n" : "") + DETAIL_GLSL + (ground ? "varying vec4 vGroundMask;\nvarying vec2 vGroundMask2;\nvarying float vGroundGust;\nuniform vec4 catLegs[ 4 ];\nuniform vec4 catFlow;\nuniform sampler2D groundField;\nuniform vec4 groundRect;\n" + SWASH_GLSL : rock ? SWASH_GLSL : "") + "\nvoid main() {")
        .replace("#include <color_fragment>", ground ? GROUND_COLOUR_GLSL : rock ? ROCK_COLOUR_GLSL : BARK_COLOUR_GLSL)
        .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\n  roughnessFactor = detailRoughness;")
        .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
        {
          // Derivative bump: perturb the shading normal by the detail height.
          vec3 dpx = dFdx( -vViewPosition );
          vec3 dpy = dFdy( -vViewPosition );
          float hx = dFdx( detailHeight );
          float hy = dFdy( detailHeight );
          vec3 r1 = cross( dpy, normal );
          vec3 r2 = cross( normal, dpx );
          float det = dot( dpx, r1 );
          vec3 grad = sign( det ) * ( hx * r1 + hy * r2 );
          normal = normalize( abs( det ) * normal - grad * ${ground ? "1.4" : rock ? "2.2" : "3.0"} );
          ${rock ? "// Drifted sand lies as the beach does: shade it as ground, not as the rock face.\n          normal = normalize( mix( normal, ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz, drift * 0.85 ) );" : ""}
        }`);
      // Film drains sooner than absorbed moisture. The local sky visibility
      // also gives a conservative canopy shelter approximation for receivers.
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <roughnessmap_fragment>",
        `float rainExposure = clamp( 1.0 - vShade * 1.15, 0.08, 1.0 );
        float rainDamp = rainWetness * rainExposure;
        diffuseColor.rgb *= 1.0 - rainDamp * ${bark ? "0.2" : "0.14"};
        detailRoughness = mix( detailRoughness, ${bark ? "0.65" : ground ? "0.38" : "0.34"}, rainFilm * rainExposure );
        #include <roughnessmap_fragment>`,
      );
    }
    if (ground)
      // Sand sparkle, lit by the shadowed sun from three's light loop.
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <lights_fragment_begin>", LEAF_LIGHTS_GLSL)
        .replace("#include <lights_fragment_end>", `${SAND_GLINT_GLSL}
        reflectedLight.indirectDiffuse *= 1.0 - 0.55 * groundContact;
        reflectedLight.indirectSpecular *= 1.0 - 0.55 * groundContact;`);
    if (foliage || bark)
      shader.fragmentShader = shader.fragmentShader
        .replace("void main() {", "uniform vec3 skySH[ 9 ];\nvoid main() {")
        .replace("#include <lights_fragment_maps>", SKY_SH_GLSL);
    if (foliage)
      shader.fragmentShader = shader.fragmentShader
        .replace("void main() {", `varying vec3 vLeafNormal;\n${flutter ? "varying float vFlip;\n" : ""}${rooted ? "varying float vAbove;\n" : ""}void main() {`)
        .replace(
          "#include <color_fragment>",
          flutter
            ? `#include <color_fragment>
          // Undersides: paler, greyer, a little bluer than the upper face.
          diffuseColor.rgb = mix( diffuseColor.rgb, mix( diffuseColor.rgb, vec3( dot( diffuseColor.rgb, vec3( 0.3, 0.55, 0.15 ) ) ), 0.3 ) * vec3( 1.3, 1.3, 1.38 ), vFlip * 0.55 );`
            : "#include <color_fragment>",
        )
        .replace("#include <lights_fragment_begin>", LEAF_LIGHTS_GLSL)
        .replace("#include <lights_fragment_end>", FOLIAGE_GLSL);
    if (bent) {
      // Bent normals: blend each leaf's normal toward its foliage mass's
      // outward direction, so a crown shades like a soft volume while each
      // leaf keeps some of its own tilt. The leaf normal is first turned to
      // the crown's outer side; both faces then share the result (no
      // back-face flip), as light doesn't care which side of a leaf faces
      // the camera. The unbent normal goes to the translucency terms.
      shader.vertexShader = shader.vertexShader
        .replace("void main() {", "attribute vec3 bendNormal;\nvarying vec3 vLeafNormal;\nvoid main() {")
        .replace(
          "#include <defaultnormal_vertex>",
          `#include <defaultnormal_vertex>
          vLeafNormal = transformedNormal;
          // Visibility is carried by canopyShade; bendNormal is a direction.
          vec3 bendView = normalize( normalMatrix * bendNormal );
          vec3 outerLeaf = dot( transformedNormal, bendView ) < 0.0 ? -transformedNormal : transformedNormal;
          transformedNormal = normalize( mix( outerLeaf, bendView, ${bent.toFixed(2)} ) );`,
        );
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <normal_fragment_begin>",
        THREE.ShaderChunk.normal_fragment_begin.replace("normal *= faceDirection;", ""),
      );
    }
    if (rock) {
      // The foot sees almost no sky where it meets the sand (or the stone it
      // rests on): contact shadow, like the bark foot.
      shader.vertexShader = shader.vertexShader
        .replace("void main() {", "varying float vRockAbove;\nvoid main() {")
        .replace("vWorld = ( modelMatrix * detailWorld ).xyz;", "vWorld = ( modelMatrix * detailWorld ).xyz;\n          vRockAbove = vWorld.y - anchorHeight;");
      shader.fragmentShader = shader.fragmentShader
        .replace("void main() {", "varying float vRockAbove;\nvoid main() {")
        .replace(
          "#include <lights_fragment_end>",
          `#include <lights_fragment_end>
          {
            float contact = mix( 0.45, 1.0, smoothstep( 0.0, 0.5, vRockAbove ) );
            // Drifted sand at the foot faces the open sky, like the beach.
            contact = mix( contact, max( contact, 0.85 ), drift );
            reflectedLight.indirectDiffuse *= contact;
            reflectedLight.indirectSpecular *= contact;
          }`,
        );
    }
    if (bark)
      // Soil, moss and damp darken the trunk's foot, so it grows out of the
      // ground instead of standing on it.
      shader.fragmentShader = shader.fragmentShader
        .replace("void main() {", "varying float vAbove;\nvoid main() {")
        .replace(
          "float detailRoughness = 0.92;",
          `float detailRoughness = 0.92;
          float foot = 1.0 - smoothstep( 0.0, 0.9, vAbove );
          diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 0.42, 0.45, 0.3 ), foot );`,
        );
    if (fade)
      // Soft waterline: the surface thins into the sea over a lacy band
      // instead of being cut at a jagged facet line (the sea shows through).
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <alphatest_fragment>",
        ground
          ? `float edge = dShore( vec2( vWorld.x, -vWorld.z ) ) + ( vGroundMask.x - 0.5 ) * 0.7 + ( dNoise( vec2( vWorld.x, -vWorld.z ) * 4.0 ) - 0.5 ) * 0.3;
             diffuseColor.a *= smoothstep( -0.35, 0.7, edge );
             #include <alphatest_fragment>`
          : `diffuseColor.a *= smoothstep( -0.08, 0.18, vWorld.y + ( dNoise( vec2( vWorld.x, -vWorld.z ) * 3.0 ) - 0.5 ) * 0.12 );
             #include <alphatest_fragment>`,
      );
    if (grounded) groundShader(shader, shared, true);
  };
}

// What the cat collides with. Trunks are circles; rocks are domes it can
// climb or jump onto (height above the centre falls off to their rim).
function obstaclesFor(layout, rocks) {
  const trunks = layout
    .filter((p) => p.kind === "tree")
    .map((p) => ({ x: p.x, z: p.z, r: p.height * 0.034 + 0.02 }));
  // solid: crevices between touching boulders too narrow for a cat are
  // bridged (it dropped into them and could not climb or jump out).
  const domes = bridgeCrevices(rockSurfaces(rocks));
  // Flowering fynbos, where butterflies feed.
  const flowers = layout
    .filter((p) => ["protea", "erica", "daisies", "aloe"].includes(p.kind))
    .map((p) => ({ x: p.x, z: p.z, h: p.height }));
  return { trunks, domes, flowers };
}

// Each rock's true top surface, rasterized from its mesh into a small height
// tile (6 cm cells): what the cat stands on, climbs, and is blocked by.
function rockSurfaces(rocks) {
  const sources = Array.from({ length: ROCK_VARIANTS }, (_, v) => rockGeometry(7, v));
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const v = new THREE.Vector3();
  const cell = 0.06;
  return rocks.map((rock) => {
    const position = sources[rock.variant].attributes.position;
    const index = sources[rock.variant].index.array;
    matrix.compose(rock.position, quaternion.setFromEuler(rock.rotation), rock.scale);
    const xs = new Float32Array(position.count);
    const ys = new Float32Array(position.count);
    const zs = new Float32Array(position.count);
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < position.count; i++) {
      v.fromBufferAttribute(position, i).applyMatrix4(matrix);
      xs[i] = v.x;
      ys[i] = v.y;
      zs[i] = v.z;
      minX = Math.min(minX, v.x);
      maxX = Math.max(maxX, v.x);
      minZ = Math.min(minZ, v.z);
      maxZ = Math.max(maxZ, v.z);
    }
    const nx = Math.ceil((maxX - minX) / cell) + 1;
    const nz = Math.ceil((maxZ - minZ) / cell) + 1;
    const heights = new Float32Array(nx * nz).fill(-Infinity);
    for (let t = 0; t < index.length; t += 3) {
      const a = index[t], b = index[t + 1], c = index[t + 2];
      const ax = xs[a], az = zs[a], bx = xs[b], bz = zs[b], cx = xs[c], cz = zs[c];
      const det = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(det) < 1e-9) continue;
      const i0 = Math.max(0, Math.ceil((Math.min(ax, bx, cx) - minX) / cell));
      const i1 = Math.min(nx - 1, Math.floor((Math.max(ax, bx, cx) - minX) / cell));
      const j0 = Math.max(0, Math.ceil((Math.min(az, bz, cz) - minZ) / cell));
      const j1 = Math.min(nz - 1, Math.floor((Math.max(az, bz, cz) - minZ) / cell));
      for (let i = i0; i <= i1; i++)
        for (let j = j0; j <= j1; j++) {
          const px = minX + i * cell;
          const pz = minZ + j * cell;
          const w0 = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / det;
          const w1 = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / det;
          const w2 = 1 - w0 - w1;
          if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
          const y = w0 * ys[a] + w1 * ys[b] + w2 * ys[c];
          const k = j * nx + i;
          if (y > heights[k]) heights[k] = y;
        }
    }
    return { x0: minX, z0: minZ, cell, nx, nz, heights, x: rock.position.x, z: rock.position.z, r: Math.max(maxX - minX, maxZ - minZ) / 2 };
  });
}

// Baked ambient occlusion on the ground: every plant and rock darkens the
// soil around it, broadly under a canopy and tightly at the base, so things
// sit in the ground instead of on it. This is most of what keeps an overcast
// scene from looking flat.
function occlusionField(occluders) {
  const cell = 6;
  const grid = new Map();
  for (const o of occluders) {
    const key = `${Math.floor(o.x / cell)},${Math.floor(o.z / cell)}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(o);
  }
  return (x, z) => {
    let visible = 1;
    const cx = Math.floor(x / cell);
    const cz = Math.floor(z / cell);
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++)
        for (const o of grid.get(`${cx + dx},${cz + dz}`) ?? []) {
          const d2 = (x - o.x) ** 2 + (z - o.z) ** 2;
          if (d2 > o.r * o.r * 4) continue;
          visible *= 1 - o.k * Math.exp(-d2 / (o.r * o.r));
        }
    return 0.3 + 0.7 * visible;
  };
}

function occludersFor(layout, rocks) {
  const list = [];
  for (const p of layout) {
    if (p.kind === "tree") {
      list.push({ x: p.x, z: p.z, r: Math.min(4, p.height * 0.32), k: 0.32 });
      list.push({ x: p.x, z: p.z, r: 0.7 + p.height * 0.03, k: 0.5 });
    } else if (p.kind === "shrub" || p.kind === "protea" || p.kind === "erica") {
      list.push({ x: p.x, z: p.z, r: p.height * 0.75, k: 0.42 });
    } else if (p.kind === "aloe" || p.kind === "restio" || p.kind === "fern") {
      list.push({ x: p.x, z: p.z, r: p.height * 0.5, k: 0.3 });
    } else {
      list.push({ x: p.x, z: p.z, r: 0.35, k: 0.12 });
    }
  }
  for (const r of rocks)
    list.push({ x: r.position.x, z: r.position.z, r: r.scale.x * 1.1, k: 0.55 });
  return list;
}

// What grows over each ground vertex, splatted from the plants themselves
// onto the ground grid: `grass` (how much sward and thatch lies under the
// tufts, and its mean colour) and `humus` (leaf litter and dark organic soil
// under crowns and shrubs). The ground then changes where the plants are,
// not where a noise field says: litter drifts under each tree, the sand
// greens and roughens round each tuft, and plants grow out of their own
// debris instead of standing on bare sand.
function coverFor(layout, turf) {
  const { size, segments } = GROUND;
  const n = segments + 1;
  const cell = size / segments;
  const x0 = ISLAND.x - size / 2;
  const z0 = ISLAND.z - size / 2;
  const grass = new Float32Array(n * n);
  const humus = new Float32Array(n * n);
  const tint = new Float32Array(n * n * 3);
  const splat = (x, z, radius, weight, target, colour = null) => {
    const i0 = Math.max(0, Math.floor((x - radius - x0) / cell));
    const i1 = Math.min(n - 1, Math.ceil((x + radius - x0) / cell));
    const j0 = Math.max(0, Math.floor((z - radius - z0) / cell));
    const j1 = Math.min(n - 1, Math.ceil((z + radius - z0) / cell));
    const r2 = radius * radius;
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const d2 = (x0 + i * cell - x) ** 2 + (z0 + j * cell - z) ** 2;
        if (d2 > r2) continue;
        const w = weight * (1 - d2 / r2) ** 2;
        // PlaneGeometry rows run along x; after rotateX(-π/2), row j is at z0 + j·cell.
        const k = j * n + i;
        target[k] += w;
        if (colour) {
          tint[k * 3] += colour.r * w;
          tint[k * 3 + 1] += colour.g * w;
          tint[k * 3 + 2] += colour.b * w;
        }
      }
  };
  for (const t of turf) splat(t.position.x, t.position.z, 0.45 + t.scale.x * 1.6, 1, grass, t.color);
  // How close a tuft stands, tightly: on open sand the near-ground carpet
  // grows only round the tufts themselves (near-ground.js).
  const tufted = new Float32Array(n * n);
  for (const t of turf) splat(t.position.x, t.position.z, 0.55 + t.scale.x * 0.5, 1, tufted);
  // Moss: velvet cushions on shaded soil, in the grass channel (the ground
  // shader's fine sward texture reads as moss pile in its colour).
  const moss = new THREE.Color();
  for (const p of layout)
    if (p.kind === "moss")
      splat(p.x, p.z, 0.7 + p.height * 5, 1.4, grass, moss.setHSL(0.24 + noise2(p.x * 0.3, p.z * 0.3) * 0.1, 0.35, 0.26, THREE.SRGBColorSpace));
  for (const p of layout) {
    if (p.kind === "tree") {
      splat(p.x, p.z, Math.min(5, 1 + p.height * 0.4), 0.9, humus);
      splat(p.x, p.z, 0.6 + p.height * 0.05, 1.2, humus);
    } else if (p.kind === "shrub" || p.kind === "protea" || p.kind === "erica" || p.kind === "fern" || p.kind === "moss") {
      splat(p.x, p.z, 0.4 + p.height * 0.9, 0.8, humus);
    } else if (p.kind === "restio" || p.kind === "daisies" || p.kind === "aloe") {
      splat(p.x, p.z, 0.4 + p.height * 0.6, 0.6, grass, new THREE.Color(MATERIAL_HEX.dryThatch));
      splat(p.x, p.z, 0.3 + p.height * 0.4, 0.4, humus);
    }
  }
  return (x, z) => {
    const i = Math.round((x - x0) / cell);
    const j = Math.round((z - z0) / cell);
    if (i < 0 || j < 0 || i >= n || j >= n) return { grass: 0, humus: 0, tufted: 0, colour: null };
    const k = j * n + i;
    const g = grass[k];
    const w = Math.max(1e-6, g);
    return {
      tufted: Math.min(1, tufted[k]),
      grass: 1 - Math.exp(-g * 1.1),
      humus: 1 - Math.exp(-humus[k] * 1.3),
      colour: g > 1e-4 ? new THREE.Color(tint[k * 3] / w, tint[k * 3 + 1] / w, tint[k * 3 + 2] / w) : null,
    };
  };
}

function addGround(scene, shared, occluders, cover, rocks = []) {
  const { size, segments } = GROUND;
  const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
  const occlusion = occlusionField(occluders);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(ISLAND.x, 0, ISLAND.z);
  const position = geometry.attributes.position;
  const colors = new Float32Array(position.count * 3);
  // Sky occlusion under plants and beside rocks: it dims skylight (and the sun
  // beyond the shadow map), not the soil's own colour.
  const shades = new Float32Array(position.count);
  // Green cover painted in the vertex colour (moss and low sward), for the
  // near-ground carpet.
  const mossy = new Float32Array(position.count);
  // An ecotone replaces the hard beach-forest line: sand grades through dry
  // dune tones and leaf litter into forest soil, dithered by noise over metres.
  // Warm, pale granitic sand; forest soil a red-brown loam under litter
  // rather than a grey mud, with living green cover through the interior.
  const sand = new THREE.Color(MATERIAL_HEX.sand);
  // Wet sand only a little darker: the swash film carries the rest (surf.js).
  const wetSand = new THREE.Color(MATERIAL_HEX.wetSand);
  const dune = new THREE.Color(MATERIAL_HEX.dune);
  const litter = new THREE.Color(MATERIAL_HEX.litter);
  const moss = new THREE.Color(MATERIAL_HEX.moss);
  const humusColour = new THREE.Color(MATERIAL_HEX.humus);
  const thatch = new THREE.Color();
  const color = new THREE.Color();
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const z = position.getZ(i);
    const inland = shoreDistance(x, z);
    const dither = noise2(x * 0.7, z * 0.7) * 4 - 2;
    position.setY(i, terrainHeight(x, z));
    color.copy(wetSand).lerp(sand, smoothstep(-0.2, 2, inland));
    color.lerp(dune, smoothstep(2.5, 6.5 + dither, inland) * 0.7);
    color.lerp(litter, smoothstep(5.5, 11 + dither, inland));
    const mossK = smoothstep(8, 16 + dither, inland) * (0.5 + noise2(x * 0.13, z * 0.11) * 0.5);
    color.lerp(moss, mossK);
    // Under the plants: humus darkens the soil beneath crowns and shrubs;
    // tufts leave thatch in their own colour (a shade darker: the dead and
    // shaded blades at their feet), so turf and ground meet without a seam.
    const { grass, humus, colour: tuftColour } = cover(x, z);
    color.lerp(humusColour, humus * 0.75);
    if (tuftColour) color.lerp(thatch.copy(tuftColour).multiplyScalar(0.62).lerp(humusColour, 0.25), grass * 0.8);
    color.multiplyScalar(0.88 + noise2(x * 2, z * 2) * 0.22);
    color.toArray(colors, i * 3);
    mossy[i] = mossK * (1 - humus);
    shades[i] = 1 - occlusion(x, z);
  }
  // land-look: rocks sit in the sand, not on it: a soft contact shadow
  // hugging each one's foot (where sky and bounce cannot reach), and the
  // sand there a touch damper and cooler. Baked once into the vertex colour.
  {
    const bucket = new Map();
    const key = (i, j) => i * 4096 + j;
    for (const r of rocks) {
      const rf = (r.scale.x + r.scale.z) * 0.5 * 0.95;
      const reach = rf * 1.6 + 0.35;
      for (let i = Math.floor((r.position.x - reach) / 4); i <= Math.floor((r.position.x + reach) / 4); i++)
        for (let j = Math.floor((r.position.z - reach) / 4); j <= Math.floor((r.position.z + reach) / 4); j++) {
          const k = key(i + 2048, j + 2048);
          if (!bucket.has(k)) bucket.set(k, []);
          bucket.get(k).push({ x: r.position.x, z: r.position.z, rf, reach });
        }
    }
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i), z = position.getZ(i);
      const list = bucket.get(key(Math.floor(x / 4) + 2048, Math.floor(z / 4) + 2048));
      if (!list) continue;
      let dark = 0;
      for (const q of list) {
        const d = Math.hypot(x - q.x, z - q.z);
        if (d < q.reach) dark = Math.max(dark, 1 - smoothstep(q.rf * 0.8, q.reach, d));
      }
      if (dark <= 0) continue;
      colors[i * 3] *= 1 - 0.42 * dark;
      colors[i * 3 + 1] *= 1 - 0.4 * dark;
      colors[i * 3 + 2] *= 1 - 0.36 * dark;
      shades[i] = Math.max(shades[i], 0.5 * dark);
    }
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute("canopyShade", new THREE.BufferAttribute(shades, 1));
  groundFieldTexture(position, colors, shared);
  geometry.computeVertexNormals();
  const masks = new Float32Array(position.count * 4);
  const fbm = (x, z) =>
    noise2(x, z) * 0.5 + noise2(x * 2.1 + 5, z * 2.1) * 0.27 + noise2(x * 4.3, z * 4.3 + 3) * 0.15 + noise2(x * 8.7 + 1, z * 8.7) * 0.08;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const z = position.getZ(i);
    const inland = shoreDistance(x, z);
    // Slope from the analytic terrain over ~1.5 m, not faceted mesh normals:
    // thresholding per-vertex normals painted stepped patches along the grid.
    const gx = (terrainHeight(x + 0.75, z) - terrainHeight(x - 0.75, z)) / 1.5;
    const gz = (terrainHeight(x, z + 0.75) - terrainHeight(x, z - 0.75)) / 1.5;
    const upness = 1 / Math.sqrt(1 + gx * gx + gz * gz);
    const steep = smoothstep(0.8, 0.55, upness + (noise2(x * 0.4, z * 0.4) - 0.5) * 0.12);
    const { grass, humus } = cover(x, z);
    const rocky = Math.max(steep, smoothstep(0.62, 0.76, fbm(x * 0.13 + 4, z * 0.13)) * smoothstep(14, 24, inland));
    masks[i * 4] = fbm(x * 0.9, z * 0.9);
    masks[i * 4 + 1] = rocky * (1 - humus * 0.6) * (1 - grass * 0.5);
    // Litter where plants shed it, patchy at the metre scale.
    masks[i * 4 + 2] = Math.min(1, humus * (0.6 + fbm(x * 2.3 + 9, z * 2.3) * 0.8));
    masks[i * 4 + 3] = grass;
  }
  geometry.setAttribute("groundMask", new THREE.BufferAttribute(masks, 4));
  // Painted low cover (ground-detail.js): strandveld scrub and sour-fig mats,
  // kept off exposed granite.
  const cover2 = new Float32Array(position.count * 2);
  for (let i = 0; i < position.count; i++) {
    const { scrub, sourfig } = groundCover(position.getX(i), position.getZ(i), undefined, shades[i]);
    const bare = 1 - masks[i * 4 + 1] * 0.9;
    cover2[i * 2] = scrub * bare;
    cover2[i * 2 + 1] = sourfig * bare;
  }
  geometry.setAttribute("groundMask2", new THREE.BufferAttribute(cover2, 2));
  // The same masks for the near-ground carpet (near-ground.js), bilinear on
  // the grid: what grows at any point, and the sky it sees.
  const n = GROUND.segments + 1;
  const cellSize = GROUND.size / GROUND.segments;
  const gx0 = ISLAND.x - GROUND.size / 2;
  const gz0 = ISLAND.z - GROUND.size / 2;
  const sampled = { grass: 0, litter: 0, rocky: 0, scrub: 0, sourfig: 0, shade: 0, moss: 0, tint: null };
  const field = {
    sample(x, z) {
      const u = Math.min(n - 1.001, Math.max(0, (x - gx0) / cellSize));
      const v = Math.min(n - 1.001, Math.max(0, (z - gz0) / cellSize));
      const i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j;
      const k = j * n + i;
      const w = [(1 - fu) * (1 - fv), fu * (1 - fv), (1 - fu) * fv, fu * fv];
      const ks = [k, k + 1, k + n, k + n + 1];
      const lerp = (array, stride, offset) => ks.reduce((sum, kk, q) => sum + array[kk * stride + offset] * w[q], 0);
      sampled.rocky = lerp(masks, 4, 1);
      sampled.litter = lerp(masks, 4, 2);
      sampled.grass = lerp(masks, 4, 3);
      sampled.scrub = lerp(cover2, 2, 0);
      sampled.sourfig = lerp(cover2, 2, 1);
      sampled.shade = lerp(shades, 1, 0);
      sampled.moss = lerp(mossy, 1, 0);
      const local = cover(x, z);
      sampled.tint = local.colour;
      sampled.tufted = local.tufted;
      return sampled;
    },
  };
  // Entirely submerged triangles cannot survive the waterline clipping or
  // alpha fade. A 1.5 m shore margin preserves every visible low-angle edge.
  const oldIndex = geometry.index.array;
  const kept = [];
  for (let i = 0; i < oldIndex.length; i += 3) {
    if ([oldIndex[i], oldIndex[i + 1], oldIndex[i + 2]].some((v) =>
      shoreDistance(position.getX(v), position.getZ(v)) > -1.5))
      kept.push(oldIndex[i], oldIndex[i + 1], oldIndex[i + 2]);
  }
  geometry.setIndex(kept);
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.95,
    transparent: true,
    clippingPlanes: [new THREE.Plane(new THREE.Vector3(0, 1, 0), 0.12)],
  });
  patchMaterial(material, shared, { ground: true, fade: true });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  scene.add(mesh);
  return field;
}

// land-look: grounding. The ground mesh's own grid (GROUND, 0.5 m) as one
// RGBA half-float texture: the terrain height (r), contact shade round the
// landmarks' feet (g, baked by groundContact once they are built), the
// ground's albedo luminance (b) and how sandy it is (a, 0 soil, 1 sand).
// Landmarks and animals read it once per pixel (GROUNDING_GLSL) to sit in
// the island rather than on it; the ground reads its contact shade.
function groundFieldTexture(position, colors, shared) {
  const n = GROUND.segments + 1;
  const data = new Uint16Array(n * n * 4);
  const half = THREE.DataUtils.toHalfFloat;
  const axis = SAND_GROUND_TINT.map((v, i) => v - SOIL_TINT[i]);
  const norm = axis.reduce((a, v) => a + v * v, 0);
  // PlaneGeometry rotated flat: rows run up z, columns up x (coast metres).
  for (let i = 0; i < position.count; i++) {
    const r = colors[i * 3], g = colors[i * 3 + 1], b = colors[i * 3 + 2];
    const l = Math.max(r * 0.2126 + g * 0.7152 + b * 0.0722, 1e-5);
    let t = 0;
    for (let c = 0; c < 3; c++) t += ([r, g, b][c] / l - SOIL_TINT[c]) * axis[c];
    data[i * 4] = half(position.getY(i));
    data[i * 4 + 1] = half(0);
    data[i * 4 + 2] = half(l);
    data[i * 4 + 3] = half(Math.min(1, Math.max(0, t / norm)));
  }
  const texture = new THREE.DataTexture(data, n, n, THREE.RGBAFormat, THREE.HalfFloatType);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  const cell = GROUND.size / GROUND.segments;
  shared.groundField.value = texture;
  // uv = (coast xz − origin) × scale; the origin sits half a texel out.
  shared.groundRect.value.set(ISLAND.x - GROUND.size / 2 - cell / 2, ISLAND.z - GROUND.size / 2 - cell / 2, 1 / (n * cell), 1 / (n * cell));
}

// Bakes contact shade into the ground field's g channel round everything in
// `roots` that meets the ground (the landmarks: static meshes in coast
// metres): along every triangle edge within ~0.3 m of the terrain, the
// ground within ~0.8 m darkens, most at the foot. Once, at load.
function bakeGroundContact(shared, land, roots) {
  const texture = shared.groundField.value;
  if (!texture) return;
  const n = texture.image.width;
  const data = texture.image.data;
  const half = THREE.DataUtils.toHalfFloat;
  const full = THREE.DataUtils.fromHalfFloat;
  const [ox, oz, sx] = shared.groundRect.value.toArray();
  const cell = 1 / (sx * n);
  const contact = new Float32Array(n * n);
  const heightAt = (x, z) => {
    const u = (x - ox) / cell - 0.5, v = (z - oz) / cell - 0.5;
    const i = Math.max(0, Math.min(n - 2, Math.floor(u))), j = Math.max(0, Math.min(n - 2, Math.floor(v)));
    const fu = Math.min(1, Math.max(0, u - i)), fv = Math.min(1, Math.max(0, v - j));
    const h = (a, b) => full(data[((j + b) * n + i + a) * 4]);
    return (h(0, 0) * (1 - fu) + h(1, 0) * fu) * (1 - fv) + (h(0, 1) * (1 - fu) + h(1, 1) * fu) * fv;
  };
  const REACH = 0.8;
  const splat = (x, z, k) => {
    const ci = (x - ox) / cell - 0.5, cj = (z - oz) / cell - 0.5;
    const r = Math.ceil(REACH / cell);
    for (let j = Math.floor(cj) - r; j <= Math.ceil(cj) + r; j++)
      for (let i = Math.floor(ci) - r; i <= Math.ceil(ci) + r; i++) {
        if (i < 0 || j < 0 || i >= n || j >= n) continue;
        const d = Math.hypot(i - ci, j - cj) * cell;
        if (d < REACH) contact[j * n + i] = Math.max(contact[j * n + i], k * (1 - smoothstep(0.1, REACH, d)));
      }
  };
  const a = new THREE.Vector3(), b = new THREE.Vector3(), p = new THREE.Vector3();
  const local = new THREE.Matrix4();
  for (const root of roots)
    root.traverse((mesh) => {
      if (!mesh.isMesh || mesh.isInstancedMesh || !mesh.geometry?.attributes.position || mesh.material?.transparent) return;
      // Coast metres: the transforms up to the land group (frozen matrices).
      local.identity();
      for (let o = mesh; o && o !== land; o = o.parent) local.premultiply(o.matrix);
      const position = mesh.geometry.attributes.position;
      const index = mesh.geometry.index;
      const count = index ? index.count : position.count;
      const vertex = (k, out) => out.fromBufferAttribute(position, index ? index.getX(k) : k).applyMatrix4(local);
      for (let t = 0; t + 2 < count; t += 3)
        for (let e = 0; e < 3; e++) {
          vertex(t + e, a);
          vertex(t + ((e + 1) % 3), b);
          const ha = a.y - heightAt(a.x, a.z), hb = b.y - heightAt(b.x, b.z);
          if (Math.min(ha, hb) > 0.3 || Math.max(ha, hb) < -0.6) continue;
          const steps = Math.min(64, Math.ceil(a.distanceTo(b) / 0.25));
          for (let s = 0; s <= steps; s++) {
            p.lerpVectors(a, b, s / steps);
            const h = p.y - heightAt(p.x, p.z);
            if (h < 0.3 && h > -0.6) splat(p.x, p.z, 1 - smoothstep(0.0, 0.3, h));
          }
        }
    });
  for (let i = 0; i < n * n; i++) data[i * 4 + 1] = half(contact[i]);
  texture.needsUpdate = true;
}

function addGroundDetails(scene, shared, details, occluders) {
  const visible = occlusionField(occluders);
  for (const list of Object.values(details))
    for (const part of list) part.shade = (1 - visible(part.position.x, part.position.z)) * 0.65;
  const woodMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 });
  const mineralMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.88 });
  for (const material of [woodMaterial, mineralMaterial]) patchMaterial(material, shared);
  const near = [{ keep: () => false, distance: 30 }];
  addInstances(scene, new THREE.CylinderGeometry(0.65, 1, 1, 3, 1, false), woodMaterial, details.twigs, false, near);
  addInstances(scene, new THREE.CylinderGeometry(0.4, 1, 1, 4, 1, false), woodMaterial, details.roots, false, [{ keep: () => false, distance: 38 }]);
  addInstances(scene, new THREE.IcosahedronGeometry(1, 0), mineralMaterial, details.stones, false, near);
}

// A leafy shoot, grown the way a real one is: a short twig carrying leaves
// in a golden-angle (2/5) spiral. Leaves near the base are mature and splay
// wide; toward the tip they are younger, smaller and yellower and hug the
// bud. Each leaf is folded along its midrib (a shallow V catches light on
// one half and shade on the other), droops under its own weight and curls
// a little sideways, and no two share proportions. `detail` 1 is a 6-triangle
// folded leaf; 0 is a 2-triangle card, fewer and larger, for distance.
function shootGeometry(leafCount = 14, detail = 1) {
  const out = { positions: [], colours: [], indices: [], flutter: [] };
  const random = seededRandom(7);
  const dir = new THREE.Vector3();
  const side = new THREE.Vector3();
  const lift = new THREE.Vector3();
  // Fewer far leaves stand in for more near ones, so each covers more.
  const enlarge = Math.sqrt(14 / leafCount) * (detail ? 1 : 0.92);
  for (let i = 0; i < leafCount; i++) {
    const t = (i + 0.5) / leafCount;
    const azimuth = i * 2.39996 + (random() - 0.5) * 0.5;
    const tilt = 1.3 - t * 0.75 + (random() - 0.5) * 0.3;
    dir.set(Math.sin(tilt) * Math.cos(azimuth), Math.cos(tilt), Math.sin(tilt) * Math.sin(azimuth));
    side.set(-Math.sin(azimuth), 0, Math.cos(azimuth));
    // The upper face: up and out from the twig.
    lift.crossVectors(side, dir).normalize();
    const grown = (0.5 + 0.5 * Math.sin(Math.PI * Math.min(1, 0.25 + t * 0.9))) * (0.85 + random() * 0.3);
    const length = 0.36 * grown * enlarge;
    smallLeaf(out, {
      base: new THREE.Vector3(0, 0.06 + t * 0.62, 0).addScaledVector(dir, 0.025),
      dir: dir.clone(),
      side: side.clone(),
      lift: lift.clone(),
      length,
      width: length * (0.34 + random() * 0.14),
      widest: 0.38 + random() * 0.2,
      droop: 0.1 + random() * 0.2 + (1 - t) * 0.1,
      curl: (random() - 0.5) * 0.3,
      fold: 0.12 + random() * 0.1,
      detail,
      // Mature leaves sit in the shoot's own shade; young ones are yellower.
      shade: (0.82 + random() * 0.3) * (0.82 + t * 0.18),
      hue: (t - 0.55) * 0.14 + (random() - 0.5) * 0.06,
      phase: random(),
      reach: 0.5 + t * 0.5,
    });
  }
  return finish(out.positions, out.indices, out.colours, out.flutter);
}

function smallLeaf(out, { base, dir, side, lift, length, width, widest, droop, curl, fold, detail, shade, hue, phase, reach }) {
  const { positions, colours, indices, flutter } = out;
  const first = positions.length / 3;
  const point = (t, across) => {
    const halfWidth = t < widest
      ? Math.sin((t / widest) * Math.PI * 0.5)
      : Math.pow(Math.cos(((t - widest) / (1 - widest)) * Math.PI * 0.5), 0.8);
    return base
      .clone()
      .addScaledVector(dir, length * t)
      // Droop, and the fold: the blade halves rise from the midrib.
      .addScaledVector(lift, -droop * length * t * t + fold * width * Math.abs(across))
      .addScaledVector(side, across * width * halfWidth + curl * length * t * t);
  };
  const push = (p, t) => {
    positions.push(p.x, p.y, p.z);
    const k = shade * (0.72 + 0.28 * Math.min(1, t * 2.2));
    colours.push(k * (1 + hue * 0.8), k * (1 + hue * 0.2), k * (1 - hue * 0.9));
    // Flutter hinges at the petiole; leaves near the twig's tip swing more.
    flutter.push(phase, t * reach);
  };
  if (detail === 0) {
    push(point(0, 0), 0);
    push(point(0.45, -1), 0.45);
    push(point(0.45, 1), 0.45);
    push(point(1, 0), 1);
    indices.push(first, first + 1, first + 2, first + 1, first + 3, first + 2);
    return;
  }
  push(point(0, 0), 0);
  push(point(0.3, -1), 0.3);
  push(point(0.3, 0), 0.3);
  push(point(0.3, 1), 0.3);
  push(point(0.7, -0.85), 0.7);
  push(point(0.7, 0.85), 0.7);
  push(point(1, 0), 1);
  indices.push(
    first, first + 1, first + 2,
    first, first + 2, first + 3,
    first + 1, first + 4, first + 2,
    first + 2, first + 4, first + 5,
    first + 2, first + 5, first + 3,
    first + 4, first + 6, first + 5,
  );
}

// One leaf (or petal, bract or style) from `base` along `dir`, bowed along
// `lift` and spread along `side`. The outline is a smooth ovate curve with a
// rounded tip; `detail` 0 is a 4-triangle rounded card for distance, 1 adds a
// raised midrib, 2 is the full cupped blade.
function blade(out, {
  base,
  dir,
  side,
  lift,
  length,
  width,
  droop = 0.1,
  widest = 0.4,
  blunt = 0.7,
  curl = 0,
  cup = 0.14,
  detail = 2,
  shade = 1,
  hue = 0,
  colour = null,
}) {
  const { positions, colours, indices } = out;
  const first = positions.length / 3;
  // Half-width at t: zero at base and tip, peak at `widest`; `blunt` rounds
  // the tip (1 = elliptic, lower = more pointed).
  const halfWidth = (t) => {
    const s = t < widest ? t / widest : 1 - (t - widest) / (1 - widest);
    const shape = t < widest ? Math.sin((s * Math.PI) / 2) : Math.pow(Math.sin((s * Math.PI) / 2), blunt);
    return width * Math.pow(Math.max(0, shape), 0.85);
  };
  const point = (t, across) => {
    const bow = -droop * length * t * t;
    // Cupped: edges curl up toward `lift` and the midrib is the low line.
    const dish = cup * width * across * across;
    return base
      .clone()
      .addScaledVector(dir, length * t)
      .addScaledVector(lift, bow + dish)
      .addScaledVector(side, across * halfWidth(t) + curl * length * t * t);
  };
  const tint = colour ?? [1, 1, 1];
  const push = (p, t) => {
    positions.push(p.x, p.y, p.z);
    // The base sits in the shoot's shade. Hue shifts swing a leaf toward
    // yellow (young, positive) or blue-green (old, negative).
    const k = shade * (0.78 + 0.22 * Math.min(1, t * 2));
    colours.push(
      tint[0] * k * (1 + hue * 0.7),
      tint[1] * k,
      tint[2] * k * (1 - hue * 0.7),
    );
  };
  const rows = detail === 0 ? [0.3, 0.68] : detail === 1 ? [0.22, 0.5, 0.78] : [0.12, 0.3, 0.5, 0.7, 0.87];
  const midrib = detail > 0;
  push(point(0, 0), 0);
  for (const t of rows) {
    push(point(t, -1), t);
    if (midrib) push(point(t, 0), t);
    push(point(t, 1), t);
  }
  push(point(1, 0), 1);
  const stride = midrib ? 3 : 2;
  const tip = first + 1 + rows.length * stride;
  const row = (i, k) => first + 1 + i * stride + k;
  const right = stride - 1;
  // Base fan, bands, tip fan.
  if (midrib) indices.push(first, row(0, 0), row(0, 1), first, row(0, 1), row(0, 2));
  else indices.push(first, row(0, 0), row(0, 1));
  for (let i = 0; i < rows.length - 1; i++)
    for (let k = 0; k < right; k++)
      indices.push(row(i, k), row(i + 1, k), row(i, k + 1), row(i, k + 1), row(i + 1, k), row(i + 1, k + 1));
  const last = rows.length - 1;
  if (midrib) indices.push(row(last, 0), tip, row(last, 1), row(last, 1), tip, row(last, 2));
  else indices.push(row(last, 0), tip, row(last, 1));
}

// A unit leaf from y = -1 (attachment) to 1 (tip) for ferns, palms, aloes and
// grasses: the same rounded, cupped outline as the shoot leaves.
function leafGeometry(detail = 2) {
  const out = { positions: [], colours: [], indices: [] };
  blade(out, {
    base: new THREE.Vector3(0, -1, 0),
    dir: new THREE.Vector3(0, 1, 0),
    side: new THREE.Vector3(1, 0, 0),
    lift: new THREE.Vector3(0, 0, 1),
    length: 2,
    width: 0.3,
    droop: 0.1,
    widest: 0.38,
    blunt: 0.6,
    cup: 0.3,
    detail,
  });
  // Hinged at the attachment (y = -1), swinging most at the tip.
  const flutter = [];
  for (let i = 1; i < out.positions.length; i += 3) flutter.push(0, (out.positions[i] + 1) / 2);
  return finish(out.positions, out.indices, out.colours, flutter);
}

// ---- Flower heads. Unit size, facing +y; instances scale, orient and tint.

// An aloe candle: a raceme of drooping tubular florets spiralling up a
// stalk. Open flowers below are paler and yellower; tight buds at the tip
// are deep red. Vertex colour carries that gradient; the instance tints it.
function spikeGeometry(florets = 44) {
  const positions = [];
  const colours = [];
  const indices = [];
  for (let i = 0; i < florets; i++) {
    const t = i / (florets - 1);
    const azimuth = i * 2.39996;
    const y = t * 1.5;
    const open = 1 - t;
    const out = new THREE.Vector3(Math.cos(azimuth), 0, Math.sin(azimuth));
    const across = new THREE.Vector3(-out.z, 0, out.x);
    const reach = 0.12 + open * 0.12;
    const droop = 0.12 + open * 0.2;
    const base = new THREE.Vector3(0, y, 0).addScaledVector(out, 0.03);
    const tip = base.clone().addScaledVector(out, reach).add(new THREE.Vector3(0, -droop, 0));
    const mid = base.clone().lerp(tip, 0.5).add(new THREE.Vector3(0, 0.02, 0));
    const w = 0.035 * (0.6 + open * 0.6);
    const first = positions.length / 3;
    positions.push(
      base.x, base.y, base.z,
      mid.x + across.x * w, mid.y, mid.z + across.z * w,
      mid.x - across.x * w, mid.y, mid.z - across.z * w,
      tip.x, tip.y, tip.z,
    );
    const c = [1.0 - t * 0.25, 0.95 - t * 0.6, 0.6 - t * 0.45];
    for (let k = 0; k < 4; k++) colours.push(...c);
    indices.push(first, first + 1, first + 2, first + 1, first + 3, first + 2);
  }
  const geometry = finish(positions, indices);
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colours, 3));
  return geometry;
}

// Petal geometries without their own gradient get white vertex colour, so
// one vertex-coloured material serves every flower.
function white(geometry) {
  if (!geometry.attributes.color)
    geometry.setAttribute(
      "color",
      new THREE.Float32BufferAttribute(new Float32Array(geometry.attributes.position.count * 3).fill(1), 3),
    );
  return geometry;
}

// An erica bell: a tiny urn, closed at the stalk and flared a little at
// the mouth. Indexed, 11 vertices (the old icosahedron was 60 unshared).
function bellGeometry() {
  const positions = [0, 0.5, 0];
  const indices = [];
  for (const [radius, y] of [[0.42, 0.1], [0.3, -0.5]])
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      positions.push(Math.cos(a) * radius, y, Math.sin(a) * radius);
    }
  for (let i = 0; i < 5; i++) {
    const a = 1 + i;
    const b = 1 + ((i + 1) % 5);
    indices.push(0, b, a, a, b, b + 5, a, b + 5, a + 5);
  }
  return finish(positions, indices);
}

// A stable pseudo-random number per shoot, by position: far levels keep
// the shoots below a share, so each coarser level keeps a subset of the last.
function shootShare(shoot) {
  if (shoot.id) {
    if (shoot.lodShare === undefined) {
      let hash = 2166136261;
      for (let i = 0; i < shoot.id.length; i++) hash = Math.imul(hash ^ shoot.id.charCodeAt(i), 16777619);
      shoot.lodShare = (hash >>> 0) / 4294967296;
    }
    return shoot.lodShare;
  }
  const h = Math.sin(shoot.position.x * 12.9898 + shoot.position.z * 78.233 + shoot.position.y * 37.719) * 43758.5453;
  return h - Math.floor(h);
}

// Instances are bucketed into ground chunks so the camera frustum culls whole
// regions in both the colour and shadow passes, but each instance chooses
// its own level of detail (src/instance-lod.js): `far` lists the levels
// after the first, nearest first, as `{ geometry, grow, keep, distance }`,
// where `distance` (metres from the eye to the instance's nearest extent,
// scaled by the render budget's LOD bias) is where the level begins, `keep`
// which instances it still draws (a cheaper level drops those the eye cannot
// resolve, and `grow`s the rest to cover the same area), and a level that
// keeps nothing ends the set. The vertex shader fades each instance over a
// band before every boundary (LOD_FADE_GLSL), so nothing pops. Each chunk
// level is an InstancedMesh over the set's shared vertex buffers; chunks
// are re-packed on the CPU, a few thousand instances a frame, when the eye
// has moved enough to move instances between levels (packLod).
const CHUNK = 20;
// How much larger leafy shoots draw into the sun's shadow map (see
// lodDepthMaterial).
const SHADOW_GROW = 1.4;
// Leaves sway up to ~1.5 m from their rest pose: cull with that margin.
const SWAY_MARGIN = 1.5;
const UP = new THREE.Vector3(0, 1, 0);
// Instances re-packed per frame at most (a jump re-packs everything at once).
const LOD_PACK_BUDGET = 24000;
// The eye in world space, for the fades in every pass (the shadow pass's
// camera is the sun's, but plants fade by distance from the eye).
const LOD_EYE = { value: new THREE.Vector3() };
function addInstances(scene, geometry, material, instances, shadows, far = null, { chunk = CHUNK, shadowGrow = 0 } = {}) {
  if (!instances.length) return;
  const steps = far ? (Array.isArray(far) ? far : [far]) : [];
  const levels = [{ geometry, grow: 1, keep: null, start: 0 }, ...steps.map((level) => ({
    geometry: level.geometry ?? geometry,
    grow: level.grow ?? 1,
    keep: level.keep ?? null,
    start: level.distance,
  }))];
  // Only sets whose levels change an instance's size need the fade.
  const fades = levels.some((level, i) => i > 0 && (level.grow !== levels[i - 1].grow || level.keep));
  const lodMaterial = fades ? withLodFade(material) : material;
  const depthMaterial = shadowGrow || fades ? lodDepthMaterial(shadowGrow || 1) : null;
  const tapered = instances[0].taper !== undefined;
  const coloured = instances.some((instance) => instance.color);
  for (const level of levels) withFlutter(level.geometry);
  levels.forEach((level) => level.geometry.computeBoundingSphere());
  const unitRadius = levels[0].geometry.boundingSphere.radius + levels[0].geometry.boundingSphere.center.length();
  const maxGrow = Math.max(...levels.map((level) => level.grow));
  const buckets = new Map();
  for (const instance of instances) {
    const key = `${Math.floor(instance.position.x / chunk)},${Math.floor(instance.position.z / chunk)}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(instance);
  }
  const transform = new THREE.Object3D();
  const registry = (scene.userData.lodChunks ??= []);
  for (const bucket of buckets.values()) {
    const n = bucket.length;
    const matrix = new Float32Array(n * 16);
    const color = coloured ? new Float32Array(n * 3).fill(1) : null;
    const anchor = new Float32Array(n);
    const bend = new Float32Array(n * 3);
    const shade = new Float32Array(n);
    const taper = tapered ? new Float32Array(n) : null;
    const positions = new Float32Array(n * 3);
    const radii = new Float32Array(n);
    const kept = new Uint8Array(n);
    bucket.forEach((instance, i) => {
      transform.position.copy(instance.position);
      transform.scale.copy(instance.scale);
      transform.rotation.copy(instance.rotation);
      transform.updateMatrix();
      transform.matrix.toArray(matrix, i * 16);
      if (instance.color) instance.color.toArray(color, i * 3);
      anchor[i] = instance.ground ?? instance.position.y;
      const b = instance.bend ?? UP;
      bend[i * 3] = b.x;
      bend[i * 3 + 1] = b.y;
      bend[i * 3 + 2] = b.z;
      shade[i] = instance.shade ?? 0;
      if (taper) taper[i] = instance.taper;
      instance.position.toArray(positions, i * 3);
      radii[i] = unitRadius * Math.max(instance.scale.x, instance.scale.y, instance.scale.z);
      levels.forEach((level, l) => {
        if (!level.keep || level.keep(instance)) kept[i] |= 1 << l;
      });
    });
    const fields = [
      { name: "matrix", size: 16, data: matrix },
      { name: "anchorHeight", size: 1, data: anchor },
      { name: "bendNormal", size: 3, data: bend },
      { name: "canopyShade", size: 1, data: shade },
      ...(color ? [{ name: "color", size: 3, data: color }] : []),
      ...(taper ? [{ name: "taper", size: 1, data: taper }] : []),
    ];
    const lod = createLodChunk({ positions, radii, kept, fields, levels });
    // One bounding sphere for every level: all the chunk's instances at
    // their largest, with the sway margin.
    const centre = new THREE.Vector3((lod.min[0] + lod.max[0]) / 2, (lod.min[1] + lod.max[1]) / 2, (lod.min[2] + lod.max[2]) / 2);
    let radius = 0;
    for (let i = 0; i < n; i++)
      radius = Math.max(radius, Math.hypot(positions[i * 3] - centre.x, positions[i * 3 + 1] - centre.y, positions[i * 3 + 2] - centre.z) + radii[i] * maxGrow);
    const sphere = new THREE.Sphere(centre, radius + SWAY_MARGIN);
    lod.outputs = [];
    lod.meshes = levels.map((level, l) => {
      const capacity = lod.capacity[l];
      if (!capacity) {
        lod.outputs.push(null);
        return null;
      }
      const geo = new THREE.BufferGeometry();
      geo.setIndex(level.geometry.index);
      for (const [name, attribute] of Object.entries(level.geometry.attributes)) geo.setAttribute(name, attribute);
      const mesh = new THREE.InstancedMesh(geo, lodMaterial, capacity);
      const live = (array, size) => new THREE.InstancedBufferAttribute(array, size).setUsage(THREE.DynamicDrawUsage);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      const out = { matrix: mesh.instanceMatrix.array };
      const attach = (name, size) => {
        const attribute = live(new Float32Array(capacity * size), size);
        geo.setAttribute(name, attribute);
        out[name] = attribute.array;
      };
      attach("anchorHeight", 1);
      attach("bendNormal", 3);
      attach("canopyShade", 1);
      if (taper) attach("taper", 1);
      attach("lodFade", 4);
      out.fade = out.lodFade;
      if (color) {
        mesh.instanceColor = live(new Float32Array(capacity * 3), 3);
        out.color = mesh.instanceColor.array;
      }
      lod.outputs.push(out);
      mesh.count = 0;
      mesh.visible = false;
      mesh.castShadow = shadows;
      if (depthMaterial) mesh.customDepthMaterial = depthMaterial;
      mesh.receiveShadow = true;
      mesh.boundingSphere = sphere;
      scene.add(mesh);
      return mesh;
    });
    registry.push(lod);
  }
}

// Re-packs the chunks whose instances have moved between levels, nearest
// first, within a per-frame budget. `eye` is the camera in world space;
// `group` the land group the instances live in.
function packLod(group, eye, bias) {
  const chunks = group.userData.lodChunks;
  if (!chunks) return;
  LOD_EYE.value.copy(eye);
  group.updateWorldMatrix(true, false);
  const local = group.worldToLocal(eye.clone());
  const at = [local.x, local.y, local.z];
  const state = (group.userData.lodState ??= { eye: null });
  // A jump (home, a teleport) or the first frame packs everything now.
  const jump = !state.eye || Math.hypot(at[0] - state.eye[0], at[1] - state.eye[1], at[2] - state.eye[2]) > 15;
  state.eye = at;
  const due = [];
  for (const chunk of chunks) if (packDue(chunk, at, bias)) due.push(chunk);
  if (!due.length) return;
  if (!jump) due.sort((a, b) => chunkRange(a, at)[0] - chunkRange(b, at)[0]);
  let budget = jump ? Infinity : LOD_PACK_BUDGET;
  for (const chunk of due) {
    if (budget <= 0) break;
    budget -= chunk.count;
    const counts = packChunk(chunk, at, bias);
    chunk.meshes.forEach((mesh, level) => {
      if (!mesh) return;
      const count = counts[level];
      mesh.count = count;
      mesh.visible = count > 0;
      if (!count) return;
      const attributes = [mesh.instanceMatrix, mesh.instanceColor, ...["anchorHeight", "bendNormal", "canopyShade", "taper", "lodFade"].map((name) => mesh.geometry.attributes[name])];
      for (const attribute of attributes) {
        if (!attribute) continue;
        attribute.clearUpdateRanges();
        attribute.addUpdateRange(0, count * attribute.itemSize);
        attribute.needsUpdate = true;
      }
    });
  }
}

// The vertex stage of the fade (instance-lod.js fadeScale): by its centre's
// distance from the eye, an instance shrinks toward a level that drops it,
// or grows toward the size a coarser level draws it at. A mesh without the
// attribute reads (0, 0, 0, 1): scale 1.
const LOD_FADE_GLSL = /* glsl */ `
#include <begin_vertex>
#ifdef USE_INSTANCING
{
  vec3 lodOrigin = ( modelMatrix * vec4( instanceMatrix[3].xyz, 1.0 ) ).xyz;
  float lodT = clamp( ( distance( lodOrigin, lodEye ) - lodFade.x ) / max( lodFade.y, 1e-3 ), 0.0, 1.0 );
  transformed *= mix( lodFade.z, lodFade.w, lodT * lodT * ( 3.0 - 2.0 * lodT ) );
}
#endif
`;
function lodVertex(source, after = "") {
  return "attribute vec4 lodFade;\nuniform vec3 lodEye;\n" + source.replace("#include <begin_vertex>", LOD_FADE_GLSL + after);
}

// Chains the fade onto a material's own patch (patchMaterial), once.
function withLodFade(material) {
  if (material.userData.lodFade) return material;
  material.userData.lodFade = true;
  const compile = material.onBeforeCompile;
  const key = material.customProgramCacheKey;
  material.onBeforeCompile = (shader, renderer) => {
    compile.call(material, shader, renderer);
    shader.uniforms.lodEye = LOD_EYE;
    shader.vertexShader = lodVertex(shader.vertexShader);
  };
  material.customProgramCacheKey = () => `${key.call(material)}|lod`;
  return material;
}

// A crown of shoots is mostly gaps at leaf scale, and a real crown's many
// layers of leaves, overlapping, block nearly all the sun: drawn as they
// are, the shoots cast shadows that let half of it through, a pale brown
// veil instead of shade lit by the blue sky. The shadow pass draws each
// shoot larger about its base so the crown's shadow closes up; the map only
// re-renders when the sun or the cat moves on, so this costs no frames.
// lod: the shadow pass fades instances as the colour pass does (LOD_EYE).
const grownDepth = new Map();
function lodDepthMaterial(grow) {
  if (!grownDepth.has(grow)) {
    const material = new THREE.MeshDepthMaterial({ side: THREE.DoubleSide });
    material.onBeforeCompile = (shader) => {
      shader.uniforms.lodEye = LOD_EYE;
      shader.vertexShader = lodVertex(shader.vertexShader, grow !== 1 ? `transformed *= ${grow.toFixed(3)};\n` : "");
    };
    material.customProgramCacheKey = () => `lod-grown-${grow}`;
    grownDepth.set(grow, material);
  }
  return grownDepth.get(grow);
}

// Geometry without its own per-leaf flutter data (petals, fronds' unit leaf)
// hinges at y = 0 and swings more toward y = 2, as one piece.
function withFlutter(geometry) {
  if (geometry.attributes.leafFlutter) return geometry;
  const position = geometry.attributes.position;
  const data = new Float32Array(position.count * 2);
  for (let i = 0; i < position.count; i++) data[i * 2 + 1] = Math.min(2, Math.max(0, position.getY(i)));
  geometry.setAttribute("leafFlutter", new THREE.BufferAttribute(data, 2));
  return geometry;
}

function addRocks(scene, random, shared, rocks = rockLayout(random)) {
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.92,
    // Opaque, so stacked boulders get early depth rejection (drawn back to
    // front in the transparent pass, every hidden face was fully shaded);
    // the waterline fade becomes MSAA coverage instead of blending.
    alphaToCoverage: true,
    clippingPlanes: [new THREE.Plane(new THREE.Vector3(0, 1, 0), 0.1)],
    // Cast from the sunlit faces. three's default (back faces) stores the
    // far side of the boulder, which near its foot is only centimetres above
    // the sand, so the depth bias lit a halo round the base.
    shadowSide: THREE.FrontSide,
  });
  patchMaterial(material, shared, { rock: true, fade: true });
  markSolid(material); // solid: no see-through cat through rock (cat-coat.js)
  // Sky occlusion from the neighbours: stones piled against each other see
  // less sky than a lone one on open sand (canopyShade, per instance).
  for (const rock of rocks) {
    const ri = Math.max(rock.scale.x, rock.scale.z) * 0.9;
    let visible = 1;
    for (const other of rocks) {
      if (other === rock) continue;
      const rj = Math.max(other.scale.x, other.scale.z) * 0.9;
      const d2 = (rock.position.x - other.position.x) ** 2 + (rock.position.z - other.position.z) ** 2;
      if (d2 > (ri + rj) ** 2 * 4) continue;
      // A small stone barely shades a big one.
      visible *= 1 - 0.5 * Math.min(1, rj / ri) * Math.exp(-d2 / (ri + rj) ** 2);
    }
    rock.shade = Math.min(0.4, 1 - visible);
    rock.ground ??= terrainHeight(rock.position.x, rock.position.z);
  }
  // The boulder fields get a fine mesh up close for crisp joints and clefts;
  // the scattered stones (mostly under half a metre) a light one.
  for (let v = 0; v < ROCK_VARIANTS; v++) {
    const own = rocks.filter((r) => r.variant === v);
    addInstances(scene, rockGeometry(12, v), material, own.filter((r) => r.cluster !== undefined && r.scale.x > 0.6), true, [
      { geometry: rockGeometry(7, v), distance: 10 },
      { geometry: rockGeometry(4, v), distance: 26 },
      { geometry: rockGeometry(2, v), distance: 55 },
    ]);
    addInstances(scene, rockGeometry(5, v), material, own.filter((r) => r.cluster === undefined || r.scale.x <= 0.6), true, [
      { geometry: rockGeometry(3, v), distance: 18 },
      { geometry: rockGeometry(1, v), distance: 45 },
    ]);
  }
  scene.traverse((o) => { if (o.material === material) o.renderOrder = SOLID_ORDER; }); // solid:
  return rocks;
}
