// Cat QA: drives headless Chrome over CDP through the cat's motions (stand,
// walk, run, jump, sit, lie, turn on the spot, wade, swim, in the forest,
// close camera, aboard the boat) from many camera angles, and at each sample
// checks every part of the cat is drawn where it should be (see
// scripts/cat-qa-page.js). Optionally saves turnaround sheets.
//
//   node scripts/cat-qa.mjs [port=5337] [mode=detect|sheets|both] [outDir]
//   CDP=9407 picks the debug port; ONLY=walk,run filters scenarios.
// Exits 1 if any part went missing.
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { ISLAND, islandPoint } from "../src/terrain.js";

const port = process.argv[2] ?? "5337";
const mode = process.argv[3] ?? "detect";
const out = process.argv[4] ?? "docs/review/cat";
const cdp = process.env.CDP ?? 9407;
const only = process.env.ONLY?.split(",");
const W = Number(process.env.W ?? 1440), H = Number(process.env.H ?? 900);
const T = Number(process.env.TIME ?? 750);
await mkdir(out, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", [
  "--headless=new", "--enable-unsafe-webgpu", `--remote-debugging-port=${cdp}`, "--no-first-run",
  `--user-data-dir=/tmp/cat-qa-chrome-${cdp}`, `--window-size=${W},${H}`, "--hide-scrollbars", "--mute-audio",
], { stdio: "ignore" });
console.log("chrome pid", chrome.pid);
let targets;
for (let i = 0; i < 60; i++) {
  try {
    targets = await (await fetch(`http://127.0.0.1:${cdp}/json`)).json();
    if (targets.some((t) => t.type === "page")) break;
  } catch {}
  await sleep(200);
}
const page = targets.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0;
const pending = new Map();
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
  if (m.method === "Runtime.exceptionThrown") console.log("  exception:", m.params.exceptionDetails.exception?.description?.slice(0, 300));
});
const send = (method, params = {}) => new Promise((r) => {
  const i = ++id;
  pending.set(i, r);
  ws.send(JSON.stringify({ id: i, method, params }));
});
const evaluate = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) console.log("  eval error", r.result.exceptionDetails.exception?.description?.slice(0, 400));
  return r.result?.result?.value;
};
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false, screenWidth: W, screenHeight: H });

const pageCode = await readFile(new URL("./cat-qa-page.js", import.meta.url), "utf8");
async function load(weather = "clear") {
  await send("Page.navigate", { url: `http://127.0.0.1:${port}/?perf&seed=1847&weather=${weather}` });
  for (let i = 0; i < 150; i++) {
    if (await evaluate("!!(window.skycope && skycope.walker && skycope.landscape && skycope.landscape.scene.getObjectByName('cat')?.userData.debug.meshes.length)")) break;
    await sleep(200);
  }
  await sleep(2500);
  await evaluate(`(async () => {
    const url = performance.getEntriesByType('resource').map((e) => e.name).find((n) => /\\.vite\\/deps\\/three\\.js/.test(n));
    window.__THREE = await import(url);
    window.__CAT_SCALE = (await import('/src/cat-rig.js')).CAT_SCALE;
  })()`);
  await evaluate(pageCode);
  // INJECT=file evaluates extra probe code after the page loads.
  if (process.env.INJECT) await evaluate(await readFile(process.env.INJECT, "utf8"));
  await setTime(T);
}
const setTime = (t) => evaluate(`(() => { const sl = document.querySelector('#time'); sl.value = ${t}; sl.dispatchEvent(new Event('input')); })()`);

const HOME = Math.atan2(0 - ISLAND.z, 6 - ISLAND.x);
const seaward = (t) => Math.atan2(Math.cos(t), Math.sin(t));
const along = (t) => seaward(t) + Math.PI / 2;

