// Renders the real sound engine (src/sound) off-line in tests/audio/sim.js:
// build it on a simulated context, drive it with a script of updates and
// calls at 30 Hz, and return the stereo output and the engine's stats.
import { OfflineAudioContext } from "./sim.js";
import { createSound } from "../../src/sound.js";
import { AUDITION_BASE, sceneInput } from "../../src/sound/catalog.js";

export const SR = 48000;

// A quiet world: no sea, no wind, no rain, noon, the cat far inland.
export const QUIET = { sea: 0, seaPan: 0, wind: 0, rain: 0, night: 0, trees: 0, shore: 60 };

// render({ seconds, conditions, script(sound, t, frame) , solo, setup })
//   conditions: the update() input each frame (object or (t) => object)
//   script: called every frame before update, for one-shots
//   solo: mute every bus but these (by fader), for bus measurements
export async function render({ seconds = 2, conditions = QUIET, script = null, setup = null, solo = null, music = false, seed = 7, sampleRate = SR } = {}) {
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * sampleRate), sampleRate);
  const sound = createSound({ context: ctx, storage: null, seed });
  if (!music) sound.setMusic(false);
  sound.start();
  setup?.(sound, ctx);
  if (solo) {
    const mix = sound._qa.mix;
    for (const [name, bus] of Object.entries(mix.buses)) if (!solo.includes(name)) mix.setLevel(name, 0, 0.001);
  }
  const dt = 1 / 30;
  let frame = 0;
  for (let t = 0; t < seconds; t += dt) {
    script?.(sound, t, frame, ctx);
    const c = typeof conditions === "function" ? conditions(t, frame, sound) : conditions;
    sound.update(c);
    ctx.renderUntil(Math.min(seconds, t + dt));
    frame++;
  }
  const buffer = await ctx.startRendering();
  return { channels: buffer.channels, sampleRate, sound, ctx, stats: sound.stats };
}

// Renders one cue alone: `play(sound, ctx)` once at 1/30 s with the beds
// off, for `seconds`.
export async function renderCue(play, { seconds = 2, conditions = QUIET, seed = 7, solo = null } = {}) {
  return render({
    seconds,
    conditions: typeof conditions === "function" ? (t, f) => ({ ...conditions(t, f), beds: false }) : { ...conditions, beds: false },
    seed,
    solo,
    script: (sound, t, frame, ctx) => {
      if (frame === 1) play(sound, ctx);
    },
  });
}

// Renders one catalogue entry (src/sound/catalog.js) as the audition page
// plays it: a one-shot at 1/30 s, or a scene driven for its length.
export async function renderEntry(cue, { seed = 7, seconds = cue.seconds + 0.3 } = {}) {
  return render({
    seconds,
    seed,
    conditions: (t, frame, sound) => (cue.scene ? sceneInput(sound, cue, t) : { ...AUDITION_BASE, beds: false }),
    script: (sound, t, frame) => {
      if (frame === 0) cue.setup?.(sound);
      if (frame === 1 && cue.play) cue.play(sound);
    },
  });
}
