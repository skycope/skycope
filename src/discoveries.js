// Discoveries: the gentle thread through the island. Places, creatures and
// moments are data (`{ id, title, x, z, r, kind? }`, coast metres); the cat
// finds one by coming within r of it, or, for a moment, by `when(context)`
// holding for `hold` seconds. An animal with a place is found face to face
// (the animal is the cat's near interest), not by walking past its home. Found ids persist per seed in localStorage (the
// island's own shape is the same on every seed, so its places and the sky's
// moments use the shared "island" scope instead). Nothing here touches the
// DOM: the field-notes panel only ever sees `list()`, which never carries the
// title of something not yet found.
import { ISLAND, shoreDistance, terrainHeight } from "./terrain.js";

const PREFIX = "skycope.found.";
const CHECK_SECONDS = 0.25;

export function createDiscoveries({ seed, signal, onFind = () => {}, storage = defaultStorage(), interval = CHECK_SECONDS } = {}) {
  const entries = new Map();
  // What storage says was found, including ids nobody has registered yet:
  // a landmark added later by another module is restored as found.
  const remembered = { seed: read(storage, PREFIX + seed), island: read(storage, PREFIX + "island") };
  let lastCheck = -Infinity;
  let nearest = null;
  let nearestDistance = Infinity;
  let stopped = false;
  signal?.addEventListener?.("abort", () => (stopped = true), { once: true });
  // Another tab finding something: take its notes too.
  globalThis.addEventListener?.(
    "storage",
    (event) => {
      if (event.key !== PREFIX + seed && event.key !== PREFIX + "island") return;
      const scope = event.key === PREFIX + seed ? "seed" : "island";
      remembered[scope] = read(storage, event.key);
      for (const entry of entries.values())
        if (entry.found === null && scopeOf(entry.poi) === scope && remembered[scope][entry.poi.id]) entry.found = remembered[scope][entry.poi.id];
    },
    signal ? { signal } : undefined,
  );

  function mark(entry, at) {
    entry.found = at;
    const scope = scopeOf(entry.poi);
    remembered[scope][entry.poi.id] = at;
    write(storage, PREFIX + (scope === "seed" ? seed : "island"), remembered[scope]);
    onFind({ id: entry.poi.id, title: entry.poi.title, kind: entry.poi.kind ?? "place", at });
  }

  return {
    // Registers points of interest; ids already registered are ignored.
    // Returns the ids that were new.
    add(pois) {
      const added = [];
      for (const poi of pois ?? []) {
        if (!poi || typeof poi.id !== "string" || typeof poi.title !== "string" || entries.has(poi.id)) continue;
        const positional = Number.isFinite(poi.x) && Number.isFinite(poi.z);
        if (!positional && typeof poi.when !== "function") continue;
        const r = Number.isFinite(poi.r) && poi.r > 0 ? poi.r : 3;
        const faceToFace = !poi.when && positional && poi.kind === "creature";
        entries.set(poi.id, {
          poi,
          positional,
          when: faceToFace ? (c) => Boolean(c.interest?.near && c.interest.kind && poi.id.startsWith(c.interest.kind)) : poi.when,
          r2: r * r,
          held: 0,
          found: remembered[scopeOf(poi)][poi.id] ?? null,
        });
        added.push(poi.id);
      }
      return added;
    },
    // A few times a second (not per frame): is the cat at, or in, anything
    // new? `pose` is walker.cat; `context` whatever the `when` tests read
    // (celestial, weather, interest, spectacles...).
    update(pose, time, context = {}) {
      if (stopped || !pose) return false;
      const step = time - lastCheck;
      if (step >= 0 && step < interval) return false;
      lastCheck = time;
      const held = step > 0 && step < 2 ? step : interval;
      const ctx = { ...context, pose };
      let best = Infinity;
      nearest = null;
      for (const entry of entries.values()) {
        if (entry.found !== null) continue;
        const { poi } = entry;
        let inside = true;
        let d2 = Infinity;
        if (entry.positional) {
          const dx = pose.x - poi.x;
          const dz = pose.z - poi.z;
          d2 = dx * dx + dz * dz;
          inside = d2 < entry.r2;
        }
        if (inside && entry.when) {
          try {
            inside = Boolean(entry.when(ctx));
          } catch {
            inside = false;
          }
        }
        entry.held = inside ? entry.held + held : 0;
        if (inside && entry.held >= (poi.hold ?? 0)) mark(entry, Date.now());
        else if (d2 < best) {
          best = d2;
          nearest = entry;
        }
      }
      nearestDistance = nearest ? Math.sqrt(best) : Infinity;
      return true;
    },
    // Marks a registered discovery found directly (e.g. from an event).
    find(id) {
      const entry = entries.get(id);
      if (!entry || entry.found !== null) return false;
      mark(entry, Date.now());
      return true;
    },
    isFound(id) {
      return (entries.get(id)?.found ?? null) !== null;
    },
    // The field notes: found entries (oldest first) with their titles, then
    // the unfound as bare placeholders. Unfound titles are never included.
    list() {
      const found = [];
      const unfound = [];
      for (const { poi, found: at } of entries.values()) {
        if (at !== null) found.push({ id: poi.id, found: true, title: poi.title, kind: poi.kind ?? "place", at });
        else unfound.push({ found: false });
      }
      found.sort((a, b) => a.at - b.at);
      return [...found, ...unfound];
    },
    get counts() {
      let found = 0;
      for (const entry of entries.values()) if (entry.found !== null) found++;
      return { found, total: entries.size };
    },
    // The nearest unfound place (positional only) at the last check: where
    // the cat's attention can drift. Never its title.
    nearest() {
      if (!nearest) return null;
      return { x: nearest.poi.x, z: nearest.poi.z, distance: nearestDistance };
    },
  };
}

