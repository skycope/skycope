import * as THREE from "three";
import { seededRandom } from "./random.js";
import { islandPoint, shoreDistance, ISLAND } from "./terrain.js";
import {
  sculpt, ellipsoid, capsule, animalMaterial, animalMesh, DEFORM_GLSL, placeInstance, formGeometry, herdBounds,
  surfaceOf, domeHeight, wrap, clamp, smooth, turnToward,
} from "./animal-forms.js";

// Cape fur seals hauled out on a boulder at the waterline: they loll in the
// sun, lift their heads to look round, scratch with a hind flipper, fan a
// fore flipper to cool, roll onto a side, yawn and bark. A cat is watched
// from ~9 m (chests up, every head on it, a bark or two); nearer than ~4.5 m,
// or on their rock, they galumph to the edge and slide into the sea, then
// bob offshore with their heads up watching it. Once it has gone they swim
// back and haul out again. A young one plays in the surf whatever happens:
// porpoising, rolling, floating on its back with its flippers held up, and
// it comes to circle a cat that swims out.
//
// Events (x, z coast metres; d from the cat; gain 0…1 with distance):
//   bark   — a harsh, goat-like bleat-bark (cows) / roar (bulls), 0.6–1.2 s
//   splash — a seal sliding off the rock into the water (heavy, ~1 s)
//   blow   — a seal surfacing near the cat: a short snorting exhale
export const SEAL_EVENTS = ["bark", "splash", "blow"];

const AWARE = 9;
const FLEE = 4.5;
const CALM = 12;

// solid: grown in and out over the last 20 m before the hide radius, so
// the herd never pops in or out of view.
const grownAt = (d, radius) => 1 - Math.min(1, Math.max(0, (d - (radius - 20)) / 20)) ** 2;

export function sealGeometry({ light = false } = {}) {
  const prims = [
    ellipsoid("body", [0, 0.19, 0.02], [0.23, 0.19, 0.5], { k: 0 }),
    ellipsoid("body", [0, 0.21, 0.33], [0.21, 0.19, 0.27], { k: 0.12 }),
    capsule("rear", [0, 0.16, -0.25], [0, 0.1, -0.6], 0.18, 0.075, { k: 0.12 }),
    capsule("neck", [0, 0.23, 0.48], [0, 0.31, 0.7], 0.14, 0.095, { k: 0.1 }),
    ellipsoid("head", [0, 0.335, 0.74], [0.088, 0.083, 0.1], { k: 0.06 }),
    capsule("head", [0, 0.32, 0.8], [0, 0.302, 0.905], 0.054, 0.03, { k: 0.04 }),
  ];
  for (const s of [-1, 1]) {
    const side = s < 0 ? "L" : "R";
    prims.push(
      // Long fore flippers, resting on the rock angled out and back.
      capsule(`fore${side}`, [s * 0.16, 0.1, 0.37], [s * 0.43, 0.025, 0.26], 0.065, 0.035, { k: 0.05, squash: [1.6, 0.48], blend: 0.03 }),
      // Hind flippers, splayed behind.
      capsule(`hind${side}`, [s * 0.05, 0.08, -0.58], [s * 0.16, 0.035, -0.86], 0.05, 0.035, { k: 0.04, squash: [1.5, 0.5], blend: 0.025 }),
    );
  }
  return sculpt({
    prims,
    cell: light ? 0.034 : 0.027,
    triangles: light ? 1100 : 2000,
    blend: 0.05,
    aoRadius: 0.08,
    paint: (p, n, w) => [w.ao, w.ao, w.ao].map((v) => v ** (1 / 2.2)),
    attributes: {
      // x: head (and neck), y: fore flipper (signed), z: hind flipper
      // (signed), w: rear body.
      part: { size: 4, value: (p, n, w) => [w.head + w.neck * 0.6, w.foreR - w.foreL, w.hindR - w.hindL, w.rear] },
      tags: { size: 4, value: (p, n, w) => [w.foreL + w.foreR + w.hindL + w.hindR, w.head, w.eye ?? 0, 0] },
    },
    extras: [
      ...[-1, 1].map((s) => {
        // Big dark eyes and the small rolled ears behind them.
        const eye = new THREE.SphereGeometry(0.017, 7, 5);
        eye.translate(s * 0.056, 0.36, 0.79);
        return { geometry: eye, colour: [1, 1, 1], weights: { head: 1, eye: 1 } };
      }),
      ...[-1, 1].map((s) => {
        const ear = new THREE.ConeGeometry(0.012, 0.045, 5);
        ear.rotateX(-1.1);
        ear.rotateZ(s * -0.5);
        ear.translate(s * 0.07, 0.39, 0.7);
        return { geometry: ear, colour: [1, 1, 1], weights: { head: 1 } };
      }),
    ],
  });
}

