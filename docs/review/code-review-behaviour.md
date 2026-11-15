# Behaviour code review (partial: cut short by the usage window)

Branch `magic-round2` at b00fa07. Read-only review. Only `src/walker.js` was read
in full before the stop order; everything else listed at the end is unreviewed.
CONFIRMED means traced line by line in the code; PLAUSIBLE means the arithmetic
is traced but how often the trigger happens in play was not verified.

---

## 1. Look-down-from-above blend can put the lens at the pivot, inside the cat

`src/walker.js:879-892` (with `pullClear`, `:929-935`). CONFIRMED (the arithmetic); PLAUSIBLE (how often it triggers).

**Defect.** When the boom is short (`near < 0.95`), the lens blends toward
`(tx + bx·up, ty + 1.6·up, tz + bz·up)` with `up = min(rig.up, upClear + 0.3)`.
When something solid sits over the cat, `upClear` is 0 and `rig.up` eases to 0,
so the lens lands on the pivot `(tx, ty, tz)`.

**Failure scenario.** The pivot is at `cat.x/z`, `targetY + 0.26·CAT_SCALE`. That is
0.36 m above the paws, at the middle of the back, inside the body (the cat is
modelled ×1.4). The cat walks under a milkwood limb, the boat's gunwale or the
cottage eave while a wall or hull is at its back. `armReach` shortens the arm
(its floor is `0.1/length`, `:1134`), so `near < 0.55` and `over = 1`, and the
lens drops to the pivot. The near plane and backface culling then remove most of
the body and leave a few paws in view. This matches the owner's report: "camera
glitched through the cat… some paws and everything else invisible".

`pullClear` (`:875`, `:891`) has the same flaw. It scales the lens toward the
pivot by the trace fraction `f`. When the pivot itself is within `LENS_GUARD` of
a solid (the cat brushing a wall, or on a sill, as in commit 8254dd4), `f ≈ 0` and
the lens is placed at the pivot.

**Fix.** Give the lens a hard minimum distance from the cat's body as the last
guard. For example, after all guards, if `hypot(camera − pivot) < 0.45·CAT_SCALE`,
push the lens out along the boom direction (or straight up). If that is blocked,
widen `distance`/elevation in the aim instead. In `pullClear` clamp
`f ≥ minLens/len`. In the blend, use `up = max(up, 0.35)` so the over view always
sits at least ~0.55 m above the head.

## 2. A "no way open" hop can make the cat's state NaN for good

`src/walker.js:363` together with `:400-402`. CONFIRMED (arithmetic); PLAUSIBLE (trigger).

**Defect.** The pin escape sets `hop = true` without checking `wall.top`. The hop
then caps `vy` with `Math.sqrt(2·g·(wall.top − cat.y + 0.12))`. This is NaN when
`wall.top` is `-Infinity` (its initial value, `:180`) or stale and lower than
`cat.y − 0.12`. `Math.min(vy, NaN)` is NaN.

**Failure scenario.** The cat is boxed in (between boulders, against a keel, in a
crevice). The last remembered wall came from a lower rock, or none was recorded
(the cat is pinned by jitter alone, `:341`). The hop sets `cat.vy = NaN`, which
flows to `cat.y`, `airborne`, `cat.air`
(`Math.max(0.001, NaN)` is NaN), and from there to the rig, wake and camera. No
check restores finite values: `cat.y <= floor` stays false forever, and the camera
cuts on every frame (`NaN !== NaN`, `:759`) with NaN targets. The result is an
invisible or broken cat and camera. This is a second path to "parts of the cat go
invisible" besides the swimming springs.

**Fix.** Write `const need = wall.top - cat.y + 0.12;` and only cap when
`Number.isFinite(need) && need > 0`. As a backstop at the end of `update`, if
`!Number.isFinite(cat.y + cat.vy + cat.x + cat.z)`, call `home()` (or restore the
last good position) and log once.

## 3. The lagging pivot spring lets a running cat reach a short-armed lens

`src/walker.js:807-815` and `RIG.pivot = 14` (`:64`). PLAUSIBLE.

**Defect.** The pivot follows the cat on a critically damped spring. Its
steady-state lag is `2v/ω`: about 0.49 m at `RUN_SPEED` 3.4 and about 0.14 m at a walk.
Every later stage (arm, over-blend, guards) places the lens relative to the
lagged pivot, not the cat.

**Failure scenario.** The cat runs toward the camera (the viewer dragged round to
face it), or runs back past a wall that has shortened the arm to ~0.1–0.5 m. The
cat's body is up to 0.5 m ahead of the pivot, so it passes over the lens before
the arm or blend reacts. All the guards check solids, trunks and ground. None
checks the cat.

**Fix.** Measure the minimum-lens-distance guard in finding 1 against the
cat's current position (`cat.x, cat.y + 0.26·CAT_SCALE, cat.z`), not the spring
pivot. Optionally, add the cat's velocity times `2/ω` to the pivot target so that
it has no steady-state lag.

## 4. The trunk guard can push the lens sideways toward the cat

`src/walker.js:842-856` together with `:1104`. PLAUSIBLE.

