import * as THREE from "three";
import { groundHeight } from "./terrain.js";
import { patchMaterial } from "./forest.js";
import { glowMaterial, smooth01 } from "./place-kit.js";
import { markSolid, SOLID_ORDER } from "./cat-coat.js";
import { buildBoatForms, HULL, LANTERN, sheer } from "./boat-forms.js";
import { createBoatRide, RIDE } from "./boat-ride.js";
import { BOAT } from "./boat-dynamics.js";
import { SWIM_LIMIT } from "./walker.js";
import { createJellies } from "./boat-jellies.js";

// The fisherman's boat, drawn and joined to the world (boat-ride.js is its
// life, boat-dynamics.js its motion, boat-forms.js its shape). Built with
// the landscape (hidden until its gift wakes); attach() joins it to the
// walker once that exists.
//
// Draws: the hull (one mesh, ~12k triangles, cut at the sea's surface by a
// clip plane fitted to the swell under it, so the hull sits IN the water
// the WebGPU pass draws behind), the swinging hurricane lantern (metal and
// glass), and one additive mesh for the lantern's halo and the wisp's
// thread of light. Nothing draws, updates or allocates while it sleeps.
//
// Values for others (coast metres):
//   magic.afloat  null ashore; aboard { x, z, heading, speed, lamp: [x, y, z],
//                 lit (0…1) }: wildlife may approach a boat, and the wisp
//                 is towing it (its position is set here after the mind's).
//   boat.lamp     [x, y, z, strength]: the lantern for the water (main.js).
//   boat.events   refilled every frame: { type: "board" | "leave" | "launch"
//                 | "bump" | "ground" | "hull-slap" | "jump" | "refuse", gain }.
//   boat.pois     places only a boat reaches ({ id, title, x, z, r }).

const LANTERN_COLOUR = new THREE.Color(1.0, 0.56, 0.2);

