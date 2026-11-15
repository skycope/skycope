// Visual stability detector: does the picture ever visibly re-render, step,
// pop, flash or blank in front of the visitor?
//
//   node scripts/stability.mjs [--sessions still,walk,orbit,time,gift,throttle]
//        [--port 5357] [--cdp 9427] [--out docs/review/stability/after]
//        [--size 1280x800] [--dpr 1] [--seed 1847] [--still 60] [--headed] [--keep 3]
//
// Each session opens a fresh tab on the running dev server with `?perf`,
// records every frame the compositor presents (CDP screencast, PNG, full
// size) and drains the page's event log (src/stability-log.js: the budget,
// resizes, the reveal, shadow refreshes, prewarm, LOD switches, time and
// weather changes, one record per rendered frame with the camera). Then it
// flags, frame by frame:
//   blank     the land half of the frame near-uniform (no land drawn), or
//             mostly the page's flat background colour
//   lum       a step in the frame's mean luminance that persists, with the
//             camera still
//   sharp     a step in the frame's Laplacian energy (resolution, MSAA or
//             detail) that persists, with the camera still
//   pop       a connected region whose change in one frame is abrupt against
//             its own motion in the frames either side, and stays changed
//             (works through slow camera motion; counted separately)
//   flash     a region that changes for one frame and changes back
//   hitch     a gap of 100 ms+ between rendered frames (a frozen picture)
//   resize    a canvas changing size; `unsynced` when it happened outside
//             the frame boundary (a cleared canvas can be shown)
// and lists, per flagged frame, the events logged in the frames it shows.
// Output: <out>/stability.json, <out>/stability.md and crops of the worst
// frame pairs (a | b | difference) as PNG.
//
// Sessions: still (load and stand 60 s: the reveal, prewarm, budget at
// rest), walk (a walked loop), orbit (a fast camera turn, then rest), time
// (time-slider jumps: golden hour, noon, night, noon), gift (two gifts wake
// in turn), throttle (CPU throttled 4x for 25 s so the budget sheds, then
// released so it restores).
//
// Start the server first:
//   node node_modules/vite/bin/vite.js --port 5357 --strictPort --host 127.0.0.1
import { spawn, execFileSync } from "node:child_process";
import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync, readFileSync } from "node:fs";
import { ISLAND, islandPoint } from "../src/terrain.js";
import { PNG } from "pngjs";

