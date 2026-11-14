PERF RESEARCH: Sky Cope, branch magic-round2 (read-only; repo untouched, server and Chrome on 5351/9451 stopped)

Tags: [M] measured this session, [C] counted from code, [J] judgement. Every millisecond was taken with other agents' browsers on the GPU, so trust ratios and counts, not absolutes. Seed 1847, 1440x900, desktop budget.

## 0. "Slow and low res": reproduced, and the scaler is the mechanism

- [C] `adaptQuality` (src/main.js ~1205): EMA of frame interval (weight 0.025); after 180 samples and 8 s since the last change, >24 ms drops quality 0.12 (floor 0.5), <18 ms raises 0.06. 18–24 ms is a dead zone. Frames >120 ms are ignored, so one hitch cannot latch it; sustained load does.
- [M] Free-running at home under contention, quality went 1 → 0.5 in about 34 s and stayed, in all four cases (day/night, gifts asleep/awake). Land canvas 1440x900 → 864x540 (36% of pixels), sea 1080x675, sky 424x265, and the frame rate stayed at 10–13 fps. The cut bought nothing visible.
- [C] It cuts all canvases at once: land scale max(0.6, q), sea max(0.75, √q), sky q, cloud steps 44 → 32. It never touches triangles, shadows, MSAA or pacing. Recovery from the floor takes at least 72 s of <18 ms frames; on a 60 Hz display a 17–24 ms scene reads as 33 ms, so it saw-tooths, and every step calls `resizeAtmosphere` and resets cloud history.
- [M] It cuts the wrong thing. Halving land pixels saves 16–30% of mesh time, while tree shoots alone are 34–40% at no pixel loss and MSAA is 19–25%.
- [C] Even at quality 1 the picture is soft. Retina laptop (1440x900 CSS, dpr 2): land 1600x1000 and sea 1549x968 on a 2880x1800 panel (about 0.55 linear), sky 848x530, clouds 424x265. Phone (390x844, dpr 3): land 585x1266 with no MSAA, sea 488x1055 (0.42 linear), sky 319x690.

Recommended shed order [J]: (1) shadow refresh cadence and cloud steps; (2) sky/cloud scale; (3) sea scale to 0.6 linear; (4) a vegetation LOD bias uniform (pull distances in 15–30%); (5) MSAA 4 → 2; (6) pacing to a steady 40 or 30 fps; (7) only then land scale, floor 0.85. Drive it from GPU time, not vsync-quantised intervals, with separate up/down thresholds per pass.

## 1. Where frame time goes

- Whole frame [M]: the mesh layer is about 80% at home and beacon (stubbing `landscape.render` leaves 17–26%), and about 46% facing the sea.
- CPU [M, sampling profiler]: about 3.4 ms/frame. Three.js takes 2.3 ms, of which `updateMatrixWorld` + `multiplyMatrices` + `projectObject` are about 1.1 ms over 2,270 scene objects. All app JS is under 1 ms. Workers are build-only.
- Mesh layer by material at home [M, timer-query A/B, IQR ±2–4 ms on a 13–22 ms base]: plants about 62% (cluster shoots alone 34–40%); ground about 35% at full resolution with only 105k triangles; shadow receive about 9%; land magic lights at night about 13% (noisy).
- The memory note "mesh layer is flat with resolution" is now false [M]: quarter pixels gives −46% at home.
- Overdraw is low [M]: 1.2–1.5 depth-passing fragments per pixel. Ground shades 43–60% of the screen. Clusters shade 0.11–0.27 fragments per pixel from 0.7–1.3M triangles, roughly 13 triangles per shaded pixel.
- Ground shader [C]: `GROUND_COLOUR_GLSL` (forest.js 595–1009) has 45 `dNoise` call sites and 23 branches.
- Cost per megapixel [M, relative]: land at 2x pixels is 1.45–1.65x with MSAA 4, 1.09–1.22x without; 4x pixels without MSAA is 1.5–2.1x. Sea at 2x pixels is 1.6–1.7x of the WebGPU frame. Sky/clouds at 2x is only +3–9%, even at 55% cover.
- [C] `magicActive` is true whenever the wisp glows, so the "compiled out" pipelines rarely run in real play.
- Memory [M]: heap is about 150 MB after GC with gifts awake or asleep, +7 MB over 150 s of night teleporting, running and meowing; about 15 MB/min of garbage between collections. GL geometries climb 245 → about 1,100 as LOD levels are first seen, because `addInstances` deep-clones geometry per chunk per level [C]. Textures stay at 12, programs 58 → 79. I saw 300–525 MB only when earlier documents in the same process were uncollected, which may explain the 488 MB reading. I did not reproduce the crash and did not exercise ceremonies.

