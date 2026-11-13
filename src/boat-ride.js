import { shoreDistance, groundHeight, ISLAND } from "./terrain.js";
import { createBoatDynamics, findMooring, BOAT } from "./boat-dynamics.js";
import { deckHeight, STATION, HULL, sheer, halfBreadth } from "./boat-forms.js";

// The boat's life, without any drawing (boat.js draws it): asleep on its
// logs until the `boat` gift wakes; the launch (it rises, rolls upright and
// slides down the beach into its cove); then afloat, waiting at a mooring
// for the cat. The cat boards by swimming or wading up to it and pushing
// at it, or jumping beside it; aboard, the walker's input steers it (the
// wisp tows it, boat-dynamics.js), the cat stands at the bow with its front
// paws on the breasthook or sits on the bow sheets once it has stopped.
// It leaves by jumping (space; not where it is too far to swim back) or
// hops out over the bow when the bow runs up on sand. Left near the shore
// the boat waits where it is; left adrift, it finds its way to the nearest
// beach and waits there.
//
// States: asleep → launching → waiting ⇄ boarding → aboard → waiting|adrift.
//
// The walker (walker.js) calls `update(dt, input, cat)` every frame and
// hands the cat over while it returns true; `deck(x, z)` is walkable.

export const RIDE = {
  // Seconds: the launch, the hop aboard, how long the bow must sit on the
  // sand before the cat hops out.
  launch: 8,
  hop: 0.55,
  beach: 0.7,
  // How close the cat must be to the hull to board (m).
  reach: 0.45,
  // Farther out than this the cat will not jump overboard (it could not
  // swim back): SWIM_LIMIT less a margin.
  jumpLimit: 20,
  // Left farther out than this, the boat makes for the beach.
  adrift: 12,
};

const H = HULL.half;

