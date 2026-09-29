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
  };
  const random = seededRandom(seed);
  const { wood: trunks, leaves, clusters, flowers, turf, layout } = createVegetation(seed);
  const rocks = addRocks(scene, random, shared);
  createSurf(scene, rocks, shared);
  const obstacles = obstaclesFor(layout, rocks);
  addGround(scene, shared, occludersFor(layout, rocks));
  const woodMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 1,
  });
  patchMaterial(woodMaterial, shared, { sway: true, bark: true });
  addInstances(
    scene,
    new THREE.CylinderGeometry(0.55, 1, 1, 8, 2, true),
    woodMaterial,
    trunks,
    true,
    [
      { geometry: new THREE.CylinderGeometry(0.55, 1, 1, 5, 1, true), keep: (w) => w.scale.x > 0.03, distance: 38 },
      { geometry: new THREE.CylinderGeometry(0.55, 1, 1, 3, 1, true), keep: (w) => w.scale.x > 0.07, distance: 85 },
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
    flutter: 0.09,
    foliage: true,
    bent: 0.5,
  });
  // The island carries ~200k shoots, and past ~60 m each covers only a few
  // pixels: the layer was bound by vertex work on pixel-sized triangles, not
  // by fill. Far levels keep a half, then a third, of the shoots (a stable
  // per-shoot choice), grown so the canopy covers the same area.
  addInstances(scene, clusterGeometry(6), clusterMaterial, clusters, true, [
    { geometry: clusterGeometry(3, 0), grow: 1.18, distance: 22 },
    { geometry: clusterGeometry(2, 0), grow: 1.35 * Math.SQRT2, keep: (c) => shootShare(c) < 0.5, distance: 58 },
    { geometry: clusterGeometry(1, 0), grow: 1.9 * Math.sqrt(3), keep: (c) => shootShare(c) < 0.34, distance: 100 },
  ]);
  const bladeMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.62,
    vertexColors: true,
    side: THREE.DoubleSide,
  });
  patchMaterial(bladeMaterial, shared, { sway: true, flutter: 0.08, foliage: true, bent: 0.45 });
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
    side: THREE.DoubleSide,
  });
  patchMaterial(turfMaterial, shared, { sway: true, flutter: 0.05, foliage: true, bent: 0.55 });
  addInstances(scene, turfGeometry(9), turfMaterial, turf, false, [
    { geometry: turfGeometry(4), keep: (t) => t.far, grow: 1.35 },
    { keep: () => false, distance: 70 },
  ]);
  // Petals are thin and backlit like leaves; they share the flutter and the
  // translucency, with a satin sheen instead of a waxy one.
  const petalMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.5,
    vertexColors: true,
    side: THREE.DoubleSide,
  });
  patchMaterial(petalMaterial, shared, { sway: true, flutter: 0.04, foliage: true, bent: 0.35 });
  addInstances(scene, white(daisyGeometry()), petalMaterial, flowers.daisy, false, { keep: () => false });
  addInstances(scene, white(proteaGeometry(18)), petalMaterial, flowers.protea, true, [{ geometry: white(proteaGeometry(8)) }, { keep: () => false, distance: 80 }]);
  addInstances(scene, white(pincushionGeometry()), petalMaterial, flowers.pincushion, true, [{ geometry: white(pincushionGeometry(1)) }, { keep: () => false, distance: 80 }]);
  addInstances(scene, spikeGeometry(), petalMaterial, flowers.spike, true, [{ geometry: spikeGeometry(14) }, { keep: () => false, distance: 95 }]);
  addInstances(scene, white(bellGeometry()), petalMaterial, flowers.bell, false, { keep: () => false });
  return {
    // Trunks and boulders, for the cat to walk around (or climb).
    obstacles,
    // The boulders the sea touches, for the water pass (rocks.js).
    shoreRocks: shoreRockData(rocks),
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
    updateSun(directionView, tint, glow) {
      shared.sunDirView.value.copy(directionView);
      shared.sunTint.value.copy(tint);
      shared.sunGlow.value = glow;
    },
  };
}

