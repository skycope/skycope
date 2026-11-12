import test from "node:test";
import assert from "node:assert/strict";
import { createQuest } from "../src/quest.js";
import { createMagic, GIFTS, KEEPSAKES } from "../src/magic.js";
import { placesLayout } from "../src/place-layout.js";

function fakeStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return { data, getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)) };
}

const places = (seed) => placesLayout(seed).map(({ id, title, x, z, r }) => ({ id, title, x, z, r }));
const HOME = { x: 12.9, z: 9.3 };

// Walk the cat to each target in turn, as a visitor following the wisp would.
function playThrough(quest, start = HOME) {
  const order = [];
  let at = { ...start };
  for (let i = 0; i < 10; i++) {
    const t = quest.target(at.x, at.z);
    if (!t) break;
    at = { x: t.x, z: t.z };
    const event = quest.update(at);
    assert.ok(event, `reaching ${t.id} starts something`);
    order.push(event.type === "finale" ? "finale" : event.place.gift);
    quest.wake();
  }
  return order;
}

test("the wisp leads to the nearest sleeping keepsake, then the summit, then nowhere", () => {
  const magic = createMagic();
  const quest = createQuest({ seed: 1847, places: places(1847), magic, storage: fakeStorage() });
  assert.equal(quest.keepsakes.length, 6);
  const first = quest.target(HOME.x, HOME.z);
  const nearest = [...quest.keepsakes].sort((a, b) => Math.hypot(a.x - HOME.x, a.z - HOME.z) - Math.hypot(b.x - HOME.x, b.z - HOME.z))[0];
  assert.equal(first.id, nearest.id);
  const order = playThrough(quest);
  assert.equal(order.length, 7);
  assert.deepEqual([...order.slice(0, 6)].sort(), [...GIFTS].sort());
  assert.equal(order[6], "finale");
  assert.equal(quest.target(0, 0), null);
  assert.ok(quest.done);
});

test("each step goes to the nearest still asleep", () => {
  const magic = createMagic();
  const quest = createQuest({ seed: 3, places: places(3), magic, storage: fakeStorage() });
  let at = HOME;
  for (let i = 0; i < 6; i++) {
    const t = quest.target(at.x, at.z);
    for (const k of quest.keepsakes)
      if (!magic.isAwake(k.gift)) assert.ok(Math.hypot(t.x - at.x, t.z - at.z) <= Math.hypot(k.x - at.x, k.z - at.z) + 1e-9);
    at = t;
    quest.update(at);
    quest.wake();
  }
});

test("the finale only wakes with all six awake", () => {
  const magic = createMagic();
  const quest = createQuest({ seed: 1847, places: places(1847), magic, storage: fakeStorage() });
  const beacon = quest.finaleSite;
  // Wake five of six, ending at the summit: no finale yet.
  for (const k of quest.keepsakes.filter((k) => k.gift !== "boat")) {
    quest.update(k);
    quest.wake();
  }
  assert.equal(quest.update(beacon), null);
  assert.equal(magic.isAwake("finale"), false);
  assert.equal(quest.target(beacon.x, beacon.z).gift, "boat");
  const boat = quest.keepsakes.find((k) => k.gift === "boat");
  quest.update(boat);
  quest.wake();
  assert.equal(quest.target(boat.x, boat.z).gift, "finale");
  const event = quest.update(beacon);
  assert.equal(event.type, "finale");
  assert.equal(quest.wake(), "finale");
  assert.ok(magic.isAwake("finale"));
});

test("nothing new starts while a ceremony plays or one is pending", () => {
  const magic = createMagic();
  const quest = createQuest({ seed: 1847, places: places(1847), magic, storage: fakeStorage() });
  const [a] = quest.keepsakes;
  assert.equal(quest.update(a, { busy: true }), null);
  assert.ok(quest.update(a));
  assert.equal(quest.update(a), null, "pending");
  assert.equal(quest.target(0, 0), quest.pending, "the wisp stays on the pending place");
  assert.equal(magic.isAwake(a.gift), false, "not until the ceremony's moment");
  quest.wake();
  assert.ok(magic.isAwake(a.gift));
});

test("waking is remembered per seed, restored quietly, and begin again forgets", () => {
  const storage = fakeStorage();
  const heard = [];
  const magic = createMagic();
  magic.on((g) => heard.push(g));
  const quest = createQuest({ seed: 1847, places: places(1847), magic, storage });
  const [a, b] = quest.keepsakes;
  quest.update(a);
  quest.wake();
  quest.update(b);
  quest.wake();
  assert.deepEqual(heard, [a.gift, b.gift]);
  assert.deepEqual(JSON.parse(storage.getItem("skycope.gifts.1847")).sort(), [a.gift, b.gift].sort());

  // Another visit: restored without a ceremony.
  const again = createMagic();
  const heardAgain = [];
  again.on((g) => heardAgain.push(g));
  const quest2 = createQuest({ seed: 1847, places: places(1847), magic: again, storage });
  assert.ok(again.isAwake(a.gift) && again.isAwake(b.gift));
  assert.equal(again.levels[a.gift], 1);
  assert.deepEqual(heardAgain, []);
  assert.equal(quest2.count, 2);
  assert.ok(![a.id, b.id].includes(quest2.target(HOME.x, HOME.z).id));

  // Another seed knows nothing of it.
  const other = createMagic();
  createQuest({ seed: 9, places: places(9), magic: other, storage });
  assert.equal(GIFTS.some((g) => other.isAwake(g)), false);

  quest2.beginAgain();
  assert.equal(again.isAwake(a.gift), false);
  assert.deepEqual(JSON.parse(storage.getItem("skycope.gifts.1847")), []);
  const fresh = createMagic();
  createQuest({ seed: 1847, places: places(1847), magic: fresh, storage });
  assert.equal(GIFTS.some((g) => fresh.isAwake(g)), false);
});

test("forced gifts (?magic=) are not written as woken", () => {
  const storage = fakeStorage();
  const magic = createMagic({ force: ["lamp", "stars"] });
  const quest = createQuest({ seed: 5, places: places(5), magic, storage });
  const k = quest.keepsakes.find((k) => !magic.isAwake(k.gift));
  quest.update(k);
  quest.wake();
  assert.deepEqual(JSON.parse(storage.getItem("skycope.gifts.5")), [k.gift]);
});

test("same seed, same order", () => {
  const order = (seed) => playThrough(createQuest({ seed, places: places(seed), magic: createMagic(), storage: fakeStorage() }));
  assert.deepEqual(order(1847), order(1847));
  assert.deepEqual(order(77), order(77));
  for (const id of Object.keys(KEEPSAKES)) assert.ok(places(1847).some((p) => p.id === id), id);
});
