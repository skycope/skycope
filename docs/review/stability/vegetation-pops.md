# Vegetation pops: findings for the vegetation lane

From the stability lane (scripts/stability.mjs, 15 Nov 2026). These are in
`instance-lod.js`, `forest.js` (packing and casters), `near-ground.js`: files
the stability lane does not edit. Measured headless at 1280×800 @1, seed
1847, under GPU contention (counts and pixel areas, not milliseconds).
"Pop" = a connected region of 16-px blocks whose brightness changed in one
frame by more than 10/255 and by more than 2.5× its own change in the
frames either side, and stayed changed; "vanish" = leafy blocks that turned
non-leafy in one frame after two steady frames. Every flag in
`before/stability.json` and `after/stability.json` carries the eye position
(`eye`, coast metres), the block box (`box`, pixels) and the events logged in
the frames it shows (`lod-pack N chunks` = N vegetation chunks repacked).

## 1. Repacking whole sets in one frame (the budget's LOD bias): fixed on our side, one ask

`packDue` repacks every chunk whose `bias` differs from the frame's. When the
render budget stepped `lodBias` (1 → 0.85 → 0.72) every chunk in range was
repacked at once: the before run logs single frames with 89, 122, 212, 228
and 274 chunks repacked (throttle and orbit sessions), each moving every
fade band in view in that frame. The stability lane now eases the bias
(`quality.js easeBias`: 1% steps, ~2.5 s for a 15% change). But each 1% step
still repacks every chunk (`chunk.bias !== bias`), so a bias change is now
~15 frames of full repacks instead of one. **Ask:** in `packDue`, repack on a
bias change only when it moves a boundary of that chunk by more than the
fade band's slack (e.g. `|Δbias| × start > 0.25 × fadeWidth(start)` for a
boundary inside the chunk's range), or carry the bias into the vertex fade
(`lodFade`) so a small bias change needs no repack at all.

## 2. Shadow casters are LOD'd from the camera

The sun's shadow map is drawn with whatever level each plant was packed at
for the camera when the refresh ran; it is refreshed only when the sun moves
(0.05–0.3°) or the anchor moves (9 m of walking). In between, plants change
level as the cat walks (the 60-triangle shoot to the 14-triangle card at
~17 m, etc.) while their shadows keep the old shape, and at the next refresh
the self-shadowing of every plant that changed level changes at once. The
stability lane made the refresh itself clean (texel-snapped shadow camera,
so static casters land in the same texels; atomic swap; no repack during a
sliced refresh). **Ask:** draw shadow casters from a camera-independent
level (the level for the distance from the shadow anchor, or a fixed
caster level), so a plant's shadow never depends on where the camera was.
`landscape.shadowRefreshing` is true while a sliced refresh is part-drawn;
The vegetation lane has since added `forest.holdShadowLod` (09b49e2), which
covers this; landscape.js now holds the LOD bias still during a refresh.

## 3. Level swaps are shape swaps (stage 1 finding, still there)

Within a fade band an instance grows or shrinks to the next level's size,
so the swap itself is between two parts of the same size, but a different
shape (stage 1, `docs/review/perf/01-stage1/veg-lodbias-worst-step-diff.jpg`).
With the camera moving, the before run flags 131 pops in the walk session,
311 on the movement lane's routes and 63 in a fast orbit; most frames with
the camera moving also repack a chunk, so attribution is weak, but the
pops are small: median 1,024–1,536 px (4–6 blocks at 1280×800), mostly in
the lower third of the frame (ground cover 2–10 m from the eye). The
routes' worst moving pops (50–75k px) are camera cuts at route starts, not
vegetation. **Ask:** a dithered cross-over of the two levels over the last
metre of the band (alpha-to-coverage, which MSAA 2 makes cheap), or
matching the coarse level's silhouette to the fine one's at the swap.

## 4. Fixed on our side, for the record

- The fold-away (leaves collapsed to their stems within 1.1 m of the lens
  and in a cone to the cat) is gone; near-lens foliage now thins instance
  by instance by dither (forest.js FOLD_GLSL / FOLIAGE_LENS_GLSL, the chunk
  the stability lane owns). See `foliage/` for route strips before/after.
- The milkwood's 30–38 m cross-over (place-kit `crossfade`) dithers by
  `alphaHash`; standing inside the band shows a stipple on the crown that
  shimmers as the wind moves it. Not measured as a pop; worth a look when
  the milkwood is next touched.
