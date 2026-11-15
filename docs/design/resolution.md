# Resolution: sharp and stable at the same GPU cost

Design only (15 Nov 2026, branch `magic-round2`). Nothing here is implemented or measured;
every gain is an estimate from yesterday's numbers (`docs/handover/perf-research.md`,
`docs/review/perf/`). Tags: **[read]** I read the code, **[doc]** from the perf docs,
**[est]** my estimate, **[unverified]** I did not open the file (I was stopped before
reading `src/forest.js`, `src/lens.js`, the `.wgsl` shaders and `scripts/perf.mjs`).

## The diagnosis in four lines

1. The land canvas is drawn at 0.52–0.75 linear of the panel and then **stretched by the
   browser with plain bilinear** (`renderer.setSize(w, h, false)` in `landscape.resize`,
   CSS-sized canvas) [read]. Bilinear is the softest upscale there is. The sea canvas is
   stretched the same way from 0.54 linear.
2. The governor moves `landScale` across 1.25 → 0.85 (2160 px → 1498 px wide on the Retina
   laptop, a 1.44× range) [read, doc]. The visitor sees the picture change sharpness, and
   under load it parks at the bottom: slow and soft.
3. The mesh layer is **triangle-bound in the plants** (about 13 triangles per shaded cluster
   pixel, plants 62% of mesh time) and **fragment-bound in the ground** (35% of mesh time
   from 105k triangles, 9–17 noise evaluations per pixel) [doc]. Pixels are cheap without
   MSAA (2× pixels = 1.09–1.22×) and dear with it (1.45–1.65×) [doc].
4. Overdraw is only 1.2–1.5 [doc]. Anything that re-submits geometry (depth pre-pass,
   velocity pass for TAA) costs more than it saves.

## Recommended three-step plan

### Step 1. One fixed internal size, an edge-adaptive upscale to the panel, no resolution steps (2 days)

- `src/quality.js`: delete the four `landScale` steps and the `msaa` step from `STEPS`;
  `baseSettings.landScale` is 1 everywhere. `renderSizes` returns two sizes for the land:
  `land` (internal, today's budget: 1762×1101 on the Retina laptop, 0.61 linear, MSAA 2)
  and `landOut` (canvas backbuffer: `min(dpr, 2)` × CSS on desktop, so 2880×1800 there;
  1.5 dpr as the fallback if the pass measures over 1.2 ms).
- `src/landscape.js` `createMsaa` [read]: `resolve()` today blits the multisampled buffer
  straight onto the canvas with `gl.NEAREST` at equal size. Change the blit destination to
  a single-sampled RGBA8 texture FBO at `land` size (linear filter, clamp). Size the canvas
  to `landOut`. After the resolve, draw one full-screen pass to the canvas: the upscale.
  Then the lens scene as now (it already draws on the canvas after the resolve).
- The upscale shader (new `src/upscale.js`, one triangle, one program): FSR1 in its
  one-pass mobile form. EASU's 12-tap edge-direction Lanczos reduced to the 9-tap
  bilinear-fetch variant, followed in the same shader by RCAS's 5-tap cross with its
  built-in ringing clamp (output limited to the local min/max). Sharpness 0.25 stops
  [est], tuned by the metric below, not by eye alone.
  - It runs **after tone mapping** (materials tonemap in-shader via the patched
    `tonemapping_pars_fragment` [read]), which is where FSR1 expects to run.
  - The land canvas has **alpha** (`alpha: true` [read]; premultiplied assumed
    [unverified]). Run the filter on premultiplied RGBA, all four channels with the same
    weights, and clamp alpha to the local min/max too, or silhouettes over the sea gain
    halos. The silhouette against the sky is the most important edge in the picture and
    this is what makes it crisp.
  - **MSAA**: FSR1 needs antialiased input and MSAA 2 plus alpha-to-coverage supplies it.
    Keep MSAA 2 fixed; never toggle it (a toggle reallocates and visibly changes edges).
  - **Thin foliage**: a spatial upscaler cannot remove shimmer from sub-pixel blades and
    RCAS amplifies it. Two guards: RCAS's noise limiter on (attenuate where local contrast
    is high-frequency in both axes), and a pixel-footprint width clamp in the grass and
    shoot vertex shaders (never narrower than about 1 internal pixel, fading alpha instead)
    [unverified whether `forest.js`/`near-ground.js` already do this].
  - **Lens** (`src/lens.js` [unverified]): grain now lands at output resolution, which is
    correct (fine grain reads as sharpness); check the grain scale uniform is in output
    pixels. Vignette, rain and glare are unaffected.
