# Sky Cope handover (14 Nov 2026, evening)

You are taking over as orchestrator. Read this whole file, then `README.md`, then the four research reports in `docs/handover/`. Everything in the "Work programme" below was started in the last session and must be finished, not restarted.

## 1. What the owner wants

The site is a live Cape Town sky over a small procedural island you explore as a tabby cat. The owner's goal, in their words over three days, in order. Quote these in every brief; they are the specification.

- "Make this site 10x more realistic, 10x more fun and magical to explore."
- "you need to magicmaxx way more than just 'oh look a lighthouse'" · "no real reason to explore right?"
- "just make it more magical - beautiful colours magical elements and style and realism - not just 'look some random low res objects to check out'" · "objects are fine though"
- "it still looks a bit flat / boring / fake"
- "some of the fireflys / new objects seemed glitchy in terms of border integrity / placement / world interaction - the way you jump over them etc. and many of the new things seemed overwhelming / too much"
- "the point isn't 'overwhelm the user with random new glitchy elements' it's 'make the world way more fun and magical to interact with'"
- "all the new objects need to blend much more seamlessly into the environment. the animals too"
- "currently its slow and low res so the worst of both world" · "drive to the absolute frontier of compute cost vs realism"
- "all the objects need major work on looking more realistic / less glitchy / more clear 'so what'. eg floating rocks, things the character glitches into and gets trapped there"
- "each object / animal needs some joyful interaction thats possible to discover"
- "the animal - object - cat interactions should be better"
- On a reference video of a lush misty garden meadow (`docs/handover/reference-meadow.jpg`): "insane reference!" · "this level of detail"
- "cat dimensions are really weird lol" (`docs/handover/owner-weird-cat.png`) · "sometimes parts of the cat go invisible lol"
- "this is your codebase, feel free to edit as you please to make it as easy and low tech debt to use as possible going forward" · "remember to commit often"

The owner's brief for YOUR session, verbatim:

- must push hard on all the threads on realism / performance / colour grading - everything started here must be completed
- qa and glitchiness must be revisited in terms of movement camera angles also vegetation
- needs to be more magic on the objects - some of them say things but nothing really happens - also the light / flash stuff could be a lot more magical
- all objects need qa (floating disconnected stuff / poor environment interactions like the boat for example in the water)
- all objects need a realism pass
- more sound design
- paring back on confusing elements
- more magical objects / details / interactions

Read that list as one sentence: fewer, better, more solid things, that look real, that answer the cat, that sound right, on a site that is fast and sharp.

Standing rules (also in the memory files, which load automatically):

- Performance first: judged by laptop fan noise and phone smoothness. Every visual gain must be paid for. State numbers.
- Everything procedural: no downloaded models, images, textures or audio. Only ask the owner to relax this if the slice (thread A3) fails on close-up plant detail, and then only for leaf and petal textures.
- Never publish Artifacts. Box cloud storage is read-only.
- Model split the owner asked for: Fable subagents research directions, Opus subagents implement, you direct.
- The owner has said "go live" twice when asked. Still ask before each push to `origin/master`: it deploys to Vercel. Push `magic-round2` freely after every merge.

## 2. State of the repo

- `origin/master` = `origin/magic-round2` = `9084787`. This is live. Local `magic-round2` is the integration branch; work there, never commit on `master`.
- 157 tests pass (`node --test`; with the trap sweep it takes over two minutes when the machine is loaded), `npm run check:shader` exits 0, `npm run build` succeeds, as of `9084787`.
- Measured once in the browser pane with the GPU nearly idle, home beach, seed 1847: 16.7 ms frames, land canvas at 1.5× CSS pixels, 1.04M triangles, clean console. This is not the idle-machine protocol; that has never been run.
- The environment was reset at the end of the session: no agents, no dev servers, no headless Chrome. 38 worktrees sit under `.claude/worktrees` (gitignored, 75 MB); nothing was deleted.

### What is merged and live

Quest and wisp (`quest.js`, `journey.js`, `wisp*.js`); six gifts with land, sea and sky effects, all turned down; sailable boat with lantern and moon jellies; night light, sand, rock and ground shader passes; cat reshaped twice; one tonemap source (`tone-glsl.js`); sky colour in low-sun ambient; shared grounding term; collision blockers, moving-body list for animals, bedded rocks, trap sweep; render budget (`quality.js`); per-instance vegetation LOD (`instance-lod.js`); sliced shadow refresh; MSAA 2; per-gift pipeline gating.

