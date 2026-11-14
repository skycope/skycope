// Pare-back captures: the same views before and after.
//   node pare.mjs <outDir> <suffix> [only=name,name]  (env FLARE = call flare used for the lens pass)
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { ISLAND, islandPoint } from "../../../../src/terrain.js";

const out = process.argv[2];
const suffix = process.argv[3] ?? "before";
const only = process.argv[4]?.split(",");
const PORT = 5340, CDP = 9410, W = 1440, H = 900;
const FLARE = Number(process.env.FLARE ?? 0.9);
await mkdir(out, { recursive: true });
const HOME = Math.atan2(0 - ISLAND.z, 6 - ISLAND.x);
const seaward = (t) => Math.atan2(Math.cos(t), Math.sin(t));
const landward = (t) => seaward(t) + Math.PI;
const along = (t) => seaward(t) + Math.PI / 2;
const NOON = 750, DUSK = 1180, NIGHT = 1320, MEADOW_DUSK = 1230;

const V = [];
const view = (name, o) => V.push({ name, magic: "", t: NOON, ...o });
// The wisp waiting 4 m ahead of the cat.
for (const [n, t] of [["noon", NOON], ["dusk", DUSK], ["night", NIGHT]]) {
  view(`wisp-${n}`, { t, at: [HOME, 2.5], yaw: along(HOME), el: 0.22, dist: 3.4, wisp: "wait" });
  view(`wisp-lens-${n}`, { t, at: [HOME, 2.5], yaw: along(HOME), el: 0.22, dist: 3.4, wisp: "lens" });
}
view("notes", { magic: "fireflies,tideglow", at: [HOME, 2.5], yaw: along(HOME), el: 0.22, dist: 3.4, notes: true });
view("sky-stars", { magic: "stars", t: NIGHT, at: [HOME, 2.5], yaw: seaward(HOME) - 0.5, el: 0.06, dist: 2.2, wait: 17000 });
view("sky-finale", { magic: "all", t: NIGHT, at: [HOME, 2.5], yaw: seaward(HOME) - 0.5, el: 0.06, dist: 2.2, wait: 17000 });
view("meadow-dusk", { t: MEADOW_DUSK, at: [HOME - 0.04, 7], yaw: landward(HOME - 0.04) + 0.3, el: 0.3, dist: 4.5 });
view("meadow-night-gift", { magic: "fireflies", t: NIGHT, at: [HOME - 0.04, 7], yaw: landward(HOME - 0.04) + 0.3, el: 0.3, dist: 4.5, wait: 7000 });

const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", [
  "--headless=new", "--enable-unsafe-webgpu", `--remote-debugging-port=${CDP}`, "--no-first-run",
  `--user-data-dir=${out}/.chrome-${suffix}`, `--window-size=${W},${H}`, "--hide-scrollbars", "--mute-audio",
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
  if (m.method === "Runtime.exceptionThrown") console.log("  exception:", m.params.exceptionDetails.exception?.description?.slice(0, 300));
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) console.log("  eval error", r.result.exceptionDetails.exception?.description?.slice(0, 400)); return r.result?.result?.value; };
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false, screenWidth: W, screenHeight: H });

