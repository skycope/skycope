// Performance harness: the measurement protocol of docs/handover/perf-research.md,
// driving one Chrome over CDP against a running dev server.
//
//   node scripts/perf.mjs bench    [options]   six views × times × gifts: frame p50/p95,
//                                               paused-rAF whole-frame bench, triangles,
//                                               draw calls, memory, render sizes reached
//   node scripts/perf.mjs ab --base <ref> [--head <ref>]  the same views, this tree against <ref>,
//                                               two tabs in one Chrome, interleaved rounds:
//                                               per-view frame-time ratio and count deltas
//   node scripts/perf.mjs toggle --on '<js>' --off '<js>'
//                                               one tab, a knob flipped between rounds
//                                               (cost attribution: hide a material, …)
//   node scripts/perf.mjs shots    --label <name> [--base <ref>]  deterministic stills of every view
//                                               (reduced motion, fixed clock, moving
//                                               animals hidden): composite JPEG + land PNG
//   node scripts/perf.mjs diff <dirA> <dirB>     per-view pixel difference of two `shots`
//   node scripts/perf.mjs lifetime [--minutes 15]
//                                               a fresh browser playing the quest round
//                                               and round (every ceremony, begin again),
//                                               running, meowing, day and night; GC'd heap,
//                                               GL/GPU objects and listeners each minute
//
// Options: --port 5333 (dev server)  --cdp 9403  --out <dir>  --headed
//          --views home,sea,milkwood,beacon,beacon-out,lighthouse  --times 750,1320
//          --magic asleep,awake  --rounds 13  --k 5  --size 1440x900  --dpr 2  --seed 1847
//          --weather clear  --quick (5 rounds, no free-run governor phase)
//
// Start the server first: node node_modules/vite/bin/vite.js --port 5333 --strictPort --host 127.0.0.1
// Output: <out>/<mode>.json and <out>/<mode>.md (a markdown table).
//
// Absolute milliseconds mean something only on an idle machine with one headed
// Chrome. Under contention trust counts and same-tab interleaved ratios.
import { spawn, execFileSync } from "node:child_process";
import { mkdir, writeFile, readFile, rm, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { ISLAND } from "../src/terrain.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const mode = argv[0] && !argv[0].startsWith("--") ? argv.shift() : "bench";
const opt = parseArgs(argv);
const PORT = Number(opt.port ?? 5333);
const CDP = Number(opt.cdp ?? 9403);
const [W, H] = (opt.size ?? "1440x900").split("x").map(Number);
const DPR = Number(opt.dpr ?? 2);
const SEED = Number(opt.seed ?? 1847);
// Live weather moves cloud shadows over the cat between runs: a preset by default.
const WEATHER = opt.weather ?? "clear";
const QUICK = Boolean(opt.quick);
const ROUNDS = Number(opt.rounds ?? (QUICK ? 5 : 13));
const K = Number(opt.k ?? 5);
const VIEWS = (opt.views ?? "home,sea,milkwood,beacon,beacon-out,lighthouse").split(",");
const TIMES = (opt.times ?? "750,1320").split(",").map(Number);
const MAGIC = (opt.magic ?? "asleep,awake").split(",");
const OUT = resolve(opt.out ?? join(tmpdir(), "skycope-perf"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseArgs(list) {
  const o = { _: [] };
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (!a.startsWith("--")) { o._.push(a); continue; }
    const key = a.slice(2);
    const next = list[i + 1];
    if (next === undefined || next.startsWith("--")) o[key] = true;
    else { o[key] = next; i++; }
  }
  return o;
}

// ---------------------------------------------------------------- Chrome + CDP
async function launchChrome({ fresh = false } = {}) {
  const profile = join(tmpdir(), `skycope-perf-chrome-${CDP}`);
  if (fresh) await rm(profile, { recursive: true, force: true });
  const args = [
    `--remote-debugging-port=${CDP}`, `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check",
    "--enable-unsafe-webgpu", "--mute-audio", "--hide-scrollbars", `--window-size=${W},${H}`,
    "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows",
    "--enable-precise-memory-info", "--autoplay-policy=no-user-gesture-required",
  ];
  if (!opt.headed) args.unshift("--headless=new");
  const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", args, { stdio: "ignore" });
  let version = null;
  for (let i = 0; i < 100 && !version; i++) {
    try { version = await (await fetch(`http://127.0.0.1:${CDP}/json/version`)).json(); } catch { await sleep(150); }
  }
  if (!version) throw new Error(`Chrome did not open CDP on ${CDP}`);
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.addEventListener("open", r); ws.addEventListener("error", j); });
  let id = 0;
  const pending = new Map();
  const listeners = new Set();
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    for (const fn of listeners) fn(m);
  });
  const send = (method, params = {}, sessionId) => new Promise((r) => {
    const i = ++id;
    pending.set(i, r);
    ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  return { chrome, send, listeners, close: () => { try { ws.close(); } catch {} chrome.kill(); } };
}

async function openTab(browser, { log = true } = {}) {
  const { targetId } = (await browser.send("Target.createTarget", { url: "about:blank" })).result;
  const { sessionId } = (await browser.send("Target.attachToTarget", { targetId, flatten: true })).result;
  const send = (method, params) => browser.send(method, params, sessionId);
  const errors = [];
  browser.listeners.add((m) => {
    if (m.sessionId !== sessionId) return;
    if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description?.slice(0, 300) ?? m.params.exceptionDetails.text);
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errors.push(m.params.args.map((a) => a.value ?? a.description).join(" ").slice(0, 300));
  });
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: DPR, mobile: false, screenWidth: W, screenHeight: H });
  await send("Emulation.setFocusEmulationEnabled", { enabled: true });
  // Counts every WebGL and WebGPU object created and destroyed (leak hunting).
  await send("Page.addScriptToEvaluateOnNewDocument", { source: `(${installCounters})()` });
  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, replMode: true });
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text);
    return r.result?.result?.value;
  };
  const tab = {
    targetId, sessionId, send, evaluate, errors,
    async activate() { await browser.send("Target.activateTarget", { targetId }); },
    async load(path, query, { quest = false } = {}) {
      errors.length = 0;
      await send("Page.navigate", { url: `http://127.0.0.1:${PORT}${path}?perf&seed=${SEED}&weather=${WEATHER}${query ? "&" + query : ""}` });
      for (let i = 0; i < 300; i++) {
        if (await evaluate("!!(window.skycope && skycope.walker && skycope.landscape && skycope.renderFrame && skycope.revealedAt !== undefined)").catch(() => false)) break;
        await sleep(200);
        if (i === 299) throw new Error(`page did not become ready: ${errors.join(" | ")}`);
      }
      await evaluate(`(${pageHelper})(${JSON.stringify({ island: ISLAND })})`);
      // No ceremonies start by themselves while a view is measured (the
      // quest wakes a keepsake when the cat is placed beside it).
      if (!quest) await evaluate("skycope.thread.journey.tick = () => {}");
      if (log && errors.length) console.log("  page errors:", errors.slice(0, 5));
    },
  };
  return tab;
}