export function createBoat(land, { light = false, shared, landmark, hull = null, seed = 1 }) {
  const forms = buildBoatForms({ light });
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const lampUniforms = {
    boatLamp: { value: new THREE.Vector4(0, 0, 0, 0) },
    boatLampColour: { value: LANTERN_COLOUR.clone() },
  };
  const wood = boatMaterial(shared, plane, lampUniforms);
  const glassMaterial = new THREE.MeshBasicMaterial({ color: 0x000000, fog: false });

  const group = new THREE.Group();
  group.name = "boat";
  group.matrixAutoUpdate = false;
  group.visible = false;
  const hullMesh = new THREE.Mesh(forms.hull, wood);
  const pivot = new THREE.Group();
  pivot.position.set(...LANTERN.pivot);
  const lampMesh = new THREE.Mesh(forms.lamp, wood);
  const glassMesh = new THREE.Mesh(forms.glass, glassMaterial);
  pivot.add(lampMesh, glassMesh);
  group.add(hullMesh, pivot);
  for (const m of [hullMesh, lampMesh]) {
    m.renderOrder = SOLID_ORDER;
    m.castShadow = false;
    m.receiveShadow = false;
  }
  glassMesh.castShadow = false;
  land.add(group);

  const glow = glowMesh();
  land.add(glow.mesh);
  // Where only the boat goes (boat-jellies.js).
  const jellies = createJellies(land, seed, { coveTheta: Math.atan2(landmark.z - 70, landmark.x - 58), light });
  const eye = [0, 0, 0];

  // Scratch.
  const euler = new THREE.Euler(0, 0, 0, "YXZ");
  const quat = new THREE.Quaternion();
  const scale = new THREE.Vector3(1, 1, 1);
  const pos = new THREE.Vector3();
  const flame = new THREE.Vector3();
  const flameCoast = new THREE.Vector3();
  const stemCoast = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const point = new THREE.Vector3();
  const swing = { x: 0, z: 0, vx: 0, vz: 0 };
  let ride = null;
  let magic = null;
  let wake = null;
  let launched = false;
  let tow = 0;
  const towPos = { x: 0, y: 0, z: 0, set: false };
  const afloat = { x: 0, z: 0, heading: 0, speed: 0, lamp: [0, 0, 0], lit: 0 };
  const lamp = [0, 0, 0, 0];
  const events = [];
  let lastVy = 0;
  let slapAt = 0;
  let clock = 0;

  // The pose during the launch: off its logs, rolled upright in the air,
  // gliding down the beach and settling on the water at its mooring.
  function launchPose(k, out) {
    const rest = groundHeight(landmark.x, landmark.z) + 0.25 + sheer(0);
    const m = ride.moor;
    const lift = smooth01(0, 0.14, k) * 0.45 + smooth01(0.14, 0.42, k) * 0.9;
    const roll = Math.PI * (1 - smooth01(0.14, 0.42, k));
    const glide = smooth01(0.42, 0.92, k);
    const x = landmark.x + (m.x - landmark.x) * glide;
    const z = landmark.z + (m.z - landmark.z) * glide;
    const over = Math.max(groundHeight(x, z), 0);
    const air = rest + lift;
    const settle = smooth01(0.85, 1, k);
    out.x = x;
    out.z = z;
    out.y = (air * (1 - glide) + (over + 1.1) * glide) * (1 - settle) + ride.state.level * settle;
    out.heading = landmark.facing + wrap(m.heading - landmark.facing) * smooth01(0.4, 0.9, k);
    // A tremble as it wakes, and a nod as it touches the water.
    out.roll = roll + Math.sin(k * 160) * 0.03 * (1 - smooth01(0, 0.14, k));
    out.pitch = Math.sin(Math.PI * glide) * -0.12 + Math.sin(Math.PI * settle) * 0.08;
    return out;
  }
  const pose = { x: 0, y: 0, z: 0, heading: 0, pitch: 0, roll: 0 };

  const api = {
    group,
    events,
    lamp,
    pois: [jellies.poi],
    // The lantern for the cat's coat (view space xyz, strength), or null.
    get catLamp() {
      return launched && ride?.afloat && lampUniforms.boatLamp.value.w > 0 ? lampUniforms.boatLamp.value : null;
    },
    // The lantern for the water (main.js → Atmosphere.lantern), or null.
    get lantern() {
      return launched && ride?.afloat ? lamp : null;
    },
    get ride() {
      return ride;
    },
    // Joins the walker, the sea and the shared record (main.js, once the
    // walker exists).
    attach({ walker, sea, magic: record, wake: wakeRecord }) {
      magic = record;
      wake = wakeRecord;
      ride = createBoatRide({ landmark, sea, bed: walker.bed, solids: walker.solids, magic, swimLimit: SWIM_LIMIT });
      walker.ride = ride;
      record.afloat = null;
      return api;
    },
    // After the wisp's mind (main.js, after thread.update): while the cat is
    // aboard the wisp flies ahead of the bow, towing.
    afterThread(dt, night = 0) {
      events.length = 0;
      if (!ride || !ride.afloat) return;
      clock += dt;
      for (const e of ride.events) events.push(e);
      const s = ride.state;
      const aboard = ride.ride.state === "aboard";
      tow += ((aboard ? 1 : 0) - tow) * Math.min(1, dt * (aboard ? 1.2 : 0.6));
      if (tow < 0.002) tow = 0;
      // Waves slap the hull as it falls into a trough.
      if (lastVy > -0.16 && s.vy <= -0.16 && clock - slapAt > 0.5) {
        slapAt = clock;
        events.push({ type: "hull-slap", gain: Math.min(1, -s.vy * 2) });
      }
      lastVy = s.vy;
      if (aboard) {
        afloat.x = s.x;
        afloat.z = s.z;
        afloat.heading = s.heading;
        afloat.speed = Math.hypot(s.vx, s.vz);
        afloat.lamp[0] = lamp[0];
        afloat.lamp[1] = lamp[1];
        afloat.lamp[2] = lamp[2];
        afloat.lit = lamp[3];
        magic.afloat = afloat;
      } else magic.afloat = null;
      if (tow > 0 && magic?.wisp) {
        const r = ride.ride;
        const fx = Math.sin(s.heading), fz = Math.cos(s.heading);
        // Ahead of the stem, toward where the cat is steering.
        let dx = fx, dz = fz;
        if (r.throttle > 0.05) {
          dx = fx * 0.4 + r.want[0];
          dz = fz * 0.4 + r.want[1];
          const l = Math.hypot(dx, dz) || 1;
          dx /= l;
          dz /= l;
        }
        const reach = 2.4 + 1.4 * r.throttle * (r.hurry ? 1.4 : 1);
        const tx = s.x + fx * (BOAT.length / 2) + dx * reach;
        const tz = s.z + fz * (BOAT.length / 2) + dz * reach;
        const ty = s.y + 0.95 + Math.sin(clock * 1.7) * 0.1 + Math.sin(clock * 0.63) * 0.06;
        if (!towPos.set) {
          towPos.x = magic.wisp.position[0];
          towPos.y = magic.wisp.position[1];
          towPos.z = magic.wisp.position[2];
          towPos.set = true;
        }
        const k = Math.min(1, dt * 2.5);
        towPos.x += (tx - towPos.x) * k;
        towPos.y += (ty - towPos.y) * k;
        towPos.z += (tz - towPos.z) * k;
        const w = magic.wisp;
        w.position[0] += (towPos.x - w.position[0]) * tow;
        w.position[1] += (towPos.y - w.position[1]) * tow;
        w.position[2] += (towPos.z - w.position[2]) * tow;
        w.glow = Math.max(w.glow, (0.7 + 0.5 * night) * tow);
        w.visible = true;
      } else towPos.set = false;
      // The wake: the hull's waterline in the sea while it moves.
      if (wake && ride.ride.state === "aboard") {
        const speed = Math.max(0, s.u);
        wake.body.half = 1.6;
        wake.body.flow = WAKE_FLOW;
        WAKE_FLOW[0] = -Math.sin(s.heading) * s.u;
        WAKE_FLOW[1] = -Math.cos(s.heading) * s.u;
        const strength2 = 0.6 + 1.4 * Math.min(1, speed / 1.2);
        wake.body.trailBack = 1.9;
        wake.move(s.x + Math.sin(s.heading) * 0.15, s.z + Math.cos(s.heading) * 0.15, s.heading, 1, speed, strength2, 0.5);
      }
    },
    // Every frame, before the scene renders (landscape.js): pose, clip,
    // lantern and thread. camera: the Three camera (view matrix current).
    render({ time, night, camera }) {
      if (!ride) return;
      eye[0] = camera.position.x;
      eye[1] = camera.position.y;
      eye[2] = -camera.position.z;
      jellies.update({ time, night, eye, lantern: launched && ride.afloat ? lamp : null });
      if (!ride.afloat && ride.ride.state !== "launching") return;
      if (!launched) {
        launched = true;
        hull?.launch();
        group.visible = true;
      }
      const s = ride.state;
      if (ride.ride.state === "launching") launchPose(ride.ride.launch, pose);
      else Object.assign(pose, { x: s.x, y: s.y, z: s.z, heading: s.heading, pitch: s.pitch, roll: s.roll });
      euler.set(-pose.pitch, pose.heading, -pose.roll);
      quat.setFromEuler(euler);
      pos.set(pose.x, pose.y, pose.z);
      group.matrix.compose(pos, quat, scale);
      // The lantern hangs plumb, swinging behind the boat's motion.
      const dt = Math.min(0.05, Math.max(0, time - (api.lastTime ?? time)));
      api.lastTime = time;
      swing.vx += (-40 * (swing.x - pose.pitch) - 2.2 * swing.vx) * dt;
      swing.vz += (-40 * (swing.z - pose.roll) - 2.2 * swing.vz) * dt;
      swing.x += swing.vx * dt;
      swing.z += swing.vz * dt;
      pivot.rotation.set(swing.x, 0, swing.z);
      group.updateMatrixWorld(true);

      // The clip: the sea's plane under the hull (coast → the land group's
      // frame is the same; the group's world is z-mirrored, and three's
      // clip planes are in world space).
      const afloatNow = ride.ride.state !== "launching" || ride.ride.launch > 0.88;
      if (afloatNow) {
        normal.set(-s.slopeX, 1, s.slopeZ).normalize();
        point.set(s.x, s.level - 0.015, -s.z);
        plane.setFromNormalAndCoplanarPoint(normal, point);
      } else plane.set(normal.set(0, 1, 0), 50);

      // The lantern: lit from dusk, a small steady flame by day.
      const lit = 0.18 + 0.82 * smooth01(0.02, 0.35, night);
      const flick = 0.9 + 0.06 * Math.sin(time * 13.1) + 0.04 * Math.sin(time * 29.7 + 1.3);
      const strength = lit * flick;
      glassMaterial.color.copy(LANTERN_COLOUR).multiplyScalar(3.2 * strength + 0.15);
      // Its flame in coast metres and in the camera's view.
      flame.set(0, -LANTERN.drop - 0.05, 0);
      glassMesh.localToWorld(flame);
      flameCoast.set(flame.x, flame.y, -flame.z);
      lamp[0] = flameCoast.x;
      lamp[1] = flameCoast.y;
      lamp[2] = flameCoast.z;
      lamp[3] = strength;
      const view = lampUniforms.boatLamp.value;
      view.set(flame.x, flame.y, flame.z, 1).applyMatrix4(camera.matrixWorldInverse);
      view.w = strength * (0.5 + 5.5 * smooth01(0.02, 0.35, night));
      // The thread: from the pole's head to the wisp.
      stemCoast.set(0, LANTERN.pivot[1] + 0.02, LANTERN.pivot[2] - 0.05).applyMatrix4(group.matrix);
      glow.update({ time, lamp: flame, strength, night, stem: stemCoast, wisp: magic?.wisp, tow, pull: ride.ride.throttle });

    },
    dispose() {
      forms.hull.dispose();
      forms.lamp.dispose();
      forms.glass.dispose();
      wood.dispose();
      glassMaterial.dispose();
      glow.dispose();
      jellies.dispose();
      land.remove(group, glow.mesh);
    },
  };
  return api;
}
const WAKE_FLOW = [0, 0];

