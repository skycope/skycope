// Places QA capture: drives headless Chrome over CDP to a fixed camera at
// every landmark (wide and close, noon and night, lamp gift awake so the
// glow gating shows) and saves a JPEG of each, with the frame's triangle
// and draw-call counts in counts.json. Same cameras every run, so a
// before and an after line up.
//   CDP=9401 node scripts/places-capture.mjs <outDir> [port=5331] [only=a,b]
// Then: node scripts/places-sheet.mjs <beforeDir> <afterDir> <sheetDir>
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { placesLayout } from "../src/place-layout.js";
import { groundHeight } from "../src/terrain.js";

const out = process.argv[2] ?? "/tmp/places-capture";
const port = process.argv[3] ?? "5331";
const only = process.argv[4]?.split(",");
const W = Number(process.env.W ?? 1200), H = Number(process.env.H ?? 750);
const CDP = process.env.CDP ?? 9401;
const SEED = Number(process.env.SEED ?? 1847);
await mkdir(out, { recursive: true });

const P = Object.fromEntries(placesLayout(SEED).map((p) => [p.id, p]));
// A camera: the cat stands at (x, z) looking at (tx, tz); the follow camera
// sits `dist` behind it at `el`.
const V = [];
const look = (name, x, z, tx, tz, { el = 0.22, dist = 4.5 } = {}) => V.push({ name, x, z, yaw: Math.atan2(tx - x, tz - z), el, dist });
const from = (p, bearing, d) => [p.x + Math.sin(bearing) * d, p.z + Math.cos(bearing) * d];
{
  // Lighthouse: from inland, a little off the axis, and close at the door.
  const p = P.lighthouse, back = p.facing + Math.PI, φ = p.facing;
  look("lighthouse-wide", ...from(p, back + 1.2, 22), p.x, p.z, { el: 0.32, dist: 7 });
  // The cottage's side (p.side; the old layout had it on +v, behind).
  const side = p.side ?? 1;
  look("lighthouse-close", ...from(p, φ - side * (Math.PI / 2 + 0.3), 7.5), p.x, p.z, { el: 0.3, dist: 4.5 });
  const cu = p.side ? -1.4 : -6.5, cv = p.side ? 9.4 * side : 4.6;
  const c = { x: p.x + Math.sin(φ) * cu + Math.cos(φ) * cv, z: p.z + Math.cos(φ) * cu - Math.sin(φ) * cv };
  look("cottage-close", ...from(c, φ + side * 0.5, 8.5), c.x, c.z, { el: 0.25, dist: 5 });
}
{
  const p = P.wreck, inland = Math.atan2(58 - p.x, 70 - p.z);
  look("wreck-wide", ...from(p, inland + 0.4, 13), p.x, p.z, { el: 0.4, dist: 6 });
  look("wreck-close", ...from(p, inland - 0.2, 5), p.x, p.z, { el: 0.3, dist: 3.4 });
  // Where the cat was drawn twice (handover QA).
  look("wreck-cat", -6.4, 45.0, p.x, p.z, { el: 0.18, dist: 2.4 });
}
{
  const p = P.milkwood;
  look("milkwood-wide", ...from(p, 2.2, 19), p.x, p.z, { el: 0.35, dist: 8 });
  look("milkwood-close", ...from(p, 2.2, 6), p.x, p.z, { el: 0.15, dist: 3.5 });
}
{
  const p = P.beacon;
  look("beacon-wide", ...from(p, 2.5, 10), p.x, p.z, { el: 0.18, dist: 4.5 });
  look("beacon-close", ...from(p, 4.0, 3.6), p.x, p.z, { el: 0.25, dist: 3 });
}
{
  const p = P.boat, inland = Math.atan2(58 - p.x, 70 - p.z);
  look("boat-wide", ...from(p, inland + 1.4, 8), p.x, p.z, { el: 0.4, dist: 6 });
  look("boat-close", ...from(p, inland - 1.2, 3.5), p.x, p.z, { el: 0.3, dist: 3.5 });
}
{
  const p = P.pool, inland = Math.atan2(58 - p.x, 70 - p.z);
  look("pool-wide", ...from(p, inland + 1.3, 8), p.x, p.z, { el: 0.5, dist: 6 });
  look("pool-close", ...from(p, inland + 0.9, 3.8), p.x, p.z, { el: 0.6, dist: 3 });
}
// Boulders: the stacked stones the audit names, and seal rock.
look("boulders-stack", 47.5, 31.5, 51.3, 28.9, { el: 0.4, dist: 5 });
look("boulders-seal", 76.5, 28.5, 81, 24, { el: 0.25, dist: 4.5 });

const TIMES = (process.env.TIMES ?? "750,1320").split(",").map(Number);

const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", [
  "--headless=new", "--enable-unsafe-webgpu", `--remote-debugging-port=${CDP}`, "--no-first-run",
  `--user-data-dir=${out}/.chrome`, `--window-size=${W},${H}`, "--hide-scrollbars", "--mute-audio",
], { stdio: "ignore" });
console.log("chrome pid", chrome.pid);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let targets;
for (let i = 0; i < 50; i++) {
  try { targets = await (await fetch(`http://127.0.0.1:${CDP}/json`)).json(); if (targets.some((t) => t.type === "page")) break; } catch {}
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
await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false, screenWidth: 1440, screenHeight: 900 });
await send("Page.navigate", { url: `http://127.0.0.1:${port}/?perf&seed=${SEED}&weather=clear&magic=${process.env.MAGIC ?? "lamp"}` });
for (let i = 0; i < 150; i++) { if (await evaluate("!!(window.skycope && skycope.walker && skycope.landscape)")) break; await sleep(200); }
await sleep(6000);

const counts = {};
for (const t of TIMES)
  for (const v of V) {
    if (only && !only.some((o) => v.name.includes(o))) continue;
    await evaluate(`(() => {
      const s = skycope, w = s.walker, c = w.cat, cam = w.camera;
      s.keys.clear();
      const sl = document.querySelector('#time'); sl.value = ${t}; sl.dispatchEvent(new Event('input'));
      c.x = ${v.x}; c.z = ${v.z}; c.y = w.surface(${v.x}, ${v.z}); c.speed = 0; c.vy = 0; c.air = 0; c.sit = 0; c.idle = 0;
      c.heading = ${v.yaw};
      cam.yaw = ${v.yaw}; cam.elevation = ${v.el}; cam.distance = ${v.dist}; cam.targetY = c.y;
    })()`);
    await sleep(2600);
    const name = `${v.name}-${t}`;
    const d = await evaluate("({ ...document.querySelector('#landscape').dataset, cat: [skycope.walker.cat.x, skycope.walker.cat.z].map((v) => +v.toFixed(2)) })");
    counts[name] = { triangles: Number(d?.triangles), drawCalls: Number(d?.drawCalls), cat: d?.cat };
    const r = await send("Page.captureScreenshot", { format: "jpeg", quality: 80 });
    await writeFile(`${out}/${name}.jpg`, Buffer.from(r.result.data, "base64"));
    console.log(name, counts[name].triangles, counts[name].drawCalls, d?.cat?.join(","), `(ground ${groundHeight(v.x, v.z).toFixed(2)})`);
  }
await writeFile(`${out}/counts.json`, JSON.stringify(counts, null, 1));
ws.close();
chrome.kill();
process.exit(0);