// Runs in the page before any script: tallies GL and WebGPU object lifetimes.
function installCounters() {
  // No hot reload in measured tabs: editing src (or extracting a snapshot)
  // must not reload a page mid-run. Vite's client gets a socket that never
  // opens and never closes (a close would make it poll and reload).
  const RealSocket = window.WebSocket;
  window.WebSocket = function (url, protocols) {
    if (String(url).includes(location.host)) {
      const quiet = new EventTarget();
      return Object.assign(quiet, { readyState: 0, send() {}, close() {}, url: String(url) });
    }
    return new RealSocket(url, protocols);
  };
  window.WebSocket.prototype = RealSocket.prototype;
  Object.assign(window.WebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
  const c = (window.__counts = { gl: {}, gpu: {} });
  const wrap = (proto, name, bucket, key, delta) => {
    const f = proto?.[name];
    if (typeof f !== "function") return;
    proto[name] = function (...a) { bucket[key] = (bucket[key] ?? 0) + delta; return f.apply(this, a); };
  };
  const GL = window.WebGL2RenderingContext?.prototype;
  for (const kind of ["Buffer", "Texture", "Program", "VertexArray", "Framebuffer", "Renderbuffer", "Query", "Shader"]) {
    wrap(GL, "create" + kind, c.gl, kind, 1);
    wrap(GL, "delete" + kind, c.gl, kind, -1);
  }
  const D = window.GPUDevice?.prototype;
  for (const kind of ["Buffer", "Texture", "RenderPipeline", "ComputePipeline", "BindGroup", "ShaderModule", "QuerySet", "Sampler"]) wrap(D, "create" + kind, c.gpu, kind + "Created", 1);
  wrap(window.GPUBuffer?.prototype, "destroy", c.gpu, "BufferDestroyed", 1);
  wrap(window.GPUTexture?.prototype, "destroy", c.gpu, "TextureDestroyed", 1);
}

// Installed in the page once per load: view placement, a paused rAF that the
// harness steps, GPU sync, counts and stills.
function pageHelper({ island }) {
  const s = window.skycope;
  const L = s.landscape;
  const gl = L.renderer.getContext();
  const device = [s.gpu?.gpu, s.gpu?.device, s.gpu?.device?.device].find((d) => typeof d?.queue?.onSubmittedWorkDone === "function");
  const pixel = new Uint8Array(4);
  const land = document.querySelector("#landscape");
  let queue = [], paused = false, clock = 0;
  const realRaf = window.requestAnimationFrame;
  const stamps = [];
  let recording = false, rendered = 0;
  const render = s.renderFrame;
  s.renderFrame = (f) => {
    rendered++;
    if (recording) stamps.push(performance.now());
    return render(f);
  };
  const poi = (id) => L.pois.find((p) => p.id === id);
  const HOME = Math.atan2(0 - island.z, 6 - island.x);
  const shoreRadius = (t) => 62 + 14 * Math.sin(2 * t + 0.8) + 7 * Math.sin(3 * t + 2.1);
  // (terrain.js islandPoint, only good to the first two harmonics: the views
  // need a stable point, not the exact shore.)
  const views = {
    home: () => ({ home: true }),
    sea: () => ({ ...shorePoint(HOME, 2), yaw: Math.atan2(Math.cos(HOME), Math.sin(HOME)), el: 0.25, dist: 3.4 }),
    milkwood: () => facing(poi("milkwood"), 11, 0.22, 3.6),
    beacon: () => facing(poi("beacon"), 7, 0.3, 3.6),
    "beacon-out": () => { const p = poi("beacon"); const a = Math.atan2(p.x - island.x, p.z - island.z); return { x: p.x + Math.sin(a) * 2, z: p.z + Math.cos(a) * 2, yaw: a, el: 0.35, dist: 6 }; },
    lighthouse: () => facing(poi("lighthouse"), 16, 0.25, 3.6),
  };
  function shorePoint(t, inland) {
    const exact = window.__shore?.(t, inland);
    if (exact) return exact;
    const r = shoreRadius(t) - inland;
    return { x: island.x + Math.cos(t) * r, z: island.z + Math.sin(t) * r };
  }
  // The cat `back` metres from a place, on the island's side, looking at it.
  function facing(p, back, el, dist) {
    if (!p) return { home: true };
    const a = Math.atan2(island.x - p.x, island.z - p.z);
    const x = p.x + Math.sin(a) * back, z = p.z + Math.cos(a) * back;
    return { x, z, yaw: Math.atan2(p.x - x, p.z - z), el, dist };
  }
  function signature(o) {
    o.updateWorldMatrix?.(true, false);
    let h = 1;
    const m = o.matrixWorld?.elements;
    if (m) for (let i = 0; i < 16; i++) h = (h * 31 + Math.round(m[i] * 1000)) | 0;
    if (o.isInstancedMesh && o.count < 400) {
      const a = o.instanceMatrix.array;
      for (let i = 0; i < o.count * 16; i += 3) h = (h * 31 + Math.round(a[i] * 1000)) | 0;
    }
    return h;
  }
  const helper = (window.__perf = {
    views: Object.keys(views),
    place(name, minutes) {
      const w = s.walker, c = w.cat, cam = w.camera;
      s.keys.clear();
      s.lastInput = performance.now();
      if (minutes !== undefined && Number(document.querySelector("#time").value) !== minutes) {
        const sl = document.querySelector("#time");
        sl.value = minutes;
        sl.dispatchEvent(new Event("input"));
      }
      const v = views[name]();
      if (v.home) { w.home(); return name; }
      c.x = v.x; c.z = v.z; c.y = w.surface(v.x, v.z);
      c.speed = 0; c.vy = 0; c.air = 0; c.sit = 0; c.idle = 0; c.heading = v.yaw;
      cam.yaw = v.yaw; cam.elevation = v.el; cam.distance = v.dist; cam.targetY = c.y;
      return name;
    },
    // Holds the app's rAF loop: resolves once its next callback is captured
    // (the one already scheduled has to fire first), so steps really render.
    async pause() {
      if (!paused) {
        paused = true;
        window.requestAnimationFrame = (cb) => { queue.push(cb); return 0; };
      }
      for (let i = 0; i < 200 && !queue.length; i++) await new Promise((r) => setTimeout(r, 5));
      clock = Math.max(clock, performance.now(), s.lastFrame ?? 0);
      if (!queue.length) throw new Error("pause: the render loop was not captured");
    },
    resume() {
      if (!paused) return;
      paused = false;
      window.requestAnimationFrame = realRaf;
      const q = queue; queue = [];
      for (const cb of q) realRaf(cb);
    },
    // n frames, each a rendered one (timestamps clear the pacing gate).
    // n frames; returns how many rendered (each should).
    step(n = 1) {
      const before = rendered;
      for (let i = 0; i < n; i++) {
        s.lastInput = performance.now();
        clock += 1000 / 30 + 1;
        const q = queue; queue = [];
        for (const cb of q) cb(clock);
      }
      return rendered - before;
    },
    async sync() {
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      if (device) await device.queue.onSubmittedWorkDone();
    },
    // Whole-frame time of k frames, GPU drained before and after (ms/frame).
    async bench(k) {
      await helper.sync();
      const t0 = performance.now();
      const n = helper.step(k);
      // The CPU side alone (JS and GL command submission), ms per frame.
      helper.lastCpu = (performance.now() - t0) / k;
      await helper.sync();
      if (n !== k) throw new Error(`bench: ${n} of ${k} frames rendered`);
      return (performance.now() - t0) / k;
    },
    // Steady-state counts: a frame with no shadow refresh in it.
    counts() {
      for (let i = 0; i < 30 && L.shadows?.pending; i++) helper.step(1);
      helper.step(1);
      const r = L.renderer.info;
      return {
        triangles: r.render.triangles, calls: r.render.calls,
        geometries: r.memory.geometries, textures: r.memory.textures, programs: r.programs?.length ?? null,
        shadowPending: !!L.shadows?.pending,
      };
    },
    // A shadow refresh frame (all slices), for its counts.
    refreshCounts() {
      const tri = [], calls = [];
      // Force a re-key: move the anchor by nudging the stored key.
      L.shadows.pending = true; L.shadows.slice = 0; L.shadows.jump = false;
      for (let i = 0; i < 12; i++) { helper.step(1); tri.push(L.renderer.info.render.triangles); calls.push(L.renderer.info.render.calls); if (!L.shadows.pending) break; }
      return { triangles: Math.max(...tri), calls: Math.max(...calls), frames: tri.length };
    },
    record(on) {
      if (on) { stamps.length = 0; recording = true; return null; }
      recording = false;
      const d = [];
      for (let i = 1; i < stamps.length; i++) d.push(stamps[i] - stamps[i - 1]);
      return d;
    },
    quality() {
      return { level: s.budget.level, settings: s.budget.settings, sizes: s.budget.sizes, gpuMs: s.gpuMs, meshGpuMs: L.gpuMs };
    },
    memory() {
      const r = L.renderer.info;
      return {
        heap: performance.memory?.usedJSHeapSize ?? null,
        geometries: r.memory.geometries, textures: r.memory.textures, programs: r.programs?.length ?? null,
        counts: JSON.parse(JSON.stringify(window.__counts ?? {})),
        objects: (() => { let n = 0; L.scene.traverse(() => n++); return n; })(),
      };
    },
    // Hide what moves on its own (animals, birds, insects, the wisp, motes,
    // rain, the cat's breathing) so two stills of one view differ only by the
    // code under test: mark, let it run a second, hide whatever moved.
    markMovers() {
      helper.marks = new Map();
      L.scene.traverse((o) => helper.marks.set(o, signature(o)));
      return helper.marks.size;
    },
    hideMovers() {
      helper.hidden = [];
      L.scene.traverse((o) => {
        if (o.visible && (o === L.wisp?.mesh || o.isPoints || o.isSprite || (helper.marks.has(o) && helper.marks.get(o) !== signature(o)))) helper.hidden.push(o);
      });
      for (const o of helper.hidden) o.visible = false;
      return helper.hidden.length;
    },
    showMovers() {
      for (const o of helper.hidden ?? []) o.visible = true;
      helper.hidden = [];
    },
    // Every vegetation chunk packed afresh for this eye (no history).
    repack() {
      L.scene.traverse((o) => {
        if (!o.userData.lodChunks) return;
        o.userData.lodState = null;
        for (const c of o.userData.lodChunks) c.state = -2;
      });
      // …and the sun's shadow map drawn whole from that packing.
      if (L.shadows) Object.assign(L.shadows, { pending: true, slice: 0, jump: true, again: false });
    },
    landPng() {
      return land.toDataURL("image/png");
    },
  });
  return true;
}

// ---------------------------------------------------------------- statistics
const sorted = (a) => a.slice().sort((x, y) => x - y);
const q = (a, f) => { const s = sorted(a); return s.length ? s[Math.min(s.length - 1, Math.round((s.length - 1) * f))] : NaN; };
const median = (a) => q(a, 0.5);
const iqr = (a) => q(a, 0.75) - q(a, 0.25);
const r2 = (x) => (Number.isFinite(x) ? Math.round(x * 100) / 100 : x);

// ---------------------------------------------------------------- modes
async function setup(tab, path, magic) {
  await tab.load(path, magic === "awake" ? "magic=all" : "");
  // Let shaders, workers and LOD builds arrive.
  await sleep(QUICK ? 2500 : 5000);
}

async function measureView(tab, view, minutes) {
  const e = tab.evaluate;
  await e(`__perf.resume(); skycope.budget.pin(0); __perf.place(${JSON.stringify(view)}, ${minutes})`);
  await sleep(1500);
  await e(`__perf.place(${JSON.stringify(view)}, ${minutes})`);
  await sleep(500);
  // Free-running frame intervals at full quality (vsync-quantised).
  await e("__perf.record(true)");
  await sleep(QUICK ? 1500 : 3000);
  const intervals = await e("__perf.record(false)");
  await e(`await __perf.pause(); __perf.place(${JSON.stringify(view)}, ${minutes}); __perf.step(12)`);
  const counts = await e("__perf.counts()");
  const refresh = await e("__perf.refreshCounts()");
  const ms = [];
  for (let r = 0; r < ROUNDS; r++) {
    await e(`__perf.place(${JSON.stringify(view)}, ${minutes})`);
    ms.push(await e(`await __perf.bench(${K})`));
  }
  const alloc = await allocation(tab);
  const quality = await e("__perf.quality()");
  await e("__perf.resume()");
  return {
    view, minutes,
    frame: { p50: r2(q(intervals, 0.5)), p95: r2(q(intervals, 0.95)), n: intervals.length },
    bench: { median: r2(median(ms)), iqr: r2(iqr(ms)), rejected: iqr(ms) > 0.1 * median(ms), rounds: ms.map(r2) },
    ...counts,
    refresh,
    alloc,
    meshGpuMs: quality.meshGpuMs === null ? null : r2(quality.meshGpuMs),
    sizes: quality.sizes,
  };
}

// Bytes allocated per frame over 60 paused frames (sampling heap profiler,
// collected objects included), and the functions allocating most.
async function allocation(tab) {
  const frames = 60;
  await tab.send("HeapProfiler.enable");
  await tab.send("HeapProfiler.startSampling", { samplingInterval: 512, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
  await tab.evaluate(`__perf.step(${frames})`);
  const { result } = await tab.send("HeapProfiler.stopSampling");
  const by = new Map();
  let total = 0;
  const walk = (node) => {
    const self = node.selfSize;
    if (self) {
      total += self;
      const f = node.callFrame;
      const key = `${f.functionName || "(anon)"} ${f.url.split("/").pop().split("?")[0]}:${f.lineNumber + 1}`;
      by.set(key, (by.get(key) ?? 0) + self);
    }
    for (const c of node.children ?? []) walk(c);
  };
  walk(result.profile.head);
  const top = [...by.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => [k, Math.round(v / frames)]);
  return { bytesPerFrame: Math.round(total / frames), top };
}

async function governor(tab, minutes) {
  // Released, free-running, cycling the views: what the budget settles on.
  await tab.evaluate("__perf.resume(); skycope.budget.pin(null)");
  const trace = [];
  const t0 = Date.now();
  for (const view of VIEWS) {
    await tab.evaluate(`__perf.place(${JSON.stringify(view)}, ${minutes})`);
    for (let i = 0; i < 4; i++) {
      await sleep(1000);
      const qy = await tab.evaluate("__perf.quality()");
      trace.push({ t: Math.round((Date.now() - t0) / 100) / 10, view, level: qy.level, land: qy.sizes?.land, sea: qy.sizes?.sea, sky: qy.sizes?.sky });
    }
  }
  const last = trace[trace.length - 1];
  const worst = trace.reduce((a, b) => (b.level > a.level ? b : a), trace[0]);
  return { final: last, worst, trace };
}

async function bench() {
  const browser = await launchChrome();
  const tab = await openTab(browser);
  const results = [];
  try {
    for (const magic of MAGIC) {
      await setup(tab, "/", magic);
      for (const minutes of TIMES) {
        const gov = QUICK ? null : await governor(tab, minutes);
        if (gov) console.log(`governor ${magic} ${minutes}: final level ${gov.final.level} land ${gov.final.land}, worst level ${gov.worst.level}`);
        for (const view of VIEWS) {
          const r = await measureView(tab, view, minutes);
          r.magic = magic;
          r.governor = gov ? { final: gov.final, worst: gov.worst } : null;
          results.push(r);
          console.log(`${magic.padEnd(6)} ${String(minutes).padEnd(5)} ${view.padEnd(11)} tri ${r.triangles} calls ${r.calls} bench ${r.bench.median}±${r.bench.iqr} ms p50 ${r.frame.p50} p95 ${r.frame.p95} alloc ${r.alloc.bytesPerFrame} B/f`);
        }
        if (gov) results.push({ magic, minutes, governorTrace: gov.trace });
      }
    }
  } finally {
    browser.close();
  }
  const env = await environment();
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "bench.json"), JSON.stringify({ env, results }, null, 1));
  const rows = results.filter((r) => r.view);
  const md = [
    `# perf bench (${env.commit}, ${env.date})`, "",
    `${W}x${H} dpr ${DPR}, seed ${SEED}, ${opt.headed ? "headed" : "headless"} Chrome, K=${K} × ${ROUNDS} rounds. Load: ${env.load}.`, "",
    "| gifts | time | view | frame p50 | frame p95 | bench median ± IQR (ms) | triangles | calls | refresh tri / calls | geometries | programs | alloc B/frame | land px |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|---|",
    ...rows.map((r) => `| ${r.magic} | ${r.minutes} | ${r.view} | ${r.frame.p50} | ${r.frame.p95} | ${r.bench.median} ± ${r.bench.iqr}${r.bench.rejected ? " (noisy)" : ""} | ${r.triangles} | ${r.calls} | ${r.refresh.triangles} / ${r.refresh.calls} | ${r.geometries} | ${r.programs} | ${r.alloc.bytesPerFrame} | ${r.sizes?.land?.join("x")} |`),
    "",
    "Governor (released, free-running, cycling views):", "",
    ...results.filter((r) => r.governorTrace).map((r) => `- ${r.magic} ${r.minutes}: ${r.governorTrace.map((t) => `${t.level}`).join(" ")} (final land ${r.governorTrace.at(-1).land?.join("x")})`),
  ].join("\n");
  await writeFile(join(OUT, "bench.md"), md + "\n");
  console.log(`\n${md}\n\nwrote ${join(OUT, "bench.json")}`);
}

// A detached copy of <ref>'s page and src under perf-base/, served by the same
// dev server at /perf-base/.
async function prepareBase(ref, name = "perf-base") {
  const dir = join(ROOT, name);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  execFileSync("sh", ["-c", `git archive ${ref} src index.html | tar -x -C ${name}`], { cwd: ROOT });
  const html = await readFile(join(dir, "index.html"), "utf8");
  await writeFile(join(dir, "index.html"), html.replace('src="/src/main.js"', `src="/${name}/src/main.js"`));
  return `/${name}/`;
}

async function ab() {
  const ref = opt.base;
  if (!ref) throw new Error("ab needs --base <git-ref>");
  const basePath = await prepareBase(ref);
  // `--head <ref>`: a frozen snapshot instead of the working tree, so src
  // can change while the A/B runs.
  const headPath = opt.head ? await prepareBase(opt.head, "perf-head") : "/";
  const browser = await launchChrome();
  const A = await openTab(browser), B = await openTab(browser);
  const results = [];
  try {
    for (const magic of MAGIC) {
      await A.activate(); await setup(A, basePath, magic);
      await B.activate(); await setup(B, headPath, magic);
      for (const minutes of TIMES) for (const view of VIEWS) {
        const counts = {};
        for (const [name, tab] of [["base", A], ["head", B]]) {
          await tab.activate();
          await tab.evaluate(`__perf.resume(); skycope.budget.pin(0); __perf.place(${JSON.stringify(view)}, ${minutes})`);
          await sleep(1200);
          await tab.evaluate(`await __perf.pause(); __perf.place(${JSON.stringify(view)}, ${minutes}); __perf.step(12)`);
          counts[name] = await tab.evaluate("__perf.counts()");
          counts[name].alloc = await allocation(tab);
        }
        const ratios = [], cpuRatios = [], base = [], head = [];
        for (let r = 0; r < ROUNDS; r++) {
          const pair = [], cpu = [];
          for (const [tab, list] of r % 2 ? [[B, head], [A, base]] : [[A, base], [B, head]]) {
            await tab.activate();
            await tab.evaluate(`__perf.place(${JSON.stringify(view)}, ${minutes})`);
            const [ms, cpuMs] = await tab.evaluate(`[await __perf.bench(${K}), __perf.lastCpu]`);
            list.push(ms);
            pair.push(ms);
            cpu.push(cpuMs);
          }
          ratios.push(r % 2 ? pair[0] / pair[1] : pair[1] / pair[0]);
          cpuRatios.push(r % 2 ? cpu[0] / cpu[1] : cpu[1] / cpu[0]);
        }
        for (const tab of [A, B]) await tab.evaluate("__perf.resume()");
        const row = {
          magic, minutes, view,
          ratio: Math.round(median(ratios) * 1000) / 1000, ratioIqr: Math.round(iqr(ratios) * 1000) / 1000,
          cpuRatio: Math.round(median(cpuRatios) * 1000) / 1000, cpuIqr: Math.round(iqr(cpuRatios) * 1000) / 1000,
          baseMs: r2(median(base)), headMs: r2(median(head)),
          base: counts.base, head: counts.head,
        };
        results.push(row);
        console.log(`${magic.padEnd(6)} ${String(minutes).padEnd(5)} ${view.padEnd(11)} head/base ${row.ratio} (IQR ${row.ratioIqr}) cpu ${row.cpuRatio} (IQR ${row.cpuIqr}) tri ${row.base.triangles}→${row.head.triangles} calls ${row.base.calls}→${row.head.calls} geo ${row.base.geometries}→${row.head.geometries} alloc ${row.base.alloc.bytesPerFrame}→${row.head.alloc.bytesPerFrame}`);
      }
    }
  } finally {
    browser.close();
    await rm(join(ROOT, "perf-base"), { recursive: true, force: true });
    await rm(join(ROOT, "perf-head"), { recursive: true, force: true });
  }
  const env = await environment();
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "ab.json"), JSON.stringify({ env, base: ref, results }, null, 1));
  const md = [
    `# perf A/B: ${opt.head ?? env.commit} against ${ref} (${env.date})`, "",
    `Two tabs, one ${opt.headed ? "headed" : "headless"} Chrome, ${W}x${H} dpr ${DPR}, interleaved K=${K} × ${ROUNDS}. Ratio = median of per-round head/base time: whole frame (GPU drained), and CPU (JS + GL submission). Load: ${env.load}.`, "",
    "| gifts | time | view | frame head/base | IQR | CPU head/base | IQR | triangles | calls | geometries | programs | alloc B/frame |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|",
    ...results.map((r) => `| ${r.magic} | ${r.minutes} | ${r.view} | ${r.ratio} | ${r.ratioIqr} | ${r.cpuRatio} | ${r.cpuIqr} | ${r.base.triangles} → ${r.head.triangles} | ${r.base.calls} → ${r.head.calls} | ${r.base.geometries} → ${r.head.geometries} | ${r.base.programs} → ${r.head.programs} | ${r.base.alloc.bytesPerFrame} → ${r.head.alloc.bytesPerFrame} |`),
  ].join("\n");
  await writeFile(join(OUT, "ab.md"), md + "\n");
  console.log(`\n${md}`);
}