// Fur: dark chocolate back grading to a paler grey-tan belly and throat,
// a grizzled guard-hair texture, a paler muzzle; leathery black flippers.
export const SEAL_PAINT = `
vec3 animalPaint( vec3 p, vec3 n, vec4 tags ) {
  vec3 back = srgb( vec3( 0.25, 0.19, 0.14 ) );
  vec3 belly = srgb( vec3( 0.5, 0.42, 0.33 ) );
  float under = smoothstep( 0.2, -0.5, n.y ) * smoothstep( 0.32, 0.12, p.y );
  float throat = smoothstep( 0.45, 0.75, p.z ) * smoothstep( 0.05, -0.6, n.y + 0.2 );
  vec3 c = mix( back, belly, max( under, throat ) );
  float grizzle = vnoise( p * vec3( 40.0, 40.0, 14.0 ) ) * 0.6 + vnoise( p * 110.0 ) * 0.4;
  c *= 0.82 + 0.36 * grizzle;
  // Paler muzzle and brow.
  float muzzle = smoothstep( 0.82, 0.9, p.z );
  c = mix( c, srgb( vec3( 0.42, 0.34, 0.26 ) ), muzzle * 0.7 );
  c = mix( c, srgb( vec3( 0.07, 0.06, 0.055 ) ), smoothstep( 0.4, 0.7, tags.x ) );
  c = mix( c, srgb( vec3( 0.12, 0.09, 0.07 ) ), smoothstep( 0.896, 0.91, p.z ) );
  return mix( c, srgb( vec3( 0.02, 0.018, 0.018 ) ), step( 0.5, tags.z ) );
}`;

