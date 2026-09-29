import * as THREE from "three";
import { createForest } from "./forest.js";
import { createFauna } from "./fauna.js";
import { createCat } from "./cat.js";
import { createCritters } from "./critters.js";
import { horizonRadiance, skyIrradianceRatio } from "./sunlight.js";

// The mesh layer tonemaps with the same ACES fit as the WebGPU water pass, so
// land, sea and sky share one exposure and one highlight shoulder.
THREE.ShaderChunk.tonemapping_pars_fragment =
  THREE.ShaderChunk.tonemapping_pars_fragment.replace(
    /vec3 CustomToneMapping\( vec3 color \) \{[^}]*\}/,
    `vec3 CustomToneMapping( vec3 color ) {
      vec3 x = max( color * toneMappingExposure, vec3( 0.0 ) );
      return clamp( ( x * ( 2.51 * x + 0.03 ) ) / ( x * ( 2.43 * x + 0.59 ) + 0.14 ), 0.0, 1.0 );
    }`,
  );

// Geometry shares the sky shader's 315° heading, 6° pitch, and projection.
// WebGL handles mesh depth/shadows; WebGPU handles the sky and water behind it.
// `light` budgets (phones): no MSAA, a smaller shadow map.
export function createLandscape(canvas, seed, { light = false } = {}) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: !light,
    // The cat's see-through silhouette uses the stencil buffer (cat.js).
    stencil: true,
    // Same GPU as the WebGPU passes (see main.js), and the quiet one.
    powerPreference: "low-power",
  });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(1);
  renderer.toneMapping = THREE.CustomToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.localClippingEnabled = true;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x8fb0b8, 0.0032);
  const camera = new THREE.PerspectiveCamera(
    (2 * Math.atan(0.5 / 0.9) * 180) / Math.PI,
    1,
    0.05,
    230,
  );
  camera.position.set(6, 4.5, 0);
  const land = new THREE.Group();
  land.scale.z = -1;
  const forest = createForest(land, seed);
  const fauna = createFauna(land, seed);
  const cat = createCat(land);
  const critters = createCritters(land, seed, forest.obstacles.flowers);
  scene.add(land);

  const ambient = new THREE.HemisphereLight(0xc3e0eb, 0x28381d, 1.3);
  const sun = new THREE.DirectionalLight(0xffe9c2, 2.5);
  sun.castShadow = true;
  // The camera stays near the cat, so the shadow map only has to cover the
  // ground around it: a 64 m square (3 cm texels at 2048²), re-rendered when
  // the cat has walked 10 m, rather than 90 m around a free-flying camera.
  sun.shadow.mapSize.setScalar(light ? 1024 : 2048);
  Object.assign(sun.shadow.camera, {
    left: -32,
    right: 32,
    top: 32,
    bottom: -32,
    near: 1,
    far: 160,
  });
  sun.shadow.normalBias = 0.02;
  sun.shadow.bias = -0.0003;
  sun.target.position.set(23, 0, -35);
  scene.add(ambient, sun, sun.target);
  let previousLighting = "";
  let skyRatio = [1, 1, 1];
  const prints = cat.prints;
  let interest = null;
  const perf = new URLSearchParams(window.location.search).has("perf");
  let perfFrame = 0;

  const sunWorld = new THREE.Vector3(0, 1, 0);
  const sunTint = new THREE.Color(1, 0.92, 0.75);
  const sunView = new THREE.Vector3();
  const lookDirection = new THREE.Vector3();
  const lookRight = new THREE.Vector3();
  const lookUp = new THREE.Vector3();
  const lookTarget = new THREE.Vector3();
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  return {
    // `?perf` QA: lets the console toggle scene parts to attribute cost.
    scene,
    obstacles: forest.obstacles,
    shoreRocks: forest.shoreRocks,
    // A screen point (−1…1) to a ray in coast metres, for tap-to-walk.
    pick(x, y) {
      ndc.set(x, y);
      raycaster.setFromCamera(ndc, camera);
      const { origin, direction } = raycaster.ray;
      return {
        origin: [origin.x, origin.y, -origin.z],
        direction: [direction.x, direction.y, -direction.z],
      };
    },
    render({ celestial, cover, time, wind, view: flight, lighting, pose, dt, surface, onStep }) {
      const pointer = [0.5, 0.5];
      const night = THREE.MathUtils.smoothstep(celestial.scene, 1, 2);
      forest.updateWind(time, wind);
      fauna.update(time, wind, night);
      const sinA = Math.sin(flight.azimuth);
      const cosA = Math.cos(flight.azimuth);
      const hx = (sinA + cosA) * Math.SQRT1_2;
      const hz = (cosA - sinA) * Math.SQRT1_2;
      // The shadow frustum follows the camera in coarse steps, so flying only
      // occasionally re-renders the map rather than every frame.
      const anchorX = Math.round((pose.x + hx * 8) / 10) * 10;
      const anchorZ = Math.round((pose.z + hz * 8) / 10) * 10;
      const key = `${celestial.sunAltitude.toFixed(1)}:${celestial.scene.toFixed(2)}:${cover.toFixed(2)}:${anchorX}:${anchorZ}`;
      if (key !== previousLighting) {
        previousLighting = key;
        sun.target.position.set(anchorX, 0, -anchorZ);
        updateDirection(celestial);
        skyRatio = skyIrradianceRatio(celestial.sun);
        renderer.shadowMap.needsUpdate = true;
      }
      updateLighting(celestial, cover, lighting, hx, hz);
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
      sunView.copy(sunWorld).transformDirection(camera.matrixWorldInverse);
      forest.updateSun(
        sunView,
        sunTint,
        THREE.MathUtils.smoothstep(sunWorld.y, -0.02, 0.12) *
          (1 - cover * 0.8) *
          (1 - night * 0.9) *
          Math.min(1, sun.intensity / 2),
      );
      prints.update(time);
      cat.update(pose, dt, time, surface, onStep, {
        night,
        direct: THREE.MathUtils.smoothstep(sunWorld.y, 0, 0.3) * (1 - cover * 0.9),
        sunX: sunWorld.x,
        sunZ: -sunWorld.z,
      });
      interest = critters.update(dt, time, pose, night);
      renderer.render(scene, camera);
      if (perf && ++perfFrame % 90 === 0) {
        // `?perf` QA: readPixels forces the GPU to drain, so timing a burst of
        // extra renders measures real mesh-layer cost, not command submission.
        const gl = renderer.getContext();
        const pixel = new Uint8Array(4);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        const started = performance.now();
        for (let i = 0; i < 6; i++) renderer.render(scene, camera);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        canvas.dataset.meshMs = ((performance.now() - started) / 6).toFixed(2);
        canvas.dataset.triangles = String(renderer.info.render.triangles);
        canvas.dataset.drawCalls = String(renderer.info.render.calls);
      }
      if (!canvas.dataset.triangles) {
        canvas.dataset.triangles = String(renderer.info.render.triangles);
        canvas.dataset.drawCalls = String(renderer.info.render.calls);
      }
    },
    get interest() {
      return interest;
    },
    addPrint(...args) {
      prints.add(...args);
    },
    resize(width, height, quality = 1) {
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      // The mesh layer is MSAA'd, so it needs fewer pixels than the sea:
      // 1.6 MP (0.8 MP on phones), scaled down further by adaptive quality.
      const budget = light ? 800000 : 1600000;
      const scale =
        Math.min(window.devicePixelRatio || 1, 1.5, Math.sqrt(budget / (width * height))) *
        Math.max(0.6, quality);
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

  function updateDirection(celestial) {
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
  }

  // Light comes from src/sunlight.js in exposed linear units: the same sun
  // colour and skylight the WebGPU sky and sea use. Three's Lambert divides by
  // π, so skylight radiance becomes π × radiance of irradiance.
  function updateLighting(celestial, cover, lighting, hx, hz) {
    const [r, g, b] = lighting.direct;
    const peak = Math.max(r, g, b, 1e-6);
    // Heavy cloud all but removes direct sun (and its shadows).
    const overcast = 1 - Math.pow(cover, 1.5) * 0.93;
    sun.color.setRGB(r / peak, g / peak, b / peak);
    sun.intensity = peak * overcast;
    sunTint.copy(sun.color);
    // Hemisphere: the whole dome's cosine-weighted skylight (blue at midday,
    // roughly a quarter of the sun on level ground), not the bright hazy
    // horizon toward the heading, which tinted every shadow khaki. At night
    // the moon/night floor in lighting.sky is already the whole story, and an
    // overcast dome is near uniform.
    const horizon = horizonRadiance(celestial, [hx, 0, hz], lighting.exposure).map(
      (v) => v * lighting.gloom,
    );
    const night = THREE.MathUtils.smoothstep(celestial.scene, 1, 2);
    const uniform = Math.max(night, cover);
    const sky = lighting.sky.map((v, i) => v * (skyRatio[i] + (1 - skyRatio[i]) * uniform));
    const skyPeak = Math.max(...sky, 1e-6);
    ambient.color.setRGB(sky[0] / skyPeak, sky[1] / skyPeak, sky[2] / skyPeak);
    // Ground bounce: the island's mean albedo (sand, soil and leaves) under
    // sun and sky, at its true brightness relative to the sky, so undersides
    // stay darker than tops instead of being lifted to match them.
    const bounce = lighting.direct.map(
      (v, i) => (v * Math.max(sunWorld.y, 0) * overcast / Math.PI + sky[i]) * [0.2, 0.19, 0.15][i],
    );
    ambient.groundColor.setRGB(
      bounce[0] / skyPeak,
      bounce[1] / skyPeak,
      bounce[2] / skyPeak,
    );
    // Overcast skies are brighter overall than the clear zenith alone.
    ambient.intensity = Math.PI * skyPeak * (1 + cover * 0.45);
    forest.updateFoamLight(
      lighting.direct.map((v, i) => (v * Math.max(sunWorld.y, 0) * overcast) / Math.PI + sky[i] * 1.1),
    );
    scene.fog.color.setRGB(horizon[0], horizon[1], horizon[2]);
    // Grey the haze under cloud, as the sky pass does.
    if (cover > 0.55) {
      const grey = horizon[0] * 0.2126 + horizon[1] * 0.7152 + horizon[2] * 0.0722;
      scene.fog.color.lerp(
        new THREE.Color().setRGB(grey * 0.92, grey * 0.96, grey),
        THREE.MathUtils.smoothstep(cover, 0.55, 1) * 0.7,
      );
    }
  }
}
