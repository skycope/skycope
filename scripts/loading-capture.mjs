// Loading-screen evidence over CDP (docs/review/loading/). Spawns its own
// headless Chrome on `--cdp` (kill it by PID; this script does on exit).
//
//   node scripts/loading-capture.mjs strip  <out> --port 5358 [--scenes noon-clear,dusk-clear] [--viewports desktop,phone]
//   node scripts/loading-capture.mjs agree  <out> --port 5358 [--scenes …]
//   node scripts/loading-capture.mjs timing <out> --port 5358 [--runs 3] [--label dev]
//
// strip: the whole load (Fast 3G, CPU 4×) as frames at 100 ms steps from
//   navigation through the hand-over to the sharp world, composed into one
//   sheet per scene and viewport, plus full-resolution frames at the
//   hand-over (last veil frame, first frames of the world).
// agree: the veil's sky against the real sky and sea canvases' pixels, for
//   the same camera, at the horizon, 30° and the zenith (and the sea below).
// timing: first paint, the veil's first sky, main.js fetched, the first
//   real frame (performance marks `loading:*`).
//
// Scenes are Cape Town minutes on 15 Nov 2026 plus a weather preset; the
// page's clock is shifted before any script runs, so the veil and the world
// both see that hour, as a visitor then would.
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { PNG } from "pngjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const [mode, out = "docs/review/loading", ...rest] = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : fallback;
};
const PORT = Number(opt("port", 5358));
const CDP = Number(opt("cdp", 9428));
const HOST = opt("host", `http://127.0.0.1:${PORT}`);
const SEED = opt("seed", "1847");

// Minutes in Cape Town (UTC+2) on 15 Nov 2026: sunrise ~05:32, sunset ~19:35.
export const SCENES = {
  "dawn-clear": { minutes: 350, weather: "clear" },
  "noon-clear": { minutes: 750, weather: "clear" },
  "golden-clear": { minutes: 1145, weather: "clear" },
  "dusk-clear": { minutes: 1188, weather: "clear" },
  "night-clear": { minutes: 1320, weather: "clear" },
  "dawn-overcast": { minutes: 350, weather: "overcast" },
  "noon-overcast": { minutes: 750, weather: "overcast" },
  "golden-overcast": { minutes: 1145, weather: "overcast" },
  "dusk-overcast": { minutes: 1188, weather: "overcast" },
  "night-overcast": { minutes: 1320, weather: "overcast" },
};
const VIEWPORTS = {
  desktop: { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false, screenWidth: 1440, screenHeight: 900 },
  phone: { width: 375, height: 812, deviceScaleFactor: 3, mobile: true, screenWidth: 375, screenHeight: 812 },
  // The agreement check reads pixels: one device pixel per CSS pixel.
  flat: { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false, screenWidth: 1440, screenHeight: 900 },
};

const clockShift = (minutes) => `(() => {
  const target = Date.UTC(2026, 10, 15, 0, ${minutes}) - 2 * 3600000;
  const Real = Date;
  const shift = target - Real.now();
  class Shifted extends Real {
    constructor(...a) { if (a.length === 0) super(Real.now() + shift); else super(...a); }
    static now() { return Real.now() + shift; }
  }
  globalThis.Date = Shifted;
  // When the veil changes state (the first real frame is "leaving").
  window.__veilStates = {};
  addEventListener("DOMContentLoaded", () => {
    const veil = document.querySelector("#loading-screen");
    if (veil) new MutationObserver(() => {
      const s = veil.dataset.state;
      if (s && !(s in window.__veilStates)) window.__veilStates[s] = Math.round(performance.now());
    }).observe(veil, { attributes: true });
  });
})();`;

