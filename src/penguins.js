import * as THREE from "three";
import { seededRandom } from "./random.js";
import { groundHeight, islandPoint, shoreDistance, ISLAND } from "./terrain.js";
import {
  sculpt, ellipsoid, capsule, animalMaterial, animalMesh, DEFORM_GLSL, placeInstance, formGeometry, herdBounds,
  surfaceOf, domeHeight, wrap, clamp, smooth, turnToward, noise3, WORLD_SCALE,
} from "./animal-forms.js";

// African penguins, as at Boulders Beach: a small colony on the sand among
// one outcrop's corestones. They stand about, preen, look round and now and
// then one throws its head back and brays (the "jackass" display). Small
// parties waddle down to the sea in single file, flop in and swim the
// shallows, porpoising, then come back up dripping and shake. A cat is
// watched from ~7 m; closer, the birds shuffle off (a bold one stands its
// ground first, head low and swaying); a pounce or a charge sends them
// hurrying for the water. Once the cat has gone they come back and settle.
//
// Events (drained by the orchestrator; x, z in coast metres, d metres from
// the cat, gain 0…1 already falling off with d):
//   bray   — the ecstatic display call, ~2.5 s of donkey-like "haw-haw-heee"
//   honk   — a short alarm call as a bird shuffles away from the cat
//   threat — a low growling "haw" from a bird standing its ground
//   splash — a penguin flopping into the swash (small)
export const PENGUIN_EVENTS = ["bray", "honk", "threat", "splash"];

const AWARE = 7;
const SHY = 2.7;
const HOME_CALM = 5;

// solid: grown in and out over the last 20 m before the hide radius, so
// the herd never pops in or out of view.
const grownAt = (d, radius) => 1 - Math.min(1, Math.max(0, (d - (radius - 20)) / 20)) ** 2;

export function penguinGeometry({ light = false } = {}) {
  const prims = [
    ellipsoid("body", [0, 0.265, -0.005], [0.112, 0.2, 0.1], { k: 0 }),
    ellipsoid("body", [0, 0.17, 0.014], [0.122, 0.125, 0.112], { k: 0.07 }),
    ellipsoid("body", [0, 0.355, 0.024], [0.09, 0.1, 0.086], { k: 0.06 }),
    ellipsoid("neck", [0, 0.445, 0.022], [0.06, 0.06, 0.06], { k: 0.05 }),
    ellipsoid("head", [0, 0.512, 0.032], [0.052, 0.055, 0.064], { k: 0.035 }),
    capsule("bill", [0, 0.506, 0.082], [0, 0.493, 0.146], 0.017, 0.008, { k: 0.012, squash: [0.75, 1] }),
    capsule("tail", [0, 0.1, -0.075], [0, 0.03, -0.15], 0.032, 0.012, { k: 0.03, squash: [1.4, 0.55] }),
  ];
  for (const s of [-1, 1]) {
    const side = s < 0 ? "L" : "R";
    prims.push(
      capsule(`flipper${side}`, [s * 0.098, 0.398, 0.004], [s * 0.152, 0.212, -0.02], 0.024, 0.013, { k: 0.01, squash: [1.75, 0.5], blend: 0.004 }),
      capsule(`foot${side}`, [s * 0.04, 0.075, 0.0], [s * 0.046, 0.022, 0.02], 0.026, 0.019, { k: 0.02 }),
      ellipsoid(`foot${side}`, [s * 0.047, 0.012, 0.045], [0.031, 0.013, 0.052], { k: 0.015 }),
    );
  }
  return sculpt({
    prims,
    cell: light ? 0.013 : 0.0115,
    triangles: light ? 1100 : 2000,
    blend: 0.012,
    aoRadius: 0.035,
    // Vertex colour carries only the baked occlusion; the markings are
    // painted per fragment (PENGUIN_PAINT).
    paint: (p, n, w) => [w.ao, w.ao, w.ao].map((v) => v ** (1 / 2.2)),
    attributes: {
      // x: head (and neck), y: flipper (signed, + right), z: foot (signed),
      // w: tail.
      part: {
        size: 4,
        value: (p, n, w) => [w.head + w.bill + w.neck * 0.55, w.flipperR - w.flipperL, w.footR - w.footL, w.tail],
      },
      // Paint masks: bill, feet, flippers, eye.
      tags: { size: 4, value: (p, n, w) => [w.bill, w.footL + w.footR, w.flipperL + w.flipperR, w.eye ?? 0] },
    },
    extras: [-1, 1].map((s) => {
      // Eyes: dark brown, in the pink.
      const eye = new THREE.SphereGeometry(0.0058, 6, 4);
      eye.translate(s * 0.0385, 0.524, 0.069);
      return { geometry: eye, colour: [1, 1, 1], weights: { head: 1, eye: 1 } };
    }),
  });
}

