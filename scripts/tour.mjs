// QA tour: drives headless Chrome over CDP through a set of views (place,
// camera, time, weather, motion) and saves a screenshot of each.
//   node scripts/tour.mjs <outDir> [port=5311] [only=name,name]
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";

const out = process.argv[2] ?? "/tmp/skycope-tour";
const port = process.argv[3] ?? "5311";
const only = process.argv[4]?.split(",");
const W = Number(process.env.W ?? 1440), H = Number(process.env.H ?? 900);
await mkdir(out, { recursive: true });

const ISLAND = { x: 58, z: 70 };
const shoreRadius = (t) => 62 + 14 * Math.sin(2 * t + 0.8) + 7 * Math.sin(3 * t + 2.1) + 3.5 * Math.sin(7 * t + 4.5);
const islandPoint = (t, inland) => {
  const r = Math.max(0, shoreRadius(t) - inland);
  return { x: ISLAND.x + Math.cos(t) * r, z: ISLAND.z + Math.sin(t) * r };
};
const HOME = Math.atan2(0 - ISLAND.z, 6 - ISLAND.x);
// yaw that looks out to sea / inland at shore angle t
const seaward = (t) => Math.atan2(Math.cos(t), Math.sin(t));
const landward = (t) => seaward(t) + Math.PI;
const along = (t) => seaward(t) + Math.PI / 2;

const NOON = 750, GOLD = 1090, DUSK = 1125, NIGHT = 1320, DAWN = 400, MORNING = 540;

// Each view: place [theta, inland], heading, cam {yaw, elevation, distance}, minutes, weather, keys/hold
const V = [];
const view = (name, o) => V.push({ name, weather: "clear", t: NOON, ...o });
view("01-home-noon", { home: true });
view("02-home-gold", { home: true, t: GOLD });
view("03-home-night", { home: true, t: NIGHT });
view("04-home-dawn", { home: true, t: DAWN });
view("05-beach-seaward-noon", { at: [HOME, 2], yaw: seaward(HOME), el: 0.25, dist: 3.4 });
view("06-beach-seaward-gold", { at: [HOME, 2], yaw: seaward(HOME), el: 0.2, dist: 3.4, t: GOLD });
view("07-beach-landward-noon", { at: [HOME, 1], yaw: landward(HOME), el: 0.18, dist: 4 });
view("08-beach-landward-morning", { at: [HOME, 1], yaw: landward(HOME), el: 0.18, dist: 4, t: MORNING });
view("09-along-beach-low", { at: [HOME, 1.5], yaw: along(HOME), el: 0.1, dist: 2.2 });
view("10-along-beach-high", { at: [HOME, 1.5], yaw: along(HOME), el: 0.7, dist: 8 });
view("11-forest-noon", { at: [HOME, 22], yaw: landward(HOME), el: 0.25, dist: 3.4 });
view("12-forest-gold", { at: [HOME, 22], yaw: landward(HOME) + 1, el: 0.25, dist: 3.4, t: GOLD });
view("13-forest-looking-out", { at: [HOME, 30], yaw: seaward(HOME), el: 0.35, dist: 6 });
view("14-hill-overview", { at: [HOME + 0.8, 45], yaw: seaward(HOME + 0.8), el: 0.9, dist: 8 });
view("15-hill-overview-gold", { at: [HOME + 0.8, 45], yaw: seaward(HOME + 0.8), el: 0.6, dist: 8, t: GOLD });
view("16-inland-grass", { at: [HOME - 0.6, 12], yaw: along(HOME - 0.6), el: 0.15, dist: 3 });
view("17-rocks-noon", { rock: 0, el: 0.3, dist: 6 });
view("18-rocks-gold", { rock: 1, el: 0.25, dist: 6, t: GOLD });
view("19-rocks-low", { rock: 2, el: 0.12, dist: 4 });
view("20-cat-closeup-side", { at: [HOME, 3], yaw: along(HOME) + 1.2, el: 0.12, dist: 1.2, heading: along(HOME) });
view("21-cat-closeup-front", { at: [HOME, 3], yaw: seaward(HOME), el: 0.15, dist: 1.2, heading: landward(HOME) });
view("22-cat-closeup-gold", { at: [HOME, 3], yaw: along(HOME) + 1.2, el: 0.12, dist: 1.3, heading: along(HOME), t: GOLD });
view("23-cat-wading", { at: [HOME, -1.5], yaw: along(HOME) + 0.5, el: 0.2, dist: 2.2, heading: along(HOME) });
view("24-cat-swimming", { at: [HOME, -6], yaw: landward(HOME), el: 0.2, dist: 2.5, heading: seaward(HOME) });
view("25-run-beach-1", { at: [HOME, 2.5], yaw: along(HOME), el: 0.3, dist: 3.4, heading: along(HOME), hold: ["w", "shift"], holdMs: 1200 });
view("26-run-into-sea", { at: [HOME, 3], yaw: seaward(HOME), el: 0.3, dist: 3.4, heading: seaward(HOME), hold: ["w", "shift"], holdMs: 1700 });
view("27-splash-sea", { at: [HOME, 0.5], yaw: seaward(HOME), el: 0.3, dist: 3.4, heading: seaward(HOME), hold: ["w", "shift"], holdMs: 900 });
view("28-walk-forest", { at: [HOME, 18], yaw: landward(HOME), el: 0.3, dist: 3.4, heading: landward(HOME), hold: ["w"], holdMs: 1500 });
view("29-overcast-beach", { at: [HOME, 2], yaw: seaward(HOME) + 0.6, el: 0.25, dist: 4, weather: "overcast" });
view("30-storm-beach", { at: [HOME, 2], yaw: seaward(HOME) + 0.6, el: 0.25, dist: 4, weather: "storm" });
view("31-rain-forest", { at: [HOME, 22], yaw: landward(HOME), el: 0.25, dist: 3.4, weather: "rain" });
view("32-cloudy-overview", { at: [HOME + 0.8, 45], yaw: seaward(HOME + 0.8), el: 0.6, dist: 8, weather: "cloudy" });
view("33-night-forest", { at: [HOME, 22], yaw: landward(HOME), el: 0.25, dist: 3.4, t: NIGHT });
view("34-night-seaward", { at: [HOME, 2], yaw: seaward(HOME), el: 0.25, dist: 3.4, t: NIGHT });
view("35-dusk-seaward", { at: [HOME, 2], yaw: seaward(HOME) - 0.8, el: 0.2, dist: 3.4, t: DUSK });
view("36-far-side-beach", { at: [HOME + Math.PI, 2], yaw: along(HOME + Math.PI), el: 0.25, dist: 4 });
view("37-far-side-landward", { at: [HOME + Math.PI * 0.6, 2], yaw: landward(HOME + Math.PI * 0.6), el: 0.3, dist: 5 });
view("38-sun-facing-noon", { at: [HOME, 5], yaw: Math.PI, el: 0.1, dist: 3.4 });

