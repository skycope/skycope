// Triangle and draw-call counts per landmark, near and far level, built in
// node exactly as places.js builds them (GPU-free, so they hold while other
// agents share the GPU). Also the stones each place adds to the rock layer.
//   node scripts/place-counts.mjs [seed=1847] [--light]
import * as THREE from "three";
import { placesLayout } from "../src/place-layout.js";
import { createMaterials } from "../src/place-kit.js";
import { BUILDERS } from "../src/places.js";
import { placeRocks } from "../src/place-rocks.js";
import { rockLayout } from "../src/rocks.js";
import { seededRandom } from "../src/random.js";

const seed = Number(process.argv[2] ?? 1847);
const light = process.argv.includes("--light");
const materials = createMaterials({});
function count(root) {
  let triangles = 0, draws = 0;
  root?.traverse((o) => {
    if (!o.isMesh || !o.visible) return;
    const g = o.geometry;
    const per = (g.index ? g.index.count : g.attributes.position.count) / 3;
    const n = o.isInstancedMesh ? o.count : g.isInstancedBufferGeometry ? g.instanceCount : 1;
    triangles += per * n;
    draws++;
  });
  return { triangles: Math.round(triangles), draws };
}
const original = rockLayout(seededRandom(seed));
const added = placeRocks(seed, original).filter((r) => !original.includes(r));
const rows = [];
for (const p of placesLayout(seed)) {
  const build = BUILDERS[p.kind];
  const b = build(p, materials, { light, seed });
  const near = count(b.lod.near), far = count(b.lod.far);
  const extra = count(b.extra);
  const stones = added.filter((r) => Math.hypot(r.position.x - p.x, r.position.z - p.z) < 8).length;
  rows.push({ place: p.id, nearTris: near.triangles + extra.triangles, nearDraws: near.draws + extra.draws, farTris: far.triangles, farDraws: far.draws, stones });
}
console.table(rows);
console.log(JSON.stringify(rows));
