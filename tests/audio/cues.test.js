// Every cue in the catalogue (src/sound/catalog.js, the audition page's
// list) rendered off-line: it sounds, it does not clip, it has no DC, it
// does not click where a voice starts or stops, and it is repeatable.
import test from "node:test";
import assert from "node:assert/strict";
import { CUES } from "../../src/sound/catalog.js";
import { measure } from "../../scripts/sound-measure.mjs";
import { renderEntry } from "./render.js";

test("the catalogue: unique ids, every checklist item has cues, every cue says what it should sound like", () => {
  const ids = new Set(CUES.map((c) => c.id));
  assert.equal(ids.size, CUES.length);
  for (let n = 1; n <= 13; n++) assert.ok(CUES.some((c) => c.n === n), `item ${n}`);
  for (const c of CUES) assert.ok(c.says && c.name && c.seconds > 0 && (c.play || c.scene), c.id);
});

for (const cue of CUES) {
  test(`cue ${cue.id}: sounds, no clipping, no DC, no clicks`, async () => {
    const x = await measure(cue);
    assert.ok(Number.isFinite(x.peak) && x.momentary > -85, `audible (${x.momentary.toFixed(1)} LUFS momentary)`);
    const ceiling = cue.id.startsWith("thunder") ? -3 : -6;
    assert.ok(x.truePeak <= ceiling, `true peak ${x.truePeak.toFixed(1)} dBTP ≤ ${ceiling}`);
    assert.ok(x.dc < 2e-3, `DC ${x.dc.toExponential(1)}`);
    assert.ok(x.edge < 0.25, `start/stop step ${x.edge.toFixed(3)} of peak`);
    assert.ok(x.stats.peak <= 40, `${x.stats.peak} voices at once`);
  });
}

test("renders are repeatable: the same seed twice is sample-identical", async () => {
  for (const id of ["step-grass", "meow", "rain-roof", "waking-tideglow"]) {
    const cue = CUES.find((c) => c.id === id);
    const a = await renderEntry(cue, { seed: 3 });
    const b = await renderEntry(cue, { seed: 3 });
    assert.deepEqual(a.channels[0], b.channels[0], id);
  }
});
