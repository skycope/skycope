import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { MATERIAL_LINEAR, srgbToLinear } from '../src/material-palette.js';
import { tintOf, landFieldLevels, LAND_FIELD } from '../src/land-field.js';
import { skyDomeMean, skyEnvironmentKey } from '../src/sunlight.js';

test('material reflectances use exact sRGB decoding and retain identity', () => {
  const sand = MATERIAL_LINEAR.sand;
  [0.539479, 0.423268, 0.262251].forEach((expected, c) => assert.ok(Math.abs(sand[c] - expected) < 1e-5));
  assert.equal(srgbToLinear(0), 0);
  assert.equal(srgbToLinear(1), 1);
  assert.ok(MATERIAL_LINEAR.moss[1] > MATERIAL_LINEAR.moss[0]);
  assert.ok(MATERIAL_LINEAR.litter[0] > MATERIAL_LINEAR.litter[1]);
  assert.ok(MATERIAL_LINEAR.wetSand.every((v, c) => v < sand[c]));
});

test('reflection tint mips average reconstructed energy rather than material labels', () => {
  const data = new Float32Array(LAND_FIELD.size ** 2 * 4);
  // Equal coverage of a bright sandy patch and a darker green patch.
  const colors = [MATERIAL_LINEAR.sand, MATERIAL_LINEAR.moss];
  const samples = colors.map(tintOf);
  for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
    const k = (j * LAND_FIELD.size + i) * 4;
    const [t, l] = samples[i];
    data[k] = 2 + i; data[k + 1] = t; data[k + 2] = l;
  }
  const level = landFieldLevels(data, 1)[0];
  assert.equal(level[0], 3, 'max height remains conservative');
  const expectedLuma = (samples[0][1] + samples[1][1]) / 2;
  const expectedTint = (samples[0][0] * samples[0][1] + samples[1][0] * samples[1][1]) / (2 * expectedLuma);
  assert.ok(Math.abs(level[2] - expectedLuma) < 1e-7);
  assert.ok(Math.abs(level[1] - expectedTint) < 1e-7);
});

test('sky integral applies both cosine and spherical solid angle', () => {
  const width = 64;
  const dome = new Float32Array(width * width / 4 * 3);
  for (let j = 0; j < width / 4; j++) {
    const up = Math.sin((j + 0.5) * Math.PI / (width / 2));
    for (let i = 0; i < width; i++) dome.set([1, up, up * up], (j * width + i) * 3);
  }
  const mean = skyDomeMean(dome, width);
  [1, 2 / 3, 1 / 2].forEach((expected, c) => assert.ok(Math.abs(mean[c] - expected) < .002));
  assert.deepEqual(skyDomeMean(dome, width, 1), [1, 1, 1]);
});

test('environment identity responds to sky and bounce changes', () => {
  const key = skyEnvironmentKey('sun', 0, [.1, .2, .3], [.01, .02, .03]);
  assert.notEqual(key, skyEnvironmentKey('sun', 0, [.1, .25, .3], [.01, .02, .03]));
  assert.notEqual(key, skyEnvironmentKey('sun', 0, [.1, .2, .3], [.02, .02, .03]));
  const mesh = readFileSync(new URL('../src/landscape.js', import.meta.url), 'utf8');
  assert.ok(mesh.includes('skyEnvironmentKey(domeKey, uniform, skyUnit, bounceUnit)'));
  assert.ok(!mesh.includes('`${previousLighting}:${domeKey}'));
});

test('mesh and atmosphere share display calibration constants', () => {
  const mesh = readFileSync(new URL('../src/landscape.js', import.meta.url), 'utf8');
  const atmosphere = readFileSync(new URL('../src/shaders/atmosphere.wgsl', import.meta.url), 'utf8');
  const gain = Number(atmosphere.match(/TONE_GAIN: f32 = ([\d.]+)/)[1]);
  const vibrance = Number(atmosphere.match(/VIBRANCE: f32 = ([\d.]+)/)[1]);
  assert.equal(Number(mesh.match(/color \* ([\d.]+)/)[1]), gain);
  assert.equal(Number(mesh.match(/#define VIBRANCE ([\d.]+)/)[1]), vibrance);
});

test('CPU and WGSL atmosphere use identical optical units and coefficients', () => {
  const cpu = readFileSync(new URL('../src/sunlight.js', import.meta.url), 'utf8');
  const gpu = readFileSync(new URL('../src/shaders/atmosphere.wgsl', import.meta.url), 'utf8');
  for (const name of ['EARTH_RADIUS', 'ATMOSPHERE_RADIUS', 'RAYLEIGH_HEIGHT', 'MIE_HEIGHT', 'SUN_INTENSITY', 'VIEW_HEIGHT']) {
    const cpuValue = Number(cpu.match(new RegExp(`const ${name} = ([\\deE.+-]+)`))[1]);
    const gpuValue = Number(gpu.match(new RegExp(`const ${name}: f32 = ([\\deE.+-]+)`))[1]);
    assert.equal(cpuValue, gpuValue, name);
  }
  for (const name of ['RAYLEIGH', 'MIE', 'OZONE']) {
    const cpuValues = cpu.match(new RegExp(`const ${name} = \\[([^\\]]+)\\]`))[1].split(',').map(Number);
    const gpuValues = gpu.match(new RegExp(`const ${name}: vec3f = vec3f\\(([^)]+)\\)`))[1].split(',').map(Number);
    assert.deepEqual(cpuValues, gpuValues, name);
  }
});