- The same pass for the sea in WebGPU (`src/main.js` `startAtmosphere` [read]): the water
  pass writes to `output` (the canvas surface) at `sizes.sea`. Give it an intermediate
  `rgba8unorm` target at `sizes.sea`, size the surface to the output size, and add one
  `effect()` pass with the same filter in WGSL. Horizon and glints sharpen; the sky inside
  it is smooth and unaffected.
- Expected: perceived sharpness of about 0.8–0.85 linear from 0.61 internal [est, FSR1
  "quality" mode ratio is 1.5× and ours is 1.63×], constant from the first frame to the
  worst load. Cost [est, unmeasured]: 0.6–1.2 ms per canvas at 5.2 MP on an M-series
  integrated GPU; paid for by removing the `landScale` 1.25 level (2160×1350 MSAA 2, about
  1.3× the mesh layer [doc ratio]). Net: the same or lower GPU time than today's level 0,
  sharper than today's level 0, and no change under load.

### Step 2. Make the ground cheap and stable: draw it last, shade it from a cache (3–4 days)

- **Draw order (hours)**: give the ground mesh a `renderOrder` after plants, rocks and
  places in the opaque list, so its 9–17-noise shader is rejected by early-Z under
  everything in front of it [unverified what order three sorts it to today; the ground is
  one huge object, so sort-by-distance puts it anywhere]. Clusters shade 0.11–0.27
  fragments per pixel over a ground that covers 43–60% of the screen [doc]: expect −5–10%
  of the mesh layer at home and milkwood [est], no look change. Requires no `discard` and
  no depth write in the ground fragment path before the test (alpha-to-coverage rocks are
  fine).
- **Ground colour clipmap**: `GROUND_COLOUR_GLSL` (`forest.js` ~595–1009 [doc]) computes
  low-frequency colour (zones, scrub clumps, sour-fig, strandline, damp band) per screen
  pixel per frame. Bake it instead into two camera-centred world-space textures (1024²
  each: 32 m at 3 cm/texel, 256 m at 25 cm/texel), re-rendered only when the cat crosses a
  snap step, a few rows per frame the way the shadow map is sliced now
  (`landscape.js` `shadows` [read]). The per-pixel shader becomes two mip-filtered fetches,
  the two grain octaves and ripple kept procedural within ~6 m (the sharp detail layer),
  and lighting. Anything that animates (wet band, swash, magic lights) stays per-pixel.
  - Gain: ground from ~35% to ~12% of the mesh layer [est], and far ground stops
    shimmering because it is mip-filtered rather than point-evaluated noise.
  - Risk: look sign-off (the diet in `02-ground-diet` was exact; this is not), seams at the
    clipmap edge (blend over the outer 10%), and texel swim on snap (snap to texel
    multiples).
- Spend what this frees on internal resolution, once, as a new fixed budget (for example
  0.61 → 0.70 linear), not as a governor level.

### Step 3. Still-view refinement and a ladder nobody sees (2–3 days)

- **Still-view accumulation**: when `settled()` is true (`main.js` `tick` already paces to
  `IDLE_FPS` there [read]) and the camera matrix has not changed for 0.3 s, jitter the
  projection by a sub-pixel Halton offset each frame and accumulate into a history texture
  at output size, with a 3×3 neighbourhood colour clamp so wind-blown leaves, fur and
  water fall back to the current frame instead of ghosting. Any camera or cat motion
  resets the history in one frame (the upscaled frame is the fallback, so there is no
  pop, only a 300 ms settle towards native-resolution detail). This is the answer to
  "details … rerender in the main view": the visitor stops to look, and the picture
  resolves to panel resolution at idle cost. It is not TAA: no motion vectors, no
  reprojection, nothing to ghost while moving.
- **The ladder**, in the order the visitor cannot see (`quality.js` `STEPS`):
  1. `shadowSlices` 4 → 8, `cloudSteps` 44 → 32 (as now).
  2. `skyScale` 0.75 (as now; smooth content).
  3. Water shading at half rate (below) or `seaScale` 0.82 → 0.68 (now behind the sea
     upscaler, so far less visible than today).
  4. `lodBias` 0.85 → 0.72, but **eased over 2 s** in `landscape.setQuality` rather than
     stepped [unverified whether `forest.updateLod` cross-fades], so no crowd of LOD swaps
     lands on one frame.
  5. `fps` 40 (120 Hz only) then 30.
  6. Nothing else. Land internal size, output size, MSAA and sharpening never change.
- Remove restore saw-tooth for anything visible: levels 4–5 restore only while the camera
  is moving or after 20 s (`TUNING.retry`).

**Expected result after the three steps** on the 2880×1800 laptop: picture reads as
0.85–0.9 linear moving and native when still (today 0.52–0.75 and wandering); mesh layer
−15–25% at the views that are ground-heavy; whole frame equal or lower than today's level
0; zero visible resolution changes. On phones: steady 30, MSAA 2 instead of none, same
upscale.

