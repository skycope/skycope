import * as THREE from "three";
import { capsule, setCapsule } from "./blockers.js";
import { groundHeight } from "./terrain.js";
import { patchMaterial } from "./forest.js";
import { glowMaterial, smooth01 } from "./place-kit.js";
import { markSolid, SOLID_ORDER } from "./cat-coat.js";
import { buildBoatForms, HULL, LANTERN, WATERPLANE, POST, buildPost, sheer } from "./boat-forms.js";
import { createBoatRide, RIDE } from "./boat-ride.js";
import { BOAT, WATER_GRID } from "./boat-dynamics.js";
import { SWIM_LIMIT } from "./walker.js";
import { createJellies } from "./boat-jellies.js";

// The fisherman's boat, drawn and joined to the world (boat-ride.js is its
// life, boat-dynamics.js its motion, boat-forms.js its shape). Built with
// the landscape (hidden until its gift wakes); attach() joins it to the
// walker once that exists.
//
// Draws: the hull (one mesh, ~12.5k triangles), the swinging hurricane
// lantern (metal and glass), and one additive mesh for the lantern's halo
// and the wisp's thread of light. Nothing draws, updates or allocates while
// it sleeps.
//
// The waterline: the sea is drawn behind, by the WebGPU pass, so the hull
// must leave a hole wherever water would hide it. Its shader knows the sea
// surface under it (nine heights over the waterplane, sampled on the CPU
// from the surface exactly as the water pass displaces it, sea-surface.js
// `drawn`, and interpolated biquadratically per fragment). The outer skin is
// cut where it is under water; the inside of the hull is dry, so it stays,
// unless the eye can only have reached it through water (the ray crossed
// the surface outside the hull's waterplane), so no sea is ever drawn
// inside the boat and no inside is seen through the sea.
//
// Values for others (coast metres):
//   magic.afloat  null ashore; aboard { x, z, heading, speed, lamp: [x, y, z],
//                 lit (0…1) }: wildlife may approach a boat, and the wisp
//                 is towing it (its position is set here after the mind's).
//   boat.lamp     [x, y, z, strength]: the lantern for the water (main.js).
//   boat.events   refilled every frame: { type: "board" | "leave" | "launch"
//                 | "bump" | "ground" | "hull-slap" | "jump" | "refuse", gain }.
//   boat.pois     places only a boat reaches ({ id, title, x, z, r }).

// An oil flame through old glass: amber, never white.
const LANTERN_COLOUR = new THREE.Color(1.0, 0.5, 0.16);

