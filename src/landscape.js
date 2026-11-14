import * as THREE from "three";
import { createForest } from "./forest.js";
import { createFauna } from "./fauna.js";
import { createCat, SPLASH } from "./cat.js";
import { CAT_SKY } from "./cat-ground.js";
import { CAT_SEA } from "./cat-coat.js";
import { createCritters } from "./critters.js";
import { createWildlife } from "./wildlife.js"; // wildlife: penguins, seals, whale…
import { createMotes } from "./motes.js";
import { createPrecipitation } from "./precipitation.js";
import { cloudTransmission } from "./cloud-transmission.js";
import { createMeshProfiler } from "./mesh-profiler.js";
import { createArchipelago } from "./archipelago.js";
import { createLens } from "./lens.js";
import { createPlaces } from "./places.js"; // places:
import { createWisp } from "./wisp.js"; // wisp: the little light that leads the cat
import { surfaceOf } from "./walker.js"; // solid: boulder tops for the fireflies
import { createLandMagic, lightWithMagic, finaleBlaze } from "./land-magic.js"; // land-magic:
import { createFireflies } from "./fireflies.js"; // land-magic:
import { groundHeight } from "./terrain.js"; // land-magic:
import { createBoat } from "./boat.js"; // boat: the fisherman's boat afloat
import { horizonRadiance, skyDomeRatio, skyDomeMean, skyEnvironmentKey } from "./sunlight.js";
import toneSource from "./shaders/tone.wgsl?raw";
import { customToneMapping, toneAdapt } from "./tone-glsl.js";

// The mesh layer tonemaps with the WebGPU sky and sea's own curve, so land,
// sea and sky share one exposure, one highlight shoulder and one grade:
// src/shaders/tone.wgsl is the only copy, translated to GLSL here.
// toneMappingExposure carries 1 + the eye's state (toneAdapt); exposure
// itself is already in the light units.
THREE.ShaderChunk.tonemapping_pars_fragment =
  THREE.ShaderChunk.tonemapping_pars_fragment.replace(
    /vec3 CustomToneMapping\( vec3 color \) \{[^}]*\}/,
    customToneMapping(toneSource),
  );

