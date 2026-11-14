// Scripted walk QA (thread D: movement, camera, vegetation). Drives the cat
// through foliage, up slopes, into the lighthouse yard, the rock-pool
// basin, under the milkwood, over boulders, through jumps and aboard the
// boat, in headless Chrome, sampling every walker frame; saves a frame
// strip per case and the counts that matter:
//   hitches  frames over 2× the median frame interval
//   steps    frames where the camera's velocity jumps (a stepped camera)
//   solid / low / trunk   frames with the lens inside a landmark or body,
//            under 20 cm off the ground, or inside a trunk
//   stuck    frames the cat was asked to move and did not
// Then plays each ceremony from three approaches and saves its last wide
// frame.
//   node scripts/walk-qa.mjs <outDir> <label> [port=5332] [cdp=9402] [only=a,b]
import { mkdir, writeFile } from "node:fs/promises";
import { openPage } from "./qa-cdp.mjs";
import { ISLAND, islandPoint } from "../src/terrain.js";

const out = process.argv[2] ?? "docs/review/movement";
const label = process.argv[3] ?? "run";
const port = Number(process.argv[4] ?? 5332);
const cdp = Number(process.argv[5] ?? 9402);
const only = process.argv[6]?.split(",");
await mkdir(out, { recursive: true });

const HOME = Math.atan2(0 - ISLAND.z, 6 - ISLAND.x);
const outward = (t) => Math.atan2(Math.cos(t), Math.sin(t));
const inward = (t) => outward(t) + Math.PI;
const along = (t) => outward(t) + Math.PI / 2;
const at = (t, inland) => islandPoint(t, inland);
const POIS = {
  lighthouse: { x: 123.19, z: 58.92, facing: 1.74, r: 10 },
  beacon: { x: 62, z: 86, r: 6 },
  milkwood: { x: 27.1, z: 73.9, facing: 3.18, r: 11 },
  wreck: { x: -9.43, z: 43.79, r: 10 },
  boat: { x: 76.7, z: 40.58, r: 6 },
  pool: { x: 63.97, z: 126.82, facing: 0.8, r: 4.5 },
};
const off = (p, a, d) => ({ x: p.x + Math.sin(a) * d, z: p.z + Math.cos(a) * d });
const toward = (from, to) => Math.atan2(to.x - from.x, to.z - from.z);

// Each case: where (x, z), heading, camera { el, dist, yaw (default behind) },
// a programme of [keys, ms, { jump: [ms…], orbit: rad/s }] segments.
const CASES = [];
const add = (name, o) => CASES.push({ el: 0.38, dist: 3.4, ...o, name });
add("foliage-walk", { pos: at(HOME, 9), heading: inward(HOME), prog: [[["w"], 1500], [["w", "a"], 900], [["w", "d"], 1200], [["w"], 1400]] });
add("forest-run", { pos: at(HOME + 0.25, 16), heading: inward(HOME + 0.25), prog: [[["w", "shift"], 2600], [["w"], 1400]] });
add("slope-up", { pos: at(HOME + 0.8, 26), heading: inward(HOME + 0.8), prog: [[["w"], 2500], [["w", "shift"], 2000]] });
add("slope-across", { pos: at(HOME + 0.8, 36), heading: along(HOME + 0.8), el: 0.25, prog: [[["w"], 2500], [["w", "a"], 1500]] });
{
  const y = off(POIS.lighthouse, POIS.lighthouse.facing, 5);
  add("lighthouse-yard", { pos: y, heading: POIS.lighthouse.facing + Math.PI / 2, prog: [[["w"], 2000], [["w", "d"], 1500], [["w"], 1500]] });
}
{
  const p = off(POIS.pool, POIS.pool.facing + Math.PI, 1.5);
  add("pool-basin", { pos: p, heading: POIS.pool.facing, el: 0.45, prog: [[["w"], 1500], [["w"], 800, { jump: [100] }], [["w", "a"], 1500], [[], 800]] });
}
{
  const p = off(POIS.milkwood, POIS.milkwood.facing, 7);
  add("milkwood-under", { pos: p, heading: toward(p, POIS.milkwood), prog: [[["w"], 2500], [["w", "d"], 2000], [["w"], 1500]] });
}
add("jumps-beach", { pos: at(HOME, 3), heading: along(HOME), prog: [[["w", "shift"], 3000, { jump: [400, 1400, 2400] }], [["w"], 800]] });
add("orbit-forest", { pos: at(HOME + 0.25, 20), heading: inward(HOME + 0.25), prog: [[[], 4000, { orbit: Math.PI / 2 }], [[], 1500, { orbit: 0, el: -0.2 }]] });
add("boulder-hop", { boulder: true, prog: [[["w"], 2500], [["w"], 1500, { jump: [200] }], [["w", "d"], 1500]] });
add("aboard", { query: "seed=1847&magic=boat", boat: true, prog: [[[], 2500, { jump: [300] }], [["w"], 3000], [["w", "a"], 2500], [[], 1500, { orbit: 1.2 }]] });