// African penguin plumage, per fragment in the rest pose (feet at the
// origin, facing +z): black back and face mask, the white band arching over
// the eye to the throat, the pink bare skin above the eye, a black band
// across the chest running down the flanks with a white line outside it,
// black spots on the belly, a pale band near the bill tip, mottled feet.
export const PENGUIN_PAINT = `
vec3 animalPaint( vec3 p, vec3 n, vec4 tags ) {
  // Every region is evaluated and blended (no branches), so the screen-space
  // derivatives behind the antialiased edges stay valid everywhere.
  vec3 black = srgb( vec3( 0.035, 0.037, 0.042 ) );
  vec3 white = srgb( vec3( 0.86, 0.86, 0.84 ) );
  float ax = abs( p.x );
  float a = abs( atan( p.x, p.z + 0.01 ) );
  // Head: black mask round eye and bill, the white band over the eye and
  // down to the throat, black crown; pink bare skin before the eye.
  float dm = length( vec3( p.x * 1.15, p.y - 0.503, ( p.z - 0.072 ) * 1.05 ) );
  float pinkSpot = length( vec3( ax - 0.033, p.y - 0.532, p.z - 0.075 ) );
  float mask = 1.0 - aaStep( 0.049, dm );
  float band = aaStep( 0.049, dm ) * ( 1.0 - aaStep( 0.065, dm ) ) * aaStep( -0.014, p.z );
  float throat = ( 1.0 - aaStep( 0.478, p.y ) ) * aaStep( 0.02, p.z ) * ( 1.0 - aaStep( 0.9, a ) );
  vec3 head = mix( black, white, max( band, throat ) * ( 1.0 - mask ) );
  head = mix( head, srgb( vec3( 0.78, 0.45, 0.45 ) ), ( 1.0 - aaStep( 0.0075, pinkSpot ) ) * aaStep( 0.028, dm ) );
  // Body: white front; the black chest band runs down each flank to the
  // legs with a thin white line outside it; a few black belly spots.
  float front = 1.0 - aaStep( 1.32, a );
  float chest = 1.0 - aaStep( 0.013, abs( p.y - ( 0.392 - 0.075 * pow( min( a, 1.0 ) / 0.9, 2.0 ) ) ) );
  chest *= 1.0 - aaStep( 1.02, a );
  float flank = aaStep( 0.985, a ) * ( 1.0 - aaStep( 1.16, a ) ) * ( 1.0 - aaStep( 0.37, p.y ) ) * aaStep( 0.06, p.y );
  float spots = aaStep( 0.86, vnoise( p * vec3( 36.0, 30.0, 36.0 ) + 3.0 ) ) * ( 1.0 - aaStep( 0.34, p.y ) ) * aaStep( 0.12, p.y ) * ( 1.0 - aaStep( 0.8, a ) );
  float whiteness = front * ( 1.0 - max( max( chest, flank ), spots ) );
  vec3 body = mix( black, mix( srgb( vec3( 0.5, 0.5, 0.48 ) ), white, aaStep( 0.06, p.y ) ), whiteness );
  vec3 c = mix( body, head, smoothstep( 0.445, 0.462, p.y ) );
  // Flippers: black above; the underside (toward the body) white, edged dark.
  float under = ( 1.0 - aaStep( -0.25, sign( p.x ) * n.x ) ) * ( 1.0 - aaStep( 0.5, n.z ) );
  vec3 flipper = mix( black, mix( srgb( vec3( 0.32 ) ), white, aaStep( 0.24, p.y ) ), under );
  c = mix( c, flipper, smoothstep( 0.35, 0.65, tags.z ) );
  // Feet: dark grey-black, mottled pink.
  vec3 foot = mix( srgb( vec3( 0.09, 0.08, 0.08 ) ), srgb( vec3( 0.42, 0.3, 0.3 ) ), aaStep( 0.68, vnoise( p * 70.0 ) ) );
  c = mix( c, foot, smoothstep( 0.35, 0.65, tags.y ) );
  // Bill: black, a pale band near the hooked tip.
  vec3 bill = mix( black, srgb( vec3( 0.42 ) ), aaStep( 0.117, p.z ) * ( 1.0 - aaStep( 0.13, p.z ) ) );
  c = mix( c, bill, smoothstep( 0.35, 0.65, tags.x ) );
  // Eye: dark red-brown.
  return mix( c, srgb( vec3( 0.14, 0.05, 0.03 ) ), step( 0.5, tags.w ) );
}`;

