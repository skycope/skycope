// Footsteps (re-voiced 15 Nov after the owner's "sound design is off (for
// footsteps)"): a cat's walk is close to silent. These hold the recipes to
// that — soft attacks, low-passed, nothing pitched but the boiler, walking
// well under the home beach's bed, a run audible but under it — and test the
// live path main.js takes: the walker's kind plus what is under the paw,
// the throttles, front paws only at a run, and the swash film.
import test from "node:test";
import assert from "node:assert/strict";
import { render, SR } from "./render.js";
import { AUDITION_BASE as BASE } from "../../src/sound/catalog.js";
import { STEPS, SURFACE, SURFACE_NAMES } from "../../src/sound/patches.js";
import { createSurfaceResolver } from "../../src/sound/surface.js";
import { walkSteps, bedLoudness } from "../../scripts/sound-footsteps.mjs";
import { islandPoint, groundHeight } from "../../src/terrain.js";
import { createSea } from "../../src/sea-surface.js";
import { createWaveModes } from "../../src/wave-modes.js";
import { swellUniform } from "../../src/swell.js";
import * as A from "./analysis.js";

const cache = new Map();
const walk = async (s, running = false) => {
  const k = `${s}:${running}`;
  if (!cache.has(k)) {
    const r = await walkSteps(s, { running });
    const m = A.mono(r.channels);
    cache.set(k, { r, m, spec: A.spectrum(m, SR), lufs: A.integratedLoudness(r.channels, SR) });
  }
  return cache.get(k);
};
const one = async (s) => A.mono((await render({ seconds: 1, conditions: { ...BASE, beds: false }, script: (x, t, f) => f === 1 && x.step(s, false, 0, { exact: true, front: true, depth: 0.03 }) })).channels);

test("recipes: every surface 0–10 has one; nothing pitched but the boiler; soft attacks; low-passed", () => {
  for (let s = 0; s <= 10; s++) {
    const p = STEPS[s];
    assert.ok(p?.layers?.length, `surface ${s}`);
    for (const l of p.layers) {
      if (s !== SURFACE.metal) assert.ok(l.noise, `${SURFACE_NAMES[s]}: noise only, no tone or modes`);
      if (l.noise) {
        assert.ok(l.attack >= 0.008, `${SURFACE_NAMES[s]} attack ${l.attack * 1000} ms ≥ 8`);
        assert.ok(l.type !== "highpass", `${SURFACE_NAMES[s]}: no high-passed ticks`);
        assert.ok(!l.chance, `${SURFACE_NAMES[s]}: no occasional clicks (twigs, claws)`);
      }
    }
  }
});

test("rendered: every surface's attack ≥ 4 ms (10→90 %), its energy below 4 kHz, its tail short", async () => {
  for (let s = 0; s <= 10; s++) {
    const m = await one(s);
    const att = A.attackTime(m, SR);
    assert.ok(att >= 0.004, `${SURFACE_NAMES[s]} attack ${(att * 1000).toFixed(1)} ms`);
    const { spec } = await walk(s);
    assert.ok(A.rolloff(spec) <= 4000, `${SURFACE_NAMES[s]} roll-off ${A.rolloff(spec).toFixed(0)} Hz`);
    if (s !== SURFACE.metal) assert.ok(A.audibleLength(m, SR) <= 0.25, `${SURFACE_NAMES[s]} lasts ${A.audibleLength(m, SR).toFixed(2)} s`);
  }
});

test("level: walking sits ≥ 15 LU under the home beach's bed; a run is louder but still ≥ 7 LU under it", async () => {
  const bed = await bedLoudness();
  for (const s of [SURFACE.drySand, SURFACE.wetSand, SURFACE.grass, SURFACE.rock, SURFACE.timber, SURFACE.shallows]) {
    const w = (await walk(s)).lufs;
    const r = (await walk(s, true)).lufs;
    assert.ok(bed - w >= 15, `${SURFACE_NAMES[s]} walking ${(bed - w).toFixed(1)} LU under the bed`);
    assert.ok(bed - r >= 7, `${SURFACE_NAMES[s]} running ${(bed - r).toFixed(1)} LU under the bed`);
    assert.ok(r - w >= 6, `${SURFACE_NAMES[s]} running +${(r - w).toFixed(1)} LU over walking`);
  }
  const rock = (await walk(SURFACE.rock)).lufs - (await walk(SURFACE.drySand)).lufs;
  assert.ok(rock <= -3, `rock ${rock.toFixed(1)} LU under sand: almost nothing`);
});