## 2. The two anomalies

- Night +440k triangles / +120 calls: not a steady-state cost. [M] Home noon vs night was 1,531,341 / 206.5 vs 1,531,170 / 205.5, and with magic=all 1,295,225 / 190 vs 1,297,453 / 188.5. The only thing that adds about 120 calls is a sun shadow-map refresh frame: forcing one gave +1.02M triangles / +117 calls. The key in `landscape.render` changes with sun altitude (0.1°), scene, cover and a 10 m cat anchor; `data-triangles` is sampled every 30 frames and on the first frame. No refreshes occurred in 12 s of standing still. [J] The engineers sampled a refresh frame.
- About 3M at milkwood and beacon [M: 2.44M, 2.69M, 3.49M looking out from the summit]: `addInstances` uses 20 m chunks with LOD distance measured to the chunk centre plus an 11 m margin. Full 60-triangle shoots therefore cover whole chunks within 17 m (7–12k shoots, 0.44–0.73M triangles), and the 14-triangle level runs out to 63 m (47–78k shoots, 0.66–1.1M). Add full turf (up to 200k), petals (up to 260k), the milkwood crown (149k), and 14 penguins at 2,072 triangles each with no LOD, visible from the summit.
- Important: `src/occlusion.js` and `freeze()` are not in this branch. Commit 8a9a58c reverted them an hour after 21153f3 landed, with no reason recorded. The memory note still describes them as wins.

## 3. Ranked directions

Tier 1: certain cuts

1. Replace the scaler (main.js `adaptQuality`, `waterSize`, `cloudSize`; landscape.js `resize`) with the shed order above. Effort S–M, risk low. Verify: under load the land canvas stays at ≥0.85 scale.
2. Shoot LOD by instance, not chunk (forest.js `addInstances`, cluster/needle/turf/petal levels): 10 m chunks or per-instance distance, a 3-leaf level from about 30 m, plus a global LOD bias uniform. Expect −35–45% triangles in the 3M views. Effort M; risk is popping, so add a dither or scale cross-fade. Verify with the triangle counter and the `-cluster` A/B.
3. Ground shader diet (forest.js `GROUND_COLOUR_GLSL`): bake low-frequency terms into the existing ground field texture and early-out by distance. Expect −15–20% of the mesh layer at home. Effort M; the look engineers must sign off. Verify with the `-ground` A/B.
4. Reinstate frozen matrices (about 1 ms CPU) and occlusion culling (−32% triangles when it existed). Ask the owner why they were reverted first. Effort S (code is in 21153f3).
5. Shadow map: time-slice the refresh (static casters cached, half the casters per frame), cast from the far LOD, and stop keying on 0.1° of sun. It removes a spike equal to about 75% of a frame's triangles. Effort S–M.
6. MSAA 4 → 2 with the freed pixels spent on scale: [M] 2x pixels without MSAA costs 1.09–1.22x versus 1.45–1.65x with it. Rocks need `alphaToCoverage`, so 2x is the floor. Effort S.
7. Animal and place LOD/culling (animal-forms.js, wildlife.js, place-kit.js): penguins at 29k triangles from 80 m. Effort S.
8. Sea-under-hill skip inside WebGPU using the landField max-height mips (ocean.wgsl near line 102, beside the existing inland skip). Helps views that look across land to sea. Effort M.
9. Gate the magic pipelines per gift rather than on the wisp (sea-sky-magic.js `magicActive`); run the settled finale's `meteor_storm` only above the horizon mask it already has, at a lower sector count. Effort S.
10. Share geometry across chunks: instance attributes on a wrapper instead of `source.clone()`. About 1,100 geometries → about 60, less GPU memory and VAO churn. Effort S–M.
11. Allocation hygiene: `createUniforms` and its spreads run every frame, and `lightWithMagic` rescans the scene 8 times in the first 40 s and recompiles materials. Effort S.

Tier 2: the frontier [J unless tagged]

