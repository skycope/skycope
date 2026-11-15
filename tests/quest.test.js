import test from "node:test";
import assert from "node:assert/strict";
import { createQuest, WEIGHT, ENDING_SIT } from "../src/quest.js";
import { createMagic, GIFTS, LIGHTS, KEEPSAKES } from "../src/magic.js";
import { placesLayout } from "../src/place-layout.js";

function fakeStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return { data, getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)) };
}

const places = (seed) => placesLayout(seed).map(({ id, title, x, z, r }) => ({ id, title, x, z, r }));
const HOME = { x: 12.9, z: 9.3 };
const LANTERN = { x: 18, z: 12 };

// Walk the cat to each target in turn, as a visitor following the wisp
// would: the home lantern first (lit by the journey), the five lights, then
// a sit on the cairn top.
function playThrough(quest, { start = HOME, night = 0 } = {}) {
  const order = [];
  let at = { ...start };
  for (let i = 0; i < 12; i++) {
    const t = quest.target(at.x, at.z, night);
    if (!t) break;
    at = { x: t.x, z: t.z };
    if (t.gift === "home") {
      assert.ok(quest.lightHome());
      order.push("home");
      continue;
    }
    let event = quest.update(at);
    if (!event && t.gift === "finale") for (let k = 0; k < 10 && !event; k++) event = quest.update({ ...at, sit: 1 }, { dt: 0.25 });
    assert.ok(event, `reaching ${t.id} starts something`);
    order.push(event.type === "ending" ? "ending" : event.place.gift);
    quest.wake();
  }
  return order;
}

test("the home lantern first, then the five lights, then the cairn, then nowhere", () => {
  const magic = createMagic();
  const quest = createQuest({ seed: 1847, places: places(1847), magic, storage: fakeStorage(), home: LANTERN });
  assert.equal(quest.keepsakes.length, 5, "the beacon keeps no light of its own");
  assert.equal(quest.target(HOME.x, HOME.z).gift, "home");
  const order = playThrough(quest);
  assert.equal(order.length, 7);
  assert.equal(order[0], "home");
  assert.deepEqual([...order.slice(1, 6)].sort(), [...LIGHTS].sort());
  assert.equal(order[6], "ending");
  assert.equal(quest.target(0, 0), null);
  assert.ok(quest.done);
  assert.ok(magic.isAwake("stars"), "the ending wakes the sky");
  assert.equal(quest.lit, 6);
});

test("each step goes to the nearest unlit, weighted by the hour", () => {
  for (const night of [0, 1]) {
    const magic = createMagic();
    const quest = createQuest({ seed: 3, places: places(3), magic, storage: fakeStorage() });
    const when = night ? "night" : "day";
    let at = HOME;
    for (let i = 0; i < 5; i++) {
      const t = quest.target(at.x, at.z, night);
      const cost = (k) => Math.hypot(k.x - at.x, k.z - at.z) * WEIGHT[k.gift][when];
      for (const k of quest.keepsakes) if (!magic.isAwake(k.gift)) assert.ok(cost(t) <= cost(k) + 1e-9);
      at = t;
      quest.update(at);
      quest.wake();
    }
  }
});

test("from home: the boat first by day, the wreck first by night (seed 1847)", () => {
  const q = (night) => createQuest({ seed: 1847, places: places(1847), magic: createMagic(), storage: fakeStorage() }).target(HOME.x, HOME.z, night).gift;
  assert.equal(q(0), "boat");
  assert.equal(q(1), "tideglow");
});

test("the ending needs all five lit and a sit on the cairn top", () => {
  const magic = createMagic();
  const quest = createQuest({ seed: 1847, places: places(1847), magic, storage: fakeStorage() });
  const summit = quest.summit;
  for (const k of quest.keepsakes.filter((k) => k.gift !== "boat")) {
    quest.update(k);
    quest.wake();
  }
  assert.equal(quest.update({ ...summit, sit: 1 }, { dt: 5 }), null);
  assert.equal(quest.act("beacon"), null);
  assert.equal(quest.target(summit.x, summit.z).gift, "boat");
  const boat = quest.keepsakes.find((k) => k.gift === "boat");
  quest.update(boat);
  quest.wake();
  assert.equal(quest.target(boat.x, boat.z).gift, "finale");
  // Standing on the top is not enough: the sit is the act.
  assert.equal(quest.update({ ...summit, sit: 0 }, { dt: 5 }), null);
  assert.equal(quest.update({ ...summit, sit: 1 }, { dt: ENDING_SIT.seconds / 2 }), null);
  const event = quest.update({ ...summit, sit: 1 }, { dt: ENDING_SIT.seconds / 2 });
  assert.equal(event.type, "ending");
  assert.equal(quest.wake(), "finale");
  assert.ok(magic.isAwake("finale") && magic.isAwake("stars"));
});

