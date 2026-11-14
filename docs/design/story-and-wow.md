# Sky Cope: the story, the arc of a visit, five shots, the ending

Design only. Nothing in `src/` was changed. Written 14 Nov 2026 against `magic-round2`.
`docs/design/waking-light.md` appeared while this was being written and has been read: this document builds on its mechanism (`magic.waking`, the kindled point, the practicals) and differs from it in exactly two places, both stated in section 9. `docs/design/first-visit-audit.md` did not exist yet. The site was read, not played: every claim about today's behaviour comes from the code and the handover reports, and the first-visit frames in `docs/design/first-visit/`.

Coordinates are seed 1847, coast metres (x, z). Home beach is near (6, 0); the island's centre is (58, 70).

---

## 1. The story

### In two sentences

A small light has fallen out of the sky onto a dark island and cannot climb home on its own, so it leads a cat from place to place and they light the island's old lights together, each one lifting it a little higher. When the last is lit it rises from the hilltop to the one empty place in the southern sky, the point the Southern Cross points at, and tonight's real stars turn around it over an island that stays lit.

### Who is who

| | What it is | What it wants | How a visitor learns this without reading |
|---|---|---|---|
| The cat | A cat who lives on the beach. Nothing more. It is warm, curious and has paws and a voice. | Nothing. It follows a light because cats do. | It is the visitor. |
| The wisp | A fallen star, small and white. | To go home, which is up. It is too faint to climb. | It falls in the first ten seconds. After every light it tries to rise, gets a little higher than last time, and sinks back. |
| The island | A kept place whose keeper has gone. A lamp, a lantern, a tree that held lights, a tide that glowed, a sea that came close. All dark, all shy. | To be lit and lived in. | Every lightable thing is visibly cold: a dead lantern on a post, a blind lighthouse, an upturned boat. |
| The lights | Five things on the island that hold light, each needing a spark (the wisp) and an act (the cat). | | The wisp can hover at one but nothing happens until the cat does the thing. |
| The animals | The island's neighbours. They keep their distance from a dark island and a stranger. | | Before the pool they flee or ignore. After it they come over. |
| The real sky | Where the wisp is from, and where the story ends. | | The ending happens in it, at a place that is astronomically true. |

The trade is the whole plot: **the wisp gives the spark, the cat does the act, the island gives height.** Neither can do it alone. Nothing is collected and nothing is counted on screen.

### Why this story and not another

- It is one verb, *light it*, and the verb is taught in the first thirty seconds by doing it once.
- It makes every existing gift the same kind of thing (a light that stays) instead of six unrelated effects.
- It gives the wisp a want a visitor can see, so following it is helping someone, not obeying an arrow.
- Its ending can only happen here: the southern sky has no pole star. Polaris has no southern twin; the place the Cross points to is empty. This site computes that place for Cape Town, tonight. The wisp fills it.
- It adds almost nothing. It is a re-ordering and a quieting of what is built.

### The six gifts, restated

Five lights below and one above. The trig beacon stops being a gift of its own with its own ceremony followed four seconds later by a second ceremony on the same spot; **the stars gift is the ending.**

| Place | Light | The cat's act (what wakes it) | What changes for good, by night | What changes for good, by day | Animals |
|---|---|---|---|---|---|
| Home beach post (new, tiny) | The first lantern. Not a gift; the lesson. | Walk up to it. | A warm lantern on a driftwood post: the way home, visible from the hilltop. | A small live flame behind glass, no glow. | none |
| Fisherman's boat (77, 41) | The hurricane lantern | Hop on the upturned hull; hop again or meow and it rolls off the logs and slides in. | A lantern riding at the mooring, its light on the water. The boat can be sailed. | The boat afloat, sailable. | Dolphins ride the bow. Moon jellies rise to the lantern. |
| Old milkwood (27, 74) | Fireflies | Walk up the low limb to the fork and sit. | The crown is full of slow lights; a few follow the cat anywhere on the island. | Sun-shaft motes under the crown; butterflies gather; one lands on a still cat's ear. | Butterflies. |
| Wreck (-9, 44) | Tideglow | Walk into the boiler and meow: it rings. | Every shore glows where it is stirred: the swash line, paw prints on wet sand, a swimming cat, the boat's wake. | In the boiler's own dark the puddle glows round the paws at noon. Otherwise nothing, honestly; the card says `after dark`. | Ghost crabs leave glowing scuffs. |
| Rock pool (64, 127) | The sea's trust | Sit still at the rim for five seconds: the anemones reopen and the klipfish come back into the cat's shadow. | Anemones hold a faint light. | The same, unlit. | **Everything changes temperament**: seals race instead of fleeing, a penguin walks over, oystercatchers lead, dolphins come into the cove, the whale answers. This is what `seafolk` now means in code: one switch in the wildlife temperament table. |
| Lighthouse (123, 59) | The lamp | Meow within 40 m (or push the door). | The beam turns; the cottage windows are lit; a meow brings the beam round to hold on the cat. | The lens glints as it turns; smoke from the cottage chimney, visible from across the island. | none |
| Trig beacon cairn (62, 86) | **The sky** (the ending) | With all five lit: climb the cairn and sit on top. | Section 5. | Section 5. | |

Every light has a night face and a day face. Where the day face is weak (tideglow, fireflies) the wisp does not lead there first by day (section 2, "order").

### What text survives, all of it

The site's voice: lower-case, spare, never instructing. Total surviving copy outside the panels is under fifty words.

**Arrival title** (unchanged): `cape town` / `sky cope`

**Lessons** (`moments.js` LESSONS; one at a time, fade if ignored):

| id | mouse | touch | when |
|---|---|---|---|
| walk | `wasd or click to walk` | `tap the ground to walk` | after the star lands |
| look | `drag to look round · scroll to zoom` | `drag to look round · pinch to zoom` | after walk |
| run | `shift to run · space to jump` | none | moving, after look |
| meow | `m to meow` | `tap the cat to hear it` | **first time the cat is inside any place that answers a meow** (boiler, lighthouse 40 m, boat hull) — not "when sitting" |
| sit | `stop and it sits` | `stop and it sits` | first time at the pool rim or the limb fork, if the cat has been moving there for 8 s |
| photo | `p for a photo` | `◎ for a photo` | after the second light, or at golden hour |

**The light cards** (`journey.js` GIFT_LINES). One line, no place title above it. The small line is used only for the two "wait" cases.

| Light | Big line | Small line |
|---|---|---|
| boat | `a lantern for the water` | |
| milkwood | `the old tree lets its lights go` | by day: `after dark` |
| wreck | `the tide remembers light` | by day: `after dark` |
| pool | `the sea comes close` | |
| lighthouse | `the lamp is lit again` | |
| ending | `home` | none. Shown once, when the star has settled, in the arrival's type. |

The home lantern has no card.

**Find line** (`thread.js` findLine). The `found ·` prefix is cut and so is every line for a thing that does nothing. A line is written only when the world has just answered something the cat did, and it says what happened:

| When | Line |
|---|---|
| boiler rings to a meow | `the boiler rings` |
| beam holds on the cat | `the light looks at you` |
| fish return at the pool | `the fish come back` |
| butterfly lands | `a butterfly, on your ear` |
| tortoise comes out | `the tortoise comes out` |
| seal wins the race | `the seal wins` |
| penguins follow | `a parade` |
| whale answers | `the whale answers` |
| jellies rise | `they rise to the lantern` |
| cat sits on a sun-warm rock | `a warm rock` |
| cat on the cottage sill in rain | `dry, under the eave` |
| first sit on the cairn top, fewer than five lit | none: the view is the message |
| after the ending | `stay as long as you like` |
| after the ending, first call | `it comes when you call` |
| dawn lapse (exists) | `dreaming of dawn` (drop `· a preview`) |
| returning, lights persisted | `the lights are still on` |
| returning after the ending, at night | `it is still up there` |

Sky and weather moments (sunset, first light, moonrise, stars, rain, nap) are still recorded in the field notes but write no line; the sit-and-watch camera is their acknowledgement.

