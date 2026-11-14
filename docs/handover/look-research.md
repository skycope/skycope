LOOK RESEARCH: Sky Cope, branch magic-round2 (read-only; server and Chrome stopped; nothing written to the repo)

Evidence lives in S = /private/tmp/claude-502/-Users-skycope-Code-skycope/f5ab9af3-9006-4e05-a49e-0559244e2385/scratchpad/look-research/ (sheets/*.jpg are 3x2 contact sheets, shots/ has 280 full frames, cat/ has orthographic silhouettes and pose frames, res/ has 2x-DPR crops).

Caveat first: the brief's times are for an equinox date. Today (14 Nov) the sun is at 14° at 1090 and 10° at 1113, so those are afternoon. I also captured true golden hour 1145 (4°), sunset 1165, dusk 1188 and dawn 350. Use those minutes for QA this month.

## 1. DIAGNOSIS

**Colour grading**
- Sunset sky is lovely but the land under it is neutral grey-brown; wet sand stays grey while the sea beside it mirrors pink (S/sheets/C1165sunset-a.jpg, B1145gold-a.jpg). Cause: `buildEnvironment` in src/landscape.js halves the sky's chroma (`luma + (rgb - luma) * 0.5`) and `hide` swaps 60% of the lowest 20° of sky for ground bounce, which is exactly where the sunset colour is.
- Shade is dark brown or neutral, never blue (S/sheets/2noon-veg.jpg, 3gold-wide.jpg). Same two terms, plus soil albedo.
- Overcast turns the whole land khaki/sepia (S/sheets/4duskoc-wide.jpg, 4duskoc-veg.jpg); real overcast is cool and neutral with richer greens. `lightingAt` in src/sunlight.js greys the sky but the land's warm albedos dominate.
- Night: any warm-albedo surface glows orange against the blue: the cat and fallen leaves (S/sheets/6nightM-cat.jpg tile 6, 5night-wide.jpg tile 2). Cause: the `cones` term in `CustomToneMapping` (landscape.js ~l.42) and `tonemap` (src/shaders/atmosphere.wgsl ~l.135) keys on hue only, not brightness.
- Sand is ochre-tan; Cape quartz beaches are near-white. It also costs bounce light.

**Lighting**
- The cat's noon shadow is near-black while tree and boulder shadows are much lighter (S/sheets/2noon-cat.jpg): two shadow systems unmatched (src/cat-ground.js `createContactShadow` vs the scene map).
- No contact darkening under paws in shade; the cat floats (S/shots/c2-cat-side_1dawn.jpg).
- Low sun only reads warm where it hits directly (B1145gold-b.jpg tile 2 is good); everything else gets no sky colour.

**Vegetation**
- The slopes are evenly spaced, same-height saplings on bare painted ground: an orchard, with no shrub layer, so you see straight through to dirt (S/sheets/2noon-wide.jpg tile 4, 2noon-veg.jpg). Real fynbos is continuous knee-high cover. src/vegetation.js `vegetationLayout`.
- Close leaves are large flat single-colour facets (S/shots/v6-shrub-close_2noon.jpg, 2noon-places.jpg tile 6).
- Ground is soft vertex-colour blobs on a 0.5 m grid (terrain.js `GROUND` 190 m / 380) with sparse spiky tufts scattered polka-dot fashion (S/sheets/dawn-cat.jpg tile 6).
- One green everywhere; no grey-green, olive or ochre mix.

**Magic**
- The wisp's ground "pool" is a 7x7 sheet draped on `surface()`, which includes boulder tops, so it stretches into hard-edged bright wedges across rock and sand (S/shots/w3-beach-sea_6nightM.jpg, 5night-wide.jpg tile 3). src/wisp.js, `POOL` and the heights loop in `update`.
- It also blows the beach to white at night: the pool plus `magicGlow[2]` in src/land-magic.js light the same ground twice.
- By day the wisp is a sun-sized white flare with a white ribbon (2noon-wide.jpg tile 3, 4duskoc-wide.jpg tile 3, S/sheets/res-crops.jpg tile 4).
- With all gifts awake: every constellation figure at once, 4–6 meteors in one frame, fireflies and tideglow together (6nightM-wide.jpg). The lighthouse beam is a flat tan wedge (6nightM-places.jpg tile 1).
- What works: lit cottage windows, the boat lantern's warm pool on blue sand, the tideglow swash line. Warm practical light in a blue night is the look to build on.

## 2. THE CAT'S PROPORTIONS (own section)

Measured from the bind-pose mesh built in node (S/cat/ortho-side.png, ortho-front.png, ortho-top.png, 5 cm grid; S/sheets/cat-stand.jpg, cat-move.jpg in game). Model metres, before `CAT_SCALE`.

| Measure | Now | Real shorthair | Change |
|---|---|---|---|
| Chest depth / withers height | 0.167 / 0.284 = 59% | ~45% | cat-body.js `anatomy`: ribs ry 0.069→0.052, centre y 0.006→0.020; chest ry 0.061→0.048, y −0.012→0; spine ry 0.048→0.042 |
| Leg visible below chest | 41% of height | 50–55% | follows from the above |
| Head width (with fur) | 11.2 cm, equal to the ribcage | 8.5–9 cm | cranium [0.039,0.035,0.042]→[0.033,0.031,0.040]; cheeks x 0.025→0.021, r 0.027→0.022 |
| Head depth | 9.8 cm | 7–7.5 cm | same, plus the neck below |
| Neck | 9 cm thick, ~1.6 cm visible | 6–7 cm thick, 4–5 cm visible | neck cone 0.045/0.041→0.034/0.030; neck ellipsoid [0.041,0.043,0.04]→[0.032,0.034,0.036]; cat-rig.js `HEAD` z 0.228→0.245 |
| Muzzle ahead of the eyes | ~1.5 cm (flat face) | 2.5–3 cm | muzzle, pads, nose, jaw-tip z each +0.007 |
| Haunch width | 15 cm (pear shape from front/top) | 9–10 cm, no wider than the chest | thigh ellipsoid x 0.034→0.024; cat-rig.js hind `hip` x 0.036→0.030 |
| Forearm / pastern thickness | 4.4 / 3.2 cm | 2.6 / 2.1 cm | cones 0.0192/0.0132→0.0145/0.0105; shin 0.021/0.0122→0.016/0.010; hock 0.0122→0.0095; leg `fur` 0.5–0.6→0.3 |
| Hind bones (femur/tibia) | 0.085 / 0.086 | 0.105 / 0.11 | cat-rig.js `LEGS` hind bones [0.085,0.086,0.068]→[0.10,0.105,0.07]: same hip height, so the stifle and hock fold into a real Z |
| Humerus | 0.066 | ~0.095 | front bones [0.066,0.086,0.034]→[0.085,0.09,0.036]; re-check `neutralFoot` |
| Tail | 4 cm thick, uniform | 3–3.5 cm tapering to 2 | `radius(s)` 0.0115→0.009, taper 0.25→0.45; tail `fur` 1.5→0.9 |
| Ears | 2.8 cm above the crown on an 11 cm head | ~half head length | fine once the head shrinks; `EAR_HEIGHT` 0.05 stays |

Length (0.47 nose to rump), height and eye spacing (3.7 cm) are right; eyes will sit at ~42% of head width once it narrows. The top view is a constant-width log (cat-stand.jpg tile 5; the owner's screenshot shows the same): after the changes it should show shoulders, waist and hips.

Non-proportion cues:
- Stripes are pencil lines: `wave = p.z * 235` with `width` 0.15–0.3 gives 4–8 mm lines (src/cat-coat.js ~l.236). Use 190 and 0.35–0.5. Ground colour is taupe; push it to warm ochre with a cream chin and belly.
- Brow marks read as angry cartoon eyebrows, and the iris fills the whole opening with a pinprick pupil (S/cat/stand-front.png). Drop the upper lid over the top 20%, darken the iris rim, and keep `catPupil` above ~0.25 by day.
- Fur reads as salt-and-pepper noise with a hard silhouette (res-crops.jpg tile 4): lengthen the outer shells at the silhouette only.
- Whiskers are thick white strokes: halve width and opacity.
- Sit pose: forelegs fuse into a pale blob and the body is an upright cylinder (cat-move.jpg tiles 1–2). cat.js `POSTURE.sit`: front [0.02,0.1]→[0.028,0.12], pitch 0.72→0.62, and curve the spine.
- Walking tail is a rigid vertical pole (cat-move.jpg tiles 4–5): lower `targetE` and add a curve at the tip.

## 3. RESOLUTION

Measured at 1512x982 CSS, DPR 2: the sea canvas is 1520x987 and the land canvas 1570x1019, so both render at about 1.0x CSS and are stretched 2x on a Retina screen; the sky target is 450k pixels (about 0.55 linear) and clouds a quarter of that. The DOM text is sharp at 2x, which makes the scene look softer by contrast.
- Policy (for the performance researcher): `budget` 1.6 MP and the `Math.max(0.6, quality)` factor in `resize`, src/landscape.js; `WATER_PIXELS`, `SKY_PIXELS`, `MAX_DPR` in src/main.js. Headless measured 33 ms frames and quality fell to 0.88. MSAA is on for desktop and off for phones (`antialias: !light`). The owner's screenshot shows stair-stepped edges consistent with quality near 0.6.
- Content: the 0.5 m ground masks; coat detail that is noise rather than strands; large leaf facets; thin blades that go blocky at 1x (res-crops.jpg tiles 1–2). These stay soft at any resolution.

## 4. BLENDING (objects and animals)

What the owner's screenshot shows (images/1.webp): wreck timbers in the shallows as bare dark prisms with knife edges, no waterline, no burial, no wet band. In my frames: wreck ribs are black sticks on clean sand, the lighthouse is a clean cylinder on grass with a flat roof, the compound wall is a grey box (S/sheets/2noon-places.jpg, 4duskoc-veg.jpg tile 6).

Missing, in order of how much they would buy: burial and drift at the base; a wet line and tide mark tied to the real sea level; contact occlusion on the ground beside the object; colour picked up from the ground; edges broken by wear; detail frequency matching the rocks'.

Why: src/place-kit.js `createMaterials` darkens by `vPlace.y - vPlaceAnchor`, a per-part authored anchor, not the real terrain or sea.

Cheapest shared mechanism: one `grounding` block in `patchMaterial` (src/forest.js), fed by a small height texture of the terrain (the grid data forest.js already holds) and the swash level uniform:
- `h` = world y minus terrain height: for h < 0.3 m blend albedo and roughness toward the ground's own colour with noise-broken edges (drift), and multiply in occlusion;
- `w` = world y minus sea/swash level: dark wet band, algae tint and gloss below ~0.5 m.
It should also write a soft darkening into the ground shader around place footprints (`placeClearance` zones are already data). Animals (penguins.js, seals.js via `lightWithMagic`-style wrapping) get the same h term for a contact shadow. Shader-only; one texture fetch.

## 5. DIRECTIONS (ranked by gain per cost within each area)

**Grade and light** (all shader/CPU-constant, no triangles)
1. Environment chroma by sun height: in `buildEnvironment`, chroma 0.5 at noon rising to ~0.85 below 10° sun; cut `hide` to ~0.25 on the sun-side half. Land and wet sand pick up the peach/mauve sky; shade turns blue-violet. Risk: cyan shade at noon if not gated.
2. Night `cones` must also require brightness: multiply by `smoothstep(0.08, 0.3, scotopic)` in both tonemaps, kept identical in landscape.js and atmosphere.wgsl.
3. Overcast white balance: under cover > 0.6, tint land key and fill ~6% toward blue and raise `VIBRANCE` to ~0.10 for greens, in the shared tonemap so sea and land match.
4. Match the cat's shadow density to the scene shadow (use the same sky-fill ratio in cat-ground.js) and add a paw contact term.
5. Paler sand (src/material-palette.js): more bounce, more Cape. Check the reflection field stays in step.

**Vegetation**
1. Fill the understory with painted and near-ground cover, not new trees: extend the scrub mask and `NEAR_GROUND` sprigs so slopes read as continuous fynbos. Shader plus existing instance budget. Risk: the near-ground window is triangle-bound; hold counts.
2. Vary tree height and spacing in `vegetationLayout` (moves triangles, adds none), and thicken crowns down to the ground at grove edges.
3. Per-plant hue families (grey-green, olive, ochre) through the existing colour attributes.
4. Leaf facets: midrib shading and a gloss gradient per pixel in the foliage shader; smaller, more numerous leaves only inside the 17 m full-detail ring (adds triangles; send to the perf pass).

**Magic** (subtract first)
1. Delete the wisp pool mesh; keep one shaded light (`magicGlow[2]`) at about a third of its strength. By day make the wisp a small glint with no ribbon.
2. Stars: draw only the figure the cat is facing after it sits or meows; cap to one meteor at a time (`meteorRate` in src/sky-events.js).
3. World answers the cat, all on existing hooks: grass and flowers lean and brighten briefly in its wake; tideglow only where paws touch; fireflies gather only when it sits; the lamp sweep pauses on the cat when it meows.
4. Replace the beam wedge with light landing on surfaces (`magicBeam` already does this) and a faint volumetric only near the lamp.

## 6. LANES

- **A. Grade, light, grounding**: src/landscape.js, src/sunlight.js, src/shaders/atmosphere.wgsl, src/forest.js (shaders only), src/material-palette.js, src/place-kit.js. Order: night cones, env chroma, overcast, sand, grounding block. Verify at 350, 750, 1145, 1165, 1188, 1320, clear and overcast, land against sea at the swash.
- **B. Cat**: src/cat-body.js, cat-rig.js, cat.js, cat-coat.js, cat-ground.js. Order: proportions (re-run the orthographic silhouettes), then leg bones and IK, sit pose, coat and eyes, shadow match. Verify paw planting and jump heights still work.
- **C. Vegetation and magic restraint**: src/vegetation.js, plant-forms.js, near-ground.js, ground-detail.js, wisp.js, land-magic.js, sea-sky-magic.js, sky-events.js. Order: wisp pool removal, stars cap, understory, layout variety. Verify triangle counts at the tour views.

Collisions: place-kit.js sits beside the collision engineer's place-*.js, and penguin/seal grounding touches files near theirs, so land grounding after their merge; anything in fireflies.js (gather-on-sit) waits for them; lengthening the cat's legs changes paw reach, so tell the walker.js owner. For the perf pass: resolution budgets, smaller leaves, and any near-ground density change.

## 7. WOULD NOT DO

- No filmic S-curve, bloom or global saturation boost: the flatness is missing sky colour in the ambient, not the curve.
- No new effects or props until the wisp pool, the daytime flare and the stars are cut back.
- No new trees or higher-poly cat as the first move: the mesh layer is triangle-bound and the faults are proportion and cover, not polygon count.
- No rescaling the cat's overall size: length and height are correct; the masses are wrong.
- No raising resolution inside the look pass: that is a cost decision for the perf researcher.

Not verified: none of the suggested constants has been run; the proportion targets are from standard shorthair anatomy, not a measured reference photo; the run frames were captured from behind, so gait timing and foot planting were not assessed.