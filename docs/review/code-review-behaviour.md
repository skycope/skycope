# Behaviour code review

Branch `magic-round2` at b00fa07, main checkout (the live build). Read-only.

- CONFIRMED: traced line by line in the code.
- PLAUSIBLE: the arithmetic is traced, but how often the trigger happens in play
  was not measured.

Each finding names the file that owns the fix, so it can be routed to the right
agent.

## Ranking (both passes, most severe first)

| # | Finding | File(s) to route | Status |
|---|---|---|---|
| 1 | The lens is pulled onto the pivot (inside the cat) when the cat is close to a solid: the boat hull while swimming beside it or after jumping out, a seal, the mooring post, a wall at its back. The tracer shrinks its pad to 0.7× the start distance, and the look-from-above blend then lands on the pivot. | `walker.js` 875-892, 929-935; `blockers.js` 183-186 | CONFIRMED mechanism; triggers PLAUSIBLE but common (the boat and seals) |
| 2 | The swash film is laid on top of boulders and a beached deck, whatever their height. Paws on dry rock at the tideline count as "in water": shallows footstep plips, splash rings, wet paws, and the cat can never sit there. | `sea-surface.js` 179-188 (callers `walker.js` 454, `main.js` 1206) | CONFIRMED |
| 3 | When a boxed-in cat finds no way out and hops, the hop height is the square root of a negative number, so `cat.vy` becomes NaN for good. The whole cat disappears and the camera is broken; nothing recovers it. | `walker.js` 363, 400-402 | CONFIRMED arithmetic; PLAUSIBLE trigger |
| 4 | Footstep surface: any height above the ground counts as "rock". The deck of a moored or drifting boat, the cottage, sills, timbers and crevice bridges play rock ticks. The sound side's timber check uses the boat's *original* place, not where the boat is now. Any rock within 5 m of the milkwood turns to timber. | `walker.js` 503, 1308; `main.js` 1203-1208; `sound/index.js` 103-111 | CONFIRMED |
| 5 | No test checks the lens's distance from the cat. The camera test's routes are all on land, away from hulls, seals and walls, so finding 1 cannot fail any test. | `tests/movement.test.js` 84-140 | CONFIRMED |
| 6 | The camera's pivot spring trails a running cat by about 0.5 m, and every guard places the lens relative to the trailing pivot, never the cat. | `walker.js` 807-815 | PLAUSIBLE |
| 7 | "Begin again" never puts the boat back to sleep. `boat-ride` has no path back to `asleep`, so a re-woken boat gift cannot relaunch, and the boat ceremony then frames a boat that is already in the cove. | `boat-ride.js` 190-224; `journey.js` 381-389; `quest.js` 102-108 | CONFIRMED |
| 8 | Haul-out spots are spaced 1.0 m apart, but seals are now 2.2–2.8 m long at WORLD_SCALE 1.4. Seals overlap each other, overhang the rock, and so do their solid capsules. | `seals.js` 175 (and the 0.35 slope test at 174) | CONFIRMED (the spacing); the overlap is visual |
| 9 | The trunk guard can push the lens sideways toward the cat when the arm is forced to its 0.9 m minimum. | `walker.js` 842-856, 1104 | PLAUSIBLE |
| 10 | Footsteps play late on some machines. The audio context is created with `latencyHint: "playback"` (large buffers), and every step is scheduled at `currentTime + 10 ms`, which moves in buffer-sized jumps. | `sound/index.js` 57; `sound/core.js` 140 | PLAUSIBLE |
| 11 | The footstep tests never touch the live path. They only play the exact-surface path, front paws only, at a fixed cadence. Nothing tests `surfaceFor`, the throttle, front-only steps at a run, or the walker-to-sound mapping, even though one test's name claims the mapping. | `tests/audio/footsteps.test.js` 13-31 | CONFIRMED |
| 12 | Aboard, the gait runs from the boat's yaw. A cat standing or sitting at the bow knocks deck footsteps, and lifts its paws while sitting, when the boat turns in rough water. | `boat-ride.js` 454-462; `cat.js` 380-385, 680 | PLAUSIBLE |
| 13 | `home()` (teleport) leaves escape, wall, turn, look and flow state behind. | `walker.js` 574-599 | CONFIRMED |
| 14 | The pivot only snaps on a horizontal jump over 3 m. A vertical jump, or the switch from boat pivot to cat pivot when the cat leaves the boat, is followed slowly on a spring. | `walker.js` 807-814 | PLAUSIBLE |
| 15 | `ride.leftAt` is written as `ride.t` (seconds into the current state), then `t` is reset to 0. It never holds a time, and nothing reads it: dead or broken API. | `boat-ride.js` 113, 516 | CONFIRMED |