export function createBoat(land, { light = false, shared, landmark, hull = null, seed = 1 }) {
  const forms = buildBoatForms({ light });
  const lampUniforms = {
    boatLamp: { value: new THREE.Vector4(0, 0, 0, 0) },
    boatLampColour: { value: LANTERN_COLOUR.clone() },
    // The sea under the hull (see the header): nine heights (world y) on
    // the WATER_GRID round the hull's pose (coast x, z, sin and cos of its
    // heading), and the waterplane's half-breadths along it.
    boatWater: { value: new Float32Array(9).fill(-100) },
    boatPose: { value: new THREE.Vector4(0, 0, 0, 1) },
    boatGrid: { value: new THREE.Vector3(WATER_GRID.u, WATER_GRID.v, HULL.half) },
    boatPlane: { value: Float32Array.from(WATERPLANE) },
    boatPostSea: { value: -100 },
    // How far the lantern and its pole are faded (they stood between the
    // camera and the cat), 0…1.
    boatFade: { value: 0 },
  };
  const wood = boatMaterial(shared, lampUniforms, true);
  const iron = boatMaterial(shared, lampUniforms, false);
  const glassMaterial = new THREE.MeshBasicMaterial({ color: 0x000000, fog: false, transparent: true, depthWrite: true });

  const group = new THREE.Group();
  group.name = "boat";
  group.matrixAutoUpdate = false;
  group.visible = false;
  const hullMesh = new THREE.Mesh(forms.hull, wood);
  const pivot = new THREE.Group();
  pivot.position.set(...LANTERN.pivot);
  const lampMesh = new THREE.Mesh(forms.lamp, iron);
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
  // The painter, and the cove's mooring post (shown once the boat is out).
  const painter = painterMesh(shared);
  land.add(painter.mesh);
  let postMesh = null;
  let walkerRef = null;
  let postBody = null;
  let seaRef = null;
  // Where only the boat goes (boat-jellies.js).
  const jellies = createJellies(land, seed, { coveTheta: Math.atan2(landmark.z - 70, landmark.x - 58), light });
  const eye = [0, 0, 0];

  // Scratch.
  const euler = new THREE.Euler(0, 0, 0, "YXZ");
  const quat = new THREE.Quaternion();
  const scale = new THREE.Vector3(1, 1, 1);
  const pos = new THREE.Vector3();
  const flame = new THREE.Vector3();
  const ring = new THREE.Vector3();
  const flameCoast = new THREE.Vector3();
  const stemCoast = new THREE.Vector3();
  const swing = { x: 0, z: 0, vx: 0, vz: 0 };
  let ride = null;
  let hullBody = null;
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

  const pose = { x: 0, y: 0, z: 0, heading: 0, pitch: 0, roll: 0 };
  // The aboard camera's hints (see the api) and the pole's segment.
  const hints = {
    active: false,
    // Frame the cat at the bow from astern and a little above: arm length
    // (m) and elevation (rad) that keep the whole hull and the lantern in
    // the picture without the pole crossing the cat.
    arm: { distance: 4.2, elevation: 0.3, min: 2.6 },
    // Where to look (the cat at its station) and the bow's heading.
    target: [0, 0, 0],
    heading: 0,
    // Capsules that may stand between lens and cat: { a, b, r } (coast).
    occluders: [
      { name: "lantern-pole", a: [0, 0, 0], b: [0, 0, 0], r: 0.06 },
      { name: "lantern", a: [0, 0, 0], b: [0, 0, 0], r: 0.12 },
      { name: "mooring-post", a: [0, -100, 0], b: [0, -100, 0], r: 0.1 },
    ],
    // 0…1: how far boat.js has dissolved them this frame.
    faded: 0,
  };
  const hintA = new THREE.Vector3(), hintB = new THREE.Vector3();
  function updateHints(camera, dt) {
    const cat = walkerRef?.cat;
    hints.active = Boolean(ride?.aboard);
    const [pole, lantern, post] = hints.occluders;
    if (postMesh?.visible) {
      post.a = [ride.post.x, ride.post.bed, ride.post.z];
      post.b = [ride.post.x, POST.top, ride.post.z];
    }
    hintA.set(0, sheer(1) + 0.02, HULL.half * 0.97).applyMatrix4(group.matrix);
    hintB.set(0, LANTERN.pivot[1], LANTERN.pivot[2]).applyMatrix4(group.matrix);
    pole.a = [hintA.x, hintA.y, hintA.z];
    pole.b = [hintB.x, hintB.y, hintB.z];
    lantern.a = [hintB.x, hintB.y, hintB.z];
    lantern.b = [flameCoast.x, flameCoast.y - 0.12, flameCoast.z];
    hints.heading = pose.heading;
    let want = 0;
    if (cat && hints.active) {
      hints.target = [cat.x, cat.y + 0.3, cat.z];
      // The lens (coast) to the cat's head: how near it passes the pole
      // and the lantern.
      const ex = camera.position.x, ey = camera.position.y, ez = -camera.position.z;
      let nearest = Infinity;
      for (const o of hints.occluders)
        for (let i = 0; i <= 8; i++) {
          const t = i / 8;
          const px = ex + (hints.target[0] - ex) * t, py = ey + (hints.target[1] - ey) * t, pz = ez + (hints.target[2] - ez) * t;
          nearest = Math.min(nearest, segmentDistance(px, py, pz, o.a, o.b) - o.r);
        }
      want = 1 - smooth01(0.05, 0.3, nearest);
    }
    hints.faded += (want * 0.85 - hints.faded) * Math.min(1, dt * 6);
    lampUniforms.boatFade.value = hints.faded;
  }

  const api = {
    group,
    events,
    lamp,
    pois: [jellies.poi],
    // Where it lies ashore ({ x, z, facing }).
    landmark,
    // magic.afloat's record while the cat is aboard, else null (fauna.js).
    get afloatNow() {
      return magic?.afloat ?? null;
    },
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
    // For the follow camera aboard (walker.js owns it): where to frame,
    // a clear arm, and what could stand in the way (coast metres). The
    // lantern and pole already dissolve themselves when they hide the cat,
    // and any boat timber within ~0.6 m of the lens dithers out.
    aboardCameraHints: hints,
    // Joins the walker, the sea and the shared record (main.js, once the
    // walker exists).
    attach({ walker, sea, magic: record, wake: wakeRecord }) {
      magic = record;
      wake = wakeRecord;
      ride = createBoatRide({ landmark, sea, bed: walker.bed, solids: walker.solids, magic, swimLimit: SWIM_LIMIT, seed });
      walker.ride = ride;
      // solid: the hull afloat is a moving solid to the camera (the follow
      // and ceremony cameras ended inside or under it); the cat boards it
      // by the ride, so it does not stop the cat.
      hullBody = capsule({ x: 0, y: -100, z: 0 }, { x: 0, y: -100, z: 0 }, 0.6, { body: false, live: false });
      walker.solids.bodies.push(hullBody);
      // The post in the cove: the cat swims round it, the boat fends off it.
      const p = ride.post;
      postBody = capsule({ x: p.x, y: p.bed - 0.3, z: p.z }, { x: p.x, y: POST.top, z: p.z }, 0.09, { live: false });
      walker.solids.bodies.push(postBody);
      postMesh = new THREE.Mesh(buildPost(p.bed - 0.3, seed), wood);
      postMesh.matrixAutoUpdate = false;
      postMesh.matrix.makeTranslation(p.x, 0, p.z);
      postMesh.visible = false;
      postMesh.renderOrder = SOLID_ORDER;
      land.add(postMesh);
      seaRef = sea;
      walkerRef = walker;
      record.afloat = null;
      return api;
    },
    // After the wisp's mind (main.js, after thread.update): while the cat is
    // aboard the wisp flies ahead of the bow, towing.
    afterThread(dt, night = 0) {
      events.length = 0;
      if (ride) for (const e of ride.events) if (e.type === "knock" || e.type === "scrape" || e.type === "launch") events.push(e);
      if (!ride || !ride.afloat) {
        // Scraping into the shallows: its keel already in the water.
        const p = ride?.ride.pose;
        if (ride?.ride.state === "launching" && p.phase === "slide") wake?.boat(p.x, p.z, p.heading, p.y, Math.hypot(p.vx, p.vz), 0, 0.3, 0);
        else wake?.noBoat();
        return;
      }
      clock += dt;
      for (const e of ride.events) if (e.type !== "knock" && e.type !== "scrape" && e.type !== "launch") events.push(e);
      // Floated off: the sea parts round it.
      if (events.some((e) => e.type === "launch")) wake?.ring(ride.state.x, ride.state.z, 1.6);
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
        // Aboard it dims to a small companion light: the lantern is the
        // light of the picture, the two must not fight.
        w.glow += (0.3 - 0.08 * night - w.glow) * tow;
        w.visible = true;
      } else towPos.set = false;
      // The hull in the sea and its wake (wake.js, wake.wgsl).
      wake?.boat(s.x, s.z, s.heading, s.y, s.u, s.v, s.chop, s.vy);
    },
    // Every frame, before the scene renders (landscape.js): pose, clip,
    // lantern and thread. camera: the Three camera (view matrix current).
    render({ time, night, camera }) {
      if (!ride) return;
      eye[0] = camera.position.x;
      eye[1] = camera.position.y;
      eye[2] = -camera.position.z;
      // Only once the boat is on the water: nothing is drawn for them before.
      if (launched) jellies.update(time, night, eye, ride.afloat ? lamp : null);
      if (!ride.afloat && ride.ride.state !== "launching") return;
      if (!launched) {
        launched = true;
        hull?.launch();
        group.visible = true;
        if (postMesh) postMesh.visible = true;
        if (postBody) postBody.live = true;
      }
      const s = ride.state;
      if (ride.ride.state === "launching") Object.assign(pose, ride.ride.pose);
      else {
        pose.x = s.x;
        pose.y = s.y;
        pose.z = s.z;
        pose.heading = s.heading;
        pose.pitch = s.pitch;
        pose.roll = s.roll;
      }
      if (hullBody) {
        const hx = Math.sin(pose.heading) * 1.6, hz = Math.cos(pose.heading) * 1.6;
        setCapsule(hullBody, pose.x - hx, pose.y + 0.1, pose.z - hz, pose.x + hx, pose.y + 0.1, pose.z + hz, 0.62);
        hullBody.live = true;
      }
      euler.set(-pose.pitch, pose.heading, -pose.roll);
      quat.setFromEuler(euler);
      pos.set(pose.x, pose.y, pose.z);
      group.matrix.compose(pos, quat, scale);
      group.matrixWorldNeedsUpdate = true; // the island group is frozen (landscape.js freezeStatic)
      // The lantern hangs plumb, swinging behind the boat's motion.
      const dt = Math.min(0.05, Math.max(0, time - (api.lastTime ?? time)));
      api.lastTime = time;
      swing.vx += (-40 * (swing.x - pose.pitch) - 2.2 * swing.vx) * dt;
      swing.vz += (-40 * (swing.z - pose.roll) - 2.2 * swing.vz) * dt;
      swing.x += swing.vx * dt;
      swing.z += swing.vz * dt;
      pivot.rotation.set(swing.x, 0, swing.z);
      group.updateMatrixWorld(true);

      // The sea under the hull, for its waterline: the dynamics' own nine
      // heights when it is floating (taken at this pose), else sampled
      // here (on the sand: none, where the beach is dry).
      const water = ride.ride.state === "launching" ? ride.dynamics.sampleWater(pose.x, pose.z, pose.heading) : s.water;
      const grid = lampUniforms.boatWater.value;
      for (let i = 0; i < 9; i++) grid[i] = Number.isFinite(water[i]) ? water[i] : -100;
      lampUniforms.boatPose.value.set(pose.x, pose.z, Math.sin(pose.heading), Math.cos(pose.heading));

      // The lantern: lit from dusk, a small steady flame by day.
      const lit = 0.18 + 0.82 * smooth01(0.02, 0.35, night);
      const flick = 0.9 + 0.06 * Math.sin(time * 13.1) + 0.04 * Math.sin(time * 29.7 + 1.3);
      const strength = lit * flick;
      // The globe glows amber (its form stays readable); the bright core
      // is the halo mesh's.
      glassMaterial.color.copy(LANTERN_COLOUR).multiplyScalar(0.7 * strength + 0.06);
      // Dissolved with its lantern when it hides the cat.
      glassMaterial.opacity = 1 - hints.faded;
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
      view.w = strength * (0.4 + 4.6 * smooth01(0.02, 0.35, night));
      // The thread: from the pole's head to the wisp.
      stemCoast.set(0, LANTERN.pivot[1] + 0.02, LANTERN.pivot[2] - 0.05).applyMatrix4(group.matrix);
      glow.update(time, flame, strength, night, stemCoast, magic?.wisp, tow, ride.ride.throttle);
      // The lantern and its pole between the lens and the cat: fade them.
      updateHints(camera, dt);
      // The painter: from the ring on the stem head to the post's ring or
      // down to its anchor, hanging in its slack.
      if (postMesh?.visible && seaRef?.drawn) {
        const h = seaRef.drawn(ride.post.x, ride.post.z);
        lampUniforms.boatPostSea.value = Number.isFinite(h) ? h : -100;
      }
      const tether = ride.ride.state === "waiting" ? ride.tether : null;
      if (tether) {
        ring.set(0, sheer(1) + 0.03, HULL.half + 0.02).applyMatrix4(group.matrix);
        painter.update(ring, tether, seaRef);
      } else painter.hide();

    },
    dispose() {
      forms.hull.dispose();
      forms.lamp.dispose();
      forms.glass.dispose();
      wood.dispose();
      iron.dispose();
      glassMaterial.dispose();
      glow.dispose();
      painter.dispose();
      postMesh?.geometry.dispose();
      jellies.dispose();
      land.remove(group, glow.mesh, painter.mesh);
      if (postMesh) land.remove(postMesh);
    },
  };
  return api;
}