// One tab; `--on` / `--off` are JS statements run in the page between rounds.
async function toggle() {
  const on = opt.on, off = opt.off;
  if (!on || !off) throw new Error("toggle needs --on '<js>' and --off '<js>'");
  const browser = await launchChrome();
  const tab = await openTab(browser);
  const results = [];
  try {
    for (const magic of MAGIC) {
      await setup(tab, "/", magic);
      for (const minutes of TIMES) for (const view of VIEWS) {
        const e = tab.evaluate;
        await e(`__perf.resume(); skycope.budget.pin(0); __perf.place(${JSON.stringify(view)}, ${minutes})`);
        await sleep(1200);
        await e(`await __perf.pause(); __perf.place(${JSON.stringify(view)}, ${minutes}); __perf.step(12)`);
        const ratios = [], onMs = [], offMs = [];
        const counts = {};
        for (const [name, js] of [["on", on], ["off", off]]) { await e(js); await e("__perf.step(4)"); counts[name] = await e("__perf.counts()"); }
        for (let r = 0; r < ROUNDS; r++) {
          await e(`__perf.place(${JSON.stringify(view)}, ${minutes})`);
          await e(on); await e("__perf.step(2)");
          const a = await e(`await __perf.bench(${K})`);
          await e(off); await e("__perf.step(2)");
          const b = await e(`await __perf.bench(${K})`);
          onMs.push(a); offMs.push(b); ratios.push(b / a);
        }
        await e(on);
        await e("__perf.resume()");
        const row = { magic, minutes, view, offOverOn: r2(median(ratios) * 100) / 100, iqr: r2(iqr(ratios) * 100) / 100, onMs: r2(median(onMs)), offMs: r2(median(offMs)), on: counts.on, off: counts.off };
        results.push(row);
        console.log(`${magic.padEnd(6)} ${String(minutes).padEnd(5)} ${view.padEnd(11)} off/on ${row.offOverOn} (IQR ${row.iqr}) tri ${row.on.triangles}→${row.off.triangles} calls ${row.on.calls}→${row.off.calls}`);
      }
    }
  } finally {
    browser.close();
  }
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "toggle.json"), JSON.stringify({ env: await environment(), on, off, results }, null, 1));
}

