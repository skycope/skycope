import * as THREE from "three";
import { seededRandom } from "./random.js";
import { islandPoint, shoreRadius, ISLAND } from "./terrain.js";
import {
  sculpt, ellipsoid, capsule, animalMaterial, animalMesh, DEFORM_GLSL, placeInstance, formGeometry, herdBounds,
  clamp, smooth,
} from "./animal-forms.js";

// A southern right whale offshore (they come to the Cape coast in winter
// and spring to calve): mostly you see nothing, then a bushy V-shaped blow
// that hangs and drifts on the wind, a broad black back rolling through
// with no fin, a few breaths, and the flukes lifting as it sounds. Now and
// then, more often if the cat sits watching from the point, it breaches:
// two-thirds of its body out of the sea, a twist in the air, and a white
// crash; or it slaps its flukes down, or holds them up in the wind.
//
// Events (x, z coast metres; d metres from the cat; gain 0…1 already with
// distance; a whale is heard over 100–250 m):
//   blow   — a deep, hollow exhalation ~1.5 s, then the inhale
//   breach — the body leaving the water: a rushing pour
//   crash  — the fall: a deep boom and long hiss of falling water
//   slap   — a fluke slap: a sharp crack carried over the water
//   fluke  — the flukes lifting as it dives: a soft pour of water
export const WHALE_EVENTS = ["blow", "breach", "crash", "slap", "fluke"];

const LENGTH = 14;

export function whaleGeometry({ light = false } = {}) {
  const prims = [
    ellipsoid("body", [0, 0, -0.6], [1.65, 1.75, 4.4], { k: 0 }),
    ellipsoid("body", [0, 0.05, 2.4], [1.6, 1.65, 2.6], { k: 0.9 }),
    // The bowed lower lips and the narrow, arched upper jaw.
    ellipsoid("head", [0, -0.45, 4.5], [1.3, 1.15, 2.25], { k: 0.6 }),
    capsule("head", [0, 0.75, 2.9], [0, 0.45, 6.6], 0.8, 0.42, { k: 0.7, squash: [0.95, 0.75] }),
    capsule("tail", [0, 0.15, -4.2], [0, 0.2, -6.9], 1.15, 0.36, { k: 1.0, squash: [1, 0.62] }),
  ];
  for (const s of [-1, 1]) {
    const side = s < 0 ? "L" : "R";
    prims.push(
      capsule(`fluke${side}`, [0, 0.2, -6.8], [s * 2.5, 0.2, -7.75], 0.62, 0.32, { k: 0.35, squash: [1.1, 0.32] }),
      capsule(`flipper${side}`, [s * 1.35, -0.75, 2.0], [s * 2.4, -1.35, 1.2], 0.5, 0.42, { k: 0.3, squash: [1.25, 0.35] }),
    );
  }
  return sculpt({
    prims,
    cell: light ? 0.2 : 0.16,
    triangles: light ? 1000 : 1700,
    blend: 0.4,
    aoRadius: 0.6,
    paint: (p, n, w) => [w.ao, w.ao, w.ao].map((v) => v ** (1 / 2.2)),
    attributes: {
      // x: tail stock (grows toward the flukes), y: flipper (signed),
      // z: flukes, w: head.
      part: { size: 4, value: (p, n, w) => [clamp((-p[2] - 2.5) / 4.5, 0, 1), w.flipperR - w.flipperL, w.flukeL + w.flukeR, w.head] },
      tags: { size: 4, value: (p, n, w) => [w.head, w.flukeL + w.flukeR, w.flipperL + w.flipperR, 0] },
    },
  });
}

