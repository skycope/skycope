// Boat QA: drives a headless Chrome (already running with
// --remote-debugging-port, default 9408, launched with
// --headless=new --enable-unsafe-webgpu) through the boat's life and saves
// frames and contact sheets.
//   node scripts/boat-review.mjs <outDir> [port=5338] [only=a,b]
// Views: moored (abeam, from the beach, waterline close-up), launch strip,
// under way (astern, abeam), aboard (the game's own camera), landing on
// another shore; noon and night; calm and storm.
import { mkdir, writeFile, readFile } from "node:fs/promises";

const out = process.argv[2] ?? "docs/review/boat/after";
const port = process.argv[3] ?? "5338";
const only = process.argv[4]?.split(",");
const CDP = process.env.CDP ?? 9408;
const W = 1440, H = 900;
const NOON = 750, NIGHT = 1320;
await mkdir(out, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const base = `http://127.0.0.1:${CDP}`;
const tab = await (await fetch(`${base}/json/new?about:blank`, { method: "PUT" })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0;
const pending = new Map();
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === "Runtime.exceptionThrown") console.log("  exception:", m.params.exceptionDetails.exception?.description?.slice(0, 300));
  if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") console.log("  console.error:", m.params.args.map((a) => a.value ?? a.description).join(" ").slice(0, 300));
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const js = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) console.log("  eval error", r.result.exceptionDetails.exception?.description?.slice(0, 300));
  return r.result?.result?.value;
};
await send("Runtime.enable");
await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false, screenWidth: W, screenHeight: H });

// In-page helpers: a camera override (state.flight is what both renderers
// read), the clock, and the boat's state.
const HELPERS = `window.__b = {
  look(cx, cy, cz, tx, ty, tz) {
    const dx = tx - cx, dz = tz - cz;
    skycope.flight = { x: cx, y: cy, z: cz, azimuth: Math.atan2(dx, dz) - Math.PI / 4, pitch: Math.atan2(ty - cy, Math.hypot(dx, dz)), pointer: [0.5, 0.5], yaw: Math.atan2(dx, dz), elevation: 0.2, distance: Math.hypot(dx, dz) };
  },
  // Relative to the boat: along (bow +), across (starboard +), up; looking at the hull's middle.
  orbit(along, across, up, lookUp = 0.15, lookAlong = 0) {
    const s = skycope.boat.ride.state, fx = Math.sin(s.heading), fz = Math.cos(s.heading);
    const cx = s.x + fx * along + fz * across, cz = s.z + fz * along - fx * across;
    this.look(cx, s.y + up, cz, s.x + fx * lookAlong, s.y + lookUp, s.z + fz * lookAlong);
  },
  follow(along, across, up, lookUp, lookAlong) { clearInterval(this.timer); this.timer = setInterval(() => this.orbit(along, across, up, lookUp, lookAlong), 16); this.orbit(along, across, up, lookUp, lookAlong); },
  release() { clearInterval(this.timer); skycope.flight = skycope.walker.camera; },
  time(m) { const sl = document.querySelector('#time'); sl.value = m; sl.dispatchEvent(new Event('input')); },
  // The cat somewhere out of the picture, on dry land.
  parkCat() { const w = skycope.walker, c = w.cat; c.x = 58; c.z = 70; c.y = w.surface(58, 70); c.speed = 0; },
  board() {
    const r = skycope.boat.ride; r.ride.state = 'aboard'; r.ride.t = 0; r.ride.still = 0;
  },
  boat() { const s = skycope.boat.ride.state; return { state: skycope.boat.ride.ride.state, x: s.x, z: s.z, y: s.y, heading: s.heading, speed: Math.hypot(s.vx, s.vz), offshore: s.offshore, bow: s.bowGrounded }; },
};`;