// Deterministic stills: reduced motion holds the clock and the cat; the
// animals, insects and the wisp are hidden.
async function shots() {
  const label = opt.label ?? "shots";
  const dir = join(OUT, label);
  await mkdir(dir, { recursive: true });
  // `--base <ref>`: stills of that ref (served from perf-base/), for before/after pairs.
  const path = opt.base ? await prepareBase(opt.base) : "/";
  const browser = await launchChrome();
  const tab = await openTab(browser);
  try {
    for (const magic of MAGIC) {
      await setup(tab, path, magic);
      for (const minutes of TIMES) for (const view of VIEWS) {
        const e = tab.evaluate;
        await tab.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });
        await e(`__perf.resume(); skycope.budget.pin(0); __perf.place(${JSON.stringify(view)}, ${minutes})`);
        await sleep(2500);
        await e(`__perf.place(${JSON.stringify(view)}, ${minutes})`);
        await sleep(1500);
        await e("__perf.markMovers()");
        await sleep(1000);
        const hidden = await e("__perf.hideMovers()");
        await tab.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
        await sleep(300);
        const png = await e("__perf.repack(); skycope.time = 1000; skycope.budget.pin(0); __perf.landPng()");
        const name = `${magic}-${minutes}-${view}`;
        await writeFile(join(dir, `${name}-land.png`), Buffer.from(png.split(",")[1], "base64"));
        const shot = await tab.send("Page.captureScreenshot", { format: "jpeg", quality: 90 });
        await writeFile(join(dir, `${name}.jpg`), Buffer.from(shot.result.data, "base64"));
        await e("__perf.showMovers()");
        console.log(name, `(${hidden} moving objects hidden)`);
      }
      await tab.send("Emulation.setEmulatedMedia", { features: [] });
    }
  } finally {
    browser.close();
  }
}