export const SEAL_DEFORM = `${DEFORM_GLSL}
attribute vec4 part;
// pose: head yaw, head pitch (+ up), chest lift (+ up), lateral bend;
// pose2: fore flipper wave (signed side), hind scratch, gait phase, gait;
// pose3: swim scull, breathing phase offset, -, -.
attribute vec4 pose;
attribute vec4 pose2;
attribute vec4 pose3;
uniform float time;
void animalDeform( inout vec3 p, inout vec3 n ) {
  // Breathing: the ribcage swells a little.
  float breathe = sin( time * 1.3 + pose3.y ) * 0.012 * smoothstep( 0.6, 0.0, abs( p.z - 0.1 ) );
  p.xy *= 1.0 + breathe;
  // Hind flippers: scull when swimming; one swings forward to scratch.
  float hind = part.z;
  if ( abs( hind ) > 0.01 ) {
    float s = sign( hind );
    float scull = pose3.x * sin( time * 5.0 + s * 1.6 ) * 0.5;
    float scratch = max( 0.0, pose2.y * s ) * ( 0.9 + 0.25 * sin( time * 14.0 ) );
    turnAbout( p, n, vec3( s * 0.05, 0.08, -0.56 ), rotY( -s * ( scull + scratch * 1.6 ) ) * rotX( -scratch * 0.9 ), abs( hind ) );
  }
  // The rear sweeps with the sculling.
  if ( part.w > 0.01 ) turnAbout( p, n, vec3( 0.0, 0.15, -0.2 ), rotY( pose3.x * sin( time * 5.0 ) * 0.22 ), part.w );
  // Fore flippers: the gait, and a raised one fanning.
  float fore = part.y;
  if ( abs( fore ) > 0.01 ) {
    float s = sign( fore );
    float step = sin( pose2.z + ( s > 0.0 ? 0.0 : 3.14159 ) ) * pose2.w;
    float wave = max( 0.0, pose2.x * s ) * ( 1.0 + 0.2 * sin( time * 3.0 ) );
    turnAbout( p, n, vec3( s * 0.16, 0.12, 0.36 ), rotZ( s * wave * 1.3 ) * rotX( step * 0.5 ) * rotY( -s * pose3.x * 0.6 ), abs( fore ) );
  }
  // Spine: the chest lifts on the fore flippers; the body curls sideways.
  float front = smoothstep( 0.0, 0.4, p.z );
  turnAbout( p, n, vec3( 0.0, 0.06, 0.12 ), rotX( -pose.z ), front );
  p.x += pose.w * p.z * p.z * 0.6;
  n = normalize( n + vec3( -pose.w * p.z * 1.2 * n.z, 0.0, 0.0 ) );
  // Head and neck, about the base of the neck (where the lift left it).
  vec3 neck = vec3( pose.w * 0.16, 0.06 + cos( pose.z ) * 0.22 + sin( pose.z ) * 0.4, 0.12 + cos( pose.z ) * 0.4 - sin( pose.z ) * 0.22 );
  turnAbout( p, n, neck, rotY( pose.x ) * rotX( -pose.y ), clamp( part.x, 0.0, 1.0 ) );
}`;

