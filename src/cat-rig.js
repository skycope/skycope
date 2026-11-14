import * as THREE from "three";

// The cat's skeleton, in the body frame: +z forward, +y up, the origin at
// mid-back 20 cm above level ground. Bones carry the anatomy that shows
// through a short coat: a spine that flexes and bends (hips, a lumbar pivot,
// chest), shoulder blades that roll over the withers as the front legs
// swing, three-bone legs, a neck and head with a hinged jaw and swivelling
// ears, a breathing ribcage, the loose belly pouch, and a jointed tail.

export const STAND_HEIGHT = 0.2;
export const PAW_LIFT = 0.0162;
export const TAIL_BONES = 14;
export const TAIL_LENGTH = 0.3;
export const TAIL_ROOT = [0, 0.04, -0.165];
// The whole cat is modelled at domestic-cat size and drawn this much larger,
// to hold its own among the island's plants.
export const CAT_SCALE = 1.4;
// The head (skull, eyes, ears, whiskers, the coat's face markings) is
// authored in head-local units and built this much larger: one knob for
// the head's size against the body (a cat's is about a fifth of its length
// and two thirds of its chest depth).
export const HEAD_SCALE = 1.06;

// Legs: the joint at the top of the leg (shoulder or hip) in the body frame,
// three bones (humerus/forearm/pastern, thigh/shin/hock), and `lean`: how far
// the last bone tilts so the joint above it sits behind the paw.
export const LEGS = [
  { name: "lf", side: 1, hip: [0.029, -0.022, 0.13], bones: [0.085, 0.09, 0.036], lean: 0.2, front: true },
  { name: "rf", side: -1, hip: [-0.029, -0.022, 0.13], bones: [0.085, 0.09, 0.036], lean: 0.2, front: true },
  { name: "lh", side: 1, hip: [0.027, 0.0, -0.125], bones: [0.1, 0.105, 0.07], lean: 0.12, front: false },
  { name: "rh", side: -1, hip: [-0.027, 0.0, -0.125], bones: [0.1, 0.105, 0.07], lean: 0.12, front: false },
];

// Pivots in the body frame (bind pose).
const SPINE = [0, 0.02, -0.02];
const HIPS = [0, 0.02, -0.045];
const CHEST = [0, 0.02, 0.005];
const RIBS = [0, 0.012, 0.06];
const POUCH = [0, -0.03, -0.075];
const NECK = [0, 0.045, 0.158];
export const HEAD = [0, 0.1, 0.206];
const JAW = [0, -0.017, -0.012].map((v) => v * HEAD_SCALE); // head-local
const EAR = [0.024, 0.03, -0.004].map((v) => v * HEAD_SCALE); // head-local, mirrored
const SCAPULA = [0.027, 0.05, 0.088]; // top of the blade, mirrored

// Where each neutral paw stands, relative to its hip. Cats walk nearly on a
// line: the paws sit inside the shoulders and hips.
export function neutralFoot(spec) {
  // The point of the shoulder sits forward: a cat stands on its front paws
  // under the elbow, well behind it.
  return [spec.hip[0] * 0.72, spec.hip[2] + (spec.front ? -0.062 : -0.004)];
}

export function createRig() {
  const bones = {};
  const list = [];
  const bone = (name, parent, [x, y, z]) => {
    const b = new THREE.Bone();
    b.name = name;
    b.position.set(x, y, z);
    if (parent) parent.add(b);
    bones[name] = b;
    list.push(b);
    return b;
  };
  const rel = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const spine = bone("spine", null, SPINE);
  const hips = bone("hips", spine, rel(HIPS, SPINE));
  const chest = bone("chest", spine, rel(CHEST, SPINE));
  bone("ribs", chest, rel(RIBS, CHEST));
  bone("pouch", hips, rel(POUCH, HIPS));
  const neck = bone("neck", chest, rel(NECK, CHEST));
  const head = bone("head", neck, rel(HEAD, NECK));
  bone("jaw", head, JAW);
  for (const side of [1, -1]) {
    const ear = bone(side > 0 ? "earL" : "earR", head, [EAR[0] * side, EAR[1], EAR[2]]);
    ear.rotation.order = "YXZ";
  }
  const legs = LEGS.map((spec) => {
    let parent = hips;
    let top = HIPS;
    let scapula = null;
    if (spec.front) {
      const at = [SCAPULA[0] * spec.side, SCAPULA[1], SCAPULA[2]];
      scapula = bone(`${spec.name}Scapula`, chest, rel(at, CHEST));
      parent = scapula;
      top = at;
    }
    const [a, b, c] = spec.bones;
    const upper = bone(`${spec.name}Upper`, parent, rel(spec.hip, top));
    upper.rotation.order = "ZXY";
    const lower = bone(`${spec.name}Lower`, upper, [0, -a, 0]);
    const foot = bone(`${spec.name}Foot`, lower, [0, -b, 0]);
    const paw = bone(`${spec.name}Paw`, foot, [0, -c, 0]);
    paw.rotation.order = "XZY";
    return { spec, scapula, upper, lower, foot, paw, stance: false, plant: null, swing: 0 };
  });
  const tail = [];
  for (let i = 0; i <= TAIL_BONES; i++)
    tail.push(bone(`tail${i}`, hips, rel([TAIL_ROOT[0], TAIL_ROOT[1], TAIL_ROOT[2] - (i * TAIL_LENGTH) / TAIL_BONES], HIPS)));

  // Bind pose: standing square on level ground.
  for (const leg of legs) {
    const [fx, fz] = neutralFoot(leg.spec);
    const below = -STAND_HEIGHT + PAW_LIFT - leg.spec.hip[1];
    // The rest angle of the upper bone: the shoulder blade swings with the
    // arm's departure from it (cat.js).
    leg.restUpper = solveLeg(leg, fx - leg.spec.hip[0], fz - leg.spec.hip[2], below, 0).upperAngle;
  }
  spine.updateMatrixWorld(true);
  return { root: spine, bones, list, legs, tail };
}

// Three bones in the leg's plane, the top joint at the origin and the paw
// target at (side x, forward f, height y) in its parent's frame. The last
// bone keeps its lean (less when flexed), which places the wrist or hock;
// two-bone IK solves the rest. Angles are from straight down, positive
// forward; each joint's rotation is the difference. The whole leg swings
// out (abducts) to reach sideways. `pawPitch` tilts the paw to the ground.
export function solveLeg(leg, x, f, y, flex, pawPitch = 0, pawRoll = 0) {
  const [a, b, c] = leg.spec.bones;
  const abduct = Math.atan2(x, -y);
  const down = -Math.hypot(x, y);
  const lean = leg.spec.lean - flex;
  const jf = f - Math.sin(lean) * c;
  const jy = down + Math.cos(lean) * c;
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
  leg.upper.rotation.set(-upperAngle, 0, abduct);
  leg.lower.rotation.x = -(lowerAngle - upperAngle);
  leg.foot.rotation.x = -(lean - lowerAngle);
  // The paw stays level with the leg's frame (and so the ground), curling
  // back as the wrist flexes.
  leg.paw.rotation.set(lean - flex * 0.6 + pawPitch, 0, -abduct + pawRoll);
  return { upperAngle, lowerAngle, lean, reached: reach <= a + b };
}