// Post-instancing offset shared by every swaying vertex: because it is a
// continuous function of the world position, parent and child branch segments
// displace together and joints stay connected. Slow whole-tree sway rides a
// travelling gust field; a faster band bobs the branches.
const WIND_GLSL = /* glsl */ `
uniform float breezeTime;
uniform float breezeStrength;
uniform vec2 breezeDir;
uniform vec4 catPush;
varying float vGlint;
// Height of the plant's base (per instance): wind bends from there, so a trunk
// or stem is rooted wherever it stands. Zero for non-instanced meshes.
attribute float anchorHeight;
varying float vAbove;
vec3 windOffset(vec3 p) {
  float h = max(p.y - anchorHeight, 0.0);
  float gust = 0.5 + 0.5 * sin(breezeTime * 0.31 + p.x * 0.045 + p.z * 0.035)
    * sin(breezeTime * 0.171 + p.z * 0.021 - p.x * 0.013);
  float sway = sin(breezeTime * 0.8 + p.x * 0.11 + p.z * 0.09);
  float bob = sin(breezeTime * 2.3 + p.x * 0.9 + p.z * 0.7 + h * 0.6);
  float amp = breezeStrength * (0.25 + 0.75 * gust);
  return vec3(breezeDir.x, 0.0, breezeDir.y) * (sway * h * h * 0.0035 * amp)
    + vec3(breezeDir.x, -0.25, breezeDir.y) * (bob * h * 0.012 * amp);
}
`;

// Low foliage parts round the cat: vertices within reach lean away from it,
// more toward their tips, and pressed a little down. Tall plants' crowns
// are out of reach, so only the lower ~60 cm of any plant moves.
const PUSH_GLSL = /* glsl */ `
{
  vec2 away = mvPosition.xz - catPush.xy;
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
  // Transmittance peaks in green-yellow and is deeper than reflectance
  // (chlorophyll absorbs red and blue on the way through).
  vec3 transmit = min( diffuseColor.rgb * vec3( 1.5, 2.4, 0.9 ), vec3( 0.45 ) );
  reflectedLight.directDiffuse += leafSun * transmit * RECIPROCAL_PI
    * ( behind * ( 0.8 + forward * 3.0 ) + forward * 0.35 );
  // Skylight through the canopy: undersides glow faintly green.
  reflectedLight.indirectDiffuse += transmit * reflectedLight.indirectDiffuse
    * clamp( -normal.y * 0.5 + 0.5, 0.0, 1.0 ) * 0.9;
  // Waxy cuticle: each leaf mirrors the sun at its own angle, so a crown
  // shimmers leaf by leaf instead of carrying one broad highlight.
  vec3 sparkleRay = reflect( -sunDirView, leafN );
  float sparkle = pow( clamp( dot( sparkleRay, toEye ), 0.0, 1.0 ), 48.0 ) * facing;
  float gate = 0.35 + 0.65 * smoothstep( 0.55, 0.95, fract( vGlint * 9.173 + breezeTime * 0.11 ) );
  reflectedLight.directSpecular += leafSun * sparkle * gate * 0.5;
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
  float fogLuma = dot( gl_FragColor.rgb, vec3( 0.30, 0.55, 0.15 ) );
  vec3 fogFaded = mix( gl_FragColor.rgb, vec3( fogLuma ), fogFade * 0.3 );
  fogFaded = mix( fogFaded, fogColor, fogFade * 0.15 );
  gl_FragColor.rgb = mix( fogFaded, fogColor, fogFactor );
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
  float floorMix = max( litter, smoothstep( 9.0, 15.0, inland ) * 0.7 ) * ( 1.0 - rocky ) * nearDetail;
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
float detailHeight = grain * 0.004 + ripple * 0.012 * dry + mottled * 0.03 * ( 1.0 - wet ) + rocky * strata * 0.08 + clutterHeight;
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
  diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.88, 0.9, 0.92 ), swashCover );
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

// Bark: vertical fissures and plates around the stem, lichen on the
// weather side. World-space, so branches share one continuous pattern.
const BARK_COLOUR_GLSL = /* glsl */ `
#include <color_fragment>
float around = ( vWorld.x * 0.7 + vWorld.z * 0.7 ) * 26.0;
float fissure = dNoise( vec2( around, vWorld.y * 1.8 ) ) * 0.65 + dNoise( vec2( around * 2.3, vWorld.y * 5.0 ) ) * 0.35;
float plates = smoothstep( 0.35, 0.6, fissure );
diffuseColor.rgb *= 0.45 + plates * 0.6;
float bark_lichen = smoothstep( 0.68, 0.8, dNoise( vec2( around * 0.4, vWorld.y * 3.0 ) + 5.0 ) );
diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.36, 0.38, 0.26 ), bark_lichen * 0.45 );
float detailHeight = plates * 0.012;
float detailRoughness = 0.92;
`;

const DETAIL_GLSL = /* glsl */ `
varying vec3 vWorld;
uniform float breezeTime;
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

