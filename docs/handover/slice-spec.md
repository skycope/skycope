VERTICAL SLICE SPEC: decisions (repo untouched; prototype server and Chrome on 5351/9451 stopped)

Tags: [M] measured this session (other agents on the GPU, so contended), [C] read from code, [J] judgement.

## The reference, and the stack question

[J] The reference is almost certainly an offline or high-end desktop render (Blender/Unreal-class scattering): even soft GI under foliage, true bokeh, per-object motion blur, no LOD pops, 24 fps. Leaf-for-leaf parity is not reachable in a browser on an integrated GPU. The same class of image at a glance (no bare ground, layered species, soft translucent crowns, mist, overcast light) is plausible, and the slice exists to prove it.

Do not rethink the stack. Vercel only serves static files and Vite is fine. What changes is that the land moves onto WebGPU.

## 1. Renderer: (a) Three.js WebGPURenderer + TSL, on the device the sky/sea already own, composited by the existing WGSL water pass

Evidence from a throwaway prototype [M] (/private/tmp/claude-502/-Users-skycope-Code-skycope/f5ab9af3-9006-4e05-a49e-0559244e2385/scratchpad/slice-research/proto.js, screenshot proto-300000.jpg in the same folder):
- `new THREE.WebGPURenderer({ canvas, device })` ran on a device I created; `renderer.backend.device === device` was true.
- A raw WGSL pass rendered a sky texture, and Three read it through `ExternalTexture` as `scene.backgroundNode`.
- Three rendered 300k instanced alpha-to-coverage cards plus a skinned mesh into an MSAA 4 `RenderTarget`.
- A raw WGSL pass then read Three's colour and depth (`renderer.backend.get(rt.depthTexture).texture`) and added depth mist. Zero validation errors.
- One catch: with MSAA the depth texture is multisampled, so bind it as `texture_depth_multisampled_2d` (or render a single-sample depth).
- Throughput, contended: 300k cards (1.8M triangles, unculled, 1440x900 MSAA 4) took 12–16 ms/frame wall; 1M cards took about 50 ms.

[C] three 0.185.1 ships what the slice needs: `device`/`context` parameters (WebGPUBackend.js:209, 336), alpha-to-coverage (WebGPUPipelineUtils.js:213), indirect draws, Skinning nodes, and `DepthOfFieldNode`, `MotionBlur`, `FSR1Node`, `TRAANode`, `GTAONode` under examples/jsm/tsl/display.

Wiring for the slice:
- vgpu's device (`state.gpu.gpu`) goes to Three.
- Three renders land into an HDR colour + depth target.
- water.wgsl gains two bindings (land colour, land depth) and composites.
- The transparent WebGL canvas, the duplicated tonemap and the lens pass disappear under `?slice`.

Rejected options:
- (b) raw WebGPU for land: would rebuild skinning, shadows, instancing and materials for no gain in the slice.
- (c) staying on WebGL: keeps two canvases and no shared depth, which is exactly what mist, depth of field and sea-under-land need.

The cat:
- SkinnedMesh works on this backend [M].
- cat-coat.js is `onBeforeCompile` GLSL (uses `gl_VertexID` texel fetches and instanced shells) [C], which node materials do not run. It must be rewritten in TSL.
- For the slice: body with the baked colour texture, plus 6 shells as an InstancedMesh with a TSL `positionNode`. This is the largest porting risk; budget 1–2 days.

Fallback:
- Where WebGPU is missing the sky and sea already do not run, so the existing static fallback in index.html stands.
- Three's `forceWebGL` backend does not help, because the WGSL passes need WebGPU.
- Keep the current WebGL land path as the default until the migration is complete.

What it commits the migration to:
- All land GLSL (about 1,500 lines in forest.js, plus place-kit.js, animal-forms.js and the cat files) rewritten as TSL.
- One tonemap and one uniform set.
- Exposure to three's node-API churn between releases.

## 2. Plants: geometry near, self-baked cards beyond, impostors far

Atlases:
- Keep the procedural rule. Bake at load on the GPU by rendering our own plant-forms.js organs (leaf sprays, petal heads, restio strands, hanging twig strands) orthographically into atlases.
- Two textures per atlas: albedo + alpha, and normal.xy + translucency/thickness + AO.
- Cost of the rule [J]: no photographic venation, blemishes or petal micro-variation, so close-ups look clean and CG. Do not ask the owner to relax it yet. Ask only if the slice fails acceptance on the close view, and then only for scanned leaf and petal atlases.

Species [J]:
- 12 species × 3–4 variants (about 40 meshes or cards), with per-instance hue, scale, lean and age jitter. Below about 8 species repetition reads.
- Set: 2 restios, thatching reed, 2 tussock grasses, erica, pincushion, protea, daisies in 3 colours, sour-fig mat, watsonia spikes (the foxglove role), milkwood, and one tree with pendulous strands (the willow role).

Budgets for the 20 × 20 m patch:

| Item | Budget |
|---|---|
| Ground-cover clumps | about 120k (300 per m²) |
| Flower stems | about 6k |
| Shrubs | about 600 |
| Trees | 3, each about 30k leaf cards at nearest level |
| Triangles in view | ≤1.5M laptop, ≤0.5M phone |
| Depth-passing fragments per pixel | ≤3 average, ≤6 peak |
| Texture memory | about 135 MB laptop (two 2048² plant atlases × 2 maps, one 2048² impostor atlas × 2, RGBA8 with mips); about 34 MB phone at 1024² |

