// LOD pop check. Camera fixed (reduced motion: nothing animates); the render
// budget's LOD bias swept in small steps moves every level boundary through
// the view. With working fades each step changes a little everywhere; a pop
// is a step where a cluster of pixels jumps. Then a walk toward the milkwood
// in 0.2 m steps, triangles per step.
import { writeFile, mkdir } from "node:fs/promises";
import { PNG } from "/Users/skycope/Code/skycope/node_modules/pngjs/lib/png.js";

export default async ({ tab, evaluate, sleep, load, opt }) => {
  const out = opt.out;
  await mkdir(out, { recursive: true });
  await load();
  const view = opt.view ?? "milkwood";
  await evaluate(`skycope.budget.pin(0); __perf.place(${JSON.stringify(view)}, 750)`);
  await sleep(3000);
  await evaluate(`__perf.place(${JSON.stringify(view)}, 750)`);
  await sleep(1500);
  await evaluate("__perf.markMovers()");
  await sleep(1000);
  await evaluate("__perf.hideMovers()");
  await tab.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await sleep(300);
  // Render one still at a bias: set the settings' lodBias directly.
  const still = async (bias) => {
    const png = await evaluate(`(() => { const s = skycope; s.settings.lodBias = ${bias}; s.landscape.setQuality(s.settings); s.time = 1000; __perf.repackKeep?.(); s.budget.pin(0); s.settings.lodBias = ${bias}; s.landscape.setQuality(s.settings); for (let i = 0; i < 3; i++) s.budget.pin(0); return __perf.landPng(); })()`);
    return PNG.sync.read(Buffer.from(png.split(",")[1], "base64"));
  };
  // pin(0) resets settings to the ladder's level 0 (lodBias 1): instead,
  // patch the ladder itself.
  const setBias = (b) => evaluate(`(() => { const s = skycope; s.budget.ladder[0].lodBias = ${b}; s.budget.pin(0); s.budget.pin(0); return [s.settings.lodBias, s.landscape.renderer.info.render.triangles, __perf.landPng()]; })()`);
  const grab = async () => PNG.sync.read(Buffer.from((await evaluate("__perf.landPng()")).split(",")[1], "base64"));
  const steps = [];
  let prev = null;
  const N = Number(opt.steps ?? 60);
  for (let i = 0; i <= N; i++) {
    const b = 1 - (i / N) * 0.4;
    const [bias, tri, png] = await setBias(b);
    const img = PNG.sync.read(Buffer.from(png.split(",")[1], "base64"));
    if (prev) {
      let changed8 = 0, changed32 = 0, sum = 0;
      const n = img.width * img.height;
      const heat = new PNG({ width: img.width, height: img.height });
      for (let p = 0; p < n; p++) {
        let m = 0;
        for (let c = 0; c < 3; c++) m = Math.max(m, Math.abs(img.data[p * 4 + c] - prev.data[p * 4 + c]));
        sum += m;
        if (m > 8) changed8++;
        if (m > 32) changed32++;
        heat.data[p * 4] = heat.data[p * 4 + 1] = heat.data[p * 4 + 2] = Math.min(255, m * 4);
        heat.data[p * 4 + 3] = 255;
      }
      steps.push({ i, bias: Math.round(bias * 1000) / 1000, tri, mean: Math.round((sum / n) * 1000) / 1000, over8: Math.round((changed8 / n) * 100000) / 1000, over32: Math.round((changed32 / n) * 100000) / 1000 });
      if (opt.heat) await writeFile(`${out}/step-${String(i).padStart(3, "0")}.png`, PNG.sync.write(heat));
    }
    prev = img;
  }
  await tab.send("Emulation.setEmulatedMedia", { features: [] });
  return steps;
};
