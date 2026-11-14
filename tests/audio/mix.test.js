// The mix: each bus on its loudness target over its reference scene, the
// whole mix on −30 ± 2 LUFS, true peaks under −6 dBTP, a limiter that does
// not act, and the makeup-gain cancellation that keeps it at unity.
import test from "node:test";
import assert from "node:assert/strict";
import { measureBus, measureMix } from "../../scripts/sound-calibrate.mjs";
import { SCENES } from "./scenes.js";
import { BUSES, LIMITER, compressorMakeup, createMix } from "../../src/sound/mix.js";
import { OfflineAudioContext } from "./sim.js";
import * as A from "./analysis.js";

for (const name of Object.keys(SCENES)) {
  test(`bus ${name}: within ±2 LU of ${BUSES[name].target} LUFS over its reference scene`, async () => {
    const m = await measureBus(name);
    assert.ok(Math.abs(m.integrated - BUSES[name].target) <= 2, `${name} ${m.integrated.toFixed(1)} LUFS`);
    assert.ok(m.shortMax <= BUSES[name].short + 1, `${name} short-term max ${m.shortMax.toFixed(1)} (≤ ${BUSES[name].short})`);
    assert.ok(m.truePeak <= -6, `${name} true peak ${m.truePeak.toFixed(1)} dBTP`);
    assert.ok(m.reduction > -1, `limiter idle (${m.reduction.toFixed(2)} dB)`);
  });
}

test("the mix: home beach at noon, walking, one meow — −30 ± 2 LUFS, true peak ≤ −6 dBTP", async () => {
  const m = await measureMix();
  assert.ok(Math.abs(m.integrated + 30) <= 2, `mix ${m.integrated.toFixed(1)} LUFS`);
  assert.ok(m.truePeak <= -6, `true peak ${m.truePeak.toFixed(1)}`);
  assert.ok(Math.max(...m.short.filter(Number.isFinite)) <= -22, "short-term ≤ −22");
  assert.ok(m.render.sound._qa.mix.reduction > -1, "the limiter did not act");
  assert.ok(A.dcOffset(m.render.channels) < 1e-3, "no DC");
});

test("the limiter's makeup gain is cancelled: unity below threshold", async () => {
  const sr = 48000;
  const ctx = new OfflineAudioContext(2, sr, sr);
  const mix = createMix(ctx);
  // Bypass the bus and master gains: a −20 dBFS tone straight into the sum.
  mix.master.gain.value = 1;
  const osc = ctx.createOscillator();
  osc.frequency.value = 997;
  const g = ctx.createGain();
  g.gain.value = 0.1;
  osc.connect(g).connect(mix.limiter);
  osc.start(0);
  const out = await ctx.startRendering();
  const level = A.db(A.samplePeak([out.channels[0].subarray(sr / 2)]));
  assert.ok(Math.abs(level + 20) < 0.1, `limiter chain gain ${(level + 20).toFixed(2)} dB`);
  // Chrome measured +3.42 dB of makeup for these settings (the audition
  // page's soundCheck()); the formula agrees.
  assert.ok(Math.abs(20 * Math.log10(compressorMakeup(LIMITER)) - 3.42) < 0.02);
});