// land-look: night light on the land (see updateLighting), exposed linear
// units: the moonless key, what a full moon adds, and the sky fill's lift.
// `?perf`: landscape.nightLand tunes them live.
const NIGHT_LAND = { key: 0.1, moon: 0.14, fill: 6 };
const MOON_KEY = new THREE.Color(0.62, 0.74, 1.0);
// land-look: the sky dome as the land's ambient (buildEnvironment): how much
// of its chroma reaches the land with the sun high and with it low, and how
// much of the lowest sky the trees and hill hide: by day, with the sun low,
// and toward a low sun.
const ENVIRONMENT = { chroma: 0.5, lowChroma: 1, hide: 0.6, lowHide: 0.4, sunHide: 0.15 };

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
  // places: landmarks, and their collision merged in before the walker reads it.
  const places = createPlaces(land, seed, { light, shared: land.userData.forestShared });
  forest.obstacles.trunks.push(...places.obstacles.trunks);
  forest.obstacles.domes.push(...places.obstacles.domes);
  forest.obstacles.blockers = places.blockers; // solid: camera and body solids (blockers.js)
  // land-magic: the gifts' light on the land (uniforms in forest.js shared).
  const landMagic = createLandMagic({ shared: land.userData.forestShared, lamps: places.lamps, beacon: places.beacon, light });
  const fauna = createFauna(land, seed);
  const cat = createCat(land, { light });
  const critters = createCritters(land, seed, forest.obstacles.flowers, forest.rocks); // solid: one rock list
  // wildlife: encounters round the shore (see wildlife.js).
  const wildlife = createWildlife(land, seed, { obstacles: forest.obstacles, light });
  forest.obstacles.bodies = wildlife.bodies; // solid: the animals, solid to the cat and the camera
  const wildEye = { x: 0, y: 0, z: 0 };
  const wisp = createWisp(land, { light }); // wisp: drawn from magic.wisp (thread.js follows it)
  // boat: the fisherman's boat afloat (boat.js), hidden until its gift wakes.
  const boatPlace = places.layout.find((p) => p.id === "boat");
  const boat = boatPlace ? createBoat(land, { light, shared: land.userData.forestShared, landmark: boatPlace, hull: places.boatHull, seed }) : null;
  scene.add(land);
  const motes = createMotes(scene, seed);
  // land-magic: the milkwood's fireflies (one draw of points, hidden asleep).
  const summitPoi = places.pois.find((q) => q.id === "beacon");
  const fireflies = createFireflies(scene, seed, { light, crown: places.crown, summit: summitPoi ? { x: summitPoi.x, y: groundHeight(summitPoi.x, summitPoi.z), z: summitPoi.z } : null, surface: surfaceOf(forest.obstacles) }); // solid: surface
  let flyPixels = 600, magicScan = 0, starLevel = 0;
  // The distant islands: their own scene and depth range, drawn first.
  const archipelago = createArchipelago(seed, { light });
  // Vignette, rain on the lens, veiling glare and grain, over both layers.
  const lens = createLens();
  renderer.info.autoReset = false;
  const precipitation = createPrecipitation(scene, seed, { light, habitat: forest.habitat, obstacles: forest.obstacles });
  let cloudBeam = 1, cloudTime = -Infinity, cloudKey = "";
  let rainRate = 0;
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
  let environmentTime = -Infinity;
  // Horizon haze toward and away from the sun, unexposed; see updateLighting.
  let hazeToward = [0, 0, 0];
  let hazeAway = [0, 0, 0];
  const prints = cat.prints;
  let interest = null;
  // The first frame's triangle and draw counts go on the canvas for QA.
  let counted = false;
  const perf = new URLSearchParams(window.location.search).has("perf");
  const profiler = createMeshProfiler(renderer, canvas, perf);
  // quality: the render budget's settings for this layer (quality.js).
  let quality = null;
  const drawingBuffer = new THREE.Vector2();

  const sunWorld = new THREE.Vector3(0, 1, 0);
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
    surf: perf ? forest.surf : null,
    obstacles: forest.obstacles,
    // places: the landmarks the cat can find ({ id, title, x, z, r }).
    pois: places.pois,
    places: perf ? places : null, // places: `?perf` QA
    landMagic: perf ? landMagic : null, // land-magic: `?perf` QA
    nightLand: perf ? NIGHT_LAND : null, // land-look: `?perf` tuning
    // land-magic: the lighthouse lamp this frame (coast metres; `angle` is
    // the beams' bearing, see land-magic.js), for the sea's own beam.
    get lamp() { return landMagic.state.lamp; },
    shoreRocks: forest.shoreRocks,
    // `?perf` QA: scales every splash the cat and the surf throw.
    splash: SPLASH,
    landField: forest.landField,
    // `?perf` QA: the distant islands' mesh, camera and light uniforms.
    archipelago,
    lens: perf ? lens : null,
    get weatherSurface() { return precipitation.surface; },
    get cloudTransmission() { return cloudBeam; },
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
    render({ celestial, cover, weather = null, time, wind, rain = 0, view: flight, lighting, pose, dt, weatherDt = dt, reducedMotion = false, paused = false, surface, water = null, onStep, wake = null, skyFlash = 0, magic = null }) {
      const pointer = [0.5, 0.5];
      const night = THREE.MathUtils.smoothstep(celestial.scene, 1, 2);
      forest.updateWind(time, wind);
      forest.updateNight(night);
      land.userData.forestShared.landNightFill.value = night; // land-look: canopy fill by night
      fauna.update(time, wind, night, boat?.afloatNow ?? null); // boat: the pod rides its bow
      // land-magic: the fireflies fly, then every gift's light is set.
      const levels = magic?.levels;
      const flies = fireflies.update({ dt, time, pose, night, level: levels?.fireflies ?? 0, finale: finaleBlaze(magic), call: magic?.call ?? null, eye: camera.position, pixelScale: flyPixels });
      const gifts = landMagic.update({ magic, time, dt, night, pose, flies }); // land-magic:
      starLevel = levels?.stars ?? 0; // land-look: the stars gift lifts the night
      // The cat's coat and the animals take the same light (their
      // materials are built lazily: wrapped at load and once more later).
      if (magicScan < 2400 && magicScan % 300 === 30) lightWithMagic(land, land.userData.forestShared);
      magicScan++;
      places.update({ time, night, wind, eye: [flight.x, flight.y, flight.z], pose, lamp: gifts.lamp, lights: gifts.lampLights }); // places:
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
      const cloudLight = celestial.sun.map((v, i) => v * (1 - night) + celestial.moon[i] * night);
      const cloudNorm = Math.hypot(...cloudLight) || 1;
      const cloudDirection = cloudLight.map(v => v / cloudNorm);
      const beamKey = `${Math.round(flight.x / 3)}:${Math.round(flight.z / 3)}:${cloudDirection.map(v => v.toFixed(2))}:${weather?.low}:${weather?.mid}:${weather?.high}:${cover.toFixed(2)}`;
      if (beamKey !== cloudKey || time - cloudTime >= .25 || time < cloudTime) {
        cloudKey = beamKey; cloudTime = time;
        cloudBeam = weather ? .07 + .93 * cloudTransmission(seed, { ...weather, x: flight.x, y: flight.y, z: flight.z, sun: cloudDirection, wind, time }) : 1 - Math.pow(cover, 1.5) * .93;
      }
      rainRate = rain;
      updateLighting(celestial, cover, lighting, cloudBeam);
      // sky-events: a lightning flash is a brief, bright sky over the land
      // (skyFlash: skylight gain from sky-events.js). Scales the sky light
      // only; nothing is rebuilt.
      if (skyFlash > 0) {
        scene.environmentIntensity *= 1 + skyFlash;
        forest.updateSkySH(skySH.coefficients, Math.max(lighting.exposure, 1e-6) * (1 + skyFlash));
        CAT_SKY.value.multiplyScalar(1 + skyFlash);
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
      // lod: vegetation detail by each instance's distance (quality: bias).
      forest.updateLod(camera.position, quality?.lodBias ?? 1);
      boat?.render({ time, night, camera }); // boat: before the cat (its lantern lights it)
      const far = archipelago.camera;
      far.position.copy(camera.position);
      far.quaternion.copy(camera.quaternion);
      far.updateMatrixWorld();
      precipitation.update({ dt: weatherDt, rain, wind, camera, reducedMotion, paused,
        brightness: Math.max(...lighting.sky) + Math.max(...lighting.direct) * cloudBeam * .2 });
      forest.updateWeather?.(precipitation.surface);
      // Leaf translucency and glints follow the light in view space (their
      // strength is the shadowed sun's own, from three's light loop).
      sunView.copy(sunWorld).transformDirection(camera.matrixWorldInverse);
      forest.updateSun(sunView);
      // Pixels per metre at one metre: how big things are on screen.
      const pixelScale = renderer.domElement.height / (2 * Math.tan((camera.fov * Math.PI) / 360));
      flyPixels = pixelScale; // land-magic:
      cat.update(pose, dt, time, surface, onStep, {
        night,
        direct: THREE.MathUtils.smoothstep(sunWorld.y, 0, 0.3) * cloudBeam,
        sun: sunWorld,
        sunX: sunWorld.x,
        sunZ: -sunWorld.z,
        eye: camera.position,
        pixelScale,
        wind,
        rain,
        lamp: boat?.catLamp ?? null, // boat:
      }, wake);
      if (wake) forest.updateCatWater(wake.paws, wake.body.flow);
      if (water) forest.updateSurf(time, [flight.x, flight.y, flight.z], pixelScale, water);
      // Plants part round the cat as it walks through them.
      forest.pushAt(pose.x, pose.z, pose.air > 0.05 ? 0 : 1);
      interest = critters.update(dt, time, pose, night);
      // wildlife: update, and the nearer of a critter and an animal holds the cat's eye.
      wildEye.x = flight.x; wildEye.y = flight.y; wildEye.z = flight.z;
      const wild = wildlife.update({ dt, time, night, wind, pose, water, eye: wildEye });
      if (wild && (!interest || wild.d < Math.hypot(interest.x - pose.x, interest.z - pose.z))) interest = wild;
      // Motes glow only in daylight, dimmed by cloud like the direct sun.
      moteLight.copy(sun.color).multiplyScalar(sun.intensity * THREE.MathUtils.smoothstep(sunWorld.y, 0.0, 0.1) * (1 - night));
      motes.update(time, wind, camera.position, sunWorld, moteLight, pixelScale);
      wisp.update(time, night, renderer.domElement.height); // wisp:
      lens.update({
        camera, time, rain, wind, sky: lighting.sky, sunDirection: sunWorld, sunColour: sun.color,
        sunVisible: cloudBeam * THREE.MathUtils.smoothstep(sunWorld.y, -0.01, 0.06) * (1 - night),
        width: renderer.domElement.width, height: renderer.domElement.height,
      });
      profiler.render(() => {
        renderer.info.reset();
        cat.renderShadow(renderer, scene);
        // Islands kilometres out, then the near scene over them with a
        // fresh depth buffer: each gets the whole depth precision.
        renderer.render(archipelago.scene, far);
        renderer.autoClear = false;
        renderer.clearDepth();
        renderer.render(scene, camera);
        renderer.render(lens.scene, camera);
        renderer.autoClear = true;
      });
      if (!counted) {
        counted = true;
        canvas.dataset.triangles = String(renderer.info.render.triangles);
        canvas.dataset.drawCalls = String(renderer.info.render.calls);
      }
    },
    get interest() {
      return interest;
    },
    // wildlife: { pois, events (refilled each frame), modules, timing }.
    wildlife,
    // wisp: wisp.follow(magic.wisp, walker.surface) once (thread.js).
    wisp,
    boat, // boat: attach({ walker, sea, magic, wake }) once (main.js)
    addPrint(print) {
      prints.add(print);
    },
    catLanded(time, strength, kind, surface) {
      cat.land(time, strength, kind, surface);
    },
    catSplashed(time, strength, level) {
      cat.splash(time, strength, level);
    },
    // quality: the mesh layer's GPU time (ms, null where unmeasurable).
    get gpuMs() {
      return profiler.gpuMs;
    },
    // quality: `width`/`height` are the CSS size (the camera's aspect);
    // `pixels` ([w, h]) is the render size quality.js decided.
    resize(width, height, [w, h]) {
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      archipelago.camera.fov = camera.fov;
      archipelago.camera.aspect = camera.aspect;
      archipelago.camera.updateProjectionMatrix();
      const size = renderer.getDrawingBufferSize(drawingBuffer);
      if (size.x !== w || size.y !== h) renderer.setSize(w, h, false);
      archipelago.uniforms.pixelAngle.value = 1 / (0.9 * h);
    },
    // quality: this level's settings (quality.js baseSettings).
    setQuality(settings) {
      quality = settings;
    },
    dispose() {
      profiler.dispose();
      // The cat owns render targets (its shadow map, the coat bakes) and a
      // build worker the scene traversal below cannot reach.
      cat.dispose();
      places.dispose(); // places:
      fireflies.dispose(); // land-magic:
      boat?.dispose(); // boat:
      wildlife.dispose();
      precipitation.dispose();
      archipelago.geometry.dispose();
      archipelago.material.dispose();
      lens.dispose();
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
      envTarget?.dispose();
      envSource.dispose();
      pmrem.dispose();
      renderer.dispose();
    },
  };

  function updateDirection(celestial) {
    const night = THREE.MathUtils.smoothstep(celestial.scene, 1, 2);
    // land-look: by night the key light is the moon; with the moon down or
    // low it is the glow of the sky on the moon's side, from at least ~25°
    // up, so the land keeps lit planes and shadowed ones instead of going
    // flat black.
    const moon = new THREE.Vector3(...celestial.moon);
    if (moon.y < 0.42) moon.y = 0.42 + (moon.y - 0.42) * 0.15;
    const direction = new THREE.Vector3(...celestial.sun)
      .lerp(moon.normalize(), night)
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
  function updateLighting(celestial, cover, lighting, beam) {
    const [r, g, b] = lighting.direct;
    const peak = Math.max(r, g, b, 1e-6);
    // Heavy cloud all but removes direct sun (and its shadows).
    const overcast = beam;
    sun.color.setRGB(r / peak, g / peak, b / peak);
    sun.intensity = peak * overcast;
    const night = THREE.MathUtils.smoothstep(celestial.scene, 1, 2);
    // land-look: night on land. The sky and sea passes give the night
    // tone; the land, lit only by the physical moon and the airglow floor,
    // went flat black. A dark-adapted eye sees a moonless beach as shapes
    // in deep blue: a cool key from the sky's bright side (the moon when it
    // is up, stronger the fuller it is), and the dome's fill lifted, more
    // when the beacon's gift (`stars`) is awake. Still night: values stay
    // in the rods' range, where the tonemap turns them blue.
    const moonUp = THREE.MathUtils.smoothstep(celestial.moon[1], -0.02, 0.15);
    const moonLit = 0.5 - 0.5 * Math.cos((celestial.moonPhase ?? 0.5) * Math.PI * 2);
    const starLift = 1 + 0.7 * starLevel;
    const nightKey = night * (NIGHT_LAND.key + NIGHT_LAND.moon * moonUp * moonLit) * starLift * (1 - 0.6 * cover);
    if (nightKey > sun.intensity) {
      const k = sun.intensity / nightKey;
      sun.color.lerp(MOON_KEY, 1 - k);
      sun.intensity = nightKey;
    }
    const nightFill = 1 + night * NIGHT_LAND.fill * starLift;
    // At night the moon/night floor in lighting.sky is already the whole
    // story, and an overcast dome is near uniform (brighter overhead).
    // land-look: even under a full deck the sky is brighter on the sun's
    // side, so the land keeps a direction to its light.
    const uniform = Math.max(night, cover * 0.72);
    // land-look: aerial perspective at the island's own scale. In clear air
    // the hill across the island holds its colour; under cloud, at dusk and
    // in rain the air thickens, so the far slopes fall back into the haze
    // and the foreground stands in front of them. Thin by night, where the
    // haze is dark and would only blacken the far land.
    const dusk = (1 - THREE.MathUtils.smoothstep(celestial.sun[1], 0.02, 0.25)) * (1 - night);
    scene.fog.density = (0.0042 + 0.0058 * THREE.MathUtils.smoothstep(cover, 0.35, 1) + 0.0025 * dusk + Math.min(rainRate, 6) * 0.0007) * (1 - 0.35 * night);
    // The environment is baked at unit exposure; environmentIntensity carries
    // the eye's adaptation frame to frame, so it is rebuilt only when the sun,
    // weather or night changes, not as exposure drifts.
    const exposure = Math.max(lighting.exposure, 1e-6);
    // Night vision (by moonlight the eye sees with rods, colour fades to a
    // blue-grey) and the overcast white balance: the tonemap reads both from
    // the exposure uniform (tone.wgsl).
    renderer.toneMappingExposure = 1 + toneAdapt(night, cover);
    scene.environmentIntensity = exposure * nightFill;
    const mean = skyDomeMean(domeRatio, envWidth, uniform);
    const sky = lighting.sky.map((v, i) => v * mean[i] * (1 + cover * 0.45));
    // Ground bounce: the island's mean albedo (sand, soil and leaves) under
    // sun and sky, at its true brightness relative to the sky, so undersides
    // stay darker than tops instead of being lifted to match them.
    const bounce = lighting.direct.map(
      (v, i) => (v * Math.max(sunWorld.y, 0) * overcast / Math.PI + sky[i]) * [0.21, 0.2, 0.165][i],
    );
    // Only incident light invalidates PMREM/SH. Camera shadow anchors do not.
    const skyUnit = lighting.sky.map((v) => (v * (1 + cover * 0.45)) / exposure);
    const bounceUnit = bounce.map((v) => v / exposure);
    const key = skyEnvironmentKey(domeKey, uniform, skyUnit, bounceUnit);
    const now = performance.now();
    if (key !== environmentKey && domeRatio && now - environmentTime >= 250) {
      environmentKey = key;
      environmentTime = now;
      buildEnvironment(skyUnit, bounceUnit, uniform, celestial.sun, night);
    }
    forest.updateSkySH(skySH.coefficients, exposure * nightFill);
    CAT_SKY.value.setRGB(sky[0] * Math.PI, sky[1] * Math.PI, sky[2] * Math.PI).multiplyScalar(nightFill);
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
    const isles = archipelago.uniforms;
    isles.sunDirection.value.copy(sunWorld);
    isles.sunLight.value.copy(sun.color).multiplyScalar(sun.intensity);
    isles.skyLight.value.setRGB(...sky);
    isles.bounceLight.value.setRGB(...bounce);
    // Under a deck the horizon behind the islands is the cloud's grey
    // underside, not the clear-sky haze: dim their veil to match.
    const veil = (1 - 0.6 * THREE.MathUtils.smoothstep(cover, 0.5, 1)) * (1 - 0.3 * Math.min(1, rainRate / 4));
    isles.hazeToward.value.setRGB(...toward).multiplyScalar(veil);
    isles.hazeAway.value.setRGB(...away).multiplyScalar(veil);
    // Clear maritime air (~50 km visibility, blue fading first); cloud and
    // rain close it in to a few kilometres.
    const thick = 1 + 3 * THREE.MathUtils.smoothstep(cover, 0.4, 1) + Math.min(rainRate, 8) * 1.2;
    isles.extinction.value.set(5e-5 * thick, 6e-5 * thick, 8e-5 * thick);
    scene.fog.color.setRGB((toward[0] + away[0]) / 2, (toward[1] + away[1]) / 2, (toward[2] + away[2]) / 2);
  }

  // Sky above the horizon from the dome ratio (CIE overcast when cloudy or
  // at night), ground bounce below it, joined through a thin horizon band.
  function buildEnvironment(sky, bounce, uniform, sunDirection, night) {
    const width = envWidth;
    const height = width / 2;
    const rows = width / 4;
    const half = THREE.DataUtils.toHalfFloat;
    skySH.zero();
    const cell = ((Math.PI * 2) / width) * (Math.PI / height);
    // land-look: with the sun low the sky is the light. Below ~25° its
    // colour reaches the land: the sunset's peach and the Belt of Venus's
    // mauve on sand and rock, shade turning blue-violet. With the sun high
    // the dome keeps half its chroma, so noon shade stays blue-grey, not cyan.
    const [sx, sy, sz] = sunDirection;
    const low = (1 - THREE.MathUtils.smoothstep(sy, 0.17, 0.42)) * (1 - night);
    const chroma = ENVIRONMENT.chroma + (ENVIRONMENT.lowChroma - ENVIRONMENT.chroma) * low;
    // The sun's bearing in this map's frame (see updateDirection).
    const sunX = (sx + sz) * Math.SQRT1_2;
    const sunZ = (sx - sz) * Math.SQRT1_2;
    const sunFlat = Math.hypot(sunX, sunZ) || 1;
    for (let j = 0; j < height; j++) {
      const elevation = ((j + 0.5) / height - 0.5) * Math.PI;
      const up = Math.sin(elevation);
      const cie = (1 + 2 * Math.max(up, 0)) / 3 / (7 / 9);
      const skyRow = Math.min(rows - 1, Math.max(0, j - rows));
      // Below the horizon the ground (and sea) returns bounce light; within
      // a few degrees it is still mostly the hazy horizon sky.
      const ground = THREE.MathUtils.smoothstep(-up, 0.0, 0.12);
      // The land never sees the whole sky: trees, dunes and the hill fill
      // the lowest 20° of it on average, returning their own bounce light.
      // A statistical local horizon (vertical walls see 0.64 of the open sky
      // instead of 0.8), so shade is not lit as if on an open plain.
      const hideRow = up > 0 ? 1 - THREE.MathUtils.smoothstep(up, 0, 0.34) : 0;
      const across = Math.cos(elevation);
      const rgb = [0, 0, 0];
      for (let i = 0; i < width; i++) {
        const k = (skyRow * width + i) * 3;
        const o = (j * width + i) * 4;
        const phi = ((i + 0.5) / width - 0.5) * Math.PI * 2;
        shDirection.set(Math.cos(phi) * across, up, Math.sin(phi) * across);
        THREE.SphericalHarmonics3.getBasisAt(shDirection, shBasis);
        // land-look: with the sun low the sky is most of the light, and
        // the land opens onto it: shade takes the blue-violet of the sky
        // overhead and the Belt of Venus, and toward the sun the bright,
        // warm horizon (where the light comes from) is barely hidden.
        const sunward = THREE.MathUtils.smoothstep((Math.cos(phi) * sunX + Math.sin(phi) * sunZ) / sunFlat, 0, 0.6);
        const lowHide = ENVIRONMENT.lowHide + (ENVIRONMENT.sunHide - ENVIRONMENT.lowHide) * sunward;
        const hide = hideRow * (ENVIRONMENT.hide + (lowHide - ENVIRONMENT.hide) * low);
        for (let c = 0; c < 3; c++) {
          const sky1 = sky[c] * (domeRatio[k + c] * (1 - uniform) + cie * uniform);
          const seen = sky1 + (bounce[c] * 1.2 - sky1) * hide;
          rgb[c] = seen + (bounce[c] - seen) * ground;
        }
        // Shade lit by a blue sky reads blue in a photograph, but not the
        // saturated cyan of the raw dome: part of its chroma, about luminance.
        const luma = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
        for (let c = 0; c < 3; c++) {
          const radiance = luma + (rgb[c] - luma) * chroma;
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
