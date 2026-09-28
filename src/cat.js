import * as THREE from "three";
import { mergeGeometries, mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";

// A small brown mackerel tabby, built from swept and spherical parts like the
// rest of the scene (no textures). Stripes, the forehead "M", cream socks and
// eyes are drawn per pixel from each part's own coordinates, so the coat
// stays crisp at any distance, and short fur shells soften its edge. Legs
// are three-bone chains (humerus/forearm/pastern, thigh/shin/hock) whose
// paws plant on the ground mesh; the tail is one tube bent along a
// CPU-computed spine.
//
// The cat lives in coast metres inside the z-mirrored land group. Its local
// +z is forward, +y up; rotation.y is the coast heading φ (forward = sin φ,
// cos φ in coast x, z).

// Part ids for the coat shader.
const BODY = 0;
const HEAD = 1;
const CREAM = 2;
const NOSE = 3;
const EAR = 4;
const EYE = 5;
const LEG = 6;
const PAW = 7;
const TAIL = 8;

const TAIL_RINGS = 16;

// Legs: hip position in the body frame and three bones. The front leg is a
// humerus tucked against the chest (elbow back), a straight forearm and a
// short sloping pastern; the hind leg a heavy thigh (knee forward), a shin
// and the long hock that stands the cat on its toes. `lean` tilts the last
// bone so the joint above it sits behind the paw.
const LEGS = [
  { name: "lf", hip: [0.033, -0.02, 0.115], bones: [0.07, 0.1, 0.034], lean: 0.18, front: true },
  { name: "rf", hip: [-0.033, -0.02, 0.115], bones: [0.07, 0.1, 0.034], lean: 0.18, front: true },
  { name: "lh", hip: [0.038, 0.0, -0.125], bones: [0.09, 0.09, 0.068], lean: 0.22, front: false },
  { name: "rh", hip: [-0.038, 0.0, -0.125], bones: [0.09, 0.09, 0.068], lean: 0.22, front: false },
];
// Fur: short shells over body, head and upper legs soften the coat's edge.
const SHELLS = 4;
const FUR_LENGTH = 0.0038;
// Gait phase offsets: a lateral-sequence walk (LH, LF, RH, RF), a trot
// (diagonal pairs together) and a rotary gallop (pairs landing close).
const WALK = { lh: 0, lf: 0.25, rh: 0.5, rf: 0.75 };
const TROT = { lh: 0, rf: 1.0, rh: 0.5, lf: 0.5 };
const GALLOP = { lh: 0, rh: 0.1, lf: 0.5, rf: 0.6 };
const PAW_LIFT = 0.013;

export function createCat(parent) {
  const uniforms = {
    catTime: { value: 0 },
    catBlink: { value: 0 },
    catPupil: { value: 0.2 },
    catEyeshine: { value: 0 },
    tailP: { value: Array.from({ length: TAIL_RINGS + 1 }, () => new THREE.Vector3()) },
    tailN: { value: Array.from({ length: TAIL_RINGS + 1 }, () => new THREE.Vector3(1, 0, 0)) },
    tailB: { value: Array.from({ length: TAIL_RINGS + 1 }, () => new THREE.Vector3(0, 1, 0)) },
  };
  const fur = coatMaterial(uniforms, { tail: false });
  const tailFur = coatMaterial(uniforms, { tail: true });
  const shells = Array.from({ length: SHELLS }, (_, i) => coatMaterial(uniforms, { shell: (i + 1) / SHELLS }));
  // Where something hides the cat, it shows through as a soft silhouette
  // (drawn only where it fails the depth test), so bushes and boulders never
  // lose it. The plants' own shaders stay discard-free.
  const ghost = new THREE.MeshBasicMaterial({
    color: new THREE.Color(0.95, 0.85, 0.7),
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
    depthFunc: THREE.GreaterDepth,
    fog: false,
    toneMapped: false,
    // Only where the cat itself isn't drawn, and once per pixel.
    stencilWrite: true,
    stencilRef: 1,
    stencilFunc: THREE.NotEqualStencilFunc,
    stencilZPass: THREE.IncrementStencilOp,
  });
  // The cat marks its pixels in the stencil buffer. It draws in the
  // transparent pass, after the (fading) ground and rocks, so anything that
  // covers it has already won the depth test and left no mark.
  for (const material of [fur, tailFur, ...shells])
    Object.assign(material, {
      transparent: true,
      stencilWrite: true,
      stencilRef: 1,
      stencilFunc: THREE.AlwaysStencilFunc,
      stencilZPass: THREE.ReplaceStencilOp,
    });

  const root = new THREE.Group();
  root.rotation.order = "YXZ";
  const body = new THREE.Mesh(bodyGeometry(), fur);
  root.add(body);
  const furred = [body];
  const neck = new THREE.Group();
  neck.position.set(0, 0.078, 0.2);
  neck.rotation.order = "YXZ";
  const head = new THREE.Mesh(headGeometry(), fur);
  head.position.set(0, 0.03, 0.04);
  // A real cat's skull is ~9 cm across; the modelled head is scaled to it.
  head.scale.setScalar(0.86);
  neck.add(head);
  const whisk = whiskers();
  head.add(whisk.lines);
  root.add(neck);
  furred.push(head);
  const tail = new THREE.Mesh(tailGeometry(), tailFur);
  tail.frustumCulled = false;
  root.add(tail);
  const legs = LEGS.map((spec) => {
    const [a, b, c] = spec.bones;
    const hip = new THREE.Group();
    hip.position.set(...spec.hip);
    const upper = new THREE.Mesh(spec.front ? humerusGeometry(a) : thighGeometry(a), fur);
    const knee = new THREE.Group();
    knee.position.y = -a;
    const lower = new THREE.Mesh(limbGeometry(spec.front ? 0.02 : 0.021, spec.front ? 0.016 : 0.014, b), fur);
    const hock = new THREE.Group();
    hock.position.y = -b;
    const foot = new THREE.Mesh(limbGeometry(spec.front ? 0.015 : 0.014, 0.013, c), fur);
    const ankle = new THREE.Group();
    ankle.position.y = -c;
    const paw = new THREE.Mesh(pawGeometry(spec.front), fur);
    hip.add(upper, knee);
    knee.add(lower, hock);
    hock.add(foot, ankle);
    ankle.add(paw);
    root.add(hip);
    furred.push(upper);
    return { spec, hip, knee, hock, ankle, lastQ: 0, swing: 0 };
  });
  const parts = [body, head, tail, ...legs.flatMap((l) => [l.hip.children[0], l.knee.children[0], l.hock.children[0], l.ankle.children[0]])];
  for (const part of parts) {
    part.renderOrder = 10;
    part.castShadow = false;
    part.receiveShadow = true;
    // The silhouette pass shares each part's geometry and transform.
    const silhouette = new THREE.Mesh(part.geometry, part === tail ? ghostTail(ghost, uniforms) : ghost);
    silhouette.renderOrder = 20;
    silhouette.frustumCulled = false;
    part.add(silhouette);
  }
  for (const part of furred)
    for (const material of shells) {
      const shell = new THREE.Mesh(part.geometry, material);
      shell.receiveShadow = true;
      shell.renderOrder = 11;
      part.add(shell);
    }
  parent.add(root);

  // A soft contact shadow: the sun's shadow map is static (re-rendered only
  // when the light moves), so the cat carries its own.
  const blob = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    multiplyMaterial(/* glsl */ `
      float d = length( vUv * 2.0 - 1.0 );
      float a = ( 1.0 - smoothstep( 0.2, 1.0, d ) ) * strength;
      gl_FragColor = vec4( vec3( 0.55, 0.56, 0.6 ) * a, a );`),
  );
  blob.material.uniforms.strength = { value: 0.6 };
  blob.renderOrder = 2;
  blob.frustumCulled = false;
  parent.add(blob);

  const prints = createPawPrints(parent);

  const temp = new THREE.Vector3();
  const local = new THREE.Vector3();
  const inverse = new THREE.Matrix4();
  const tailDir = new THREE.Vector3();
  const worldPoint = new THREE.Vector3();
  let gaitPhase = 0;
  const tailElev = new Float32Array(TAIL_RINGS).fill(-0.3);
  const tailSide = new Float32Array(TAIL_RINGS);
  const tailElevV = new Float32Array(TAIL_RINGS);
  const tailSideV = new Float32Array(TAIL_RINGS);
  let lastHeight = 0;
  let lastLift = 0;
  let lastPitch = 0;
  let blinkTimer = 2;
  let blinkT = 0;

  return {
    root,
    prints,
    // pose: from walker.js. ground(x, z) → height; onStep(leg, x, z) fires
    // as each paw lands.
    update(pose, dt, time, ground, onStep, light) {
      uniforms.catTime.value = time;
      uniforms.catPupil.value = THREE.MathUtils.lerp(0.14, 0.62, light.night);
      uniforms.catEyeshine.value = light.night;
      // Blink every few seconds, twice now and then.
      blinkTimer -= dt;
      if (blinkTimer < 0) {
        blinkT = 0.16;
        blinkTimer = 1.5 + Math.random() * 4.5;
        if (Math.random() < 0.2) blinkTimer = 0.3;
      }
      blinkT = Math.max(0, blinkT - dt);
      uniforms.catBlink.value = Math.max(Math.sin((blinkT / 0.16) * Math.PI), pose.sleepy);

      const { x, z, heading } = pose;
      const sin = Math.sin(heading);
      const cos = Math.cos(heading);
      const sit = pose.sit;
      const amp = pose.gaitAmp;

      // Gait blends with speed instead of switching: a lateral-sequence walk,
      // then a trot (diagonal pairs), then a rotary gallop. Stride lengthens
      // and each foot spends less of the cycle on the ground.
      const speed = Math.abs(pose.speed);
      const trot = THREE.MathUtils.smoothstep(speed, 1.0, 1.8);
      const gallop = THREE.MathUtils.smoothstep(speed, 2.3, 3.2);
      const stride = THREE.MathUtils.lerp(THREE.MathUtils.lerp(0.34, 0.62, trot), 1.05, gallop);
      const duty = THREE.MathUtils.lerp(THREE.MathUtils.lerp(0.64, 0.46, trot), 0.36, gallop);
      const pace = Math.max(speed, Math.abs(pose.turn) * 0.1);
      gaitPhase = (gaitPhase + (pace / stride) * dt) % 1;
      const cycle = gaitPhase * Math.PI * 2;

      // Ground under the front and hind feet sets pitch and height.
      const gf = ground(x + sin * 0.13, z + cos * 0.13);
      const gh = ground(x - sin * 0.13, z - cos * 0.13);
      const gl = ground(x + cos * 0.05, z - sin * 0.05);
      const gr = ground(x - cos * 0.05, z + sin * 0.05);
      const slopePitch = Math.atan2(gf - gh, 0.26);
      const roll = Math.atan2(gl - gr, 0.1) * 0.5;
      // The body dips as each foot takes weight (twice a cycle), sways toward
      // the supporting side, leans into turns, and rocks nose-to-tail in a gallop.
      const bob = amp * (-Math.abs(Math.sin(cycle)) * THREE.MathUtils.lerp(0.006, 0.012, trot) * (1 - gallop) + Math.sin(cycle) * 0.018 * gallop);
      const sway = amp * Math.sin(cycle) * 0.04 * (1 - trot);
      const lean = THREE.MathUtils.clamp(-pose.turn * speed * 0.05, -0.25, 0.25);
      const rock = Math.cos(cycle) * 0.12 * gallop * amp;
      const pitch = slopePitch + sit * 0.55 + pose.airPitch + rock;
      const height = (gf + gh) / 2 + 0.2 - sit * 0.05 + bob + pose.air;
      root.position.set(x - sin * sit * 0.03, height, z - cos * sit * 0.03);
      root.rotation.set(-pitch, heading, (roll + sway + lean) * (1 - sit));
      root.updateMatrix();

      // Head: leads into turns, watches, and stays steady while the body
      // bobs, the way a cat's head floats as it walks.
      neck.rotation.y = THREE.MathUtils.clamp(pose.look, -0.9, 0.9);
      neck.rotation.x = pitch * 0.85 - pose.lookUp - bob * 3 - 0.08 * amp * (1 - gallop);
      neck.rotation.z = pose.tilt - (sway + lean) * 0.8;
      whisk.update(dt, time, {
        // Forward and fanned when watching something, swept back at speed.
        alert: pose.swish,
        back: THREE.MathUtils.smoothstep(speed, 0.8, 3) + pose.air * 2,
        turn: neck.rotation.y + heading,
        height: height + neck.rotation.x * 0.05,
        sniff: pose.swish * (1 - amp),
        // Unlit lines: tint them by the light so they never glow.
        light: 0.18 + light.direct * 0.55 + (1 - light.night) * 0.15,
      });

      // Legs. Offsets per gait (fraction of the cycle each foot lags).
      const offsets = {};
      for (const name of ["lf", "rf", "lh", "rh"])
        offsets[name] = THREE.MathUtils.lerp(THREE.MathUtils.lerp(WALK[name], TROT[name], trot), GALLOP[name], gallop);
      // Feet are placed in coast metres (the parent's frame). In stance a
      // paw stays exactly where it landed; in swing it arcs to where it will
      // be under the hip at mid-stance, so nothing slides, even in turns.
      inverse.copy(root.matrix).invert();
      const stanceReach = stride * duty * 0.5;
      for (const leg of legs) {
        const { spec } = leg;
        const q = (((gaitPhase + offsets[spec.name]) % 1) + 1) % 1;
        // Neutral: under the hip (sitting tucks the hind feet forward).
        let footZ = spec.hip[2] + (spec.front ? 0.012 : 0.03);
        if (!spec.front) footZ += sit * 0.12;
        else footZ -= sit * 0.01;
        const footX = spec.hip[0] * 1.02;
        const nx = x + sin * footZ + cos * footX;
        const nz = z + cos * footZ - sin * footX;
        if (!leg.plant) leg.plant = { x: nx, z: nz, fromX: nx, fromZ: nz };
        const stance = q < duty;
        let wx, wz, lift = 0;
        leg.swing = 0;
        if (amp < 0.04 || pose.air > 0.01) {
          // Standing still (or airborne): settle toward the neutral stance.
          const k = Math.min(1, dt * 6);
          leg.plant.x += (nx - leg.plant.x) * k;
          leg.plant.z += (nz - leg.plant.z) * k;
          wx = leg.plant.x;
          wz = leg.plant.z;
        } else if (stance) {
          if (!leg.stance) {
            // Touchdown: leave a print and a footstep.
            if (amp > 0.25) onStep(spec.name, leg.plant.x, leg.plant.z, heading, spec.front);
            leg.stance = true;
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
          // Aim half a stance ahead of where the hip is now; the target
          // tracks the hip, so the paw lands where mid-stance will be under it.
          const ahead = stanceReach * amp;
          leg.plant.x = nx + sin * ahead;
          leg.plant.z = nz + cos * ahead;
          // Paw lifts back and up first, then reaches and sets down softly.
          const e = t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t);
          wx = leg.plant.fromX + (leg.plant.x - leg.plant.fromX) * e;
          wz = leg.plant.fromZ + (leg.plant.z - leg.plant.fromZ) * e;
          lift = Math.sin(Math.PI * Math.pow(t, 0.8)) * THREE.MathUtils.lerp(0.028, 0.055, trot) * Math.min(1, amp * 2);
          leg.swing = Math.sin(Math.PI * Math.min(1, t * 1.3)) * Math.min(1, amp * 2);
        }
        let wy = ground(wx, wz) + PAW_LIFT + lift;
        if (pose.air > 0.01) wy = height - (spec.front ? 0.12 : 0.1) + pose.air * 0.1;
        // Paw target into the hip's frame.
        local.set(wx, wy, wz).applyMatrix4(inverse);
        local.x -= spec.hip[0];
        local.y -= spec.hip[1];
        local.z -= spec.hip[2];
        // The wrist (or hock) flexes as the foot lifts, trailing the paw.
        const flex = leg.swing * (spec.front ? 1.3 : 0.55) + pose.air * (spec.front ? 1.4 : 0.8);
        solveLeg(leg, local.z, local.y, flex);
      }

      // Tail spine: up and gently question-marked while walking, wrapped
      // round the paws when sitting, swishing with mood.
      // Tail: each segment's angles are a damped spring toward a pose
      // (carried in a curve when walking, a low J when standing, wrapped
      // round the paws when sitting). The body's own motion drives it: a
      // turn leaves the tail behind, a bob or landing makes it bounce, and
      // looser springs toward the tip make the motion flow down its length.
      const swish = pose.swish;
      const P = uniforms.tailP.value;
      const N = uniforms.tailN.value;
      const B = uniforms.tailB.value;
      P[0].set(0, 0.042, -0.162);
      const length = 0.31;
      const step = Math.min(dt, 1 / 30);
      if (!lastHeight) lastHeight = height;
      const lift = (height - lastHeight) / Math.max(step, 1e-4);
      const liftAccel = step > 0 ? (lift - lastLift) / step : 0;
      lastLift = lift;
      lastHeight = height;
      const pitchRate = step > 0 ? (pitch - lastPitch) / step : 0;
      lastPitch = pitch;
      for (let i = 0; i < TAIL_RINGS; i++) {
        const s = i / TAIL_RINGS;
        const carried = 0.45 + THREE.MathUtils.smoothstep(s, 0, 0.55) * 0.85 + THREE.MathUtils.smoothstep(s, 0.72, 1) * 0.4;
        const resting = -0.5 + THREE.MathUtils.smoothstep(s, 0.3, 1) * 1.05;
        const up = THREE.MathUtils.lerp(resting, carried, THREE.MathUtils.smoothstep(amp, 0.1, 0.6));
        // Sitting: down to the floor, then along it (the body is pitched up
        // ~0.55 rad, so level in the world is about −0.55 here).
        const down = THREE.MathUtils.lerp(-1.0, -0.58, THREE.MathUtils.smoothstep(s, 0.05, 0.25));
        const targetE = THREE.MathUtils.lerp(up, down, sit) + pose.air * 1.2;
        // A slow, lazy sway (quicker and wider when the cat is intent).
        const targetS =
          Math.sin(time * (0.9 + swish * 2.5) - s * 2.6) * s * s * (0.22 + swish * 0.55) + sit * s * 2.2;
        if (step > 0) {
          const k = THREE.MathUtils.lerp(110, 16, s);
          const c = 2 * Math.sqrt(k) * 0.4;
          // Inertia: body rotation and vertical jolts, felt more toward the tip.
          tailSide[i] -= pose.turn * step * (0.25 + s * 0.6);
          tailElev[i] -= pitchRate * step * (0.3 + s * 0.5);
          tailElevV[i] += (k * (targetE - tailElev[i]) - c * tailElevV[i] - THREE.MathUtils.clamp(liftAccel, -40, 40) * s * 0.6) * step;
          tailSideV[i] += (k * (targetS - tailSide[i]) - c * tailSideV[i]) * step;
          tailElev[i] += tailElevV[i] * step;
          tailSide[i] += tailSideV[i] * step;
        } else {
          tailElev[i] = targetE;
          tailSide[i] = targetS;
        }
        const elevation = tailElev[i];
        const side = tailSide[i];
        tailDir.set(
          Math.sin(side) * Math.cos(elevation),
          Math.sin(elevation),
          -Math.cos(side) * Math.cos(elevation),
        );
        P[i + 1].copy(P[i]).addScaledVector(tailDir, length / TAIL_RINGS);
        // The ground pushes the tail up rather than letting it sink in.
        worldPoint.copy(P[i + 1]).applyMatrix4(root.matrix);
        const floor = ground(worldPoint.x, worldPoint.z) + 0.014;
        if (worldPoint.y < floor) {
          const push = Math.min(0.6, (floor - worldPoint.y) / (length / TAIL_RINGS));
          tailElev[i] += push;
          tailElevV[i] = Math.max(0, tailElevV[i]);
          tailDir.set(
            Math.sin(tailSide[i]) * Math.cos(tailElev[i]),
            Math.sin(tailElev[i]),
            -Math.cos(tailSide[i]) * Math.cos(tailElev[i]),
          );
          P[i + 1].copy(P[i]).addScaledVector(tailDir, length / TAIL_RINGS);
        }
      }
      // Parallel-transported frames along the spine.
      for (let i = 0; i <= TAIL_RINGS; i++) {
        const a = P[Math.max(0, i - 1)];
        const b = P[Math.min(TAIL_RINGS, i + 1)];
        temp.subVectors(b, a).normalize();
        const n = i === 0 ? N[0].set(1, 0, 0) : N[i].copy(N[i - 1]);
        n.addScaledVector(temp, -n.dot(temp)).normalize();
        B[i].crossVectors(temp, n);
      }

      // Contact shadow, stretched a little away from the sun.
      blob.position.set(x - sin * sit * 0.05, (gf + gh) / 2 + 0.006, z - cos * sit * 0.05);
      blob.position.x -= light.sunX * 0.06;
      blob.position.z -= light.sunZ * 0.06;
      blob.rotation.y = heading;
      blob.scale.set(0.26, 1, 0.5 - sit * 0.1);
      blob.material.uniforms.strength.value = 0.35 + light.direct * 0.35 - pose.air * 1.5;
    },
    dispose() {
      root.traverse((o) => o.geometry?.dispose());
      fur.dispose();
      tailFur.dispose();
      shells.forEach((m) => m.dispose());
      root.traverse((o) => o.isLineSegments && o.material.dispose());
      ghost.dispose();
      blob.geometry.dispose();
      blob.material.dispose();
      prints.dispose();
    },
  };
}

