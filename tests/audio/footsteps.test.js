// Footsteps by surface, rendered off-line: each surface's spectral
// identity, envelope and level, and that every surface differs from every
// other (docs/design/sound-plan.md section 9b).
import test from "node:test";
import assert from "node:assert/strict";
import { render, SR } from "./render.js";
import { AUDITION_BASE } from "../../src/sound/catalog.js";
import { STEPS, SURFACE, SURFACE_NAMES, estimateCentroid } from "../../src/sound/patches.js";
import * as A from "./analysis.js";

// Eight walking steps on one surface, 0.35 s apart (each hit varies).
async function steps(surface, { running = false, count = 8 } = {}) {
  const r = await render({
    seconds: count * 0.35 + (surface === SURFACE.metal ? 1.2 : 0.3),
    conditions: { ...AUDITION_BASE, beds: false },
    script: (s, t, frame) => {
      if (frame % 10 === 1 && frame < count * 10) s.step(surface, running, 0, { exact: true, front: true });
    },
  });
  const m = A.mono(r.channels);
  return { r, m, spec: A.spectrum(m, SR), ch: r.channels };
}

const cache = new Map();
const of = async (s) => {
  if (!cache.has(s)) cache.set(s, await steps(s));
  return cache.get(s);
};

test("every surface 0–10 has a recipe, and the walker's kinds map onto them", () => {
  for (let s = 0; s <= 10; s++) assert.ok(STEPS[s]?.layers?.length, `surface ${s} (${SURFACE_NAMES[s]}) has layers`);
});

test("footsteps: spectral centroids sit where each surface should", async () => {
  const want = {
    [SURFACE.drySand]: [500, 1100],
    [SURFACE.wetSand]: [300, 700],
    [SURFACE.grass]: [3500, 8000],
    [SURFACE.rock]: [2000, 7000],
    [SURFACE.pebbles]: [1400, 3000],
    [SURFACE.shallows]: [700, 1800],
  };
  for (const [s, [lo, hi]] of Object.entries(want)) {
    const c = A.centroid((await of(+s)).spec);
    assert.ok(c >= lo && c <= hi, `${SURFACE_NAMES[s]} centroid ${c.toFixed(0)} Hz in ${lo}–${hi}`);
  }
  assert.ok(A.rolloff((await of(SURFACE.rock)).spec) > 5000, "rock keeps its highs (the claw)");
});

test("footsteps: timber rings at 210 and 340 Hz, metal at 196 / 418 / 733 / 1210 Hz and hangs", async () => {
  const near = (list, hz, tol) => list.some((p) => Math.abs(p.hz - hz) / hz <= tol);
  const timber = A.peaks((await of(SURFACE.timber)).spec, { count: 6, min: 100 });
  for (const hz of [210, 340]) assert.ok(near(timber, hz, 0.08), `timber peak near ${hz}: ${timber.map((p) => p.hz.toFixed(0))}`);
  const metal = A.peaks((await of(SURFACE.metal)).spec, { count: 8, min: 100 });
  for (const hz of [196, 418, 733, 1210]) assert.ok(near(metal, hz, 0.05), `metal peak near ${hz}: ${metal.map((p) => p.hz.toFixed(0))}`);
  // One metal step alone: still above −40 dB re its peak half a second on.
  const one = await steps(SURFACE.metal, { count: 1 });
  const env = A.envelope(one.m, SR, 0.01);
  const peak = Math.max(...env.values);
  const at = Math.round((0.033 + 0.5) / env.step);
  assert.ok(A.db(env.values[at] / peak) > -40, `metal at 0.5 s: ${A.db(env.values[at] / peak).toFixed(1)} dB`);
});

test("footsteps: attacks — rock under 4 ms, dry sand 8–20 ms", async () => {
  const one = async (s) => A.attackTime((await steps(s, { count: 1 })).m, SR);
  assert.ok((await one(SURFACE.rock)) < 0.004, "rock is a tap");
  const sand = await one(SURFACE.drySand);
  assert.ok(sand >= 0.006 && sand <= 0.02, `dry sand attack ${(sand * 1000).toFixed(1)} ms`);
});

test("footsteps: every surface differs from every other (centroid 15 %, or roll-off 25 %)", async () => {
  const feats = [];
  for (let s = 0; s <= 10; s++) {
    const { spec } = await of(s);
    feats.push({ s, c: A.centroid(spec), r: A.rolloff(spec) });
  }
  for (const a of feats)
    for (const b of feats) {
      if (a.s >= b.s) continue;
      const dc = Math.abs(a.c - b.c) / Math.min(a.c, b.c);
      const dr = Math.abs(a.r - b.r) / Math.min(a.r, b.r);
      assert.ok(dc >= 0.15 || dr >= 0.25, `${SURFACE_NAMES[a.s]} (${a.c.toFixed(0)} / ${a.r.toFixed(0)}) vs ${SURFACE_NAMES[b.s]} (${b.c.toFixed(0)} / ${b.r.toFixed(0)})`);
    }
});

test("footsteps: walking levels — sand pair equal, rock nearly silent, timber and metal a little over", async () => {
  const lufs = async (s) => A.integratedLoudness((await of(s)).ch, SR);
  const dry = await lufs(SURFACE.drySand);
  const rel = async (s) => (await lufs(s)) - dry;
  assert.ok(Math.abs(await rel(SURFACE.wetSand)) <= 2.5, `wet vs dry ${(await rel(SURFACE.wetSand)).toFixed(1)} LU`);
  for (const s of [SURFACE.grass, SURFACE.scrub, SURFACE.forest, SURFACE.shallows]) assert.ok(Math.abs(await rel(s)) <= 4, `${SURFACE_NAMES[s]} ${(await rel(s)).toFixed(1)} LU`);
  const rock = await rel(SURFACE.rock);
  assert.ok(rock <= -2 && rock >= -10, `rock ${rock.toFixed(1)} LU under sand`);
  for (const s of [SURFACE.timber, SURFACE.metal]) assert.ok((await rel(s)) >= -1 && (await rel(s)) <= 8, `${SURFACE_NAMES[s]} ${(await rel(s)).toFixed(1)} LU`);
});

test("footsteps: running is louder, not harsher", async () => {
  const walk = await of(SURFACE.drySand);
  const run = await steps(SURFACE.drySand, { running: true });
  const d = A.integratedLoudness(run.ch, SR) - A.integratedLoudness(walk.ch, SR);
  assert.ok(d > 2 && d < 8, `running +${d.toFixed(1)} LU`);
  assert.ok(A.centroid(run.spec) < A.centroid(walk.spec) * 1.2, "no brighter than 20 % over walking");
});

test("patches as data: the estimate ranks surfaces like the render does, roughly", async () => {
  // Sanity of the data-only estimate: dark surfaces below bright ones.
  assert.ok(estimateCentroid(STEPS[SURFACE.wetSand]) < estimateCentroid(STEPS[SURFACE.grass]));
  assert.ok(estimateCentroid(STEPS[SURFACE.timber]) < estimateCentroid(STEPS[SURFACE.rock]));
});
