# Visual stability (15 Nov 2026)

The owner, on the merged build: "it seems quite glitchy in terms of views
rendering / lighting changing etc", "details and stuff for performance
reasons i think obviously rerender in the main view", "lighting of plants
were flickering", "the vegetation … kind of goes invisible when the cat walks
through it or when the camera goes through it". The rule: adaptation is
allowed, seeing it happen is not.

Measured with `scripts/stability.mjs` (README, "Visual stability"), headless
Chrome at 1280×800 @1, seed 1847, on a shared, loaded machine (load average
5–20, other agents' browsers on the GPU): trust counts, not milliseconds.
`before/` is 9c3e373 (magic-round2 at b00fa07 plus only the `?perf` event log),
`after/` is this branch. Each directory has `stability.md` (every flag with
the events logged in the frames it shows), `stability.json` (flags with eye
position and block box, the event log, the per-frame series) and the worst
example of each kind as `<session>-<kind>-1.png` (frame a | frame b | 4×
difference). `compare.md` and `compare-cloudy.md` are the full before → after
tables. `foliage/` has the movement lane's routes as strips, before and after.

## What changed, by how visible it was

| class | before → after | cause | fix |
|---|---|---|---|
| canvases resized outside a frame (a cleared canvas can be shown) | 15 → 0 per session | the load reveal stepped every canvas 1/32 → 1 in five timer-driven resizes; window resizes also from the event | the reveal is one eased focus pull (a compositor blur on both canvases, 1.4 s, then removed) at final size from the first frame; window resizes and budget levels apply at the top of the next rAF tick, in the task that draws both canvases |
| reveal steps | 5 → 1 | as above | as above (sharpness rises smoothly during the veil's hand-over: the detector counts that as a run of small consecutive steps in the first 1.6 s; after it, still-camera sharpness steps 9 → 2 across all sessions) |
| budget level changes | still 10 → 2, throttle 19 → 6, routes 14 → 7, leaves 14 → 0 | the governor shed in 0.6 s and restored after 1.5 s of headroom; restores failed and re-shed (saw-tooth: 19 changes in the throttle session) | land resolution and MSAA fixed for the session (removed from the ladder); the ladder sheds only unseen things; no two changes within 8 s; at rest a shed needs 8 s of overload; restores need 30 s since the last change, 10 s of headroom and the camera moving; a failed restore backs off 60 s doubling; the LOD bias eases in over ~2.5 s in 1% steps (`quality.js`, tests in `tests/quality.test.js`) |
| time jump: lighting in two steps | shadows swapped 3–7 frames after the sun; a second luminance step 67 ms later (−22.9 then −10.4 at golden hour); skylight up to 250 ms late → one frame, shadow lag 0 | sliced shadow refresh (4–8 frames) while the sun direction applied at once; dome and environment throttled to 4/s | a change of sun over ~2° is a discontinuity: dome, environment, light through the clouds and an unsliced shadow map all in that frame |
| plant lighting flicker under broken cloud | environment rebuilt 189 → 15 times in 50 s (`--weather cloudy`) | the sun through the clouds was sampled at the camera 4×/s and on every 3 m of camera travel and applied unsmoothed to sun, leaf light and the environment key (to 3 digits), so the island's light and every material's sky light stepped four times a second | sampled where the cat stands, eased (τ 0.6 s); the environment's bounce takes a slow average held until it moves 6%, both inputs quantised to ~2.5% |
| shadow refresh mechanics | — | refresh slices mixed vegetation levels; anchor flipped as the camera turned; texel grid moved with the anchor; long low-sun shadows jumped per 0.3° | no repack while a sliced refresh is part-drawn (`landscape.shadowRefreshing`); anchor with 9 m hysteresis; shadow camera snapped to whole texels; refresh quantum down to 0.05° near the horizon; the cat's pass never draws the sun map |
| prewarm stall | before: 112–175 ms hitches at prewarm here, and a 6.4 s frozen frame mid-reveal at load average 40; after: none at the land prewarm | ~70 programs compiled in one task (`compileAsync` on the whole scene), with the WebGPU awake pipelines in the same task, racing the first frame under load | `src/prewarm.js`: one new program per idle slice, the next only once the GPU reports it linked; starts 3 s after the reveal; the sky/sea awake pipelines only after it (tests in `tests/stability.test.js`) |
| foliage vanishing round the cat and the camera | fold removed | leaves within 1.1 m of the lens and in a cone round the line of sight to the cat collapsed onto their stems | nothing folds; foliage within 0.25–0.7 m of the lens thins instance by instance (own hashed threshold, narrow ordered-dither band) measured from where the plant stands, so sway does not move it across the boundary |
| blank frames | routes 1 → 0 | the one blank was the detector's own clipped screenshot re-laying the page out | strips now come from the screencast |

Also fixed: a lightning flash at night dropped the night fill on foliage;
the lamp slot jumped between lamps (now held until another is a fifth nearer,
faded out and in over 0.25 s); the waking catch's gutter ran at ~6 Hz for
five gifts (now under 3 Hz at every pace, tested); a lost WebGL context is
logged (`webgl-lost` under `?perf`). `scripts/perf.mjs ab --base` (and
`stability.mjs --base`) measured the working tree as the base since the
loading veil started importing `main.js` dynamically; both now rewrite every
`/src/` import in the snapshot.

## The blank screen

Not reproduced as a blank in these runs (0 blank frames in every session,
before and after). What was reproduced: the prewarm racing the first frames.
On the loaded machine at the start of this session (load average 40) the
first frame came after the 4 s prewarm timer, the whole-scene compile ran
in the reveal, and no frame was rendered for 6.4 s; on a quieter machine it
was a 112–175 ms hitch. A flat page-blue screen is what both canvases look
like when nothing is presented (the page background is #8fc4e3); a GPU
process busy with ~70 program links plus the WebGPU pipeline build is the
likely way to get there. After: the land prewarm is 35 slices over 1.5–3 s
with no hitch; the remaining hitch is the sky/sea awake pipelines' build
(105–130 ms, once, ~5 s after load), which is one task of WebGPU work.

## Lighting lag after a time change

Before: the first frame after the slider had the new sun, colour and
exposure but the old shadow map (3–7 frames, sliced) and up to 250 ms of old
skylight: two visible steps. After: one frame. The luminance then drifts
smoothly for a few seconds (cloud history rebuilding), with no steps.

## What remains

- Moving-camera pops and flashes are dominated by natural motion and by
  vegetation level swaps (`vegetation-pops.md`, for that lane). The
  still-camera pop/flash counts include surf, swash, animals and fireflies;
  they did not move meaningfully either way.
- The foliage flicker metrics (`flicker`, `leafLight`) depend on the
  screencast's capture rate, which fell in the later after-runs as the
  machine loaded up; compare them only within a run. `leafLight` (the mean
  light on foliage, which sway averages out) is the one to trust.
- Under contention the budget still sheds during the sessions (sky and sea
  scale, shadow cadence, LOD bias, pace); each is applied at a frame boundary
  and none changes the land's resolution. Whether 0.61 linear on a Retina
  laptop is the right fixed land size is a look decision (`docs/design/resolution.md`).
- The near-lens dither is a dither: very close grass shows a stipple as it
  dissolves. A depth-aware camera (the camera lane) keeps the lens out of
  bushes; this only handles what is left.
- The awake sky/sea pipelines build in one task (105–130 ms hitch once).

## Perf

`perf/ab.md`: this branch against b00fa07 (its merge base), two tabs, one
headless Chrome, 1440×900 @2, budget pinned to level 0 (which now renders
the land at its fixed budget size, 1762×1101, where level 0 used to render
2160×1350 with headroom): see the table there and the final report.
