// Footstep evidence: for each surface, eight walking steps (and eight
// running) rendered through the whole chain, measured against the home
// beach's ambient bed, with a spectrogram each.
//   node scripts/sound-footsteps.mjs <out-dir>   (e.g. docs/review/sound/footsteps/after)
import { mkdirSync, writeFileSync } from "node:fs";
import { render, SR } from "../tests/audio/render.js";
import { AUDITION_BASE as BASE } from "../src/sound/catalog.js";
import { SURFACE, SURFACE_NAMES } from "../src/sound/patches.js";
import { SCENES } from "../tests/audio/scenes.js";
import { spectrogram } from "./sound-evidence.mjs";
import * as A from "../tests/audio/analysis.js";

// A cat's walk: four paws a stride, one every ~0.22 s (front, hind alternate).
export async function walkSteps(surface, { running = false, seconds = 4, seed = 7 } = {}) {
  const every = running ? 5 : 7; // frames at 30 Hz: run ~6/s (front paws), walk ~4.3/s
  return render({
    seconds,
    seed,
    conditions: { ...BASE, beds: false },
    script: (s, t, frame) => {
      if (frame % every === 1) {
        const n = Math.floor(frame / every);
        s.step(surface, running, n % 2 ? 0.15 : -0.15, { exact: true, front: running ? true : n % 2 === 0, depth: 0.03 });
      }
    },
  });
}

export async function bedLoudness() {
  const r = await render({ ...SCENES.amb, solo: ["amb"] });
  return A.integratedLoudness(r.channels, SR);
}

export async function footstepTable() {
  const bed = await bedLoudness();
  const rows = [];
  for (let s = 0; s <= 10; s++) {
    const walk = await walkSteps(s);
    const run = await walkSteps(s, { running: true });
    const m = A.mono(walk.channels);
    const one = A.mono((await render({ seconds: 1, conditions: { ...BASE, beds: false }, script: (x, t, f) => f === 1 && x.step(s, false, 0, { exact: true, front: true, depth: 0.03 }) })).channels);
    const spec = A.spectrum(m, SR);
    rows.push({
      s,
      name: SURFACE_NAMES[s],
      walk: A.integratedLoudness(walk.channels, SR),
      run: A.integratedLoudness(run.channels, SR),
      peak: A.db(A.samplePeak(walk.channels)),
      attack: A.attackTime(one, SR),
      centroid: A.centroid(spec),
      rolloff: A.rolloff(spec),
      length: A.audibleLength(one, SR),
      under: bed - A.integratedLoudness(walk.channels, SR),
      mono: m,
    });
  }
  return { bed, rows };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = process.argv[2] ?? "docs/review/sound/footsteps/after";
  mkdirSync(out, { recursive: true });
  const { bed, rows } = await footstepTable();
  const f = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : "−∞");
  const md = [`Home-beach ambient bed (amb bus, 30 s): ${f(bed)} LUFS.`, "", "| surface | walk LUFS | under the bed | run LUFS | peak dBFS | attack ms | length s | centroid Hz | roll-off Hz | spectrogram |", "|---|---|---|---|---|---|---|---|---|---|"];
  for (const r of rows) {
    spectrogram(r.mono, `${out}/${r.s}-${r.name}.png`, { width: 400 });
    md.push(`| ${r.name} | ${f(r.walk)} | ${f(r.under)} LU | ${f(r.run)} | ${f(r.peak)} | ${f(r.attack * 1000)} | ${f(r.length, 2)} | ${f(r.centroid, 0)} | ${f(r.rolloff, 0)} | [png](${r.s}-${r.name}.png) |`);
  }
  writeFileSync(`${out}/table.md`, md.join("\n") + "\n");
  console.log(md.join("\n"));
}