**Field notes panel**: heading `field notes`; empty state `nothing yet · go and look`; entries are the lines above with the Cape Town time; the dim dashes for unfound things stay (they are the only "there is more" signal and they are quiet). The six gift glyphs, the coloured dots on the toggle and their tooltips are cut. `begin again` stays, shown only when at least one light is lit, with the confirmation `let the lights go out? · yes`.

No other text. No counts, no "5 of 6", no place names on arrival, no map.

---

## 2. The arc of a visit

### The first ten seconds (the hook)

The loading veil already has a comet-tail wisp as its progress mark (`loading-screen.js`). Keep it and make it the same object: on hand-over it does not fade, it is *still falling*.

1. 0 s. The world sharpens. The cat sits on its rock on the home beach (the composition in `first-visit/c004-13s.jpg`). High in the frame, where the loading wisp was, a bright point with a short tail hangs in the real sky. The arrival title plays over it.
2. First input, or 6 s after the title clears, whichever is first. The cat's head snaps up. The point falls: a real fireball track (`sky-events.js` forced fireball, already placed in front of the camera) coming down over 1.4 s, by day a white chalk line, by night a white-green streak that lights the sand.
3. It lands 9 m up the beach with a soft thump, a puff of sand and six embers that die in two seconds. Silence for one beat. Then a small light lifts out of the sand, wobbles, tries to go straight up, gets to about a metre and a half and sinks back.

That is the hook: *a star just fell on my beach and it can't get back up.*

### The first minute (what they understand)

4. ~12 s. Hint: walk. Between the cat and the fallen star stands a driftwood post with a cold storm lantern, 8 m from the rock. The wisp drifts to it and hangs beside the glass. Nothing happens. It bobs, looks back (existing "beckon").
5. ~25 s. The cat arrives within 2 m. The wisp slips into the lantern. The wick catches, gutters once, holds (`lampCatch`, shortened). Warm light on blue sand, or by day a small flame behind salt-hazed glass. **The first "oh".** The wisp comes out brighter, tries to rise again and gets visibly higher (3 m), sings two notes instead of one, sinks, and sets off inland.
6. 30–60 s. The visitor now knows the whole game without a word: it puts light into things; it needs me beside it; each light helps it climb. They follow.

### The middle (what pulls them on)

Pull, in order of strength. None is a marker.

- **The wisp.** Leads by the existing behaviours, pared: flits ahead, waits in sight, comes back for a dawdler, answers a meow, sits with a sitting cat. Cut: hiding in the grass and popping out, darting about when the cat runs, colour tinting by last gift. It stays star-white and only gets brighter. By day it is a small bright point with a short tail, not a sun-sized flare (`look-research.md`).
- **Lit against unlit.** From any high ground the lit places are warm points and the unlit ones are dark shapes. The home lantern is always the first point, so the pattern is legible from the first climb.
- **The cairn as the map.** Sitting on the cairn top at any time eases the camera up and back (audit interaction 3). The lit places show; the wisp flies a short way toward the nearest dark one and back, twice. Then it tries to rise from the highest ground on the island and fails. This plants the ending: *this is where it will go from.*
- **The beam.** Once the lamp is lit and all five are done, the beam lingers 0.6 s on the cairn each turn.
- **Sound.** Each unlit place has one quiet sound that carries about 40 m: the boat hull knocking on its logs in the swash wind, the boiler's hollow hum, the milkwood's crown in wind, the pool's drip and suck, a loose shutter at the cottage. Lit, each swaps to a warmer one (section 8).
- **Animals.** Oystercatchers flushed by the cat land 20 m on toward the nearest unlit place (audit 14). After the pool, a seal surfaces by the boat mooring; dolphins show in the cove with the boat.

**Order.** The wisp leads to the nearest unlit place weighted by the hour, so the first light a visitor wakes is one whose effect they can see right now:

| | boat | pool | milkwood | lighthouse | wreck |
|---|---|---|---|---|---|
| Day weight on distance | 0.6 | 0.8 | 1.0 | 1.0 | 1.6 |
| Night weight | 1.0 | 1.3 | 0.8 | 0.9 | 0.6 |

From home that gives the boat first by day (82 m, a boat to sail in daylight) and the wreck first by night (46 m, a glowing beach under the paws). The cat may still go anywhere in any order and every place answers its act whenever it is done; the wisp catches up.

**The climb.** After the n-th light the wisp's rise reaches 1.5, 3, 5, 8, 12 m and it sings n+1 notes of a six-note phrase (section 8). After the fifth it does not sink all the way; it hovers at 12 m, drifting toward the hill, visible from the whole island.

### Three visitors

**Three minutes, daytime.**

| t | What happens |
|---|---|
| 0:00 | Star falls. |
| 0:25 | Home lantern. First "oh". |
| 0:35–1:20 | Follows the wisp along the north shore to the upturned boat. Passes penguins that keep their distance. |
| 1:20 | Hops on the hull: hollow knock, a crab bolts. Hops again: it rolls, slides, floats. Card: `a lantern for the water`. Wisp rises 5 m, three notes. |
| 1:50 | Wades out, boards. Sails. Dolphins on the bow within twenty seconds if under way. |
| 3:00 | Leaves from a boat, looking back at an island with two small flames on it. They know there is more and what kind. |

**Three minutes, night.** Same to 0:25. Then the wreck at ~1:10: into the boiler, footsteps go metallic, the meow hint appears, the meow comes back as a bell, the wisp dives into the wet sand, and the next swash comes in lit blue. `the tide remembers light`. They spend the remaining ninety seconds running on glowing sand and swimming in light. That is a complete, shareable visit.

**Fifteen minutes.** Route by night: home → wreck (1:10) → milkwood (2:30) → cairn passed on the way, climbed, the map view (4:00) → pool (5:30) → boat (7:30), a sail with tideglow already lit: shot 2, and if they go out far and call, shot 3 (to 10:30) → land at the point, lighthouse: shot 4 (11:30) → the beam points at the cairn, the wisp hangs at 12 m → cairn top: the ending (13:00–14:30) → free on a lit island. About 400 m of travel, five acts, one sail.

**Returning.**

- *Lights persist* (they do today, per seed). On return there is no fall: the wisp is waiting in the home lantern and comes out when the cat walks up. Line: `the lights are still on`.
- *They come back at a different hour*, which is the real reward. A visitor who lit the wreck at noon and read `after dark` returns in the evening to a glowing shore they caused.
- *After the ending*, the island is the place in section 5 ("afterwards"): every light on, animals trusting, the star at the pole on any clear night, and one new thing to do: call it down.
- *The sky is never the same twice.* Moon phase, the hour, the weather and the meteor calendar are real; the table below is what a second and third visit differ by.

### The same island, told by the real sky

| Condition | What the story uses |
|---|---|
| Noon | The fall is a chalk-white daylight fireball. Lights are flames, not glows. The pull is the boat, the pool, the chimney smoke after the lamp. The ending runs a whole night as a lapse (section 5). |
| Golden hour / dusk | The best first visit. Lights come up in value as the sky goes down. The wisp sits with a sitting cat at sunset (exists). If the ending falls at dusk the lights answer one by one for real. |
| Night, no moon | Milky Way, strongest tideglow and fireflies (true of both). The night sail is at its best. The pole star is plain. |
| Night, full moon | Tideglow and fireflies at about half strength (true). The moon path on the sea does the work instead; the whale's back shines; shadows of the cat on the sand. The lamp's hold on the cat reads less; the moonlit island reads more. |
| Moon rising or setting | The watch camera already finds it. If it happens during a sail the wisp stops towing for a few seconds and faces it (uses the existing sunset "sit together" branch with the moon). |
| Overcast | No stars. The lights own the picture: the lamp's beam sweeps the cloud base (real; it is the one time the beam is drawn as a shaft), the cottage windows and lanterns read warmest of all against flat grey-blue. The ending handles cloud honestly (section 5). |
| Rain | The wisp flies low and close and shelters under the milkwood, the cottage eave, the boiler. Lit places are dry places. Halos round every lamp. Fireflies stay under the crown. Roof drum on the cottage. A visitor in rain is led from shelter to shelter. |
| Storm | The wisp will not lead over open ground; it waits in the nearest shelter with the cat. Lightning shows the unlit places as silhouettes: free reconnaissance. The boat will not launch (`refuse` exists). |
| A real meteor shower night | The fall comes from the shower's real radiant. Any meteor makes the wisp stop and look up (exists) and try, briefly, to rise. |

