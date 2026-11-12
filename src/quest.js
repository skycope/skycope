// The quest: the island keeps six gifts, one in each keepsake place
// (magic.js KEEPSAKES), and the wisp leads the cat to them, nearest first.
// Reaching a sleeping keepsake starts its waking (the ceremony thread.js
// stages); once all six are awake the wisp leads to the summit and the
// finale wakes. Pure: no DOM, no audio, no three.js. Which gifts this seed
// has woken persists in storage beside the discoveries, and "begin again"
// puts them all back to sleep.
import { GIFTS, KEEPSAKES } from "./magic.js";

const PREFIX = "skycope.gifts.";
// Where the finale wakes: the trig beacon on the summit, or the hilltop.
const SUMMIT = "beacon";

// places: places.js pois ({ id, title, x, z, r }); summit: { x, z, r } for
// the finale when there is no beacon. magic: createMagic().
export function createQuest({ seed, places = [], magic, storage = defaultStorage(), summit = null } = {}) {
  const key = PREFIX + seed;
  const keepsakes = places.filter((p) => p && KEEPSAKES[p.id] && Number.isFinite(p.x) && Number.isFinite(p.z)).map((p) => ({ ...p, gift: KEEPSAKES[p.id], r: p.r > 0 ? p.r : 4 }));
  const beacon = keepsakes.find((k) => k.id === SUMMIT);
  const finaleSite = beacon
    ? { id: SUMMIT, title: beacon.title, x: beacon.x, z: beacon.z, r: beacon.r, gift: "finale" }
    : summit
      ? { id: "summit", title: "the hilltop", x: summit.x, z: summit.z, r: summit.r ?? 5, gift: "finale" }
      : null;
  // What this seed woke on earlier visits (not what `?magic=` forced).
  const woken = new Set(read(storage, key).filter((g) => GIFTS.includes(g) || g === "finale"));
  for (const gift of woken) magic.wake(gift, { quiet: true });
  // A keepsake reached and waiting for its ceremony to wake it.
  let pending = null;

  const asleep = (k) => !magic.isAwake(k.gift);
  const save = () => write(storage, key, [...woken]);

  function nearestSleeping(x, z) {
    let best = null;
    let bestD = Infinity;
    for (const k of keepsakes) {
      if (!asleep(k)) continue;
      const d = Math.hypot(k.x - x, k.z - z);
      if (d < bestD) [best, bestD] = [k, d];
    }
    return best;
  }

  return {
    keepsakes,
    finaleSite,
    // Where the wisp should lead from (x, z): the nearest sleeping
    // keepsake; the summit once all six are awake; null once the finale is.
    target(x, z) {
      if (pending) return pending;
      const next = nearestSleeping(x, z);
      if (next) return next;
      if (finaleSite && magic.allAwake && !magic.isAwake("finale")) return finaleSite;
      return null;
    },
    // A few times a second, with the cat's pose: has it reached somewhere
    // whose gift sleeps? Returns { type: "wake", place } (a keepsake) or
    // { type: "finale", place } once, and holds it pending until wake().
    // `busy`: a ceremony is still playing (nothing new starts).
    update(pose, { busy = false } = {}) {
      if (pending || busy || !pose) return null;
      for (const k of keepsakes) {
        if (!asleep(k)) continue;
        if (Math.hypot(pose.x - k.x, pose.z - k.z) < k.r) {
          pending = k;
          return { type: "wake", place: k };
        }
      }
      if (finaleSite && magic.allAwake && !magic.isAwake("finale") && Math.hypot(pose.x - finaleSite.x, pose.z - finaleSite.z) < finaleSite.r) {
        pending = finaleSite;
        return { type: "finale", place: finaleSite };
      }
      return null;
    },
    get pending() {
      return pending;
    },
    // The ceremony's moment: the pending gift wakes (listeners hear it) and
    // is remembered.
    wake() {
      if (!pending) return null;
      const place = pending;
      pending = null;
      magic.wake(place.gift);
      woken.add(place.gift);
      save();
      return place.gift;
    },
    // Gifts awake out of six (the finale is not counted).
    get count() {
      return GIFTS.filter((g) => magic.isAwake(g)).length;
    },
    get done() {
      return magic.isAwake("finale");
    },
    // Every gift back to sleep; the wisp starts over.
    beginAgain() {
      pending = null;
      woken.clear();
      save();
      for (const gift of [...GIFTS, "finale"]) magic.sleep(gift);
      magic.pulse = null;
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