// Place the cat (shore angle, metres inland) and the follow camera.
async function place({ at = [HOME, 3], heading = along(HOME), yaw = null, el = 0.38, dist = 3.4, free = false } = {}) {
  const p = islandPoint(at[0], at[1]);
  await evaluate(`(() => {
    const s = skycope, w = s.walker, c = w.cat, cam = w.camera;
    s.keys.clear();
    w.freeCamera(${free});
    c.x = ${p.x}; c.z = ${p.z}; c.y = w.surface(c.x, c.z); c.speed = 0; c.vy = 0; c.air = 0; c.sit = 0; c.idle = 0; c.sleepy = 0;
    c.heading = ${heading};
    cam.yaw = ${yaw ?? heading}; cam.elevation = ${el}; cam.distance = ${dist}; cam.targetY = c.y;
  })()`);
}
const keys = (k) => evaluate(`skycope.keys.clear(); for (const k of ${JSON.stringify(k)}) skycope.keys.add(k); skycope.lastInput = performance.now();`);
const orbit = (yaw, el, dist) => evaluate(`(() => { const cam = skycope.walker.camera; cam.yaw = ${yaw}; cam.elevation = ${el}; cam.distance = ${dist}; })()`);

const failures = [];
let samples = 0;
async function check(label) {
  let r = await evaluate("catQA.sample()");
  if (r?.retry) r = await evaluate("catQA.sample()");
  samples++;
  if (!r) return console.log(label, "no result");
  const bad = r.missing.length || !r.finite || r.nearest < r.near + 0.03;
  const line = `${label.padEnd(34)} ${JSON.stringify(r.pose)} ${Object.entries(r.parts).map(([k, v]) => `${k}:${v.drawn}/${v.visible}/${v.alone}`).join(" ")}`;
  if (bad) {
    failures.push({ label, ...r });
    console.log("FAIL", line, r.missing.join(", "), r.finite ? "" : "NaN", r.nearest < r.near + 0.03 ? `near ${r.nearest}` : "");
  } else if (process.env.VERBOSE) console.log("ok  ", line);
  return r;
}
// Sample a motion from every side.
async function sweep(label, { els = [0.15, 0.38, 0.9], dists = [3.4], yaws = 8, wait = 140 } = {}) {
  const base = await evaluate("skycope.walker.cat.heading");
  for (const el of els)
    for (const dist of dists)
      for (let k = 0; k < yaws; k++) {
        const yaw = base + (k / yaws) * Math.PI * 2;
        await orbit(yaw, el, dist);
        await sleep(wait);
        await check(`${label} el${el} d${dist} y${k}`);
      }
}

const scenarios = {
  async stand() {
    await place();
    await sleep(1500);
    await sweep("stand", { dists: [1.1, 3.4] });
  },
  async walk() {
    await place({ at: [HOME, 4] });
    await keys(["w"]);
    await sleep(800);
    await sweep("walk", { yaws: 6 });
  },
  async run() {
    await place({ at: [HOME + 0.3, 6] });
    await keys(["w", "shift"]);
    await sleep(800);
    await sweep("run", { yaws: 6, wait: 90 });
  },
  async turn() {
    await place();
    await keys(["a"]);
    await sleep(500);
    await sweep("turn", { yaws: 6 });
  },
  async jump() {
    await place();
    await sleep(800);
    for (let k = 0; k < 6; k++) {
      await evaluate("skycope.jump = true");
      for (let j = 0; j < 6; j++) {
        await sleep(70);
        await check(`jump ${k}.${j}`);
      }
      await orbit((await evaluate("skycope.walker.cat.heading")) + k, 0.3, 3.4);
      await sleep(500);
    }
  },
  async sit() {
    await place();
    await evaluate("(() => { const c = skycope.walker.cat; c.idle = 30; })()");
    await sleep(4000);
    await sweep("sit", { dists: [1.1, 3.4] });
  },
  async wade() {
    await place({ at: [HOME, -1.2] });
    await keys(["w"]);
    await sleep(600);
    await sweep("wade", { yaws: 6 });
    await keys([]);
    await place({ at: [HOME, -0.6], heading: seaward(HOME) });
    await sleep(1200);
    await sweep("wade-still", { yaws: 6 });
  },
  async swim() {
    await place({ at: [HOME, -6] });
    await sleep(2000);
    await sweep("swim", { yaws: 6 });
    await keys(["w"]);
    await sleep(600);
    await sweep("swim-move", { yaws: 6 });
  },
  // Swimming, then out up the beach at a run: the water goes from under
  // the cat while it still floats (the frame that used to poison the rig).
  async exit() {
    await place({ at: [HOME, -5], heading: seaward(HOME) + Math.PI });
    await sleep(1500);
    await keys(["w", "shift"]);
    for (let k = 0; k < 40; k++) {
      await sleep(120);
      await check(`exit ${k}`);
    }
  },
  async forest() {
    await place({ at: [HOME, 22] });
    await keys(["w"]);
    await sleep(800);
    await sweep("forest", { yaws: 8, els: [0.1, 0.38] });
  },
  async close() {
    await place({ free: true });
    await sleep(800);
    await evaluate("skycope.walker.zoom(0.01)");
    await sleep(1500);
    await sweep("close", { dists: [0.7], els: [0.05, 0.4, 1.2] });
  },
  async boat() {
    const ok = await evaluate(`(() => {
      const b = skycope.boat; if (!b) return false;
      b.ride.wake(false);
      return true;
    })()`);
    if (!ok) return console.log("boat: none");
    await sleep(500);
    // Hop aboard from beside the hull.
    await evaluate(`(() => {
      const b = skycope.boat.ride, w = skycope.walker, c = w.cat, s = b.state;
      c.x = s.x + 0.8; c.z = s.z; c.y = w.surface(c.x, c.z); c.air = 0;
      b.ride.state = 'boarding'; b.ride.t = 0; Object.assign(b.ride.hop, { x: c.x, y: c.y, z: c.z, heading: c.heading });
    })()`);
    await sleep(2500);
    await sweep("boat-stand", { yaws: 8, els: [0.15, 0.5], dists: [3.4] });
    await sleep(6000);
    await sweep("boat-sit", { yaws: 8, els: [0.15, 0.5], dists: [3.4] });
  },
};

