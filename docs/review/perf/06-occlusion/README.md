# Occlusion culling: re-measured, not reinstated

Why it went (8a9a58c, 30 Sep, no reason recorded): read against its own design
(21153f3 `src/occlusion.js`), the answer of each box query arrives one or two
frames late, so a chunk that a passing trunk, boulder or the hill uncovers stays
missing for those frames. Frustum entry was counted as visible, but disocclusion
was not; from the cat's low follow camera, walking past a tree uncovers chunks all
the time. It also needed 10 m chunks (+~130 draw calls) to pay. The revert came
50 minutes after it landed, which fits pop-in seen in play.

What it could save now (`occlusion.mjs`, here): render the view into a depth
target, then test every drawn mesh of 2,000+ triangles (bounding sphere as a box)
against that depth with ANY_SAMPLES_PASSED_CONSERVATIVE. Hidden share of the
tested triangles, noon, gifts asleep:

| view | meshes tested | hidden meshes | tested triangles | hidden | share |
|---|---|---|---|---|---|
| home | 94 | 21 | 940,143 | 202,524 | 21.5% |
| milkwood | 84 | 1 | 1,366,736 | 2,723 | 0.2% |
| beacon | 106 | 1 | 1,711,484 | 2,723 | 0.2% |
| beacon-out | 96 | 5 | 1,435,337 | 28,290 | 2.0% |
| lighthouse | 48 | 1 | 854,491 | 2,723 | 0.3% |
| sea | 24 | 2 | 368,826 | 6,107 | 1.7% |

Per-instance LOD already removed most of what the old culling caught: with 20 m
chunks only the home beach (the hill behind the dunes) has much to gain, and only
by a one-frame-late test that pops on disocclusion. Not reinstated. The way to get
the home view's 20% without pop-in is a same-frame test: a depth pre-pass or Hi-Z
from last frame's depth reprojected, which is the single-renderer (WebGPU) stage of
the plan, not a WebGL patch.
