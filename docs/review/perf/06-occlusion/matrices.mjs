// Cost of the per-frame world-matrix update, and what still auto-updates.
export default async ({ evaluate, sleep, load }) => {
  await load();
  await evaluate(`skycope.budget.pin(0); __perf.place("home", 750)`);
  await sleep(2500);
  await evaluate(`await __perf.pause()`);
  return evaluate(`(() => {
    const L = skycope.landscape, scene = L.scene;
    let objects = 0, auto = 0, autoMeshes = 0;
    const byParent = {};
    scene.traverse((o) => { objects++; if (o.matrixAutoUpdate) { auto++; const k = (o.parent?.name || o.parent?.type) + ">" + o.type; byParent[k] = (byParent[k] ?? 0) + 1; } });
    const t = [];
    for (let r = 0; r < 7; r++) { const t0 = performance.now(); for (let i = 0; i < 50; i++) scene.updateMatrixWorld(); t.push((performance.now() - t0) / 50); }
    t.sort((a, b) => a - b);
    return { objects, auto, frozen: L.renderer.domElement.dataset.frozen, msPerUpdate: t[3], top: Object.entries(byParent).sort((a, b) => b[1] - a[1]).slice(0, 8) };
  })()`);
};
