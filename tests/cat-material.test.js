import test from 'node:test';
import assert from 'node:assert/strict';
import { furFlow, EYE_RADIUS, eyeCentre, buildCatGeometry, LOFT } from '../src/cat-body.js';
import { createRig } from '../src/cat-rig.js';
import { pupilResponse } from '../src/cat.js';

test('anatomical fur flow remains unit and tangent across region joins and poles', () => {
  for (let k = 0; k <= 50; k++) {
    const t = k / 50;
    for (const n of [[1, 0, 0], [0, 1, 0], [0, 0, 1]]) {
      const flow = furFlow([.025, .04, .12 + .08 * t], n, [t, 0, 0, 0], [0, -.3, -1]);
      assert.ok(flow.every(Number.isFinite));
      assert.ok(Math.abs(Math.hypot(...flow) - 1) < 1e-6);
      assert.ok(Math.abs(flow.reduce((v, c, i) => v + c * n[i], 0)) < 1e-6);
    }
  }
  const tail = furFlow([0, .02, -.3], [1, 0, 0], [0, 0, 1, 0], [0, 0, -1]);
  assert.deepEqual(tail, [0, 0, -1]);
  const cheek = furFlow([.035, .05, .22], [0, 0, 1], [1, 0, 0, 0], [1, -.3, -.5]);
  assert.ok(cheek[0] > 0, 'cheek hair fans away from nose');
});

test('pupils adapt continuously to both cloud shade and night', () => {
  const clear = { night: 0, direct: 1 };
  const dark = { night: 1, direct: 0 };
  assert.equal(pupilResponse(.12, dark, 0), .12);
  const one = pupilResponse(.12, dark, .2);
  const two = pupilResponse(pupilResponse(.12, dark, .1), dark, .1);
  assert.ok(Math.abs(one - two) < 1e-12, 'frame subdivision does not change response');
  assert.ok(one > .12 && one < .66);
  assert.ok(pupilResponse(.12, {night:0, direct:.1}, .2) > .12);
  assert.ok(pupilResponse(.66, clear, 1) < .2);
});

test('eyes sit inside the facial envelope and body flow is tangent at both LODs', () => {
  // Head frame: the muzzle's skin front is at z 0.0468 (before its coat);
  // the cranium's front is at 0.034 plus its coat (0.6 × LOFT).
  const front = eyeCentre(1)[2] + EYE_RADIUS;
  assert.ok(front < .0468, 'globe is recessed behind muzzle front');
  assert.ok(front > .034 + .6 * LOFT, 'globe stands clear of the coat round it, not in a pit');
  assert.equal(eyeCentre(1)[0], -eyeCentre(-1)[0]);
  const lods = buildCatGeometry(createRig());
  for (const [name, g] of Object.entries(lods)) {
    const { coat, comb, normal } = g.attributes;
    for (let i = 0; i < coat.count; i++) {
      if (coat.getW(i) !== 0) continue;
      const d = comb.getX(i) * normal.getX(i) + comb.getY(i) * normal.getY(i) + comb.getZ(i) * normal.getZ(i);
      const length = Math.hypot(comb.getX(i), comb.getY(i), comb.getZ(i));
      assert.ok(Math.abs(d) < 1e-5, `${name}: tangent flow`);
      assert.ok(Math.abs(length - 1) < 1e-5, `${name}: unit flow`);
    }
    g.dispose();
  }
});