// Black, with irregular white patches on the belly and the pale, crusted
// callosities on the head (on the rostrum, over the eyes, on the chin and
// lip): each whale's own pattern.
export const WHALE_PAINT = `
vec3 animalPaint( vec3 p, vec3 n, vec4 tags ) {
  vec3 c = srgb( vec3( 0.045, 0.047, 0.055 ) );
  float belly = smoothstep( -0.4, -0.85, n.y ) * aaStep( 0.62, vnoise( p * 0.45 + 2.0 ) );
  c = mix( c, srgb( vec3( 0.7, 0.72, 0.72 ) ), belly );
  // Callosities: lumpy pale patches, warm (whale lice) round the edges.
  float head = smoothstep( 2.6, 3.4, p.z );
  float crest = smoothstep( 0.35, 0.8, n.y ) * smoothstep( 4.0, 4.6, p.z );
  float brow = ( 1.0 - smoothstep( 0.25, 0.5, abs( abs( p.x ) - 1.0 ) ) ) * smoothstep( 0.2, 0.7, p.y ) * smoothstep( 3.2, 3.7, p.z ) * ( 1.0 - smoothstep( 4.2, 4.6, p.z ) );
  float chin = smoothstep( 5.2, 6.0, p.z ) * smoothstep( -0.2, -0.6, p.y );
  float lumps = vnoise( p * 3.2 ) * 0.7 + vnoise( p * 9.0 ) * 0.3;
  float callus = head * max( max( crest, brow ), chin ) * aaStep( 0.45, lumps );
  c = mix( c, mix( srgb( vec3( 0.86, 0.8, 0.66 ) ), srgb( vec3( 0.8, 0.62, 0.42 ) ), smoothstep( 0.45, 0.55, lumps ) * 0.5 ), callus );
  return c;
}`;

export const WHALE_DEFORM = `${DEFORM_GLSL}
attribute vec4 part;
// pose: fluke beat angle, tail arch (raise the flukes), flipper sweep, -.
attribute vec4 pose;
void animalDeform( inout vec3 p, inout vec3 n ) {
  // The tail stock bends progressively; the flukes follow it.
  float t = part.x;
  if ( t > 0.01 ) {
    float bend = pose.x + pose.y;
    turnAbout( p, n, vec3( 0.0, 0.1, -2.6 ), rotX( bend * 0.45 ), smoothstep( 0.0, 0.5, t ) );
    turnAbout( p, n, vec3( 0.0, 0.15, -4.8 ), rotX( bend * 0.55 ), smoothstep( 0.4, 1.0, t ) );
  }
  if ( part.z > 0.01 ) turnAbout( p, n, vec3( 0.0, 0.2, -6.7 ), rotX( pose.x * 0.5 ), part.z );
  float f = part.y;
  if ( abs( f ) > 0.01 ) {
    float s = sign( f );
    turnAbout( p, n, vec3( s * 1.35, -0.75, 2.0 ), rotY( s * pose.z ) * rotZ( s * pose.z * 0.4 ), abs( f ) );
  }
}`;