function patchMaterial(material, shared, { sway = false, flutter = 0, foliage = false, ground = false, rock = false, bark = false, bent = 0, fade = false } = {}) {
  // three caches programs by onBeforeCompile's source text, which is the same
  // for every patched material: key them by their options, or a material
  // silently runs another's shader (blades with the clusters' flutter).
  const key = JSON.stringify({ sway, flutter, foliage, ground, rock, bark, bent, fade });
  material.customProgramCacheKey = () => key;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shared);
    shader.vertexShader = WIND_GLSL +
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
        ${
          flutter
            ? /* glsl */ `
        #ifdef USE_INSTANCING
          float leafTip = clamp( position.y, 0.0, 2.0 );
          float leafPhase = breezeTime * ( 3.2 + vGlint * 2.6 )
            + windAnchor.x * 1.7 + windAnchor.y * 1.3;
          float leafAmp = ${flutter.toFixed(3)} * ( 0.3 + breezeStrength );
          transformed.x += sin( leafPhase ) * leafTip * leafAmp;
          transformed.z += cos( leafPhase * 1.37 ) * leafTip * leafAmp;
        #endif`
            : ""
        }`,
      );
    if (sway)
      shader.vertexShader = shader.vertexShader.replace(
        "#include <project_vertex>",
        foliage ? PROJECT_GLSL.replace("vAbove =", `${PUSH_GLSL}\nvAbove =`) : PROJECT_GLSL,
      );
    shader.fragmentShader =
      "uniform vec3 sunDirView;\nuniform vec3 sunTint;\nuniform float sunGlow;\nuniform float breezeTime;\nvarying float vGlint;\n" +
      shader.fragmentShader.replace("#include <fog_fragment>", FOG_GLSL);
    if (ground)
      // Sky mirrored in the swash film (there is no environment map), by
      // Fresnel, from the horizon colour the fog already carries.
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        #ifdef USE_FOG
          float filmFresnel = 0.02 + 0.98 * pow( 1.0 - max( dot( normal, normalize( vViewPosition ) ), 0.0 ), 5.0 );
          totalEmissiveRadiance += fogColor * filmFresnel * swashFilm * ( 1.0 - swashCover ) * 0.9;
          totalEmissiveRadiance += vec3( 0.05, 0.42, 0.95 ) * swashGlow * 0.12;
        #endif`,
      );
    if (ground || rock || bark) {
      shader.vertexShader = shader.vertexShader
        .replace(
          "void main() {",
          ground
            ? "varying vec3 vWorld;\nattribute vec3 groundMask;\nvarying vec3 vGroundMask;\nvoid main() {\n  vGroundMask = groundMask;"
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
        .replace("void main() {", DETAIL_GLSL + (ground ? "varying vec3 vGroundMask;\n" + SWASH_GLSL : rock ? SWASH_GLSL : "") + "\nvoid main() {")
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
    if (foliage)
      shader.fragmentShader = shader.fragmentShader
        .replace("void main() {", "varying vec3 vLeafNormal;\nvoid main() {")
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
          vec3 bendView = normalMatrix * bendNormal;
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

function addGround(scene, shared, occluders) {
  const { size, segments } = GROUND;
  const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
  const occlusion = occlusionField(occluders);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(ISLAND.x, 0, ISLAND.z);
  const position = geometry.attributes.position;
  const colors = new Float32Array(position.count * 3);
  // An ecotone replaces the hard beach-forest line: sand grades through dry
  // dune tones and leaf litter into forest soil, dithered by noise over metres.
  const sand = new THREE.Color("#b9a98b");
  const wetSand = new THREE.Color("#7a6f55");
  const dune = new THREE.Color("#a2926f");
  const litter = new THREE.Color("#4a3d28");
  const moss = new THREE.Color("#354b26");
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
    color.multiplyScalar((0.88 + noise2(x * 2, z * 2) * 0.22) * occlusion(x, z));
    color.toArray(colors, i * 3);
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  const masks = new Float32Array(position.count * 3);
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
    masks[i * 3] = fbm(x * 0.9, z * 0.9);
    masks[i * 3 + 1] = Math.max(steep, smoothstep(0.62, 0.76, fbm(x * 0.13 + 4, z * 0.13)) * smoothstep(14, 24, inland));
    masks[i * 3 + 2] = smoothstep(0.52, 0.72, fbm(x * 2.3 + 9, z * 2.3)) * smoothstep(6, 12, inland);
  }
  geometry.setAttribute("groundMask", new THREE.BufferAttribute(masks, 3));
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

// A shoot tip: a golden-angle spray of leaves. No two blades share an outline:
// each gets its own length, width, widest point and tip bluntness (ovate to
// elliptic to obovate), a cupped cross-section, a droop and a slight sideways
// curl, so the spray reads as grown rather than stamped. Vertex colour gives
// each leaf its own shade and hue and darkens the shoot's shaded heart.
function clusterGeometry(blades = 7, detail = 2) {
  const positions = [];
  const colours = [];
  const indices = [];
  const random = seededRandom(7);
  const dir = new THREE.Vector3();
  const side = new THREE.Vector3();
  const lift = new THREE.Vector3();
  for (let b = 0; b < blades; b++) {
    const azimuth = b * 2.39996 + (random() - 0.5) * 0.7;
    // Inner blades stand, outer blades droop past horizontal: a soft mound.
    const tilt = 0.4 + (b / blades) * 1.0 + (random() - 0.5) * 0.35;
    dir.set(
      Math.sin(tilt) * Math.cos(azimuth),
      Math.cos(tilt),
      Math.sin(tilt) * Math.sin(azimuth),
    );
    side.set(-Math.sin(azimuth), 0, Math.cos(azimuth));
    lift.crossVectors(dir, side).normalize();
    const length = 0.42 + random() * 0.5;
    const inner = 1 - b / blades;
    blade({ positions, colours, indices }, {
      base: new THREE.Vector3(0, 0.02, 0).addScaledVector(dir, 0.04),
      dir,
      side,
      lift,
      length,
      width: (0.19 + random() * 0.1) * length,
      droop: 0.08 + random() * 0.16,
      widest: 0.3 + random() * 0.25,
      blunt: 0.45 + random() * 0.5,
      curl: (random() - 0.5) * 0.25,
      cup: 0.1 + random() * 0.12,
      detail,
      // Inner leaves sit in their neighbours' shade; each leaf has its own tone.
      shade: (0.8 + random() * 0.28) * (1 - inner * 0.25),
      // Mostly blue-green; the odd young leaf a little yellower.
      hue: (random() - 0.65) * 0.1,
    });
  }
  return finish(positions, indices, colours);
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
  return finish(out.positions, out.indices, out.colours);
}

// A grass clump: curved, tapering blades fanning from a tight base.
function turfGeometry(blades = 9) {
  const positions = [];
  const indices = [];
  const random = seededRandom(11);
  for (let b = 0; b < blades; b++) {
    const azimuth = b * 2.39996 + random() * 0.4;
    const lean = 0.15 + random() * 0.55;
    const height = 0.6 + random() * 0.5;
    const width = 0.035 + random() * 0.02;
    const out = new THREE.Vector3(Math.cos(azimuth), 0, Math.sin(azimuth));
    const across = new THREE.Vector3(-out.z, 0, out.x);
    const base = out.clone().multiplyScalar(0.04 + random() * 0.06);
    const first = positions.length / 3;
    const levels = 4;
    for (let i = 0; i < levels; i++) {
      const t = i / levels;
      const p = base.clone().addScaledVector(out, lean * t * t * height).add(new THREE.Vector3(0, height * t * (1 - lean * t * 0.35), 0));
      const w = width * (1 - t * 0.8);
      positions.push(p.x - across.x * w, p.y, p.z - across.z * w, p.x + across.x * w, p.y, p.z + across.z * w);
    }
    const tip = base.clone().addScaledVector(out, lean * height).add(new THREE.Vector3(0, height * (1 - lean * 0.35), 0));
    positions.push(tip.x, tip.y, tip.z);
    for (let i = 0; i < levels - 1; i++) {
      const a = first + i * 2;
      indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    const last = first + (levels - 1) * 2;
    indices.push(last, first + levels * 2, last + 1);
  }
  return finish(positions, indices);
}

// ---- Flower heads. Unit size, facing +y; instances scale, orient and tint.

function finish(positions, indices, colours = null) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  if (colours) geometry.setAttribute("color", new THREE.Float32BufferAttribute(colours, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

// A daisy: a ring of slender ray petals, slightly cupped, around a raised
// dark disc.
function daisyGeometry() {
  const positions = [0, 0.25, 0];
  const indices = [];
  const petals = 12;
  for (let i = 0; i < petals; i++) {
    const a = (i / petals) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const w = 0.13;
    const first = positions.length / 3;
    positions.push(
      c * 0.2 - s * w, 0.1, s * 0.2 + c * w,
      c * 0.2 + s * w, 0.1, s * 0.2 - c * w,
      c * 0.75 - s * w * 1.6, 0.18, s * 0.75 + c * w * 1.6,
      c * 0.75 + s * w * 1.6, 0.18, s * 0.75 - c * w * 1.6,
      c * 1.0, 0.1, s * 1.0,
    );
    indices.push(first, first + 2, first + 1, first + 1, first + 2, first + 3, first + 2, first + 4, first + 3);
    // Disc wedge (petals and disc share the instance colour; the disc is
    // darkened by its ambient-occluded, upward-bulging normals).
    indices.push(0, first, first + 1);
  }
  return finish(positions, indices);
}

// A king protea: overlapping rows of broad, pointed bracts rising from a
// cup around a domed centre.
function proteaGeometry(bracts = 14) {
  const positions = [];
  const indices = [];
  for (let row = 0; row < 2; row++) {
    const count = row ? bracts : Math.max(5, bracts - 4);
    const tilt = row ? 0.75 : 0.35;
    const length = row ? 1.0 : 0.85;
    for (let i = 0; i < count; i++) {
      const a = ((i + row * 0.5) / count) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const out = Math.sin(tilt);
      const up = Math.cos(tilt);
      const w = (Math.PI * 0.55) / count;
      const first = positions.length / 3;
      const base = 0.25;
      positions.push(
        c * base - s * w * 0.5, 0, s * base + c * w * 0.5,
        c * base + s * w * 0.5, 0, s * base - c * w * 0.5,
        c * (base + out * length * 0.6) - s * w * 1.4, up * length * 0.6, s * (base + out * length * 0.6) + c * w * 1.4,
        c * (base + out * length * 0.6) + s * w * 1.4, up * length * 0.6, s * (base + out * length * 0.6) - c * w * 1.4,
        c * (base + out * length * 1.05), up * length, s * (base + out * length * 1.05),
      );
      indices.push(first, first + 2, first + 1, first + 1, first + 2, first + 3, first + 2, first + 4, first + 3);
    }
  }
  const dome = new THREE.SphereGeometry(0.42, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2);
  const offset = positions.length / 3;
  const dp = dome.attributes.position;
  for (let i = 0; i < dp.count; i++) positions.push(dp.getX(i), dp.getY(i) * 1.1 + 0.05, dp.getZ(i));
  for (const i of dome.index.array) indices.push(i + offset);
  return finish(positions, indices);
}

// A pincushion: a ball of long styles, each a thin spike with a knobbed tip,
// approximated by a spiky icosphere.
function pincushionGeometry(detail = 2) {
  const geometry = new THREE.IcosahedronGeometry(0.7, detail);
  const p = geometry.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const spike = (Math.sin(v.x * 23) * Math.sin(v.y * 19) * Math.sin(v.z * 21)) > 0.2 ? 1.45 : 1;
    v.multiplyScalar(spike);
    if (v.y < -0.2) v.y = -0.2;
    p.setXYZ(i, v.x, v.y + 0.3, v.z);
  }
  geometry.computeVertexNormals();
  return geometry;
}

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

// An erica bell: a tiny closed urn.
function bellGeometry() {
  const geometry = new THREE.IcosahedronGeometry(0.5, 0);
  geometry.scale(0.7, 1.0, 0.7);
  return geometry;
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
// out by most of the chunk's half-diagonal: a chunk no longer swaps detail
// (or drops shoots) while its near edge is right beside the camera, which
// read as plants glitching in and out. Hysteresis stops it flickering on the
// boundary as the cat walks back and forth.
const CHUNK = 20;
const CHUNK_MARGIN = CHUNK * 0.55;
const LOD_HYSTERESIS = 0.12;
// Leaves sway up to ~1.5 m from their rest pose: cull with that margin.
const SWAY_MARGIN = 1.5;
const UP = new THREE.Vector3(0, 1, 0);
const LOD_DISTANCE = 42;
function addInstances(scene, geometry, material, instances, shadows, far = null) {
  const chunks = new Map();
  for (const instance of instances) {
    const key = `${Math.floor(instance.position.x / CHUNK)},${Math.floor(instance.position.z / CHUNK)}`;
    if (!chunks.has(key)) chunks.set(key, []);
    chunks.get(key).push(instance);
  }
  const transform = new THREE.Object3D();
  const build = (source, bucket, level) => {
    // Instance attributes live on the geometry, so each chunk gets a light
    // clone (vertex buffers are small) carrying its anchors and bent normals.
    const geo = source.clone();
    const anchors = new Float32Array(bucket.length);
    const bends = new Float32Array(bucket.length * 3);
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
    }
    geo.setAttribute("anchorHeight", new THREE.InstancedBufferAttribute(anchors, 1));
    geo.setAttribute("bendNormal", new THREE.InstancedBufferAttribute(bends, 3));
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
      scene.add(near);
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
      const distance = (level.distance ?? LOD_DISTANCE * (index + 1)) + CHUNK_MARGIN;
      if (!kept.length) {
        lod.addLevel(new THREE.Object3D(), distance, LOD_HYSTERESIS);
        return;
      }
      const mesh = build(level.geometry ?? geometry, kept, level);
      mesh.position.sub(centre);
      lod.addLevel(mesh, distance, LOD_HYSTERESIS);
    });
    scene.add(lod);
  }
}

function addRocks(scene, random, shared, rocks = rockLayout(random)) {
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.92,
    transparent: true,
    clippingPlanes: [new THREE.Plane(new THREE.Vector3(0, 1, 0), 0.1)],
  });
  patchMaterial(material, shared, { rock: true, fade: true });
  for (let v = 0; v < ROCK_VARIANTS; v++)
    addInstances(scene, rockGeometry(5, v), material, rocks.filter((r) => r.variant === v), true, [
      { geometry: rockGeometry(3, v), distance: 22 },
      { geometry: rockGeometry(2, v), distance: 60 },
    ]);
  return rocks;
}
