// The story's evidence (docs/design/story-and-wow.md step 1 and 2 pass
// frames): the first 25 seconds (the point in the sky, the fall, the
// meeting, the first lantern) at night, dusk and noon; the ending from the
// cairn top at night and by day. Frames into <outDir>/frames, one labelled
// sheet per run.
//   node scripts/story-strips.mjs <outDir> [port=5356] [cdp=9426] [what=opening|ending|text] [minutes=1320,1110,750]
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { openPage } from "./qa-cdp.mjs";

const out = process.argv[2] ?? "docs/review/story";
const port = Number(process.argv[3] ?? 5356);
const cdp = Number(process.argv[4] ?? 9426);
const what = process.argv[5] ?? "opening";
const TIMES = (process.argv[6] ?? "1320,1110,750").split(",").map(Number);
const W = 1280, H = 800;
await mkdir(`${out}/frames`, { recursive: true });
const name = (m) => (m === 750 ? "noon" : m >= 1200 || m < 300 ? "night" : m >= 1050 ? "dusk" : `${m}min`);

// (Machine safety: one Chrome at a time, closed as soon as the run is
// done; frames go straight to disk and the sheet links them, so this
// process holds no images. The last run's page renders the sheet.)
async function run(minutes, last) {
  const extra = what === "ending" ? `&magic=${process.env.MAGIC ?? "home,fireflies,tideglow,lamp,seafolk,boat"}&at=beacon&minutes=${minutes}` : "";
  const page = await openPage({ port, cdp, query: `seed=1847&weather=clear${extra}`, width: W, height: H });
  const { evaluate, send, sleep } = page;
  const shots = [];
  const snap = async (label) => {
    const r = await send("Page.captureScreenshot", { format: "jpeg", quality: 82 });
    const file = `frames/${what}-${name(minutes)}-${shots.length}.jpg`;
    await writeFile(`${out}/${file}`, Buffer.from(r.result.data, "base64"));
    shots.push({ label, file });
    console.log(what, minutes, label, JSON.stringify(await evaluate(`(() => { const s = skycope, w = s.magic.wisp, j = s.thread?.journey; return { mode: j?.mind?.mode, wisp: w.position.map((v) => +v.toFixed(1)), glow: +w.glow.toFixed(2), lit: j?.lit, home: +(s.magic.levels.home ?? 0).toFixed(2), card: document.querySelector('#gift-card .gift-big')?.textContent, line: document.querySelector('#find-line')?.textContent, hint: document.querySelector('#hint')?.dataset.hidden === 'false' ? document.querySelector('#hint .mouse')?.textContent : '' }; })()`)));
  };
  await evaluate(`(() => { const sl = document.querySelector('#time'); sl.value = ${minutes}; sl.dispatchEvent(new Event('input')); return true; })()`);
  if (what === "opening") {
    // Wait for the arrival title to clear (it plays over the world).
    for (let i = 0; i < 60 && !(await evaluate("document.body.dataset.arrival === 'done'")); i++) await sleep(250);
    await sleep(1000);
    await snap("A1 · +1 s after the title: the point in the sky");
    // No input: it falls 6 s after the title.
    for (let i = 0; i < 80 && (await evaluate("skycope.thread.journey.mind.mode")) !== "fall"; i++) await sleep(100);
    await sleep(700);
    await snap("A2 · mid-fall");
    await sleep(3000);
    await snap("A3 · +3 s: it lifts, fails to rise");
    await sleep(5000);
    await snap("A4 · the wisp at the cold lantern");
    // The cat walks to the lantern.
    await evaluate(`(() => { const s = skycope, h = s.landscape.home, w = s.walker, c = w.cat; const dx = c.x - h.x, dz = c.z - h.z, d = Math.hypot(dx, dz); const x = h.x + dx / d * 1.6, z = h.z + dz / d * 1.6; c.x = x; c.z = z; c.y = w.surface(x, z); c.heading = Math.atan2(h.x - x, h.z - z); c.speed = 0; return true; })()`);
    await sleep(2500);
    await snap("A5 · the wick catches");
    await sleep(3000);
    await snap("A5 · +3 s: lit; the wisp climbs");
    await sleep(4000);
    await snap("A5 · +7 s: it sinks and sets off");
  } else if (what === "ending") {
    for (let i = 0; i < 60 && !(await evaluate("document.body.dataset.arrival === 'done'")); i++) await sleep(250);
    await sleep(1500);
    // The cat sits on the cairn top with five lit: the ending starts by
    // itself (endNow() only if it has not). Frames by the ending's clock.
    await evaluate("skycope.thread.journey.ceremony || skycope.thread.journey.endNow()");
    const plan = (process.env.AT ?? (minutes === 750 ? "1,4,12,22,28,32,34,45,58,68" : "1,4,9,13.5,15,17,25,35,47,52")).split(",").map(Number);
    const clock = "(() => { const c = skycope.thread.journey.ceremony; return c ? performance.now() / 1000 - c.at : 999; })()";
    for (const at of plan) {
      for (let i = 0; i < 400 && (await evaluate(clock)) < at; i++) await sleep(100);
      await snap(`t = ${at} s`);
    }
  }
  if (page.errors.length) console.log("errors", page.errors.slice(0, 5));
  if (!last) await page.close();
  return { shots, page: last ? page : null };
}

const rows = [];
let page = null;
for (const [i, m] of TIMES.entries()) {
  const done = await run(m, i === TIMES.length - 1);
  rows.push({ minutes: m, shots: done.shots });
  page = done.page;
}
const tw = 320, th = 200;
const html = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#111;color:#eee;font:12px system-ui">
${rows.map(({ minutes, shots }) => `<div style="padding:4px">${what} · ${name(minutes)} (${minutes} min)</div><div style="display:flex;flex-wrap:wrap;gap:4px;padding:0 4px 4px">${shots.map(({ label, file }) => `<div style="position:relative;width:${tw}px;height:${th}px"><img width="${tw}" height="${th}" src="${file}"><div style="position:absolute;left:6px;top:4px;background:#000a;padding:1px 6px">${label}</div></div>`).join("")}</div>`).join("")}`;
await writeFile(`${out}/${what}-sheet.html`, html);
const height = rows.reduce((h, r) => h + 24 + 204 * Math.ceil(r.shots.length / 4), 8);
await page.send("Emulation.setDeviceMetricsOverride", { width: 1320, height, deviceScaleFactor: 1, mobile: false });
await page.send("Page.navigate", { url: `file://${resolve(out)}/${what}-sheet.html` });
await page.sleep(1500);
const r = await page.send("Page.captureScreenshot", { format: "jpeg", quality: 80 });
await writeFile(`${out}/${what}-sheet.jpg`, Buffer.from(r.result.data, "base64"));
await page.close();
console.log("sheet", `${out}/${what}-sheet.jpg`);