---

# First pass (walker.js)

## A. Look-down-from-above blend can put the lens at the pivot, inside the cat (ranked 1)

`src/walker.js:879-892`, with `pullClear` at `:929-935`. CONFIRMED (see the second pass for the tracer semantics that make it happen).

**Defect.** When the boom is short (`near < 0.95`), the lens blends toward
`(tx + bx·up, ty + 1.6·up, tz + bz·up)`, with `up = min(rig.up, upClear + 0.3)`.
When something solid is close above or behind the pivot, `upClear` is about 0 and
`rig.up` eases to it, so the lens sits on the pivot. The pivot is at `cat.x/z`,
`targetY + 0.26·CAT_SCALE`: 0.36 m above the paws, mid-back, inside the ×1.4 body.
Afloat it sits right at the swimming cat's back.

`pullClear` (`:875`, `:891`) does the same: it scales the lens toward the pivot by
the trace fraction.

**Fix.** Add a final guard: if `hypot(lens − catHead) < ~0.45·CAT_SCALE`, push the
lens out along the boom or straight up; if that is blocked too, widen the aim.
Measure it against the cat's *current* position (see F). In `pullClear`, clamp
`f ≥ minLens/len`. In the blend, use `up = max(up, 0.35)`.

## B. A "no way open" hop can make the cat's state NaN for good (ranked 3)

`src/walker.js:363` with `:400-402`.

**Defect.** The pin escape sets `hop = true` without checking `wall.top`. The hop
then caps the jump speed with `Math.sqrt(2·g·(wall.top − cat.y + 0.12))`. That is
NaN when `wall.top` is `-Infinity` (its initial value, `:180`) or stale and lower
than the cat. `Math.min(vy, NaN)` is NaN, and from there `cat.y`, `cat.air`, the
rig, the wake and the camera all go NaN.

`cat.js heal()` resets its own springs but never the pose, so the root becomes
NaN and the whole cat is gone. The camera cuts on every frame (`NaN !== NaN`,
`:759`) and stays NaN.

**Fix.** Write `const need = wall.top - cat.y + 0.12;` and only cap when
`Number.isFinite(need) && need > 0`. Add a backstop at the end of `update`: if
`!Number.isFinite(cat.x + cat.y + cat.z + cat.vy)`, restore the last good pose
(or call `home()`) and log once.

## C. The lagging pivot spring (ranked 6)

`src/walker.js:807-815`.

**Defect.** The pivot's steady-state lag is `2v/ω`: about 0.49 m at `RUN_SPEED`.
The lens is placed relative to the lagged pivot.

**Failure scenario.** A cat running toward the camera, or past a wall that has
shortened the arm, overtakes the lens.

**Fix.** Measure the guard from finding A against the cat's current position, or
lead the pivot target by `v·2/ω`.

## D. The trunk guard can push the lens toward the cat (ranked 9)

`src/walker.js:842-856`, `:1104`.

**Defect.** The arm never goes shorter than `ARM_MIN` (0.9 m). With a trunk closer
than that behind the cat, the lens lands in the bark. The guard then pushes it out
radially from the trunk's centre, which can be toward the cat's flank.

**Fix.** Same guard as A, or lift the arm instead of forcing its length.

## E. Footstep "rock" includes decks and buildings (ranked 4)

