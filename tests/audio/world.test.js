// The world answering: distance and pan, shelter in rain, silence where it
// should be, the owl and the crickets answering the cat, the CPU budget,
// and the named cue lists the other lanes call (waking light, story).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, renderCue, SR } from "./render.js";
import { AUDITION_BASE as BASE } from "../../src/sound/catalog.js";
import { WAKING_CUES, STORY_CUES, createSound } from "../../src/sound.js";
import { camel } from "../../src/sound/cues.js";
import { placeSource } from "../../src/sound/space.js";
import { HOME_PHRASE, homeEvents } from "../../src/score.js";
import { OfflineAudioContext } from "./sim.js";
import * as A from "./analysis.js";

const LISTENER = { x: 0, z: 0, y: 0, yaw: 0 };

test("distance: 4.8 ± 0.5 dB per doubling past ref; the air dulls it; far sounds are wetter", () => {
  const g = (d) => placeSource(LISTENER, { x: 0, z: d }, 25);
  for (const d of [25, 50, 100]) {
    const drop = 20 * Math.log10(g(d).gain / g(2 * d).gain);
    assert.ok(Math.abs(drop - 4.8) <= 0.5, `${d} → ${2 * d} m: ${drop.toFixed(2)} dB`);
  }
  assert.ok(g(400).cutoff < g(100).cutoff && g(100).cutoff < g(25).cutoff);
  assert.ok(g(200).sendA > g(20).sendA);
});

test("distance, rendered: a penguin bray at 1×, 2×, 4× ref drops ~4.8 dB a doubling and gets duller", async () => {
  const at = async (d) => {
    const r = await renderCue((s) => s.wild({ source: "penguins", type: "bray", x: 0, z: d }), { seconds: 3, conditions: BASE });
    const m = A.mono(r.channels);
    return { lufs: A.integratedLoudness(r.channels, SR), c: A.centroid(A.spectrum(m, SR)) };
  };
  const [a, b, c] = [await at(25), await at(50), await at(100)];
  for (const [x, y] of [[a, b], [b, c]]) assert.ok(Math.abs(x.lufs - y.lufs - 4.8) <= 1.5, `drop ${(x.lufs - y.lufs).toFixed(1)} LU`);
  assert.ok(a.c > b.c && b.c > c.c, `centroid falls: ${[a, b, c].map((x) => x.c.toFixed(0))}`);
});

test("pan: a source 10 m to the right is ≥ 8 dB louder on the right, and to the left the other way", async () => {
  const side = async (x) => A.channelBalance((await renderCue((s) => s.wild({ source: "seals", type: "bark", x, z: 0 }), { seconds: 2, conditions: BASE })).channels);
  const r = await side(10);
  const l = await side(-10);
  assert.ok(r <= -8, `right: L − R = ${r.toFixed(1)} dB`);
  assert.ok(l >= 8, `left: L − R = ${l.toFixed(1)} dB`);
});

test("behind the camera: quieter and duller than the same call ahead", () => {
  const ahead = placeSource(LISTENER, { x: 0, z: 30 }, 25);
  const behind = placeSource(LISTENER, { x: 0, z: -30 }, 25);
  assert.ok(behind.behind && !ahead.behind && behind.gain < ahead.gain);
});

test("shelter: under the eave the open rain drops ≥ 10 dB (2–9 kHz) and the roof's modes rise ≥ 4 dB", async () => {
  const scene = (roofX) => render({ seconds: 6, conditions: { ...BASE, beds: false, rain: 4, roofs: [{ x: roofX, z: 0, y: 3, r: 2.2 }] } });
  const open = await scene(30);
  const eave = await scene(0.5);
  const tail = (r) => A.spectrum(A.mono(r.channels).subarray(SR * 2), SR, 4096);
  const so = tail(open), se = tail(eave);
  const band = A.bandLevel(so, 2000, 9000) - A.bandLevel(se, 2000, 9000);
  assert.ok(band >= 10, `open rain band down ${band.toFixed(1)} dB under the eave`);
  for (const hz of [240, 510, 1150]) {
    const up = A.bandLevel(se, hz * 0.95, hz * 1.05) - A.bandLevel(so, hz * 0.95, hz * 1.05);
    assert.ok(up >= 4, `roof mode ${hz} Hz up ${up.toFixed(1)} dB`);
  }
});

