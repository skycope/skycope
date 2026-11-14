// Measures each bus over its reference scene (tests/audio/scenes.js) and
// prints the fader that would put it on its loudness target
// (src/sound/mix.js BUSES), then the whole mix.
//   node scripts/sound-calibrate.mjs
import { render, SR } from "../tests/audio/render.js";
import { SCENES, MIX } from "../tests/audio/scenes.js";
import { BUSES, FADER, MASTER } from "../src/sound/mix.js";
import * as A from "../tests/audio/analysis.js";

export async function measureBus(name) {
  const s = SCENES[name];
  const r = await render({ ...s, solo: [s.bus] });
  const st = A.shortTermCurve(r.channels, SR, 0.5).filter(Number.isFinite);
  // As the plan measures it: with the master at 1.
  const master = 20 * Math.log10(MASTER);
  return { name, integrated: A.integratedLoudness(r.channels, SR) - master, shortMax: Math.max(...st) - master, truePeak: A.db(A.truePeak(r.channels)), reduction: r.sound._qa.mix.reduction };
}

export async function measureMix() {
  const r = await render(MIX);
  return { integrated: A.integratedLoudness(r.channels, SR), short: A.shortTermCurve(r.channels, SR, 0.5), truePeak: A.db(A.truePeak(r.channels)), render: r };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const fader = {};
  for (const name of Object.keys(SCENES)) {
    const m = await measureBus(name);
    const want = BUSES[name].target;
    fader[name] = +(FADER[name] * 10 ** ((want - m.integrated) / 20)).toPrecision(3);
    console.log(`${name.padEnd(8)} ${m.integrated.toFixed(1)} LUFS (target ${want}), short-term max ${m.shortMax.toFixed(1)} (≤ ${BUSES[name].short}), true peak ${m.truePeak.toFixed(1)} dBTP → fader ${fader[name]}`);
  }
  console.log("FADER =", JSON.stringify(fader));
  const mix = await measureMix();
  console.log(`mix ${mix.integrated.toFixed(1)} LUFS (target −30 ± 2), short-term max ${Math.max(...mix.short.filter(Number.isFinite)).toFixed(1)}, true peak ${mix.truePeak.toFixed(1)} dBTP`);
}