`src/walker.js:503`, `surfaceKind` `:1308-1316`. Merged into the second pass's
footstep finding (S3).

## F. `home()` leaves state behind (ranked 13)

`src/walker.js:574-599`.

**Defect.** `home()` does not reset `rt.escape`, `rt.escapeUntil`, `rt.pinned`,
`rt.blocked`, `wall.*`, `cat.turn`, `rising`, `flow`, `soak`, `look` or `rig.look`.

**Failure scenario.** An escape heading or a stale wall normal steers the first
steps after a teleport, and a stale `wall.top` feeds finding B.

**Fix.** Reset all of them in `home()`.

## G. Pivot cut is horizontal only (ranked 14)

`src/walker.js:807-814`.

**Defect.** Only a horizontal jump over 3 m snaps the pivot. A vertical teleport,
or the boat-to-cat pivot source switch when the cat leaves the boat, is followed
on the 6 rad/s `pivotY` spring.

**Fix.** Snap when `|cy − rig.py.x| > 1.5`, and on the `afloat` edge.

---

# Second pass

Read in this pass: `blockers.js`; the near plane in `landscape.js`; `cat.js`
(update, gait, footstep firing, heal, IK hand-off); `cat-rig.js`; the footstep
path in `main.js`; all of `sound/index.js`, `sound/foley.js`, `sound/patches.js`,
`sound/walk.js`, and the voice lifecycle in `sound/core.js`; `calls.js`
(`playCall`); `journey.js`; `quest.js`; `boat-ride.js`; the solids wiring in
`boat.js`; `sea-surface.js` (`at`, `drawn`); `wildlife.js` (bodies); `seals.js`
haul-out; the WORLD_SCALE uses; timers and listeners across every scoped file;
`tests/movement.test.js` (camera); `tests/audio/footsteps.test.js`.

## S1. Why the lens lands in the cat: the tracer shrinks to nothing next to a solid (ranked 1)

`src/blockers.js:183-186` together with `src/walker.js:875-892`, `:1109-1134`. CONFIRMED.

**Defect.** `trace()` uses `r = min(pad, 0.7·start)`, where `start` is the pivot's
distance to the nearest solid. If the pivot is within a few centimetres of a solid
it can see, the tracer sphere is tiny and stops as soon as it touches anything.
Three things then happen together:

1. `armReach` gives `f ≈ 0`, so the arm drops to its floor of `0.1/length`
   (`:1134`).
2. The over-blend's upward trace (`:885`), which leans 0.4 m *toward the
   camera*, i.e. toward the solid, returns about 0.
3. `rig.up` eases to it, so `up` goes to 0 and the lens sits on the pivot.

At a start distance of 0 or less (the pivot inside the solid), `trace` returns 1
instead, so the problem is the band just outside the solid.

**Concrete triggers.** These are moving solids that can see the camera
(`lens !== false`):
- the hull capsule while afloat (`boat.js:333-336`, radius 0.62);
- the seal capsules (`wildlife.js:77`, radius 0.3·size, up to 0.47 m);
- the mooring post;
- the cottage walls and sill (commit 8254dd4 was a symptom of this).

**Failure scenario.** The cat jumps out of the boat (`boat-ride.js leave`) or swims
along the moored hull. The camera's yaw is still the boat's heading, so the boom
passes through the hull. The pivot is about 6 cm above the water, right at the
swimming cat's back, so the lens is pulled onto its back. With the near plane at
0.05 m (`landscape.js:88-93`), the view shows the paddling paws and little else.
This matches the owner's "glitched through the cat… some paws and everything else
invisible". A seal waddling past a sitting cat does the same.

**Fix.**
- In `trace`, keep the pad at least `LENS_GUARD·0.5` and start the march at `t₀`
  where the padded sphere first clears the start, instead of shrinking the pad.
- In `placeCamera`, never let `pullClear` or the blend bring the lens within
  `~0.5 m` of the cat's head. Prefer raising the boom straight up (`bx = bz = 0`)
  when the lean-back trace is blocked.
