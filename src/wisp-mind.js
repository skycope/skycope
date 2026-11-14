// The wisp's mind: a small living light with its own curiosity that leads
// the cat to the island's sleeping keepsakes by behaviour, never by arrow.
// It flits ahead and waits where it can be seen, loops back when the cat
// dawdles, darts about when it runs, hides in the grass and pops out,
// circles the cat when it sits (and sits with it at sunset), comes when
// it is meowed at, peeks at animals, looks up at a falling star, and dives
// into a keepsake when its gift wakes. Pure (no three.js, no DOM): thread.js
// drives it each frame and wisp.js draws where it is.
//
// Coast metres throughout. It keeps out of trunks (walker.js obstacle
// circles), floats over boulders (via `surface`, walker.surface), and over
// the sea only goes where the cat can swim (inside SWIM_LIMIT).
import { groundHeight, shoreDistance, ISLAND } from "./terrain.js";
import { seededRandom } from "./random.js";
import { createRoutes } from "./wisp-route.js";

export const WISP = {
  // How high it floats above the ground (metres), and how high it waits.
  float: 0.9,
  wait: 1.25,
  waitHigh: 1.95,
  // How far ahead it waits for a walking / running cat, how near the cat
  // comes before it flits on, and how far the cat strays before it comes back.
  hop: 7,
  hopRun: 11,
  near: 4.5,
  stray: 16,
  // Seconds without the cat getting any closer before it gives up leading
  // and keeps the cat company instead (and tries again now and then).
  patience: 45,
  // Clearance from trunks, and how far inside the swim limit it keeps.
  clear: 0.35,
  sea: 3,
};

const TAU = Math.PI * 2;
const NONE = [];

