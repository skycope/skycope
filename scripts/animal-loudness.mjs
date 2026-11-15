// Loudness of the animal voices a live log asked for (scripts/animal-log.mjs):
// per scene and voice, how many were asked for and played, per minute,
// from how far, and how loud each played one is after spatialisation
// (rendered one at a time, off-line, from where the listener heard it),
// against the scene's ambient bed. Also replays the whole scene through
// the current engine to count what it would play now.
//   node scripts/animal-loudness.mjs <log.json> <out.md> [replay]
import { readFileSync, writeFileSync } from "node:fs";
import { render } from "../tests/audio/render.js";
import { AUDITION_BASE as BASE } from "../src/sound/catalog.js";
import * as A from "../tests/audio/analysis.js";

const SR = 24000; // enough for loudness; keeps memory small
const bedCache = new Map();

export function sceneBed(scene) {
  const inland = scene.setup?.inland ?? 3;
  const sea = 1 - Math.min(1, Math.max(0, inland / 30)) ** 2 * (3 - 2 * Math.min(1, Math.max(0, inland / 30)));
  const wind = Math.hypot(...(scene.wind ?? [5, 0]));
  return { ...BASE, sea, seaPan: 0.5, wind, shore: inland, night: scene.night > 1.5 ? 1 : 0, trees: 0 };
}

export async function bedLoudness(scene) {
  const c = sceneBed(scene);
  const key = JSON.stringify(c);
  if (!bedCache.has(key)) {
    const r = await render({ seconds: 20, conditions: c, solo: ["amb"], sampleRate: SR });
    bedCache.set(key, A.integratedLoudness(r.channels, SR));
  }
  return bedCache.get(key);
}

// One event, alone, from where it was heard (listener at the origin facing +z).
export async function eventLoudness(h) {
  const [source, type] = h.voice.split(":");
  const at = { x: h.right, z: h.ahead, y: h.y };
  const r = await render({
    seconds: 4,
    sampleRate: SR,
    conditions: { ...BASE, beds: false },
    script: (s, t, f) => {
      if (f !== 1) return;
      if (source === "gull") s._qa.beds.gull({ x: 0, z: 0, y: 0 }, 0, at);
      else if (source === "owl" && !s._qa.fauna) s.play("owl", { at, gain: 0.8 });
      else if (source === "crickets") s._qa.beds.chirpAt?.(at);
      else s.wild({ source, type, x: at.x, z: at.z, y: at.y, gain: h.gain ?? 1 });
    },
  });
  return A.maxMomentary(r.channels, SR);
}

export async function table(log, { replay = false, sample = 12 } = {}) {
  const rows = [];
  for (const scene of log.results) {
    const bed = await bedLoudness(scene);
    const minutes = scene.wallSeconds / 60;
    const by = new Map();
    for (const h of scene.heard) {
      if (!by.has(h.voice)) by.set(h.voice, []);
      by.get(h.voice).push(h);
    }
    for (const [voice, list] of by) {
      const played = list.filter((h) => h.played !== false);
      // Loudness of up to `sample` played events, spread over the scene.
      const pick = played.filter((_, i) => i % Math.max(1, Math.ceil(played.length / sample)) === 0);
      const levels = [];
      for (const h of pick) levels.push(await eventLoudness(h));
      const finite = levels.filter(Number.isFinite).sort((a, b) => a - b);
      rows.push({
        scene: scene.name,
        voice,
        asked: list.length,
        played: played.length,
        perMinute: played.length / minutes,
        dmin: Math.min(...list.map((h) => h.d)),
        dmax: Math.max(...list.map((h) => h.d)),
        maxM: finite.length ? finite[finite.length - 1] : -Infinity,
        medianM: finite.length ? finite[Math.floor(finite.length / 2)] : -Infinity,
        bed,
      });
    }
  }
  return rows;
}

export function markdown(rows) {
  const f = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : "—");
  const md = ["| scene | voice | asked | played | played / min | distance m | loudest (max M, LUFS) | median | bed (LUFS) | loudest vs bed |", "|---|---|---|---|---|---|---|---|---|---|"];
  for (const r of rows) md.push(`| ${r.scene} | ${r.voice} | ${r.asked} | ${r.played} | ${f(r.perMinute)} | ${f(r.dmin, 0)}–${f(r.dmax, 0)} | ${f(r.maxM)} | ${f(r.medianM)} | ${f(r.bed)} | ${Number.isFinite(r.maxM) ? f(r.maxM - r.bed) + " LU" : "—"} |`);
  return md.join("\n") + "\n";
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [input, out] = process.argv.slice(2);
  const log = JSON.parse(readFileSync(input, "utf8"));
  const rows = await table(log);
  writeFileSync(out, markdown(rows));
  console.log(markdown(rows));
}
