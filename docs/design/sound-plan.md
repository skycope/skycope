# Sound plan (14 Nov 2026, branch `magic-round2`)

For the implementer of handover thread E. Everything here is procedural Web Audio: oscillators, generated noise buffers, biquads, delays, gains. No audio files.

**Read this first.** Nobody has heard this site. Agents cannot hear; every audio change so far was checked as offline level measurements. This document was written from the source (`src/sound.js`, `src/calls.js`, `src/score.js`, the call sites in `src/main.js`, `src/thread.js`, `src/journey.js`) and from general synthesis practice, by an agent that also cannot hear. The recipes are starting values with reasons, not tuned sounds. Section 9 says how an agent can verify what is verifiable without ears; section 10 is the numbered listening checklist the owner is asked to run. Treat every "should sound like" as a hypothesis until the owner reports on it by number.

The owner's brief: "more sound design", inside "paring back on confusing elements" and "the point isn't 'overwhelm the user with random new glitchy elements' it's 'make the world way more fun and magical to interact with'". So: quiet, few voices at once, and sound that answers what the cat does.

## 1. Inventory: what exists

Graph today (`createSound`, `src/sound.js`): every voice → `master` gain 0.9 → `DynamicsCompressor` (threshold -18 dB, ratio 3, other values default) → destination. One reverb (`createReverb`, `src/score.js`, 4.8 s) fed by the music send and by named calls. Three 3-second stereo noise buffers (white x0.5, pink, brown) built at start with `Math.random` (so no two runs are sample-identical).

| Sound | Where | Method | Level (linear peak into master) | Trigger |
|---|---|---|---|---|
| Sea bed | `beds.sea` | brown noise loop → lowpass 480 Hz Q 0.7; two LFOs (0.09 Hz, 0.037 Hz) on gain | 0.05 + sea x 0.3 | always; `sea` = 1 at the shore → 0 at 30 m inland |
| Surf bed | `beds.surf` | pink loop → bandpass 900 Hz Q 0.6 | sea² x 0.1 | always |
| Breaking wave | `update` | pink burst lowpass 2200 → 300 Hz, attack 0.5 s, 2.8 s; white highpass 3 kHz hiss 0.4 s later | 0.02 + sea² x 0.18 | every 5-10 s, random; not tied to the drawn waves |
| Wind bed | `beds.wind` | pink loop → bandpass 520 Hz, Q 0.8 + wind x 0.05, centre wobbled ±180 Hz at 0.13 Hz | min(0.2, 0.012 + wind x 0.012) | weather wind (m/s) |
| Leaves bed | `beds.leaves` | white loop → highpass 2600 Hz | trees x min(0.06, 0.004 + wind x 0.005) | `trees` = 0 → 1 over 8-16 m inland |
| Rain bed | `beds.rain` | white loop → highpass 1400 Hz | min(0.2, rain x 0.035) | weather rain (mm/h) |
| Rain drips | `update` | white burst bandpass 2.5-5.5 kHz Q 8, 30 ms, random pan | 0.02-0.05 | rain > 0.3, rate ∝ rain |
| Gull | `gull()` | sawtooth 1.5-1.9 kHz falling to 55 % → bandpass 2200 Hz Q 2.5, 0.3 s, 1-3 calls | 0.035 | every 6-22 s by day; random pan, no position |
| Crickets | `crickets()` | sine 4.3-4.9 kHz, three 30 ms pulses | 0.012 | night > 0.6, every 0.25-0.85 s; random pan |
| Thunder | `calls.js thunder` | white crack, pink body, 3-6 brown rolls, long brown tail; delayed by distance / 343 m/s | 0.42 / (1 + d / 2500) | lightning events (`main.js:1153`) or storm timer |
| Paw step | `step(surface, running, pan)` | one or more noise bursts: rock = white bandpass 1.8-2.4 kHz Q 3, 20 ms; wet sand = pink lowpass 700 Hz, 70 ms; dry sand = white lowpass 1300 → 500 Hz, 90 ms; scrub and forest = 2-3 white crackles at 2.5-5 kHz, 15-35 ms | walk 0.035, run 0.07, x 0.7-1.3 | each paw landing (`main.js footstep`); surfaces 0-4 only; pan ±0.15 by left/right leg |
| Meow | `meow()` → `voice` | sawtooth 430 → 760 → 690 → 360 Hz, vibrato 5.5-7.5 Hz ±9 Hz, two moving bandpass formants (600-1100 Hz Q 5; 1500-2500 Hz Q 7), breath noise | 0.22 | key m, tap on cat |
| Chirrup | `chirrup()` | same voice, 330 → 560 Hz, 0.26 s | 0.13 | something of interest near, at most every 12 s |
| Purr | `setPurr` | brown loop → lowpass 320 Hz, amplitude 26 Hz triangle, breath 0.45 Hz | 0.35 (the loudest sustained thing in the mix) | sitting and idle > 8 s |
| Splash, paddle, shake, jump, land | `splash`, `setSwim`, `shake`, `jump`, `land` | pink and white bursts; land = brown lowpass 260 Hz 0.12 s | splash 0.03-0.12; paddle 0.025-0.045; land ≤ 0.25 | walker and boat events (`main.js:1048-1111`); the boat's hull slap, grounding and launch reuse `splash` and `land` |
| Penguin bray, seal bark, whale blow, owl, big splash | `calls.js` | voiced: sawtooth through three fixed formants with square-wave roughness; whale = three noise bursts | 0.05-0.25 at reference distance | `thread.hear(name, {x, z})` from wildlife: distance gain (ref / d)^0.8, lowpass 16 kHz x exp(-d / 450), reverb send rising with d, pan x 0.8. **`owl` is defined and never triggered.** |
| Discover chime | `calls.js discover` | sines D5, A5, E6 with 2x and 2.76x partials, 2.6 s | 0.11 | every "found" line |
| Wisp answer | `calls.js wisp` | sines D6, A6, D7, 70 ms apart, plus air | 0.065 | 0.25-1.6 s after a meow |
| Wake | `calls.js wake` | sines D2, A2, D3 swelling 1.1 s, pink sweep 900 → 7000 Hz, four bells | 0.13 | each gift waking |
| Ceremony phrase | `score.js CEREMONIES` | pad chord plus a plucked phrase per gift, on the music bus | pad 0.052, pluck 0.088 x velocity | each ceremony; **silent when music is off** |
| Score | `score.js` | seeded composer in D, a mode per light and weather; pads and plucks | pad 0.026, pluck 0.04, x mood level 0.4-1 | always, if music is on |

