// The waking light's evidence (docs/design/waking-light.md section 9): for
// each gift, frames over the timeline (before the waking, the catch, the
// front arriving, the linger, the steady state), at night and at noon,
// tiled into one labelled sheet per gift.
//   node scripts/waking-strips.mjs <outDir> [port=5351] [cdp=9421] [gifts=all] [label=after]
// MODE=before drives the old pulse (magic.pulse) at a frozen age instead
// of skycope.waking.freeze, for a baseline build of the site.
// AGES=-1,0.7,2.2,5,14 overrides the timeline; TIMES=1320,750 the clock.
import { mkdir, writeFile } from "node:fs/promises";
import { openPage } from "./qa-cdp.mjs";

const out = process.argv[2] ?? "docs/review/waking";
const port = Number(process.argv[3] ?? 5351);
const cdp = Number(process.argv[4] ?? 9421);
// (No stars: the beacon has no waking of its own, story-and-wow.md 9.)
const ALL = ["fireflies", "tideglow", "lamp", "seafolk", "boat"];
const gifts = process.argv[5] && process.argv[5] !== "all" ? process.argv[5].split(",") : ALL;
const label = process.argv[6] ?? process.env.MODE ?? "after";
const before = process.env.MODE === "before";
const AGES = (process.env.AGES ?? "-1,0.7,2.2,5,14").split(",").map(Number);
const TIMES = (process.env.TIMES ?? "1320,750").split(",").map(Number);
const W = 1280, H = 800;
// Where the cat stands for each gift's shot (see setup below); STANDS='{"lamp":[1.2,16]}' overrides.
const STANDS = { fireflies: [0, 4], tideglow: [0, 5], lamp: [1.2, 16], stars: [0, 5], seafolk: [0, 5], boat: [-0.9, 6], ...JSON.parse(process.env.STANDS ?? "{}") };
await mkdir(out, { recursive: true });
const frames = process.env.FRAMES ?? `${out}/frames`;
await mkdir(frames, { recursive: true });

const page = await openPage({ port, cdp, query: "seed=1847&weather=clear", width: W, height: H });
const { evaluate, send, sleep } = page;

// In the page: the source, a stand 5 m from it on the island's side, and
// the ceremony's own wide framing (journey.js ceremonyFrames).
await evaluate(`(async () => {
  const s = skycope;
  const { ceremonyFrames, SHOTS } = await import('/src/journey.js');
  const KEEP = { fireflies: 'milkwood', tideglow: 'wreck', lamp: 'lighthouse', stars: 'beacon', seafolk: 'pool', boat: 'boat' };
  window.__waking = {
    setup(gift) {
      if (s.waking) s.waking.freeze(gift, -1); // awake to the quest before the cat arrives
      const poi = s.landscape.pois.find((p) => p.id === KEEP[gift]);
      const w = s.walker, c = w.cat;
      // Where the cat stands: [turn from the island-centre side (rad), metres].
      const [turn, back] = (${JSON.stringify(STANDS)})[gift] ?? [0, 5];
      let dx = 58 - poi.x, dz = 70 - poi.z;
      const L = Math.hypot(dx, dz); dx /= L; dz /= L;
      [dx, dz] = [dx * Math.cos(turn) - dz * Math.sin(turn), dx * Math.sin(turn) + dz * Math.cos(turn)];
      const x = poi.x + dx * back, z = poi.z + dz * back;
      c.x = x; c.z = z; c.y = w.surface(x, z); c.speed = 0; c.vy = 0; c.air = 0; c.sit = 0; c.idle = 0;
      c.heading = Math.atan2(poi.x - x, poi.z - z);
      const ground = w.surface(poi.x, poi.z);
      const shot = SHOTS[gift] ?? SHOTS.default;
      const yaw = Math.atan2(poi.x - x, poi.z - z);
      const f = ceremonyFrames(w, { place: poi, gift, ground, shot, yaw, crown: s.landscape.places?.crown, canopies: s.landscape.obstacles?.canopies ?? [], fov: 1 }).wide;
      this.shot = { f, gift, x, z };
      this.hold();
      return { poi: [poi.x, poi.z], cat: [x, z], shot: f && { yaw: f.yaw, elevation: f.elevation, distance: f.distance } };
    },
    hold() {
      const { f } = this.shot;
      const w = s.walker, c = w.cat, cam = w.camera;
      s.keys.clear();
      c.idle = 0; c.sit = 0;
      w.freeCamera(true);
      cam.yaw = f.yaw; cam.elevation = f.elevation; cam.distance = f.distance; cam.targetY = c.y;
      w.lookAt(f.look, 1);
    },
  };
  // Keep the cat and the camera where they were put (no wandering, no
  // watch camera), every frame.
  const tick = () => { if (window.__waking.shot) { const c = s.walker.cat; c.idle = 0; c.sit = 0; c.speed = 0; } requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  return true;
})()`);