// Ceremonies: approach each keepsake from three sides.
const CEREMONIES = [];
for (const [id, p] of Object.entries(POIS)) for (const a of [0, 2.1, 4.2]) CEREMONIES.push({ id, p, approach: a });

const pages = new Map();
async function pageFor(query = "seed=1847") {
  if (!pages.has(query)) {
    for (const [, p] of pages) await p.close();
    pages.clear();
    const page = await openPage({ port, cdp, query });
    await install(page);
    // The walk cases are about movement: no ceremony takes the camera.
    if (!query.includes("ceremony")) await page.evaluate("(() => { const q = skycope.thread.journey.quest; if (q) q.update = () => null; })()");
    pages.set(query, page);
  }
  return pages.get(query);
}

async function install(page) {
  await page.evaluate(`(() => {
    const s = skycope, w = s.walker;
    const qa = window.qa = { rec: null, raf: [], last: 0 };
    const trunks = s.landscape.obstacles.trunks;
    const u = w.update;
    w.update = function (dt, input, interest, cameraDt = dt) {
      const r = u.call(this, dt, input, interest, cameraDt);
      if (qa.rec) {
        const c = w.cat, k = w.camera;
        let trunk = Infinity;
        for (const t of trunks) {
          const dx = k.x - t.x, dz = k.z - t.z;
          if (Math.abs(dx) > 3 || Math.abs(dz) > 3) continue;
          const crown = w.surface(t.x, t.z) + 0.4 * Math.max(1.5, (t.r - 0.02) / 0.034);
          if (k.y < crown) trunk = Math.min(trunk, Math.hypot(dx, dz) - t.r);
        }
        qa.rec.push({
          t: performance.now(), dt: cameraDt, moving: Boolean(input.move[0] || input.move[1]),
          cx: c.x, cy: c.y, cz: c.z, air: c.air,
          x: k.x, y: k.y, z: k.z, yaw: k.yaw, arm: k.arm,
          solid: Math.min(99, w.solids.distance(k.x, k.y, k.z, 1)),
          ground: k.y - w.surface(k.x, k.z),
          trunk: Math.min(99, trunk),
        });
      }
      return r;
    };
    const tick = (t) => { if (qa.last) qa.raf.push(t - qa.last); qa.last = t; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    document.querySelector('#time').value = 760;
    document.querySelector('#time').dispatchEvent(new Event('input'));
  })()`);
}

const SHOT = 0.5;
async function shot(page) {
  const r = await page.send("Page.captureScreenshot", { format: "jpeg", quality: 80, clip: { x: 0, y: 0, width: 1280, height: 800, scale: SHOT } });
  return r.result.data;
}
async function strip(page, frames, path) {
  const data = await page.evaluate(`(async () => {
    const frames = ${JSON.stringify(frames)};
    const imgs = await Promise.all(frames.map((f) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = 'data:image/jpeg;base64,' + f; })));
    const w = imgs[0].width, h = imgs[0].height;
    const c = document.createElement('canvas'); c.width = w * imgs.length + 4 * (imgs.length - 1); c.height = h;
    const g = c.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height);
    imgs.forEach((i, k) => g.drawImage(i, k * (w + 4), 0));
    return c.toDataURL('image/jpeg', 0.8).split(',')[1];
  })()`);
  await writeFile(path, Buffer.from(data, "base64"));
}

