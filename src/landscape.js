import * as THREE from "three";
import { createForest, groundAnimals } from "./forest.js";
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
import { WAKE_LIGHT, wakingSource } from "./waking.js"; // waking:
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
// grade: more key, less fill, at about the same overall level. With the
// fill six times the dome the night beach was one even grey-blue: a rock
// had no lit side. Moonlight is directional (a crescent still throws
// shadows a dark-adapted eye reads); the fill keeps the shade blue, not
// black.
const NIGHT_LAND = { key: 0.25, moon: 0.3, fill: 4.5 };
const MOON_KEY = new THREE.Color(0.62, 0.74, 1.0);
// land-look: the sky dome as the land's ambient (buildEnvironment): how much
// of its chroma reaches the land with the sun high and with it low, and how
// much of the lowest sky the trees and hill hide: by day, with the sun low,
// and toward a low sun. Low-sun chroma is above the clear-sky model's own
// (1.35), and its blues lean violet (`violet`): together they carry what
// the clear-sky model leaves out (the sunset-lit clouds, the ozone-violet
// zenith, a camera's daylight white balance), which is why open shade
// photographs blue-violet and wet sand peach at golden hour.
const ENVIRONMENT = { chroma: 0.5, lowChroma: 1.35, violet: 0.3, hide: 0.6, lowHide: 0.25, sunHide: 0.05 };
// grade: the blue hour's white balance on the sky light, unit luminance
// (see buildEnvironment).
const TWILIGHT_TINT = [0.797, 1.036, 1.245];

