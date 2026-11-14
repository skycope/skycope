import { groundHeight, shoreDistance, islandPoint, ISLAND } from "./terrain.js";
import { CAT_SCALE, STAND_HEIGHT } from "./cat-rig.js";
import { seabedDepth, shoreAlong } from "./sea-surface.js";
import { createBlockers } from "./blockers.js";

// The cat's movement and the camera that follows it, in coast metres (x
// right, z toward the home horizon; heading φ points along (sin φ, cos φ)).
// The renderer's azimuth is φ − 45° (the coast frame is the world frame
// turned by 45°), so the WebGPU sky/sea and the Three.js layer share this
// camera exactly as they shared the old flight state.

const WALK_SPEED = 0.95;
const RUN_SPEED = 3.4;
const GRAVITY = 9.8;
const JUMP_SPEED = 4.1;
const CAT_RADIUS = 0.12 * CAT_SCALE;
const LOOK_LIFT = 0.13;
const HOME_THETA = Math.atan2(0 - ISLAND.z, 6 - ISLAND.x);
// The body, not just its centre, meets a rock: points along the chest to the
// chin and at the shoulders, [forward, right] in metres. A point may be
// higher than the paws by a step plus a climbable slope to it; any higher
// and the chest would be in the rock.
const PROBES = [[0.04, 0], [0.09, 0], [0.14, 0], [0.2, 0], [0.12, 0.05], [0.12, -0.05]].map(([f, s]) => [
  f * CAT_SCALE,
  s * CAT_SCALE,
  Math.hypot(f, s) * CAT_SCALE,
]);
const STEP_UP = 0.08;
const CLIMB = 0.75;
// Walking straight at a rock it can reach, a cat hops up rather than stopping.
const HOP_REACH = 0.7;
// In the sea. The cat wades until the water reaches its back, then floats
// with its back just under the surface and paddles: slowly, as cats do.
// Water drags at its legs as it deepens. Past the kelp it turns back.
const LEG = STAND_HEIGHT * CAT_SCALE;
const FLOAT = 0.02;
const SWIM_SPEED = 0.5;
const SWIM_SPRINT = 0.78;
export const SWIM_LIMIT = 24;

export const CAMERA = { distance: 3.4, elevation: 0.38, min: 1.1, max: 8 };
// boat: the follow camera's range afloat (distance m, elevation rad).
export const BOAT_VIEW = { distance: 7.2, elevation: 0.2, min: 4.5, max: 14, low: 0.07, high: 0.7 };
// Photo mode frees the camera further round, lower, higher and wider.
const FREE = { min: 0.7, max: 14, low: 0.02, high: 1.4 };
// How close the spring arm may pull the camera to the cat, and how far the
// lens keeps from a trunk.
const ARM_MIN = 0.9;
const ARM_CLEARANCE = 0.35;
// The most the camera rises to see over a boulder before the arm shortens.
const ARM_LIFT = 1.6;
// How far the lens keeps from a wall, a tower or a timber (blockers.js),
// and the least it may come to one before it is pulled in along the boom.
const LENS_CLEARANCE = 0.4;
const LENS_GUARD = 0.18;
// Each step the boom may tilt up to see over a solid at the cat's back.
const SOLID_RISE = 1.1;
// Step turns (radians) tried when the cat brushes a wall (see update).
const SKEW = [0.3, 0.6, -0.3, -0.6];