test("act() lights a place whatever the radius", () => {
  const magic = createMagic();
  const quest = createQuest({ seed: 1847, places: places(1847), magic, storage: fakeStorage() });
  const event = quest.act("lighthouse");
  assert.equal(event.place.gift, "lamp");
  assert.equal(quest.act("pool"), null, "one at a time");
  quest.wake();
  assert.ok(magic.isAwake("lamp"));
  assert.equal(quest.act("lighthouse"), null, "already lit");
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

test("lighting is remembered per seed and in order, restored quietly, and begin again forgets", () => {
  const storage = fakeStorage();
  const heard = [];
  const magic = createMagic();
  magic.on((g) => heard.push(g));
  const quest = createQuest({ seed: 1847, places: places(1847), magic, storage, home: LANTERN });
  quest.lightHome();
  const [a, b] = quest.keepsakes;
  quest.update(b);
  quest.wake();
  quest.update(a);
  quest.wake();
  assert.deepEqual(heard, ["home", b.gift, a.gift]);
  assert.deepEqual(JSON.parse(storage.getItem("skycope.gifts.1847")), ["home", b.gift, a.gift]);
  assert.deepEqual(quest.order, ["home", b.gift, a.gift]);

  // Another visit: restored without a ceremony.
  const again = createMagic();
  const heardAgain = [];
  again.on((g) => heardAgain.push(g));
  const quest2 = createQuest({ seed: 1847, places: places(1847), magic: again, storage, home: LANTERN });
  assert.ok(again.isAwake(a.gift) && again.isAwake(b.gift) && again.isAwake("home"));
  assert.equal(again.levels[a.gift], 1);
  assert.deepEqual(heardAgain, []);
  assert.equal(quest2.count, 2);
  assert.equal(quest2.lit, 3);
  assert.deepEqual(quest2.order, ["home", b.gift, a.gift]);
  assert.ok(![a.id, b.id, "home"].includes(quest2.target(HOME.x, HOME.z).id));

  // Another seed knows nothing of it.
  const other = createMagic();
  createQuest({ seed: 9, places: places(9), magic: other, storage });
  assert.equal([...GIFTS, "home"].some((g) => other.isAwake(g)), false);

  quest2.beginAgain();
  assert.equal(again.isAwake(a.gift), false);
  assert.equal(again.isAwake("home"), false);
  assert.deepEqual(JSON.parse(storage.getItem("skycope.gifts.1847")), []);
  const fresh = createMagic();
  createQuest({ seed: 1847, places: places(1847), magic: fresh, storage });
  assert.equal([...GIFTS, "home"].some((g) => fresh.isAwake(g)), false);
});

test("forced lights (?magic=) are not written as lit", () => {
  const storage = fakeStorage();
  const magic = createMagic({ force: ["lamp", "home"] });
  const quest = createQuest({ seed: 5, places: places(5), magic, storage });
  const k = quest.keepsakes.find((k) => !magic.isAwake(k.gift));
  quest.update(k);
  quest.wake();
  assert.deepEqual(JSON.parse(storage.getItem("skycope.gifts.5")), [k.gift]);
});

test("same seed, same order", () => {
  const order = (seed) => playThrough(createQuest({ seed, places: places(seed), magic: createMagic(), storage: fakeStorage(), home: LANTERN }));
  assert.deepEqual(order(1847), order(1847));
  assert.deepEqual(order(77), order(77));
  for (const id of Object.keys(KEEPSAKES)) assert.ok(places(1847).some((p) => p.id === id), id);
  assert.equal(Object.values(KEEPSAKES).includes("stars"), false);
});
