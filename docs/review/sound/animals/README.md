# Animal voices rework (15 Nov 2026)

The owner, on the live site: "the sounds are annoying theres some dominating animal noise". This folder holds the measurements that found the culprit and the before and after numbers. Nobody has listened to the result yet. Please try the audition page's item 11 (`/?audition`), then stand at the spawn for a few minutes.

## How it was measured

- **Live logs.** `node scripts/animal-log.mjs 5352 9422 <out.json>` runs one headless Chrome on the dev server, muted, with the audio running. It logs every animal voice the sound engine was asked for: when, which, where from the listener, and whether it was played or held back (and why). The scenes:
  - seed 1847 at noon, standing at the spawn for 5 minutes;
  - seed 1847 at dusk and at night, 90 s each;
  - seeds 2 and 3 at noon, 90 s each;
  - a 60 s walk along the beach past the penguins.

  Files: `before.json` and `after.json`.
- **Loudness.** `node scripts/animal-loudness.mjs <log.json> <out.md>` renders each played voice alone, off-line, from where it was heard: the level after the distance falloff and panning. It compares each against that scene's ambient sound bed. Files: [before.md](before.md) and [after.md](after.md).
- **Tests.** `tests/audio/animals.test.js` replays the live `before.json` events through the current engine and asserts the limits below.

## The culprit: the penguin colony

Standing at the spawn on seed 1847 at noon, the colony 26–41 m away **brayed 115 times in 5 minutes (23 a minute)**. Brays loudest at −36.7 LUFS, 4 LU under the beach's ambient bed. Walking past the colony they reached −30.5 LUFS, 2 LU *over* the bed. The bray was a nasal donkey call: a sawtooth source with harsh formants. Seeds 2 and dusk were the same (15–22 a minute).

The cause: each bird re-rolls its idle act every few seconds with a 10% chance to bray, and braying is contagious. The sound side played every one.

Second offender: **the whale's blow at 100–115 m played at −33 LUFS, as loud as the bed itself**, twice a minute. Its distance law was too gentle: reference 90 m, gain falling as distance to the power 0.8.

Also played but should not have been:
- the oystercatchers' wary piping (about 2 a minute), triggered by the cat merely standing within 7 m;
- penguin splashes, 8–22 a minute.

Silent anyway: seal barks and splashes beyond 60 m (the animals' own events carry gain 0 out there).

## What changed (`src/sound/fauna.js`, `world.js`, `beds.js`, `calls.js`)

- **One gate for every animal voice** (`createFauna`):
  - at most one voice in any 6 s across species, never two at once;
  - a randomised gap per species: the colony at most once every 40–90 s, seals 50–110 s, gulls 45–120 s, the whale 45–120 s, the owl 3–6 min;
  - idle chatter fades out over the first minutes the cat stands still, and is gone after 3;
  - nothing speaks because the cat merely stands near (the penguins' threat display and the oystercatchers' wary piping are silent);
  - a startled animal answers once, not again for 25 s;
  - events beyond the animal's own reach are dropped before they use the budget.
- **Distance**: animals fall off as (ref / d)^1.25 and lose highs fast (12 kHz × e^(−d / 30 m), floor 700 Hz). The colony is faint from the spawn.
- **Level**: each voice is trimmed so it peaks at least 10 LU under the home beach's bed at its usual distance (`scripts/animal-calibrate.mjs`).
- **Timbre**:
  - the bray is now a soft far-off honk or two: a triangle source, broad low formants, little roughness, 50–90 ms attacks, 85% of its energy under 2.5 kHz;
  - the seal bark, gull, haw, oystercatcher piping, wings, snort, hiss and whale tail are softened the same way;
  - every call draws its pitch, count and lengths afresh, so no two are sample-identical.
- **Crickets**: half their old level, at most two chirps a second.

## Before and after (played voices)

| scene | before: played (per min) | after: played (per min) | loudest before | loudest after |
|---|---|---|---|---|
| seed 1847 noon, 5 min at the spawn | 256 (51): bray 115, penguin splashes 41, seal events 68 (gain 0, inaudible), whale 13, gull 10, piping 9 | 6 (1.2): bray 3, gull 2, whale 1 | bray −36.7, whale −32.9 LUFS | gull −46.3, whale −49.1, bray −59.6 LUFS |
| seed 1847 dusk, 90 s | 86 (57) | 5 (3.3) | whale −33.0 | gull −44.6 |
| seed 1847 night, 90 s | 21 (14) | 3 (2) | whale −33.1 | gull −42.7 |
| seed 2 noon, 90 s | 64 (43) | 4 (2.7) | bray −34.9 | gull −47.3 |
| seed 3 noon, 90 s | 43 (29) | 4 (2.7) | whale −35.2 | gull −45.2 |
| walking past the colony, 60 s | 43 (43) | 4 (4) | bray −30.5 (+2 LU over the bed) | startled haw at 3 m −43.6 (11 LU under) |

The bed is −32.6 LUFS throughout (the home beach). "Played" counts include voices too far away to hear (the seals' gain-0 events), which the old code also passed on.

## Not changed (other lanes)

The animals' own behaviour still asks for a bray every couple of seconds (`penguins.js` idle acts and contagion). The sound side now declines nearly all of them. If the animation also shows birds braying that often with their bills open, the penguin lane may want to slow it down too.
