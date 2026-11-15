# Rendering code review: magic-round2 (9084787..magic-round2)

## Combined ranking (both passes; read this first)

This review read the main checkout (`magic-round2` @ 428f278; since b00fa07 only `src/affordances.js` has changed). Each finding names the file that owns the fix and the agent stream it belongs to:
- **stability:** `quality.js`, `landscape.js` shadows, the `main.js` loop
- **vegetation:** `instance-lod.js`, `near-ground.js`, `forest.js`
- **loading:** `loading-screen.js`
- **unassigned:** files no current stream owns

| # | Finding | File (owner) | Status | Symptom it explains |
|---|---|---|---|---|
| 1 | Cloud transmission sampled at the camera's position and applied unsmoothed, 4×/s, to sun intensity, leaf light and the environment key (S2-1) | `landscape.js` 370-376, 649-651, 696-707 (stability) | CONFIRMED | plant lighting flicker; lighting changing as you walk |
| 2 | Sliced sun-shadow refresh races the per-instance LOD repack: instances drop out of or double in the shadow map (S2-2) | `forest.js` `packLod` 2798; `landscape.js` 556-608 (vegetation + stability) | CONFIRMED mechanism | plant shadow and lighting flicker |
| 3 | Lazy material re-wraps (`lightWithMagic`/`groundAnimals`) recompile shaders mid-frame every 300 frames until frame 2130, independent of prewarm; prewarm runs in one task with the WebGPU pipeline build and nothing logs WebGL context loss (S2-3; revises first-pass #1) | `landscape.js` 321-324, 291-306; `land-magic.js` 234; `main.js` 780-788 (stability) | CONFIRMED stalls; the 3 s blank is still PLAUSIBLE | 3 s blank about 9 s after load |
| 4 | The land canvas is resized outside a frame (reveal timer, window resize) and nothing draws until the next frame that is not skipped; on 120 Hz screens every other frame is skipped (S2-4) | `main.js` 930, 1306-1322, `tick` (stability) | PLAUSIBLE | land blinks out during the reveal and on resize |
| 5 | Lighting updates in two steps after a time change: dome and environment throttled to 250 ms (first pass #3) | `landscape.js` 360-366, 703-708 (stability) | CONFIRMED | lighting changes after a time jump |
| 6 | Shadow refresh quantised to about 0.3° of sun direction: near sunrise and sunset each refresh moves long shadows by metres at once (S2-5) | `landscape.js` 349 (stability) | PLAUSIBLE | shadows jump |
| 7 | Practical-light slot 3 picks the nearest lamp with no hysteresis or crossfade: a lamp's pool of light switches off as the cat passes the midpoint between two (S2-6) | `land-magic.js` 366-395 (unassigned) | CONFIRMED | lighting pops near lamps |
| 8 | Waking catch flickers at about 6 Hz for every gift except the lamp, against the code's own 3 Hz photosensitivity limit (S2-7) | `waking.js` 58-66, 88, 122 (unassigned) | CONFIRMED | accessibility |
| 9 | Lightning at night drops the night fill from the foliage sky light, so plants darken while everything else flashes (S2-8) | `landscape.js` 380-384 (stability) | CONFIRMED | plant lighting flicker in storms |
| 10 | Loading veil painted with seed 1 while the world uses a random seed; its night and cloud lighting constants are stale (S2-9; replaces first-pass #6) | `loading-screen.js` 377, 227-229 (loading) | CONFIRMED (seed) | loading picture does not match the world |
| 11 | In interval mode the quality governor's restore threshold (1.06 × frame period) is always met when frames hit vsync, so it keeps retrying restores; each changes land resolution (S2-10) | `quality.js` 120-131 (stability) | PLAUSIBLE | view visibly re-renders |
| 12 | Per-frame allocations in `packLod` and the lighting code (S2-11, first-pass #7) | `forest.js` 2798-2815; `landscape.js` (vegetation, stability) | CONFIRMED | GC hitches |
| — | First-pass #1 "prewarm compiles the wrong variants": refuted. The MSAA target is flagged `isXRRenderTarget` (`landscape.js` 921), so three gives it the same tone mapping and output colour space as the canvas. | — | REFUTED | — |
| — | First-pass #4 frozen subtrees and #5 cat pass using up the shadow refresh: latent only. The only `userData.static` setter is the LOD chunk meshes (never moved), and nothing outside `renderShadowSlice` sets `shadowMap.needsUpdate`. | `landscape.js` | LATENT | — |

---

# First pass

The coordinator asked for a wrap-up before every file in scope was read. The files read in full or in diff were `src/main.js` (diff), `src/landscape.js` (lines 60-700 plus the whole diff) and `src/cat.js` `renderShadow`. The second pass below corrects findings 1, 4, 5 and 6.

Findings are ranked most severe first. CONFIRMED means I traced the code path. PLAUSIBLE means the code allows the failure but I did not trace every step (three.js internals or callers I did not open).

---

## 1. Prewarm compiles the wrong program variants, all at once, about 9 s after load (PLAUSIBLE, high)
**Where:** `src/landscape.js:291-306` (`prewarm`); `src/main.js:780-788` (the 4 s timer plus `requestIdleCallback` with a 3 s timeout).

**Defect:** `prewarm()` calls `renderer.compileAsync(scene, camera)` while no render target is bound. The last call in `render()` is `setRenderTarget(null)` (landscape.js:459). The main pass, though, draws `scene` into `msaa.target` (landscape.js:453-457). three.js builds the program cache key from the current render target: it sets `toneMapping` to `NoToneMapping` and uses linear output when the target is not null. So prewarm compiles every material (with every hidden object made visible) as the canvas variant. That variant is never used for `scene`.

**Failure:**
- About 4 s after the atmosphere starts, or when the idle callback's 3 s timeout fires (about 9 s after load), roughly 70+ programs are created synchronously in one task. `wakeMagicPasses()` also builds the WebGPU pipelines in that same task.
- The main thread stalls, and the WebGL canvas and the WebGPU sky canvas present out of step. The sky can present while the land canvas does not, which matches the "3 s blank blue" report.
- After the stall, the variants a gift actually needs still compile mid-frame on its first waking, so prewarm does not deliver the benefit it was added for.
- If a time change lands in the same window, the environment and lighting changes add their own work on top.

**Fix:**
```js
prewarm() {
  renderer.setRenderTarget(msaa.target);   // same target state as the main pass
  … compileAsync(scene, camera, scene) …
  renderer.setRenderTarget(null);
}
```
- Split the work across several idle callbacks (for example, one group of hidden objects per callback). Do not use `{ timeout: 3000 }`, which forces it to run while the page is busy.
- Run `wakeMagicPasses()` in a separate callback.
- Check the archipelago and lens scenes the same way, because they render to the target and to the canvas respectively.

## 2. Instance-LOD tiers switch with the camera but the shadow map does not, and sliced refreshes mix tiers (PLAUSIBLE)
**Where:** `src/landscape.js:399` (`forest.updateLod(camera.position, …)` every frame); `src/landscape.js:556-581` (casters gathered once at slice 0, sliced by `i % count`).

**Defect:** The shadow map is redrawn only when the sun direction moves about 0.3° or the anchor moves 10 m. The caster set it captures, however, is whichever LOD tier is visible from the camera in that frame. With `shadowSlices > 1`, each slice is drawn in a different frame. A mesh that was hidden on the frame of its slice (`i % count === slice`) is missing from the finished map, and a mesh that was visible then but has since switched tier stays in it.

**Failure:**
- Plant shadows, and so the plants' lighting, pop when the cat moves a few metres (the tier changes but the map does not).
- When a refresh straddles a tier change, the completed map has holes, or shadows from a tier that is no longer drawn.
- This flicker shows on leaves and ground under trees, which matches "plant lighting flickering".

**Fix:**
- Gather casters from a camera-independent set: the nearest or full tier, flagged `userData.shadowTier`.
- Alternatively, lock the LOD visibility while a sliced refresh is pending: snapshot `visible` at slice 0 and restore it around each slice draw, the same way `castShadow` is snapshotted.
- At minimum, call `requestShadow(false)` when `updateLod` changes any chunk's tier.

## 3. Lighting changes in two steps after any time change (CONFIRMED behaviour; PLAUSIBLE as the reported "lighting changing")
**Where:** `src/landscape.js:360-366` (sky dome, throttled to every 250 ms); `src/landscape.js:~704-708` (`buildEnvironment`/PMREM, also throttled to 250 ms and keyed on `domeRatio`).

**Defect:**
- After a time change, the first frame uses the new sun, sun colour and exposure, but the old dome ratio, environment map and spherical-harmonic sky.
- The next rebuild happens at least 250 ms later, then the environment follows up to another 250 ms after that.
- Each step is a visible jump in sky fill on every material.

**Failure:**
- The user scrubs or jumps the time. The land shows the new direct light with the old skylight, then pops once or twice over the next 0.25-0.5 s. That is the "views visibly re-rendering / lighting changing" report.
- With `renderStill()` only (no continuous loop, for example while paused), the stale state persists until something else triggers a frame.

**Fix:**
- Bypass the throttle when the change is a discrete jump. Keep it only while scrubbing (for example, pass `jump: true` from `updateTime` and apply it when `|Δsun| > 0.05`).
- Or schedule one trailing frame (`setTimeout(renderStill, 260)`) so the settled state always arrives.

## 4. `freezeStatic` freezes whole subtrees, so anything that moves under a `userData.static` node stops updating (PLAUSIBLE)
**Where:** `src/landscape.js:243-245`, `844-873`.

**Defect:**
- `freeze(o)` sets `matrixAutoUpdate = false` on every descendant of a static-flagged node.
- It replaces that node's `updateMatrixWorld` with a no-op unless `matrixWorldNeedsUpdate` is set.
- `scene` and `land` themselves are frozen too. Their children still update, because three walks the children with `force = false`, but only if the roots are never moved.

**Failure:**
- A child of a static place that is animated by setting `position` or `rotation` stops moving, with no error. Examples are a lamp beam, a waking ember, a swinging sign, or a LOD chunk mesh re-placed by `instance-lod`.
- Its bounding sphere and shadow are then wrong, and frustum culling uses a stale `matrixWorld`, so the object can pop in and out at view edges.
- Anything added under a static node after load (lazily built materials and meshes) never gets its matrix composed. It renders at the origin, or not at all.

**Fix:**
- Freeze only leaf meshes (`traverse` only to check that no descendant is flagged `userData.dynamic`).
- Or assert in `?perf`: compare `matrixWorld` before and after a forced update on a sample each second, and log mismatches.
- Audit every `userData.static = true` setter in `places.js`, `place-*.js` and `forest.js` for children that animate.

## 5. The cat's shadow pass can consume a pending sun-shadow update (PLAUSIBLE)
**Where:** `src/landscape.js:202-208`, `447-448`; `src/landscape.js:193` (`sun.layers.enable(3)`).

**Defect:**
- With the sun now on layer 3, the cat pass (`renderer.render(scene, shadowCamera)`) hands three the sun.
- During that pass the patched `shadowMap.render` forwards straight to three's `drawShadows`.
- If anything sets `renderer.shadowMap.needsUpdate = true` outside `renderShadowSlice` (for example a `?perf` hook, or another module forcing a refresh), the full sun map is drawn in the cat pass. That draw is unsliced, from the shadow-camera frame, and with `scene.overrideMaterial = depth` set. It also resets `needsUpdate`, so the main pass's slice bookkeeping and the drawn map disagree.

**Fix:** In the patched `render`, return without drawing whenever `shadows.catPass` is set:
```js
if (shadows.catPass) return;
```
The cat pass never needs the sun map redrawn.

## 6. The loading picture is painted from a placeholder view and is updated on every time and weather update (PLAUSIBLE)
**Where:** `src/main.js:513` (`updateTime`), `565` (`applyWeather`), `722` (the view arrives only at the "world" progress step).

**Defect:**
- `loading.scene({ celestial, weather })` is called before `loading.scene({ view })` exists.
- The veil paints a sky and land at a default view and resolution, which does not match the world the user is about to see.
- It is also called on every `updateTime`, including after the veil has gone, unless `loading-screen.js` guards it (not verified).

**Failure:**
- The low-resolution loading picture does not match the world.
- There may also be per-update canvas work after reveal.

**Fix:**
- Make `loading.scene` a no-op once `ready()` has run.
- Do not paint the picture until `view` is known; use a neutral veil until then.

## 7. Per-call allocations in the lighting and shadow paths (CONFIRMED, minor)
**Where:**
- `src/landscape.js:566` (`sun.position.clone()` and `target.clone()` for every slice)
- `629-639` (three `Vector3`s per lighting key)
- `360` (`celestial.sun.map(...).join()`, every frame)
- `367-370` (arrays and a template string, every frame)
- `562` (a full `scene.traverse` at each refresh start)

**Fix:** Reuse module-level vectors. Key the dome on quantised numbers rather than strings. Cache the caster list and rebuild it only when the scene changes.

## 8. The prewarm timer is not cleared on dispose, and its errors are swallowed (CONFIRMED, minor)
**Where:** `src/main.js:780-788`.

**Defect:** `prewarm?.()?.catch?.(() => {})` hides compile failures, and the timer is never cleared. The timer is guarded by `state.gpu !== gpu`, so a disposed instance does not run it, but a compile error from a bad define in a sleeping gift's program is invisible until that gift wakes.

**Fix:** In `?perf`, log the rejection. Store the timer id and clear it in dispose.

---

## Not reviewed (wrap-up requested before reaching them)
- `src/forest.js` (354-line diff: `updateCanopyLight`, LOD, `pushAt`)
- `src/quality.js`
- `src/instance-lod.js` (hysteresis not checked)
- `src/waking.js`
- `src/land-magic.js`
- `src/magic.js`
- `src/near-ground.js`
- `src/terrain.js`
- `src/place-kit.js`
- `src/places.js`
- `src/place-*.js`
- `src/rocks.js`
- `src/sunlight.js`
- `src/tone-glsl.js`
- `src/land-field.js`
- `src/loading-screen.js`
- `src/shaders/*.wgsl`
- The main.js render loop, resize and reveal path beyond the diff

Next steps for whoever continues:
- Find every `userData.static` setter (finding 4).
- Find any `shadowMap.needsUpdate` writes outside landscape.js (finding 5).
- Check `instance-lod.js` for distance hysteresis (finding 2).
- Check `loading-screen.js` for a post-`ready()` guard (finding 6).

---

# Second pass

Files covered in this pass:
- In full or the relevant parts: `instance-lod.js`, `quality.js`, `waking.js`, `land-magic.js`, `loading-screen.js` (controller and paint inputs), `magic.js`, `near-ground.js`, `terrain.js`, `rocks.js`, `sunlight.js`, `land-field.js`, `tone.wgsl`
- From the diff: `forest.js` (the whole diff plus the LOD section 2655-2948), `places.js`, `sea-magic.wgsl`, `sky.wgsl`, `ocean.wgsl`, `view.wgsl`, `water.wgsl`
- For update hooks only: `place-kit.js`, `place-shore.js`, `place-milkwood.js`
- Checked in three.js 0.185.1: `compile`/`compileAsync`, `getParameters` (tone mapping per render target), and the shadow depth materials (they do not carry `alphaHash`)

## S2-1. Sun intensity and sky light step 4×/s with the camera's position and cloud (CONFIRMED). Owner: stability (`landscape.js`)
**Where:** `landscape.js:370-374` (`cloudBeam`), `649-651` (`sun.intensity = peak * overcast`), `696-707` (the environment key includes `bounceUnit`, which includes `overcast`).

**Defect:**
- `cloudBeam` is recomputed every 0.25 s of scene time from `cloudTransmission(...)` sampled at the camera's position (key `flight.x/3`, `flight.z/3`).
- Its value goes straight into the sun's intensity and into the environment key, with no temporal smoothing.

**Failure:**
- With broken cloud, every 0.25 s, or every 3 m the camera moves, the whole island's direct light jumps.
- Everything driven by the sun light jumps with it: leaf translucency and glints (`forest.updateSun` light loop), the cat's `direct`, the motes and the lens's `sunVisible`.
- The bounce term in the environment key changes too, so `buildEnvironment` and PMREM rebuild up to 4×/s, and the environment and sky-light terms step as well.
- On plants, which show the sun's translucency strongly, this reads as flickering lighting. Walking changes the light in steps.

**Fix:**
- Keep `cloudBeamTarget` from the sampled value. Ease `cloudBeam` toward it every frame by wall time (for example `1 - exp(-dt / 0.6)`).
- Sample at a fixed point near the cat's anchor, the shadow anchor (`anchorX`/`anchorZ`), rather than the camera.
- Leave `overcast` out of `bounceUnit` for the environment key, or quantise it to 0.05, so cloud drift alone does not rebuild PMREM.

## S2-2. Sliced shadow refresh against per-instance LOD repacking (CONFIRMED mechanism). Owner: vegetation (`forest.js` `packLod`) and stability (`landscape.js` `renderShadowSlice`)
**Where:** `forest.js:2798-2836` (`packLod` rewrites `mesh.count`/`visible` and the instance buffers of every due chunk, every frame, within budget); `landscape.js:556-581` (casters gathered once at slice 0, slice membership by mesh index `i % count`).

**Defect:**
- A refresh is spread over 4 frames by default (8 when shed).
- Between slices, `packLod` moves instances from one level's InstancedMesh to another's (a different mesh, so a different `i`, so a different slice).
- An instance can therefore sit in a mesh whose slice was already drawn before the move, and in a mesh whose slice is drawn after it. It ends up missing from the completed map or drawn twice.
- Meshes whose `count` fell to 0 are skipped (`visible = false`) at their slice even if they refill later.

**Failure:**
- While the cat walks, which is exactly when the anchor triggers refreshes, plant shadows have holes or doubles until the next refresh.
- Plants and ground change shading as each refresh lands: the "plant lighting flickering".
- The fades in the map are those of `LOD_EYE` at slice time, which also differ from slice to slice.

**Fix (pick one):**
- (a) `forest.js` exposes `freezeLod(bool)`. `renderShadowSlice` freezes packing (and `LOD_EYE`) from slice 0 until the refresh completes. Packing is cheap to defer.
- (b) Slice by chunk rather than by mesh: tag each LOD chunk's meshes with one slice index, `chunkIndex % count`. Every level of a chunk is then drawn in the same frame, and instances only move within a chunk.
- (c) Draw every LOD mesh in every slice and slice only the other casters. LOD meshes are most of the cost, though, so (b) is better.

## S2-3. Stalls about 5-11 s after load: re-wraps recompile mid-frame; prewarm and the pipeline build share one task (stalls CONFIRMED; blank screen PLAUSIBLE). Owner: stability (`landscape.js`, `main.js`), with `land-magic.js`/`forest.js` for the wrappers
**Where:**
- `landscape.js:321-324`: `magicScan % 300 === 30` runs `lightWithMagic` and `groundAnimals` at frames 30, 330, 630, … 2130.
- `land-magic.js:234-258` and `forest.js:1538-1553`: the wrappers, each wrap setting `m.needsUpdate = true` with a new program key.
- `landscape.js:291-306`: `prewarm`.
- `main.js:780-788`: the prewarm timer.

**Defect:**
- Materials built lazily (the cat's coat after its bake, animal forms) are wrapped on whichever scan first sees them. Each wrap forces a new program, compiled synchronously in the frame that draws it.
- The scan frames fall at about 5.5 s and about 10.5 s after load at 60 fps (about 11 s and 21 s when the 30 fps idle pace applies), the same window as the prewarm idle callback (4 s plus up to 3 s).
- Prewarm compiles the pre-wrap programs of anything wrapped later, so that work is wasted, and the post-wrap programs still compile mid-frame.
- `warm()` also calls `wakeMagicPasses()` (WebGPU pipelines) in the same task as `compileAsync`. `compile()` itself is synchronous over the whole scene, with every hidden object (sleeping gifts, far LOD levels, crossfade copies) shown.
- Correction to first-pass #1: the variants prewarm compiles are the right ones, because the MSAA target is flagged as XR.

**Why a "blank blue" rather than a frozen frame (PLAUSIBLE):**
- A long synchronous compile in the GPU process can trip Chrome's GPU watchdog and lose the WebGL context. three then shows a transparent canvas until `webglcontextrestored`, while the WebGPU sky keeps presenting. That reads as about 3 s of blue sky.
- Nothing in `src` listens for `webglcontextlost` (grep finds none), so this cannot be confirmed from the code.

**Fix:**
- Run the wrap scan from material creation (a hook in `animal-forms.js`/`cat-coat.js`), or at least before `prewarm`, and then not again.
- Call `prewarm` after the last scan, and spread it over idle callbacks without the 3 s forced timeout.
- Give `wakeMagicPasses` its own callback.
- Add `canvas.addEventListener("webglcontextlost", …)` that logs and counts losses into `canvas.dataset`, so the next report says whether the blank was a context loss.

## S2-4. Land canvas resized outside a frame, with no draw before the composite (PLAUSIBLE). Owner: stability (`main.js`)
**Where:** `main.js:930` (reveal steps, a `setTimeout` calling `applySizes`); the `resize` listener at 374; `applySizes` at 1306-1322 (`renderStill()` draws only under reduced motion); `tick` (`if (timestamp - state.lastFrame < interval - 3) return;`).

**Defect:**
- `renderer.setSize` (and the WebGPU `output.resize`) clears the canvas. When `applySizes` runs from a timer, nothing draws until the next `tick` that is not skipped.
- On a 120 Hz screen with a 60 fps target, every other `tick` is skipped. At the 40/30 fps quality levels, and at the 30 fps idle pace, more are skipped.
- The cleared, transparent land canvas can therefore be composited over the sky.

**Failure:** During the reveal (5 steps, 260 ms apart) and on every window resize, the land can blink out for a frame or more. It reads as the view re-rendering. With the 30 fps idle pace, it can stay blank for up to about 33 ms.

**Fix:** Do not resize from timers. Set `state.sizesDirty = true` and apply it at the top of `tick`, the same way `qualityChanged` is applied, so the resize and the draw happen in the same frame. Alternatively, force `frame()` straight after `applySizes` whenever the loop is running.

## S2-5. Shadow refresh quantised to about 0.3° of sun direction, so long shadows jump at low sun (PLAUSIBLE). Owner: stability (`landscape.js`)
**Where:** `landscape.js:349` (`Math.round(sunWorld.* × 200)`), and `602` (the finished back map replaces the front map in one step).

**Defect:** The map changes all at once when the quantised direction ticks over. A shadow's length goes as h / tan(altitude), so near the horizon a 0.3° step moves a 10 m tree's shadow tip by more than 1 m.

**Failure:**
- In live time near sunrise and sunset, about once a minute, every long shadow jumps at once.
- While the time slider is scrubbed, shadows step.
- Through dusk, `sunWorld` sweeps from the sun to the moon as `night` rises (`updateDirection`), with the same steps.

**Fix:**
- Scale the quantum by altitude: finer when `sunWorld.y` is small, which costs more refreshes, already sliced.
- Or crossfade the front and back maps over a few frames (two shadow lookups during the fade).

## S2-6. Practical-light slot 3 hard-switches between lamps (CONFIRMED). Owner: unassigned (`land-magic.js`)
**Where:** `land-magic.js:366-395`.

**Defect:** Slot 3 holds one light: whichever lamp or keepsake practical is nearest the cat (by an argmin each frame), with no hysteresis and no fade.

**Failure:** After the lighthouse wakes, at night, walking between two lamps (or between a lamp and the wreck's ember or the pool's light) turns off the whole pool of light around the one behind as the cat crosses the midpoint. That lamp's light is visibly still in view: lighting pops.

**Fix:**
- Keep the current choice until another candidate is 20% nearer.
- Crossfade by easing `colours[3]` down, swapping position at zero and easing up over about 0.3 s.
- Or use two slots, so the two nearest always light, and fade by weight.

## S2-7. The waking catch flickers at about 6 Hz for five of the six gifts (CONFIRMED). Owner: unassigned (`waking.js`)
**Where:** `waking.js:58-66` (gutter `|sin(s × 9.5)|`, about 3 Hz: the comment there says "inside photosensitivity guidance, do not raise it"); `88` and `122` (`lampCatch(s * k)` with `k = spec.catch ?? 2`).

**Defect:** Every gift except the lamp has no `catch` field, so k = 2. The gutter then runs at about 6 Hz for about 0.8 s, on the body light that lights the surroundings (up to `body` metres, `night` peak 3-4.5). The same applies on the sea (`wakingSea`).

**Failure:** A strobing flash at about 6 Hz over a large part of the screen at night. That is above the three-flashes-per-second guidance the code itself cites.

**Fix:** Apply `k` to the swell only, not the gutter: `lampCatch(s, k)`, with the gutter phase kept at `s * 9.5`. Alternatively, cap the gutter frequency at 3 Hz when `k > 1`.

## S2-8. Lightning at night drops the night fill on foliage (CONFIRMED). Owner: stability (`landscape.js`)
**Where:** `landscape.js:380-384` compared with `709`.

**Defect:**
- The normal path calls `forest.updateSkySH(…, exposure * nightFill)`, where `nightFill` is up to 1 + 4.5 × starLift at night.
- The flash path overwrites it with `exposure * (1 + skyFlash)`, which leaves `nightFill` out.
- `scene.environmentIntensity` and `CAT_SKY` keep it.

**Failure:** In a night storm, each lightning flash makes the foliage sky light (spherical harmonics) darker by up to about 5×, while the ground and rocks brighten. Plants strobe dark against the flash.

**Fix:** Multiply the existing value instead of replacing it: `forest.updateSkySH(skySH.coefficients, exposure * nightFill * (1 + skyFlash))`. That means hoisting `nightFill` out of `updateLighting` or returning it.

## S2-9. The loading picture is painted with the wrong seed and stale lighting constants (seed CONFIRMED, lighting PLAUSIBLE). Owner: loading (`loading-screen.js`), plus one line in `main.js`
**Where:** `loading-screen.js:377` (`seed: Number(params.get("seed")) || 1`); `main.js:102` (`sceneSeed()` returns a random 32-bit seed when there is no `?seed`), with `seed` never passed to `loading.scene`; `loading-screen.js:227-229`.

**Defect:**
- Without `?seed`, which is the normal visit, the veil places its clouds (`paint` 314-338) with seed 1, while the world uses a random seed.
- Its night ambient `1 + 2.5 × night` predates `NIGHT_LAND` (fill 4.5, key 0.25, moon 0.3).
- Its direct light uses `1 - 0.85 × cover`, not the world's cloud transmission.

**Failure:**
- The clouds in the picture are not where the world's clouds are.
- At night the picture is darker and flatter than the world it dissolves into.
- This is the "loading picture does not match the world" report.
- The low resolution is by design (`PAINT_PIXELS = 52000`).
- Correction to first-pass #6: `scene()` is a no-op after `ready()` (`state !== "loading"`), so there is no work after the reveal.

**Fix:**
- Call `loading.scene({ seed: state.seed })` from `main.js` once the seed is known, and accept `next.seed` in `scene()`. Or move the random seed choice into a module both files import.
- Import `NIGHT_LAND` (export it from `landscape.js` or a small constants module) instead of the 2.5.

## S2-10. The quality governor in interval mode keeps trying restores (PLAUSIBLE). Owner: stability (`quality.js`)
**Where:** `quality.js:105-108` (`interval: { shed: 1.22, restore: 1.06 }`), `120-131`.

**Defect:**
- Without timestamp queries (Safari, Firefox, or any GPU without `timestamp-query`), the cost is the frame interval.
- An interval that hits vsync is about 1.0 × period, which is always below the restore threshold. A restore is therefore always "roomy" after 1.5 s, however close to the limit the GPU is.
- The back-off only doubles when the restored level fails within `failWindow` (6 s). A level that holds 7 s, then sheds, then is restored again 1.5 s later, never backs off.

**Failure:**
- On such browsers, the level oscillates every ~8-10 s.
- Most top steps change `landScale` (a canvas resize), `shadowSlices` or `lodBias` (re-packs every chunk), so the view visibly re-renders each time.

**Fix:**
- In interval mode, also require the CPU frame time (`cpuMs`) to be under about 0.5 × period before restoring.
- Count a shed within about 30 s of a restore as a failure.

## S2-11. Per-frame allocations in the LOD packer (CONFIRMED, minor). Owner: vegetation (`forest.js`)
**Where:** `forest.js:2803` (`eye.clone()`), `2806` (`due` array), and `packDue` → `chunkLevel` → `chunkRange`, which allocates a 2-element array per chunk per frame and again in every comparison of `due.sort`.

**Fix:**
- Reuse a scratch vector.
- Have `chunkRange` write into a module-level scratch array, or return `near` only, through a separate `chunkNear` function.
- Sort by a precomputed `chunk.near`.

## Checked and found sound (second pass)
- `terrain.js` vertex-height cache (one canonical position per vertex).
- `near-ground.js` `setCat` (`cat` is initialised as `[0, 0]`).
- `instance-lod.js` level choice: fade bands hide per-instance swaps, so no hysteresis is needed.
- Waking curves are NaN-guarded (`!(s >= 0)`).
- `waking_on_sea` and `point_light_on_sea` guard their divides; the boat hull terms in `ocean.wgsl` are `all_finite`-guarded.
- `crossfade` alpha-hash: three's shadow depth materials ignore `alphaHash`, so the crown's shadow stays whole.
- The places' lamp beam, halo and pool are gated by `dark` as intended.
- `sun.layers.enable(3)` keeps the light state equal in both passes, as its comment says.
- `loading.scene()` is inert after `ready()`.

## Still not reviewed
- `place-lighthouse.js` and `place-wreck.js` beyond their update hooks, which hold no per-frame matrix work.
- The rest of `place-kit.js` material patches.
- The remainder of `wake.wgsl` (new, 254 lines): only its divisions were scanned. `ripple()` divides by `r` at line 34 with no floor, but that code predates this diff.
- `sea-sky-magic.js`, `fireflies.js`, `wisp.js`: outside the listed scope.