// sea (sea-surface.js) gives the water level; wake (wake.js) takes the
// cat's trail through it.
export function createWalker(obstacles, sea = null, wake = null) {
  const grid = spatialGrid(obstacles);
  // solid: the landmarks' walls, towers, timbers and limbs (places.js).
  const solids = createBlockers(obstacles.blockers ?? [], obstacles.bodies ?? []);
  const cat = {
    x: 0,
    z: 0,
    y: 0,
    heading: 0,
    speed: 0,
    turn: 0,
    gaitAmp: 0,
    running: false,
    vy: 0,
    air: 0,
    airPitch: 0,
    sit: 0,
    sleepy: 0,
    idle: 0,
    look: 0,
    lookUp: 0,
    tilt: 0,
    swish: 0,
    meowing: 0,
    onRock: false,
    // Water: the surface over the cat, how deep it is there, how much the
    // cat wades (0…1 of its leg) and floats, its slope for rolling on the
    // waves, the body height (in the bind pose) the coat is wet to, and the
    // shake that throws the water off afterwards (0 idle, then 0…1).
    waterY: -Infinity,
    water: 0,
    wade: 0,
    swim: 0,
    waterSlope: [0, 0],
    // The water's velocity past the cat (its flow less the cat's own
    // motion), and how fast the water is rising round it (m/s).
    flow: [0, 0],
    rising: 0,
    soak: -1,
    shake: 0,
    dryFor: 0,
    shaken: true,
  };
  const camera = {
    yaw: 0,
    elevation: CAMERA.elevation,
    distance: CAMERA.distance,
    x: 0,
    y: 0,
    z: 0,
    targetY: 0,
    azimuth: 0,
    pitch: 0,
    pointer: [0.5, 0.5],
    // The spring arm's current length as a fraction of `distance`.
    arm: 1,
    // How far the arm tilts up to clear a rise or a boulder (metres).
    lift: 0,
  };
  let target = null;
  let blocked = 0;
  let armLift = 0;
  let lastDrag = -10;
  let clock = 0;
  // Where the camera is easing to when it is not simply following: the
  // viewer's own framing in photo mode (`free`), or the slow drift of
  // sitting to watch the sky. { yaw, elevation, distance, rate }
  let goal = null;
  let free = false;
  let last = null;
  // The last rock face the body met: outward normal, when, which way round
  // the cat is going, and how long it has pushed straight at it.
  const wall = { x: 0, z: 0, at: -10, side: 1, top: -Infinity, headOn: 0 };
  const events = [];
  // boat: the fisherman's boat (boat.js), when it is afloat: its deck is
  // walkable surface, and while the cat is aboard it moves the cat, takes
  // the input and frames the camera.
  let ride = null;

  home();

  return {
    cat,
    camera,
    events,
    surface,
    // boat: the surface without the boat's deck (seabed, sand, boulders).
    bed: base,
    solids,
    // boat: boat.js attaches itself ({ deck(x, z), carries(cat), update(dt,
    // input, cat, yaw) → true while it has the cat, view }); null detaches.
    set ride(r) {
      ride = r;
    },
    get ride() {
      return ride;
    },
    // The water over (x, z): { level (−∞ where dry), flow }.
    water(x, z) {
      return waterAt(x, z, surface(x, z));
    },
    home,
    walkTo(x, z) {
      target = { x, z };
      blocked = 0;
    },
    meow() {
      cat.meowing = 0.9;
      cat.idle = Math.min(cat.idle, 2);
    },
    orbit(dx, dy) {
      if (free) {
        goal.yaw += dx;
        goal.elevation = clamp(goal.elevation + dy, FREE.low, FREE.high);
        return;
      }
      camera.yaw += dx;
      camera.elevation = clamp(camera.elevation + dy, 0.06, 1.2);
      lastDrag = clock;
    },
    zoom(factor) {
      if (free) {
        goal.distance = clamp(goal.distance * factor, FREE.min, FREE.max);
        return;
      }
      // boat: afloat it may draw further back.
      const afloat = ride && ride.carries(cat);
      camera.distance = clamp(camera.distance * factor, afloat ? BOAT_VIEW.min : CAMERA.min, afloat ? BOAT_VIEW.max : CAMERA.max);
    },
    // Photo mode: orbit and zoom ease toward where the viewer puts them,
    // over a wider range; off again, the follow camera takes over from
    // wherever the photo left it.
    freeCamera(on) {
      free = Boolean(on);
      if (free) goal = { yaw: camera.yaw, elevation: camera.elevation, distance: camera.distance, rate: 3.5 };
      else {
        goal = null;
        camera.elevation = clamp(camera.elevation, 0.06, 1.2);
        camera.distance = clamp(camera.distance, CAMERA.min, CAMERA.max);
        lastDrag = clock;
      }
    },
    // Sitting to watch: drift slowly to frame `view` ({ yaw, elevation,
    // distance }), or null to stop wherever it has got to.
    watch(view) {
      if (free) return;
      goal = view ? { ...view, yaw: camera.yaw + wrap(view.yaw - camera.yaw), rate: 0.11 } : null;
      if (!view) lastDrag = clock;
    },
    // input: move [right, forward] in camera terms (−1…1), run, jump (edge).
    // cameraDt is the camera's own clock: it keeps easing while time is
    // paused for a photo.
    update(dt, input, interest, cameraDt = dt) {
      clock += dt;
      // boat: aboard, the boat carries the cat and the input steers it.
      // (Every frame, so the boat lives while the cat is ashore too.)
      if (ride && ride.update(dt, input, cat, camera.yaw)) {
        target = null;
        updateCamera(cameraDt, false);
        return cat;
      }
      let mx = input.move[0];
      let mz = input.move[1];
      if (mx || mz) target = null;
      const forwardX = Math.sin(camera.yaw);
      const forwardZ = Math.cos(camera.yaw);
      let dirX = forwardX * mz + forwardZ * mx;
      let dirZ = forwardZ * mz - forwardX * mx;
      let want = Math.min(1, Math.hypot(dirX, dirZ));
      let run = input.run;
      if (target) {
        const tx = target.x - cat.x;
        const tz = target.z - cat.z;
        const d = Math.hypot(tx, tz);
        if (d < 0.18 || blocked > 0.8) target = null;
        else {
          dirX = tx;
          dirZ = tz;
          want = Math.min(1, d / 0.5);
          run = run || d > 7;
        }
      }
      // Against a rock, walk round it: the wanted direction loses its part
      // into the rock, and straight at it picks a side and keeps to it. A
      // low enough rock met head-on is hopped onto instead.
      let hop = false;
      if (want > 0.01 && clock - wall.at < 0.3) {
        const len = Math.hypot(dirX, dirZ);
        const wx = dirX / len;
        const wz = dirZ / len;
        const into = wx * wall.x + wz * wall.z;
        if (into < 0) {
          let tx = wx - wall.x * into;
          let tz = wz - wall.z * into;
          const across = Math.hypot(tx, tz);
          if (across > 0.3) wall.side = Math.sign(tx * wall.z - tz * wall.x) || wall.side;
          const reach = wall.top - cat.y;
          wall.headOn = across < 0.45 ? wall.headOn + dt : 0;
          if (across < 0.45 && reach > 0.05 && reach < HOP_REACH && cat.air === 0) {
            hop = wall.headOn > 0.12;
          } else {
            if (across < 0.3) {
              tx = wall.z * wall.side;
              tz = -wall.x * wall.side;
            }
            const t = Math.hypot(tx, tz);
            dirX = tx / t;
            dirZ = tz / t;
          }
        } else wall.headOn = 0;
      }
      // Turn toward the wanted direction; a cat pivots rather than reversing.
      // Turning eases in and out (angular velocity, not snapped headings),
      // and a cat slows to turn sharply.
      // A shake stops the cat where it stands.
      if (cat.shake > 0) want = 0;
      let wantedTurn = 0;
      if (want > 0.01) {
        const diff = wrap(Math.atan2(dirX, dirZ) - cat.heading);
        const rate = (run ? 5.5 : 3.8) * (1 - cat.swim * 0.55);
        wantedTurn = clamp(diff * 6, -rate, rate);
        want *= Math.max(0, Math.cos(diff)) ** 0.8;
      }
      cat.turn += (wantedTurn - cat.turn) * Math.min(1, dt * 9);
      cat.heading = wrap(cat.heading + cat.turn * dt);
      // Water drags at the legs; afloat, the cat paddles.
      const drag = 1 - 0.55 * smooth(0.04, LEG, cat.water);
      const topSpeed = lerp((run ? RUN_SPEED : WALK_SPEED) * drag, run ? SWIM_SPRINT : SWIM_SPEED, cat.swim);
      const accel = (cat.air > 0 ? 1 : run ? 7 : 4) * lerp(drag, 0.35, cat.swim);
      // Speed eases toward the target: quick to start, softer to stop.
      const targetSpeed = want * topSpeed;
      const rate = targetSpeed > cat.speed ? accel : accel * 1.4;
      cat.speed += clamp((targetSpeed - cat.speed) * Math.min(1, dt * 5), -rate * dt, rate * dt);
      if (Math.abs(cat.speed) < 0.01 && want === 0) cat.speed = 0;
      cat.running = cat.speed > 1.7;

      // Jump: straight up or forward, onto rocks if they are in reach.
      if ((input.jump || hop) && cat.air === 0 && cat.sit < 0.5 && cat.shake === 0) {
        // Afloat, only a scramble: enough to haul out onto a rock.
        cat.vy = JUMP_SPEED * lerp(1, 0.78, cat.swim);
        // A hop onto a rock goes only as high as it needs to.
        if (hop && !input.jump) {
          cat.vy = Math.min(cat.vy, Math.sqrt(2 * GRAVITY * (wall.top - cat.y + 0.12)));
          cat.speed = Math.max(cat.speed, 1.1);
          wall.headOn = 0;
        }
        cat.air = 0.001;
        events.push({ type: "jump" });
      }
      if (input.jump && cat.sit >= 0.5) cat.idle = 0;

      // Move, sliding along whatever blocks the way.
      const step = cat.speed * dt;
      const sx = Math.sin(cat.heading) * step;
      const sz = Math.cos(cat.heading) * step;
      // Against a rock, slide along its outline (only the part of the step
      // into it is lost), so the cat brushes past instead of juddering.
      let moved = tryMove(cat.x + sx, cat.z + sz);
      if (!moved && clock === wall.at) {
        const into = sx * wall.x + sz * wall.z;
        if (into < 0) moved = tryMove(cat.x + sx - wall.x * into, cat.z + sz - wall.z * into);
      }
      if (!moved) moved = tryMove(cat.x + sx, cat.z) || tryMove(cat.x, cat.z + sz);
      // solid: still pressed in (a wall met at a shallow angle the normal
      // misjudged by a few degrees): turn the step a little either way,
      // so a cat brushing a wall slides along it and is never pinned.
      for (let k = 0; !moved && k < SKEW.length && Math.abs(step) > 1e-4; k++) {
        const a = cat.heading + SKEW[k] * wall.side;
        moved = tryMove(cat.x + Math.sin(a) * step * 0.8, cat.z + Math.cos(a) * step * 0.8);
      }
      if (!moved && Math.abs(step) > 1e-4) {
        blocked += dt;
        // In the air, momentum carries on once the body clears the rim.
        if (cat.air === 0) cat.speed *= 0.5;
      } else blocked = 0;
      // The swell carries a floating cat back and forth (and the broken
      // bores carry it in); it surges round wading legs.
      if (cat.water > 0.02 && cat.air === 0 && last) {
        const push = (cat.swim + (1 - cat.swim) * 0.3 * cat.wade) * dt;
        tryMove(cat.x + last.flowX * push, cat.z + last.flowZ * push, true);
      }

      // Water: the level here, and its slope for the body to roll with.
      const bed = surface(cat.x, cat.z);
      // (sea.at reuses one result object: copy it before sampling again.)
      const water = { ...waterAt(cat.x, cat.z, bed) };
      last = water;
      const depth = Math.max(0, water.level - bed);
      if (depth > 0) {
        // Over the sand, never a rock top: the film over a boulder beside
        // the cat read as a steep slope and tilted its waterline through
        // the body.
        const e = 0.25;
        const sx = waterAt(cat.x + e, cat.z, groundHeight(cat.x + e, cat.z)).level;
        const sz = waterAt(cat.x, cat.z + e, groundHeight(cat.x, cat.z + e)).level;
        cat.waterSlope[0] = Number.isFinite(sx) ? clamp((sx - water.level) / e, -0.3, 0.3) : 0;
        cat.waterSlope[1] = Number.isFinite(sz) ? clamp((sz - water.level) / e, -0.3, 0.3) : 0;
      } else cat.waterSlope[0] = cat.waterSlope[1] = 0;
      const moving = cat.air > 0 ? 0 : cat.speed;
      cat.flow[0] = (depth > 0 ? water.flowX : 0) - Math.sin(cat.heading) * moving;
      cat.flow[1] = (depth > 0 ? water.flowZ : 0) - Math.cos(cat.heading) * moving;
      cat.rising += ((dt > 0 ? (depth - cat.water) / dt : 0) - cat.rising) * Math.min(1, dt * 12);
      const entering = depth > 0.03 && cat.water <= 0.03;
      cat.water = depth;
      cat.waterY = depth > 0 ? water.level : -Infinity;
      cat.wade += (Math.min(1, depth / LEG) - cat.wade) * Math.min(1, dt * 10);
      cat.swim += (smooth(0.22, 0.3, depth) - cat.swim) * Math.min(1, dt * 4);
      if (entering && Math.abs(cat.speed) > 1.2) events.push({ type: "splash", speed: Math.abs(cat.speed) });

      // Vertical: stick to the ground (or float), or fly a ballistic arc.
      const floor = depth > 0 ? Math.max(bed, water.level - LEG - FLOAT) : bed;
      if (cat.air > 0) {
        cat.vy -= GRAVITY * dt;
        cat.y += cat.vy * dt;
        // solid: a leap stops under a limb or a seal, not inside it.
        if (cat.vy > 0 && solids.touches(cat.x, cat.y + 0.17, cat.z, CAT_RADIUS)) {
          cat.y -= cat.vy * dt;
          cat.vy = 0;
        }
        if (cat.y <= floor && cat.vy < 0) {
          cat.y = floor;
          events.push({ type: depth > 0.03 ? "splash" : "land", speed: -cat.vy });
          cat.vy = 0;
          cat.air = 0;
        }
      } else if (floor < cat.y - 0.12) {
        // Stepped off a rock.
        cat.vy = 0;
        cat.air = 0.001;
      } else cat.y = floor;
      const airborne = cat.air > 0 ? Math.max(0, cat.y - floor) : 0;
      cat.air = cat.air > 0 ? Math.max(0.001, airborne) : 0;
      cat.airPitch = cat.air > 0 ? clamp(cat.vy * 0.08, -0.3, 0.3) : 0;
      cat.onRock = bed > groundHeight(cat.x, cat.z) + 0.03;

      // The coat wets up to the waterline and dries over a minute or so.
      // Out of the water, a soaked cat stops and shakes it off.
      if (depth > 0) cat.soak = Math.max(cat.soak, clamp((water.level - cat.y - LEG) / CAT_SCALE, -0.2, 0.16));
      cat.soak = Math.max(-1, cat.soak - dt * (cat.soak > -0.2 ? 0.0035 : 0.05));
      if (depth > 0.1) cat.shaken = false;
      cat.dryFor = depth > 0.005 ? 0 : cat.dryFor + dt;
      if (!cat.shaken && cat.dryFor > 0.7 && cat.air === 0 && cat.soak > -0.13) {
        cat.shaken = true;
        cat.shake = 0.001;
        events.push({ type: "shake" });
      }
      if (cat.shake > 0) {
        cat.shake += dt / 1.1;
        if (cat.shake >= 1) {
          cat.shake = 0;
          cat.soak -= 0.04;
        }
      }
      // The wake: the body's waterline once it floats, churn from legs
      // running through the shallows.
      if (wake) {
        const immersion = Math.max(cat.swim, smooth(0.14, 0.26, depth)) * (cat.air > 0 ? 0 : 1);
        const speed = Math.abs(cat.speed);
        const churn = smooth(0.4, 1.6, speed) * smooth(0.03, 0.12, depth) * 0.7;
        const strength = Math.max(immersion * (0.45 + 0.55 * Math.min(1, speed / 0.6)), churn);
        wake.body.half = 0.2 * CAT_SCALE * lerp(0.6, 1, cat.swim);
        wake.body.trailBack = 0; // boat: (the boat drops its trail from the transom)
        wake.body.flow = depth > 0 ? cat.flow : [0, 0];
        wake.move(cat.x, cat.z, cat.heading, immersion, speed, cat.air > 0 ? 0 : strength, lerp(0.09, 0.075, cat.swim) * CAT_SCALE);
      }

      // How much the legs are stepping (the gait itself lives in cat.js).
      const pace = Math.max(Math.abs(cat.speed), Math.abs(cat.turn) * 0.1);
      cat.gaitAmp += (smooth(0, 0.18, pace) - cat.gaitAmp) * Math.min(1, dt * 8);

      // Idle: sit down after a few seconds, grow sleepy after half a minute.
      // Nor does a cat settle down in the water.
      const active = want > 0.01 || cat.air > 0 || Math.abs(cat.speed) > 0.05 || depth > 0.02 || cat.shake > 0;
      cat.idle = active ? 0 : cat.idle + dt;
      const sitting = cat.idle > 4 ? 1 : 0;
      cat.sit += (sitting - cat.sit) * Math.min(1, dt * (sitting ? 1.6 : 5));
      cat.sleepy += ((cat.idle > 30 ? 0.55 : 0) - cat.sleepy) * Math.min(1, dt * 0.5);

      // Head: leads into turns, glances round when idle, watches whatever
      // is interesting (a butterfly, a crab), and looks up to meow.
      let look = clamp(cat.turn * 0.12, -0.6, 0.6);
      if (cat.idle > 1) look += Math.sin(clock * 0.37) * Math.sin(clock * 0.13 + 1) * 0.8;
      let lookUp = 0;
      if (interest) {
        const ix = interest.x - cat.x;
        const iz = interest.z - cat.z;
        const d = Math.hypot(ix, iz);
        if (d < 5) {
          look = wrap(Math.atan2(ix, iz) - cat.heading);
          lookUp = clamp(Math.atan2(interest.y - cat.y - 0.3, d), -0.4, 0.8);
        }
      }
      cat.meowing = Math.max(0, cat.meowing - dt);
      if (cat.meowing > 0) lookUp += Math.sin((cat.meowing / 0.9) * Math.PI) * 0.35;
      cat.look += (look - cat.look) * Math.min(1, dt * 5);
      cat.lookUp += (lookUp - cat.lookUp) * Math.min(1, dt * 5);
      cat.tilt += ((cat.sit > 0.8 ? Math.sin(clock * 0.21) * 0.25 : 0) - cat.tilt) * Math.min(1, dt * 2);
      cat.swish += ((interest && interest.near ? 1 : input.rain ? 0.6 : 0) - cat.swish) * Math.min(1, dt * 1.5);

      updateCamera(cameraDt, want > 0.01);
      return cat;
    },
  };

  function home() {
    // Just up the beach below the original view, walking along the sand.
    const p = islandPoint(HOME_THETA, 3.2);
    cat.x = p.x;
    cat.z = p.z;
    cat.y = surface(p.x, p.z);
    cat.heading = HOME_THETA + Math.PI / 2 + 0.35;
    cat.speed = 0;
    cat.air = 0;
    cat.vy = 0;
    cat.idle = 0;
    cat.sit = 0;
    cat.swim = cat.wade = cat.water = 0;
    cat.waterY = -Infinity;
    cat.shake = 0;
    cat.shaken = true;
    last = null;
    target = null;
    camera.yaw = cat.heading;
    camera.elevation = CAMERA.elevation;
    camera.distance = CAMERA.distance;
    camera.targetY = cat.y;
    goal = free ? { yaw: camera.yaw, elevation: camera.elevation, distance: camera.distance, rate: 3.5 } : null;
    placeCamera(1);
  }

  function tryMove(nx, nz, drift = false) {
    if (!grid.clearOfTrunks(nx, nz, CAT_RADIUS)) return false;
    // Out past the kelp is too far for a cat.
    if (shoreDistance(nx, nz) < -SWIM_LIMIT) return false;
    const next = surface(nx, nz);
    // Rises are measured from where the cat is: afloat, a boulder's top
    // above the water needs a scramble.
    const rise = next - (cat.air > 0 || cat.swim > 0.5 ? cat.y : surface(cat.x, cat.z));
    if (drift && rise > 0.02) return false;
    const run = Math.hypot(nx - cat.x, nz - cat.z) || 1e-4;
    // Pebbles are stepped over; a boulder's steep flank needs a jump.
    const tall = next - groundHeight(nx, nz) > 0.12;
    if (cat.air > 0 ? rise > 0.02 : tall && rise > 0.003 && rise / run > 1.6) return false;
    if (!drift && !bodyClear(nx, nz, next - rise)) return false;
    // solid: walls, the tank, the stem and the milkwood's resting limbs.
    const bodyY = (cat.air > 0 ? Math.max(cat.y, next) : next) + 0.17;
    if (solids.touches(nx, bodyY, nz, CAT_RADIUS)) {
      const h = solids.hit;
      // Only a step that goes deeper into it: free to back away or slide
      // along (a step along a curved limb crept into it by the normal).
      if (h.d < solids.distance(cat.x, bodyY, cat.z, CAT_RADIUS + 0.5) - 1e-4) {
        wall.x = h.nx;
        wall.z = h.nz;
        wall.top = h.top;
        wall.at = clock;
        return false;
      }
    }
    cat.x = nx;
    cat.z = nz;
    return true;
  }

  // Whether the chest and shoulders fit at (x, z), paws at height `feet`.
  // A blocking rock is remembered as the wall to slide along and walk round.
  function bodyClear(x, z, feet) {
    const sin = Math.sin(cat.heading);
    const cos = Math.cos(cat.heading);
    const step = cat.air > 0 || cat.swim > 0.5 ? 0.03 : STEP_UP;
    for (const [f, s, d] of PROBES) {
      const px = x + sin * f + cos * s;
      const pz = z + cos * f - sin * s;
      const h = surface(px, pz);
      if (h <= feet + step + CLIMB * d) continue;
      // The rock's outward normal: from its centre, which turns smoothly
      // as the cat goes round (the height field's gradient is ragged at
      // the rim).
      // A wall, a hull or a log (a tile marked `gradient`): the way its
      // own surface falls away, round the probe.
      const dome = grid.domeAt(px, pz);
      let nx;
      let nz;
      if (dome?.gradient) {
        nx = nz = 0;
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
          const fall = h - Math.max(groundHeight(px + ca * 0.3, pz + sa * 0.3), tileHeight(dome.tile, px + ca * 0.3, pz + sa * 0.3));
          nx += ca * fall;
          nz += sa * fall;
        }
        // Its top here (a tile's highest point is the cottage roof, not
        // the wall in front of the cat).
        wall.top = h;
      } else if (dome) {
        nx = px - dome.x;
        nz = pz - dome.z;
        wall.top = dome.top;
      } else {
        const e = 0.1;
        nx = surface(px - e, pz) - surface(px + e, pz);
        nz = surface(px, pz - e) - surface(px, pz + e);
        wall.top = h;
      }
      const n = Math.hypot(nx, nz) || 1;
      wall.x = nx / n;
      wall.z = nz / n;
      wall.at = clock;
      return false;
    }
    return true;
  }

  // Walkable height: the ground mesh, the top of a boulder, or under the
  // sea the seabed the water pass draws (ocean.wgsl seabed_depth), which the
  // land mesh fades out above.
  function surface(x, z) {
    const h = base(x, z);
    // boat: its deck, where it floats.
    return ride ? Math.max(h, ride.deck(x, z)) : h;
  }

  function base(x, z) {
    let h = Math.max(groundHeight(x, z), grid.domeHeight(x, z));
    const inland = shoreDistance(x, z);
    if (inland < 0) h = Math.max(h, -seabedDepth(-inland, shoreAlong(x, z)));
    return h;
  }

  function waterAt(x, z, bed) {
    return sea ? sea.at(x, z, bed) : NO_WATER;
  }

  function updateCamera(dt, moving) {
    // boat: afloat, a lower, wider, calmer follow (boatCamera below).
    if (ride && ride.carries(cat) && !free && !goal) {
      boatCamera(dt);
      return;
    }
    if (goal) {
      const k = 1 - Math.exp(-dt * goal.rate);
      camera.yaw += wrap(goal.yaw - camera.yaw) * k;
      camera.elevation += (goal.elevation - camera.elevation) * k;
      camera.distance += (goal.distance - camera.distance) * k;
    }
    // Swing round behind the cat while it walks, unless the viewer is
    // steering the camera themselves.
    else if (moving && clock - lastDrag > 1.2) {
      const rate = 1.4 * Math.min(1, Math.abs(cat.speed) / WALK_SPEED);
      camera.yaw += wrap(cat.heading - camera.yaw) * Math.min(1, dt * rate);
    }
    placeCamera(Math.min(1, dt * 6));
  }

  function placeCamera(ease) {
    // Follow a softened height so hops and stepping stones don't jolt the view.
    camera.targetY += (cat.y - camera.targetY) * Math.min(1, ease * 0.6 + 0.02);
    const tx = cat.x;
    const tz = cat.z;
    const ty = camera.targetY + 0.26 * CAT_SCALE;
    const horizontal = Math.cos(camera.elevation) * camera.distance;
    // Spring arm: shorten the boom to just short of the first trunk, rock or
    // rise of ground between the cat and the camera. It pulls in quickly and
    // lets out slowly, so passing a tree doesn't make the view pump.
    const reach = armReach(tx, ty, tz, horizontal, Math.sin(camera.elevation) * camera.distance);
    camera.arm += (reach - camera.arm) * (reach < camera.arm ? Math.min(1, ease * 2.5) : ease * 0.35);
    if (ease >= 1) camera.arm = reach;
    let x = tx - Math.sin(camera.yaw) * horizontal * camera.arm;
    let z = tz - Math.cos(camera.yaw) * horizontal * camera.arm;
    camera.lift += (armLift - camera.lift) * (armLift > camera.lift ? Math.min(1, ease * 2.5) : ease * 0.35);
    if (ease >= 1) camera.lift = armLift;
    let y = ty + Math.sin(camera.elevation) * camera.distance * camera.arm + camera.lift * camera.arm;
    // Clear the ground (and boulders), and never dip toward the sea surface.
    const clearance = shoreDistance(x, z) > -1 ? surface(x, z) + 0.45 : 0.9;
    y = Math.max(y, clearance, 0.9);
    camera.x += (x - camera.x) * ease;
    camera.z += (z - camera.z) * ease;
    camera.y += (y - camera.y) * ease;
    // solid: the eased lens never ends up in a wall or a timber. Swinging
    // round or lifting over the ground can carry it into one between arm
    // updates; it is pulled in along the line to the cat, at once.
    if (solids.distance(camera.x, camera.y, camera.z, LENS_CLEARANCE) < LENS_GUARD) {
      const f = solids.trace(tx, ty, tz, camera.x, camera.y, camera.z, LENS_GUARD);
      if (f < 1) {
        camera.x = tx + (camera.x - tx) * f;
        camera.y = ty + (camera.y - ty) * f;
        camera.z = tz + (camera.z - tz) * f;
      }
      // Pulled right in to the cat's back: look down on it from above
      // instead, as far up as is clear.
      if (Math.hypot(camera.x - tx, camera.y - ty, camera.z - tz) < 0.7) {
        const bx = -Math.sin(camera.yaw) * 0.4, bz = -Math.cos(camera.yaw) * 0.4;
        const up = solids.trace(tx, ty, tz, tx + bx, ty + 1.6, tz + bz, LENS_GUARD);
        camera.x = tx + bx * up;
        camera.y = ty + 1.6 * up;
        camera.z = tz + bz * up;
      }
    }
    const dx = tx - camera.x;
    const dz = tz - camera.z;
    const heading = Math.atan2(dx, dz);
    camera.azimuth = heading - Math.PI / 4;
    camera.pitch = Math.atan2(ty - camera.y, Math.hypot(dx, dz)) + LOOK_LIFT;
  }

  // boat: the camera afloat. It frames the boat and the cat in it from
  // further back and lower, swings round behind the boat's heading slowly
  // (the viewer's drag wins for a while), follows a heavily softened heave
  // so the swell does not shake the view, and never dips toward the sea.
  function boatCamera(dt) {
    const v = ride.view;
    const k = Math.min(1, dt * 1.2);
    // Only once the bow has come round toward where the cat is steering:
    // swinging sooner would drag the steering round with it.
    if (clock - lastDrag > 2.5) {
      const rate = (0.45 + 0.5 * Math.min(1, Math.abs(v.speed) / 1.5)) * smooth(0.5, 0.95, v.align ?? 1);
      camera.yaw += wrap(v.heading - camera.yaw) * Math.min(1, dt * rate);
    }
    camera.distance += (clamp(camera.distance, BOAT_VIEW.min, BOAT_VIEW.max) - camera.distance) * k;
    camera.elevation += (clamp(camera.elevation, BOAT_VIEW.low, BOAT_VIEW.high) - camera.elevation) * k;
    camera.targetY += (v.y - camera.targetY) * Math.min(1, dt * 0.8);
    const ty = camera.targetY + 0.35;
    const horizontal = Math.cos(camera.elevation) * camera.distance;
    const x = v.x - Math.sin(camera.yaw) * horizontal;
    const z = v.z - Math.cos(camera.yaw) * horizontal;
    let y = ty + Math.sin(camera.elevation) * camera.distance;
    y = Math.max(y, shoreDistance(x, z) > -1 ? surface(x, z) + 0.6 : 1.1);
    const ease = Math.min(1, dt * 3);
    camera.x += (x - camera.x) * ease;
    camera.z += (z - camera.z) * ease;
    camera.y += (y - camera.y) * ease;
    camera.arm = 1;
    camera.lift = 0;
    const dx = v.x - camera.x;
    const dz = v.z - camera.z;
    camera.azimuth = Math.atan2(dx, dz) - Math.PI / 4;
    camera.pitch = Math.atan2(ty - camera.y, Math.hypot(dx, dz)) + LOOK_LIFT * 0.6;
  }

  // The unobstructed fraction (0…1) of the boom from the cat's head toward
  // the camera (`horizontal` back along −yaw, `rise` up). Trunks are
  // cylinders up to their crowns, padded by the lens's clearance; ground and boulders are
  // sampled along the boom. Never closer than ARM_MIN metres.
  function armReach(tx, ty, tz, horizontal, rise) {
    const bx = -Math.sin(camera.yaw) * horizontal;
    const bz = -Math.cos(camera.yaw) * horizontal;
    const length = Math.hypot(horizontal, rise) || 1;
    let t = 1;
    for (const trunk of grid.trunksNear(tx + bx / 2, tz + bz / 2, horizontal / 2 + 1)) {
      // Segment (tx, tz) + s·(bx, bz) against the padded circle.
      const r = trunk.r + ARM_CLEARANCE;
      const ox = tx - trunk.x;
      const oz = tz - trunk.z;
      const a = bx * bx + bz * bz;
      const b = ox * bx + oz * bz;
      const c = ox * ox + oz * oz - r * r;
      if (c < 0 || a < 1e-6) continue;
      const disc = b * b - a * c;
      if (disc < 0) continue;
      const s = (-b - Math.sqrt(disc)) / a;
      if (!(s > 0 && s < t)) continue;
      // A trunk only blocks below its crown: a high boom passes over the
      // branching (about 40% of the tree's height, from its girth; see
      // obstaclesFor in forest.js), and leaves there are only a veil.
      const crownBase = surface(trunk.x, trunk.z) + 0.4 * Math.max(1.5, (trunk.r - 0.02) / 0.034);
      if (ty + rise * s > crownBase) continue;
      t = s;
    }
    // Ground and boulders: the boom tilts up over a rise or a rock (lifting
    // the camera by `lift` raises the boom at s by lift·s) when a modest
    // lift clears it; otherwise it shortens to just before the obstacle.
    const steps = 14;
    let lift = 0;
    let blocked = -1;
    for (let i = 2; i <= steps; i++) {
      const s = (i / steps) * t;
      const px = tx + bx * s;
      const pz = tz + bz * s;
      if (shoreDistance(px, pz) < -1) break;
      const need = surface(px, pz) + 0.3 - (ty + rise * s);
      if (need <= 0) continue;
      if (blocked < 0) blocked = i;
      lift = Math.max(lift, need / s);
    }
    if (lift > ARM_LIFT) {
      t = ((blocked - 1) / steps) * t;
      lift = 0;
    }
    // solid: the landmarks. The boom (lifted as above) is sphere-traced
    // through their walls, towers, timbers and limbs; a low one (the yard
    // wall, the boat, a resting limb) is cleared by lifting further when a
    // modest lift does it, anything else stops the arm short of it.
    const boomTo = (lift2) => solids.trace(tx, ty, tz, tx + bx * t, ty + (rise + lift2) * t, tz + bz * t, LENS_CLEARANCE);
    let f = boomTo(lift);
    if (f < 1) {
      const prim = solids.hit.prim;
      const s = Math.max(f * t, 0.05);
      const over = prim && prim.k !== 3 ? (prim.y1 + LENS_CLEARANCE + 0.05 - (ty + rise * s)) / s : Infinity;
      if (over > lift && over < ARM_LIFT) {
        const f2 = boomTo(over);
        if (f2 > f) {
          f = f2;
          lift = over;
        }
      }
      // Still stopped close behind the cat (a hull or a wall at its back):
      // look down over it from higher up rather than from the cat's back.
      const base = lift;
      for (let k = 1; f * t * length < ARM_MIN * 1.6 && k <= 3; k++) {
        const f2 = boomTo(base + k * SOLID_RISE);
        if (f2 > f + 0.1) {
          f = f2;
          lift = base + k * SOLID_RISE;
        }
      }
      t *= f;
    }
    armLift = lift;
    return Math.max(t, Math.min(1, ARM_MIN / length));
  }
}