// The boat's timber and paint: the places' shared light model (fog, aerial
// perspective, baked occlusion) plus grain along the planks in the boat's
// own frame (so it rides with the hull), paint worn at the edges, and the
// lantern's warm light. `water`: the hull's waterline (see the header); the
// lantern, always above the sea, goes without.
function boatMaterial(shared, uniforms, water) {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72 });
  patchMaterial(material, shared);
  markSolid(material);
  const base = material.onBeforeCompile;
  material.customProgramCacheKey = () => (water ? "boat-hull-v2" : "boat-iron-v2");
  material.onBeforeCompile = (shader, renderer) => {
    base?.(shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("void main() {", "attribute float skin;\nvarying vec3 vBoatP;\nvarying vec3 vBoatW;\nvarying float vSkin;\nvoid main() {\n  vBoatP = position;\n  vSkin = skin;")
      .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\n  vBoatW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;");
    shader.fragmentShader = shader.fragmentShader
      .replace("void main() {", `${BOAT_NOISE}\n${water ? BOAT_WATER : ""}\nvarying vec3 vBoatP;\nvarying vec3 vBoatW;\nvarying float vSkin;\nuniform vec4 boatLamp;\nuniform vec3 boatLampColour;\nuniform float boatFade;\nvoid main() {`)
      .replace(
        "#include <clipping_planes_fragment>",
        /* glsl */ `#include <clipping_planes_fragment>
        {
          // Never a wall of timber in the lens: whatever is right at the
          // camera, and the lantern and its pole when they hide the cat,
          // dissolve (an ordered dither, so it stays opaque and sorted).
          float near = 1.0 - smoothstep( 0.3, 0.75, length( vBoatW - cameraPosition ) );
          float fade = max( near, ${water ? "vSkin < -0.5 || vSkin > 1.5 ? boatFade : 0.0" : "boatFade"} );
          vec2 cell = mod( floor( gl_FragCoord.xy ), 4.0 );
          float bayer = mod( cell.x * 2.0 + cell.y * 3.0 + floor( cell.x * 0.5 ) * 5.0, 8.0 ) / 8.0 + 0.0625;
          if ( fade > bayer ) discard;
        }
        `,
      )
      .replace(
        "#include <clipping_planes_fragment>",
        water
          ? /* glsl */ `#include <clipping_planes_fragment>
        // The post (skin 2) stands outside the hull's grid: its own level.
        float boatAbove = vBoatW.y - ( vSkin > 1.5 ? boatPostSea : boatSea( vBoatW ) );
        if ( boatAbove < 0.0 ) {
          // The sea is drawn behind: under water, the outside leaves a hole
          // for it, and so does any inside the eye reached through water.
          if ( vSkin > 0.5 || !boatSeenFromAbove( vBoatW, boatAbove ) ) discard;
        }`
          : "#include <clipping_planes_fragment>",
      )
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
          float outside = clamp( vSkin, 0.0, 1.0 );
          diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.08, 0.1, 0.04 ), tide * 0.6 * outside );
          // Soaked timber below the line the water keeps it at (darker,
          // a little green), and a dry crust of salt just above it where
          // spray dries on the paint.
          float soaked = 1.0 - smoothstep( 0.0, 0.07 + ( blotch - 0.5 ) * 0.04, vBoatP.y );
          diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 0.62, 0.68, 0.6 ), soaked * outside );
          float salt = smoothstep( 0.06, 0.1, vBoatP.y ) * ( 1.0 - smoothstep( 0.12, 0.24, vBoatP.y ) ) * smoothstep( 0.45, 0.75, fine * 0.5 + blotch * 0.7 );
          diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.62, 0.62, 0.58 ), salt * 0.22 * outside );
          ${water ? /* glsl */ `
          // Wet just above the water it rides in: darker where it laps.
          float wet = min( vSkin, 1.0 ) * ( 1.0 - smoothstep( 0.0, 0.05, boatAbove ) );
          diffuseColor.rgb *= 1.0 - 0.45 * wet;` : ""}
        }`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        /* glsl */ `#include <roughnessmap_fragment>
        // Varnish and fresh paint have a sheen; wet near the water.
        roughnessFactor = mix( roughnessFactor, 0.38, ( 1.0 - smoothstep( -0.05, 0.2, vBoatP.y ) ) * min( vSkin, 1.0 ) );
        ${water ? "roughnessFactor = mix( roughnessFactor, 0.12, min( vSkin, 1.0 ) * ( 1.0 - smoothstep( 0.0, 0.025, boatAbove ) ) );" : ""}`,
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
          // Inverse square beyond the lantern's own size (~0.4 m).
          reflectedLight.directDiffuse += boatLampColour * boatLamp.w * ndl * diffuseColor.rgb * 0.31831 * 2.6 / ( 1.0 + d2 * 2.2 );
        }`,
      );
  };
  return material;
}

