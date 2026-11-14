// What occlusion culling could still save: render the view into a depth
// target, then test every drawn mesh's bounding box against that depth with
// an occlusion query. Hidden triangles / drawn triangles, per view.
export default async ({ evaluate, sleep, load, opt }) => {
  await load();
  const out = {};
  for (const view of (opt.views ?? "home,milkwood,beacon,beacon-out,lighthouse,sea").split(",")) {
    await evaluate(`skycope.budget.pin(0); __perf.place(${JSON.stringify(view)}, 750)`);
    await sleep(2500);
    await evaluate(`await __perf.pause(); __perf.place(${JSON.stringify(view)}, 750); __perf.step(6)`);
    out[view] = await evaluate(`await (async () => {
      const L = skycope.landscape, r = L.renderer, gl = r.getContext(), scene = L.scene, camera = L.camera;
      const T = await import("/node_modules/.vite/deps/three.js").catch(() => null);
      const THREE = T ?? window.THREE;
      const size = r.getDrawingBufferSize(new THREE.Vector2());
      const rt = new THREE.WebGLRenderTarget(size.x, size.y, { depthBuffer: true });
      r.setRenderTarget(rt);
      r.autoClear = true;
      r.render(scene, camera);
      // Candidates: meshes drawn this frame (visible chain, in the frustum).
      const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
      const seen = (o) => { for (let q = o; q; q = q.parent) if (!q.visible) return false; return true; };
      const items = [];
      scene.traverse((o) => {
        if (!o.isMesh || !seen(o) || o.isSkinnedMesh) return;
        const g = o.geometry;
        const per = (g.index ? g.index.count : g.attributes.position?.count ?? 0) / 3;
        const tris = per * (o.isInstancedMesh ? o.count : 1);
        if (tris < 2000) return;
        const sphere = o.boundingSphere ? o.boundingSphere.clone() : (g.boundingSphere ?? (g.computeBoundingSphere(), g.boundingSphere)).clone();
        sphere.applyMatrix4(o.matrixWorld);
        if (o.frustumCulled !== false && !frustum.intersectsSphere(sphere)) return;
        items.push({ o, tris, sphere, veg: !!o.parent?.userData?.lodChunks || !!o.userData.static });
      });
      // Box proxies: no colour, no depth writes, tested against the depth.
      const box = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, side: THREE.DoubleSide }));
      const proxy = new THREE.Scene();
      proxy.add(box);
      r.autoClear = false;
      const queries = [];
      for (const it of items) {
        const s = it.sphere;
        // Camera inside the sphere: visible.
        if (s.center.distanceTo(camera.position) < s.radius + camera.near * 2) { queries.push(null); continue; }
        box.position.copy(s.center);
        box.scale.setScalar(s.radius * 2);
        box.updateMatrixWorld();
        const q = gl.createQuery();
        gl.beginQuery(gl.ANY_SAMPLES_PASSED_CONSERVATIVE, q);
        r.render(proxy, camera);
        gl.endQuery(gl.ANY_SAMPLES_PASSED_CONSERVATIVE);
        queries.push(q);
      }
      r.setRenderTarget(null);
      r.autoClear = true;
      for (let w = 0; w < 200; w++) {
        if (queries.every((q) => !q || gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE))) break;
        await new Promise((res) => setTimeout(res, 10));
      }
      let total = 0, hidden = 0, vegTotal = 0, vegHidden = 0, hiddenMeshes = 0;
      items.forEach((it, i) => {
        const q = queries[i];
        const visible = !q || gl.getQueryParameter(q, gl.QUERY_RESULT);
        total += it.tris;
        if (it.veg) vegTotal += it.tris;
        if (!visible) { hidden += it.tris; hiddenMeshes++; if (it.veg) vegHidden += it.tris; }
        if (q) gl.deleteQuery(q);
      });
      rt.dispose(); box.geometry.dispose(); box.material.dispose();
      return { meshes: items.length, hiddenMeshes, tested: total, hidden, share: +(hidden / total).toFixed(3), vegShare: +(vegHidden / Math.max(1, vegTotal)).toFixed(3) };
    })()`);
    await evaluate("__perf.resume()");
  }
  return out;
};