async function launch() {
  const profile = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "skycope-loading-"));
  const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", [
    "--headless=new", "--enable-unsafe-webgpu", `--remote-debugging-port=${CDP}`, "--no-first-run",
    `--user-data-dir=${profile}`, "--window-size=1440,900", "--hide-scrollbars", "--mute-audio",
    "--disable-background-timer-throttling", "--disable-renderer-backgrounding",
  ], { stdio: "ignore" });
  console.log(`chrome pid ${chrome.pid} on cdp ${CDP}`);
  let version = null;
  for (let i = 0; i < 80 && !version; i++) {
    try {
      version = await (await fetch(`http://127.0.0.1:${CDP}/json/version`)).json();
    } catch {
      await sleep(200);
    }
  }
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  let id = 0;
  const pending = new Map();
  const listeners = new Set();
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    } else if (m.method) for (const l of listeners) l(m);
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const i = ++id;
    pending.set(i, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)));
    ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  // A fresh context per page: no cache, no storage carried between loads.
  async function page(viewport) {
    const { browserContextId } = await send("Target.createBrowserContext");
    const { targetId } = await send("Target.createTarget", { url: "about:blank", browserContextId });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    const s = (method, params) => send(method, params, sessionId);
    const on = (method, fn) => {
      const l = (m) => m.sessionId === sessionId && m.method === method && fn(m.params);
      listeners.add(l);
      return () => listeners.delete(l);
    };
    await s("Page.enable");
    await s("Runtime.enable");
    await s("Network.enable");
    await s("Emulation.setDeviceMetricsOverride", viewport);
    if (viewport.mobile) await s("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await s("Target.activateTarget", { targetId });
    const evaluate = async (expression) => {
      const r = await s("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
      return r.result.value;
    };
    return {
      s, on, evaluate,
      async close() {
        await send("Target.closeTarget", { targetId }).catch(() => {});
        await send("Target.disposeBrowserContext", { browserContextId }).catch(() => {});
      },
    };
  }
  return {
    page,
    async close() {
      try { ws.close(); } catch {}
      chrome.kill();
      await sleep(300);
    },
  };
}

const FAST_3G = { offline: false, latency: 562.5, downloadThroughput: (1.6 * 1024 * 1024 * 0.9) / 8, uploadThroughput: (750 * 1024 * 0.9) / 8 };

// The load's timeline, from the page's own clock (ms from navigation).
const TIMELINE = `(() => {
  const marks = Object.fromEntries(performance.getEntriesByType("mark").filter((m) => m.name.startsWith("loading:")).map((m) => [m.name.slice(8), Math.round(m.startTime)]));
  const paint = Object.fromEntries(performance.getEntriesByType("paint").map((p) => [p.name, Math.round(p.startTime)]));
  const main = performance.getEntriesByType("resource").find((r) => /\\/main(-[\\w-]+)?\\.js/.test(r.name));
  return {
    firstPaint: paint["first-paint"] ?? null,
    firstContentfulPaint: paint["first-contentful-paint"] ?? null,
    mainRequested: main ? Math.round(main.startTime) : null,
    mainFetched: main ? Math.round(main.responseEnd) : null,
    marks,
    states: window.__veilStates ?? {},
    ready: marks.ready ?? window.__veilStates?.leaving ?? null,
    timeOrigin: performance.timeOrigin,
  };
})()`;

async function strip(browser, sceneName, viewportName) {
  const scene = SCENES[sceneName];
  const viewport = VIEWPORTS[viewportName];
  const page = await browser.page(viewport);
  await page.s("Network.setCacheDisabled", { cacheDisabled: true });
  await page.s("Network.emulateNetworkConditions", FAST_3G);
  await page.s("Emulation.setCPUThrottlingRate", { rate: 4 });
  await page.s("Page.addScriptToEvaluateOnNewDocument", { source: clockShift(scene.minutes) });
  // Frames go straight to disk (memory stays flat on long loads).
  const dir = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "skycope-frames-"));
  const frames = [];
  page.on("Page.screencastFrame", (p) => {
    const file = join(dir, `${frames.length}.jpg`);
    writeFileSync(file, Buffer.from(p.data, "base64"));
    frames.push({ t: p.metadata.timestamp * 1000, file });
    page.s("Page.screencastFrameAck", { sessionId: p.sessionId }).catch(() => {});
  });
  await page.s("Page.startScreencast", { format: "jpeg", quality: 78, everyNthFrame: 1 });
  const started = Date.now();
  await page.s("Page.navigate", { url: `${HOST}/?seed=${SEED}&weather=${scene.weather}` });
  // Until the veil is gone and the world has had a moment to sharpen.
  let gone = 0;
  while (Date.now() - started < 120000) {
    await sleep(400);
    const state = await page.evaluate(`(() => { const v = document.querySelector("#loading-screen"); return !v ? "missing" : v.hidden ? "gone" : (v.dataset.state ?? "loading"); })()`).catch(() => "");
    if (state === "gone" || state === "failed" || state === "missing") gone ||= Date.now();
    if (gone && Date.now() - gone > 2500) break;
  }
  await page.s("Page.stopScreencast");
  await page.s("Emulation.setCPUThrottlingRate", { rate: 1 });
  const timeline = await page.evaluate(TIMELINE);
  await page.close();
  // Frame times relative to navigation, ms.
  for (const f of frames) f.at = f.t - timeline.timeOrigin;
  frames.sort((a, b) => a.at - b.at);
  return { scene: sceneName, viewport: viewportName, timeline, frames, dir };
}

