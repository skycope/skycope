// Contact sheets from places-capture.mjs runs: one sheet per place, a row
// per run (before, after, …), a column per camera and time, rendered by
// headless Chrome from a throwaway HTML page.
//   CDP=9401 node scripts/places-sheet.mjs <sheetDir> <label=dir> [label=dir …]
// Env ONLY=a,b limits the places; COLS=n thumbnails per row (default 4).
import { spawn } from "node:child_process";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const out = resolve(process.argv[2]);
const runs = process.argv.slice(3).map((a) => { const [label, dir] = a.split("="); return { label, dir: resolve(dir) }; });
const CDP = process.env.CDP ?? 9401;
await mkdir(out, { recursive: true });
const files = (await readdir(runs[0].dir)).filter((f) => f.endsWith(".jpg")).sort();
const places = [...new Set(files.map((f) => f.split("-")[0]))].filter((p) => !process.env.ONLY || process.env.ONLY.split(",").includes(p));
const TW = 400, TH = 250;

const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", [
  "--headless=new", `--remote-debugging-port=${CDP}`, "--no-first-run", `--user-data-dir=${out}/.chrome`,
  "--hide-scrollbars", "--allow-file-access-from-files",
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

for (const place of places) {
  const shots = files.filter((f) => f.startsWith(place + "-"));
  // Day first, then night, wide before close.
  shots.sort((a, b) => (a.match(/-(\d+)\.jpg$/)[1] - b.match(/-(\d+)\.jpg$/)[1]) || a.localeCompare(b));
  const cols = shots.length;
  const width = 90 + cols * (TW + 4), height = 24 + runs.length * (TH + 4);
  const cells = runs.map((r) => `<div class=row><div class=label>${r.label}</div>${shots.map((s) => `<img src="file://${r.dir}/${s}">`).join("")}</div>`).join("");
  const head = `<div class=row><div class=label></div>${shots.map((s) => `<div class=cap>${s.replace(".jpg", "")}</div>`).join("")}</div>`;
  const html = `<!doctype html><meta charset=utf-8><style>body{margin:0;background:#111;color:#ddd;font:12px monospace}.row{display:flex;gap:4px;margin-bottom:4px}.label{width:86px;padding:4px}.cap{width:${TW}px;height:20px}img{width:${TW}px;height:${TH}px;object-fit:cover}</style>${head}${cells}`;
  const page = `${out}/.${place}.html`;
  await writeFile(page, html);
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: `file://${page}` });
  await sleep(1200);
  const r = await send("Page.captureScreenshot", { format: "jpeg", quality: 82 });
  await writeFile(`${out}/${place}.jpg`, Buffer.from(r.result.data, "base64"));
  console.log(`${out}/${place}.jpg`);
}
ws.close();
chrome.kill();
process.exit(0);
