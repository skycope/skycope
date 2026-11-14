import test from "node:test";
import assert from "node:assert/strict";
import { createDiscoveries, islandDiscoveries, spectacleSeen } from "../src/discoveries.js";

function fakeStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
  };
}

const pose = (x, z, extra = {}) => ({ x, z, y: 0, sit: 0, sleepy: 0, swim: 0, wade: 0, ...extra });

test("a place is found within its radius, not outside it", () => {
  const found = [];
  const d = createDiscoveries({ seed: 7, storage: fakeStorage(), onFind: (f) => found.push(f.id) });
  d.add([{ id: "wreck", title: "the old wreck", x: 10, z: 10, r: 4 }]);
  d.update(pose(15, 10), 0);
  assert.deepEqual(found, []);
  d.update(pose(13.9, 10), 1);
  assert.deepEqual(found, ["wreck"]);
  d.update(pose(10, 10), 2);
  assert.deepEqual(found, ["wreck"], "found once");
});

test("checks are throttled to a few times a second", () => {
  const found = [];
  const d = createDiscoveries({ seed: 7, storage: fakeStorage(), onFind: (f) => found.push(f.id) });
  d.add([{ id: "a", title: "a", x: 0, z: 0, r: 1 }]);
  assert.equal(d.update(pose(50, 50), 0), true);
  assert.equal(d.update(pose(0, 0), 0.1), false, "skipped: too soon");
  assert.deepEqual(found, []);
  assert.equal(d.update(pose(0, 0), 0.3), true);
  assert.deepEqual(found, ["a"]);
});

test("an animal is found face to face, not by passing its home", () => {
  const found = [];
  const d = createDiscoveries({ seed: 1, storage: fakeStorage(), onFind: (f) => found.push(f.id) });
  d.add([{ id: "tortoise", title: "tortoise", kind: "creature", x: 0, z: 0, r: 4 }]);
  d.update(pose(1, 1), 0, { interest: null });
  d.update(pose(1, 1), 1, { interest: { kind: "butterfly", near: true } });
  assert.deepEqual(found, [], "in range, but nothing face to face");
  d.update(pose(1, 1), 2, { interest: { kind: "tortoise", near: true } });
  assert.deepEqual(found, ["tortoise"]);
});

test("moments must hold for their time", () => {
  const found = [];
  const d = createDiscoveries({ seed: 1, storage: fakeStorage(), onFind: (f) => found.push(f.id) });
  d.add([{ id: "rain", title: "out in the rain", hold: 2, when: (c) => c.weather.rain > 0.5 }]);
  let t = 0;
  for (; t < 1.5; t += 0.25) d.update(pose(0, 0), t, { weather: { rain: 2 } });
  assert.deepEqual(found, []);
  d.update(pose(0, 0), t, { weather: { rain: 0 } });
  for (t += 0.25; t < 3; t += 0.25) d.update(pose(0, 0), t, { weather: { rain: 2 } });
  assert.deepEqual(found, [], "the hold restarts when the moment is broken");
  for (; t < 4; t += 0.25) d.update(pose(0, 0), t, { weather: { rain: 2 } });
  assert.deepEqual(found, ["rain"]);
});

test("persistence is per seed; island-scoped finds carry across seeds", () => {
  const storage = fakeStorage();
  const pois = [
    { id: "wreck", title: "the old wreck", x: 0, z: 0, r: 3 },
    { id: "hill", title: "the hilltop", x: 100, z: 0, r: 3, scope: "island" },
  ];
  const a = createDiscoveries({ seed: 11, storage });
  a.add(pois);
  a.update(pose(0, 0), 0);
  a.update(pose(100, 0), 1);
  assert.equal(a.counts.found, 2);
  // The same seed remembers both.
  const again = createDiscoveries({ seed: 11, storage });
  again.add(pois);
  assert.equal(again.isFound("wreck"), true);
  assert.equal(again.isFound("hill"), true);
  // Another seed: its own wreck is unfound; the island's hilltop is shared.
  const other = createDiscoveries({ seed: 12, storage });
  other.add(pois);
  assert.equal(other.isFound("wreck"), false);
  assert.equal(other.isFound("hill"), true);
  assert.ok(storage.data.has("skycope.found.11"));
  assert.ok(storage.data.has("skycope.found.island"));
});

