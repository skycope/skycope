import * as THREE from "three";
import { seededRandom } from "./random.js";
import { groundHeight, islandPoint, shoreDistance, ISLAND } from "./terrain.js";
import {
  sculpt, ellipsoid, capsule, animalMaterial, animalMesh, DEFORM_GLSL, placeInstance, formGeometry, herdBounds,
  wrap, clamp, smooth, turnToward,
} from "./animal-forms.js";

// Small lives along the shore and in the fynbos:
// - an angulate tortoise (Chersina angulata) plodding between the flowers,
//   cropping them; it pulls head and legs into its shell with a hiss if the
//   cat comes close or pounces, and only peeks out again once all is quiet;
// - a pair of African black oystercatchers at the swash, probing the wet
//   sand with their red bills and running ahead of each wave; a cat makes
//   them pipe and walk off, then flush low along the shore and land farther
//   on, still piping.
//
// Events (x, z coast metres; d from the cat; gain 0…1 with distance):
//   hiss — the tortoise withdrawing: a short, breathy exhale (~0.4 s)
//   pipe — oystercatcher alarm: loud ringing "kleep-kleep" calls, ~1 s
//   flush — oystercatchers taking off: wingbeats and a piping trill
export const SHORE_EVENTS = ["hiss", "pipe", "flush"];

// ---------------------------------------------------------------------------
// Tortoise: shell ~26 cm long, facing +z, plastron on the ground.

// solid: grown in and out over the last 20 m before the hide radius, so
// the herd never pops in or out of view.
const grownAt = (d, radius) => 1 - Math.min(1, Math.max(0, (d - (radius - 20)) / 20)) ** 2;
let tortoiseGrow = 1, pairGrow = 1;

export function tortoiseGeometry({ light = false } = {}) {
  const prims = [
    ellipsoid("shell", [0, 0.07, 0], [0.095, 0.075, 0.13], { k: 0 }),
    // The flat plastron, and the gular spur jutting forward under the chin.
    ellipsoid("shell", [0, 0.035, 0.0], [0.1, 0.03, 0.135], { k: 0.02 }),
    capsule("shell", [0, 0.02, 0.1], [0, 0.022, 0.155], 0.018, 0.01, { k: 0.015, squash: [1.4, 0.6] }),
    capsule("neck", [0, 0.05, 0.1], [0, 0.065, 0.165], 0.02, 0.017, { k: 0.01, blend: 0.006 }),
    ellipsoid("head", [0, 0.07, 0.18], [0.019, 0.017, 0.026], { k: 0.012, blend: 0.006 }),
  ];
  for (const [sx, sz, tag] of [[-1, 1, "legLF"], [1, 1, "legRF"], [-1, -1, "legLH"], [1, -1, "legRH"]]) {
    prims.push(capsule(tag, [sx * 0.065, 0.04, sz * 0.075], [sx * 0.085, 0.008, sz * 0.09], 0.019, 0.016, { k: 0.01, blend: 0.006 }));
  }
  return sculpt({
    prims,
    cell: light ? 0.007 : 0.0055,
    triangles: light ? 700 : 1200,
    blend: 0.008,
    aoRadius: 0.02,
    paint: (p, n, w) => [w.ao, w.ao, w.ao].map((v) => v ** (1 / 2.2)),
    attributes: {
      // x: head and neck, y: leg side (signed), z: leg end (+ front),
      // w: shell.
      part: {
        size: 4,
        value: (p, n, w) => [w.head + w.neck, w.legRF + w.legRH - w.legLF - w.legLH, w.legLF + w.legRF - w.legLH - w.legRH, w.shell],
      },
      tags: { size: 4, value: (p, n, w) => [w.shell, w.head + w.neck, w.legLF + w.legRF + w.legLH + w.legRH, 0] },
    },
  });
}

