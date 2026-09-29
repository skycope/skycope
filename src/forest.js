import * as THREE from "three";
import {
  terrainHeight,
  shoreDistance,
  GROUND,
  islandPoint,
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
export function createForest(scene, seed) {
  const shared = {
    breezeTime: { value: 0 },
    breezeStrength: { value: 0.4 },
    breezeDir: { value: new THREE.Vector2(0.9, -0.436) },
    sunDirView: { value: new THREE.Vector3(0, 1, 0) },
    sunTint: { value: new THREE.Color(1, 0.92, 0.75) },
    sunGlow: { value: 1 },
    // Lambert-lit white (sun/π + sky), set from the shared lighting model.
    foamLight: { value: new THREE.Color(1, 1, 1) },
    // Night (0–1), for bioluminescence in the swash.
    nightGlow: { value: 0 },
    // The breaking swell train (src/swell.js), for swash on sand and rocks.
    swell: { value: new THREE.Vector4(...swellUniform(seed, [0, 0])) },
    // Where the cat is (coast x, z), how far it pushes, how hard.
    catPush: { value: new THREE.Vector4(0, 0, 0.4, 0) },
    // Horizon haze toward and away from the sun (aerial perspective).
    hazeToward: { value: new THREE.Color(0.6, 0.7, 0.8) },
    hazeAway: { value: new THREE.Color(0.6, 0.7, 0.8) },
    // The sun shadow map's centre (Three world space): beyond its reach the
    // baked canopy occlusion stands in for sun shadows.
    shadowCentre: { value: new THREE.Vector3() },
    // The sky dome's radiance as nine SH coefficients (landscape.js).
    skySH: { value: Array.from({ length: 9 }, () => new THREE.Vector3()) },
  };
  // `?perf` QA: the console can read and tweak the shared lighting uniforms.
  scene.userData.forestShared = shared;
  const random = seededRandom(seed);
  const { wood: trunks, leaves, clusters, flowers, turf, fronds, succulents, needles, reeds, layout } = createVegetation(seed);
  const rocks = addRocks(scene, random, shared);
  createSurf(scene, rocks, shared);
  const obstacles = obstaclesFor(layout, rocks);
  addGround(scene, shared, occludersFor(layout, rocks), coverFor(layout, turf));
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
  addInstances(
    scene,
    new THREE.CylinderGeometry(1, 1, 1, 7, 1, true),
    woodMaterial,
    trunks,
    true,
    [
      { geometry: new THREE.CylinderGeometry(1, 1, 1, 5, 1, true), keep: (w) => w.scale.x > 0.03, distance: 38 },
      { geometry: new THREE.CylinderGeometry(1, 1, 1, 3, 1, true), keep: (w) => w.scale.x > 0.07, distance: 85 },
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
  // are 14 small folded leaves (84 triangles, 98 vertices; was 6 big ones at
  // 120 and 102), only in the chunks round the cat: past ~17 m a leaf is a
  // few pixels and its folds are invisible, and full shoots out to 25 m cost
  // a millisecond. Then 7, 3 and 1 larger leaf cards (28, 12, 4 vertices).
  addInstances(scene, shootGeometry(14, 1), clusterMaterial, clusters, true, [
    { geometry: shootGeometry(7, 0), grow: 1.12, distance: 6 },
    { geometry: shootGeometry(3, 0), grow: 1.35 * Math.SQRT2, keep: (c) => shootShare(c) < 0.5, distance: 52 },
    { geometry: shootGeometry(1, 0), grow: 1.9 * Math.sqrt(3), keep: (c) => shootShare(c) < 0.34, distance: 95 },
  ]);
  const bladeMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.62,
    vertexColors: true,
    side: THREE.DoubleSide,
  });
  patchMaterial(bladeMaterial, shared, { sway: true, flutter: 0.08, foliage: true, bent: 0.45, pliant: true, rooted: 0.25, sheen: 0.3 });
  addInstances(scene, leafGeometry(1), bladeMaterial, leaves, true, [
    { geometry: leafGeometry(0), keep: (l) => l.scale.y > 0.18 || l.scale.x > 0.05, distance: 24 },
    { geometry: leafGeometry(0), keep: (l) => l.scale.y > 0.5, distance: 56 },
    { geometry: leafGeometry(0), keep: (l) => l.scale.y > 1.2, distance: 90 },
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
  // ~17 m a blade is under a pixel wide.
  addInstances(scene, tuftGeometry(24, 3, 2), turfMaterial, turf, false, [
    { geometry: tuftGeometry(10, 2), distance: 6 },
    { geometry: tuftGeometry(5, 2), keep: (t) => t.far, grow: 1.3, distance: 42 },
    { keep: () => false, distance: 70 },
  ]);
  // Restio clumps share the tufts' pliant, vertex-coloured material.
  addInstances(scene, reedGeometry(34, 1), turfMaterial, reeds, true, [
    { geometry: reedGeometry(14, 0), distance: 8 },
    { keep: () => false, distance: 75 },
  ], { chunk: 40 });
  // Fern and palm fronds: one organ per frond. Palms (tall anchors) stay
  // to the horizon; fern fronds drop out where they'd be a few pixels.
  addInstances(scene, frondGeometry(16, 2), bladeMaterial, fronds, true, [
    { geometry: frondGeometry(12, 1), distance: 6 },
    { geometry: frondGeometry(8, 0), keep: (f) => f.scale.y > 1.5 || shootShare(f) < 0.6, distance: 45 },
    { geometry: frondGeometry(6, 0), keep: (f) => f.scale.y > 1.5, distance: 90 },
  ]);
  // Heath shoots: needles, on the same foliage material as leafy shoots.
  addInstances(scene, needleGeometry(26), clusterMaterial, needles, true, [
    { geometry: needleGeometry(10), grow: 1.15, distance: 14 },
    { geometry: needleGeometry(4), grow: 1.5, keep: (c) => shootShare(c) < 0.5, distance: 55 },
  ]);
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
    { geometry: succulentGeometry(0), distance: 6 },
    { keep: (s) => s.scale.y > 0.35, distance: 60 },
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
  addInstances(scene, daisyGeometry(), petalMaterial, flowers.daisy, false, { keep: () => false, distance: 32 }, { chunk: 40 });
  addInstances(scene, proteaGeometry(1), petalMaterial, flowers.protea, true, [{ geometry: proteaGeometry(0), distance: 8 }, { keep: () => false, distance: 70 }], { chunk: 40 });
  addInstances(scene, pincushionGeometry(36, 1), petalMaterial, flowers.pincushion, true, [{ geometry: pincushionGeometry(14, 0), distance: 8 }, { keep: () => false, distance: 70 }], { chunk: 40 });
  addInstances(scene, spikeGeometry(), petalMaterial, flowers.spike, true, [{ geometry: spikeGeometry(14), distance: 31 }, { keep: () => false, distance: 84 }], { chunk: 40 });
  addInstances(scene, white(bellGeometry()), petalMaterial, flowers.bell, false, { keep: () => false, distance: 31 }, { chunk: 40 });
  return {
    // Trunks and boulders, for the cat to walk around (or climb).
    obstacles,
    // The boulders the sea touches, for the water pass (rocks.js).
    shoreRocks: shoreRockData(rocks),
    // The island's top surface for reflections in the sea (land-field.js).
    landField: landFieldData(clusters),
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
      const push = shared.catPush.value;
      push.x = x;
      push.y = z;
      push.w += (strength - push.w) * 0.2;
    },
    updateNight(night) {
      shared.nightGlow.value = night;
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
    updateSun(directionView, tint, glow) {
      shared.sunDirView.value.copy(directionView);
      shared.sunTint.value.copy(tint);
      shared.sunGlow.value = glow;
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
varying float vGlint;
// Height of the plant's base (per instance): wind bends from there, so a trunk
// or stem is rooted wherever it stands. Zero for non-instanced meshes.
attribute float anchorHeight;
varying float vAbove;
varying float vGust;
vec3 windOffset(vec3 p) {
  float h = max(p.y - anchorHeight, 0.0);
  float gust = gustAt( p.xz );
  vGust = gust;
  float sway = sin(breezeTime * 0.8 + p.x * 0.11 + p.z * 0.09);
  float bob = sin(breezeTime * 2.3 + p.x * 0.9 + p.z * 0.7 + h * 0.6);
  float amp = breezeStrength * (0.25 + 0.75 * gust);
  vec3 offset = vec3(breezeDir.x, 0.0, breezeDir.y) * ((sway * 0.7 + gust * 0.6) * h * h * 0.0035 * amp)
    + vec3(breezeDir.x, -0.25, breezeDir.y) * (bob * h * 0.012 * amp);
  #ifdef PLIANT
    float blade = h * h / ( 0.25 + h ) * ( 1.0 - smoothstep( 1.2, 2.6, h ) );
    float lash = sin( breezeTime * 2.7 + p.x * 1.3 + p.z * 0.9 ) * ( 0.15 + 0.3 * gust );
    vec2 push = breezeDir * ( blade * breezeStrength * ( 0.12 + gust * 0.55 + lash ) );
    offset.xz += push;
    offset.y -= dot( push, push ) / max( h, 0.05 ) * 0.5;
  #endif
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
    float skyVisible = 1.0 - vShade;
    reflectedLight.indirectDiffuse *= skyVisible;
    reflectedLight.indirectSpecular *= skyVisible * skyVisible;
    float farShade = 1.0 - vShade * 0.85 * vShadowFar;
    reflectedLight.directDiffuse *= farShade;
    reflectedLight.directSpecular *= farShade;
    ${
      foliage
        ? `vec3 canopyGreen = diffuseColor.rgb * vec3( 2.0, 2.25, 1.45 );
    reflectedLight.indirectDiffuse += foamLight * canopyGreen * diffuseColor.rgb * vShade * 0.5;`
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
    * ( behind * ( 0.85 + forward * 1.6 ) + forward * 0.15 );
  // Glossy leaves mirror the sky (SKY_SH_GLSL). Deep in a crown the leaves
  // around each one hide most of it (vCrownAO), and duller organs (grass
  // blades) reflect less: SHEEN is relative to a leaf's 0.6.
  reflectedLight.indirectSpecular *= vCrownAO * vCrownAO * ( SHEEN / 0.6 );
  // Skylight through the canopy: undersides glow faintly green.
  reflectedLight.indirectDiffuse += transmit / max( diffuseColor.rgb, vec3( 0.001 ) ) * reflectedLight.indirectDiffuse
    * clamp( -normal.y * 0.5 + 0.5, 0.0, 1.0 ) * 0.5;
  // Waxy cuticle: each leaf mirrors the sun at its own angle, so a crown
  // shimmers leaf by leaf instead of carrying one broad highlight.
  vec3 sparkleRay = reflect( -sunDirView, leafN );
  float sparkle = pow( clamp( dot( sparkleRay, toEye ), 0.0, 1.0 ), 48.0 ) * facing;
  float gate = 0.35 + 0.65 * smoothstep( 0.55, 0.95, fract( vGlint * 9.173 + breezeTime * 0.11 ) );
  reflectedLight.directSpecular += leafSun * sparkle * gate * 0.5;
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
  float fogFade = smoothstep( 60.0, 220.0, vFogDepth );
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
// Metre-scale masks are baked per vertex (vGroundMask: mottling, exposed
// granite, leaf litter); only centimetre detail is evaluated per pixel.
vec2 coast = vec2( vWorld.x, -vWorld.z );
float inland = dShore( coast );
// Metres per pixel. Grain finer than ~2 pixels is replaced by its mean, not
// sampled: sampled, it shimmered as the camera moved.
float px = max( fwidth( coast.x ), fwidth( coast.y ) );
float grain = mix( dNoise( coast * 38.0 ), 0.5, smoothstep( 0.2, 0.5, px * 38.0 ) ) * 0.6
  + mix( dNoise( coast * 90.0 ), 0.5, smoothstep( 0.2, 0.5, px * 90.0 ) ) * 0.4;
float mottled = vGroundMask.x;
float rocky = vGroundMask.y;
float litter = vGroundMask.z;
// Wind ripples on dry sand, crests across the prevailing south-easter.
float ripple = sin( dot( coast, vec2( 0.44, 0.9 ) ) * 9.0 + dNoise( coast * 0.8 ) * 6.0 );
float dry = smoothstep( 1.2, 3.0, inland ) * ( 1.0 - smoothstep( 6.0, 11.0, inland ) );
float wet = 1.0 - smoothstep( 0.1, 1.6, inland + ( mottled - 0.5 ) * 0.8 );
diffuseColor.rgb *= 0.78 + grain * mix( 0.3, 0.08, wet ) + ( mottled - 0.5 ) * 0.35;
diffuseColor.rgb *= 1.0 + ripple * 0.06 * dry;
diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 0.52, 0.5, 0.48 ), wet );
// Coarse granitic sand up close: black heavy minerals and biotite, white
// shell grit and quartz, pink feldspar, each a few millimetres, averaged
// away beyond a couple of metres.
float grainNear = ( 1.0 - smoothstep( 0.0025, 0.006, px ) ) * ( 1.0 - rocky );
if ( grainNear > 0.01 ) {
  float darkGrain = smoothstep( 0.8, 0.9, dNoise( coast * 210.0 + 3.0 ) );
  float paleGrain = smoothstep( 0.8, 0.88, dNoise( coast * 170.0 + 11.0 ) );
  float pinkGrain = smoothstep( 0.82, 0.9, dNoise( coast * 150.0 + 23.0 ) );
  diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * 0.35, darkGrain * grainNear * 0.8 );
  diffuseColor.rgb = mix( diffuseColor.rgb, mix( vec3( 0.8, 0.78, 0.74 ), diffuseColor.rgb, wet * 0.6 ), paleGrain * grainNear * 0.6 );
  diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 1.25, 0.95, 0.88 ), pinkGrain * grainNear * 0.6 );
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
// Sward: under and between the tufts, blades too fine and too many to model.
// Short strokes combed downwind, in clumps, over the thatch colour already
// baked per vertex; each stroke averages to its mean below ~2 pixels. A
// gust rolling through turns the blades' paler sides up, so grass visibly
// brightens in travelling bands, in step with the tufts' own bending.
float grassy = vGroundMask.w;
float sward = 0.0;
if ( grassy > 0.02 ) {
  vec2 wind = vec2( dot( coast, breezeDir ), dot( coast, vec2( -breezeDir.y, breezeDir.x ) ) );
  float strokes = mix( dNoise( wind * vec2( 55.0, 110.0 ) ), 0.5, smoothstep( 0.2, 0.5, px * 110.0 ) );
  float tufts = dNoise( coast * 2.7 + 7.0 );
  float cover = smoothstep( 0.1, 0.6, grassy );
  sward = cover * ( 0.5 * strokes + 0.5 * tufts );
  diffuseColor.rgb *= mix( 1.0, 0.72 + strokes * 0.3 + tufts * 0.3, cover );
  diffuseColor.rgb *= 1.0 + cover * 0.25 * ( vGroundGust - 0.55 ) * breezeStrength;
}
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
      float cover = ( 1.0 - smoothstep( 0.82, 1.0, d ) ) * sandy * nearDetail;
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
    // Stranded kelp in drifts along the wrack line.
  }
  float floorMix = max( litter, smoothstep( 9.0, 15.0, inland ) * 0.35 ) * ( 1.0 - rocky ) * ( 1.0 - grassy * 0.6 ) * nearDetail;
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
      vec3 leafColour = mix( mix( vec3( 0.36, 0.2, 0.07 ), vec3( 0.55, 0.36, 0.1 ), dHash( id + 4.8 ) ), vec3( 0.25, 0.3, 0.1 ), step( 0.8, dHash( id + 9.9 ) ) );
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
float detailHeight = grain * 0.004 + ripple * 0.012 * dry * ( 1.0 - grassy ) + mottled * 0.03 * ( 1.0 - wet ) + rocky * strata * 0.08 + clutterHeight + sward * 0.02;
float detailRoughness = mix( mix( mix( 0.95, 0.9, rocky ), 0.28, wet ), 0.35, clutterGloss );
// The swash (surf.js, on the sea's clock): each bore's film runs up the sand
// and drains back, froth at its front and lace left in the backwash, little
// bubbles popping in it, the swash mark at the top, and sand that stays dark
// and glossy for a few seconds as it drains. The film mirrors the sky.
float swashFilm = 0.0;
float swashCover = 0.0;
float swashGlow = 0.0;
if ( inland < 4.5 ) {
  float along = shoreAlong( coast );
  vec4 sw = swash( along, inland, breezeTime );
  swashFilm = sw.x;
  float pixel = length( fwidth( coast ) );
  swashCover = swashFoam( vec2( along * 0.7, inland ), sw.y, breezeTime, pixel );
  // Bubbles ride in the froth and just behind the front, and dot the film.
  vec2 bubbles = swashBubbles( coast, breezeTime, pixel, smoothstep( 0.04, 0.35, sw.y + sw.x * 0.12 ) );
  diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 0.55, 0.56, 0.55 ), sw.z * ( 1.0 - wet ) * 0.85 );
  diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 0.66, 0.76, 0.76 ), swashFilm * smoothstep( 0.0, 0.25, sw.w ) );
  swashCover = max( swashCover, bubbles.x );
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
  diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.66, 0.68, 0.7 ), swashCover );
  detailHeight *= 1.0 - swashFilm * 0.9;
  detailHeight += swashCover * 0.004;
  detailRoughness = mix( detailRoughness, 0.3, sw.z );
  detailRoughness = mix( detailRoughness, 0.04, swashFilm * ( 1.0 - swashCover ) );
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
diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 1.3, 0.98, 0.72 ), iron * 0.55 );
// Patina: undersides and hollows darken where rain and light don't reach.
diffuseColor.rgb *= mix( 0.72, 1.0, smoothstep( 0.0, 0.5, up + mid * 0.3 ) );
// Joint cracks and exfoliation seams: thin dark lines, faded with distance.
float crackWidth = 0.0035 + footprint * 0.6;
float seam = 1.0 - smoothstep( 0.0, crackWidth, abs( dNoise3( q * 0.8 + 11.0 ) + ( mid - 0.5 ) * 0.08 - 0.5 ) );
seam *= ( 1.0 - smoothstep( 0.015, 0.04, footprint ) ) * smoothstep( 0.5, 0.62, macro * 0.7 + mid * 0.3 ) * smoothstep( 0.3, 0.6, relief + mid * 0.3 );
diffuseColor.rgb *= 1.0 - seam * 0.3;
// Grain: coarse porphyritic granite, feldspar crystals a centimetre or two.
float grainFade = 1.0 - smoothstep( 0.004, 0.012, footprint );
float feldspar = 0.0;
float biotite = 0.0;
float quartz = 0.0;
if ( grainFade > 0.01 ) {
  feldspar = smoothstep( 0.58, 0.72, dNoise3( q * 38.0 ) ) * grainFade;
  quartz = smoothstep( 0.6, 0.75, dNoise3( q * 61.0 + 4.0 ) ) * grainFade;
  biotite = smoothstep( 0.7, 0.8, dNoise3( q * 110.0 + 9.0 ) ) * grainFade;
  diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 1.32, 1.22, 1.12 ), feldspar );
  diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 0.82, 0.84, 0.88 ), quartz );
  diffuseColor.rgb *= 1.0 - biotite * 0.7;
}
// Far away the grain's mean: the crystals lighten the rock a little overall.
diffuseColor.rgb *= mix( 1.04, 1.0, grainFade );
// The shore's zones, by height above the sea.
float y = q.y + ( mid - 0.5 ) * 0.25;
// Lichen crusts above the spray: grey-green rosettes, orange Xanthoria.
// Crusts: ragged-edged patches a hand or two across. Rosettes: round
// orange colonies a few centimetres wide, scattered and clustered where the
// crusts are, each its own size; they average to a faint tint far off.
float lichenZone = smoothstep( 0.9, 1.6, y ) * smoothstep( 0.3, 0.8, up );
float lichen = 0.0;
float orange = 0.0;
if ( lichenZone > 0.01 ) {
  float rosette = mid * 0.7 + macro * 0.3;
  float fray = mix( dNoise3( q * 17.0 ), 0.5, smoothstep( 0.2, 0.5, footprint * 17.0 ) );
  lichen = smoothstep( 0.6, 0.64, rosette + ( fray - 0.5 ) * 0.16 ) * lichenZone;
  float colonies = smoothstep( 0.45, 0.75, rosette ) * lichenZone;
  if ( footprint < 0.03 ) {
    vec2 g = coast * 11.0 + q.y * 2.0;
    vec2 cell = floor( g );
    vec2 f = fract( g );
    for ( int j = -1; j <= 1; j++ ) for ( int i = -1; i <= 1; i++ ) {
      vec2 o = vec2( float( i ), float( j ) );
      vec2 id = cell + o;
      if ( dHash( id + 21.0 ) > colonies * 0.8 ) continue;
      vec2 c = o + vec2( dHash( id ), dHash( id + 5.3 ) ) - f;
      float r = 0.12 + 0.4 * pow( dHash( id + 9.1 ), 2.0 );
      orange = max( orange, 1.0 - smoothstep( r * 0.75, r, length( c ) ) );
    }
    orange *= 1.0 - smoothstep( 0.012, 0.03, footprint );
  }
  orange = mix( orange, colonies * 0.12, smoothstep( 0.012, 0.03, footprint ) );
}
diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.38, 0.4, 0.33 ) * ( 0.8 + mid * 0.4 ), lichen * 0.5 );
diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.55, 0.3, 0.07 ), orange * 0.7 );
// Black splash-zone lichen, a ragged band.
float splash = smoothstep( 0.15, 0.45, y ) * ( 1.0 - smoothstep( 0.9, 1.5, y + ( macro - 0.5 ) * 0.6 ) );
diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.05, 0.05, 0.045 ), splash * smoothstep( 0.4, 0.65, mid + macro * 0.3 ) * 0.55 );
// Barnacles: pale, rough, crowded just above the low-water line.
float barnacleZone = smoothstep( 0.0, 0.12, y ) * ( 1.0 - smoothstep( 0.35, 0.6, y ) );
float barnacles = 0.0;
if ( barnacleZone > 0.01 && footprint < 0.02 ) {
  barnacles = smoothstep( 0.62, 0.74, dNoise3( q * 55.0 ) ) * smoothstep( 0.35, 0.6, dNoise3( q * 4.0 + 1.0 ) )
    * barnacleZone * ( 1.0 - smoothstep( 0.005, 0.015, footprint ) );
}
diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.46, 0.44, 0.4 ), barnacleZone * 0.25 );
diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.62, 0.6, 0.55 ), barnacles * 0.5 );
// Green algae and weed at and below the waterline, thinning upward.
float algae = ( 1.0 - smoothstep( -0.1, 0.3, y ) ) * smoothstep( 0.3, 0.55, mid + relief * 0.3 );
diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.09, 0.12, 0.05 ) * ( 0.7 + mid * 0.6 ), algae * 0.6 );
// Swash on the rock, on the sea's clock: a sheet of water running up and
// draining, and damp rock below the highest run-up.
float surgeS = fract( -swashPhase( shoreAlong( coast ), breezeTime ) / 6.283185 ) / 0.82;
float surgeNow = surgeS < 1.0 ? pow( sin( 3.141593 * pow( surgeS, 0.65 ) ), 2.0 ) : 0.0;
float runup = 0.12 + ( 0.25 + swell.w * 2.5 ) * surgeNow;
float sheet = 1.0 - smoothstep( runup - 0.15, runup + 0.05, y + ( relief - 0.5 ) * 0.1 );
float damp = 1.0 - smoothstep( 0.2, 0.6 + swell.w * 2.5, y );
diffuseColor.rgb *= mix( 1.0, 0.7, damp * ( 1.0 - sheet ) );
diffuseColor.rgb *= mix( 1.0, 0.55, sheet );
float detailHeight = macro * 0.05 + mid * 0.018 + relief * 0.022 + feldspar * 0.0015 - biotite * 0.001 - seam * 0.006 + barnacles * 0.004 + lichen * 0.002;
float detailRoughness = mix( mix( mix( 0.82, 0.95, max( barnacles, lichen ) ), 0.5, damp ), 0.12, sheet );
detailHeight *= 1.0 - sheet * 0.8;
`;

// Bark: vertical fissures between corky plates, the plates' faces paler
// and weathered, the fissures dark and deep; world-space, so a tree's
// branches share one continuous pattern. Moss and green algae grow on the
// upper, damper side of limbs and up the trunk's shaded foot; pale lichen
// crusts patch the rest. Detail finer than a pixel averages out.
const BARK_COLOUR_GLSL = /* glsl */ `
#include <color_fragment>
float barkPx = max( fwidth( vWorld.y ), fwidth( vWorld.x + vWorld.z ) );
float around = ( vWorld.x * 0.7 + vWorld.z * 0.7 ) * 26.0;
float fissure = dNoise( vec2( around, vWorld.y * 1.8 ) ) * 0.65
  + mix( dNoise( vec2( around * 2.3, vWorld.y * 5.0 ) ), 0.5, smoothstep( 0.2, 0.5, barkPx * 60.0 ) ) * 0.35;