- Frontier, biggest lever: one WebGPU renderer owning the frame. Three.js r185 (already installed) has WebGPURenderer with indirect draws for BatchedMesh since about r170, occlusion queries, and TRAA in r183 (per release notes; I did not re-read the primary GitHub notes). It ends duplicated uniforms, tonemap and lighting between layers; gives shared depth, so sea-under-land is free and the sea can be depth-aware half-resolution; and allows a depth pre-pass, compute culling and Hi-Z. Cost L (the GLSL in forest.js, cat-coat.js and place-kit.js must be ported to TSL/WGSL). Risk: phones without WebGPU need the WebGL2 backend. The memory note's cross-API copy trap disappears rather than applies.
- Frontier: octahedral impostors or baked crown cards for vegetation beyond about 35 m (Brucks/Fortnite practice; three.js community implementations exist). Crowns are procedural, so bake at load into one atlas. This removes the 14-triangle level entirely and frees triangles for real leaves near the cat. Effort M–L.
- Frontier: per-pass dynamic resolution plus a spatial upscale and sharpen for the sea (FSR1-style EASU+RCAS runs as pixel shaders; a mobile write-up reports about 2.7 ms optimised on an iPhone 12). Land stays native with MSAA 2. TAA on the land is a distraction: fur shells, sub-pixel grass and alpha-to-coverage ghost under TAA.
- Frontier: steady 40/30 fps pacing, with idle 30 extended to "camera still".
- Worth doing: vertex-pulled grass with distance density (near-ground.js already windows; extend it over the turf levels); cached static shadow atlas with only the cat dynamic (the cat already has its own map).
- Already done: quarter-resolution temporal clouds, SH skylight, baked canopy occlusion, footprint-filtered sea.
- Distraction: clustered or continuous LOD for terrain and rocks (ground is 105k triangles, rocks under 2%); WASM or workers for simulation (app JS under 1 ms); hair cards for fur (6 shells, about 30k triangles, is right at this distance; drop to 3 shells beyond 6 m).

## 4. Targets, plan, protocol

Budgets [J; convert on an idle machine]:
- Laptop, 60 fps, land at 0.75 linear of native with MSAA 2: land ≤6 ms (≤900k triangles), sea ≤2.5, sky and clouds ≤1, CPU ≤2.5.
- Phone, steady 30: land ≤10 ms (≤500k triangles), sea ≤5, sky ≤2.
- Regression budget per view: triangles within +3%, draw calls within +10, paired A/B frame time within +2%.

Stages:
1. Days 1–2, the stage that delivers "fast and sharp" soonest: items 1, 2, 5, 6, 7, 9. Expect about −40% mesh cost and the land canvas raised to about 0.75 linear on retina.
2. Days 3–5: items 3, 4, 8, 10, 11 and the sea upscaler. This pays for near-cat leaf and grass geometry and night lights.
3. Week 2: impostors, then the single-renderer migration. Port ground and rocks first behind a flag, then plants, then the cat; each step is shippable and deletes one layer of duplicated uniforms and tonemap. This pays for translucent near foliage, contact shadows and depth-aware sea.

Protocol: idle machine, one headed Chrome, `Emulation.setDeviceMetricsOverride` 1440x900 dpr 2. Views: home, sea, milkwood, beacon, beacon looking out, lighthouse; at 750 and 1320; gifts asleep and awake. Re-place the cat before every burst. Record triangles, calls, mesh GPU timer, paused-rAF whole-frame ticks (K=5, 13 interleaved rounds, median and IQR); discard a run if the IQR exceeds 10% of the median. Lifetime: 15 minutes scripted, logging GC'd heap, `renderer.info.memory` and programs each minute, in a fresh browser process.

Reusable harness scripts are in /private/tmp/claude-502/-Users-skycope-Code-skycope/f5ab9af3-9006-4e05-a49e-0559244e2385/scratchpad/perf-research/ (cdp.mjs, attr.js, meshbench.js, frame.js, msaa.js, overdraw.js, heap.mjs, prof.mjs).

Sources (search summaries, not re-read in full):
- [three.js r170 release notes mirror](https://newreleases.io/project/github/mrdoob/three.js/release/r170)
- [three.js r183 release notes mirror](https://newreleases.io/project/github/mrdoob/three.js/release/r183)
- [three.js r158 release notes mirror](https://newreleases.io/project/github/mrdoob/three.js/release/r158)
- [Optimizing AMD FSR for Mobiles](https://atyuwen.github.io/posts/optimizing-fsr)
- [AMD FSR1 manual](https://gpuopen.com/manuals/fidelityfx_sdk/techniques/super-resolution-spatial/)
- [Octahedral impostors for three.js](https://discourse.threejs.org/t/octahedral-impostors-for-three-js/80318)
- [Epic Impostor Baker documentation](https://dev.epicgames.com/documentation/en-us/unreal-engine/impostor-baker-plugin-in-unreal-engine)