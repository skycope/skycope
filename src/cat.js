import * as THREE from "three";
import { CAT_SCALE, PAW_LIFT, STAND_HEIGHT, TAIL_BONES, TAIL_LENGTH, TAIL_ROOT, createRig, neutralFoot, solveLeg } from "./cat-rig.js";
import { buildCatGeometry } from "./cat-body.js";
import { bakeShellColours, catUniforms, coatMaterial, ghostMaterial, CAT_SEA } from "./cat-coat.js";
import { createContactShadow, createDust, createPawPrints } from "./cat-ground.js";

// A brown mackerel tabby. One seamless skinned body (cat-body.js) on a
// skeleton with a flexing spine, rolling shoulder blades, three-bone legs,
// a hinged jaw, swivelling ears and a jointed tail (cat-rig.js), a coat lit
// as fur with instanced shells (cat-coat.js), and its shadow, prints and
// kicked-up sand on the ground (cat-ground.js).
//
// The cat lives in coast metres inside the z-mirrored land group. Its local
// +z is forward, +y up; rotation.y is the coast heading φ (forward = sin φ,
// cos φ in coast x, z). Body-frame distances are cat-sized and scaled by
// CAT_SCALE; everything on the ground is in coast metres.
//
// Draws: the coat, one instanced draw for all fur shells, the see-through
// silhouette, whiskers, the cat's shadow map, its ground shadow, prints and
// sand: eight in all (the old cat took ~63).

const S = CAT_SCALE;
const SHADOW_LAYER = 3;
// Gait phase offsets: a lateral-sequence walk (LH, LF, RH, RF), a trot
// (diagonal pairs together) and a rotary gallop (pairs landing close).
const WALK = { lh: 0, lf: 0.25, rh: 0.5, rf: 0.75 };
const TROT = { lh: 0, rf: 1.0, rh: 0.5, lf: 0.5 };
const GALLOP = { lh: 0, rh: 0.1, lf: 0.5, rf: 0.6 };
// Swimming: a dog paddle in diagonal pairs, as swimming quadrupeds use.
const PADDLE = { lf: 0, rh: 0.08, rf: 0.5, lh: 0.58 };
// Postures (body frame, before scaling): the height of the mid-back over
// the ground, the body's pitch, and where the paws rest [x, z].
const POSTURE = {
  stand: { height: STAND_HEIGHT, pitch: 0 },
  // Sitting: haunches on the ground, front legs straight, ~40° up.
  sit: { height: 0.145, pitch: 0.72, front: [0.02, 0.1], hind: [0.042, 0.045] },
  // Loaf: belly down, paws tucked.
  lie: { height: 0.082, pitch: 0.03, front: [0.022, 0.13], hind: [0.045, -0.07] },
  // Stalking: low, the rump a touch higher than the shoulders.
  crouch: { height: 0.15, pitch: -0.07 },
};
const lerp = THREE.MathUtils.lerp;
const smooth = THREE.MathUtils.smoothstep;
const clamp = THREE.MathUtils.clamp;