// The frame on screen at time t (the last one delivered before it).
const frameAt = (frames, t) => {
  let best = null;
  for (const f of frames) if (f.at <= t) best = f;
  return best;
};

async function composeSheet(browser, run, file) {
  const { frames, timeline } = run;
  const ready = timeline.ready ?? frames.at(-1).at;
  const painted = timeline.marks.painted ?? timeline.firstContentfulPaint ?? 0;
  const first = frames[0]?.at ?? 0;
  // Navigation to the veil's first sky (+0.5 s) at 100 ms; the wait at
  // 1 s; the hand-over from 0.5 s before the first real frame to 3.5 s
  // after it at 100 ms.
  const times = [];
  for (let t = Math.max(0, Math.floor(first / 100) * 100); t <= painted + 500; t += 100) times.push(t);
  for (let t = Math.ceil((painted + 600) / 1000) * 1000; t < ready - 600; t += 1000) times.push(t);
  for (let t = Math.round((ready - 500) / 100) * 100; t <= ready + 3500; t += 100) times.push(t);
  const cells = times.map((t) => ({ t, frame: frameAt(frames, t) })).filter((c) => c.frame);
  const phone = run.viewport === "phone";
  const thumb = phone ? 150 : 288;
  const columns = phone ? 12 : 6;
  // Composed in a page opened from the frames' own folder (file URLs, no
  // frames held in memory here).
  const page = join(run.dir, "sheet.html");
  await writeFile(page, "<!doctype html><body></body>");
  const sheet = await browser.page(VIEWPORTS.flat);
  await sheet.s("Page.navigate", { url: pathToFileURL(page).href });
  await sleep(500);
  const png = await sheet.evaluate(`(async () => {
    const cells = ${JSON.stringify(cells.map((c) => ({ t: c.t, data: pathToFileURL(c.frame.file).href })))};
    const ready = ${ready}, painted = ${painted};
    const images = await Promise.all(cells.map((c) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = c.data; })));
    const w = ${thumb}, h = Math.round(w * images[0].height / images[0].width), cols = ${columns}, label = 16;
    const canvas = document.createElement("canvas");
    canvas.width = cols * (w + 4) + 4;
    canvas.height = Math.ceil(cells.length / cols) * (h + label + 4) + 4 + 22;
    const g = canvas.getContext("2d");
    g.fillStyle = "#111"; g.fillRect(0, 0, canvas.width, canvas.height);
    g.font = "12px monospace"; g.fillStyle = "#ddd";
    g.fillText(${JSON.stringify(`${run.scene} · ${run.viewport} · Fast 3G, CPU 4× · ms from navigation; first real frame at `)} + ready + " ms", 6, 15);
    cells.forEach((c, k) => {
      const x = 4 + (k % cols) * (w + 4), y = 26 + Math.floor(k / cols) * (h + label + 4);
      g.drawImage(images[k], x, y + label, w, h);
      g.fillStyle = c.t >= ready ? "#9fd" : c.t >= painted ? "#fd9" : "#aaa";
      g.fillText(c.t + (c.t >= ready ? " world" : c.t >= painted ? " veil" : ""), x + 2, y + 12);
    });
    return canvas.toDataURL("image/jpeg", 0.85).split(",")[1];
  })()`);
  await sheet.close();
  await writeFile(file, Buffer.from(png, "base64"));
}

