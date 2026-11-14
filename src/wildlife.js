import { seededRandom } from "./random.js";
import { ISLAND, islandPoint, groundHeight } from "./terrain.js";
import { createBlobs, createSpray, boulderClusters, angleBetween, domeHeight } from "./animal-forms.js";
import { createPenguins } from "./penguins.js";
import { createSeals } from "./seals.js";
import { createWhale } from "./whale.js";
import { createTortoise, createOystercatchers } from "./shore-life.js";
import { cylinder, capsule, setCapsule } from "./blockers.js";

// The island's larger animals, each a module with the same interface:
//   { pois: [{ id, title, x, z, r }], update(frame) → interest | null,
//     events: [], dispose() }
// This gathers them for landscape.js: where each lives (from the same rock
// layout forest.js draws), their shared contact shadows and spray, the
// nearest one for the cat's head to follow, and their sounds as events.
//
// landscape.wildlife.events is refilled every frame (cleared at the start
// of each render), so read it between renders; each event is
//   { type, x, z, d, gain, source }  (source: "penguins", "seals", ...)
// See each module's header for its event types and the sounds they want.
const HOME_THETA = Math.atan2(0 - ISLAND.z, 6 - ISLAND.x);

export function createWildlife(group, seed, { obstacles, light = false }) {
  const { domes, flowers } = obstacles;
  const random = seededRandom(seed ^ 0x3b1d5a97);
  const blobs = createBlobs(group, 48);
  const spray = createSpray(group, light ? 96 : 192, random);
  const clusters = boulderClusters(domes);
  const signed = (theta) => Math.atan2(Math.sin(theta - HOME_THETA), Math.cos(theta - HOME_THETA));
  // The colony: the nearest outcrop along the shore from where the cat
  // starts that is far enough to be a walk (and is mostly on land).
  const byDistance = clusters
    .map((c) => ({ c, a: angleBetween(c.theta, HOME_THETA) }))
    .sort((p, q) => p.a - q.a);
  const fallback = (t) => ({ ...islandPoint(t, 1), theta: t, inland: 1, members: domes.slice(0, 1) });
  const colonyRock = (byDistance.find(({ c, a }) => a > 0.22 && c.inland > -2) ?? byDistance[0])?.c ?? fallback(HOME_THETA + 0.4);
  // The seals: a waterline outcrop, preferably on the other side of home
  // from the penguins, so the two encounters pull the cat different ways.
  const side = Math.sign(signed(colonyRock.theta)) || 1;
  const sealRock = byDistance.find(({ c, a }) => c !== colonyRock && c.inland < 0.5 && a > 0.25 && Math.sign(signed(c.theta)) !== side)?.c
    ?? byDistance.find(({ c }) => c !== colonyRock && c.inland < 0.5)?.c
    ?? byDistance.find(({ c }) => c !== colonyRock)?.c
    ?? colonyRock;
  // The whale ranges offshore, in sight of the home beach toward the seals.
  const whaleTheta = HOME_THETA + -side * 0.3;
  const tall = (x, z) => {
    for (const d of domes) {
      if (Math.abs(x - d.x) > d.r || Math.abs(z - d.z) > d.r) continue;
      if (domeHeight(d, x, z) > groundHeight(x, z) + 0.15) return true;
    }
    return false;
  };
  const modules = [];
  const add = (source, module) => {
    module.source = source;
    modules.push(module);
    return module;
  };
  const home = islandPoint(HOME_THETA, 3.2);
  const shared = { light, blobs, spray };
  const penguins = add("penguins", createPenguins(group, { seed, domes, cluster: colonyRock, ...shared }));
  const seals = add("seals", createSeals(group, { seed, domes, cluster: sealRock, ...shared }));
  const whale = add("whale", createWhale(group, { seed, theta: whaleTheta, ...shared }));
  const tortoise = add("tortoise", createTortoise(group, { seed, flowers, home, ...shared }));
  const oystercatchers = add("oystercatchers", createOystercatchers(group, { seed, theta: HOME_THETA - side * 0.16, avoid: tall, ...shared }));
  const events = [];
  const pois = modules.flatMap((m) => m.pois);
  const best = { x: 0, y: 0, z: 0, kind: "", near: false, d: Infinity };
  const timing = { ms: 0, frames: 0 };

  // solid: the animals' bodies, one list of moving solids (blockers.js)
  // beside the landmarks' static ones: the cat cannot pass through them
  // and the camera keeps out of the big ones. Rewritten in place each frame.
  const bodies = [];
  const bodyOf = new Map();
  const add2 = (animal, prim) => { bodyOf.set(animal, prim); bodies.push(prim); };
  for (const b of penguins.birds ?? []) add2(b, cylinder(b.x, b.z, 0.17, 0, 0.6, { lens: false }));
  for (const s of seals.seals ?? []) add2(s, capsule({ x: s.x, y: 0, z: s.z }, { x: s.x, y: 0, z: s.z }, 0.3));
  if (tortoise.tortoise) add2(tortoise.tortoise, cylinder(0, 0, 0.24, 0, 0.24, { lens: false, stand: true }));
  for (const b of oystercatchers.birds ?? []) add2(b, cylinder(b.x, b.z, 0.1, 0, 0.3, { lens: false }));
  const placeBodies = () => {
    for (const b of penguins.birds ?? []) {
      const c = bodyOf.get(b);
      const y = Number.isFinite(b.y) ? b.y : 0;
      c.x = b.x; c.z = b.z; c.rad = c.r = 0.17 * (b.size ?? 1); c.y0 = y; c.y1 = y + 0.6 * (b.size ?? 1);
    }
    for (const s of seals.seals ?? []) {
      const k = s.size ?? 1, hx = Math.sin(s.heading) * 0.55 * k, hz = Math.cos(s.heading) * 0.55 * k;
      const y = (Number.isFinite(s.y) ? s.y : 0) + 0.28 * k;
      setCapsule(bodyOf.get(s), s.x - hx, y, s.z - hz, s.x + hx, y, s.z + hz, 0.3 * k);
    }
    const t = tortoise.tortoise;
    if (t) {
      const c = bodyOf.get(t);
      c.x = t.x; c.z = t.z; c.y0 = groundHeight(t.x, t.z); c.y1 = c.y0 + 0.24;
    }
    for (const b of oystercatchers.birds ?? []) {
      const c = bodyOf.get(b);
      c.live = b.state !== "fly";
      c.x = b.x; c.z = b.z; c.y0 = b.y ?? groundHeight(b.x, b.z); c.y1 = c.y0 + 0.3;
    }
  };
  placeBodies();
  return {
    bodies,
    pois,
    events,
    modules,
    penguins,
    seals,
    whale,
    tortoise,
    oystercatchers,
    blobs,
    spray,
    timing,
    // frame: { dt, time, night, wind, pose, water, eye }. Returns the
    // nearest animal worth watching (same shape as critters' interest, plus
    // d), or null.
    update(frame) {
      const started = performance.now();
      events.length = 0;
      blobs.begin();
      let found = null;
      for (const m of modules) {
        const interest = m.update(frame);
        for (const e of m.events) {
          e.source = m.source;
          events.push(e);
        }
        m.events.length = 0;
        if (interest && (!found || interest.d < found.d)) found = interest;
      }
      blobs.end();
      placeBodies();
      spray.update(frame.dt, frame.wind, frame.night);
      timing.ms += performance.now() - started;
      timing.frames++;
      if (!found) return null;
      Object.assign(best, found);
      return best;
    },
    dispose() {
      for (const m of modules) m.dispose();
      blobs.dispose();
      spray.dispose();
    },
  };
}