// domes: forest.obstacles.domes; cluster: the outcrop they haul out on.
export function createSeals(group, { seed, domes, cluster, light = false, blobs = null, spray = null }) {
  const random = seededRandom(seed ^ 0x5ea15ea1);
  const events = [];
  const hauled = light ? 3 : 4;
  const count = hauled + 1;
  const near = domes.filter((d) => Math.hypot(d.x - cluster.x, d.z - cluster.z) < 30);
  const surface = surfaceOf(near);
  // Their rock: of the outcrop's stones, the one with the most flat top
  // well clear of the sea and close to it.
  const spots = [];
  const rocks = cluster.members
    .map((d) => {
      let flat = 0;
      let top = -Infinity;
      for (const h of d.heights) top = Math.max(top, h);
      for (const h of d.heights) if (h > top - 0.3) flat++;
      return { d, top, flat: flat * d.cell * d.cell, inland: shoreDistance(d.x, d.z) };
    })
    .filter((r) => r.top > 0.45 && r.top < 3.2 && r.inland < 3)
    .sort((a, b) => b.flat - b.inland * 0.3 - (a.flat - a.inland * 0.3));
  for (const r of rocks) {
    const { d } = r;
    for (let k = 0; k < 300 && spots.length < hauled; k++) {
      const x = d.x0 + random() * (d.nx - 1) * d.cell;
      const z = d.z0 + random() * (d.nz - 1) * d.cell;
      const h = domeHeight(d, x, z);
      if (!(h > r.top - 0.45)) continue;
      // Gentle enough to lie on.
      const e = 0.3;
      const gx = domeHeight(d, x + e, z) - domeHeight(d, x - e, z);
      const gz = domeHeight(d, x, z + e) - domeHeight(d, x, z - e);
      if (!(Math.abs(gx) < 0.35 && Math.abs(gz) < 0.35)) continue;
      if (spots.some((s) => Math.hypot(s.x - x, s.z - z) < 1.0)) continue;
      spots.push({ x, z, rock: d, heading: random() * Math.PI * 2 });
    }
    if (spots.length >= hauled) break;
  }
  const rock = rocks[0]?.d ?? cluster.members[0];
  while (spots.length < hauled) {
    const p = islandPoint(cluster.theta + (spots.length - 1) * 0.02, 0.3);
    spots.push({ x: p.x, z: p.z, rock, heading: random() * Math.PI * 2 });
  }
  // From each spot, the way into the sea: straight out from the island
  // until the rock falls away; then a leap out over the water.
  for (const s of spots) {
    const t = Math.atan2(s.z - ISLAND.z, s.x - ISLAND.x);
    let ox = Math.cos(t);
    let oz = Math.sin(t);
    const top = surface(s.x, s.z);
    let ex = s.x;
    let ez = s.z;
    for (let k = 1; k < 40; k++) {
      const x = s.x + ox * k * 0.15;
      const z = s.z + oz * k * 0.15;
      if (surface(x, z) < top - 0.6) break;
      ex = x;
      ez = z;
    }
    s.exit = { x: ex, z: ez, y: surface(ex, ez) };
    s.water = { x: ex + ox * 1.8, z: ez + oz * 1.8 };
    s.out = Math.atan2(ox, oz);
  }
  const rockCentre = {
    x: spots.reduce((a, s) => a + s.x, 0) / spots.length,
    z: spots.reduce((a, s) => a + s.z, 0) / spots.length,
  };
  const rockTheta = Math.atan2(rockCentre.z - ISLAND.z, rockCentre.x - ISLAND.x);

  const geometry = formGeometry("seal", { light }, sealGeometry);
  const shared = { time: { value: 0 } };
  const material = animalMaterial({ name: "seal", uniforms: shared, pars: SEAL_DEFORM, paint: SEAL_PAINT, roughness: 0.7, sheen: 0.22 });
  const { mesh, attrs } = animalMesh(group, geometry, material, count, { pose: 4, pose2: 4, pose3: 4 });
  // lod: a 420-triangle body beyond 26 m (2,000 near).
  const bounds = herdBounds(mesh, { coarse: formGeometry("seal", { light, coarse: 420 }, sealGeometry), far: 26 });

  const seals = Array.from({ length: count }, (_, i) => {
    const spot = spots[i] ?? null;
    const player = i === hauled;
    const start = player ? islandPoint(rockTheta + 0.05, -6) : spot;
    return {
      i,
      spot,
      player,
      x: start.x,
      z: start.z,
      y: player ? -0.2 : surface(start.x, start.z),
      heading: player ? rockTheta : spot.heading,
      pitch: 0,
      roll: 0,
      // haul | gallop | leap | swim | climb | play
      state: player ? "play" : "haul",
      act: "rest",
      actTimer: random() * 6,
      headYaw: 0,
      headPitch: 0,
      lift: 0,
      bend: 0,
      fore: 0,
      scratch: 0,
      gait: 0,
      gaitAmp: 0,
      scull: 0,
      wet: player ? 1 : 0.3 * random(),
      size: player ? 0.7 : 0.88 + random() * 0.24,
      breath: random() * 6,
      vx: 0,
      vy: 0,
      vz: 0,
      leapT: 0,
      calm: 0,
      target: null,
      trick: "swim",
      trickTimer: 3,
      spin: 0,
      climbT: 0,
      sideRoll: 0,
    };
  });
  let clock = 0;
  let barkAt = -10;
  let atSea = 0;
  let sea0 = null;
  const circle = { x: 0, z: 0 };
  const attrList = Object.values(attrs);
  // The water level over (x, z) (0 off the CPU sea, as in tests).
  const levelAt = (x, z) => {
    if (!sea0) return 0;
    const l = sea0(x, z).level;
    return Number.isFinite(l) ? l : 0;
  };
  const interest = { x: 0, y: 0, z: 0, kind: "seal", near: false, d: 0 };
  const say = (type, s, d, gain) => events.push({ type, x: s.x, z: s.z, d, gain: gain * clamp(1 - d / 60, 0, 1) });

  let grow = 1;
  return {
    pois: [{ id: "seals", title: "Seal rock", x: rockCentre.x, z: rockCentre.z, r: 7 }],
    events,
    seals,
    rock: rockCentre,
    update({ dt, time, night, pose, water, eye = null }) {
      clock += dt;
      shared.time.value = time;
      sea0 = water;
      const catD = Math.hypot(pose.x - rockCentre.x, pose.z - rockCentre.z);
      const far = catD > 110 && atSea === 0;
      grow = atSea ? 1 : grownAt(catD, 110);
      mesh.visible = !far && geometry.userData.ready;
      if (far) return null;
      atSea = 0;
      const catSpeed = Math.abs(pose.speed);
      const catSwims = (pose.swim ?? 0) > 0.5;
      // On their rock: the cat's feet are well above the sand and near it.
      const catOnRock = pose.y > 0.35 && catD < 6;
      let best = null;
      let bestD = AWARE;
      bounds.begin();
      for (const s of seals) {
        const dx = s.x - pose.x;
        const dz = s.z - pose.z;
        const dc = Math.hypot(dx, dz) || 1e-3;
        const toCat = Math.atan2(-dx, -dz);
        s.calm = dc > CALM ? s.calm + dt : 0;
        if (s.state === "haul") {
          if (dc < FLEE + catSpeed * 0.6 || (catOnRock && dc < 7)) {
            s.state = "gallop";
            s.target = s.spot.exit;
            if (clock - barkAt > 1) {
              barkAt = clock;
              say("bark", s, dc, 1);
            }
          }
        }
        let yaw = 0;
        let pitch = 0;
        let lift = 0;
        let bend = 0;
        let fore = 0;
        let scratch = 0;
        let roll = 0;
        let gaitAmp = 0;
        let scull = 0;
        if (s.state === "haul") {
          const watching = dc < AWARE;
          s.actTimer -= dt;
          if (s.actTimer < 0) {
            const r = random();
            s.act = watching ? (r < 0.75 ? "watch" : "bark")
              : r < 0.35 ? "rest" : r < 0.55 ? "lookup" : r < 0.67 ? "scratch" : r < 0.77 ? "fan" : r < 0.87 ? "side" : r < 0.94 ? "yawn" : "bark";
            s.actTimer = { rest: 4 + random() * 8, lookup: 2 + random() * 3, scratch: 2.5 + random() * 2, fan: 4 + random() * 5, side: 6 + random() * 8, yawn: 1.6, bark: 1.4, watch: 2 + random() * 2 }[s.act];
            s.lookYaw = (random() - 0.5) * 2;
            s.side = random() < 0.5 ? -1 : 1;
            if (s.act === "bark" && clock - barkAt > 2.5) {
              barkAt = clock;
              say("bark", s, dc, watching ? 0.9 : 0.6);
            }
          }
          if (s.act === "rest") {
            pitch = -0.32;
            lift = -0.05;
            bend = 0.12 * Math.sin(s.i * 3);
          } else if (s.act === "lookup") {
            lift = 0.25;
            pitch = 0.15;
            yaw = s.lookYaw;
          } else if (s.act === "scratch") {
            bend = 0.55 * s.side;
            scratch = s.side;
            yaw = -s.side * 1.0;
            pitch = -0.1;
            lift = 0.1;
          } else if (s.act === "fan") {
            fore = s.side;
            roll = -s.side * 0.35;
            pitch = -0.2;
          } else if (s.act === "side") {
            roll = s.side * 0.85;
            pitch = -0.1;
            bend = -0.2 * s.side;
            fore = s.side * 0.4;
          } else if (s.act === "yawn") {
            pitch = 0.9 * Math.sin(Math.PI * clamp(1 - s.actTimer / 1.6, 0, 1));
            lift = 0.25;
          } else if (s.act === "bark") {
            lift = 0.4;
            pitch = 0.55 + Math.sin(clock * 18) * 0.06;
            yaw = clamp(wrap(toCat - s.heading), -1.2, 1.2) * (dc < AWARE ? 1 : 0);
          }
          if (watching) {
            // Chest up, every head on the cat.
            lift = Math.max(lift, 0.45 * smooth(AWARE, AWARE - 3, dc));
            yaw = clamp(wrap(toCat - s.heading), -1.3, 1.3);
            pitch = Math.max(pitch, 0.1);
            roll *= 0.3;
          }
          // Lie along the rock's slope.
          const g = surface(s.x, s.z);
          s.y += (g - 0.02 - s.y) * Math.min(1, dt * 4);
        } else if (s.state === "gallop") {
          // A seal on land runs on all four flippers, the body heaving.
          const tx = s.target.x - s.x;
          const tz = s.target.z - s.z;
          const td = Math.hypot(tx, tz);
          s.heading = turnToward(s.heading, Math.atan2(tx, tz), dt * 4);
          const v = 1.3;
          s.x += Math.sin(s.heading) * v * dt * Math.min(1, td / 0.2 + 0.2);
          s.z += Math.cos(s.heading) * v * dt * Math.min(1, td / 0.2 + 0.2);
          s.gait += dt * 9;
          gaitAmp = 1;
          lift = 0.35 + Math.sin(s.gait) * 0.12;
          pitch = 0.2;
          s.y = surface(s.x, s.z) - 0.02 + Math.max(0, Math.sin(s.gait)) * 0.06;
          if (td < 0.2) {
            // Off the edge, head first.
            s.state = "leap";
            s.leapT = 0;
            const out = s.spot.water;
            const ox = out.x - s.x;
            const oz = out.z - s.z;
            const flight = 0.55;
            s.vx = ox / flight;
            s.vz = oz / flight;
            s.vy = 1.2;
            s.heading = Math.atan2(ox, oz);
          }
        } else if (s.state === "leap") {
          s.leapT += dt;
          s.vy -= 9.8 * dt;
          s.x += s.vx * dt;
          s.z += s.vz * dt;
          s.y += s.vy * dt;
          lift = 0.1;
          pitch = -0.2;
          s.pitchTarget = clamp(-s.vy * 0.35, -0.2, 1.2);
          const level = levelAt(s.x, s.z);
          if (s.y < level - 0.1) {
            s.state = "swim";
            s.wet = 1;
            s.target = sea(s, 8 + random() * 6);
            say("splash", s, dc, 1);
            spray?.emit({ x: s.x, y: level + 0.1, z: s.z, count: light ? 10 : 18, vx: s.vx * 0.2, vy: 2.4, vz: s.vz * 0.2, spread: 1.4, size: 0.18, grow: 0.5, life: 1.1, fall: 0.85, drag: 0.6, opacity: 0.85 });
          }
        }
        if (s.state === "swim" || s.state === "play" || s.state === "climb-swim") {
          atSea++;
          const level = levelAt(s.x, s.z);
          s.wet = 1;
          scull = 1;
          let speed = 0.7;
          if (s.state === "swim") {
            // Bobbing offshore, heads up, watching the cat.
            if (!s.target || Math.hypot(s.target.x - s.x, s.target.z - s.z) < 1) s.target = sea(s, 7 + random() * 7);
            if (s.calm > 10 + s.i * 2) {
              s.state = "climb-swim";
              s.target = s.spot.water;
            }
            yaw = clamp(wrap(toCat - s.heading), -1.3, 1.3) * (dc < 25 ? 1 : 0);
            lift = 0.75;
            pitch = 0.3;
            speed = 0.6;
          } else if (s.state === "play") {
            // Play: tricks in the surf, and a swimming cat is irresistible.
            s.trickTimer -= dt;
            if (catSwims && dc < 25) {
              const a = Math.atan2(dx, dz) + dt * 0.5;
              circle.x = pose.x + Math.sin(a + 0.6) * 2.6;
              circle.z = pose.z + Math.cos(a + 0.6) * 2.6;
              s.target = circle;
              if (s.trick !== "circle") {
                s.trick = "circle";
                say("blow", s, dc, 0.8);
              }
              speed = 1.1;
              yaw = clamp(wrap(toCat - s.heading), -1.3, 1.3);
              lift = 0.8;
            } else {
              if (s.trick === "circle") s.trick = "swim";
              if (s.trickTimer < 0) {
                const r = random();
                s.trick = r < 0.35 ? "porpoise" : r < 0.6 ? "jughandle" : r < 0.8 ? "roll" : "swim";
                s.trickTimer = { porpoise: 1.4, jughandle: 6 + random() * 4, roll: 2.2, swim: 3 + random() * 4 }[s.trick];
                s.target = playSpot();
                if (s.trick === "porpoise") s.leapT = 0;
              }
              if (!s.target || Math.hypot(s.target.x - s.x, s.target.z - s.z) < 1) s.target = playSpot();
              if (s.trick === "jughandle") {
                // On its back, fore and hind flippers held up together.
                speed = 0.15;
                s.sideRoll += (Math.PI - s.sideRoll) * Math.min(1, dt * 2);
                fore = 1.4;
                scratch = 0.6;
                lift = 0.3;
              } else if (s.trick === "roll") {
                speed = 0.9;
                s.sideRoll += dt * 5.5;
              } else {
                s.sideRoll += (Math.round(s.sideRoll / (Math.PI * 2)) * Math.PI * 2 - s.sideRoll) * Math.min(1, dt * 3);
                speed = s.trick === "porpoise" ? 2.2 : 0.8;
              }
              lift = s.trick === "jughandle" ? lift : 0.5;
            }
            roll = s.sideRoll;
          }
          if (s.state === "climb-swim") {
            speed = 0.8;
            lift = 0.6;
            if (Math.hypot(s.target.x - s.x, s.target.z - s.z) < 1.0) {
              s.state = "climb";
              s.climbT = 0;
              say("blow", s, dc, 0.4);
            }
          }
          if (s.target) {
            const tx = s.target.x - s.x;
            const tz = s.target.z - s.z;
            s.heading = turnToward(s.heading, Math.atan2(tx, tz), dt * 1.6);
          }
          let nx = s.x + Math.sin(s.heading) * speed * dt;
          let nz = s.z + Math.cos(s.heading) * speed * dt;
          // Stay in water deep enough to swim, off the rocks.
          if (shoreDistance(nx, nz) > -1.5 && s.state !== "climb-swim") {
            s.heading += dt * 2;
            nx = s.x;
            nz = s.z;
          }
          s.x = nx;
          s.z = nz;
          let y = level - 0.16;
          if (s.state === "play" && s.trick === "porpoise") {
            s.leapT += dt / 1.0;
            const k = s.leapT % 1;
            const arc = Math.sin(Math.PI * k);
            y = level - 0.45 + arc * 0.75;
            s.pitchTarget = -Math.cos(Math.PI * k) * 0.7;
            if (k < s.lastK) say("splash", s, dc, 0.35);
            s.lastK = k;
          } else s.pitchTarget = 0;
          s.y = y;
          s.waterline = level;
        } else s.waterline = -1e4;
        if (s.state === "climb") {
          // Hauling out: a lunge up the rock, then galumph to its spot.
          s.climbT += dt / 1.4;
          const k = smooth(0, 1, s.climbT);
          const w = s.spot.water;
          const e = s.spot.exit;
          s.x = w.x + (e.x - w.x) * k;
          s.z = w.z + (e.z - w.z) * k;
          s.y = levelAt(w.x, w.z) - 0.2 + (e.y - levelAt(w.x, w.z) + 0.2) * Math.sin((k * Math.PI) / 2);
          s.heading = turnToward(s.heading, s.spot.out + Math.PI, dt * 4);
          s.pitchTarget = -0.6 * (1 - k);
          lift = 0.5;
          gaitAmp = 1;
          s.gait += dt * 8;
          s.waterline = levelAt(s.x, s.z);
          if (s.climbT >= 1) {
            s.state = "home";
            s.target = s.spot;
            s.waterline = -1e4;
          }
        }
        if (s.state === "home") {
          const tx = s.spot.x - s.x;
          const tz = s.spot.z - s.z;
          const td = Math.hypot(tx, tz);
          s.heading = turnToward(s.heading, Math.atan2(tx, tz), dt * 3);
          s.x += Math.sin(s.heading) * 0.7 * dt;
          s.z += Math.cos(s.heading) * 0.7 * dt;
          s.y = surface(s.x, s.z) - 0.02;
          s.gait += dt * 7;
          gaitAmp = 1;
          lift = 0.3;
          s.pitchTarget = 0;
          if (td < 0.25) {
            s.state = "haul";
            s.act = "rest";
            s.actTimer = 3;
          }
        }
        if (s.state !== "swim" && s.state !== "play" && s.state !== "leap" && s.state !== "climb") s.pitchTarget = 0;
        if (s.state !== "play") s.sideRoll = 0;
        // Out of the water the coat dries over a few minutes.
        if (s.state === "haul" || s.state === "home") s.wet = Math.max(0, s.wet - dt / 240);
        s.headYaw += (yaw - s.headYaw) * Math.min(1, dt * 4);
        s.headPitch += (pitch - s.headPitch) * Math.min(1, dt * 4);
        s.lift += (lift - s.lift) * Math.min(1, dt * 3);
        s.bend += (bend - s.bend) * Math.min(1, dt * 2);
        s.fore += (fore - s.fore) * Math.min(1, dt * 3);
        s.scratch += (scratch - s.scratch) * Math.min(1, dt * 4);
        s.gaitAmp += (gaitAmp - s.gaitAmp) * Math.min(1, dt * 6);
        s.scull += (scull - s.scull) * Math.min(1, dt * 2);
        s.roll += ((s.state === "play" ? roll : roll) - s.roll) * Math.min(1, dt * (s.state === "play" ? 8 : 1.5));
        s.pitch += ((s.pitchTarget ?? 0) - s.pitch) * Math.min(1, dt * 5);
        // Body pitch on a sloping rock.
        let slope = 0;
        if (s.state === "haul" || s.state === "home" || s.state === "gallop") {
          const fx = Math.sin(s.heading) * 0.55;
          const fz = Math.cos(s.heading) * 0.55;
          slope = Math.atan2(surface(s.x - fx, s.z - fz) - surface(s.x + fx, s.z + fz), 1.1);
        }
        placeInstance(mesh, s.i, s.x, s.y, s.z, s.heading, clamp(s.pitch + slope, -1.3, 1.3), s.roll, s.size * grow);
        bounds.add(s.x, s.y, s.z, 1.2);
        attrs.pose.setXYZW(s.i, s.headYaw, s.headPitch, s.lift, s.bend);
        attrs.pose2.setXYZW(s.i, s.fore, s.scratch, s.gait, s.gaitAmp);
        attrs.pose3.setXYZW(s.i, s.scull, s.breath, 0, 0);
        attrs.wet.setX(s.i, s.wet);
        attrs.waterline.setX(s.i, s.waterline);
        if (blobs && s.waterline < -1e3 && s.state !== "leap") blobs.add(s.x, s.y + 0.0, s.z, s.heading, 1.1 * s.size, 0.55 * s.size, 0.9);
        if (dc < bestD) {
          bestD = dc;
          best = s;
        }
      }
      bounds.end(eye);
      mesh.instanceMatrix.needsUpdate = true;
      for (const a of attrList) a.needsUpdate = true;
      if (!best) return null;
      interest.x = best.x;
      interest.y = best.y + 0.35 * best.size;
      interest.z = best.z;
      interest.near = bestD < 3;
      interest.d = bestD;
      return interest;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      mesh.dispose();
      group.remove(mesh);
    },
  };

  function sea(s, out) {
    return islandPoint(rockTheta + (random() - 0.5) * 0.3, -out);
  }
  function playSpot() {
    return islandPoint(rockTheta + (random() - 0.5) * 0.35, -(3.5 + random() * 9));
  }
}