export function createCat(parent, { light = false, sync = typeof Worker === "undefined" } = {}) {
  const uniforms = catUniforms();
  const rig = createRig();
  // Bone inverses from the bind pose, before anything moves.
  const skeleton = new THREE.Skeleton(rig.list);
  const b = rig.bones;
  const bind = Object.fromEntries(rig.list.map((bone) => [bone.name, bone.position.clone()]));
  // Proportions tuned after binding: a cat's head and paws are big for
  // its body.
  b.head.scale.setScalar(1.1);
  for (const leg of rig.legs) leg.paw.scale.setScalar(1.05);

  const root = new THREE.Group();
  root.name = "cat";
  root.rotation.order = "YXZ";
  root.scale.setScalar(S);
  root.add(rig.root);
  parent.add(root);

  const coat = coatMaterial(uniforms);
  const coatFar = coatMaterial(uniforms, { baked: true });
  const fur = coatMaterial(uniforms, { shell: true });
  const ghost = ghostMaterial();
  // The cat draws in the transparent pass, after the (fading) ground and
  // rocks, and marks its pixels in the stencil buffer, so the silhouette
  // shows only where something covers it.
  for (const material of [coat, coatFar, fur])
    Object.assign(material, {
      transparent: true,
      stencilWrite: true,
      stencilRef: 1,
      stencilFunc: THREE.AlwaysStencilFunc,
      stencilZPass: THREE.ReplaceStencilOp,
    });
  fur.depthWrite = false;
  const depth = new THREE.MeshDepthMaterial({ side: THREE.DoubleSide });
  const meshes = [];
  let shellGeometry = null;
  const maxShells = light ? 4 : 5;

  let lods = null;
  let baked = null;
  let shadowFrame = 0;
  let shadowKey = "";
  let still = false;
  function attach(geometries) {
    lods = geometries;
    const bindMatrix = new THREE.Matrix4();
    const skinned = (g, material, order) => {
      const mesh = new THREE.SkinnedMesh(g, material);
      mesh.bind(skeleton, bindMatrix);
      mesh.frustumCulled = false;
      mesh.renderOrder = order;
      mesh.receiveShadow = true;
      root.add(mesh);
      meshes.push(mesh);
      return mesh;
    };
    skinned(lods.mid, coat, 10);
    // Shells share the coarse mesh's buffers: under fuzz its sub-mm chord
    // error is invisible, and every shell costs a skinned pass.
    shellGeometry = new THREE.InstancedBufferGeometry();
    shellGeometry.index = lods.far.index;
    for (const [name, attribute] of Object.entries(lods.far.attributes)) shellGeometry.setAttribute(name, attribute);
    shellGeometry.instanceCount = maxShells;
    skinned(shellGeometry, fur, 11);
    skinned(lods.far, ghost, 20).receiveShadow = false;
    // The shadow map sees only this coarse copy.
    const caster = skinned(lods.far, depth, 0);
    caster.layers.set(SHADOW_LAYER);
  }
  const toGeometry = ({ attributes, index }) => {
    const geometry = new THREE.BufferGeometry();
    for (const [name, { array, itemSize }] of Object.entries(attributes)) geometry.setAttribute(name, new THREE.BufferAttribute(array, itemSize));
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
    geometry.computeBoundingSphere();
    return geometry;
  };
  if (sync) attach(buildCatGeometry(createRig(), { light }));
  else {
    const worker = new Worker(new URL("./cat-worker.js", import.meta.url), { type: "module" });
    worker.onmessage = ({ data }) => {
      worker.terminate();
      if (!disposed) attach(Object.fromEntries(Object.entries(data).map(([lod, g]) => [lod, toGeometry(g)])));
    };
    worker.postMessage({ light });
  }
  let disposed = false;

  const whisk = whiskers();
  b.head.add(whisk.lines);

  // The cat's own shadow map: a small orthographic view from the sun, fit
  // round the cat. The scene's shadow map is static, so the cat carries its
  // own for the ground and for shadowing itself.
  const shadowSize = light ? 192 : 256;
  const shadowTarget = new THREE.WebGLRenderTarget(shadowSize, shadowSize, {
    depthTexture: new THREE.DepthTexture(shadowSize, shadowSize),
    depthBuffer: true,
  });
  const reach = 0.46 * S;
  // Deep enough for the long shadow a low sun throws across the sand.
  const shadowCamera = new THREE.OrthographicCamera(-reach, reach, reach, -reach, 0.05, 10.05);
  shadowCamera.layers.set(SHADOW_LAYER);
  uniforms.catShadowMap.value = shadowTarget.depthTexture;
  const shadowBias = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);

  const contact = createContactShadow(parent, uniforms);
  contact.local.catScale.value = S;
  const prints = createPawPrints(parent);
  const dust = createDust(parent);
  const splash = createDust(parent, { water: true, grains: light ? 160 : 256 });

  const temp = new THREE.Vector3();
  const local = new THREE.Vector3();
  const inverse = new THREE.Matrix4();
  const toCoast = new THREE.Matrix4();
  const worldPoint = new THREE.Vector3();
  const centre = new THREE.Vector3();
  const up = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const quat2 = new THREE.Quaternion();
  const basis = new THREE.Matrix4();
  const X = new THREE.Vector3();
  const Y = new THREE.Vector3();
  const Z = new THREE.Vector3();
  const state = {
    // Eased ground support under the body (see update).
    settle: {},
    gait: 0,
    blinkTimer: 2,
    blinkT: 0,
    lie: 0,
    crouch: 0,
    dip: 0,
    dipV: 0,
    lastAir: 0,
    airVel: 0,
    lastHeight: 0,
    lastLift: 0,
    lastPitch: 0,
    breath: 0,
    exertion: 0,
    pouch: 0,
    pouchV: 0,
    wet: 0,
    yawn: 0,
    yawned: false,
    gaze: new THREE.Vector2(),
    gazeTarget: new THREE.Vector2(),
    gazeTimer: 1,
    ears: [1, -1].map((side) => ({ side, swivel: 0, target: 0, timer: 1 + Math.random() * 3, flick: 0 })),
    tailElev: new Float32Array(TAIL_BONES).fill(-0.3),
    tailSide: new Float32Array(TAIL_BONES),
    tailElevV: new Float32Array(TAIL_BONES),
    tailSideV: new Float32Array(TAIL_BONES),
    pawWet: 0,
    // The paddle stroke's phase (0…1).
    stroke: 0,
  };
  const tailP = Array.from({ length: TAIL_BONES + 1 }, () => new THREE.Vector3());
  const tailN = Array.from({ length: TAIL_BONES + 1 }, () => new THREE.Vector3(1, 0, 0));
  const tailRoot = new THREE.Vector3(...TAIL_ROOT).sub(b.spine.position).sub(b.hips.position);
  let firstFrame = true;

  return {
    root,
    prints,
    // Dev: the lab's benchmark toggles parts to attribute cost.
    debug: { meshes, shells: null },
    get ready() {
      return meshes.length > 0;
    },
    // pose: from walker.js. ground(x, z) → height; onStep(leg, x, z,
    // heading, front, { side, speed }) fires as each paw lands and returns
    // the surface kind (walker.surfaceKind). light: see landscape.js.
    // wake (wake.js): where the paws stand in the water, and splash rings.
    update(pose, dt, time, ground, onStep, light, wake = null) {
      if (firstFrame) {
        parent.updateMatrixWorld(true);
        firstFrame = false;
      }
      uniforms.catTime.value = time;
      const step = Math.min(dt, 1 / 30);
      still = pose.gaitAmp < 0.02 && pose.air === 0 && Math.abs(pose.turn) < 0.05;
      const speed = Math.abs(pose.speed);
      const amp = pose.gaitAmp;
      const { x, z, heading } = pose;
      const sin = Math.sin(heading);
      const cos = Math.cos(heading);
      // Water: afloat (swim), how deep the legs are in it (wade), and the
      // shake that throws it off afterwards.
      const inWater = Number.isFinite(pose.waterY);
      const swim = pose.swim ?? 0;
      const wade = (pose.wade ?? 0) * (1 - swim);
      const shaking = pose.shake ?? 0;
      const effort = clamp(speed / 0.7, 0, 1);
      state.stroke = (state.stroke + lerp(1.15, 2.1, effort) * step * smooth(swim, 0.02, 0.3)) % 1;
      const strokeC = state.stroke * Math.PI * 2;
      uniforms.catWater.value.set(inWater ? pose.waterY : -100, pose.waterSlope?.[0] ?? 0, -(pose.waterSlope?.[1] ?? 0), inWater ? 1 : 0);
      uniforms.catWaterAt.value.set(x, -z);
      uniforms.catSoak.value = pose.soak ?? -1;

      // Postures blend: standing → sitting → lying (loaf) after a long
      // idle; a stalking crouch when something small moves nearby.
      state.lie += ((pose.sit > 0.95 && pose.sleepy > 0.3 ? 1 : 0) - state.lie) * Math.min(1, step * 0.6);
      const sitW = pose.sit * (1 - state.lie);
      const lieW = pose.sit * state.lie;
      const standW = 1 - pose.sit;
      state.crouch += ((pose.swish > 0.6 && speed < 0.5 && pose.sit < 0.3 && pose.air === 0 ? 1 : 0) - state.crouch) * Math.min(1, step * 2.5);
      const crouch = state.crouch * standW;

      // Gait blends with speed: a lateral-sequence walk, a trot, then a
      // rotary gallop. Stride lengthens and each foot spends less of the
      // cycle on the ground.
      const trot = smooth(speed, 1.0, 1.8);
      const gallop = smooth(speed, 2.3, 3.2);
      const stride = lerp(lerp(0.34, 0.62, trot), 1.05, gallop) * S * lerp(1, 0.75, crouch);
      const duty = lerp(lerp(0.64, 0.46, trot), 0.36, gallop);
      const pace = Math.max(speed, Math.abs(pose.turn) * 0.1);
      state.gait = (state.gait + (pace / stride) * dt) % 1;
      const cycle = state.gait * Math.PI * 2;
      state.exertion += ((pose.running ? 1 : 0) - state.exertion) * Math.min(1, step * (pose.running ? 0.15 : 0.04));

      // Landing: the legs take the impact and the body dips, then recovers.
      state.airVel = step > 0 ? (pose.air - state.lastAir) / step : 0;
      if (state.lastAir > 0.005 && pose.air === 0) state.dipV = Math.min(state.dipV, -0.4 - Math.min(3, -state.lastAirVel || 0) * 0.35);
      state.lastAirVel = state.airVel;
      state.lastAir = pose.air;
      state.dipV += (-220 * state.dip - 18 * state.dipV) * step;
      state.dip = clamp(state.dip + state.dipV * step, -0.05, 0.02);

      // Ground under the front and hind feet sets pitch and height.
      const span = 0.13 * S;
      // Round rocks the samples jump (onto a rim, off a ledge): each is held
      // near the ground under the body's middle, and the support they give
      // eases, so the body flows over a boulder instead of snapping.
      const g0 = ground(x, z);
      const near = (g) => clamp(g, g0 - 0.1 * S, g0 + 0.12 * S);
      const gf = near(ground(x + sin * span, z + cos * span));
      const gh = near(ground(x - sin * span, z - cos * span));
      const gl = near(ground(x + cos * 0.05 * S, z - sin * 0.05 * S));
      const gr = near(ground(x - cos * 0.05 * S, z + sin * 0.05 * S));
      const ease = (key, target, rate) => {
        if (!(key in state.settle)) state.settle[key] = target;
        return (state.settle[key] += (target - state.settle[key]) * Math.min(1, step * rate));
      };
      // In the air the support is the flight itself: follow it closely.
      const support = ease("support", (gf + gh) / 2 + pose.air, pose.air > 0 ? 60 : 18);
      const slopePitch = ease("pitch", Math.atan2(gf - gh, 2 * span), 14) * (1 - lieW * 0.5);
      const roll = ease("roll", Math.atan2(gl - gr, 0.1 * S), 14) * 0.5;
      // The body dips as each foot takes weight, sways toward the
      // supporting side, leans into turns, and rocks nose-to-tail at a
      // gallop.
      const bob = amp * (-Math.abs(Math.sin(cycle)) * lerp(0.006, 0.012, trot) * (1 - gallop) + Math.sin(cycle) * 0.018 * gallop);
      const sway = amp * Math.sin(cycle) * 0.04 * (1 - trot);
      const lean = clamp(-pose.turn * speed * 0.05, -0.25, 0.25);
      const rock = Math.cos(cycle) * 0.12 * gallop * amp;
      const posturePitch = POSTURE.sit.pitch * sitW + POSTURE.lie.pitch * lieW + POSTURE.crouch.pitch * crouch;
      let pitch = slopePitch * (1 - sitW * 0.6) + posturePitch + pose.airPitch + rock;
      const bodyHeight = lerp(lerp(STAND_HEIGHT, POSTURE.crouch.height, crouch), 0, pose.sit) + POSTURE.sit.height * sitW + POSTURE.lie.height * lieW;
      const baseGround = support - pose.air;
      let height = baseGround + (bodyHeight + bob + state.dip) * S + pose.air;
      // Afloat: the back just under the surface, rump low and chin high,
      // riding the waves' slope, bobbing and rolling a little with each
      // stroke.
      let bodyRoll = (roll + sway + lean) * (1 - pose.sit);
      if (swim > 0.001) {
        const slopeX = pose.waterSlope?.[0] ?? 0;
        const slopeZ = pose.waterSlope?.[1] ?? 0;
        const along = Math.atan(slopeX * sin + slopeZ * cos) * 0.7;
        const across = Math.atan(slopeX * cos - slopeZ * sin) * 0.7;
        const floatY = pose.waterY - 0.045 * S + Math.sin(strokeC * 2) * 0.004 * S + pose.air;
        height = lerp(height, floatY, swim);
        pitch = lerp(pitch, 0.2 - effort * 0.05 + along, swim);
        bodyRoll = lerp(bodyRoll, across + Math.sin(strokeC) * 0.05 + lean * 0.5, swim);
      }
      // The shake rolls through the whole body, head first.
      const shakeT = shaking * 1.1;
      const shakeWave = (lag) => Math.sin((shakeT - lag) * Math.PI * 2 * 5.5);
      const shakeEnv = (a, b) => (shaking > 0 ? Math.sin(Math.PI * clamp((shaking - a) / (b - a), 0, 1)) : 0);
      const shakeHead = shakeEnv(0, 0.4);
      const shakeBody = shakeEnv(0.15, 0.78);
      const shakeTail = shakeEnv(0.45, 1);
      bodyRoll += shakeWave(0.03) * 0.09 * shakeBody;
      // Sitting settles back onto the haunches; the front paws stay put.
      const shift = (0.03 * sitW - 0.005 * lieW) * S;
      root.position.set(x + sin * shift, height, z + cos * shift);
      root.rotation.set(-pitch, heading, bodyRoll);

      // Spine: bends into turns (a cat turns its whole length), flexes and
      // extends at a gallop, the hips and shoulders roll alternately at a
      // walk, the pelvis tucks under to sit, and a stalking cat wiggles its
      // rump before it pounces.
      const bend = clamp(pose.turn * 0.075, -0.24, 0.24) * standW;
      const flex = (Math.sin(cycle) * 0.2 * gallop + Math.sin(cycle * 2) * 0.02 * trot) * amp;
      const walkRoll = Math.sin(cycle) * 0.05 * amp * (1 - trot);
      const wiggle = crouch * Math.max(0, Math.sin(time * 0.9)) * Math.sin(time * 11) * 0.09;
      // Paddling works the spine a little: shoulders and hips roll in turn.
      const paddleRoll = Math.sin(strokeC) * 0.07 * swim;
      b.chest.rotation.set(-flex * 0.6 + 0.04 * sitW, bend, -walkRoll * 0.7 - paddleRoll + shakeWave(0.02) * 0.32 * shakeBody);
      b.hips.rotation.set(flex - 0.22 * sitW - 0.05 * lieW + Math.sin(strokeC * 2) * 0.03 * swim, -bend * 0.8, walkRoll + wiggle + paddleRoll - shakeWave(0.06) * 0.26 * shakeBody);
      // Breathing: slow at rest, deeper after running, and quick when purring.
      state.breath += step * Math.PI * 2 * lerp(0.33, 1.1, state.exertion);
      const breath = Math.sin(state.breath) * lerp(0.012, 0.03, state.exertion) + (pose.sit > 0.9 && pose.idle > 8 ? Math.sin(time * 150) * 0.002 : 0);
      b.ribs.scale.set(1 + breath, 1 + breath * 1.4, 1);
      // The belly pouch lags the body's bounce.
      const rise = step > 0 ? (height - (state.lastHeight || height)) / step : 0;
      const accel = step > 0 ? clamp((rise - state.lastLift) / step, -40, 40) : 0;
      state.pouchV += (-150 * state.pouch - 7 * state.pouchV - accel * 0.02) * step;
      state.pouch = clamp(state.pouch + state.pouchV * step, -0.007, 0.007);
      b.pouch.position.copy(bind.pouch).setY(bind.pouch.y + state.pouch - 0.004 * lieW);
      b.pouch.rotation.z = sway * 0.6;

      // Head: leads into turns, watches, and floats steady while the body
      // bobs. Low and forward when stalking; resting low in a loaf.
      const chestPitch = pitch - (-flex * 0.6);
      // Swimming, the head is held high, chin clear of the water.
      b.neck.rotation.set(
        chestPitch * 0.85 - pose.lookUp - bob * 3 - 0.08 * amp * (1 - gallop) + 0.32 * crouch + 0.12 * lieW - swim * 0.32,
        clamp(pose.look, -0.9, 0.9) - bend * 0.8 + shakeWave(0) * 0.22 * shakeHead,
        pose.tilt - (sway + lean) * 0.8 + shakeWave(0) * 0.6 * shakeHead,
      );
      b.head.rotation.set(-0.12 * crouch, clamp(pose.look - b.neck.rotation.y, -0.3, 0.3) * 0.4, 0);
      // Jaw: open to meow, and one long yawn on settling down to sleep.
      if (state.lie > 0.5 && !state.yawned) {
        state.yawned = true;
        state.yawn = 2.2;
      }
      if (state.lie < 0.1) state.yawned = false;
      state.yawn = Math.max(0, state.yawn - step);
      const meow = pose.meowing > 0 ? Math.sin((pose.meowing / 0.9) * Math.PI) : 0;
      const yawn = state.yawn > 0 ? Math.sin((state.yawn / 2.2) * Math.PI) : 0;
      const jaw = Math.max(meow * 0.32, yawn * 0.62);
      b.jaw.rotation.x = jaw;
      uniforms.catJaw.value = jaw;

      // Ears swivel on their own, toward whatever is heard, flick now and
      // then, prick forward to watch something and flatten back at a run,
      // in rain, and to yawn.
      const flat = Math.max(smooth(speed, 2, 3.4) * 0.6, (light.rain ?? 0) * 0.5, jaw * 1.2, state.wet * 0.2, swim * 0.4, shakeHead * 0.5);
      for (const ear of state.ears) {
        ear.timer -= step;
        if (ear.timer < 0) {
          ear.timer = 1.5 + Math.random() * 4;
          ear.target = Math.random() < 0.6 ? 0 : Math.random() * 0.9 - 0.2;
          if (Math.random() < 0.3) ear.flick = 1;
        }
        const alert = pose.swish;
        ear.swivel += ((ear.target * (1 - alert) - alert * 0.1) - ear.swivel) * Math.min(1, step * 6);
        ear.flick *= Math.exp(-step * 18);
        const bone = ear.side > 0 ? b.earL : b.earR;
        const flap = shakeWave(0.01) * shakeHead * 0.5;
        bone.rotation.set(-flat * 0.55 + alert * 0.12 - ear.flick * 0.25, ear.side * (ear.swivel + flat * 0.7), ear.side * (flat * 0.45 + ear.flick * 0.2) + flap);
      }

      // Whiskers.
      whisk.update(step, time, {
        alert: pose.swish,
        back: smooth(speed, 0.8, 3) + pose.air * 2 + jaw,
        turn: b.neck.rotation.y + heading,
        height: height + b.neck.rotation.x * 0.05,
        sniff: pose.swish * (1 - amp),
        light: 0.03 + light.direct * 0.6 + (1 - light.night) * 0.3,
      });

      // Eyes: blink every few seconds (twice now and then), slow-blink
      // when content, droop when sleepy and close in a loaf. Glances between
      // saccades; the slit pupil opens in the dark.
      state.blinkTimer -= step;
      if (state.blinkTimer < 0) {
        state.blinkT = pose.sit > 0.9 && Math.random() < 0.3 ? 0.9 : 0.16;
        state.blinkTimer = 1.5 + Math.random() * 4.5;
        if (Math.random() < 0.2) state.blinkTimer = 0.3;
      }
      const blinkLen = state.blinkT > 0.5 ? 0.9 : 0.16;
      state.blinkT = Math.max(0, state.blinkT - step);
      const blink = state.blinkT > 0 ? Math.sin((state.blinkT / blinkLen) * Math.PI) : 0;
      uniforms.catBlink.value = Math.min(1, Math.max(blink, pose.sleepy * (1 + state.lie * 0.9), yawn * 0.8, (light.rain ?? 0) * 0.25));
      uniforms.catPupil.value = lerp(0.12, 0.66, light.night);
      uniforms.catEyeshine.value = light.night;
      // The see-through silhouette is unlit: keep it as dim as the scene.
      ghost.color.setRGB(0.95, 0.85, 0.7).multiplyScalar(0.12 + 0.88 * (1 - light.night) * (0.4 + 0.6 * light.direct));
      state.gazeTimer -= step;
      if (state.gazeTimer < 0) {
        state.gazeTimer = 0.4 + Math.random() * 2.2;
        state.gazeTarget.set((Math.random() - 0.5) * 0.18, (Math.random() - 0.5) * 0.08);
      }
      const leftover = clamp(pose.look - b.neck.rotation.y - b.head.rotation.y, -0.4, 0.4);
      state.gaze.x += (state.gazeTarget.x + leftover * 0.5 - state.gaze.x) * Math.min(1, step * 25);
      state.gaze.y += (state.gazeTarget.y + pose.lookUp * 0.2 - state.gaze.y) * Math.min(1, step * 25);
      uniforms.catGaze.value.copy(state.gaze);

      // Coat: rain soaks it slowly; it dries more slowly still. Wind and
      // the cat's own speed ruffle the shells.
      state.wet = clamp(state.wet + step * ((light.rain ?? 0) > 0.2 ? 0.04 * light.rain : -0.004), 0, 1);
      uniforms.catWet.value = state.wet;
      const wind = light.wind ?? [0, 0];
      const windScale = Math.min(1.5, Math.hypot(wind[0], wind[1]) / 6);
      const wl = Math.hypot(wind[0], wind[1]) || 1;
      uniforms.catWind.value.set(
        ((wind[0] * cos - wind[1] * sin) / wl) * windScale,
        0,
        ((wind[0] * sin + wind[1] * cos) / wl) * windScale - speed * 0.25,
      );

      root.updateMatrixWorld(true);

      // Legs. Feet are placed in coast metres (the parent's frame). In
      // stance a paw stays exactly where it landed; in swing it arcs to
      // where it will be under the hip at mid-stance, so nothing slides,
      // even in turns. At a walk the hind paw lands in the front paw's
      // print on its side, as cats' do ("direct register").
      const offsets = {};
      for (const name of ["lf", "rf", "lh", "rh"]) offsets[name] = lerp(lerp(WALK[name], TROT[name], trot), GALLOP[name], gallop);
      const stanceReach = stride * duty * 0.5;
      const rising = state.airVel > 0;
      toCoast.copy(parent.matrixWorld).invert();
      let legIndex = -1;
      for (const leg of rig.legs) {
        legIndex++;
        const { spec } = leg;
        const q = (((state.gait + offsets[spec.name]) % 1) + 1) % 1;
        // Neutral paw position for the current posture (body frame).
        const [sx0, sz0] = neutralFoot(spec);
        const sitAt = spec.front ? POSTURE.sit.front : POSTURE.sit.hind;
        const lieAt = spec.front ? POSTURE.lie.front : POSTURE.lie.hind;
        const footX = (sx0 * standW + sitAt[0] * spec.side * sitW + lieAt[0] * spec.side * lieW) * S;
        const footZ = ((sz0 + (crouch * (spec.front ? 0.015 : 0.02))) * standW + sitAt[1] * sitW + lieAt[1] * lieW) * S - shift;
        const nx = root.position.x + sin * footZ + cos * footX;
        const nz = root.position.z + cos * footZ - sin * footX;
        if (!leg.plant) leg.plant = { x: nx, z: nz, fromX: nx, fromZ: nz };
        const stance = q < duty;
        let wx, wz;
        let lift = 0;
        leg.swing = 0;
        if (amp < 0.04 || pose.air > 0.01) {
          // Standing still (or airborne): settle toward the neutral stance.
          const k = Math.min(1, step * (pose.sit > 0.05 ? 3 : 6));
          leg.plant.x += (nx - leg.plant.x) * k;
          leg.plant.z += (nz - leg.plant.z) * k;
          wx = leg.plant.x;
          wz = leg.plant.z;
          leg.stance = true;
        } else if (stance) {
          if (!leg.stance) {
            // Touchdown: a print, a footstep, perhaps a spray of sand.
            leg.stance = true;
            if (amp > 0.25 && swim < 0.5) {
              const kind = onStep(spec.name, leg.plant.x, leg.plant.z, heading, spec.front, { side: spec.side, speed: gallop + trot * 0.4 });
              if (kind === 2 && speed > 1.3) dust.spray(time, leg.plant.x, ground(leg.plant.x, leg.plant.z), leg.plant.z, -sin, -cos, Math.round(4 + speed * 3), 0.6 + speed * 0.35);
              // Bounding through the shallows throws water ahead and up.
              if (kind === 5 && speed > 0.6) splash.spray(time, leg.plant.x, pose.waterY, leg.plant.z, sin * 0.6, cos * 0.6, Math.round(3 + speed * 5), 0.7 + speed * 0.45);
              if (spec.front) leg.lastPrint = { x: leg.plant.x, z: leg.plant.z };
            }
          }
          wx = leg.plant.x;
          wz = leg.plant.z;
        } else {
          if (leg.stance) {
            leg.plant.fromX = leg.plant.x;
            leg.plant.fromZ = leg.plant.z;
            leg.stance = false;
          }
          const t = (q - duty) / (1 - duty);
          const ahead = stanceReach * amp;
          leg.plant.x = nx + sin * ahead;
          leg.plant.z = nz + cos * ahead;
          if (!spec.front && trot < 0.3) {
            const front = rig.legs.find((l) => l.spec.front && l.spec.side === spec.side);
            const print = front.lastPrint;
            if (print && Math.hypot(print.x - leg.plant.x, print.z - leg.plant.z) < 0.07 * S) {
              leg.plant.x = print.x;
              leg.plant.z = print.z;
            }
          }
          // Paw lifts back and up first, then reaches and sets down softly.
          const e = t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t);
          wx = leg.plant.fromX + (leg.plant.x - leg.plant.fromX) * e;
          wz = leg.plant.fromZ + (leg.plant.z - leg.plant.fromZ) * e;
          // In water a cat high-steps, lifting each paw clear.
          lift = Math.sin(Math.PI * Math.pow(t, 0.8)) * lerp(0.028, 0.055, trot) * S * Math.min(1, amp * 2) * (1 + smooth(wade, 0.05, 0.5) * 1.8);
          leg.swing = Math.sin(Math.PI * Math.min(1, t * 1.3)) * Math.min(1, amp * 2);
        }
        const gy = ground(wx, wz);
        leg.groundGap = lift;
        // The shoulder blade rides the swing of the arm, and rises over the
        // leg that bears weight.
        if (leg.scapula) {
          const weight = leg.stance ? 1 : 0;
          leg.scapLift = (leg.scapLift ?? 0) + (weight - (leg.scapLift ?? 0)) * Math.min(1, step * 10);
          leg.scapula.rotation.x = -(leg.lastUpper ?? 0) * 0.3;
          leg.scapula.position.copy(bind[leg.scapula.name]).setY(bind[leg.scapula.name].y + (leg.scapLift - 0.5) * 0.006 * amp);
          leg.scapula.updateMatrixWorld(true);
        }
        const upperParent = leg.upper.parent;
        inverse.copy(upperParent.matrixWorld).invert();
        let flexLeg = leg.swing * (spec.front ? 1.3 : 0.55);
        if (pose.air > 0.01) {
          // In the air: pushing off, the hind legs trail and the front tuck;
          // coming down, the front legs reach for the ground.
          const reachDown = spec.front ? (rising ? -0.12 : -0.19) : rising ? -0.18 : -0.11;
          const reachFwd = spec.front ? (rising ? -0.01 : 0.05) : rising ? -0.07 : 0.03;
          local.set(0, reachDown, reachFwd);
          flexLeg = spec.front ? (rising ? 1.3 : 0.2) : rising ? -0.1 : 0.6;
        } else {
          local.set(wx, gy + PAW_LIFT * S + lift, wz).applyMatrix4(parent.matrixWorld).applyMatrix4(inverse).sub(leg.upper.position);
        }
        // Paddling: each paw circles under the body, pulling down and back
        // with the toes spread, then curling up and forward to reach again.
        // Treading water, the circles are smaller.
        if (swim > 0.001) {
          const th = ((((state.stroke + PADDLE[spec.name]) % 1) + 1) % 1) * Math.PI * 2;
          const circle = lerp(0.6, 1, effort);
          const recover = Math.max(0, -Math.sin(th));
          if (spec.front) temp.set(-spec.side * 0.004, -0.118 - 0.045 * Math.sin(th) * circle, 0.04 + 0.06 * Math.cos(th) * circle);
          else temp.set(-spec.side * 0.004, -0.14 - 0.04 * Math.sin(th) * circle, -0.02 + 0.065 * Math.cos(th) * circle);
          local.lerp(temp, swim);
          flexLeg = lerp(flexLeg, recover * (spec.front ? 1.25 : 0.75), swim);
          // Each front stroke reaching forward stirs the surface ahead.
          const phase = th / (Math.PI * 2);
          if (spec.front && wake && swim > 0.6 && leg.lastPhase !== undefined && leg.lastPhase < 0.92 && phase >= 0.92) {
            const ahead = 0.2 * S;
            const px = x + sin * ahead + cos * spec.side * 0.04 * S;
            const pz = z + cos * ahead - sin * spec.side * 0.04 * S;
            wake.ring(px, pz, 0.25 + effort * 0.35);
            if (effort > 0.5) splash.spray(time, px, pose.waterY, pz, sin * 0.3, cos * 0.3, 2, 0.5);
          }
          leg.lastPhase = phase;
        }
        // Sitting: the hind hocks lie flat on the ground.
        if (!spec.front) flexLeg = lerp(flexLeg, spec.lean - (Math.PI / 2 - pitch - 0.12), sitW + lieW * 0.9);
        const solved = solveLeg(leg, local.x, local.z, local.y, flexLeg);
        leg.lastUpper = solved.upperAngle;
        // A loaf folds every leg underneath.
        if (lieW > 0.01) {
          // Front: upper arm back, forearm and pastern forward under the
          // chest. Hind: thigh forward, shin back, hock folded flat forward.
          const tuck = spec.front ? [1.25, -2.6, 0.1, 1.5] : [-1.0, 2.6, -3.05, 1.45];
          leg.upper.rotation.x = lerp(leg.upper.rotation.x, tuck[0], lieW);
          leg.lower.rotation.x = lerp(leg.lower.rotation.x, tuck[1], lieW);
          leg.foot.rotation.x = lerp(leg.foot.rotation.x, tuck[2], lieW);
          leg.paw.rotation.x = lerp(leg.paw.rotation.x, tuck[3], lieW);
        }
        // Planted paws lie flat on the ground, on slopes and rock too.
        leg.upper.updateMatrixWorld(true);
        const planted = (leg.stance ? 1 : 1 - leg.swing) * (1 - lieW) * (pose.air > 0.01 ? 0 : 1) * (1 - swim);
        if (planted > 0.01) {
          const e = 0.03;
          up.set(ground(wx - e, wz) - ground(wx + e, wz), 2 * e, ground(wx, wz - e) - ground(wx, wz + e)).normalize();
          // Coast → the cat's frame → the paw's parent frame.
          up.applyQuaternion(quat.copy(root.quaternion).invert());
          basis.copy(root.matrixWorld).invert().multiply(leg.foot.matrixWorld);
          quat.setFromRotationMatrix(basis).invert();
          up.applyQuaternion(quat);
          temp.set(0, 1, 0).applyQuaternion(leg.paw.quaternion);
          quat2.setFromUnitVectors(temp, up);
          quat.identity().slerp(quat2, planted);
          leg.paw.quaternion.premultiply(quat);
        }
        leg.pawWorld = leg.pawWorld ?? new THREE.Vector3();
        leg.paw.getWorldPosition(leg.pawWorld).applyMatrix4(toCoast);
        // Wading legs cut the water; a paw lifted out drips, one put back
        // in splashes.
        const p = leg.pawWorld;
        const pawDepth = inWater ? pose.waterY - p.y : -1;
        if (wake) wake.paw(legIndex, p.x, p.z, swim > 0.5 ? 0 : clamp(pawDepth, 0, 0.3));
        const under = pawDepth > 0;
        if (leg.under !== undefined && under !== leg.under && inWater && swim < 0.5 && pose.air === 0) {
          if (under && speed > 0.25) splash.spray(time, p.x, pose.waterY, p.z, sin * 0.4, cos * 0.4, Math.round(2 + speed * 3), 0.45 + speed * 0.3);
          else if (!under) splash.spray(time, p.x, pose.waterY + 0.01, p.z, 0, 0, 2, 0.15, 0.3);
        }
        leg.under = under;
      }

      // Tail: each segment's angles are a damped spring toward a pose that
      // reads the cat's mood: carried high with a hooked tip at a walk,
      // lower and streaming at a run, low and twitching at the tip when
      // stalking, up for balance in the air, wrapped round the paws when
      // sitting and round the body in a loaf. The body's own motion drives
      // it: a turn leaves the tail behind, a bounce or a landing makes it
      // whip, and looser springs toward the tip let motion flow down it.
      const swish = pose.swish;
      tailP[0].copy(tailRoot);
      const seg = TAIL_LENGTH / TAIL_BONES;
      const lift2 = step > 0 ? (height - (state.lastHeight || height)) / step : 0;
      const liftAccel = step > 0 ? (lift2 - state.lastLift) / step : 0;
      state.lastLift = lift2;
      state.lastHeight = height;
      const pitchRate = step > 0 ? (pitch - state.lastPitch) / step : 0;
      state.lastPitch = pitch;
      const moving = smooth(amp, 0.1, 0.6);
      b.hips.updateMatrixWorld(true);
      const hipsToCoast = inverse.multiplyMatrices(toCoast, b.hips.matrixWorld);
      for (let i = 0; i < TAIL_BONES; i++) {
        const s = i / TAIL_BONES;
        const carried = 0.5 + smooth(s, 0, 0.5) * 0.8 - smooth(s, 0.75, 1) * 0.9;
        const streaming = 0.15 - s * 0.1;
        const resting = -0.55 + smooth(s, 0.3, 1) * 1.0;
        const stalking = -0.45 + smooth(s, 0.2, 0.6) * 0.3;
        let up2 = lerp(resting, lerp(carried, streaming, smooth(speed, 1.6, 3)), moving);
        up2 = lerp(up2, stalking, crouch);
        // Sitting: down to the floor, then along it (the body is pitched up,
        // so level in the world is about −pitch here).
        const floorE = -pitch + 0.02;
        const down = lerp(-1.05, floorE, smooth(s, 0.05, 0.25));
        let targetE = lerp(up2, down, pose.sit) + pose.air * 1.4 / S;
        // Wading, the tail is held high and dry; afloat it streams out
        // level behind as a rudder.
        targetE += wade * 0.6 * (1 - s * 0.5);
        targetE = lerp(targetE, -pitch + 0.06 - s * 0.05, swim);
        const sway = Math.sin(time * (0.9 + swish * 2.5) - s * 2.6) * s * s * (0.22 + swish * 0.55) * (1 - crouch);
        const twitch = crouch * smooth(s, 0.75, 1) * Math.sin(time * 13) * 0.5 * (0.5 + 0.5 * Math.sin(time * 1.3));
        const gaitSway = Math.sin(cycle + Math.PI * s) * 0.06 * amp * (1 - gallop) * s;
        let targetS = sway + twitch + gaitSway + sitW * s * 2.3 + lieW * s * 3.2;
        targetS = lerp(targetS, Math.sin(strokeC - s * 3) * 0.1 * s - pose.turn * 0.25 * s, swim);
        targetS += Math.sin((shakeT - 0.5 - s * 0.15) * Math.PI * 2 * 5.5) * 0.45 * s * shakeTail;
        if (step > 0) {
          const k = lerp(110, 16, s);
          const c = 2 * Math.sqrt(k) * 0.4;
          state.tailSide[i] -= pose.turn * step * (0.25 + s * 0.6);
          state.tailElev[i] -= pitchRate * step * (0.3 + s * 0.5);
          state.tailElevV[i] += (k * (targetE - state.tailElev[i]) - c * state.tailElevV[i] - clamp(liftAccel, -40, 40) * s * 0.6) * step;
          state.tailSideV[i] += (k * (targetS - state.tailSide[i]) - c * state.tailSideV[i]) * step;
          state.tailElev[i] += state.tailElevV[i] * step;
          state.tailSide[i] += state.tailSideV[i] * step;
        }
        const dir = (e, sd) => temp.set(Math.sin(sd) * Math.cos(e), Math.sin(e), -Math.cos(sd) * Math.cos(e));
        tailP[i + 1].copy(tailP[i]).addScaledVector(dir(state.tailElev[i], state.tailSide[i]), seg);
        // The ground pushes the tail up rather than letting it sink in.
        worldPoint.copy(tailP[i + 1]).applyMatrix4(hipsToCoast);
        let floor = ground(worldPoint.x, worldPoint.z) + 0.013 * S;
        if (swim > 0.3) floor = Math.max(floor, pose.waterY - 0.012 * S);
        if (worldPoint.y < floor) {
          const push = Math.min(0.6, (floor - worldPoint.y) / (seg * S));
          state.tailElev[i] += push;
          state.tailElevV[i] = Math.max(0, state.tailElevV[i]);
          tailP[i + 1].copy(tailP[i]).addScaledVector(dir(state.tailElev[i], state.tailSide[i]), seg);
        }
      }
      // Bones along the spine, with parallel-transported frames (so the
      // tail never twists).
      for (let i = 0; i <= TAIL_BONES; i++) {
        const a = tailP[Math.max(0, i - 1)];
        const c = tailP[Math.min(TAIL_BONES, i + 1)];
        Z.subVectors(a, c).normalize();
        const n = i === 0 ? tailN[0].set(1, 0, 0) : tailN[i].copy(tailN[i - 1]);
        n.addScaledVector(Z, -n.dot(Z)).normalize();
        X.copy(n);
        Y.crossVectors(Z, X);
        basis.makeBasis(X, Y, Z);
        const bone = rig.tail[i];
        bone.position.copy(tailP[i]);
        bone.quaternion.setFromRotationMatrix(basis);
      }

      // The cat's shadow: a view from the sun fit round the cat.
      const sun = light.sun;
      const direct = light.direct;
      uniforms.catShadowOn.value = direct > 0.02 && sun && sun.y > 0.02 ? 1 : 0;
      b.chest.getWorldPosition(centre);
      if (sun) {
        shadowCamera.position.copy(centre).addScaledVector(sun, 2);
        shadowCamera.up.set(0, 1, 0);
        if (Math.abs(sun.y) > 0.98) shadowCamera.up.set(1, 0, 0);
        shadowCamera.lookAt(centre);
        shadowCamera.updateMatrixWorld();
        uniforms.catShadowMatrix.value.multiplyMatrices(shadowBias, shadowCamera.projectionMatrix).multiply(shadowCamera.matrixWorldInverse);
      }
      uniforms.catGroundY.value = baseGround;
      // Ground patch: round the cat, stretched away from the sun.
      const altitude = Math.max(0.12, Math.asin(clamp(sun?.y ?? 1, -1, 1)));
      const length = Math.min(3 * S, (0.3 * S) / Math.tan(altitude));
      const hx = light.sunX ?? 0;
      const hz = light.sunZ ?? 0;
      const hl = Math.hypot(hx, hz) || 1;
      contact.place(
        Math.round((x - (hx / hl) * length * 0.5) * 50) / 50,
        Math.round((z - (hz / hl) * length * 0.5) * 50) / 50,
        Math.ceil((0.9 * S + length) * 10) / 10,
        ground,
      );
      contact.local.catBody.value.set(x - sin * 0.01, z - cos * 0.01, heading, Math.max(0, (1 - pose.air * 6) * lerp(1, 1.4, pose.sit) * (1 - swim)));
      rig.legs.forEach((leg, i) => {
        const p = leg.pawWorld;
        contact.local.catPaws.value[i].set(p.x, p.z, pose.air > 0.01 ? 1 : Math.max(0, p.y - ground(p.x, p.z) - PAW_LIFT * S * 0.5));
      });
      contact.local.sunShare.value = clamp(direct * 0.75, 0, 0.8) * uniforms.catShadowOn.value;
      contact.local.shadowSpan.value = reach * 2;

      // Fewer shells as the cat gets smaller on screen.
      if (shellGeometry && light.eye) {
        const d = light.eye.distanceTo(centre);
        const count = this.debug.shells ?? Math.round(clamp(8.2 - d * 2, 2, maxShells));
        const body = meshes[0];
        // Beyond ~2 m the stripes span a few pixels: paint the body per vertex.
        const perVertex = body.material === coatFar ? d > 2.0 : d > 2.3;
        body.material = perVertex && uniforms.catBodyColours.value ? coatFar : coat;
        shellGeometry.instanceCount = count;
        uniforms.catPixelAngle.value = 1 / (light.pixelScale ?? 500);
        uniforms.shellCount.value = count;
      }
      // The shake flings water off the coat, tangent to the roll.
      if (shaking > 0 && Math.max(shakeHead, shakeBody) > 0.3) {
        const along = lerp(0.2, -0.15, shaking) * S;
        const cx = x + sin * along;
        const cz = z + cos * along;
        const side = shakeWave(0) > 0 ? 1 : -1;
        splash.spray(time, cx + cos * side * 0.07 * S, height + 0.02 * S, cz - sin * side * 0.07 * S, cos * side * 1.2, -sin * side * 1.2, light.eye ? 3 : 2, 1.3, 0.6);
      }
      prints.update(time, light.night ?? 0);
      dust.update(time, 0.35 + direct * 0.9 + (1 - light.night) * 0.2, light.pixelScale ?? 500);
      splash.update(time, CAT_SEA.foam.value, light.pixelScale ?? 500);
    },
    // A hard landing sprays sand round the paws.
    land(time, strength, kind, ground) {
      if (kind !== 2 && kind !== 3) return;
      for (const leg of rig.legs) {
        const p = leg.pawWorld;
        if (!p) continue;
        for (let k = 0; k < 2; k++) {
          const a = Math.random() * Math.PI * 2;
          dust.spray(time, p.x, ground(p.x, p.z), p.z, Math.cos(a), Math.sin(a), Math.round(3 + strength * 3), 0.4 + strength * 0.25);
        }
      }
    },
    // Plunging into the water: a crown of spray round the body.
    splash(time, strength, level) {
      if (!Number.isFinite(level)) return;
      const p = root.position;
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2 + Math.random() * 0.5;
        splash.spray(time, p.x + Math.cos(a) * 0.12 * S, level, p.z + Math.sin(a) * 0.12 * S, Math.cos(a), Math.sin(a), Math.round(3 + strength * 5), 0.8 + strength * 1.2);
      }
    },
    // Renders the cat's shadow map. Called by the landscape before the
    // frame.
    renderShadow(renderer, scene) {
      if (!meshes.length) return;
      if (!baked) {
        baked = { mid: bakeShellColours(renderer, lods.mid), far: bakeShellColours(renderer, lods.far) };
        uniforms.catShellColours.value = baked.far.texture;
        uniforms.catBodyColours.value = baked.mid.texture;
      }
      if (uniforms.catShadowOn.value < 0.5) return;
      // A still cat (breathing, twitching) needs its shadow redrawn less often.
      shadowFrame = (shadowFrame + 1) % 3;
      const key = `${shadowCamera.position.x.toFixed(3)}:${shadowCamera.position.y.toFixed(3)}:${shadowCamera.position.z.toFixed(3)}`;
      if (still && shadowFrame !== 0 && key === shadowKey) return;
      shadowKey = key;
      const target = renderer.getRenderTarget();
      const override = scene.overrideMaterial;
      scene.overrideMaterial = depth;
      renderer.setRenderTarget(shadowTarget);
      renderer.render(scene, shadowCamera);
      renderer.setRenderTarget(target);
      scene.overrideMaterial = override;
    },
    dispose() {
      disposed = true;
      if (lods) Object.values(lods).forEach((g) => g.dispose());
      shellGeometry?.dispose();
      coat.dispose();
      coatFar.dispose();
      fur.dispose();
      ghost.dispose();
      depth.dispose();
      whisk.dispose();
      shadowTarget.dispose();
      if (baked) Object.values(baked).forEach((t) => t.dispose());
      contact.dispose();
      prints.dispose();
      dust.dispose();
      splash.dispose();
    },
  };
}