// obstacles: { trunks: [{ x, z, r }], domes: [{ x, z, r, … }] } (walker.js).
export function createWispMind({ seed = 1, obstacles = null, surface = groundHeight, swimLimit = 24 } = {}) {
  const random = seededRandom((seed ^ 0x3157a1) >>> 0);
  const grid = obstacleGrid(obstacles ?? { trunks: [], domes: [] });
  const reach = swimLimit - WISP.sea;
  // The body (it steers), its velocity, and the flutter laid over it.
  const body = { x: 0, y: -100, z: 0 };
  const vel = { x: 0, y: 0, z: 0 };
  const goal = { x: 0, y: 0, z: 0 };
  const out = { x: 0, y: -100, z: 0 };
  // Where it waits while leading; where it is curious about right now.
  const perch = { x: 0, z: 0, set: false };
  const scratch = { x: 0, z: 0 };
  const phase = [random() * TAU, random() * TAU, random() * TAU, random() * TAU];
  let mode = "hidden";
  let modeAt = 0;
  let clock = 0;
  let glow = 0;
  let flare = 0;
  let visible = false;
  let speedCap = 6;
  // Leading: the best distance the cat has been from the target, and when.
  let best = Infinity;
  let bestAt = 0;
  let target = null;
  let lastTug = 0;
  let nextHide = 14 + random() * 14;
  let nextFidget = 0;
  const fidget = { x: 0, y: 0, z: 0 };
  let orbit = random() * TAU;
  let lastPeek = -Infinity;
  let sitFor = 0;
  let perchBest = Infinity;
  let perchBestAt = 0;
  let reroute = 0;
  let tryingAt = -Infinity;
  let beckon = 0;
  const tugFrom = { x: 0, z: 0 };
  // The way to the current target (routes.find), and how far along the cat is.
  const routes = createRoutes({ obstacles: obstacles ?? { trunks: [], domes: [] }, surface, reach });
  let route = null;
  let routeFor = null;
  let routeAt = 0;
  let previous = "lead";
  // A ceremony's dive ({ x, y, z } of the keepsake) while one plays.
  const dive = { x: 0, y: 0, z: 0, at: 0, active: false };
  let stage = "";
  let stageAt = 0;
  const setStage = (next) => {
    stage = next;
    stageAt = clock;
  };

  const set = (next) => {
    if (next === mode) return;
    if (mode !== "answer" && mode !== "peek" && mode !== "gaze") previous = mode;
    mode = next;
    modeAt = clock;
  };
  const since = () => clock - modeAt;

  const mind = {
    // Rendered position (body + flutter), glow (0 hidden … ~1.6 flaring).
    position: out,
    get glow() {
      return glow;
    },
    get visible() {
      return visible;
    },
    get mode() {
      return mode;
    },
    // The dive's stage: "approach", "plunge", "gone" (the gift wakes as it
    // goes in), "emerge"; "" when not diving.
    get stage() {
      return mode === "dive" ? stage : "";
    },
    // Its steered body (no flutter), for tests.
    body,
    // Appear: rises out of the sand a few metres ahead of the cat.
    appear(cat) {
      if (mode !== "hidden") return;
      const ahead = 5.5;
      let x = cat.x + Math.sin(cat.heading) * ahead;
      let z = cat.z + Math.cos(cat.heading) * ahead;
      ({ x, z } = keepInside(x, z));
      body.x = x;
      body.z = z;
      body.y = surface(x, z) + 0.12;
      vel.x = vel.z = 0;
      vel.y = 1.6;
      visible = true;
      flare = 0.35;
      set("greet");
    },
    // The ceremony: dive into the keepsake at (x, y, z); `end()` lets it go.
    dive(x, y, z) {
      // Not met yet: it comes down out of the sky to do it.
      if (mode === "hidden") Object.assign(body, { x, y: y + 6, z });
      dive.x = x;
      dive.y = y;
      dive.z = z;
      dive.at = clock;
      dive.active = true;
      visible = true;
      setStage("approach");
      set("dive");
    },
    // The finale: rise high over the summit.
    soar(x, y, z) {
      if (mode === "hidden") Object.assign(body, { x, y: y + 1, z });
      dive.x = x;
      dive.y = y;
      dive.z = z;
      dive.at = clock;
      dive.active = true;
      visible = true;
      set("soar");
    },
    end() {
      dive.active = false;
      best = Infinity;
      bestAt = clock;
      perch.set = false;
      set("greet");
    },
    // Somewhere else moved it (the boat tows it while the cat is aboard):
    // carry on from there, so it does not slide back across the bay after.
    place(x, y, z) {
      body.x = x;
      body.y = y;
      body.z = z;
      vel.x = vel.y = vel.z = 0;
    },
    // Back to before it met the cat (begin again).
    reset() {
      visible = false;
      glow = 0;
      body.y = out.y = -100;
      perch.set = false;
      dive.active = false;
      set("hidden");
    },
    // dt: seconds (wall clock). ctx:
    //   cat         walker.cat
    //   target      { x, z } of where to lead, or null (nothing left: keep company)
    //   night       0 day … 1 night
    //   call        true on the frame the cat meows
    //   interest    an animal or critter near the cat ({ x, y, z, kind }), or null
    //   meteor      true while a falling star is in the sky
    //   sunset      the sun is going down (sit together)
    //   gifts       how many gifts are awake (it grows a little brighter)
    update(dt, ctx) {
      dt = Math.min(Math.max(dt, 0), 0.1);
      clock += dt;
      const cat = ctx.cat;
      if (mode === "hidden" || !cat) {
        glow += (0 - glow) * Math.min(1, dt * 4);
        return mind;
      }
      if (ctx.target !== target) {
        target = ctx.target;
        best = Infinity;
        bestAt = clock;
        perch.set = false;
      }
      const catY = Number.isFinite(cat.y) ? cat.y : surface(cat.x, cat.z);
      const sitting = cat.sit > 0.85;
      sitFor = sitting ? sitFor + dt : 0;
      if (ctx.trying || Math.abs(cat.speed) > 0.05) tryingAt = clock;
      // A cat that has sat a while (not one that has only just stopped).
      const settled = sitFor > (ctx.sunset ? 3 : 10);
      let hover = WISP.float;
      let rest = 0.6 + 0.4 * (ctx.night ?? 0);
      speedCap = 6;
      let stiff = 1;

      // Things that interrupt whatever it is doing.
      const free = mode !== "dive" && mode !== "soar";
      if (free && ctx.call) {
        set("answer");
        flare = Math.max(flare, 0.25);
      }
      if (free && mode !== "answer" && ctx.meteor && mode !== "gaze") set("gaze");
      if (free && mode !== "answer" && mode !== "gaze" && ctx.interest && isAnimal(ctx.interest.kind) && clock - lastPeek > 40 && mode !== "peek") {
        lastPeek = clock;
        set("peek");
      }
      // While leading, how the cat is getting on.
      let toTarget = Infinity;
      if (target) {
        toTarget = Math.hypot(target.x - cat.x, target.z - cat.z);
        if (toTarget < best - 2) {
          best = toTarget;
          bestAt = clock;
        }
      }
      const ignored = target && clock - bestAt > WISP.patience;

      switch (mode) {
        case "greet": {
          // Comes to the cat, loops round it once, then sets off.
          orbit += dt * 2.4;
          const r = 1.3;
          goal.x = cat.x + Math.sin(orbit) * r;
          goal.z = cat.z + Math.cos(orbit) * r;
          goal.y = catY + 0.7;
          speedCap = 5;
          if (since() > 2.4) set(target ? "lead" : "company");
          break;
        }
        case "lead": {
          if (!target) {
            set("company");
            break;
          }
          if (settled) {
            set(ctx.sunset ? "sunset" : "circle");
            break;
          }
          if (ignored) {
            set("company");
            lastTug = clock;
            best = toTarget;
            bestAt = clock - 10;
            break;
          }
          const running = cat.running || Math.abs(cat.speed) > 2;
          // Far from the keepsake it leads in longer hops (the way is long).
          const hopLength = (running ? WISP.hopRun : WISP.hop) + Math.min(4, Math.max(0, toTarget - 20) / 12);
          const toPerch = perch.set ? Math.hypot(perch.x - cat.x, perch.z - cat.z) : Infinity;
          // (With a route, the perch may stand off the straight line on purpose.)
          const perchToTarget = perch.set && !route ? Math.hypot(target.x - perch.x, target.z - perch.z) : -Infinity;
          // Nearly there (or as near as the way goes): wait over the keepsake.
          const routeEnd = route ? Math.hypot(route[route.length - 2] - cat.x, route[route.length - 1] - cat.z) : Infinity;
          if (toTarget < 9 || (routeEnd < 3 && toTarget < 16)) {
            // Nearly there: wait over the keepsake itself.
            perch.x = target.x;
            perch.z = target.z;
            perch.set = true;
            hover = WISP.wait + 0.6;
          } else if (!perch.set || toPerch < WISP.near + (hopLength - WISP.hop) * 0.4 || (running && toPerch < WISP.near + 3) || perchToTarget > toTarget + 2) {
            // The cat has caught up (or the perch is behind it): flit on.
            choosePerch(cat, target, hopLength, 0);
            flare = Math.max(flare, 0.12);
          } else if (clock - perchBestAt > 6 && clock - tryingAt < 2 && toPerch > WISP.near) {
            // The cat cannot get to it (a rock, a gully): another way round.
            choosePerch(cat, target, Math.min(hopLength, 6), ++reroute);
            flare = Math.max(flare, 0.2);
          } else if (toPerch > WISP.stray) {
            // Dawdling or wandering off: come back for the cat.
            set("fetch");
            break;
          }
          const nowToPerch = Math.hypot(perch.x - cat.x, perch.z - cat.z);
          if (nowToPerch < perchBest - 0.5) {
            perchBest = nowToPerch;
            perchBestAt = clock;
          }
          // Waiting: bob, fidget, sometimes hide in the grass and pop out.
          const waiting = Math.hypot(body.x - perch.x, body.z - perch.z) < 1.2;
          goal.x = perch.x;
          goal.z = perch.z;
          // Over the scrub and bushes inland it waits higher, where it shows.
          goal.y = surface(perch.x, perch.z) + (hover === WISP.float ? (shoreDistance(perch.x, perch.z) > 7 ? WISP.waitHigh : WISP.wait) : hover);
          if (running) {
            // Playful: zigzag across the way and dart.
            const across = Math.sin(clock * 3.1 + phase[0]) * 1.1;
            const dx = target.x - cat.x;
            const dz = target.z - cat.z;
            const d = Math.hypot(dx, dz) || 1;
            goal.x += (dz / d) * across;
            goal.z -= (dx / d) * across;
            speedCap = 11;
            stiff = 1.5;
          } else speedCap = 7;
          if (waiting) {
            fidgetAround(dt, 0.7);
            goal.x += fidget.x;
            goal.y += fidget.y;
            goal.z += fidget.z;
            // "Come on": while the cat stands still, now and then a quick
            // swoop toward it and back again.
            beckon = Math.abs(cat.speed) < 0.15 ? beckon + dt : 0;
            if (beckon > 4) {
              const swoop = Math.max(0, Math.sin((beckon - 4) * 0.8)) ** 6;
              const bx = cat.x - perch.x;
              const bz = cat.z - perch.z;
              const bd = Math.hypot(bx, bz) || 1;
              goal.x += (bx / bd) * swoop * Math.min(2.2, bd * 0.4);
              goal.z += (bz / bd) * swoop * Math.min(2.2, bd * 0.4);
              goal.y += swoop * 0.5;
              if (swoop > 0.5) stiff = 2.2;
            }
            // Far off, a slow brightening now and then, so it can be found.
            if (nowToPerch > 6) flare = Math.max(flare, 0.3 * Math.max(0, Math.sin(clock * 1.1 + phase[2])) ** 14);
            nextHide -= dt;
            if (nextHide <= 0 && shoreDistance(perch.x, perch.z) > 6 && toTarget > 9) {
              nextHide = 20 + random() * 25;
              set("hide");
            }
          }
          break;
        }
        case "fetch": {
          // Back to the cat, a loop round it, then lead again.
          orbit += dt * 2.6;
          const d = Math.hypot(body.x - cat.x, body.z - cat.z);
          const r = d < 2.2 ? 1.1 : 0;
          goal.x = cat.x + Math.sin(orbit) * r;
          goal.z = cat.z + Math.cos(orbit) * r;
          goal.y = catY + 0.75;
          speedCap = 9;
          if ((r > 0 && since() > 2.2) || since() > 8) {
            perch.set = false;
            set(target ? "lead" : "company");
          }
          break;
        }
        case "company": {
          // Nothing to lead to, or the cat would rather wander: stays near,
          // a little to one side and ahead, and now and then tugs toward
          // where it wants to go.
          if (settled) {
            set(ctx.sunset ? "sunset" : "circle");
            break;
          }
          const side = Math.sin(clock * 0.21 + phase[1]) > 0 ? 1 : -1;
          const a = cat.heading + side * 0.9;
          goal.x = cat.x + Math.sin(a) * 1.8;
          goal.z = cat.z + Math.cos(a) * 1.8;
          goal.y = catY + 0.85;
          fidgetAround(dt, 0.5);
          goal.x += fidget.x;
          goal.y += fidget.y;
          goal.z += fidget.z;
          speedCap = 5;
          rest *= target ? 0.75 : 0.85;
          if (target && clock - lastTug > 22) {
            lastTug = clock;
            set("tug");
          }
          // The cat sets off toward the keepsake after all: lead again.
          if (target && clock - bestAt < 1 && since() > 3) {
            perch.set = false;
            set("lead");
          }
          break;
        }
        case "tug": {
          // A few metres along the way to the keepsake and a pause there;
          // if the cat comes too, lead on from there, else back to it.
          if (since() < 0.05 && target) {
            choosePerch(cat, target, 4.5, 0);
            tugFrom.x = cat.x;
            tugFrom.z = cat.z;
          }
          const out = since() < 2.8 && target;
          goal.x = out ? perch.x : cat.x + Math.sin(cat.heading + 0.9) * 1.6;
          goal.z = out ? perch.z : cat.z + Math.cos(cat.heading + 0.9) * 1.6;
          goal.y = surface(goal.x, goal.z) + (out ? WISP.wait : 0.85);
          speedCap = 6;
          const followed = target && Math.hypot(cat.x - tugFrom.x, cat.z - tugFrom.z) > 2 && Math.hypot(perch.x - cat.x, perch.z - cat.z) < Math.hypot(perch.x - tugFrom.x, perch.z - tugFrom.z);
          if (followed) {
            best = toTarget;
            bestAt = clock;
            perch.set = false;
            set("lead");
          } else if (since() > 4.4) set("company");
          break;
        }
        case "circle": {
          // The cat sits: round and round it, slowly, at head height.
          if (!sitting) {
            set(previous === "company" ? "company" : "lead");
            break;
          }
          if (ctx.sunset) {
            set("sunset");
            break;
          }
          orbit += dt * 0.9;
          goal.x = cat.x + Math.sin(orbit) * 0.85;
          goal.z = cat.z + Math.cos(orbit) * 0.85;
          goal.y = catY + 0.5 + Math.sin(orbit * 2) * 0.08;
          speedCap = 3;
          // Now and then, a gentle "this way" while the cat sits on.
          if (target && since() > 9 && clock - lastTug > 24) {
            lastTug = clock;
            set("tug");
          }
          break;
        }
        case "sunset": {
          // Sitting together: settled beside the cat, low and soft.
          if (!sitting) {
            set(previous === "company" ? "company" : "lead");
            break;
          }
          const a = cat.heading + 1.4;
          goal.x = cat.x + Math.sin(a) * 0.55;
          goal.z = cat.z + Math.cos(a) * 0.55;
          goal.y = catY + 0.22 + Math.sin(clock * 0.8) * 0.03;
          speedCap = 1.5;
          rest *= 0.8;
          break;
        }
        case "hide": {
          // Down into the grass, dim… and out again, a little brighter.
          const t = since();
          goal.x = perch.x;
          goal.z = perch.z;
          goal.y = surface(perch.x, perch.z) + (t < 2.2 ? 0.08 : WISP.wait + 0.3);
          rest *= t < 0.5 ? 1 : t < 2.2 ? 0.12 : 1;
          speedCap = t < 2.2 ? 2.5 : 8;
          stiff = t < 2.2 ? 1 : 2.5;
          if (t > 2.2 && t - dt <= 2.2) flare = 0.35;
          if (t > 3 || Math.hypot(perch.x - cat.x, perch.z - cat.z) < WISP.near) set("lead");
          break;
        }
        case "answer": {
          // Meowed at: comes straight to the cat's face, brightens, loops
          // round its head, and goes back to what it was doing.
          orbit += dt * 4;
          const near = Math.hypot(body.x - cat.x, body.z - cat.z) < 1.6;
          const r = near ? 0.7 : 0;
          goal.x = cat.x + Math.sin(orbit) * r;
          goal.z = cat.z + Math.cos(orbit) * r;
          goal.y = catY + 0.6;
          speedCap = 12;
          stiff = 2;
          if (since() > 2.6) set(previous === "hidden" ? "lead" : previous);
          break;
        }
        case "peek": {
          // An animal: a closer look, hovering over it, then back.
          const it = ctx.interest;
          if (!it || since() > 3.5) {
            set(previous);
            break;
          }
          goal.x = it.x;
          goal.z = it.z;
          goal.y = (Number.isFinite(it.y) ? it.y : surface(it.x, it.z)) + 1.4;
          speedCap = 6;
          break;
        }
        case "gaze": {
          // A falling star: it rises a little and holds still, looking up.
          if (!ctx.meteor && since() > 2.5) {
            set(previous);
            break;
          }
          if (since() < 0.05) {
            goal.x = body.x;
            goal.z = body.z;
            goal.y = body.y + 1.1;
          }
          speedCap = 2;
          rest *= 1.25;
          break;
        }
        case "dive": {
          // Up over the keepsake, then a plunge into it; gone a moment, then
          // out again carrying its gift (thread.js times the rest by `stage`).
          const t = clock - dive.at;
          goal.x = dive.x;
          goal.z = dive.z;
          if (stage === "approach") {
            goal.y = dive.y + 2.6;
            speedCap = 30;
            stiff = 3;
            rest = 1.1;
            if ((t > 0.6 && Math.hypot(body.x - goal.x, body.y - goal.y, body.z - goal.z) < 0.8) || t > 3) setStage("plunge");
          } else if (stage === "plunge") {
            goal.y = dive.y;
            speedCap = 14;
            stiff = 4;
            rest = 1.6;
            if (clock - stageAt > 0.45) setStage("gone");
          } else if (stage === "gone") {
            goal.y = dive.y;
            rest = 0;
            speedCap = 1;
            if (clock - stageAt > 2.1) {
              setStage("emerge");
              flare = 1.2;
            }
          } else {
            goal.y = dive.y + 1.8;
            speedCap = 3;
            rest = 1.4;
          }
          break;
        }
        case "soar": {
          // The finale: up and up over the summit, blazing.
          const t = clock - dive.at;
          goal.x = dive.x + Math.sin(t * 0.5) * Math.min(4, 1 + t * 0.4);
          goal.z = dive.z + Math.cos(t * 0.5) * Math.min(4, 1 + t * 0.4);
          goal.y = dive.y + Math.min(2.6, 0.8 + t * 0.3);
          speedCap = 6;
          rest = 1.15;
          break;
        }
        default:
          break;
      }

      // Steer: a velocity toward the goal, capped, approached smoothly (it
      // turns in arcs, overshoots a little, and settles).
      const gx = goal.x - body.x;
      const gy = goal.y - body.y;
      const gz = goal.z - body.z;
      const gd = Math.hypot(gx, gy, gz);
      const want = Math.min(speedCap, gd * 2.2 * stiff);
      const k = gd > 1e-5 ? want / gd : 0;
      const accel = Math.min(1, dt * 5 * stiff);
      vel.x += (gx * k - vel.x) * accel;
      vel.y += (gy * k - vel.y) * accel;
      vel.z += (gz * k - vel.z) * accel;
      body.x += vel.x * dt;
      body.y += vel.y * dt;
      body.z += vel.z * dt;
      if (mode !== "soar") collide();

      // Flutter: small, uneven, alive; calmer when settled, livelier in flight.
      const speed = Math.hypot(vel.x, vel.z);
      const settle = mode === "sunset" ? 0.25 : mode === "dive" || mode === "soar" ? 0.4 : 1;
      const amp = (0.09 + Math.min(0.08, speed * 0.012)) * settle;
      out.x = body.x + (Math.sin(clock * 1.31 + phase[0]) + 0.5 * Math.sin(clock * 3.7 + phase[2])) * amp;
      out.y = body.y + (Math.sin(clock * 1.73 + phase[1]) + 0.4 * Math.sin(clock * 5.3 + phase[3])) * amp * 0.8;
      out.z = body.z + (Math.cos(clock * 1.13 + phase[2]) + 0.5 * Math.sin(clock * 4.1 + phase[0])) * amp;
      const floor = surface(out.x, out.z) + (mode === "hide" ? 0.05 : 0.12);
      if (out.y < floor) out.y = floor;

      // Glow: steady by day, more at night, brighter with each gift woken;
      // flares decay.
      flare *= Math.exp(-dt * 1.6);
      const breathe = 1 + 0.06 * Math.sin(clock * 2.1 + phase[3]);
      const aim = rest * (1 + 0.03 * (ctx.gifts ?? 0)) * breathe + flare;
      glow += (aim - glow) * Math.min(1, dt * (rest < 0.2 ? 6 : 3));
      return mind;
    },
    // Distance from the wisp to (x, z), for tests and the thread.
    distanceTo(x, z) {
      return Math.hypot(out.x - x, out.z - z);
    },
    // Line of sight from (x, y, z) to the wisp, past trunks.
    seenFrom(x, z) {
      return grid.clearLine(x, z, out.x, out.z);
    },
  };

  // A spot hopLength further on from the cat toward the target, clear of
  // trunks and boulders, inside the swim limit, and with nothing between it
  // and the cat (so it can be seen waiting). Tries a fan of bearings.
  // Bearings to try, straight on first; a reroute starts wider, on
  // alternating sides.
  const FANS = [
    [0, 0.3, -0.3, 0.6, -0.6, 0.9, -0.9],
    [0.7, -0.7, 1.1, -1.1, 1.5, -1.5, 0],
    [-0.7, 0.7, -1.1, 1.1, -1.5, 1.5, 0],
  ];
  function choosePerch(cat, to, hopLength, attempt = 0) {
    // A walkable way to the target, found once per target (and again when
    // the cat strays from it or gets stuck); the perch is hopLength along it.
    if (attempt > 0) route = null;
    else if (!route || routeFor !== to || offRoute(cat)) {
      route = routes.find(cat.x, cat.z, to.x, to.z);
      routeFor = to;
      routeAt = 0;
    }
    if (route && attempt === 0 && perchAlong(cat, hopLength)) return;
    const dx = to.x - cat.x;
    const dz = to.z - cat.z;
    const d = Math.hypot(dx, dz) || 1;
    const base = Math.atan2(dx, dz);
    const length = Math.min(hopLength, d);
    let chosen = false;
    const fan = FANS[attempt === 0 ? 0 : 1 + (attempt % 2)];
    for (let pass = 0; pass < 2 && !chosen; pass++)
      for (const turn of fan) {
        const a = base + turn;
        let x = cat.x + Math.sin(a) * length;
        let z = cat.z + Math.cos(a) * length;
        ({ x, z } = keepInside(x, z));
        ({ x, z } = clearOf(x, z, 0.6));
        if (!grid.clearLine(cat.x, cat.z, x, z)) continue;
        // The first pass also wants a way a cat can walk.
        if (pass === 0 && !walkable(cat.x, cat.z, x, z)) continue;
        perch.x = x;
        perch.z = z;
        chosen = true;
        break;
      }
    if (!chosen) {
      const p = keepInside(cat.x + (dx / d) * length * 0.5, cat.z + (dz / d) * length * 0.5);
      const q = clearOf(p.x, p.z, 0.6);
      perch.x = q.x;
      perch.z = q.z;
    }
    perch.set = true;
    perchBest = Math.hypot(perch.x - cat.x, perch.z - cat.z);
    perchBestAt = clock;
  }

  // The route's point nearest the cat, searched forward from the last.
  function nearestOnRoute(cat) {
    let best = routeAt;
    let bestD = Infinity;
    for (let i = routeAt; i < route.length / 2 && i < routeAt + 40; i++) {
      const d = Math.hypot(route[i * 2] - cat.x, route[i * 2 + 1] - cat.z);
      if (d < bestD) [best, bestD] = [i, d];
    }
    return { index: best, distance: bestD };
  }
  function offRoute(cat) {
    return nearestOnRoute(cat).distance > 6;
  }
  // The perch: hopLength along the route from the cat, drawn back until the
  // cat can see it. False if there is no such point.
  function perchAlong(cat, hopLength) {
    const near = nearestOnRoute(cat);
    routeAt = near.index;
    const n = route.length / 2;
    let left = hopLength;
    let x = route[routeAt * 2];
    let z = route[routeAt * 2 + 1];
    const points = [];
    for (let i = routeAt + 1; i < n && left > 0; i++) {
      const nx = route[i * 2];
      const nz = route[i * 2 + 1];
      const seg = Math.hypot(nx - x, nz - z);
      const t = seg > left ? left / seg : 1;
      x += (nx - x) * t;
      z += (nz - z) * t;
      left -= seg * t;
      points.push(x, z);
    }
    for (let k = points.length / 2 - 1; k >= 0; k--) {
      const px = points[k * 2];
      const pz = points[k * 2 + 1];
      if (Math.hypot(px - cat.x, pz - cat.z) < 2.5) break;
      if (!grid.clearLine(cat.x, cat.z, px, pz)) continue;
      const p = clearOf(px, pz, 0.45);
      perch.x = p.x;
      perch.z = p.z;
      perch.set = true;
      perchBest = Math.hypot(perch.x - cat.x, perch.z - cat.z);
      perchBestAt = clock;
      return true;
    }
    return false;
  }

  // No step up a cat could not take (a boulder's flank, a bank) on the
  // straight way from (ax, az) to (bx, bz), and no deep water past reach.
  function walkable(ax, az, bx, bz) {
    // Room for a cat between trunks (fence posts, a thicket).
    if (!grid.clearLine(ax, az, bx, bz, 0.3)) return false;
    const length = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(1, Math.ceil(length / 0.5));
    let h = surface(ax, az);
    for (let i = 1; i <= steps; i++) {
      const x = ax + ((bx - ax) * i) / steps;
      const z = az + ((bz - az) * i) / steps;
      if (shoreDistance(x, z) < -reach) return false;
      const next = surface(x, z);
      if (next - h > 0.32) return false;
      h = next;
    }
    return true;
  }

  function fidgetAround(dt, size) {
    nextFidget -= dt;
    if (nextFidget <= 0) {
      nextFidget = 0.9 + random() * 2.2;
      const a = random() * TAU;
      const r = size * (0.3 + random() * 0.7);
      fidget.x = Math.sin(a) * r;
      fidget.z = Math.cos(a) * r;
      fidget.y = (random() - 0.35) * size * 0.6;
    }
  }

  // Inside the swim limit (pulled back toward the island).
  function keepInside(x, z) {
    const inland = shoreDistance(x, z);
    if (inland >= -reach) {
      scratch.x = x;
      scratch.z = z;
      return scratch;
    }
    const dx = ISLAND.x - x;
    const dz = ISLAND.z - z;
    const r = Math.hypot(dx, dz) || 1;
    const pull = -reach - inland;
    scratch.x = x + (dx / r) * pull;
    scratch.z = z + (dz / r) * pull;
    return scratch;
  }

  // Out of any trunk (and, for a place to wait, boulder) circle.
  function clearOf(x, z, margin) {
    for (let pass = 0; pass < 3; pass++) {
      let moved = false;
      for (const o of grid.near(x, z)) {
        const r = o.r + margin;
        const dx = x - o.x;
        const dz = z - o.z;
        const d = Math.hypot(dx, dz);
        if (d >= r) continue;
        const n = d > 1e-4 ? 1 / d : 1;
        x = o.x + (d > 1e-4 ? dx : 1) * n * r;
        z = o.z + (d > 1e-4 ? dz : 0) * n * r;
        moved = true;
      }
      if (!moved) break;
    }
    scratch.x = x;
    scratch.z = z;
    return scratch;
  }

  // The body never inside a trunk, below the ground or a boulder's top, or
  // past the swim limit.
  function collide() {
    // (Diving into its keepsake, it goes in.)
    for (const t of mode === "dive" ? NONE : grid.trunksAt(body.x, body.z)) {
      const r = t.r + WISP.clear;
      const dx = body.x - t.x;
      const dz = body.z - t.z;
      const d = Math.hypot(dx, dz);
      if (d >= r || body.y > t.top) continue;
      const n = d > 1e-4 ? 1 / d : 1;
      body.x = t.x + (d > 1e-4 ? dx : 1) * n * r;
      body.z = t.z + (d > 1e-4 ? dz : 0) * n * r;
      // Slide round it rather than stopping dead.
      const along = (vel.x * dx + vel.z * dz) * n;
      if (along < 0) {
        vel.x -= dx * n * along;
        vel.z -= dz * n * along;
      }
    }
    const p = keepInside(body.x, body.z);
    body.x = p.x;
    body.z = p.z;
    const floor = Math.max(surface(body.x, body.z), shoreDistance(body.x, body.z) < 0 ? 0.35 : -Infinity) + (mode === "hide" || mode === "dive" ? 0.06 : 0.18);
    if (body.y < floor) {
      body.y = floor;
      if (vel.y < 0) vel.y = 0;
    }
  }

  return mind;
}