// The sea under the hull, in Three world (x, y, −z coast). Nine heights on
// a grid along (u) and across (v) the hull's heading, Lagrange-quadratic
// between them (a little beyond the grid, held).
const BOAT_WATER = /* glsl */ `
uniform float boatWater[9];
uniform vec4 boatPose;
uniform vec3 boatGrid;
uniform float boatPlane[9];
uniform float boatPostSea;
vec2 boatLocal( vec3 w ) {
  vec2 d = vec2( w.x, -w.z ) - boatPose.xy;
  return vec2( d.x * boatPose.z + d.y * boatPose.w, d.x * boatPose.w - d.y * boatPose.z );
}
vec3 boatWeights( float t ) {
  t = clamp( t, -1.3, 1.3 );
  return vec3( 0.5 * t * ( t - 1.0 ), 1.0 - t * t, 0.5 * t * ( t + 1.0 ) );
}
float boatSea( vec3 w ) {
  vec2 uv = boatLocal( w );
  vec3 a = boatWeights( uv.x / boatGrid.x );
  vec3 b = boatWeights( uv.y / boatGrid.y );
  vec3 r0 = vec3( boatWater[0], boatWater[1], boatWater[2] );
  vec3 r1 = vec3( boatWater[3], boatWater[4], boatWater[5] );
  vec3 r2 = vec3( boatWater[6], boatWater[7], boatWater[8] );
  return a.x * dot( r0, b ) + a.y * dot( r1, b ) + a.z * dot( r2, b );
}
// Whether the ray from the eye to a point under water at w crossed the
// water's level inside the hull's waterplane (it came in over the side).
bool boatSeenFromAbove( vec3 w, float below ) {
  float h = cameraPosition.y - w.y;
  if ( h <= -below ) return true;
  vec3 q = mix( cameraPosition, w, ( h + below ) / h );
  vec2 uv = boatLocal( q );
  float s = clamp( ( uv.x / boatGrid.z + 1.0 ) * 4.0, 0.0, 8.0 );
  int i = int( min( floor( s ), 7.0 ) );
  float halfB = mix( boatPlane[i], boatPlane[i + 1], s - float( i ) );
  return abs( uv.y ) < halfB + 0.015 && abs( uv.x ) < boatGrid.z;
}
`;

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
    // A fixed size in the world, so it shrinks with distance on screen.
    float s = 0.42;
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
    // A small bright core and a soft halo whose peak stays below white.
    float g = exp( -r2 * 260.0 ) * 0.75 + exp( -r2 * 22.0 ) * 0.16 + exp( -r2 * 5.0 ) * 0.07;
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
  const material = glowMaterial({ colour: [1.0, 0.5, 0.16], vertex: GLOW_VERTEX, fragment: GLOW_FRAGMENT, uniforms });
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
    update(time, lamp, strength, night, stem, wisp, tow, pull) {
      mesh.visible = true;
      uniforms.time.value = time;
      uniforms.lamp.value.copy(lamp);
      uniforms.strength.value = Math.min(1, strength) * (0.35 + 0.65 * smooth01(0.02, 0.35, night));
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

// The painter: a manila line (one tube, 20 × 4 quads) placed in the vertex
// shader from its two ends and its sag, so nothing is uploaded but a few
// uniforms. Parabolic sag from the slack (a shallow catenary): s with
// L ≈ D + 8s²/3D. Under the sea's surface (sampled along it on the CPU) it is
// not drawn: the water pass shows the sea there.
const PAINTER = { segments: 20, sides: 4, radius: 0.011, slack: 0.3 };
const ROPE_VERTEX = /* glsl */ `
attribute vec2 rope;
uniform vec3 ropeA;
uniform vec3 ropeB;
uniform float ropeSag;
uniform float ropeWater[11];
varying float vRopeSea;
varying float vRopeY;
vec3 ropeAt( float t ) {
  vec3 p = mix( ropeA, ropeB, t );
  p.y -= ropeSag * 4.0 * t * ( 1.0 - t );
  return p;
}
`;
const ROPE_BEGIN = /* glsl */ `
  vec3 ropeC = ropeAt( rope.x );
  vec3 ropeT = normalize( ropeAt( min( rope.x + 0.02, 1.0 ) ) - ropeAt( max( rope.x - 0.02, 0.0 ) ) + vec3( 0.0, 1e-5, 0.0 ) );
  vec3 ropeS = normalize( cross( ropeT, vec3( 0.0, 1.0, 0.0 ) ) + vec3( 1e-4, 0.0, 0.0 ) );
  vec3 ropeU = cross( ropeS, ropeT );
  vec3 ropeN = ropeS * cos( rope.y ) + ropeU * sin( rope.y );
  float ropeF = rope.x * 10.0;
  int ropeI = int( min( floor( ropeF ), 9.0 ) );
  vRopeSea = mix( ropeWater[ ropeI ], ropeWater[ ropeI + 1 ], ropeF - float( ropeI ) );
  vRopeY = ropeC.y;
`;

function painterMesh(shared) {
  const { segments, sides } = PAINTER;
  const ropeAttr = [];
  const index = [];
  for (let i = 0; i <= segments; i++) for (let j = 0; j <= sides; j++) ropeAttr.push(i / segments, (j / sides) * Math.PI * 2);
  for (let i = 0; i < segments; i++)
    for (let j = 0; j < sides; j++) {
      const a = i * (sides + 1) + j, b = a + 1, c = a + sides + 1, d = c + 1;
      index.push(a, c, b, b, c, d);
    }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(ropeAttr.length * 1.5), 3));
  geometry.setAttribute("rope", new THREE.Float32BufferAttribute(ropeAttr, 2));
  geometry.setIndex(index);
  const uniforms = {
    ropeA: { value: new THREE.Vector3() },
    ropeB: { value: new THREE.Vector3() },
    ropeSag: { value: 0 },
    ropeWater: { value: new Float32Array(11).fill(-100) },
  };
  const material = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.32, 0.26, 0.17), roughness: 0.9 });
  patchMaterial(material, shared);
  const base = material.onBeforeCompile;
  material.customProgramCacheKey = () => "boat-painter-v1";
  material.onBeforeCompile = (shader, renderer) => {
    base?.(shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("void main() {", `${ROPE_VERTEX}\nvoid main() {\n${ROPE_BEGIN}`)
      .replace("#include <beginnormal_vertex>", "vec3 objectNormal = ropeN;\n#ifdef USE_TANGENT\nvec3 objectTangent = ropeT;\n#endif")
      .replace("#include <begin_vertex>", `vec3 transformed = ropeC + ropeN * ${PAINTER.radius.toFixed(4)};`);
    shader.fragmentShader = shader.fragmentShader
      .replace("void main() {", "varying float vRopeSea;\nvarying float vRopeY;\nvoid main() {\n  if ( vRopeY < vRopeSea ) discard;")
      .replace(
        "#include <color_fragment>",
        // Wet and dark where it has been in the water.
        "#include <color_fragment>\n  diffuseColor.rgb *= 1.0 - 0.45 * ( 1.0 - smoothstep( 0.0, 0.25, vRopeY - vRopeSea ) );",
      );
  };
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  mesh.visible = false;
  mesh.renderOrder = SOLID_ORDER;
  const water = uniforms.ropeWater.value;
  return {
    mesh,
    // a: the stem's ring (coast); tether { x, z, y, length }; sea: for the
    // water along it.
    update(a, tether, sea) {
      mesh.visible = true;
      uniforms.ropeA.value.copy(a);
      const b = uniforms.ropeB.value.set(tether.x, tether.y, tether.z);
      const d = a.distanceTo(b);
      const length = Math.max(d, Math.hypot(tether.length, a.y - tether.y) + PAINTER.slack);
      uniforms.ropeSag.value = Math.min(1.2, Math.sqrt((3 * d * Math.max(0, length - d)) / 8));
      for (let i = 0; i <= 10; i++) {
        const t = i / 10;
        const h = sea?.drawn ? sea.drawn(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t) : -100;
        water[i] = Number.isFinite(h) ? h : -100;
      }
    },
    hide() {
      mesh.visible = false;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

// Distance from a point to the segment a–b (arrays).
function segmentDistance(px, py, pz, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const l = dx * dx + dy * dy + dz * dz || 1e-9;
  const t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy + (pz - a[2]) * dz) / l));
  return Math.hypot(px - a[0] - dx * t, py - a[1] - dy * t, pz - a[2] - dz * t);
}

function wrap(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}
export { RIDE, HULL };