const argv = process.argv.slice(2);
const opt = {};
for (let i = 0; i < argv.length; i++) {
  if (!argv[i].startsWith("--")) continue;
  const next = argv[i + 1];
  if (next === undefined || next.startsWith("--")) opt[argv[i].slice(2)] = true;
  else { opt[argv[i].slice(2)] = next; i++; }
}
const PORT = Number(opt.port ?? 5357);
const CDP = Number(opt.cdp ?? 9427);
const [W, H] = String(opt.size ?? "1280x800").split("x").map(Number);
const DPR = Number(opt.dpr ?? 1);
const SEED = Number(opt.seed ?? 1847);
const STILL = Number(opt.still ?? 60);
const KEEP = Number(opt.keep ?? 1);
const SESSIONS = String(opt.sessions ?? "still,walk,orbit,time,gift,throttle").split(",");
const OUT = resolve(opt.out ?? join(tmpdir(), "skycope-stability"));
const WEATHER = opt.weather ?? "clear";
const QUERY = opt.query ? `&${opt.query}` : "";
// --base <git ref>: measure that commit instead of the working tree, served
// by the same dev server from a snapshot in ./stab-base (so editing src/
// while a run is going changes nothing it measures).
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let PATH = "/";
if (opt.base) {
  const dir = join(ROOT, "stab-base");
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  execFileSync("sh", ["-c", `git archive ${opt.base} src index.html | tar -x -C stab-base`], { cwd: ROOT });
  const html = await readFile(join(dir, "index.html"), "utf8");
  // Every module the page loads from /src/ (the veil's script imports main.js and the loading screen itself).
  await writeFile(join(dir, "index.html"), html.replaceAll('"/src/', '"/stab-base/src/').replaceAll('src="/src/', 'src="/stab-base/src/'));
  PATH = "/stab-base/";
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The page's own background (index.html :root): what shows where no canvas drew.
const PAGE_BG = [143, 196, 227];
// Analysis grid: 16-pixel blocks of mean luma.
const BLOCK = 16;
// Thresholds (0…255 luma; tuned on the still session of the merged build).
const T = {
  blankStd: 5, blankBg: 0.5,
  lum: 0.8, sharp: 0.035, persist: 4,
  cell: 10, abrupt: 2.5, cellFloor: 3, popCells: 3, quiet: 2.5,
  hitch: 100,
  stillPos: 0.002, stillAngle: 0.0005,
};

// ---------------------------------------------------------------- Chrome + CDP
async function launchChrome() {
  const profile = join(tmpdir(), `skycope-stability-chrome-${CDP}`);
  await rm(profile, { recursive: true, force: true });
  const args = [
    `--remote-debugging-port=${CDP}`, `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check",
    "--enable-unsafe-webgpu", "--mute-audio", "--hide-scrollbars", `--window-size=${W},${H}`,
    "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows",
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

async function openTab(browser, onFrame) {
  const { targetId } = (await browser.send("Target.createTarget", { url: "about:blank" })).result;
  const { sessionId } = (await browser.send("Target.attachToTarget", { targetId, flatten: true })).result;
  const send = (method, params) => browser.send(method, params, sessionId);
  const errors = [];
  const listener = (m) => {
    if (m.sessionId !== sessionId) return;
    if (m.method === "Page.screencastFrame") {
      send("Page.screencastFrameAck", { sessionId: m.params.sessionId });
      onFrame(m.params);
    }
    if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description?.slice(0, 300) ?? m.params.exceptionDetails.text);
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errors.push(m.params.args.map((a) => a.value ?? a.description).join(" ").slice(0, 300));
  };
  browser.listeners.add(listener);
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: DPR, mobile: false, screenWidth: Math.max(W, 1440), screenHeight: Math.max(H, 900) });
  await send("Emulation.setFocusEmulationEnabled", { enabled: true });
  // No hot reload mid-session (editing src must not reload a measured page).
  await send("Page.addScriptToEvaluateOnNewDocument", { source: `(${quietHmr})()` });
  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text);
    return r.result?.result?.value;
  };
  return {
    send, evaluate, errors,
    async close() {
      browser.listeners.delete(listener);
      await browser.send("Target.closeTarget", { targetId });
    },
  };
}

function quietHmr() {
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
}

// ---------------------------------------------------------------- per-frame metrics
function measure(png) {
  const { width: w, height: h, data } = png;
  const n = w * h;
  const y = new Uint8Array(n);
  let sum = 0;
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const v = (54 * data[p] + 183 * data[p + 1] + 19 * data[p + 2]) >> 8;
    y[i] = v;
    sum += v;
  }
  const mean = sum / n;
  // The land half: below the horizon band, above the bottom UI strip.
  const y0 = Math.floor(h * 0.45), y1 = Math.floor(h * 0.9);
  let ls = 0, ls2 = 0, bg = 0, ln = 0;
  for (let j = y0; j < y1; j++) {
    for (let i = 0; i < w; i++) {
      const k = j * w + i;
      const v = y[k];
      ls += v; ls2 += v * v; ln++;
      const p = k * 4;
      if (Math.abs(data[p] - PAGE_BG[0]) < 10 && Math.abs(data[p + 1] - PAGE_BG[1]) < 10 && Math.abs(data[p + 2] - PAGE_BG[2]) < 10) bg++;
    }
  }
  const landMean = ls / ln;
  const landStd = Math.sqrt(Math.max(0, ls2 / ln - landMean * landMean));
  // Laplacian energy (sharpness), below the top UI row.
  let lap = 0, lapN = 0;
  for (let j = Math.floor(h * 0.12); j < h - 1; j += 1) {
    for (let i = 1; i < w - 1; i++) {
      const k = j * w + i;
      lap += Math.abs(4 * y[k] - y[k - 1] - y[k + 1] - y[k - w] - y[k + w]);
      lapN++;
    }
  }
  const gw = Math.floor(w / BLOCK), gh = Math.floor(h / BLOCK);
  const grid = new Float32Array(gw * gh);
  // Foliage cells: most of the block green or olive (green over red and blue).
  const leafy = new Uint8Array(gw * gh);
  for (let gj = 0; gj < gh; gj++) {
    for (let gi = 0; gi < gw; gi++) {
      let s = 0, g = 0;
      for (let j = gj * BLOCK; j < (gj + 1) * BLOCK; j++) {
        for (let i = gi * BLOCK; i < (gi + 1) * BLOCK; i++) {
          const k = j * w + i;
          s += y[k];
          const p = k * 4;
          if (data[p + 1] > data[p] + 3 && data[p + 1] > data[p + 2] + 6) g++;
        }
      }
      grid[gj * gw + gi] = s / (BLOCK * BLOCK);
      leafy[gj * gw + gi] = g > BLOCK * BLOCK * 0.5 && gj * BLOCK > h * 0.12 ? 1 : 0;
    }
  }
  // The foliage's mean brightness: sway averages out over many leaves;
  // a change of the light on them does not (plant lighting flicker).
  let leafSum = 0, leafN = 0;
  for (let i = 0; i < grid.length; i++) if (leafy[i]) { leafSum += grid[i]; leafN++; }
  return { mean, landStd, bg: bg / ln, sharp: lap / lapN, grid, leafy, leafMean: leafN > 20 ? leafSum / leafN : null, gw, gh, w, h };
}

// Cells that changed abruptly in frame b (against a→b's neighbours in time),
// and cells that flashed (changed in b and changed back in c).
function abrupt(f) {
  const [p, a, b, c] = f; // frames k-2, k-1, k, k+1
  const n = b.grid.length;
  const dtA = Math.max(1, a.t - p.t), dtB = Math.max(1, b.t - a.t), dtC = Math.max(1, c.t - b.t);
  const pop = new Uint8Array(n), flash = new Uint8Array(n), vanish = new Uint8Array(n);
  // Leaves that vanish: a cell leafy for two frames running (and steady
  // between them) that is not leafy in the next.
  for (let i = 0; i < n; i++) {
    if (p.leafy[i] && a.leafy[i] && !b.leafy[i] && Math.abs(a.grid[i] - p.grid[i]) < T.cell && Math.abs(b.grid[i] - a.grid[i]) > T.cell) vanish[i] = 1;
  }
  for (let i = 0; i < n; i++) {
    const d = Math.abs(b.grid[i] - a.grid[i]);
    if (d < T.cell) continue;
    // Only where the picture was at rest: surf, swash, animals and the
    // wisp change all the time and are not pops.
    if (p.act && p.act[i] > T.quiet) continue;
    const before = Math.abs(a.grid[i] - p.grid[i]) * (dtB / dtA);
    const after = Math.abs(c.grid[i] - b.grid[i]) * (dtB / dtC);
    const stays = Math.abs(c.grid[i] - a.grid[i]);
    if (d > T.abrupt * Math.max(before, after) + T.cellFloor && stays > 0.6 * d) pop[i] = 1;
    else if (after > T.cell && stays < 0.3 * d && before < 0.5 * d) flash[i] = 1;
  }
  return { pop: components(pop, b.gw, b.gh), flash: components(flash, b.gw, b.gh), vanish: components(vanish, b.gw, b.gh) };
}

// Foliage flicker in frame b: how far each leafy cell sits off the line
// between its neighbours in time (a, c), i.e. the frame-rate component of
// its brightness. Smooth sway and slow light changes give little; a light
// that jumps between frames (and back, or on) gives a lot. Returns the mean
// over leafy cells and the share of them off by more than 3/255.
function flicker(a, b, c) {
  let sum = 0, n = 0, over = 0;
  const wa = (c.t - b.t) / Math.max(1, c.t - a.t);
  for (let i = 0; i < b.grid.length; i++) {
    if (!b.leafy[i]) continue;
    const e = Math.abs(b.grid[i] - (a.grid[i] * wa + c.grid[i] * (1 - wa)));
    sum += e; n++;
    if (e > 3) over++;
  }
  return n > 20 ? { mean: sum / n, share: over / n, cells: n } : null;
}

function components(mask, gw, gh) {
  const seen = new Uint8Array(mask.length);
  let best = null, total = 0;
  for (let s = 0; s < mask.length; s++) {
    if (!mask[s] || seen[s]) continue;
    const stack = [s];
    seen[s] = 1;
    let cells = 0, x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
    while (stack.length) {
      const k = stack.pop();
      cells++;
      const x = k % gw, y = (k / gw) | 0;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
        const q = ny * gw + nx;
        if (mask[q] && !seen[q]) { seen[q] = 1; stack.push(q); }
      }
    }
    total += cells;
    if (!best || cells > best.cells) best = { cells, box: [x0 * BLOCK, y0 * BLOCK, (x1 + 1) * BLOCK, (y1 + 1) * BLOCK] };
  }
  return { cells: best?.cells ?? 0, total, box: best?.box ?? null };
}

// ---------------------------------------------------------------- one session
async function runSession(browser, name) {
  const frames = [];   // metrics per captured frame
  const raws = [];     // the last few PNG buffers, by frame index
  // Frames kept for evidence go to disk at once (memory stays flat).
  const spool = join(tmpdir(), `skycope-stability-${CDP}-${name}`);
  await rm(spool, { recursive: true, force: true });
  await mkdir(spool, { recursive: true });
  const saved = new Map(); // frame index → spooled PNG path
  let processing = Promise.resolve();
  let activity = null;
  let latest = null;
  const keepRaw = (i) => { if (!saved.has(i) && raws[i]) { const p = join(spool, `${i}.png`); writeFileSync(p, raws[i]); saved.set(i, p); } };
  let pending = 0, dropped = 0;
  const onFrame = (params) => {
    const t = (params.metadata.timestamp ?? Date.now() / 1000) * 1000;
    // Never more than a few frames waiting (memory stays flat; a dropped
    // frame only widens the gap the next one is compared across).
    if (pending > 3) { dropped++; return; }
    pending++;
    const buffer = Buffer.from(params.data, "base64");
    processing = processing.then(() => {
      pending--;
      let png;
      try { png = PNG.sync.read(buffer); } catch { return; }
      const k = frames.length;
      latest = png;
      const m = measure(png);
      m.t = t;
      frames.push(m);
      raws[k] = buffer;
      // Each cell's recent activity (mean change per 33 ms, decaying).
      if (k >= 1) {
        const a = frames[k - 1];
        const scale = 33 / Math.max(1, m.t - a.t);
        activity ??= new Float32Array(m.grid.length);
        for (let i = 0; i < activity.length; i++) activity[i] = activity[i] * 0.85 + Math.abs(m.grid[i] - a.grid[i]) * scale * 0.15;
        m.act = activity.slice();
      }
      if (k >= 4) raws[k - 4] = undefined;
      // Live candidates keep their pixels (the camera test comes later).
      if (m.landStd < T.blankStd || m.bg > T.blankBg) keepRaw(k);
      if (k >= 1) {
        const a = frames[k - 1];
        if (Math.abs(m.mean - a.mean) > T.lum || Math.abs(m.sharp / a.sharp - 1) > T.sharp) { keepRaw(k - 1); keepRaw(k); }
      }
      if (k >= 3) {
        const f = frames.slice(k - 3, k + 1);
        const r = abrupt(f);
        frames[k - 1].abrupt = r;
        frames[k - 1].flicker = flicker(f[1], f[2], f[3]);
        const [la, lb, lc] = [f[1], f[2], f[3]];
        if (la.leafMean !== null && lb.leafMean !== null && lc.leafMean !== null) {
          const wa = (lc.t - lb.t) / Math.max(1, lc.t - la.t);
          frames[k - 1].leafJump = Math.abs(lb.leafMean - (la.leafMean * wa + lc.leafMean * (1 - wa)));
        }
        if (r.pop.cells >= T.popCells || r.flash.cells >= T.popCells || r.vanish.cells >= T.popCells) { keepRaw(k - 2); keepRaw(k - 1); keepRaw(k); }
      }
      // Drop the grids the pop test no longer needs (memory).
      if (k >= 6) frames[k - 6].grid = frames[k - 6].act = frames[k - 6].leafy = null;
    });
  };
  const tab = await openTab(browser, onFrame);
  const marks = [];
  const mark = (label) => marks.push({ t: Date.now(), label });
  const events = [];
  const rendered = [];
  await tab.send("Page.startScreencast", { format: "png", maxWidth: W, maxHeight: H, everyNthFrame: 1 });
  mark("navigate");
  await tab.send("Page.navigate", { url: `http://127.0.0.1:${PORT}${PATH}?perf&seed=${SEED}&weather=${WEATHER}${QUERY}` });
  for (let i = 0; i < 300; i++) {
    if (await tab.evaluate("!!(window.skycope && skycope.stability && skycope.renderFrame && skycope.walker)").catch(() => false)) break;
    await sleep(200);
    if (i === 299) throw new Error(`${name}: page did not become ready: ${tab.errors.join(" | ")}`);
  }
  // No ceremony starts by itself (the gift session wakes gifts directly).
  await tab.evaluate("skycope.thread.journey.tick = () => {}; true").catch(() => {});
  let draining = true;
  const drain = async () => {
    const log = await tab.evaluate("skycope.stability.drain()").catch(() => null);
    if (log) { events.push(...log.events); rendered.push(...log.frames); }
  };
  const drainer = (async () => { while (draining) { await drain(); await sleep(1000); } })();
  const key = async (type, k) => {
    const codes = { w: ["KeyW", 87], a: ["KeyA", 65], d: ["KeyD", 68], s: ["KeyS", 83], shift: ["ShiftLeft", 16] };
    await tab.send("Input.dispatchKeyEvent", { type, key: k, code: codes[k][0], windowsVirtualKeyCode: codes[k][1] });
  };
  const script = SCRIPTS[name];
  if (!script) throw new Error(`unknown session ${name}`);
  // A small copy of the latest presented frame (from the screencast: a
  // screenshot with a clip scale re-lays the page out, and showed up as a
  // blank frame of its own).
  const still = (scale = 0.3) => {
    if (!latest) return null;
    const w = Math.floor(latest.width * scale), h = Math.floor(latest.height * scale);
    const out = new PNG({ width: w, height: h });
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) latest.data.copy(out.data, (y * w + x) * 4, (Math.floor(y / scale) * latest.width + Math.floor(x / scale)) * 4, (Math.floor(y / scale) * latest.width + Math.floor(x / scale)) * 4 + 4);
    return out;
  };
  await script({ tab, mark, key, still });
  mark("end");
  draining = false;
  await drainer;
  await drain();
  await tab.send("Page.stopScreencast");
  await sleep(300);
  await processing;
  const errors = tab.errors.slice();
  await tab.close();
  return { name, frames, events, rendered, marks, saved, errors };
}

const settleAfterLoad = async (tab, seconds) => {
  // Wait for the first frame, then `seconds`.
  for (let i = 0; i < 200; i++) {
    if (await tab.evaluate("skycope.revealedAt !== undefined").catch(() => false)) break;
    await sleep(100);
  }
  await sleep(seconds * 1000);
};

// The cat 11 m from the milkwood on the island's side, looking at it.
const toMilkwood = (tab, pin) => tab.evaluate(`(() => {
  const s = skycope, I = ${JSON.stringify({ x: ISLAND.x, z: ISLAND.z })};
  const p = s.landscape.pois.find((q) => q.id === "milkwood");
  const a = Math.atan2(I.x - p.x, I.z - p.z);
  const x = p.x + Math.sin(a) * 11, z = p.z + Math.cos(a) * 11;
  const c = s.walker.cat, cam = s.walker.camera;
  c.x = x; c.z = z; c.y = s.walker.surface(x, z); c.speed = 0; c.vy = 0; c.air = 0; c.heading = Math.atan2(p.x - x, p.z - z);
  cam.yaw = c.heading; cam.elevation = 0.22; cam.distance = 3.6; cam.targetY = c.y;
  if (${pin}) s.budget?.pin(0);
  return 1;
})()`);

// The movement lane's cases (scripts/walk-qa.mjs): the cat through grass,
// a forest run, up the slope, under the milkwood, the camera orbiting
// through crowns. [keys, ms, orbit rad/s].
const HOME = Math.atan2(0 - ISLAND.z, 6 - ISLAND.x);
const inward = (t) => Math.atan2(Math.cos(t), Math.sin(t)) + Math.PI;
const MILKWOOD = { x: 27.1, z: 73.9, facing: 3.18 };
const underMilkwood = { x: MILKWOOD.x + Math.sin(MILKWOOD.facing) * 7, z: MILKWOOD.z + Math.cos(MILKWOOD.facing) * 7 };
const ROUTES = {
  "foliage-walk": { pos: islandPoint(HOME, 9), heading: inward(HOME), prog: [[["w"], 1500], [["w", "a"], 900], [["w", "d"], 1200], [["w"], 1400]] },
  "forest-run": { pos: islandPoint(HOME + 0.25, 16), heading: inward(HOME + 0.25), prog: [[["w", "shift"], 2600], [["w"], 1400]] },
  "slope-up": { pos: islandPoint(HOME + 0.8, 26), heading: inward(HOME + 0.8), prog: [[["w"], 2500], [["w", "shift"], 2000]] },
  "milkwood-under": { pos: underMilkwood, heading: Math.atan2(MILKWOOD.x - underMilkwood.x, MILKWOOD.z - underMilkwood.z), prog: [[["w"], 2500], [["w", "d"], 2000], [["w"], 1500]] },
  "orbit-forest": { pos: islandPoint(HOME + 0.25, 20), heading: inward(HOME + 0.25), prog: [[[], 4000, Math.PI / 2], [[], 1500, 0]] },
};

const SCRIPTS = {
  async routes({ tab, mark, key, still }) {
    await settleAfterLoad(tab, 6);
    for (const [name, r] of Object.entries(ROUTES)) {
      await tab.evaluate(`(() => {
        const s = skycope, c = s.walker.cat, cam = s.walker.camera, p = ${JSON.stringify(r.pos)};
        c.x = p.x; c.z = p.z; c.y = s.walker.surface(p.x, p.z); c.speed = 0; c.vy = 0; c.air = 0; c.heading = ${r.heading};
        cam.yaw = ${r.heading}; cam.elevation = 0.38; cam.distance = 3.4; cam.targetY = c.y;
        return 1;
      })()`);
      await sleep(2500);
      mark(name);
      // A strip of the route for the eye: a small still every 0.6 s.
      const shots = [];
      let shooting = true;
      const shooter = (async () => {
        while (shooting && shots.length < 10) {
          const shot = still();
          if (shot) shots.push(shot);
          await sleep(600);
        }
      })();
      for (const [keys, ms, orbit] of r.prog) {
        for (const k of keys) await key("keyDown", k);
        if (orbit) await tab.evaluate(`(() => { window.__turn = setInterval(() => skycope.walker.orbit(${orbit / 60}, 0), 16); return 1; })()`);
        await sleep(ms);
        if (orbit) await tab.evaluate("clearInterval(window.__turn), 1");
        for (const k of keys) await key("keyUp", k);
      }
      shooting = false;
      await shooter;
      if (shots.length) await writeFile(join(OUT, `route-${name}.png`), PNG.sync.write(strip(shots)));
      await sleep(1000);
    }
  },
  async still({ tab, mark }) {
    await settleAfterLoad(tab, 0);
    mark("revealed");
    await sleep(STILL * 1000);
  },
  async walk({ tab, mark, key }) {
    await settleAfterLoad(tab, 8);
    mark("walk");
    await key("keyDown", "w");
    for (let lap = 0; lap < 4; lap++) {
      await sleep(4500);
      await key("keyDown", "a");
      await sleep(1800);
      await key("keyUp", "a");
    }
    await key("keyUp", "w");
    mark("rest");
    await sleep(10000);
  },
  async orbit({ tab, mark }) {
    await settleAfterLoad(tab, 8);
    mark("orbit");
    await tab.evaluate(`(() => { const id = setInterval(() => skycope.walker.orbit(0.09, 0), 16); setTimeout(() => clearInterval(id), 8000); return 1; })()`);
    await sleep(8000);
    mark("rest");
    await sleep(14000);
  },
  async time({ tab, mark }) {
    await settleAfterLoad(tab, 8);
    for (const minutes of [1145, 750, 1320, 750]) {
      mark(`time ${minutes}`);
      await tab.evaluate(`(() => { const s = document.querySelector('#time'); s.value = ${minutes}; s.dispatchEvent(new Event('input')); return 1; })()`);
      await sleep(8000);
    }
  },
  async gift({ tab, mark }) {
    await settleAfterLoad(tab, 8);
    for (const gift of ["fireflies", "lamp"]) {
      mark(`gift ${gift}`);
      await tab.evaluate(`(skycope.waking.play(${JSON.stringify(gift)}), 1)`).catch((e) => console.log("  gift:", e.message));
      await sleep(12000);
    }
  },
  // Plant lighting flicker: the camera on the milkwood's slope, one suspect
  // switched off per phase (src/landscape.js `debug`), still and then slowly
  // turning, then walking. The budget is pinned so its steps do not confound.
  // The milkwood's slope, the camera still, 40 s: plant lighting flicker
  // as the visitor would see it standing (try --weather cloudy).
  async leaves({ tab, mark }) {
    await settleAfterLoad(tab, 6);
    await toMilkwood(tab, false);
    await sleep(4000);
    mark("still");
    await sleep(40000);
  },
  async foliage({ tab, mark, key }) {
    await settleAfterLoad(tab, 6);
    await toMilkwood(tab, true);
    await sleep(5000);
    const reset = `Object.assign(skycope.landscape.debug, { shadows: "live", canopy: true, fold: true, lod: true, wind: true }); skycope.landscape.setQuality(skycope.settings);`;
    const phases = [
      ["live", ""],
      ["shadows frozen", `skycope.landscape.debug.shadows = "frozen"`],
      ["shadows whole", `skycope.landscape.debug.shadows = "whole"`],
      ["canopy frozen", `skycope.landscape.debug.canopy = false`],
      ["fold off", `skycope.landscape.debug.fold = false`],
      ["lod frozen", `skycope.landscape.debug.lod = false`],
      ["wind off", `skycope.landscape.debug.wind = false`],
      ["msaa 4", `skycope.landscape.setQuality({ ...skycope.settings, msaa: 4 })`],
      ["msaa 0", `skycope.landscape.setQuality({ ...skycope.settings, msaa: 0 })`],
    ];
    for (const motion of ["still", "turning", "walking"]) {
      for (const [label, js] of motion === "still" ? phases : phases.slice(0, 6)) {
        await tab.evaluate(`${reset} ${js}; 1`);
        mark(`${motion}: ${label}`);
        if (motion === "turning") {
          await tab.evaluate(`(() => { window.__turn = setInterval(() => skycope.walker.orbit(0.004, 0), 16); return 1; })()`);
          await sleep(6000);
          await tab.evaluate("clearInterval(window.__turn), 1");
        } else if (motion === "walking") {
          // Out and back, the same way each phase.
          await key("keyDown", "w");
          await sleep(4000);
          await key("keyUp", "w");
          await key("keyDown", "s");
          await sleep(4000);
          await key("keyUp", "s");
        } else await sleep(6000);
      }
    }
    await tab.evaluate(`${reset} 1`);
  },
  async throttle({ tab, mark }) {
    await settleAfterLoad(tab, 8);
    mark("throttle 4x");
    await tab.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await sleep(25000);
    mark("released");
    await tab.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    await sleep(35000);
  },
};

// ---------------------------------------------------------------- analysis
function analyse(run) {
  const { frames, events, rendered, marks } = run;
  rendered.sort((a, b) => a[0] - b[0]);
  events.sort((a, b) => a.t - b.t);
  const first = events.find((e) => e.kind === "first-frame")?.t ?? rendered[0]?.[0] ?? 0;
  // The camera at wall time t: the last rendered frame at or before it.
  const at = (t) => {
    let lo = 0, hi = rendered.length - 1, best = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (rendered[mid][0] <= t) { best = mid; lo = mid + 1; } else hi = mid - 1; }
    return best;
  };
  const same = (i, j) => {
    if (i < 0 || j < 0) return false;
    const a = rendered[i], b = rendered[j];
    for (let k = 1; k <= 3; k++) if (Math.abs(a[k] - b[k]) > T.stillPos) return false;
    for (let k = 4; k <= 5; k++) if (Math.abs(a[k] - b[k]) > T.stillAngle) return false;
    return true;
  };
  // Still across the frames a..b (indices into `frames`), every rendered frame between.
  const stillOver = (a, b) => {
    if (a < 0 || b >= frames.length) return false;
    const i0 = at(frames[a].t - 150), i1 = at(frames[b].t);
    if (i0 < 0 || i1 < 0) return false;
    for (let i = i0 + 1; i <= i1; i++) if (!same(i0, i)) return false;
    return true;
  };
  const eventsFor = (k) => {
    const t1 = frames[k].t, t0 = (frames[k - 1]?.t ?? t1 - 100) - 150;
    return events.filter((e) => e.t > t0 && e.t <= t1 && e.kind !== "lod-pack").map(describe)
      .concat((() => { const n = events.filter((e) => e.t > t0 && e.t <= t1 && e.kind === "lod-pack").reduce((s, e) => s + e.chunks, 0); return n ? [`lod-pack ${n} chunks`] : []; })());
  };
  const phase = (t) => {
    let label = "load";
    for (const m of marks) if (m.t <= t) label = m.label;
    return label;
  };
  const flags = [];
  const camAt = (k) => { const i = at(frames[k].t); return i < 0 ? null : rendered[i].slice(1, 4).map((v) => +v.toFixed(1)); };
  const flag = (kind, k, detail) => flags.push({ kind, frame: k, t: Math.round(frames[k].t - first), phase: phase(frames[k].t), still: detail.still ?? null, ...detail, eye: camAt(k), events: eventsFor(k) });
  const loaded = (k) => frames[k].t > first; // after the first rendered frame
  for (let k = 1; k < frames.length; k++) {
    const f = frames[k];
    if (!loaded(k)) continue;
    // Blank: from the first frame on, the land must always be there.
    if (f.landStd < T.blankStd || f.bg > T.blankBg) flag("blank", k, { landStd: +f.landStd.toFixed(2), bg: +f.bg.toFixed(3) });
    const P = T.persist;
    if (k >= P && k + P < frames.length) {
      const still = stillOver(k - P, k + P - 1);
      const mean = (a, b, key) => { let s = 0; for (let i = a; i < b; i++) s += frames[i][key]; return s / (b - a); };
      const dl = f.mean - frames[k - 1].mean;
      const persistL = mean(k, k + P, "mean") - mean(k - P, k, "mean");
      if (still && Math.abs(dl) > T.lum && Math.abs(persistL) > T.lum && Math.sign(dl) === Math.sign(persistL)) flag("lum", k, { still, step: +dl.toFixed(2) });
      const ds = f.sharp / frames[k - 1].sharp - 1;
      const persistS = mean(k, k + P, "sharp") / mean(k - P, k, "sharp") - 1;
      if (still && Math.abs(ds) > T.sharp && Math.abs(persistS) > T.sharp && Math.sign(ds) === Math.sign(persistS)) flag("sharp", k, { still, step: +(ds * 100).toFixed(1) });
    }
    const r = f.abrupt;
    if (r && k >= 2 && k + 1 < frames.length) {
      const still = stillOver(k - 2, k + 1);
      if (r.pop.cells >= T.popCells) flag("pop", k, { still, cells: r.pop.cells, pixels: r.pop.cells * BLOCK * BLOCK, box: r.pop.box, all: r.pop.total });
      if (r.flash.cells >= T.popCells) flag("flash", k, { still, cells: r.flash.cells, pixels: r.flash.cells * BLOCK * BLOCK, box: r.flash.box });
      if (r.vanish.cells >= T.popCells) flag("vanish", k, { still, cells: r.vanish.cells, pixels: r.vanish.cells * BLOCK * BLOCK, box: r.vanish.box });
    }
  }
  // Hitches: gaps between rendered frames (after the first), beyond the pacing.
  const hitches = [];
  for (let i = 1; i < rendered.length; i++) {
    const gap = rendered[i][0] - rendered[i - 1][0];
    if (rendered[i][0] > first + 500 && gap > T.hitch) {
      const t0 = rendered[i - 1][0], t1 = rendered[i][0];
      hitches.push({ t: Math.round(t0 - first), ms: Math.round(gap), phase: phase(t0), events: events.filter((e) => e.t >= t0 - 5 && e.t <= t1).map(describe) });
    }
  }
  // Foliage flicker by phase (and over every frame with the camera still).
  const byPhase = {};
  let stillSum = 0, stillN = 0;
  for (let k = 2; k + 1 < frames.length; k++) {
    const fl = frames[k].flicker;
    if (!fl || !loaded(k)) continue;
    const p = (byPhase[phase(frames[k].t)] ??= { mean: 0, share: 0, frames: 0, still: 0 });
    p.mean += fl.mean; p.share += fl.share; p.frames++;
    if (stillOver(k - 1, k + 1)) { p.still++; stillSum += fl.mean; stillN++; }
  }
  const flicker = Object.fromEntries(Object.entries(byPhase).map(([k, p]) => [k, { mean: +(p.mean / p.frames).toFixed(3), share: +(p.share / p.frames).toFixed(4), frames: p.frames, still: p.still }]));
  const resizes = events.filter((e) => e.kind === "resize");
  const count = (kind, still = null) => flags.filter((f) => f.kind === kind && (still === null || f.still === still)).length;
  const summary = {
    session: run.name,
    captured: frames.length,
    rendered: rendered.length,
    seconds: rendered.length ? +((rendered[rendered.length - 1][0] - first) / 1000).toFixed(1) : 0,
    blank: count("blank"),
    lum: count("lum"),
    sharp: count("sharp"),
    popStill: count("pop", true),
    popMoving: count("pop", false),
    flashStill: count("flash", true),
    flashMoving: count("flash", false),
    vanishStill: count("vanish", true),
    vanishMoving: count("vanish", false),
    worstPopPixels: Math.max(0, ...flags.filter((f) => f.kind === "pop" && f.still).map((f) => f.pixels)),
    hitches: hitches.length,
    worstHitchMs: Math.max(0, ...hitches.map((h) => h.ms)),
    resizes: resizes.length,
    unsynced: resizes.filter((e) => !e.boundary).length,
    quality: events.filter((e) => e.kind === "quality").length,
    reveal: events.filter((e) => e.kind === "reveal").length,
    shadowSwaps: events.filter((e) => e.kind === "shadow-swap").length,
    placeLod: events.filter((e) => e.kind === "place-lod").length,
    animalLod: events.filter((e) => e.kind === "animal-lod").length,
    flicker: stillN ? +(stillSum / stillN).toFixed(3) : null,
    // The light on the foliage (mean of leafy cells) off the line between its
    // neighbours in time, camera still: mean, and frames over 0.5/255.
    leafLight: (() => { const v = []; for (let k = 1; k + 1 < frames.length; k++) if (frames[k].leafJump !== undefined && loaded(k) && stillOver(k - 1, k + 1)) v.push(frames[k].leafJump); return v.length ? +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(3) : null; })(),
    leafSteps: (() => { let n = 0; for (let k = 1; k + 1 < frames.length; k++) if (frames[k].leafJump > 0.5 && loaded(k) && stillOver(k - 1, k + 1)) n++; return n; })(),
    errors: run.errors.length,
  };
  const series = frames.map((f, k) => [Math.round(f.t - first), +f.mean.toFixed(2), +f.sharp.toFixed(2), f.flicker ? +f.flicker.mean.toFixed(2) : null, f.leafMean === null ? null : +f.leafMean.toFixed(2), k > 0 && stillOver(k - 1, k) ? 1 : 0]);
  return { summary, flags, hitches, flicker, series, lighting: lightingAfterTime(run, frames, events, rendered, first), events: events.filter((e) => e.kind !== "lod-pack").map((e) => ({ ...e, t: Math.round(e.t - first) })) };
}