test("character: brightness order grass > scrub > litter > sand > wet sand; wood pads dark", async () => {
  const c = async (s) => A.centroid((await walk(s)).spec);
  const order = [SURFACE.grass, SURFACE.scrub, SURFACE.forest, SURFACE.drySand, SURFACE.wetSand];
  for (let i = 1; i < order.length; i++) assert.ok((await c(order[i - 1])) > (await c(order[i])) * 1.15, `${SURFACE_NAMES[order[i - 1]]} brighter than ${SURFACE_NAMES[order[i]]}`);
  for (const s of [SURFACE.timber, SURFACE.deck]) assert.ok((await c(s)) < 400, `${SURFACE_NAMES[s]} centroid ${(await c(s)).toFixed(0)}`);
});

test("character: surfaces differ (centroid 15 %, roll-off 25 % or length 40 %), timber and deck excepted", async () => {
  const feats = [];
  for (let s = 0; s <= 10; s++) {
    const { spec } = await walk(s);
    feats.push({ s, c: A.centroid(spec), r: A.rolloff(spec), l: A.audibleLength(await one(s), SR) });
  }
  const rel = (a, b) => Math.abs(a - b) / Math.min(a, b);
  for (const a of feats)
    for (const b of feats) {
      if (a.s >= b.s || (a.s === SURFACE.timber && b.s === SURFACE.deck)) continue;
      assert.ok(rel(a.c, b.c) >= 0.15 || rel(a.r, b.r) >= 0.25 || rel(a.l, b.l) >= 0.4, `${SURFACE_NAMES[a.s]} vs ${SURFACE_NAMES[b.s]}`);
    }
});

test("the boiler: the one pitched step, at its modes, and it hangs", async () => {
  const near = (list, hz, tol) => list.some((p) => Math.abs(p.hz - hz) / hz <= tol);
  const metal = A.peaks((await walk(SURFACE.metal)).spec, { count: 8, min: 100 });
  for (const hz of [196, 418, 733, 1210]) assert.ok(near(metal, hz, 0.05), `metal peak near ${hz}: ${metal.map((p) => p.hz.toFixed(0))}`);
  const m = await one(SURFACE.metal);
  const env = A.envelope(m, SR, 0.01);
  const peak = Math.max(...env.values);
  assert.ok(A.db(env.values[Math.round(0.43 / env.step)] / peak) > -50, "still ringing at 0.4 s");
});

test("variation: eight steps never repeat; levels spread over ≥ 2 dB", async () => {
  const { m } = await walk(SURFACE.drySand);
  const every = Math.round((7 / 30) * SR);
  const peaks = [];
  for (let k = 0; k < 8; k++) {
    let p = 0;
    for (let i = k * every; i < (k + 1) * every && i < m.length; i++) p = Math.max(p, Math.abs(m[i]));
    peaks.push(A.db(p));
  }
  assert.equal(new Set(peaks.map((p) => p.toFixed(3))).size, 8, "no two steps alike");
  assert.ok(Math.max(...peaks) - Math.min(...peaks) >= 2, `spread ${(Math.max(...peaks) - Math.min(...peaks)).toFixed(1)} dB`);
});

test("live path: at a run only front paws sound, at most ~8 a second; a double trigger within 50 ms is one step", async () => {
  const count = async (fn, seconds = 2) => {
    const r = await render({ seconds, conditions: { ...BASE, beds: false }, script: fn });
    return r.sound.stats.created;
  };
  const base = await count(() => {});
  const hind = await count((s, t, f) => f % 5 === 1 && s.step(SURFACE.drySand, true, 0, { exact: true, front: false }));
  assert.equal(hind, base, "no hind paws at a run");
  const double = await count((s, t, f) => f === 3 && (s.step(2, false, 0, { exact: true, front: true }), s.step(2, false, 0, { exact: true, front: false })));
  const single = await count((s, t, f) => f === 3 && s.step(2, false, 0, { exact: true, front: true }));
  assert.equal(double, single, "the second paw within 50 ms is dropped");
});

