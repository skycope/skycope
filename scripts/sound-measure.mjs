// Renders every cue in src/sound/catalog.js off-line (tests/audio/sim.js)
// and prints its numbers: length, peak and true peak (dBFS), loudness
// (max momentary LUFS, integrated LUFS), spectral centroid and roll-off,
// attack, the largest sample step at its edges, DC and voices.
//   node scripts/sound-measure.mjs [id-filter]
import { CUES } from "../src/sound/catalog.js";
import { renderEntry, SR } from "../tests/audio/render.js";
import * as A from "../tests/audio/analysis.js";

export async function measure(cue) {
  const r = await renderEntry(cue);
  const ch = r.channels;
  const m = A.mono(ch);
  const spec = A.spectrum(m, SR);
  const peak = A.samplePeak(ch);
  return {
    id: cue.id,
    n: cue.n,
    seconds: A.audibleLength(m, SR),
    peak: A.db(peak),
    truePeak: A.db(A.truePeak(ch)),
    momentary: A.maxMomentary(ch, SR),
    integrated: A.integratedLoudness(ch, SR),
    centroid: A.centroid(spec),
    rolloff: A.rolloff(spec),
    attack: A.attackTime(m, SR),
    edge: edgeStep(ch, peak),
    dc: A.dcOffset(ch),
    peaks: A.peaks(spec, { count: 6 }),
    stats: r.stats,
    render: r,
  };
}

// A click at a voice's start or stop: the largest |sample| in the first and
// last 4 samples of each stretch of sound (after / before 5 ms of digital
// silence), relative to the cue's own peak. An envelope that starts or
// stops on a step shows here; a fast but ramped attack does not.
export function edgeStep(channels, peak) {
  if (!(peak > 0)) return 0;
  const floor = peak * 1e-5;
  const gap = Math.round(0.005 * SR);
  let worst = 0;
  // Onsets forwards; stops are onsets of the reversed signal.
  for (const c of channels)
    for (const x of [c, Float32Array.from(c).reverse()]) {
      let quiet = 0; // the render's own start and end are not silence
      for (let i = 0; i < x.length; i++) {
        const loud = Math.abs(x[i]) > floor;
        if (loud && quiet >= gap) for (let k = i; k < Math.min(x.length, i + 4); k++) worst = Math.max(worst, Math.abs(x[k]));
        quiet = loud ? 0 : quiet + 1;
      }
    }
  return worst / peak;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const filter = process.argv[2] ?? "";
  const f = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : String(x));
  console.log("id                       n   len    peak   tp     maxM    int    cent   roll   att    edge  dc       voices created");
  for (const cue of CUES.filter((c) => c.id.includes(filter))) {
    const t0 = performance.now();
    const x = await measure(cue);
    console.log(
      `${x.id.padEnd(24)} ${String(x.n).padStart(2)} ${f(x.seconds, 2).padStart(5)} ${f(x.peak).padStart(6)} ${f(x.truePeak).padStart(6)} ${f(x.momentary).padStart(6)} ${f(x.integrated).padStart(6)} ${f(x.centroid, 0).padStart(6)} ${f(x.rolloff, 0).padStart(6)} ${f(x.attack * 1000, 1).padStart(5)} ${f(x.edge, 3).padStart(6)} ${x.dc.toExponential(1)} ${x.stats.peak}/${x.stats.created}  ${((performance.now() - t0) / 1000).toFixed(1)}s`,
    );
  }
}
