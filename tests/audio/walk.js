// A scripted 60 s walk for the mix render and the CPU budget: the home
// beach on dry sand, up into grass (pushing through a bush, one meow),
// over rock (a jump), down into the sea (shallows, belly deep, a swim),
// and out in the boat. Noon, wind 7 m/s, music on.
import { AUDITION_BASE as BASE } from "../../src/sound/catalog.js";
import { SURFACE } from "../../src/sound/patches.js";

export const LEGS = [
  { from: 0, to: 12, name: "beach (dry sand)" },
  { from: 12, to: 24, name: "grass, a bush, a meow" },
  { from: 24, to: 34, name: "rock, a jump" },
  { from: 34, to: 46, name: "wading, then swimming" },
  { from: 46, to: 60, name: "the boat" },
];

const leg = (t) => LEGS.findIndex((l) => t >= l.from && t < l.to);

function conditions(t) {
  const i = leg(t);
  const c = { ...BASE, wind: 7, seaPan: 0.5, night: 0, cat: { ...BASE.cat, speed: 1.1 } };
  if (i === 0) Object.assign(c, { sea: 0.8, shore: 6 - t * 0.25, trees: 0 });
  if (i === 1) Object.assign(c, { sea: 0.3, shore: 14, trees: 0.4, contact: t > 17 && t < 20 ? { density: 0.7, speed: 1.1, kind: "shrub" } : { density: 0, speed: 0 } });
  if (i === 2) Object.assign(c, { sea: 0.6, shore: 4, trees: 0 });
  if (i === 3) Object.assign(c, { sea: 1, shore: -(t - 34) * 0.4, trees: 0, cat: { ...c.cat, wade: t < 40 ? 0.1 : 0.4, swim: t > 42 ? 1 : 0, speed: t > 42 ? 0.6 : 0.9 } });
  if (i === 4) {
    const u = t - 46;
    Object.assign(c, { sea: 1, shore: -12, trees: 0, cat: { ...c.cat, speed: 0 }, boat: { afloat: true, aboard: true, x: 0, z: 0, speed: Math.min(2.2, u * 0.25), roll: 0.08 * Math.sin(u * 1.3), vr: Math.cos(u * 1.3), stretch: -1 } });
  }
  return c;
}

function script(s, t, frame) {
  const i = leg(t);
  const pan = frame % 16 < 8 ? -0.15 : 0.15;
  const paw = (surface, every = 8, extra = {}) => frame % every === 0 && s.step(surface, false, pan, { exact: true, front: frame % (2 * every) === 0, ...extra });
  if (i === 0) paw(SURFACE.drySand);
  if (i === 1) paw(t > 17 && t < 20 ? SURFACE.scrub : SURFACE.grass);
  if (i === 1 && frame === 600) s.meow();
  if (i === 2) {
    if (t < 29.5 || t > 30.6) paw(SURFACE.rock);
    if (frame === 885) s.jump();
    if (frame === 915) s.land(4, SURFACE.rock, { exact: true });
  }
  if (i === 3 && t < 42) paw(SURFACE.shallows, 10, { depth: t < 40 ? 0.04 : 0.2, speed: 0.9 });
  if (i === 3 && frame === 1020) s.splash(0.8);
  if (i === 4) {
    if (frame === 1380) s.boatEvent({ type: "board" }, { aboard: true });
    if (frame > 1385 && frame < 1420) paw(SURFACE.deck, 12);
    if (frame % 110 === 50) s.boatEvent({ type: "hull-slap", gain: 0.6 }, { aboard: true });
  }
}

export const WALK = {
  seconds: 60,
  music: true,
  conditions,
  script,
  setup: (s) => s.setScore({ sunAltitude: 50 }),
};
