import * as THREE from "three";
import { createForest } from "./forest.js";

// Geometry shares the sky shader's 315° heading, 6° pitch, and projection.
// WebGL handles mesh depth/shadows; WebGPU handles the sky and water behind it.
export function createLandscape(canvas, seed) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    powerPreference: "low-power",
  });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.localClippingEnabled = true;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x8fb0b8, 0.0045);
  const camera = new THREE.PerspectiveCamera(
    (2 * Math.atan(0.5 / 0.9) * 180) / Math.PI,
    1,
    0.2,
    280,
  );
  camera.position.set(6, 4.5, 0);
  const land = new THREE.Group();
  land.scale.z = -1;
  const forest = createForest(land, seed);
  scene.add(land);

  const ambient = new THREE.HemisphereLight(0xc3e0eb, 0x28381d, 1.3);
  const sun = new THREE.DirectionalLight(0xffe9c2, 2.5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, {
    left: -45,
    right: 45,
    top: 45,
    bottom: -45,
    near: 1,
    far: 180,
  });
  sun.shadow.normalBias = 0.06;
  sun.shadow.bias = -0.0002;
  sun.target.position.set(23, 0, -35);
  scene.add(ambient, sun, sun.target);
  const fogDay = new THREE.Color(0x91b1b7);
  const fogDusk = new THREE.Color(0x827476);
  const fogNight = new THREE.Color(0x132332);
  let previousLighting = "";

  return {
    render(celestial, pointer, cover, time, windSpeed) {
      forest.updateWind(time, windSpeed);
      const key = `${celestial.sunAltitude.toFixed(1)}:${celestial.scene.toFixed(2)}:${cover.toFixed(2)}`;
      if (key !== previousLighting) {
        previousLighting = key;
        updateLighting(celestial, cover);
        renderer.shadowMap.needsUpdate = true;
      }
      const leanX = (pointer[0] - 0.5) * 0.014;
      const leanY = (pointer[1] - 0.5) * 0.009;
      camera.lookAt(
        6 + leanX,
        4.5 + 0.104528 * 0.9 + 0.994522 * leanY,
        -0.994522 * 0.9 + 0.104528 * leanY,
      );
      renderer.render(scene, camera);
      if (!canvas.dataset.triangles) {
        canvas.dataset.triangles = String(renderer.info.render.triangles);
        canvas.dataset.drawCalls = String(renderer.info.render.calls);
      }
    },
    resize(width, height, quality = 1) {
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      const scale =
        Math.min(2, Math.sqrt(2500000 / (width * height))) *
        Math.max(0.8, quality);
      renderer.setSize(
        Math.round(width * scale),
        Math.round(height * scale),
        false,
      );
    },
    dispose() {
      const geometries = new Set();
      const materials = new Set();
      scene.traverse((object) => {
        if (object.isInstancedMesh) object.dispose();
        if (object.geometry) geometries.add(object.geometry);
        if (object.material) materials.add(object.material);
      });
      geometries.forEach((geometry) => geometry.dispose());
      materials.forEach((material) => material.dispose());
      sun.shadow.dispose();
      renderer.dispose();
    },
  };

  function updateLighting(celestial, cover) {
    const night = THREE.MathUtils.smoothstep(celestial.scene, 1, 2);
    const direction = new THREE.Vector3(...celestial.sun)
      .lerp(new THREE.Vector3(...celestial.moon), night)
      .normalize();
    const localX = (direction.x + direction.z) * Math.SQRT1_2;
    const localZ = (-direction.x + direction.z) * Math.SQRT1_2;
    sun.position
      .copy(sun.target.position)
      .add(new THREE.Vector3(localX, direction.y, -localZ).multiplyScalar(85));
    sun.color
      .set(0xffecd1)
      .lerp(new THREE.Color(0xffaa6b), Math.min(1, celestial.scene));
    sun.color.lerp(new THREE.Color(0x9bbcd5), night);
    sun.intensity =
      (2.5 - night * 2.05) *
      THREE.MathUtils.smoothstep(direction.y, -0.03, 0.1) *
      (1 - cover * 0.72);
    ambient.intensity = THREE.MathUtils.lerp(1.35, 0.15, night);
    scene.fog.color
      .copy(fogDay)
      .lerp(fogDusk, Math.min(1, celestial.scene))
      .lerp(fogNight, night);
  }
}
