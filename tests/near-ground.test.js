import test from "node:test";
import assert from "node:assert/strict";
import { NEAR_GROUND, NEAR_KIND, nearCell, nearGroundInstances, clumpGeometry } from "../src/near-ground.js";
import { groundHeight, islandPoint } from "../src/terrain.js";

// A ground whose masks are set by hand: grass everywhere, or bare sand.
const field = (masks) => ({ sample: () => ({ grass: 0, litter: 0, rocky: 0, scrub: 0, sourfig: 0, shade: 0.2, moss: 0, tufted: 0, tint: null, ...masks }) });

test("near-ground carpet stays within its triangle budget on both quality levels", () => {
  // Worst case: every slot of both windows grows (packing draws live clumps only).
  const desktop = nearGroundInstances(false).reduce((a, b) => a + b, 0) * clumpGeometry(4).index.count / 3;
  const light = nearGroundInstances(true).reduce((a, b) => a + b, 0) * clumpGeometry(3).index.count / 3;
  assert.ok(desktop <= 80000, `desktop worst case ${desktop}`);
  assert.ok(light <= 30000, `phone worst case ${light}`);
  assert.ok(light < desktop / 2);
  // The dense window sits inside the coarse one, which ends where the
  // painted cover takes over (~9 m from the eye).
  for (const [inner, outer] of [NEAR_GROUND.desktop, NEAR_GROUND.light]) {
    assert.ok(inner.cell < outer.cell && inner.radius < outer.radius && outer.radius <= 8);
  }
});

test("near-ground cells are deterministic, grounded and follow the ground's masks", () => {
  const inland = islandPoint(-2.2, 18);
  const ix = Math.floor(inland.x / 0.15), iz = Math.floor(inland.z / 0.15);
  const grassy = field({ grass: 1 });
  let grown = 0;
  for (let i = 0; i < 400; i++) {
    const a = nearCell(grassy, ix + (i % 20), iz + Math.floor(i / 20), 0.15, 0);
    const b = nearCell(grassy, ix + (i % 20), iz + Math.floor(i / 20), 0.15, 0);
    assert.deepEqual({ ...a, colour: a.colour?.getHex() }, { ...b, colour: b.colour?.getHex() });
    if (a.kind === NEAR_KIND.none) continue;
    grown++;
    assert.equal(a.kind, NEAR_KIND.grass);
    assert.equal(a.y, groundHeight(a.x, a.z));
    assert.ok(a.size > 0 && Number.isFinite(a.yaw));
  }
  assert.ok(grown > 300, "a closed sward fills its cells");
  // Bare ground and rock grow nothing; litter lies as fallen leaves with
  // shade herbs (sprigs) growing through it, both.
  const underCrown = { litter: 0, sprig: 0 };
  for (let i = 0; i < 200; i++) {
    assert.equal(nearCell(field({}), ix + i, iz, 0.15, 0).kind, NEAR_KIND.none);
    assert.equal(nearCell(field({ grass: 1, rocky: 1 }), ix + i, iz, 0.15, 0).kind, NEAR_KIND.none);
    const leaf = nearCell(field({ litter: 1, shade: 0.8 }), ix + i, iz, 0.15, 0).kind;
    assert.ok(leaf === NEAR_KIND.litter || leaf === NEAR_KIND.sprig || leaf === NEAR_KIND.none);
    if (leaf === NEAR_KIND.litter) underCrown.litter++;
    if (leaf === NEAR_KIND.sprig) underCrown.sprig++;
  }
  assert.ok(underCrown.litter > 30 && underCrown.sprig > 30, `litter and herbs under a crown (${underCrown.litter}, ${underCrown.sprig})`);
  // Nothing grows in the swash.
  const beach = islandPoint(1, 0.5);
  assert.equal(nearCell(grassy, Math.floor(beach.x / 0.15), Math.floor(beach.z / 0.15), 0.15, 0).kind, NEAR_KIND.none);
});