- Afloat or swimming, skip the over-blend's lean toward the camera.

## S2. The swash film is applied on top of rocks and the beached deck (ranked 2)

`src/sea-surface.js:179-188`. CONFIRMED.

**Defect.** `at(x, z, ground)` sets
`level = max(level, ground + film·…)`. Here `ground` is the walk surface (boulder
tops, the boat deck, landmark tiles), and `film` depends only on the horizontal
distance inland.

**Failure scenario.** A boulder 1 m tall within the uprush (`inland < reach`, up to
~7 m) gets a 1–6 cm "water" layer on its top at every wave. This has five effects:
- The footstep path (`main.js:1206`) reads `depth > 0.008`, so the walker's kind is
  5 and the step plays *shallows* plips instead of claw ticks on dry rock. This is
  very likely part of "sound design is off (for footsteps)".
- It throws splash rings (`main.js:1211`).
- It wets the paws.
- The walker marks the cat in water (`cat.water > 0`), so it never sits or settles
  on tideline rocks (`walker.js:542`).
- `cat.js` treats it as in water (`waterY` finite).

The walker's slope sampling already avoids rock tops (`walker.js:457-462`), but its
level and depth do not.

**Fix.** Lay the film relative to the sand. Compute
`sand = groundHeight(x, z)` inside `at`, take the swash level as
`sand + film·…`, and only raise `out.level` when `ground <= swashLevel + 0.005`.
Alternatively, have the callers pass the sand height separately from the walk
surface.

## S3. Footstep surface resolution (ranked 4)

Files: `src/walker.js:503`, `:1308-1316`; `src/main.js:1203-1208`; `src/sound/index.js:103-111`. CONFIRMED.

1. `onRock = surface > groundHeight + 0.03` is true for every walk tile. That
   covers the boat's deck when the cat is not "aboard" (the boat is moored or
   adrift and the cat has walked or hopped onto it, or landed back on it after
   `clearFor`), the cottage steps and sills, landmark `gradient` tiles, and the
   crevice bridges. All of them give kind 0, i.e. rock.
2. `surfaceFor(0)` checks timber against `scene.boat`, which is the POI found
   once in `setWorld` (the logs where the boat lay). Once launched, the boat
   floats at the cove or wherever it was left, so steps on its deck are rock
   ticks.
3. `scene.milkwood` within 5 m turns *every* rock step there into timber,
   including the boulders around the tree.
4. `land()` after a hop uses the same resolution, so a landing on the deck gives
   a rock tap plus a sand thud.

**Fix.** Return the winning surface from `walker.base()`/`surface()`: ground,
dome, `gradient` tile with its material, crevice bridge, or deck. Map the deck to
`SURFACE.deck` whenever the deck wins, aboard or not, and timber tiles to
`SURFACE.timber`. Pass the boat's live position (or a `deck` flag) to the sound
side rather than the static POI.

## S4. No test catches the camera in the cat (ranked 5)

`tests/movement.test.js:84-140`. CONFIRMED.

**Defect.** The test asserts the lens stays out of solids, trunks and the ground,
and that it never moves in a sudden step. It never asserts distance from the cat.
Its four routes are all on land, inland of the beach, with no hull, seal, wall at
the back, or swimming. The boat and animals-solid tests check the cat's body
against solids, not the lens.

**Fix.** Add an assertion that `hypot(camera − (cat.x, cat.y + 0.26·CAT_SCALE, cat.z)) > 0.5`
on every frame. Add routes for:
- swimming along the moored hull with the camera across it;
- jumping out of the boat;
- sitting beside a hauled-out seal;
- backing into the cottage wall and sill.

## S5. "Begin again" leaves the boat afloat; the boat has no way back to sleep (ranked 7)

`src/boat-ride.js:190-224`; `src/journey.js:381-389`; `src/quest.js:102-108`. CONFIRMED.

