// Affordances: turn what the cat does into events props and animals answer.
// Pure: no DOM, no three.js. Fed the `affordances` list createPlaces returns
// (place-kit.js prop contract), plus any animal spots ({ kind: "animal" }).
//
//   const aff = createAffordances(places.affordances);
//   const events = aff.update(catState, dt);
//   catState = { x, y, z, heading, speed, sitting, meowed, jumpedOnto,
//                bumped: { id } | null, onGround }
//   event    = { type, id, place, t }, type one of
//              on-top | inside | sat-near | meow-near | bumped | ran-at | left
//
// Headings and `facing` are radians with direction (sin a, cos a), as the
// prop contract says. An act fires once when it is really done (dwell), and
// `left` fires once when the cat is clearly gone (exit radius > enter radius,
// plus a short grace), so nothing flickers at a boundary.

export const DWELL = { sit: 1.5, inside: 0.6, onTop: 0.3, leave: 0.25 };
const EXIT = (r) => r * 1.25 + 0.2; // hysteresis: leave only well outside
const FACE_COS = Math.cos(Math.PI / 3); // "roughly facing": within 60°
const RUN = { speed: 3, cone: Math.cos(Math.PI / 6), reach: 8 };
const Y_TOL = { onTop: 0.35, inside: 0.6 };

// What wakes or answers each keepsake (quest.js reads this; docs cite why).
// `on`: the event type; `id`: the affordance id that must carry it;
// `seconds`: dwell override for sat-near; `answer`: what the world does.
export const ACTS = {
  // object-audit.md 1-2 ("the light looks at you", "the sill"); story-and-wow.md step 4 lighthouse row and step 5.
  lighthouse: { on: "sat-near", id: "cottage-sill", answer: "beam swings onto the cat and holds 4 s", also: { on: "meow-near", id: "lighthouse-light" } },
  // object-audit.md 3 ("the boiler"); story-and-wow.md step 4 wreck row (inside:boiler).
  wreck: { on: "inside", id: "wreck-boiler", answer: "footsteps go metallic; a meow inside rings the bell", also: { on: "meow-near", id: "wreck-bell" } },
  // object-audit.md 5 ("the whole island"); story-and-wow.md step 3 cairn watch and step 4 beacon row.
  beacon: { on: "sat-near", id: "beacon-top", seconds: 1.5, answer: "camera eases back to the island view with every woken light" },
  // object-audit.md 4 ("a cat in a tree"); story-and-wow.md step 4 milkwood row (fork, 2 s).
  milkwood: { on: "sat-near", id: "milkwood-fork", seconds: 2, answer: "dry under the crown; fireflies drift to the perch" },
  // object-audit.md 6 ("shy flowers"); story-and-wow.md step 4 pool row (5 s).
  pool: { on: "sat-near", id: "pool-rim", seconds: 5, answer: "anemones reopen, klipfish gather in the cat's shadow" },
  // object-audit.md 7 ("launch it yourself"); story-and-wow.md step 4 boat row (on-top twice, or on-top then meow).
  boat: { on: "on-top", id: "boat-hull", count: 2, answer: "first hop knocks and a crab bolts; second rolls it into the water", also: { on: "meow-near", id: "boat-hull", after: "on-top" } },
};

const seated = (k) => k === "sit-near" || k === "perch";

export function createAffordances(list = []) {
  const spots = list.map((a) => ({ a, inZone: false, dwell: 0, fired: false, out: 0 }));
  let t = 0;

  function within(s, c, r) {
    return Math.hypot(c.x - s.a.x, c.z - s.a.z) <= r;
  }
  function facingOk(a, heading) {
    if (!Number.isFinite(a.facing) || !Number.isFinite(heading)) return true;
    return Math.cos(heading - a.facing) >= FACE_COS;
  }
  // Is the act's condition true this frame (inside the enter radius)?
  function holds(s, c) {
    const { a } = s;
    if (!within(s, c, a.r)) return false;
    if (seated(a.kind)) return !!c.sitting && facingOk(a, c.heading);
    if (a.kind === "inside") return Math.abs((c.y ?? a.y) - a.y) < Y_TOL.inside;
    if (a.kind === "on-top") return c.onGround !== false && Math.abs((c.y ?? a.y) - a.y) < Y_TOL.onTop;
    return false;
  }
  const dwellFor = (a) => (seated(a.kind) ? a.seconds ?? DWELL.sit : a.kind === "inside" ? DWELL.inside : DWELL.onTop);
  const type = (k) => (seated(k) ? "sat-near" : k);

  function update(c, dt = 0) {
    t += Math.max(0, dt);
    const ev = [];
    const emit = (tp, a) => ev.push({ type: tp, id: a.id, place: a.place ?? null, t: Math.round(t * 1000) / 1000 });
    for (const s of spots) {
      const { a } = s;
      if (c.bumped && c.bumped.id === a.id) emit("bumped", a);
      if (a.kind === "meow-near") {
        if (c.meowed && within(s, c, a.r)) emit("meow-near", a);
        continue;
      }
      if (a.kind === "animal") {
        const dx = a.x - c.x, dz = a.z - c.z, d = Math.hypot(dx, dz);
        const reach = a.r ?? RUN.reach;
        if (!s.fired) {
          const toward = d > 1e-6 ? (Math.sin(c.heading) * dx + Math.cos(c.heading) * dz) / d : 1;
          if (d <= reach && (c.speed ?? 0) >= RUN.speed && toward >= RUN.cone) {
            s.fired = true;
            emit("ran-at", a);
          }
        } else if (d > EXIT(reach)) s.fired = false;
        continue;
      }
      // Dwell-based acts: on-top, inside, sit-near, perch.
      if (holds(s, c)) {
        s.inZone = true;
        s.out = 0;
        if (!s.fired) {
          // on-top: a landing settles; a jump onto this spot counts at once.
          s.dwell += dt;
          if (s.dwell >= dwellFor(a)) {
            s.fired = true;
            emit(type(a.kind), a);
          }
        }
      } else if (s.fired) {
        // Fired: leave only when clearly outside (exit radius, or a seated
        // cat that stood up and walked off), after a short grace.
        const gone = !within(s, c, EXIT(a.r)) || (seated(a.kind) && !c.sitting && !within(s, c, a.r));
        s.out = gone ? s.out + dt : 0;
        if (s.out >= DWELL.leave) {
          emit("left", a);
          s.fired = false;
          s.inZone = false;
          s.dwell = 0;
          s.out = 0;
        }
      } else {
        // Not fired yet: a moment outside the enter radius resets the dwell
        // only once past the exit radius (jitter at the edge keeps it).
        if (!within(s, c, EXIT(a.r)) || (seated(a.kind) && !c.sitting)) s.dwell = 0;
        s.inZone = false;
      }
    }
    return ev;
  }

  // The nearest affordance to (x, z) and its distance (for hints, the wisp).
  function near(x, z) {
    let best = null, bd = Infinity;
    for (const { a } of spots) {
      const d = Math.hypot(x - a.x, z - a.z);
      if (d < bd) { bd = d; best = a; }
    }
    return best ? { ...best, distance: bd } : null;
  }

  function reset() {
    t = 0;
    for (const s of spots) Object.assign(s, { inZone: false, dwell: 0, fired: false, out: 0 });
  }

  return { update, near, reset };
}
