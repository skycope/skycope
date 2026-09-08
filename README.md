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

This renders clear, cloudy, rainy, dusk, night, and sun-glint sky/water PNGs and reports combined GPU pass timing.
It requires a GPU with `timestamp-query`. The fixture sky texture is black, so
verify catalog stars and the WebGL forest in the browser. The GPU timings cover
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
| `src/shaders/sky.wgsl`   | Atmosphere, cloud volumes, lighting, stars, rain                         |
| `src/shaders/view.wgsl`  | Shared camera projection and uniform layout                              |
| `src/shaders/water.wgsl` | Sharp water composite, direct sun, rain and final colour                 |
| `src/shaders/ocean.wgsl` | Coastal swells, filtered ripples, water reflectance, foam                |
| `src/landscape.js`       | Three.js camera, lighting, shadows, lifecycle                            |
| `src/vegetation.js`      | Seed-derived growth traits, habitat placement, branches, ferns and grass |
| `src/forest.js`          | Instanced trunks, branches, individual leaves, rocks, beach mesh         |
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
No API key or visitor geolocation is used. The weather text links to the provider.

[SunCalc 2](https://github.com/mourner/suncalc) calculates the apparent sun and moon
positions and lunar illumination. **Version 2 returns degrees, with azimuth
clockwise from north**; do not substitute the old radians/south-based convention.
The shader uses east / up / north coordinates and radians. Palette transitions
follow solar altitude, including twilight, rather than fixed clock cutoffs.

The camera faces **northwest (315°), tilted 6° above the horizon**. Sun, moon and
constellations move through this fixed view; they are not moved into frame when
actually elsewhere. Cursor movement changes the view by less than a degree.
Sun and moon discs are slightly enlarged for the illustration. The sun uses a pixel-width antialiased edge and clips each fragment below the sea horizon. Coast, forest and cloud
geometry are illustrative, while celestial positions and weather inputs are data based.

The night atlas contains 2,851 catalog stars through magnitude 5.5 and all 88
Western constellation figures. Latitude and local sidereal time rotate it into
Cape Town's sky. Coordinates are J2000; stellar precession/proper motion,
refraction and local light pollution are omitted. See [data notes](src/data/README.md).

## Procedural variation and water

Each page load chooses a fresh random seed for trees, shrubs, rocks, cloud noise,
and wave phases. Time, celestial positions and weather are independent of that seed.
The coastline stays fixed so the water and beach agree. For reproducible visual QA,
open `/?seed=1847`; use a positive 32-bit integer. The current seed is also exposed
on the sky canvas as `data-seed`. No seed controls or extra text appear in the UI.

Water uses separate scales of detail. Six broad swells use shoreline coordinates:
crests shorten and turn into the shallows, with a smaller phase-matched returning
wave fading offshore. Only the first three broad swells displace ray intersections,
with displacement fading toward grazing angles. Fine detail uses four rotated,
advected procedural noise gradients. This avoids tracing tiny waves with unstable
intersection steps and avoids repeating high-frequency sine interference patterns.
Both ripples and swells are filtered by their projected pixel footprint; unresolved
slope energy broadens the reflection. The animation clock is intentionally slowed.

The cloud/sky intermediate uses RGBA16F to preserve smooth twilight gradients. The sun disc is drawn through cloud transmission only in the final pass. The ocean
uses a broad microfacet sun reflection, so it does not alias a second reflection
of a low-resolution disc. Sky/cloud reflections use a filtered screen-space lookup
with a smooth edge fallback; offscreen geometry and trees are not ray-traced into
water. This is an illustrative coastal model, not a fluid solver or marine forecast.

Vegetation uses four growth families: woody canopy, shrubs, ferns and grasses.
Each seed generates eight communities of continuous growth traits (height, spread,
branching, leaf proportions, foliage and bark colour), rather than authored species
models. Smooth habitat fields form related groves; exposure lowers the coastal edge,
spacing avoids intersecting trunks, and a separate patch field populates lower layers.
Branches curve and split recursively. Leaves originate on connected shoots with fixed
bases during flutter. Ferns grow arching paired fronds; grasses grow in tufts.
Near canopy trees receive an extra branching level; shrubs and distant trees stay
simpler. Geometry is instanced, with no per-tree scene graphs. These are illustrative
growth families, not a claim to reproduce specific Cape Town species.

## Render budget and lifecycle

- Two WebGPU passes: clouds at most **1,000,000 shaded pixels**, then water and the
  final composite at up to **3.5 million pixels / 2× DPR**. Adaptive cloud quality
  never reduces the water resolution. The remaining pixel accent is typography.
- Up to 56 primary ray samples, quadratically spaced for nearby detail. Empty
  space is skipped and opaque rays exit early. Three secondary samples estimate
  cloud self-shadowing; directional light, ambient fill and haze add depth.
- An alpha WebGL canvas composites depth-tested terrain and forest meshes over
  the water/sky canvas. Both cameras share position, heading, pitch and FOV.
  Geometry uses instancing and no per-tree scene graph. The mesh canvas caps at
  2.5 million pixels with MSAA. Sun shadows use one 2048² map, updated only when
  lighting changes. Individual leaf tips flutter in a vertex shader.
- A 256 KiB repeating noise volume avoids hashing many noise octaves per sample.
  The star atlas is uploaded once (2048 × 1024 RGBA, 8 MiB).
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