**Defect.** `quest.beginAgain()` puts the `boat` gift to sleep, but `boat-ride` only
ever moves *out of* `asleep`. The boat stays `waiting`, `adrift` or `aboard`.
`wake()` returns early unless the state is `asleep`.

**Failure scenario.** The player begins again with the boat in the cove (or with
the cat aboard). When the boat gift is woken again, there is no "ready on its
logs", no launch, no knock or scrape. The boat ceremony's follow shot treats the
boat as already in the cove (`journey.js:248`, `k = 1`), and the logs are empty
while the gift wakes.

**Fix.** Add `ride.sleep()`. It hands the cat back if it is aboard (`leave`, or
place the cat ashore), resets `pose` to the logs (roll π), sets the state to
`asleep`, sets `tether = null`, and clears the stored mooring (`BOAT_KEY`). Call
it from `journey.beginAgain`, or from `boat.js` when `magic` reports `boat`
asleep.

## S6. Seals at WORLD_SCALE overlap on their haul-out (ranked 8)

`src/seals.js:174-176`, `:246`. CONFIRMED (the spacing); the overlap is visual and in the solids.

**Defect.** Seals are now 1.5 m model × (0.88–1.12) × 1.4, i.e. 2.2–2.8 m long,
with random headings. Haul-out spots still only need to be 1.0 m apart, and the
"gentle enough" slope test samples only ±0.3 m around the centre. Their solid
capsules (`wildlife.js:89-92`, half-length 0.55·size, radius 0.3·size) overlap
too.

**Failure scenario.** Two seals interpenetrate on the same rock, or a seal hangs
off the edge of the rock. The cat is boxed between overlapping capsules, which
feeds the pin-escape hop (finding B).

**Fix.** Space spots by `1.2·size·WORLD_SCALE` (about 2.4 m), test the slope at the
nose and the tail along the chosen heading, and orient seals along the rock's
long axis.

## S7. Footsteps late against the paw on some machines (ranked 10)

`src/sound/index.js:57`; `src/sound/core.js:140`; `src/sound/foley.js:24-29`. PLAUSIBLE.

**Defect.** The context is created with `latencyHint: "playback"`, which asks for
large output buffers (tens of ms on many devices, more over Bluetooth). Each step
is scheduled at `currentTime + 0.01`. `currentTime` moves in buffer-sized jumps, so
both the onset and the 50 ms / 120 ms throttles jitter by a buffer. The onset is
the paw's touchdown, `cat.js:677-681`, which is correct.

**Failure scenario.** At a walk (about 125 ms between paws) a 40–90 ms lag reads
as steps that do not match the feet.

**Fix.** Use `latencyHint: "interactive"`, or a number around 0.02. Schedule from
`ctx.getOutputTimestamp()` mapped to `performance.now()` so each step lands at the
frame's presentation time.

## S8. Footstep tests do not cover the live path (ranked 11)

`tests/audio/footsteps.test.js:13-31`. CONFIRMED.

**Defect.** The render helper plays `s.step(surface, running, 0, { exact: true, front: true })`
every 10 frames. The following are never exercised:
- the walker-kind → `surfaceFor` refinement (habitat, milkwood timber, the boat
  POI);
- the running front-only filter;
- the 50 ms and 120 ms throttles;
- hind-paw level (`1/1.2`);
- the `wade` branch.

The test named "the walker's kinds map onto them" only checks that surfaces 0–10
have layers. The running test's "+2…+8 LU" range is wide enough to pass with or
without the 1.8× factor's intended effect. With half the steps voiced at a run,
the integrated loudness moves by about −3 dB, which this test, with front paws
only at a fixed cadence, never sees.

**Fix.** Drive `api.step(kind, running, pan, { x, z, front })` from a recorded
gait (4 paws, the real duty and offsets) on each walker kind. Assert the voiced
step count per second at walk, trot and gallop, and the loudness per kind via
`surfaceFor`. Narrow the running range to what the design intends.

## S9. Aboard, the gait runs from the boat's yaw: deck knocks from a still cat (ranked 12)

