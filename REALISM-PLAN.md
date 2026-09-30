# Skycope realism: independent review and deeper implementation plan

Independent review, 2026-09-30. Target: branch `realism-100x` in this worktree.

The largest improvement will come from making **colour and light, plant growth, and ground structure** agree. The inland scene needs a convincing distribution of living material, exposed substrate and accumulated debris, illuminated without emerald highlights, muddy ground or unreadable canopy interiors. Advance surf and cat materials alongside that land work; then make weather leave persistent consequences. Distant procedural islands should follow those foreground improvements. More noise, denser meshes and stronger colour grading alone will not deliver the realism sought here.

This is a revised plan, not an implementation or a measured performance result. The original audit is retained at the end for comparison. Its numerical diagnoses and cost estimates are hypotheses unless explicitly verified below.

This revision incorporates the updated audit's splash defect and the owner's **procedural-world direction: no real-world landmarks**. Botanical and photographic references constrain plausible forms and light; they do not turn this seeded island into a reconstruction of Cape Town.

## 1. Evidence and independent visual judgment

I inspected all **42 original frames** in seven contact sheets, examined representative originals at full size, and took **five additional live browser captures** from this worktree using ordinary navigation. Seed: `1847`. New captures include noon at home and inland, noon rain, a clear close view of the cat and an evening close view. Capture dimensions differ; these are diagnostic images, not a controlled visual or timing A/B. See [the capture record](realism-review/README.md).

| Visible problem | Evidence | Independent judgment |
|---|---|---|
| Surf reads as white cutout sheets, with large rounded holes and broad continuous bands. Far swells form repeated parallel stripes. | Original `01`, `07–10`, `23–27`; [own noon](realism-review/own-01-home-noon.jpg) | **Highest coastal priority.** Improve the shape, distribution, lighting and history of foam before adding more ocean microdetail. |
| Slopes look like a smooth landscaped surface with isolated specimen plants. Ground between trunks has little intermediate structure. | Original `01`, `07`, `11`, `13`, `16`, `37`; [own inland](realism-review/own-02-inland-noon.jpg) | **Growth, ground relief and colour must be solved together.** A green shader on the same bare slopes would still lack height, edges and parallax; new geometry under the current muddy light would remain hard to read. |
| Sunlit foliage is strongly green, shaded foliage and ground lose material separation, and pale surf dominates the coastal palette. | Original clear/cloudy tour; own noon, inland and evening captures | Calibrate the light and material contributions independently. Preserve differences between grey/waxy leaves, dry stems, mineral sand, humus and damp surfaces instead of giving the whole scene one desaturation treatment. |
| Close foliage exposes large angular leaves, repeated organ silhouettes and prominent branch joints. | Original `11`, `14`, `15`, `28`, `32` | The current simplification is visible. Redistribute geometry and preserve canopy appearance through LOD; multiplying shrub count can make the same problem more expensive. |
| The cat's eyes look luminous, stripes look drawn on, and the body has a hard surface even when its silhouette reads correctly. | Original `20–22`; [own close view](realism-review/own-04-cat-close.jpg), [own evening](realism-review/own-05-cat-evening.jpg) | Correct eye shading, coat direction and transitions between anatomical regions first. A grey coat or extra shell alone is insufficient. |
| The rain occupies the sky and sea but disappears across the land. Heavy cloud has a bright horizon strip. | Original `29–31`; [own rain](realism-review/own-03-rain-noon.jpg) | A clear compositing and weather-consistency problem. Rain should also affect materials, shelter, impacts and sound. |
| Boulders often read as rounded isolated forms with a broad painted wet band; close granite speckle competes with shape. | Original `05`, `09`, `23`, `36`, `37`; own close view's background | Joint structure, embedding and the relationship between rock, sand and water matter more than adding variants alone. |
| Daytime shadows already provide strong contrast; forest floors can be very dark while remaining structurally empty. | Original `11–16`, `28`, `31` | The scene is not uniformly flat. Adding blanket AO can deepen darkness without improving form. Diagnose direct light, sky visibility, bounce and representation separately. |
| Distant space lacks landmarks, but close objects dominate most frames. | Original `05`, `06`, `35`, `38` | A skyline adds place and distance cues. It cannot rescue implausible foreground structure and materials. |

The original `14-hill-overview` and `32-cloudy-overview` frames are largely inside foliage, and several `17–19` rock views are obstructed by vegetation. A fixture name does not prove it covers its intended subject. Repair these targets before treating the tour as comprehensive QA. The swimming still also warrants an immersion/pose check, but a still does not establish gait quality.

Screenshots establish appearance, not real-world irradiance ratios, wind amplitudes, GPU bottlenecks or temporal stability. Those require separate measurements or motion sequences.

## 2. Recommendations that should change

| Original claim or recommendation | What the current code supports | Revised action |
|---|---|---|
| “Rayleigh-only” atmosphere; aerosol about 20× too low. | `sunlight.js:7–12` already includes Mie scattering with marine aerosol coefficients, and also ozone. | Check units, scattering orders, angular distribution, exposure and CPU/WGSL agreement. Do not multiply aerosol from the original assertion. |
| Reject non-finite splash results after `cat_sea`, as well as fixing its expressions. | `shaders/wake.wgsl:136–150` has unchecked negative event age and a signed input to `pow(x,2)`; the swash twins also square signed values using `pow`. | Fix the numerical domains and clocks first, reproduce the running route, then judge the water. A bitcast guard or whole-circle bound does not establish safe arithmetic within that region. |
| Reduce the ocean to 3% reflectance to match real water. | The shader already has angle-dependent Fresnel with a 0.02 normal-incidence term. Water-body scattering, sky reflection, foam and the final display curve are separate contributions. | A low normal-incidence reflectance is not an all-angle brightness target. Inspect contributions at several view angles; reduce excessive body scattering or grading only where the diagnosis supports it. |
| Mesh and reflected land already share one palette. | `land-field.js:15–20` retains older sand/dune/litter/moss values than `forest.js:1268–1273`; it also compresses colour onto two tint endpoints. | Share the material description, then measure compression and canopy-shade bias. Copying four base colours alone will not reproduce the mesh's masks, wetness and lighting. |
| Crown AO is always 1, so crown occlusion does nothing. | `forest.js:1032` does derive `vCrownAO` from a normalized vector, so that **specular** factor is ineffective. However, explicit `canopyShade` separately occludes diffuse and specular light. | Repair the dead factor or remove the duplication. Preserve and evaluate the working shade path before strengthening it. |
| Crown shading is absent. | A fresh seed-1847 generation produced 216,129 clusters, 215,962 explicit shades, a median shade of 0.2707 and a range of 0–0.7099. | Treat this as an interaction between two paths, not a missing system. These are data values, not measured image darkening. |
| A 0.5 m occlusion grid misses tufts. | `occlusionField` uses 6 m **spatial buckets** for analytic occluder queries; ground attributes are another discretization. | Measure ground sampling and which plants enter the occluder list. Bucket size is not the resolution of an AO texture. |
| Every rock is one clone. | `ROCK_VARIANTS = 3`; small scatter uses variant 0, while clustered boulders use several variants. | Improve scale-dependent shapes and placement rules; do not present existing variation as new work. |
| Shade should be desaturated 50%, with a statistical horizon applied globally. | The scene uses a global environment/SH dome, with local scalar visibility. | Fix atmospheric calibration and add **local directional** visibility. Keep a global open-sky reference. A uniform horizon mask would dim the open beach as if it were under trees. |
| A shaded vertical face should receive about 0.5× the light of horizontal ground. | That ratio depends on sky distribution, visibility, surface orientation and bounce. 0.5 is a useful uniform-upper-hemisphere reference, not a universal outdoor target. | Test against angular integration and matched material probes, not one fixed ratio across weather and time. |
| Skyline reflection is free. | Water samples the resolved sky on screen and falls back to the sky-view table off screen; direct sun and night objects are added later in `water.wgsl`. | Integrate skyline visibility into all relevant paths, including off-screen reflection and celestial-disc occlusion. Count additional evaluation and filtering. |
| A final WebGL post quad can grade the whole scene. | WebGL land sits over a separate WebGPU canvas. That quad cannot automatically sample the underlying HDR sky/water. | Use a staged cross-layer strategy described below. Do not assume shared colour/depth textures or free cross-API copies. |
| Narrower FOV saves 45% of chunks. | Chunk culling and LOD depend on position, projection and threshold; moving the camera back changes them again. | Prototype lens and follow distance together. Compare equal subject size and navigability. Bank only measured savings. |
| Shader changes and bakes have zero cost. | They still use ALU, vertex work, bandwidth, memory, uploads or startup time. PMREM rebuilding also submits GPU work. | Distinguish steady-frame, update-frame, startup and memory costs. Every new lookup and pass needs a ledger entry. |
| Fauna shadows are always stale because the shadow map never updates. | `autoUpdate` is false, but `needsUpdate` is set on lighting and camera-anchor changes. | Shadows can become stale between updates. Remove inappropriate casters or provide a small dynamic path after measuring their contribution. |
| Cape slopes should be 90% covered in vegetation. | No location-specific reference was established for that percentage. Cape coastal communities vary substantially. | Choose a habitat composition and reference it. Use dense patches, open sand and exposed edges intentionally; avoid one coverage target for the entire island. |