---

## 3. Five shots

Each is triggered by something the cat does. Each is quiet until then. None adds a full-screen pass. Triangle figures are against the budgets in `docs/handover/perf-research.md` (laptop land ≤ 900k, phone ≤ 500k).

### Shot 1: the fall and the first lantern

- **Where**: the home beach, the cat on its rock.
- **Trigger**: the visitor's first input (fallback 6 s after the title clears, so an idle tab still starts).
- **Beats**: (1) a bright point hanging where the loading wisp was. (2) The cat looks up. (3) 1.4 s fall along a fireball track, its light racing over the sand and the cat (one of the four `magicGlow` slots, moving). (4) Thump, sand puff, six embers. (5) One beat of nothing but sea. (6) The wisp lifts, fails to rise, sinks. (7) It goes to the cold lantern and waits. (8) The cat comes; the wick catches; the wisp climbs to 3 m and sinks.
- **Camera**: untouched for beats 1–2. On the fall, a critically damped tilt up of at most 12° that follows the streak down, then returns to the player. No cut, no letterbox, never taken for more than 2.5 s. From beat 6 it is entirely the player's.
- **Heard**: nothing announces it. A thin falling hiss that drops in pitch, a soft low thump in sand, one glass-like tick, then the wisp's single note. At the lantern: a wick's soft catch, the glass ticking as it warms, two notes.
- **Ends**: with a lit lantern and a light setting off inland.
- **Why they send the link**: "a star falls on your beach in the first ten seconds and you help it." It is a premise that fits in a message.
- **Cost**: the fireball is the existing gated branch in `phenomena.wgsl` for 1.4 s. Sand puff and embers: one existing spray/mote emitter, ≤ 30 sprites, 2 s. Home lantern and post: ≤ 400 triangles, reusing `boat-forms.js` LANTERN geometry and `glowMaterial`. Zero when idle. No new pass.

### Shot 2: lantern on the water

- **Where**: aboard the boat, at night, heading out from the cove. Needs the boat; is at full strength with the wreck lit too.
- **Trigger**: the cat boards and steers offshore. The shot is not a cutscene; it is what steering out *is*, staged by three thresholds of distance offshore.
- **Beats**: (1) 0–25 m: the lantern's amber pool on black water, the hull's creak, the wisp ahead of the bow on its thread. (2) Past the kelp (~25 m): with tideglow lit, the wake opens behind as two lines of cold blue that fade over three seconds, and each oar-less surge of the bow throws a little light. (3) ~45 m: the moon jellies, brought in from 80 m to a 35–60 m band (audit 8), rise under the lantern, pale rings in dark water. One line: `they rise to the lantern`. (4) Past 60 m, if the cat stops steering: the boat settles, the cat sits on the bow sheets, the wisp comes back and sits on the stem. The camera does the only thing it does in this shot. (5) Looking back: the island is a dark shape with its lit places as warm points and the lamp turning. Looking out: the real sky to the horizon, the Milky Way and whatever is rising tonight, in the right place.
- **Camera**: the afloat follow (`BOAT_VIEW`) throughout. At beat 4 only, after 3 s without input, it eases lower and wider over 4 s until the horizon is on the lower third and the lantern is the only warm thing in frame; any input gives it back at once.
- **Heard**: hull slap, a slow timber creak tied to roll, the lantern's bail squeaking on the swing, wake hiss that rises with speed; at beat 4 the score thins to one held note and the sea.
- **Ends**: when the visitor steers again. It has no end state; it is a place to be.
- **Why they send the link**: it is the screenshot. A cat in a small boat with a lantern, a glowing wake, and the actual sky over Cape Town tonight.
- **Cost**: nothing new is drawn. Wake glow is the existing tideglow agitation fed from `wake.js`; jellies are the existing single draw (150 discs), only moved closer; the camera ease is arithmetic. Pipelines for tideglow and lantern are already per-gift gated. Zero when ashore.

### Shot 3: the whale beside the boat

- **Where**: aboard, more than 70 m offshore. Needs the boat and the pool.
- **Trigger**: the cat meows from the boat (or sits still in the bow for 8 s). Without the pool's trust the meow gets a far-off blow on the horizon and nothing else, which is the hint.
- **Beats**: (1) Three seconds of nothing. The dolphins, if present, peel away. (2) The water 12 m off the beam domes and goes smooth. (3) The head breaks surface alongside, parallel to the boat, longer than the boat by three times. (4) The blow: a V of mist four metres high, lit amber from below by the lantern, and, if the lamp is lit, cut once by the lighthouse beam passing through it. (5) The inhale. The back rolls through, callosities and all, for a long time. With tideglow, its edges draw in blue. (6) The boat rocks on its swell (one impulse into `boat-dynamics`). (7) The flukes lift, drip, and go under without a splash. (8) The cat, which flattened itself at beat 3, stands back up.
- **Camera**: the afloat follow yaws at most 35° toward the whale over 2 s and widens to hold boat and blow; critically damped; returns after the flukes. Input always wins.
- **Heard**: the single most important sound on the site. A deep hollow exhale about 1.5 s, close enough to hear the wet in it, then the inhale like a cave breathing in; water sheeting off the back; the boat's planks answering the swell; drips from the flukes; then quiet and one answering note from the wisp.
- **Ends**: the whale is gone for at least four minutes. Line: `the whale answers`.
- **Why they send the link**: scale and breath. The biggest animal on the site comes because you called, and you see its breath in your own lantern light.
- **Cost**: the whale exists (1,700 triangles, one draw) and its spray emitter exists (24 sprites a blow). New: `whale.summon()` and one lantern-colour uniform on the spray material. No new geometry. Zero when not summoned; the "whale lookout" marker and the random distant schedule are cut, so the whale costs less than today when idle.

### Shot 4: the light looks at you

- **Where**: the lighthouse headland. Best at dusk or night; works by day as a smaller thing.
- **Trigger**: the cat meows within 40 m of the unlit tower (the wisp hangs at the lantern room, sixteen metres up, where the cat cannot follow; the meow hint appears here if it has not been learnt).
- **Beats**: (1) The meow echoes off the tower. (2) The wisp goes in at the top. (3) The wick catches, gutters twice, swells (`lampCatch`). Windows: lantern room, then the stair slits top to bottom, then the cottage panes, one at a time. (4) The lens begins to turn, slowly, clockwork taking up (`lampSpin`). (5) The beam comes round and *stops on the cat.* Four seconds: the cat's shadow thrown thirty metres down the headland, every blade of grass lit from one side, the cat's eyes shining back. (6) The beam lifts off and makes its first full sweep out over the sea. Where it crosses water, a stripe of the sea answers under it: with tideglow lit, a travelling line of blue; with the pool lit, a seal's head or a dolphin's back caught in it. (7) It crosses the island: the cairn stands up white for an instant. (8) It settles to its twelve-second turn. The wisp comes back out, climbs, sinks.
- **Camera**: the existing `SHOTS.lamp` (low, far, tower top in frame) through beat 4. At beat 5 it drops behind the cat looking *down the beam* at the tower so the cat is rim-lit. At beat 6 it turns with the beam out to sea for half the sweep, then comes home. The cat is released at beat 6.
- **Heard**: the echo; a wick catching; glass ticking; a slow heavy clockwork that only exists within 15 m of the tower; at beat 5 a low warm swell, no sting; at beat 6 the sea alone, and the swash that the beam crosses breaks a fraction louder.
- **Ends**: with the beam turning. Ever after, a meow within 40 m at night brings the beam round to hold on the cat for four seconds: `the light looks at you`. A meow from farther off makes it blink once.
- **Why they send the link**: the biggest thing on the island notices you, and then you watch your one meow go out across the whole sea.
- **Cost**: the beam's bearing is already a uniform on land and sea. Holding it is arithmetic. The sea stripe is one multiply-add in the tideglow term, gated on lamp × tideglow. Chimney smoke by day: six soft billboards. No new pass, no new triangles beyond the audit's lighthouse rework. Zero when unlit. The beam is drawn as a shaft only when rain, mist or cloud base gives it something to light; on a clear night it is light arriving on surfaces, which is both truer and cheaper than today's "flat tan wedge".

