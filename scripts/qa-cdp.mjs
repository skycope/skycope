// Headless Chrome over CDP for QA scripts (walk-qa.mjs, ad hoc probes):
// spawns its own Chrome on CDP port `cdp` (one per agent, so parallel
// sessions do not collide), opens the site on `port` with ?perf (window.
// skycope), and returns { evaluate, snap, frame, close }.
//   const page = await openPage({ port: 5332, cdp: 9402, query: "seed=1847" });
import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function openPage({ port = 5332, cdp = 9402, query = "seed=1847", width = 1280, height = 800, desktop = true } = {}) {
  const profile = await mkdtemp(join(tmpdir(), "skycope-qa-"));
  const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", [
    "--headless=new", "--enable-unsafe-webgpu", `--remote-debugging-port=${cdp}`, "--no-first-run",
    `--user-data-dir=${profile}`, `--window-size=${width},${height}`, "--hide-scrollbars", "--mute-audio",
    "--disable-background-timer-throttling", "--disable-renderer-backgrounding",
  ], { stdio: "ignore" });
  let targets = [];
  for (let i = 0; i < 80; i++) {
    try {
      targets = await (await fetch(`http://127.0.0.1:${cdp}/json`)).json();
      if (targets.some((t) => t.type === "page")) break;
    } catch {}
    await sleep(200);
  }
  const target = targets.find((t) => t.type === "page");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  let id = 0;
  const pending = new Map();
  const errors = [];
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errors.push(m.params.args.map((a) => a.value ?? a.description).join(" ").slice(0, 300));
    if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description?.slice(0, 300));
  });
  const send = (method, params = {}) => new Promise((r) => {
    const i = ++id;
    pending.set(i, r);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  const evaluate = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? "eval failed");
    return r.result?.result?.value;
  };
  await send("Runtime.enable");
  // The desktop budget (headless reports an 800×600 screen: the phone path).
  if (desktop) await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false, screenWidth: 1440, screenHeight: 900 });
  else await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: `http://127.0.0.1:${port}/?perf&${query}` });
  for (let i = 0; i < 150; i++) {
    try {
      if (await evaluate("!!(window.skycope && skycope.walker && skycope.landscape)")) break;
    } catch {}
    await sleep(200);
  }
  await sleep(2500);
  return {
    send,
    evaluate,
    errors,
    sleep,
    async snap(path, quality = 85) {
      const r = await send("Page.captureScreenshot", { format: "jpeg", quality });
      await writeFile(path, Buffer.from(r.result.data, "base64"));
      return path;
    },
    async close() {
      try { ws.close(); } catch {}
      chrome.kill();
      await sleep(300);
    },
  };
}
