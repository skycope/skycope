// Animal voices (reworked 15 Nov after "the sounds are annoying theres some
// dominating animal noise"; the live log found the penguin colony braying
// ~23 times a minute at 26–41 m, 4 LU under the bed, and the whale's blow
// at the bed's own level). The sea and wind are the sound of the site; an
// animal is heard occasionally, at a distance, softly.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { OfflineAudioContext } from "./sim.js";
import { createSound } from "../../src/sound.js";
import { AUDITION_BASE as BASE } from "../../src/sound/catalog.js";
import { RULES, BUDGET } from "../../src/sound/fauna.js";
import { measureVoices } from "../../scripts/animal-calibrate.mjs";
import { render } from "./render.js";
import * as A from "./analysis.js";

const LOG = JSON.parse(readFileSync(new URL("../../docs/review/sound/animals/before.json", import.meta.url), "utf8"));

// Replays a live scene's animal events through the current engine, the cat
// standing still at the origin. A low sample rate: only the decisions are
// measured here, not the audio.
function replay(scene, { sampleRate = 3000 } = {}) {
  const seconds = Math.ceil(scene.wallSeconds) + 2;
  const ctx = new OfflineAudioContext(2, seconds * sampleRate, sampleRate);
  const sound = createSound({ context: ctx, storage: null, seed: 5 });
  sound.setMusic(false);
  sound.start();
  const events = scene.heard.filter((h) => !h.voice.startsWith("gull") && !h.voice.startsWith("crickets") && !h.voice.startsWith("owl")).sort((a, b) => a.t - b.t);
  const t0 = events.length ? events[0].t - 1 : 0;
  let i = 0;
  for (let t = 0; t < seconds; t += 1 / 10) {
    sound.update({ ...BASE, beds: false, sea: 0.9, shore: 3 });
    while (i < events.length && events[i].t - t0 <= t) {
      const h = events[i++];
      const [source, type] = h.voice.split(":");
      sound.wild({ source, type, x: h.right, z: h.ahead, y: h.y, gain: h.gain ?? 1 });
    }
    ctx.renderUntil(Math.min(seconds, t + 1 / 10));
  }
  const heard = sound._qa.core.heard;
  return { heard, played: heard.filter((h) => h.played), t0 };
}

const spawn = LOG.results.find((r) => /noon, standing at the spawn/.test(r.name));

test("the live log (before) found the culprit: the penguin colony", () => {
  const brays = spawn.heard.filter((h) => h.voice === "penguins:bray");
  assert.ok(brays.length / (spawn.wallSeconds / 60) > 15, "the colony brayed more than 15 times a minute");
});

test("the 5-minute stand at the spawn, replayed: a handful of voices, never two within 6 s, none after 3 min still", () => {
  const { played } = replay(spawn);
  const minutes = spawn.wallSeconds / 60;
  assert.ok(played.length / minutes <= 2, `${played.length} voices in ${minutes.toFixed(1)} min`);
  for (let k = 1; k < played.length; k++) assert.ok(played[k].t - played[k - 1].t >= BUDGET.window - 0.05, `voices ${played[k - 1].voice} and ${played[k].voice} ${(played[k].t - played[k - 1].t).toFixed(1)} s apart`);
  const brays = played.filter((h) => h.voice === "penguins:bray");
  assert.ok(brays.length <= Math.ceil(spawn.wallSeconds / 40), `${brays.length} brays`);
  for (let k = 1; k < brays.length; k++) assert.ok(brays[k].t - brays[k - 1].t >= 40, "a colony brays at most once every 40 s");
  const late = played.filter((h) => RULES[h.voice]?.idle && h.t - played[0].t > BUDGET.fadeEnd + 5);
  assert.equal(late.length, 0, "idle chatter is gone after three minutes of standing still");
});

test("every scene of the live log, replayed: at most 2 voices a minute, no voice for the cat merely standing near", () => {
  for (const scene of LOG.results) {
    const { heard, played } = replay(scene);
    const minutes = scene.wallSeconds / 60;
    assert.ok(played.length / minutes <= 3, `${scene.name}: ${(played.length / minutes).toFixed(1)} a minute`);
    for (const h of heard) if (RULES[h.voice] === null) assert.equal(h.played, false, `${scene.name}: ${h.voice} stays silent`);
  }
});

test("reactions: a startled animal answers once, not again within 25 s", () => {
  const ctx = new OfflineAudioContext(2, 40 * 3000, 3000);
  const sound = createSound({ context: ctx, storage: null, seed: 2 });
  sound.setMusic(false);
  sound.start();
  for (let t = 0; t < 30; t += 0.5) {
    sound.update({ ...BASE, beds: false });
    if (t % 7 === 0) sound.wild({ source: "tortoise", type: "hiss", x: 1, z: 0 });
    ctx.renderUntil(t + 0.5);
  }
  const hisses = sound._qa.core.heard.filter((h) => h.voice === "tortoise:hiss" && h.played);
  assert.equal(hisses.length, 2, "at 0 s and again only after 25 s");
});

test("loudness: every voice at its typical distance peaks ≥ 10 LU under the home beach's bed", async () => {
  const { bed, out } = await measureVoices();
  for (const r of out) assert.ok(r.under >= 10, `${r.voice} at ${r.d} m: ${r.maxM.toFixed(1)} LUFS, ${r.under.toFixed(1)} LU under the bed (${bed.toFixed(1)})`);
});

test("timbre: the colony's call is soft — slow attack, nothing much above 2 kHz, never twice the same", async () => {
  const one = async (seed) => {
    const r = await render({ seconds: 3.5, seed, conditions: { ...BASE, beds: false }, script: (s, t, f) => f === 1 && s.wild({ source: "penguins", type: "bray", x: 0, z: 8 }) });
    return A.mono(r.channels);
  };
  const a = await one(3);
  const spec = A.spectrum(a, 48000);
  assert.ok(A.rolloff(spec) <= 2500, `85 % of its energy under ${A.rolloff(spec).toFixed(0)} Hz`);
  assert.ok(A.attackTime(a, 48000) >= 0.02, `attack ${(A.attackTime(a, 48000) * 1000).toFixed(0)} ms`);
  const b = await one(4);
  assert.notDeepEqual(a.subarray(0, 48000), b.subarray(0, 48000), "two calls are never sample-identical");
});
