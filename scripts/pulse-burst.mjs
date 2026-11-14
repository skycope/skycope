// QA for "boulders turn see-through when the tideglow pulse passes": walk
// the cat into the wreck (its gift is tideglow) with the camera on the
// boulders by the water, and save a burst of frames while the waking's
// pulse runs out (look for a rock whose body shows the sea through it).
//   CDP=9401 node scripts/pulse-burst.mjs <outDir> [port=5331] [time=750]
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { placesLayout } from "../src/place-layout.js";

const out = process.argv[2] ?? "/tmp/pulse-burst";
const port = process.argv[3] ?? "5331";
const minutes = Number(process.argv[4] ?? 750);
const CDP = process.env.CDP ?? 9401;
await mkdir(out, { recursive: true });
const wreck = placesLayout(1847).find((p) => p.id === "wreck");
const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", [
  "--headless=new", "--enable-unsafe-webgpu", `--remote-debugging-port=${CDP}`, "--no-first-run",
  `--user-data-dir=${out}/.chrome`, "--window-size=1200,750", "--hide-scrollbars", "--mute-audio",
], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let targets;
for (let i = 0; i < 50; i++) {
  try { targets = await (await fetch(`http://127.0.0.1:${CDP}/json`)).json(); if (targets.some((t) => t.type === "page")) break; } catch {}
  await sleep(200);
}
const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const pending = new Map();
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expr) => (await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
await send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 750, deviceScaleFactor: 1, mobile: false, screenWidth: 1440, screenHeight: 900 });
await send("Page.navigate", { url: `http://127.0.0.1:${port}/?perf&seed=1847&weather=clear` });
for (let i = 0; i < 150; i++) { if (await evaluate("!!(window.skycope && skycope.walker && skycope.landscape)")) break; await sleep(200); }
await sleep(6000);
// Stand 9 m inland of the wreck looking out over it to the shore boulders.
const inland = Math.atan2(58 - wreck.x, 70 - wreck.z);
// Far enough out not to wake it yet; then in to 5 m, the camera over the
// wreck to the boulders along the beach.
const x = wreck.x + Math.sin(inland) * 22, z = wreck.z + Math.cos(inland) * 22;
const cx = wreck.x + Math.sin(inland - 0.2) * 5, cz = wreck.z + Math.cos(inland - 0.2) * 5;
const yaw = Math.atan2(wreck.x - cx, wreck.z - cz);
const place = (cx, cz) => evaluate(`(() => { const s = skycope, w = s.walker, c = w.cat, cam = w.camera; const sl = document.querySelector('#time'); sl.value = ${minutes}; sl.dispatchEvent(new Event('input')); c.x = ${cx}; c.z = ${cz}; c.y = w.surface(${cx}, ${cz}); c.speed = 0; c.heading = ${yaw}; cam.yaw = ${yaw}; cam.elevation = 0.3; cam.distance = 5; cam.targetY = c.y; })()`);
await place(x, z);
await sleep(2500);
// Walk in: the cat reaches the keepsake and the ceremony starts.
await place(cx, cz);
for (let f = 0; f < 14; f++) {
  await sleep(450);
  await evaluate(`(() => { const s = skycope, cam = s.walker.camera; s.thread?.input(); cam.yaw = ${yaw}; cam.elevation = 0.35; cam.distance = 7; })()`);
  const r = await send("Page.captureScreenshot", { format: "jpeg", quality: 80 });
  await writeFile(`${out}/pulse-${String(f).padStart(2, "0")}.jpg`, Buffer.from(r.result.data, "base64"));
}
console.log("done", out);
ws.close();
chrome.kill();
process.exit(0);
