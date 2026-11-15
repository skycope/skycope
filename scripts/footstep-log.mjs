// Footstep QA in the live site (one headless Chrome, closed at the end):
// logs every footstep main.js asks for — which paw, when, at what speed,
// the walker's kind, what is under the paw and the surface the sound side
// resolves — while the cat walks, trots and runs inland from the swash on
// seed 1847, and then the surface on every made tile of every place.
//   node scripts/footstep-log.mjs <vite port> <cdp port> <out.json>
import { writeFileSync } from "node:fs";
import { openPage } from "./qa-cdp.mjs";

const [port = 5352, cdp = 9422, out = "docs/review/sound/footsteps/timing.json"] = process.argv.slice(2);
const page = await openPage({ port: +port, cdp: +cdp, query: "seed=1847&weather=clear" });
const key = async (type, k, code = k) => page.send("Input.dispatchKeyEvent", { type, key: k, code, windowsVirtualKeyCode: k === "Shift" ? 16 : k.toUpperCase().charCodeAt(0) });
try {
  await page.evaluate(`(async () => {
    const T = await import('/src/terrain.js');
    const { SURFACE_NAMES } = await import('/src/sound/patches.js');
    const sk = window.skycope, s = sk.sound, w = sk.walker;
    window.__log = [];
    const orig = s.step.bind(s);
    s.step = (kind, running, pan, info = {}) => {
      const res = info.exact ? kind : s.surfaceFor(kind, info);
      window.__log.push({ t: Math.round(performance.now()), leg: (info.front === false ? 'hind' : 'fore') + (pan < 0 ? 'L' : 'R'), speed: +w.cat.speed.toFixed(2), running, kind, under: info.under?.on ?? null, surface: SURFACE_NAMES[res], why: s.lastSurface?.why ?? null, inland: +T.shoreDistance(info.x ?? w.cat.x, info.z ?? w.cat.z).toFixed(2) });
      return orig(kind, running, pan, info);
    };
    // Stand in the swash facing inland.
    const c = w.cat;
    const dx = c.x - T.ISLAND.x, dz = c.z - T.ISLAND.z, r = Math.hypot(dx, dz);
    const start = T.islandPoint(Math.atan2(dz, dx), 0.4);
    c.x = start.x; c.z = start.z; c.vx = c.vz = 0;
    w.camera.yaw = Math.atan2(-dx / r, -dz / r);
    c.heading = w.camera.yaw;
    return true;
  })()`);
  await page.sleep(1500);
  const phase = async (name, ms, keys) => {
    await page.evaluate(`window.__phase = ${JSON.stringify(name)}; window.__log.push({ phase: ${JSON.stringify(name)}, t: Math.round(performance.now()) })`);
    for (const k of keys) await key("keyDown", k);
    await page.sleep(ms);
    for (const k of keys) await key("keyUp", k);
  };
  await phase("walk inland", 6000, ["w"]);
  await phase("stand", 1500, []);
  await phase("run inland", 3500, ["Shift", "w"]);
  await phase("stand", 1500, []);
  await phase("turn on the spot", 1500, ["a"]);
  const log = await page.evaluate("window.__log");
  // Every made tile of every place: what the sound side calls it.
  const tiles = await page.evaluate(`(async () => {
    const { SURFACE_NAMES } = await import('/src/sound/patches.js');
    const sk = window.skycope, s = sk.sound, w = sk.walker;
    const pois = sk.landscape.pois;
    const out = [];
    for (const d of sk.landscape.obstacles.domes) {
      if (!d.gradient) continue;
      const under = w.surfaceAt(d.x, d.z);
      const near = pois.reduce((b, p) => (!b || Math.hypot(p.x - d.x, p.z - d.z) < Math.hypot(b.x - d.x, b.z - d.z) ? p : b), null);
      out.push({ place: near?.id, x: +d.x.toFixed(1), z: +d.z.toFixed(1), under: under.on, surface: SURFACE_NAMES[s.surfaceFor(0, { x: d.x, z: d.z, under })], why: s.lastSurface?.why });
    }
    // And the named spots (prop contract affordances): the stoep, sills,
    // the door, the boiler, the hull, the cairn's top step, the fork.
    for (const a of sk.landscape.soundWorld?.places?.affordances ?? []) {
      const under = w.surfaceAt(a.x, a.z);
      out.push({ place: a.place, spot: a.id, x: +a.x.toFixed(1), z: +a.z.toFixed(1), under: under.on, surface: SURFACE_NAMES[s.surfaceFor(under.on === 'ground' ? 2 : 0, { x: a.x, z: a.z, under })], why: s.lastSurface?.why });
    }
    return out;
  })()`);
  writeFileSync(out, JSON.stringify({ log, tiles, errors: page.errors }, null, 1));
  console.log(`${log.filter((e) => !e.phase).length} steps, ${tiles.length} tiles → ${out}`);
} finally {
  await page.close();
}
