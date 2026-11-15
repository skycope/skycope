// The quest: a small light has fallen onto a dark island, and it leads the
// cat to the island's old lights (magic.js KEEPSAKES) so they can light
// them together, each one lifting it a little higher. First the home
// lantern on the beach (the lesson), then the five lights, nearest first
// but weighted by the hour so the first a visitor lights is one whose
// effect shows now (story-and-wow.md section 2, "order"); then the summit,
// where the cat sits on the cairn and the ending begins. Pure: no DOM, no
// audio, no three.js. Which lights this seed has lit, and in what order,
// persists in storage, and "begin again" puts them all out.
import { GIFTS, LIGHTS, KEEPSAKES } from "./magic.js";

const PREFIX = "skycope.gifts.";
// Where the ending starts: the trig beacon on the summit.
const SUMMIT = "beacon";
// A keepsake's heart can be hard to reach (a hull, a rock pool): close is
// enough. (Until each light wakes on its own act, story step 4.)
const REACH_SLACK = 1.5;
const slack = (r) => Math.max(REACH_SLACK, r * 0.45);
// The ending: sitting this long on the cairn's top, this near the pillar.
export const ENDING_SIT = { seconds: 1.5, r: 2.4 };

// Distance weights by the hour (story-and-wow.md section 2): by day the
// boat (a boat to sail in daylight); by night the wreck (a glowing shore).
export const WEIGHT = {
  boat: { day: 0.6, night: 1.0 },
  seafolk: { day: 0.8, night: 1.3 },
  fireflies: { day: 1.0, night: 0.8 },
  lamp: { day: 1.0, night: 0.9 },
  tideglow: { day: 1.6, night: 0.6 },
};