test("a landmark registered later is restored as found", () => {
  const storage = fakeStorage({ "skycope.found.3": JSON.stringify({ lighthouse: 1700000000000 }) });
  const d = createDiscoveries({ seed: 3, storage });
  d.add([{ id: "lighthouse", title: "the lighthouse", x: 0, z: 0, r: 2 }]);
  assert.equal(d.isFound("lighthouse"), true);
});

test("broken or missing storage never throws", () => {
  const throwing = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("full"); } };
  const d = createDiscoveries({ seed: 1, storage: throwing });
  d.add([{ id: "a", title: "a", x: 0, z: 0, r: 1 }]);
  d.update(pose(0, 0), 0);
  assert.equal(d.isFound("a"), true);
  const corrupt = createDiscoveries({ seed: 1, storage: fakeStorage({ "skycope.found.1": "{not json" }) });
  corrupt.add([{ id: "a", title: "a", x: 0, z: 0, r: 1 }]);
  assert.equal(corrupt.isFound("a"), false);
  const none = createDiscoveries({ seed: 1, storage: null });
  none.add([{ id: "a", title: "a", x: 0, z: 0, r: 1 }]);
  none.update(pose(0, 0), 0);
});

test("unfound titles are never exposed", () => {
  const d = createDiscoveries({ seed: 5, storage: fakeStorage() });
  d.add([
    { id: "wreck", title: "the old wreck", x: 0, z: 0, r: 3 },
    { id: "cave", title: "the secret sea cave", x: 50, z: 50, r: 3 },
    { id: "rainbow", title: "a double rainbow", when: () => false },
  ]);
  d.update(pose(0, 0), 0);
  const list = d.list();
  assert.equal(list.length, 1, "only the found");
  assert.deepEqual(list[0], { id: "wreck", found: true, title: "the old wreck", kind: "place", at: list[0].at });
  const text = JSON.stringify(list) + JSON.stringify(d.nearest()) + JSON.stringify(d.counts);
  assert.ok(!text.includes("secret"), "unfound place title leaked");
  assert.ok(!text.includes("rainbow"), "unfound moment title/id leaked");
  assert.ok(!text.includes("cave"), "unfound id leaked");
  // The nearest unfound place is a direction, not a name.
  assert.deepEqual(Object.keys(d.nearest()).sort(), ["distance", "x", "z"]);
});

test("invalid entries and duplicates are ignored; find() marks directly", () => {
  const found = [];
  const d = createDiscoveries({ seed: 1, storage: fakeStorage(), onFind: (f) => found.push(f) });
  const added = d.add([{ id: "a", title: "a", x: 0, z: 0 }, { id: "a", title: "again", x: 9, z: 9 }, { title: "no id", x: 0, z: 0 }, { id: "b", title: "nowhere" }, null]);
  assert.deepEqual(added, ["a"]);
  assert.equal(d.find("a"), true);
  assert.equal(d.find("a"), false);
  assert.equal(d.find("missing"), false);
  assert.equal(found[0].title, "a");
});

test("the island seeds its own discoveries, and none for empty places", () => {
  const pois = islandDiscoveries();
  const ids = pois.map((p) => p.id);
  for (const id of ["hilltop", "sunset", "moonrise", "rain", "nap", "crab", "butterfly"]) assert.ok(ids.includes(id), id);
  // Nothing that names an empty stretch of shore or sea, or an effect.
  for (const id of ["far-shore", "long-point", "deep-cove", "big-rock", "kelp", "fireflies"]) assert.ok(!ids.includes(id), id);
  // A nap, as the cat curls up.
  const d = createDiscoveries({ seed: 1, storage: fakeStorage() });
  d.add(pois);
  for (let t = 0; t < 4; t += 0.25) d.update(pose(1000, 1000, { sit: 1, sleepy: 0.5 }), t, {});
  assert.equal(d.isFound("nap"), true);
  // A crab, close.
  d.update(pose(1000, 1000), 5, { interest: { kind: "crab", near: true } });
  assert.equal(d.isFound("crab"), true);
});

test("a sky spectacle in view can be a discovery", () => {
  const d = createDiscoveries({ seed: 1, storage: fakeStorage() });
  d.add([{ id: "rainbow", title: "a rainbow", kind: "sky", when: spectacleSeen("rainbow") }]);
  d.update(pose(0, 0), 0, { spectacles: [{ id: "rainbow", visible: 0.2 }] });
  assert.equal(d.isFound("rainbow"), false);
  d.update(pose(0, 0), 1, { spectacles: [{ id: "rainbow", visible: 0.9 }] });
  assert.equal(d.isFound("rainbow"), true);
});