// The carapace in scutes: each a dark blotch on straw-yellow with black
// seams, the marginals barred; the plastron pale with a dark centre;
// head and legs tan-yellow, scaled.
export const TORTOISE_PAINT = `
vec2 scuteCell( vec2 q, out float edge ) {
  // Distance to the nearest and second-nearest scute centres on a skewed grid.
  vec2 i = floor( q );
  float d1 = 9.0, d2 = 9.0;
  vec2 best = vec2( 0.0 );
  for ( int y = -1; y <= 1; y++ ) for ( int x = -1; x <= 1; x++ ) {
    vec2 c = i + vec2( x, y );
    vec2 o = c + 0.5 + ( vec2( hash31( vec3( c, 1.0 ) ), hash31( vec3( c, 2.0 ) ) ) - 0.5 ) * 0.35;
    float d = length( q - o );
    if ( d < d1 ) { d2 = d1; d1 = d; best = c; } else if ( d < d2 ) d2 = d;
  }
  edge = d2 - d1;
  return vec2( d1, hash31( vec3( best, 3.0 ) ) );
}
vec3 animalPaint( vec3 p, vec3 n, vec4 tags ) {
  vec3 straw = srgb( vec3( 0.78, 0.62, 0.3 ) );
  vec3 dark = srgb( vec3( 0.11, 0.08, 0.05 ) );
  float top = smoothstep( 0.035, 0.05, p.y );
  // Scutes on the dome: a grid in (around, along) over the shell.
  vec2 q = vec2( atan( p.x, p.y - 0.02 ) * 2.2, p.z * 22.0 );
  float edge;
  vec2 cell = scuteCell( q, edge );
  float blotch = 1.0 - smoothstep( 0.18, 0.3, cell.x );
  vec3 shell = mix( straw, dark, blotch * 0.85 );
  shell = mix( shell, srgb( vec3( 0.86, 0.48, 0.18 ) ), smoothstep( 0.32, 0.5, cell.x ) * 0.35 * cell.y );
  shell = mix( dark, shell, aaStep( 0.06, edge ) );
  // Marginals: barred.
  float margin = 1.0 - smoothstep( 0.04, 0.055, p.y );
  shell = mix( shell, mix( straw, dark, step( 0.5, fract( atan( p.x, p.z ) * 5.0 ) ) ), margin * top );
  vec3 plastron = mix( srgb( vec3( 0.82, 0.72, 0.5 ) ), dark, smoothstep( 0.06, 0.03, length( p.xz * vec2( 1.2, 0.8 ) ) ) * 0.6 );
  vec3 c = mix( plastron, shell, top );
  vec3 skin = srgb( vec3( 0.62, 0.5, 0.3 ) ) * ( 0.8 + 0.4 * vnoise( p * 400.0 ) );
  c = mix( c, skin, smoothstep( 0.4, 0.6, tags.y + tags.z ) );
  // Eye.
  float eye = length( vec3( abs( p.x ) - 0.015, p.y - 0.075, p.z - 0.19 ) );
  return mix( c, srgb( vec3( 0.03 ) ), ( 1.0 - aaStep( 0.004, eye ) ) * tags.y );
}`;

export const TORTOISE_DEFORM = `${DEFORM_GLSL}
attribute vec4 part;
// pose: withdrawn (0 out … 1 in), head yaw, head pitch (+ up), gait phase;
// pose2: gait amplitude, chew, -, -.
attribute vec4 pose;
attribute vec4 pose2;
uniform float time;
void animalDeform( inout vec3 p, inout vec3 n ) {
  float h = part.x;
  if ( h > 0.01 ) {
    float chew = pose2.y * sin( time * 9.0 ) * 0.08;
    turnAbout( p, n, vec3( 0.0, 0.05, 0.1 ), rotY( pose.y ) * rotX( -pose.z - chew ), clamp( h, 0.0, 1.0 ) );
    // In: the head slides back under the shell's rim.
    p.z -= pose.x * 0.085 * h;
    p.y -= pose.x * 0.01 * h;
  }
  float side = part.y;
  if ( abs( side ) > 0.01 ) {
    float front = sign( part.z );
    // Diagonal pairs step together, slowly.
    float ph = pose.w + ( side * front > 0.0 ? 0.0 : 3.14159 );
    float lift = max( 0.0, sin( ph ) ) * pose2.x;
    p.y += lift * 0.012 * abs( side );
    p.z += cos( ph ) * pose2.x * 0.018 * abs( side );
    // In: legs fold up and in, scaled into the shell.
    vec3 hip = vec3( sign( side ) * 0.06, 0.045, front * 0.07 );
    p = mix( p, hip + ( p - hip ) * 0.35, pose.x * abs( side ) );
  }
}`;

