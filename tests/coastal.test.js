import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createWake, WAKE } from "../src/wake.js";
import { createWaveModes } from "../src/wave-modes.js";
import { swashState } from "../src/sea-surface.js";
import { swellUniform } from "../src/swell.js";

test("swash CPU and shipping GLSL agree over run-up, retreat and cycle wrap", () => {
  const glsl = readFileSync(new URL("../src/surf.js", import.meta.url), "utf8");
  const names = ["swashEnvelope", "breakerTheta", "swashPhase", "swash"];
  const code = names.map((name) => {
    const source = glsl.match(new RegExp(`(?:float|vec4) ${name}\\([^]*?\\n\\}`))[0];
    return source.replace(/(?:float|vec4) (\w+)\(/, "function $1(")
      .replace(/float /g, "")
      .replace(/swell\.([xyzw])/g, (_, c) => `swell[${"xyzw".indexOf(c)}]`)
      .replace(/return vec4\( ([^]*?) \);/, "return [$1];")
      .replace(/\n  (\w+) =/g, "\n  var $1 =");
  }).join("\n");
  const shader = new Function("swell", "along", "inland", "time", `
    const { sin, cos, pow, exp, asin, min, max } = Math;
    const mix = (a,b,t) => a*(1-t)+b*t;
    const fract = x => x - Math.floor(x);
    const clamp = (x,a,b) => max(a,min(b,x));
    const smoothstep = (a,b,x) => { const t=clamp((x-a)/(b-a),0,1); return t*t*(3-2*t); };
    ${code}
    // Pixel footprint 0: the shaders widen the film edge by it for antialiasing.
    return swash(along,inland,time,0);
  `);
  const wgsl = readFileSync(new URL("../src/shaders/ocean.wgsl", import.meta.url), "utf8");
  const wgCode = ["set_envelope", "breaker_warp", "swash"].map((name) => {
    const source = wgsl.match(new RegExp(`fn ${name}\\([^]*?\\n\\}`))[0];
    return source.replace(/fn (\w+)\(([^]*?)\) -> \w+ \{/, (_, name, args) =>
      `function ${name}(${args.replace(/: \w+/g, "")}) {`)
      .replace(/var /g, "let ")
      .replace(/swell\.([xyzw])/g, (_, c) => `swell[${"xyzw".indexOf(c)}]`)
      .replace(/return vec[24]f\(([^]*?)\);/, "return [$1];")
      .replace(/breaker_warp\(([^]*?)\)\.x/, "breaker_warp($1)[0]");
  }).join("\n");
  const wgShader = new Function("swell", "along", "inland", "time", `
    const { sin, cos, pow, exp, asin, min, max } = Math;
    const TAU = 6.283185;
    const select = (a,b,p) => p ? b : a;
    const mix = (a,b,t) => a*(1-t)+b*t;
    const fract = x => x-Math.floor(x);
    const clamp = (x,a,b) => max(a,min(b,x));
    const smoothstep = (a,b,x) => { const t=clamp((x-a)/(b-a),0,1); return t*t*(3-2*t); };
    ${wgCode}
    return swash(along,inland,time,swell,0);
  `);
  for (const seed of [0, 1847, 65535]) {
    const swell = swellUniform(seed, [6, 2]);
    for (let time = 0; time < 70; time += 0.73) {
      for (const along of [-170, -3, 0, 90, 180]) {
        for (const inland of [-0.5, 0, 0.2, 0.8, 1.4, 2, 3, 4]) {
          const state = swashState(along, inland, time, swell);
          const expected = [state.film, state.foam, state.wet, state.depth];
          const actual = shader(swell, along, inland, time);
          assert.deepEqual(wgShader(swell, along, inland, time), actual);
          actual.forEach((v, i) => assert.ok(Math.abs(v - expected[i]) < 0.0004, `${seed}/${time}/${along}/${inland}: ${i} ${v} != ${expected[i]}`));
        }
      }
    }
  }
});

test("moisture persists on periodically exposed sand and film/depth remain bounded", () => {
  const swell = swellUniform(1847, [0, 0]);
  let dryFrames = 0;
  for (let t = 0; t < 80; t += 0.03) {
    const state = swashState(0, 0.2, t, swell);
    assert.ok(Object.values(state).every(Number.isFinite));
    assert.ok(state.film >= 0 && state.film <= 1 && state.wet >= state.film && state.wet <= 1);
    if (state.film === 0) { dryFrames++; assert.ok(state.wet > 0.45); }
  }
  assert.ok(dryFrames > 100);
  assert.equal(swashState(0, 10, 0, swell).wet, 0);
  assert.ok(Object.values(swashState(0, 0.2, 0, [0, 0, 0, 0.28])).every(Number.isFinite));
});

test("wake rejects invalid events, rewinds history and returns one empty upload", () => {
  const wake = createWake();
  wake.tick(5);
  wake.move(0, 0, 0, 0.8, -2, 1, -0.1);
  wake.ring(0, 0, 1);
  wake.ring(NaN, 0, 1);
  wake.ring(0, 0, -1);
  wake.paw(9, 0, 0, 1);
  const data = wake.pack();
  assert.ok([...data].every(Number.isFinite));
  assert.equal(data[4], 0);
  assert.ok(data[6] > 0);
  assert.equal(data[11], 1);
  wake.tick(1);
  assert.equal(wake.body.immersion, 0);
  assert.ok([...wake.pack()].every((x) => x === 0));
  assert.equal(wake.pack(), null);
});

test("wake disk contains every visible Gaussian packet and follows old trail", () => {
  const wake = createWake();
  for (let i = 0; i < 24; i++) {
    wake.tick(i * 0.15);
    wake.move(i * 0.6, 0, 0, 0.8, 2, 1, 0.1);
  }
  wake.ring(3, 4, 1.5);
  wake.paw(0, 14, 0.3, 0.2);
  const data = wake.pack();
  const [cx, cz, bound] = data.slice(8, 11);
  for (let i = 0; i < data[7]; i++) {
    const [x, z, birth] = data.slice((3 + i) * 4, (4 + i) * 4);
    const age = wake.now - birth;
    const radius = Math.max(3 * (0.1 * (1 + age * 0.5) + 0.03), 0.1 + age * 0.32 + 3 * (0.08 + age * 0.09));
    assert.ok(Math.hypot(x - cx, z - cz) + radius <= bound + 1e-5);
  }
  assert.ok(cx < 13.8 && cx > 0);
  assert.ok(bound < 12); // old body-centred disk covered nearly the full track.
  assert.equal(data.length, WAKE.width * 4);
});

test("weather changes preserve wavevectors and phase and relax amplitudes", () => {
  const waves = createWaveModes(1847);
  const initial = waves.update(0, [4, 0]).slice();
  const turned = waves.update(0, [-15, 10]).slice();
  assert.deepEqual(turned, initial);
  let change = 0;
  for (let frame = 1; frame <= 120; frame++) waves.update(frame / 60, [-15, 10]);
  const final = waves.data;
  for (let i = 0; i < 128; i++) {
    const o = i * 4;
    assert.equal(initial[o], final[o]);
    assert.equal(initial[o + 1], final[o + 1]);
    assert.ok(final[o + 2] >= 0 && Number.isFinite(final[o + 3]));
    change += Math.abs(initial[o + 2] - final[o + 2]);
  }
  assert.ok(change > 0.01);
  const resumed = final.slice();
  waves.update(10000, [0, 0]);
  for (let i = 0; i < 128; i++) assert.ok(Math.abs(waves.data[i * 4 + 2] - resumed[i * 4 + 2]) < 0.01);
});