// Per-view difference of two `shots` directories' land layers.
async function diff() {
  const [a, b] = opt._.map((d) => resolve(d));
  const files = (await readdir(a)).filter((f) => f.endsWith("-land.png"));
  const rows = [];
  for (const f of files) {
    if (!existsSync(join(b, f))) continue;
    const [pa, pb] = [PNG.sync.read(await readFile(join(a, f))), PNG.sync.read(await readFile(join(b, f)))];
    if (pa.width !== pb.width || pa.height !== pb.height) { rows.push({ view: f, error: "size differs" }); continue; }
    let sum = 0, max = 0, over2 = 0, over8 = 0, mse = 0;
    const n = pa.width * pa.height;
    const heat = new PNG({ width: pa.width, height: pa.height });
    for (let i = 0; i < n; i++) {
      let m = 0;
      for (let c = 0; c < 4; c++) {
        const d = Math.abs(pa.data[i * 4 + c] - pb.data[i * 4 + c]);
        sum += d; mse += d * d; m = Math.max(m, d);
      }
      max = Math.max(max, m);
      if (m > 2) over2++;
      if (m > 8) over8++;
      const v = Math.min(255, m * 8);
      heat.data[i * 4] = v; heat.data[i * 4 + 1] = v; heat.data[i * 4 + 2] = v; heat.data[i * 4 + 3] = 255;
    }
    if (opt.heat) await writeFile(join(resolve(opt.heat), f.replace("-land.png", "-diff.png")), PNG.sync.write(heat));
    const meanAbs = sum / (n * 4);
    const psnr = 10 * Math.log10((255 * 255) / Math.max(1e-9, mse / (n * 4)));
    rows.push({ view: f.replace("-land.png", ""), meanAbs: Math.round(meanAbs * 1000) / 1000, max, over2: Math.round((over2 / n) * 10000) / 100, over8: Math.round((over8 / n) * 10000) / 100, psnr: Math.round(psnr * 10) / 10 });
  }
  const md = ["| view | mean abs (0–255) | max | % px > 2 | % px > 8 | PSNR dB |", "|---|---|---|---|---|---|", ...rows.map((r) => r.error ? `| ${r.view} | ${r.error} |` : `| ${r.view} | ${r.meanAbs} | ${r.max} | ${r.over2} | ${r.over8} | ${r.psnr} |`)].join("\n");
  console.log(md);
  if (opt.md) await writeFile(resolve(opt.md), md + "\n");
  return rows;
}