// solid: the ground and every boulder and landmark top on it, for things
// that must stay above them (fireflies.js); no walker needed.
export function surfaceOf(obstacles) {
  const grid = spatialGrid({ trunks: [], domes: obstacles.domes ?? [] });
  return (x, z) => Math.max(groundHeight(x, z), grid.domeHeight(x, z));
}

// The surface of one height tile (a boulder's dome, a landmark's tile) at
// (x, z), bilinear within its cells; −∞ off it. The one implementation:
// animal-forms.js and everything standing on rocks use it too.
export function tileHeight(d, x, z) {
  const u = (x - d.x0) / d.cell;
  const v = (z - d.z0) / d.cell;
  const i = Math.floor(u);
  const j = Math.floor(v);
  if (i < 0 || j < 0 || i >= d.nx - 1 || j >= d.nz - 1) return -Infinity;
  const h = d.heights;
  const k = j * d.nx + i;
  const h00 = h[k], h10 = h[k + 1], h01 = h[k + d.nx], h11 = h[k + d.nx + 1];
  const fu = u - i;
  const fv = v - j;
  if (h00 > -Infinity && h10 > -Infinity && h01 > -Infinity && h11 > -Infinity)
    return (h00 * (1 - fu) + h10 * fu) * (1 - fv) + (h01 * (1 - fu) + h11 * fu) * fv;
  return Math.max(h00, h10, h01, h11);
}

