OBJECT AUDIT: Sky Cope, magic-round2 (read-only; repo untouched; server and Chrome stopped)

Evidence: contact sheets (3x3: wide, N, E, S, W, contact, scale, top-down, on-top) in S = /private/tmp/claude-502/-Users-skycope-Code-skycope/f5ab9af3-9006-4e05-a49e-0559244e2385/scratchpad/object-audit/sheets/ named <seed>-<object>-<750|1320>.jpg.

What is current and what is not:
- Captured after the grounding commit, seed 1847 noon: lighthouse compound, wreck, milkwood, pool, beacon, penguins, seals, slope boulders.
- Older captures, reused because the object is unchanged: all night sheets, far views (S/old/1847-far-*.jpg), boat ashore and afloat, seed 2203.
- Not seen: the whale never surfaced in 30 s at the lookout. Dolphins, cormorants, crabs and butterflies were not captured close. No audio was heard.
- The trap scan ran before the grounding commit.

Coordinates are seed 1847 (x, z). Triangle counts are measured near-LOD figures; each spec stays at or under them. World scale: the cat is drawn at 1.4x.

1. LIGHTHOUSE TOWER (123.2, 58.9). Keep, rework. 6,488 tris with cottage, wall and tank.
- Real: Cape lights (Slangkop, Danger Point) are white masonry, 12-18 m, base about 5 m tapering to 3.5 m, corbelled gallery with rail, diagonal-astragal lantern, red dome with vent ball, plank door up two steps, on levelled bedrock at the head's high point.
- Now: from 40 m it is the best silhouette on the island (S/old/1847-far-lighthouse-750.jpg tiles 4-9). Up close it is a smooth cylinder on a 2 m dark rubble octagon at beach level (tiles 1-3); the door is a flat green slab; stair windows are detached orange slivers; beam and panes are lit at noon.
- Spec: keep the 12.6 m lathe. Plinth becomes a 0.4 m whitewashed apron on a levelled pad. Door recessed 0.25 m, two stone steps. Six gallery brackets. Rust weep under gallery and windows, salt-grey to 1.5 m on the sea side. Glow gated by night.
- Scale: right. Siting wrong: move from 8.5 m inland to the headland crest.
- Solidity: camera arm collapses to under 0.5 m between tower and cottage (119.6, 57.2); loose tilted step slabs landward of the plinth.
- So what, now: nothing; you cannot enter or climb.
- Joy: "the light looks at you". At night, meow within 40 m and the beam stops, swings onto the cat and holds it in light for about 4 s, then resumes. Hint: the beam already crosses the cat every 12 s; a half-attempt (any meow, even far off) makes it blink once. Joyful because the biggest thing on the island notices you. Cost S: beam bearing is already a uniform in places.js, plus journey.call; no frame cost. Record: yes.

2. KEEPER'S COTTAGE, TANK, YARD WALL. Cottage: keep, rework. Tank: merge into cottage. Wall: cut as built.
- Real: limewashed plaster, red-oxide corrugated roof, stoep on posts, sash windows with deep sills, corrugated galvanised tank (1.8 m) on a stone plinth under a downpipe, wall of whitewashed rubble 0.9 m stepping down slopes.
- Now: walls read blue-grey on a 2 m dark podium; panes are orange cards at noon; the tank is a smooth grey can on a red cylinder (S/1847-lighthouse-compound-750.jpg tile 2). The wall is a rounded grey ribbon ramping down the hill and round the beach, and reads as a sewer pipe (same sheet tiles 2-4; far sheet tile 2).
- Spec: same 7.2 x 4.4 m footprint on the pad. Add a 1.2 m stoep with lean-to roof on the lee side, sills 0.45 m high and 0.3 m deep, corrugated tank. Replace the 46 m ribbon with two 4 m stepped drystone garden-wall stubs 0.6 m high (hop height).
- Solidity: wall runs to the swash at (131.7, 57.2); hard-edged dark stain disc in the yard.
- Joy: "the sill". Walking into the wall under a window auto-hops the cat onto the sill; it sits, the lamp inside warms, and in rain it is dry under the eave while the iron roof drums. Hint: one sill has a worn paint patch. Joyful as home and warmth after weather. Cost S: one cover rect to precipitation.js, one roof-drum sound. Record: yes.

3. WRECK (-9.4, 43.8). Keep only if reworked; otherwise cut. 3,016 tris.
- Real: a beached wooden coaster's bones are paired grown frames 20-30 cm square, grey-silver above, black-green and barnacled low, standing in a hull curve with the keelson between; a Scotch boiler is 2.5-3 m across, riveted, with furnace mouths.
- Now: grounding has seated the ribs and half-buried the boiler (S/1847-wreck-750.jpg), but ribs are still flat black strips, the boiler is an oil drum 1.24 m across, the bow sits on dune grass 17 m from a stern in the swash, and stray wedges remain in the water (tile 9).
- Spec: shorten to the landward 9 m, wholly above the tide line. 7 rib pairs, square section 0.25 m, sweeping to 2.2 m, weathered-timber material with end-grain checks. Keelson walkable. Boiler 2.4 m across, open furnace end, rivet rings in the normal map. Cut the stakes, the swash pieces and the stem lantern.
- Solidity: stick points on the rib rows where a cat placed there cannot move in any direction, at z 41.8 for x -11.4 to -2.4 and z 44.8-45.4 for x -10.2 to -1.8 (trunks lock, do not eject; rerun on current code). Cat drawn twice at (-6.4, 45.0), tile 6, in every capture round.
- Joy: "the boiler". The cat walks into the furnace mouth, footsteps go metallic, and a meow inside comes back as a deep bell note; with tideglow awake the swash pulses once to it. Hint: a dark cat-sized opening faces the approach. Cost M: open cylinder, two side blockers, one resonant sound. Record: yes.

