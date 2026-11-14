// Probe: where the follow camera's velocity jumps on the movement test's
// routes (tests/movement.test.js), frame by frame.
import { island, walkerFor } from "../tests/interaction-harness.js";
import { islandPoint, ISLAND } from "../src/terrain.js";

const SEED = Number(process.argv[2] ?? 1847);
const HOME = Math.atan2(0 - ISLAND.z, 6 - ISLAND.x);
island(SEED);
const walker = walkerFor(SEED);
const { cat, camera } = walker;
const routes = [
  { from: islandPoint(HOME, 9), weave: 0.7 },
  { from: islandPoint(HOME + 0.25, 16), run: true, weave: 0.4 },
  { from: islandPoint(HOME + 0.8, 26), weave: 0.5 },
  { from: islandPoint(HOME - 0.6, 12), turn: Math.PI / 2, weave: 0.9 },
];
const dt = 1 / 60;
routes.forEach((r, ri) => {
  cat.x = r.from.x; cat.z = r.from.z; cat.y = walker.surface(cat.x, cat.z);
  cat.heading = Math.atan2(ISLAND.x - cat.x, ISLAND.z - cat.z) + (r.turn ?? 0);
  camera.yaw = cat.heading; camera.elevation = 0.38; camera.distance = 3.4; camera.targetY = cat.y;
  cat.speed = cat.vy = cat.air = 0;
  const input = { move: [0, 1], run: Boolean(r.run), jump: false };
  let p0 = null, p1 = null;
  for (let f = 0; f < 600; f++) {
    input.move[0] = Math.sin(f / 70) * r.weave;
    input.jump = f % 150 === 75;
    walker.update(dt, input, null);
    const p = [camera.x, camera.y, camera.z];
    if (p0 && p1) {
      const dv = Math.hypot(p[0] - 2 * p1[0] + p0[0], p[1] - 2 * p1[1] + p0[1], p[2] - 2 * p1[2] + p0[2]) / dt;
      if (dv > 0.6) console.log(`route ${ri} f ${f} dv ${dv.toFixed(2)} arm ${camera.arm.toFixed(3)} lift ${camera.lift.toFixed(2)} y ${camera.y.toFixed(2)} ground ${(camera.y - walker.surface(camera.x, camera.z)).toFixed(2)} dy ${((p[1] - 2 * p1[1] + p0[1]) / dt).toFixed(2)} cat.air ${cat.air.toFixed(2)}`);
    }
    p0 = p1; p1 = p;
  }
});
