# Stage 1 verification (14 Nov 2026, under GPU contention: counts and image diffs only)

## Per-instance vegetation LOD (instance-lod.js): no pops found
`lodsweep.mjs`: camera fixed at the milkwood view, reduced motion, the render budget's
`lodBias` swept 1.0 → 0.6 in 1% steps (every level boundary walks through the view).
Per step: 0.05–0.32% of pixels change by more than 8/255, mean 0.01–0.10; no step spikes
(triangles 1.53M → 1.05M). The worst step (`veg-lodbias-worst-step-diff.jpg`) shows a few
restio/tuft silhouettes swapping geometry whole at the same size: the level switch is a
shape change, not a fade, but at ~20 m and a few pixels wide.

## Landmark LOD (places.js THREE.LOD, not instance-lod): the milkwood pops
`lodswap.mjs`: from just inside each landmark's `farDistance`, the same frame drawn with
its near and far level. Milkwood (farDistance 34 m): 2.0% of all pixels change by more
than 8/255 in one frame even from a viewpoint where most of the crown is behind other
trees (`milkwood-lod-near/far/diff.jpg`), 162k triangles saved. The other landmarks:
0.3% (45 m), ~0% (40 m, 40 m, 30 m). Owner of the fix: places / movement lanes
(a fade or a dithered cross-over at the milkwood's boundary).

## Sliced sun-shadow refresh: works; one bug fixed
A refresh is spread over `shadowSlices` = 4 frames (+21%, +18%, +14%, +13% triangles)
instead of one +90% frame. Bug: the cat's own shadow pass renders the scene too, and
consumed a slice, so two slices often ran in one frame. Fixed in landscape.js.

## Render budget (quality.js) under load
Released and free-running under heavy contention (load average 6–9), the governor walks
3 → 11 in ~15 s and holds there: level 11 is the land floor (0.85 × fit), land
1498×936 of a 2160×1350 full size on a 2880×1800 panel. It never went below the floor,
shed sky, sea, LOD bias and pace (30 fps) first as designed, and restored to 9–10
when load eased. It holds the floor it was given; whether 0.52 linear of native is the
right floor is a look decision.
