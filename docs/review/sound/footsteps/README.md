# Footsteps rework (15 Nov 2026)

The owner listened in the live site and said "sound design is off (for footsteps)". This folder is the before-and-after evidence. Nobody has listened to the new version yet either: please try the audition page's item 2 (`/?audition`), then walk the beach.

## What was wrong

1. **The sounds were wrong for a cat.** The first pass voiced footsteps as audible foley: claw ticks, twig snaps, high-passed clicks, sine "taps", ringing wood modes, water plinks. Attacks were as short as 1 ms, and walking sat only 6–11 LU under the beach's ambient bed. A cat's walk is close to silent.
2. **The surface was wrong.** The walker called any raised surface "rock": the boat's deck, the stoep, sills, steps, the wreck's keelson and the milkwood's roots. The sound side then guessed timber from the boat's *original* landing place and from anything within 5 m of the milkwood. The sand, scrub and forest bands were fixed distances from the shore (1.7, 6 and 11 m) that no longer match the ground the shader paints: the walker said "wet sand" up to 1.7 m inland, but the painted wet band ends at about 0.85 m.
3. **Dry rocks played water.** The swash film was laid on top of whatever surface it was given (`sea-surface.js` `at()`), so a boulder top or a beached deck at the tideline counted as shallows. That meant water plips, splash rings and wet paws on dry rock.
4. **Steps could trail the paws.** The audio context asked for `latencyHint: "playback"` (larger buffers). It is now "interactive" (measured in Chrome: 5 ms base plus 24 ms output latency).

## What changed

- **Recipes** (`src/sound/patches.js`):
  - Filtered noise only; nothing is pitched except inside the boiler.
  - Attacks 8–15 ms (8–10 ms measured from 10% to 90%), everything below about 3 kHz (85% roll-off ≤ 3.1 kHz), tails 15–140 ms.
  - Sand is a faint soft compression; grass a whisper; rock almost nothing; timber and the deck a soft low pad; the swash a soft wet pad. The boiler is a pad that the iron rings with faintly.
- **Level**: walking is about 20 LU under the home beach's bed, about 10 dB quieter than before. A run is about +10.5 LU over a walk (front paws only, at most about 8 a second), so still about 10 LU under the bed.
- **Variation**: every step varies ±3 dB in level, ±10% in its filters, ±15% in length and up to 8 ms in timing. Hind paws are 1.5 dB softer and 15% darker than front paws.
- **Surface from what is under the paw**:
  - `walker.surfaceAt(x, z)` (one new helper in `walker.js`) says which surface won: the deck, a place's tile, a boulder, the seabed or the ground.
  - `src/sound/surface.js` maps a tile to its place's material: stone for the lighthouse, stoep, sills, steps and the cairn; timber for the wreck's keelson, the boat and the milkwood; iron for the boiler.
  - For the ground it mirrors the ground shader: the wet band (below 0.85 m), litter under a crown, granite where the rocky mask is, painted strandveld, sour-fig mats (voiced as grass), dry sand to about 7 m, turf beyond.
  - The prop contract's covers now drive shelter (the eave, the crown) and the boiler's inside.
- **The swash film** lies on the sand height, never on a boulder top or a deck.
- **Tests** (`tests/audio/footsteps.test.js`):
  - Recipes have no pitch, no clicks and soft attacks; every surface's rendered attack is at least 4 ms and its roll-off under 4 kHz.
  - Walking is at least 15 LU under the bed, a run at least 7 LU under it and at least 6 LU over a walk.
  - Steps vary; at a run only front paws sound, and a double trigger is dropped.
  - The live resolution path is tested: deck, keelson, boiler top and inside, stoep, milkwood roots, a boulder by the milkwood (rock, not timber), wet versus dry sand at 0.3 and 1.5 m.
  - The swash never wets a boulder top.

## Numbers

Walking: four paws, one every 0.23 s. Running: front paws, one every 0.17 s. Rendered through the whole chain. The home-beach bed is −32.8 LUFS.