// Sheets: each row one pose, each column one view, rendered in one go so
// every view shows the same instant. TAG names the files (before/after).
const TAG = process.env.TAG ?? "now";
const VIEWS = ["follow", "side", "rear", "front", "top"];
async function row(label, views = VIEWS, opts = {}) {
  const id = `__row${Math.random().toString(36).slice(2, 8)}`;
  await evaluate(`window.${id} = ${JSON.stringify(views)}.map((view) => ({ img: catQA.shot({ view, ...${JSON.stringify(opts)} }), label: ${JSON.stringify(label)} + ' · ' + view }))`);
  return id;
}
async function saveSheet(name, ids, cols, title) {
  const url = await evaluate(`catQA.sheet([${ids.map((i) => `...window.${i}`).join(",")}], ${cols}, ${JSON.stringify(title)})`);
  await writeFile(`${out}/${name}-${TAG}.png`, Buffer.from(url.split(",")[1], "base64"));
  console.log("wrote", `${out}/${name}-${TAG}.png`);
}
async function poses(prefix, minutes) {
  await setTime(minutes);
  const ids = [];
  await place();
  await sleep(1800);
  ids.push(await row("stand"));
  await place({ at: [HOME, 4] });
  await keys(["w"]);
  await sleep(1400);
  ids.push(await row("walk"));
  await keys([]);
  await place({ at: [HOME + 0.3, 6] });
  await keys(["w", "shift"]);
  await sleep(1400);
  ids.push(await row("run"));
  await keys([]);
  await place();
  await evaluate("skycope.walker.cat.idle = 6");
  await sleep(3500);
  ids.push(await row("sit"));
  const boat = await evaluate(`(() => {
    const b = skycope.boat; if (!b) return false;
    b.ride.wake(false);
    const r = b.ride, w = skycope.walker, c = w.cat, s = r.state;
    c.x = s.x + 0.8; c.z = s.z; c.y = w.surface(c.x, c.z); c.air = 0;
    r.ride.state = 'boarding'; r.ride.t = 0; Object.assign(r.ride.hop, { x: c.x, y: c.y, z: c.z, heading: c.heading });
    return true;
  })()`);
  if (boat) {
    await sleep(2500);
    ids.push(await row("boat stand"));
    await sleep(6500);
    ids.push(await row("boat sit"));
    // Ashore again for the next run.
    await evaluate("(() => { const r = skycope.boat.ride.ride; r.state = 'waiting'; })()");
  }
  await saveSheet(`${prefix}-turnaround`, ids, VIEWS.length, `${prefix} ${TAG}: rows stand, walk, run, sit${boat ? ", boat stand, boat sit" : ""}; columns follow, side, rear, front, top`);
}

