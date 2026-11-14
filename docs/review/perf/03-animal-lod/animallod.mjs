// A herd seen from just past its LOD distance: the same frame with the fine
// body and with the coarse one (nothing else changes: reduced motion).
import { writeFile, mkdir } from "node:fs/promises";
import { PNG } from "/Users/skycope/Code/skycope/node_modules/pngjs/lib/png.js";

export default async ({ tab, evaluate, sleep, load, opt }) => {
  await mkdir(opt.out, { recursive: true });
  await load();
  const rows = [];
  for (const [kind, key, d] of [["penguins", "animal-penguin", 24], ["seals", "animal-seal", 33]]) {
    await evaluate(`skycope.budget.pin(0); __perf.place("home", 750)`);
    await tab.send("Emulation.setEmulatedMedia", { features: [] });
    await sleep(1500);
    // Walk the cat near the herd so it is awake and placed, then freeze.
    await evaluate(`(() => { const s = skycope, m = s.landscape.wildlife.${kind}; const c = m.centre ?? m.rock ?? { x: m.seals?.[0]?.x, z: m.seals?.[0]?.z }; const w = s.walker, cat = w.cat; const t = Math.atan2(c.z - 70, c.x - 58), R = Math.hypot(c.x - 58, c.z - 70) - 1.5, t2 = t + ${d} / R; cat.x = 58 + Math.cos(t2) * R; cat.z = 70 + Math.sin(t2) * R; cat.y = w.surface(cat.x, cat.z); const a = Math.atan2(c.x - cat.x, c.z - cat.z); cat.heading = a; w.camera.yaw = a; w.camera.distance = 3.4; w.camera.elevation = 0.2; window.__herd = c; })()`);
    await sleep(2500);
    await tab.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    await sleep(300);
    const shots = await evaluate(`(() => {
      const s = skycope, c = __herd;
      let mesh = null;
      s.landscape.scene.traverse((o) => { if (o.isInstancedMesh && String(o.material?.customProgramCacheKey?.()).startsWith(${JSON.stringify(key)})) mesh = o; });
      const f = s.flight, dist = Math.hypot(c.x - f.x, c.z - f.z);
      s.time = 1000;
      s.budget.pin(0);
      const coarse = mesh.geometry;
      const tri = (g) => g.index.count / 3;
      const out = { dist, coarseTri: tri(coarse), count: mesh.count, isCoarse: coarse.userData.ready };
      const a = [s.landscape.renderer.info.render.triangles, __perf.landPng()];
      coarse.userData.ready = false; s.budget.pin(0);
      const fine = mesh.geometry;
      const b = [s.landscape.renderer.info.render.triangles, __perf.landPng()];
      coarse.userData.ready = true;
      out.fineTri = tri(fine);
      out.same = fine === coarse;
      return [out, a, b];
    })()`);
    const [info, a, b] = shots;
    const ia = PNG.sync.read(Buffer.from(a[1].split(",")[1], "base64")), ib = PNG.sync.read(Buffer.from(b[1].split(",")[1], "base64"));
    let over8 = 0, sum = 0, n = ia.width * ia.height;
    for (let p = 0; p < n; p++) { let m = 0; for (let ch = 0; ch < 3; ch++) m = Math.max(m, Math.abs(ia.data[p * 4 + ch] - ib.data[p * 4 + ch])); sum += m; if (m > 8) over8++; }
    await writeFile(`${opt.out}/${kind}-coarse.png`, PNG.sync.write(ia));
    await writeFile(`${opt.out}/${kind}-fine.png`, PNG.sync.write(ib));
    rows.push({ kind, ...info, triCoarseFrame: a[0], triFineFrame: b[0], mean: sum / n, over8pct: (over8 / n) * 100, over8px: over8 });
  }
  return rows;
};