// After each time jump: how long the picture takes to settle, how many
// visible luminance steps it takes on the way, and how many frames the
// shadows lag the sun.
function lightingAfterTime(run, frames, events, rendered, first) {
  const out = [];
  const jumps = events.filter((e) => e.kind === "time");
  for (const j of jumps) {
    const k0 = frames.findIndex((f) => f.t > j.t);
    if (k0 < 0) continue;
    const end = j.t + 6000;
    let last = k0, steps = 0;
    const ys = [];
    for (let k = k0; k < frames.length && frames[k].t < end; k++) {
      ys.push(+frames[k].mean.toFixed(1));
      const d = Math.abs(frames[k].mean - frames[k - 1].mean);
      if (d > 0.3) last = k;
      if (k > k0 + 1 && d > T.lum) steps++;
    }
    const swap = events.find((e) => e.kind === "shadow-swap" && e.t >= j.t);
    const framesToSwap = swap ? rendered.filter((r) => r[0] > j.t && r[0] <= swap.t).length : null;
    out.push({
      minutes: j.minutes,
      settleMs: Math.round(frames[last].t - j.t),
      stepsAfterFirst: steps,
      shadowLagFrames: framesToSwap,
      luminance: ys.slice(0, 40),
    });
  }
  return out;
}

function describe(e) {
  const { t, kind, ...rest } = e;
  const bits = Object.entries(rest).map(([k, v]) => `${k}=${Array.isArray(v) ? v.join("x") : v}`);
  return bits.length ? `${kind} ${bits.join(" ")}` : kind;
}