async function runStrips() {
  const scenes = opt("scenes", "noon-clear,dusk-clear,night-clear,noon-overcast,dusk-overcast,night-overcast").split(",");
  const viewports = opt("viewports", "desktop,phone").split(",");
  const prefix = opt("label", "after");
  await mkdir(out, { recursive: true });
  const browser = await launch();
  const timelines = [];
  try {
    for (const viewport of viewports)
      for (const scene of scenes) {
        const run = await strip(browser, scene, viewport);
        const name = `${prefix}-${scene}-${viewport}`;
        await composeSheet(browser, run, join(out, `${name}.jpg`));
        // Full resolution at the hand-over: the last veil frame and the
        // world 0, 0.5, 1 and 2 s after its first frame.
        const ready = run.timeline.ready;
        if (ready) {
          await mkdir(join(out, "frames"), { recursive: true });
          for (const [tag, t] of [["veil", ready - 20], ["world0", ready + 80], ["world500", ready + 500], ["world1000", ready + 1000], ["world2000", ready + 2000]]) {
            const f = frameAt(run.frames, t);
            if (f) await writeFile(join(out, "frames", `${name}-${tag}.jpg`), await readFile(f.file));
          }
        }
        timelines.push({ name, ...run.timeline, frames: run.frames.length });
        console.log(name, JSON.stringify(run.timeline.marks), `${run.frames.length} frames`);
        await rm(run.dir, { recursive: true, force: true });
      }
  } finally {
    await browser.close();
  }
  await writeFile(join(out, `${prefix}-strips.json`), JSON.stringify(timelines, null, 2));
}

// ---- Colour agreement -------------------------------------------------------

function decodePng(base64) {
  return PNG.sync.read(Buffer.from(base64, "base64"));
}

// Mean colour of a square patch (dither and grain average out).
function patch(png, u, v, r = 5) {
  const cx = Math.round(u * (png.width - 1));
  const cy = Math.round(v * (png.height - 1));
  const sum = [0, 0, 0];
  let n = 0;
  for (let y = Math.max(0, cy - r); y <= Math.min(png.height - 1, cy + r); y++)
    for (let x = Math.max(0, cx - r); x <= Math.min(png.width - 1, cx + r); x++) {
      const k = (y * png.width + x) * 4;
      for (let c = 0; c < 3; c++) sum[c] += png.data[k + c];
      n++;
    }
  return sum.map((s) => s / n);
}

