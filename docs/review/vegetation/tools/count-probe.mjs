// perf.mjs probe: steady-state triangles and draw calls per vegetation view,
// plus triangles drawn per material name in the colour pass of one frame
// (onAfterRender fires only for objects that were actually drawn).
const VIEWS = (process.env.VIEWS ?? "forest-slope,meadow,shore-scrub,hilltop,milkwood-under,cat-plants").split(",");
const TIMES = (process.env.TIMES ?? "750").split(",").map(Number);
export default async function ({ evaluate, sleep, load, shot }) {
  await load("asleep");
  const out = {};
  for (const minutes of TIMES)
    for (const view of VIEWS) {
      await evaluate(`__perf.resume(); skycope.budget.pin(0); __perf.place(${JSON.stringify(view)}, ${minutes})`);
      await sleep(1500);
      await evaluate(`await __perf.pause(); __perf.place(${JSON.stringify(view)}, ${minutes}); __perf.step(20)`);
      const c = await evaluate("__perf.counts()");
      const parts = await evaluate(`(() => {
        const L = skycope.landscape;
        const by = {};
        const hooked = [];
        L.scene.traverse((o) => {
          if (!o.isMesh || !o.geometry) return;
          const prev = o.onAfterRender;
          hooked.push([o, prev]);
          o.onAfterRender = function (r, s, cam, g, m) {
            if (m && m.isMeshDepthMaterial || m && m.isMeshDistanceMaterial) return;
            const per = (g.index ? g.index.count : g.attributes.position?.count ?? 0) / 3;
            const n = o.isInstancedMesh ? o.count : g.isInstancedBufferGeometry ? g.instanceCount : 1;
            const name = o.name || (Array.isArray(o.material) ? o.material[0] : o.material)?.name || "other";
            by[name] = (by[name] ?? 0) + per * n;
          };
        });
        __perf.step(1);
        for (const [o, prev] of hooked) o.onAfterRender = prev;
        for (const k in by) by[k] = Math.round(by[k]);
        return by;
      })()`);
      out[`${minutes}-${view}`] = { triangles: c.triangles, calls: c.calls, parts };
      await evaluate("__perf.resume()");
      await sleep(400);
      if (shot) await shot(`${minutes}-${view}`);
    }
  return out;
}
