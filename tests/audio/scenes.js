// The reference scenes each bus's loudness target is measured over
// (docs/design/sound-plan.md section 2), and the mix scene. Each is a
// render() argument: 30 s, the bus soloed (others at level 0).
import { AUDITION_BASE as BASE } from "../../src/sound/catalog.js";

const beach = { ...BASE, sea: 0.85, seaPan: 0.5, wind: 7, shore: 4, trees: 0 };

// A cat walking: a paw every 0.25 s (front and hind), on `surface` (sound surface ids).
const walk = (surface, every = 0.25, running = false) => (sound, t, frame) => {
  const k = Math.round(every * 30);
  if (frame % k === 0) sound.step(surface, running, frame % (2 * k) ? 0.15 : -0.15, { exact: true, front: true });
};

export const SCENES = {
  amb: { bus: "amb", seconds: 30, conditions: beach },
  weather: { bus: "weather", seconds: 30, conditions: { ...BASE, beds: false, rain: 4, sea: 0.3 } },
  foley: { bus: "foley", seconds: 30, conditions: { ...BASE, beds: false }, script: walk(2, 0.2, true) },
  voice: { bus: "voice", seconds: 30, conditions: { ...BASE, beds: false }, script: (s, t, frame) => frame % 150 === 10 && s.meow() },
  // world: the boat under way, aboard (was a penguin bray every 8 s at 10 m until the 15 Nov animal rework).
  world: { bus: "world", seconds: 30, conditions: (t) => ({ ...BASE, beds: false, boat: { afloat: true, aboard: true, x: 0, z: 0, speed: Math.min(2.2, 0.5 + t * 0.2), roll: 0.09 * Math.sin(t * 1.3), vr: Math.cos(t * 1.3), stretch: -1 } }), script: (s, t, frame) => frame % 150 === 40 && s.boatEvent({ type: "hull-slap", gain: 0.6 }, { aboard: true }) },
  magic: { bus: "magic", seconds: 14, music: true, conditions: { ...BASE, beds: false }, script: (s, t, frame) => frame === 5 && s.ceremony("tideglow") },
  music: { bus: "music", seconds: 30, music: true, conditions: { ...BASE, beds: false }, setup: (s) => s.setScore({ sunAltitude: 50 }) },
};

// The whole mix: the home beach at noon, walking on dry sand, one meow.
export const MIX = {
  seconds: 30,
  music: true,
  conditions: (t) => ({ ...beach, cat: { ...BASE.cat, speed: 1 } }),
  setup: (s) => s.setScore({ sunAltitude: 50 }),
  script: (s, t, frame) => {
    walk(2, 0.25)(s, t, frame);
    if (frame === 300) s.meow();
  },
};
