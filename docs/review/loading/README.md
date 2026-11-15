# Loading screen: before and after

Owner, on the live site: "loading screen is off - looks weird and low res and then what appears is completely different".

**Before** (`before-*.jpg`): a dark placeholder gradient, then at ~1.5 s a small canvas scaled up (a painted hill silhouette and flat ground guessed from seed 1, not the visitor's island), then a cut to a different picture.

**After** (`after-*.jpg`): the first paint is already the sky of that moment (an inline table in `index.html`, `scripts/veil-palette.mjs`); at ~1.5 s the exact sky and sea fade in over it, drawn by one shader at device resolution (`src/loading-sky.js`, `src/loading-screen.js`), with the horizon where the walker's camera puts it. No land is painted. When the world's first frame is on the GPU the drawn sky goes soft and fades off a world that is out of focus under it, and the focus pulls in over about 1.2 s.

Sheets: frames at 100 ms from navigation to the veil's sky (+0.5 s), every second while the island builds, then 100 ms from 0.5 s before the first real frame to 3.5 s after it. Production build (`vite build` + `vite preview`), Fast 3G, CPU 4×. Desktop 1440×900 at DPR 2; phone 375×812 at DPR 3. `frames/*-veil.jpg` and `*-world0/500/1000/2000.jpg` are full-resolution frames at the hand-over.

Regenerate: `node scripts/loading-capture.mjs strip|agree|timing docs/review/loading --port <port>` (`agree` needs the dev server: it imports `/src/terrain.js`), then `node scripts/loading-tables.mjs docs/review/loading`.

## Colour agreement

The veil against the WebGPU sky and sea canvases' pixels for the same camera (land layer hidden, no vignette on either), 11×11 px patch means, CIE76 ΔE. Full table: `after-colour-agreement.md`; the old veil's sky model on the same samples: `before-colour-agreement.json`.

| scene | sky samples | before median / max ΔE | after median / max ΔE |
|---|---|---|---|
| dawn clear | 18 | 1.5 / 3.1 | 0.1 / 0.5 |
| noon clear | 18 | 1.0 / 1.4 | 0.2 / 0.3 |
| golden hour clear | 18 | 1.9 / 2.6 | 0.2 / 0.4 |
| dusk clear | 18 | 2.2 / 3.6 | 0.7 / 1.1 |
| night clear | 18 | 5.0 / 6.8 | 0.5 / 4.2 |
| dawn overcast | 18 | 17.3 / 30.5 | 6.8 / 12.5 |
| noon overcast | 18 | 34.0 / 55.0 | 3.3 / 24.3 |
| golden hour overcast | 18 | 17.2 / 28.1 | 5.1 / 11.9 |
| dusk overcast | 18 | 29.1 / 36.4 | 2.5 / 7.1 |
| night overcast | 18 | 7.3 / 12.5 | 0.6 / 3.1 |

What the first frame shows (home view: horizon to ~13°, the sea strip at −1°), after: median ΔE 0.1–0.7 clear, 1.0–5.2 overcast; worst single sample 17.5 (noon overcast, sea at −1° beside the distant island). Overcast and the sea are textured in the renderer (cloud march, waves): the veil paints their mean, so single patches differ; the open-sea samples below −3° are the near shore's shallow water (turquoise, foam) and are not modelled.

## Horizon

The veil frames `HOME_VIEW` (equal to the walker's home camera on bare ground, held by a test) and eases to the real first camera when main.js passes it at the `world` milestone. The seeded boulders lift the real camera: pitch −0.279 on seed 1847 against −0.250, 2.6 % of the frame height; the veil had the real pitch exactly at the first real frame in every run (`loading:ready` mark detail: `pitch` = `veilPitch` = −0.27885).

## Timing (ms from navigation)

Production, Fast 3G, CPU 4× (one load per case; full tables from `scripts/loading-tables.mjs`):

| | first paint | sky colours right | veil sky drawn | main.js fetched | first real frame |
|---|---|---|---|---|---|
| before, 12 cases | 656–772 | never (placeholder, then a guessed picture) | 1467–1612 | 3373–3413 | 13079–22545 |
| after, 12 cases | 664–752 | at first paint | 1483–1568 | 3497–3587 | 12896–18284 |

The first real frame's spread is the world build (island, plants, shader compiles) under CPU 4×, which this lane does not touch; it varies by ±3 s between identical loads. After `loading.ready()` the veil waits for the land layer's GPU fence and two frames: 40–120 ms ("world shown" in `scripts/loading-tables.mjs`).

Unthrottled, one load each (noise ±0.5 s on the world build):

| | first paint | veil sky drawn | main.js requested / fetched | first real frame |
|---|---|---|---|---|
| production before | 96 | 153 | 79 / 186 | 4298 |
| production after | 160 | 106 | 106 / 175 | 5418 |
| dev before | 176 | 409 | 339 / 549 | 8886 |
| dev after | 324 | 509 | 509 / 577 | 8434 |

The veil's entry chunk grew from 13.4 to 16.7 kB gzipped (tone.wgsl's source for the shader, the sky table) and index.html by ~10 kB (the first-paint table, ~4 kB gzipped). First-contentful-paint is later after (the word "loading" is now visually hidden, so the first text is the page's own), which is a metric change, not a visible one.
