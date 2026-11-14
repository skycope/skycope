// Triangles by kind of mesh in a view (frustum-tested like the renderer).
export default async ({ evaluate, sleep, load, opt }) => {
  await load(opt.magic ?? "asleep");
  const out = {};
  for (const view of (opt.views ?? "home,beacon-out,milkwood").split(",")) {
    await evaluate(`skycope.budget.pin(0); __perf.place(${JSON.stringify(view)}, 750)`);
    await sleep(3000);
    out[view] = await evaluate(`(() => {
      const L = skycope.landscape, cam = L.camera, THREE_F = cam.constructor;
      cam.updateMatrixWorld();
      const m = cam.projectionMatrix.clone().multiply(cam.matrixWorldInverse);
      const planes = [];
      const e = m.elements;
      const row = (i) => [e[i], e[i + 4], e[i + 8], e[i + 12]];
      const r0 = row(0), r1 = row(1), r2 = row(2), r3 = row(3);
      for (const [a, s] of [[r0, 1], [r0, -1], [r1, 1], [r1, -1], [r2, 1], [r2, -1]]) {
        const p = r3.map((v, i) => v + s * a[i]); const n = Math.hypot(p[0], p[1], p[2]); planes.push(p.map((v) => v / n));
      }
      const visibleAll = (o) => { for (let q = o; q; q = q.parent) if (!q.visible) return false; return true; };
      const by = {};
      L.scene.traverse((o) => {
        if (!o.isMesh || !visibleAll(o) || !o.geometry?.index && !o.geometry?.attributes?.position) return;
        if (o.frustumCulled !== false) {
          const s = o.boundingSphere ?? (o.geometry.boundingSphere || (o.geometry.computeBoundingSphere(), o.geometry.boundingSphere));
          if (s) {
            const c = s.center.clone().applyMatrix4(o.matrixWorld);
            const r = s.radius * o.matrixWorld.getMaxScaleOnAxis();
            if (planes.some((p) => p[0] * c.x + p[1] * c.y + p[2] * c.z + p[3] < -r)) return;
          }
        }
        const per = (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
        const n = o.isInstancedMesh ? o.count : 1;
        let key = String(o.material?.customProgramCacheKey?.() ?? o.material?.type).slice(0, 60);
        if (o.name) key = o.name + " " + key;
        by[key] = (by[key] ?? 0) + per * n;
      });
      return Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 18).map(([k, v]) => [Math.round(v), k]);
    })()`);
  }
  return out;
};