// The boat's timber and paint: the places' shared light model (fog, aerial
// perspective, baked occlusion) plus grain along the planks in the boat's
// own frame (so it rides with the hull), paint worn at the edges, and the
// lantern's warm light.
function boatMaterial(shared, plane, uniforms) {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, clippingPlanes: [plane] });
  patchMaterial(material, shared);
  markSolid(material);
  const base = material.onBeforeCompile;
  material.customProgramCacheKey = () => "boat-hull-v1";
  material.onBeforeCompile = (shader, renderer) => {
    base?.(shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader.replace("void main() {", "varying vec3 vBoatP;\nvoid main() {\n  vBoatP = position;");
    shader.fragmentShader = shader.fragmentShader
      .replace("void main() {", `${BOAT_NOISE}\nvarying vec3 vBoatP;\nuniform vec4 boatLamp;\nuniform vec3 boatLampColour;\nvoid main() {`)
      .replace(
        "#include <color_fragment>",
        /* glsl */ `#include <color_fragment>
        {
          float px = max( fwidth( vBoatP.x ), max( fwidth( vBoatP.y ), fwidth( vBoatP.z ) ) );
          // Grain runs along the boat (planks, gunwale, thwarts' length
          // across): streaks long in z, fine across.
          vec3 q = vBoatP * vec3( 26.0, 26.0, 1.6 );
          float grain = bOctave( q, 1.0, px * 26.0 );
          float fine = bOctave( vBoatP * vec3( 90.0, 90.0, 5.0 ), 1.0, px * 90.0 );
          float blotch = bOctave( vBoatP, 3.1, px ) * 0.6 + bOctave( vBoatP, 9.0, px ) * 0.4;
          float top = max( diffuseColor.r, max( diffuseColor.g, diffuseColor.b ) );
          float painted = smoothstep( 0.15, 0.4, ( top - min( diffuseColor.r, min( diffuseColor.g, diffuseColor.b ) ) ) / max( top, 1e-3 ) );
          // Bare and varnished wood shows its grain; paint only a little.
          diffuseColor.rgb *= 0.86 + ( grain - 0.5 ) * mix( 0.42, 0.1, painted ) + ( fine - 0.5 ) * 0.1 + ( blotch - 0.5 ) * 0.14;
          // Paint worn back to grey timber in patches near the gunwale and
          // the waterline, where hands, ropes and the sea work it.
          float edge = smoothstep( 0.3, 0.48, vBoatP.y ) + ( 1.0 - smoothstep( -0.02, 0.12, vBoatP.y ) ) * 0.7;
          float wear = smoothstep( 0.78, 0.86, blotch + ( grain - 0.5 ) * 0.3 + edge * 0.1 ) * painted;
          diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.16, 0.14, 0.11 ) * ( 0.8 + grain * 0.4 ), wear * 0.7 );
          // A green-brown tide line of weed at the boot-top.
          float tide = exp( -pow( ( vBoatP.y + 0.035 ) / 0.02, 2.0 ) ) * smoothstep( 0.4, 0.7, blotch );
          diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.08, 0.1, 0.04 ), tide * 0.6 );
        }`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        /* glsl */ `#include <roughnessmap_fragment>
        // Varnish and fresh paint have a sheen; wet near the water.
        roughnessFactor = mix( roughnessFactor, 0.38, 1.0 - smoothstep( -0.05, 0.2, vBoatP.y ) );`,
      )
      .replace(
        "#include <lights_fragment_end>",
        /* glsl */ `#include <lights_fragment_end>
        if ( boatLamp.w > 0.0 ) {
          // The lantern: a warm point light with a soft 1/(1+d²) falloff,
          // wrapped a little so it rounds over the frames and thwarts.
          vec3 toL = boatLamp.xyz + vViewPosition;
          float d2 = dot( toL, toL );
          vec3 L = toL * inversesqrt( max( d2, 1e-4 ) );
          float ndl = clamp( dot( normal, L ) * 0.75 + 0.25, 0.0, 1.0 );
          reflectedLight.directDiffuse += boatLampColour * boatLamp.w * ndl * diffuseColor.rgb * 0.31831 * 2.2 / ( 1.0 + d2 * 1.2 );
        }`,
      );
  };
  return material;
}

