# Sky Cope

A small, live Cape Town sky. Vite and vanilla JavaScript, with [Vercel's vgpu](https://vgpu.sh) for sky/water
and Three.js for procedural terrain and vegetation. No application framework or
server. No generated images, photographs, or downloaded environment models.

## Run and verify

```sh
npm install
npm run dev
npm test
```

`npm test` checks the astronomy/weather data boundary, validates WGSL on a real
WebGPU adapter, and builds production assets. Shader validation needs GPU access;
it fails explicitly when an adapter is unavailable.

Optional offline visual and performance checks:

```sh
npm run render:sky -- /tmp/skycope-qa
```

In the browser, `?weather=clear|cloudy|overcast|rain|storm` opens on that weather
preset (the same as choosing it in the weather panel); `?perf` records
mesh-layer timing on the landscape canvas (`data-mesh-gpu-ms` and its p95 from
asynchronous timer queries, `data-mesh-submit-ms` where the extension is
missing), with triangles and draw calls, and exposes the live state as
`window.skycope` (for example to aim `flight` at the sun). With `?perf`,
`&review=home-noon|inland-noon|forest-overcast|cat-close|cat-evening|rain-home|sea-noon|splash-run`
pins the date, time, place and camera for before/after captures
(`src/review-fixtures.js`).

`node scripts/tour.mjs <outDir> [port]` drives headless Chrome through 38 views
of a running dev server (place, camera, time, weather, motion) and saves a
screenshot of each.

`node scripts/perf.mjs <mode> --port <dev server> --cdp <port> --out <dir>` is the
performance protocol (modes and options at the top of the script): `bench`
(six views, noon and night, gifts asleep and awake: frame p50/p95, a paused-rAF
whole-frame bench, triangles, draw calls, shadow-refresh counts, bytes allocated
per frame, the render size the budget settles on), `ab --base <ref> [--head <ref>]`
(two snapshots in two tabs, interleaved; whole-frame and CPU ratios), `shots` and
`diff` (deterministic stills and per-view pixel differences, for before/after
pairs), `lifetime --minutes 15` (a fresh browser plays the quest round and round;
GC'd heap, GL/WebGPU objects and listeners each minute) and `probe --script`.
Add `--headed` for the idle-machine protocol; under contention trust counts and
same-tab ratios only.

`ONLY=surf,rocks` renders just those fixtures; `BENCH=1` adds per-pass throughput,
and `BASE_WATER=<other checkout>/src/shaders/water.wgsl` benches that water shader
against this one, interleaved in the same process (robust to a busy GPU).

This renders clear, cloudy, rainy, dusk, night, Milky Way, Southern Cross, crescent, full-moon, moonrise and sun-glint sky/water PNGs and reports combined GPU pass timing.
It requires a GPU with `timestamp-query`. Fixtures include the real star
catalog; the constellation figures are left black, so verify those and the
WebGL forest in the browser. The GPU timings cover
the two WebGPU passes at 700 × 490 clouds and 1000 × 700 water, not the WebGL forest or whole application. Fixtures never replace the website's live
weather. Also check the time slider and Live reset at desktop/mobile sizes, OS
reduced-motion mode, background/resume, and with the weather endpoint blocked.

## Where things live

| File                     | Responsibility                                                           |
| ------------------------ | ------------------------------------------------------------------------ |
| `index.html`             | Minimal page, time preview, styles, static non-WebGPU fallback           |
| `src/main.js`            | Controls, resource lifetime, clocks, uniforms; applies the render budget |
| `src/quality.js`         | The render budget: every layer's render size, and what to shed under load |
| `src/astronomy.js`       | Cape Town dates, sun/moon positions, sidereal rotation                   |
| `src/weather.js`         | Open-Meteo request and validation; no rendering code                     |
| `src/weather-panel.js`   | Weather panel: live, presets, and cloud/wind/rain sliders                |
| `src/loading-screen.js`  | The pixel-sky loading veil the world sharpens in from                    |
| `src/swell.js`           | The breaking swell train shared by sea, swash and rock surf              |
| `src/wave-modes.js`      | The wind sea's 128 modes per frame, for `waves.wgsl`                     |
| `src/sea-surface.js`     | CPU twin of the sea where the cat is: level, flow, swash                 |
| `src/wake.js`            | The cat's wake, paw collars and splash rings, packed for `wake.wgsl`     |
| `src/shore-textures.js`  | Boulder and land-field textures for the water pass                       |
| `src/archipelago.js`     | Distant islands: layout, mesh, baked skylines and sun cover for the sea  |
| `src/shaders/waves.wgsl` | Wind-sea cascades (four 128² tiles); `spectrum.wgsl` is their shared maths |
| `src/shaders/foam.wgsl`  | Whitecap foam history over the largest wave tile                         |
| `src/shaders/wake.wgsl`  | The cat in the sea: collar, trail, ripples, splashes                     |
| `src/shaders/archipelago.wgsl` | Distant islands' reflections from their baked skylines             |
| `src/surf.js`            | Swash foam, bubbles and glow on the sand; spray off the boulders         |
| `src/land-field.js`      | The island as the sea reflects it: height, albedo, distance to land      |
| `src/rocks.js`           | Rock layout and corestone shapes; the waterline boulders for the sea     |
| `src/shaders/rocks.wgsl` | Lapping rings, collar foam, rock reflections/shadows, hidden-sea skip    |
| `src/shaders/atmosphere.wgsl` | Rayleigh/Mie/ozone scattering, transmittance                       |
| `src/shaders/tone.wgsl`  | The one tonemap and grade, for sea, sky and (as GLSL) the land          |
| `src/tone-glsl.js`       | Translates tone.wgsl's shared block to the land layer's GLSL            |
| `src/sunlight.js`        | CPU twin of the scattering model: exposure, sun and sky light per frame  |
| `src/shaders/sky-table.wgsl` | Per-frame sky-view table of the scattering integral (sun and moon)   |
| `src/shaders/clouds.wgsl` | Quarter-resolution, jittered cloud march                                |
| `src/shaders/sky.wgsl`   | Sky resolve: temporal cloud reconstruction, background, Milky Way       |
| `src/shaders/skyview.wgsl` | Shared table mapping, overcast grading, moonlight, volume noise       |
| `src/shaders/night.wgsl` | Stars, Milky Way, Moon                                                   |
| `src/shaders/view.wgsl`  | Shared camera projection and uniform layout                              |
| `src/shaders/water.wgsl` | Sharp water composite, sun disc, rain, tonemap and final colour          |
| `src/shaders/ocean.wgsl` | Swells, ripples, reflection, seabed, caustics, kelp, glitter, foam       |
| `src/landscape.js`       | Three.js camera, lights from `sunlight.js`, shadows, lifecycle           |
| `src/lens.js`            | Rain on the lens and veiling glare, one full-screen pass over both layers |
| `src/precipitation.js`   | Rain streaks and impacts, canopy shelter, surface wetness history        |
| `src/cloud-transmission.js` | CPU ray through the visible cloud: the sun's direct beam              |
| `src/mesh-profiler.js`   | Mesh-layer GPU timer queries (for the budget; `?perf` QA attributes)     |
| `src/review-fixtures.js` | `?perf&review=` permalinks for before/after captures                     |
| `src/vegetation.js`      | Growth traits, habitat placement, trees, ferns, grass and fynbos         |
| `src/habitat.js`         | Regional habitat descriptors, crown competition, ground producers        |
| `src/plant-growth.js`    | Foliage demand and pipe-model branch radii                               |
| `src/ground-detail.js`   | Fallen leaves, twigs, roots and pebbles; painted scrub and sour-fig cover |
| `src/material-palette.js` | Authored material colours shared by the mesh and the reflection field   |
| `src/forest.js`          | Instanced plants, wind and gusts, foliage/ground/bark shaders, LOD       |
| `src/instance-lod.js`    | Vegetation level of detail per instance, with the cross-fade (no three)  |
| `src/plant-forms.js`     | Unit plant organs: tufts, reeds, fronds, aloe leaves, heath shoots, heads |
| `src/near-ground.js`     | Sward, sprigs, sour-fig fingers and fallen leaves round the cat (≤ 9 m)  |
| `src/motes.js`           | Pollen and dust that catch the sun when you look toward it               |
| `src/fauna.js`           | Gulls, cormorants and a dolphin pod                                      |
| `src/walker.js`          | Cat movement, collisions, follow camera                                  |
| `src/cat.js`             | Cat animation: gait/IK, spine, postures, tail, ears, eyes, whiskers, LOD  |
| `src/cat-rig.js`         | Skeleton (43 bones), bind pose, three-bone leg IK                        |
| `src/cat-body.js`        | Anatomical SDF meshed with surface nets, skin weights, baked AO, 2 LODs  |
| `src/cat-coat.js`        | Tabby pattern, fur lighting, eyes, instanced fur shells, coat bake       |
| `src/cat-ground.js`      | Cat shadow on terrain, relief paw prints (and their glow), kicked sand   |
| `src/cat-worker.js`      | Builds the cat mesh off the main thread                                  |
| `src/critters.js`        | Butterflies, fireflies and ghost crabs                                   |
| `src/sound.js`           | Synthesized ambience and cat sounds (WebAudio)                           |
| `src/random.js`          | Reload seed, reproducible random streams                                 |
| `src/terrain.js`         | Terrain and shoreline functions                                          |
| `src/cloud-noise.js`     | Deterministic 64³ cloud noise texture, generated once                    |
| `src/stars.js`           | One-time star/constellation atlas from the compact catalog               |
| `src/star-catalog.js`    | Packs the catalog into the grid the composite pass reads (no DOM)        |
| `src/data/`              | Catalog and source/epoch documentation                                   |

## Time, weather, and astronomy

The observer is fixed at **33.9249° S, 18.4241° E**. All displayed dates and times
use `Africa/Johannesburg` (SAST, UTC+2), regardless of the visitor's timezone.
Live mode follows the clock. The slider previews a minute on today's Cape Town
date; **weather remains current**. Live restores the actual time. Removing the
preview later only requires removing its markup and the corresponding control
listeners/state in `main.js`.

Weather comes directly from [Open-Meteo](https://open-meteo.com/en/docs), refreshed
every ten minutes with a twelve-second request timeout. These are the provider's
current **weather-model estimates**, not a live webcam or exact cloud geometry.
Low/mid/high cloud cover drives three separate cloud decks, wind drives drift,
and precipitation drives rain. In a clear forecast the sky is clear. A failed
refresh retains data for at most 90 minutes and labels it delayed; unavailable or
stale data gets an explicit unavailable label and a neutral clear rendering.
No API key or visitor geolocation is used.

The weather label opens a panel: **live** follows the forecast; **clear, cloudy,
overcast, rain, storm** are presets; the cloud, wind speed, wind direction and rain
sliders set any sky by hand. Chosen weather is labelled "· set". Live data keeps
refreshing underneath, and choosing live returns to it. Weather also shapes the
light model: cloud cover turns the blue skylight into grey diffuse light and rain
dims it, for clouds, sea and land alike (`lightingAt(celestial, weather)`).

[SunCalc 2](https://github.com/mourner/suncalc) calculates the apparent sun and moon
positions and lunar illumination. **Version 2 returns degrees, with azimuth
clockwise from north**; do not substitute the old radians/south-based convention.
The shader uses east / up / north coordinates and radians. Palette transitions
follow solar altitude, including twilight, rather than fixed clock cutoffs.

The visitor is a brown tabby cat on the beach below the original view
(`src/walker.js`, `src/cat.js`). WASD/arrows walk relative to the camera,
shift runs, space jumps (onto boulders), M meows; click or tap the ground to
walk there, tap the cat to hear it, drag to orbit, scroll or pinch to zoom, H
returns home. A follow camera sits ~3 m behind and above the cat, clear of the
ground and the sea. Both the WGSL passes and the Three.js camera read that
camera (`walker.camera`: coast metres, azimuth, pitch); keep them aligned. The
cat walks on the ground mesh's exact surface (`groundHeight`) and on each
boulder's rasterized top, is blocked by trunks and steep rock, and stops at the
swash. The cat is one seamless skinned body meshed from an anatomical signed
distance field (skull, cheeks, ribcage, haunches, shoulder blades, toes), drawn
1.4× domestic size to hold its own among the plants. Its gait blends walk →
trot → gallop with a flexing, bending spine and rolling shoulder blades; paws
plant flat on the ground (slopes and rock too), and at a walk the hind paws
land in the front prints. It sits on its haunches, lies in a loaf and yawns
when sleepy, stalks with a rump wiggle and twitching tail tip when something
small moves, and dips as it lands. It casts a real shadow (its own small sun
shadow map, soft with distance from the paws) and shadows itself; low plants
part round it. Paw prints are relief-lit pits (crisp in wet sand, crumbling in
dry, wet stamps on rock after the swash) that fade (fast in the swash); running
kicks up sand. Rain soaks and darkens the coat. Butterflies,
fireflies and ghost crabs (`src/critters.js`) flee it. All sound is
synthesized in `src/sound.js` and starts on the first gesture. Sun, moon and constellations occupy their true directions;
they are not moved into frame when actually elsewhere. The sun disc is
slightly enlarged and the moon about four times, so its face reads. The sun uses a pixel-width antialiased
edge and clips each fragment below the sea horizon. Island, forest and cloud
geometry are illustrative, while celestial positions and weather inputs are data based.

The night sky has 2,851 catalog stars through magnitude 5.5 and all 88 Western
constellation figures, rotated into Cape Town's sky by latitude and local
sidereal time. Stars are drawn in the sharp final pass as point sources at
their exact catalog positions (`src/star-catalog.js` packs them into a grid of
0.35° cells): about a pixel wide, with flux from magnitude, colour from B−V,
extinction and twinkle growing toward the horizon, and faint stars fading out
against a moonlit or twilight sky. The Milky Way (`src/shaders/night.wgsl`) is
placed by the J2000→galactic rotation: a bright Sagittarius bulge, clumpy star
clouds, the Great Rift and Coalsack, both Magellanic Clouds, and a fainter
star dust concentrated along the band. The Moon is lit by the true sun
direction (exact phase and lit limb), oriented with lunar north toward the
ecliptic pole, and carries the real near-side maria and rayed craters, flat
Lommel–Seeliger shading, earthshine and daytime visibility. Moonlight is far
too dim for colour vision, so it lights sky, clouds, sea and land as a cool,
colourless luminance: a low moon never paints a sunrise, though its disc still
rises reddened. Coordinates are J2000; stellar precession/proper motion,
refraction, lunar libration and local light pollution are omitted. See
[data notes](src/data/README.md).

## Procedural variation and water

Each page load chooses a fresh random seed for trees, shrubs, rocks, cloud noise,
and wave phases. Time, celestial positions and weather are independent of that seed.
The land is an island: a closed shore curve whose radius varies around a fixed
centre (`terrain.js`), surrounded by boundless ocean. The island stays fixed so
the water and beach agree. For reproducible visual QA,
open `/?seed=1847`; use a positive 32-bit integer. The current seed is also exposed
on the sky canvas as `data-seed`. No seed controls or extra text appear in the UI.

Water uses separate scales of detail. Six broad swells use shore-relative
(radial/tangential) coordinates: crests shorten and turn toward the beach all
around the island, with a smaller phase-matched returning wave fading offshore.
Only the first three broad swells displace ray intersections,
with displacement fading toward grazing angles. Fine detail uses four rotated,
advected procedural noise gradients. This avoids tracing tiny waves with unstable
intersection steps and avoids repeating high-frequency sine interference patterns.
Both ripples and swells are filtered by their projected pixel footprint; unresolved
slope energy broadens the reflection. The animation clock is intentionally slowed.

Offshore, wind-aligned plane waves take over from the shore-relative swell so the
open sea never forms rings around the island. Below the surface, rays refract
(n = 1.33) onto a sloping seabed: rippled sand, granite reef, seagrass, drifting
kelp-canopy shadows and a circling fish school, lit by sharp caustics that blur with
depth. Coastal-Atlantic absorption (red first) and single scattering produce the
turquoise shallows and ink-blue deep water from physics rather than a palette.
Ecklonia kelp beds float at the surface a little offshore. Foam breaks in sets with
lacy residue and a thin swash line; whitecaps appear above ~5 m/s wind. Foam decays
as froth does: holes open round random seeds and merge into torn lace (the sea's
`foam_cover` and the beach's `swashFoam` are twins). Swash bubbles are heavy-tailed
in size, off any lattice, and gather in clumps. Close to the eye, capillary ripples
(the finest cascade, shrunk and turned) break up the surface; where a reflection
leaves the screen it comes from the sky-view table rather than a flat colour.

The sea knows the boulders at the waterline (`src/rocks.js` slices each one's true
waterline from its mesh and packs its transform into a small texture, with a 2 m
lookup grid). Each rock sends lapping rings out on every surge (the swash clock, so
rock, beach and sea flood together) and reflects the chop; its lee is calm, foam
clings to its contact line, it is mirrored in the water, shades it, and shows
through it where it is submerged. Sea behind a boulder is not shaded at all.

At night the water is bioluminescent, as Cape waters are when dinoflagellates
bloom: breaking rollers, the uprush on the sand, the surge round each rock and
breaking whitecaps glow blue, single cells spark in fresh-stirred water, blooms
drift in patches, and the cat's fresh paw prints in wet sand flash and ebb. At
golden hour, steep crest faces glow green-gold with the light through them.

The sun path is a GGX microfacet lobe whose roughness is the real sub-pixel slope
variance, plus a rough tail and squared patchiness so bright sparkle fields are
split by dark troughs. On top of that, **glints**: each footprint-sized world cell
draws a random facet from the unresolved slope distribution, and facets that
mirror the sun disc flash far past white and twinkle as they re-roll. They fade
out where many glints would share one pixel.

## Light and colour

The sky is a physically based single-scattering atmosphere (Rayleigh, Mie and
ozone over a spherical Earth) with a multiple-scattering term modelled as light
from a slightly higher sun, which keeps the twilight Earth shadow and Belt of Venus
lit. The sea-salt aerosol scatters slightly more blue than red (Ångström
exponent ~0.7), so the horizon haze is white-blue, not cream. `src/sunlight.js`
evaluates the same model on the CPU once per frame to get exposure, the direct
sun (or moon) colour and zenith skylight. They go to both WebGPU passes as
uniforms and drive the Three.js directional light, so land, sea, clouds and sky
share one sun. Exposure adapts like an eye: the zenith stays steady through
golden hour, and it also partly meters the land (up to 1.5× as a low sun
stops lighting the ground), then genuinely darkens through civil twilight,
with limited dark adaptation at night. After the neutral tonemap, both layers
apply the same gentle vibrance (`VIBRANCE`), a camera's picture profile that
lifts muted colours. **Keep `atmosphere.wgsl` and `sunlight.js` in step.**

The land's skylight is image based. When the sun moves, `skyDomeRatio` samples
the scattering model over the whole dome (sun side warm and bright, anti-sun
deep blue); `landscape.js` puts it over the ground's bounce light in a 64 × 32
map, prefiltered by PMREM for ground, rocks and the cat (directional skylight
and rough sky reflections: the wet swash mirrors the sky), and projected to
nine spherical-harmonic coefficients for the heavily overdrawn foliage and bark
(`SKY_SH_GLSL`, a few multiply-adds instead of cube-map reads). Cloud cover
blends it toward the CIE overcast dome. Sky occlusion is baked, not guessed:
each shoot knows how deep in its crown it sits and every plant part and the
ground know the canopy above them (`canopyShade`). It dims skylight and sky
reflections, not albedo, and beyond the 64 m sun shadow map it stands in for
the canopy's shadow, so distant woods keep their shaded depth. Plant colours
are sRGB HSL (three's `setHSL` defaults to linear, which made leaves three to
four times too bright); real foliage albedo is 5–12%.

Leaves transmit about as much as they reflect, deeper and yellower (PROSPECT:
T ≈ 0.8 R), lit by the shadowed sun irradiance from three's light loop, so only
leaves the sun reaches glow. Aerial perspective on the land is the horizon sky
along each line of sight, bright toward the sun and blue away from it. The
cat's shadow is its own soft shadow map, deep enough for a low sun's long
shadow across the sand.

Every pass works in linear HDR. The sky target (RGBA16F) holds exposed linear
radiance; the water pass and the Three.js layer apply the same curve and sRGB
encoding once: Khronos PBR Neutral, linear through the midtones so colours stay
as light and materials make them and shadows stay open (as in a photograph,
not a filmic S-curve), with a shoulder so the sun disc and glints roll off to
white. At night the same curve shifts toward rod vision (Purkinje: colour
fades to blue-grey), except for bright things like the Moon's disc. The sun
disc is drawn through cloud transmission only in the final pass. Sky/cloud
reflections use a filtered screen-space lookup whose blur grows with
roughness, with the sky-view table off screen. The island itself mirrors in
the sea: `src/land-field.js` bakes the land's top (terrain or crown) and albedo
into a 256² field with a max-height mip chain and a distance-to-land channel,
and reflected rays near the shore march through it (`land_reflection`), lit by
sun and sky, their edge softened by the rough lobe's spread. Boulders are
traced separately (`rocks.wgsl`). This is an illustrative coastal model, not a
fluid solver or marine forecast.

Vegetation uses four growth families: woody canopy, shrubs, ferns and grasses.
Each seed generates eight communities of continuous growth traits (height, spread,
branching, leaf proportions, foliage and bark colour), rather than authored species
models. Smooth habitat fields form related groves; exposure lowers the coastal edge,
spacing avoids intersecting trunks, and a separate patch field populates lower layers.
Crowns grow by space colonization; stems taper continuously through every fork (pipe
model radii, each segment narrowing to its thickest child). Leaves grow on shoots:
a short twig with 10 small folded leaves in a golden-angle spiral, mature and wide at
the base, young and yellower at the tip. Sun leaves outside the crown are smaller and
yellower, shade leaves inside larger and bluer, and each shoot's depth in its crown
darkens it and occludes its sky sheen. Every plant organ is grown, not stamped
(`plant-forms.js`): grass tufts of 24 arching 5 mm blades with dry tips and nodding
panicles; ferns and palms as pinnate fronds with lobed pinnae; aloes as rosettes of
keeled, recurved, red-toothed succulent leaves, tree aloes on a stem in a skirt of dead
leaves; restios as dense reed clumps; ericas as domes of needle shoots hung with bells.
Geometry is instanced, with no per-tree scene graphs.

Foliage is lit as thin, glossy, translucent tissue: sunlight through a leaf exits
yellow-green (a forward lobe and a diffuse term, from the shadowed sun only), a leaf at
a glancing angle mirrors the sky (Fresnel on a rough cuticle), and low plants darken
into their own base. Wind has gust fronts that roll downwind across the island at
the wind's speed, so one gust visibly runs through the grass, then the shrubs, then the
crowns; trees lean with it and sway about the lean, grass and fronds bend for their
height (keeping their length), and every leaf, blade and pinna flutters on its own
stalk. The ground under the plants comes from the plants themselves: grass, moss and
litter are splatted from the actual tufts, crowns and cushions onto the ground grid, so
litter pools under each tree and sward (fine combed strokes, brightening as each gust
bends it) spreads round each tuft. Close to the cat the paint gets geometry
(`src/near-ground.js`): two world-snapped windows of small instanced clumps
follow the camera, dense round the cat and coarser out to ~9 m, where the painted
cover takes over. Each cell grows what the ground's baked masks say grows there:
short sward on grassy and mossy ground, fynbos sprigs under the painted scrub,
sour-fig fingers only inside the painted mats, and fallen leaves lying flat in the
litter; open beach sand stays bare between the tufts. Cells are filled on the CPU
as they enter a window and only live clumps are packed for the one draw, so open
sand and rock cost nothing. Pollen and dust motes glitter only when you look
toward the sun.

Open ground between groves is fynbos: king and sugarbush proteas, pincushions,
aloes with orange flower candles, restio reed tufts, pink-belled ericas, and
Namaqualand-style daisy drifts that share one colour over tens of metres and face
the northern (southern-hemisphere) sun. Granite corestone fields straddle the
waterline in a few clusters, in five corestone shapes (jointing and sheeting
shells). Granite is shaded in true 3D noise: weathering tone, iron stain running
down, patina in hollows, fine cracks, feldspar/quartz/biotite grain up close,
grey-green crusts and orange lichen rosettes above the spray, and the shore's
zones (black splash band, barnacles, green algae) with a wet line that rises and
drains with each swell. Sand has mineral grains up close (dark heavy minerals,
white shell and quartz, pink feldspar), heavy-mineral laminae just above the
waterline, pebbles and shells in drifts, and sparkling quartz grains in sun and
moonlight. The ground also gets wind ripples, a glossy wet swash band, granite on
steep ground, leaf litter, and a derivative bump map; bark has fissured plates. These
are illustrative forms inspired by Cape flora, not botanical reconstructions.

Kelp gulls soar in drifting thermals with occasional flapping bursts, lines of
Cape cormorants skim the sea, and a dolphin pod porpoises offshore on staggered
breathing cycles (clipped at the surface). Birds roost at night.

## Sky events

`src/sky-events.js` decides when the sky stages something, from the seed, the
animation clock (`state.time`), the real sun and moon and the weather; the
shaders draw it from seven Atmosphere fields (`events`, `bolt`, `optics`,
`meteor`, `trail`, `streak`, `satellite`) and skip all work while they are
zero. Nothing is moved into frame; only the rates of random events are
compressed (`LINGER`) so a visitor who stays a few minutes sees one.

- **Rainbow / moonbow** (sky resolve, `phenomena.wgsl`): Airy theory over ten
  wavelengths with water's real dispersion: primary at 40.8–42.4°, secondary
  at 50.2–53.2° with reversed colours, Alexander's dark band, supernumeraries
  that wash out as drops grow; only with rain, the sun (or a near-full moon)
  below 42° and its beam getting through the cloud. Showers under broken
  cloud hang as rain curtains, and the sea reflects the bow.
- **22° halo and sundogs** in thin high cloud (minimum deviation through ice
  prisms; parhelia move out as the sun climbs); **lunar corona** (droplet
  diffraction) in thin cloud round the Moon; **zodiacal light** on dark,
  moonless nights; **crepuscular rays** from the cloud layer's transmission
  toward a low sun (16 taps, screen space).
- **Lightning** in storms: the flash lights the clouds in the resolve (never
  written to the cloud history, so it cannot ghost), the branched channel and
  its broken reflection are drawn at full resolution, and `landFlash` brightens
  the land's skylight. `createSkyEvents().on(fn)` publishes each strike
  (`{ type: "lightning", at, strength, bearing, distanceKm, thunderDelay }`) and
  meteor; main.js keeps the scheduler at `state.skyEvents`.
- **Meteors** (sporadics and the real showers' radiants, rare fireballs with a
  persistent train), **satellites** at dusk (lit unless in the Earth's shadow),
  and the **green flash** on the last sliver of a clear sea sunset.
- `skySpectacles({ date, celestial, weather, seed, sunlit })` lists what is
  visible now or due soon, for a "look up" hint.
- With `?perf`, `?sky=rainbow|moonbow|lightning|meteor|fireball|satellite|halo|corona|rays|green-flash|zodiacal`
  forces one; positions stay real. `render-sky.mjs` has a fixture for each.
## The thread, the score and the keepsake

- **Discoveries** (`src/discoveries.js`): places, creatures and moments as data
  (`{ id, title, x, z, r, kind?, scope?, when?, hold?, above? }`), checked four
  times a second. Found ids persist in localStorage per seed (`scope: "island"`
  for things every seed shares). A find chimes, writes one line of type
  ("found · the deep cove") and joins the **field notes** (header, left); the
  unfound show only as dim dashes, never by name. While it sits, the cat now and
  then turns its head toward the nearest place it has not found.
- **Score** (`src/score.js`): sparse generative music on D, its mode following
  light and weather (lydian noon, mixolydian golden hour, aeolian night, almost
  nothing in a storm, silence while the cat sleeps), with a small FDN reverb. Music
  has its own switch (the note button) beside sound; both are remembered.
  `sound.play(name, { distance, pan, gain })` plays named one-shots (`src/calls.js`).
- **Photo mode** (`src/photo-mode.js`): P or the camera button. UI hidden, cat
  still, camera free (arrows, drag, scroll/pinch, +/−); space pauses time; F wide
  2.39:1 crop, C caption, S or the shutter saves a PNG of both canvases and the
  vignette (rendered and read in one task: no `preserveDrawingBuffer`). Phones
  share, desktops download.
- **Moments** (`src/moments.js`): the name on arrival, a hint that teaches one
  thing at a time, the camera drifting to watch the sun, moon or sea when the cat
  has sat a while (any input returns it), and dawn as a time-lapse preview while
  the cat sleeps at night. `src/thread.js` joins these to `main.js`.
- **The wisp and the six gifts** (`src/journey.js`, `src/quest.js`,
  `src/wisp-mind.js`, `src/wisp.js`): a small living light meets the cat on the
  home beach and leads it, by behaviour, to the nearest keepsake whose gift still
  sleeps (`magic.js` KEEPSAKES): it flits ahead and waits in sight, beckons,
  comes back for a dawdler, darts beside a runner, hides in the grass, circles a
  sitting cat (and sits with it at sunset), answers a meow, peeks at animals and
  looks up at a falling star. Reaching the keepsake is a ceremony: the wisp
  dives in, time holds, the score plays that gift's phrase (`score.js`
  CEREMONIES), a wave of light runs out (`magic.pulse`), the camera eases back,
  and one line of type names the gift. All six awake, it leads to the summit for
  the finale. Woken gifts persist per seed (`skycope.gifts.<seed>`); the field
  notes show the six as marks and offer "begin again". The mind is pure and
  tested (`tests/wisp.test.js`, `tests/quest.test.js`); the light is one draw.

## Render budget and lifecycle

- Six WebGPU passes: the wind-sea cascades and (in wind) the whitecap history,
  three for the sky, then the water. The sky: a 256 × 128 **sky-view table** of the scattering
  integral (Hillaire 2020; it was 1.6 ms of per-pixel integrals at 1 M pixels),
  then the **cloud march at a quarter of the sky's pixels**, each texel tracing
  one pixel of its 2×2 block in a rotating jitter, then a **resolve** at up to
  **450,000 pixels** (220,000 on phones) that takes the fresh sample where it matches and otherwise
  reprojects last frame's cloud layer into the current view, clamped to the
  fresh neighbourhood so moving cloud never ghosts (MRT: the sky for the water
  pass, and the cloud layer as history). A resize, time scrub, weather change or
  returning home resets the history; reduced-motion stills render four frames.
  Then water and the final composite at up to **1.5 million pixels / 1.5× DPR** (650,000 / 1.25× on phones).
- The island's reflection in the sea runs only where it can show (a Fresnel
  above 4%, within 70 m of the shore, rising rays), leaps open water and empty
  cells, and costs the water pass about 14% on desktop; the phone budget skips
  it (`atmosphere.ocean.z`).
- The water pass skips work nobody sees: sea under the island (its calm-sea hit
  is more than 1.5 m inland, where the terrain mesh is opaque), seabed shading
  where the water column hides the bottom, foam lookups away from surf and
  whitecaps, wave intersection steps at grazing angles (zero displacement),
  star searches where the catalog grid marks no star nearby, and sea behind a
  waterline boulder (the eye ray passes well inside it above its see-through
  band). The whitecap history steps every other frame over both frames' time.
  Rock work is gated by the 2 m grid, and one pass traces the shadow,
  reflection and refraction rays against each listed rock after a bounding-sphere
  test. At 2560 × 1368
  water and 1368 × 731 sky this took the WebGPU frame from 7–10 ms to 2.5–3.4 ms
  on an Apple GPU, with sky and visible sea identical to within 5/255.
- Up to 56 primary ray samples, quadratically spaced for nearby detail. Empty
  space is skipped and opaque rays exit early. Three secondary samples estimate
  cloud self-shadowing; directional light, ambient fill and haze add depth.
- An alpha WebGL canvas composites depth-tested terrain and forest meshes over
  the water/sky canvas. Both cameras share position, heading, pitch and FOV.
  Geometry uses instancing and no per-tree scene graph. Instances are bucketed
  into 20 m chunks (40 m for sparse sets) for culling and draw calls, but each
  instance chooses its own level of detail by its own distance
  (`src/instance-lod.js`, tested): leafy shoots are 10 folded leaves within
  11 m, then 7 leaf cards, 5 from 22 m and 3 from 38 m, then half and a third
  of the shoots, grown to cover the same canopy area (from 60 and 100 m);
  tufts, fronds, needles, branches, flowers and rocks have their own ladders.
  Over a band before each boundary the vertex shader shrinks an instance the
  next level drops and grows one it keeps to the next level's size, so the
  swap itself changes only the part count: nothing pops. Chunks are re-packed
  on the CPU (at most ~24k instances a frame, nearest first) when the eye has
  moved enough to move instances between levels; the render budget's
  `lodBias` pulls every level in. Per-instance levels cut the milkwood,
  beacon and summit views from 2.2–3.3 M triangles to 1.7–2.1 M. The mesh layer renders
  into its own multisampled framebuffer, resolved onto the (single-sampled)
  canvas by one blit, so the render budget chooses the sample count: MSAA 2
  on high-DPI screens at 1.94 MP (about the cost of the old 1.6 MP at MSAA 4,
  measured whole-frame), up to 0.75 of native linear (2160 × 1350 on a
  1440 × 900 Retina laptop) while the GPU has headroom; MSAA 4 at native size
  on 1x screens; 0.8 MP without MSAA on phones. Rendering
  is capped at 60 fps, 30 once the cat has settled, on the low-power GPU. The
  cat is ~8 draws (the old one ~63): its skinned passes are vertex-bound, so the
  fur shells, shadow map and see-through silhouette use a coarse mesh, outer
  shells are clipped away before rasterisation except at the silhouette, and the
  coat is baked per vertex once on the GPU for the shells (and for the body
  beyond ~2 m). Its cost matches the old cat at the follow distance. Sun
  shadows use one 2048² map over 64 m around the cat, re-rendered only when
  the light's direction moves ~0.3° or the cat's 10 m anchor moves (not for
  colour, twilight or cloud). A refresh is spread over four frames (eight
  under load, `shadowSlices`): each renders a quarter of the casters into a
  back map that replaces the front one only when whole, so no frame pays the
  whole caster set (at the milkwood 3 M extra triangles in one frame before,
  about 0.5–0.8 M in each of four now); a jump renders it at once. Individual
  leaf tips flutter in a vertex shader.
- A 256 KiB repeating noise volume avoids hashing many noise octaves per sample.
  The constellation atlas is uploaded once (2048 × 1024 RGBA, 8 MiB), and the
  star catalog grid once (1024 × 512 RGBA16F, 4 MiB).
- Rendering follows `requestAnimationFrame`, paced to 60 fps (30 once the cat has settled) with a small tolerance so vsync jitter never skips a frame. No full-resolution bloom; the only history buffer is the cloud layer.
- **The render budget** (`src/quality.js`, pure and tested) decides every layer's render size in one place and what to give up under load. It is driven by GPU time where the platform reports it (the mesh layer's timer query plus WebGPU pass timestamps), else by frame intervals. Sustained cost over 88% of the frame period sheds one step about every second, in this order: the sun shadow map's refresh spread over more frames and fewer cloud march steps; sky and cloud scale; sea scale (0.82, 0.68); vegetation LOD distances (×0.85, ×0.72); MSAA 4 → 2 where it starts at 4; a steady 40 fps (only on displays that pace it evenly) then 30; and only last the land's resolution, never below 0.85. Headroom under 62% restores a step after 1.5 s; a restore that cannot hold waits twice as long before it is tried again, so it never saw-tooths. Only a sky-size change rebuilds the cloud history. `?perf`: `skycope.budget.pin(level)` holds a level (`null` releases), and `data-quality` on the sky canvas shows it.
- Hidden tabs stop rendering and skip weather fetches. Resuming refreshes stale
  weather. Reduced motion stops the animation loop and redraws only for clock,
  control, weather or size updates; pointer movement is disabled.
- GPU initialization/validation/device-loss failures show the static CSS sky.
  The controls and data still work. Fallback geometry is decorative.
- Hot reload cancels requests, listeners, timers and GPU work before rebuilding.

Keep atmospheric/water changes in WGSL, geometry in `forest.js`/`terrain.js`,
and data changes in their respective modules. The ocean shader repeats the short
`shoreline(z)` formula from `terrain.js`: change and test both together. Likewise,
keep the camera constants in `view.wgsl`/`ocean.wgsl` and `landscape.js` aligned.
The landscape is procedural and stylized, not a photogrammetric reconstruction.
Avoid adding a framework, more render passes, or a runtime astronomy/network
service unless it solves a concrete limitation. Measure the cloudy/rainy cases,
not just the cheap clear sky, when changing the rendering budget.

## Credits

- [Three.js](https://threejs.org/), MIT.
- [vgpu](https://vgpu.sh), Vercel, MIT.
- [SunCalc](https://github.com/mourner/suncalc), Vladimir Agafonkin, BSD-2-Clause.
- [d3-celestial](https://github.com/ofrohn/d3-celestial), Olaf Frohn, BSD-3-Clause.
  The complete required notice is shipped as `public/celestial-license.txt`.
- [Open-Meteo](https://open-meteo.com/), weather data, CC BY 4.0.
- [Departure Mono](https://departuremono.com), Helena Zhang, OFL.