### Shot 5: the south star

The ending. Specified in full in section 5.

- **Why they send the link**: because it is true. The place the wisp goes to is the real south celestial pole from Cape Town, the Cross you are shown is the real Cross where it really is tonight, and the turning is tonight's sky.

### Candidates considered and where they went

- *Beam finds the cat, then wakes the sea*: kept, shot 4.
- *Night sail through tideglow under the Milky Way*: kept, shot 2. "Constellations rising in the right place" needs no work: the sky is already real. Drawing figures over it during the sail is rejected; the sail is better with a plain sky.
- *The island's lights answering one by one from the cairn at dusk*: kept, but as the first beat of the ending (it happens for real when the ending's lapse crosses dusk) and, before then, as the cairn's map view. It is not a separate set piece.
- *Whale beside the boat, breath lit by the lantern*: kept, shot 3.
- *The finale as the real sky*: kept, shot 5.
- *The fall*: added. The site had five endings and no beginning.

---

## 4. What the finale does today

Read from `journey.js`, `quest.js`, `wisp-mind.js`, `fireflies.js`, `sea-sky-magic.js`, `sky.wgsl`, `water.wgsl`, `sea-magic.wgsl`, `ocean.wgsl`, `score.js`:

- It starts by proximity at the beacon once six gifts are awake, usually four seconds after the stars ceremony on the same spot.
- The wisp spirals up round the cat; at 2.4 s the `finale` level wakes and a wide pulse ring runs out.
- The camera orbits slowly for 13 s; time runs at 0.45 for 4.5 s; the cat is held for 13 s.
- Card: `six gifts · one island` / `the island is awake`. Then the line `stay as long as you like`.
- For about a minute at full strength, then at 30% for ever: a storm of about 180 falling stars from one radiant, drawn in the water pass; slow spirals of light turning round the island in the sea; the moon's path doubled; every constellation figure lit at once; all fireflies gathered into a turning column over the summit; lamp and paw-print glow boosted.

Verdict: it is the overwhelm the owner rejected, staged where nobody has seen it. It is five effects at once, none of them a consequence of the story, three of them physically false (the storm, the spirals, the doubled moon path) on a site whose claim is that the sky is real. The settled 30% state leaves a permanent meteor storm, which makes the real meteors worthless. **Cut all of it** except the phrase in the score and the last line of text.

---

## 5. The ending

### Condition

All five lights lit. The wisp is hovering at 12 m and drifting to the hill. The lamp's beam lingers on the cairn each turn. The cat climbs the cairn (three hop-height steps, audit 5) and sits on the top step. Sitting is the act: the ending does not start because a radius was crossed.

### The shot, night version (sun below −6°)

Times are seconds from the sit. The cat is held only from 0 to 16.

| t | Beat |
|---|---|
| 0 | The cat sits. The camera eases up and back as for the map view. **The island answers**: each lit place's practical flares once (`waking-light.md` 5.7: power × 2.5, decaying over 2 s), half a second apart, in the order the visitor lit them, home lantern first; the beam swings to the summit. Then all six sit steady as warm points. The score stops. Sea and wind only. |
| 3 | The wisp comes down to the cat's nose, one last time. One beat, level with its eyes. The cat slow-blinks. |
| 5 | It rises. No spiral. As it leaves, the `stars` row of the waking table plays from the cairn (`waking-light.md` 5.4): a cool front of dew-glints runs down the summit grass to 60 m, lit from above, because the light is now over the island. Straight up, then leaning south. It sings the phrase as it goes, all six notes for the first time, one for each light and the last for itself. The camera tilts to follow, turning to true south, until the horizon is at the bottom fifth of the frame. |
| 10 | It is among the stars and still climbing, now a point. It slows as it nears a place 34° above the southern horizon where there is nothing. |
| 13 | It stops there. A soft swell of light, once, the size of a thumbnail. It is a star now: white, steady, about as bright as the Pointers. |
| 14 | The Southern Cross, wherever it really is tonight, draws itself: four strokes, the existing pen of light. Then the pen runs on past the foot of the Cross along its long axis, four and a half lengths, a thin line, and arrives exactly at the new star. The line fades. The Cross's figure fades to nothing. |
| 16 | The cat is free. The camera stays on the sky unless the visitor moves it. Card: `home`, in the arrival's type, 5 s. |
| 18–48 | **The sky turns.** Time runs forward as a lapse, about two hours in thirty seconds (never past astronomical dawn; stop early if needed). Every real star wheels clockwise round the one that does not move. The moon, if up, travels. Below, the island's lights hold perfectly still and the lamp keeps its real twelve-second turn (the lapse advances the sky, not `magic.clock`). This is the image: a still island, a still star, and everything else turning. |
| 48 | The lapse eases to a stop. One held chord. Line: `stay as long as you like`. |
| after | Over the next ninety seconds the sky drifts back to live time, too slowly to see. |

Any movement input after t = 16 returns the camera at once and lets the lapse finish behind the visitor's own view. Reduced motion: no lapse and no camera move; the wisp rises, the star is there, the card shows.

### Day version (sun above −6°)

The stars cannot be seen, so the ending borrows tonight. It is the same shot with a longer lapse, and it comes full circle.

| t | Beat |
|---|---|
| 0–5 | As above: sit, the wisp at the cat's nose. |
| 5 | The wisp rises to 20 m and waits there, bright. The day begins to run. |
| 5–20 | Lapse to tonight's dusk: the real sun goes down at its real azimuth, shadows swing and stretch across the island. **As the light fails the island's lights come on, one by one, in the order the visitor lit them**, home lantern first. This is the "lights answering" shot and it is earned by time passing, not by an effect. First stars. |
| 20–36 | Night. The wisp climbs to the pole, the swell, the Cross points. Card: `home`. The cat is free from 24. |
| 36–56 | The sky turns through the whole night round the star. |
| 56–66 | Dawn comes up on a lit island. The lights pale and hold. The lapse continues to the same clock time it left, a day later in preview only, and stops. Chimney smoke. Line: `stay as long as you like`. |

It ends where it began, with one thing different: the visitor knows what is up there. Sixty-six seconds, skippable from 24 by moving.

### Weather

- Thin or broken cloud: nothing special; cloud racing in the lapse is a gift.
- Overcast or rain: the wisp rises into the cloud and its light spreads inside it. During the lapse only, cloud cover is eased down to at most 0.3 (clouds visibly blowing through, which is what a lapse shows) and restored over ten seconds when live time returns. This is the same honesty as the time panel's "preview"; the header conditions do not change. If a storm is on, the wisp will not go up: it waits under cover and the cairn does nothing but the map view. The ending is worth waiting for weather.

### Afterwards: a woken island is a nicer place to be

Permanent for the seed, restored quietly on return:

- **Every light is on** and behaves as in section 1. The night island is navigable by its own lamps.
- **The south star.** On any clear night it is there, 34° up, due south, not moving. Nothing marks it. It is visible in photo mode and in reflections of the sky that the sea already draws.
- **Call it down.** A meow anywhere under open sky: the star brightens, and a small light comes down the sky to the cat in about three seconds (the fall, gently). It keeps company exactly as before the ending, tows the boat, sits at sunset, and goes home when the cat sleeps, or after two minutes of the cat sitting still, or when the visitor leaves. First time: `it comes when you call`. By day it comes too; stars are there by day. This keeps the companion, keeps the boat working unchanged (`boat.js` tows from `magic.wisp`), and leaves the visitor with a new verb instead of a credit roll.
- **Trust.** Seal race, penguin parade, tortoise, butterfly, whale answer: all the audit's interactions are available with no gating left.
- **Shelter and warmth.** The cottage sill, the milkwood fork, the boiler, the boat's bow sheets are all good places to sit; each has its sound; a cat asleep in any of them at night gets the existing dawn lapse.
- **Nothing settles at 30%.** No leftover storm, spirals or column. The island at rest after the ending draws *fewer* effects than the island mid-quest, because the wisp is usually in the sky.
- **The score** gains the sixth note for good: the complete phrase may now appear, rarely, in the generative music at night.