// Trunks and boulder domes bucketed in 4 m cells.
function spatialGrid({ trunks, domes }) {
  const cell = 4;
  const cells = new Map();
  const add = (kind, o, r) => {
    for (let i = Math.floor((o.x - r) / cell); i <= Math.floor((o.x + r) / cell); i++)
      for (let j = Math.floor((o.z - r) / cell); j <= Math.floor((o.z + r) / cell); j++) {
        const key = i * 4096 + j;
        if (!cells.has(key)) cells.set(key, { trunks: [], domes: [] });
        cells.get(key)[kind].push(o);
      }
  };
  for (const t of trunks) add("trunks", t, t.r + 0.3);
  // Each rock's own top, for how far up it is to hop.
  const tops = new Map(domes.map((d) => [d, d.heights.reduce((m, h) => Math.max(m, h), -Infinity)]));
  for (const d of domes) add("domes", d, d.r + 0.1);
  let found = null;
  const hit = { x: 0, z: 0, top: 0, gradient: false, tile: null };
  const at = (x, z) => cells.get(Math.floor(x / cell) * 4096 + Math.floor(z / cell));
  return {
    // Trunks within `radius` of (x, z) (whole cells; may include a few more).
    trunksNear(x, z, radius) {
      const out = new Set();
      for (let i = Math.floor((x - radius) / cell); i <= Math.floor((x + radius) / cell); i++)
        for (let j = Math.floor((z - radius) / cell); j <= Math.floor((z + radius) / cell); j++) {
          const c = cells.get(i * 4096 + j);
          if (c) for (const t of c.trunks) out.add(t);
        }
      return out;
    },
    clearOfTrunks(x, z, radius) {
      const c = at(x, z);
      if (!c) return true;
      for (const t of c.trunks) if (Math.hypot(x - t.x, z - t.z) < t.r + radius) return false;
      return true;
    },
    // The highest rock surface here (bilinear within each rock's tile).
    domeHeight(x, z) {
      const c = at(x, z);
      let best = -Infinity;
      found = null;
      if (!c) return best;
      for (const d of c.domes) {
        const y = tileHeight(d, x, z);
        if (y > best) {
          best = y;
          found = d;
        }
      }
      return best;
    },
    // The rock whose surface that is: { x, z (its centre), top, gradient,
    // and the tile itself } (one object, reused).
    domeAt(x, z) {
      if (this.domeHeight(x, z) === -Infinity) return null;
      hit.x = found.x;
      hit.z = found.z;
      hit.top = tops.get(found);
      hit.gradient = Boolean(found.gradient);
      hit.tile = found;
      return hit;
    },
  };
}

// How a paw print and a footstep sound: 0 rock, 1 wet sand, 2 dry sand,
// 3 dune scrub, 4 forest floor, 5 water.
export function surfaceKind(x, z, onRock, inWater = false) {
  if (inWater) return 5;
  if (onRock) return 0;
  const inland = shoreDistance(x, z);
  if (inland < 1.7) return 1;
  if (inland < 6) return 2;
  if (inland < 11) return 3;
  return 4;
}

const NO_WATER = { level: -Infinity, flowX: 0, flowZ: 0, breaking: 0 };

function lerp(a, b, t) {
  return a + (b - a) * t;
}
function clamp(v, a, b) {
  return Math.min(b, Math.max(a, v));
}
function wrap(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}
function smooth(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