export function createTortoise(group, { seed, flowers, light = false, blobs = null, home = null }) {
  const random = seededRandom(seed ^ 0x70270153);
  const events = [];
  const geometry = formGeometry("tortoise", { light }, tortoiseGeometry);
  const shared = { time: { value: 0 } };
  const material = animalMaterial({ name: "tortoise", uniforms: shared, pars: TORTOISE_DEFORM, paint: TORTOISE_PAINT, roughness: 0.55, sheen: 0.3 });
  const { mesh, attrs } = animalMesh(group, geometry, material, 1, { pose: 4, pose2: 4 });
  const bounds = herdBounds(mesh);
  // Its range: the flowering fynbos nearest the cat's start, in from the
  // beach (so it is met early, on the way up from the sand).
  const patch = (flowers ?? [])
    .map((f) => ({ f, inland: shoreDistance(f.x, f.z), d: home ? Math.hypot(f.x - home.x, f.z - home.z) : 0 }))
    .filter((p) => p.inland > 7 && p.inland < 22)
    .sort((a, b) => a.d - b.d)
    .slice(0, 12)
    .map((p) => p.f);
  const start = patch[0] ?? islandPoint(Math.atan2(-70, -52) + 0.1, 10);
  const t = {
    x: start.x + 0.6,
    z: start.z + 0.6,
    heading: random() * Math.PI * 2,
    in: 0,
    want: 0,
    quiet: 0,
    target: null,
    pause: 2,
    gait: 0,
    gaitAmp: 0,
    yaw: 0,
    pitch: 0,
    chew: 0,
    speed: 0,
  };
  const interest = { x: 0, y: 0, z: 0, kind: "tortoise", near: false, d: 0 };
  return {
    pois: [{ id: "tortoise", title: "Tortoise", x: start.x, z: start.z, r: 4 }],
    events,
    tortoise: t,
    update({ dt, time, pose }) {
      shared.time.value = time;
      const dx = t.x - pose.x;
      const dz = t.z - pose.z;
      const dc = Math.hypot(dx, dz);
      mesh.visible = dc < 60 && geometry.userData.ready;
      tortoiseGrow = grownAt(dc, 60);
      if (dc > 60) return null;
      const startled = dc < 1.3 || (dc < 2.6 && (pose.air > 0.05 || Math.abs(pose.speed) > 2));
      if (startled) {
        if (t.want < 1) events.push({ type: "hiss", x: t.x, z: t.z, d: dc, gain: clamp(1 - dc / 12, 0, 1) * 0.7 });
        t.want = 1;
        t.quiet = 0;
      } else if (t.want > 0) {
        t.quiet += dt;
        // Only once the cat has been still or away a while.
        if (t.quiet > (dc > 3 ? 6 : 12)) t.want = 0;
      }
      // Withdrawing is quick; coming out is slow and wary, head first.
      t.in += (t.want - t.in) * Math.min(1, dt * (t.want > t.in ? 9 : 0.5));
      let speed = 0;
      let chew = 0;
      let yaw = 0;
      let pitch = 0;
      if (t.in < 0.05) {
        t.pause -= dt;
        if (!t.target && t.pause < 0) {
          const f = patch[Math.floor(random() * patch.length)];
          t.target = f ? { x: f.x + (random() - 0.5) * 0.8, z: f.z + (random() - 0.5) * 0.8 } : null;
        }
        if (t.target) {
          const tx = t.target.x - t.x;
          const tz = t.target.z - t.z;
          const td = Math.hypot(tx, tz);
          t.heading = turnToward(t.heading, Math.atan2(tx, tz), dt * 0.6);
          speed = 0.06 * Math.max(0, Math.cos(wrap(Math.atan2(tx, tz) - t.heading)));
          pitch = -0.1 + Math.sin(t.gait * 0.5) * 0.05;
          if (td < 0.15) {
            t.target = null;
            t.pause = 6 + random() * 12;
          }
        } else {
          // Cropping the flowers.
          chew = 1;
          pitch = -0.35 + Math.max(0, Math.sin(time * 0.8)) * 0.25;
        }
      } else {
        // Peeking: a slow look toward the cat.
        yaw = clamp(wrap(Math.atan2(-dx, -dz) - t.heading), -0.8, 0.8);
        pitch = 0.1;
      }
      t.speed += (speed - t.speed) * Math.min(1, dt * 3);
      t.x += Math.sin(t.heading) * t.speed * dt;
      t.z += Math.cos(t.heading) * t.speed * dt;
      t.gait += dt * t.speed * 55;
      t.gaitAmp += ((t.speed > 0.01 ? 1 : 0) - t.gaitAmp) * Math.min(1, dt * 4);
      t.yaw += (yaw - t.yaw) * Math.min(1, dt * 2);
      t.pitch += (pitch - t.pitch) * Math.min(1, dt * 3);
      t.chew += (chew - t.chew) * Math.min(1, dt * 3);
      const y = groundHeight(t.x, t.z);
      // On a slope it tilts with the ground.
      const fx = Math.sin(t.heading) * 0.12;
      const fz = Math.cos(t.heading) * 0.12;
      const slope = Math.atan2(groundHeight(t.x - fx, t.z - fz) - groundHeight(t.x + fx, t.z + fz), 0.24);
      const sway = Math.sin(t.gait) * 0.03 * t.gaitAmp;
      bounds.begin();
      placeInstance(mesh, 0, t.x, y - t.in * 0.012, t.z, t.heading, slope, sway, 1.25 * tortoiseGrow);
      bounds.add(t.x, y - t.in * 0.012, t.z, 0.3);
      attrs.pose.setXYZW(0, t.in, t.yaw, t.pitch, t.gait);
      attrs.pose2.setXYZW(0, t.gaitAmp, t.chew, 0, 0);
      bounds.end();
      mesh.instanceMatrix.needsUpdate = true;
      attrs.pose.needsUpdate = true;
      attrs.pose2.needsUpdate = true;
      blobs?.add(t.x, y, t.z, t.heading, 0.42, 0.34, 1);
      if (dc > 5) return null;
      interest.x = t.x;
      interest.y = y + 0.1;
      interest.z = t.z;
      interest.near = dc < 2;
      interest.d = dc;
      return interest;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      mesh.dispose();
      group.remove(mesh);
    },
  };
}

