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
  addGround(scene, shared);
  const random = seededRandom(seed);
  const { wood: trunks, leaves, clusters } = createVegetation(seed);
  const woodMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 1,
  });
  patchMaterial(woodMaterial, shared, { sway: true });
  addInstances(
    scene,
    new THREE.CylinderGeometry(0.55, 1, 1, 5, 1, true),
    woodMaterial,
    trunks,
    true,
  );
  const clusterMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.78,
    side: THREE.DoubleSide,
  });
  patchMaterial(clusterMaterial, shared, {
    sway: true,
    flutter: 0.09,
    foliage: true,
  });
  addInstances(scene, clusterGeometry(), clusterMaterial, clusters, true);
  const bladeMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.72,
    side: THREE.DoubleSide,
  });
  patchMaterial(bladeMaterial, shared, { flutter: 0.08, foliage: true });
  addInstances(scene, leafGeometry(), bladeMaterial, leaves, true);
  addRocks(scene, random, shared);
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
vec3 windOffset(vec3 p) {
  float h = max(p.y, 0.0);
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
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;
`;

// Backlit leaves transmit warm light (cheap subsurface scattering), and a
// shifting subset carries a tight specular lobe: sun-sparkles as they flutter.
const FOLIAGE_GLSL = /* glsl */ `
#include <lights_fragment_end>
{
  vec3 sceneViewDir = normalize( vViewPosition );
  float backlit = clamp( -dot( sceneViewDir, sunDirView ), 0.0, 1.0 );
  float transmission = pow( backlit, 3.0 ) * ( 0.25 + 0.75 * abs( dot( normal, sunDirView ) ) );
  reflectedLight.indirectDiffuse += diffuseColor.rgb * vec3( 1.1, 1.05, 0.55 )
    * sunTint * transmission * sunGlow * 2.2;
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

function patchMaterial(material, shared, { sway = false, flutter = 0, foliage = false } = {}) {
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
    if (foliage)
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <lights_fragment_end>",
        FOLIAGE_GLSL,
      );
  };
}

function addGround(scene, shared) {
  const size = 190;
  const geometry = new THREE.PlaneGeometry(size, size, 190, 190);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(ISLAND.x, 0, ISLAND.z);
  const position = geometry.attributes.position;
  const colors = new Float32Array(position.count * 3);
  // An ecotone replaces the hard beach-forest line: sand grades through dry
  // dune tones and leaf litter into forest soil, dithered by noise over metres.
  const sand = new THREE.Color("#bcb193");
  const wetSand = new THREE.Color("#716f53");
  const dune = new THREE.Color("#a4986b");
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
    color.multiplyScalar(0.88 + noise2(x * 2, z * 2) * 0.22);
    color.toArray(colors, i * 3);
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.95,
    clippingPlanes: [new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)],
  });
  patchMaterial(material, shared);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  scene.add(mesh);
}

// A shoot tip of drooping blades in a jittered golden-angle fan replaces
// uniform single lozenges: structured phyllotaxis placement reads as more
// organic than random cards, and one instance covers what several lozenges did.
function clusterGeometry() {
  const positions = [];
  const indices = [];
  const random = seededRandom(7);
  const dir = new THREE.Vector3();
  const side = new THREE.Vector3();
  const lift = new THREE.Vector3();
  for (let b = 0; b < 6; b++) {
    const azimuth = b * 2.39996 + (random() - 0.5) * 0.8;
    // Inner blades stand, outer blades droop past horizontal: a soft mound
    // silhouette instead of a symmetric star.
    const tilt = 0.5 + (b / 6) * 0.85 + (random() - 0.5) * 0.3;
    dir.set(
      Math.sin(tilt) * Math.cos(azimuth),
      Math.cos(tilt),
      Math.sin(tilt) * Math.sin(azimuth),
    );
    side.set(-Math.sin(azimuth), 0, Math.cos(azimuth));
    lift.crossVectors(dir, side).normalize();
    const length = 0.5 + random() * 0.45;
    const width = (0.2 + random() * 0.06) * length;
    // Ovate outline: widest past the middle, a blunt rounded tip, and a cupped
    // cross-section so the shading rolls off instead of faceting to a point.
    const base = new THREE.Vector3(0, 0.02, 0);
    const mid = base
      .clone()
      .addScaledVector(dir, length * 0.55)
      .addScaledVector(lift, 0.06);
    const shoulder = base
      .clone()
      .addScaledVector(dir, length * 0.88)
      .addScaledVector(lift, -0.02 - random() * 0.05);
    const tip = base
      .clone()
      .addScaledVector(dir, length)
      .addScaledVector(lift, -0.07 - random() * 0.06);
    const first = positions.length / 3;
    positions.push(
      base.x, base.y, base.z,
      mid.x + side.x * width, mid.y, mid.z + side.z * width,
      mid.x - side.x * width, mid.y, mid.z - side.z * width,
      shoulder.x + side.x * width * 0.55, shoulder.y, shoulder.z + side.z * width * 0.55,
      shoulder.x - side.x * width * 0.55, shoulder.y, shoulder.z - side.z * width * 0.55,
      tip.x, tip.y, tip.z,
    );
    indices.push(
      first, first + 1, first + 2,
      first + 1, first + 3, first + 2,
      first + 2, first + 3, first + 4,
      first + 3, first + 5, first + 4,
    );
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function leafGeometry() {
  const geometry = new THREE.BufferGeometry();
  // A curved eight-triangle blade. Shared vertices keep the rib softly shaded.
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      [
        0, -1, 0, -0.32, -0.35, 0.01, 0, -0.35, 0.12, 0.32, -0.35, 0.01, -0.28,
        0.4, -0.04, 0, 0.4, 0.08, 0.28, 0.4, -0.04, 0, 1, -0.18,
      ],
      3,
    ),
  );
  geometry.setIndex([
    0, 1, 2, 0, 2, 3, 1, 4, 5, 1, 5, 2, 2, 5, 6, 2, 6, 3, 4, 7, 5, 5, 7, 6,
  ]);
  geometry.computeVertexNormals();
  return geometry;
}

function rockGeometry() {
  const geometry = new THREE.SphereGeometry(1, 14, 10);
  const positions = geometry.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    const p = new THREE.Vector3().fromBufferAttribute(positions, i);
    p.multiplyScalar(
      0.78 +
        noise2(p.x * 2.5 + p.y * 2, p.z * 2.5) * 0.35 +
        noise2(p.x * 10, p.z * 10 + p.y * 5) * 0.06,
    );
    positions.setXYZ(i, p.x, p.y, p.z);
  }
  geometry.computeVertexNormals();
  return geometry;
}

function addInstances(scene, geometry, material, instances, shadows) {
  const mesh = new THREE.InstancedMesh(geometry, material, instances.length);
  const transform = new THREE.Object3D();
  for (let i = 0; i < instances.length; i++) {
    const instance = instances[i];
    transform.position.copy(instance.position);
    transform.scale.copy(instance.scale);
    transform.rotation.copy(instance.rotation);
    transform.updateMatrix();
    mesh.setMatrixAt(i, transform.matrix);
    if (instance.color) mesh.setColorAt(i, instance.color);
  }
  mesh.castShadow = shadows;
  mesh.receiveShadow = true;
  mesh.computeBoundingSphere();
  scene.add(mesh);
}

function addRocks(scene, random, shared) {
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
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.92,
    clippingPlanes: [new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)],
  });
  patchMaterial(material, shared);
  addInstances(scene, rockGeometry(), material, rocks, true);
}
