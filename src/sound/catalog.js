// Every cue the site can make, numbered to match the owner's listening
// checklist (docs/design/sound-plan.md section 10). The audition page
// (/?audition) lists these with a play button each; the tests render each
// one and hold it to its numbers; scripts/sound-evidence.mjs draws its
// spectrogram.
//
// An entry: { id, n (checklist item), name, says (what it should sound
// like), seconds (render length), play(sound) } or, for a scene,
// { scene: (t) => update input } played for `seconds`.
// Positioned cues are placed relative to a listener at the origin facing
// +z (the camera 3 m behind), so "10 m right" means x = 10.
import { SURFACE } from "./patches.js";
import { WALK } from "./walk.js";

export const CHECKLIST = [
  { n: 1, title: "The home beach at noon, standing still" },
  { n: 2, title: "Footsteps, surface by surface (walk, then run)" },
  { n: 3, title: "Pushing through a bush, stopping, coming out" },
  { n: 4, title: "Into the sea and out again" },
  { n: 5, title: "Meow, and what answers" },
  { n: 6, title: "The purr" },
  { n: 7, title: "Rain, and shelter under the eave and the milkwood" },
  { n: 8, title: "The boat" },
  { n: 9, title: "The wreck's boiler" },
  { n: 10, title: "Waking a gift" },
  { n: 11, title: "The animals" },
  { n: 12, title: "The story's moments" },
  { n: 13, title: "All together: a 60 s walk" },
];

const CAT = { x: 0, y: 0, z: 0, speed: 0, sit: 0 };
const CAMERA = { x: 0, z: -3, yaw: 0 };
const base = { sea: 0, seaPan: 0, wind: 0, rain: 0, night: 0, trees: 0, shore: 60, cat: CAT, camera: CAMERA };
const right = (d, extra = {}) => ({ x: d, z: 0, y: 0, ...extra });
const ahead = (d, extra = {}) => ({ x: 0, z: d, y: 0, ...extra });

// Four paws of a walk (lateral sequence, a step every 0.25 s) or four
// front-paw beats of a run, on one surface, scheduled on the audio clock.
const gait = (id, surface, name, says, running = false) => ({
  id, n: 2, name, says, seconds: surface === SURFACE.metal ? 2 : 1.4,
  play: (s) => {
    const legs = running ? [[true, -0.15], [true, 0.15], [true, -0.15], [true, 0.15]] : [[false, -0.15], [true, -0.15], [false, 0.15], [true, 0.15]];
    legs.forEach(([front, pan], i) => s._qa.cues.schedule(0.02 + i * (running ? 0.17 : 0.25), () => s.step(surface, running, pan, { exact: true, front, depth: 0.03 })));
  },
});