// Silhouettes of the standing cat (side, top, front, rear) beside lit side
// and top views: for judging proportions against a real cat.
if (mode === "sil") {
  await load();
  await setTime(Number(process.env.DAY ?? 1090));
  await place();
  await sleep(1800);
  const a = await row("stand", ["side", "top", "front", "rear"], { alone: true, size: 420 });
  const b = await row("stand", ["side", "top", "quarter", "follow"], { size: 420 });
  await saveSheet("silhouettes", [a, b], 4, `standing cat ${TAG}: silhouettes, then lit (narrow lens, ~orthographic; frame 0.95 m = 0.68 m cat-sized)`);
}

// Experiments: EXP is a JSON list of [label, setup code] run just before
// each shot (in the same task as the render), VIEWS_EXP the views.
if (mode === "exp") {
  await load();
  await setTime(Number(process.env.DAY ?? 1090));
  await place(JSON.parse(process.env.PLACE ?? "{}"));
  if (process.env.KEYS) await keys(JSON.parse(process.env.KEYS));
  await sleep(Number(process.env.WAIT ?? 1800));
  const exps = JSON.parse(process.env.EXP ?? '[["now", ""]]');
  const views = JSON.parse(process.env.VIEWS_EXP ?? '["side"]');
  const opts = JSON.parse(process.env.OPTS ?? '{"size": 420}');
  await evaluate("window.__cells = []");
  for (const [label, code] of exps)
    await evaluate(`(() => { const dbg = skycope.landscape.scene.getObjectByName('cat').userData.debug; const u = dbg.uniforms; ${code}; for (const view of ${JSON.stringify(views)}) __cells.push({ img: catQA.shot({ view, ...${JSON.stringify(opts)} }), label: ${JSON.stringify(label)} + ' · ' + view }); })()`);
  const url = await evaluate(`catQA.sheet(__cells, ${views.length}, ${JSON.stringify(process.env.TITLE ?? "experiment")})`);
  await writeFile(`${out}/exp-${TAG}.png`, Buffer.from(url.split(",")[1], "base64"));
  if (process.env.DUMP) console.log(JSON.stringify(await evaluate(process.env.DUMP)));
  console.log("wrote", `${out}/exp-${TAG}.png`);
}

if (mode === "sheets" || mode === "both" || mode === "close") {
  await load();
  if (mode !== "close") {
    await poses("day", Number(process.env.DAY ?? 1090));
    await poses("night", 1320);
  }
  await setTime(1090);
  // Close-ups: the face (eyes, lids), and the inner thighs mid-stride.
  const ids = [];
  await place();
  await sleep(1800);
  ids.push(await row("stand", ["face", "quarter"], { size: 360, fov: 9 }));
  await place({ at: [HOME, 4] });
  await keys(["w"]);
  for (let k = 0; k < 3; k++) {
    await sleep(170);
    ids.push(await row(`walk ${k}`, ["thighs", "under"], { size: 360 }));
  }
  await keys(["w", "shift"]);
  await sleep(1200);
  ids.push(await row("run", ["thighs", "under"], { size: 360 }));
  await keys([]);
  await saveSheet("closeups", ids, 2, `closeups ${TAG}: face and quarter at stand; inner thighs and from behind mid-walk and mid-run`);
  // Width along the body from straight above (cat-sized metres).
  await place();
  await sleep(1500);
  const prof = await evaluate("catQA.topProfile()");
  const nonzero = prof.rows.map((w, i) => [i, w]).filter(([, w]) => w > 0);
  const step = Math.max(1, Math.round(nonzero.length / 24));
  console.log("top-view width profile (nose→tail, cm):", nonzero.filter((_, i) => i % step === 0).map(([, w]) => (w * 100).toFixed(1)).join(" "));
  await writeFile(`${out}/top-profile-${TAG}.json`, JSON.stringify(prof.rows));
}

if (mode === "detect" || mode === "both") {
  await load();
  for (const [name, run] of Object.entries(scenarios)) {
    if (only && !only.includes(name)) continue;
    const before = failures.length;
    try {
      await run();
    } catch (e) {
      console.log(name, "error", e.message);
    }
    await keys([]);
    console.log(`${name}: ${failures.length - before} failing samples`);
  }
  console.log(`${samples} samples, ${failures.length} failing`);
  // DUMP=expr prints a page expression at the end (with INJECT probes).
  if (process.env.DUMP) console.log(JSON.stringify(await evaluate(process.env.DUMP), null, 1));
  await writeFile(`${out}/qa-failures.json`, JSON.stringify(failures, null, 1));
}

ws.close();
chrome.kill();
process.exit(failures.length ? 1 : 0);
