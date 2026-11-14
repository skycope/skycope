// Probe: the camera's state frame by frame on one movement-test route.
//   node scripts/probe-camera2.mjs <route> <fromFrame> <toFrame>
import { island, walkerFor } from "../tests/interaction-harness.js";
import { islandPoint, ISLAND } from "../src/terrain.js";

const [route, from, to] = process.argv.slice(2).map(Number);
const SEED = 1847;
const HOME = Math.atan2(0 - ISLAND.z, 6 - ISLAND.x);
const { obstacles } = island(SEED);
const walker = walkerFor(SEED);
const { cat, camera, solids } = walker;
const routes = [
  { from: islandPoint(HOME, 9), weave: 0.7 },
  { from: islandPoint(HOME + 0.25, 16), run: true, weave: 0.4 },
  { from: islandPoint(HOME + 0.8, 26), weave: 0.5 },
  { from: islandPoint(HOME - 0.6, 12), turn: Math.PI / 2, weave: 0.9 },
];
const dt = 1 / 60;
for (let ri = 0; ri <= route; ri++) {
const r = routes[ri];
cat.x = r.from.x; cat.z = r.from.z; cat.y = walker.surface(cat.x, cat.z);
cat.heading = Math.atan2(ISLAND.x - cat.x, ISLAND.z - cat.z) + (r.turn ?? 0);
camera.yaw = cat.heading; camera.elevation = 0.38; camera.distance = 3.4; camera.targetY = cat.y;
cat.speed = cat.vy = cat.air = 0;
const input = { move: [0, 1], run: Boolean(r.run), jump: false };
for (let f = 0; f <= (ri === route ? to : 599); f++) {
  input.move[0] = Math.sin(f / 70) * r.weave;
  input.jump = f % 150 === 75;
  walker.update(dt, input, null);
  if (ri === route && f >= from) {
    let tr = Infinity;
    for (const t of obstacles.trunks) tr = Math.min(tr, Math.hypot(camera.x - t.x, camera.z - t.z) - t.r);
    const solid = solids.distance(camera.x, camera.y, camera.z, 1);
    console.log(f, [camera.x, camera.y, camera.z].map((v) => v.toFixed(3)).join(" "), "cat", [cat.x, cat.y, cat.z].map((v) => v.toFixed(2)).join(" "), "arm", camera.arm.toFixed(3), "yaw", camera.yaw.toFixed(3), "trunk", tr.toFixed(2), "solid", solid.toFixed(2), solids.hit.prim?.k ?? "", "gnd", (camera.y - walker.surface(camera.x, camera.z)).toFixed(2));
  }
}
}