export const PENGUIN_DEFORM = `${DEFORM_GLSL}
attribute vec4 part;
// pose: head yaw, head pitch (+ up), flipper spread (rad), gait phase;
// pose2: gait amplitude, flipper beat (swimming), preen jitter, bill open.
attribute vec4 pose;
attribute vec4 pose2;
uniform float time;
void animalDeform( inout vec3 p, inout vec3 n ) {
  float foot = part.z;
  if ( abs( foot ) > 0.01 ) {
    float ph = pose.w + ( foot > 0.0 ? 0.0 : 3.14159 );
    float w = abs( foot );
    p.y += max( 0.0, sin( ph ) ) * pose2.x * 0.03 * w;
    p.z += cos( ph ) * pose2.x * 0.035 * w;
  }
  float fl = part.y;
  if ( abs( fl ) > 0.01 ) {
    float s = sign( fl );
    float beat = pose2.y * sin( time * 11.0 + pose.w );
    turnAbout( p, n, vec3( s * 0.098, 0.395, 0.0 ), rotZ( s * ( pose.z + beat - 0.08 ) ) * rotX( -beat * 0.4 ), abs( fl ) );
  }
  if ( part.w > 0.01 ) turnAbout( p, n, vec3( 0.0, 0.1, -0.07 ), rotX( -0.25 * pose2.x * sin( pose.w * 2.0 ) ), part.w );
  float h = part.x;
  if ( h > 0.01 ) {
    float jitter = pose2.z * sin( time * 23.0 ) * 0.12;
    turnAbout( p, n, vec3( 0.0, 0.43, 0.01 ), rotY( pose.x + jitter ) * rotX( -pose.y ), clamp( h, 0.0, 1.0 ) );
  }
}`;