const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", [
  "--headless=new", "--enable-unsafe-webgpu", `--remote-debugging-port=${process.env.CDP ?? 9377}`, "--no-first-run",
  `--user-data-dir=${out}/.chrome`, `--window-size=${W},${H}`, "--hide-scrollbars", "--mute-audio",
], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let targets;
for (let i = 0; i < 50; i++) {
  try { targets = await (await fetch(`http://127.0.0.1:${process.env.CDP ?? 9377}/json`)).json(); if (targets.some((t) => t.type === "page")) break; } catch {}
  await sleep(200);
}
const page = targets.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const pending = new Map();
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") console.log("  console.error:", m.params.args.map((a) => a.value ?? a.description).join(" ").slice(0, 300));
  if (m.method === "Runtime.exceptionThrown") console.log("  exception:", m.params.exceptionDetails.exception?.description?.slice(0, 300));
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) console.log("  eval error", r.result.exceptionDetails.exception?.description); return r.result?.result?.value; };
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false, screenWidth: W, screenHeight: H });

let loadedWeather = null;
for (const v of V) {
  if (only && !only.some((o) => v.name.includes(o))) continue;
  if (loadedWeather !== v.weather) {
    await send("Page.navigate", { url: `http://127.0.0.1:${port}/?perf&seed=1847&weather=${v.weather}` });
    for (let i = 0; i < 100; i++) { if (await evaluate("!!(window.skycope && skycope.walker && skycope.landscape)")) break; await sleep(200); }
    await sleep(2500);
    loadedWeather = v.weather;
  }
  const rockPos = v.rock !== undefined ? await evaluate(`(() => { const s = skycope.landscape.surf?.sections; if (!s || !s.length) return null; const r = s[${v.rock} % s.length]; const p = r.position ?? r.center ?? r; return [p.x, p.z]; })()`) : null;
  await evaluate(`(() => {
    const s = skycope, w = s.walker, c = w.cat, cam = w.camera;
    s.keys.clear();
    const sl = document.querySelector('#time'); sl.value = ${v.t}; sl.dispatchEvent(new Event('input'));
    ${v.home ? "w.home();" : ""}
    const pos = ${JSON.stringify(v.at ? islandPoint(v.at[0], v.at[1]) : null)} ?? (${JSON.stringify(rockPos)} ? {x: ${rockPos?.[0] ?? 0}, z: ${rockPos?.[1] ?? 0}} : null);
    if (pos) {
      let x = pos.x, z = pos.z;
      ${v.rock !== undefined ? "const dx = x - 58, dz = z - 70, L = Math.hypot(dx, dz); x -= dx / L * 5; z -= dz / L * 5;" : ""}
      c.x = x; c.z = z; c.y = w.surface(x, z); c.speed = 0; c.vy = 0; c.air = 0; c.sit = 0; c.idle = 0;
      c.heading = ${v.heading ?? "null"} ?? ${v.yaw ?? "null"} ?? c.heading;
      ${v.rock !== undefined ? "cam.yaw = Math.atan2(dx, dz);" : ""}
    }
    ${v.yaw !== undefined ? `cam.yaw = ${v.yaw};` : ""}
    ${v.el !== undefined ? `cam.elevation = ${v.el};` : ""}
    ${v.dist !== undefined ? `cam.distance = ${v.dist};` : ""}
    cam.targetY = c.y;
  })()`);
  if (v.hold) {
    await sleep(1200);
    for (const k of v.hold) await evaluate(`skycope.keys.add(${JSON.stringify(k)}); skycope.lastInput = performance.now();`);
    await sleep(v.holdMs);
    await snap(v.name + "-a");
    await sleep(350);
    await snap(v.name + "-b");
    await evaluate("skycope.keys.clear()");
  } else {
    await sleep(2200);
    await snap(v.name);
  }
}
async function snap(name) {
  const fps = await evaluate("document.querySelector('canvas')?.dataset?.meshMs ?? ''");
  const r = await send("Page.captureScreenshot", { format: "jpeg", quality: 88 });
  await writeFile(`${out}/${name}.jpg`, Buffer.from(r.result.data, "base64"));
  console.log(name, fps);
}
ws.close();
chrome.kill();
process.exit(0);