The coastal vegetation direction should follow a selected reference community. SANBI describes coastal fynbos as a mix of shrubs, restios and bulbous plants, often with small leaves, while its ecosystem guidance distinguishes several strandveld structures. That supports a habitat mosaic; it does not establish the audit's blanket 90% figure. [SANBI coastal fynbos](https://www.sanbi.org/gardens/kirstenboch/seasons/botanical-society-conservatory/kirstenbosch-conservatory-the-coastal-fynbos-bed/), [ecosystem guidance](https://opus.sanbi.org/bitstream/20.500.12143/5806/1/Ecosystem_Guidelines_Ed2.pdf).

## 3. Shared causes: the foundation for deeper realism

Create a small set of world descriptions that all renderers and interactions consume. Extend the existing `swell.js`, `sea-surface.js`, seeded vegetation and land field; much of the groundwork exists already.

| Shared description | Required contents | Consumers |
|---|---|---|
| Terrain and shore | Actual beach slope, local shore normal/arc, bathymetry, material region, conservative land coverage | Mesh, water, swash, collisions, prints, sound |
| Weather forcing | Mean wind, gust phase, shelter, rain, cloud transport and explicit response times | Plants, short waves, spray, fur, precipitation, audio |
| Surface state | Moisture, standing film, last inundation/impact time, drainage class | Sand, rock, bark, coat, footprints, reflections |
| Habitat | Exposure, substrate, slope/aspect, shelter, competition and patch age | Plant architecture, placement, ground litter, fauna opportunities |
| Material identity | Linear base colour, pigment/age class, roughness/normal statistics, transmission, moisture response | Mesh shading, ground generation, reflection field, near/far plant representations |
| Visibility and transport | Solid horizons, porous canopy visibility, local bounce colour, spatial height | Diffuse sky, rough reflections, rain shelter, wind shelter, acoustic obstruction |
| Interaction events | Paw contact/lift, water entry, landing, shake, disturbance, animal alert | Gait, prints, rings, droplets, plant bend and sound |

Keep biological time, astronomical preview time and animation time explicit. The sea intentionally uses slowed rates (`SWELL_SPEED = 0.22`, with different cascade rates), and the cat is drawn at 1.4× domestic scale. Those choices affect perceived mass and size. Test more physically consistent motion and scale together before deciding that the lens alone is the scale problem. Weather changes need response times; a time preview must not silently simulate hours of rainfall or change tide without a stated rule.

Generated numerical fields and caches should come from the existing procedural scene. This preserves the project's asset approach and makes the same seed describe visible geometry, collision and environmental effects. The following proposals combine established techniques with project-specific designs; “novel” here means a useful experiment for this renderer, not a claim of a new research invention.

## 4. Realism workstreams, with performance designs

### Colour and lighting — first land experiment

The goal is readable material identity under changing illumination: pale mineral sand, weathered wood, restrained living greens, dry grey/brown growth, and wet surfaces that retain their identity. The current captures suggest an imbalance between material, illumination and display response, but do not identify one universal colour multiplier. Start by exposing those contributions.

**Calibration order:**

1. Render neutral planes/spheres beside one sand patch, one crown, one boulder and the cat. Inspect base colour, direct diffuse, sky diffuse, bounce, specular/transmission and haze separately using temporary debug modes. Hold exposure, weather and camera fixed. These are diagnostic variants, not extra passes in the shipping frame.
2. Establish a common colour contract: authored hex/CSS inputs, linear RGB material/vertex data, linear radiance/irradiance and a single output conversion per layer. Trace explicit exposure through `sunlight.js`, Three lights, SH, PMREM and WGSL. Audit cosine/solid-angle weights and the Lambertian π conversion rather than tuning gains until one view agrees. Three's documentation distinguishes these input, working and output roles; the current use of `THREE.Color` does not by itself prove a pipeline error. [Three.js colour management](https://threejs.org/manual/pages/color-management.html).
3. Generate mesh base colours and reflection-field inputs from one material description. As a concrete starting check, `#c2ae8c` sand converts to approximately `[0.5395, 0.4233, 0.2623]` linear RGB, whereas the field uses `[0.4, 0.33, 0.2]`. That is a **base-colour mismatch**, not a measured final-image difference. Preserve material masks, wet state and occlusion separately; do not bake a lighting error into albedo.
4. Compare the present `1.5` tone gain and `VIBRANCE = 0.18` with neutral diagnostic settings in **both** renderers. Check highlight clipping, hue shifts and loss of shadow separation. Choose the display look after transport/material calibration. Automatic white balance per view would erase purposeful warm sun/cool sky relations and cause camera-dependent colour changes; use one documented baseline and restrained adaptation.
5. Correct local visibility/bounce using workstream C. Open-beach sand should see the horizon; a trunk under a crown should not. Check the existing green bounce, whose colour contains the leaf albedo twice, before adding another bounce term. Maintain separate controls for transmitted light and reflected fill, and test their combined energy rather than treating each additive term as an independent brightness enhancement.

| Material / visible symptom | Deeper colour and light change | Cheap representation |
|---|---|---|
| Saturated leafy crowns with dark empty interiors | Correlate pigment, thickness, leaf age and upper/lower surface response; put pale waxy leaves in appropriate architectural families. Preserve dark interior gaps and plausible backlit edges. | A few organ classes and per-instance parameters; reuse the existing shader. Generate their mean response for far LOD. |
| Muddy/olive floor with little separation | Separate mineral sand, humus, decayed litter, live moss and dry thatch. Derive their coverage from substrate and local producers, then light them consistently. | Shared patch/material fields and sparse near geometry, as described below. |
| Bark chevrons and pale high-contrast marks | Define longitudinal grain and interrupted growth/weathering regions in branch coordinates. Make colour, relief and roughness correlated without identical amplitudes. | Branch-local coordinates; cache coarse fields per archetype. |
| Black glossy wet rock / over-white foam | Separate substrate absorption from film reflection, and foam coverage from its scattering. Retain roughness and partial coverage as effects become unresolved. | Moisture/film parameters, normal moments and integrated coverage, without another full-screen pass. |
| Grain and leaf highlights look synthetic | Broaden unresolved lobes as the pixel footprint grows; preserve integrated energy. A random sparkle gate should not brighten a patch merely because a different seed/LOD was selected. | Statistical lobe/coverage parameters produced with existing LOD data. |

**Feasible experiment:** one switchable material/light fixture and one inland patch, using the existing passes. A material table is tiny; local transport has the explicit costs in C. Avoid a new colour lookup for every pixel if an instance/vertex parameter suffices. Evaluate reflection tint compression by reconstructing representative materials and measuring error; widen it only if visibly needed.

**Pass condition:** noon, overcast and evening retain distinct sand/wood/live/dead material identities; canopy interiors are readable without lifting the whole forest; backlit leaves do not bleach; reflected land agrees with visible land within the documented approximation. **Fallback:** shared palette, corrected colour/exposure contracts and restrained existing material terms, before a new transport field. Touch `sunlight.js`, `landscape.js`, `forest.js`, `vegetation.js`, `land-field.js`, `atmosphere.wgsl` and relevant water shading together.

### Numerical correctness — before water appearance work

The updated audit correctly elevates the running/splash corruption. Reproduce original `26–27`, but distinguish a verified numerical hazard from an unmeasured diagnosis of every white patch. WGSL excludes negative bases from `pow`'s domain, including when the exponent is `2.0`; portable signed squaring uses `x * x`. [WGSL `pow` definition](https://gpuweb.github.io/gpuweb/wgsl/#pow-builtin).

