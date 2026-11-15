// Animal voices in the live site (one headless Chrome, muted, audio running):
// stands the cat at the spawn and logs every animal voice the sound engine
// is asked for — when, what, where from the listener, played or held back —
// over several scenes, then a walk past the penguins and the seals.
//   node scripts/animal-log.mjs <vite port> <cdp port> <out.json> [quick]
import { writeFileSync } from "node:fs";
import { openPage } from "./qa-cdp.mjs";

const [port = 5352, cdp = 9422, out = "docs/review/sound/animals/before.json", quick] = process.argv.slice(2);
const k = quick ? 0.2 : 1;
const SCENES = [
  { name: "seed 1847, noon, standing at the spawn", seed: 1847, minutes: 750, seconds: 300 * k },
  { name: "seed 1847, dusk, standing", seed: 1847, minutes: 1188, seconds: 90 * k },
  { name: "seed 1847, night, standing", seed: 1847, minutes: 1320, seconds: 90 * k },
  { name: "seed 2, noon, standing", seed: 2, minutes: 750, seconds: 90 * k },
  { name: "seed 3, noon, standing", seed: 3, minutes: 750, seconds: 90 * k },
  { name: "seed 1847, noon, walking past the penguins and seals", seed: 1847, minutes: 750, seconds: 60 * k, walk: true },
];

const page = await openPage({ port: +port, cdp: +cdp, query: "seed=1847&weather=clear", args: ["--autoplay-policy=no-user-gesture-required"] });
const results = [];
try {
  for (const scene of SCENES) {
    await page.send("Page.navigate", { url: `http://127.0.0.1:${port}/?perf&seed=${scene.seed}&weather=clear` });
    for (let i = 0; i < 150; i++) {
      try {
        if (await page.evaluate("!!(window.skycope && skycope.walker && skycope.landscape && skycope.sound)")) break;
      } catch {}
      await page.sleep(200);
    }
    await page.sleep(2500);
    const setup = await page.evaluate(`(async () => {
      const T = await import('/src/terrain.js');
      const sk = window.skycope;
      const slider = document.querySelector('#time');
      if (slider) { slider.value = ${scene.minutes}; slider.dispatchEvent(new Event('input', { bubbles: true })); }
      sk.sound.start();
      if (!sk.sound.enabled) sk.sound.setEnabled(true);
      await sk.sound.context?.resume?.();
      const c = sk.walker.cat;
      let colony = null;
      if (${!!scene.walk}) {
        const pois = sk.landscape.wildlife?.pois ?? [];
        colony = pois.find((p) => /penguin/i.test(p.id + p.title)) ?? pois[0];
        if (colony) {
          const dx = colony.x - T.ISLAND.x, dz = colony.z - T.ISLAND.z, r = Math.hypot(dx, dz);
          // Start 25 m along the shore from the colony, a few metres up the beach.
          const theta = Math.atan2(dz, dx) - 25 / r;
          const p = T.islandPoint(theta, 3);
          c.x = p.x; c.z = p.z;
          const q = T.islandPoint(Math.atan2(dz, dx) + 25 / r, 3);
          sk.walker.camera.yaw = Math.atan2(q.x - p.x, q.z - p.z);
        }
      }
      const heard = sk.sound._qa?.core.heard;
      if (heard) heard.length = 0;
      return { state: sk.sound.context?.state, cat: [c.x, c.z], inland: T.shoreDistance(c.x, c.z), wind: sk.weather?.wind ?? null, colony: colony && { id: colony.id, x: colony.x, z: colony.z } };
    })()`);
    const t0 = Date.now();
    if (scene.walk) await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "w", code: "KeyW", windowsVirtualKeyCode: 87 });
    while (Date.now() - t0 < scene.seconds * 1000) await page.sleep(5000);
    if (scene.walk) await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "w", code: "KeyW", windowsVirtualKeyCode: 87 });
    const got = await page.evaluate(`(async () => {
      const T = await import('/src/terrain.js');
      const sk = window.skycope, c = sk.walker.cat;
      return { heard: (sk.sound._qa?.core.heard ?? []).slice(), night: sk.celestial?.scene, inland: T.shoreDistance(c.x, c.z), wind: sk.weather?.wind ?? null, state: sk.sound.context?.state };
    })()`);
    results.push({ ...scene, setup, ...got, wallSeconds: (Date.now() - t0) / 1000 });
    console.log(`${scene.name}: ${got.heard.length} voices asked for (audio ${setup.state})`);
    writeFileSync(out, JSON.stringify({ results, errors: page.errors }, null, 1));
  }
} finally {
  await page.close();
}