`begin again` puts the lights out, takes the star out of the sky, and the next load opens with the fall.

---

## 6. What to cut for the story's sake

Plainly. Each of these is rejected.

| Cut | Where | Why |
|---|---|---|
| The whole current finale spectacle: meteor storm, sea spirals, doubled moon path, firefly column, all figures lit, the boosts, and the permanent 30% settle | `water.wgsl` meteor storm, `sea-magic.wgsl` `spirals`, `ocean.wgsl` ~448, `fireflies.js` finale branch, `sky.wgsl` finale terms, `FINALE_SETTLE`, `finaleBlaze` | Section 4. False on a site about a true sky; loud; unseen. |
| The stars gift as a separate ceremony at the beacon | `magic.js` KEEPSAKES, `journey.js` SHOTS.stars | Two ceremonies on one spot. The sky is the ending, not a stop on the way. |
| Every constellation figure drawing itself | `sky.wgsl` `constellation_lines` | One figure, the Cross, once, for a reason. Afterwards a figure may draw only for the one constellation at the centre of the sit-and-watch camera, one at a time. The faint always-on atlas lines go too: the sky should look like the sky. |
| Meteors with long glowing trains (stars gift) | `sky-events.js` `meteorInSlot` magic argument | Real meteors are the point. |
| Waking by proximity radius | `quest.js` `update` | "Gives without being asked." Each light wakes on its act. |
| The pulse ring, the burst bubble, the lime edge wash | `magic.pulse`, `wisp.js` burst, `mEdge` | Not light. Replaced by the kindled light in `waking-light.md`; its delete checklist (section 8 there) stands in full. |
| Time slowing to 0.3 during ceremonies | `journey.js` `timeScale` | It stalls the sea and reads as a hitch. `waking-light.md` softens it to 0.6 for 1.2 s; take that, and remove it altogether if the first captures still show the swash stalling. Never in the ending. |
| `found · …` lines for places and creatures that do nothing | `thread.js` onFind | "Say things but nothing really happens." A line only when the world answered. |
| The geography discoveries: hilltop, far shore, long point, deep cove, top of the big rock, kelp | `discoveries.js` `islandDiscoveries` | Names for places where nothing happens. |
| Creature "finds" by proximity: crab, butterfly, fireflies, gulls, tortoise, penguin colony, seal rock, oystercatchers | same, and each animal's `pois` | Replaced by the interaction lines, earned by acts. |
| Whale lookout POI and the whale's random distant schedule | `whale.js` | It marks empty sea. The whale comes when called. |
| Gift glyphs in the notes, coloured dots on the toggle, tooltips | `moments.js` GLYPHS, `renderGifts` | A HUD quest log. The cairn is the log. |
| Card small line with the place's title; `six gifts · one island`; `the island is awake` | `journey.js` | One line each. The ending says `home`. |
| Wisp colour carried from the last gift; hide-and-pop; darting beside a runner | `journey.js` `colourFor`, `wisp-mind.js` | It is a star: white, and it only gets brighter. Behaviours that are not leading, waiting, answering or keeping company blur what it wants. |
| The wisp's ground "pool" sheet | `wisp.js` POOL | Stretches across rocks and lights the ground twice (`look-research.md`). The `magicGlow[2]` point light is enough. |
| Wisp as a sun-sized flare by day | `wisp.js` | A small bright point with a short tail. |
| Ambient fireflies outside the gift | `critters.js` | The fireflies are the milkwood's. Before it is lit there are none anywhere, so lighting it is the arrival of fireflies on the island. |
| Wreck stem lantern, beacon lantern | places | Unlit lanterns that can never be lit are lies in this story; lit ones that nobody lit are worse. The only lanterns are home and boat. The audit already cuts both. |
| Cormorant flock, oars, floats, rope coil, yard wall ribbon, stacked boulders | per `object-audit.md` | Noise. |
| The lighthouse beam drawn as a wedge on clear nights; lamp, panes and lanterns glowing at noon | `places.js`, `land-magic.js` | Light is seen where it lands, or in rain and cloud. |
| `dreaming of dawn · a preview` | `thread.js` | `dreaming of dawn`. |

Kept and promoted: the lessons, the arrival title, the sit-and-watch camera, the dawn lapse, photo mode, the generative score, the real sky events, the boat, the moon jellies, dolphins on the bow.

---

## 7. Build plan

Ranked. Steps 1 and 2 are the beginning and the end; with only those two merged the site has a story, even with the middle still waking by radius. Every step: commit after each sub-step; `node --test`, `npm run check:shader`, `npm run build` green; state triangle and draw-call deltas from `?perf` (`data-triangles`, `data-draw-calls`) against the regression budget (triangles within +3%, draw calls within +10).

Lanes referred to: **places** (place-kit, place-*.js), **affordances** (`src/affordances.js`, walker events), **waking light** (`waking-light.md`), **boat** (boat*.js), **cat** (cat*.js), **sound** (sound.js, calls.js, score.js), **camera** (walker.js camera, journey cam).

### Step 1: the beginning (the fall, the first lantern, the climb, the words)

Owner of files: `journey.js`, `wisp-mind.js`, `quest.js`, `magic.js`, `moments.js`, `thread.js`, `discoveries.js`, `score.js`, plus one small prop.

1. `magic.js`
   - `export const LIGHTS = ["boat", "fireflies", "tideglow", "seafolk", "lamp"];` `GIFTS` stays as the six for storage compatibility.
   - `KEEPSAKES`: remove `beacon: "stars"`. `stars` is woken by the ending.
   - Record gains `home: { lit: false }` (the home lantern) and `climb: 0` (lights lit, 0–5, for the wisp).
2. `wisp-mind.js`
   - `fall(from, to)`: replaces `appear(cat)`. `from` is a point 60 m up along the fireball's track, `to` a beach point 9 m ahead of the cat (`keepInside`). 1.4 s ballistic, then mode `"landed"` (hidden 1 s), then `"greet"`.
   - `reach(n)`: a one-off rise to `[1.5, 3, 5, 8, 12][n-1]` m above ground over 2.2 s, a 0.6 s hang, a 2.5 s sink; for n = 5 it does not sink (`mode = "aloft"`, drifting toward the summit at 1 m/s, 12 m up).
   - Remove the hide and dart branches. Keep lead, wait, beckon, fetch, answer, company, peek, gaze, sit.
   - `shelter(point)`: when `ctx.rain > 0.5`, perches under the nearest cover (list from places: `covers`); until the places lane provides covers, the milkwood centre only.
3. `quest.js`
   - `target(x, z, night)`: nearest unlit by `distance × WEIGHT[gift][night > 0.5 ? "night" : "day"]`, table in section 2.
   - `act(id)`: the public way to wake. `update()` keeps the radius test behind `ACTS[id].fallbackRadius` until the affordances lane lands (step 4), so step 1 does not depend on it.
   - `finaleSite` requires `LIGHTS.every(awake)`; remove the summit fallback's proximity start: the ending starts from `act("beacon")`.