What the inventory shows:

1. **One bus.** Nothing can be balanced, ducked or measured by family. Ceremony phrases ride the music switch.
2. **Almost nothing is in the world.** Beds, gulls, crickets and the cat's paws have no position; only the named calls do. The gull that calls is not the gull on the beach.
3. **Six of the surfaces in the brief are missing**: grass as distinct from scrub, timber, metal, shallow water as a step, pebbles. Boat sounds are borrowed splashes.
4. **Levels are uneven on paper**: purr 0.35 sustained against a 0.035 step and a 0.012 cricket. Thunder 0.42 can hit the compressor hard.
5. **Nothing answers.** No sound changes because of what the cat did, except its own paws and the wisp's chime.
6. **Three things stack at each waking**: the `wake` call, the ceremony phrase, and (if a "found" line fires) the discover chime.

## 2. Structure: buses and loudness

```
voices → [bus gain] → [bus EQ] ─┬→ dry ────────────────→ MIX → limiter → destination
                                ├→ send A (outdoor air) ─┘
                                └→ send B (small space) ─┘
```

Loudness targets are integrated LUFS (ITU-R BS.1770 K-weighting, gated) over the named 30 s reference scene, measured at the bus output with master at 1.0, by the offline harness in section 9. Set each bus fader by measurement, not by the voice gains in the recipes.

| Bus | Carries | Reference scene (30 s) | Target LUFS | Short-term max | Notes |
|---|---|---|---|---|---|
| `amb` | sea, surf, wind, leaves, insects | home beach, noon, wind 7 m/s | -36 | -32 | the floor everything sits on |
| `weather` | rain layers, roof, thunder | rain 4 mm/h in the open | -32 | -24 (thunder -18) | replaces part of `amb` when raining |
| `foley` | paws, rustle, water on the cat, jump, land, shake | running on dry sand | -40 | -34 | you should be able to forget it |
| `voice` | meow, chirrup, purr | one meow every 5 s | -34 | -28 | the meow is the visitor's own action: clearly audible |
| `world` | animals, boat, objects, all positioned | penguin bray at 10 m every 8 s | -36 | -28 | already attenuated by distance |
| `magic` | wisp, discovery, ceremony phrases | one ceremony | -34 | -26 | not on the music switch |
| `music` | the score | noon mood | -40 | -34 | under everything, as now |
| **mix** | sum | home beach, noon, walking, one meow | **-30 ±2** | -22 | true peak ≤ -6 dBTP in normal play |

For scale: streaming music is mastered near -14 LUFS, so this site plays about 16 LU quieter than a music tab at the same volume setting. That is the "stays quiet" requirement.

Master chain: replace the 3:1 compressor with a limiter that should almost never act: `DynamicsCompressor` threshold -8 dB, knee 0, ratio 20, attack 0.003 s, release 0.25 s, then a fixed gain of 0.89 (-1 dB). If the limiter shows more than 1 dB of reduction outside thunder, a bus is too loud; fix the bus.

Ducking (plain `setTargetAtTime` on bus faders, no side-chain node):

- A ceremony phrase: `music` -9 dB and `amb` -4 dB over 0.4 s, back over 2.5 s.
- Thunder within 2 km: `amb` and `weather` rain -3 dB for 1.5 s (the ear's own recovery).
- Under cover (section 6): `weather` open-rain layer -12 dB and lowpass 1.5 kHz; roof or leaf layer up.
- The cat asleep: `music` to 0 (as now), `amb` -3 dB, lowpass 3 kHz on `amb`.

Reverbs, both generated, both built once:

- **Send A, outdoor air**: the existing `createReverb` at 1.6 s instead of 4.8 s (an island has no hall). Send by distance: `min(0.5, 0.05 + d / 300)`. The score keeps its own 4.8 s instance.
- **Send B, small space**: a `ConvolverNode` with a generated impulse: 0.35 s of white noise x exp(-t / 0.07), lowpassed at 4 kHz, plus three early taps (4, 7, 11 ms at 0.6, 0.4, 0.3). Used under the upturned hull and in the cottage doorway. The boiler has its own resonator (section 5).

## 3. Spatialisation and distance

One model for every positioned voice, in a helper `place(voice, {x, y, z})` that replaces `thread.hear`'s arithmetic.

- **Listener**: 70 % of the way from the camera to the cat, at cat ear height; facing the camera's yaw. (A pure camera listener makes the cat's own sounds distant when zoomed out; a pure cat listener makes the picture and the sound disagree when orbiting.)
- **Pan**: `StereoPannerNode`, `pan = sin(bearing) x min(1, d / 2) x 0.85`. No HRTF: `PannerNode` HRTF costs a convolution per voice and the site must run on phones. Sources within 2 m narrow toward centre.
- **Distance gain**: `g = (ref / max(ref, d))^0.8`, the law `calls.js` already uses (gentler than 1/d, so far calls stay audible). `ref` per source below.
- **Air**: lowpass at `16000 x exp(-d / 450)` Hz, floor 500 Hz (existing).
- **Reverb send A** rises with distance as above, so far sounds are wetter.
- **Behind**: bearing more than 110° from the view direction → -2 dB and a high shelf of -4 dB at 5 kHz. Stereo cannot place a sound behind you; this is the cheapest cue.
- **Occlusion**: four times a second per audible source, sample `walker.surface` at three points along the line to it; if the ground or a boulder rises more than 1.5 m above that line, target -5 dB and lowpass 1.2 kHz, eased over 0.3 s. Skip for sources beyond 120 m or under -60 dB.
- **Cull**: a voice whose computed gain is under 0.002 is not created.