test("silence: still inside a bush the rustle stops dead; no new voices", async () => {
  let created = null;
  const r = await render({
    seconds: 6,
    conditions: (t) => ({ ...BASE, beds: false, contact: { density: 0.8, speed: t < 2 ? 1.2 : 0, kind: "shrub" } }),
    script: (s, t, frame) => {
      if (frame === 75) created = s.stats.created;
    },
  });
  const quiet = r.channels.map((c) => c.subarray(Math.round(SR * 2.6)));
  assert.ok(A.integratedLoudness(quiet, SR) < -70 || !Number.isFinite(A.integratedLoudness(quiet, SR)), "silent once still");
  assert.equal(r.sound.stats.created, created, "no nodes made while standing still");
  // While moving it did rustle.
  assert.ok(A.integratedLoudness(r.channels.map((c) => c.subarray(0, SR * 2)), SR) > -70);
});

test("silence: with sound off nothing is built at all, and nothing is made by any entry point", async () => {
  const store = { getItem: (k) => (k === "skycope.sound" ? "0" : null), setItem() {} };
  const ctx = new OfflineAudioContext(2, SR, SR);
  const sound = createSound({ context: ctx, storage: store });
  sound.start();
  sound.update({ ...BASE, sea: 1, rain: 5 });
  sound.step(2, true, 0, { exact: true });
  sound.meow();
  sound.waking("lamp", { x: 0, z: 10 });
  sound.play("thunder", { distance: 500 });
  assert.equal(ctx.created, 0, "no nodes");
});

test("answering: a meow at night near the milkwood brings the owl 1.5 ± 0.2 s later", async () => {
  let meowAt = null;
  const r = await render({
    seconds: 4,
    conditions: { ...BASE, beds: false, night: 1 },
    setup: (s) => s.setWorld({ pois: [{ id: "milkwood", x: 0, z: 20, r: 6 }] }),
    script: (s, t, frame, ctx) => {
      if (frame === 15) {
        meowAt = ctx.currentTime;
        s.meow();
      }
    },
  });
  const owl = r.sound._qa.calls.find((c) => c.name === "owl");
  assert.ok(owl, "the owl answered");
  assert.ok(Math.abs(owl.at - meowAt - 1.5) <= 0.2, `owl ${(owl.at - meowAt).toFixed(2)} s after`);
  // And it is heard: the owl's band (280–420 Hz) carries energy after 1.6 s.
  const late = A.spectrum(A.mono(r.channels).subarray(Math.round(SR * (meowAt + 1.6))), SR);
  assert.ok(A.bandLevel(late, 280, 420) - A.bandLevel(late, 1000, 3000) > 6, "the owl's hoot is in the render");
  // By day, or far from the tree, no owl.
  const day = await render({ seconds: 3, conditions: { ...BASE, beds: false, night: 0 }, setup: (s) => s.setWorld({ pois: [{ id: "milkwood", x: 0, z: 20, r: 6 }] }), script: (s, t, f) => f === 15 && s.meow() });
  assert.ok(!day.sound._qa.calls.some((c) => c.name === "owl"));
});