4. `journey.js`
   - `meet()`: starts the fall on first input (thread passes `lastInput`) or 6 s after the arrival title. Asks `skyEvents` for a forced fireball whose end point projects to the landing spot (`sky-events.js` already places forced fireballs in front of the camera; add `force: { fireball: { bearing, elevation } }` at runtime, not only via `?sky=`).
   - `GIFT_LINES` and the day small line as in section 1. `card.show(small, big, hold, grand)` already takes both.
   - After each `wakeNow()`: `mind.reach(quest.count)` and `sound.home(quest.count + 1)`.
   - Remove `colourFor`. `wakeNow()` sets `magic.waking = { gift, x, y, z, age: 0 }` as `waking-light.md` 3.1 specifies (until `src/waking.js` lands, leave the existing pulse in place: step 1 must not depend on that lane). The home lantern uses the `boat` row of the waking table at 0.4 × reach and no card.
   - Returning with lights lit: no fall; the wisp starts inside the home lantern and emerges at 2 m; `findLine.show("the lights are still on")`.
5. Home lantern: `place-shore.js` (or `place-kit.js`) `homeLantern({ x, z })`: driftwood post 1.1 m, the boat's hurricane lantern from `boat-forms.js` LANTERN, ≤ 400 triangles, one entry in `places.js` `lamps` gated by `magic.home.lit`. Sited 8 m from the cat's start, on the line toward the nearest keepsake by day. A blocker capsule for the post. Lit when the cat comes within 2 m while the wisp waits there. Persist in `skycope.gifts.<seed>` as `"home"`.
6. `thread.js`, `discoveries.js`, `moments.js`: the text changes in sections 1 and 6 (prefix, cut entries, lessons table, notes panel without glyphs and dots, `begin again` confirmation).
7. `score.js`: `export const HOME_PHRASE = [74, 76, 78, 81, 83, 86];` (D lydian, rising, unresolved until the sixth) and `homeEvents(n)` → plucks for the first n notes, the last one held. `sound.js` `home(n)`.

**Judged by** (seed 1847, capture with `scripts/tour.mjs`, port 5339, CDP 9409; clear weather; minutes 750 and 1320):

| Frame | Pass looks like |
|---|---|
| A1 t = 1 s after title | A bright point with a tail high in the sky, cat on rock, no other UI but the header. |
| A2 mid-fall | A streak ending on the beach; sand and cat lit from the streak's side at night; a thin white line by day. |
| A3 +3 s | A small light a metre over a scuffed patch of sand; not a flare; no white-out on the beach. |
| A4 wisp at the cold lantern | Lantern dark, wisp beside it, cat 6 m off. Reads as waiting. |
| A5 lantern lit, night | Amber pool on blue sand ≤ 4 m across, glass and flame visible, wisp 3 m above. |
| A5d lantern lit, noon | A flame behind glass. No glow disc on the sand. |
| A6 after the first real light | Wisp at 5 m with clear sky behind; card with one line. |
| Text sweep | Walk the north shore past penguins, tortoise, seals: no `found ·` line appears. |
| Counts | Home view triangles within +0.1% of before (lantern only); draw calls +2 at most. |

A person who has never seen the site, shown A1–A5 as a strip, should be able to say "a star fell and it lit the lamp" unprompted.

### Step 2: the ending (the south star and the turning sky; remove the old finale)

Owner of files: `journey.js`, `sea-sky-magic.js`, `shaders/sky.wgsl`, `shaders/water.wgsl`, `shaders/sea-magic.wgsl`, `shaders/ocean.wgsl`, `fireflies.js`, `land-magic.js`, `moments.js` (lapse), `star-catalog.js`, `main.js` (uniform plumbing).

1. Delete: `meteor_storm` and its call in `water.wgsl`; `spirals` in `sea-magic.wgsl`; the doubled moon path in `ocean.wgsl`; the finale branch and uniform in `fireflies.js`; `finaleBlaze` and its users; `FINALE_SETTLE`. `magic.levels.finale` stays as the "ending has happened" flag and feeds only the star.
2. The star. `sea-sky-magic.js`: reuse `magic.w` as the south star's brightness (0…1) and add a field `home: [phase, crossPen, 0, 0]` (`phase` 0…1 the swell at arrival; `crossPen` 0…1.2 the pen's progress). In `sky.wgsl`, inside the existing `MAGIC_AWAKE` branch of the star pass: one point at declination −90° (in the horizon frame: azimuth south, altitude = |latitude|, already available from `atmosphere.celestial.y`), drawn with the same point-spread and twinkle as catalogue stars of magnitude ~0.5, plus `phase` as a single soft bloom of radius 0.6°. Cost: one dot product and one `exp` per sky fragment inside a branch that is compiled out before the ending.
3. The Cross. `star-catalog.js` `constellationAtlas`: write Crux's figure id to a known value and export `CRUX = { id, foot: [ra, dec] of Acrux, head: [ra, dec] of Gacrux }`. `sky.wgsl` `constellation_lines`: draw only where `abs(atlas.b - cruxId) < eps`, progress from `home.y`; then the pointer line as a great-circle segment from Acrux toward the pole (distance to a great circle through two known directions, both passed as uniforms; 4.5 Cross-lengths lands within a degree or two of the pole, so end the segment at the pole itself). Fades with `home.y > 1`. Remove the always-on `FIGURE_LINE` term.
4. `wisp-mind.js` `ascend(direction)`: from `"aloft"`, climbs along a ray toward the pole direction; `journey.js` hands the wisp over from the land layer to the sky at 120 m (the land wisp fades out as the sky point fades in at the same screen position; both exist for half a second).
5. `journey.js` `ending()`: the timeline in section 5 as data:
   ```js
   const ENDING = {
     night: { nose: 3, rise: 5, arrive: 13, cross: 14, free: 16, turn: [18, 48], hours: 2 },
     day:   { nose: 3, wait: 5, dusk: [5, 20], rise: 20, arrive: 30, cross: 31, free: 24, turn: [36, 56], dawn: [56, 66] },
   };
   ```
   Camera: `camAim` to true south (yaw from the celestial frame, not from the island), elevation so the pole sits on the upper third; all eases critically damped (camera lane). `holdsCat` only until `free`.
6. The lapse. `moments.js`: generalise `createDawnLapse` into `createLapse({ preview })` with `run({ from, to, seconds, ease })` over unwrapped preview minutes (it already supports "past 1440 is tomorrow"). The ending calls it for the turn (night: +120 min; day: to the same minute tomorrow, in three eased segments). `magic.clock` is not advanced by the lapse, so the lamp and the sea keep real pace. While a lapse runs: shadow refresh at most twice a second (it keys on 0.1° of sun today), cloud history not reset per step, quality scaler frozen. After the night version, drift back at −1.3 min/s of preview until live.
7. Lights in order (day version): `land-magic.js` `lampLights` per lamp gains a per-light threshold on the night level, ordered by `quest` wake order, so they come on one at a time across dusk (thresholds spread over night 0.15…0.6). This also makes every real dusk on a lit island do the same thing, for free.
8. Overcast: during a lapse, the weather passed to the sky uses `min(cover, 0.3)` eased over 6 s; restored over 10 s. Storm: `act("beacon")` returns `"wait"` and only the map view plays.
9. Afterwards: `journey.call()` when `quest.done` and the wisp is in the sky: `mind.fall(poleRay, nearCat)` at a third of the speed, `findLine.show("it comes when you call")` once; `mind.ascend()` again on `pose.sleepy`, or 120 s of sitting, or page hide. `magic2.y` (seconds since the meow, already uploaded, read by nothing) makes the star brighten for a second when called.
10. QA entry: `?perf&magic=fireflies,tideglow,lamp,seafolk,boat&at=beacon` places the cat on the cairn top with five lit, so the ending can be captured without playing; `&magic=all` shows the afterwards state.

**Judged by** (minutes 1320 clear, 1320 overcast, 750 clear; moon as it really is on the day, and one forced full, one new):