// landmark: the boat's place ({ x, z, facing }, places.js layout); bed:
// walker.bed; sea; solids: walker.solids; magic: the shared record.
export function createBoatRide({ landmark, sea, bed, solids = null, magic = null, swimLimit = 24 }) {
  const dyn = createBoatDynamics({ sea, bed, solids });
  const s = dyn.state;
  // The cove: clear of boulders and solids, reached from the logs by a clear
  // glide (findMooring), with fallbacks that relax the margins.
  const cove = findMooring(landmark.x, landmark.z, bed, { solids, from: landmark })
    ?? findMooring(landmark.x, landmark.z, bed, { solids, from: landmark, margin: 1.2 })
    ?? findMooring(landmark.x, landmark.z, bed)
    ?? { x: landmark.x, z: landmark.z, heading: landmark.facing };
  const moor = { x: cove.x, z: cove.z, heading: cove.heading };
  const events = [];
  const ride = {
    state: "asleep",
    // Seconds into the current state.
    t: 0,
    // 0…1 through the launch (boat.js poses the hull along it).
    launch: 0,
    // The cat's hop aboard / ashore: from (x, y, z) to the station.
    hop: { x: 0, y: 0, z: 0, heading: 0 },
    // While the cat is aboard: which way it wants to go (world), how hard.
    want: [0, 0],
    throttle: 0,
    hurry: false,
    // Seconds the boat has been still with the cat aboard.
    still: 0,
    beached: 0,
    // How long the deck is ignored after a jump out (clearing the gunwale).
    clearFor: 0,
    // The camera's view of it (walker.js boatCamera).
    view: { x: 0, y: 0, z: 0, heading: 0, speed: 0, align: 1 },
    target: null,
    // Seconds since the cat last left (wildlife, the wisp).
    leftAt: -Infinity,
  };
  dyn.place(moor.x, moor.z, moor.heading);

  const fwd = () => [Math.sin(s.heading), Math.cos(s.heading)];
  // A boat-frame point (x across, z along) to world coast (x, z).
  const world = { x: 0, z: 0 };
  function toWorld(x, z) {
    const fx = Math.sin(s.heading), fz = Math.cos(s.heading);
    world.x = s.x + fx * z + fz * x;
    world.z = s.z + fz * z - fx * x;
    return world;
  }
  // World (x, z) to the boat frame, ignoring pitch and roll.
  const local = { x: 0, z: 0 };
  function toLocal(x, z) {
    const fx = Math.sin(s.heading), fz = Math.cos(s.heading);
    const dx = x - s.x, dz = z - s.z;
    local.z = dx * fx + dz * fz;
    local.x = dx * fz - dz * fx;
    return local;
  }
  // The deck's height in the world at boat-frame (x, z), riding the hull's
  // heave, pitch and roll.
  function deckWorld(lx, lz) {
    const h = deckHeight(lx, lz);
    if (h === -Infinity) return h;
    return s.y + h - Math.sin(s.pitch) * 0 + lz * Math.tan(s.pitch) - lx * Math.tan(s.roll);
  }

  function afloat() {
    return ride.state !== "asleep" && ride.state !== "launching";
  }

  const api = {
    ride,
    dynamics: dyn,
    state: s,
    events,
    cove,
    moor,
    get afloat() {
      return afloat();
    },
    get aboard() {
      return ride.state === "aboard" || ride.state === "boarding";
    },
    toWorld: (x, z) => ({ ...toWorld(x, z) }),
    // Sail toward a tapped point (coast metres).
    sailTo(x, z) {
      ride.target = { x, z };
    },
    // Walkable deck (world coast metres), or −∞ off the boat.
    deck(x, z) {
      if (!afloat() || ride.clearFor > 0) return -Infinity;
      const dx = x - s.x, dz = z - s.z;
      if (dx * dx + dz * dz > (H + 0.4) * (H + 0.4)) return -Infinity;
      toLocal(x, z);
      return deckWorld(local.x, local.z);
    },
    carries(cat) {
      return ride.state === "aboard" || ride.state === "boarding";
    },
    get view() {
      return ride.view;
    },
    // Wake the boat: from its logs (a ceremony) or straight onto its
    // mooring (awake at load).
    wake(now = true) {
      if (ride.state !== "asleep") return;
      if (now) {
        ride.state = "launching";
        ride.t = 0;
        ride.launch = 0;
      } else {
        ride.state = "waiting";
        dyn.place(moor.x, moor.z, moor.heading);
      }
    },
    // The walker's hook, every frame. input: { move: [right, forward],
    // run, jump } in camera terms; yaw: the camera's heading (to turn the
    // move into a world direction). Returns true while it has the cat.
    update(dt, input, cat, yaw = s.heading) {
      events.length = 0;
      ride.t += dt;
      ride.clearFor = Math.max(0, ride.clearFor - dt);
      if (ride.state === "asleep") {
        if (magic?.isAwake?.("boat")) api.wake(Number.isFinite(magic.wakeAt?.boat) && magic.wakeAt.boat > -Infinity);
        if (ride.state === "asleep") return false;
      }
      if (ride.state === "launching") {
        ride.launch = Math.min(1, ride.t / RIDE.launch);
        if (ride.launch >= 1) {
          ride.state = "waiting";
          ride.t = 0;
          dyn.place(moor.x, moor.z, moor.heading);
          dyn.nudge(0.35, 0.3, -0.2);
          events.push({ type: "launch", gain: 1 });
        }
        return false;
      }
      // The cat's wish, as a world direction.
      const mx = input?.move?.[0] ?? 0, mz = input?.move?.[1] ?? 0;
      const sinY = Math.sin(yaw), cosY = Math.cos(yaw);
      let wx = sinY * mz + cosY * mx;
      let wz = cosY * mz - sinY * mx;
      // A tapped point on the sea, until the keys take over or it is reached.
      if (mx || mz) ride.target = null;
      if (ride.target && ride.state === "aboard") {
        const tx = ride.target.x - s.x, tz = ride.target.z - s.z;
        const d = Math.hypot(tx, tz);
        if (d < 2.5) ride.target = null;
        else {
          wx = tx / d;
          wz = tz / d;
        }
      }
      const wl = Math.hypot(wx, wz);
      if (wl > 1) {
        wx /= wl;
        wz /= wl;
      }

      if (ride.state === "waiting" || ride.state === "adrift") {
        // Board: pushing at the hull from the water or the sand beside
        // it, or jumping when close.
        const near = cat.air === 0 && hullGap(cat.x, cat.z) < RIDE.reach;
        const pushing = wl > 0.3 && (wx * (s.x - cat.x) + wz * (s.z - cat.z)) > 0;
        if (near && (pushing || input?.jump)) {
          ride.state = "boarding";
          ride.t = 0;
          Object.assign(ride.hop, { x: cat.x, y: cat.y, z: cat.z, heading: cat.heading });
          events.push({ type: "jump" });
        }
      }

      if (ride.state === "boarding") {
        const k = Math.min(1, ride.t / RIDE.hop);
        const st = toWorld(STATION.x, STATION.z);
        const endY = deckWorld(STATION.x, STATION.z);
        const e = k * k * (3 - 2 * k);
        cat.x = ride.hop.x + (st.x - ride.hop.x) * e;
        cat.z = ride.hop.z + (st.z - ride.hop.z) * e;
        const base = ride.hop.y + (endY - ride.hop.y) * k;
        const arc = Math.sin(Math.PI * k) * (0.35 + Math.max(0, endY - ride.hop.y) * 0.6);
        cat.y = base + arc;
        cat.air = k < 1 ? Math.max(0.001, arc) : 0;
        cat.vy = Math.cos(Math.PI * k) * 2.5;
        cat.airPitch = clamp(cat.vy * 0.08, -0.3, 0.3);
        cat.heading = lerpAngle(ride.hop.heading, s.heading, e);
        cat.speed = k < 1 ? 1 : 0;
        dryCat(cat);
        if (k >= 1) {
          ride.state = "aboard";
          ride.t = 0;
          ride.still = 0;
          cat.air = 0;
          cat.vy = 0;
          // The hull dips and rocks under the cat landing in it.
          const side = Math.sign(toLocal(ride.hop.x, ride.hop.z).x) || 1;
          dyn.nudge(0.28, 0.45 * side, 0.15);
          events.push({ type: "board", gain: 1 });
        }
        stepBoat(dt, null, 0, false, null);
        return true;
      }

      if (ride.state !== "aboard") ride.throttle = 0;
      if (ride.state === "aboard") {
        ride.want[0] = wx;
        ride.want[1] = wz;
        ride.throttle = Math.min(1, wl);
        ride.hurry = Boolean(input?.run);
        stepBoat(dt, wl > 0.05 ? ride.want : null, ride.throttle, ride.hurry, null);
        const speed = Math.hypot(s.vx, s.vz);
        ride.still = wl > 0.05 || speed > 0.25 ? 0 : ride.still + dt;
        holdCat(cat, dt, wl > 0.05);
        // Hop out over the bow when it has run up the sand (unless backing
        // off it), or jump out on request.
        ride.beached = s.bowGrounded && !(wl > 0.05 && wx * Math.sin(s.heading) + wz * Math.cos(s.heading) < -0.3) ? ride.beached + dt : 0;
        if (ride.beached > RIDE.beach) leave(cat, fwd(), true);
        else if (input?.jump) {
          if (s.offshore < Math.min(RIDE.jumpLimit, swimLimit - 3) || s.bowGrounded) {
            // Over the side the cat is steering toward, else toward the shore.
            let dx = wx, dz = wz;
            if (wl < 0.05) {
              dx = ISLAND.x - s.x;
              dz = ISLAND.z - s.z;
            }
            leave(cat, [dx, dz], false);
          } else {
            cat.meowing = 0.9;
            events.push({ type: "refuse" });
          }
        }
        updateView();
        return ride.state === "aboard";
      }

      // Waiting or adrift: held at the mooring, or making for the beach.
      if (ride.state === "adrift") {
        home[0] = ISLAND.x - s.x;
        home[1] = ISLAND.z - s.z;
        stepBoat(dt, home, 0.4, false, null);
        if (s.offshore < 9) {
          setMoor(s.x, s.z, s.heading);
          ride.state = "waiting";
          ride.t = 0;
        }
      } else stepBoat(dt, null, 0, false, moor);
      updateView();
      return false;
    },
  };

  function setMoor(x, z, heading) {
    moor.x = x;
    moor.z = z;
    moor.heading = heading;
  }

  // Distance from (x, z) to the hull's outline (0 inside).
  function hullGap(x, z) {
    toLocal(x, z);
    const sl = clamp(local.z / H, -1, 1);
    const du = Math.max(0, Math.abs(local.z) - H);
    const dv = Math.max(0, Math.abs(local.x) - halfBreadth(sl));
    return Math.hypot(du, dv);
  }

  // Reused every frame: no allocation.
  const control = { dir: null, throttle: 0, hurry: false, moor: null, load: 0 };
  const home = [0, 0];
  function stepBoat(dt, dir, throttle, hurry, mooring) {
    control.dir = dir;
    control.throttle = throttle;
    control.hurry = hurry;
    control.moor = mooring;
    control.load = ride.state === "aboard" ? 1 : 0;
    dyn.step(dt, control);
    for (const e of dyn.events) events.push(e);
    dyn.events.length = 0;
  }

  function updateView() {
    const v = ride.view;
    // Frame a little ahead of the cat: the boat's middle and its bow.
    const p = toWorld(0, H * 0.3);
    v.x = p.x;
    v.z = p.z;
    v.y = s.y + 0.3;
    v.heading = s.heading;
    v.speed = s.u;
    // How far the bow points where the cat steers (1 when not steering).
    v.align = ride.throttle > 0.05 ? ride.want[0] * Math.sin(s.heading) + ride.want[1] * Math.cos(s.heading) : 1;
  }

  // Aboard: the cat stands at the station, riding the deck; a cat that has
  // decided it is captain. The pose fields follow walker.js's.
  function holdCat(cat, dt, steering) {
    // Standing, front paws up on the breasthook; sitting, a step back so
    // all four are on the bow sheets.
    const sz = STATION.z - 0.2 * clamp(cat.sit, 0, 1);
    const st = toWorld(STATION.x, sz);
    cat.x = st.x;
    cat.z = st.z;
    cat.y = deckWorld(STATION.x, sz);
    // Faces the bow; the head turns into the wind of its going and to
    // whatever is off the bow.
    cat.heading = s.heading;
    cat.speed = 0;
    cat.turn = s.r * 0.6;
    cat.air = 0;
    cat.vy = 0;
    cat.airPitch = 0;
    cat.running = false;
    dryCat(cat);
    // Paws shift as the boat heels and pitches.
    const work = clamp(Math.abs(s.vr) * 0.6 + Math.abs(s.vp) * 0.5, 0, 1);
    cat.gaitAmp += (work * 0.35 - cat.gaitAmp) * Math.min(1, dt * 4);
    // Stands while under way; sits once the boat has been still a while.
    cat.idle = ride.still;
    const sitting = ride.still > 4 ? 1 : 0;
    cat.sit += (sitting - cat.sit) * Math.min(1, dt * (sitting ? 1.2 : 4));
    cat.sleepy += ((ride.still > 40 ? 0.5 : 0) - cat.sleepy) * Math.min(1, dt * 0.4);
    const ahead = steering ? clamp(Math.atan2(ride.want[0], ride.want[1]) - s.heading, -1, 1) : 0;
    const look = wrap(ahead) * 0.6 + clamp(s.r * 0.5, -0.4, 0.4) + (ride.still > 2 ? Math.sin(ride.t * 0.31) * Math.sin(ride.t * 0.11 + 1) * 0.7 : 0);
    cat.look += (look - cat.look) * Math.min(1, dt * 3);
    const up = steering ? 0.15 : 0.05;
    cat.lookUp += (up - cat.lookUp) * Math.min(1, dt * 3);
    // Balance: the head counters the roll.
    cat.tilt += (clamp(s.roll * 0.8, -0.3, 0.3) - cat.tilt) * Math.min(1, dt * 4);
    cat.swish = 0;
    cat.meowing = Math.max(0, (cat.meowing ?? 0) - dt);
  }

  function dryCat(cat) {
    cat.waterY = -Infinity;
    cat.water = 0;
    cat.wade = 0;
    cat.swim = 0;
    if (cat.waterSlope) cat.waterSlope[0] = cat.waterSlope[1] = 0;
    if (cat.flow) cat.flow[0] = cat.flow[1] = 0;
    cat.rising = 0;
    cat.onRock = false;
  }

  // Out of the boat: a leap over the bow or the side, handed back to the
  // walker's ballistic flight.
  function leave(cat, dir, overBow) {
    let [dx, dz] = dir;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l;
    dz /= l;
    if (!overBow) {
      // Over the gunwale nearest that way.
      const f = fwd();
      const side = dx * f[1] - dz * f[0] > 0 ? 1 : -1;
      const along = clamp(dx * f[0] + dz * f[1], -0.4, 0.6);
      const sx = f[1] * side, sz = -f[0] * side;
      dx = sx + f[0] * along;
      dz = sz + f[1] * along;
      const m = Math.hypot(dx, dz) || 1;
      dx /= m;
      dz /= m;
    }
    cat.heading = Math.atan2(dx, dz);
    cat.speed = overBow ? 1.5 : 1.3;
    cat.vy = 3.6;
    cat.air = 0.001;
    cat.sit = 0;
    cat.idle = 0;
    ride.clearFor = 0.7;
    ride.leftAt = ride.t;
    ride.beached = 0;
    events.push({ type: "leave", gain: 1 });
    dyn.nudge(-0.12, -0.3 * Math.sign(dx * Math.cos(s.heading) - dz * Math.sin(s.heading)), 0);
    if (s.offshore > RIDE.adrift && !s.bowGrounded) ride.state = "adrift";
    else {
      setMoor(s.x, s.z, s.heading);
      ride.state = "waiting";
    }
    ride.t = 0;
  }

  return api;
}

function clamp(v, a, b) {
  return Math.min(b, Math.max(a, v));
}
function wrap(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}
function lerpAngle(a, b, t) {
  return a + wrap(b - a) * t;
}
export { BOAT, sheer, shoreDistance, groundHeight };