## What to stop doing

- Stop changing land resolution at run time, in either direction. The +12%/+25% headroom
  levels are as much a part of the wobble as the 0.92/0.85 floor.
- Stop letting the browser do the upscale.
- Stop toggling MSAA in the ladder.
- Stop chasing whole-frame gains through CPU and allocation work for this goal: stage 2
  bought 3% of the frame [doc]. The frame is GPU; the levers are triangles in plants and
  fragments in ground.
- Do not build land TAA, a depth pre-pass, WebGL occlusion queries, or another separate
  renderer for one layer (reasons below).

## Every option, ranked by sharpness gained per millisecond

| # | Option | Sharpness / stability | GPU cost | Risk | Verdict |
|---|---|---|---|---|---|
| 1 | Fixed internal size + EASU/RCAS upscale in the land layer | large, constant | +0.6–1.2 ms, repaid by dropping `landScale` 1.25 | low | Step 1 |
| 2 | Same upscale on the sea canvas | medium (horizon, glints) | +0.5–1 ms | low | Step 1 |
| 3 | Remove resolution and MSAA steps from the ladder | large (stability) | 0 | low | Step 1 |
| 4 | Ground drawn last | 0 (frees ms) | −5–10% mesh | very low | Step 2 |
| 5 | Ground colour clipmap + procedural detail layer | medium (far ground stops shimmering) | −20% mesh | look sign-off | Step 2 |
| 6 | Still-view jittered accumulation | large when still | idle headroom only | low–medium | Step 3 |
| 7 | Far foliage as mip-filtered cards / impostors with alpha-to-coverage | large stability, frees most triangles | −30–40% mesh | high effort | after the plan |
| 8 | Water shading at half rate with reprojection | 0 (frees ms) | −30–45% of WebGPU frame | medium | ladder level, after step 3 |
| 9 | Phone DPR and MSAA policy | medium on phones | device-dependent | needs a device | with step 1 |
| 10 | Shadow map resolution / cadence | small | small | low | leave |
| 11 | Centre-weighted / foveated resolution | small | — | high | reject |
| 12 | Depth pre-pass | 0 | negative | — | reject |
| 13 | Land TAA | — | negative | high | reject |

### 1–3. Upscaler and fixed-resolution policy
Covered in step 1. Extra notes:
- Why not render at native without MSAA instead (pixels are cheap without MSAA [doc])?
  Because 4× pixels without MSAA is 1.5–2.1× the mesh layer [doc] and leaves sub-pixel
  foliage unantialiased; 0.61 linear MSAA 2 plus an upscale is cheaper and steadier.
  Worth one A/B though: 0.75 linear, no MSAA, alpha-tested rocks dithered, versus the
  plan. If rocks did not need coverage this would be closer.
- Sharpening must be the last thing before the lens grain and after the composite's
  tone curve. It is.
- The two canvases are composited by the browser, so each is sharpened separately. The
  land's silhouette alpha is filtered by the land pass; there is no cross-canvas edge
  problem as long as alpha is clamped (above).

### 4–5. Ground
Covered in step 2. Lower-frequency shading by resolution (a half-resolution ground buffer
composited under the plants) was considered and rejected: it needs a second depth-tested
pass and a depth-aware upsample at every plant edge, in WebGL without shared depth between
passes, for less gain than the clipmap, which is resolution-independent.

### 6. Temporal accumulation
- Full TAA on the land is rejected. Wind-blown foliage needs per-vertex previous positions
  (a second vertex evaluation on a triangle-bound layer) or it ghosts; fur shells and
  alpha-to-coverage edges flicker under neighbourhood clamping; and the land's history
  would carry premultiplied alpha over a sea canvas it cannot see, so disocclusions at the
  silhouette show stale sea-coloured fringes. The perf research reached the same verdict.
- The still-view variant in step 3 keeps the benefit (native detail when someone looks)
  with none of those failure modes, because it only accumulates while nothing in the
  camera moves, and per-pixel clamping handles what the wind moves.
- The clouds already do this properly (2×2 jitter, reprojected resolve, `main.js` `JITTER`
  [read]); leave them.