| Frame | Pass looks like |
|---|---|
| E0 sit, t = 1 | Island below with six warm points, beam mid-turn, wisp above. No ring, no column, no meteors. |
| E1 t = 4 | Wisp level with the cat's face, close. |
| E2 t = 9 | A white point with a short tail against real stars, south, horizon low in frame, island lights still in the bottom of the picture. |
| E3 t = 13.5 | One new star, a small soft swell round it. Nothing else has changed in the sky. |
| E4 t = 15 | The Cross drawn as four thin lines, a fifth thin line from its foot ending on the new star. Check against a planetarium for the date: the Cross is where it should be and the line's end is 34° above due south. |
| E5 three frames across the turn | Star positions rotated about the new star; the new star on the same pixel in all three (± 2 px); island lights unmoved; the beam at different bearings. |
| E6 end | Line `stay as long as you like`; sky plain; no residual effect anywhere. |
| D1–D4 day version | Sunset at the correct azimuth; a frame at dusk with exactly some, not all, lights on; night frames as E2–E5; dawn frame with lights pale and on. Ends at the starting minute. |
| O1 overcast | Cloud lit from within where the wisp went in; breaks during the turn showing stars; cover back to live afterwards. |
| R1 reduced motion | Star present, card shown, no camera move, no lapse. |
| After | `&magic=all` at 1320 from the home beach looking south: the star is there. Meow: a light comes down in ≤ 3 s. |
| Counts | With `magic=all`, night, cairn looking out: triangles **lower** than today's `magic=all` (column and boosts gone); sky and water pass GPU time not higher than with the stars gift alone today. Lapse: no frame over 50 ms in a 60 s trace on an idle machine. |

The test of the step: a person shown E2–E5 says "it became a star and the sky goes round it". Then tell them that spot is the real south pole of the sky and watch their face.

### Step 3: lights that stay, and the cairn as the map

Depends on: places (trig cairn steps; levelled pads), camera.