- Replace signed-square uses in the splash rim and GLSL/WGSL swash twins. Audit other `sqrt`, inverse length, division and fractional-power domains along the same path.
- Reject future/expired events before evaluating age-dependent math; clamp valid strengths to the producer's documented range, and retain positive spread/decay denominators. Align event timestamps with animation time after pause/resume and scrubbing.
- Fix the producer and expressions first. A final non-finite guard is defensive diagnostics, not proof of portability or a cure for upstream invalid arithmetic; WGSL permits indeterminate results outside these domains.
- Verify no-event, fresh contact, overlapping rings, expired rings and resumed-time routes on both renderers. Then consider tighter wake bounds in the performance ledger.

### A. Surf with structure, age and transport — first coastal experiment

The current whitecap history already exists in `foam.wgsl`; the proposal is to extend causal state to shore foam and connect it to the existing swash, not introduce history as if it were absent.

- Separate **fresh breaking froth**, **advected residue**, **thin draining film** and **individual close bubbles**. They need different coverage, opacity, thickness, light response and lifetimes.
- Derive foam production from depth-limited breaking/compression and rock/paw disturbance. Stretch and tear it with the local flow; drainage should reveal damp sand beneath it. A new random threshold each frame will produce boiling rather than transport.
- Break the perfect ribbon into overlapping wave packets, alongshore variation and local sheltered gaps. Keep packet phases continuous when wind changes; transition energy and direction over time instead of rebuilding a wholly different sea immediately.
- Preserve the scale of bubble clusters and torn edges in metres. When they become unresolved, integrate their coverage instead of enlarging the holes or increasing whiteness.

**Feasible experiment:** start with analytic foam age driven by recent breaker events, then test a narrow shoreline ribbon of 256 alongshore × 32 cross-shore cells. Four FP16 channels with ping-pong storage are **128 KiB of raw texels**, before other resources. Evolve it at a candidate 10–20 Hz, reconstruct between updates and use existing world-to-shore coordinates. This is a local transport approximation, not a general shallow-water solver. Respect wet/dry boundaries, the periodic shore seam and rock barriers; substep or clamp transport so a cell cannot move through a barrier during one update.

**Pass condition:** in the same low beach view, fresh foam breaks into residue that moves and decays, water and sand retain visible tonal separation, and repeated parallel bands no longer dominate. Test a moving camera and several seeds. **Fallback:** event-driven analytic age/flow without the state grid. Keep whichever earns its measured cost. Touch `ocean.wgsl`, `foam.wgsl`, `surf.js`, `sea-surface.js`, `swell.js` together.

### B. A coast that remembers being wet

Extend the existing swash film and analytic five-second drainage term in `surf.js`/`ocean.wgsl`. Introduce separate moisture and surface-film states that survive different surges, rain and interactions. A surface can be damp after its shiny water film has drained; the current one-cycle analytic age is useful, but does not retain an arbitrary history of those events.

- Wet-sand width follows recent maximum run-up, rain, drainage and evaporation. Fine dark deposits collect where flow slows; retreat leaves uneven drying margins.
- Rock films drain down gravity-aligned paths and remain in hollows. Bark wets by exposure and absorption; coat clumps according to body region, immersion and time since leaving water.
- Paw prints have depth and compaction on sand, transient wet transfer on dry rock, and wash-out under a later surge. The same paw event produces the print, local water ring and impact sound.
- Keep material changes energy-conscious: add a dielectric film response, alter substrate scattering and broaden unresolved highlights. Do not uniformly turn wet surfaces black and mirror-smooth.

**Feasible experiment:** update only active shore segments and recently interacted patches. Store timestamps and drainage parameters, then evaluate exponential drying analytically. A 64² RGBA8 local state patch is 16 KiB raw; double buffering would be 32 KiB. A small CPU producer can upload the same state to both APIs without GPU readback. Measure upload spikes and quantization before expanding coverage.

**Pass condition:** after a wave retreats, sand remains damp; after rain stops, films drain before the substrate dries; a footprint is removed by the water that reaches it. **Fallback:** per-segment maximum run-up and event timestamps. This is also the first platform for wrack, kelp and debris deposited by larger surges.

### C. Local directional skylight and economical bounce

At a point `p` with normal `n`, diffuse sky irradiance should approximate:

`E(p,n) = integral[Lsky(w) * V(p,w) * max(dot(n,w),0) dw] + Ebounce(p,n)`.

Keep the open sky intact and model the local visibility `V`. A trunk blocks a direction; a crown transmits some light; neither is equivalent to desaturating the entire dome.

**Two candidates, to compare rather than stack automatically:**

1. Bake 4–8 directional horizon sectors plus canopy transmission and a bent direction from procedural geometry. Evaluate several sky directions per instance or ground vertex; interpolate on the surface. Eight horizon angles at 128² in two RGBA8 textures use 128 KiB raw, excluding transmission and mips. Encode canopy as porous material separately from the solid horizon.
2. For static ground/rock receivers, bake the **cosine-weighted visibility transfer** into nine scalar SH coefficients per receiver and dot it against the RGB sky coefficients. This is transfer including the receiver normal, not component-wise multiplication of two SH vectors. At 4,096 receiver samples, nine FP16 values use 72 KiB raw. Interpolate carefully across material and occluder boundaries.