**Defect.** `armReach` stops the arm before a trunk, then raises it to at least
`ARM_MIN / length` (0.9 m). If a trunk is within 0.9 m behind the cat, the lens
ends up in or past the trunk. The guard then pushes it out radially from the
trunk's centre. That direction can point toward the cat standing beside the
trunk.

**Failure scenario.** The cat stands with a trunk 0.4 m behind it and slightly
to one side. The lens is pushed out of the bark toward the cat's flank, within a
few tens of centimetres of the body. If `near` stays above 0.55, the over-blend
does not fully engage.

**Fix.** Same minimum-distance-from-cat guard as finding 1. Alternatively, when
a trunk is inside ARM_MIN, lift the arm (`rt.armLift`) instead of forcing its
length.

## 5. Footstep surface: a boat deck or landmark tile counts as rock

`src/walker.js:503` together with `surfaceKind` `:1308-1316`. CONFIRMED for walker.js; how `main.js footstep()` uses it was not reviewed.

**Defect.** `cat.onRock = bed > groundHeight + 0.03`. Here `bed` is `surface()`,
which includes the boat's deck (`ride.deck`, `:726`), the cottage, lighthouse and
wall tiles (`gradient` domes) and the crevice bridges. `surfaceKind` turns
`onRock` into kind 0 (rock) ahead of everything else.

**Failure scenario.** Walking on the moored boat's deck, on cottage steps or
sills, or on timber gives rock footsteps and rock paw prints. A rock-like tile
on the sand gives stone steps. The sand, scrub and forest bands are fixed
distances from shore (1.7, 6 and 11 m). If WORLD_SCALE changed the shore widths,
these bands now fall in the wrong places. The second point is PLAUSIBLE and was
not checked against terrain.js.

**Fix.** Return a surface tag with the height. `base()` already knows whether
the winner was ground, a dome, a `gradient` tile (wood or stone by tile) or the
seabed, and `surface()` knows about the deck. Map deck and timber to a wood
kind, and derive the inland thresholds from the terrain's own constants.

## 6. Teleport (`home()`) leaves movement and look state behind

`src/walker.js:574-599`. CONFIRMED.

**Defect.** `home()` resets position, speed and air, but not `rt.escapeUntil`,
`rt.escape`, `rt.pinned`, `rt.blocked`, `wall.*` (`at`, `top`, `headOn`),
`cat.turn`, `cat.rising`, `cat.flow`, `cat.soak`, `look`, `free` or `rig.look`.

**Failure scenario.** A cat sent home within 0.7 s of an escape keeps walking
along the old escape heading (`:366-369`). Within 0.3 s of a wall contact, the
stale wall normal changes its first steps (`:306`), and a stale `wall.top`
feeds finding 2. A ceremony `lookAt` point left set keeps turning the view
toward a subject on the other side of the island.

**Fix.** Reset `rt` to its initial values in `home()`, set `wall.at = -10` and
`wall.top = -Infinity` (with finding 2 fixed), and clear `cat.turn`, `rising`
and `flow`. Clearing `look` and `rig.look` is a judgement call: do it unless a
ceremony relies on home keeping them.

## 7. The pivot cut ignores vertical jumps and the afloat-to-ashore source switch

`src/walker.js:807-814`. PLAUSIBLE.

**Defect.** Only a horizontal jump over 3 m is a cut, and `rig.py` is settled
only when `dt === 0`. A vertical teleport (dropped onto a rooftop or the
lighthouse gallery), or the switch of the pivot source from `ride.view` (boat,
+0.35) to the cat (+0.26·CAT_SCALE) when `afloat` flips, is followed on the slow
`pivotY` spring (6 rad/s). The lens trails or sits low for about half a second
and can sweep through hull or ground before the floor catches it.

**Fix.** Include `|cy − rig.py.x| > 1.5` in the cut test and settle `rig.py`
there too. On the `afloat` edge, settle the pivot onto the new source and keep
the offset continuous.

---

## Not reviewed (stopped by the coordinator before reading)

`src/cat.js`, `src/cat-rig.js` (constants only), `src/cat-body.js`, `src/cat-ground.js`,
`src/boat.js`, `src/boat-dynamics.js`, `src/boat-forms.js`, `src/boat-jellies.js`,
`src/boat-launch.js`, `src/boat-ride.js`, `src/wake.js`, `src/sea-surface.js`,
`src/journey.js`, `src/quest.js`, `src/wisp.js`, `src/wisp-mind.js`, `src/wisp-route.js`,
`src/discoveries.js`, `src/thread.js`, `src/penguins.js`, `src/seals.js`,
`src/animal-forms.js`, `src/shore-life.js`, `src/whale.js`, `src/blockers.js` (the
`trace` / `distance` semantics that findings 1 and 4 depend on), all of `src/sound/`,
`src/calls.js`, `src/score.js`, the `footstep()` path in `src/main.js`, and the tests.
The near-plane value of the cat/landscape camera (`src/landscape.js:88`, `:179`) was not
checked. The footstep phase, double-firing and level questions are still open.