const counts = {};
for (const v of V) {
  if (only && !only.some((o) => v.name === o)) continue;
  // A fresh load per view: no state carried between them.
  await send("Page.navigate", { url: `http://127.0.0.1:${PORT}/?perf&seed=1847&weather=clear${v.magic ? `&magic=${v.magic}` : ""}` });
  for (let i = 0; i < 150; i++) { if (await evaluate("!!(window.skycope && skycope.walker && skycope.landscape && skycope.thread?.journey?.mind)")) break; await sleep(200); }
  await evaluate("try { localStorage.clear() } catch {}");
  await sleep(2500);
  const meadow = v.meadow ? await evaluate(`(() => { const f = skycope.landscape.obstacles.flowers; const all = Array.isArray(f) ? f : Object.values(f).flat(); const h = ${JSON.stringify(islandPoint(HOME, 14))}; let best = null, bd = Infinity; for (const p of all) { const d = Math.hypot(p.x - h.x, p.z - h.z); if (d < bd) { bd = d; best = p; } } return best && [best.x, best.z]; })()`) : null;
  const at = v.at ? islandPoint(v.at[0], v.at[1]) : meadow ? { x: meadow[0] - 2.5, z: meadow[1] - 2.5 } : null;
  await evaluate(`(() => {
    const s = skycope, w = s.walker, c = w.cat, cam = w.camera;
    s.keys.clear();
    const sl = document.querySelector('#time'); sl.value = ${v.t}; sl.dispatchEvent(new Event('input'));
    const pos = ${JSON.stringify(at)};
    if (pos) {
      c.x = pos.x; c.z = pos.z; c.y = w.surface(pos.x, pos.z); c.speed = 0; c.vy = 0; c.air = 0; c.sit = 0; c.idle = 0;
      c.heading = ${v.yaw ?? "null"} ?? c.heading;
    }
    ${v.yaw !== undefined ? `cam.yaw = ${v.yaw};` : v.meadow ? `cam.yaw = Math.atan2(${meadow?.[0] ?? 0} - pos.x, ${meadow?.[1] ?? 0} - pos.z);` : ""}
    cam.elevation = ${v.el}; cam.distance = ${v.dist}; cam.targetY = c.y;
  })()`);
  if (v.wisp) {
    // Take the wisp's record over: a fixed pose (wait) or a pass by the lens
    // just after a meow (lens), with the glow its mind would give.
    await evaluate(`(() => {
      const s = skycope, j = s.thread.journey, rec = s.magic.wisp, cam = s.landscape.camera, c = s.walker.cat;
      const start = performance.now();
      const mode = ${JSON.stringify(v.wisp)};
      j.update = function () {
        const night = Math.min(1, Math.max(0, (s.celestial.scene ?? 0) - 1));
        const rest = 0.6 + 0.4 * night;
        rec.visible = true;
        if (mode === "wait") {
          const a = c.heading;
          const x = c.x + Math.sin(a) * 4, z = c.z + Math.cos(a) * 4;
          rec.position[0] = x; rec.position[1] = s.walker.surface(x, z) + 1.25; rec.position[2] = z;
          rec.glow = rest;
          return;
        }
        const e = cam.matrixWorld.elements;
        const P = [e[12], e[13], e[14]], F = [-e[8], -e[9], -e[10]], R = [e[0], e[1], e[2]], U = [e[4], e[5], e[6]];
        const k = Math.min(1, (performance.now() - start) / 1600);
        const ease = 1 - (1 - k) ** 2;
        const d = 7 + (0.5 - 7) * ease, r = 2.5 + (0.08 - 2.5) * ease, u = 0.6 + (0.02 - 0.6) * ease;
        const wx = P[0] + F[0] * d + R[0] * r + U[0] * u, wy = P[1] + F[1] * d + R[1] * r + U[1] * u, wz = P[2] + F[2] * d + R[2] * r + U[2] * u;
        rec.position[0] = wx; rec.position[1] = wy; rec.position[2] = -wz;
        rec.glow = rest + ${FLARE} * Math.exp(-((performance.now() - start) / 1000) * 1.6);
      };
    })()`);
    if (v.wisp === "lens") await sleep(1500);
    else await sleep(2500);
  } else if (v.notes) {
    await evaluate(`(() => { const d = skycope.thread.discoveries; for (const id of ["hilltop", "sunset", "tortoise", "penguins"]) d.find(id); document.querySelector('#notes-toggle').click(); })()`);
    await sleep(1500);
  } else {
    await sleep(v.wait ?? 3000);
  }
  await snap(`${v.name}-${suffix}`, v.name);
}
await writeFile(`${out}/counts-${suffix}.json`, JSON.stringify(counts, null, 2));
async function snap(file, name) {
  const ds = await evaluate("({ ...document.querySelector('#landscape').dataset })");
  counts[name] = { drawCalls: Number(ds.drawCalls), triangles: Number(ds.triangles) };
  const r = await send("Page.captureScreenshot", { format: "jpeg", quality: 85 });
  await writeFile(`${out}/${file}.jpg`, Buffer.from(r.result.data, "base64"));
  console.log(file, counts[name]);
}
ws.close();
chrome.kill();
process.exit(0);