Low-frequency radiance transfer has an established basis in [Sloan, Kautz and Snyder's PRT work](https://www.microsoft.com/en-us/research/publication/precomputed-radiance-transfer-real-time-rendering-dynamic-low-frequency-lighting-environments/). The sector representation and compression choices above are adaptations for this scene and need validation.

Add a conservative local diffuse bounce from sand, foliage and rock colours. This can give the cat a warm underside near sand and a cooler/green fill inside a thicket. It is a bounded single-bounce approximation, not full GI. Avoid adding the same bounce both to the global lower hemisphere and a local term.

**Limits:** low-order SH cannot supply sharp wet reflections or all contact shadows. A top-height map cannot represent overhangs or distinguish the sky above a canopy from the space underneath it. Use sparse height layers or crown primitives around important areas; retain directional shadow maps for direct sun. Moving leaves and the cat must sample/approximate visibility at their current height rather than reuse a ground coefficient blindly.

**Pass condition:** open beach stays open, occluded vertical faces turn convincingly, canopy interiors retain readable structure under overcast, and glossy rocks do not show sky through a solid neighbour. **Fallback:** one visibility/bent-direction term, with no new per-pixel march.

### D. Habitat architecture, not more specimen plants

Choose a coherent coastal community before adding species. Use exposed scrub, sheltered thicket, dune pioneers, restio/grass patches and intentional blowouts as spatial communities. Let tree shapes and low vegetation share shelter and substrate constraints.

- Replace the widely separated identical tufts with clustered mats, uneven patch edges, dead material and low woody structure. Keep selected paths and open sand plausible rather than filling every gap.
- Put plant height where silhouettes and parallax require it. Far interiors can remain shaded coverage; near patch borders need geometry. Roots meet accumulated litter and local depressions instead of an isolated dark splat.
- Design a few constrained architectural families: fine restio stems, narrow ericoid shoots, broad hard leaves and fleshy mats. Changing only colour and scale on a shared broad-leaf organ does not reproduce that distinction.
- Make flower density and dead material seasonal/patch-related. A constant display of every bright bloom across all habitats reads as landscaping.

**Feasible experiment:** represent each patch by coverage, height distribution, leaf-area density, material mix and motion response. Keep a cheap full-island patch description; generate detailed organs only for visible near patches and their collision needs. Spend the current geometry budget on low-layer edges and convincing close leaves; remove unresolvable organs from dense crown interiors.

**Pass condition:** the inland wide shot has a convincing intermediate height layer, the floor is not merely repainted green, and a close leaf silhouette no longer exposes the same large card everywhere. **Fallback:** low-poly patch clumps plus far coverage, with stable seeded placements. Touch `vegetation.js`, `plant-forms.js`, `forest.js` and reflection/visibility descriptions together.

#### Growth that explains the resulting shapes

The current space-colonization generator already uses attraction points, tropism, wind bias, clearance and branching; retain that investment. Extend the **decisions at buds and branches**, not just the scattering of finished plants. Light/space competition and internal allocation have precedent in [Pałubicki et al.'s self-organizing tree models](https://algorithmicbotany.org/papers/selforg.sig2009.html). The bounded coarse scheme below is an adaptation for this island, not a full physiological simulation.

- Give each plant a rootstock, developmental age and architectural rules: internode length, branch angle, apical dominance, basal shoots, leaf arrangement, bud survival and shedding. A prostrate mat, coppiced shrub and canopy tree should not be scaled versions of one crown.
- During generation, let a **long-term light-opportunity proxy** and nearby occupancy influence bud direction/survival. Use a small set of representative sun/sky directions, not today's instantaneous sunlight. Exposed trees retain fuller low crowns; crowded interiors self-prune and extend toward gaps. Preserve some dead twigs and breakage where the family/age permits them.
- Combine slope/gravity, prevailing exposure and substrate moisture with that opportunity field. Wind-exposed growth becomes asymmetric over developmental time; live gust bending remains a separate reversible motion. Changing weather presets must not instantly regrow the island.
- Allocate terminal leaf area/bud demand back through the branch graph. `tips = fill(1)` currently sums **all growth nodes**, so radius depends on branch discretization as well as foliage demand. Prototype leaf-demand/terminal-bud weights so changing colonization step size or LOD cannot thicken the trunk arbitrarily. Keep tapered junctions and contiguous branch surfaces around important forks.
- Carry semantic organ IDs and age through every representation. Younger tips, older hard leaves, dead basal blades and bare shaded branches can share a coherent colour/roughness story. LOD selects a representation of the same organism, rather than generating a different organism.
- Solve recruitment and patch expansion at community scale: a few parent patches, sheltered establishment, clonal expansion where appropriate, mortality and open disturbance gaps. This produces age gradients and interlocking edges rather than a uniformly jittered field of mature plants.

**Feasible experiment:** generate one exposed grove and one sheltered thicket with a bounded 6–12 coarse allocation/competition rounds and explicit caps on buds, neighbours and work. Cache occupancy/light opportunity by region; process plants in deterministic batches to avoid generator-order bias. Generate developmental skeletons once per seed in a worker, then decorate only needed near regions. Those round counts are candidate limits; measure generation latency and memory, and reduce them if shapes converge earlier. A handful of seed-consistent skeleton families with cheap contextual adaptation is the low-tier fallback.

**Pass condition:** isolated and crowded examples of the same family have visibly different, explainable crowns; low dead branches and leaf-age gradients are visible nearby; changing growth resolution preserves major form and thickness. Measure startup separately from steady-frame cost. No per-frame botanical growth solver is required.

### Ground detail — structure deposited by plants, wind and water

`forest.js` already shades grains, ripples, pebble/shell marks, litter, twigs and sward. The independent criticism is that much of this remains **paint on a smooth surface** and lacks a convincing distribution at the camera's scale. Adding another noise octave to every material would repeat that failure.

| Scale at the surface | What should explain it | Representation to test |
|---|---|---|
| Metres to tens of metres | Dune shoulders, erosion/runoff paths, sheltered sand accumulation, exposed granite, thicket margins | Shared terrain/substrate and habitat fields; geometry and collision agree. |
| Decimetres to a few metres | Root flares, hummocks, hollows, sediment berms, dead clump centres, litter pockets | Sparse feature descriptors and near relief; broad far coverage/height statistics. |
| Centimetres to decimetres | Curled leaves, branching twigs, shell fragments, stones, basal stems, footprints and exposed roots | Sparse near instances where they create silhouette/contact; shallow relief elsewhere. |
| Millimetres and below | Grain mixtures, fibre/leaf roughness, small pits and aggregate slopes | Footprint-filtered material detail and normal moments, not individually rendered grains everywhere. |

**Distribution rules that leave evidence:**

- Plants produce specific litter: restio/grass thatch at their bases, broad leaves under suitable crowns, sparse twigs near woody structure. Seed source density from organ/patch identity, then bias transport into wind shelter and depressions. Decomposition changes shape, pigment and roughness together; avoid default bright orange autumn leaves beneath every evergreen.
- Roots stabilize small hummocks and collect litter; exposed gaps can scour or compact. A root collar should meet the actual ground, and a boulder should interrupt drainage/sand deposition. Keep these as bounded features, not a noise field displaced through every object.
- Water sorts and redistributes beach material: recent run-up margins, fine deposits in low flow, stranded fragments/wrack, and washed-out prints. Start with an analytic deposition proxy using known flow and shelter. A mass-conserving local transport experiment is later work, after water motion and boundaries agree.
- Use directional coordinates: ripples aligned with local flow/wind, litter elongated by transport, bark grain along branches, and root features following the plant base. Avoid unrelated world-space patterns crossing every habitat with the same orientation.
- Ground cover overlaps organically: low stems transition into thatch, patch edges curl into exposed sand, and dead centres/open blowouts break uniform mats. Place detail where it contributes occlusion/parallax at patch edges, instead of hiding most of it beneath opaque crowns.

**Feasible experiment:** improve one 12–20 m inland patch, keeping its seed and camera fixed. Use a coarse full-island material/producer description plus a candidate **32 m × 32 m, 128² local cache** for low-frequency detail: 0.25 m cells. One RGBA8 mix field plus one R16F relief field is **96 KiB raw**, before mips, staging, renderer duplication and any rolling double buffer. A 128² field over 190 m has ~1.48 m cells and cannot encode centimetre litter; do not mistake texture resolution for a solution to every scale. Fine features remain analytic or sparse instances.

Cache material mix, substrate/deposition tendencies and broad relief once; derive normals from the same relief. Compare fewer shader hashes against the texture fetch/upload cost. Only give near centimetre features actual geometry when they earn silhouette, contact or parallax. Keep the relief stable in world space while the local cache moves; rebuild only entering strips with safe overlap. If relief affects paw planting, camera clearance or the water edge, make it queryable by their CPU/shared descriptor too. Pure shading bumps must remain too small to imply unsupported contact geometry. Do not add full-island tessellation or a per-frame erosion solver.

**Pass condition:** a low, sideways pan reveals rooted plants, an uneven floor and convincing litter thickness; the same patch at follow distance has readable live/dead/mineral separation without sparkly noise or visible cell stamps. Cat paws and rock bases meet the new surface; cache movement does not repaint it. **Fallback:** static regional caches, clustered near litter/root geometry and the current filtered shader for fine grains.

### E. LOD that preserves the response to light and wind

The current stable subsets and enlarged shoots save vertices, but matching projected area alone does not preserve gaps, orientation, transmission, shadow density or specular response. This is a major realism/performance opportunity.

For each representative patch or crown, preserve:

- silhouette and directional coverage;
- mean albedo and its relationship to shade;
- normal distribution and unresolved slope variance;
- transmissive fraction and the rough sheen width;
- aggregate shadow/sky visibility;
- mean bend and motion amplitude/phase.

Generate a hierarchy from the same organs: actual leaves nearby, compact folded clusters at middle distances, then a small directional coverage representation. Consider a limited atlas of **unlit albedo, normal, depth and coverage** generated from procedural archetypes. Bake geometry/material properties rather than sunlit colour so it can survive weather and time changes. A billboard must handle parallax, wind, shadow passes and silhouettes; it is not inherently cheaper when overdraw dominates.

Normal moments can carry unresolved detail into a broader highlight rather than vanishing or sparkling. This follows the filtering principle demonstrated by [LEAN Mapping](https://userpages.cs.umbc.edu/olano/papers/lean/); foliage coverage and motion matching remain separate project-specific work.

**Pass condition:** crossing an LOD boundary changes neither crown brightness nor gap density visibly, and a gust does not restart or change amplitude abruptly. **Fallback:** improve the existing folded-cluster hierarchy using coverage and normal statistics, without atlas generation. Use projected error and hysteresis rather than chunk-centre distance alone.

### F. Geology and sediment as connected structure

Rounded granite forms are not automatically wrong. The problem is a weak relationship between joint planes, weathering, placement and surrounding material.

- Generate a parent joint system for each boulder cluster. Smaller fragments inherit some orientation and grain scale; random rotations of unrelated rounded blobs do not tell the same geological story.
- Balance rounded corestones with planar breaks, shallow clefts, sheeting and a few angular chips. Vary macro shape before adding fine speckle.
- Embed the base in sand and accumulate a small sediment berm on the sheltered side. Spray exposure, lichen placement and wet drainage follow slope and actual shelter.
- Pack joint/shape parameters into a common descriptor used by visible mesh, water contact, reflection and collision. Changing the mesh alone would leave old waterline collars and floating/penetrating interactions.

**Feasible experiment:** several reusable jointed archetypes with per-instance parameters; near-only crevice/edge geometry, far normals and roughness moments. **Pass condition:** low-angle rocks sit in the beach, close grain does not become glitter, and foam/refraction follow the new outline. **Fallback:** improve placement, normal/roughness and descriptor consistency before adding geometry.

### G. A cat with fur, tissue and weight

Keep the existing body SDF, rig, IK, shell system, coat bake and dedicated shadow. The question is which signals those systems fail to convey at play distance.

- Author a continuous anatomical fur-flow field: cheeks fan out, neck/chest fall downward, legs follow limb axes, flank runs toward the haunch and tail follows its tangent. Transport the flow with skinning. Use directional sheen and clump normals; fur volume in the silhouette and material response on the body have different jobs.
- Feather stripe boundaries through fur flow, mix root/tip pigmentation and ticking, and reduce repeated high-contrast bands where the reference coat requires it. Choose a coat reference before recolouring the entire cat.
- Recess eyes under a brow/lid, reduce apparent iris radiance, and separate iris from a clear corneal highlight. Keep pupils dependent on illumination and a small continuous response time. The current luminous appearance is a visual observation, not proof of an emissive shader bug.
- Match body mass to planted paws: weight transfer, shoulder glide, pelvic motion, compression on landing, and acceleration/turn anticipation. Test slope contact and immersion transitions before adding idle flourishes.
- Wetness should alter clumping, loft, sheen and region-specific drying. Tie droplets to shakes and body acceleration; keep wet transfer to rocks on the same paw events.

Hair/fur scattering is directional and includes transmission through pigmented fibres; [PBRT's hair model](https://pbr-book.org/4ed/Reflection_Models/Scattering_from_Hair) is a reference for the response, not a proposal to run its full offline BSDF per game pixel.

**Feasible experiment:** a small precomputed lobe table or fitted approximation, body shading at all distances, and shell/fin detail restricted by projected fur width and silhouette contribution. Reallocate existing shells before adding a pass. **Pass condition:** the cat reads as fur at follow distance, eyes remain integrated in shade, paws do not slide during a stance, and a swimming body meets the actual water level. **Fallback:** flow-aligned sheen plus corrected eyes and contact, using the current draw budget.

### H. Wind with shelter, inertia and a shared phase

Travelling gusts and plant push already exist. Improve their cause and response rather than simply multiplying sway.

- One world wind field supplies large gusts; static terrain/crown shelter changes their magnitude. Leaves, restios, branches, spray and coat use different frequency responses to that same forcing.
- Use branch size/stiffness to produce lag and rebound. Keep connected branch endpoints coherent. A heavy trunk should not respond like a reed.
- Let short waves react quickly and large swell retain independent longer-term forcing. Cloud drift can follow wind aloft; surface wind and cloud transport need not be identical.
- Preserve phase when wind direction or quality changes. Tilted leaf undersides and changing normal distributions should produce the gust shimmer; avoid an independent colour wave that outruns the geometry.

Efficient hierarchical/stochastic responses have precedent in [GPU Gems' procedural tree wind](https://developer.nvidia.com/gpugems/gpugems3/part-i-geometry/chapter-6-gpu-generated-procedural-wind-animations-trees). Here, extend that principle across consumers.

**Feasible experiment:** 2–3 response bands per architectural family, parameters generated with each plant, coarse shelter samples and shared analytic phases. Evaluate common bands per patch/instance when profitable, then small leaf flutter per vertex. **Pass condition:** a visible gust propagates through the scene with believable relative lag and no detached joints. **Fallback:** existing shader bands with improved scale/stiffness parameters. Verify in video, not screenshots.

### I. Clouds and atmosphere that light the world they show

- Calibrate the direct cloud term, phase-function normalization, extinction, multiple-scattering approximation and sky fill together. The factor `0.075` is visible in code, but replacing it by ×4 is an experiment, not an established physical correction.
- Give each cloud deck plausible base/top structure and coverage transitions. Fix the overcast horizon gap at the density/extent level; drawing a uniform darker strip conceals the symptom.
- Add a small cloud-transmission field so coherent cloud shadows reach terrain **and** sea. Reuse the same density/drift description as visible clouds; do not animate an unrelated dark patch map.
- Make aerial perspective depend on distance and view direction consistently in both renderers. Distinguish broad marine haze from local spray; local mist is strongest near breaking/impact events.

Atmospheric lookup tables and approximate multiple scattering are established in [Hillaire's atmosphere work](https://sebh.github.io/publications/); cloud density/lighting strategies are documented in [Guerrilla's Nubis overview](https://www.guerrilla-games.com/read/nubis-realtime-volumetric-cloudscapes-in-a-nutshell). Existing sky-view tables and cloud reconstruction should remain the starting point.

**Feasible experiment:** first test shared cloud transmission on a coarse grid generated from the common density source. A 64² R8 field is 4 KiB raw, but producing it and uploading it to both APIs is not free. Candidate cadence: 5–10 Hz, with motion-aware interpolation and sun-angle invalidation. **Pass condition:** the same cloud dims adjacent sand, plants and water, with plausible softness. **Fallback:** global transmission plus corrected cloud lighting, without the new field.

### J. Camera, compositing and precipitation

Keep the camera/world projection in one descriptor. Changing a repeated `0.9` focal constant at eight sites is brittle; derive projection and its inverse from the same focal/aspect/jitter values, including reflection lookups and picking.

Test 41°, 48° and the current ~58° vertical FOV with follow distance chosen to hold cat screen size constant. Judge scene scale, close occlusion, collision frequency, navigation and projected vegetation detail. A narrow lens can increase per-object pixel cost and higher-detail LOD even as it excludes chunks.

**Immediate cross-layer solution:** keep distant precipitation in the WebGPU background; add a small camera-near rain volume in WebGL, depth-tested against land. Add sheltered rain/impact rules from the shared world visibility. Use a sparse transparent overlay for truly lens-bound droplets/veiling effects when needed. A dark vignette can cover both layers by alpha composition, but colour-dependent HDR grading and bloom require access to the combined image. Retain the existing matched tonemaps until such access is real; verify edge alpha and colour space with diagnostic patches.

**Architectural experiment:** compare explicit colour/depth exchange against moving a limited mesh prototype into one rendering API. Measure copies, bandwidth, transparency, antialiasing, feature parity and device support. A full renderer migration is an optional milestone, not a prerequisite for fixing rain and not a claimed free optimization. Never use per-frame GPU readback to bridge the layers.

The spring-arm collision is present, but its coarse surface sampling and minimum reach are approximations. Check camera-sphere clearance, interpolated motion, steep rock gaps, near-plane exposure and canopy occlusion. Bending every plant away by a metre can reveal a moving hole; limit any lens avoidance to the nearest soft foliage and use a restrained visibility treatment when necessary.

**Pass condition:** rain exists in front of appropriate land surfaces, disappears under shelter, and shares one perspective; camera changes cannot introduce sky/land misalignment. **Fallback:** near WebGL precipitation with the current composition and lens.

### K. A procedural archipelago and a more restrained night

Follow the updated owner direction: **no real-world landmarks**. Generate a seed-consistent archipelago, initially the proposed 3–5 islands at candidate distances of 0.8–6 km. Vary ridge structure, forest/fynbos cover, dune shoulders and exposed granite coherently. Choose a few unequal shapes and gaps; evenly spaced cones would replace one artificial horizon with another. Astronomical coordinates do not require real geographical scenery.

Use compact seeded terrain descriptors and depth/bearing silhouettes with shared haze. Nearby distant islands need some slope/material response; tiny far silhouettes can use angular coverage/depth. Include them in direct sun/moon/star visibility, sky resolve and the off-screen reflection fallback; blend unresolved detail with the water's rough reflection footprint. Avoid an unconditional `above 5°` exit unless generated bounds prove it for all permitted camera heights. Test parallax when walking across the home island and transitions where overlapping islands exchange visibility; a single panorama at all positions will betray the nearest distances.

At night, test true and current stylized angular sizes of Sun/Moon separately from brightness and visibility. `water.wgsl` explicitly enlarges the Moon. Bioluminescence should be a spatial bloom/event state with disturbance response and decay, rather than a promise that every Cape night glows. Keep dark adaptation gradual and selective; uniformly lifting black forest floors would weaken believable night contrast.

**Feasible experiment:** compact seeded island descriptors with a small directional depth/coverage cache, and seeded bloom patches. Rebuild view-dependent caches only when a measured parallax/lighting error requires it; share island parameters across sky and reflection code. **Pass condition:** islands establish distance, celestial objects cannot shine through them, and reflections remain when their source is outside the view. **Fallback:** fewer and farther procedural islands plus correct occlusion.

### L. Ecology and sound with consequences

After foreground structure is convincing, add a wrack/kelp strandline deposited by high run-up, feeding/roosting opportunities and locally disturbed animals. Birds should choose perches, react at varied distances, turn and stagger flapping; a randomly jittered horizon row is still a row.

Use compact state machines and scheduled events. Simulate hidden distant birds at a low cadence; analytically continue flight and maintain sparse awareness near the cat. Rare insect/bird events and seasonal opportunities are preferable to uniformly filling the scene with motion.

Sound should consume the same events: a crest breaking nearby, water striking a particular rock, paw contact on wet sand versus rock, sheltered canopy rustle, and a shake. Distance, broad obstruction and source direction can supply a strong sense of space without acoustic ray tracing. Separate near surf events from far sea ambience so every visible wave does not trigger an unrelated repeating wash.

**Pass condition:** an interaction has synchronized visible and audible consequences, and wildlife looks situated when observed for a minute. **Fallback:** fewer agents, richer local behaviour and event-linked audio. Screenshots cannot verify this workstream.

## 5. Performance experiments that make the ambition feasible

### Cost ledger and honest budgets

The audit's “~2 ms per million triangles,” “−1.4 ms,” “45% fewer chunks” and “0.1 ms post pass” are not transferable budgets. A shader-heavy triangle, a tiny triangle, an alpha-covered pixel and a shadow caster have different costs. The scene uses separate APIs and adaptive resolution, so fewer triangles alone does not prove a faster or cheaper whole frame.

Track **CPU update/submission**, **GPU pass timings when available**, **active-frame p50/p95/p99**, **draws and submitted vertices**, **render pixels**, **raw and allocated memory**, **uploads**, **startup**, and **thermal behaviour on an actual phone**. Keep active 60 fps and settled 30 fps separate. The single rain capture exposed `frameMs = 33.5` and `meshMs = 5.03`; it was settled/adaptive, and is not a 60 fps benchmark or a device-tier comparison.

Use the chosen device tier's existing frame ceiling, with an explicit safety margin agreed from its measured baseline. Bank observed savings per scenario. Spend only the bank that survives worst-case forest, rain, surf and close-cat views. Candidate grid sizes and update rates in this document are prototype limits, not performance guarantees. Raw memory arithmetic excludes mipmaps, driver allocations, alignment and staging buffers.

| Experiment | Expected source of savings | Failure mode / decision gate |
|---|---|---|
| **Remove provably invisible ground indices** | Vertex and primitive work, potentially in several passes | Keep the swash/submerged transition, silhouettes and any needed seabed; test all camera heights, wave extrema and low angles. Use conservative coverage, not one still image's clipped percentage. |
| **Decouple environment invalidation from shadow anchors** | CPU work and PMREM update spikes | `updateLighting`'s environment key includes `previousLighting`, which includes camera anchors. Separate sky/weather/bounce dependencies from shadow-map location; verify no legitimate material/environment change is lost. |
| **Bake repeated procedural material evaluation into numerical caches** | Noise/hash/derivative ALU on near ground, rock or bark | Generate low-frequency fields/normal moments once per seed or material family. Retain analytical filtering and close detail. Reject visible tiling, colour-space drift and startup costs larger than the saving. |
| **Grow once, decorate by need** | Avoid regenerating detailed botanical graphs and invisible organs | Cache seed-consistent developmental skeletons and patch demand; stream near organs from stable IDs. Count worker time, peak memory, transfers and first-visible latency. Do not let quality alter the world/collision identity. |
| **Factor plant/ground/material data by shared cause** | Reuse occupancy, shelter, producer and substrate calculations | Generate regional fields together where scales/dependencies match; derive litter, shade and deposition from them. Separate incompatible resolutions and update lifetimes. Shared inputs can save work without forcing every consumer to sample one giant packed texture. |
| **Coverage/response-preserving vegetation LOD** | Fewer organs, vertex transforms and draw submissions | Measure gaps, sheen, transmission and shadow density together. An atlas that adds alpha overdraw can lose despite fewer triangles. |
| **Budget geometry by visible error and patch edges** | Move triangles from crown interiors/far organs into ground structure | Retain a coarse complete world for collision/reflection. Expand bounds for wind; account for camera movement and shadow/reflection visibility. Never cull a receiver's shadow caster solely because it is off screen. |
| **Independent colour and shadow representations** | Cheaper caster geometry and smaller targeted updates | Static low-frequency shadows plus a limited near dynamic correction; same wind phase and density. Count seams and update spikes. Add the dynamic path only where frozen shadows are visibly wrong. |
| **Derivative-bounded update scheduling** | Avoid recomputing slowly changing fields | Skip a field until predicted screen/light error exceeds a threshold; stagger rebuilds. On camera cuts, scrubs, resumed tabs and weather jumps, explicitly invalidate affected state. Do not call stale lighting a successful optimization. |
| **Hybrid analytic event state and sparse simulation** | Tiny state relative to a full island fluid/cloth/vegetation solver | Use timestamps for drying, bending and decay; simulate only transport that cannot be reconstructed. Fixed-step integration and bounded substeps prevent frame-rate-dependent behaviour. |
| **Tighter active wake bounds** | Avoid up to 28 trail and 16 ring evaluations across a large mostly empty region | After domain fixes, build age-dependent bounds for the actual live rings/trail segments. First compare cheap per-event rejection or a few groups against the current one-circle gate; account for slopes, filtering support and late foam. Only add tile lists if saved work beats list generation/upload and divergent branches. |
| **Carry unresolved variance into shading** | Avoid evaluating invisible high-frequency waves/grains/fur | Approximate the integrated response using slope/normal moments and coverage. Do not double-count explicit and unresolved normal energy at the transition. Match brightness and highlight width while moving the camera. |
| **Prepare predictable near detail off the main thread** | Smooth generation/upload spikes | Queue likely next patches from camera/cat movement, cap work and cache by seed/descriptor. Track memory and initial load. Do not create a large cache for every possible weather or view. |

### Share descriptions across APIs; do not assume shared GPU textures

The existing land field already serves reflections and skipping; visibility, shelter and habitat could derive from the same world description. Reuse its generation inputs and acceleration structures first. Do not pack incompatible height, lighting and dynamic state into one texture just because it already exists.

For small dynamic fields, compare CPU generation/upload to both APIs against duplicated local GPU evaluation. CPU upload can be practical for tiny grids and events; full-resolution colour/depth exchange is a different bandwidth problem. Document the producer, consumers, format, update trigger, upload volume and lifetime of each field. Avoid synchronous GPU-to-CPU-to-GPU round trips.

A useful extension of the top-height field is a limited vertical density representation around trees, plus solid rock/trunk primitives. It can support porous reflection, local sky visibility and shelter without treating the crown as a solid wall. This adds generation, storage and traversal; prototype one grove before committing to a whole-island volume.

### Quality should preserve the visible cause

Degrade independent costs in the order that least damages perception: unresolved organs/noise first, then secondary agents and distant history cadence, while retaining the near foam front, planted paws and visible silhouette. Restrict adaptive decisions to a few stable quality tiers with hysteresis. Allocate by projected error and interaction relevance; no eye tracking is required.

A low tier should still have a wet beach after a surge, sheltered rain and a cat grounded in the scene. It may have fewer bubble samples, coarser field interpolation and fewer distant agents. Validate each tier as a coherent image, not only as a throughput number.

### Three combined experiments with unusually high potential

These are project-specific designs to prototype after the simple corrections. They combine workstreams so a richer scene can reduce duplicated work; none has a demonstrated saving yet.

1. **Compile a plant's developmental graph into its render hierarchy.** Keep one seed-consistent skeleton with leaf-demand, age, stiffness and stable organ IDs. Bottom-up summaries hold directional coverage, normal moments, transmissive fraction and bend response. Nearby nodes expand to organs; far nodes render their aggregate response. Litter producers, collision branches and reflection/visibility proxies derive from that same graph. This makes growth richness available without retaining every leaf mesh, and makes LOD errors measurable. First prove one shrub's noon/overcast/backlit appearance and moving silhouette; reject a representation whose transparency cost exceeds the current folded clusters.
2. **Compile local environment causes into receiver coefficients.** From the same regional geometry queries, prepare solid/porous visibility, coarse shelter and low-frequency transfer for static receivers. Small changing sky/weather coefficients update the lighting; individual plants sample shelter at instance/height level. Reuse traversal work without forcing reflection, rain and light into one inadequate ground-height value. Measure whether instance/vertex evaluation plus interpolation replaces repeated pixel work profitably. Keep sharp sun shadows, close reflection and discontinuous contact as separate higher-frequency cases.
3. **Reserve detail for observable boundaries and consequences.** Give root collars, ground-cover edges, foam fronts, planted paws and nearby wet/dry margins a small explicit budget before allocating invisible crown interiors or subpixel noise. Derive priority from projected extent, silhouette/contact contribution and recent interaction; stabilize it with spatial overlap, hysteresis and bounded changes per frame. It is a deterministic allocation scheme, not gaze tracking. Test a continuous pan through a grove and a run into the sea: no detail may visibly appear just because it has gained priority. Measure total vertices, overdraw and upload tails as well as image quality.

Together, these shift cost from repeated generic detail toward a stable representation of the scene's causes. Start with one plant, one grove and one shoreline segment; do not build an all-purpose world compiler before demonstrating those wins.

## 6. Implementation sequence and acceptance gates

| Stage | Deliverable | Gate before continuing |
|---|---|---|
| **0 — establish a trustworthy baseline** | Repair splash/swash numerical domains and obstructed fixtures; pin seed/date/time/weather/camera; expose budget tier and render sizes; add colour/light contribution diagnostics; capture continuous low beach/forest/cat routes | Shader/data/build checks pass; the running route has no numerical corruption; both device tiers have a reproducible performance record and no startup placeholder is mistaken for the final image. |
| **1 — spend the existing geometry and shading better** | Shared material palette and colour/light calibration; one grown habitat patch with low relief/litter; foam hierarchy; corrected cat eyes/flow/contact; AO-path cleanup and environment invalidation fix | Separate comparisons prefer calibrated land, growth/ground structure, surf and cat across noon/overcast/evening, with measured savings or unchanged whole-frame cost. Test one workstream at a time before combining. |
| **2 — add shared persistent causes** | Wetness/film history, local directional visibility and bounce, coherent wind responses, near precipitation | The same event agrees across mesh, water, cat and sound; state does not reset/pop on quality changes, pause/resume or a camera transition. Each state field has a proven fallback. |
| **3 — deepen atmosphere and place** | Cloud transmission across sea/land, procedural archipelago with reflection/occlusion, geological cluster structure, restrained night/bloom state | No off-screen reflection gaps, cloud-shadow mismatch or new hidden copies; capture and time worst-case weather/low sun. |
| **4 — richness where people notice it** | Strandline/deposition, wildlife opportunity/alert behaviour, event-linked audio, additional anatomical/seasonal polish | One-minute observation and interaction sequences remain convincing; low tier maintains the core causes and performance ceiling. |

Do not wait for a large combined pass to discover which change helped. Stage 1 starts with **colour/light calibration** and a **grown inland patch with ground relief**, followed by independently switchable **foam structure** and **cat eye/coat response**. Within the land patch, compare colour/light alone, geometry alone and both together; this separates repainted emptiness from expensive detail hidden by bad lighting. Compare at a fixed camera before undertaking deeper simulation.

### Validation that can falsify this plan

- **Appearance:** neutral material spheres/planes and a foliage/rock/cat close fixture under identical sun/exposure; noon, low sun, overcast, rain, moonlit and moonless night. Disable albedo variation and direct light separately to diagnose transport. Use plausible references with matching lighting and lens, not unmatched photo contrast as a target.
- **Motion:** continuous pans across LOD thresholds; a gust crossing ground, shrubs and trees; a complete breaker/run-up/retreat cycle; wet-to-dry rock and fur; stance, acceleration, turn, jump/landing and swim entry/exit. Look for popping, boiling, sliding and mismatched clocks.
- **Agreement:** sample terrain, bathymetry, wave heights, shore normal, waterline and rock shapes across CPU/GLSL/WGSL twins with documented tolerances. Test the shore seam and any representation changes. Centralize generation/shared parameters where possible instead of relying only on “keep in step” comments.
- **Growth/ground invariance:** vary colonization step size, organ detail and quality without changing major branch thickness, patch identity or litter sources. Check isolated versus crowded plants, exposed versus sheltered patches, and a low sideways camera path. Inspect cache borders, cell lattices, root/rock embedding and paw contact.
- **History/lifecycle:** resize, time scrub, weather change, home, reduced motion, background/resume, seed reload and GPU loss. Define which state persists; avoid unintended time integration while suspended.
- **Performance:** compare the current worktree before/after as the primary baseline, then master separately. Warm shaders/assets; fix quality and active/idle state; alternate A/B runs in one consistent visible foreground workflow. Background tabs may suspend this app, so simultaneous “two-tab A/B” is not sufficient. Use async GPU timer queries where supported, discard disjoint results and retain non-blocking frame/CPU observations as fallback. The existing readback-synced six-render burst is an intrusive mesh microbenchmark; it does not include normal updates, the other renderer or browser composition.
- **Sustained devices:** genuine phone/light-tier hardware and a desktop, same routes and difficult weather. Report median/tail times, pixels, quality transitions, memory and thermal decay together. No desktop-to-phone inference from viewport size alone.
- **Rejection rules:** discard a technique that only wins one curated view, trades saved vertices for excessive overdraw, produces obvious state discontinuities, or needs hidden per-frame cross-API readback. Keep the simplest candidate that delivers the visible improvement within the measured ceiling.

The ambitious target is a coast whose forms, light, motion and history explain each other. The practical strategy is to concentrate geometry on visible structure, represent unresolved detail statistically, and simulate only the few state changes that viewers can actually follow.

---

<details>
<summary>Original audit — retained for traceability; recommendations and estimates below are superseded where challenged above</summary>

## Original: Skycope realism pass, findings and plan

Branch `realism-100x` (worktree `.claude/worktrees/realism-100x`), 2026-09-30.

## How this was produced

- **Captures:** 42 headless-Chrome frames at 1440×900 on the desktop budget, made with `scripts/tour.mjs`. They cover:
  - beach, forest, hill, rocks, cat close-ups, wading, swimming, running and splashing;
  - noon, golden hour, dusk, dawn and night;
  - clear, cloudy, overcast, rain and storm.
- **Audits:** Five Opus 5.5 auditors each owned one domain (ocean, lighting, vegetation, cat, rocks and composition); all five reported. They compared the frames to real Cape coast photos, traced each flaw to a file and line, and ranked the fixes by impact per unit of effort, under a constant-frame-cost rule.
- **Tools:** The auditors' probe scripts and extra shots are in the session scratchpad (`veg/probe.mjs` triangle counter, `light/*.mjs` light-model numerics).

## Diagnosis: why it looks flat

1. **Skylight arrives from every direction, unoccluded.**
   - The sky band below 11° is 5–6× brighter than the zenith and nothing ever hides it. A vertical face in shade therefore gets 0.80× the light of level ground, where a real one gets about 0.5×. Forms don't turn.
   - Three occlusion terms look active but do nothing: rocks never get a `shade` value, crown `bendNormal` is normalised so crown AO is always 1, and tufts are too small for the 0.5 m occlusion grid.
2. **Shade is teal.**
   - The model is Rayleigh-only, with aerosol about 20× below Cape marine levels. Skylight ends up about 4.7× bluer than the sun, against about 1.4× in real shade.
   - Shaded sand goes teal-grey and shaded leaves go slate.
3. **The ground is painted dirt.**
   - Real Cape dune slopes are about 90% covered by grey-green strandveld and fynbos.
   - Here the hill is flat tan-brown with lone tufts, and bright orange leaf decals sit under the trees.
4. **Nothing gives the scene scale.**
   - The horizon is a ruler-straight line with no land on it: the island floats in an infinite game ocean.
   - The 58° vertical FOV (a 21 mm lens) shrinks the island and the boulders further.
5. **Materials read as toys.**
   - The cat is a smooth vinyl figurine. It has effectively no fur volume at play distance, amber-and-black tiger stripes, and bug eyes.
   - Rocks are eggs and bowling balls: smooth ellipsoids perched on the sand, a glossy black wet sheet, and 230 clones of one shape.
   - Bark carries white rings and chevrons from a planar world-space projection.
6. **The sea is milky and the surf is polka-dotted.**
   - Deep water reflects ~14% (real: 2–4%) and 65% sky haze is blended in at the horizon, so the open sea is pale teal-grey and melts into the sky.
   - Swash foam is opaque white slabs punched with round holes, not a translucent web. Wet sand doesn't mirror the sky, and the swash edge stair-steps.
   - A NaN in the splash rings blanks the near sea whenever the cat runs in.
7. **Dead air.**
   - A 5 m crown sways about 3 cm in a 3.5 m/s breeze, where real trees move 10–30 cm.
   - Clouds are lit almost entirely by the sky (sun term ×0.075), so they're grey smudges with no bright tops.
   - Cormorants fly in an evenly spaced row pinned to the horizon.
8. **The "lens" covers half the image.**
   - Rain, vignette and grain live in the WebGPU canvas, under the WebGL land layer.
   - So rain falls behind the trees and stops at the sand, and the land is never vignetted.
9. **The camera clips.**
   - The follow camera had no collision, so it swung through trunks, canopy and boulders.
   - Leaves near the lens slice through the 5 cm near plane.

## Bug to fix first: splash rings blank the near sea

In 26-run-into-sea and 27-splash-sea, every pixel inside the cat's wake circle (up to ~10 m) goes flat slate-blue with hard white blotches. `cat_sea` returns non-finite height/slope from the splash-ring loop (`wake.wgsl:136-150`): `pow()` of a negative base, unclamped age. Fix: clamp age and strength, replace `pow(x, 2.0)` with `x*x`, and drop the cat's contribution when it's non-finite (bitcast test in `ocean.wgsl` after `cat_sea`). The same undefined-`pow` pattern sits in the swash reach (`surf.js:39`, `ocean.wgsl:890`) and gets the same fix. Cost: none.

## The 10 changes

Ordered by impact per effort. The owner's direction: a **procedural world**, no real-world landmarks.

| # | Change | Where | Frame cost |
|---|---|---|---|
| 1 | **A procedural archipelago on the horizon.** 3–5 seeded islands, 0.8–6 km out, each with its own silhouette and biome: dark forested dome, grey-green fynbos ridge, bare granite knuckles, pale dune spit. Aerial perspective fades them to blue-grey with distance; they hide the sun disc, catch golden-hour light on their sunward flanks, and the sea reflects them for free. Replaces the empty ruler-line horizon, the biggest scale cue we're missing. | `sky.wgsl` resolve (+ a small seeded island table as a uniform) | ~0: horizon pixels only, early-out above ~3° |
| 2 | **Skylight that occludes.** (a) A statistical local horizon in the env map: vertical/level 0.80 → 0.64. (b) Land skylight desaturated 50%: blue shade, not teal. (c) Re-enable rock AO (neighbours + foot contact) and crown AO (un-normalise `bend`). | `landscape.js` `buildEnvironment`/`updateLighting`, `forest.js` rocks, `vegetation.js:916` | 0 (rebuilt on a light change) |
| 3 | **Ground and bark materials.** Procedural strandveld/fynbos scrub and sour-fig mats painted into the dune and hill ground, darker litter and humus, muted leaf decals. Bark mapped in trunk space (no white rings or chevrons), darker, with lichen as patches. | `forest.js` `addGround` (new mask attribute), `GROUND_COLOUR_GLSL`, bark shader; `vegetation.js:326` | 0 triangles, ~20 ALU per ground pixel |
| 4 | **The sea's body.** Deep blue-teal open water (Gordon-form inscatter, ~3% reflectance instead of ~14%). A crisp horizon (haze 0.00022 → 0.00008). Clearer shallows (less residue milk). Soft sky gradients in near ripples, not white strokes (wider reflection blur, calmer capillaries). | `ocean.wgsl:319, 417, 734, 327, ~222` | 0 |
| 5 | **Foam as lace, wet sand as a mirror.** Swash and residue foam drawn as translucent Voronoi walls (a web of filaments), not white slabs with polka-dot holes. The pinhole web goes; one crisp bore line stays. Swash edges filtered by `fwidth`, so no stair-steps. Drained sand darker and glassier, so it mirrors the sky. | `surf.js:35-127`, `ocean.wgsl:816-890, 391`, `forest.js:682-690, 1270` | Neutral to a saving (pinhole web removed, bubbles 3 → 2 layers) |
| 6 | **Rocks as granite corestones.** Jointed faces, clefts, waterline notch, 5 variants, sunk into the sand, and stacked in clusters. The wet sheet drains in streaks instead of turning the rock into a black bowling ball. Softer grain, lobed lichen. | `rocks.js`, `forest.js` rock material | Same triangles, +2 draws |
| 7 | **A cat that reads as a real tabby.** Fur loft baked into the SDF, plus a velvet rim lobe. A grey-brown ticked coat with a darker saddle and feathered stripes. Almond, brow-shaded hazel eyes. Wet fur darkens instead of wearing grey socks, and submerged legs fade. A thicker, hooked tail and fuller haunches. | `cat-body.js`, `cat-coat.js`, `cat.js` | ~0 (baked or per pixel; +1 far-shell pass) |
| 8 | **Lens.** A 32 mm focal length (41° vertical, follow distance ~5 m), so the background looms instead of receding. One last full-screen pass on the WebGL canvas: vignette and grain over *everything*, rain falling in front of the trees and onto the sand, and veiling glare round the sun. | Focal constant in 8 sites (`landscape.js`, `view.wgsl`, `ocean.wgsl`, `water.wgsl`); new post quad | **Saves**: ~45% fewer chunks in frustum; post pass ~0.1 ms |
| 9 | **Air that moves.** Sunlit clouds: sun term ×4, less sky fill, stronger self-shadow, bright tops over grey bases, overcast horizon strip closed. Wind with weight: tree sway ×2.5 driven by gusts, and a leaf-flip shimmer of pale undersides in travelling gust bands. | `clouds.wgsl:96-97`, `forest.js:283`, `FOLIAGE_GLSL` | 0 |
| 10 | **A camera that respects the world.** Spring-arm collision against trunks, rocks and terrain (**done**). Leaves and grass within ~1 m of the lens fold away in the vertex shader. | `walker.js` (done), `forest.js` push hook | ~0, no `discard` |

## Keeping performance constant

The mesh layer is triangle-bound, at about 2 ms per million triangles. Forest views draw 3.7–4.1 M. Savings to bank before anything adds cost:

- **Trim the ground index buffer.** 63% of its 289k triangles lie under the sea and are clipped. Dropping them saves about 180k triangles in *every* view.
- **Reduce the near shoot** from 84 to 60 triangles (`shootGeometry(10,1)`). Saves about 380k in forest and hill views.
- **Add a bark mid-LOD** that drops twigs under 1.2 cm inside crowns. Saves an estimated 100–200k.
- **Narrow the FOV** (item 8), which draws fewer chunks.
- **Turn off `castShadow` on fauna.** The shadow map never auto-updates, so those shadows are stale anyway.

Net: roughly −700k triangles, about −1.4 ms, before any additions. Every change gets a two-tab interleaved A/B, following the visual-QA notes.

## Deferred (worth doing, higher cost or risk)

- **Thicket densification.** Lower crowns and about 600 skirt shrubs round the trunks, for about +420k triangles. The savings above would pay for it.
- **Baked top-down height-map sky visibility.** 18 taps per pixel on ground, rock and bark, giving true contact AO under everything. About 150 lines of work, with a halo risk.
- **Tighter wake bounds** in `wake.js` `pack()`: the 28-segment trail loop runs over the whole bound circle per sea pixel, a real saving in swim views.
- **A strandline.** A wrack band, kelp stipes, driftwood, standing gulls or oystercatchers that flee the cat, and ragged distant cormorant skeins.
- **Tail and gait polish** beyond the carriage fix.

## How the changes will be checked

- **Screenshots:** Re-run `scripts/tour.mjs` after each group of changes and compare side by side with `tour0/`.
- **Performance:** Measure frame time with two-tab A/Bs against master on the desktop budget and the phone (`LIGHT`) budget.

</details>