// ---------------------------------------------------------------------------
// African black oystercatcher, ~44 cm, standing, facing +z.

export function oystercatcherGeometry({ light = false } = {}) {
  const prims = [
    ellipsoid("body", [0, 0.2, -0.01], [0.062, 0.065, 0.14], { rot: [0.2, 0, 0], k: 0 }),
    ellipsoid("neck", [0, 0.26, 0.09], [0.036, 0.045, 0.04], { k: 0.04 }),
    ellipsoid("head", [0, 0.29, 0.12], [0.032, 0.032, 0.038], { k: 0.025 }),
    capsule("tail", [0, 0.2, -0.1], [0, 0.185, -0.2], 0.035, 0.012, { k: 0.02, squash: [1.4, 0.4] }),
  ];
  for (const s of [-1, 1]) {
    const side = s < 0 ? "L" : "R";
    // Folded wings, lying along the back to the tail.
    prims.push(capsule(`wing${side}`, [s * 0.045, 0.235, 0.06], [s * 0.03, 0.215, -0.19], 0.03, 0.012, { k: 0.012, squash: [1.6, 0.45], blend: 0.006 }));
  }
  const extras = [];
  // The long, blade-like coral-red bill.
  const bill = new THREE.CylinderGeometry(0.004, 0.0085, 0.085, 6);
  bill.rotateX(Math.PI / 2 + 0.12);
  bill.translate(0, 0.283, 0.19);
  extras.push({ geometry: bill, colour: [1, 1, 1], weights: { head: 1, bill: 1 } });
  for (const s of [-1, 1]) {
    // Eye, with its red ring.
    const eye = new THREE.SphereGeometry(0.0065, 6, 4);
    eye.translate(s * 0.024, 0.298, 0.137);
    extras.push({ geometry: eye, colour: [1, 1, 1], weights: { head: 1, eye: 1 } });
    // Stout pink legs.
    const leg = new THREE.CylinderGeometry(0.0045, 0.0045, 0.15, 5);
    leg.translate(s * 0.022, 0.075, 0.0);
    extras.push({ geometry: leg, colour: [1, 1, 1], weights: { [s < 0 ? "legL" : "legR"]: 1, leg: 1 } });
    const foot = new THREE.BoxGeometry(0.03, 0.004, 0.035);
    foot.translate(s * 0.022, 0.002, 0.012);
    extras.push({ geometry: foot, colour: [1, 1, 1], weights: { [s < 0 ? "legL" : "legR"]: 1, leg: 1 } });
  }
  return sculpt({
    prims,
    cell: light ? 0.009 : 0.007,
    triangles: light ? 500 : 900,
    blend: 0.01,
    aoRadius: 0.02,
    paint: (p, n, w) => [w.ao, w.ao, w.ao].map((v) => v ** (1 / 2.2)),
    attributes: {
      // x: head (and bill), y: wing (signed), z: leg (signed), w: -.
      part: { size: 4, value: (p, n, w) => [w.head + w.neck * 0.6 + (w.bill ?? 0), (w.wingR - w.wingL), (w.legR ?? 0) - (w.legL ?? 0), 0] },
      tags: { size: 4, value: (p, n, w) => [w.bill ?? 0, w.leg ?? 0, w.eye ?? 0, 0] },
    },
    extras,
  });
}