| surface | walk before | walk after | under the bed after | run after | attack after | centroid before → after |
|---|---|---|---|---|---|---|
| dry sand | −42.9 | −53.1 | 20.3 LU | −42.5 | 8 ms | 827 → 631 Hz |
| wet sand | −44.3 | −53.0 | 20.2 LU | −42.4 | 9 ms | 473 → 318 Hz |
| grass | −44.1 | −55.0 | 22.2 LU | −44.3 | 10 ms | 6397 → 1941 Hz |
| scrub | −44.0 | −54.0 | 21.2 LU | −43.5 | 5 ms | 4194 → 1340 Hz |
| leaf litter | −42.5 | −54.1 | 21.3 LU | −43.5 | 5 ms | 2762 → 1016 Hz |
| rock / stone | −49.6 | −59.0 | 26.2 LU | −48.3 | 6 ms | 4393 → 742 Hz |
| pebbles | −50.9 | −57.1 | 24.3 LU | −46.2 | 20 ms | 1912 → 1121 Hz |
| timber | −38.7 | −52.0 | 19.2 LU | −41.2 | 10 ms | 234 → 246 Hz |
| deck | −38.1 | −51.0 | 18.3 LU | −40.2 | 8 ms | 175 → 207 Hz |
| swash | −40.1 | −50.7 | 17.9 LU | −40.2 | 8 ms | 1086 → 802 Hz |
| boiler (metal) | −39.9 | −49.0 | 16.2 LU | −38.5 | 9 ms | 299 → 298 Hz |

Before, attacks were 1–2 ms for rock, pebbles, the deck and leaf litter. Full tables: [before/table.md](before/table.md) and [after/table.md](after/table.md). Each row's spectrogram is beside it (eight walking steps, log frequency 40 Hz to 20 kHz).

## Timing against the animation (live site, seed 1847, headless Chrome)

`timing.json` comes from `node scripts/footstep-log.mjs 5352 9422 docs/review/sound/footsteps/timing.json`. It logs every footstep main.js asks for, with the paw, the time, the speed, the walker's kind, what is under the paw, and the surface resolved. It covers a walk inland from the swash, standing, a run inland, standing, and moving sideways. It also logs the surface at every made tile and every named spot of every place.

- **Steps fire at touchdown.** `cat.js` calls `footstep()` from the paw's stance transition (the review confirmed this, with no double firing). The sound is scheduled 10 ms ahead, plus up to 8 ms of jitter, plus about 29 ms of output latency: roughly 40–50 ms after the paw lands.
- **Walk (0.95 m/s)**: four even beats, 115–135 ms apart, in the order right hind, left fore, left hind, right fore. That is a four-beat *diagonal*-sequence walk; a cat's own walk is a lateral sequence (a hind then the fore on the same side). That is the cat lane's gait table (`cat.js` `WALK`), not sound.
- **Run (3.4 m/s)**: the fore pair lands 20–50 ms apart and the hind pair likewise, a stride about 0.33 s. Only the first fore paw of each stride sounds (front only, at least 120 ms apart), so about 3 steps a second, never a machine-gun.
- **Standing**: no steps (the paws' settling while stopped does not call `footstep()`).
- **Slow walking makes no steps at all.** `cat.js` only calls `footstep()` when the gait amplitude is over 0.25. Walking by tap at about 0.4 m/s produced no footsteps, and the first walk in the log went 4 s without one while the cat got up to speed. That is the cat lane's gate. It may be part of what sounded "off" (steps appearing and vanishing with speed).
- **Surfaces along the walk inland**: wet sand to 0.8 m; dry sand to about 2–3 m; sour-fig mats (soft, voiced as grass) 3–6.5 m; strandveld 6.7–10 m; turf at 10.9 m; leaf litter under the crowns from 11 m. Earlier the walker's fixed bands called 0.85–1.7 m "wet sand", and everything raised "rock".
- **Every made thing**:
  - stone: the lighthouse light, its door, the cottage sill and stoep, the beacon's top step, the pool rim;
  - timber: the milkwood's fork and roots, the wreck's keelson, the boat's six tiles;
  - metal: the wreck's boiler and bell spot.
- **Water at 2–2.7 m inland during the run's first steps**: the swash running up the sand (film 2–3 cm), not a rock; after the fix, boulder tops never get the film.

## Not changed (other lanes)

- **The walk's gait order** (diagonal versus lateral sequence) and **the amplitude gate on slow walking** are in `cat.js`.
- **Deck knocks from a still cat when the boat turns in rough water** (code review finding 12) come from `boat-ride.js`'s held-cat gait.
- **Turning on the spot** plays no pads, because the stopped-paw settling does not call `footstep()`. Giving it a soft single pad is a one-line hook in `cat.js` for that lane.