export const CUES = [
  // 1 · the beach
  { id: "beach-noon", n: 1, name: "Beach at noon (scene, 30 s)", says: "low slow sea that breathes, a wave rushing up every few seconds, light wind, maybe one gull; quiet enough to work to", seconds: 30, scene: () => ({ ...base, sea: 0.85, seaPan: 0.5, wind: 7, shore: 4, trees: 0 }) },
  { id: "wave", n: 1, name: "One breaking wave", says: "a rush that falls in pitch, then a hiss of foam", seconds: 4, play: (s) => s._qa.beds.update({ ...base, sea: 1, shore: 4 }) },

  // 2 · footsteps
  // Each "paw" entry is four steps of a walk (left hind, left fore, right
  // hind, right fore), so the variation between steps can be heard.
  gait("step-dry-sand", SURFACE.drySand, "Walking on dry sand", "a faint soft compression; you should have to listen for it"),
  gait("step-wet-sand", SURFACE.wetSand, "Walking on wet sand", "a damp pad, a little darker than dry sand"),
  gait("step-grass", SURFACE.grass, "Walking in grass (or a sour-fig mat)", "a whisper of blades"),
  gait("step-scrub", SURFACE.scrub, "Walking through low scrub", "a soft brush"),
  gait("step-forest", SURFACE.forest, "Walking on leaf litter", "a soft dry settle"),
  gait("step-rock", SURFACE.rock, "Walking on rock or the stoep", "almost nothing"),
  gait("step-pebbles", SURFACE.pebbles, "Walking on shingle", "a soft grit shifting"),
  gait("step-timber", SURFACE.timber, "Walking on timber (the keelson, the milkwood's limb)", "a soft low pad"),
  gait("step-deck", SURFACE.deck, "Walking on the boat's deck", "a soft low pad, a touch hollow"),
  gait("step-shallows", SURFACE.shallows, "Walking in the swash", "a soft wet pad, no plinks"),
  gait("run-dry-sand", SURFACE.drySand, "Running on dry sand", "clearly there now, still soft; front paws only, never a machine-gun", true),
  gait("run-grass", SURFACE.grass, "Running through grass", "a quicker whisper", true),
  { id: "land-sand", n: 2, name: "Landing a jump on sand", says: "a soft low settle", seconds: 0.6, play: (s) => s.land(4, SURFACE.drySand, { exact: true }) },
  { id: "jump", n: 2, name: "Jump", says: "a short whoosh of fur", seconds: 0.5, play: (s) => s.jump() },

  // 3 · foliage
  { id: "rustle", n: 3, name: "Pushing through a bush (scene, 4 s: move 2.5 s, stop, leave)", says: "leaves rustle only while moving, stop dead when it stops, one soft spring-back on leaving", seconds: 5,
    scene: (t) => ({ ...base, beds: false, contact: t < 2.5 ? { density: 0.8, speed: 1.2, kind: "shrub" } : t < 3.6 ? { density: 0.8, speed: 0, kind: "shrub" } : { density: 0, speed: 0 } }) },
  { id: "rustle-restio", n: 3, name: "Through restio and dry grass (scene, 2.5 s)", says: "a finer, higher hiss", seconds: 3, scene: (t) => ({ ...base, beds: false, contact: t < 2.5 ? { density: 0.8, speed: 1.2, kind: "restio" } : { density: 0, speed: 0 } }) },

  // 4 · water
  { id: "wade", n: 4, name: "Wading belly deep", says: "a slosh per stride", seconds: 0.8, play: (s) => s.step(SURFACE.shallows, false, 0, { exact: true, depth: 0.2, speed: 1 }) },
  { id: "splash-in", n: 4, name: "Bounding into the sea", says: "a plunge with a low body, then drops", seconds: 1.2, play: (s) => s.splash(1.2) },
  { id: "swim", n: 4, name: "Swimming (scene, 6 s)", says: "soft paddle strokes with a bubble, a small breath now and then", seconds: 6, scene: () => ({ ...base, beds: false, cat: { ...CAT, swim: 1, speed: 0.6 } }) },
  { id: "drips", n: 4, name: "Coming out: drips", says: "drips slowing", seconds: 2.5, play: (s) => s._qa.foley.drip(12) },
  { id: "shake", n: 4, name: "The shake (wet)", says: "a flutter of fur throwing off spray, droplets after", seconds: 1.6, play: (s) => { s._qa.foley.splash(0.2); s.shake(); } },

  // 5 · meow
  { id: "meow", n: 5, name: "Meow", says: "a small cat, not a synthesiser: 'mi-aow'", seconds: 1.4, play: (s) => s.meow() },
  { id: "meow-short", n: 5, name: "Short greeting meow (an animal close)", says: "quicker and brighter", seconds: 0.8, play: (s) => s._qa.foley.meow({ short: true }) },
  { id: "chirrup", n: 5, name: "Chirrup", says: "a questioning 'mrrp?'", seconds: 0.6, play: (s) => s.chirrup() },
  { id: "wisp", n: 5, name: "The wisp's answer", says: "three small glassy notes skipping up", seconds: 1.5, play: (s) => s.play("wisp", { distance: 4 }) },
  { id: "haw", n: 5, name: "A penguin's soft 'haw' back (8 m left)", says: "one short soft honk", seconds: 0.8, play: (s) => s.wild({ source: "penguins", type: "answer", ...right(-8) }) },
  { id: "owl", n: 5, name: "The owl in the milkwood (25 m ahead)", says: "a soft 'hoo, hooo', the second lower and longer", seconds: 2, play: (s) => s.wild({ source: "owl", type: "idle", ...ahead(25, { y: 6 }) }) },
  { id: "tower-echo", n: 5, name: "The lighthouse throwing a meow back (25 m)", says: "the meow, late and dark", seconds: 1.8, play: (s) => s.towerEcho(25) },

  // 6 · purr
  { id: "purr", n: 6, name: "Purr (scene, 6 s)", says: "low soft flutter, noticed after a moment, quieter than the sea; audible on laptop speakers", seconds: 6, scene: (t) => ({ ...base, beds: false, _purr: t < 5 }) },

  // 7 · rain
  { id: "rain-open", n: 7, name: "Rain 4 mm/h in the open (scene, 8 s)", says: "a soft full rain, lighter on sand", seconds: 8, scene: () => ({ ...base, beds: false, rain: 4, sea: 0.3 }) },
  { id: "rain-tree", n: 7, name: "Rain under the milkwood (scene, 8 s)", says: "the open rain softer, leaves louder, big drips falling", seconds: 8, scene: () => ({ ...base, beds: false, rain: 4, trees: 1, under: "tree" }) },
  { id: "rain-roof", n: 7, name: "Rain on the iron roof, 12 m away (scene, 8 s)", says: "the roof ringing and drumming from where it is", seconds: 8, scene: () => ({ ...base, beds: false, rain: 6, roofs: [right(12, { y: 3, r: 2.2 })] }) },
  { id: "rain-eave", n: 7, name: "Under the eave (scene, 8 s)", says: "outside soft and far, the roof loud overhead, a gutter dripping: the contrast is the point", seconds: 8, scene: () => ({ ...base, beds: false, rain: 6, roofs: [right(0.5, { y: 3, r: 2.2 })] }) },
  { id: "thunder-near", n: 7, name: "Thunder, 1.5 km", says: "a crack then rolls; loud but not painful", seconds: 12, play: (s) => s.play("thunder", { distance: 1500 }) },
  { id: "thunder-far", n: 7, name: "Thunder, 8 km", says: "only a low grumble", seconds: 30, play: (s) => s.play("thunder", { distance: 8000 }) },

  // 8 · boat
  { id: "boat-knock", n: 8, name: "Hopping on the upturned hull", says: "a hollow wooden knock", seconds: 1, play: (s) => s.boatEvent({ type: "knock" }, { x: 2, z: 2 }) },
  { id: "boat-scrape", n: 8, name: "Keel scraping down the sand", says: "a rough sandy scrape rising", seconds: 2, play: (s) => s.boatEvent({ type: "scrape" }, { x: 2, z: 3 }) },
  { id: "boat-launch", n: 8, name: "Afloat: the bow meets the water", says: "a last scrape, a plunge, a slap", seconds: 2.5, play: (s) => s.boatEvent({ type: "launch" }, { x: 2, z: 3 }) },
  { id: "boat-board", n: 8, name: "Stepping aboard", says: "a hollow knock on the deck, a slap under it", seconds: 1, play: (s) => s.boatEvent({ type: "board" }, { aboard: true }) },
  { id: "hull-slap", n: 8, name: "A wave slapping the hull (aboard)", says: "a low wet knock and a lick of water", seconds: 0.8, play: (s) => s.boatEvent({ type: "hull-slap", gain: 0.8 }, { aboard: true }) },
  { id: "boat-creak", n: 8, name: "Timber creak in a swell", says: "a slow ragged creak, not a squeal", seconds: 0.8, play: (s) => s._qa.world.creak({ where: { pan: 0 } }) },
  { id: "lantern-tick", n: 8, name: "The lantern's glass and wire", says: "a tiny tick", seconds: 0.4, play: (s) => s._qa.world.lanternTick() },
  { id: "bail-squeak", n: 8, name: "The lantern's handle squeaking", says: "a very small squeak", seconds: 0.4, play: (s) => s._qa.world.bailSqueak() },
  { id: "painter", n: 8, name: "The painter coming taut", says: "a short rope creak and a soft thud", seconds: 0.6, play: (s) => s._qa.world.painter() },
  { id: "boat-under-way", n: 8, name: "Under way, aboard (scene, 8 s, speeding up)", says: "water chuckling at the bow, a wake hiss that follows the speed; a creak as it rolls", seconds: 8,
    scene: (t) => ({ ...base, beds: false, boat: { afloat: true, aboard: true, x: 0, z: 0, speed: Math.min(2.4, t * 0.4), roll: 0.09 * Math.sin(t * 1.6), vr: Math.cos(t * 1.6) } }) },

  // 9 · boiler
  { ...gait("step-metal", SURFACE.metal, "Walking inside the boiler", "soft pads that the iron answers with a faint ring"), n: 9 },
  { id: "boiler-meow", n: 9, name: "Meow inside the boiler", says: "the meow comes back as one deep bell note that hangs for seconds", seconds: 5, setup: (s) => s.setInside("boiler"), play: (s) => s.meow(), teardown: (s) => s.setInside(null) },
  { id: "boiler-hum", n: 9, name: "The boiler's hollow breath (10 m)", says: "wind across the mouth, barely there", seconds: 4, play: (s) => s.boilerHum(right(10)) },

  // 10 · wakings (the diegetic layer) and a ceremony phrase
  ...["fireflies", "tideglow", "lamp", "stars", "seafolk", "boat"].map((gift) => ({
    id: `waking-${gift}`, n: 10, name: `Waking: ${gift} (12 m ahead)`, says: {
      fireflies: "hollow knock, leaves breathing out, a dozen tiny glass ticks",
      tideglow: "struck iron, a fizz running away, a low thump into the water, bright ticks from the swash",
      lamp: "a match, two puffs, a warm low swell, slow clockwork, small 'pt's along the necklace",
      stars: "a high glass harmonic swelling, wind down the hill, a soft meteor hiss",
      seafolk: "a deep bloop and bubbles, water running out, a seal answers far off",
      boat: "lantern glass, a match, a creak, keel on sand, a slap, two little squeaks",
    }[gift], seconds: 10, play: (s) => s.waking(gift, ahead(12, { y: 1 }), { tCat: 2.5 }),
  })),
  { id: "ceremony-tideglow", n: 10, name: "Ceremony phrase: tideglow (music off)", says: "one slow swelling phrase on D; one event, not three", seconds: 10, play: (s) => s.ceremony("tideglow") },
  { id: "ceremony-fireflies", n: 10, name: "Ceremony phrase: fireflies (music off)", says: "small and glassy, with an afterglow", seconds: 8, play: (s) => s.ceremony("fireflies") },

  // 11 · animals
  // Animals are rare, quiet events at a distance (reworked 15 Nov after
  // "some dominating animal noise"); each entry is one, from where it is
  // usually heard.
  { id: "penguin-bray", n: 11, name: "The penguin colony from the spawn beach (30 m right)", says: "a soft far-off honk or two; faint under the sea", seconds: 3, play: (s) => s.wild({ source: "penguins", type: "bray", ...right(30) }) },
  { id: "penguin-near", n: 11, name: "A penguin calling close by (8 m right)", says: "the same soft honk, nearer: still not a donkey", seconds: 3, play: (s) => s.wild({ source: "penguins", type: "bray", ...right(8) }) },
  { id: "penguin-startled", n: 11, name: "A penguin startled by the cat (5 m)", says: "one short soft haw", seconds: 1, play: (s) => s.wild({ source: "penguins", type: "honk", ...right(5) }) },
  { id: "seal-bark", n: 11, name: "A seal across the rocks (40 m left)", says: "one or two soft gruff barks", seconds: 2.5, play: (s) => s.wild({ source: "seals", type: "bark", ...right(-40), gain: 1 }) },
  { id: "seal-snort", n: 11, name: "A seal lifting its head (8 m)", says: "a soft snort", seconds: 0.6, play: (s) => s.wild({ source: "seals", type: "blow", ...right(-8) }) },
  { id: "whale-blow", n: 11, name: "The whale blowing far out (110 m)", says: "a deep wet exhale, far off", seconds: 3.5, play: (s) => s.wild({ source: "whale", type: "blow", ...ahead(110) }) },
  { id: "whale-slap", n: 11, name: "The whale's tail on the water (110 m)", says: "a soft heavy wash, far off", seconds: 2, play: (s) => s.wild({ source: "whale", type: "slap", ...ahead(110) }) },
  { id: "tortoise-hiss", n: 11, name: "The tortoise withdrawing (1 m)", says: "a short soft hiss; you must be close", seconds: 0.6, play: (s) => s.wild({ source: "tortoise", type: "hiss", ...right(1) }) },
  { id: "oystercatchers", n: 11, name: "Oystercatchers flushed (10 m)", says: "a few piping notes, then soft wings", seconds: 2, play: (s) => s.wild({ source: "oystercatchers", type: "flush", ...right(10) }) },
  { id: "gull", n: 11, name: "A kelp gull over the water (45 m)", says: "a soft falling call, far off", seconds: 1.5, play: (s) => s._qa.beds.gull({ x: 0, z: 0, y: 0 }, 0, ahead(45, { y: 15 })) },
  { id: "crickets", n: 11, name: "Crickets at night, the cat walking through (scene, 10 s)", says: "chirps round you; the near ones stop as you walk past and come back after", seconds: 10,
    scene: (t) => ({ ...base, night: 1, trees: 1, cat: { ...CAT, x: t * 1.5, speed: t < 5 ? 1.5 : 0 } }) },

  // 12 · story moments
  { id: "star-fall", n: 12, name: "A star falling", says: "a thin airy hiss falling, quiet until the end", seconds: 2, play: (s) => s.starFall() },
  { id: "star-land", n: 12, name: "It lands in the sand (9 m)", says: "a low soft thump, grains ticking, one glassy tick", seconds: 1.5, play: (s) => s.starLand(ahead(9)) },
  ...[1, 3, 6].map((n) => ({ id: `home-${n}`, n: 12, name: `Home phrase, ${n} light${n > 1 ? "s" : ""} lit`, says: n === 6 ? "the six notes rising and resolving, the octave below under the last" : `the first ${n} note${n > 1 ? "s" : ""}, the last held and left hanging`, seconds: n * 0.45 + 4, play: (s) => s.home(n) })),
  { id: "wisp-note", n: 12, name: "The wisp's note (n = 3)", says: "one bell-like pluck with a shimmer", seconds: 2, play: (s) => s.wispNote(3) },
  { id: "wick-catch", n: 12, name: "A wick catching (the lamp's, larger)", says: "a soft 'fff', two gutters, settling", seconds: 1.6, play: (s) => s.wickCatch(null, { large: true }) },
  { id: "glass-tick", n: 12, name: "Lantern glass ticking as it warms", says: "two or three irregular ticks", seconds: 3.5, play: (s) => s.glassTick(null, { delay: 0 }) },
  { id: "beam-hold", n: 12, name: "The lighthouse beam holding the cat", says: "a low warm swell, no attack", seconds: 6.5, play: (s) => s.beamHold(4) },
  { id: "clockwork", n: 12, name: "The lighthouse clockwork (6 m)", says: "a slow heavy escapement, one tick a second", seconds: 4.5, play: (s) => s.clockwork(right(6)) },
  { id: "tide-light", n: 12, name: "The first lit swash", says: "the swash with a faint glassy shimmer", seconds: 2.5, play: (s) => s.tideLight() },
  { id: "pool-drip", n: 12, name: "The rock pool: drip and suck", says: "a drip, then water sucking in rock", seconds: 1.6, play: (s) => s.poolDrip(right(2)) },
  { id: "shutter", n: 12, name: "A loose shutter in wind (10 m)", says: "a wooden knock or two, irregular", seconds: 1.5, play: (s) => s.shutter(right(10)) },
  { id: "whale-near", n: 12, name: "The whale beside the boat (15 m)", says: "a deep hollow exhale with wet in it, then a long inhale", seconds: 4, play: (s) => s.whaleBlowNear(right(15)) },
  { id: "ending-arrive", n: 12, name: "The ending's arrival", says: "one soft high bell and its octave below", seconds: 5, play: (s) => s.endingArrive() },

  // 13 · everything at once
  { id: "walk", n: 13, name: "Beach → grass (a bush, a meow) → rock (a jump) → wading and a swim → the boat (scene, 60 s)", says: "the whole mix: quiet, the sea underneath, each surface answering the paws; nothing you want to turn off", seconds: 60, scene: WALK.conditions, script: WALK.script, setup: WALK.setup, music: true },
];

export const CUE_IDS = CUES.map((c) => c.id);

// Plays a catalogue entry on a running sound (the audition page and the
// render harness share this). Returns its length (s); scenes are driven by
// `tick(t)` the caller calls each frame.
export function startCue(sound, cue) {
  cue.setup?.(sound);
  sound.update({ ...base, beds: false });
  if (cue.play) cue.play(sound);
  return cue.seconds;
}

// Scene input for time t (s): the update() conditions (with `_purr`
// applied on the side).
export function sceneInput(sound, cue, t) {
  const c = cue.scene(t);
  if (c._purr !== undefined) sound.setPurr(c._purr);
  return c;
}

export { base as AUDITION_BASE };