4. OLD MILKWOOD (27.1, 73.9). Keep; it is the best landmark. 178,026 tris near: cut to 60k or less.
- Real sideroxylon: 6-10 m tall, wider than high, gnarled grey fissured boles, limbs resting on the ground, dense dark leathery crown, old man's beard.
- Now: right form (S/1847-milkwood-750.jpg), but the bole is a faceted dark cone with pale blotches and the leaves are big flat triangles from above (tile 8).
- Solidity: pops at its LOD distance (QA-known).
- Joy: "a cat in a tree". One limb dips to the ground as a ramp; the cat walks up to a fork 2 m up and sits. Rain does not reach it, and with the fireflies gift they drift in around the perch. Hint: bark worn pale along the top of that one limb. Cost M: one limb as a height tile (it cannot then be walked under), crown as a rain cover. Record: yes.

5. TRIG BEACON (62, 86). Keep, rework. 824 tris plus 26 rock instances.
- Real SA trig beacon: white concrete pillar 1.2 m by 0.3 m with four black sheet vanes on a short pole, on a square concrete base or tight cairn of angular local stone. It carries no lantern.
- Now: a pyramid of dark rounded river cobbles in hovering courses, with a bucket, pole and hurricane lamp (S/1847-beacon-750.jpg, S/2203-beacon-750.jpg). At night the stars sheen paints cyan and yellow patches on the stones (S/1847-beacon-1320.jpg tile 6).
- Spec: pillar and vanes on a three-step angular granite cairn (steps 0.35 m, hop height); cut the lantern.
- Joy: "the whole island". Sitting on the top step eases the camera back and up within 3 s to show the island, with every woken keepsake's light where it stands (S/2203-beacon-750.jpg tile 9 shows the view exists). Hint: the cairn is a staircase; arrival brings a gust in the grass. Cost S: moments.js watch camera with a shorter trigger. Record: yes.

6. ROCK POOL (64, 126.8). Keep, light rework. 6,198 tris.
- Now: convincing basin with urchins, stars and anemones (S/1847-pool-750.jpg), but the rim is a moulded tub from above (tile 8).
- Spec: break the rim with two joint cracks and a spill notch to the sea side; wet band from the grounding term.
- Solidity: none found in the scan.
- Joy: "shy flowers". Anemones snap shut as a paw comes within 0.3 m and reopen behind it; if the cat sits still at the rim for 5 s the klipfish return and gather in its shadow. Cost S: tentacle scale by distance to the cat uniform. Record: yes.

7. BOAT ASHORE AND GEAR (76.7, 40.6). Keep boat, logs, pots, post lantern; cut oars, floats, rope coil. 5,524 tris.
- Now: reads well from the hill, red hull on logs (S/1847-boat-ashore-750.jpg tiles 6-9).
- Solidity: the gift fires on proximity (about 8.7 m), so the hull rolls and levitates before the visitor touches it (S/2203-boat-ashore-750.jpg tile 8, hull in mid-air); the camera ends inside the hull (S/1847-boat-ashore-1320.jpg tile 7).
- Joy: "launch it yourself". Hopping onto the upturned hull makes it rock with a hollow knock and a crab bolts out; a second hop or a meow rolls it off the logs and it slides down the sand into the water. That act is the gift waking. Hint: the hull is hop height and already a surface. Cost M: replaces launchPose and the radius trigger in quest.js. Record: yes.

8. BOAT AFLOAT AND MOON JELLIES. Keep as is; the best-made object (S/1847-boat-afloat-750.jpg, S/1847-boat-aboard-1320.jpg). 13,049 tris.
- Solidity: a black post fills the aboard camera (tiles 6, 9).
- Joy: already there (jellies rise to the lantern at night) but it sits 78-88 m offshore and is unhinted. Bring the band to 35-60 m and let one jelly glint from the cove. Cost S. Record: yes.

9. BOULDERS. Keep. Now bedded (S/1847-rocks-slope-stone-750.jpg tile 4).
- Cut the stacked ball-on-boulder variant at (51.3, 28.9), (56.2, 20.6) and seal rock (81, 24); it reads as placed, not weathered.
- Add one sheeting joint per large stone in the normal map.
- Solidity: boulders go see-through on the tideglow pulse (QA-known).
- Joy: "warm rock". Sitting on a sunlit top brings a purr and slow blink, and the loaf comes sooner; the rock stays warm an hour after sunset. Cost S: sun term plus a purr sound. Record: once.