// The old build: a frozen pulse at age T (scene clock), the gift's level
// eased to what it would be then.
const BEFORE_SHIM = `(() => {
  if (window.__old) return true;
  const s = skycope, m = s.magic;
  window.__old = { gift: null, age: -1 };
  const tick = () => {
    const o = window.__old;
    if (o.gift) {
      const T = o.age;
      if (T < 0) { m.levels[o.gift] = 0; m.pulse = null; }
      else {
        m.levels[o.gift] = 1 - Math.exp(-T / 2.5);
        m.wakeAt[o.gift] = m.clock - T;
        if (!m.pulse || m.pulse.gift !== o.gift) {
          const poi = s.landscape.pois.find((p) => p.id === o.poi);
          const ground = s.walker.surface(poi.x, poi.z);
          m.pulse = { x: poi.x, y: ground + (o.gift === 'lamp' ? 16.4 : 1.1), z: poi.z, at: 0, gift: o.gift, colour: o.colour, speed: 18, reach: 150 };
        }
        m.pulse.at = m.clock - T;
      }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return true;
})()`;
if (before) await evaluate(BEFORE_SHIM);

const KEEP = { fireflies: "milkwood", tideglow: "wreck", lamp: "lighthouse", stars: "beacon", seafolk: "pool", boat: "boat" };
const OLD_COLOURS = { fireflies: [0.86, 1.0, 0.42], tideglow: [0.42, 0.86, 1.0], lamp: [1.0, 0.8, 0.46], stars: [0.78, 0.76, 1.0], seafolk: [0.46, 1.0, 0.78], boat: [1.0, 0.6, 0.5] };

async function freeze(gift, age) {
  if (before) {
    await evaluate(`(() => { const m = skycope.magic; if (!m.isAwake('${gift}')) m.wake('${gift}', { quiet: true }); Object.assign(window.__old, { gift: '${gift}', poi: '${KEEP[gift]}', age: ${age}, colour: ${JSON.stringify(OLD_COLOURS[gift])} }); return true; })()`);
  } else if (age < 0) await evaluate(`skycope.waking.freeze('${gift}', -1)`);
  else await evaluate(`skycope.waking.freeze('${gift}', ${age})`);
}

async function grab() {
  const r = await send("Page.captureScreenshot", { format: "jpeg", quality: 86 });
  return r.result.data;
}

const sheets = {};
for (const gift of gifts) {
  sheets[gift] = [];
  for (const minutes of TIMES) {
    const row = [];
    await evaluate(`(() => { const sl = document.querySelector('#time'); sl.value = ${minutes}; sl.dispatchEvent(new Event('input')); return true; })()`);
    const info = await evaluate(`window.__waking.setup('${gift}')`);
    console.log(gift, minutes, JSON.stringify(info));
    await freeze(gift, -1);
    await sleep(3500);
    for (const age of AGES) {
      await evaluate("window.__waking.hold()");
      await freeze(gift, age);
      await sleep(age < 0 ? 400 : 1300);
      const data = await grab();
      await writeFile(`${frames}/${gift}-${minutes}-${age}-${label}.jpg`, Buffer.from(data, "base64"));
      row.push({ age, data });
    }
    sheets[gift].push({ minutes, row });
  }
  // Back to sleep before the next gift.
  if (before) await evaluate(`(() => { const m = skycope.magic; window.__old.gift = null; m.pulse = null; m.sleep('${gift}'); m.levels['${gift}'] = 0; return true; })()`);
  // (after: the next setup puts this gift back to sleep, once the cat has left.)
}
if (page.errors.length) console.log("page errors:", page.errors.slice(0, 5));

// Tile each gift's frames into one labelled sheet, in the same tab.
await send("Page.enable");
await send("Page.navigate", { url: "about:blank" });
await sleep(500);
const { result: { frameTree } } = await send("Page.getFrameTree");
const tw = 512, th = 320;
for (const gift of gifts) {
  const rows = sheets[gift];
  const html = `<html><body style="margin:0;background:#111;color:#ddd;font:14px -apple-system,Helvetica,sans-serif">
  <div style="padding:6px 10px;font-size:16px">${gift} · ${label} · seed 1847 · columns: wall seconds after the waking</div>
  ${rows.map(({ minutes, row }) => `<div style="display:flex;gap:4px;padding:0 4px 4px">${row.map(({ age, data }) => `<div style="position:relative;width:${tw}px;height:${th}px"><img width="${tw}" height="${th}" src="data:image/jpeg;base64,${data}"><div style="position:absolute;left:6px;top:4px;background:#000a;padding:1px 6px">${minutes === 750 ? "noon" : minutes >= 1200 ? "night" : minutes + " min"} · ${age < 0 ? "before" : "T " + age + " s"}</div></div>`).join("")}</div>`).join("")}
  </body></html>`;
  const width = AGES.length * (tw + 4) + 4, height = 34 + rows.length * (th + 4);
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
  await send("Page.setDocumentContent", { frameId: frameTree.frame.id, html });
  await sleep(800);
  const r = await send("Page.captureScreenshot", { format: "jpeg", quality: 82 });
  await writeFile(`${out}/${gift}-${label}.jpg`, Buffer.from(r.result.data, "base64"));
  console.log("sheet", `${out}/${gift}-${label}.jpg`);
}
await page.close();
process.exit(0);