async function load(query) {
  await send("Page.navigate", { url: `http://127.0.0.1:${port}/?perf&seed=1847&${query}` });
  for (let i = 0; i < 150; i++) {
    await sleep(200);
    if (await js("!!(window.skycope && skycope.walker && skycope.landscape && skycope.boat && skycope.time > 1)")) break;
  }
  await js(HELPERS);
  await sleep(2000);
}
async function snap(name, label) {
  const r = await send("Page.captureScreenshot", { format: "jpeg", quality: 86 });
  const file = `${out}/${name}.jpg`;
  await writeFile(file, Buffer.from(r.result.data, "base64"));
  const stats = await js(`(({ triangles, drawCalls }) => triangles + ' tris, ' + drawCalls + ' draws')(document.querySelector('#landscape').dataset)`);
  shots.push({ name, label: label ?? name, file });
  console.log(name, stats);
}
const shots = [];
const want = (name) => !only || only.some((o) => name.includes(o));

// ---- Moored: abeam, from the beach, the waterline close up; noon, night,
// storm.
for (const [weather, times] of [["clear", [NOON, NIGHT]], ["storm", [NOON]]]) {
  if (!want(`moored-${weather}`)) continue;
  await load(`magic=boat&weather=${weather}`);
  for (const t of times) {
    const tag = `${weather}-${t === NOON ? "noon" : "night"}`;
    await js(`__b.time(${t}); __b.parkCat();`);
    await js(`__b.follow(0.3, 7.5, 1.7, 0.1)`);
    await sleep(2500);
    await snap(`moored-abeam-${tag}`, `moored, abeam 7.5 m (${tag})`);
    await js(`__b.follow(-6.5, -3.5, 2.2, 0.1)`);
    await sleep(1500);
    await snap(`moored-quarter-${tag}`, `moored, from astern quarter (${tag})`);
    await js(`__b.follow(0.2, 2.6, 0.75, 0.0)`);
    await sleep(1500);
    await snap(`waterline-${tag}`, `waterline close-up (${tag})`);
    await js(`__b.follow(4.0, 1.2, 1.1, 0.1, 3.5)`);
    await sleep(1500);
    await snap(`painter-${tag}`, `bow and painter (${tag})`);
  }
  await js("__b.release()");
}

// ---- The launch: the gift wakes (or the cat pushes), frame by frame.
if (want("launch")) {
  await load(`weather=clear`);
  await js(`__b.time(${NOON})`);
  // The cat beside the hull on its logs, facing it.
  const lm = await js(`(() => { const p = skycope.boat.landmark ?? skycope.landscape.pois?.find((q) => q.id === 'boat') ?? null; const r = skycope.boat.ride; return p ? { x: p.x, z: p.z, facing: p.facing, cove: r.cove } : { cove: r.cove }; })()`);
  console.log("landmark", JSON.stringify(lm));
  if (lm?.x !== undefined) {
    const fx = Math.sin(lm.facing ?? 0), fz = Math.cos(lm.facing ?? 0);
    await js(`(() => { const w = skycope.walker, c = w.cat; c.x = ${lm.x + fz * 1.6}; c.z = ${lm.z - fx * 1.6}; c.y = w.surface(c.x, c.z); c.heading = Math.atan2(${-fz}, ${fx}); c.speed = 0; })()`);
    const mx = (lm.x + lm.cove.x) / 2, mz = (lm.z + lm.cove.z) / 2;
    const dx = lm.cove.x - lm.x, dz = lm.cove.z - lm.z, L = Math.hypot(dx, dz);
    const cx = mx - (dz / L) * 9, cz = mz + (dx / L) * 9;
    await js(`__b.look(${cx}, 2.6, ${cz}, ${mx}, 0.2, ${mz})`);
    await sleep(1500);
    await snap("launch-0-ashore", "launch: ashore, before");
    await js(`(${process.env.LAUNCH ?? "() => skycope.magic.wake('boat')"})()`);
    for (let k = 1; k <= 8; k++) {
      await sleep(1000);
      await snap(`launch-${k}`, `launch: ${k} s`);
    }
    await sleep(3000);
    await snap(`launch-9-settled`, "launch: settled");
  }
}