// Three bones in the leg's sagittal plane, hip at the origin, paw target at
// (forward f, height y). The last bone keeps its lean (less when flexed),
// which places the wrist/hock; two-bone IK solves the rest. Angles are from
// straight down, positive forward; each joint's rotation is the difference.
function solveLeg(leg, f, y, flex) {
  const [a, b, c] = leg.spec.bones;
  const lean = leg.spec.lean - flex;
  const jf = f - Math.sin(lean) * c;
  const jy = y + Math.cos(lean) * c;
  const reach = Math.hypot(jf, jy);
  const d = Math.min(Math.max(reach, 0.02), a + b - 1e-4);
  const toward = Math.atan2(jf, -jy);
  const bend = Math.acos(THREE.MathUtils.clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1));
  // Front elbows point back; hind knees point forward.
  const upperAngle = leg.spec.front ? toward - bend : toward + bend;
  const scale = reach > d ? d / reach : 1;
  const kneeF = Math.sin(upperAngle) * a;
  const kneeY = -Math.cos(upperAngle) * a;
  const lowerAngle = Math.atan2(jf * scale - kneeF, -(jy * scale - kneeY));
  leg.hip.rotation.x = -upperAngle;
  leg.knee.rotation.x = -(lowerAngle - upperAngle);
  leg.hock.rotation.x = -(lean - lowerAngle);
  // Paws stay level with the body, curling back as the wrist flexes.
  leg.ankle.rotation.x = lean - flex * 0.6;
}