// offshore: metres beyond the shore at `theta` where it ranges.
export function createWhale(group, { seed, theta, light = false, spray = null }) {
  const random = seededRandom(seed ^ 0x0b1e3a7f);
  const events = [];
  const geometry = formGeometry("whale", { light }, whaleGeometry);
  const shared = { time: { value: 0 } };
  const material = animalMaterial({ name: "whale", uniforms: shared, pars: WHALE_DEFORM, paint: WHALE_PAINT, roughness: 0.42, sheen: 0.18 });
  const { mesh, attrs } = animalMesh(group, geometry, material, 1, { pose: 4 });
  const bounds = herdBounds(mesh);
  const viewpoint = islandPoint(theta, 1.5);
  const whale = {
    // Where along its beat it is (radians round the island) and which way.
    along: theta,
    dir: random() < 0.5 ? -1 : 1,
    offshore: 95 + random() * 25,
    x: islandPoint(theta, -100).x,
    z: islandPoint(theta, -100).z,
    y: -4,
    heading: 0,
    pitch: 0,
    roll: 0,
    // under | rise | breathe | sound | breach | slap | sail
    state: "under",
    timer: 8 + random() * 10,
    breaths: 0,
    t: 0,
    beat: 0,
    arch: 0,
    flipper: 0,
    waiting: 0,
    blown: false,
    crashed: false,
  };
  const interest = { x: 0, y: 0, z: 0, kind: "whale", near: false, d: 0 };
  // The frame's distance to the cat and sea level, for the helpers below.
  const ctx = { dc: 0, level: 0 };
  function say(type, gain) {
    const w = whale;
    events.push({ type, x: w.x, z: w.z, d: ctx.dc, gain: gain * clamp(1 - ctx.dc / 260, 0, 1) });
    show = type === "fluke" ? 3 : 6;
    showX = w.x;
    showY = Math.max(ctx.level + 2, w.y);
    showZ = w.z;
  }
  function blow(w, level) {
    say("blow", 0.8);
    if (!spray) return;
    // The V: two bushy plumes from the paired blowholes, up to ~5 m,
    // that hang and drift downwind.
    const fx = Math.sin(w.heading);
    const fz = Math.cos(w.heading);
    const hx = w.x + fx * 2.2;
    const hz = w.z + fz * 2.2;
    // Each plume is a column: puffs launched at a spread of speeds, so the
    // spout stands from the water to its top at once and then billows.
    for (let side = -1; side <= 1; side += 2) {
      for (let k = 0; k < 5; k++) {
        const up = 1.5 + k * 1.7;
        spray.emit({
          x: hx + fz * side * 0.3, y: level + 0.8, z: hz - fx * side * 0.3,
          count: light ? 2 : 4, vx: (fz * side * 0.22 + fx * 0.08) * up, vy: up, vz: (-fx * side * 0.22 + fz * 0.08) * up,
          spread: 0.35 + k * 0.1, size: 0.3 + k * 0.12, grow: 0.9 + k * 0.2, life: 4, fall: 0.12, drag: 0.9, opacity: 0.5,
        });
      }
    }
  }
  function drip(w, level, count) {
    if (!spray) return;
    const fx = Math.sin(w.heading);
    const fz = Math.cos(w.heading);
    spray.emit({ x: w.x - fx * 7, y: level + 3, z: w.z - fz * 7, count, vy: 0.5, spread: 1.5, size: 0.35, grow: 0.3, life: 1.6, fall: 1, drag: 0.2, opacity: 0.7 });
  }
  function splash(w, level, strength) {
    if (!spray) return;
    const n = Math.round((light ? 28 : 56) * strength);
    spray.emit({ x: w.x, y: level + 0.5, z: w.z, count: n, vy: 7 * strength + 2, spread: 6, size: 1.2, grow: 2.2, life: 2.6, fall: 0.9, drag: 0.4, opacity: 0.9 });
    spray.emit({ x: w.x, y: level + 1, z: w.z, count: Math.round(n / 2), vy: 2, spread: 4, size: 2.4, grow: 2.5, life: 4.5, fall: 0.12, drag: 1, opacity: 0.5 });
  }
  function splashTail(w, level) {
    if (!spray) return;
    const fx = Math.sin(w.heading);
    const fz = Math.cos(w.heading);
    spray.emit({ x: w.x - fx * 7, y: level + 0.3, z: w.z - fz * 7, count: light ? 12 : 24, vy: 5, spread: 3.5, size: 0.8, grow: 1.6, life: 2, fall: 0.9, drag: 0.4, opacity: 0.85 });
  }
  let show = 0;
  let showX = 0;
  let showY = 0;
  let showZ = 0;

  return {
    pois: [{ id: "whale-point", title: "Whale lookout", x: viewpoint.x, z: viewpoint.z, r: 8 }],
    events,
    whale,
    update({ dt, time, night, wind, pose, water, eye }) {
      shared.time.value = time;
      const w = whale;
      // Cruise along the beat, slowly, turning back at its ends.
      const radius = shoreRadius(w.along) + w.offshore;
      const speed = w.state === "under" ? 1.6 : w.state === "breach" ? 0 : 1.1;
      w.along += (w.dir * speed * dt) / radius;
      if (Math.abs(Math.atan2(Math.sin(w.along - theta), Math.cos(w.along - theta))) > 0.55 && w.state === "under") {
        w.dir = Math.sign(Math.atan2(Math.sin(theta - w.along), Math.cos(theta - w.along)));
      }
      w.x = ISLAND.x + Math.cos(w.along) * radius;
      w.z = ISLAND.z + Math.sin(w.along) * radius;
      // Tangent to the beat.
      w.heading = Math.atan2(-Math.sin(w.along) * w.dir, Math.cos(w.along) * w.dir);
      const dc = Math.hypot(w.x - pose.x, w.z - pose.z);
      const de = eye ? Math.hypot(w.x - eye.x, w.z - eye.z) : dc;
      // A cat sitting quietly at the lookout makes a breach likelier.
      const watching = Math.hypot(pose.x - viewpoint.x, pose.z - viewpoint.z) < 10 && (pose.sit ?? 0) > 0.8;
      w.waiting = watching ? w.waiting + dt : Math.max(0, w.waiting - dt * 0.2);
      w.timer -= dt;
      w.t += dt;
      const level = water ? finite(water(w.x, w.z).level) : 0;
      ctx.dc = dc;
      ctx.level = level;
      let y = -4;
      let pitch = 0;
      let roll = 0;
      let arch = 0;
      let beat = Math.sin(time * 0.55) * 0.12;
      if (w.state === "under") {
        if (w.timer < 0) {
          const chance = 0.12 + Math.min(0.5, w.waiting / 120);
          const r = random();
          go(r < chance ? "breach" : r < chance + 0.08 ? "slap" : r < chance + 0.12 ? "sail" : "rise");
          w.breaths = 2 + Math.floor(random() * 3);
        }
      } else if (w.state === "rise" || w.state === "breathe") {
        // Each breath: the head breaks the surface and blows, then the back
        // rolls through and slips under.
        const T = 9;
        const k = w.t / T;
        const up = smooth(0, 0.15, k) * (1 - smooth(0.7, 1, k));
        y = -2.25 + up * 1.4;
        pitch = 0.1 - 0.22 * smooth(0.1, 0.9, k);
        if (!w.blown && k > 0.12) {
          w.blown = true;
          blow(w, level);
        }
        if (k >= 1) {
          w.breaths--;
          w.blown = false;
          if (w.breaths > 0) go("breathe");
          else go("sound");
        }
      } else if (w.state === "sound") {
        // The terminal dive: the back arches high and the flukes lift clear.
        const T = 11;
        const k = w.t / T;
        y = -1.3 + Math.sin(Math.PI * clamp(k * 1.2, 0, 1)) * 0.8 - smooth(0.6, 1, k) * 2.5;
        pitch = 0.15 + smooth(0.1, 0.8, k) * 0.75;
        arch = -smooth(0.25, 0.7, k) * 1.4;
        beat = 0;
        if (!w.blown && k > 0.5) {
          w.blown = true;
          say("fluke", 0.6);
          drip(w, level, 6);
        }
        if (k >= 1) go("under", 40 + random() * 50);
      } else if (w.state === "breach") {
        // Up from below, steeply, two-thirds clear, twisting, and down on
        // its side.
        const T = 6.5;
        const k = w.t / T;
        const rise = smooth(0.0, 0.45, k);
        const fall = smooth(0.45, 0.8, k);
        y = -6 + rise * 9 - fall * 5.5;
        pitch = -1.25 * (1 - fall) - 0.1 * fall + smooth(0.8, 1, k) * 0.3;
        roll = smooth(0.3, 0.75, k) * 1.6 * (w.dir > 0 ? 1 : -1);
        w.flipper = smooth(0.25, 0.5, k) * 0.9;
        beat = Math.sin(w.t * 3) * 0.3 * (1 - rise);
        if (!w.blown && y > level - 1) {
          w.blown = true;
          say("breach", 1);
          splash(w, level, 0.5);
        }
        if (!w.crashed && k > 0.7) {
          w.crashed = true;
          say("crash", 1);
          splash(w, level, 1);
        }
        if (k >= 1) go("under", 30 + random() * 40);
      } else if (w.state === "slap" || w.state === "sail") {
        // Head down, flukes up: slapped down (with a crack) or held aloft in
        // the wind like a sail.
        const T = w.state === "slap" ? 9 : 20;
        const k = w.t / T;
        y = -3.2 + smooth(0, 0.15, k) * 1.4 - smooth(0.85, 1, k) * 2;
        pitch = 1.25 * smooth(0, 0.2, k);
        arch = -0.4;
        if (w.state === "slap") {
          const phase = (w.t % 3) / 3;
          beat = -0.6 + Math.sin(phase * Math.PI * 2) * 0.9;
          const slapNow = phase > 0.7 && phase < 0.75 && k > 0.2 && k < 0.9;
          if (slapNow && !w.blown) {
            w.blown = true;
            say("slap", 0.8);
            splashTail(w, level);
          }
          if (phase < 0.5) w.blown = false;
        } else beat = -0.3 + Math.sin(time * 0.4) * 0.08;
        if (k >= 1) go("under", 40 + random() * 40);
      }
      w.y += (y + level - w.y) * Math.min(1, dt * (w.state === "breach" ? 30 : 1.4));
      w.pitch += (pitch - w.pitch) * Math.min(1, dt * (w.state === "breach" ? 10 : 1.2));
      w.roll += (roll - w.roll) * Math.min(1, dt * (w.state === "breach" ? 6 : 1));
      w.arch += (arch - w.arch) * Math.min(1, dt * 1.5);
      w.beat += (beat - w.beat) * Math.min(1, dt * 3);
      if (w.state !== "breach") w.flipper += (0 - w.flipper) * Math.min(1, dt);
      const visible = w.y > level - 3.5 && de < 240 && geometry.userData.ready;
      mesh.visible = visible;
      if (visible) {
        // The body pitches about its middle, so a nose-up breach rises.
        bounds.begin();
        placeInstance(mesh, 0, w.x, w.y, w.z, w.heading, w.pitch, w.roll, 1);
        bounds.add(w.x, w.y, w.z, 9);
        attrs.pose.setXYZW(0, w.beat, w.arch, w.flipper, 0);
        attrs.waterline.setX(0, level);
        attrs.wet.setX(0, 1);
        bounds.end();
        mesh.instanceMatrix.needsUpdate = true;
        attrs.pose.needsUpdate = true;
        attrs.waterline.needsUpdate = true;
        attrs.wet.needsUpdate = true;
      }
      // The cat looks out to sea for a few seconds after a blow or a breach:
      // a point 4 m off in the whale's direction (the head only turns to
      // things within 5 m), at the whale's elevation.
      show = Math.max(0, show - dt);
      if (show <= 0 || dc > 230) return null;
      const s = 4 / dc;
      interest.x = pose.x + (showX - pose.x) * s;
      interest.z = pose.z + (showZ - pose.z) * s;
      interest.y = pose.y + 0.3 + (showY - pose.y - 0.3) * s;
      interest.d = 4.5;
      return interest;

    },
    dispose() {
      geometry.dispose();
      material.dispose();
      mesh.dispose();
      group.remove(mesh);
    },
  };

  function go(state, timer = 0) {
    whale.state = state;
    whale.t = 0;
    whale.timer = timer;
    whale.blown = false;
    whale.crashed = false;
  }
}

function finite(v) {
  return Number.isFinite(v) ? v : 0;
}