const BOAT_NOISE = /* glsl */ `
float bHash3( vec3 p ) {
  p = fract( p * 0.1031 );
  p += dot( p, p.zyx + 31.32 );
  return fract( ( p.x + p.y ) * p.z );
}
float bNoise3( vec3 p ) {
  vec3 i = floor( p );
  vec3 f = fract( p );
  vec3 u = f * f * ( 3.0 - 2.0 * f );
  return mix(
    mix( mix( bHash3( i ), bHash3( i + vec3( 1, 0, 0 ) ), u.x ), mix( bHash3( i + vec3( 0, 1, 0 ) ), bHash3( i + vec3( 1, 1, 0 ) ), u.x ), u.y ),
    mix( mix( bHash3( i + vec3( 0, 0, 1 ) ), bHash3( i + vec3( 1, 0, 1 ) ), u.x ), mix( bHash3( i + vec3( 0, 1, 1 ) ), bHash3( i + vec3( 1, 1, 1 ) ), u.x ), u.y ),
    u.z );
}
float bOctave( vec3 p, float k, float px ) {
  return mix( bNoise3( p * k ), 0.5, smoothstep( 0.3, 0.6, px * k ) );
}
`;

// The lantern's halo and the wisp's thread of light: one additive mesh,
// placed in the vertex shader from uniforms (no buffer uploads).
const THREAD = 28;
const GLOW_VERTEX = /* glsl */ `
attribute vec2 corner;
attribute float slot;
uniform vec3 lamp;
uniform vec3 stem;
uniform vec3 wisp;
uniform float time;
uniform float sag;
varying vec2 vUv2;
varying float vSlot;
varying float vAlong;
vec3 threadAt( float t ) {
  vec3 p = mix( stem, wisp, t );
  // Hangs in a shallow curve, and shivers with the tow.
  p.y -= sag * 4.0 * t * ( 1.0 - t );
  p.y += sin( t * 9.0 - time * 3.1 ) * 0.02 * t * ( 1.0 - t ) * 4.0;
  return p;
}
void main() {
  vSlot = slot;
  vUv2 = corner;
  vec3 right = vec3( viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0] );
  vec3 up = vec3( viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1] );
  vec3 world;
  if ( slot < 0.5 ) {
    vec3 toEye = normalize( cameraPosition - lamp );
    float d = length( cameraPosition - lamp );
    float s = 0.55 * ( 1.0 + d * 0.025 );
    world = lamp + toEye * 0.12 + ( right * corner.x + up * corner.y ) * s;
    vAlong = 0.0;
  } else {
    float t = ( slot - 1.0 ) / ${(THREAD - 1).toFixed(1)};
    vec3 p = threadAt( t );
    vec3 tangent = normalize( threadAt( min( t + 0.02, 1.0 ) ) - threadAt( max( t - 0.02, 0.0 ) ) );
    vec3 side = normalize( cross( tangent, normalize( cameraPosition - p ) ) );
    float d = length( cameraPosition - p );
    // Never thinner than about a pixel and a half.
    float w = max( 0.006, d * 0.0022 );
    world = p + side * corner.x * w;
    vAlong = t;
  }
  gl_Position = projectionMatrix * viewMatrix * vec4( world, 1.0 );
}`;
const GLOW_FRAGMENT = /* glsl */ `
uniform vec3 glowColour;
uniform vec3 threadColour;
uniform float strength;
uniform float threadOn;
uniform float time;
varying vec2 vUv2;
varying float vSlot;
varying float vAlong;
void main() {
  vec3 c;
  if ( vSlot < 0.5 ) {
    float r2 = dot( vUv2, vUv2 );
    float g = exp( -r2 * 40.0 ) * 1.3 + exp( -r2 * 9.0 ) * 0.28 + exp( -r2 * 2.6 ) * 0.07;
    c = glowColour * g * strength * ( 1.0 - smoothstep( 0.6, 1.0, r2 ) );
  } else {
    float across = 1.0 - vUv2.x * vUv2.x;
    // Light running along the thread toward the wisp.
    float run = 0.55 + 0.45 * sin( vAlong * 24.0 - time * 5.0 );
    float ends = smoothstep( 0.0, 0.08, vAlong ) * ( 0.6 + 0.4 * vAlong );
    c = threadColour * across * run * ends * threadOn;
  }
  gl_FragColor = vec4( c, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function glowMesh() {
  const corners = [], slots = [];
  for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]]) {
    corners.push(u, v);
    slots.push(0);
  }
  for (let i = 0; i < THREAD - 1; i++)
    for (const [k, side] of [[0, -1], [0, 1], [1, 1], [0, -1], [1, 1], [1, -1]]) {
      corners.push(side, 0);
      slots.push(1 + i + k);
    }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(slots.length * 3), 3));
  geometry.setAttribute("corner", new THREE.Float32BufferAttribute(corners, 2));
  geometry.setAttribute("slot", new THREE.Float32BufferAttribute(slots, 1));
  const uniforms = {
    lamp: { value: new THREE.Vector3() },
    stem: { value: new THREE.Vector3() },
    wisp: { value: new THREE.Vector3() },
    time: { value: 0 },
    sag: { value: 0.3 },
    strength: { value: 0 },
    threadOn: { value: 0 },
    threadColour: { value: new THREE.Color() },
  };
  const material = glowMaterial({ colour: [1.0, 0.58, 0.24], vertex: GLOW_VERTEX, fragment: GLOW_FRAGMENT, uniforms });
  material.side = THREE.DoubleSide;
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  mesh.renderOrder = 12;
  mesh.visible = false;
  return {
    mesh,
    // lamp: Three world; stem: coast; wisp: magic.wisp (coast). The
    // shader works in Three world (the land group mirrors coast z).
    update({ time, lamp, strength, night, stem, wisp, tow, pull }) {
      mesh.visible = true;
      uniforms.time.value = time;
      uniforms.lamp.value.copy(lamp);
      uniforms.strength.value = strength * (0.35 + 0.65 * smooth01(0.02, 0.35, night));
      uniforms.stem.value.set(stem.x, stem.y, -stem.z);
      const on = wisp?.visible ? tow : 0;
      if (on > 0) uniforms.wisp.value.set(wisp.position[0], wisp.position[1], -wisp.position[2]);
      uniforms.threadOn.value = on * (0.25 + 0.35 * pull) * (0.45 + 0.55 * night);
      uniforms.sag.value = 0.35 - 0.25 * pull;
      // The wisp's own colour, warmed toward the flame it runs from.
      if (wisp) uniforms.threadColour.value.setRGB(wisp.colour[0], wisp.colour[1], wisp.colour[2]).lerp(LANTERN_COLOUR, 0.35).multiplyScalar(1.2);
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

function wrap(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}
export { RIDE, HULL };