test("answering: crickets within 6 m of a moving cat hush, and the far ones keep chirping", async () => {
  const walking = (t) => t > 4 && t < 9;
  const r = await render({
    seconds: 20,
    conditions: (t) => ({ ...BASE, night: 1, trees: 1, sea: 0, cat: { ...BASE.cat, speed: walking(t) ? 1.5 : 0 } }),
  });
  const chirps = r.sound._qa.beds.chirps;
  assert.ok(chirps.length > 10, `${chirps.length} chirps`);
  // A chirp needs its cricket's quiet clock at zero: none near while walking.
  const nearWhileWalking = chirps.filter((c) => walking(c.t - 0.05) && c.t > 4.2 && Math.hypot(c.x, c.z) < 6);
  assert.equal(nearWhileWalking.length, 0, "no near chirps while the cat walks");
  assert.ok(chirps.some((c) => c.t > 9 && Math.hypot(c.x, c.z) >= 6), "the far ones carry on");
});

test("the CPU budget over a 60 s walk (beach, grass, rock, wade, boat): voices, loops, node rate", async () => {
  const { WALK } = await import("./walk.js");
  const r = await render(WALK);
  const s = r.sound.stats;
  assert.ok(s.peak <= 40, `peak voices ${s.peak}`);
  assert.ok(s.loops <= 14, `loops ${s.loops}`);
  assert.ok(r.sound._qa.core.stats.maxRate <= 150, `node creations peak ${r.sound._qa.core.stats.maxRate}/s`);
  assert.ok(s.created / 60 <= 40, `average ${(s.created / 60).toFixed(1)} nodes/s`);
});

test("cue lists: every cue waking-light.md section 6 names exists on the sound object", () => {
  const doc = readFileSync(new URL("../../docs/design/waking-light.md", import.meta.url), "utf8");
  const section = doc.slice(doc.indexOf("## 6. Sound cues"), doc.indexOf("## 7."));
  const names = [...section.matchAll(/^\| `([a-z-]+)` \|/gm)].map((m) => m[1]);
  assert.ok(names.length >= 7, `found ${names}`);
  const sound = createSound({ context: new OfflineAudioContext(2, 128, SR), storage: null });
  for (const n of names) {
    assert.ok(WAKING_CUES.includes(n), `${n} in WAKING_CUES`);
    assert.equal(typeof sound[n], "function", `sound.${n}`);
  }
});

test("cue lists: every cue story-and-wow.md section 8 names exists (camelCase) on the sound object", () => {
  const doc = readFileSync(new URL("../../docs/design/story-and-wow.md", import.meta.url), "utf8");
  const section = doc.slice(doc.indexOf("## 8. Sound cue list"), doc.indexOf("## 9."));
  const names = [...section.matchAll(/^\| (`[^|]+`) \|/gm)].flatMap((m) => [...m[1].matchAll(/`([a-z-]+)(?:\(n\))?`/g)].map((x) => x[1]));
  assert.ok(names.length >= 30, `found ${names.length}`);
  const sound = createSound({ context: new OfflineAudioContext(2, 128, SR), storage: null });
  for (const n of names) {
    assert.ok(STORY_CUES.includes(n), `${n} in STORY_CUES`);
    assert.equal(typeof sound[camel(n)], "function", `sound.${camel(n)}`);
  }
});

test("the home phrase: one note per light lit, the sixth resolving", () => {
  assert.deepEqual(HOME_PHRASE, [74, 76, 78, 81, 83, 86]);
  assert.equal(homeEvents(0).plucks.length, 0);
  for (let n = 1; n <= 5; n++) {
    const e = homeEvents(n);
    assert.equal(e.plucks.length, n);
    assert.equal(e.resolved, false);
    assert.deepEqual(e.plucks.map((p) => p.midi), HOME_PHRASE.slice(0, n));
    assert.ok(e.plucks[n - 1].decay > e.plucks[0].decay || n === 1, "the last note held");
  }
  const six = homeEvents(6);
  assert.ok(six.resolved && six.plucks.some((p) => p.midi === 74 + 12 - 12 + 0 || p.midi === 86 - 12));
  assert.equal(homeEvents(9).plucks.length, 7, "clamped to six (plus the octave under the last)");
});

test("the generic wake call is gone; the waking cues replace it", async () => {
  const { CALLS } = await import("../../src/calls.js");
  assert.ok(!CALLS.includes("wake"));
});