// Geometry shares the sky shader's 315° heading, 6° pitch, and projection.
// WebGL handles mesh depth/shadows; WebGPU handles the sky and water behind it.
// `light` budgets (phones): no MSAA, a smaller shadow map.
export function createLandscape(canvas, seed, { light = false } = {}) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    // msaa: the canvas itself is single-sampled; the scene renders into a
    // multisampled framebuffer whose sample count the render budget sets
    // (quality.js msaa), resolved onto the canvas by one blit.
    antialias: false,
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
  // land-look: the ground darkens round the landmarks' feet (forest.js).
  forest.groundContact(land, [places.group]);
  // land-magic: the gifts' light on the land (uniforms in forest.js shared).
  // waking: each keepsake's small steady light, what its waking resolves
  // into (waking-light.md 3.7): the furnace ember and the pool lit from below.
  // (The milkwood's is its crown; the lamp's, the lamps and beams; the boat's,
  // its own lantern, which leaves the logs with the hull.)
  const practicals = [
    ["tideglow", WAKE_LIGHT.tideglow.tint, 1.6, 0.35],
    ["seafolk", WAKE_LIGHT.seafolk.tint, 2.2, 0.45],
  ].map(([gift, colour, reach, power]) => {
    const at = wakingSource(gift, { pois: places.pois, blockers: places.blockers, anchors: places.wakingAnchors, surface: gift === "seafolk" ? surfaceOf(forest.obstacles) : groundHeight });
    return at && { x: at[0], y: at[1] + (gift === "seafolk" ? 0.25 : 0), z: at[2], colour, reach, power, gift };
  }).filter(Boolean);
  const landMagic = createLandMagic({ shared: land.userData.forestShared, lamps: places.lamps, practicals, beacon: places.beacon, light });
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
  // perf: the cat's shadow pass (cat.js) renders this scene with a camera
  // on its own layer (3). Seeing no light there, three bumped its light
  // state twice a frame, which re-resolved every lit material's program
  // (parameters and cache key, ~70 materials) in the main pass. On that
  // layer too, the sun keeps the light state the same in both passes.
  sun.layers.enable(3);
  scene.add(sun, sun.target);
  let previousLighting = "";
  // shadow: the sun's map is refreshed a slice of its casters per frame
  // (quality.js shadowSlices) into a back map, which replaces the front
  // one when it is whole; until then the front map and its matrix stay in
  // use, so a refresh never shows half the casters, and never costs a
  // frame the whole caster set (about a million triangles). A jump (home,
  // a teleport) or the first frame renders it at once.
  const drawShadows = renderer.shadowMap.render.bind(renderer.shadowMap);
  renderer.shadowMap.render = (lights, target, eye) => {
    // The cat's own shadow pass renders this scene too: a slice belongs to
    // the frame's main render only, or two run in one frame.
    if (target !== scene || !shadows.pending || shadows.catPass) return drawShadows(lights, target, eye);
    renderShadowSlice(() => drawShadows(lights, target, eye));
  };
  const shadows = { key: "", anchor: null, pending: false, again: false, jump: false, catPass: false, slice: 0, count: 1, casters: [], cast: [], back: null, light: new THREE.Vector3(), target: new THREE.Vector3(), centre: [0, 0], matrix: new THREE.Matrix4() };
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
  const msaa = createMsaa(renderer);

  const sunWorld = new THREE.Vector3(0, 1, 0);
  const sunView = new THREE.Vector3();
  const lookDirection = new THREE.Vector3();
  const lookRight = new THREE.Vector3();
  const lookUp = new THREE.Vector3();
  const lookTarget = new THREE.Vector3();
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  // perf: frozen matrices. The scene root and the island group never move,
  // nor do the vegetation chunks or anything else flagged
  // `userData.static`: their matrices are composed once, and the per-frame
  // world update stops at each of them instead of re-composing and walking
  // thousands of objects (three re-composes every auto-updating matrix,
  // and a parent that did forces its whole subtree). Moving things (the
  // cat, animals, the boat, the wisp) keep updating as before, under a
  // parent whose world matrix simply no longer changes.
  for (const chunk of land.userData.lodChunks ?? []) for (const mesh of chunk.meshes) if (mesh) mesh.userData.static = true;
  const frozen = freezeStatic(scene, land);
  if (perf) canvas.dataset.frozen = String(frozen);

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
    // waking: the places a gift's light is kindled from (waking.js wakingSource).
    wakingPlaces: { crown: places.crown, beacon: places.beacon, anchors: places.wakingAnchors },
    nightLand: perf ? NIGHT_LAND : null, // land-look: `?perf` tuning
    shadows: perf ? shadows : null, // shadow: `?perf` QA of the sliced refresh
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
    // hitch: compile every program the land layer can draw, sleeping
    // gifts' and hidden levels' included, ahead of their first frame (a
    // gift's first waking compiled 9 programs mid-frame). Hidden meshes
    // are shown only for the compile's traversal; lights are left alone
    // (their count is part of every program).
    prewarm() {
      const hidden = [];
      scene.traverse((o) => {
        if (!o.visible && !o.isLight) {
          hidden.push(o);
          o.visible = true;
        }
      });
      let done;
      try {
        done = renderer.compileAsync ? renderer.compileAsync(scene, camera) : Promise.resolve(renderer.compile(scene, camera));
      } finally {
        for (const o of hidden) o.visible = false;
      }
      return done;
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
      const flies = fireflies.update({ dt, time, pose, night, level: levels?.fireflies ?? 0, finale: finaleBlaze(magic), call: magic?.call ?? null, eye: camera.position, pixelScale: flyPixels, born: magic?.waking?.gift === "fireflies" ? magic.waking : null }); // waking: out of the hollow
      const gifts = landMagic.update({ magic, time, dt, night, pose, flies, reduced: reducedMotion, afloat: Boolean(boat?.afloatNow) }); // land-magic: (waking: reduced motion, the boat afloat)
      starLevel = levels?.stars ?? 0; // land-look: the stars gift lifts the night
      // The cat's coat and the animals take the same light (their
      // materials are built lazily: wrapped at load and once more later).
      if (magicScan < 2400 && magicScan % 300 === 30) {
        lightWithMagic(land, land.userData.forestShared);
        groundAnimals(land, land.userData.forestShared); // land-look: animals sit in the ground
      }
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
        // shadow: the map is re-rendered only when what it holds moves: the
        // light's direction (to ~0.3°) or the anchor, not the sun's colour,
        // the twilight scene or cloud cover.
        const shadowKey = `${Math.round(sunWorld.x * 200)}:${Math.round(sunWorld.y * 200)}:${Math.round(sunWorld.z * 200)}:${anchorX}:${anchorZ}`;
        if (shadowKey !== shadows.key) {
          const jump = !shadows.anchor || Math.hypot(anchorX - shadows.anchor[0], anchorZ - shadows.anchor[1]) > 20;
          shadows.key = shadowKey;
          shadows.anchor = [anchorX, anchorZ];
          requestShadow(jump);
        }
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
      forest.pushAt(pose.x, pose.z, pose.air > 0.05 ? 0 : 1, pose.y); // move: (y aims the line of sight)
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
        shadows.catPass = true;
        try { cat.renderShadow(renderer, scene); } finally { shadows.catPass = false; }
        // Islands kilometres out, then the near scene over them with a
        // fresh depth buffer: each gets the whole depth precision. Both
        // into the multisampled buffer (msaa), resolved onto the canvas;
        // the lens is a full-screen pass with no edges to antialias.
        renderer.setRenderTarget(msaa.target);
        renderer.render(archipelago.scene, far);
        renderer.autoClear = false;
        renderer.clearDepth();
        renderer.render(scene, camera);
        msaa.resolve();
        renderer.setRenderTarget(null);
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
      msaa.set(w, h, quality?.msaa ?? (light ? 0 : 2));
      archipelago.uniforms.pixelAngle.value = 1 / (0.9 * h);
    },
    // quality: this level's settings (quality.js baseSettings).
    setQuality(settings) {
      quality = settings;
      const size = renderer.getDrawingBufferSize(drawingBuffer);
      msaa.set(size.x, size.y, settings.msaa);
    },
    dispose() {
      profiler.dispose();
      msaa.dispose();
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
      shadows.back?.depthTexture?.dispose();
      shadows.back?.dispose();
      envTarget?.dispose();
      envSource.dispose();
      pmrem.dispose();
      renderer.dispose();
    },
  };

  function requestShadow(jump) {
    if (shadows.pending && shadows.slice > 0 && !jump) {
      shadows.again = true;
      return;
    }
    shadows.pending = true;
    shadows.jump = shadows.jump || jump;
    shadows.slice = 0;
  }

  // Called by three inside renderer.render(scene), where its shadow pass
  // runs (before the lights are set up for the colour pass).
  function renderShadowSlice(draw) {
    const shadow = sun.shadow;
    if (shadows.slice === 0) {
      shadows.count = !shadow.map || shadows.jump ? 1 : Math.max(1, quality?.shadowSlices ?? 1);
      shadows.light.copy(sun.position);
      shadows.target.copy(sun.target.position);
      shadows.centre = shadows.anchor;
      shadows.casters.length = 0;
      if (shadows.count > 1) scene.traverse((o) => { if (o.castShadow && (o.isMesh || o.isLine || o.isPoints)) shadows.casters.push(o); });
    }
    const { count, slice, casters } = shadows;
    // Render with the light where this refresh began.
    const lightNow = sun.position.clone(), targetNow = sun.target.position.clone();
    sun.position.copy(shadows.light);
    sun.target.position.copy(shadows.target);
    sun.updateMatrixWorld();
    sun.target.updateMatrixWorld();
    const front = shadow.map;
    if (count > 1) {
      if (!shadows.back) shadows.back = shadowTarget(front);
      shadows.matrix.copy(shadow.matrix);
      shadow.map = shadows.back;
      // Others toggle castShadow too (the cat's own map): restore, never assume.
      for (let i = 0; i < casters.length; i++) {
        shadows.cast[i] = casters[i].castShadow;
        casters[i].castShadow = shadows.cast[i] && i % count === slice;
      }
    }
    const clear = renderer.clear;
    if (slice > 0) renderer.clear = () => {};
    renderer.shadowMap.needsUpdate = true;
    try {
      draw();
    } finally {
      renderer.clear = clear;
      if (count > 1) for (let i = 0; i < casters.length; i++) casters[i].castShadow = shadows.cast[i];
      sun.position.copy(lightNow);
      sun.target.position.copy(targetNow);
      sun.updateMatrixWorld();
      sun.target.updateMatrixWorld();
    }
    shadows.slice++;
    if (shadows.slice < count) {
      // Not whole yet: draw this frame with the front map.
      shadow.map = front;
      shadow.matrix.copy(shadows.matrix);
      return;
    }
    if (count > 1) shadows.back = front;
    forest.updateShadowCentre(shadows.centre[0], shadows.centre[1]);
    shadows.slice = 0;
    shadows.jump = false;
    shadows.pending = shadows.again;
    shadows.again = false;
  }

  // A second map like three's own (depth, compared, filtered), to render into.
  function shadowTarget(like) {
    const size = like.width;
    const target = new THREE.WebGLRenderTarget(size, size);
    target.depthTexture = new THREE.DepthTexture(size, size, THREE.UnsignedIntType);
    target.depthTexture.format = THREE.DepthFormat;
    target.depthTexture.compareFunction = like.depthTexture.compareFunction;
    target.depthTexture.minFilter = like.depthTexture.minFilter;
    target.depthTexture.magFilter = like.depthTexture.magFilter;
    target.depthTexture.name = like.depthTexture.name;
    return target;
  }

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
      buildEnvironment(skyUnit, bounceUnit, uniform, celestial.sun, night, cover);
    }
    forest.updateSkySH(skySH.coefficients, exposure * nightFill);
    CAT_SKY.value.setRGB(sky[0] * Math.PI, sky[1] * Math.PI, sky[2] * Math.PI).multiplyScalar(nightFill);
    const foamLight = lighting.direct.map((v, i) => (v * Math.max(sunWorld.y, 0) * overcast) / Math.PI + sky[i] * 1.1);
    forest.updateFoamLight(foamLight);
    // grade: a crown is a volume: a low sun lights its side as much as a
    // high one lights its top, so the light that filters through to the
    // floor holds up into the golden hour (forest.js occlusionGlsl).
    forest.updateCanopyLight(lighting.direct.map((v, i) => (v * (0.35 + 0.65 * Math.max(sunWorld.y, 0)) * overcast) / Math.PI + sky[i]));
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
  function buildEnvironment(sky, bounce, uniform, sunDirection, night, cover = 0) {
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
    // grade: civil twilight is the blue hour. Once the sun is a few
    // degrees down, the light on the land is the deep, ozone-blue dome
    // (measured twilight irradiance runs 9000-12000 K); the single-
    // scattering model leaves that blue out and its sunset band, pushed
    // by the low-sun chroma, turned the whole island maroon at dusk.
    const twilight = THREE.MathUtils.smoothstep(-sy, 0.01, 0.08) * (1 - night);
    const chroma = (ENVIRONMENT.chroma + (ENVIRONMENT.lowChroma - ENVIRONMENT.chroma) * low) * (1 - 0.3 * twilight);
    const blueHour = TWILIGHT_TINT.map((t) => 1 + (t - 1) * twilight);
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
          // grade: under cloud the clear dome's blaze round a low sun (up
          // to 12x the zenith) is behind the deck: keep its direction, not
          // its hot spot. Even at 28% it mirrored in the wet sand as a
          // saturated gold band beside a grey sea.
          const clearRatio = domeRatio[k + c] / (1 + Math.max(domeRatio[k + c] - 1, 0) * cover * 0.6);
          const sky1 = sky[c] * (clearRatio * (1 - uniform) + cie * uniform);
          const seen = sky1 + (bounce[c] * 1.2 - sky1) * hide;
          rgb[c] = seen + (bounce[c] - seen) * ground;
        }
        // Shade lit by a blue sky reads blue in a photograph, but not the
        // saturated cyan of the raw dome: part of its chroma, about luminance.
        for (let c = 0; c < 3; c++) rgb[c] *= blueHour[c];
        const luma = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
        // Blue sky toward violet with the sun low: red lifted by the blue
        // excess, green lowered to keep the luminance.
        // (Less of it in the blue hour: the model's twilight is short of green
        // already, and the lean pushed it magenta.)
        const lean = Math.max(rgb[2] - luma, 0) * ENVIRONMENT.violet * low * (1 - 0.6 * twilight);
        rgb[0] += lean;
        rgb[1] -= (lean * 0.2126) / 0.7152;
        for (let c = 0; c < 3; c++) {
          const radiance = Math.max(0, luma + (rgb[c] - luma) * chroma);
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

// Freezes the roots' own matrices, and every object under them flagged
// `userData.static` with its whole subtree: composed now, never again, and
// skipped by the per-frame world update unless something marks it
// (`matrixWorldNeedsUpdate`) or a frozen root is moved and updated by hand.
// Returns how many objects were frozen.
export function freezeStatic(...roots) {
  let count = 0;
  const freeze = (object) => {
    object.traverse((o) => {
      o.updateMatrix();
      o.matrixAutoUpdate = false;
      count++;
    });
    object.updateMatrixWorld = frozenMatrixWorld;
  };
  for (const root of roots) {
    root.updateMatrix();
    root.matrixAutoUpdate = false;
    root.updateMatrixWorld(true);
  }
  for (const root of roots)
    root.traverse((o) => {
      if (o.userData.static && o.updateMatrixWorld !== frozenMatrixWorld) freeze(o);
    });
  return count;
}

function frozenMatrixWorld(force) {
  if (this.matrixWorldNeedsUpdate || force) THREE.Object3D.prototype.updateMatrixWorld.call(this, true);
}

// msaa: a multisampled colour + depth/stencil framebuffer that three renders
// into as an externally managed target (so it never resolves it itself),
// resolved straight onto the single-sampled canvas by one blit. `target` is
// null (render to the canvas) when the sample count is 0. The target is
// flagged as XR so three applies tone mapping and sRGB output to it, as it
// does for the canvas.
function createMsaa(renderer) {
  const gl = renderer.getContext();
  const most = gl.getParameter(gl.MAX_SAMPLES);
  const state = { target: null, fbo: null, colour: null, depth: null, width: 0, height: 0, samples: 0 };
  const release = () => {
    if (state.fbo) gl.deleteFramebuffer(state.fbo);
    if (state.colour) gl.deleteRenderbuffer(state.colour);
    if (state.depth) gl.deleteRenderbuffer(state.depth);
    state.fbo = state.colour = state.depth = null;
    state.target?.dispose();
    state.target = null;
  };
  return {
    get target() {
      return state.target;
    },
    set(width, height, samples) {
      samples = Math.min(samples, most);
      if (width === state.width && height === state.height && samples === state.samples) return;
      release();
      state.width = width;
      state.height = height;
      state.samples = samples;
      if (!samples) return;
      const storage = (format) => {
        const buffer = gl.createRenderbuffer();
        gl.bindRenderbuffer(gl.RENDERBUFFER, buffer);
        gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, format, width, height);
        return buffer;
      };
      state.colour = storage(gl.RGBA8);
      state.depth = storage(gl.DEPTH24_STENCIL8);
      gl.bindRenderbuffer(gl.RENDERBUFFER, null);
      state.fbo = gl.createFramebuffer();
      renderer.state.bindFramebuffer(gl.FRAMEBUFFER, state.fbo);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, state.colour);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT, gl.RENDERBUFFER, state.depth);
      renderer.state.bindFramebuffer(gl.FRAMEBUFFER, null);
      const target = new THREE.WebGLRenderTarget(width, height, { depthBuffer: true, stencilBuffer: true });
      target.texture.colorSpace = THREE.SRGBColorSpace;
      target.isXRRenderTarget = true;
      renderer.setRenderTargetFramebuffer(target, state.fbo);
      state.target = target;
    },
    // Resolves the samples onto the canvas (call with the target bound).
    resolve() {
      if (!state.target) return;
      const { width, height } = state;
      renderer.state.setScissorTest(false);
      renderer.state.bindFramebuffer(gl.READ_FRAMEBUFFER, state.fbo);
      renderer.state.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
      gl.blitFramebuffer(0, 0, width, height, 0, 0, width, height, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      renderer.state.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    },
    dispose: release,
  };
}