test("live path: the walker's kinds and what is under the paw resolve to the right surface", () => {
  const r = createSurfaceResolver();
  const wreck = { id: "wreck", x: 0, z: 0, r: 6 };
  r.world.pois = [wreck, { id: "lighthouse", x: 100, z: 0, r: 8 }, { id: "milkwood", x: 0, z: 100, r: 6 }];
  r.world.covers = [{ place: "wreck", kind: "roof", x: 2, z: 0, yaw: 0, hu: 1, hv: 0.5, y: 1.2 }, { place: "lighthouse", kind: "eave", x: 100, z: 4, yaw: 0, hu: 1, hv: 3, y: 2 }];
  const tile = (x, z, extra = {}) => ({ x, z, r: 1, gradient: true, ...extra });
  const at = (kind, x, z, under) => SURFACE_NAMES[r.resolve(kind, { x, z, under }).surface];
  assert.equal(at(0, 50, 50, { on: "deck" }), "deck", "the moored boat's deck is the deck, wherever it floats");
  assert.equal(at(0, -3, 0, { on: "tile", tile: tile(-3, 0) }), "timber", "the wreck's keelson");
  assert.equal(at(0, 2.5, 0.2, { on: "tile", tile: tile(2.4, 0) }), "metal", "the boiler's top");
  assert.equal(at(2, 2, 0, { on: "ground" }), "metal", "inside the boiler");
  assert.equal(at(0, 101, 3, { on: "tile", tile: tile(101, 3) }), "rock", "the stoep: stone");
  assert.equal(at(0, 3, 98, { on: "tile", tile: tile(3, 98) }), "timber", "the milkwood's roots and limb");
  assert.equal(at(0, 30, 30, { on: "rock", tile: { x: 30, z: 30 } }), "rock", "a boulder");
  assert.equal(at(0, 2, 101, { on: "rock", tile: { x: 2, z: 101 } }), "rock", "a boulder by the milkwood is rock, not timber");
  assert.equal(at(5, 30, 30, { on: "ground" }), "shallows", "water");
  // The beach: wet at the edge, dry sand above it (mostly; mats and scrub
  // where the ground shader paints them).
  // (From about 3 m the ground shader paints sour-fig mats over half the
  // dune: a paw on one is a soft mat, voiced as grass.)
  for (let i = 0; i < 60; i++) {
    const theta = (i / 60) * Math.PI * 2;
    const a = islandPoint(theta, 0.3);
    assert.equal(at(1, a.x, a.z, { on: "ground" }), "wetSand", "0.3 m inland is wet sand");
    const b = islandPoint(theta, 1.5);
    assert.equal(at(1, b.x, b.z, { on: "ground" }), "drySand", "1.5 m inland is dry sand (the walker said wet)");
    const c = islandPoint(theta, 3.5);
    assert.ok(["drySand", "grass"].includes(at(2, c.x, c.z, { on: "ground" })), "3.5 m: sand or a sour-fig mat, never rock or timber");
  }
});

test("the swash film lies on the sand, never on a boulder top or a beached deck", () => {
  const modes = createWaveModes(1847);
  const sea = createSea(1847, modes.data);
  const wind = [3, 2];
  let wetSand = 0, wetRock = 0;
  for (let k = 0; k < 40; k++) {
    const t = k * 0.7;
    modes.update(t, wind);
    sea.set(t, swellUniform(1847, wind), wind);
    for (let i = 0; i < 24; i++) {
      const p = islandPoint((i / 24) * Math.PI * 2, 0.4);
      const sand = groundHeight(p.x, p.z);
      if (sea.at(p.x, p.z, sand).level > sand) wetSand++;
      const rock = sand + 0.5;
      if (sea.at(p.x, p.z, rock).level > rock) wetRock++;
    }
  }
  assert.ok(wetSand > 0, "the swash does wet the sand");
  assert.equal(wetRock, 0, "a boulder top half a metre up stays dry");
});
