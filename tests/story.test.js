// The story's beginning (docs/design/story-and-wow.md step 1): the fall, the
// climb after each light, the home lantern.
import test from "node:test";
import assert from "node:assert/strict";
import { createWispMind, WISP } from "../src/wisp-mind.js";
import { groundHeight } from "../src/terrain.js";
import { HOME_START, HOME_LANTERN, homeLanternSite, homeLandingPoint, buildHomeLantern } from "../src/place-home.js";

const DT = 1 / 30;
const cat = { x: HOME_START.x, y: groundHeight(HOME_START.x, HOME_START.z), z: HOME_START.z, heading: HOME_START.heading, speed: 0, sit: 1 };
const ctx = () => ({ cat, target: null, night: 1 });

test("the fall: out of the sky onto the sand in 1.4 s, a beat of nothing, then it tries to rise and sinks back", () => {
  const mind = createWispMind({ seed: 1 });
  const site = homeLanternSite();
  const to = homeLandingPoint(site);
  const from = { x: to.x + 40, y: 80, z: to.z - 30 };
  mind.fall(from, to);
  assert.equal(mind.mode, "fall");
  let t = 0;
  while (mind.mode === "fall" && t < 5) {
    mind.update(DT, ctx());
    t += DT;
  }
  assert.ok(Math.abs(t - WISP.fall) < 0.1, `fell in ${t.toFixed(2)} s`);
  assert.equal(mind.mode, "landed");
  assert.ok(Math.hypot(mind.body.x - to.x, mind.body.z - to.z) < 0.5, "it lands where it was aimed");
  assert.equal(mind.visible, false, "a beat of nothing but the sea");
  let top = 0;
  for (let i = 0; i < 30 * 8; i++) {
    mind.update(DT, ctx());
    if (mind.visible) top = Math.max(top, mind.body.y - groundHeight(mind.body.x, mind.body.z));
  }
  assert.ok(Math.abs(top - WISP.reach[0]) < 0.25, `it tries to climb to ${WISP.reach[0]} m, got ${top.toFixed(2)}`);
  assert.ok(mind.body.y - groundHeight(mind.body.x, mind.body.z) < WISP.reach[0], "and sinks back");
});

test("after each light it climbs a little higher; with every light lit it stays up", () => {
  let last = 0;
  for (let lit = 1; lit <= 6; lit++) {
    const mind = createWispMind({ seed: 2 });
    mind.appear(cat);
    for (let i = 0; i < 60; i++) mind.update(DT, ctx());
    mind.reach(lit);
    let top = 0;
    for (let i = 0; i < 30 * 4; i++) {
      mind.update(DT, ctx());
      top = Math.max(top, mind.body.y - groundHeight(mind.body.x, mind.body.z));
    }
    assert.ok(top > last, `${lit} lit: ${top.toFixed(2)} m, higher than ${last.toFixed(2)}`);
    assert.ok(Math.abs(top - WISP.reach[lit]) < 0.6, `${lit} lit: ${top.toFixed(2)} vs ${WISP.reach[lit]}`);
    last = top;
    if (lit === 6) {
      for (let i = 0; i < 30 * 6; i++) mind.update(DT, ctx());
      assert.equal(mind.mode, "aloft");
      assert.ok(mind.body.y - Math.max(0, groundHeight(mind.body.x, mind.body.z)) > 10, "it stays up");
    }
  }
});

test("the home lantern: 8 m from the cat's start, ahead of it, under 400 triangles", () => {
  const site = homeLanternSite();
  const d = Math.hypot(site.x - HOME_START.x, site.z - HOME_START.z);
  assert.ok(Math.abs(d - HOME_LANTERN.distance) < 0.01, `${d.toFixed(2)} m`);
  const ahead = Math.sin(HOME_START.heading) * (site.x - HOME_START.x) + Math.cos(HOME_START.heading) * (site.z - HOME_START.z);
  assert.ok(ahead > 0, "in front of the cat");
  const landing = homeLandingPoint(site);
  const r = Math.hypot(landing.x - site.x, landing.z - site.z);
  assert.ok(r > 1.5 && r < 4, "the star lands just beyond it");
  const home = buildHomeLantern(site);
  let triangles = 0;
  let draws = 0;
  home.lod.near.traverse((o) => {
    if (!o.isMesh) return;
    draws++;
    const g = o.geometry;
    triangles += (g.index ? g.index.count : g.attributes.position.count) / 3;
  });
  assert.ok(triangles <= 400, `${triangles} triangles`);
  assert.ok(draws <= 2, `${draws} draws`);
  assert.equal(home.update({ lit: 0, night: 1 }), 0, "cold until lit");
  assert.ok(home.update({ lit: 1, since: 3, night: 1 }) > 0.5, "lit, it burns");
  home.dispose();
});
