import { groundHeight, shoreDistance, islandPoint, ISLAND } from "./terrain.js";
import { CAT_SCALE } from "./cat-rig.js";

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

export const CAMERA = { distance: 3.4, elevation: 0.38, min: 1.1, max: 8 };

export function createWalker(obstacles) {
  const grid = spatialGrid(obstacles);
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
  };
  let target = null;
  let blocked = 0;
  let lastDrag = -10;
  let clock = 0;
  // The last rock face the body met: outward normal, when, which way round
  // the cat is going, and how long it has pushed straight at it.
  const wall = { x: 0, z: 0, at: -10, side: 1, top: -Infinity, headOn: 0 };
  const events = [];

  home();

  return {
    cat,
    camera,
    events,
    surface,
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
      camera.yaw += dx;
      camera.elevation = clamp(camera.elevation + dy, 0.06, 1.2);
      lastDrag = clock;
    },
    zoom(factor) {
      camera.distance = clamp(camera.distance * factor, CAMERA.min, CAMERA.max);
    },
    // input: move [right, forward] in camera terms (−1…1), run, jump (edge).
    update(dt, input, interest) {
      clock += dt;
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
      let wantedTurn = 0;
      if (want > 0.01) {
        const diff = wrap(Math.atan2(dirX, dirZ) - cat.heading);
        const rate = run ? 5.5 : 3.8;
        wantedTurn = clamp(diff * 6, -rate, rate);
        want *= Math.max(0, Math.cos(diff)) ** 0.8;
      }
      cat.turn += (wantedTurn - cat.turn) * Math.min(1, dt * 9);
      cat.heading = wrap(cat.heading + cat.turn * dt);
      const topSpeed = run ? RUN_SPEED : WALK_SPEED;
      const accel = cat.air > 0 ? 1 : run ? 7 : 4;
      // Speed eases toward the target: quick to start, softer to stop.
      const targetSpeed = want * topSpeed;
      const rate = targetSpeed > cat.speed ? accel : accel * 1.4;
      cat.speed += clamp((targetSpeed - cat.speed) * Math.min(1, dt * 5), -rate * dt, rate * dt);
      if (Math.abs(cat.speed) < 0.01 && want === 0) cat.speed = 0;
      cat.running = cat.speed > 1.7;

      // Jump: straight up or forward, onto rocks if they are in reach.
      if ((input.jump || hop) && cat.air === 0 && cat.sit < 0.5) {
        cat.vy = JUMP_SPEED;
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
      if (!moved && Math.abs(step) > 1e-4) {
        blocked += dt;
        // In the air, momentum carries on once the body clears the rim.
        if (cat.air === 0) cat.speed *= 0.5;
      } else blocked = 0;

      // Vertical: stick to the ground, or fly a ballistic arc.
      const floor = surface(cat.x, cat.z);
      if (cat.air > 0) {
        cat.vy -= GRAVITY * dt;
        cat.y += cat.vy * dt;
        if (cat.y <= floor && cat.vy < 0) {
          cat.y = floor;
          events.push({ type: "land", speed: -cat.vy });
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
      cat.onRock = floor > groundHeight(cat.x, cat.z) + 0.03;

      // How much the legs are stepping (the gait itself lives in cat.js).
      const pace = Math.max(Math.abs(cat.speed), Math.abs(cat.turn) * 0.1);
      cat.gaitAmp += (smooth(0, 0.18, pace) - cat.gaitAmp) * Math.min(1, dt * 8);

      // Idle: sit down after a few seconds, grow sleepy after half a minute.
      const active = want > 0.01 || cat.air > 0 || Math.abs(cat.speed) > 0.05;
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

      updateCamera(dt, want > 0.01);
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
    target = null;
    camera.yaw = cat.heading;
    camera.elevation = CAMERA.elevation;
    camera.distance = CAMERA.distance;
    camera.targetY = cat.y;
    placeCamera(1);
  }

  function tryMove(nx, nz) {
    if (!grid.clearOfTrunks(nx, nz, CAT_RADIUS)) return false;
    const next = surface(nx, nz);
    const onRock = next > groundHeight(nx, nz) + 0.03;
    // Cats don't swim: stop at the swash unless standing on a boulder.
    if (!onRock && shoreDistance(nx, nz) < 0.45) return false;
    const rise = next - (cat.air > 0 ? cat.y : surface(cat.x, cat.z));
    const run = Math.hypot(nx - cat.x, nz - cat.z) || 1e-4;
    // Pebbles are stepped over; a boulder's steep flank needs a jump.
    const tall = next - groundHeight(nx, nz) > 0.12;
    if (cat.air > 0 ? rise > 0.02 : tall && rise > 0.003 && rise / run > 1.6) return false;
    if (!bodyClear(nx, nz, next - rise)) return false;
    cat.x = nx;
    cat.z = nz;
    return true;
  }

  // Whether the chest and shoulders fit at (x, z), paws at height `feet`.
  // A blocking rock is remembered as the wall to slide along and walk round.
  function bodyClear(x, z, feet) {
    const sin = Math.sin(cat.heading);
    const cos = Math.cos(cat.heading);
    const step = cat.air > 0 ? 0.03 : STEP_UP;
    for (const [f, s, d] of PROBES) {
      const px = x + sin * f + cos * s;
      const pz = z + cos * f - sin * s;
      const h = surface(px, pz);
      if (h <= feet + step + CLIMB * d) continue;
      // The rock's outward normal: from its centre, which turns smoothly
      // as the cat goes round (the height field's gradient is ragged at
      // the rim).
      const dome = grid.domeAt(px, pz);
      let nx;
      let nz;
      if (dome) {
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

  // Walkable height: the ground mesh, or the top of a boulder.
  function surface(x, z) {
    return Math.max(groundHeight(x, z), grid.domeHeight(x, z));
  }

  function updateCamera(dt, moving) {
    // Swing round behind the cat while it walks, unless the viewer is
    // steering the camera themselves.
    if (moving && clock - lastDrag > 1.2) {
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
    let x = tx - Math.sin(camera.yaw) * horizontal;
    let z = tz - Math.cos(camera.yaw) * horizontal;
    let y = ty + Math.sin(camera.elevation) * camera.distance;
    // Clear the ground (and boulders), and never dip toward the sea surface.
    const clearance = shoreDistance(x, z) > -1 ? surface(x, z) + 0.45 : 0.9;
    y = Math.max(y, clearance, 0.9);
    camera.x += (x - camera.x) * ease;
    camera.z += (z - camera.z) * ease;
    camera.y += (y - camera.y) * ease;
    const dx = tx - camera.x;
    const dz = tz - camera.z;
    const heading = Math.atan2(dx, dz);
    camera.azimuth = heading - Math.PI / 4;
    camera.pitch = Math.atan2(ty - camera.y, Math.hypot(dx, dz)) + LOOK_LIFT;
  }
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
  const at = (x, z) => cells.get(Math.floor(x / cell) * 4096 + Math.floor(z / cell));
  return {
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
        const u = (x - d.x0) / d.cell;
        const v = (z - d.z0) / d.cell;
        const i = Math.floor(u);
        const j = Math.floor(v);
        if (i < 0 || j < 0 || i >= d.nx - 1 || j >= d.nz - 1) continue;
        const h = d.heights;
        const k = j * d.nx + i;
        const h00 = h[k], h10 = h[k + 1], h01 = h[k + d.nx], h11 = h[k + d.nx + 1];
        const fu = u - i;
        const fv = v - j;
        let y;
        if (h00 > -Infinity && h10 > -Infinity && h01 > -Infinity && h11 > -Infinity)
          y = (h00 * (1 - fu) + h10 * fu) * (1 - fv) + (h01 * (1 - fu) + h11 * fu) * fv;
        else y = Math.max(h00, h10, h01, h11);
        if (y > best) {
          best = y;
          found = d;
        }
      }
      return best;
    },
    // The rock whose surface that is: { x, z (its centre), top }.
    domeAt(x, z) {
      if (this.domeHeight(x, z) === -Infinity) return null;
      return { x: found.x, z: found.z, top: tops.get(found) };
    },
  };
}

// How a paw print and a footstep sound: 0 rock, 1 wet sand, 2 dry sand,
// 3 dune scrub, 4 forest floor.
export function surfaceKind(x, z, onRock) {
  if (onRock) return 0;
  const inland = shoreDistance(x, z);
  if (inland < 1.7) return 1;
  if (inland < 6) return 2;
  if (inland < 11) return 3;
  return 4;
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