| Source | ref (m) | Heard to about |
|---|---|---|
| Paws, rustle, the cat's own water | not positioned (pan by leg, ±0.15) | n/a |
| Crab clicks, tortoise, anemones, lantern tick | 1.5 | 10 m |
| Penguin peeps, oystercatcher, gull on the sand | 8 | 60 m |
| Penguin bray, seal bark, owl | 25 | 150 m |
| Boat hull slap, creak (not aboard) | 6 | 50 m |
| Iron roof in rain | 10 | 60 m |
| Whale blow, breach | 90 | 400 m |
| Thunder | 3000 | all |

Beds become partly positional without new voices: `sea` and `surf` already pan toward the nearest shore; add a second surf voice whose gain and lowpass follow the actual swash line distance (`shoreDistance`) so standing in the swash sounds like it (section 5).

## 4. The cat: footsteps, foliage, body

Conventions for recipes: gains are linear envelope peaks into the bus before its fader. "Burst" is a noise source through one filter with a linear attack and an exponential tail (the existing `burst` helper). Every one-shot gets ±12 % gain, ±6 % filter frequency and ±15 % length of random variation, and never the same random draw twice running. Running multiplies gain by 1.8 and shortens tails by 20 %. Front paws are 20 % louder than hind. Paws land four to a stride: at a run, voice only the two front paws (cap 8 steps per second).