function isAnimal(kind) {
  return kind === "penguin" || kind === "seal" || kind === "whale" || kind === "tortoise" || kind === "dassie" || kind === "gull";
}

// Trunks (with a rough top: the trunk-to-height ratio forest.js uses) and
// boulder domes, bucketed in 4 m cells.
function obstacleGrid({ trunks = [], domes = [] }) {
  const cell = 4;
  const cells = new Map();
  const empty = [];
  const add = (o, r) => {
    for (let i = Math.floor((o.x - r) / cell); i <= Math.floor((o.x + r) / cell); i++)
      for (let j = Math.floor((o.z - r) / cell); j <= Math.floor((o.z + r) / cell); j++) {
        const key = i * 4096 + j;
        let c = cells.get(key);
        if (!c) cells.set(key, (c = { trunks: [], all: [] }));
        c.all.push(o);
        if (o.top !== undefined) c.trunks.push(o);
      }
  };
  for (const t of trunks) {
    // Tall as its girth says (forest.js: r = height × 0.034 + 0.02), plus its crown.
    const height = Math.max(2, (t.r - 0.02) / 0.034);
    add({ x: t.x, z: t.z, r: t.r, top: groundHeight(t.x, t.z) + height * 1.05 }, t.r + 1);
  }
  for (const d of domes) add({ x: d.x, z: d.z, r: d.r }, d.r + 1);
  const at = (x, z) => cells.get(Math.floor(x / cell) * 4096 + Math.floor(z / cell));
  return {
    near(x, z) {
      return at(x, z)?.all ?? empty;
    },
    trunksAt(x, z) {
      return at(x, z)?.trunks ?? empty;
    },
    // Is the straight line (ax, az) → (bx, bz) clear of trunks?
    clearLine(ax, az, bx, bz, margin = 0) {
      const dx = bx - ax;
      const dz = bz - az;
      const length = Math.hypot(dx, dz);
      const steps = Math.max(1, Math.ceil(length / cell));
      const seen = new Set();
      for (let s = 0; s <= steps; s++) {
        const c = at(ax + (dx * s) / steps, az + (dz * s) / steps);
        if (!c) continue;
        for (const t of c.trunks) {
          if (seen.has(t)) continue;
          seen.add(t);
          // Closest approach of the segment to the trunk's centre.
          const u = length > 1e-6 ? Math.max(0, Math.min(1, ((t.x - ax) * dx + (t.z - az) * dz) / (length * length))) : 0;
          // Heading away from a trunk it starts beside is fine.
          if (u === 0 && margin > 0) continue;
          const px = ax + dx * u - t.x;
          const pz = az + dz * u - t.z;
          if (px * px + pz * pz < (t.r + margin) * (t.r + margin)) return false;
        }
      }
      return true;
    },
  };
}