// ---------------------------------------------------------------------------
// Coat shader

// The tail's silhouette needs the same spine bend as the tail.
function ghostTail(ghost, uniforms) {
  const material = ghost.clone();
  material.customProgramCacheKey = () => "cat-ghost-tail";
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("void main() {", `${TAIL_UNIFORMS}\nvoid main() {`)
      .replace("#include <begin_vertex>", TAIL_BEGIN);
  };
  return material;
}

const TAIL_UNIFORMS = `uniform vec3 tailP[${TAIL_RINGS + 1}];
uniform vec3 tailN[${TAIL_RINGS + 1}];
uniform vec3 tailB[${TAIL_RINGS + 1}];`;
const TAIL_BEGIN = `int ring = int( position.z + 0.5 );
vec3 transformed = tailP[ ring ] + tailN[ ring ] * position.x + tailB[ ring ] * position.y;`;

function coatMaterial(uniforms, { tail: isTail = false, shell = 0 } = {}) {
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.88 });
  // Distinct programs: three caches by onBeforeCompile's source text.
  material.customProgramCacheKey = () => `cat-coat-${isTail}-${shell}`;
  if (shell) material.alphaToCoverage = false;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        "void main() {",
        /* glsl */ `attribute vec4 coat;
        varying vec4 vCoat;
        ${isTail ? TAIL_UNIFORMS : ""}
        void main() {
          vCoat = coat;`,
      );
    if (isTail)
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <beginnormal_vertex>",
          /* glsl */ `int ring = int( position.z + 0.5 );
          vec3 objectNormal = normalize( tailN[ ring ] * position.x + tailB[ ring ] * position.y + 1e-5 );`,
        )
        .replace("#include <begin_vertex>", TAIL_BEGIN.replace("int ring = int( position.z + 0.5 );\n", ""));
    if (shell)
      // Push each shell out along the normal, drooping slightly with length.
      shader.vertexShader = shader.vertexShader.replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        transformed += normalize( objectNormal ) * ${(shell * FUR_LENGTH).toFixed(5)};
        transformed.y -= ${(shell * shell * FUR_LENGTH * 0.25).toFixed(5)};`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "void main() {",
        /* glsl */ `varying vec4 vCoat;
        uniform float catBlink;
        uniform float catPupil;
        uniform float catEyeshine;
        float cHash( vec3 p ) {
          p = fract( p * 0.3183099 + 0.1 );
          p *= 17.0;
          return fract( p.x * p.y * p.z * ( p.x + p.y + p.z ) );
        }
        float cNoise( vec3 x ) {
          vec3 i = floor( x );
          vec3 f = fract( x );
          f = f * f * ( 3.0 - 2.0 * f );
          return mix( mix( mix( cHash( i ), cHash( i + vec3( 1, 0, 0 ) ), f.x ),
                           mix( cHash( i + vec3( 0, 1, 0 ) ), cHash( i + vec3( 1, 1, 0 ) ), f.x ), f.y ),
                      mix( mix( cHash( i + vec3( 0, 0, 1 ) ), cHash( i + vec3( 1, 0, 1 ) ), f.x ),
                           mix( cHash( i + vec3( 0, 1, 1 ) ), cHash( i + vec3( 1, 1, 1 ) ), f.x ), f.y ), f.z );
        }
        vec3 lin( vec3 c ) { return pow( c, vec3( 2.2 ) ); }
        void main() {`,
      )
      .replace(
        "#include <color_fragment>",
        /* glsl */ `#include <color_fragment>
        vec3 cp = vCoat.xyz;
        float part = floor( vCoat.w + 0.5 );
        // Brown mackerel tabby. The ground colour is agouti: every hair is
        // banded, so up close it reads as a warm grey-brown salt-and-pepper,
        // redder on the flanks. Markings are near-black with soft, furry
        // edges; the chin, chest, belly and socks are cream.
        vec3 agoutiLight = lin( vec3( 0.7, 0.56, 0.38 ) );
        vec3 agoutiDark = lin( vec3( 0.5, 0.38, 0.26 ) );
        vec3 stripe = lin( vec3( 0.12, 0.09, 0.065 ) );
        vec3 cream = lin( vec3( 0.86, 0.79, 0.67 ) );
        vec3 pink = lin( vec3( 0.86, 0.56, 0.54 ) );
        float tick = cNoise( cp * 700.0 ) * 0.4 + cNoise( cp * 240.0 ) * 0.6;
        vec3 agouti = mix( agoutiDark, agoutiLight, smoothstep( 0.15, 0.85, tick ) );
        vec3 coatColour = agouti;
        float dark = 0.0;
        float pale = 0.0;
        float gloss = 0.0;
        vec3 glow = vec3( 0.0 );
        // Soft-edged band: 1 inside, feathered by the fur over ~2 mm.
        #define BAND( v, width ) ( 1.0 - smoothstep( ( width ) * 0.55, ( width ), abs( v ) ) )
        if ( part < 0.5 ) {
          float flank = smoothstep( 0.09, -0.02, cp.y );
          // Warm, almost rufous lower flanks and haunches.
          coatColour = mix( coatColour, coatColour * vec3( 1.18, 0.98, 0.78 ), flank * 0.7 );
          // Three dorsal lines down the spine, wavering, merging at the rump.
          float wob = ( cNoise( cp * vec3( 10.0, 10.0, 26.0 ) ) - 0.5 ) * 0.008;
          float spine = smoothstep( 0.03, 0.07, cp.y );
          float lines = max( BAND( cp.x + wob, 0.005 ), BAND( abs( cp.x + wob ) - 0.014, 0.0035 ) * 0.8 );
          dark = lines * spine * 0.85;
          // Mackerel stripes: narrow, many, falling from the spine and sweeping
          // back as they go down the flank; they fork, break into dashes, and
          // fade into spots toward the belly.
          float warp = ( cNoise( cp * 18.0 ) - 0.5 ) * 3.2 + ( cNoise( cp * 55.0 ) - 0.5 ) * 1.1;
          float wave = cp.z * 200.0 - ( 0.08 - cp.y ) * 40.0 + warp;
          float stripeLine = abs( fract( wave / 6.2832 ) - 0.5 ) * 2.0;
          float width = mix( 0.2, 0.34, cNoise( cp * vec3( 20.0, 40.0, 30.0 ) ) );
          float dash = smoothstep( 0.18, 0.42, cNoise( cp * vec3( 30.0, 70.0, 45.0 ) ) );
          float mackerel = ( 1.0 - smoothstep( width * 0.6, width, stripeLine ) ) * dash;
          mackerel *= smoothstep( -0.055, 0.0, cp.y ) * ( 1.0 - spine * 0.5 );
          // Haunch bars run more horizontally round the thigh.
          float haunch = smoothstep( -0.08, -0.13, cp.z );
          float bars = BAND( fract( cp.y * 32.0 + cp.z * 12.0 + warp * 0.2 ) - 0.5, 0.2 ) * haunch * smoothstep( -0.06, -0.02, cp.y );
          dark = max( dark, max( mackerel * ( 1.0 - haunch ), bars ) );
          // Belly: cream with scattered dark spots; necklaces on the chest.
          float belly = smoothstep( -0.03, -0.065, cp.y );
          float chest = smoothstep( 0.1, 0.17, cp.z ) * smoothstep( 0.0, -0.05, cp.y );
          pale = max( belly, chest * smoothstep( 0.02, 0.0, abs( cp.x ) ) * 0.6 );
          float spots = smoothstep( 0.62, 0.72, cNoise( cp * 90.0 ) ) * belly * smoothstep( 0.12, -0.1, cp.z );
          float necklace = BAND( fract( ( cp.z - cp.y * 0.6 ) * 38.0 ) - 0.5, 0.16 ) * chest * smoothstep( 0.2, 0.14, cp.z );
          dark = max( dark * ( 1.0 - belly ), max( spots, necklace ) );
        } else if ( part < 1.5 ) {
          // Head: the forehead "M" and the lines running back over the crown,
          // a mascara line from each outer eye corner, darker ear backs, and
          // pale fur round the eyes and on the muzzle, chin and throat.
          float front = smoothstep( -0.01, 0.02, cp.z );
          float crown = smoothstep( 0.018, 0.045, cp.y );
          float m = BAND( fract( cp.x * 58.0 + 0.5 + sin( cp.y * 120.0 ) * 0.12 ) - 0.5, 0.26 ) * smoothstep( 0.04, 0.02, abs( cp.x ) );
          dark = m * crown * mix( 0.6, 1.0, front );
          float temple = BAND( abs( cp.x ) - 0.043 + cp.y * 0.3, 0.005 ) * smoothstep( 0.0, 0.03, cp.y );
          dark = max( dark, temple );
          vec2 eyeCorner = vec2( abs( cp.x ) - 0.036, cp.y - 0.004 );
          float mascara = BAND( eyeCorner.y + eyeCorner.x * 0.35, 0.0038 ) * smoothstep( -0.002, 0.004, eyeCorner.x ) * smoothstep( 0.03, 0.0, eyeCorner.x );
          float cheekLine = BAND( cp.y + 0.013 + ( abs( cp.x ) - 0.04 ) * 0.6, 0.0035 ) * smoothstep( 0.03, 0.045, abs( cp.x ) );
          dark = max( dark, max( mascara, cheekLine * 0.85 ) );
          float eyeRing = BAND( length( vec2( abs( cp.x ) - 0.024, ( cp.y - 0.009 ) * 1.2 ) ) - 0.018, 0.006 ) * front;
          pale = max( eyeRing * 0.35, smoothstep( -0.012, -0.03, cp.y ) * smoothstep( 0.015, 0.04, cp.z ) );
          pale = max( pale, smoothstep( -0.03, -0.05, cp.y ) );
          dark = max( dark, smoothstep( -0.012, -0.03, cp.z ) * smoothstep( 0.03, 0.05, cp.y ) * 0.7 );
        } else if ( part < 2.5 ) {
          pale = 1.0;
        } else if ( part < 3.5 ) {
          coatColour = lin( vec3( 0.82, 0.48, 0.47 ) );
        } else if ( part < 4.5 ) {
          coatColour = mix( pink, coatColour, smoothstep( 0.2, 0.9, cp.x ) );
          dark = smoothstep( 0.8, 1.0, cp.y ) * 0.8;
        } else if ( part < 5.5 ) {
          // Eye: amber-green iris, a slit pupil that opens in the dark, and
          // lids (fur) that close from above for a blink.
          vec3 e = normalize( cp );
          float iris = smoothstep( 0.6, 0.72, e.z );
          vec3 irisColour = mix( lin( vec3( 0.55, 0.62, 0.16 ) ), lin( vec3( 0.86, 0.66, 0.2 ) ), smoothstep( 0.2, 0.75, length( e.xy ) ) );
          irisColour *= 0.8 + cNoise( e * 40.0 ) * 0.4;
          float pupil = 1.0 - smoothstep( 0.9, 1.1, length( vec2( e.x / catPupil, e.y / 0.62 ) ) * 2.6 );
          coatColour = mix( lin( vec3( 0.05, 0.04, 0.03 ) ), irisColour, iris ) * ( 1.0 - pupil * 0.96 );
          glow = lin( vec3( 0.35, 0.9, 0.55 ) ) * iris * ( 1.0 - pupil * 0.6 ) * catEyeshine * 0.35;
          gloss = 1.0;
          float lid = mix( 1.2, -1.2, catBlink );
          if ( e.y > lid ) { coatColour = agouti * 0.8; gloss = 0.0; glow = vec3( 0.0 ); }
        } else if ( part < 6.5 ) {
          // Legs: irregular bars, bolder toward the paws, over a paler
          // inner side (the side facing the other leg is -x or +x; bars
          // fade where the leg's front faces the camera less).
          float warp = ( cNoise( cp * 60.0 ) - 0.5 ) * 0.25;
          float barLine = abs( fract( cp.y * 42.0 + cp.x * 6.0 + warp ) - 0.5 ) * 2.0;
          float barWidth = mix( 0.2, 0.34, cNoise( cp * vec3( 40.0, 90.0, 40.0 ) ) );
          dark = ( 1.0 - smoothstep( barWidth * 0.5, barWidth, barLine ) ) * 0.7;
          dark *= smoothstep( 0.2, 0.55, cNoise( cp * vec3( 50.0, 20.0, 50.0 ) ) + 0.25 );
          pale = smoothstep( 0.0, -0.012, cp.z ) * 0.35;
        } else if ( part < 7.5 ) {
          // Paws: the coat colour, a little paler on the toes.
          pale = 0.25 + smoothstep( 0.012, 0.024, cp.z ) * 0.2;
        } else {
          // Tail: rings, broader toward the tip, a dark line along the top,
          // and a black tip.
          float ring = abs( fract( cp.x * ( 7.0 + cp.x * 2.0 ) ) - 0.5 ) * 2.0;
          dark = 1.0 - smoothstep( 0.32, 0.55 + cp.x * 0.15, ring );
          dark = max( dark, BAND( fract( cp.y + 0.25 ) - 0.5, 0.12 ) * 0.7 );
          dark = max( dark, smoothstep( 0.87, 0.93, cp.x ) );
        }
        #undef BAND
        if ( part < 2.5 || part > 5.5 ) {
          coatColour = mix( coatColour, stripe * ( 0.8 + tick * 0.4 ), clamp( dark, 0.0, 1.0 ) );
          coatColour = mix( coatColour, cream * ( 0.9 + tick * 0.15 ), clamp( pale, 0.0, 1.0 ) );
        }
        diffuseColor.rgb = coatColour;
        ${shell ? `
        // Fur strands: each shell keeps a thinning subset of ~2 mm strand
        // cells, brighter toward the tips; eyes and nose have none.
        if ( part > 2.5 && part < 5.5 ) discard;
        vec3 strandCell = floor( cp * 420.0 + vec3( 0.0, cNoise( cp * 90.0 ) * 2.0, 0.0 ) );
        if ( cHash( strandCell ) < ${(0.12 + shell * 0.78).toFixed(3)} ) discard;
        // Agouti hairs: pale band near the tip, dark tip on the last shell.
        // Tips catch a little more light than the roots.
        diffuseColor.rgb *= ${(0.98 + shell * 0.08).toFixed(3)};` : `
        // Under the fur the coat is a touch darker (self-shadowed roots).
        if ( part < 2.5 || part > 5.5 ) diffuseColor.rgb *= 0.86;`}`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        "#include <roughnessmap_fragment>\n roughnessFactor = mix( roughnessFactor, 0.12, gloss );",
      )
      .replace(
        "#include <emissivemap_fragment>",
        "#include <emissivemap_fragment>\n totalEmissiveRadiance += glow;",
      )
      .replace(
        "#include <lights_fragment_end>",
        /* glsl */ `#include <lights_fragment_end>
        // Fur scatters light round its silhouette: a soft rim of sky and sun.
        float rim = pow( 1.0 - clamp( dot( normal, normalize( vViewPosition ) ), 0.0, 1.0 ), 3.0 ) * ( 1.0 - gloss );
        reflectedLight.indirectDiffuse += reflectedLight.indirectDiffuse * rim * 0.9;
        reflectedLight.directDiffuse += reflectedLight.directDiffuse * rim * 0.4;`,
      );
  };
  return material;
}

// ---------------------------------------------------------------------------
// Geometry. Each part carries `coat` = (pattern coordinates, part id).

// Parts stay indexed and are welded at their seams, so normals come out
// smooth (non-indexed parts shaded as flat facets).
function tag(geometry, part, coords = null) {
  const g = geometry;
  g.deleteAttribute("uv");
  if (g.attributes.normal) g.deleteAttribute("normal");
  const position = g.attributes.position;
  const coat = new Float32Array(position.count * 4);
  for (let i = 0; i < position.count; i++) {
    const c = coords ? coords(position.getX(i), position.getY(i), position.getZ(i)) : [position.getX(i), position.getY(i), position.getZ(i)];
    coat.set([c[0], c[1], c[2], part], i * 4);
  }
  g.setAttribute("coat", new THREE.BufferAttribute(coat, 4));
  const welded = mergeVertices(g, 1e-5);
  return welded.index ? welded : g;
}

function ellipsoid(r, [x, y, z], [sx, sy, sz], part, segments = [24, 16]) {
  const g = new THREE.SphereGeometry(r, segments[0], segments[1]);
  g.scale(sx, sy, sz);
  g.translate(x, y, z);
  return tag(g, part);
}

function finish(parts) {
  const merged = mergeGeometries(parts);
  merged.computeVertexNormals();
  merged.computeBoundingSphere();
  return merged;
}

// Sweep elliptical sections along the spine (z forward), interpolated with
// Catmull-Rom so the outline flows: each section is [z, centre y, half-width,
// half-height, belly flattening].
function sweep(sections, rings = 56, radial = 30) {
  const at = (t, k) => {
    const f = t * (sections.length - 1);
    const i = Math.min(sections.length - 2, Math.floor(f));
    const u = f - i;
    const p0 = sections[Math.max(0, i - 1)][k];
    const p1 = sections[i][k];
    const p2 = sections[i + 1][k];
    const p3 = sections[Math.min(sections.length - 1, i + 2)][k];
    return 0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u * u * u);
  };
  const positions = [];
  const index = [];
  for (let r = 0; r <= rings; r++) {
    const t = r / rings;
    const z = at(t, 0);
    const cy = at(t, 1);
    // A long, round rear cap (the rump) and a short one at the neck.
    const rear = Math.min(1, t / 0.11);
    const front = Math.min(1, (1 - t) / 0.04);
    const cap = Math.sqrt(1 - (1 - rear) * (1 - rear)) * Math.sqrt(1 - (1 - front) * (1 - front));
    const rx = at(t, 2) * cap;
    const ry = at(t, 3) * cap;
    const flat = at(t, 4);
    for (let k = 0; k <= radial; k++) {
      const a = (k / radial) * Math.PI * 2;
      const sy = Math.sin(a);
      // Narrower over the spine than through the flanks: no box top.
      positions.push(Math.cos(a) * rx * (1 - 0.2 * Math.max(0, sy) ** 2), cy + sy * ry * (sy < 0 ? flat : 1), z);
    }
  }
  for (let r = 0; r < rings; r++)
    for (let k = 0; k < radial; k++) {
      const a = r * (radial + 1) + k;
      const b = a + radial + 1;
      index.push(a, a + 1, b, a + 1, b + 1, b);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(index);
  return g;
}

function bodyGeometry() {
  // Rump, haunches, a tucked waist, the deep ribcage and chest, then the
  // neck rising into the head. Real cats are narrow seen from above and
  // deep seen from the side.
  // Proportions of a domestic cat: ~45 cm chest to rump, ~13 cm deep,
  // ~10 cm wide, so about 3.5× as long as deep, standing ~25 cm at the
  // shoulder with daylight under the belly.
  // The rump slopes down into the tail, the belly tucks up in front of the
  // thighs, and the chest is deepest behind the front legs.
  const trunk = sweep([
    // The rump rounds off ~4–5 cm behind the hip joints (z −0.125).
    [-0.178, 0.008, 0.03, 0.034, 0.9],
    [-0.16, 0.01, 0.044, 0.05, 0.9],
    [-0.125, 0.012, 0.051, 0.059, 0.86],
    [-0.075, 0.017, 0.044, 0.053, 0.78],
    [-0.02, 0.016, 0.045, 0.056, 0.92],
    [0.05, 0.012, 0.049, 0.064, 1.05],
    [0.1, 0.01, 0.047, 0.066, 1.08],
    [0.15, 0.03, 0.042, 0.058, 1.0],
    [0.19, 0.062, 0.037, 0.047, 1.0],
    [0.23, 0.094, 0.033, 0.038, 1.0],
  ]);
  return finish([
    tag(trunk, BODY),
    // Shoulder blades and haunch muscle under the coat.
    ellipsoid(1, [0.022, 0.028, 0.11], [0.024, 0.038, 0.038], BODY),
    ellipsoid(1, [-0.022, 0.028, 0.11], [0.024, 0.038, 0.038], BODY),
    ellipsoid(1, [0.028, 0.0, -0.118], [0.028, 0.048, 0.044], BODY),
    ellipsoid(1, [-0.028, 0.0, -0.118], [0.028, 0.048, 0.044], BODY),
  ]);
}

function headGeometry() {
  const parts = [
    // Cranium, broad cheeks, whisker pads, chin and a small nose leather.
    ellipsoid(1, [0, 0.004, -0.004], [0.062, 0.054, 0.058], HEAD, [30, 22]),
    ellipsoid(1, [0.028, -0.016, 0.014], [0.034, 0.03, 0.034], HEAD),
    ellipsoid(1, [-0.028, -0.016, 0.014], [0.034, 0.03, 0.034], HEAD),
    ellipsoid(1, [0.011, -0.024, 0.047], [0.016, 0.014, 0.016], CREAM),
    ellipsoid(1, [-0.011, -0.024, 0.047], [0.016, 0.014, 0.016], CREAM),
    ellipsoid(1, [0, -0.012, 0.047], [0.016, 0.014, 0.018], HEAD),
    ellipsoid(1, [0, -0.038, 0.034], [0.017, 0.011, 0.017], CREAM),
    ellipsoid(1, [0, -0.008, 0.062], [0.0075, 0.005, 0.005], NOSE, [10, 6]),
  ];
  for (const side of [-1, 1]) {
    // Eyes: set into the face (flush with it, not bulging), almond-shaped,
    // angled slightly up at the outer corner. Coordinates are relative to
    // the eye centre, before the almond squash.
    const centre = [side * 0.023, 0.01, 0.041];
    const eye = new THREE.SphereGeometry(0.0118, 18, 12);
    eye.scale(1.15, 0.78, 0.8);
    eye.rotateZ(side * 0.15);
    eye.translate(...centre);
    parts.push(tag(eye, EYE, (x, y, z) => [x - centre[0], y - centre[1], z - centre[2]]));
    // Ears: tall, wide-based, rounded at the tip, pink inside.
    for (const inner of [false, true]) {
      const cone = new THREE.ConeGeometry(inner ? 0.02 : 0.028, inner ? 0.04 : 0.05, inner ? 10 : 14, 4);
      cone.translate(0, 0.025, 0);
      const positions = cone.attributes.position;
      for (let i = 0; i < positions.count; i++) {
        // Round the tip.
        const y = positions.getY(i);
        const k = 1 + Math.max(0, y / 0.05 - 0.7) * 0.8;
        positions.setX(i, positions.getX(i) * k);
      }
      cone.scale(1, 1, inner ? 0.35 : 0.55);
      const ear = tag(cone, inner ? EAR : HEAD, (x, y, z) => [Math.abs(x) / 0.028, y / 0.05, z]);
      ear.rotateZ(-side * 0.42);
      ear.rotateX(-0.18);
      ear.rotateY(side * 0.25);
      ear.translate(side * 0.034, 0.036, inner ? 0.0 : -0.008);
      parts.push(ear);
    }
  }
  return finish(parts);
}

// A tapered tube with rounded ends, hanging down -y from the joint.
function limbGeometry(r0, r1, length) {
  const profile = [];
  for (let i = 0; i <= 6; i++) {
    const a = (i / 6) * Math.PI * 0.5;
    profile.push(new THREE.Vector2(Math.max(1e-4, Math.sin(a) * r1), -length - Math.cos(a) * r1 * 0.8));
  }
  for (let i = 0; i <= 6; i++) {
    const a = (i / 6) * Math.PI * 0.5;
    profile.push(new THREE.Vector2(Math.max(1e-4, Math.cos(a) * r0), Math.sin(a) * r0 * 0.8));
  }
  profile.sort((p, q) => p.y - q.y);
  const g = new THREE.LatheGeometry(profile, 16);
  return finish([tag(g, LEG)]);
}

// The upper bones carry the muscle: a broad thigh that merges into the
// haunch, and the shoulder/upper arm against the chest.
function thighGeometry(length) {
  return finish([
    // A teardrop from hip to knee, as deep as the flank above it.
    ellipsoid(1, [0, -length * 0.4, 0.01], [0.027, length * 0.66, 0.05], LEG, [20, 16]),
    tag(new THREE.LatheGeometry(limbProfile(0.02, 0.016, length), 14), LEG),
  ]);
}

function humerusGeometry(length) {
  return finish([
    ellipsoid(1, [0, -length * 0.4, -0.004], [0.024, length * 0.6, 0.03], LEG, [16, 12]),
    tag(new THREE.LatheGeometry(limbProfile(0.018, 0.016, length), 14), LEG),
  ]);
}

function limbProfile(r0, r1, length) {
  const profile = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    profile.push(new THREE.Vector2(Math.max(1e-4, (r1 + (r0 - r1) * t) * Math.sin(Math.min(1, Math.min(t, 1 - t) * 6 + 0.2) * Math.PI * 0.5)), -length + t * length));
  }
  return profile;
}

// Whiskers: four rows a side from the whisker pads, plus two brows. Each is
// a short bent line rebuilt every frame (~70 vertices): the pads fan them
// forward when the cat is interested and flatten them back when it runs,
// each side twitches on its own, a sniff flutters them, and the tips lag
// behind quick head turns and bend back in the airflow.
function whiskers() {
  const SEGMENTS = 4;
  const strands = [];
  for (const side of [-1, 1]) {
    for (let row = 0; row < 4; row++)
      strands.push({
        side,
        root: new THREE.Vector3(side * 0.014, -0.02 - row * 0.004, 0.056),
        spread: 0.9 + row * 0.12,
        droop: -0.12 - row * 0.1,
        length: 0.07 - row * 0.004,
        phase: Math.random() * 6.28,
      });
    // Two short brow hairs above each eye.
    for (let k = 0; k < 2; k++)
      strands.push({ side, root: new THREE.Vector3(side * (0.017 + k * 0.006), 0.022, 0.044), spread: 0.75 + k * 0.2, droop: 0.35, length: 0.022 - k * 0.004, phase: Math.random() * 6.28 });
  }
  const positions = new Float32Array(strands.length * SEGMENTS * 2 * 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  const lines = new THREE.LineSegments(
    geometry,
    new THREE.LineBasicMaterial({ color: new THREE.Color(0.9, 0.88, 0.82), transparent: true, opacity: 0.38, depthWrite: false }),
  );
  lines.frustumCulled = false;
  lines.renderOrder = 12;
  const twitch = { "-1": 0, 1: 0 };
  const timer = { "-1": 1, 1: 2.5 };
  let lag = 0;
  let lastTurn = null;
  // Springs for the tips' inertia: vertical (bounce) and sideways (turns).
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
      // Fan angle from straight ahead (0) to straight back (π/2 + spread).
      const flutter = Math.sin(time * 30 + w.phase) * 0.14 * mood.sniff;
      // Each whisker drifts on its own, never quite still.
      const drift = Math.sin(time * (0.8 + w.phase * 0.07) + w.phase) * 0.07 + Math.sin(time * 2.1 + w.phase * 1.7) * 0.025;
      const fan = w.spread - mood.alert * 0.45 + mood.back * 0.7 + twitch[key] + flutter + drift;
      q.copy(w.root);
      for (let k = 1; k <= SEGMENTS; k++) {
        const t = k / SEGMENTS;
        // Tips bend back with airflow and trail the head's turn.
        const bend = fan + t * t * (mood.back * 0.5 + w.side * (lag + swing.x) * 1.5);
        const s = w.length / SEGMENTS;
        // Whiskers arc down along their length and bob with the springs;
        // a slow breath lifts and lowers them a little.
        const breath = Math.sin(time * 1.3 + w.phase * 0.2) * 0.008 + Math.sin(time * 0.9 + w.phase) * 0.004;
        p.set(
          q.x + w.side * Math.sin(bend) * s,
          q.y + (w.droop * 0.07 * (1 - mood.alert * 0.4) - t * 0.02 + (bounce.x + breath) * t * 2) / SEGMENTS,
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
      // Independent twitches: a quick flick forward, then relax.
      for (const key of ["-1", "1"]) {
        timer[key] -= dt;
        if (timer[key] < 0) {
          timer[key] = 1 + Math.random() * 3.5;
          twitch[key] = -0.45 - Math.random() * 0.3;
        }
        twitch[key] *= Math.exp(-dt * 3.5);
      }
      // Secondary motion: the tips lag head yaw, and the head's vertical
      // jolts (each footfall, a landing) set them bouncing on springs.
      const step = Math.min(dt, 1 / 30);
      if (lastTurn === null) lastTurn = mood.turn;
      if (lastHeight === null) lastHeight = mood.height;
      const turnRate = step > 0 ? Math.atan2(Math.sin(mood.turn - lastTurn), Math.cos(mood.turn - lastTurn)) / step : 0;
      lastTurn = mood.turn;
      lag += (THREE.MathUtils.clamp(-turnRate * 0.12, -0.5, 0.5) - lag) * Math.min(1, step * 8);
      const rise = step > 0 ? (mood.height - lastHeight) / step : 0;
      const accel = step > 0 ? THREE.MathUtils.clamp((rise - lastRise) / step, -30, 30) : 0;
      lastHeight = mood.height;
      lastRise = rise;
      if (step > 0) {
        bounce.v += (-260 * bounce.x - 9 * bounce.v - accel * 0.4) * step;
        bounce.x += bounce.v * step;
        swing.v += (-180 * swing.x - 8 * swing.v - turnRate * 4) * step;
        swing.x += swing.v * step;
      }
      lines.material.color.setRGB(0.95, 0.93, 0.86).multiplyScalar(mood.light);
      build(time, mood);
    },
  };
}

// A neat oval paw with four toes, cream-socked.
function pawGeometry(front) {
  const s = front ? 1 : 0.94;
  const parts = [ellipsoid(1, [0, 0.003, 0.006], [0.016 * s, 0.011, 0.021 * s], PAW, [16, 10])];
  for (const [x, z] of [[-0.011, 0.018], [-0.004, 0.024], [0.004, 0.024], [0.011, 0.018]])
    parts.push(ellipsoid(1, [x * s, 0.0, z * s], [0.0055, 0.0065, 0.0062], PAW, [10, 8]));
  return finish(parts);
}

// Rings of the tail cross-section: xy is the offset in the ring's frame,
// z the ring index (the vertex shader places it on the spine).
function tailGeometry() {
  const radial = 10;
  const positions = [];
  const coat = [];
  const index = [];
  for (let i = 0; i <= TAIL_RINGS; i++) {
    const s = i / TAIL_RINGS;
    // ~3 cm across at the root, tapering, with a rounded tip.
    const r = i === TAIL_RINGS ? 0.004 : 0.0155 * (1 - s * 0.38) - Math.max(0, s - 0.9) * 0.06;
    for (let k = 0; k <= radial; k++) {
      const a = (k / radial) * Math.PI * 2;
      positions.push(Math.cos(a) * r, Math.sin(a) * r, i);
      coat.push(s, k / radial, 0, TAIL);
    }
  }
  for (let i = 0; i < TAIL_RINGS; i++)
    for (let k = 0; k < radial; k++) {
      const a = i * (radial + 1) + k;
      const b = a + radial + 1;
      index.push(a, b, a + 1, a + 1, b, b + 1);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(positions.map(() => 0), 3));
  g.setAttribute("coat", new THREE.Float32BufferAttribute(coat, 4));
  g.setIndex(index);
  return g;
}

// ---------------------------------------------------------------------------
// Paw prints: one quad each, the pad and four toe beans drawn in the fragment
// shader and multiplied into the ground (so they darken sand in any light).
// A ring buffer; prints fade with age, fast in the swash where waves wash them.

function multiplyMaterial(body, extraVertex = "", extraFragment = "") {
  return new THREE.ShaderMaterial({
    uniforms: { strength: { value: 1 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      ${extraVertex.split("@main")[0] ?? ""}
      void main() {
        vUv = uv;
        vec4 p = vec4( position, 1.0 );
        #ifdef USE_INSTANCING
          p = instanceMatrix * p;
        #endif
        ${extraVertex.split("@main")[1] ?? ""}
        gl_Position = projectionMatrix * modelViewMatrix * p;
      }`,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      uniform float strength;
      ${extraFragment}
      void main() { ${body} }`,
    transparent: true,
    depthWrite: false,
    premultipliedAlpha: true,
    blending: THREE.MultiplyBlending,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
}

const PRINT_COUNT = 700;

function createPawPrints(parent) {
  const geometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  // born time, depth (surface), wetness
  const data = new THREE.InstancedBufferAttribute(new Float32Array(PRINT_COUNT * 3).fill(-1e4), 3);
  data.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("print", data);
  const material = multiplyMaterial(
    /* glsl */ `
      vec2 q = vUv * 2.0 - 1.0;
      float pad = length( ( q - vec2( 0.0, -0.28 ) ) / vec2( 0.44, 0.34 ) );
      float shape = 1.0 - smoothstep( 0.75, 1.0, pad );
      shape = max( shape, 1.0 - smoothstep( 0.12, 0.2, length( q - vec2( -0.46, 0.3 ) ) ) );
      shape = max( shape, 1.0 - smoothstep( 0.12, 0.2, length( q - vec2( -0.16, 0.56 ) ) ) );
      shape = max( shape, 1.0 - smoothstep( 0.12, 0.2, length( q - vec2( 0.16, 0.56 ) ) ) );
      shape = max( shape, 1.0 - smoothstep( 0.12, 0.2, length( q - vec2( 0.46, 0.3 ) ) ) );
      float a = shape * vFade;
      vec3 tint = mix( vec3( 0.72, 0.68, 0.62 ), vec3( 0.62, 0.62, 0.64 ), vWet );
      gl_FragColor = vec4( mix( vec3( 1.0 ), tint, a ) * 1.0, 1.0 );`,
    /* glsl */ `attribute vec3 print;
      uniform float printTime;
      varying float vFade;
      varying float vWet;
      @main
      float age = printTime - print.x;
      float life = mix( 90.0, 9.0, print.z );
      vFade = print.y * smoothstep( 0.0, 0.15, age ) * ( 1.0 - smoothstep( life * 0.5, life, age ) );
      vWet = print.z;
      if ( vFade <= 0.0 ) p = vec4( 0.0, -1e4, 0.0, 1.0 );`,
    "varying float vFade;\nvarying float vWet;",
  );
  // Prints multiply straight colour: alpha stays 1, colour does the work.
  material.blending = THREE.CustomBlending;
  material.blendSrc = THREE.DstColorFactor;
  material.blendDst = THREE.ZeroFactor;
  material.blendSrcAlpha = THREE.ZeroFactor;
  material.blendDstAlpha = THREE.OneFactor;
  material.uniforms.printTime = { value: 0 };
  const mesh = new THREE.InstancedMesh(geometry, material, PRINT_COUNT);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < PRINT_COUNT; i++) mesh.setMatrixAt(i, hidden);
  parent.add(mesh);
  const transform = new THREE.Object3D();
  const up = new THREE.Vector3();
  let next = 0;
  return {
    mesh,
    update(time) {
      material.uniforms.printTime.value = time;
    },
    // normal: ground normal (coast frame); depth: 0–1 by surface; wet: 0–1.
    add(time, x, y, z, heading, front, normal, depth, wet) {
      if (depth <= 0.02) return;
      transform.position.set(x, y + 0.004, z);
      up.set(normal[0], normal[1], normal[2]);
      transform.quaternion.setFromUnitVectors(THREE.Object3D.DEFAULT_UP, up);
      transform.rotateY(heading);
      const size = front ? 0.052 : 0.046;
      transform.scale.set(size * 0.9, 1, size);
      transform.updateMatrix();
      mesh.setMatrixAt(next, transform.matrix);
      data.setXYZ(next, time, depth, wet);
      // Upload only the new print (three clears the ranges after upload).
      mesh.instanceMatrix.addUpdateRange(next * 16, 16);
      mesh.instanceMatrix.needsUpdate = true;
      data.addUpdateRange(next * 3, 3);
      data.needsUpdate = true;
      next = (next + 1) % PRINT_COUNT;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      mesh.dispose();
    },
  };
}
