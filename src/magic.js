// The island's awakenings: the one shared record of which of its gifts the
// cat has woken, as eased levels (0 asleep … 1 awake) that every layer reads.
// Finding a keepsake place wakes its gift, and the world is different from
// then on. The quest (thread.js) decides when; the land, sea and sky decide
// what each gift looks like. Nothing here draws.
//
//   fireflies  the old milkwood: lights in the air that follow the cat
//   tideglow   the wreck: the sea and wet sand glow where anything stirs them
//   lamp       the lighthouse: its lamp is lit and sweeps the island
//   stars      the trig beacon: the sky leans close (figures, falling stars)
//   seafolk    the rock pool: the sea's animals come to the cat
//   boat       the fisherman's boat: it can be taken out on the water
//   finale     every gift awake: the island's own answer
export const GIFTS = ["fireflies", "tideglow", "lamp", "stars", "seafolk", "boat"];

// Which landmark (places.js poi id) keeps which gift.
export const KEEPSAKES = {
  milkwood: "fireflies",
  wreck: "tideglow",
  lighthouse: "lamp",
  beacon: "stars",
  pool: "seafolk",
  boat: "boat",
};

// `force`: gifts awake from the start (`?perf&magic=all` or a comma list).
export function createMagic({ force = [] } = {}) {
  const awake = new Set(force.filter((g) => GIFTS.includes(g) || g === "finale"));
  // Levels ease toward 0 or 1; `wakeAt` is the clock time each was woken
  // (-Infinity if it was already awake at load), for one-off ceremonies.
  const levels = Object.fromEntries([...GIFTS, "finale"].map((g) => [g, awake.has(g) ? 1 : 0]));
  const wakeAt = Object.fromEntries([...GIFTS, "finale"].map((g) => [g, awake.has(g) ? -Infinity : Infinity]));
  const listeners = new Set();
  let clock = 0;
  return {
    levels,
    wakeAt,
    get clock() {
      return clock;
    },
    isAwake: (gift) => awake.has(gift),
    get allAwake() {
      return GIFTS.every((g) => awake.has(g));
    },
    // Wake a gift now (ceremony: listeners hear it once) or restore it
    // silently from an earlier visit (`quiet`).
    wake(gift, { quiet = false } = {}) {
      if (!(gift in levels) || awake.has(gift)) return false;
      awake.add(gift);
      if (quiet) {
        levels[gift] = 1;
        wakeAt[gift] = -Infinity;
      } else {
        wakeAt[gift] = clock;
        for (const fn of listeners) fn(gift);
      }
      return true;
    },
    sleep(gift) {
      awake.delete(gift);
      if (gift in wakeAt) wakeAt[gift] = Infinity;
    },
    on(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    // Per frame: `time` is the scene clock (main.js state.time).
    update(dt, time = clock + dt) {
      clock = time;
      for (const gift in levels) {
        const target = awake.has(gift) ? 1 : 0;
        // A gift takes a few seconds to come fully awake.
        levels[gift] += (target - levels[gift]) * (1 - Math.exp(-Math.max(dt, 0) / 2.5));
        if (Math.abs(target - levels[gift]) < 1e-3) levels[gift] = target;
      }
    },
  };
}

export function parseMagicForce(search) {
  const params = new URLSearchParams(search);
  if (!params.has("perf")) return [];
  const value = params.get("magic");
  if (!value) return [];
  return value === "all" ? [...GIFTS, "finale"] : value.split(",");
}
