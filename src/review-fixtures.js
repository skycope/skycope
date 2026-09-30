import { ISLAND, islandPoint } from "./terrain.js";

const HOME = Math.atan2(-ISLAND.z, 6 - ISLAND.x);
const OUT = Math.atan2(Math.cos(HOME), Math.sin(HOME));

// Opt-in development permalinks make before/after captures use the same
// world, date, lens and subject. Ordinary visitor navigation is unchanged.
export function reviewFixture(search) {
  const params = new URLSearchParams(search);
  if (!params.has("perf")) return null;
  const name = params.get("review");
  const scenes = {
    "home-noon": { minutes: 750, home: true },
    "inland-noon": { minutes: 750, inland: 12, yaw: OUT + Math.PI, elevation: 0.27, distance: 4 },
    "forest-overcast": { minutes: 750, inland: 22, yaw: OUT + Math.PI + 0.5, elevation: 0.3, distance: 4 },
    "cat-close": { minutes: 750, inland: 3, yaw: OUT + Math.PI / 2 + 1.2, heading: OUT + Math.PI / 2, elevation: 0.12, distance: 1.25 },
    "cat-evening": { minutes: 1090, inland: 3, yaw: OUT + Math.PI / 2 + 1.2, heading: OUT + Math.PI / 2, elevation: 0.12, distance: 1.25 },
    "rain-home": { minutes: 750, home: true },
    "sea-noon": { minutes: 750, inland: 2, yaw: OUT, elevation: 0.25, distance: 3.4 },
    "splash-run": { minutes: 750, inland: 1, yaw: OUT, heading: OUT, elevation: 0.3, distance: 3.4, run: true },
  };
  if (!scenes[name]) return null;
  return { name, date: new Date("2026-09-30T12:00:00Z"), ...scenes[name] };
}

export function applyReviewFixture(walker, fixture, obstacles) {
  if (!fixture || fixture.home) return;
  const cat = walker.cat, camera = walker.camera;
  const point = islandPoint(HOME, fixture.inland);
  const clear = clearPoint(point, obstacles.trunks);
  cat.x = clear.x; cat.z = clear.z; cat.y = walker.surface(clear.x, clear.z);
  cat.heading = fixture.heading ?? fixture.yaw;
  cat.speed = 0; cat.sit = 0; cat.idle = 0;
  camera.yaw = fixture.yaw;
  camera.elevation = fixture.elevation;
  camera.distance = fixture.distance;
  camera.targetY = cat.y;
  // Settle the spring arm before the first visible frame without a camera
  // jump or modifying the production collision/follow implementation.
  for (let i = 0; i < 40; i++) walker.update(0.05, { move: [0, 0], run: false, jump: false });
}

function clearPoint(point, trunks) {
  for (let i = 0; i < 24; i++) {
    const r = Math.floor(i / 6) * 0.35, a = i * 2.39996;
    const x = point.x + Math.cos(a) * r, z = point.z + Math.sin(a) * r;
    if (trunks.every(t => Math.hypot(x - t.x, z - t.z) > t.r + 0.55)) return { x, z };
  }
  return point;
}