### 7. Alpha-to-coverage versus geometry for foliage
Shimmer on distant foliage is undersampled geometry: 13 triangles per shaded pixel means
most triangles miss every sample centre and the ones that hit change every frame. Geometry
is right within ~15 m. Beyond that, mip-filtered cards (or the octahedral impostors the
perf research lists) with alpha-to-coverage are prefiltered and therefore stable, and they
are where the triangles go. With MSAA 2, coverage has only three levels: sharpen alpha
with `(a − 0.5) / fwidth(a) + 0.5` so the edge is one pixel wide, and add a per-pixel
blue-noise offset to the coverage threshold so the three levels dither rather than band
(the upscaler's clamp keeps that dither from being amplified). This is the biggest
remaining lever for both cost and stability, and too large for this plan; do it next.

### 8. Sky and sea at lower rate
- Sky: already ~0.3 linear with quarter-rate clouds; 2× its pixels is only +3–9% [doc].
  Nothing to gain.
- Sea: the water pass is the WebGPU cost (2× pixels = 1.6–1.7× [doc]); the WebGPU frame is
  ~20% of the frame at home and ~54% facing the sea [doc]. Half rate: shade water into a
  target every other frame with a 4% overscan; every frame run a cheap reprojection pass
  (per output pixel: ray to the sea plane, project with the shading frame's camera,
  sample; sky pixels by rotation only). Camera turns stay locked to the land canvas; wave
  motion updates at 30 Hz, which reads as water. Failure modes: screen-edge disocclusion
  beyond the overscan on fast turns (fall back to clamped sample), the cat's wake and surf
  line stepping at 30 Hz next to 60 Hz land (shade the near 30 m every frame if seen).
  Without reprojection, do not do it: a one-frame lag between the canvases slides the
  coastline against the land.
- Use as ladder level 3 rather than always-on, so the sea is full rate when there is room.

### 9. DPR policy
- Laptop (dpr 2): internal 0.61 linear MSAA 2 → output native. After step 2, 0.70.
- Desktop dpr 1: internal = native, MSAA 4, no upscale pass, RCAS off (as today).
- Phone (dpr 3, `light`): today 585×1266 with no antialiasing [doc], which crawls. Tile
  GPUs resolve MSAA cheaply [est, unverified on a device]; try MSAA 2 (then 4) at the same
  internal size and the one-pass upscale to dpr 2 output (780×1688), browser doing the
  last 1.5×. Pace at a steady 30 from the start on `light` rather than discovering it
  through the ladder: evenly paced 30 is smoother than 60 with drops.
- All fixed at load from `dpr` and the budget; a window resize is the only thing that
  changes a size.

### 10. Shadows
Shadow receive is ~9% of the mesh layer [doc]; the refresh is already sliced and keyed
[read]. A 2048 map over the near field with PCF radius 2.2 is not what makes the picture
soft. Leave it, except: after step 1, check that shadow edges do not ring under RCAS (the
clamp should prevent it).

### 11. Foveated / centre-weighted / content-adaptive
WebGL2 has no variable-rate shading; a warped projection would bend every vertex shader in
`forest.js`. The layer split (sky 0.3, sea 0.54, land 0.61) already is content-adaptive
resolution. Reject.

### 12. Depth pre-pass and front-to-back
Overdraw is 1.2–1.5 [doc] and the layer is triangle-bound: a pre-pass doubles vertex work
to save at most a third of fragment work. Reject. The free version is ordering: ground
last (step 2). Same-frame occlusion for the home view's 21.5% hidden triangles still needs
shared depth, which stays with the single-renderer migration.

## Measuring it

`scripts/perf.mjs` [doc; script not opened]:
- Cost: `ab --base <ref>` at 1440×900 dpr 2, six views × noon/night, whole-frame ratio and
  IQR, per step. Pass bar: step 1 ≤ 1.00 against today's level 0 pinned; step 2 ≤ 0.90 at
  home and milkwood. `bench` for the governor trace: the land size line must be constant.
- Look: `shots` + `diff` for stills before and after.
- **Sharpness metric** (new mode, `sharp`): capture the composited page at device pixels
  for each view (a) as shipped and (b) a reference with the land and sea pinned to native
  size, MSAA 4, no upscale. Report on luma:
  - gradient-energy ratio: mean Sobel magnitude, test / reference. Target 0.90–1.05
    (today's bilinear stretch should score about 0.55–0.65 [est]; over 1.05 means
    oversharpened);
  - MTF50 ratio from the radially averaged power spectrum, test / reference;
  - overshoot: share of pixels outside the reference's local 5×5 min/max by more than
    4/255 (halos). Target < 0.5%.
- **Stability metric** (same mode): with scene time frozen, eight captures with the
  camera yawed by one quarter of an internal pixel each; mean absolute luma difference
  between consecutive frames after shifting back, on edge pixels only. It must not rise
  against today's build (this is what catches RCAS amplifying foliage crawl), and should
  fall after the clipmap and the footprint clamp.
- The owner's test stays the last word: fan noise on the laptop after five minutes at the
  beacon, and thumb-scrolling the camera on a phone.

## Open questions for whoever implements

- Is the land canvas premultiplied, and does `lens.js` assume the canvas is at land size?
- Does `forest.updateLod` cross-fade or swap?
- Where does three sort the ground in the opaque list today?
- Does `perf.mjs shots` capture at device pixels (needed for the sharpness metric)?