LOD chain, per instance, never per 20 m chunk (that mistake is what produced the 3M-triangle views):
- 0–8 m: real geometry (blades, petals, leaves).
- 8–25 m: cards.
- 25–60 m: clump billboards; trees become octahedral impostors beyond 40 m.
- Cross-fades are 2 m bands of dithered alpha, which works with alpha-to-coverage and needs no blending or sorting.

No bare soil:
- The ground mesh is a dark litter/moss base matched to mean plant albedo, so gaps read as shade.
- Density never thins with distance; the cards get larger instead.

Shading and wind:
- Wind: port `GUST_GLSL`/`WIND_GLSL` to a TSL `positionNode`.
- Leaves: wrapped diffuse plus a back-lit term scaled by baked thickness, a rough sheen from the atlas normal, skylight from the existing nine SH coefficients, and per-instance baked canopy occlusion.

Culling:
- CPU cells of 4 m with three distance bands for the slice.
- Record instances per band. Move to compute culling with indirect draws only for the whole island.

## 3. Atmosphere and camera

Cheap with shared depth, done at full resolution inside the composite pass (one depth read):
- Exponential height mist over ground and water, with slow noise.
- Distance haze tinted by the sky table, so tree layers separate.

Lighting: overcast is SH skylight plus baked occlusion. It needs no sun shadow pass; a low sun uses the cached shadow map.

Depth of field: `DepthOfFieldNode` at half resolution, far-field only. On when the camera is still and in photo mode; off while moving.

Leave out of the slice: motion blur (needs a velocity buffer, and a 60 fps follow camera barely shows it), god rays, SSGI, SSR, TRAA.

## 4. Frame budget on the Retina MacBook (targets [J]; idle-machine numbers do not exist yet)

Panel is about 3024×1964 (5.9 MP).

| Pass | Resolution | Budget |
|---|---|---|
| Land | 0.75 linear, about 2268×1473 (3.3 MP), MSAA 4 | ≤7.5 ms (ground and near geometry 2, cards 3.5, cat 0.7, amortised shadows 0.8, margin 0.5) |
| Composite + mist | native | 0.7 ms |
| Sea | 1.5 MP, upscaled | ≤2.5 ms |
| Sky and clouds | 0.45 MP | ≤1 ms |
| Depth of field, when on | half resolution | 1.5 ms |
| CPU | n/a | ≤3 ms |

Total is about 12 ms GPU at 60 fps.

Phone tier: steady 30 fps, about 1 MP land, alpha-test with dither instead of alpha-to-coverage, 40% density, cards from 4 m, trees as impostors beyond 15 m, no depth of field.

Most likely to fail:
1. Fill cost of layered cards at 3.3 MP (hanging strands, flower fields at cat height). My contended 12–16 ms for 1.8M card triangles at 1.3 MP is the warning.
2. The cat coat's TSL port losing its look.
3. Self-baked atlases reading as stamped CG up close.

## 5. Build plan for one engineer

New modules under src/slice/, behind `?slice`; one branch in main.js and two bindings in water.wgsl:
- index.js: renderer on the shared device, targets, counters
- patch.js: 20 × 20 m layout beside the home beach
- species.js: built on plant-forms.js
- atlas.js: GPU bake
- materials.js: TSL foliage, ground, wind, SH
- instances.js: cells, LOD bands, dither fades
- tree.js
- mist.wgsl: included by the composite
- cat-tsl.js
- hud.js

Order:
1. First hours: shared device, composite with depth, ground base and restio/grass cover. There is something to look at.
2. Rest of day 1: flowers.
3. Day 2: atlas bake and one milkwood.
4. Day 3: mist, haze, depth of field.
5. Day 4: the cat.
6. Day 5: measure on the owner's laptop, idle.

Views to capture:
- V1: cat height through flowers toward the sea (reference frames 9–10).
- V2: shore edge into low sun with mist (frames 1–2).
- V3: under the tree looking up (frame 11).
- V4: reeds beside the path (frame 6).

Counters:
- Instances per LOD band, triangles, draw calls.
- Depth-passing fragments per pixel (additive override material).
- GPU ms per pass. main.js now requests `timestamp-query` [C].
- Atlas MB.
- Frame p50 and p95 over a 60 s scripted walk.

Acceptance:
- V1 and V2 stills beside the reference frames, which the owner calls the same class of image.
- p95 ≤16.7 ms at 0.75 linear on the MacBook, with the fans quiet after 5 minutes.
- A steady 33 ms counts as "possible, at 30 fps".
- Slower than that means stop and rethink before any migration.

Sources: installed three 0.185.1 source (paths above); [three.js r170 release notes mirror](https://newreleases.io/project/github/mrdoob/three.js/release/r170); [three.js r183 release notes mirror](https://newreleases.io/project/github/mrdoob/three.js/release/r183); [Octahedral impostors for three.js](https://discourse.threejs.org/t/octahedral-impostors-for-three-js/80318); [Optimizing AMD FSR for Mobiles](https://atyuwen.github.io/posts/optimizing-fsr).