### Unmerged work, saved on branches (all local, none pushed)

Each was stopped mid-task. Read `git log magic-round2..<branch>` and the diff before building on it; the last commit on two of them is a WIP save of whatever was on disk and may be half-applied.

| Thread | Branch | State |
|---|---|---|
| Meadow slice | `worktree-agent-ad8bf2a036b025614` | 4 commits. WebGPU land renderer under `src/slice/` behind `?slice`: shared device, depth mist composite, fine restio culms with baked occlusion, card band from GPU-baked atlases, far billboards. Last commit `4260be3` is a WIP save. Not measured. |
| Movement and camera | `worktree-agent-a71103aff39acf7f5` | 2 commits: the white patch at boulder feet fixed; then a WIP save `1fa51d3` in `walker.js` (non-allocating trunk grid, spring helpers) that is probably incomplete. |
| Loading screen | `worktree-agent-a3b804cfa2eb074f3` | 5 commits, clean tree: painted sky veil, comet-tail wisp, hand-over. Never reviewed; first-paint timing not measured. |
| Places rework | `worktree-agent-a9afcaa95fd85ff07` | Nothing committed. Start again from its brief (section 4, thread C1). |

Agents cannot be resumed from a new session. Start fresh agents and point them at the branch to continue from.

## 3. Research you must read

All in `docs/handover/`. They are the evidence base; briefs should point agents at these files rather than restate them.