export const OYSTERCATCHER_PAINT = `
vec3 animalPaint( vec3 p, vec3 n, vec4 tags ) {
  vec3 c = srgb( vec3( 0.03, 0.03, 0.035 ) ) * ( 0.85 + 0.3 * vnoise( p * 300.0 ) );
  c = mix( c, srgb( vec3( 0.88, 0.22, 0.1 ) ), step( 0.5, tags.x ) );
  c = mix( c, srgb( vec3( 0.86, 0.55, 0.55 ) ), step( 0.5, tags.y ) );
  // Eye: red ring round a red iris.
  return mix( c, srgb( vec3( 0.75, 0.12, 0.08 ) ), step( 0.5, tags.z ) );
}`;

export const OYSTERCATCHER_DEFORM = `${DEFORM_GLSL}
attribute vec4 part;
// pose: head pitch (+ up; probing is strongly down), head yaw, gait phase,
// gait amplitude; pose2: flight (0 folded … 1 spread), -, -, -.
attribute vec4 pose;
attribute vec4 pose2;
uniform float time;
void animalDeform( inout vec3 p, inout vec3 n ) {
  float leg = part.z;
  if ( abs( leg ) > 0.01 ) {
    float ph = pose.z + ( leg > 0.0 ? 0.0 : 3.14159 );
    // Knee-less: the whole leg swings from the hip.
    turnAbout( p, n, vec3( sign( leg ) * 0.022, 0.15, 0.0 ), rotX( sin( ph ) * 0.45 * pose.w ), abs( leg ) * ( 1.0 - pose2.x ) );
    // Tucked under in flight.
    turnAbout( p, n, vec3( sign( leg ) * 0.022, 0.15, 0.0 ), rotX( -1.3 ), abs( leg ) * pose2.x );
  }
  float wing = part.y;
  if ( abs( wing ) > 0.01 ) {
    float s = sign( wing );
    float beat = sin( time * 16.0 + pose.z ) * 0.9 * pose2.x;
    // Spread from folded: swing out about the shoulder, then beat.
    vec3 shoulder = vec3( s * 0.045, 0.235, 0.05 );
    turnAbout( p, n, shoulder, rotZ( s * ( beat + 0.2 * pose2.x ) ) * rotY( s * 1.45 * pose2.x ), abs( wing ) );
  }
  float h = part.x;
  if ( h > 0.01 ) turnAbout( p, n, vec3( 0.0, 0.25, 0.07 ), rotY( pose.y ) * rotX( -pose.x ), clamp( h, 0.0, 1.0 ) );
}`;

