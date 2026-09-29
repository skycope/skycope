import * as THREE from "three";
import { createForest } from "./forest.js";
import { createFauna } from "./fauna.js";
import { createCat, SPLASH } from "./cat.js";
import { CAT_SKY } from "./cat-ground.js";
import { CAT_SEA } from "./cat-coat.js";
import { createCritters } from "./critters.js";
import { createMotes } from "./motes.js";
import { horizonRadiance, skyDomeRatio } from "./sunlight.js";
import { createOcclusion } from "./occlusion.js";

// The mesh layer tonemaps with the same curve as the WebGPU water pass
// (atmosphere.wgsl), so land, sea and sky share one exposure and one
// highlight shoulder: Khronos PBR Neutral. It is linear through the
// midtones, so colours stay as the materials and light make them, with only
// a small toe: shadows stay open and lifted by skylight, as in a photograph,
// rather than crushed by a filmic S-curve. Keep TONE_GAIN equal in both.
THREE.ShaderChunk.tonemapping_pars_fragment =
  THREE.ShaderChunk.tonemapping_pars_fragment.replace(
    /vec3 CustomToneMapping\( vec3 color \) \{[^}]*\}/,
    `vec3 CustomToneMapping( vec3 color ) {
      // toneMappingExposure carries 1 + night adaptation (see scotopic in
      // atmosphere.wgsl); exposure itself is already in the light units.
      color = max( color * 1.5, vec3( 0.0 ) );
      float rods = clamp( toneMappingExposure - 1.0, 0.0, 1.0 );
      float scotopic = dot( color, vec3( 0.06, 0.56, 0.38 ) );
      color = mix( color, vec3( 0.72, 0.9, 1.35 ) * scotopic, rods * 0.6 * ( 1.0 - smoothstep( 0.25, 1.5, scotopic ) ) );
      float low = min( color.r, min( color.g, color.b ) );
      color -= low < 0.08 ? low - 6.25 * low * low : 0.04;
      float peak = max( color.r, max( color.g, color.b ) );
      if ( peak < 0.76 ) return color;
      float newPeak = 1.0 - 0.0576 / ( peak - 0.52 );
      color *= newPeak / peak;
      return mix( color, vec3( newPeak ), 1.0 - 1.0 / ( 0.15 * ( peak - newPeak ) + 1.0 ) );
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
  const forest = createForest(land, seed, { light });
  const fauna = createFauna(land, seed);
  const cat = createCat(land, { light });
  const critters = createCritters(land, seed, forest.obstacles.flowers);
  scene.add(land);
  // The scene root and the island never move. Left to auto-update, each
  // re-composes its matrix every frame, which forces a world-matrix update
  // down through every plant chunk; frozen, only what moves (cat, birds,
  // critters) updates, and static chunks skip even the walk (forest.js).
  for (const root of [scene, land]) {
    root.updateMatrix();
    root.matrixAutoUpdate = false;
  }
  const motes = createMotes(scene, seed);
  const moteLight = new THREE.Color();

  // Skylight is image-based: the scattering model's own sky dome (sun side
  // warm and bright, anti-sun deep blue) over the ground's bounce light, as a
  // small equirect map prefiltered by PMREM. Every standard material then
  // takes directional skylight and rough sky reflections from it, instead of
  // one hemisphere colour. Rebuilt only when the lighting key changes.
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envWidth = 64;
  const envData = new Uint16Array(envWidth * (envWidth / 2) * 4);
  const envSource = new THREE.DataTexture(envData, envWidth, envWidth / 2, THREE.RGBAFormat, THREE.HalfFloatType);
  envSource.mapping = THREE.EquirectangularReflectionMapping;
  envSource.magFilter = THREE.LinearFilter;
  envSource.minFilter = THREE.LinearFilter;
  envSource.colorSpace = THREE.LinearSRGBColorSpace;
  let envTarget = null;
  // The same sky as nine spherical-harmonic coefficients (unit exposure),
  // for the heavily overdrawn foliage: a few multiply-adds per fragment
  // instead of two prefiltered cube-map lookups (forest.js SKY_SH_GLSL).
  const skySH = new THREE.SphericalHarmonics3();
  const shBasis = new Array(9).fill(0);
  const shDirection = new THREE.Vector3();
  let domeRatio = null;
  let domeKey = "";
  let domeTime = 0;
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
  // The sun is half a degree wide: shadows soften with distance from their
  // caster. A small PCF radius gives leaf shadows their penumbra.
  sun.shadow.radius = light ? 1.5 : 2.2;
  sun.shadow.normalBias = 0.02;
  sun.shadow.bias = -0.0003;
  sun.target.position.set(23, 0, -35);
  scene.add(sun, sun.target);
  let previousLighting = "";
  let environmentKey = "";
  // Horizon haze toward and away from the sun, unexposed; see updateLighting.
  let hazeToward = [0, 0, 0];
  let hazeAway = [0, 0, 0];
  const prints = cat.prints;
  let interest = null;
  const perf = new URLSearchParams(window.location.search).has("perf");
  // Plant chunks hidden behind the ground and nearer plants skip their draws
  // (see occlusion.js). `?nocull` turns it off for A/B checks.
  const occlusion = createOcclusion(renderer, scene, camera, {
    enabled: !new URLSearchParams(window.location.search).has("nocull"),
  });
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
    // `?perf` QA: lets the console toggle scene parts and time the mesh
    // layer on its own (renderer and camera are only exposed then).
    scene,
    renderer: perf ? renderer : null,
    camera: perf ? camera : null,
    occlusion: perf ? occlusion : null,
    surf: perf ? forest.surf : null,
    obstacles: forest.obstacles,
    shoreRocks: forest.shoreRocks,
    // `?perf` QA: scales every splash the cat and the surf throw.
    splash: SPLASH,
    landField: forest.landField,
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
    render({ celestial, cover, time, wind, rain = 0, view: flight, lighting, pose, dt, surface, water = null, onStep, wake = null }) {
      const pointer = [0.5, 0.5];
      const night = THREE.MathUtils.smoothstep(celestial.scene, 1, 2);
      forest.updateWind(time, wind);
      forest.updateNight(night);
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
        const toward = Math.hypot(celestial.sun[0], celestial.sun[2]) > 1e-4
          ? [celestial.sun[0], 0, celestial.sun[2]]
          : [1, 0, 0];
        const norm = Math.hypot(toward[0], toward[2]);
        hazeToward = horizonRadiance(celestial, [toward[0] / norm, 0, toward[2] / norm], 1);
        hazeAway = horizonRadiance(celestial, [-toward[0] / norm, 0, -toward[2] / norm], 1);
        forest.updateShadowCentre(anchorX, anchorZ);
        renderer.shadowMap.needsUpdate = true;
      }
      // The sky dome only depends on the sun (not the cat's shadow anchor).
      // It costs ~4 ms of CPU, so while the time slider scrubs it follows at
      // most four times a second, and catches up once the sun settles.
      const sunKey = celestial.sun.map((v) => v.toFixed(3)).join();
      const now = performance.now();
      if (sunKey !== domeKey && (!domeRatio || now - domeTime > 250)) {
        domeKey = sunKey;
        domeTime = now;
        domeRatio = skyDomeRatio(celestial.sun, envWidth);
      }
      updateLighting(celestial, cover, lighting);
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
      cat.update(pose, dt, time, surface, onStep, {
        night,
        direct: THREE.MathUtils.smoothstep(sunWorld.y, 0, 0.3) * (1 - cover * 0.9),
        sun: sunWorld,
        sunX: sunWorld.x,
        sunZ: -sunWorld.z,
        eye: camera.position,
        pixelScale: renderer.domElement.height / (2 * Math.tan((camera.fov * Math.PI) / 360)),
        wind,
        rain,
      }, wake);
      if (water) forest.updateSurf(time, [flight.x, flight.y, flight.z], renderer.domElement.height / (2 * Math.tan((camera.fov * Math.PI) / 360)), water);
      // Plants part round the cat as it walks through them.
      forest.pushAt(pose.x, pose.z, pose.air > 0.05 ? 0 : 1);
      interest = critters.update(dt, time, pose, night);
      // Motes glow only in daylight, dimmed by cloud like the direct sun.
      moteLight.copy(sun.color).multiplyScalar(sun.intensity * THREE.MathUtils.smoothstep(sunWorld.y, 0.0, 0.1) * (1 - night));
      motes.update(time, wind, camera.position, sunWorld, moteLight,
        renderer.domElement.height / (2 * Math.tan((camera.fov * Math.PI) / 360)));
      cat.renderShadow(renderer, scene);
      occlusion.cull();
      renderer.render(scene, camera);
      occlusion.test();
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
    addPrint(print) {
      prints.add(print);
    },
    catLanded(time, strength, kind, surface) {
      cat.land(time, strength, kind, surface);
    },
    catSplashed(time, strength, level) {
      cat.splash(time, strength, level);
    },
    // A jump cut (the cat sent home): stale occlusion answers must not hold
    // back what the new view sees.
    resetOcclusion() {
      occlusion.reset();
    },
    resize(width, height, quality = 1) {
      occlusion.reset();
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
      occlusion.dispose();
      sun.shadow.dispose();
      envTarget?.dispose();
      envSource.dispose();
      pmrem.dispose();
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
  function updateLighting(celestial, cover, lighting) {
    const [r, g, b] = lighting.direct;
    const peak = Math.max(r, g, b, 1e-6);
    // Heavy cloud all but removes direct sun (and its shadows).
    const overcast = 1 - Math.pow(cover, 1.5) * 0.93;
    sun.color.setRGB(r / peak, g / peak, b / peak);
    sun.intensity = peak * overcast;
    sunTint.copy(sun.color);
    const night = THREE.MathUtils.smoothstep(celestial.scene, 1, 2);
    // At night the moon/night floor in lighting.sky is already the whole
    // story, and an overcast dome is near uniform (brighter overhead).
    const uniform = Math.max(night, cover);
    // The environment is baked at unit exposure; environmentIntensity carries
    // the eye's adaptation frame to frame, so it is rebuilt only when the sun,
    // weather or night changes, not as exposure drifts.
    const exposure = Math.max(lighting.exposure, 1e-6);
    // Night vision: by moonlight the eye sees with rods, colour fades to a
    // blue-grey (the tonemap reads it from the exposure uniform).
    renderer.toneMappingExposure = 1 + night;
    scene.environmentIntensity = exposure;
    forest.updateSkySH(skySH.coefficients, exposure);
    const key = `${previousLighting}:${domeKey}:${lighting.gloom.toFixed(2)}`;
    const mean = domeMean(uniform);
    const sky = lighting.sky.map((v, i) => v * mean[i] * (1 + cover * 0.45));
    // Ground bounce: the island's mean albedo (sand, soil and leaves) under
    // sun and sky, at its true brightness relative to the sky, so undersides
    // stay darker than tops instead of being lifted to match them.
    const bounce = lighting.direct.map(
      (v, i) => (v * Math.max(sunWorld.y, 0) * overcast / Math.PI + sky[i]) * [0.2, 0.19, 0.15][i],
    );
    if (key !== environmentKey && domeRatio) {
      environmentKey = key;
      buildEnvironment(lighting.sky.map((v) => (v * (1 + cover * 0.45)) / exposure), bounce.map((v) => v / exposure), uniform);
    }
    CAT_SKY.value.setRGB(sky[0] * Math.PI, sky[1] * Math.PI, sky[2] * Math.PI);
    const foamLight = lighting.direct.map((v, i) => (v * Math.max(sunWorld.y, 0) * overcast) / Math.PI + sky[i] * 1.1);
    forest.updateFoamLight(foamLight);
    CAT_SEA.foam.value.setRGB(...foamLight);
    // The water column's own colour, as ocean.wgsl scatters it: sun and sky
    // light times scattering over extinction.
    const ambient = lighting.direct.map((v, i) => (v * (1 - cover * 0.8) * (0.4 + 0.6 * Math.max(sunWorld.y, 0))) / Math.PI + lighting.sky[i]);
    CAT_SEA.colour.value.setRGB(ambient[0] * 0.0188, ambient[1] * 0.087, ambient[2] * 0.123);
    // Aerial perspective: the haze is the horizon sky toward each fragment,
    // bright and warm toward the sun, cooler and bluer away from it, rather
    // than one colour for the whole view.
    const haze = (h) => {
      const c = h.map((v) => v * exposure * lighting.gloom);
      // Grey the haze under cloud, as the sky pass does.
      const grey = c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
      const k = THREE.MathUtils.smoothstep(cover, 0.55, 1) * 0.7;
      return c.map((v, i) => v + (grey * [0.92, 0.96, 1][i] - v) * k);
    };
    const toward = haze(hazeToward);
    const away = haze(hazeAway);
    forest.updateHaze(toward, away);
    scene.fog.color.setRGB((toward[0] + away[0]) / 2, (toward[1] + away[1]) / 2, (toward[2] + away[2]) / 2);
  }

  // Cosine-weighted mean of the dome ratio: what a level surface receives.
  function domeMean(uniform) {
    const mean = [0, 0, 0];
    if (!domeRatio) return [1, 1, 1];
    const rows = envWidth / 4;
    let total = 0;
    for (let j = 0; j < rows; j++) {
      const elevation = ((j + 0.5) / (rows * 2)) * Math.PI;
      const w = Math.sin(elevation) * Math.cos(elevation);
      for (let i = 0; i < envWidth; i++) {
        const k = (j * envWidth + i) * 3;
        for (let c = 0; c < 3; c++) mean[c] += w * domeRatio[k + c];
        total += w;
      }
    }
    // Overcast: the CIE dome, (1 + 2 sin h) / 3, whose cosine mean is 7/9.
    return mean.map((v) => (v / total) * (1 - uniform) + uniform);
  }

  // Sky above the horizon from the dome ratio (CIE overcast when cloudy or
  // at night), ground bounce below it, joined through a thin horizon band.
  function buildEnvironment(sky, bounce, uniform) {
    const width = envWidth;
    const height = width / 2;
    const rows = width / 4;
    const half = THREE.DataUtils.toHalfFloat;
    skySH.zero();
    const cell = ((Math.PI * 2) / width) * (Math.PI / height);
    for (let j = 0; j < height; j++) {
      const elevation = ((j + 0.5) / height - 0.5) * Math.PI;
      const up = Math.sin(elevation);
      const cie = (1 + 2 * Math.max(up, 0)) / 3 / (7 / 9);
      const skyRow = Math.min(rows - 1, Math.max(0, j - rows));
      // Below the horizon the ground (and sea) returns bounce light; within
      // a few degrees it is still mostly the hazy horizon sky.
      const ground = THREE.MathUtils.smoothstep(-up, 0.0, 0.12);
      const across = Math.cos(elevation);
      for (let i = 0; i < width; i++) {
        const k = (skyRow * width + i) * 3;
        const o = (j * width + i) * 4;
        const phi = ((i + 0.5) / width - 0.5) * Math.PI * 2;
        shDirection.set(Math.cos(phi) * across, up, Math.sin(phi) * across);
        THREE.SphericalHarmonics3.getBasisAt(shDirection, shBasis);
        for (let c = 0; c < 3; c++) {
          const sky1 = sky[c] * (domeRatio[k + c] * (1 - uniform) + cie * uniform);
          const radiance = sky1 + (bounce[c] - sky1) * ground;
          envData[o + c] = half(radiance);
          const weight = radiance * cell * across;
          for (let b = 0; b < 9; b++) skySH.coefficients[b].setComponent(c, skySH.coefficients[b].getComponent(c) + shBasis[b] * weight);
        }
        envData[o + 3] = half(1);
      }
    }
    envSource.needsUpdate = true;
    const previous = envTarget;
    envTarget = pmrem.fromEquirectangular(envSource, previous ?? null);
    scene.environment = envTarget.texture;
  }
}