// ---------------------------------------------------------------- evidence
async function writeEvidence(run, result, dir) {
  const files = [];
  const worst = {};
  for (const f of result.flags) {
    const score = f.kind === "pop" || f.kind === "flash" ? f.pixels * (f.still ? 4 : 1) : f.kind === "blank" ? 1e9 : Math.abs(f.step ?? 0) * 1000;
    (worst[f.kind] ??= []).push({ f, score });
  }
  for (const [kind, list] of Object.entries(worst)) {
    list.sort((a, b) => b.score - a.score);
    let n = 0;
    for (const { f } of list) {
      if (n >= KEEP) break;
      const pa = run.saved.get(f.frame - 1), pb = run.saved.get(f.frame);
      const a = pa ? readFileSync(pa) : null, b = pb ? readFileSync(pb) : null;
      if (!b) continue;
      const name = `${run.name}-${kind}-${n + 1}.png`;
      await writeFile(join(dir, name), PNG.sync.write(pairImage(a ? PNG.sync.read(a) : null, PNG.sync.read(b), f.box)));
      f.image = name;
      files.push(name);
      n++;
    }
  }
  return files;
}

// a | b | |a − b| ×4, cropped round `box` (or the whole frame, halved).
function pairImage(a, b, box) {
  const w = b.width, h = b.height;
  let x0 = 0, y0 = 0, cw = w, ch = h, scale = 2;
  if (box) {
    scale = 1;
    const cx = (box[0] + box[2]) / 2, cy = (box[1] + box[3]) / 2;
    cw = Math.min(w, Math.max(360, (box[2] - box[0]) * 2));
    ch = Math.min(h, Math.max(240, (box[3] - box[1]) * 2));
    x0 = Math.max(0, Math.min(w - cw, Math.round(cx - cw / 2)));
    y0 = Math.max(0, Math.min(h - ch, Math.round(cy - ch / 2)));
  }
  // Each panel at most 360 px wide (evidence stays small in the repo).
  scale = Math.max(scale, Math.ceil(cw / 360));
  const ow = Math.floor(cw / scale), oh = Math.floor(ch / scale);
  const out = new PNG({ width: ow * 3 + 8, height: oh });
  out.data.fill(255);
  const px = (img, x, y) => { const p = ((y0 + y * scale) * w + (x0 + x * scale)) * 4; return [img.data[p], img.data[p + 1], img.data[p + 2]]; };
  for (let y = 0; y < oh; y++) {
    for (let x = 0; x < ow; x++) {
      const cb = px(b, x, y);
      const ca = a ? px(a, x, y) : cb;
      const put = (ox, c) => { const q = (y * out.width + ox + x) * 4; out.data[q] = c[0]; out.data[q + 1] = c[1]; out.data[q + 2] = c[2]; out.data[q + 3] = 255; };
      put(0, ca);
      put(ow + 4, cb);
      const d = Math.min(255, 4 * Math.max(Math.abs(ca[0] - cb[0]), Math.abs(ca[1] - cb[1]), Math.abs(ca[2] - cb[2])));
      put(2 * ow + 8, [d, d, d]);
    }
  }
  return out;
}