function scopeOf(poi) {
  return poi.scope === "island" ? "island" : "seed";
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
    const value = JSON.parse(storage?.getItem(key) ?? "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function write(storage, key, value) {
  try {
    storage?.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode or a full quota: the notes last this visit only.
  }
}

// ---------------------------------------------------------------------------
// The island's own discoveries, from things that exist without any landmark
// module: its high ground, and moments of sky, weather and cat. (Only what
// answers or can be seen: no names for empty stretches of shore or sea.)
export function islandDiscoveries() {
  const pois = [];
  const hill = highestGround();
  pois.push({ id: "hilltop", title: "the hilltop", kind: "place", scope: "island", x: hill.x, z: hill.z, r: 5 });

  const sitting = (c) => c.pose.sit > 0.9;
  const asleep = (c) => c.pose.sit > 0.95 && c.pose.sleepy > 0.3;
  const sunAlt = (c) => c.celestial?.sunAltitude ?? 90;
  const moonAlt = (c) => (Math.asin(Math.max(-1, Math.min(1, c.celestial?.moon?.[1] ?? -1))) * 180) / Math.PI;
  const night = (c) => (c.celestial?.scene ?? 0) > 1.6;
  const near = (kind) => (c) => c.interest?.kind === kind && c.interest.near;
  pois.push(
    { id: "sunset", title: "the sun going down", kind: "moment", scope: "island", hold: 12, when: (c) => sunAlt(c) < 2 && sunAlt(c) > -3 && (c.celestial?.sunAzimuth ?? 0) > 180 && sitting(c) },
    { id: "first-light", title: "first light", kind: "moment", scope: "island", hold: 6, when: (c) => sunAlt(c) < 3 && sunAlt(c) > -2 && (c.celestial?.sunAzimuth ?? 360) < 180 && sitting(c) },
    { id: "moonrise", title: "the moon coming up", kind: "moment", scope: "island", hold: 10, when: (c) => (c.celestial?.scene ?? 0) > 1 && moonAlt(c) > -0.5 && moonAlt(c) < 8 && (c.celestial?.moon?.[0] ?? -1) > 0 && sitting(c) },
    { id: "stars", title: "a sky full of stars", kind: "moment", scope: "island", hold: 10, when: (c) => (c.celestial?.scene ?? 0) > 1.85 && (c.weather?.cover ?? 0) < 0.3 && sitting(c) },
    { id: "glowing-sea", title: "the sea, glowing", kind: "moment", scope: "island", hold: 1.5, when: (c) => night(c) && c.pose.wade > 0.15 },
    { id: "rain", title: "out in the rain", kind: "moment", scope: "island", hold: 20, when: (c) => (c.weather?.rain ?? 0) > 0.5 },
    { id: "nap", title: "forty winks", kind: "moment", scope: "island", hold: 3, when: asleep },
    { id: "crab", title: "a ghost crab", kind: "creature", scope: "island", when: near("crab") },
    { id: "butterfly", title: "a butterfly", kind: "creature", scope: "island", when: near("butterfly") },
    { id: "gulls", title: "the gulls at the tideline", kind: "creature", scope: "island", when: near("gull") },
  );
  return pois;
}

// A `when` for a sky spectacle (sky-events' skySpectacles() list: entries
// with an id and a 0…1 `visible`): found while one is plainly in view.
export function spectacleSeen(id, threshold = 0.5) {
  return (c) => (c.spectacles ?? []).some((s) => s?.id === id && (s.visible ?? 1) >= threshold);
}

function highestGround() {
  let best = { x: ISLAND.x, z: ISLAND.z, y: -Infinity };
  for (let x = ISLAND.x - 90; x <= ISLAND.x + 90; x += 1.5)
    for (let z = ISLAND.z - 90; z <= ISLAND.z + 90; z += 1.5) {
      if (shoreDistance(x, z) < 6) continue;
      const y = terrainHeight(x, z);
      if (y > best.y) best = { x, z, y };
    }
  return best;
}