float plates = smoothstep( 0.32, 0.62, fissure );
float crack = 1.0 - smoothstep( 0.18, 0.34, fissure );
diffuseColor.rgb *= 0.5 + plates * 0.62;
diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * 0.35, crack * 0.8 );
// Weathered plate faces go silvery grey.
diffuseColor.rgb = mix( diffuseColor.rgb, vec3( dot( diffuseColor.rgb, vec3( 0.33 ) ) ), plates * 0.15 );
vec3 barkUp = ( vec4( normalize( vNormal ), 0.0 ) * viewMatrix ).xyz;
float moss = smoothstep( 0.25, 0.8, barkUp.y + ( dNoise( vec2( around * 0.3, vWorld.y * 1.2 ) + 9.0 ) - 0.5 ) * 0.9 )
  * smoothstep( 0.35, 0.65, dNoise( vec2( around * 0.12, vWorld.y * 0.5 ) + 3.0 ) );
diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.09, 0.13, 0.04 ) * ( 0.7 + fissure * 0.6 ), moss * 0.55 );
float bark_lichen = smoothstep( 0.68, 0.8, dNoise( vec2( around * 0.4, vWorld.y * 3.0 ) + 5.0 ) ) * ( 1.0 - moss );
diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.42, 0.44, 0.36 ), bark_lichen * 0.5 );
float detailHeight = plates * 0.012 - crack * 0.006 + moss * 0.004;
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
// dFbm with each octave faded to its mean once it is finer than ~2 pixels.
// cycles is the first octave's cells per pixel; each octave doubles it.
float dFbmFiltered( vec2 p, float cycles ) {
  float v = 0.0;
  float a = 0.5;
  for ( int i = 0; i < 4; i++ ) {
    v += a * mix( dNoise( p ), 0.5, smoothstep( 0.2, 0.5, cycles ) );
    p = mat2( 1.6, 1.2, -1.2, 1.6 ) * p;
    cycles *= 2.0;
    a *= 0.5;
  }
  return v;
}
float dFbm( vec2 p ) {
  float v = 0.0;
  float a = 0.5;
  for ( int i = 0; i < 4; i++ ) { v += a * dNoise( p ); p = mat2( 1.6, 1.2, -1.2, 1.6 ) * p; a *= 0.5; }
  return v;
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
// Signed shore distance, matching terrain.js (positive inland).
float dShore( vec2 p ) {
  vec2 d = p - vec2( 58.0, 70.0 );
  float t = atan( d.y, d.x );
  return 62.0 + 14.0 * sin( 2.0 * t + 0.8 ) + 7.0 * sin( 3.0 * t + 2.1 ) + 3.5 * sin( 7.0 * t + 4.5 ) - length( d );
}
`;

function patchMaterial(material, shared, { sway = false, flutter = 0, foliage = false, ground = false, rock = false, bark = false, bent = 0, fade = false, taper = false, pliant = false, rooted = 0, sheen = 0.6 } = {}) {
  // three caches programs by onBeforeCompile's source text, which is the same
  // for every patched material: key them by their options, or a material
  // silently runs another's shader (blades with the clusters' flutter).
  const key = JSON.stringify({ sway, flutter, foliage, ground, rock, bark, bent, fade, taper, pliant, rooted, sheen });
  material.customProgramCacheKey = () => key;
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
        #endif`
            : ""
        }`,
      );
    shader.vertexShader = shader.vertexShader.replace(
      "void main() {",
      `${flutter ? "attribute vec2 leafFlutter;\n" : ""}${taper ? "attribute float taper;\n" : ""}void main() {`,
    );
    if (sway)
      shader.vertexShader = shader.vertexShader.replace(
        "#include <project_vertex>",
        foliage ? PROJECT_GLSL.replace("vAbove =", `${PUSH_GLSL}\nvAbove =`) : PROJECT_GLSL,
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
      "uniform vec3 sunDirView;\nuniform vec3 sunTint;\nuniform float sunGlow;\nuniform float breezeTime;\nvarying float vGlint;\nvarying float vGust;\n" +
      "uniform vec3 hazeToward;\nuniform vec3 hazeAway;\nuniform vec3 foamLight;\nvarying float vShade;\nvarying float vShadowFar;\n" +
      shader.fragmentShader
        .replace("#include <fog_fragment>", FOG_GLSL)
        .replace("#include <lights_fragment_end>", `#include <lights_fragment_end>\n${occlusionGlsl(foliage)}`);
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
            ? "varying vec3 vWorld;\nattribute vec4 groundMask;\nvarying vec4 vGroundMask;\nvarying float vGroundGust;\nvoid main() {\n  vGroundMask = groundMask;\n  // Gust bands are metres wide: the 0.5 m ground grid resolves them.\n  vGroundGust = gustAt( position.xz );"
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
      shader.fragmentShader = shader.fragmentShader
        .replace("uniform float breezeTime;\n", "")
        .replace("void main() {", DETAIL_GLSL + (ground ? "varying vec4 vGroundMask;\nvarying float vGroundGust;\n" + SWASH_GLSL : rock ? SWASH_GLSL : "") + "\nvoid main() {")
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
        }`);
    }
    if (ground)
      // Sand sparkle, lit by the shadowed sun from three's light loop.
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <lights_fragment_begin>", LEAF_LIGHTS_GLSL)
        .replace("#include <lights_fragment_end>", SAND_GLINT_GLSL);
    if (foliage || bark)
      shader.fragmentShader = shader.fragmentShader
        .replace("void main() {", "uniform vec3 skySH[ 9 ];\nvoid main() {")
        .replace("#include <lights_fragment_maps>", SKY_SH_GLSL);
    if (foliage)
      shader.fragmentShader = shader.fragmentShader
        .replace("void main() {", `varying vec3 vLeafNormal;\nvarying float vCrownAO;\n${rooted ? "varying float vAbove;\n" : ""}void main() {`)
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
        .replace("void main() {", "attribute vec3 bendNormal;\nvarying vec3 vLeafNormal;\nvarying float vCrownAO;\nvoid main() {")
        .replace(
          "#include <defaultnormal_vertex>",
          `#include <defaultnormal_vertex>
          vLeafNormal = transformedNormal;
          // The bent normal's length carries the shoot's depth in its crown.
          vCrownAO = length( bendNormal );
          vec3 bendView = normalize( normalMatrix * bendNormal );
          vec3 outerLeaf = dot( transformedNormal, bendView ) < 0.0 ? -transformedNormal : transformedNormal;
          transformedNormal = normalize( mix( outerLeaf, bendView, ${bent.toFixed(2)} ) );`,
        );
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <normal_fragment_begin>",
        THREE.ShaderChunk.normal_fragment_begin.replace("normal *= faceDirection;", ""),
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
  };
}

// What the cat collides with. Trunks are circles; rocks are domes it can
// climb or jump onto (height above the centre falls off to their rim).
function obstaclesFor(layout, rocks) {
  const trunks = layout
    .filter((p) => p.kind === "tree")
    .map((p) => ({ x: p.x, z: p.z, r: p.height * 0.034 + 0.02 }));
  const domes = rockSurfaces(rocks);
  // Flowering fynbos, where butterflies feed.
  const flowers = layout
    .filter((p) => ["protea", "erica", "daisies", "aloe"].includes(p.kind))
    .map((p) => ({ x: p.x, z: p.z, h: p.height }));
  return { trunks, domes, flowers };
}

// Each rock's true top surface, rasterized from its mesh into a small height
// tile (6 cm cells): what the cat stands on, climbs, and is blocked by.
function rockSurfaces(rocks) {
  const sources = Array.from({ length: ROCK_VARIANTS }, (_, v) => rockGeometry(3, v));
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
  // Moss: velvet cushions on shaded soil, in the grass channel (the ground
  // shader's fine sward texture reads as moss pile in its colour).
  const moss = new THREE.Color();
  for (const p of layout)
    if (p.kind === "moss")
      splat(p.x, p.z, 0.7 + p.height * 5, 1.4, grass, moss.setHSL(0.24 + noise2(p.x * 0.3, p.z * 0.3) * 0.1, 0.5, 0.2));
  for (const p of layout) {
    if (p.kind === "tree") {
      splat(p.x, p.z, Math.min(5, 1 + p.height * 0.4), 0.9, humus);
      splat(p.x, p.z, 0.6 + p.height * 0.05, 1.2, humus);
    } else if (p.kind === "shrub" || p.kind === "protea" || p.kind === "erica" || p.kind === "fern" || p.kind === "moss") {
      splat(p.x, p.z, 0.4 + p.height * 0.9, 0.8, humus);
    } else if (p.kind === "restio" || p.kind === "daisies" || p.kind === "aloe") {
      splat(p.x, p.z, 0.4 + p.height * 0.6, 0.6, grass);
      splat(p.x, p.z, 0.3 + p.height * 0.4, 0.4, humus);
    }
  }
  return (x, z) => {
    const i = Math.round((x - x0) / cell);
    const j = Math.round((z - z0) / cell);
    if (i < 0 || j < 0 || i >= n || j >= n) return { grass: 0, humus: 0, colour: null };
    const k = j * n + i;
    const g = grass[k];
    const w = Math.max(1e-6, g);
    return {
      grass: 1 - Math.exp(-g * 1.1),
      humus: 1 - Math.exp(-humus[k] * 1.3),
      colour: g > 1e-4 ? new THREE.Color(tint[k * 3] / w, tint[k * 3 + 1] / w, tint[k * 3 + 2] / w) : null,
    };
  };
}

function addGround(scene, shared, occluders, cover) {
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
  // An ecotone replaces the hard beach-forest line: sand grades through dry
  // dune tones and leaf litter into forest soil, dithered by noise over metres.
  const sand = new THREE.Color("#b9a98b");
  const wetSand = new THREE.Color("#7a6f55");
  const dune = new THREE.Color("#a2926f");
  const litter = new THREE.Color("#4a3d28");
  const moss = new THREE.Color("#354b26");
  const humusColour = new THREE.Color("#3b2c1c");
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
    color.lerp(
      moss,
      smoothstep(9, 17 + dither, inland) *
        (0.4 + noise2(x * 0.13, z * 0.11) * 0.6),
    );
    // Under the plants: humus darkens the soil beneath crowns and shrubs;
    // tufts leave thatch in their own colour (a shade darker: the dead and
    // shaded blades at their feet), so turf and ground meet without a seam.
    const { grass, humus, colour: tuftColour } = cover(x, z);
    color.lerp(humusColour, humus * 0.75);
    if (tuftColour) color.lerp(thatch.copy(tuftColour).multiplyScalar(0.62).lerp(humusColour, 0.25), grass * 0.8);
    color.multiplyScalar(0.88 + noise2(x * 2, z * 2) * 0.22);
    color.toArray(colors, i * 3);
    shades[i] = 1 - occlusion(x, z);
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute("canopyShade", new THREE.BufferAttribute(shades, 1));
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
  const h = Math.sin(shoot.position.x * 12.9898 + shoot.position.z * 78.233 + shoot.position.y * 37.719) * 43758.5453;
  return h - Math.floor(h);
}

// Instances are bucketed into ground chunks so the camera frustum culls whole
// regions in both the colour and shadow passes. Each chunk is also a THREE.LOD:
// beyond LOD_DISTANCE it swaps to a cheaper geometry and drops instances the
// eye cannot resolve (fine twigs, tiny blades), which is where most triangles
// were being spent. Chunks share geometry and material; the cost is draw calls.
// LOD distances are measured to the chunk centre, so each threshold is pushed
// out by most of a 20 m chunk's half-diagonal: a chunk no longer swaps detail
// (or drops shoots) while its near edge is right beside the camera, which
// read as plants glitching in and out. Hysteresis stops it flickering on the
// boundary as the cat walks back and forth. Dense sets use 10 m chunks (with
// the same 20 m margin, so detail reaches as far): occlusion culling
// (occlusion.js) then holds back far more hidden foliage, for ~130 more
// draw calls.
const CHUNK = 10;
const LOD_HYSTERESIS = 0.12;
// Leaves sway up to ~1.5 m from their rest pose: cull with that margin.
const SWAY_MARGIN = 1.5;
const UP = new THREE.Vector3(0, 1, 0);
const LOD_DISTANCE = 42;
// Sparse sets (a few hundred aloes, reeds or flower heads) pass a larger
// `chunk`: each chunk costs a draw call per set, and a sparse set gains
// little from fine culling.
function addInstances(scene, geometry, material, instances, shadows, far = null, { chunk = CHUNK } = {}) {
  const margin = Math.max(chunk, 20) * 0.55;
  const chunks = new Map();
  for (const instance of instances) {
    const key = `${Math.floor(instance.position.x / chunk)},${Math.floor(instance.position.z / chunk)}`;
    if (!chunks.has(key)) chunks.set(key, []);
    chunks.get(key).push(instance);
  }
  const transform = new THREE.Object3D();
  const tapered = instances.length > 0 && instances[0].taper !== undefined;
  const build = (source, bucket, level) => {
    withFlutter(source);
    // Instance attributes live on the geometry, so each chunk gets a light
    // clone (vertex buffers are small) carrying its anchors and bent normals.
    const geo = source.clone();
    const anchors = new Float32Array(bucket.length);
    const bends = new Float32Array(bucket.length * 3);
    const shades = new Float32Array(bucket.length);
    const mesh = new THREE.InstancedMesh(geo, material, bucket.length);
    for (let i = 0; i < bucket.length; i++) {
      const instance = bucket[i];
      transform.position.copy(instance.position);
      transform.scale.copy(instance.scale);
      transform.rotation.copy(instance.rotation);
      if (level?.grow) transform.scale.multiplyScalar(level.grow);
      transform.updateMatrix();
      mesh.setMatrixAt(i, transform.matrix);
      if (instance.color) mesh.setColorAt(i, instance.color);
      anchors[i] = instance.ground ?? instance.position.y;
      const bend = instance.bend ?? UP;
      bends.set([bend.x, bend.y, bend.z], i * 3);
      shades[i] = instance.shade ?? 0;
    }
    geo.setAttribute("anchorHeight", new THREE.InstancedBufferAttribute(anchors, 1));
    if (tapered)
      geo.setAttribute("taper", new THREE.InstancedBufferAttribute(Float32Array.from(bucket, (w) => w.taper), 1));
    geo.setAttribute("bendNormal", new THREE.InstancedBufferAttribute(bends, 3));
    geo.setAttribute("canopyShade", new THREE.InstancedBufferAttribute(shades, 1));
    mesh.castShadow = shadows;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    mesh.boundingSphere.radius += SWAY_MARGIN;
    return mesh;
  };
  // `far` is one LOD level or a list of them, nearest first.
  const levels = far ? (Array.isArray(far) ? far : [far]) : [];
  for (const bucket of chunks.values()) {
    const near = build(geometry, bucket, null);
    if (!levels.length) {
      scene.add(freeze(near));
      continue;
    }
    // LOD distances are measured to the object origin, so centre it on the chunk.
    const centre = near.boundingSphere.center.clone();
    const lod = new THREE.LOD();
    lod.position.copy(centre);
    near.position.sub(centre);
    lod.addLevel(near, 0);
    levels.forEach((level, index) => {
      const kept = level.keep ? bucket.filter(level.keep) : bucket;
      const distance = (level.distance ?? LOD_DISTANCE * (index + 1)) + margin;
      if (!kept.length) {
        lod.addLevel(new THREE.Object3D(), distance, LOD_HYSTERESIS);
        return;
      }
      const mesh = build(level.geometry ?? geometry, kept, level);
      mesh.position.sub(centre);
      lod.addLevel(mesh, distance, LOD_HYSTERESIS);
    });
    scene.add(freeze(lod));
  }
}

// Chunks never move: compose their matrices once, not every frame, and once
// their world matrices are set, skip the walk through their levels (thousands
// of objects cost the renderer's per-frame matrix update ~2 ms).
function freeze(object) {
  object.traverse((o) => {
    o.updateMatrix();
    o.matrixAutoUpdate = false;
  });
  object.updateMatrixWorld = frozenMatrixWorld;
  return object;
}

function frozenMatrixWorld(force) {
  if (this.matrixWorldNeedsUpdate || force) THREE.Object3D.prototype.updateMatrixWorld.call(this, true);
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
    transparent: true,
    clippingPlanes: [new THREE.Plane(new THREE.Vector3(0, 1, 0), 0.1)],
    // Cast from the sunlit faces. three's default (back faces) stores the
    // far side of the boulder, which near its foot is only centimetres above
    // the sand, so the depth bias lit a halo round the base.
    shadowSide: THREE.FrontSide,
  });
  patchMaterial(material, shared, { rock: true, fade: true });
  for (let v = 0; v < ROCK_VARIANTS; v++)
    addInstances(scene, rockGeometry(5, v), material, rocks.filter((r) => r.variant === v), true, [
      { geometry: rockGeometry(3, v), distance: 22 },
      { geometry: rockGeometry(2, v), distance: 60 },
    ]);
  return rocks;
}