export function createOystercatchers(group, { seed, theta, light = false, blobs = null, avoid = () => false }) {
  const random = seededRandom(seed ^ 0x0e7ca7c4);
  const events = [];
  const count = 2;
  const geometry = formGeometry("oystercatcher", { light }, oystercatcherGeometry);
  const shared = { time: { value: 0 } };
  const material = animalMaterial({ name: "oystercatcher", uniforms: shared, pars: OYSTERCATCHER_DEFORM, paint: OYSTERCATCHER_PAINT, roughness: 0.55, sheen: 0.3 });
  const { mesh, attrs } = animalMesh(group, geometry, material, count, { pose: 4, pose2: 4 });
  const bounds = herdBounds(mesh);
  // A beat of shore they work, and where they go when flushed.
  let beat = theta;
  const birds = Array.from({ length: count }, (_, i) => {
    const p = islandPoint(theta + i * 0.008, 0.6);
    return {
      i,
      x: p.x,
      z: p.z,
      y: groundHeight(p.x, p.z),
      heading: random() * Math.PI * 2,
      state: "forage",
      timer: random() * 2,
      probe: 0,
      gait: 0,
      gaitAmp: 0,
      fly: 0,
      target: null,
      pitch: 0,
      yaw: 0,
      speed: 0,
      vy: 0,
      flight: 0,
    };
  });
  let pipeAt = -10;
  let clock = 0;
  const interest = { x: 0, y: 0, z: 0, kind: "oystercatcher", near: false, d: 0 };
  return {
    pois: [{ id: "oystercatchers", title: "Oystercatchers", x: birds[0].x, z: birds[0].z, r: 5 }],
    events,
    birds,
    update({ dt, time, night, pose, water }) {
      clock += dt;
      shared.time.value = time;
      const dcPair = Math.hypot(birds[0].x - pose.x, birds[0].z - pose.z);
      // They roost at night, and cost nothing when far away.
      mesh.visible = night < 0.7 && dcPair < 90 && geometry.userData.ready;
      pairGrow = grownAt(dcPair, 90);
      if (!mesh.visible) return null;
      let best = null;
      let bestD = 6;
      bounds.begin();
      for (const b of birds) {
        const dx = b.x - pose.x;
        const dz = b.z - pose.z;
        const dc = Math.hypot(dx, dz) || 1e-3;
        let speed = 0;
        let pitch = 0.05;
        let yaw = 0;
        if (b.state !== "fly") {
          if (dc < 3.2 + Math.abs(pose.speed) * 0.6) {
            // Flush: up and away low along the shore, the pair together.
            for (const o of birds) {
              if (o.state === "fly") continue;
              o.state = "fly";
              o.flight = 0;
              o.vy = 1.5;
              const side = Math.sign(Math.sin(Math.atan2(o.z - ISLAND.z, o.x - ISLAND.x) - Math.atan2(pose.z - ISLAND.z, pose.x - ISLAND.x))) || 1;
              beat += side * (0.35 + random() * 0.25);
              o.target = landing(beat, o.i);
            }
            events.push({ type: "flush", x: b.x, z: b.z, d: dc, gain: clamp(1 - dc / 50, 0, 1) });
          } else if (dc < 7) {
            // Wary: piping, walking off along the shore.
            if (clock - pipeAt > 2.2) {
              pipeAt = clock;
              events.push({ type: "pipe", x: b.x, z: b.z, d: dc, gain: clamp(1 - dc / 60, 0, 1) });
            }
            b.state = "wary";
            b.heading = turnToward(b.heading, Math.atan2(dx, dz), dt * 4);
            speed = 0.5;
            pitch = 0.25;
          } else if (b.state === "wary") b.state = "forage";
        }
        if (b.state === "forage") {
          // Work the swash line: probe, step on, run up from a wave.
          b.timer -= dt;
          if (b.timer < 0) {
            b.target = islandPoint(Math.atan2(b.z - ISLAND.z, b.x - ISLAND.x) + (random() - 0.5) * 0.03, 0.3 + random() * 1.4);
            if (avoid(b.target.x, b.target.z)) b.target = null;
            b.timer = 1.5 + random() * 3;
            b.probing = random() < 0.6 ? 1.2 + random() : 0;
          }
          const wet = water ? water(b.x, b.z).level - groundHeight(b.x, b.z) : -1;
          if (wet > 0.01) {
            // A wave: trot up the beach ahead of it.
            b.target = islandPoint(Math.atan2(b.z - ISLAND.z, b.x - ISLAND.x), 1.8);
            b.probing = 0;
          }
          if (b.probing > 0) {
            b.probing -= dt;
            pitch = -1.1 + Math.abs(Math.sin(time * 7 + b.i)) * 0.25;
          } else if (b.target) {
            const tx = b.target.x - b.x;
            const tz = b.target.z - b.z;
            const td = Math.hypot(tx, tz);
            b.heading = turnToward(b.heading, Math.atan2(tx, tz), dt * 5);
            speed = wet > 0.01 ? 0.9 : 0.35;
            pitch = -0.15;
            if (td < 0.06) b.target = null;
          }
        }
        if (b.state === "fly") {
          b.flight += dt;
          const tx = b.target.x - b.x;
          const tz = b.target.z - b.z;
          const td = Math.hypot(tx, tz);
          b.heading = turnToward(b.heading, Math.atan2(tx, tz), dt * 2.5);
          speed = Math.min(7, 2 + b.flight * 4, td * 1.5 + 0.5);
          const g = groundHeight(b.x, b.z);
          const cruise = Math.max(g, 0) + Math.min(2.2, 0.4 + td * 0.12);
          b.y += (cruise - b.y) * Math.min(1, dt * 2);
          b.fly += (1 - b.fly) * Math.min(1, dt * 8);
          pitch = 0.1;
          if (td < 0.3 && b.flight > 1) {
            b.state = "forage";
            b.timer = 1;
            b.y = g;
          }
        } else {
          b.fly += (0 - b.fly) * Math.min(1, dt * 6);
          b.y = groundHeight(b.x, b.z);
        }
        b.speed += (speed - b.speed) * Math.min(1, dt * 6);
        b.x += Math.sin(b.heading) * b.speed * dt;
        b.z += Math.cos(b.heading) * b.speed * dt;
        b.gait += dt * (6 + b.speed * 30);
        b.gaitAmp += ((b.state !== "fly" && b.speed > 0.05 ? 1 : 0) - b.gaitAmp) * Math.min(1, dt * 8);
        b.pitch += (pitch - b.pitch) * Math.min(1, dt * 8);
        b.yaw += (yaw - b.yaw) * Math.min(1, dt * 6);
        placeInstance(mesh, b.i, b.x, b.y + (b.state === "fly" ? 0 : Math.abs(Math.sin(b.gait)) * 0.005 * b.gaitAmp), b.z, b.heading, b.state === "fly" ? -0.1 : 0, 0, 1.1 * pairGrow);
        bounds.add(b.x, b.y + (b.state === "fly" ? 0 : Math.abs(Math.sin(b.gait)) * 0.005 * b.gaitAmp), b.z, 0.8);
        attrs.pose.setXYZW(b.i, b.pitch, b.yaw, b.gait, b.gaitAmp);
        attrs.pose2.setXYZW(b.i, b.fly, 0, 0, 0);
        if (b.state !== "fly") blobs?.add(b.x, b.y, b.z, b.heading, 0.18, 0.12, 0.8);
        if (dc < bestD && b.state !== "fly") {
          bestD = dc;
          best = b;
        }
      }
      bounds.end();
      mesh.instanceMatrix.needsUpdate = true;
      attrs.pose.needsUpdate = true;
      attrs.pose2.needsUpdate = true;
      if (!best) return null;
      interest.x = best.x;
      interest.y = best.y + 0.25;
      interest.z = best.z;
      interest.near = bestD < 2.5;
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

  function landing(t, i) {
    for (let k = 0; k < 12; k++) {
      const p = islandPoint(t + i * 0.006 + k * 0.01, 0.8);
      if (!avoid(p.x, p.z)) return p;
    }
    return islandPoint(t, 0.8);
  }
}
