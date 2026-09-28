import * as THREE from "three";
import {
  terrainHeight,
  shoreDistance,
  islandPoint,
  ISLAND,
  noise2,
  smoothstep,
} from "./terrain.js";
import { seededRandom } from "./random.js";
import { createVegetation } from "./vegetation.js";

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
  };
  const random = seededRandom(seed);
  const { wood: trunks, leaves, clusters, flowers, turf, layout } = createVegetation(seed);
  const rocks = addRocks(scene, random, shared);
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
    side: THREE.DoubleSide,
  });
  patchMaterial(clusterMaterial, shared, {
    sway: true,
    flutter: 0.09,
    foliage: true,
    bent: 0.62,
  });
  addInstances(scene, clusterGeometry(6), clusterMaterial, clusters, true, [
    { geometry: clusterGeometry(4, true), grow: 1.12, distance: 38 },
    { geometry: clusterGeometry(2, true), grow: 1.45, distance: 85 },
  ]);
  const bladeMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.62,
    side: THREE.DoubleSide,
  });
  patchMaterial(bladeMaterial, shared, { sway: true, flutter: 0.08, foliage: true, bent: 0.45 });
  addInstances(scene, leafGeometry(), bladeMaterial, leaves, true, [
    { geometry: leafGeometry(true), keep: (l) => l.scale.y > 0.18 || l.scale.x > 0.05, distance: 32 },
    { geometry: leafGeometry(true), keep: (l) => l.scale.y > 0.5, distance: 80 },
  ]);
  // Turf shades as a soft lawn (normals bent up) and only near clumps cast
  // shadows; far away a sparse subset stands in for the rest.
  const turfMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.7,
    side: THREE.DoubleSide,
  });
  patchMaterial(turfMaterial, shared, { sway: true, flutter: 0.05, foliage: true, bent: 0.55 });
  addInstances(scene, turfGeometry(9), turfMaterial, turf, false, {
    geometry: turfGeometry(4),
    keep: (t) => t.far,
    grow: 1.35,
  });
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
  addInstances(scene, white(proteaGeometry(18)), petalMaterial, flowers.protea, true, { geometry: white(proteaGeometry(8)) });
  addInstances(scene, white(pincushionGeometry()), petalMaterial, flowers.pincushion, true, { geometry: white(pincushionGeometry(1)) });
  addInstances(scene, spikeGeometry(), petalMaterial, flowers.spike, true, { geometry: spikeGeometry(14) });
  addInstances(scene, white(bellGeometry()), petalMaterial, flowers.bell, false, { keep: () => false });
  return {
    updateWind(time, wind) {
      shared.breezeTime.value = time;
      const speed = Math.hypot(wind[0], wind[1]);
      shared.breezeStrength.value = Math.min(1.5, 0.15 + speed / 8);
      if (speed > 0.5)
        shared.breezeDir.value.set(wind[0] / speed, wind[1] / speed);
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
const FOLIAGE_GLSL = /* glsl */ `
#include <lights_fragment_end>
{
  vec3 sceneViewDir = normalize( vViewPosition );
  float backlit = clamp( -dot( sceneViewDir, sunDirView ), 0.0, 1.0 );
  float through = clamp( -dot( normal, sunDirView ), 0.0, 1.0 );
  float transmission = pow( backlit, 4.0 ) * 0.9 + through * 0.35;
  vec3 leafLight = diffuseColor.rgb * vec3( 1.15, 1.1, 0.5 );
  reflectedLight.indirectDiffuse += leafLight * sunTint * transmission * sunGlow * 1.1;
  reflectedLight.indirectDiffuse += diffuseColor.rgb * vec3( 0.9, 1.0, 0.6 )
    * reflectedLight.indirectDiffuse * clamp( -normal.y, 0.0, 1.0 ) * 0.6;
  vec3 sparkleRay = reflect( -sunDirView, normal );
  float sparkle = pow( clamp( dot( sparkleRay, sceneViewDir ), 0.0, 1.0 ), 80.0 );
  float gate = smoothstep( 0.80, 0.97, fract( vGlint * 9.173 + breezeTime * 0.11 ) );
  reflectedLight.directSpecular += sunTint * sparkle * gate * sunGlow * 1.6;
}
`;

// Distance should remove information, not just add white: far geometry loses
// saturation and contrast toward the sky tone before the fog blend itself.
const FOG_GLSL = /* glsl */ `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
  #endif
  float fogFade = smoothstep( 25.0, 190.0, vFogDepth );
  float fogLuma = dot( gl_FragColor.rgb, vec3( 0.30, 0.55, 0.15 ) );
  vec3 fogFaded = mix( gl_FragColor.rgb, vec3( fogLuma ), fogFade * 0.5 );
  fogFaded = mix( fogFaded, fogColor, fogFade * 0.22 );
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
float grain = dNoise( coast * 38.0 ) * 0.6 + dNoise( coast * 90.0 ) * 0.4;
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
float strata = 0.0;
if ( rocky > 0.01 ) {
  strata = dNoise( coast * vec2( 2.0, 7.0 ) ) * 0.6 + dNoise( coast * vec2( 5.0, 15.0 ) ) * 0.4;
  vec3 granite = mix( vec3( 0.16, 0.15, 0.14 ), vec3( 0.34, 0.32, 0.29 ), strata );
  granite = mix( granite, vec3( 0.32, 0.3, 0.12 ), smoothstep( 0.62, 0.72, dNoise( coast * 5.0 ) ) * 0.6 );
  diffuseColor.rgb = mix( diffuseColor.rgb, granite, rocky );
}
diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.19, 0.12, 0.06 ) * ( 0.7 + grain * 0.6 ), litter * 0.55 );
float detailHeight = grain * 0.004 + ripple * 0.012 * dry + mottled * 0.03 * ( 1.0 - wet ) + rocky * strata * 0.08;
float detailRoughness = mix( mix( 0.95, 0.9, rocky ), 0.28, wet );
`;

const ROCK_COLOUR_GLSL = /* glsl */ `
#include <color_fragment>
vec2 coast = vec2( vWorld.x, -vWorld.z );
float veins = dFbm( vec2( vWorld.x + vWorld.y * 0.7, vWorld.z - vWorld.y * 0.4 ) * 3.0 );
float crystals = dNoise( coast * 60.0 + vWorld.y * 40.0 );
diffuseColor.rgb *= 0.72 + veins * 0.45 + crystals * 0.12;
// Lichen on top surfaces, a dark wet band near the waterline, barnacles below.
float up = abs( normalize( cross( dFdx( vWorld ), dFdy( vWorld ) ) ).y );
float lichen = smoothstep( 0.55, 0.7, dNoise( coast * 4.0 + vWorld.y * 3.0 ) ) * smoothstep( 0.4, 0.8, up );
diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.45, 0.4, 0.12 ), lichen * 0.55 );
float tide = 1.0 - smoothstep( 0.05, 0.5, vWorld.y );
diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * 0.45, tide );
float detailHeight = veins * 0.05 + crystals * 0.004;
float detailRoughness = mix( 0.85, 0.35, tide );
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
float dFbm( vec2 p ) {
  float v = 0.0;
  float a = 0.5;
  for ( int i = 0; i < 4; i++ ) { v += a * dNoise( p ); p = mat2( 1.6, 1.2, -1.2, 1.6 ) * p; a *= 0.5; }
  return v;
}
// Signed shore distance, matching terrain.js (positive inland).
float dShore( vec2 p ) {
  vec2 d = p - vec2( 58.0, 70.0 );
  float t = atan( d.y, d.x );
  return 62.0 + 14.0 * sin( 2.0 * t + 0.8 ) + 7.0 * sin( 3.0 * t + 2.1 ) + 3.5 * sin( 7.0 * t + 4.5 ) - length( d );
}
`;

function patchMaterial(material, shared, { sway = false, flutter = 0, foliage = false, ground = false, rock = false, bark = false, bent = 0, fade = false } = {}) {
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
        PROJECT_GLSL,
      );
    shader.fragmentShader =
      "uniform vec3 sunDirView;\nuniform vec3 sunTint;\nuniform float sunGlow;\nuniform float breezeTime;\nvarying float vGlint;\n" +
      shader.fragmentShader.replace("#include <fog_fragment>", FOG_GLSL);
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
        .replace("void main() {", DETAIL_GLSL + (ground ? "varying vec3 vGroundMask;\n" : "") + "\nvoid main() {")
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
    if (foliage)
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <lights_fragment_end>",
        FOLIAGE_GLSL,
      );
    if (bent) {
      // Bent normals: blend each card's normal toward its foliage mass's
      // outward direction, so a crown shades like a soft volume. Both faces
      // share it (no back-face flip), as light doesn't care which side of a
      // tiny leaf faces the camera.
      shader.vertexShader = shader.vertexShader
        .replace("void main() {", "attribute vec3 bendNormal;\nvoid main() {")
        .replace(
          "#include <defaultnormal_vertex>",
          `#include <defaultnormal_vertex>
          transformedNormal = normalize( mix( transformedNormal, normalMatrix * bendNormal, ${bent.toFixed(2)} ) );`,
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
  const size = 190;
  const geometry = new THREE.PlaneGeometry(size, size, 380, 380);
  const occlusion = occlusionField(occluders);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(ISLAND.x, 0, ISLAND.z);
  const position = geometry.attributes.position;
  const colors = new Float32Array(position.count * 3);
  // An ecotone replaces the hard beach-forest line: sand grades through dry
  // dune tones and leaf litter into forest soil, dithered by noise over metres.
  const sand = new THREE.Color("#a99c7c");
  const wetSand = new THREE.Color("#7a6f55");
  const dune = new THREE.Color("#968a64");
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
  const normals = geometry.attributes.normal;
  const masks = new Float32Array(position.count * 3);
  const fbm = (x, z) =>
    noise2(x, z) * 0.5 + noise2(x * 2.1 + 5, z * 2.1) * 0.27 + noise2(x * 4.3, z * 4.3 + 3) * 0.15 + noise2(x * 8.7 + 1, z * 8.7) * 0.08;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const z = position.getZ(i);
    const inland = shoreDistance(x, z);
    const steep = smoothstep(0.84, 0.66, normals.getY(i));
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

// A shoot tip: a golden-angle fan of rounded leaves. Each blade has an ovate
// outline (widest below the middle, blunt tip), a folded midrib and a droop
// along its length, so shading rolls smoothly instead of faceting.
function clusterGeometry(blades = 7, simple = false) {
  const positions = [];
  const indices = [];
  const random = seededRandom(7);
  const dir = new THREE.Vector3();
  const side = new THREE.Vector3();
  const lift = new THREE.Vector3();
  for (let b = 0; b < blades; b++) {
    const azimuth = b * 2.39996 + (random() - 0.5) * 0.7;
    // Inner blades stand, outer blades droop past horizontal: a soft mound.
    const tilt = 0.45 + (b / blades) * 0.95 + (random() - 0.5) * 0.3;
    dir.set(
      Math.sin(tilt) * Math.cos(azimuth),
      Math.cos(tilt),
      Math.sin(tilt) * Math.sin(azimuth),
    );
    side.set(-Math.sin(azimuth), 0, Math.cos(azimuth));
    lift.crossVectors(dir, side).normalize();
    const length = 0.5 + random() * 0.45;
    blade(positions, indices, new THREE.Vector3(0, 0.02, 0), dir, side, lift,
      length, (0.2 + random() * 0.07) * length, 0.1 + random() * 0.12, simple);
  }
  return finish(positions, indices);
}

// One leaf blade from `base` along `dir`: 4 midrib points and 2 edge pairs.
function blade(positions, indices, base, dir, side, lift, length, width, droop, simple = false) {
  const at = (t, across, raise) =>
    base
      .clone()
      .addScaledVector(dir, length * t)
      .addScaledVector(lift, -droop * length * t * t + raise)
      .addScaledVector(side, across);
  const fold = width * 0.18;
  const first = positions.length / 3;
  if (simple) {
    // Distant blades: a bent diamond, two triangles.
    for (const p of [at(0, 0, 0), at(0.45, width * 0.9, 0), at(1, 0, 0), at(0.45, -width * 0.9, 0)])
      positions.push(p.x, p.y, p.z);
    indices.push(first, first + 1, first + 2, first, first + 2, first + 3);
    return;
  }
  const points = [
    at(0, 0, 0),
    at(0.33, 0, fold),
    at(0.7, 0, fold * 0.7),
    at(1, 0, 0),
    at(0.3, width, 0),
    at(0.68, width * 0.72, 0),
    at(0.3, -width, 0),
    at(0.68, -width * 0.72, 0),
  ];
  for (const p of points) positions.push(p.x, p.y, p.z);
  const [m0, m1, m2, m3, l1, l2, r1, r2] = [0, 1, 2, 3, 4, 5, 6, 7].map((v) => v + first);
  indices.push(
    m0, l1, m1, m1, l1, l2, m1, l2, m2, m2, l2, m3,
    m0, m1, r1, m1, r2, r1, m1, m2, r2, m2, m3, r2,
  );
}

function leafGeometry(simple = false) {
  const geometry = new THREE.BufferGeometry();
  if (simple) {
    // Distant blades: a two-triangle diamond with the same outline and bend.
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(
        [0, -1, 0, -0.3, 0, 0.02, 0.3, 0, 0.02, 0, 1, -0.18],
        3,
      ),
    );
    geometry.setIndex([0, 1, 2, 1, 3, 2]);
    geometry.computeVertexNormals();
    return geometry;
  }
  // A unit leaf from y = -1 (attachment) to 1 (tip): smooth ovate outline,
  // folded midrib, drooping toward the tip.
  const levels = [-1, -0.5, 0, 0.5, 1];
  const half = [0, 0.27, 0.31, 0.22, 0];
  const positions = [];
  for (let i = 0; i < levels.length; i++) {
    const y = levels[i];
    const t = (y + 1) / 2;
    const z = -0.2 * t * t;
    positions.push(0, y, z + 0.07 * Math.sin(Math.PI * t));
    if (i > 0 && i < levels.length - 1) {
      positions.push(-half[i], y, z - 0.02, half[i], y, z - 0.02);
    }
  }
  // Vertex layout: m0, (m1,l1,r1), (m2,l2,r2), (m3,l3,r3), m4
  const m = [0, 1, 4, 7, 10];
  const l = [null, 2, 5, 8, null];
  const r = [null, 3, 6, 9, null];
  const indices = [];
  for (let i = 0; i < 4; i++) {
    const a = m[i];
    const b = m[i + 1];
    if (l[i] === null) indices.push(a, l[i + 1], b, a, b, r[i + 1]);
    else if (l[i + 1] === null) indices.push(a, l[i], b, a, b, r[i]);
    else indices.push(a, l[i], l[i + 1], a, l[i + 1], b, a, r[i + 1], r[i], a, b, r[i + 1]);
  }
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
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

function finish(positions, indices) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
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

function rockGeometry(detail = 4) {
  // Weathered granite: a rounded core (corestones erode spherically) with
  // flattened facets from jointing and a little surface roughness.
  const geometry = new THREE.IcosahedronGeometry(1, detail);
  const positions = geometry.attributes.position;
  const p = new THREE.Vector3();
  for (let i = 0; i < positions.count; i++) {
    p.fromBufferAttribute(positions, i);
    let r =
      0.8 +
      noise2(p.x * 1.6 + p.y * 1.3 + 3, p.z * 1.6 - p.y) * 0.3 +
      noise2(p.x * 4 + 7, p.z * 4 + p.y * 3) * 0.08 +
      noise2(p.x * 11, p.z * 11 + p.y * 7) * 0.025;
    // Joint planes: clamp the radius along a few directions.
    r = Math.min(r, 0.92 / Math.max(0.3, Math.abs(p.y + 0.15)), 0.95 / Math.max(0.3, Math.abs(p.x * 0.8 + p.z * 0.6)));
    p.multiplyScalar(r);
    positions.setXYZ(i, p.x, p.y, p.z);
  }
  geometry.computeVertexNormals();
  return geometry;
}

// Instances are bucketed into ground chunks so the camera frustum culls whole
// regions in both the colour and shadow passes. Each chunk is also a THREE.LOD:
// beyond LOD_DISTANCE it swaps to a cheaper geometry and drops instances the
// eye cannot resolve (fine twigs, tiny blades), which is where most triangles
// were being spent. Chunks share geometry and material; the cost is draw calls.
const CHUNK = 28;
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
      const distance = level.distance ?? LOD_DISTANCE * (index + 1);
      if (!kept.length) {
        lod.addLevel(new THREE.Object3D(), distance);
        return;
      }
      const mesh = build(level.geometry ?? geometry, kept, level);
      mesh.position.sub(centre);
      lod.addLevel(mesh, distance);
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
  addInstances(scene, rockGeometry(4), material, rocks, true, {
    geometry: rockGeometry(2),
  });
  return rocks;
}

function rockLayout(random) {
  const rocks = [];
  for (let i = 0; i < 230; i++) {
    const { x, z } = islandPoint(random() * Math.PI * 2, random() * 7 - 2);
    const size = 0.15 + random() ** 3 * 1.2;
    rocks.push({
      position: new THREE.Vector3(x, terrainHeight(x, z) + size * 0.25, z),
      scale: new THREE.Vector3(size, size * 0.7, size * 0.85),
      rotation: new THREE.Euler(random(), random() * 6, random()),
      color: new THREE.Color().setHSL(0.13, 0.08, 0.28 + random() * 0.13),
    });
  }
  // Granite boulder fields, as on the Cape Peninsula's shores: a few clusters
  // of big rounded corestones straddling the waterline, stacked and leaning.
  const clusters = 5 + Math.floor(random() * 3);
  for (let c = 0; c < clusters; c++) {
    const theta = random() * Math.PI * 2;
    const count = 5 + Math.floor(random() * 8);
    for (let i = 0; i < count; i++) {
      const { x, z } = islandPoint(
        theta + (random() - 0.5) * 0.12,
        random() * 9 - 4,
      );
      const size = 0.9 + random() ** 1.5 * 3.2;
      const grey = 0.3 + random() * 0.12;
      rocks.push({
        position: new THREE.Vector3(
          x,
          Math.max(terrainHeight(x, z), -0.6) + size * (0.2 + random() * 0.3),
          z,
        ),
        scale: new THREE.Vector3(size, size * (0.65 + random() * 0.3), size * (0.8 + random() * 0.3)),
        rotation: new THREE.Euler(random() * 0.6, random() * 6, random() * 0.6),
        color: new THREE.Color().setHSL(0.08 + random() * 0.05, 0.1, grey),
      });
    }
  }
  return rocks;
}
