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
// Where the body meets solids: a sphere of CAT_RADIUS this far above the
// paws (chest height, from the leg).
const BODY_Y = STAND_HEIGHT * CAT_SCALE * 0.6;
const LOOK_LIFT = 0.13;
const HOME_THETA = Math.atan2(0 - ISLAND.z, 6 - ISLAND.x);
// The body, not just its centre, meets a rock: points along the chest to the
// chin and at the shoulders, [forward, right] in metres. A point may be
// higher than the paws by a step plus a climbable slope to it; any higher
// and the chest would be in the rock.
const PROBES = [[0.04, 0], [0.09, 0], [0.14, 0], [0.2, 0], [0.12, 0.05], [0.12, -0.05]].map(([f, s]) => [
  f * CAT_SCALE,
  s * CAT_SCALE,
  hyp(f, s) * CAT_SCALE,
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
const ARM_CLEARANCE = 0.6;
// The most the camera rises to see over a boulder before the arm shortens.
const ARM_LIFT = 1.6;
// How far the lens keeps from a wall, a tower or a timber (blockers.js),
// and the least it may come to one before it is pulled in along the boom.
const LENS_CLEARANCE = 0.4;
const LENS_GUARD = 0.18;
// Each step the boom may tilt up to see over a solid at the cat's back.
const SOLID_RISE = 1.1;
// The rig's springs (critically damped, rad/s): how quickly the view follows
// a drag or the swing behind the cat, a zoom, the pivot on the cat, and the
// arm drawing in for an obstacle (quick) or letting out past it (slow).
const RIG = { turn: 12, zoom: 8, pivot: 14, pivotY: 6, armIn: 9, armOut: 2.4, liftUp: 5, liftDown: 2, floor: 9, ease: 14 };
// The trunk clearance the lens must never come inside, whatever the springs.
const TRUNK_GUARD = 0.15;
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
  // The camera rig, in stages, each frame (updateCamera):
  //   1. aim: the boom the viewer and the follow want (yaw, elevation,
  //      distance). Drags, zooms, the swing behind the cat, photo mode, the
  //      ceremonies and the watch drift all move the aim, never the camera;
  //   2. the view: yaw, elevation and distance follow the aim on critically
  //      damped springs (camera.yaw etc. are these current values);
  //   3. the pivot: the cat's head, followed on springs (a step or a hop does
  //      not jolt the view);
  //   4. reach: the arm's length and lift that keep the lens clear of trunks,
  //      rocks, ground and landmarks (armReach), followed on springs that
  //      draw in quickly and let out slowly; vegetation is not solid (the
  //      plants near the lens and between it and the cat thin out in their
  //      shader instead);
  //   5. guards: the lens never inside a solid, a trunk or below the ground,
  //      whatever the springs did (instant, and rare);
  //   6. look: azimuth and pitch from the lens to the pivot.
  // Writing camera.yaw (or elevation, distance) from outside is a cut: the
  // rig jumps there (tests, review fixtures, QA scripts).
  const aim = { yaw: 0, elevation: CAMERA.elevation, distance: CAMERA.distance };
  const rig = {
    yaw: { x: 0, v: 0 }, elevation: { x: 0, v: 0 }, distance: { x: 0, v: 0 },
    px: { x: 0, v: 0 }, py: { x: 0, v: 0 }, pz: { x: 0, v: 0 },
    arm: { x: 1, v: 0 }, lift: { x: 0, v: 0 }, floor: { x: 0, v: 0 },
    // The reach and lift the arm springs toward, eased first (RIG.ease): an
    // obstacle entering the boom moves the goal in a step, and a spring
    // driven by a step starts with a jolt (its acceleration jumps); eased,
    // the lens's acceleration stays continuous too.
    reach: 1, lift2: 0,
    // How far the look has turned toward `look` (0…1), and its last point.
    look: { x: 0, v: 0 }, lookAt: null,
    // How far up (0…1 of 1.6 m) the look-down-from-above view is clear.
    up: 1,
    // What the rig last wrote to camera.yaw, elevation, distance, targetY.
    wrote: [NaN, NaN, NaN, NaN],
  };
  let target = null;
  // Running state kept in one object, not closure variables: a closure's
  // number is re-boxed on every write (an allocation a frame each).
  const rt = { blocked: 0, armLift: 0, lastDrag: -10, clock: 0, escape: 0, escapeUntil: -1 };
  // Where the aim is easing to when it is not simply following: the slow
  // drift of sitting to watch the sky. { yaw, elevation, distance, rate }
  let goal = null;
  let free = false;
  // A point the view turns partly toward ({ x, y, z, share }), or null.
  let look = null;
  let last = null;
  const lastWater = { level: -Infinity, flowX: 0, flowZ: 0, breaking: 0 };
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
      rt.blocked = 0;
    },
    meow() {
      cat.meowing = 0.9;
      cat.idle = Math.min(cat.idle, 2);
    },
    // The viewer turns the aim; the view follows it on its springs, so a
    // drag's uneven pointer steps and a wheel's notches come out smooth.
    orbit(dx, dy) {
      goal = null;
      aim.yaw += dx;
      aim.elevation = free ? clamp(aim.elevation + dy, FREE.low, FREE.high) : clamp(aim.elevation + dy, 0.06, 1.2);
      if (!free) rt.lastDrag = rt.clock;
    },
    zoom(factor) {
      if (free) {
        aim.distance = clamp(aim.distance * factor, FREE.min, FREE.max);
        return;
      }
      // boat: afloat it may draw further back.
      const afloat = ride && ride.carries(cat);
      aim.distance = clamp(aim.distance * factor, afloat ? BOAT_VIEW.min : CAMERA.min, afloat ? BOAT_VIEW.max : CAMERA.max);
    },
    // Photo mode (and the ceremonies): orbit and zoom range wider; off
    // again, the aim comes back inside the follow camera's range and the
    // view eases there from wherever it was.
    freeCamera(on) {
      free = Boolean(on);
      goal = null;
      if (!free) {
        aim.elevation = clamp(aim.elevation, 0.06, 1.2);
        aim.distance = clamp(aim.distance, CAMERA.min, CAMERA.max);
        rt.lastDrag = rt.clock;
      }
    },
    // Turn the view partly (`share` 0…1) toward a point (coast x, y, z),
    // keeping the cat in the frame; null turns back to the cat.
    lookAt(point, share = 0.5) {
      look = point ? { x: point.x, y: point.y, z: point.z, share } : null;
    },
    // A clear shot of `subject` ({ x, z, y0, y1 }: its foot and top) past
    // the cat: the boom (yaw, elevation, distance) near the one asked for
    // whose lens is clear of rock, trunks, solids and plant crowns
    // (`canopies`: [{ x, y, z, r }]), that sees the subject's foot, middle
    // and top past them, and fits the cat and the top in the frame
    // (`fov`, vertical, radians). Returns { yaw, elevation, distance,
    // look: { x, y, z } (where to turn the view), score (0 clean) }.
    frameShot({ subject, yaw, elevation, distance, canopies = [], fov = 1.0 }) {
      return frameShot(subject, yaw, elevation, distance, canopies, fov);
    },
    // Sitting to watch: drift slowly to frame `view` ({ yaw, elevation,
    // distance }), or null to stop wherever it has got to.
    watch(view) {
      if (free) return;
      goal = view ? { yaw: aim.yaw + wrap(view.yaw - aim.yaw), elevation: view.elevation, distance: view.distance, rate: 0.11 } : null;
      if (!view) rt.lastDrag = rt.clock;
    },
    // input: move [right, forward] in camera terms (−1…1), run, jump (edge).
    // cameraDt is the camera's own clock: it keeps easing while time is
    // paused for a photo.
    update(dt, input, interest, cameraDt = dt) {
      rt.clock += dt;
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
      let want = Math.min(1, hyp(dirX, dirZ));
      let run = input.run;
      if (target) {
        const tx = target.x - cat.x;
        const tz = target.z - cat.z;
        const d = hyp(tx, tz);
        if (d < 0.18 || rt.blocked > 0.8) target = null;
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
      if (want > 0.01 && rt.clock - wall.at < 0.3) {
        const len = hyp(dirX, dirZ);
        const wx = dirX / len;
        const wz = dirZ / len;
        const into = wx * wall.x + wz * wall.z;
        if (into < 0) {
          let tx = wx - wall.x * into;
          let tz = wz - wall.z * into;
          const across = hyp(tx, tz);
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
            const t = hyp(tx, tz);
            dirX = tx / t;
            dirZ = tz / t;
          }
        } else wall.headOn = 0;
      }
      // Never pinned: held against something for a third of a second (a
      // trunk dead ahead, a pocket between boulders, a keel), the cat looks
      // for the nearest way that is open, either side of where it wants to
      // go, and heads that way for a moment; with none open, it hops.
      if (want > 0.01 && rt.blocked > 0.35 && cat.air === 0 && cat.swim < 0.5) {
        const base = Math.atan2(dirX, dirZ);
        let found = NaN;
        for (let k = 1; k <= 8 && found !== found; k++)
          for (let side = 0; side < 2; side++) {
            const a = base + (side ? -wall.side : wall.side) * k * (Math.PI / 8);
            if (canStep(a, Math.max(0.005, WALK_SPEED * 0.6 * dt)) && canStep(a, 0.08)) {
              found = a;
              break;
            }
          }
        if (found === found) {
          rt.escape = found;
          rt.escapeUntil = rt.clock + 0.7;
          wall.side = Math.sign(wrap(found - base)) || wall.side;
        } else hop = true;
        rt.blocked = 0;
      }
      if (rt.clock < rt.escapeUntil && want > 0.01) {
        dirX = Math.sin(rt.escape);
        dirZ = Math.cos(rt.escape);
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
      if (!moved && rt.clock === wall.at) {
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
      // Getting out of a pin: the cat steps the open way while it is still
      // turning to face it (a sidestep), at a walk.
      if (!moved && rt.clock < rt.escapeUntil && cat.air === 0) {
        const heading = cat.heading;
        const d = Math.max(Math.abs(step), WALK_SPEED * 0.6 * dt);
        cat.heading = rt.escape;
        moved = tryMove(cat.x + Math.sin(rt.escape) * d, cat.z + Math.cos(rt.escape) * d);
        cat.heading = heading;
        if (moved) cat.speed = Math.max(cat.speed, WALK_SPEED * 0.6);
      }
      if (!moved && Math.abs(step) > 1e-4) {
        rt.blocked += dt;
        // In the air, momentum carries on once the body clears the rim.
        if (cat.air === 0) cat.speed *= 0.5;
      } else rt.blocked = 0;
      // The swell carries a floating cat back and forth (and the broken
      // bores carry it in); it surges round wading legs.
      if (cat.water > 0.02 && cat.air === 0 && last) {
        const push = (cat.swim + (1 - cat.swim) * 0.3 * cat.wade) * dt;
        tryMove(cat.x + last.flowX * push, cat.z + last.flowZ * push, true);
      }

      // Water: the level here, and its slope for the body to roll with.
      const bed = surface(cat.x, cat.z);
      // (sea.at reuses one result object: copy it before sampling again.)
      const water = (last = Object.assign(lastWater, waterAt(cat.x, cat.z, bed)));
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
        // solid: a leap stops under a limb or a seal, not inside it (but
        // one that starts against a solid, out of a hull, goes on).
        const rising = cat.vy > 0 && !solids.touches(cat.x, cat.y + BODY_Y, cat.z, CAT_RADIUS);
        cat.y += cat.vy * dt;
        if (rising && solids.touches(cat.x, cat.y + BODY_Y, cat.z, CAT_RADIUS)) {
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
      if (cat.idle > 1) look += Math.sin(rt.clock * 0.37) * Math.sin(rt.clock * 0.13 + 1) * 0.8;
      let lookUp = 0;
      if (interest) {
        const ix = interest.x - cat.x;
        const iz = interest.z - cat.z;
        const d = hyp(ix, iz);
        if (d < 5) {
          look = wrap(Math.atan2(ix, iz) - cat.heading);
          lookUp = clamp(Math.atan2(interest.y - cat.y - 0.3, d), -0.4, 0.8);
        }
      }
      cat.meowing = Math.max(0, cat.meowing - dt);
      if (cat.meowing > 0) lookUp += Math.sin((cat.meowing / 0.9) * Math.PI) * 0.35;
      cat.look += (look - cat.look) * Math.min(1, dt * 5);
      cat.lookUp += (lookUp - cat.lookUp) * Math.min(1, dt * 5);
      cat.tilt += ((cat.sit > 0.8 ? Math.sin(rt.clock * 0.21) * 0.25 : 0) - cat.tilt) * Math.min(1, dt * 2);
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
    goal = null;
    cut();
    placeCamera(0);
  }

  function tryMove(nx, nz, drift = false) {
    // A trunk is a wall like any other: remember its face (outward from its
    // centre), so the cat slides along it and walks round it instead of
    // snagging on it. A step out of a trunk the cat is already inside (a
    // teleport, a landing) is always free.
    if (!grid.clearOfTrunks(nx, nz, CAT_RADIUS)) {
      const t = grid.trunk;
      const away = hyp(nx - t.x, nz - t.z);
      if (!(away > hyp(cat.x - t.x, cat.z - t.z) && hyp(cat.x - t.x, cat.z - t.z) < t.r + CAT_RADIUS)) {
        wall.x = away > 1e-6 ? (nx - t.x) / away : -Math.sin(cat.heading);
        wall.z = away > 1e-6 ? (nz - t.z) / away : -Math.cos(cat.heading);
        wall.top = Infinity;
        wall.at = rt.clock;
        return false;
      }
    }
    // Out past the kelp is too far for a cat.
    if (shoreDistance(nx, nz) < -SWIM_LIMIT) return false;
    const next = surface(nx, nz);
    // Rises are measured from where the cat is: afloat, a boulder's top
    // above the water needs a scramble.
    const rise = next - (cat.air > 0 || cat.swim > 0.5 ? cat.y : surface(cat.x, cat.z));
    if (drift && rise > 0.02) return false;
    const run = hyp(nx - cat.x, nz - cat.z) || 1e-4;
    // Pebbles are stepped over; a boulder's steep flank needs a jump.
    const tall = next - groundHeight(nx, nz) > 0.12;
    // (The slope over at least 6 cm: a rock tile is bilinear in 6 cm cells,
    // so over a slow step's millimetres its facets read as walls; a cat
    // pinned on a boulder top could not creep off it that way.)
    let climb = rise / run;
    if (cat.air === 0 && run < 0.06 && tall && rise > 0.003) {
      const k = 0.06 / run;
      climb = (surface(cat.x + (nx - cat.x) * k, cat.z + (nz - cat.z) * k) - (next - rise)) / 0.06;
    }
    if (cat.air > 0 ? rise > 0.02 : tall && rise > 0.003 && climb > 1.6) return false;
    if (!drift && !bodyClear(nx, nz, next - rise)) return false;
    // solid: walls, the tank, the stem and the milkwood's resting limbs.
    const bodyY = (cat.air > 0 ? Math.max(cat.y, next) : next) + BODY_Y;
    if (solids.touches(nx, bodyY, nz, CAT_RADIUS)) {
      const h = solids.hit;
      // Only a step that goes deeper into it: free to back away or slide
      // along (a step along a curved limb crept into it by the normal).
      if (h.d < solids.distance(cat.x, bodyY, cat.z, CAT_RADIUS + 0.5) - 1e-4) {
        wall.x = h.nx;
        wall.z = h.nz;
        wall.top = h.top;
        wall.at = rt.clock;
        return false;
      }
    }
    cat.x = nx;
    cat.z = nz;
    return true;
  }

  // Whether a step of `d` metres heading `a` is open (tryMove's rules),
  // moving nothing.
  function canStep(a, d) {
    const x = cat.x, z = cat.z, heading = cat.heading;
    const wx = wall.x, wz = wall.z, wt = wall.top, wa = wall.at;
    cat.heading = a;
    const ok = tryMove(x + Math.sin(a) * d, z + Math.cos(a) * d);
    cat.x = x;
    cat.z = z;
    cat.heading = heading;
    wall.x = wx; wall.z = wz; wall.top = wt; wall.at = wa;
    return ok;
  }

  // Whether the chest and shoulders fit at (x, z), paws at height `feet`.
  // A blocking rock is remembered as the wall to slide along and walk round.
  function bodyClear(x, z, feet) {
    const sin = Math.sin(cat.heading);
    const cos = Math.cos(cat.heading);
    const step = cat.air > 0 || cat.swim > 0.5 ? 0.03 : STEP_UP;
    for (let k = 0; k < PROBES.length; k++) {
      const probe = PROBES[k], f = probe[0], s = probe[1], d = probe[2];
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
      const n = hyp(nx, nz) || 1;
      wall.x = nx / n;
      wall.z = nz / n;
      wall.at = rt.clock;
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

  // The rig jumps to where camera.yaw, elevation, distance and targetY say
  // and the cat is: no springing from wherever it was.
  function cut() {
    aim.yaw = camera.yaw;
    aim.elevation = camera.elevation;
    aim.distance = camera.distance;
    settle(rig.yaw, camera.yaw);
    settle(rig.elevation, camera.elevation);
    settle(rig.distance, camera.distance);
    settle(rig.px, cat.x);
    settle(rig.pz, cat.z);
    settle(rig.py, camera.targetY);
    rig.arm.v = rig.lift.v = rig.floor.v = 0;
    rig.arm.x = -1; // (arm, lift and floor placed at once on the next placeCamera)
    rig.up = 1;
  }

  function updateCamera(dt, moving) {
    // A write from outside (a test, a review fixture, a QA script) is a cut.
    if (camera.yaw !== rig.wrote[0] || camera.elevation !== rig.wrote[1] || camera.distance !== rig.wrote[2] || camera.targetY !== rig.wrote[3]) cut();
    const afloat = ride && ride.carries(cat) && !free && !goal;
    // 1. Aim.
    if (goal) {
      const k = 1 - Math.exp(-dt * goal.rate);
      aim.yaw += wrap(goal.yaw - aim.yaw) * k;
      aim.elevation += (goal.elevation - aim.elevation) * k;
      aim.distance += (goal.distance - aim.distance) * k;
    } else if (afloat) {
      // boat: swing round behind the boat's heading slowly (the viewer's
      // drag wins for a while), only once the bow has come round toward
      // where the cat is steering: sooner would drag the steering with it.
      const v = ride.view;
      if (rt.clock - rt.lastDrag > 2.5) {
        const rate = (0.45 + 0.5 * Math.min(1, Math.abs(v.speed) / 1.5)) * smooth(0.5, 0.95, v.align ?? 1);
        aim.yaw += wrap(v.heading - aim.yaw) * Math.min(1, dt * rate);
      }
      aim.distance = clamp(aim.distance, BOAT_VIEW.min, BOAT_VIEW.max);
      aim.elevation = clamp(aim.elevation, BOAT_VIEW.low, BOAT_VIEW.high);
    } else {
      if (!free && (aim.distance > CAMERA.max || aim.distance < CAMERA.min)) aim.distance = clamp(aim.distance, CAMERA.min, CAMERA.max);
      // Swing round behind the cat while it walks, unless the viewer is
      // steering the camera themselves.
      if (moving && !free && rt.clock - rt.lastDrag > 1.2) {
        const rate = 1.4 * Math.min(1, Math.abs(cat.speed) / WALK_SPEED);
        aim.yaw += wrap(cat.heading - aim.yaw) * Math.min(1, dt * rate);
      }
    }
    // 2. The view follows the aim (afloat, more calmly).
    const calm = afloat ? 0.5 : 1;
    camera.yaw = spring(rig.yaw, rig.yaw.x + wrap(aim.yaw - rig.yaw.x), RIG.turn * calm, dt);
    camera.elevation = spring(rig.elevation, aim.elevation, RIG.turn * calm, dt);
    camera.distance = spring(rig.distance, aim.distance, RIG.zoom * calm, dt);
    // Keep the aim's yaw beside the view's (both unwrapped), so a long
    // orbit never makes the spring take the long way round.
    aim.yaw = camera.yaw + wrap(aim.yaw - camera.yaw);
    placeCamera(dt, afloat);
  }

  // Stages 3–6 (see the rig above). dt 0 places everything at once.
  function placeCamera(dt, afloat = false) {
    const v = afloat ? ride.view : null;
    // 3. Pivot: the cat's head (afloat, the boat, its heave heavily
    // softened so the swell does not shake the view). A jump of metres
    // (home, a teleport) is a cut.
    const cx = afloat ? v.x : cat.x;
    const cz = afloat ? v.z : cat.z;
    const cy = afloat ? v.y : cat.y;
    if (dt === 0 || hyp(cx - rig.px.x, cz - rig.pz.x) > 3) {
      settle(rig.px, cx);
      settle(rig.pz, cz);
      if (dt === 0) settle(rig.py, cy);
    }
    const tx = spring(rig.px, cx, afloat ? RIG.pivot * 0.3 : RIG.pivot, dt);
    const tz = spring(rig.pz, cz, afloat ? RIG.pivot * 0.3 : RIG.pivot, dt);
    camera.targetY = spring(rig.py, cy, afloat ? 1.2 : RIG.pivotY, dt);
    const ty = camera.targetY + (afloat ? 0.35 : 0.26 * CAT_SCALE);
    const horizontal = Math.cos(camera.elevation) * camera.distance;
    const rise = Math.sin(camera.elevation) * camera.distance;
    const sin = Math.sin(camera.yaw);
    const cos = Math.cos(camera.yaw);
    // 4. Reach: afloat the open sea needs none.
    const reach = afloat ? 1 : armReach(tx, ty, tz, horizontal, rise);
    const lift = afloat ? 0 : rt.armLift;
    const placing = dt === 0 || rig.arm.x < 0;
    if (placing) {
      settle(rig.arm, reach);
      settle(rig.lift, lift);
      rig.reach = reach;
      rig.lift2 = lift;
    }
    const ease = 1 - Math.exp(-RIG.ease * dt);
    rig.reach += (reach - rig.reach) * ease;
    rig.lift2 += (lift - rig.lift2) * ease;
    let arm = spring(rig.arm, rig.reach, rig.reach < rig.arm.x ? RIG.armIn : RIG.armOut, dt);
    const lifted = spring(rig.lift, rig.lift2, rig.lift2 > rig.lift.x ? RIG.liftUp : RIG.liftDown, dt);
    let x = tx - sin * horizontal * arm;
    let z = tz - cos * horizontal * arm;
    let y = ty + rise * arm + lifted * arm;
    // 5. Guards. A trunk the springs have not yet cleared (the boom swung
    // round onto it faster than the arm draws in): the lens slides round
    // its bark instead of entering it. Pushed straight out, it moves on
    // smoothly round the trunk; shortening the arm here was a jump.
    if (!afloat) {
      const n = grid.trunksNear(x, z, 1);
      for (let i = 0; i < n; i++) {
        const t = grid.found[i];
        const r = t.r + TRUNK_GUARD;
        const dx = x - t.x, dz = z - t.z;
        const d = hyp(dx, dz);
        if (d >= r + 0.3 || y > trunkTop(t)) continue;
        // (Eased onto the guard radius, so the lens's path bends round
        // the bark instead of kinking.)
        const k = d > 1e-6 ? softMax(d, r, 0.3) / d : 1;
        x = t.x + (d > 1e-6 ? dx : -sin * r) * k;
        z = t.z + (d > 1e-6 ? dz : -cos * r) * k;
      }
    }
    // The ground (and boulders) below the lens: a floor that follows the
    // ground under the lens on a spring (so bumps do not jog it), and a
    // harder one close to the ground; never toward the sea surface.
    const ground = lensGround(x, z);
    const floorAt = ground > -Infinity ? ground + (afloat ? 0.6 : 0.45) : afloat ? 1.1 : 0.9;
    if (placing) settle(rig.floor, floorAt);
    const floor = spring(rig.floor, floorAt, RIG.floor, dt);
    // (A soft max: the lens settles onto the floor and lifts off it without
    // a kink in its path.)
    y = Math.max(softMax(y, floor, 0.25), ground + 0.25, 0.9);
    camera.x = x;
    camera.y = y;
    camera.z = z;
    // solid: the lens never ends up in a wall or a timber. The springs can
    // carry it into one for a moment; it is pulled in along the line to
    // the cat, at once. (The springs keep their state: the pull eases off
    // by itself as the unguarded lens comes clear, so it never steps;
    // shortening the arm itself here left it stuck at the cat's back.)
    if (solids.distance(camera.x, camera.y, camera.z, LENS_CLEARANCE) < LENS_GUARD) pullClear(tx, ty, tz);
    // Pulled right in to the cat's back: look down on it from above
    // instead, as far up as is clear, blending in as the boom shortens
    // (a switch here flicked between the two views frame to frame).
    const near = Math.hypot(camera.x - tx, camera.y - ty, camera.z - tz);
    const over = smooth(0.95, 0.55, near);
    if (over > 0) {
      const bx = -sin * 0.4, bz = -cos * 0.4;
      // (How far up is clear, eased: a limb passing over the cat would
      // otherwise drop the lens in one frame; the guard below still holds.)
      const upClear = solids.trace(tx, ty, tz, tx + bx, ty + 1.6, tz + bz, LENS_GUARD);
      rig.up += (upClear - rig.up) * (upClear < rig.up ? 1 - Math.exp(-dt * 10) : 1 - Math.exp(-dt * 3));
      const up = Math.min(rig.up, upClear + 0.3);
      camera.x += (tx + bx * up - camera.x) * over;
      camera.y += (ty + 1.6 * up - camera.y) * over;
      camera.z += (tz + bz * up - camera.z) * over;
      if (solids.distance(camera.x, camera.y, camera.z, LENS_CLEARANCE) < LENS_GUARD * 0.5) pullClear(tx, ty, tz);
    }
    camera.arm = rig.arm.x;
    camera.lift = rig.lift.x;
    // 6. Look at the pivot, or (a ceremony) between it and the subject,
    // so both are in the frame (`look`, eased in and out on a spring).
    const dx = tx - camera.x;
    const dz = tz - camera.z;
    let azimuth = Math.atan2(dx, dz);
    let pitch = Math.atan2(ty - camera.y, hyp(dx, dz)) + LOOK_LIFT * (afloat ? 0.6 : 1);
    const share = spring(rig.look, look ? look.share : 0, 3, dt);
    if (look) rig.lookAt = look;
    if (share > 1e-4 && rig.lookAt) {
      const p = rig.lookAt;
      const lx = p.x - camera.x, lz = p.z - camera.z;
      azimuth += wrap(Math.atan2(lx, lz) - azimuth) * share;
      pitch += (Math.atan2(p.y - camera.y, hyp(lx, lz)) - pitch) * share;
    }
    camera.azimuth = azimuth - Math.PI / 4;
    camera.pitch = pitch;
    rig.wrote[0] = camera.yaw;
    rig.wrote[1] = camera.elevation;
    rig.wrote[2] = camera.distance;
    rig.wrote[3] = camera.targetY;
  }

  // What the lens must stay above at (x, z): the land and its rocks
  // ashore; at sea, only a moored or drifting hull (its deck raised to the
  // gunwale), never the sea surface (−∞).
  function lensGround(x, z) {
    if (shoreDistance(x, z) > -1) return surface(x, z);
    if (!ride) return -Infinity;
    const deck = ride.deck(x, z);
    return deck > -Infinity ? deck + 0.5 : -Infinity;
  }

  // The lens drawn in along the line to the pivot until it is clear of the
  // landmarks' solids.
  function pullClear(tx, ty, tz) {
    const f = solids.trace(tx, ty, tz, camera.x, camera.y, camera.z, LENS_GUARD);
    if (f >= 1) return;
    camera.x = tx + (camera.x - tx) * f;
    camera.y = ty + (camera.y - ty) * f;
    camera.z = tz + (camera.z - tz) * f;
  }

  // The ceremony framing search (see the API's frameShot). Pure: reads
  // the world, moves nothing.
  function frameShot(subject, yaw0, el0, dist0, canopies, fov) {
    const tx = cat.x, tz = cat.z, ty = cat.y + 0.26 * CAT_SCALE;
    const near = canopies.filter((c) => Math.abs(c.x - tx) < dist0 + 30 + c.r && Math.abs(c.z - tz) < dist0 + 30 + c.r);
    const sy0 = subject.y0, sy1 = subject.y1;
    const points = [
      { x: subject.x, y: sy0 + Math.min(0.4, (sy1 - sy0) * 0.2), z: subject.z },
      { x: subject.x, y: (sy0 + sy1) / 2, z: subject.z },
      { x: subject.x, y: sy1, z: subject.z },
    ];
    // How many crowns a segment passes through (each counted once).
    const crowns = (ax, ay, az, bx, by, bz) => {
      let n = 0;
      const ex = bx - ax, ey = by - ay, ez = bz - az;
      const ll = ex * ex + ey * ey + ez * ez || 1;
      for (const c of near) {
        const t = clamp(((c.x - ax) * ex + (c.y - ay) * ey + (c.z - az) * ez) / ll, 0, 1);
        const qx = ax + ex * t - c.x, qy = ay + ey * t - c.y, qz = az + ez * t - c.z;
        if (qx * qx + qy * qy + qz * qz < c.r * c.r * 0.8) n++;
      }
      return n;
    };
    // How much of a sight line the land, the landmarks and the trunks hide.
    const blocked = (ax, ay, az, bx, by, bz) => {
      let cost = 0;
      for (let i = 1; i < 12; i++) {
        const t = i / 12;
        const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
        if (ay + (by - ay) * t < lensGround(x, z) + 0.05) { cost += 2; break; }
      }
      // (The subject's own solids may end the line, within its radius.)
      const f = solids.trace(ax, ay, az, bx, by, bz, 0.05);
      if (f < 0.999 && hyp(ax + (bx - ax) * f - subject.x, az + (bz - az) * f - subject.z) > (subject.r ?? 1)) cost += 2;
      const n = grid.trunksNear((ax + bx) / 2, (az + bz) / 2, hyp(bx - ax, bz - az) / 2 + 1);
      for (let i = 0; i < n; i++) {
        const tr = grid.found[i];
        const ex = bx - ax, ez = bz - az;
        const ll = ex * ex + ez * ez || 1;
        const t = clamp(((tr.x - ax) * ex + (tr.z - az) * ez) / ll, 0.02, 0.98);
        const qx = ax + ex * t - tr.x, qz = az + ez * t - tr.z;
        if (qx * qx + qz * qz < tr.r * tr.r * 1.2 && ay + (by - ay) * t < trunkTop(tr)) { cost += 1.5; break; }
      }
      return cost + Math.min(3, crowns(ax, ay, az, bx, by, bz)) * 0.6;
    };
    let best = null;
    for (const dy of [0, 0.3, -0.3, 0.6, -0.6, 0.95, -0.95, 1.4, -1.4])
      for (const de of [0, 0.12, 0.26, -0.06])
        for (const kd of [1, 0.75, 1.3, 0.55]) {
          const yaw = yaw0 + dy;
          const elevation = clamp(el0 + de, 0.04, 1.1);
          const distance = clamp(dist0 * kd, 2.5, FREE.max);
          const horizontal = Math.cos(elevation) * distance;
          const rise = Math.sin(elevation) * distance;
          const reach = armReach(tx, ty, tz, horizontal, rise, yaw);
          const lift = rt.armLift;
          const lx = tx - Math.sin(yaw) * horizontal * reach;
          const lz = tz - Math.cos(yaw) * horizontal * reach;
          const ground = lensGround(lx, lz);
          const ly = Math.max(ty + (rise + lift) * reach, ground + 0.45, 0.9);
          let score = Math.abs(dy) * 0.8 + Math.abs(de) * 1.5 + Math.abs(Math.log(kd)) * 0.8;
          score += (1 - reach) * 4;
          // The lens in a crown, beside a trunk, in a solid.
          for (const c of near) {
            const d = hyp(hyp(lx - c.x, lz - c.z), ly - c.y);
            if (d < c.r) score += 2 + (1 - d / c.r) * 2;
          }
          const n = grid.trunksNear(lx, lz, 1);
          for (let i = 0; i < n; i++) if (hyp(lx - grid.found[i].x, lz - grid.found[i].z) < grid.found[i].r + 0.5 && ly < trunkTop(grid.found[i])) score += 2;
          if (solids.distance(lx, ly, lz, 1) < 0.5) score += 3;
          // The subject seen past everything (its top counts most).
          for (let i = 0; i < points.length; i++) score += blocked(lx, ly, lz, points[i].x, points[i].y, points[i].z) * (i === 2 ? 1.2 : 0.8);
          // The cat seen too (plants on that line fold away; not trunks or rock).
          score += (blocked(lx, ly, lz, tx, ty, tz) - Math.min(3, crowns(lx, ly, lz, tx, ty, tz)) * 0.6) * 1.5;
          // Cat and top both in the frame: the angle between them, from the lens.
          const top = points[2];
          const toCat = Math.atan2(ty - 0.15 - ly, hyp(tx - lx, tz - lz));
          const toTop = Math.atan2(top.y - ly, hyp(top.x - lx, top.z - lz));
          const span = Math.abs(toTop - toCat);
          if (span > fov * 0.8) score += (span - fov * 0.8) * 6;
          const across = Math.abs(wrap(Math.atan2(top.x - lx, top.z - lz) - Math.atan2(tx - lx, tz - lz)));
          if (across > fov * 0.6) score += (across - fov * 0.6) * 6;
          if (!best || score < best.score) best = { yaw, elevation, distance, score, lens: { x: lx, y: ly, z: lz } };
        }
    // Turn the view to the middle of the cat and the subject's top (by
    // angle), so both sit in the frame.
    // (The bisector of the directions from the lens to the cat and to the
    // subject's top: a midpoint in space put a near cat out of the bottom
    // of the frame, and aiming two-thirds up left the lighthouse's lantern
    // above it; the search keeps their span inside the frame.)
    const L = best.lens;
    const fx = subject.x, fy = sy1, fz = subject.z;
    const dc = hyp(hyp(tx - L.x, tz - L.z), ty - 0.1 - L.y) || 1;
    const ds = hyp(hyp(fx - L.x, fz - L.z), fy - L.y) || 1;
    const ux = (tx - L.x) / dc + (fx - L.x) / ds, uy = (ty - 0.1 - L.y) / dc + (fy - L.y) / ds, uz = (tz - L.z) / dc + (fz - L.z) / ds;
    const u = hyp(hyp(ux, uz), uy) || 1;
    best.look = { x: L.x + (ux / u) * 20, y: L.y + (uy / u) * 20, z: L.z + (uz / u) * 20 };
    return best;
  }

  // How high a trunk stands as a solid: the stem carries on up into the
  // crown, to about 80% of the tree's height (from its girth; see
  // obstaclesFor in forest.js); above it, only leaves and twigs, which
  // fold out of the view (forest.js FOLD_GLSL). Cached on the trunk.
  function trunkTop(t) {
    if (t.top === undefined) t.top = groundHeight(t.x, t.z) + 0.8 * Math.max(1.5, (t.r - 0.02) / 0.034);
    return t.top;
  }

  // The unobstructed fraction (≤ t) of the boom (bx, bz back, `rise` up)
  // from (tx, ty, tz) past the trunks, each padded by `clearance`, up to
  // their tops (trunkTop).
  function trunkReach(tx, ty, tz, bx, bz, rise, clearance, t) {
    const n = grid.trunksNear(tx + bx / 2, tz + bz / 2, hyp(bx, bz) / 2 + 1);
    for (let i = 0; i < n; i++) {
      const trunk = grid.found[i];
      // Segment (tx, tz) + s·(bx, bz) against the padded circle.
      const r = trunk.r + clearance;
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
      if (ty + rise * s > trunkTop(trunk)) continue;
      t = s;
    }
    return t;
  }

  // The unobstructed fraction (0…1) of the boom from the cat's head toward
  // the camera (`horizontal` back along −yaw, `rise` up). Trunks are
  // cylinders up to their crowns, padded by the lens's clearance; ground and boulders are
  // sampled along the boom. Never closer than ARM_MIN metres.
  function armReach(tx, ty, tz, horizontal, rise, yaw = camera.yaw) {
    const bx = -Math.sin(yaw) * horizontal;
    const bz = -Math.cos(yaw) * horizontal;
    const length = hyp(horizontal, rise) || 1;
    let t = trunkReach(tx, ty, tz, bx, bz, rise, ARM_CLEARANCE, 1);
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
      const under = lensGround(px, pz);
      if (under === -Infinity) continue;
      const need = under + 0.3 - (ty + rise * s);
      if (need <= 0) continue;
      if (blocked < 0) blocked = i;
      lift = Math.max(lift, need / s);
    }
    if (lift > ARM_LIFT) {
      t = ((blocked - 1) / steps) * t;
      lift = 0;
    }
    // Trunks and ground never draw the lens closer than ARM_MIN (it lifts
    // over them instead); a landmark may, and then the lens rises to look
    // down from above the cat (placeCamera).
    t = Math.max(t, Math.min(1, ARM_MIN / length));
    // solid: the landmarks. The boom (lifted as above) is sphere-traced
    // through their walls, towers, timbers and limbs; a low one (the yard
    // wall, the boat, a resting limb) is cleared by lifting further when a
    // modest lift does it, anything else stops the arm short of it.
    let f = solids.trace(tx, ty, tz, tx + bx * t, ty + (rise + lift) * t, tz + bz * t, LENS_CLEARANCE);
    if (f < 1) {
      const prim = solids.hit.prim;
      const s = Math.max(f * t, 0.05);
      const over = prim && prim.k !== 3 ? (prim.y1 + LENS_CLEARANCE + 0.05 - (ty + rise * s)) / s : Infinity;
      if (over > lift && over < ARM_LIFT) {
        const f2 = solids.trace(tx, ty, tz, tx + bx * t, ty + (rise + over) * t, tz + bz * t, LENS_CLEARANCE);
        if (f2 > f) {
          f = f2;
          lift = over;
        }
      }
      // Still stopped close behind the cat (a hull or a wall at its back):
      // look down over it from higher up rather than from the cat's back.
      const base = lift;
      for (let k = 1; f * t * length < ARM_MIN * 1.6 && k <= 3; k++) {
        const f2 = solids.trace(tx, ty, tz, tx + bx * t, ty + (rise + base + k * SOLID_RISE) * t, tz + bz * t, LENS_CLEARANCE);
        if (f2 > f + 0.1) {
          f = f2;
          lift = base + k * SOLID_RISE;
        }
      }
      t *= f;
    }
    rt.armLift = lift;
    return Math.max(t, 0.1 / length);
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

// Bridges the crevices between touching rocks that are narrower than a cat
// (a morphological closing of their joint surface, radius CREVICE): each
// group of overlapping tiles gets one more tile holding only the bridges.
// Without it a cat that dropped into such a slot could neither walk nor
// jump out. Returns the tiles with the bridges added.
const CREVICE = 0.3;
export function bridgeCrevices(domes, cell = 0.1) {
  const groups = [];
  const seen = new Set();
  const overlaps = (a, b) => Math.abs(a.x - b.x) < a.r + b.r && Math.abs(a.z - b.z) < a.r + b.r;
  for (const d of domes) {
    if (seen.has(d)) continue;
    const group = [d];
    seen.add(d);
    for (let i = 0; i < group.length; i++)
      for (const e of domes) if (!seen.has(e) && overlaps(group[i], e)) { seen.add(e); group.push(e); }
    if (group.length > 1) groups.push(group);
  }
  const out = [...domes];
  const k = Math.ceil(CREVICE / cell);
  for (const group of groups) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const d of group) { x0 = Math.min(x0, d.x - d.r); x1 = Math.max(x1, d.x + d.r); z0 = Math.min(z0, d.z - d.r); z1 = Math.max(z1, d.z + d.r); }
    const nx = Math.ceil((x1 - x0) / cell) + 1, nz = Math.ceil((z1 - z0) / cell) + 1;
    if (nx * nz > 4e6) continue;
    const h = new Float32Array(nx * nz);
    for (let j = 0; j < nz; j++)
      for (let i = 0; i < nx; i++) {
        const x = x0 + i * cell, z = z0 + j * cell;
        let y = groundHeight(x, z);
        for (const d of group) if (Math.abs(x - d.x) <= d.r && Math.abs(z - d.z) <= d.r) y = Math.max(y, tileHeight(d, x, z));
        h[j * nx + i] = y;
      }
    // Closing: dilate (max) then erode (min) over a square of ±k cells,
    // separably.
    const pass = (src, op, alongX) => {
      const dst = new Float32Array(src.length);
      for (let j = 0; j < nz; j++)
        for (let i = 0; i < nx; i++) {
          let v = src[j * nx + i];
          for (let s = -k; s <= k; s++) {
            const ii = alongX ? i + s : i, jj = alongX ? j : j + s;
            if (ii < 0 || jj < 0 || ii >= nx || jj >= nz) continue;
            v = op(v, src[jj * nx + ii]);
          }
          dst[j * nx + i] = v;
        }
      return dst;
    };
    const closed = pass(pass(pass(pass(h, Math.max, true), Math.max, false), Math.min, true), Math.min, false);
    const fill = new Float32Array(nx * nz);
    let any = false;
    for (let i = 0; i < fill.length; i++) {
      // Only real crevices: filled well above what is there, between rock.
      fill[i] = closed[i] > h[i] + 0.12 ? closed[i] : -Infinity;
      if (fill[i] > -Infinity) any = true;
    }
    if (!any) continue;
    out.push({ x0, z0, cell, nx, nz, heights: fill, x: (x0 + x1) / 2, z: (z0 + z1) / 2, r: Math.max(x1 - x0, z1 - z0) / 2, bridge: true });
  }
  return out;
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
  // trunksNear: its results, and a stamp per query so each trunk is listed once.
  const foundTrunks = [];
  const marks = new Map();
  let stamp = 0;
  const at = (x, z) => cells.get(Math.floor(x / cell) * 4096 + Math.floor(z / cell));
  return {
    // Trunks within `radius` of (x, z) (whole cells; may include a few
    // more), into `found`, each once; returns how many. No allocation.
    found: foundTrunks,
    trunksNear(x, z, radius) {
      stamp++;
      let n = 0;
      for (let i = Math.floor((x - radius) / cell); i <= Math.floor((x + radius) / cell); i++)
        for (let j = Math.floor((z - radius) / cell); j <= Math.floor((z + radius) / cell); j++) {
          const c = cells.get(i * 4096 + j);
          if (c) for (const t of c.trunks) if (marks.get(t) !== stamp) { marks.set(t, stamp); foundTrunks[n++] = t; }
        }
      return n;
    },
    // Whether a body of `radius` at (x, z) is clear of every trunk; when it
    // is not, `trunk` is the one in the way.
    trunk: null,
    clearOfTrunks(x, z, radius) {
      const c = at(x, z);
      if (!c) return true;
      for (const t of c.trunks)
        if (hyp(x - t.x, z - t.z) < t.r + radius) {
          this.trunk = t;
          return false;
        }
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

// A critically damped spring, s = { x, v }, toward `target` at angular
// frequency `omega` (rad/s): exact for any dt, so it moves the same at 30
// and 120 fps; no overshoot, no allocation. Returns the new x.
export function spring(s, target, omega, dt) {
  if (!(dt > 0)) return s.x;
  const y = s.x - target;
  const c = s.v + omega * y;
  const e = Math.exp(-omega * dt);
  s.x = target + (y + c * dt) * e;
  s.v = (s.v - omega * c * dt) * e;
  return s.x;
}
// max(a, b), rounded over a band `k` wide so a path that meets the larger
// one turns smoothly onto it (never below the max, at most k/4 above).
function softMax(a, b, k) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.max(a, b) + h * h * k * 0.25;
}
function settle(s, x) {
  s.x = x;
  s.v = 0;
}

// Math.hypot allocates on every call; the walker calls this hundreds of
// times a frame.
function hyp(a, b) {
  return Math.sqrt(a * a + b * b);
}
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