// domes: forest.obstacles.domes; blobs/spray: shared (animal-forms.js).
export function createPenguins(group, { seed, domes, cluster, light = false, blobs = null, spray = null }) {
  const random = seededRandom(seed ^ 0x7e9a11c3);
  const events = [];
  const count = light ? 9 : 14;
  // The outcrop's stones (and any nearby) are what they walk round.
  const near = domes.filter((d) => Math.hypot(d.x - cluster.x, d.z - cluster.z) < 26);
  const surface = surfaceOf(near);
  // Moves a standing bird to (x, z) unless that is up on a rock.
  const easeTo = (q, x, z) => {
    if (surface(x, z) - groundHeight(x, z) > 0.3) return;
    q.x = x;
    q.z = z;
  };
  // Whether a stride toward heading h climbs a flank (see update).
  const steepAhead = (b, here, h) => {
    const ax = b.x + Math.sin(h) * 0.25, az = b.z + Math.cos(h) * 0.25;
    const ahead = surface(ax, az);
    const up = ahead - here;
    return up > 0.35 || (up > 0.1 && ahead - groundHeight(ax, az) > 0.3);
  };
  const tall = (x, z) => {
    for (const d of near) {
      if (Math.abs(x - d.x) > d.r || Math.abs(z - d.z) > d.r) continue;
      if (domeHeight(d, x, z) > groundHeight(x, z) + 0.3) return true;
    }
    return false;
  };
  // Home: the sand on the landward side of the outcrop and between its
  // stones, a metre or two inland.
  const theta = cluster.theta;
  const homes = [];
  for (let k = 0; k < 400 && homes.length < count; k++) {
    const t = theta + (random() - 0.5) * 0.22;
    const inland = 0.9 + random() * 5.5;
    const p = islandPoint(t, inland);
    if (tall(p.x, p.z) || tall(p.x + 0.25, p.z) || tall(p.x - 0.25, p.z) || tall(p.x, p.z + 0.25) || tall(p.x, p.z - 0.25)) continue;
    if (homes.some((h) => Math.hypot(h.x - p.x, h.z - p.z) < 0.55)) continue;
    // Keep the party together: near the first few.
    if (homes.length > 2 && !homes.some((h) => Math.hypot(h.x - p.x, h.z - p.z) < 1.4)) continue;
    homes.push(p);
  }
  while (homes.length < count) homes.push(islandPoint(theta + (homes.length - count / 2) * 0.01, 2.5 + (homes.length % 3)));
  const centre = {
    x: homes.reduce((s, h) => s + h.x, 0) / homes.length,
    z: homes.reduce((s, h) => s + h.z, 0) / homes.length,
  };
  const centreTheta = Math.atan2(centre.z - ISLAND.z, centre.x - ISLAND.x);
  // Where they go in: the nearest clear sand at the swash.
  let entry = islandPoint(centreTheta, -0.4);
  for (let k = 0; k < 40; k++) {
    const t = centreTheta + (k % 2 ? 1 : -1) * Math.floor((k + 1) / 2) * 0.012;
    const p = islandPoint(t, 0.2);
    if (!tall(p.x, p.z) && !tall(p.x, p.z + 0.5) && !tall(p.x + 0.5, p.z)) {
      entry = islandPoint(t, -0.6);
      break;
    }
  }
  const entryTheta = Math.atan2(entry.z - ISLAND.z, entry.x - ISLAND.x);
  // Wading on in until it is deep enough to swim.
  const plunge = islandPoint(entryTheta, -2.8);
  // And where they come out: swim in, stand up in the shallows, walk up.
  const landing = islandPoint(entryTheta, 1.2);

  const geometry = formGeometry("penguin", { light }, penguinGeometry);
  const shared = { time: { value: 0 } };
  const material = animalMaterial({ name: "penguin", uniforms: shared, pars: PENGUIN_DEFORM, paint: PENGUIN_PAINT, roughness: 0.62, sheen: 0.25 });
  const { mesh, attrs } = animalMesh(group, geometry, material, count, { pose: 4, pose2: 4 });
  // lod: a 360-triangle body beyond 18 m (2,000 near).
  const bounds = herdBounds(mesh, { coarse: formGeometry("penguin", { light, coarse: 360 }, penguinGeometry), far: 18 });

  const birds = homes.map((home, i) => ({
    i,
    home,
    x: home.x,
    z: home.z,
    y: surface(home.x, home.z),
    vy: 0,
    heading: Math.atan2(centre.x - home.x, centre.z - home.z) + (random() - 0.5) * 2.5,
    speed: 0,
    // colony | away | outing | sea | back | flee
    mode: "colony",
    act: "look",
    actTimer: random() * 4,
    target: null,
    pace: 0.32,
    gait: random() * 6,
    gaitAmp: 0,
    headYaw: 0,
    headPitch: 0,
    lookYaw: 0,
    lookPitch: 0,
    flipper: 0,
    flipperWant: 0,
    beat: 0,
    swim: 0,
    wet: 0,
    porpoise: 0,
    pitch: 0,
    size: (0.92 + random() * 0.14) * 1.07 * WORLD_SCALE, // 0.57 m model → 0.85 m: a 0.6 m bird at the island's scale
    bold: random(),
    calm: 10,
    seaTimer: 0,
    crumb: 0,
    threat: 0,
    shake: 0,
  }));
  // A party walking to the sea follows its leader's trail.
  let outing = null;
  let outingTimer = 25 + random() * 30;
  let alarmAt = -10;
  const crumbs = [];
  let clock = 0;
  let atSea = 0;
  const interest = { x: 0, y: 0, z: 0, kind: "penguin", near: false, d: 0 };
  const say = (type, b, d, gain) => events.push({ type, x: b.x, z: b.z, d, gain: gain * clamp(1 - d / 45, 0, 1) });

  let grow = 1;
  return {
    pois: [{ id: "penguins", title: "Penguin colony", x: centre.x, z: centre.z, r: 6 }],
    events,
    birds,
    centre,
    entry,
    update({ dt, time, night, pose, water, eye = null }) {
      clock += dt;
      shared.time.value = time;
      const catD = Math.hypot(pose.x - centre.x, pose.z - centre.z);
      // Far off (and no-one at sea) the colony costs nothing.
      const away = catD > 95 && atSea === 0;
      grow = atSea ? 1 : grownAt(catD, 95);
      mesh.visible = !away && geometry.userData.ready;
      if (away) return null;
      atSea = 0;
      const catSpeed = Math.abs(pose.speed);
      const pounce = pose.air > 0.05 || catSpeed > 2;
      let best = null;
      let bestD = AWARE;
      // Outings: now and then, when nothing troubles them, a few go to sea.
      outingTimer -= dt;
      if (!outing && outingTimer < 0 && catD > 12 && night < 0.8) {
        const party = birds.filter((b) => b.mode === "colony").sort(() => random() - 0.5).slice(0, 3 + Math.floor(random() * 3));
        if (party.length >= 2) {
          outing = { party, leader: party[0] };
          crumbs.length = 0;
          party.forEach((b, k) => {
            b.mode = "outing";
            b.crumb = k * 0.42;
            b.seaTimer = 25 + random() * 30;
          });
        }
        outingTimer = 60 + random() * 70;
      }
      bounds.begin();
      for (const b of birds) {
        const dx = b.x - pose.x;
        const dz = b.z - pose.z;
        const dc = Math.hypot(dx, dz) || 1e-3;
        const ax = dx / dc;
        const az = dz / dc;
        const onLand = shoreDistance(b.x, b.z) > -0.2 && b.swim < 0.5;
        b.calm = dc > 8 ? b.calm + dt : 0;
        // Reactions on land.
        if (onLand && b.mode !== "flee") {
          const shy = SHY + catSpeed * 0.55;
          if (pounce && dc < 3.4) {
            // Panic: the nearest few hurry for the water.
            b.mode = "flee";
            b.seaTimer = 14 + random() * 10;
            b.target = null;
            say("honk", b, dc, 0.9);
          } else if (dc < shy && b.threat <= 0 && (b.mode === "colony" || b.mode === "away")) {
            if (b.bold > 0.8 && catSpeed < 0.5 && b.mode === "colony") {
              // Stands its ground a moment: faces the cat, head low, swaying.
              b.threat = 2.2;
              say("threat", b, dc, 0.7);
            } else {
              b.mode = "away";
              const r = shy + 1.2 + random();
              b.target = clearSpot(pose.x + ax * r, pose.z + az * r, b);
              b.pace = 0.42;
              if (clock - alarmAt > 1.6) {
                alarmAt = clock;
                say("honk", b, dc, 0.6);
              }
            }
          }
        }
        if (b.threat > 0) {
          b.threat -= dt;
          b.target = null;
          b.heading = turnToward(b.heading, Math.atan2(-dx, -dz), dt * 4);
          if (b.threat <= 0) {
            b.mode = "away";
            b.target = clearSpot(pose.x + ax * 4.5, pose.z + az * 4.5, b);
            b.pace = 0.4;
          }
        }
        // Back home once the cat has gone.
        if (b.mode === "away" && b.calm > HOME_CALM + (b.i % 4)) {
          b.mode = "colony";
          b.target = { x: b.home.x, z: b.home.z };
          b.pace = 0.3;
        }
        if (b.mode === "outing") {
          if (b === outing?.leader || !outing || outing.leader.mode !== "outing") b.target = plunge;
          else b.target = crumbAt(b.crumb);
          b.pace = 0.36;
          if (b.swim > 0.5) {
            b.mode = "sea";
            b.target = seaSpot(b);
          }
        }
        if (b.mode === "flee") {
          b.pace = 0.75;
          if (b.swim > 0.5) {
            b.mode = "sea";
            b.target = seaSpot(b, 8);
          } else if (!b.target || b.target === b.home) b.target = fleeEntry(b);
        }
        if (b.mode === "sea") {
          atSea++;
          b.seaTimer -= dt;
          b.pace = b.porpoise > 0 ? 1.8 : 0.55;
          if (b.target && Math.hypot(b.target.x - b.x, b.target.z - b.z) < 0.8) b.target = seaSpot(b);
          // Porpoise now and then, out where it is deep enough.
          if (b.porpoise <= 0 && shoreDistance(b.x, b.z) < -4 && random() < dt * 0.25) b.porpoise = 1;
          if (b.seaTimer < 0 && (b.calm > 3 || dc > 8)) {
            b.mode = "back";
            b.target = landing;
          }
        }
        if (b.mode === "back") {
          b.pace = b.swim > 0.5 ? 0.55 : 0.3;
          if (b.swim < 0.3 && shoreDistance(b.x, b.z) > 0.2) {
            b.mode = "colony";
            b.target = { x: b.home.x, z: b.home.z };
            b.shake = 0.6;
          }
        }
        if (b.mode === "colony" && b.target && Math.hypot(b.target.x - b.x, b.target.z - b.z) < 0.12) b.target = null;
        if (b.mode === "away" && b.target && Math.hypot(b.target.x - b.x, b.target.z - b.z) < 0.15) b.target = null;

        // Idle acts at home (or wherever it is standing).
        const walking = !!b.target && b.threat <= 0;
        if (!walking && b.swim < 0.5 && b.threat <= 0) {
          b.actTimer -= dt;
          if (b.actTimer < 0) {
            const r = random();
            const watched = dc < AWARE;
            b.act = watched ? (r < 0.8 ? "watch" : "look")
              : night > 0.6 ? (r < 0.7 ? "doze" : "look")
              : r < 0.3 ? "look" : r < 0.55 ? "preen" : r < 0.7 ? "stretch" : r < 0.8 ? "bray" : r < 0.9 ? "doze" : "shuffle";
            b.actTimer = { look: 2 + random() * 3, watch: 1.5 + random() * 2, preen: 2 + random() * 3, stretch: 1.4, bray: 2.6, doze: 4 + random() * 6, shuffle: 1 }[b.act];
            b.lookYaw = (random() - 0.5) * 2.2;
            b.lookPitch = (random() - 0.5) * 0.4;
            b.preenSide = random() < 0.5 ? -1 : 1;
            if (b.act === "bray") {
              say("bray", b, dc, 1);
              // Braying is catching.
              for (const o of birds) if (o !== b && o.mode === "colony" && !o.target && random() < 0.25 && Math.hypot(o.x - b.x, o.z - b.z) < 2.5) {
                o.act = "bray";
                o.actTimer = 2.6 + random() * 0.4;
              }
            }
            if (b.act === "shuffle" && b.mode === "colony") {
              const a = random() * Math.PI * 2;
              const s = clearSpot(b.home.x + Math.cos(a) * 0.25, b.home.z + Math.sin(a) * 0.25, b);
              b.target = s;
              b.pace = 0.2;
            }
          }
        }
        // Head and flippers, by what it is doing.
        let yaw = 0;
        let pitch = 0;
        let jitter = 0;
        let flip = 0;
        if (b.threat > 0) {
          yaw = Math.sin(clock * 9) * 0.45;
          pitch = -0.55;
          flip = 0.35;
        } else if (b.swim > 0.5) {
          pitch = 1.05 + Math.sin(clock * 1.3 + b.i) * 0.1;
          yaw = Math.sin(clock * 0.5 + b.i * 3) * 0.6;
        } else if (walking) {
          yaw = Math.sin(clock * 1.1 + b.i) * 0.2;
          pitch = 0.05;
          flip = b.pace > 0.4 ? 0.55 : 0.18;
          if (dc < AWARE && b.mode === "away") yaw = clamp(wrap(Math.atan2(-dx, -dz) - b.heading), -1.3, 1.3);
        } else if (b.act === "watch" || dc < AWARE) {
          // Watches the cat: head round, a little tilted up when it is near.
          yaw = clamp(wrap(Math.atan2(-dx, -dz) - b.heading), -1.4, 1.4);
          pitch = -0.1 + (dc < 3 ? 0.1 : 0);
          // Turns the body if the cat is behind it.
          if (Math.abs(wrap(Math.atan2(-dx, -dz) - b.heading)) > 1.2) b.heading = turnToward(b.heading, Math.atan2(-dx, -dz), dt * 1.2);
        } else if (b.act === "look") {
          yaw = b.lookYaw;
          pitch = b.lookPitch;
        } else if (b.act === "preen") {
          yaw = b.preenSide * 1.25;
          pitch = -0.85;
          jitter = 1;
          flip = 0.25;
        } else if (b.act === "stretch") {
          const t = 1 - b.actTimer / 1.4;
          flip = Math.sin(Math.PI * clamp(t, 0, 1)) * 1.1;
          pitch = 0.3 * Math.sin(Math.PI * clamp(t, 0, 1));
          b.beat = Math.sin(Math.PI * clamp(t, 0, 1)) * 0.25;
        } else if (b.act === "bray") {
          // Head thrown up, flippers out, the chest pumping.
          const t = clamp(1 - b.actTimer / 2.6, 0, 1);
          const up = smooth(0, 0.15, t) * (1 - smooth(0.85, 1, t));
          pitch = 1.35 * up;
          flip = 0.9 * up + Math.sin(clock * 6) * 0.15 * up;
          b.beat = 0;
        } else if (b.act === "doze") {
          pitch = -0.35;
          yaw = 0.15;
        }
        if (b.shake > 0) {
          b.shake -= dt;
          yaw += Math.sin(b.shake * 40) * 0.5 * (b.shake / 0.6);
        }
        b.headYaw += (yaw - b.headYaw) * Math.min(1, dt * (b.threat > 0 ? 14 : 6));
        b.headPitch += (pitch - b.headPitch) * Math.min(1, dt * 5);
        b.flipperWant = flip;
        b.flipper += (b.flipperWant - b.flipper) * Math.min(1, dt * 6);
        b.jitter = jitter;
        if (b.act !== "stretch" || walking) b.beat = b.swim * (b.porpoise > 0 ? 0.9 : 0.35);

        // Move.
        let want = 0;
        if (walking && b.target) {
          const tx = b.target.x - b.x;
          const tz = b.target.z - b.z;
          const td = Math.hypot(tx, tz);
          const desire = Math.atan2(tx, tz);
          b.heading = turnToward(b.heading, desire, dt * (b.swim > 0.5 ? 2 : 3.2));
          want = b.pace * Math.max(0, Math.cos(wrap(desire - b.heading))) * Math.min(1, td / 0.25 + 0.3);
        }
        b.speed += (want - b.speed) * Math.min(1, dt * 4);
        // Keep apart from neighbours.
        let px = 0;
        let pz = 0;
        if (b.swim < 0.5) for (const o of birds) {
          if (o === b || o.swim > 0.5) continue;
          const ox = b.x - o.x;
          const oz = b.z - o.z;
          const od = Math.hypot(ox, oz);
          if (od < 0.38 * WORLD_SCALE && od > 1e-4) {
            px += (ox / od) * (0.38 * WORLD_SCALE - od);
            pz += (oz / od) * (0.38 * WORLD_SCALE - od);
          }
        }
        // solid: and from the cat's paws: a penguin brushed by the cat
        // steps aside (it is a body the cat cannot walk through).
        if (b.swim < 0.5) {
          const cx = b.x - pose.x, cz = b.z - pose.z, cd = Math.hypot(cx, cz);
          if (cd < 0.6 && cd > 1e-4) {
            px += (cx / cd) * (0.6 - cd) * 2.5;
            pz += (cz / cd) * (0.6 - cd) * 2.5;
          }
        }
        let nx = b.x + Math.sin(b.heading) * b.speed * dt + px * dt * 3;
        let nz = b.z + Math.cos(b.heading) * b.speed * dt + pz * dt * 3;
        // Round the stones: a rock too tall to hop is walked round.
        // solid: judged a stride ahead, not one frame's step: by the step
        // a boulder's flank never looked steep, so penguins walked up the
        // big boulders in a stutter of little hops and stood on their
        // rounded tops. A penguin hops onto a low flat stone (under 0.3 m
        // above the sand), never up a flank.
        const here = surface(b.x, b.z);
        if (b.speed > 0.01 && steepAhead(b, here, b.heading)) {
          // Feel round it: the nearest clear bearing either side, keeping to
          // whichever side it chose first until clear.
          const step = b.speed * dt + 0.08;
          let found = false;
          for (let k = 1; k <= 4 && !found; k++) {
            for (const s of b.dodge ? [b.dodge] : [1, -1]) {
              const h = b.heading + s * k * 0.45;
              if (!steepAhead(b, here, h)) {
                b.dodge = s;
                b.heading = turnToward(b.heading, h, dt * 6);
                nx = b.x + Math.sin(h) * b.speed * dt;
                nz = b.z + Math.cos(h) * b.speed * dt;
                found = true;
                break;
              }
            }
          }
          if (!found) {
            nx = b.x;
            nz = b.z;
            b.heading += (b.dodge || 1) * dt * 3;
          }
        } else if (b.speed > 0.01) b.dodge = 0;
        // And whatever the push (a neighbour, a dodge), never up onto a
        // rock more than a low stone's height above the sand.
        if (b.swim < 0.5) {
          const top = surface(nx, nz);
          if (top > here + 0.002 && top - groundHeight(nx, nz) > 0.3) {
            nx = b.x;
            nz = b.z;
          }
        }
        // Only to sea when meaning to go.
        const goingIn = b.mode === "outing" || b.mode === "flee" || b.mode === "sea" || b.mode === "back";
        if (!goingIn && shoreDistance(nx, nz) < 0.5 && shoreDistance(nx, nz) < shoreDistance(b.x, b.z)) {
          nx = b.x;
          nz = b.z;
          b.target = null;
        }
        if (shoreDistance(nx, nz) < -22) {
          nx = b.x;
          nz = b.z;
        }
        b.x = nx;
        b.z = nz;
        if (b === outing?.leader) dropCrumb(b);
        // Water: float once it is deep enough to swim.
        const ground = surface(b.x, b.z);
        const sea = water && shoreDistance(b.x, b.z) < 1.5 ? water(b.x, b.z) : null;
        const level = sea ? sea.level : -Infinity;
        const depth = level - ground;
        const swimming = depth > (b.swim > 0.5 ? 0.06 : 0.14);
        if (swimming && b.swim < 0.5 && b.mode !== "back") say("splash", b, dc, 0.5);
        b.swim += ((swimming ? 1 : 0) - b.swim) * Math.min(1, dt * 3);
        if (b.swim > 0.5) b.wet = 1;
        else b.wet = Math.max(0, b.wet - dt / 90);
        // Gait: about 1.9 waddle cycles a second at a brisk walk.
        b.gaitAmp += ((b.swim < 0.5 && b.speed > 0.03 ? 1 : 0) - b.gaitAmp) * Math.min(1, dt * 8);
        b.gait += dt * (b.swim > 0.5 ? 1.5 : 4 + b.speed * 22);
        let y;
        let pitchBody = b.swim * Math.PI * 0.47;
        if (b.swim > 0.5 && Number.isFinite(level)) {
          // Afloat low, the back just awash; porpoising leaps clear in arcs.
          y = level - 0.03;
          if (b.porpoise > 0) {
            b.porpoise -= dt / 1.1;
            const s = 1 - Math.max(0, b.porpoise);
            const arc = Math.sin(Math.PI * s);
            y = level - 0.25 + arc * 0.55;
            pitchBody = Math.PI * 0.5 - Math.cos(Math.PI * s) * 0.55;
            if (b.porpoise <= 0) say("splash", b, dc, 0.25);
          }
          b.vy = 0;
        } else {
          // Hops up onto a low stone, drops off one.
          if (ground > b.y + 0.06 && b.vy <= 0) b.vy = Math.sqrt(2 * 9.8 * (ground - b.y + 0.05));
          b.vy -= 9.8 * dt;
          b.y += b.vy * dt;
          if (b.y <= ground) {
            b.y = ground;
            b.vy = 0;
          }
          y = b.y;
        }
        if (b.swim > 0.5) b.y = ground;
        b.pitch += (pitchBody - b.pitch) * Math.min(1, dt * 5);
        // Waddle: the body rocks side to side over each foot.
        const roll = Math.sin(b.gait) * 0.13 * b.gaitAmp;
        const yawWobble = Math.sin(b.gait) * 0.06 * b.gaitAmp;
        // Swimming, the body lies along the heading: shift the feet back so
        // the bird's middle is where it is.
        const back = Math.sin(b.pitch) * 0.28 * b.size;
        const bob = b.swim < 0.5 ? Math.abs(Math.cos(b.gait)) * 0.012 * b.gaitAmp : 0;
        placeInstance(mesh, b.i, b.x - Math.sin(b.heading) * back, y + bob, b.z - Math.cos(b.heading) * back, b.heading + yawWobble, b.pitch, roll, b.size * grow);
        bounds.add(b.x - Math.sin(b.heading) * back, y + bob, b.z - Math.cos(b.heading) * back, 0.5);
        attrs.pose.setXYZW(b.i, b.headYaw, b.headPitch, b.flipper, b.gait);
        attrs.pose2.setXYZW(b.i, b.gaitAmp * Math.min(1, b.speed / 0.2 + 0.3), b.beat, b.jitter ?? 0, 0);
        attrs.wet.setX(b.i, b.wet);
        attrs.waterline.setX(b.i, b.swim > 0.2 && Number.isFinite(level) ? level : -1e4);
        if (blobs && b.swim < 0.5) blobs.add(b.x, ground, b.z, b.heading, 0.3 * b.size, 0.26 * b.size, Math.max(0, 1 - (y - ground) * 4) * (1 - b.wet * 0.2));
        if (dc < bestD) {
          bestD = dc;
          best = b;
        }
      }
      // solid: no two standing penguins in one place: pairs closer than a
      // body's width are eased apart (not onto a rock).
      for (let i = 0; i < birds.length; i++) {
        const b = birds[i];
        if (b.swim > 0.5) continue;
        for (let j = i + 1; j < birds.length; j++) {
          const o = birds[j];
          if (o.swim > 0.5) continue;
          const dx = b.x - o.x, dz = b.z - o.z, d = Math.hypot(dx, dz);
          if (d >= 0.34 * WORLD_SCALE || d < 1e-5) continue;
          const push = (0.34 * WORLD_SCALE - d) / 2 / d;
          easeTo(b, b.x + dx * push, b.z + dz * push);
          easeTo(o, o.x - dx * push, o.z - dz * push);
        }
      }
      if (outing && outing.party.every((b) => b.mode !== "outing")) outing = null;
      bounds.end(eye);
      mesh.instanceMatrix.needsUpdate = true;
      attrs.pose.needsUpdate = true;
      attrs.pose2.needsUpdate = true;
      attrs.wet.needsUpdate = true;
      attrs.waterline.needsUpdate = true;
      if (!best) return null;
      interest.x = best.x;
      interest.y = best.y + 0.45 * best.size;
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

  function clearSpot(x, z, b) {
    // Toward (x, z), but on the sand, not in a rock or the sea.
    for (let k = 0; k < 8; k++) {
      const f = 1 - k * 0.12;
      const px = b.x + (x - b.x) * f + (k ? (random() - 0.5) * 0.6 : 0);
      const pz = b.z + (z - b.z) * f + (k ? (random() - 0.5) * 0.6 : 0);
      if (shoreDistance(px, pz) > 0.7 && !tall(px, pz)) return { x: px, z: pz };
    }
    return null;
  }
  function seaSpot(b, out = 0) {
    const t = entryTheta + (random() - 0.5) * 0.25;
    return islandPoint(t, -(3 + out + random() * 7));
  }
  function fleeEntry(b) {
    // The nearest bit of sea, unless a rock is in the way: then the entry.
    const t = Math.atan2(b.z - ISLAND.z, b.x - ISLAND.x);
    const p = islandPoint(t, -1);
    for (let s = 0.2; s < 1; s += 0.2) {
      if (tall(b.x + (p.x - b.x) * s, b.z + (p.z - b.z) * s)) return plunge;
    }
    return islandPoint(t, -2.8);
  }
  function dropCrumb(b) {
    const last = crumbs[crumbs.length - 1];
    if (!last || Math.hypot(last.x - b.x, last.z - b.z) > 0.08) crumbs.push({ x: b.x, z: b.z });
    if (crumbs.length > 400) crumbs.shift();
  }
  // The leader's trail, `back` metres behind it.
  function crumbAt(back) {
    if (!crumbs.length) return null;
    const k = crumbs.length - 1 - Math.round(back / 0.08);
    return k < 0 ? null : crumbs[k];
  }
}
