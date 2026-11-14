import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { toneBlock, wgslToGlsl, customToneMapping, toneAdapt } from '../src/tone-glsl.js';

const wgsl = readFileSync(new URL('../src/shaders/tone.wgsl', import.meta.url), 'utf8');
const strip = (s) => s.replace(/\/\/.*$/gm, '');

test('the land layer tonemap is generated from the one WGSL curve', () => {
  const glsl = customToneMapping(wgsl);
  assert.match(glsl, /vec3 tone_curve\(vec3 hdr, float adapt\) \{/);
  assert.match(glsl, /const float TONE_GAIN = [\d.]+;/);
  assert.match(glsl, /return tone_curve\( color, toneMappingExposure - 1\.0 \);/);
  assert.doesNotMatch(strip(glsl), /\b(let|var|fn|select|f32|vec[234]f)\b|->/);
  // Every statement survives: same count of semicolons, same numbers in order.
  const block = strip(toneBlock(wgsl));
  const out = strip(wgslToGlsl(toneBlock(wgsl)));
  assert.equal(out.split(';').length, block.split(';').length);
  const numbers = (s) => s.match(/\d+\.\d+(e-?\d+)?|\de-?\d+/g);
  assert.deepEqual(numbers(out), numbers(block));
});

test('the shared block keeps to the subset both languages accept', () => {
  const block = strip(toneBlock(wgsl));
  assert.doesNotMatch(block, /\bselect\(/);
  // Untyped let/var would need inference the translation does not do.
  assert.doesNotMatch(block, /\b(let|var) \w+ =/);
  // Bare integer literals are ints in GLSL (vec3(0) is fine, max(x, 0) is not).
  const bare = block.replace(/\d+(\.\d+)?e-?\d+/g, 'F');
  assert.doesNotMatch(bare, /(?<![\w.])\d+(?![\d.\w])/);
  assert.throws(() => wgslToGlsl('let x = select(a, b, c);'), /untranslated/);
});

test('toneAdapt is the JS twin of tone_adapt in tone.wgsl', () => {
  const fn = wgsl.match(/fn tone_adapt\(([^)]*)\) -> f32 \{([\s\S]*?)\n\}/);
  assert.ok(fn, 'tone_adapt exists');
  const params = fn[1].split(',').map((p) => p.split(':')[0].trim());
  const body = fn[2]
    .replace(/\/\/.*$/gm, '')
    .replace(/\blet (\w+): f32 =/g, 'const $1 =');
  const helpers = 'const clamp = (x, a, b) => Math.min(b, Math.max(a, x));'
    + 'const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };'
    + 'const mix = (a, b, t) => a + (b - a) * t; const max = Math.max, min = Math.min;';
  const gpu = new Function(...params, helpers + body);
  for (let i = 0; i <= 10; i++) for (let j = 0; j <= 10; j++) {
    const args = [i / 10, j / 10].slice(0, params.length);
    assert.ok(Math.abs(gpu(...args) - toneAdapt(...args)) < 1e-6, `tone_adapt(${args})`);
  }
});