// A fresh browser plays the quest over and over: every ceremony, then begin
// again; between them it runs, meows and changes the time of day.
async function lifetime() {
  const minutes = Number(opt.minutes ?? 15);
  const browser = await launchChrome({ fresh: true });
  const tab = await openTab(browser);
  const e = tab.evaluate;
  const log = [];
  let ceremonies = 0, loops = 0;
  const started = Date.now();
  const sample = async (label) => {
    await tab.send("HeapProfiler.collectGarbage");
    const heap = (await tab.send("Runtime.getHeapUsage")).result;
    const dom = (await tab.send("Memory.getDOMCounters")).result;
    const mem = await e("__perf.memory()");
    const qy = await e("__perf.quality()");
    const row = {
      minute: Math.round((Date.now() - started) / 6000) / 10, label, ceremonies, loops,
      heapMB: Math.round((heap.usedSize / 1048576) * 10) / 10, totalMB: Math.round((heap.totalSize / 1048576) * 10) / 10,
      geometries: mem.geometries, textures: mem.textures, programs: mem.programs, objects: mem.objects,
      gl: mem.counts.gl, gpu: mem.counts.gpu,
      nodes: dom.nodes, listeners: dom.jsEventListeners, documents: dom.documents, level: qy.level,
    };
    log.push(row);
    console.log(`${row.minute.toFixed(1).padStart(5)} min  heap ${row.heapMB} MB  geo ${row.geometries} tex ${row.textures} prog ${row.programs} obj ${row.objects}  glBuf ${row.gl.Buffer} glTex ${row.gl.Texture} vao ${row.gl.VertexArray}  gpuBuf ${(row.gpu.BufferCreated ?? 0) - (row.gpu.BufferDestroyed ?? 0)} gpuTex ${(row.gpu.TextureCreated ?? 0) - (row.gpu.TextureDestroyed ?? 0)} pipes ${(row.gpu.RenderPipelineCreated ?? 0) + (row.gpu.ComputePipelineCreated ?? 0)}  listeners ${row.listeners} nodes ${row.nodes}  ceremonies ${ceremonies} loops ${loops}  ${label}`);
  };
  try {
    await tab.load("/", "", { quest: true });
    await sleep(6000);
    await sample("loaded");
    let nextSample = Date.now() + 60000;
    let night = false;
    const hold = async (keys, ms) => {
      for (const k of keys) await e(`skycope.keys.add(${JSON.stringify(k)}); skycope.lastInput = performance.now()`);
      await sleep(ms);
      await e("skycope.keys.clear()");
    };
    while (Date.now() - started < minutes * 60000) {
      // The next keepsake the quest wants (or the summit for the finale).
      const target = await e(`(() => {
        const s = skycope, m = s.magic, K = { milkwood: "fireflies", wreck: "tideglow", lighthouse: "lamp", beacon: "stars", pool: "seafolk", boat: "boat" };
        const c = s.walker.cat;
        const sleeping = s.landscape.pois.filter((p) => K[p.id] && !m.isAwake(K[p.id]));
        if (sleeping.length) { sleeping.sort((a, b) => Math.hypot(a.x - c.x, a.z - c.z) - Math.hypot(b.x - c.x, b.z - c.z)); return sleeping[0]; }
        if (!m.isAwake("finale")) return s.landscape.pois.find((p) => p.id === "beacon") ?? null;
        return null;
      })()`);
      if (!target) {
        await e("skycope.thread.journey.beginAgain()");
        loops++;
      } else {
        // Arrive from a few metres off, then walk in.
        await e(`(() => { const s = skycope, w = s.walker, c = w.cat, t = ${JSON.stringify(target)};
          const a = Math.atan2(58 - t.x, 70 - t.z), d = (t.r || 4) * 0.6;
          c.x = t.x + Math.sin(a) * d; c.z = t.z + Math.cos(a) * d; c.y = w.surface(c.x, c.z); c.speed = 0; c.vy = 0; c.air = 0; c.heading = a + Math.PI;
          s.lastInput = performance.now(); })()`);
        await hold(["w"], 700);
        let began = false;
        for (let i = 0; i < 60; i++) {
          const busy = await e("!!skycope.thread.journey.ceremony");
          if (busy) began = true;
          if (began && !busy) break;
          if (!began && i > 10) break;
          await sleep(1000);
        }
        if (began) ceremonies++;
      }
      // Play between: run, meow, jump, and now and then day ↔ night.
      await hold(["w", "shift"], 2500);
      await e("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'm' })); window.dispatchEvent(new KeyboardEvent('keydown', { key: 'm' }))");
      await hold(["a", "w"], 1200);
      await hold([" "], 300);
      if (Math.random() < 0.35) {
        night = !night;
        await e(`(() => { const sl = document.querySelector('#time'); sl.value = ${night ? 1320 : 750}; sl.dispatchEvent(new Event('input')); })()`);
      }
      if (Date.now() >= nextSample) {
        nextSample += 60000;
        await sample(target ? `after ${target.id}` : "begin again");
      }
    }
    await sample("end");
  } finally {
    browser.close();
  }
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "lifetime.json"), JSON.stringify({ env: await environment(), log, errors: tab.errors }, null, 1));
  const md = [
    `# lifetime (${minutes} min, fresh browser)`, "",
    "| min | heap MB (after GC) | geometries | textures | programs | scene objects | GL buffers | GL textures | VAOs | GPU buffers live | GPU textures live | pipelines made | listeners | DOM nodes | ceremonies | loops |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|",
    ...log.map((r) => `| ${r.minute} | ${r.heapMB} | ${r.geometries} | ${r.textures} | ${r.programs} | ${r.objects} | ${r.gl.Buffer} | ${r.gl.Texture} | ${r.gl.VertexArray} | ${(r.gpu.BufferCreated ?? 0) - (r.gpu.BufferDestroyed ?? 0)} | ${(r.gpu.TextureCreated ?? 0) - (r.gpu.TextureDestroyed ?? 0)} | ${(r.gpu.RenderPipelineCreated ?? 0) + (r.gpu.ComputePipelineCreated ?? 0)} | ${r.listeners} | ${r.nodes} | ${r.ceremonies} | ${r.loops} |`),
  ].join("\n");
  await writeFile(join(OUT, "lifetime.md"), md + "\n");
  console.log(`\n${md}`);
}