// Whiskers: four rows a side from the whisker pads, two brows over each
// eye, and a few on the cheeks. Each is a bent line rebuilt every frame in
// the head's frame, fading toward its fine tip. The pads fan them forward
// when the cat is interested and flatten them back when it runs; each side
// twitches on its own, a sniff flutters them, and the tips lag behind quick
// head turns and bend back in the airflow.
function whiskers() {
  const SEGMENTS = 5;
  const strands = [];
  for (const side of [-1, 1]) {
    for (let row = 0; row < 4; row++)
      for (let k = 0; k < 3; k++)
        strands.push({
          side,
          root: new THREE.Vector3(side * (0.0105 + k * 0.0022), -0.0158 - row * 0.0026, 0.0435 - k * 0.0025),
          spread: 0.85 + row * 0.12 + k * 0.05,
          droop: -0.1 - row * 0.1 + k * 0.03,
          length: 0.068 - row * 0.005 - k * 0.004,
          phase: Math.random() * 6.28,
        });
    for (let k = 0; k < 2; k++)
      strands.push({ side, root: new THREE.Vector3(side * (0.013 + k * 0.005), 0.0175, 0.035), spread: 0.7 + k * 0.2, droop: 0.4, length: 0.024 - k * 0.005, phase: Math.random() * 6.28 });
    strands.push({ side, root: new THREE.Vector3(side * 0.036, -0.004, 0.012), spread: 1.35, droop: 0.1, length: 0.02, phase: Math.random() * 6.28 });
  }
  const vertices = strands.length * SEGMENTS * 2;
  const positions = new Float32Array(vertices * 3);
  const colours = new Float32Array(vertices * 4);
  for (let w = 0; w < strands.length; w++)
    for (let k = 0; k < SEGMENTS; k++)
      for (let e = 0; e < 2; e++) {
        const t = (k + e) / SEGMENTS;
        colours.set([1, 1, 1, 0.6 * (1 - t * 0.85)], ((w * SEGMENTS + k) * 2 + e) * 4);
      }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute("color", new THREE.BufferAttribute(colours, 4));
  const lines = new THREE.LineSegments(
    geometry,
    new THREE.LineBasicMaterial({ color: new THREE.Color(0.9, 0.88, 0.82), vertexColors: true, transparent: true, depthWrite: false }),
  );
  lines.frustumCulled = false;
  lines.renderOrder = 12;
  const twitch = { "-1": 0, 1: 0 };
  const timer = { "-1": 1, 1: 2.5 };
  let lag = 0;
  let lastTurn = null;
  const bounce = { x: 0, v: 0 };
  const swing = { x: 0, v: 0 };
  let lastHeight = null;
  let lastRise = 0;
  const p = new THREE.Vector3();
  const q = new THREE.Vector3();
  const build = (time, mood) => {
    let o = 0;
    for (const w of strands) {
      const key = String(w.side);
      const flutter = Math.sin(time * 30 + w.phase) * 0.14 * mood.sniff;
      const drift = Math.sin(time * (0.8 + w.phase * 0.07) + w.phase) * 0.07 + Math.sin(time * 2.1 + w.phase * 1.7) * 0.025;
      const fan = w.spread - mood.alert * 0.45 + mood.back * 0.7 + twitch[key] + flutter + drift;
      q.copy(w.root);
      for (let k = 1; k <= SEGMENTS; k++) {
        const t = k / SEGMENTS;
        const bend = fan + t * t * (mood.back * 0.5 + w.side * (lag + swing.x) * 1.5);
        const s = w.length / SEGMENTS;
        const breath = Math.sin(time * 1.3 + w.phase * 0.2) * 0.008 + Math.sin(time * 0.9 + w.phase) * 0.004;
        p.set(
          q.x + w.side * Math.sin(bend) * s,
          q.y + (w.droop * 0.07 * (1 - mood.alert * 0.4) - t * 0.025 + (bounce.x + breath) * t * 2) / SEGMENTS,
          q.z + Math.cos(bend) * s - 0.01 / SEGMENTS,
        );
        positions.set([q.x, q.y, q.z, p.x, p.y, p.z], o);
        o += 6;
        q.copy(p);
      }
    }
    geometry.attributes.position.needsUpdate = true;
  };
  build(0, { alert: 0, back: 0, sniff: 0 });
  return {
    lines,
    update(dt, time, mood) {
      for (const key of ["-1", "1"]) {
        timer[key] -= dt;
        if (timer[key] < 0) {
          timer[key] = 1 + Math.random() * 3.5;
          twitch[key] = -0.45 - Math.random() * 0.3;
        }
        twitch[key] *= Math.exp(-dt * 3.5);
      }
      if (lastTurn === null) lastTurn = mood.turn;
      if (lastHeight === null) lastHeight = mood.height;
      const turnRate = dt > 0 ? Math.atan2(Math.sin(mood.turn - lastTurn), Math.cos(mood.turn - lastTurn)) / dt : 0;
      lastTurn = mood.turn;
      lag += (clamp(-turnRate * 0.12, -0.5, 0.5) - lag) * Math.min(1, dt * 8);
      const rise = dt > 0 ? (mood.height - lastHeight) / dt : 0;
      const accel = dt > 0 ? clamp((rise - lastRise) / dt, -30, 30) : 0;
      lastHeight = mood.height;
      lastRise = rise;
      if (dt > 0) {
        bounce.v += (-260 * bounce.x - 9 * bounce.v - accel * 0.4) * dt;
        bounce.x += bounce.v * dt;
        swing.v += (-180 * swing.x - 8 * swing.v - turnRate * 4) * dt;
        swing.x += swing.v * dt;
      }
      lines.material.color.setRGB(0.95, 0.93, 0.86).multiplyScalar(mood.light);
      build(time, mood);
    },
    dispose() {
      geometry.dispose();
      lines.material.dispose();
    },
  };
}

