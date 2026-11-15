# Wiring src/affordances.js (not done yet)

`src/affordances.js` is pure and tested (`tests/affordances.test.js`). Nothing calls it. A later agent adds:

1. **main.js**, after `createPlaces(...)` returns `places`:
   `const affordances = createAffordances([...places.affordances, ...animalSpots])`
   where `animalSpots` are `{ place, id, kind: "animal", x, y, z, r }` from wildlife (penguins, seals, tortoise), refreshed per frame if they move (or rebuild the list when they do).
2. **main.js** frame loop, after `walker.update(...)`: build `catState` from the walker pose
   `{ x, y, z, heading, speed, sitting, meowed: journey.callThisFrame, jumpedOnto, bumped, onGround }`
   and call `const events = affordances.update(catState, dt)`.
3. **walker.js** must expose per frame: `sitting` (loaf/sit pose), `jumpedOnto` (tile/affordance id when a hop lands), `bumped` (`{ id }` when the body hits a trunk/solid that carries an affordance or animal id), `onGround`, `speed`, `heading` with direction `(sin h, cos h)` (same convention as prop `facing`). Check the sign of heading against place-kit `facing` before trusting the facing test.
4. **quest.js**: replace the radius wake with `quest.offer(event)` using `ACTS` from affordances.js (`on`, `id`, `seconds`, `count`, `also`). Boat: count two `on-top` events on `boat-hull`, or one then a `meow-near`. Place-shore.js has no `boat-hull` affordance yet; add `{ id: "boat-hull", kind: "on-top", ... }` to the boat prop. Fallbacks from story-and-wow.md step 4 until each prop is reworked.
5. **journey.js / land-magic.js / place props**: answer half-attempts from the same events (`meow-near lighthouse-light` far off blinks the beam; first `on-top boat-hull` knocks and a crab bolts; `left pool-rim` lets anemones reopen).
6. **discoveries.js**: record an interaction the first time its event fires.

Seconds are per affordance: set `seconds` on the prop's affordance (pool 5, milkwood fork 2) or let quest pass `ACTS[place].seconds` into the list before `createAffordances`.
