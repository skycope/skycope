import test from "node:test";
import assert from "node:assert/strict";
import { createMeshProfiler } from "../src/mesh-profiler.js";

test("QA draws once per normal frame and bounds unfinished GPU queries", () => {
  const fake = fixture();
  const profiler = createMeshProfiler(fake.renderer, fake.canvas, true, fake.now);
  for (let i = 0; i < 300; i++) profiler.render(fake.draw);
  assert.equal(fake.calls.draw, 300);
  assert.equal(fake.calls.created, 4);
  assert.equal(fake.calls.results, 0, "unfinished query is never read synchronously");
  assert.equal(fake.canvas.dataset.meshGpuSamples, "0");
  assert.equal(fake.canvas.dataset.meshSubmitMs, "1.00");
  profiler.dispose();
  assert.equal(fake.calls.deleted, 4);
});

test("only finished queries publish GPU time; disjoint samples are discarded", () => {
  const fake = fixture();
  const profiler = createMeshProfiler(fake.renderer, fake.canvas, true, fake.now);
  fake.status.available = true;
  for (let i = 0; i < 30; i++) profiler.render(fake.draw);
  assert.equal(fake.canvas.dataset.meshGpuMs, "2.00");
  assert.equal(fake.calls.results, 2);
  fake.status.disjoint = true;
  profiler.render(fake.draw);
  assert.equal(fake.canvas.dataset.meshGpuMs, undefined);
  profiler.dispose();
});

test("unsupported GPU timer reports submission time without issuing queries", () => {
  const fake = fixture(false);
  const profiler = createMeshProfiler(fake.renderer, fake.canvas, true, fake.now);
  for (let i = 0; i < 30; i++) profiler.render(fake.draw);
  assert.equal(fake.canvas.dataset.meshTiming, "cpu-submission");
  assert.equal(fake.calls.created, 0);
  assert.equal(fake.calls.draw, 30);
});

function fixture(supported = true) {
  const status = { available: false, disjoint: false };
  const calls = { draw: 0, created: 0, deleted: 0, results: 0 };
  const gl = {
    QUERY_RESULT_AVAILABLE: "available", QUERY_RESULT: "result",
    getExtension: () => supported ? { GPU_DISJOINT_EXT: "disjoint", TIME_ELAPSED_EXT: "elapsed" } : null,
    getParameter: () => status.disjoint,
    createQuery: () => ({ id: ++calls.created }),
    deleteQuery: () => calls.deleted++,
    beginQuery() {}, endQuery() {},
    getQueryParameter(query, key) {
      if (key === "available") return status.available;
      calls.results++;
      return 2e6;
    },
  };
  let time = 0;
  return { status, calls, renderer: { getContext: () => gl, info: { render: { triangles: 123, calls: 4 } } },
    canvas: { dataset: {} }, now: () => time++, draw: () => calls.draw++ };
}