async function environment() {
  const git = (args) => { try { return execFileSync("git", args, { cwd: ROOT }).toString().trim(); } catch { return "?"; } };
  let load = "?";
  try { load = execFileSync("sysctl", ["-n", "vm.loadavg"]).toString().trim(); } catch {}
  return { commit: git(["rev-parse", "--short", "HEAD"]) + (git(["status", "--porcelain", "src"]) ? "+dirty" : ""), date: new Date().toISOString(), load, size: [W, H], dpr: DPR, seed: SEED, headed: Boolean(opt.headed) };
}

// Ad-hoc investigation: `--script <file.mjs>` default-exports
// async ({ tab, evaluate, sleep, shot, load }) => result, run against one tab.
async function probe() {
  const { default: run } = await import(resolve(opt.script));
  const browser = await launchChrome();
  const tab = await openTab(browser);
  await mkdir(OUT, { recursive: true });
  try {
    const shot = async (name) => {
      const r = await tab.send("Page.captureScreenshot", { format: "jpeg", quality: 85 });
      await writeFile(join(OUT, `${name}.jpg`), Buffer.from(r.result.data, "base64"));
    };
    const result = await run({ tab, evaluate: tab.evaluate, sleep, shot, load: (magic = "asleep") => setup(tab, "/", magic), opt });
    if (result !== undefined) console.log(JSON.stringify(result, null, 1));
    if (tab.errors.length) console.log("page errors:", tab.errors.slice(0, 8));
  } finally {
    browser.close();
  }
}

const MODES = { bench, ab, toggle, shots, diff, lifetime, probe };
if (!MODES[mode]) {
  console.error(`unknown mode ${mode}; one of ${Object.keys(MODES).join(", ")}`);
  process.exit(1);
}
await MODES[mode]();
process.exit(0);
