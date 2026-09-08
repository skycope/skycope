import * as THREE from "three";
import { terrainHeight, shoreline, noise2, smoothstep } from "./terrain.js";
import { seededRandom } from "./random.js";
import { createVegetation } from "./vegetation.js";

// All assets are built from geometry. No downloaded or generated images/textures.
export function createForest(scene, seed) {
  addGround(scene);
  const random = seededRandom(seed);
  const { wood: trunks, leaves } = createVegetation(seed);
  addInstances(
    scene,
    new THREE.CylinderGeometry(0.55, 1, 1, 5),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }),
    trunks,
    true,
  );
  const breeze = { time: { value: 0 }, strength: { value: 0 } };
  const leafMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.72,
    side: THREE.DoubleSide,
  });
  leafMaterial.onBeforeCompile = (shader) => {
    shader.uniforms.breezeTime = breeze.time;
    shader.uniforms.breezeStrength = breeze.strength;
    shader.vertexShader =
      "uniform float breezeTime; uniform float breezeStrength;\n" +
      shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      `
      #include <begin_vertex>
      float phase = breezeTime * 1.4 + instanceMatrix[3].x * 0.7 + instanceMatrix[3].z * 0.4;
      float tipWeight = (position.y + 1.0) * 0.5;
      transformed.z += sin(phase) * tipWeight * tipWeight * 0.10 * breezeStrength;
    `,
    );
  };
  addInstances(scene, leafGeometry(), leafMaterial, leaves, true);
  addRocks(scene, random);
  return {
    updateWind(time, speed) {
      breeze.time.value = time;
      breeze.strength.value = Math.min(1.5, speed / 8);
    },
  };
}

function addGround(scene) {
  const width = 100;
  const depth = 225;
  const geometry = new THREE.PlaneGeometry(width, depth, 160, 200);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(40, 0, depth / 2);
  const position = geometry.attributes.position;
  const colors = new Float32Array(position.count * 3);
  const sand = new THREE.Color("#bcb193");
  const wetSand = new THREE.Color("#716f53");
  const moss = new THREE.Color("#354b26");
  const color = new THREE.Color();
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const z = position.getZ(i);
    const inland = x - shoreline(z);
    position.setY(i, terrainHeight(x, z));
    color.copy(wetSand).lerp(sand, smoothstep(-0.2, 2, inland));
    color.lerp(moss, smoothstep(4, 9, inland));
    color.multiplyScalar(0.88 + noise2(x * 2, z * 2) * 0.22);
    color.toArray(colors, i * 3);
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.95,
      clippingPlanes: [new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)],
    }),
  );
  mesh.receiveShadow = true;
  scene.add(mesh);
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

function addRocks(scene, random) {
  const rocks = [];
  for (let i = 0; i < 140; i++) {
    const z = 8 + random() * 180;
    const x = shoreline(z) + random() * 7 - 2;
    const size = 0.15 + random() ** 3 * 1.2;
    rocks.push({
      position: new THREE.Vector3(x, terrainHeight(x, z) + size * 0.25, z),
      scale: new THREE.Vector3(size, size * 0.7, size * 0.85),
      rotation: new THREE.Euler(random(), random() * 6, random()),
      color: new THREE.Color().setHSL(0.13, 0.08, 0.28 + random() * 0.13),
    });
  }
  addInstances(
    scene,
    rockGeometry(),
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.92,
      clippingPlanes: [new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)],
    }),
    rocks,
    true,
  );
}
