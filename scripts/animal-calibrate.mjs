// Each animal voice at its typical distance (fauna.js TYPICAL), rendered
// through the governor, against the home beach's bed: prints its loudest
// 400 ms and the LEVEL trim that puts it TARGET LU under the bed.
//   node scripts/animal-calibrate.mjs
import { eventLoudness, bedLoudness } from "./animal-loudness.mjs";
import { LEVEL, TYPICAL } from "../src/sound/fauna.js";

export const TARGET_UNDER = 10.5; // LU under the bed (the brief: at least 8–10)
export const KEYS = {
  penguin: "penguins:bray", "penguin-splash": "penguins:splash", seal: "seals:bark", "seal-splash": "seals:splash", "seal-snort": "seals:blow",
  whale: "whale:blow", "whale-slap": "whale:slap", "whale-breach": "whale:breach", tortoise: "tortoise:hiss", oystercatcher: "oystercatchers:flush", gull: "gull:idle", owl: "owl:idle",
};

export async function measureVoices() {
  const bed = await bedLoudness({ setup: { inland: 3.2 }, wind: [5, 3], night: 0 });
  const out = [];
  for (const [voice, key] of Object.entries(KEYS)) {
    const d = TYPICAL[voice];
    const m = await eventLoudness({ voice: key, right: 0, ahead: d, y: voice === "gull" ? 15 : voice === "owl" ? 6 : 0, d, gain: 1 });
    out.push({ voice, d, maxM: m, under: bed - m });
  }
  return { bed, out };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { bed, out } = await measureVoices();
  const trims = {};
  for (const r of out) {
    trims[r.voice] = +((LEVEL[r.voice] ?? 1) * 10 ** ((bed - TARGET_UNDER - r.maxM) / 20)).toPrecision(3);
    console.log(`${r.voice.padEnd(15)} at ${String(r.d).padStart(4)} m: ${r.maxM.toFixed(1)} LUFS, ${r.under.toFixed(1)} LU under the bed (${bed.toFixed(1)}) → LEVEL ${trims[r.voice]}`);
  }
  console.log("LEVEL =", JSON.stringify(trims));
}