- The lit places are the `practicals` list of `waking-light.md` 3.7 (`{ x, y, z, colour, reach, power, gift }`: furnace ember, pool lit from below, boat lantern, the lamp and its necklace, the crown's pool). Add `order` (when the visitor lit it) and the home lantern (`gift: "home"`). What this step adds on top is that each has a halo sprite legible as a point from the cairn at 60–130 m (2–4 px, no bloom), night-gated per step 2.7; by day flames only.
- `moments.js` `createWatch`: add a `"cairn"` framing with a 1.5 s trigger when the cat sits with `pose.y` on the top step: elevation +0.25 rad, distance to the camera's max, yaw toward the island's centre of lit places. Critically damped; any input ends it.
- `wisp-mind.js` `point(target)`: two out-and-back flights of 10 m toward the target from above the cat, then `reach(quest.count)` from the summit.
- `land-magic.js` `lampSpin`: when `quest` reports five lit and the ending not done, add a 0.6 s dwell as the beam bearing crosses the cairn.
- Remove `GLYPHS`, `renderGifts`, `.gift-dots`, `.gift-marks`.

**Judged by**: cairn-top frames at 1320 with 0, 2 and 5 lit: the count is readable from the picture alone; lit places are small warm points, none blown out; the unlit lighthouse is a dark silhouette against sea or sky. At 750: the map view shows smoke from the cottage if the lamp is lit and the boat afloat if launched. Camera: never inside the pillar; no pop when it ends.

### Step 4: acts, not radii

Depends on: affordances (walker events `on-top`, `inside`, `sat-near`, `meow-near`, `bumped`, `ran-at`), places (hop-height hull, walk-in boiler, limb ramp, pool rim, door steps).

```js
// quest.js
export const ACTS = {
  boat:       { any: [{ on: "on-top", count: 2 }, { on: "on-top", then: "meow-near" }], fallbackRadius: 3 },
  milkwood:   { on: "sat-near", where: "fork", seconds: 2,  fallback: { on: "sat-near", seconds: 3, r: 5 } },
  wreck:      { on: "meow-near", where: "inside:boiler",    fallback: { on: "meow-near", r: 6 } },
  pool:       { on: "sat-near", r: 1.2, seconds: 5 },
  lighthouse: { any: [{ on: "meow-near", r: 40 }, { on: "bumped", where: "door" }] },
  beacon:     { on: "sat-near", where: "top", seconds: 1.5, needs: "all" },
};
```

- `affordances.on(event => quest.offer(event))`; `quest.offer` returns `{ type: "wake", place }` as `update` does now. The fallbacks let this step land before every prop is reworked.
- Half-attempts answer too, so nothing is ever silent: one hop on the hull knocks and a crab bolts; a meow outside the boiler gets a faint hum; walking past the pool shuts the anemones; a meow far from the lighthouse (once lit) blinks it.
- The wisp shows the act by where it waits: on the hull, at the fork, inside the boiler mouth, over the pool's centre, at the lantern room. It never mimes.
- `seafolk`: `wildlife.js` temperament table reads `magic.levels.seafolk` as `trust`; the audit's interactions 5, 7, 9, 13, 14 key on it.

**Judged by**: a scripted run in which the cat walks through every place without acting: nothing wakes. Then each act: wakes within 1 s of the act completing. Frames: the boat mid-roll with the cat on it; the cat inside the boiler with the wisp at the mouth; the pool with fish in the cat's shadow. Day frames of the boiler interior showing the blue puddle at noon.

### Step 5: shot 4, the light looks at you

Depends on: places (lighthouse rework, stair windows as separate lit elements, chimney), waking light, sound.

- `land-magic.js`: `lamp.hold = { until, bearing }`; `lampSpin` eases the bearing to the cat and holds 4 s, then releases into the first sweep. `journey.js` ceremony `lamp`: beats and camera as in section 3; windows lit in sequence through `lampLights` per-lamp levels (step 2.7 mechanism).
- `sea-magic.wgsl` `tideglow`: add the beam cone (the sea already has the lamp position and bearing) as agitation, × `magic.z` × `magic.x`. One multiply-add.
- Beam shaft: strength × `max(rain, mist, lowCloud)`; 0 on a clear night.
- Chimney smoke: 6 billboards on the existing spray system, day only, when `lamp` is lit.
- After: `journey.call()` within 40 m at night sets `lamp.hold`; farther, a one-frame-pair blink.

**Judged by**: six frames at 1320 (meow; lantern room lit; stair windows half lit; beam held on the cat seen from behind the cat; beam over the sea with a blue stripe when tideglow is lit and none when not; settled). The held frame must show a hard-edged cat shadow and no light on ground behind the hill. At 750: lens glint and smoke, no beam, no glow discs. Counts: no change in triangles beyond the places lane's own.

### Step 6: shot 2, lantern on the water

Depends on: boat (waterline, wake, aboard camera post, no tether), sound.

- `boat-jellies.js` `jelliesPlace`: band 35–60 m; one jelly glint visible from the cove at night.
- `wake.js` → tideglow agitation for the hull (check it is fed; add if not).
- `walker.js` boat camera: the idle ease (3 s without input and more than 60 m offshore) to horizon-on-lower-third; input cancels.
- `wisp-mind.js`: when the boat is stopped, perch on the stem.

**Judged by**: frames at 1320 new moon and full moon, tideglow lit and unlit: from astern at 30 m (wake lines), over the side at 45 m (jellies under the lantern), the idle frame at 80 m looking seaward (lantern, cat, horizon, Milky Way; check the Milky Way's orientation against a planetarium) and looking back (island with its points and the beam). The post must not cross the cat in any of them.

### Step 7: shot 3, the whale

Depends on: boat (swell impulse), sound (the blow), step 4 (`seafolk` trust).

- `whale.js`: `summon({ x, z, heading, side })`: places the whale 12 m abeam, parallel, state `"rise"` with one breath then `"sound"`; cooldown 240 s. Remove `pois` and the random schedule's breaches (keep a rare far blow as ambience only when the pool is lit).
- Spray material: `boatLamp`/`boatLampColour` uniforms (from `boat.js` `lampUniforms`) as an inverse-square tint; lamp beam term as in land magic.
- `boat-dynamics.js`: `impulse({ x, z, strength })` one radial swell.
- `cat.js`: a flatten pose for 3 s (ears back, low) on `whale` within 20 m.

**Judged by**: five frames at 1320 (smooth dome; head up; blow at full height lit amber from below; back mid-roll; flukes). The blow must be warmer at the bottom than the top. At 750: the same in daylight, white blow. Without the pool: a meow gives only a far blow on the horizon. Counts: +1 draw, +1,700 triangles only while summoned.

### Step 8: weather, moon and return

- `journey.js` ctx gains `rain`, `storm`, `moonPhase`, `moonAlt`; `wisp-mind.js` shelter and low flight; refuse to lead in a storm.
- `sea-sky-magic.js` / `fireflies.js`: tideglow and firefly strength × `(1 − 0.5 × moonIllumination × moonUp)`.
- Returning-visitor openings (section 2).
- Real shower nights: the fall's track from the shower radiant.

**Judged by**: the same four views at new and full moon, clear, overcast and rain: twelve frames in a sheet, each recognisably the same island and recognisably a different night.

### Step 9: sound pass (with the owner listening)

Section 8. Agents cannot hear; the owner listens at three checkpoints: after step 1 (fall, lantern, phrase), after step 5 (lighthouse), after step 7 (whale).

---

## 8. Sound cue list

All synthesised (`calls.js`, `score.js`). Levels relative to the sea bed; everything spatialised from the cat except the score. "New" means no cue exists today.

| Cue | When | Character | New |
|---|---|---|---|
| `star-fall` | shot 1 beat 3 | Thin airy hiss, falling a fifth in pitch over 1.4 s, very quiet until the last 0.3 s | yes |
| `star-land` | beat 4 | Low soft thump (sand, no ring), a spray of grain ticks, one glassy tick | yes |
| `wisp-note(n)` | the wisp speaks | One pluck from `HOME_PHRASE[n]`, bell-like, slight shimmer | replaces the wisp chime |
| `home-phrase(n)` | each `reach(n)` | First n notes rising, the last held and left hanging; n = 6 at the ending resolves with the octave below under it | yes |
| `wick-catch` | home lantern, boat lantern, lamp | A soft "fff" and settle; lamp version larger, with two gutters | yes |
| `glass-tick` | 1–4 s after any lantern lights | Two or three irregular ticks | yes |
| `hull-knock` | on-top the upturned boat | Hollow wooden knock, pitched by where the cat lands | yes |
| `hull-roll`, `hull-slide`, `hull-float` | launch | Timber on timber, sand hiss, a slap and the first lap of water | partly (`launch`) |
| `boat-creak`, `hull-slap`, `bail-squeak`, `wake-hiss` | afloat | Tied to roll, to swell under the bow, to lantern swing, to speed | `hull-slap` exists |
| `boiler-step` | inside the boiler | Footsteps with a short metallic ring | yes |
| `boiler-hum` | within 40 m of the unlit wreck | A hollow breath of wind across the mouth, barely there | yes |
| `boiler-bell` | meow inside | The meow returned as a deep bell an octave and a fifth down, 4 s tail | yes |
| `tide-light` | the first lit swash | The swash sound with a faint high glassy component, once | yes |
| `crown-wind` → `crown-lights` | milkwood unlit → lit | Leaves in wind; lit, the same with a few very quiet high ticks at night | yes |
| `pool-drip` → `pool-return` | pool unlit; fish return | Drip and suck in rock; a soft cluster of plops | yes |
| `shutter` | cottage, unlit | A loose shutter in wind, irregular | yes |
| `tower-echo` | meow within 40 m of the tower | The meow back, late and dark | yes |
| `clockwork` | within 15 m of the lit tower | Slow heavy escapement, one tick a second | yes |
| `beam-hold` | beam on the cat | Low warm swell on D, 4 s, no attack | yes |
| `whale-blow-near` | shot 3 | Deep hollow exhale 1.5 s with wet noise, then a long inhale; `blow` exists for distance, this is the close one | yes |
| `whale-back`, `fluke-drip`, `boat-swell` | shot 3 | Water sheeting; drips; planks working | partly |
| `ending-rise` | section 5 t = 5 | The full phrase, slow, each note with more air; under it nothing but sea | yes |
| `ending-arrive` | t = 13 | One soft high bell and its octave below; then silence for two seconds | yes |
| `turn` | the lapse | One held open fifth on D, very quiet, breathing with the sea; ends on the chord from `CEREMONIES.finale`'s last pad | reuse |
| `call-down` | after the ending, a meow | `star-fall` at half speed and half level, then `wisp-note(6)` | yes |
| Rain on iron, dry under the eave | cottage in rain | From the sound lane's own list | sound lane |

The existing per-gift ceremony phrases in `score.js` stay as the harmony under each waking; `home-phrase` is the melody the visitor learns. Cut: the `discover` chime for inert finds.

Mix rule: one new cue at a time; nothing above the sea except `whale-blow-near` and `boiler-bell`.

---

## 9. Seams with the other designers and lanes

- **`waking-light.md`** owns how a waking looks as light, and this document adopts it whole: `src/waking.js`, `magic.waking`, the kindled point as the wisp re-lit, catch / reach / linger / resolve, the practicals, the card at 2.4 s, its sound cues `kindle`, `reach`, `glints` (section 8 here lists only the cues that document does not), and its delete checklist. The `reach(n)` climb of the wisp starts when the wisp re-emerges from the kindled point (about 6 s), so it reads against a settled scene. Two differences, both about *when*, not *how*:
  1. **The stars are not a stop on the way.** That document wakes the stars at the beacon as the sixth gift (its 5.4) and then plays a finale (5.7) on the same spot. Here the beacon has no waking of its own; its 5.4 treatment (the glint front down the summit, light from above, one figure, eyeshine) is used once, as the moment the wisp leaves the cairn in the ending, and "one figure" is the Cross. Its `stars` table row is kept; its "one meteor at 3.5 s" is dropped, because the wisp rising *is* the falling star run backwards and a second streak would compete with it.
  2. **The finale row is not a blast from the wisp.** Its 5.7 "the island answers" (practicals flaring in turn, the beam swinging to the summit) is kept as the ending's first beat, ordered by when the visitor lit each rather than by distance. The 60 m warm-white `finale` waking over the cat is not used: the wisp is leaving, not kindling. The fireflies' column, which that document leaves to the owner, is cut here.
  Where the two documents disagree on a look, that one wins; on the order of events, this one.
- **`first-visit-audit.md`** owns what confuses a first visitor. Section 6 here is the story's cut list; where the audit cuts more, cut more. If it objects to the 6 s fallback or to the tilt in shot 1, shorten the tilt before removing the fall.
- **Places**: home lantern prop; cairn with three hop steps; walk-in boiler; hop-height hull; limb ramp and fork; stair windows as separately lit elements; chimney; covers list for shelter.
- **Affordances**: the six events with `where` tags (`fork`, `inside:boiler`, `top`, `door`).
- **Boat**: wake into tideglow; `impulse`; stem perch point; the aboard camera's post.
- **Cat**: look-up on the fall; slow blink at the ending; flatten at the whale; eye shine in the beam (one emissive term keyed on the lamp hold).
- **Camera**: every move here is critically damped, cancellable by input, and never longer than stated. The ending's turn to true south needs yaw in the celestial frame.
- **Sound**: section 8; three owner listening checkpoints.

## 10. Risks and things not verified

- Nothing here was played or captured. The site was read. The geometry of sightlines (whether the lighthouse is visible from the home beach, whether the cairn top sees all six points) must be checked in step 3's frames before relying on them.
- The Cross in November evenings is low in the south from Cape Town. If it is within 5° of the horizon at the ending, start the turn first and draw the Cross when its foot clears 8°.
- A 24-hour lapse in a minute will hit the shadow refresh and the cloud temporal history. Step 2.6 lists the guards; it needs a real trace on an idle machine.
- The land-to-sky hand-over of the wisp (WebGL land layer to WebGPU sky layer) must match in screen position and brightness for half a second. If it cannot be made seamless, hide it behind the `ending-arrive` swell by doing the hand-over at the moment of arrival instead of at 120 m.
- Removing proximity `found` lines makes the field notes emptier until step 4 lands. That is acceptable for one merge; do not ship step 1 live without at least the half-attempt answers for the boat and the pool.
- Whether a meow is discoverable enough to gate two lights (wreck, lighthouse) depends on the meow lesson firing at the right moment. Both have a second route (the fallback and the door) for that reason.
