# Rendering code review: magic-round2 (9084787..magic-round2)

Partial review: the coordinator asked for a wrap-up before every file in scope was read. The files read in full or in diff are `src/main.js` (diff), `src/landscape.js` (lines 60-700 plus the whole diff) and `src/cat.js` `renderShadow`. The unreviewed files are listed at the end.

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