10. PENGUINS (0.4, 22.4). Keep. Good models, now on the ground (S/1847-animal-penguins-750.jpg).
- Scale: 0.51 m, about cat height; should be about 0.85 m (0.6-0.7 m real x 1.4).
- Joy: "the parade". Sit within 4 m for 8 s and the nearest waddles over and brays; walk off slowly and three follow in single file to the water and porpoise; run and they scatter. Hint: one head tracks the cat from 7 m and takes two steps toward a seated cat. Sitting 26 s and a meow got no response today (S/1847-z2-animals.jpg tiles 5-7). Cost M: outing logic with the cat as leader. Record: yes.

11. SEALS (81, 24). Keep (S/old2/1847-animal-seals-750.jpg).
- Scale: 1.5 m; raise to about 2.1 m.
- Now: they flee the rock when the cat arrives; one circles a swimming cat. Solid but do not yield when bumped (QA-known).
- Joy: "the race". Swim in the cove and the player seal porpoises alongside, beats you to the rock and barks; hauled seals only lift their heads if you walk. Cost S-M. Record: yes.

12. TORTOISE (11, 16). Keep. Readable only at 1.5 m (S/1847-z2-animals.jpg tile 1); hidden in grass otherwise. Put it on open sand paths.
- Joy: "patience". Sit beside the closed shell for 6 s; the head comes out, it plods to the nearest daisy and eats it. Cost S: the flower list exists. Record: yes.

13. SHORE BIRDS. Oystercatchers: keep (correct black with red bill, tile 3 of S/1847-zoom-oystercatchers-750.jpg). Shore gulls: keep. Cormorant flock (96, at 215-445 m): cut; never legible.
- Joy: "follow me". A flushed pair flies a low piping loop and lands 20 m on, toward the nearest undiscovered thing. Cost S. No record.

14. WHALE AND DOLPHINS. Dolphins: keep (they already ride the boat's bow). Whale: keep only if it answers; otherwise cut it and the "whale lookout" marker, which today marks empty sea.
- Joy: sit at the lookout and a blow is guaranteed within 10 s; a meow is answered by a tail slap. Cost S: breach weighting exists. Record: yes.

15. CRITTERS. Crabs: keep. Ambient fireflies (40): merge into the gift's fireflies. Butterflies: keep.
- Joy: sit still in flowers for 10 s and one lands on the cat's ear; the ear flicks and it lifts. Cost S. Record: yes.

16. QUEST LAYER. Keep, but it gives without being asked.
- Every gift wakes on a radius, and "seafolk" changes nothing in the world (its level is read by no code).
- Make each keepsake wake on its own act (entries 1 and 3-7), and make seafolk the switch that turns shy animals into approaching ones (entries 10-12).

SHARED MECHANISMS (less code than now)
A. Affordances, new src/affordances.js. The walker emits six events with position: on-top, inside, sat-near (with seconds), meow-near, bumped, ran-at. Props and animals subscribe; discoveries.js records; quest.js wakes on them instead of radii. Replaces per-module AWARE/SHY/FLEE constants with one temperament table in wildlife.js.
B. One prop contract in place-kit.js: {lod, surfaces, covers, lights, affordances}. Removes the lamp/cottage/crown/hull lookups in places.js, landscape.js, main.js and journey.js; covers feed precipitation.js so shelter is real.
C. Materials kit of five surfaces in place-kit.js (limewash, rubble, corrugated iron, weathered timber, rusted iron). One weathering block (edge streaks, sea-side salt, rust weep) sits on the existing grounding term; glow is gated by night, which fixes panes, beam and lanterns lit at noon.
D. Siting in place-layout.js and terrain.js: built places get a levelled pad at the crest, not podiums; one WORLD_SCALE = 1.4 in animal-forms.js.

ORDER OF WORK
- Engineer 1 (places): place-kit.js (B, C); place-layout.js and terrain.js (D); place-lighthouse.js; place-wreck.js; place-shore.js and place-rocks.js; place-milkwood.js triangle cut.
- Engineer 2 (behaviour): affordances.js and walker.js; quest.js and journey.js; penguins.js, seals.js, shore-life.js, critters.js, whale.js; discoveries.js, precipitation.js, sound.js and calls.js.

CUT OUTRIGHT
Yard wall ribbon; wreck stakes, swash pieces and stem lantern; beacon lantern; oars, floats and rope coil; stacked boulders; cormorants; ambient fireflies; whale lookout if the whale stays silent.

INTERACTIONS BY JOY PER EFFORT (build 1-8 first)
1. Lighthouse beam looks at you (S)
2. Anemones close, fish return (S)
3. Cairn-top island view (S)
4. Butterfly on the ear (S)
5. Tortoise patience (S)
6. Hop-launch the boat (M)
7. Penguin parade (M)
8. Boiler bell (M)
9. Seal race
10. Cottage sill in rain
11. Milkwood limb
12. Warm rock
13. Whale answer
14. Oystercatchers lead
15. Jellies nearer