`src/boat-ride.js:454-462`; `src/cat.js:380-385`, `:680-681`. PLAUSIBLE.

**Defect.** `holdCat` sets `cat.turn = s.r·0.6` and `gaitAmp` up to 0.35 from
roll and pitch rates. In `cat.js`, `pivotSpeed = |turn|·0.13·S` advances the gait,
and touchdowns fire `onStep` whenever `amp > 0.25`. Aboard, `main.js footstep`
plays `SURFACE.deck`.

**Failure scenario.** Steering a turn in a swell, the cat standing (or sitting:
`sitW` does not stop the gait branch when `amp > 0.04`) at the bow gives a run of
hollow deck knocks, and a sitting cat lifts its paws.

**Fix.** Aboard, drive paw shifts from a separate, sparse "weight shift" timer, or
gate `onStep` on `pose.speed > 0.05 || !aboard`. Set `cat.turn = 0` in `holdCat`
and pass the yaw only to the head look.

## S10. `ride.leftAt` holds no time (ranked 15)

`src/boat-ride.js:113`, `:516`. CONFIRMED.

**Defect.** It is documented as "seconds since the cat last left". It is set to
`ride.t` (seconds into the `aboard` state), then `ride.t` is reset to 0. Nothing
in `src/` reads it.

**Fix.** Delete it, or keep a ride clock and store that.

## Checked and found sound (no finding)

- **`blockers.js` gather and stamp:** `mark` stamps are per-primitive integers,
  so a primitive shared across cells is listed once. `bodies` are tested every
  query.
- **Near plane:** `landscape.js:88-93` uses 0.05 m. Reasonable; finding S1, not
  the near plane, is the cause.
- **`cat-rig.js solveLeg`:** the reach and `acos` arguments are clamped. No NaN
  from out-of-reach paws.
- **`cat.js heal()`:** covers its springs, tail, ears, gaze and plants. It does
  *not* cover the walker pose (finding B).
- **Footstep phase in `cat.js`:** the step fires at the swing→stance edge
  (touchdown) and only when `amp > 0.25 && swim < 0.5`. In the air every leg is
  held in stance, so a landing never adds per-paw steps on top of `land`. No
  double-fire found. The 50 ms throttle merges a trot's diagonal pair, which is
  intended.
- **Voice lifecycle (`sound/core.js`):** every `core.voice(` in `sound/*` has a
  matching `done()` (counted per file). `kill()` leaves cleanup to the clock's
  `onended`, which `done()` always schedules. The foliage carrier stops after
  2 s idle. The purr disconnects on `onended`. No leak found.
- **`calls.js playCall`:** chains release at `t + length + 0.3`.
- **Listeners and timers:**
  - `journey.js` subscribes to `skyEvents` once (`listening` flag).
  - `discoveries.js` and `thread.js` listeners take the abort `signal`.
  - No per-ceremony listeners or timers exist.
  - The sound's `suspendTimer` is cleared before it is re-armed.
- **Ceremony camera:** `camStart` and `camEnd` pair up in `start` and `finish`.
  `finish` runs from `beginAgain` too. `lookAt(null)` is called on exit.
- **Reduced motion:** the cat does not walk (`main.js:359`, `:1394`), so the
  frozen gait (`dt: 0` to `cat.update`) has no effect.

## Still not reviewed

- `cat-body.js` and `cat-ground.js` (prints and dust) beyond their call sites.
- `boat-dynamics.js`, `boat-forms.js`, `boat-launch.js`, `boat-jellies.js`, and
  `boat.js` beyond its solids wiring.
- `wake.js`.
- `wisp.js`, `wisp-mind.js`, `wisp-route.js`.
- `thread.js` beyond its listeners.
- `penguins.js` behaviour, `whale.js`, `shore-life.js`, and `animal-forms.js`
  beyond WORLD_SCALE.
- `sound/beds.js`, `cues.js`, `weather.js`, `world.js`, `mix.js` levels, and
  `score.js`.
- The tests other than the two named above.
