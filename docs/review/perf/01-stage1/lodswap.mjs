// Every THREE.LOD in the scene: from just inside its switch distance, the
// same frame drawn with its near level and with its far level. The diff is
// the pop a visitor sees when walking across the boundary.
import { writeFile, mkdir } from "node:fs/promises";
import { PNG } from "/Users/skycope/Code/skycope/node_modules/pngjs/lib/png.js";

export default async ({ tab, evaluate, sleep, load, opt }) => {
  await mkdir(opt.out, { recursive: true });
  await load();
  await evaluate(`skycope.budget.pin(0); __perf.place("milkwood", 750)`);
  await sleep(3000);
  await evaluate("__perf.markMovers()");
  await sleep(1000);
  await evaluate("__perf.hideMovers()");
  await tab.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await sleep(300);
  const lods = await evaluate(`(() => { const out = []; window.__lods = []; skycope.landscape.scene.traverse((o) => { if (o.isLOD && o.levels.length > 1) { const p = new o.constructor().position; o.getWorldPosition(p); __lods.push(o); out.push({ i: __lods.length - 1, x: p.x, y: p.y, z: -p.z, d: o.levels.map((l) => l.distance), name: o.parent?.name || o.name }); } }); return out; })()`);
  const rows = [];
  for (const l of lods) {
    const d = l.d[1] - 0.5;
    const pngs = await evaluate(`(() => {
      const s = skycope, lod = __lods[${l.i}];
      const a = Math.atan2(58 - ${l.x}, 70 - ${l.z});
      const x = ${l.x} + Math.sin(a) * ${d}, z = ${l.z} + Math.cos(a) * ${d};
      const dx = ${l.x} - x, dz = ${l.z} - z, L = Math.hypot(dx, dz);
      const y = Math.max(s.walker.surface(x, z) + 2.0, ${l.y} + 4 + ${d} * 0.4);
      s.flight = { ...s.flight, x, y, z, azimuth: Math.atan2(dx / L - dz / L, dx / L + dz / L), pitch: -Math.atan2(y - ${l.y} - 4, ${d}) };
      s.time = 1000;
      const shots = [];
      lod.autoUpdate = false;
      for (const k of [0, 1]) {
        lod.levels.forEach((lv, j) => (lv.object.visible = j === k));
        s.budget.pin(0);
        shots.push([s.landscape.renderer.info.render.triangles, __perf.landPng()]);
      }
      lod.autoUpdate = true;
      return shots;
    })()`);
    const [a, b] = pngs.map(([, p]) => PNG.sync.read(Buffer.from(p.split(",")[1], "base64")));
    let over8 = 0, sum = 0;
    const n = a.width * a.height;
    const heat = new PNG({ width: a.width, height: a.height });
    for (let p = 0; p < n; p++) {
      let m = 0;
      for (let c = 0; c < 3; c++) m = Math.max(m, Math.abs(a.data[p * 4 + c] - b.data[p * 4 + c]));
      sum += m; if (m > 8) over8++;
      heat.data[p * 4] = heat.data[p * 4 + 1] = heat.data[p * 4 + 2] = Math.min(255, m * 4); heat.data[p * 4 + 3] = 255;
    }
    await writeFile(`${opt.out}/lod-${l.i}-near.png`, PNG.sync.write(a));
    await writeFile(`${opt.out}/lod-${l.i}-far.png`, PNG.sync.write(b));
    await writeFile(`${opt.out}/lod-${l.i}-diff.png`, PNG.sync.write(heat));
    rows.push({ ...l, at: d, triNear: pngs[0][0], triFar: pngs[1][0], mean: Math.round((sum / n) * 1000) / 1000, over8: Math.round((over8 / n) * 100000) / 1000 });
  }
  return rows;
};