function analyse(rec, raf) {
  const sorted = [...raf].sort((a, b) => a - b);
  const median = sorted[sorted.length >> 1] ?? 16.7;
  const hitches = raf.filter((d) => d > 2 * median).length;
  let steps = 0, maxAccel = 0, stuck = 0, solid = 0, low = 0, trunk = 0, minGround = Infinity, minSolid = Infinity;
  for (let i = 2; i < rec.length; i++) {
    const a = rec[i - 2], b = rec[i - 1], c = rec[i];
    if (!(b.dt > 0) || !(c.dt > 0)) continue;
    const v1 = [(b.x - a.x) / b.dt, (b.y - a.y) / b.dt, (b.z - a.z) / b.dt];
    const v2 = [(c.x - b.x) / c.dt, (c.y - b.y) / c.dt, (c.z - b.z) / c.dt];
    const accel = Math.hypot(v2[0] - v1[0], v2[1] - v1[1], v2[2] - v1[2]) / c.dt;
    maxAccel = Math.max(maxAccel, accel);
    // A step: the lens's velocity changes by more than 0.6 m/s in one frame.
    if (Math.hypot(v2[0] - v1[0], v2[1] - v1[1], v2[2] - v1[2]) > 0.6) steps++;
    if (c.moving && Math.hypot(c.cx - b.cx, c.cz - b.cz) < 1e-3 && c.air === 0) stuck++;
  }
  for (const s of rec) {
    if (s.solid < 0.05) solid++;
    if (s.ground < 0.2) low++;
    if (s.trunk < 0.1) trunk++;
    minGround = Math.min(minGround, s.ground);
    minSolid = Math.min(minSolid, s.solid);
  }
  return { frames: rec.length, medianMs: +median.toFixed(1), hitches, steps, maxAccel: +maxAccel.toFixed(1), stuck, solid, low, trunk, minGround: +minGround.toFixed(2), minSolid: +minSolid.toFixed(2) };
}

const metrics = {};
for (const c of CASES) {
  if (only && !only.some((o) => c.name.includes(o))) continue;
  const page = await pageFor(c.query);
  // Place the cat and the camera behind it.
  await page.evaluate(`(() => {
    const s = skycope, w = s.walker, cat = w.cat, cam = w.camera;
    s.keys.clear();
    let pos = ${JSON.stringify(c.pos ?? null)}, heading = ${c.heading ?? 0};
    if (${Boolean(c.boulder)}) {
      const d = s.landscape.obstacles.domes.filter((d) => !d.bridge && d.r > 0.9 && d.r < 2.2 && Math.hypot(d.x - ${ISLAND.x}, d.z - ${ISLAND.z}) < 55).sort((a, b) => a.x - b.x)[0];
      pos = { x: d.x - 4, z: d.z }; heading = Math.PI / 2;
    }
    if (${Boolean(c.boat)}) {
      const r = s.boat.ride; const m = r.moor;
      const a = (m.heading ?? 0) + Math.PI / 2;
      pos = { x: m.x + Math.sin(a) * 1.5, z: m.z + Math.cos(a) * 1.5 }; heading = a + Math.PI;
    }
    cat.x = pos.x; cat.z = pos.z; cat.y = w.surface(pos.x, pos.z);
    cat.heading = heading; cat.speed = 0; cat.vy = 0; cat.air = 0; cat.sit = 0; cat.idle = 0;
    cam.yaw = heading; cam.elevation = ${c.el}; cam.distance = ${c.dist}; cam.targetY = cat.y;
  })()`);
  await page.sleep(1500);
  await page.evaluate("qa.rec = []; qa.raf = []; qa.last = 0;");
  const total = c.prog.reduce((s, p) => s + p[1], 0);
  const snapTimes = [0, 0.33, 0.66, 0.99].map((f) => f * total);
  const frames = [];
  let t0 = Date.now();
  let si = 0;
  for (const [keys, ms, opt = {}] of c.prog) {
    const segStart = Date.now();
    await page.evaluate(`(() => { const s = skycope; s.keys.clear(); for (const k of ${JSON.stringify(keys)}) s.keys.add(k); s.lastInput = performance.now();
      qa.orbit = ${opt.orbit ?? 0}; qa.el = ${opt.el ?? 0};
      if (!qa.orbiting) { qa.orbiting = true; let last = performance.now(); const f = (t) => { const d = Math.min(0.05, (t - last) / 1000); last = t; if (qa.orbit || qa.el) s.walker.orbit(qa.orbit * d, qa.el * d); requestAnimationFrame(f); }; requestAnimationFrame(f); }
    })()`);
    const jumps = [...(opt.jump ?? [])];
    while (Date.now() - segStart < ms) {
      const el = Date.now() - segStart;
      if (jumps.length && el >= jumps[0]) {
        jumps.shift();
        await page.evaluate("skycope.jump = true");
      }
      if (si < snapTimes.length && Date.now() - t0 >= snapTimes[si]) {
        frames.push(await shot(page));
        si++;
      }
      await page.sleep(40);
    }
  }
  while (si < snapTimes.length) { frames.push(await shot(page)); si++; }
  await page.evaluate("skycope.keys.clear(); qa.orbit = 0; qa.el = 0;");
  const { rec, raf } = await page.evaluate("({ rec: qa.rec, raf: qa.raf })");
  await page.evaluate("qa.rec = null");
  metrics[c.name] = analyse(rec, raf);
  await strip(page, frames, `${out}/${c.name}-${label}.jpg`);
  console.log(c.name, JSON.stringify(metrics[c.name]));
}