- `look-research.md`: why the land looks flat (missing sky colour in ambient, not the tone curve), the cat's measured proportions, vegetation ("an orchard": no shrub layer, one green), resolution, blending. Sections 5–7 list ranked changes and what not to do.
- `perf-research.md`: where frame time goes, the two triangle anomalies explained, ranked directions in two tiers, budgets, a three-stage plan, the idle-machine measurement protocol.
- `slice-spec.md`: the architecture decision (Three.js WebGPURenderer + TSL on the sky/sea's own device), plant pipeline, budgets, acceptance test.
- `object-audit.md`: per object and animal: verdict, real-world form and material spec, scale, and ONE discoverable joyful interaction; four shared mechanisms; what to cut; interactions ranked by joy per effort.

## 4. Work programme

Every thread has an owner complaint behind it. Finish all of them. Suggested order inside each group is by what the owner will notice soonest.

### A. Performance and resolution ("slow and low res")

1. **Measure for real.** Run the protocol at the end of `perf-research.md` on an idle machine (no agents, one headed Chrome): six views, noon and night, gifts asleep and awake, p50/p95, triangles, draw calls, render sizes reached. Nothing has been verified this way. Record the numbers in `README.md` as the regression budget.
2. **Finish stage 1 and do stage 2.** Stage 1 is merged but its agent never reported: verify per-instance LOD does not pop (milkwood especially), the sliced shadow refresh, and that the render budget holds land resolution under load. Then stage 2: ground shader diet (45 noise call sites, ~35% of the mesh layer), animal and place LOD (penguins are 2,072 triangles each with no LOD), shared geometry instead of `source.clone()` per chunk, per-frame allocation hygiene, frozen matrices with an explicit static flag, and occlusion culling only if a re-measure shows it still pays and a fast camera turn shows no pop-in (it was removed on 30 Sep, commit `8a9a58c`, reason unknown to the owner).
3. **Finish the slice and decide the migration.** Continue from the slice branch to the spec's acceptance test: four views beside reference frames that a non-expert calls the same class of image, p95 ≤ 16.7 ms at 0.75 linear on the owner's MacBook (33 ms steady counts as "possible at 30 fps"). My read of its last frames: mist and density work; plants still read as flat-coloured CG strands; near band was 2.79M triangles against a 1.5M budget. If it passes, bring the owner the migration plan (land GLSL to TSL, one renderer, one tonemap); it is a large rewrite and is their decision. If it fails on close-up plant detail, that is when to ask about relaxing the procedural rule.
4. **Memory.** A 12-minute scripted playthrough ended with the page dying at 488 MB heap; the researcher could not reproduce it (steady ~150 MB) but did not exercise ceremonies. Run the 15-minute lifetime protocol.

### B. Realism, colour grading, lighting, vegetation, the cat

1. **Colour grading and lighting.** Merged: night warm-light fix, sky chroma by sun height, overcast balance, paler sand, pushed low-sun shade. Its agent never delivered final sheets. Capture dawn 350, noon 750, golden hour 1145, sunset 1165, dusk 1188, night 1320 (correct minutes for November), clear and overcast, and judge against photographs. My last look at sunset found the change too subtle and the slope under trees still dark and brown. Finish `look-research.md` section 5 "Grade and light"; do not add an S-curve, bloom or a global saturation boost.
2. **Vegetation realism.** Not started. `look-research.md`: continuous fynbos understory instead of spaced saplings on bare ground, varied tree height and spacing, hue families (grey-green, olive, ochre), leaf facets with midrib shading. Move triangles, do not add. If the slice wins, do this in the new renderer instead.
3. **The cat.** Proportions were fixed, overshot (weasel neck: `owner-weird-cat.png`), then corrected. Verify the correction from the follow camera, side and rear. Open: eyes slightly bulging with a pale lid ring; skin stretching between the inner thighs mid-stride; top view still tube-like under the stripes; boat poses unchecked; a possible extra factor of π in the shared shadow sky term. **New bug from the owner: "sometimes parts of the cat go invisible".** Not investigated. Suspects: frustum culling on stale bounding boxes after the reshape, fur shells or the ghost silhouette's stencil, the waterline clip, the foliage/solid stencil order.
4. **Objects realism pass.** See C1.

### C. Objects: realism, QA, magic, "so what"

1. **Rework every place and prop** from `object-audit.md` (Engineer 1): one prop contract `{ lod, surfaces, covers, lights, affordances }` in `place-kit.js`; a five-material kit with weathering; glow off at noon; levelled pads instead of podiums; then lighthouse, cottage (tank merged, yard wall cut), wreck (real frames, walk-in boiler), trig beacon (pillar on a hop-up cairn), boat ashore, rock pool rim, boulders, milkwood (178k → ≤60k triangles, a limb ramp). Cut what the audit says to cut. Fix scale: penguins and seals are too small; one `WORLD_SCALE`.
2. **Object QA, all of them.** The trap and floating-rock sweeps pass on five seeds, but most fixes were verified in node only. In the browser, by day and night, check every object for: floating or disconnected parts, hard intersections with ground or water, see-through seams, the cat double-drawn by the wreck (-6.4, 45.0), stick points on the wreck's rib rows, boulders turning see-through when the tideglow pulse passes (reproduced, unfixed, probably the sea pass). **The boat in the water** needs its own pass: waterline against the swell, a thin wake, no bow spray, no tether, a black post filling the aboard camera, the launch levitating before the cat touches it, the camera ending inside the moored hull.
3. **Make things happen (Engineer 2, behaviour).** The owner: "some of them say things but nothing really happens". Today reaching a place prints a line and plays a ceremony; the object itself does nothing, gifts wake on a proximity radius, and the `seafolk` gift is read by no code. Build `src/affordances.js` (walker emits on-top, inside, sat-near, meow-near, bumped, ran-at), wake each keepsake on its own act, and build the audit's interactions in its ranked order: lighthouse beam looks at you, anemones close and fish return, cairn-top island view, butterfly on the ear, tortoise patience, hop-launch the boat, penguin parade, boiler bell, then the rest. Record each in the field notes once found. Seals, tortoise and gulls must yield or react when bumped.
4. **More magical objects, details and interactions**, after 1–3 are solid. The register that works, from the research: warm practical light in a blue night, and the world answering what the cat does. Commission a Fable pass for ten more small discoveries in that register, each using existing mechanics, each with a hint a visitor can find without text.
5. **The light and flash.** The owner: "the light / flash stuff could be a lot more magical". The waking ceremony's bloom, the pulse ring and the gift flash are currently a pale ring and a lime or white wash over foliage. Redesign the moment of waking as light that behaves like light: it should travel, catch on surfaces and water, colour by gift, linger as embers or glints, and resolve into the gift's steady state. Get a Fable design first.

### D. QA and glitchiness: movement, camera, vegetation

Continue from the movement branch; the brief is in the previous session's transcript and summarised here. Movement through foliage (plants part, bend and spring back; no snagging on trunk colliders); camera never inside foliage, rock, animal or hull, with foliage between lens and cat dithered out and all arm changes critically damped, checked on slopes, in the yard, the pool basin, under the milkwood, aboard and mid-jump; ceremony cameras (several end in bushes, inside the hull, or cut the tower top off); frame hitches (shadow refresh, LOD changes, pipelines compiling when a gift first wakes, GC) and motion that stutters at a steady frame rate (stepped camera or animation, foot sliding); popping at the milkwood LOD and near-ground windows; vegetation QA: LOD cross-fades, shimmer, plants through rocks and props.

### E. Sound design

Almost nothing here has been heard by anyone: every audio change was checked as offline level measurements only. Scope a proper pass: footsteps per surface (sand, wet sand, grass, rock, timber, metal in the boiler), foliage rustle as the cat pushes through, water by depth, the boat (hull slap, creak, wake), each animal's voice and reaction, weather and shelter (rain on the iron roof, dry under the eave), a sound for every interaction in C3, the ceremony phrases, spatialisation and distance, and a mix that stays quiet. Tell the owner plainly that agents cannot hear and ask them to listen at set checkpoints.

### F. Pare back confusing elements

Get a Fable agent to play as a first-time visitor with no context and list everything that confuses or adds noise, then cut. Candidates I already know of: "found · …" lines for things that do nothing; ceremony cards that name a gift whose effect is not visible in the shot (seafolk); the field-notes gift marks and dots; a wisp that is a large white flare by day; every constellation at once; the whale lookout marking empty sea; separate ambient fireflies beside the gift's fireflies; the pulse ring; props the audit says to cut.

### G. Loading screen

Review the branch (sheets and first-paint time), merge if it holds, otherwise finish it. Brief: instant first frame in the real current sky colours, the wisp as the one living thing showing real progress, a hand-over that reads as focus pulling.

## 5. Running subagents: what the last session learned

- **Usage limits ended three rounds.** Five or six Opus agents exhaust the 5-hour limit in about two hours and all die together. Run three or four. Every brief must say "commit after every step"; that alone turned a cut-off from a lost round into a lost ten minutes.
- **A session restart orphans agents.** They cannot be messaged afterwards. Before stopping for any reason, commit each worktree.
- **Research first.** The four Fable reports changed the quality of everything after them. Save each report to a file the implementers can read.
- **Do not ask for "bold" or "unmistakable".** My briefs did, and produced the overwhelm the owner rejected. Ask for quiet by default and responsive.
- **A report is a claim.** Open the before/after sheets yourself before merging. I merged the cat on its numbers and one sheet and shipped a weasel. Tests passed because the ranges were loose.
- **One lane per agent, by files.** Name the files others are editing in every brief.
- **Shared GPU makes milliseconds meaningless.** Ask for counts and same-tab A/B ratios; measure time yourself on an idle machine.
- **Agents leave servers and headless Chrome running.** Kill them when each reports: `pkill -f "Google Chrome.*--headless"` and `pkill -f "vite/bin/vite.js"`.
- **Worktrees branch from `origin/master`.** Start every brief with `git merge --ff-only magic-round2`.
- **Merge conflicts** have all been "keep both sides" in `forest.js`, `landscape.js` and `places.js`.

## 6. Commands

```bash
node node_modules/vite/bin/vite.js --port 5321 --strictPort --host 127.0.0.1
```

```bash
CDP=9393 node scripts/tour.mjs /tmp/tour 5321 "01-home-noon,34-night"
```

`.claude/launch.json` starts the same server for the browser pane. `/?perf&seed=1847` exposes `window.skycope` (walker.cat, walker.camera, landscape, magic, quality) and puts `data-triangles` / `data-draw-calls` on `#landscape`. The `#time` slider takes minutes plus an `input` event. `&weather=clear|cloudy|overcast|rain|storm`, `&magic=all` or a comma list, `?slice` for the new renderer (slice branch only). The performance harness the researcher wrote was in the session scratchpad and may be gone; the protocol is in `perf-research.md`.

## 7. Tell the owner honestly

- Nobody has heard the audio.
- No frame-time number is trustworthy yet.
- Nobody has played the whole quest on the live build; the one scripted run did not reach the finale.
- The objects are still crude and do nothing; that work has a specification and has not started.
- Whether the reference's level of detail is reachable in the browser is still an open question the slice exists to answer.