// Stills side by side, two rows.
function strip(shots) {
  const w = shots[0].width, h = shots[0].height, per = Math.ceil(shots.length / 2);
  const out = new PNG({ width: per * (w + 4), height: 2 * (h + 4) });
  out.data.fill(255);
  shots.forEach((img, n) => {
    const ox = (n % per) * (w + 4), oy = Math.floor(n / per) * (h + 4);
    for (let y = 0; y < Math.min(h, img.height); y++) img.data.copy(out.data, ((oy + y) * out.width + ox) * 4, y * img.width * 4, (y * img.width + Math.min(w, img.width)) * 4);
  });
  return out;
}

function markdown(results) {
  const cols = ["session", "captured", "seconds", "blank", "lum", "sharp", "popStill", "popMoving", "worstPopPixels", "flashStill", "flashMoving", "vanishStill", "vanishMoving", "flicker", "leafLight", "leafSteps", "hitches", "worstHitchMs", "resizes", "unsynced", "quality", "reveal", "shadowSwaps", "placeLod", "animalLod", "errors"];
  const lines = [
    `# Stability, ${new Date().toISOString().slice(0, 16)} (${W}x${H} @${DPR}, seed ${SEED})`,
    "",
    `| ${cols.join(" | ")} |`,
    `| ${cols.map(() => "---").join(" | ")} |`,
    ...results.map((r) => `| ${cols.map((c) => r.summary[c]).join(" | ")} |`),
    "",
    "Columns: frames captured (screencast) and seconds rendered; blank frames; persistent luminance",
    "and sharpness steps with the camera still; pops (abrupt local changes that stay) with the camera",
    "still and moving, the worst still one in pixels; one-frame flashes; hitches (gaps of 100 ms+",
    "between rendered frames) and the worst; canvas resizes and those outside the frame boundary;",
    "budget level changes; reveal steps; shadow-map swaps; landmark and animal LOD switches.",
    "",
  ];
  for (const r of results) {
    lines.push(`## ${r.summary.session}`, "");
    const shown = r.flags.filter((f) => f.kind !== "pop" || f.still).slice(0, 40);
    for (const f of shown) lines.push(`- ${f.t} ms [${f.phase}] **${f.kind}**${f.still === false ? " (moving)" : ""} ${f.pixels ? f.pixels + " px" : f.step !== undefined ? "step " + f.step : ""}${f.image ? ` ![](${f.image})` : ""} — ${f.events.join("; ") || "no event"}`);
    const moving = r.flags.filter((f) => f.kind === "pop" && !f.still).length;
    if (moving) lines.push(`- (${moving} pops while the camera moved; in stability.json)`);
    for (const h of r.hitches.slice(0, 12)) lines.push(`- ${h.t} ms [${h.phase}] **hitch** ${h.ms} ms — ${h.events.join("; ") || "no event"}`);
    if (r.summary.session === "foliage") {
      lines.push("", "| phase | flicker (mean /255) | cells > 3/255 | frames | still |", "| --- | --- | --- | --- | --- |");
      for (const [p, v] of Object.entries(r.flicker)) lines.push(`| ${p} | ${v.mean} | ${(v.share * 100).toFixed(2)}% | ${v.frames} | ${v.still} |`);
      lines.push("");
    }
    for (const l of r.lighting) lines.push(`- time → ${l.minutes}: settles in ${l.settleMs} ms, ${l.stepsAfterFirst} visible steps after the first frame, shadows swap ${l.shadowLagFrames} frames after the sun moves`);
    lines.push("");
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------- compare
// node scripts/stability.mjs compare <before dir> <after dir> [out.md]:
// one table, before → after per session and column.
if (process.argv[2] === "compare") {
  const [a, b, out] = process.argv.slice(3);
  const load = async (d) => JSON.parse(await readFile(join(d, "stability.json"), "utf8"));
  const A = await load(a), B = await load(b);
  const cols = ["blank", "lum", "sharp", "popStill", "popMoving", "flashStill", "flashMoving", "vanishStill", "vanishMoving", "flicker", "leafLight", "leafSteps", "hitches", "worstHitchMs", "resizes", "unsynced", "quality", "reveal", "shadowSwaps"];
  const lines = [`| session | ${cols.join(" | ")} |`, `| --- | ${cols.map(() => "---").join(" | ")} |`];
  for (const r of B) {
    const before = A.find((x) => x.summary.session === r.summary.session)?.summary ?? {};
    lines.push(`| ${r.summary.session} | ${cols.map((c) => `${before[c] ?? "–"} → ${r.summary[c] ?? "–"}`).join(" | ")} |`);
  }
  const text = lines.join("\n") + "\n";
  if (out) await writeFile(out, text);
  console.log(text);
  process.exit(0);
}

// ---------------------------------------------------------------- main
await mkdir(OUT, { recursive: true });
const browser = await launchChrome();
const results = [];
try {
  for (const name of SESSIONS) {
    const started = Date.now();
    console.log(`session ${name}…`);
    const run = await runSession(browser, name);
    const result = analyse(run);
    await writeEvidence(run, result, OUT);
    results.push(result);
    console.log(`  ${JSON.stringify(result.summary)} (${Math.round((Date.now() - started) / 1000)} s)`);
    if (run.errors.length) console.log("  page errors:", run.errors.slice(0, 3));
    await writeFile(join(OUT, "stability.json"), JSON.stringify(results, null, 1));
    await writeFile(join(OUT, "stability.md"), markdown(results));
  }
} finally {
  browser.close();
}
console.log(`wrote ${join(OUT, "stability.md")}`);