// Ceremonies.
const ceremonyOut = {};
for (const c of CEREMONIES) {
  const name = `ceremony-${c.id}-${c.approach.toFixed(1)}`;
  if (only && !only.some((o) => name.includes(o))) continue;
  const page = await pageFor("seed=1847&ceremony");
  // Fresh quest state: every gift asleep, nothing pending.
  await page.evaluate(`(() => { const j = skycope.thread.journey; j.beginAgain(); })()`);
  await page.sleep(300);
  const start = await page.evaluate(`(() => {
    const s = skycope, w = s.walker, cat = w.cat, cam = w.camera;
    const k = s.thread.journey.quest.keepsakes.find((k) => k.id === ${JSON.stringify(c.id)});
    // Just inside reach, approaching from angle a.
    const a = ${c.approach};
    const d = k.r + Math.max(1.5, k.r * 0.45) - 0.8;
    let x = k.x + Math.sin(a) * d, z = k.z + Math.cos(a) * d;
    // Ashore: step in until there is land under the cat.
    for (let i = 0; i < 20 && w.water(x, z).level > w.surface(x, z) + 0.15; i++) { x += (k.x - x) * 0.1; z += (k.z - z) * 0.1; }
    cat.x = x; cat.z = z; cat.y = w.surface(x, z); cat.heading = Math.atan2(k.x - x, k.z - z);
    cat.speed = 0; cat.air = 0; cat.vy = 0;
    cam.yaw = cat.heading; cam.elevation = 0.38; cam.distance = 3.4; cam.targetY = cat.y;
    return { x, z };
  })()`);
  // Wait for the ceremony to start, then for its wide shot to end.
  let ceremony = null;
  for (let i = 0; i < 40 && !ceremony; i++) {
    await page.sleep(250);
    ceremony = await page.evaluate("(() => { const c = skycope.thread.journey.ceremony; return c ? { gift: c.gift, shot: c.shot } : null; })()");
  }
  if (!ceremony) { console.log(name, "no ceremony"); continue; }
  const frames = [];
  let gone = null;
  for (let i = 0; i < 80; i++) {
    gone = await page.evaluate("(() => { const c = skycope.thread.journey.ceremony; return c && c.goneAt !== null ? performance.now() / 1000 - c.goneAt : null; })()");
    if (gone !== null) break;
    await page.sleep(100);
  }
  const camHome = ceremony.shot.camHome ?? 5;
  for (const t of [0.5, camHome * 0.5, camHome - 0.25]) {
    const g = await page.evaluate("(() => { const c = skycope.thread.journey.ceremony; return c && c.goneAt !== null ? performance.now() / 1000 - c.goneAt : null; })()");
    if (g === null) break;
    if (t > g) await page.sleep((t - g) * 1000);
    frames.push(await shot(page));
  }
  // Where the cat is on screen (NDC, |x|,|y| < 1 is in frame).
  const cam = await page.evaluate("(() => { const k = skycope.walker.camera, w = skycope.walker, c = w.cat, cam3 = skycope.landscape.camera; const p = cam3.position.clone().set(c.x, c.y + 0.2, -c.z).project(cam3); return { x: k.x, y: k.y, z: k.z, solid: Math.min(99, w.solids.distance(k.x, k.y, k.z, 1)), ground: k.y - w.surface(k.x, k.z), catOnScreen: [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(3)] }; })()");
  if (frames.length) await strip(page, frames, `${out}/${name}-${label}.jpg`);
  ceremonyOut[name] = { start, cam };
  console.log(name, JSON.stringify(cam));
  // Let it finish.
  for (let i = 0; i < 60; i++) {
    if (!(await page.evaluate("Boolean(skycope.thread.journey.ceremony)"))) break;
    await page.sleep(250);
  }
}

await writeFile(`${out}/metrics-${label}.json`, JSON.stringify({ cases: metrics, ceremonies: ceremonyOut }, null, 1));
for (const [, p] of pages) {
  if (p.errors.length) console.log("console errors:", p.errors.slice(0, 5));
  await p.close();
}
process.exit(0);
