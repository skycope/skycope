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
mesh-layer GPU time (`data-mesh-ms`, via a `readPixels`-synced render burst every
90 frames), triangles and draw calls on the landscape canvas, and exposes the live
state as `window.skycope` (for example to aim `flight` at the sun).

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
| `src/main.js`            | Controls, resource lifetime, clocks, uniforms, adaptive render budget    |
| `src/astronomy.js`       | Cape Town dates, sun/moon positions, sidereal rotation                   |
| `src/weather.js`         | Open-Meteo request and validation; no rendering code                     |
| `src/weather-panel.js`   | Weather panel: live, presets, and cloud/wind/rain sliders                |
| `src/surf.js`            | Foam collars, lapping ripples and spray where the sea meets boulders     |
| `src/shaders/atmosphere.wgsl` | Rayleigh/Mie/ozone scattering, transmittance, the one tonemap       |
| `src/sunlight.js`        | CPU twin of the scattering model: exposure, sun and sky light per frame  |
| `src/shaders/sky.wgsl`   | Sky radiance, cloud volumes and lighting, moon, stars                    |
| `src/shaders/view.wgsl`  | Shared camera projection and uniform layout                              |
| `src/shaders/water.wgsl` | Sharp water composite, sun disc, rain, tonemap and final colour          |
| `src/shaders/ocean.wgsl` | Swells, ripples, reflection, seabed, caustics, kelp, glitter, foam       |
| `src/landscape.js`       | Three.js camera, lights from `sunlight.js`, shadows, lifecycle           |
| `src/vegetation.js`      | Growth traits, habitat placement, trees, ferns, grass and fynbos         |
| `src/forest.js`          | Instanced plants, flowers, granite, ground and bark detail shaders, LOD  |
| `src/fauna.js`           | Gulls, cormorants and a dolphin pod                                      |
| `src/random.js`          | Reload seed, reproducible random streams                                 |
| `src/terrain.js`         | Terrain and shoreline functions                                          |
| `src/cloud-noise.js`     | Deterministic 64³ cloud noise texture, generated once                    |
| `src/stars.js`           | One-time star/constellation atlas from the compact catalog               |
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

The home view faces **northwest (315°), tilted 6° above the horizon**, and the
visitor can fly: dragging looks around, W/S is throttle, the arrow keys turn and
pitch, and H returns home. Both the WGSL passes and the Three.js camera read the
same flight state (position in coast metres, azimuth, pitch); keep them aligned.
Flight is bounded to 160 m around the island centre, above the terrain, and
below the cloud deck. Sun, moon and constellations occupy their true directions;
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
lacy residue and a thin swash line; whitecaps appear above ~5 m/s wind.

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
lit. `src/sunlight.js` evaluates the same model on the CPU once per frame to get
exposure, the direct sun (or moon) colour and zenith skylight. They go to both
WebGPU passes as uniforms and drive the Three.js directional and hemisphere lights
and fog, so land, sea, clouds and sky share one sun. The land's skylight is the
cosine-weighted mean of the whole dome (`skyIrradianceRatio`), not the hazy
horizon toward the heading, and its ground bounce keeps its true brightness
relative to the sky. Leaf translucency and glints use the shadowed sun
irradiance from three's light loop, so only leaves the sun reaches glow. Exposure adapts like an eye:
the zenith stays steady through golden hour, then genuinely darkens through civil
twilight, with limited dark adaptation at night. **Keep `atmosphere.wgsl` and
`sunlight.js` in step.**

Every pass works in linear HDR. The sky target (RGBA16F) holds exposed linear
radiance; the water pass and the Three.js layer apply the same ACES fit and sRGB
encoding once, so highlights such as the sun disc and glints roll off instead of
clipping. The sun disc is drawn through cloud transmission only in the final pass.
Sky/cloud reflections use a filtered screen-space lookup whose blur grows with
roughness, with a smooth edge fallback. Offscreen geometry and trees are not
ray-traced into water. This is an illustrative coastal model, not a fluid solver or
marine forecast.

Vegetation uses four growth families: woody canopy, shrubs, ferns and grasses.
Each seed generates eight communities of continuous growth traits (height, spread,
branching, leaf proportions, foliage and bark colour), rather than authored species
models. Smooth habitat fields form related groves; exposure lowers the coastal edge,
spacing avoids intersecting trunks, and a separate patch field populates lower layers.
Branches curve and split recursively. Leaves originate on connected shoots with fixed
bases during flutter. Ferns grow arching paired fronds; grasses grow in tufts.
Near canopy trees receive an extra branching level; shrubs and distant trees stay
simpler. Geometry is instanced, with no per-tree scene graphs.

Open ground between groves is fynbos: king and sugarbush proteas, pincushions,
aloes with orange flower candles, restio reed tufts, pink-belled ericas, and
Namaqualand-style daisy drifts that share one colour over tens of metres and face
the northern (southern-hemisphere) sun. Granite corestone fields straddle the
waterline in a few clusters. The ground and rocks get per-pixel world-space detail:
sand grain and wind ripples, a glossy wet swash band, granite on steep ground,
lichen, leaf litter, and a derivative bump map; bark has fissured plates. These
are illustrative forms inspired by Cape flora, not botanical reconstructions.

Kelp gulls soar in drifting thermals with occasional flapping bursts, lines of
Cape cormorants skim the sea, and a dolphin pod porpoises offshore on staggered
breathing cycles (clipped at the surface). Birds roost at night.

## Render budget and lifecycle

- Two WebGPU passes: clouds at most **1,000,000 shaded pixels**, then water and the
  final composite at up to **3.5 million pixels / 2× DPR**. Adaptive cloud quality
  never reduces the water resolution. The remaining pixel accent is typography.
- Up to 56 primary ray samples, quadratically spaced for nearby detail. Empty
  space is skipped and opaque rays exit early. Three secondary samples estimate
  cloud self-shadowing; directional light, ambient fill and haze add depth.
- An alpha WebGL canvas composites depth-tested terrain and forest meshes over
  the water/sky canvas. Both cameras share position, heading, pitch and FOV.
  Geometry uses instancing and no per-tree scene graph. Each 28 m chunk is a
  `THREE.LOD`: beyond 42 m it swaps to cheaper leaf/cluster/branch/rock geometry and
  drops unresolvable twigs, blades and flowers (at the home view this cut visible
  triangles from 3.4 M to 1.3–1.6 M). The mesh canvas caps at
  2.5 million pixels with MSAA. Sun shadows use one 2048² map, updated only when
  lighting changes. Individual leaf tips flutter in a vertex shader.
- A 256 KiB repeating noise volume avoids hashing many noise octaves per sample.
  The constellation atlas is uploaded once (2048 × 1024 RGBA, 8 MiB), and the
  star catalog grid once (1024 × 512 RGBA16F, 4 MiB).
- Rendering follows the display refresh through `requestAnimationFrame`, without a second FPS cutoff that can skip near-boundary frames. Sustained slow frames reduce resolution and sample
  count; recovery is gradual. The water budget is fixed. No full-resolution bloom or temporal history buffers.
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