// ---- Under way: astern and abeam; the aboard camera; a landing.
for (const weather of ["clear", "storm"]) {
  if (!want(`underway-${weather}`)) continue;
  await load(`magic=boat&weather=${weather}`);
  for (const t of weather === "clear" ? [NOON, NIGHT] : [NOON]) {
    const tag = `${weather}-${t === NOON ? "noon" : "night"}`;
    await js(`__b.time(${t}); __b.board();`);
    // Out to sea along the shore.
    await js(`(() => { const r = skycope.boat.ride, s = r.state; const ox = s.x - 58, oz = s.z - 70, L = Math.hypot(ox, oz); r.sailTo(s.x + ox / L * 30 + oz / L * 25, s.z + oz / L * 30 - ox / L * 25); })()`);
    await sleep(9000);
    await js(`__b.follow(-7.5, 0.6, 2.1, 0.2)`);
    await sleep(1200);
    await snap(`underway-astern-${tag}`, `under way, astern (${tag}) ${JSON.stringify(await js("__b.boat().speed.toFixed(2)"))} m/s`);
    await js(`__b.follow(1.0, 6.5, 1.5, 0.15)`);
    await sleep(1200);
    await snap(`underway-abeam-${tag}`, `under way, abeam (${tag})`);
    await js(`__b.follow(5.5, 2.5, 1.2, 0.15, 1.5)`);
    await sleep(1200);
    await snap(`underway-bow-${tag}`, `under way, bow wave (${tag})`);
    await js("__b.release()");
    await sleep(3000);
    await snap(`aboard-${tag}`, `aboard: the game camera (${tag})`);
    // The game camera pulled in close (the viewer's zoom).
    await js("skycope.walker.zoom(0.4)");
    await sleep(2500);
    await snap(`aboard-close-${tag}`, `aboard: zoomed in (${tag})`);
    await js("skycope.walker.zoom(2)");
    await js(`(() => { const r = skycope.boat.ride; r.sailTo(r.state.x, r.state.z); r.ride.state = 'waiting'; })()`);
  }
}

if (want("landing")) {
  await load(`magic=boat&weather=clear`);
  await js(`__b.time(${NOON}); __b.board();`);
  // Straight in at another beach, a quarter of the way round the island.
  const target = await js(`(() => { const r = skycope.boat.ride, s = r.state; const a = Math.atan2(s.z - 70, s.x - 58) + 0.5; const tx = 58 + Math.cos(a) * 30, tz = 70 + Math.sin(a) * 30; r.sailTo(tx, tz); return [tx, tz]; })()`);
  for (let i = 0; i < 40; i++) {
    await sleep(1000);
    const b = await js("__b.boat()");
    if (b.bow || b.state !== "aboard") break;
  }
  await js(`__b.follow(1.5, 5.5, 1.6, 0.2)`);
  await sleep(300);
  await snap("landing-grounded", "landing: bow on the sand");
  await js(`__b.release()`);
  await sleep(2500);
  await snap("landing-ashore", "landing: the cat hops out");
}

// ---- Contact sheet: the frames in a grid, rendered by the same browser.
const cells = [];
for (const s of shots) cells.push(`<figure><img src="data:image/jpeg;base64,${(await readFile(s.file)).toString("base64")}"><figcaption>${s.label}</figcaption></figure>`);
const cols = 3;
const html = `<!doctype html><meta charset=utf-8><style>body{margin:0;background:#111;color:#ddd;font:14px system-ui}main{display:grid;grid-template-columns:repeat(${cols},1fr);gap:6px;padding:6px}figure{margin:0}img{width:100%;display:block}figcaption{padding:3px 2px}</style><main>${cells.join("")}</main>`;
await writeFile(`${out}/sheet.html`, html);
if (shots.length) {
  const rows = Math.ceil(shots.length / cols);
  const sheetW = 1800, cellH = (sheetW / cols) * (H / W) + 24;
  await send("Emulation.setDeviceMetricsOverride", { width: sheetW, height: Math.ceil(rows * cellH + 12), deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: `file://${process.cwd()}/${out}/sheet.html` });
  await sleep(1500);
  const r = await send("Page.captureScreenshot", { format: "jpeg", quality: 80, captureBeyondViewport: true });
  await writeFile(`${out}/sheet.jpg`, Buffer.from(r.result.data, "base64"));
  console.log("sheet", `${out}/sheet.jpg`);
}
await fetch(`${base}/json/close/${tab.id}`);
ws.close();
process.exit(0);
