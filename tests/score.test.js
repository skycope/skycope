import test from "node:test";
import assert from "node:assert/strict";
import { createComposer, inMode, moodFor, MODES } from "../src/score.js";

const run = (seed, moods, beats = 200) => {
  const composer = createComposer(seed);
  const out = [];
  for (let i = 0; i < beats; i++) out.push(composer.step(moods[i % moods.length], 0));
  return out;
};

test("the composer is deterministic for a seed", () => {
  assert.deepEqual(run(42, ["noon"]), run(42, ["noon"]));
  assert.deepEqual(run(42, ["night", "night", "golden"]), run(42, ["night", "night", "golden"]));
  assert.notDeepEqual(run(42, ["noon"]), run(43, ["noon"]));
});

test("every note is in the mode", () => {
  for (const mood of Object.keys(MODES)) {
    for (const { events } of run(7, [mood], 400))
      for (const e of events) {
        const notes = e.type === "pad" ? e.notes : [e.midi];
        for (const midi of notes) assert.ok(inMode(midi, mood), `${mood}: ${midi}`);
      }
  }
});

test("plucks keep to the mode's register; pads sit low", () => {
  for (const mood of ["noon", "golden", "night", "rain"]) {
    const [lo, hi] = MODES[mood].register;
    for (const { events } of run(3, [mood], 400))
      for (const e of events) {
        if (e.type === "pluck") assert.ok(e.midi >= lo - 5 && e.midi <= hi + 5, `${mood} pluck ${e.midi}`);
        else for (const n of e.notes) assert.ok(n < 76, `${mood} pad ${n}`);
      }
  }
});

test("silent while the cat sleeps; sparse in a storm; busier at noon than at night", () => {
  for (const { events } of run(9, ["sleep"], 300)) assert.equal(events.length, 0);
  const count = (mood) => run(9, [mood], 600).reduce((n, b) => n + b.events.filter((e) => e.type === "pluck").length, 0);
  const storm = count("storm");
  const night = count("night");
  const noon = count("noon");
  assert.ok(storm < 40, `storm plucks ${storm}`);
  assert.ok(night < noon, `night ${night} vs noon ${noon}`);
  assert.ok(noon > 80, `noon plucks ${noon}`);
});

test("no exact repetition over a long stretch", () => {
  const notes = run(5, ["noon"], 800).flatMap((b) => b.events.filter((e) => e.type === "pluck").map((e) => e.midi));
  // No 16-note phrase repeats verbatim.
  const seen = new Set();
  let repeats = 0;
  for (let i = 0; i + 16 <= notes.length; i++) {
    const key = notes.slice(i, i + 16).join(",");
    if (seen.has(key)) repeats++;
    seen.add(key);
  }
  assert.ok(repeats < 3, `repeats ${repeats}`);
});

test("moods follow the light and the weather", () => {
  assert.equal(moodFor({ sunAltitude: 50 }), "noon");
  assert.equal(moodFor({ sunAltitude: 6, sunAzimuth: 260 }), "golden");
  assert.equal(moodFor({ sunAltitude: 6, sunAzimuth: 90 }), "dawn");
  assert.equal(moodFor({ sunAltitude: -20 }), "night");
  assert.equal(moodFor({ sunAltitude: 40, cover: 0.95 }), "grey");
  assert.equal(moodFor({ sunAltitude: 40, rain: 2 }), "rain");
  assert.equal(moodFor({ sunAltitude: 40, rain: 8 }), "storm");
  assert.equal(moodFor({ sunAltitude: 40, asleep: true }), "sleep");
});