The walker must report more surfaces. Extend `footstep`'s `kind` to: 0 rock, 1 wet sand, 2 dry sand, 3 scrub, 4 forest floor, **5 grass, 6 timber, 7 metal, 8 shallows, 9 pebbles**. Timber and metal come from the prop contract's `surfaces` (the object audit's `place-kit.js`), shallows from `cat.wade` between 0.02 and 0.15.

### Footsteps

| Surface | Layers | Why |
|---|---|---|
| **Dry sand** (2) | (a) white → lowpass 1100 → 420 Hz over the tail, Q 0.7, attack 14 ms, tail 95 ms, gain 0.030. (b) 25 ms later: white → bandpass 3200 Hz Q 1.2, attack 8 ms, tail 40 ms, gain 0.006 (grains settling). | soft, no click, a little "shh" |
| **Wet sand** (1) | (a) pink → lowpass 620 Hz Q 2, attack 8 ms, tail 60 ms, gain 0.040. (b) sine 180 → 120 Hz, attack 4 ms, tail 35 ms, gain 0.012 (firm ground under it). (c) one step in three: white → bandpass 2400 Hz Q 6, tail 18 ms, gain 0.006, 40 ms late (the suck as the paw lifts). | denser and darker than dry sand |
| **Grass** (5) | two or three grains 8-14 ms apart: white → bandpass 4500-7000 Hz Q 1.5, attack 3 ms, tail 22-40 ms, gain 0.010 each; under them brown → lowpass 300 Hz, tail 50 ms, gain 0.012. | blades brushing, soft soil |
| **Scrub and forest floor** (3, 4) | as grass, plus one step in four a twig: white → bandpass 2200 Hz Q 9, attack 1 ms, tail 12 ms, gain 0.016. Forest: one more grain and a 380 Hz brown thump at 0.015 (leaf litter). | keeps today's crackle, less often |
| **Rock** (0) | (a) white → bandpass 2600 Hz Q 4, attack 1 ms, tail 14 ms, gain 0.016 (pad tap). (b) sine 420 Hz, attack 1 ms, tail 25 ms, gain 0.006. Walking, 30 % of steps add a claw tick: white → highpass 5000 Hz, tail 6 ms, gain 0.008. Running: always. | a cat on stone is nearly silent; the tick is what you hear |
| **Timber** (6: keelson, boat deck, sill) | (a) brown → lowpass 500 Hz, attack 2 ms, tail 45 ms, gain 0.030. (b) two resonances rung by the same hit: white burst 5 ms → two parallel bandpasses at 210 Hz Q 18 and 340 Hz Q 14, gains 0.020 and 0.012 (the filters ring about 70 ms). On the boat deck drop the resonances to 150 and 260 Hz and add 20 % send B (hollow hull). | a knock with a body under it |
| **Metal, inside the boiler** (7) | exciter: white burst 3 ms, gain 0.05 → four parallel bandpasses at 196, 418, 733, 1210 Hz (inharmonic), Q 40, 35, 30, 25, gains 1, 0.6, 0.4, 0.25 → sum x 0.5 → `boiler` resonator (section 5). Claw tick always: highpass 6000 Hz, 5 ms, gain 0.01. | the ring is the point; each step should hang about 0.6 s |
| **Shallows** (8) | (a) pink → bandpass 1100 → 500 Hz Q 1.4, attack 6 ms, tail 110 ms, gain 0.035. (b) one or two bubble blips 30-90 ms later: sine sweeping up from f to 1.6 f over 35 ms, f random 700-1500 Hz, attack 2 ms, tail 30 ms, gain 0.008. | a plip, then drops |
| **Pebbles** (9, shell and pebble bands) | three clicks over 40 ms: white → bandpass 1800-3600 Hz Q 7, tail 9 ms, gain 0.012, the last with a 300 Hz sine tap at 0.006. | stones shifting |

### Foliage rustle

Triggered by contact, not a bed: the walker already knows which plant instances the cat's body overlaps (thread D bends them). Emit `rustle(density, speed)` while overlapping.

- Granular: grains at a rate of `6 + 30 x speed x density` per second (cap 40). Each grain: white → bandpass at a random 3000-8000 Hz, Q 1.2, attack 4 ms, tail 25-70 ms, gain `0.004 + 0.010 x speed`, pan ±0.3 random.
- Broad leaves (shrubs with large leaves): add a second, lower grain family at 900-1800 Hz, tail 60-120 ms, gain x 0.7 (leaf slap).
- Dry grass and restio: centre 6-10 kHz, tails 15-30 ms (a hiss).
- On leaving the plant: one spring-back: white → bandpass 2500 → 1200 Hz, attack 20 ms, tail 180 ms, gain 0.008.
- Standing still inside a plant: silence. The rustle must stop the moment the cat does.

### Body

- **Meow**: keep the synthesis. Level 0.22 → 0.16. Add a second variant chosen by context: short greeting (0.35 s, peak 620 Hz) when an animal is within 4 m; the long call (as now) otherwise.
- **Purr**: 0.35 → 0.10, and start it only after 12 s. Raise the lowpass to 420 Hz and add a second partial: the same pulsed noise through a bandpass at 110 Hz Q 3, gain 0.5, so small speakers reproduce something.
- **Jump**: keep. **Land**: by surface: sand as now; rock adds the rock tap x 2; timber the timber knock x 1.6; water is `splash`.
- **Shake**: keep the flutter; add 6-10 droplet blips (shallows layer b) over the following 0.5 s if the cat is wet.

## 5. Water, the boat, and the boiler

### Water by depth

| Depth (walker) | Sound | Recipe |
|---|---|---|
| Swash, `wade` < 0.15 | shallows steps (section 4) | plus the near-swash voice below |
| Belly deep, `wade` 0.15-0.5 | sloshing strides | per stride: pink → lowpass 800 Hz Q 1, attack 30 ms, tail 220 ms, gain 0.035; a continuous pink → bandpass 600 Hz Q 0.8 at gain `0.02 x speed` |
| Swimming, `swim` > 0.5 | paddle strokes, breath | stroke (existing `setSwim`): pink → lowpass 700-1000 Hz, attack 20 ms, tail 120 ms, gain 0.03; every stroke a bubble blip at 500-900 Hz, gain 0.006. Every 2.5-4 s a small nasal breath: white → bandpass 1900 Hz Q 2.5, attack 60 ms, tail 180 ms, gain 0.008 |
| Coming out | drips | 8-14 bubble blips over 1.5 s, rate falling, gain 0.005, then the automatic shake |
| Entering at a run | `splash` (existing) | add a low body: sine 110 → 60 Hz, attack 5 ms, tail 120 ms, gain 0.04 x strength |

**Near-swash voice** (`amb`): one extra looping pink source → bandpass 2500 Hz Q 0.5, gain `0.05 x smooth(6, 0, |shoreDistance|)`, amplitude driven by the swash phase the surf shader already computes (`surf.js`; if the phase is not exposed on the CPU, use a 0.11 Hz raised cosine and say so). At the top of each run-up add the fizz: white → highpass 5000 Hz, attack 0.3 s, tail 1.4 s, gain 0.012. Tie `nextWave` to the same phase so the breaking-wave burst and the picture agree.

**Tideglow has no sound of its own.** Light answering in silence is stronger; do not add sparkles.

### The boat

All on `world`, positioned at the hull when the cat is ashore; when aboard, not positioned (pan ±0.2 by event side) with 15 % send B.

| Event | Recipe | Trigger |
|---|---|---|
| **Hull slap** | sine 130 → 85 Hz, attack 3 ms, tail 90 ms, gain 0.05; with pink → bandpass 520 Hz Q 1.5, attack 4 ms, tail 70 ms, gain 0.03; then white → highpass 3500 Hz, attack 20 ms, tail 160 ms, gain 0.008 (the lick of water after) | existing `hull-slap` event (`main.js:1111`), gain by its strength |
| **Creak** | stick-slip: sawtooth 70-110 Hz with ±20 Hz jitter from a 30 Hz random LFO → bandpass 900-1500 Hz Q 12 (centre glides 10 % over the creak) → gain 0.012, attack 30 ms, length 180-420 ms, amplitude multiplied by lowpassed noise (cutoff 40 Hz) for raggedness | each zero crossing of roll rate above a threshold, at most one per 1.2 s; none in flat calm |
| **Wake** | continuous pink → bandpass 1300 Hz Q 0.7, gain `0.03 x (speed / top)²`, eased over 0.5 s; plus bow chuckle: bubble blips at 400-900 Hz at a rate of `2 + 10 x speed / top` per second, gain 0.005 | while under way |
| **Boarding** | timber knock x 1.5 with the deck resonances (150, 260 Hz), one hull slap at 0.5 | `board` event |
| **Hop on the upturned hull** (audit no. 7) | hollow knock: exciter 4 ms → bandpasses 120 Hz Q 20, 215 Hz Q 16, 370 Hz Q 12, gains 1, 0.6, 0.3 x 0.05, with 30 % send B. A crab scuttle from under it (section 7) 0.3 s later | `on-top` affordance |
| **Launch** | keel on sand: brown → bandpass 400 → 700 Hz Q 1.2, amplitude roughened by a 22 Hz square at 50 % depth, gain 0.05, 2.5 s, rising then cut by the plunge (existing `splash(1)`) and one hull slap | `launch` event |
| **Grounding** | sand scrape 0.4 s (as launch, gain 0.04) and one timber knock | `ground` event |
| **Lantern** | glass and wire tick when the boat rolls past ±6°: sine 2900 Hz and 4350 Hz, attack 1 ms, tail 40 ms, gain 0.004 | roll; at most one per 0.8 s |

### The boiler (audit no. 3)

A shared resonator node graph, built once, that anything can be sent into while the cat is inside:

- Input → a feedback delay of 9.5 ms (a 2.4 m drum's round trip is about 14 ms; shorter reads as metal, not as a room), feedback 0.82 through a lowpass at 2800 Hz → output; in parallel four bandpasses at 73, 147, 196, 418 Hz, Q 30, mixed at 0.5. Decay about 1.2 s.
- While `inside` (affordance): `foley` and `voice` send 0.6 into it; `amb` gets a lowpass at 900 Hz and -6 dB (the sea goes dull and distant; this change is half the effect).
- **A meow inside**: the dry meow at -6 dB, then the resonator's own reply: a sine at 73 Hz (D2) with partials at 2.0 x and 2.76 x (gains 1, 0.4, 0.2 x 0.12), attack 80 ms, tail 3.5 s, starting 120 ms after the meow. This is "comes back as a deep bell note".
- Rain on the boiler from inside: the roof-drum recipe (section 6) with modes 196, 418, 733 Hz, through the resonator.

## 6. Weather and shelter

Rain becomes layers chosen by what is around the cat, all on `weather`. `r` is rain in mm/h, `k = min(1, r / 8)`.

| Layer | Recipe | Gain | Heard when |
|---|---|---|---|
| Open rain (air) | white loop → highpass 1800 Hz → lowpass 9000 Hz | 0.06 x k | not under cover |
| On sand | pink loop → bandpass 1400 Hz Q 0.5 | 0.04 x k x (1 - trees) | open ground |
| On leaves | existing leaves bed (highpass 2600 Hz) plus drips: white → bandpass 1500-3500 Hz Q 5, tail 35 ms, at `20 x k` per second, gain 0.012, pan random | 0.05 x k x trees | in or near the wood |
| On the sea | white loop → bandpass 6500 Hz Q 0.6 (a fine hiss) | 0.04 x k x sea | within 15 m of the water |
| **On the iron roof** | each drop: white burst 2 ms → three parallel bandpasses at 240, 510, 1150 Hz with Q 22, 18, 14 and gains 1, 0.7, 0.4, plus a click (highpass 4000 Hz, 3 ms) at 0.3. Rate `8 + 60 x k` per second, Poisson; gain per drop 0.010-0.022 random. Positioned at the cottage roof, ref 10 m. Under heavy rain (k > 0.7) add a bed: white → bandpass 600 Hz Q 2 at 0.03 so single drops merge into a drum roll. | by distance | within 60 m of the cottage |
| Gutter and tank | every 0.6-1.4 s at the downpipe: bubble blip 900 → 500 Hz (falling), tail 60 ms, gain 0.012, through a 160 Hz Q 10 bandpass at 0.3 (the tank's body) | by distance | within 15 m |
| Big drips under the milkwood | at `0.5 + 3 x k` per second: brown → lowpass 900 Hz, attack 2 ms, tail 50 ms, gain 0.02, plus one leaf-litter grain | — | under the crown |

**Shelter** uses the prop contract's `covers` (the same rectangles `precipitation.js` uses to keep rain off the cat), so sound and picture cannot disagree:

- **Under the eave** (the sill, audit no. 2): open rain, sand and sea layers -12 dB with a lowpass at 1500 Hz, eased over 0.4 s; roof layer +6 dB, not positioned, with 20 % send B; gutter drip audible; `amb` wind -4 dB. Dry and loud above, soft and far outside: that contrast is the joy.
- **Under the milkwood**: open rain -9 dB, leaves layer +3 dB, big drips on.
- **In the boiler**: open rain -15 dB, the boiler drum on.
- **Aboard**: rain on timber: the on-sand layer swapped for timber knocks at 30 % of the drop rate, gain 0.008.

Wind: keep the bed. Add gusts that the grass shader's gust phase drives (or a 0.07 Hz random walk): pink → bandpass 350-900 Hz Q 0.9 sweeping up through the gust, 2-4 s, gain `0.02 x wind / 10`. At the trig beacon above 8 m/s: a faint hum from the vanes: two sines at 180 and 183 Hz, gain 0.004, amplitude following the gust.

Thunder: keep the synthesis. Level `0.42 → 0.30`, and send it through `weather` so the ducking rule applies.

## 7. Animals: voices and reactions

All on `world`, positioned. Every animal gets an idle voice (rare) and a reaction voice (what it does about the cat). Rates are per animal unless said.

| Animal | Idle | Reaction to the cat | Recipe notes |
|---|---|---|---|
| **Cat** | section 4 | n/a | |
| **Penguin** | the existing bray, from one bird every 40-90 s by day | **Looks at you** (cat within 7 m): a soft "haw": sawtooth 300 → 260 Hz, 0.18 s, formants 700 Hz Q 4 and 1400 Hz Q 5, roughness 0.3 at 40 Hz, gain 0.03. **Parade** (audit no. 10): foot pats: pink → lowpass 900 Hz, tail 30 ms, gain 0.008, two per step per bird, at most three birds voiced. **Scatter**: three quick haws from different birds, pitch +20 %, and wing pats (white → bandpass 1200 Hz Q 1, tail 50 ms, six per second for 1 s). **Porpoising**: small splash at 0.4. | bray gain 0.10 → 0.07 |
| **Seal** | existing bark, one seal every 30-70 s | **Lifts its head** (cat walking within 10 m): a snort: pink → bandpass 600 → 300 Hz Q 1.5, attack 15 ms, tail 220 ms, gain 0.04. **Bumped**: a groan: sawtooth 110 → 85 Hz, 0.5 s, formants 400 Hz and 900 Hz, roughness 0.5 at 22 Hz, gain 0.05. **Enters the water**: `splash-big` at size 0.6. **Wins the race** (audit no. 11): two barks, pitch +10 %. | |
| **Gull (on the sand)** | the existing "kee-ow", but emitted by an actual bird at its position, every 15-40 s per flock | **Flushed**: three calls, 15 % faster and higher, then wingbeats: white → bandpass 900 Hz Q 0.8, attack 30 ms, tail 70 ms, gain 0.012, 4 per second, fading over 2 s as it climbs | delete the unpositioned `nextGull` timer |
| **Oystercatcher** | none | **Flushed** (audit no. 13): piping "kleep-kleep-kleep": each note a sine 3600 → 3000 Hz in 60 ms with a 2nd harmonic at 0.25, attack 4 ms, tail 50 ms, gain 0.03; a run of 6-10 notes accelerating from 5 to 9 per second, then slowing as it lands 20 m on | carries far: ref 8 m |
| **Tortoise** | none | **Withdraws** (cat arrives fast): a hiss: white → highpass 3000 Hz, attack 20 ms, tail 250 ms, gain 0.012. **Patience** (audit no. 12): shell scrape as it steps: brown → bandpass 500 Hz Q 2 with a 12 Hz roughness, 0.3 s, gain 0.012; **eating**: three or four crisp bites 0.4 s apart: white → bandpass 2800 Hz Q 3, tail 25 ms, gain 0.010 | ref 1.5 m: you must be close, which is the point |
| **Ghost crab** | none | **Bolts**: scuttle: clicks (white → bandpass 4500 Hz Q 12, tail 5 ms, gain 0.008) at 25 per second for 0.4-0.8 s, slowing. **Stands its ground** (if built): two slow claw clicks at 3000 Hz | |
| **Butterfly, fireflies, jellies, anemones, fish** | silence | silence, except **anemones closing** (audit no. 6): one soft bubble blip at 500 Hz, gain 0.004, per anemone, at most four | fireflies must stay silent; their quiet is part of them |
| **Whale** | existing blow, at the whale's position, ref 90 m | **Answers a meow** (audit no. 14): tail slap: white → highpass 800 Hz crack 8 ms at 0.2, then pink → lowpass 1200 → 200 Hz, tail 0.9 s at 0.15, then `splash-big`; delayed by distance / 343 m/s like thunder | |
| **Dolphin** | none | **Rides the bow**: a puff: white → bandpass 2200 Hz Q 0.9, attack 15 ms, tail 130 ms, gain 0.03, at each surfacing; a small splash on re-entry | |
| **Owl** | the existing `owl` call from the milkwood crown, every 3-6 minutes at night | **Answers a meow** within 40 m at night (first-visit audit, discovery 1): the same call 1.5 s after the meow, pitch -4 % | already synthesised, never triggered |
| **Crickets** | existing chirp, but from 5-7 fixed positions in grass around the cat, re-seeded as it moves | **Hush** (first-visit audit, discovery 6): any cricket within 6 m of a moving cat is silent; resumes 4-8 s after the cat has passed or 10 s after it sits | gain 0.012 → 0.008; at most 4 chirps per second in total |

## 8. Interactions and ceremonies

### One sound per interaction in the object audit

Each is the smallest sound that confirms "that was you". On `world` unless noted.

| # | Interaction | Sound |
|---|---|---|
| 1 | Lighthouse beam looks at you | Silence for the swing. When the beam holds the cat: a low warm hum fading in over 0.8 s: sines at 98 and 147 Hz (G2, D3), gain 0.012, lowpass 400 Hz, held 4 s, 1.5 s release. The half-attempt blink: one relay click: white → bandpass 1500 Hz Q 6, 6 ms, gain 0.01, from the lantern room (so it arrives a moment late: 16 m is 47 ms) |
| 2 | The sill | Hop: timber knock. Lamp warms: nothing. In rain: the shelter mix of section 6 is the sound |
| 3 | The boiler | Section 5 |
| 4 | Milkwood limb | Timber steps with the low resonances (150, 260 Hz); at the fork, one long soft creak (the boat creak recipe at 60 % pitch, gain 0.008) |
| 5 | Cairn-top view | Wind bed +4 dB and its bandpass centre up to 800 Hz over 3 s as the camera rises; the gust in the grass on arrival is the gust voice once. No chime |
| 6 | Anemones and klipfish | Anemone blips (section 7). Fish return: two shallows blips, gain 0.004 |
| 7 | Hop-launch the boat | Section 5: hollow knock, crab, launch |
| 8 | Jellies rise | Silence |
| 9 | Warm rock | The purr starts after 4 s instead of 12 |
| 10 | Penguin parade | Section 7 |
| 11 | Seal race | Section 7 |
| 12 | Tortoise patience | Section 7 |
| 13 | Oystercatchers lead | Section 7 |
| 14 | Whale answers | Section 7 |
| 15 | Butterfly on the ear | One ear flick: white → bandpass 3000 Hz Q 2, tail 15 ms, gain 0.006. Nothing for the butterfly |

**The discovery chime** stays (D5, A5, E6) at 0.11 → 0.06 and plays only for discoveries that answered (the first-visit audit's rule), never within 8 s of a ceremony.

### Ceremony phrases

Keep the seven motifs in `score.js CEREMONIES`: they are composed, in mode, and tested. Changes:

1. **Move them to the `magic` bus**, so they play with the music switch off (at -3 dB in that case, with no pad, phrase only).
2. **One event, not three.** Fold the `wake` call's bloom (D2, A2, D3 swell and the rising air) into the ceremony as its first 1.8 s (the motif's existing `lead`); drop the `wake` bells, which double the phrase; suppress the discover chime.
3. **Give each gift's phrase the timbre of its light**, so the sound says which gift without a card. All use the existing `pluck` envelope shape unless noted:

| Gift | Voice for the phrase | Reason |
|---|---|---|
| fireflies | sine with a 2.76 x partial at 0.15, attack 3 ms, decay 0.9 s; each note repeated once, 90 ms later, at 0.3 and an octave up | glass, with an afterglow |
| tideglow | sine pair detuned ±3 cents, attack 120 ms (bowed, no pluck), decay 1.8 s; under each note pink → bandpass at the note's frequency x 4, Q 2, gain 0.1 of the note | a swell arriving |
| lamp | triangle → lowpass 1400 Hz, plus a 2.0 x partial at 0.25, attack 25 ms, decay 2.4 s | warm, steady, lower |
| stars | sine, attack 2 ms, decay 3 s, amplitude trembling at 6 Hz by 20 %; an octave-up echo 0.31 s later at 0.25 | high and far |
| seafolk | sine gliding down a semitone into each note over 150 ms, formant bandpass at 700 Hz Q 3 in parallel at 0.3, decay 2 s | a voice from the water |
| boat | plucked string: white burst 6 ms → delay line at 1 / f seconds with feedback 0.96 through a lowpass at 3500 Hz (Karplus-Strong with `DelayNode`); decay about 1.2 s | wood and a taut line |
| finale | each phrase note in the timbre of the gift whose colour the wisp is showing, in the order the gifts were woken; the last three notes in all six, quietly, ending on D | "six gifts, one island" |

4. **Length**: the stars ceremony is the model (the picture and the phrase end together). Trim any phrase whose tail outlasts its card by more than 2 s.

**The wisp's answer** (D6, A6, D7): keep, at 0.065 → 0.045; raise its distance law so it is silent beyond 25 m (a reply you cannot see is confusing).

## 9. CPU budget and verification without ears

### Budget

| Limit | Value | How it is held |
|---|---|---|
| Sustained sources (loops) | ≤ 14 | 5 beds + near-swash + up to 4 rain layers + wake + purr + rustle carrier + 1 spare |
| One-shot voices alive | ≤ 24 typical, ≤ 40 peak | a voice pool with priorities: `voice` and `magic` never stolen; then `world` nearest first; then `foley`; `weather` drops first. A new voice over the cap replaces the quietest of the lowest priority |
| Node creations | ≤ 150 per second peak, ≤ 40 per second averaged over 10 s | heavy rain on the roof is the worst case (68 drops/s x 5 nodes): above 40 drops/s, voice one drop in two at +3 dB and let the merge bed carry the rest |
| Convolvers | 1 (send B, 0.35 s mono) | the outdoor reverb stays a delay network |
| HRTF panners, AudioWorklets, ScriptProcessors | 0 | |
| Noise buffers | three mono 2 s buffers (about 1.1 MB at 48 kHz) instead of three stereo 3 s (3.4 MB); decorrelate left and right by starting two sources at different offsets | |
| Main-thread scheduling | ≤ 0.2 ms per frame mean, ≤ 1 ms worst | all scheduling in one `update` at 30 Hz, look-ahead 0.1 s; no per-frame node creation outside events |
| Audio render load | mean ≤ 0.10, peak ≤ 0.35, zero underruns, on the phone budget path | Chrome's `AudioContext.renderCapacity` (`averageLoad`, `peakLoad`, `underrunRatio`) where the browser exposes it (check: it has not shipped everywhere; fall back to counting voices and node creations), sampled once a second under `?perf` and written to `#landscape.dataset.audioLoad` beside the mesh timings |
| Silence | a hidden tab suspends the context (exists); with sound off, no nodes are created at all | `step`, `splash` and the rest already return early; make every new entry point do the same |

Performance comes first on this site (the owner judges by fan noise): if the audio load figure cannot be met on the phone path, cut rain-drop voices first, then rustle grains, then occlusion checks.

### What an agent can check

Three layers of test, cheapest first.

**a. Patches as data (pure node, `node --test`).** Move every recipe into `src/sound-patches.js` as plain data: `{ bus, ref, layers: [{ source, filter, f, to, q, attack, tail, gain, at }] }`. Tests assert without rendering:

- every patch names a bus and, if positioned, a `ref`;
- peak gain per patch is under its bus's ceiling (foley ≤ 0.08, world ≤ 0.25, magic ≤ 0.12, voice ≤ 0.2);
- every footstep surface 0-9 has a patch, and each differs from every other in spectral centroid estimated from its layers by at least 15 %;
- no patch is longer than its declared `maxSeconds`;
- the trigger table is total: every walker, boat, affordance and wildlife event name maps to a patch or to an explicit `null` ("silence on purpose").

**b. Offline render (headless Chrome, `OfflineAudioContext`).** Node has no Web Audio; `createSound({ context })` already accepts an offline context. Add `scripts/audio-probe.mjs` (launch Chrome as `scripts/tour.mjs` does, import the modules from the dev server, render, return `Float32Array` channel data over CDP as base64) and `tests/audio/*.test.js` that skip when Chrome is absent. Seed the noise buffers (replace `Math.random` in `noiseBuffer` with `seededRandom`) so renders are repeatable. Assertions:

| Assertion | Method | Example thresholds |
|---|---|---|
| Loudness per bus and for the mix | BS.1770 K-weighting (two biquads), 400 ms blocks, absolute gate -70 LUFS and relative gate -10 LU, written in about 60 lines of JS in `tests/audio/loudness.js` | each bus within ±2 LU of the table in section 2; mix -30 ±2 |
| True-peak ceiling | 4x oversampled peak | ≤ -6 dBTP in every scene except thunder (≤ -3) |
| Limiter idle | render with and without the limiter; RMS difference | < 0.3 dB outside thunder |
| Spectral identity of each footstep | 2048-point FFT, Hann, averaged over the step; centroid and 85 % roll-off | dry sand centroid 500-1100 Hz; wet sand 300-700 Hz; grass 3.5-7 kHz; rock 2-3.5 kHz with roll-off > 5 kHz; timber: peaks within ±8 % of 210 and 340 Hz; metal: peaks within ±5 % of 196, 418, 733, 1210 Hz and energy still above -40 dB re peak at 0.5 s |
| Envelope shape | RMS in 5 ms windows: attack time (10 → 90 %), T60 from a line fit to the log envelope | rock attack < 4 ms; dry sand attack 8-20 ms; boiler T60 1.0-1.5 s; cottage roof drop T60 < 0.25 s |
| Distance law | the same call rendered at 1x, 2x, 4x `ref` | level drops 4.8 ±0.5 dB per doubling; centroid falls monotonically |
| Pan | a source at bearing +90° and -90° | inter-channel level difference has the right sign and is ≥ 8 dB beyond 2 m |
| Shelter | rain 4 mm/h, in the open against under the eave | open-rain band (2-9 kHz) down ≥ 10 dB; roof modes (240, 510, 1150 Hz) up ≥ 4 dB |
| Silence where it should be | standing still in a bush for 3 s; fireflies awake; tideglow stirred | foley bus under -70 LUFS; no new voices |
| Answering | meow near crickets, penguins, the owl | cricket voices within 6 m: zero onsets for 4 s after the cat moves; owl onset 1.5 ±0.2 s after the meow |
| No clicks | first-difference of the signal | no sample-to-sample step above 0.25 full scale at voice starts and stops |
| Determinism | the same seed twice | sample-identical |

**c. In-page counters under `?perf`.** Live voice count, node creations per second, `renderCapacity` load, limiter reduction (`compressor.reduction`), written to `dataset` for the tour script to read while the cat runs a fixed route through sand, grass, wood, swash, the boat and rain. Fail the tour if any budget row in the table above is broken.

What none of this can tell: whether the sand sounds like sand, whether the meow is charming or grating, whether the mix is pleasant. Only the checklist below can.

## 10. Listening checklist for the owner

Run this after the pass is implemented (today's build has only the sounds in section 1, so items 3, 7, 8 and 9 and parts of 5 will not be there yet: report "not built"). Headphones first, then the laptop's speakers, then the phone. System volume where you would normally have music. Please report by number: "3 ok", "5 too loud", "7 sounds like static", "9 nothing happened". Two or three words each is enough.

1. **Stand still on the home beach at noon for 30 seconds.** You should hear a low, slow sea that breathes, a wave rushing up and back every several seconds in time with the waves you see, light wind, perhaps one gull from where the gulls are. It should be quiet enough that you could leave it on while working. Nothing should sound like radio hiss.
2. **Walk, then run, from the wet sand at the water's edge up onto dry sand, then into grass, then under trees.** Each surface should sound different without looking: wet sand dark and firm, dry sand soft and whispery, grass a light brushing, the wood with an occasional twig. Running should be quicker and a little louder, not harsher. The steps should fall with the paws.
3. **Push through a bush, stop inside it, then walk out.** Leaves should rustle only while you move, stop when you stop, and give one soft spring-back as you leave.
4. **Walk into the sea until you are swimming, turn and come out.** Paw plips in the shallows, then sloshing, then soft paddling with a small breath now and then; drips and a shake as you come out. The sea itself should get closer and brighter at the edge, not just louder.
5. **Press m to meow in three places: on the open beach, near the penguins, and at night near the big milkwood.** On the beach: the meow, then a small three-note glassy answer from the little light. Near penguins: a short, soft "haw" back from one bird. At the milkwood at night: about a second and a half later, an owl's "hoo, hooo" from the tree. The meow itself should sound like a small cat, not a synthesiser.
6. **Sit still until the cat purrs.** A low, soft, fluttering purr that you notice only after a moment, quieter than the sea. It should be audible on the laptop speakers as well as headphones.
7. **Set the weather to rain and walk from open ground to under the cottage's eave (or under the milkwood).** In the open: a soft full rain, lighter on sand, brighter near the sea. At the cottage: the iron roof should ring and drum from where the roof is as you approach. Under the eave: the rain outside goes soft and distant, the roof is loud overhead, a gutter drips. This contrast is the main thing to judge.
8. **Take the boat out at night.** Stepping aboard: a hollow wooden knock. Under way: water chuckling at the bow, a soft hiss of wake that follows your speed, an occasional slap on the hull and, in a swell, a slow creak. Stopped: nearly silent, a slap now and then. No splash sounds that seem to belong to the cat.
9. **Walk into the wreck's boiler and meow.** Steps should go metallic and ring; the sea should go dull and far; the meow should come back as one deep bell-like note that hangs for a few seconds. (If the boiler is not built yet, report "9 not built".)
10. **Wake one gift, at night (the wreck is the easiest).** One musical phrase of a few seconds, in a tone that suits the light you see (the tide's is slow and swelling; the fireflies' is small and glassy), with the sea and the music dipping under it and coming back. One event: not a chime, then bells, then a tune. It should make you look at the place, not at the speakers.

After the ten, one open question: **was there any moment you wanted to turn the sound off?** Say where.
