import * as THREE from "three";
import { createForest } from "./forest.js";

// Geometry shares the sky shader's 315° heading, 6° pitch, and projection.
// WebGL handles mesh depth/shadows; WebGPU handles the sky and water behind it.
export function createLandscape(canvas, seed) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    powerPreference: "high-performance",
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
  sun.shadow.normalBias = 0.02;
  sun.shadow.bias = -0.0003;
  sun.target.position.set(23, 0, -35);
  scene.add(ambient, sun, sun.target);
  const fogDay = new THREE.Color(0x91b1b7);
  const fogDusk = new THREE.Color(0x827476);
  const fogNight = new THREE.Color(0x132332);
  let previousLighting = "";

  const sunWorld = new THREE.Vector3(0, 1, 0);
  const sunView = new THREE.Vector3();
  const lookDirection = new THREE.Vector3();
  const lookRight = new THREE.Vector3();
  const lookUp = new THREE.Vector3();
  const lookTarget = new THREE.Vector3();

  return {
    render(celestial, pointer, cover, time, wind, flight) {
      forest.updateWind(time, wind);
      const sinA = Math.sin(flight.azimuth);
      const cosA = Math.cos(flight.azimuth);
      const hx = (sinA + cosA) * Math.SQRT1_2;
      const hz = (cosA - sinA) * Math.SQRT1_2;
      // The shadow frustum follows the camera in coarse steps, so flying only
      // occasionally re-renders the map rather than every frame.
      const anchorX = Math.round((flight.x + hx * 28) / 24) * 24;
      const anchorZ = Math.round((flight.z + hz * 28) / 24) * 24;
      const key = `${celestial.sunAltitude.toFixed(1)}:${celestial.scene.toFixed(2)}:${cover.toFixed(2)}:${anchorX}:${anchorZ}`;
      if (key !== previousLighting) {
        previousLighting = key;
        sun.target.position.set(anchorX, 0, -anchorZ);
        updateLighting(celestial, cover);
        renderer.shadowMap.needsUpdate = true;
      }
      // The Three scene mirrors coast z (the land group is z-flipped).
      camera.position.set(flight.x, flight.y, -flight.z);
      const cp = Math.cos(flight.pitch);
      lookDirection.set(hx * cp, Math.sin(flight.pitch), -hz * cp);
      lookRight.set(hz, 0, hx);
      lookUp.crossVectors(lookRight, lookDirection);
      lookTarget
        .copy(camera.position)
        .add(lookDirection)
        .addScaledVector(lookRight, (pointer[0] - 0.5) * 0.014)
        .addScaledVector(lookUp, (pointer[1] - 0.5) * 0.009);
      camera.lookAt(lookTarget);
      camera.updateMatrixWorld();
      // Leaf translucency and glints follow the light in view space. Overcast
      // and low light retract them so night foliage never glows.
      const night = THREE.MathUtils.smoothstep(celestial.scene, 1, 2);
      sunView.copy(sunWorld).transformDirection(camera.matrixWorldInverse);
      forest.updateSun(
        sunView,
        sun.color,
        THREE.MathUtils.smoothstep(sunWorld.y, -0.02, 0.12) *
          (1 - cover * 0.8) *
          (1 - night * 0.9),
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
    sunWorld.set(localX, direction.y, -localZ).normalize();
    sun.position
      .copy(sun.target.position)
      .add(sunWorld.clone().multiplyScalar(85));
    sun.color
      .set(0xffecd1)
      .lerp(new THREE.Color(0xff9a55), Math.min(1, celestial.scene));
    sun.color.lerp(new THREE.Color(0x9bbcd5), night);
    sun.intensity =
      (2.5 - night * 2.05) *
      THREE.MathUtils.smoothstep(direction.y, -0.03, 0.1) *
      (1 - cover * 0.72);
    // The ambient fill follows the sky: cool daylight, warm-grey dusk, and a
    // faint blue night, so foliage is not lit with noon colours at sunset.
    const dusk = Math.min(1, celestial.scene);
    ambient.color
      .set(0xc3e0eb)
      .lerp(new THREE.Color(0xd9a98c), dusk)
      .lerp(new THREE.Color(0x24344e), night);
    ambient.groundColor
      .set(0x28381d)
      .lerp(new THREE.Color(0x2e2119), dusk)
      .lerp(new THREE.Color(0x0a0f14), night);
    ambient.intensity =
      THREE.MathUtils.lerp(1.35, 0.75, dusk * dusk) *
        (1 - night) +
      0.14 * night;
    scene.fog.color
      .copy(fogDay)
      .lerp(fogDusk, Math.min(1, celestial.scene))
      .lerp(fogNight, night);
  }
}
