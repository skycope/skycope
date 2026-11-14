// Probe: shader programs compiled after warm-up when each gift first wakes
// (three.js programs on the land layer; whether the WebGPU awake pipelines
// were already built), and frames over 2x the median around each waking.
//   node scripts/probe-compiles.mjs [port] [cdp]
import { openPage } from "./qa-cdp.mjs";

const port = Number(process.argv[2] ?? 5332);
const cdp = Number(process.argv[3] ?? 9402);
const page = await openPage({ port, cdp, query: "seed=1847" });
await page.evaluate(`(() => {
  const qa = window.qa = { raf: [], last: 0 };
  const tick = (t) => { if (qa.last) qa.raf.push(t - qa.last); qa.last = t; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  document.querySelector('#time').value = 1290; document.querySelector('#time').dispatchEvent(new Event('input'));
})()`);
await page.sleep(6000);
const programs = () => page.evaluate("skycope.landscape.renderer.info.programs.length");
const out = { start: await programs(), gifts: {} };
for (const gift of (process.env.ORDER ?? "fireflies,tideglow,lamp,stars,seafolk,boat").split(",")) {
  await page.evaluate("qa.raf = []");
  const before = await programs();
  await page.evaluate(`skycope.magic.wake(${JSON.stringify(gift)})`);
  await page.sleep(2500);
  const raf = await page.evaluate("qa.raf");
  const sorted = [...raf].sort((a, b) => a - b);
  const median = sorted[sorted.length >> 1];
  out.gifts[gift] = { programs: (await programs()) - before, hitches: raf.filter((d) => d > 2 * median).length, worstMs: Math.round(Math.max(...raf)), frames: raf.length };
}
console.log(JSON.stringify(out));
if (page.errors.length) console.log(page.errors.slice(0, 3));
await page.close();
process.exit(0);