// CIE76 ΔE between two sRGB colours (0…255).
function deltaE(a, b) {
  const lab = (rgb) => {
    const l = rgb.map((v) => {
      v /= 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    const x = (0.4124 * l[0] + 0.3576 * l[1] + 0.1805 * l[2]) / 0.95047;
    const y = 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2];
    const z = (0.0193 * l[0] + 0.1192 * l[1] + 0.9505 * l[2]) / 1.08883;
    const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
  };
  const p = lab(a);
  const q = lab(b);
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

// Screen position (u right, v down) of a direction (east, up, north) for a
// view: view.wgsl's view_uv with the pointer centred.
function viewUv(ray, aspect, azimuth, pitch) {
  const heading = [Math.sin(azimuth), 0, Math.cos(azimuth)];
  const right = [heading[2], 0, -heading[0]];
  const forward = [heading[0] * Math.cos(pitch), Math.sin(pitch), heading[2] * Math.cos(pitch)];
  const up = [forward[1] * right[2] - forward[2] * right[1], forward[2] * right[0] - forward[0] * right[2], forward[0] * right[1] - forward[1] * right[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const depth = dot(ray, forward);
  return [(dot(ray, right) * 0.9) / depth / aspect + 0.5, 0.5 - (dot(ray, up) * 0.9) / depth];
}

async function runAgree() {
  const scenes = opt("scenes", Object.keys(SCENES).join(",")).split(",");
  await mkdir(out, { recursive: true });
  const browser = await launch();
  const rows = [];
  try {
    for (const sceneName of scenes) {
      const scene = SCENES[sceneName];
      const page = await browser.page(VIEWPORTS.flat);
      await page.s("Page.addScriptToEvaluateOnNewDocument", { source: clockShift(scene.minutes) });
      await page.s("Page.navigate", { url: `${HOST}/?perf&seed=${SEED}&weather=${scene.weather}` });
      for (let i = 0; i < 200; i++) {
        await sleep(300);
        const ok = await page.evaluate(`!!(window.skycope?.walker && skycope.reveal >= 1 && document.querySelector("#loading-screen").hidden)`).catch(() => false);
        if (ok) break;
      }
      await sleep(1500);
      const home = await page.evaluate(`({ ...skycope.walker.camera })`);
      // Toward the sun's side and away from it, low and high.
      // Out to open sea: from the island's centre through the cat.
      const outward = await page.evaluate(`import("/src/terrain.js").then(({ ISLAND }) => {
        const cat = skycope.walker.cat;
        const dx = cat.x - ISLAND.x, dz = cat.z - ISLAND.z;
        return Math.atan2(dx - dz, dx + dz);
      })`);
      const views = [
        { name: "home", azimuth: home.azimuth, pitch: home.pitch },
        { name: "sea", azimuth: outward, pitch: -0.12 },
        { name: "up", azimuth: home.azimuth, pitch: 1.15 },
      ];
      console.log("home camera", JSON.stringify(home));
      await page.evaluate(`(() => {
        for (const s of ["#landscape", ".vignette", ".sky-meta", ".corner", "#hint", "#arrival", ".find-line", "#time-panel"]) document.querySelectorAll(s).forEach((e) => (e.style.visibility = "hidden"));
        // Neither picture's lens falloff: the model alone is compared.
        const style = document.createElement("style");
        style.textContent = ".loading-screen::after { display: none !important; }";
        document.head.append(style);
        return true;
      })()`);
      for (const view of views) {
        // The world: hold the camera on this view for a few frames.
        await page.evaluate(`(() => { skycope.flight = { ...skycope.walker.camera, azimuth: ${view.azimuth}, pitch: ${view.pitch} }; return true; })()`);
        await sleep(900);
        const world = decodePng((await page.s("Page.captureScreenshot", { format: "png" })).data);
        // The veil, painted for the same view and scene, over everything.
        await page.evaluate(`window.__veil.show({ azimuth: ${view.azimuth}, pitch: ${view.pitch} })`);
        await sleep(300);
        const veil = decodePng((await page.s("Page.captureScreenshot", { format: "png" })).data);
        await page.evaluate(`window.__veil.hide()`);
        await writeFile(join(out, "frames", `agree-${sceneName}-${view.name}-world.png`), PNG.sync.write(world)).catch(async () => {
          await mkdir(join(out, "frames"), { recursive: true });
          await writeFile(join(out, "frames", `agree-${sceneName}-${view.name}-world.png`), PNG.sync.write(world));
        });
        await writeFile(join(out, "frames", `agree-${sceneName}-${view.name}-veil.png`), PNG.sync.write(veil));
        const aspect = world.width / world.height;
        const sun = await page.evaluate(`skycope.celestial.sun`);
        const sunAz = Math.atan2(sun[0], sun[2]);
        // Sample directions: elevations at the centre column and toward
        // the sides of the frame.
        const samples = {
          home: [["horizon +1°", 1], ["5°", 5], ["15°", 15], ["sea −1°", -1]],
          sea: [["horizon +1°", 1], ["sea −1°", -1], ["sea −3°", -3], ["sea −8°", -8], ["sea −15°", -15]],
          up: [["30°", 30], ["45°", 45], ["60°", 60], ["zenith 88°", 88]],
        }[view.name];
        for (const [label, elevation] of samples)
          for (const across of [-0.3, 0, 0.3]) {
            const az = view.azimuth + across * (view.name === "up" ? 0.6 : 1);
            const el = (elevation * Math.PI) / 180;
            const ray = [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)];
            const [u, v] = viewUv(ray, aspect, view.azimuth, view.pitch);
            if (!(u > 0.03 && u < 0.97 && v > 0.03 && v < 0.97)) continue;
            const a = patch(world, u, v);
            const b = patch(veil, u, v);
            let rel = Math.abs(((az - sunAz + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
            rows.push({
              scene: sceneName, view: view.name, sample: label, fromSun: Math.round((rel * 180) / Math.PI),
              ray: ray.map((x) => Number(x.toFixed(5))),
              world: a.map(Math.round), veil: b.map(Math.round),
              maxChannel: Math.round(Math.max(...a.map((x, c) => Math.abs(x - b[c])))),
              deltaE: Number(deltaE(a, b).toFixed(1)),
            });
          }
      }
      console.log(sceneName, rows.filter((r) => r.scene === sceneName).map((r) => `${r.sample}@${r.fromSun}: ΔE ${r.deltaE}`).join(" | "));
      await page.close();
    }
  } finally {
    await browser.close();
  }
  const label = opt("label", "after");
  await writeFile(join(out, `${label}-colour-agreement.json`), JSON.stringify(rows, null, 2));
  const lines = [
    `| scene | view | sample | ° from sun | world sRGB | veil sRGB | max Δ channel | ΔE76 |`,
    `|---|---|---|---|---|---|---|---|`,
    ...rows.map((r) => `| ${r.scene} | ${r.view} | ${r.sample} | ${r.fromSun} | ${r.world.join(", ")} | ${r.veil.join(", ")} | ${r.maxChannel} | ${r.deltaE} |`),
  ];
  await writeFile(join(out, `${label}-colour-agreement.md`), lines.join("\n") + "\n");
}

// ---- Timing -----------------------------------------------------------------

async function runTiming() {
  const runs = Number(opt("runs", 3));
  const label = opt("label", "dev");
  const throttled = opt("throttle", "fast3g");
  await mkdir(out, { recursive: true });
  const browser = await launch();
  const results = [];
  try {
    for (let i = 0; i < runs; i++) {
      const page = await browser.page(VIEWPORTS.desktop);
      await page.s("Network.setCacheDisabled", { cacheDisabled: true });
      if (throttled === "fast3g") {
        await page.s("Network.emulateNetworkConditions", FAST_3G);
        await page.s("Emulation.setCPUThrottlingRate", { rate: 4 });
      }
      await page.s("Page.addScriptToEvaluateOnNewDocument", { source: clockShift(750) });
      const started = Date.now();
      await page.s("Page.navigate", { url: `${HOST}/?seed=${SEED}&weather=clear` });
      while (Date.now() - started < 180000) {
        await sleep(500);
        const ok = await page.evaluate(`performance.getEntriesByName("loading:ready").length > 0 || "leaving" in (window.__veilStates ?? {}) || "failed" in (window.__veilStates ?? {})`).catch(() => false);
        if (ok) break;
      }
      await page.s("Emulation.setCPUThrottlingRate", { rate: 1 });
      const t = await page.evaluate(TIMELINE);
      results.push(t);
      console.log(label, throttled, JSON.stringify(t));
      await page.close();
    }
  } finally {
    await browser.close();
  }
  await writeFile(join(out, `timing-${label}-${throttled}.json`), JSON.stringify(results, null, 2));
}

const modes = { strip: runStrips, agree: runAgree, timing: runTiming };
if (!modes[mode]) {
  console.error("mode: strip | agree | timing");
  process.exit(1);
}
await modes[mode]();
