// Opt-in QA measures ordinary frames. Queries are polled only after the GPU
// signals completion; unsupported devices report CPU submission separately.
export function createMeshProfiler(renderer, canvas, enabled, now = () => performance.now()) {
  if (!enabled) return { render: (draw) => draw(), dispose() {} };
  const gl = renderer.getContext();
  const timer = gl.getExtension("EXT_disjoint_timer_query_webgl2");
  const pending = [], cpu = [], gpu = [];
  let frame = 0;
  canvas.dataset.meshTiming = timer ? "async-gpu" : "cpu-submission";
  return {
    render(draw) {
      const disjoint = timer && gl.getParameter(timer.GPU_DISJOINT_EXT);
      if (disjoint) {
        for (const query of pending) gl.deleteQuery(query);
        pending.length = 0;
        gpu.length = 0;
        delete canvas.dataset.meshGpuMs;
        delete canvas.dataset.meshGpuP95;
      } else if (timer) {
        while (pending.length && gl.getQueryParameter(pending[0], gl.QUERY_RESULT_AVAILABLE)) {
          const query = pending.shift();
          record(gpu, gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6);
          gl.deleteQuery(query);
        }
      }
      // At most four pending measurements and one query per fifteen frames.
      const query = timer && !disjoint && frame % 15 === 0 && pending.length < 4 ? gl.createQuery() : null;
      const started = now();
      if (query) gl.beginQuery(timer.TIME_ELAPSED_EXT, query);
      try { draw(); } finally {
        if (query) { gl.endQuery(timer.TIME_ELAPSED_EXT); pending.push(query); }
      }
      record(cpu, now() - started);
      if (++frame % 30 !== 0) return;
      canvas.dataset.meshSubmitMs = quantile(cpu, .5).toFixed(2);
      if (gpu.length) {
        canvas.dataset.meshGpuMs = quantile(gpu, .5).toFixed(2);
        canvas.dataset.meshGpuP95 = quantile(gpu, .95).toFixed(2);
      }
      canvas.dataset.meshGpuSamples = String(gpu.length);
      canvas.dataset.triangles = String(renderer.info.render.triangles);
      canvas.dataset.drawCalls = String(renderer.info.render.calls);
    },
    dispose() {
      for (const query of pending) gl.deleteQuery(query);
      pending.length = 0;
    },
  };
}

function record(samples, value) {
  if (!Number.isFinite(value) || value < 0) return;
  samples.push(value);
  if (samples.length > 120) samples.shift();
}

function quantile(samples, fraction) {
  const ordered = [...samples].sort((a, b) => a - b);
  return ordered[Math.min(ordered.length - 1, Math.floor((ordered.length - 1) * fraction))] ?? 0;
}