// places: places.js pois ({ id, title, x, z, r }). home: the home lantern
// ({ x, z }) or null. magic: createMagic().
export function createQuest({ seed, places = [], magic, storage = defaultStorage(), home = null } = {}) {
  const key = PREFIX + seed;
  const keepsakes = places.filter((p) => p && KEEPSAKES[p.id] && Number.isFinite(p.x) && Number.isFinite(p.z)).map((p) => ({ ...p, gift: KEEPSAKES[p.id], r: p.r > 0 ? p.r : 4 }));
  const beacon = places.find((p) => p?.id === SUMMIT && Number.isFinite(p.x));
  const summit = beacon ? { id: SUMMIT, title: beacon.title, x: beacon.x, z: beacon.z, r: ENDING_SIT.r, gift: "finale" } : null;
  const lantern = home && Number.isFinite(home.x) ? { id: "home", title: "the home lantern", x: home.x, z: home.z, r: 2, gift: "home" } : null;
  // What this seed lit on earlier visits, in the order it was lit (not
  // what `?magic=` forced).
  const valid = (g) => GIFTS.includes(g) || g === "home" || g === "finale";
  const woken = new Set(read(storage, key).filter(valid));
  for (const gift of woken) magic.wake(gift, { quiet: true });
  // A keepsake reached and waiting for its ceremony to wake it.
  let pending = null;
  let sat = 0;

  const asleep = (k) => !magic.isAwake(k.gift);
  const save = () => write(storage, key, [...woken]);

  function nearestUnlit(x, z, night) {
    let best = null;
    let bestD = Infinity;
    const when = night > 0.5 ? "night" : "day";
    for (const k of keepsakes) {
      if (!asleep(k)) continue;
      const d = Math.hypot(k.x - x, k.z - z) * (WEIGHT[k.gift]?.[when] ?? 1);
      if (d < bestD) [best, bestD] = [k, d];
    }
    return best;
  }

  function light(place) {
    magic.wake(place.gift);
    woken.add(place.gift);
    save();
    return place.gift;
  }

  return {
    keepsakes,
    summit,
    home: lantern,
    // Where the wisp should lead from (x, z): the home lantern first; then
    // the nearest unlit light, weighted by the hour (`night` 0…1); the
    // summit once all five are lit; null once the ending has happened.
    target(x, z, night = 0) {
      if (pending) return pending;
      if (lantern && !magic.isAwake("home")) return lantern;
      const next = nearestUnlit(x, z, night);
      if (next) return next;
      if (summit && magic.allLit && !magic.isAwake("finale")) return summit;
      return null;
    },
    // A few times a second, with the cat's pose: has it reached a light
    // that is out? Returns { type: "wake", place } (a keepsake) or, once
    // all five are lit and the cat has sat on the cairn top for
    // ENDING_SIT.seconds, { type: "ending", place }; held pending until
    // wake(). `busy`: a ceremony is still playing. `dt`: seconds since the
    // last call. (The home lantern is lit by the journey: it needs the
    // wisp waiting at it.)
    update(pose, { busy = false, dt = 0.25 } = {}) {
      if (pending || busy || !pose) return null;
      for (const k of keepsakes) {
        if (!asleep(k)) continue;
        if (Math.hypot(pose.x - k.x, pose.z - k.z) < k.r + slack(k.r)) {
          pending = k;
          return { type: "wake", place: k };
        }
      }
      if (summit && magic.allLit && !magic.isAwake("finale")) {
        const on = Math.hypot(pose.x - summit.x, pose.z - summit.z) < summit.r && (pose.sit ?? 0) > 0.85;
        sat = on ? sat + dt : 0;
        if (sat >= ENDING_SIT.seconds) {
          sat = 0;
          pending = summit;
          return { type: "ending", place: summit };
        }
      }
      return null;
    },
    // The public way to light something now, whatever the radius: the act
    // that wakes it ("home", a keepsake's id, or "beacon" for the ending
    // when all five are lit). Returns the event update() would, or null.
    act(id) {
      if (pending) return null;
      if (id === "home") return lantern && !magic.isAwake("home") ? { type: "home", place: lantern } : null;
      if (id === SUMMIT) {
        if (!summit || !magic.allLit || magic.isAwake("finale")) return null;
        pending = summit;
        return { type: "ending", place: summit };
      }
      const k = keepsakes.find((p) => p.id === id || p.gift === id);
      if (!k || !asleep(k)) return null;
      pending = k;
      return { type: "wake", place: k };
    },
    get pending() {
      return pending;
    },
    // The ceremony's moment: the pending light is lit (listeners hear it)
    // and remembered. The ending lights the sky itself (`stars`) and the
    // ending's own flag (`finale`).
    wake() {
      if (!pending) return null;
      const place = pending;
      pending = null;
      if (place.gift === "finale") {
        magic.wake("stars");
        woken.add("stars");
      }
      return light(place);
    },
    // The home lantern, lit when the cat comes to it with the wisp there.
    lightHome() {
      if (!lantern || magic.isAwake("home")) return false;
      light(lantern);
      return true;
    },
    // How many lights are lit, the home lantern included (0…6).
    get lit() {
      return (magic.isAwake("home") ? 1 : 0) + LIGHTS.filter((g) => magic.isAwake(g)).length;
    },
    // The five lights below lit (0…5).
    get count() {
      return LIGHTS.filter((g) => magic.isAwake(g)).length;
    },
    // In the order the visitor lit them (home first), for the ending's
    // answer; forced ones (`?magic=`) after, in table order.
    get order() {
      const all = ["home", ...LIGHTS];
      const lit = [...woken].filter((g) => all.includes(g) && magic.isAwake(g));
      return [...lit, ...all.filter((g) => magic.isAwake(g) && !woken.has(g))];
    },
    get done() {
      return magic.isAwake("finale");
    },
    // Every light out, the star out of the sky; the next load opens with
    // the fall.
    beginAgain() {
      pending = null;
      woken.clear();
      save();
      for (const gift of [...GIFTS, "home", "finale"]) magic.sleep(gift);
      magic.waking = null;
      magic.ending = null;
    },
  };
}

function defaultStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function read(storage, key) {
  try {
    const value = JSON.parse(storage?.getItem(key) ?? "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function write(storage, key, value) {
  try {
    storage?.setItem(key, JSON.stringify(value));
  } catch {
    // This visit only.
  }
}
