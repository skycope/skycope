# Waking light: the moment a gift wakes

Design for HANDOVER thread C5 ("the light and flash"). Branch `magic-round2`, read at `dc0cb8f`.

Status of this document: designed from the code and the research sheets. I did not run the site, so no intensity, colour or cost in here has been seen or measured. Every number is a starting value with an acceptance test beside it (section 9). ALU counts are estimates from reading the shaders.

The owner's words this answers:

- "needs to be more magic on the objects - some of them say things but nothing really happens - also the light / flash stuff could be a lot more magical"
- "the point isn't 'overwhelm the user with random new glitchy elements' it's 'make the world way more fun and magical to interact with'"
- "many of the new things seemed overwhelming / too much"

## 1. The idea

**A lamp is lit, and you watch its light arrive.**

Today a waking draws three things that are not light: a 6 m rainbow-rimmed bubble (`wisp.js` burst), a flat ring that runs 150 m across land and sea at 18 m/s ignoring every surface normal (`magicPulse`, `pulse_on_sea`), and an albedo-free edge term (`mEdge`) that paints foliage lime or white. Plants bow away from it as from a blast.

Replace all three with one real point light at the keepsake, the *kindled light*:

1. It has a **source you can see**, a point a few centimetres across sitting in a shaded recess of the object (a hollow, a furnace mouth, a lantern room, under water).
2. It **catches** like a wick: a spark, two gutters, a swell.
3. Its light **reaches outward** as a decelerating wavefront. Behind the front the world stays lit (inverse-square from the source, multiplied by albedo, by which way the surface faces). Nothing is lit ahead of the front.
4. The front itself adds only **specular**: a narrow band of glints on whatever is glossy or edge-on. Wet sand, leaf edges, rock rims, the cat's fur fringe, wave crests. This is what carries past the few metres where diffuse light is visible.
5. It **lingers** as sparse twinkling glints inside the lit zone, and a few motes in the air.
6. It **resolves**: the body light sinks to a lantern-sized practical at the source, which is the gift's steady light from then on.

One mechanism, seven rows of numbers (six gifts and the finale). Restraint is structural: land reach is 14–60 m, never the island; nothing albedo-free covers area; no full-screen term exists.

By day emission is nearly invisible, so the same beats are carried by: light in the *shaded recess* the source sits in (visible at noon because it is in shade), sun-glints that the front switches on in sequence, a breath of air through the plants, the object's own motion, motes, and sound.

## 2. What a first-time visitor finds confusing today, and what replaces each

| Today | Why it confuses | Replacement |
|---|---|---|
| Pulse ring over land (`magicPulse`, land-magic.js; 18 m/s to 150 m) | Reads as sonar or a shockwave; no source; lights the far side of hills | Lit zone growing from a visible source, 14–60 m |
| Lime / white wash on foliage (`mEdge`, and `magicPulseColour` saturated ×2.2 at night) | Looks like a rendering fault | Light × albedo only; specular confined to glints |
| Burst sphere (`wisp.js` slot `burst`, 6 m, `prism()` rim) | A sci-fi shield bubble | A 6–14 cm kindled point with a small halo |
| Plants bowing away (`WIND_GLSL` pulse block, up to 32 cm) | A blast wave | A breath: 4.5 cm at most, inside the reach only |
| Pulse wash on the sea to the horizon (`pulse_on_sea`) | Neon band; boulders turn see-through as it passes (QA-known) | Glitter road and crest catch within sea reach |
| Time slows to 0.3 for 1.8 s (`journey.js` `stage`) | The sea freezing looks like a dropped frame rate | Scale 0.6 for 1.2 s; the light runs on wall time |
| Card at 0.6 s (`WAKE.card`) | Type covers the event; "seafolk" names an effect that is not there | Card at 2.4 s; seafolk's card needs its practical (5.5) |
| Wisp gone 2.1 s, then `flare = 1.2` | By day a sun-sized white flare (look-research) | The kindled point *is* the wisp re-lit; flare 0.5 by day |
| Paw-print glow in a mix of all woken colours (`mixGiftColour`) | Colour means nothing | Prints answer tideglow only (blue, wet sand); otherwise off |
| `prism()` rainbow on the burst and ribbon | A third colour language | Removed from the burst; drop from the ribbon too |
| One generic `wake` sound (4 bells, low bloom) under the score's phrase | Two musical events at once, the same for every gift | Diegetic cues per beat (section 6); the score phrase stays |
| Lamps, panes and halos lit at noon (object-audit C) | Glow with no darkness to glow in | Practicals gated by night (already in the audit; this design depends on it) |

Not in this design's scope but on the same list for thread F: every firefly flashing at once on a meow; the finale's spirals of light round the island.

## 3. The shared mechanism

### 3.1 Record and clock

New pure module **`src/waking.js`** (no three.js, no DOM; unit-testable). `magic.js` loses `PULSE` and `magic.pulse`; it gains:

```js
// magic.waking: null, or the one waking in progress
{ gift, x, y, z,          // source, coast metres (updated each frame if `follow` is set)
  age,                    // WALL seconds since the gift woke
  follow: null | () => [x, y, z],   // boat: the lantern moves
  frozen: false }         // QA: age does not advance
```

`magic.update(dt, time, realDt = dt)`: `if (waking && !waking.frozen) waking.age += realDt; if (waking.age > WAKING.end) waking = null`. `main.js` line 797 passes `realDt`. Wall time, because the ceremony slows scene time and the light must not crawl.

`journey.js` `wakeNow()` sets `magic.waking = { gift, ...source, age: 0 }` in place of `magic.pulse = {…}`. `ceremony.y` becomes the source height (below) so the wisp dives *into the source*. `quest.beginAgain()` nulls it.

Only one waking exists at a time (`restUntil` already guarantees 4 s between ceremonies; a second `wake` replaces the first).

### 3.2 The curves

```js
export const WAKING = { start: 0.35, tau: 1.5, hold: 3.0, fade: 3.0, end: 16 };

// s: wall seconds. spec: a row of WAKE_LIGHT. night: 0…1. reduced: prefers-reduced-motion.
export function wakingAt(s, spec, night, reduced = false) {
  if (!(s >= 0) || s > WAKING.end) return ZERO;
  const k = spec.catch ?? 2;                       // lamp 1 (its own 4 s catch), others 2
  const caught = reduced ? smooth(s, 0, 1.5) : lampCatch(s * k);   // land-magic.js, moved here
  const settle = spec.rest + (1 - spec.rest) * Math.exp(-Math.max(s - WAKING.hold, 0) / WAKING.fade);
  const peak = spec.day + (spec.night - spec.day) * night;
  const u = Math.max(s - WAKING.start, 0) / (spec.tau ?? WAKING.tau);
  const radius = reduced ? spec.reach : spec.reach * (1 - Math.exp(-u));
  const spent = 1 - radius / spec.reach;           // 1 at the source, 0 at full reach
  return {
    radius,                                        // m
    width: 0.6 + 0.05 * radius,                    // m, the front's half-width
    inside: peak * caught * settle,                // I: the body light
    front: reduced ? 0 : (spec.frontDay + (spec.front - spec.frontDay) * night) * smooth(s, WAKING.start, WAKING.start + 0.3) * spent ** 1.5,   // F
    glint: spec.glint * smooth(s, 0.8, 2.2) * Math.exp(-Math.max(s - 4, 0) / 4),   // G
  };
}
```

`lampCatch` already exists (spark by 0.25 s, two gutters at about 3 Hz, swell to full): it is the one catch curve for every gift. At `k = 2` the light is at 28% by 0.13 s, dips, 66% at 1.0 s, full at 1.8 s. Two dips at 3 Hz is inside photosensitivity guidance; do not raise the gutter rate.

Front speed: starts at `reach / tau` (16–40 m/s) and decelerates, 63% of reach at 1.85 s, 95% at 4.85 s. It reads as a light being turned up, and the front dies (`spent^1.5`) before it stops, so there is no edge left standing.

Reduced motion: no travelling front, no flicker, no breath; the light eases up in place over 1.5 s.

### 3.3 The table

Colours are linear RGB, the light's own colour (surfaces multiply it by albedo). Intensities are in the land shader's exposed units, the same scale as `magicGlowColour` (for reference: the wisp at night is about 0.2–0.38 at its centre, the milkwood's pool at most 0.4).

```js
export const WAKE_LIGHT = {
  //           tint (linear RGB)        core  reach  night  day   front frontDay glint rest  sea reach / hold
  fireflies: { tint: [1.00, 0.74, 0.28], core: 1.8, reach: 24, night: 0.85, day: 0.22, front: 0.50, frontDay: 0.25, glint: 0.5, rest: 0,    sea: 0 },
  tideglow:  { tint: [0.10, 0.55, 1.00], core: 1.6, reach: 30, night: 0.70, day: 0.12, front: 0.70, frontDay: 0.35, glint: 0.8, rest: 0,    sea: 120, seaHold: 8 },
  lamp:      { tint: [1.00, 0.66, 0.26], core: 5.0, reach: 46, night: 1.10, day: 0.20, front: 0.45, frontDay: 0.20, glint: 0.3, rest: 0,    sea: 150, catch: 1, tau: 2.2 },
  stars:     { tint: [0.62, 0.72, 1.00], core: 1.2, reach: 60, night: 0.30, day: 0.05, front: 0.35, frontDay: 0.30, glint: 1.0, rest: 0,    sea: 0, up: 1 },
  seafolk:   { tint: [0.20, 0.80, 0.60], core: 1.4, reach: 14, night: 0.60, day: 0.12, front: 0.40, frontDay: 0.20, glint: 0.4, rest: 0,    sea: 90, ripple: 0.4 },
  boat:      { tint: [1.00, 0.50, 0.16], core: 1.5, reach: 26, night: 0.80, day: 0.18, front: 0.50, frontDay: 0.25, glint: 0.4, rest: 0,    sea: 80 },
  finale:    { tint: [1.00, 0.90, 0.72], core: 3.0, reach: 60, night: 0.90, day: 0.20, front: 0.50, frontDay: 0.30, glint: 0.6, rest: 0,    sea: 150 },
};
```

`rest` is 0 everywhere because the steady light is handed to the practical (3.7), not left in this term. These tints replace `GIFT_COLOURS` (magic.js) and `STEP_COLOURS` (land-magic.js) as the one colour table: export `GIFT_COLOURS` from `waking.js` as the tints. `moments.js` gift marks keep working (they only need an rgb triple). `lamp` and `boat` reuse the constants already in `sea-magic.wgsl` (`LAMP_COLOUR`, the lantern `flame`); `tideglow` is `TIDEGLOW.colour`.

Do not saturate the colours for the night tonemap as the pulse did (`k = 1 + 1.2 * night`). The `cones` fix (look-research 5.2) keeps bright warm light warm; if a tint greys at night, raise its intensity, not its chroma.

### 3.4 Where the source sits

Coast metres. Until the prop contract (`place-kit.js` `lights`, object-audit mechanism B) lands, `waking.js` resolves it from what `places.js` already exposes; when it lands, each keepsake's `lights[0]` is the source and this table goes.

| Gift | Source | Today's data |
|---|---|---|
| fireflies | A hollow in the milkwood's bole, 1.6 m up | `places.crown` → `(crown.x, crown.ground + 1.6, crown.z)` |
| tideglow | Inside the boiler's furnace mouth, 0.6 m above the sand | wreck poi, `surface + 0.6` (after the audit's rework: the furnace opening) |
| lamp | The lantern room | `places.beacon` (x, y, z) |
| stars | The tip of the trig pillar's vanes | beacon poi, `surface + 2.0` |
| seafolk | 0.2 m under the rock pool's surface, at its centre | pool poi, `surface − 0.15` |
| boat | The boat's hurricane lantern; it moves | `state.boat.lantern` via `follow`; else boat poi, `surface + 0.9` |
| finale | The wisp, soaring over the cat | `magic.wisp.position` via `follow` |

Every source except the stars' is in shade at noon. That is deliberate: it is why the first two metres of light read by day.

### 3.5 Land: uniforms and the shared GLSL chunk

In `land-magic.js`, delete `magicPulse`, `magicPulseColour`, the pulse branch of `MAGIC_LIGHT_GLSL` (including `mEdge`), and the pulse block of `createLandMagic().update`. Add to `magicUniforms()`:

| Uniform | Type | Contents |
|---|---|---|
| `wakeSource` | vec4 | source in Three world (x, y, −z), w = core radius a |
| `wakeFront` | vec4 | x radius r, y width w, z front F, w glint G |
| `wakeColour` | vec3 | tint × inside I |
| `wakeTint` | vec3 | tint |
| `wakeShape` | vec4 | x ripple (seafolk), y up-bias (stars), z unused, w unused |
| `wakeCat` | vec4[2] | the cat's chest and haunch in Three world, w = shadow strength (ground material only reads it) |

`update()` fills them from `wakingAt(...)` and sets `on = 1` while `inside + front + glint > 0`; otherwise all zero. `magicOn` stays the single gate, so asleep cost is unchanged.

`MAGIC_LIGHT_DECLARATIONS` gains the uniforms and two helpers shared with the dew:

```glsl
// Rare round points a pixel or two wide that twinkle as the eye moves; fade out
// where a cell is bigger than that on screen. (The dew's code, as a function.)
float magicSparkle( vec3 world, vec3 view, float scale, float rare ) {
  vec3 gp = world * scale;
  vec3 cell = floor( gp );
  float h = magicHash( cell );
  float spot = 1.0 - smoothstep( 0.12, 0.3, length( fract( gp ) - 0.5 ) );
  float small = 1.0 - smoothstep( 0.6, 2.0, scale * length( fwidth( world ) ) );
  return step( rare, h ) * spot * small
    * ( 0.5 + 0.5 * sin( h * 40.0 + magicBeam.w * ( 1.5 + 3.0 * h ) + dot( view, vec3( 30.0 ) ) ) );
}
// The front's band at a world point (0 away from it): for the sun-glint gates.
float wakeBandAt( vec3 world ) {
  float fb = ( length( wakeSource.xyz - world ) - wakeFront.x ) / wakeFront.y;
  return exp( -fb * fb ) * wakeFront.z;
}
```

The block that replaces the pulse branch inside `if ( magicOn > 0.0 ) { … }` (compute `mView` once, above, and let the sheen branch reuse it):

```glsl
vec3 mWake = vec3( 0.0 );      // diffuse: multiplied by albedo below
vec3 mWakeSpec = vec3( 0.0 );  // specular: glints only
if ( wakeFront.x > 0.0 ) {
  vec3 wd = wakeSource.xyz - mWorld;
  float d2 = dot( wd, wd );
  float d = sqrt( d2 );
  // Nothing ahead of the front; outside the band there is no work.
  if ( d < wakeFront.x + 3.0 * wakeFront.y ) {
    vec3 wl = wd / max( d, 1e-3 );
    float a2 = wakeSource.w * wakeSource.w;
    float fall = a2 / ( d2 + a2 );
    float reached = 1.0 - smoothstep( wakeFront.x - wakeFront.y, wakeFront.x, d );
    float ndl = dot( mN, wl );
    // Solids take it as a lamp's light; thin leaves let it round. Stars: from above.
    float lam = clamp( mix( ndl, mN.y, wakeShape.y ) * WAKE_WRAP + ( 1.0 - WAKE_WRAP ), 0.0, 1.0 );
    // Seafolk: light from under moving water.
    float ripple = 1.0 + wakeShape.x * sin( dot( mWorld.xz, vec2( 5.1, 3.7 ) ) + magicBeam.w * 2.3 ) * sin( dot( mWorld.xz, vec2( -2.9, 4.6 ) ) - magicBeam.w * 1.7 );
    float body = fall * lam * reached * ripple;
    #ifdef WAKE_CAT_SHADOW
      body *= wakeCatShade( mWorld );
    #endif
    mWake = wakeColour * body;
    // What catches: edges seen against the light, and gloss.
    float edge = pow( 1.0 - abs( dot( mN, mView ) ), 3.0 );
    float against = clamp( dot( -mView, wl ) * 0.5 + 0.5, 0.0, 1.0 );
    #ifdef STANDARD
      float rough = material.roughness;
    #else
      float rough = 0.85;
    #endif
    vec3 wh = normalize( wl + mView );
    float gloss = pow( clamp( dot( mN, wh ), 0.0, 1.0 ), mix( 180.0, 10.0, rough ) ) * ( 1.0 - rough ) * step( 0.0, ndl );
    float fb = ( d - wakeFront.x ) / wakeFront.y;
    float band = exp( -fb * fb ) * wakeFront.z;
    float lit = sqrt( fall ) * reached;
    // Behind the front: a steady rim and sheen from the body light itself.
    mWakeSpec = wakeColour * lit * ( edge * against * 0.35 * mix( vec3( 1.0 ), diffuseColor.rgb * 4.0, 0.7 ) + gloss * 2.0 );
    // The front: glints running outward. Many cells flash as it passes…
    mWakeSpec += wakeTint * band * ( edge * against * 0.5 + gloss * 1.2 + magicSparkle( mWorld, mView, 55.0, 0.97 ) * 3.0 );
    // …and a few keep twinkling behind it.
    mWakeSpec += wakeTint * wakeFront.w * lit * magicSparkle( mWorld, mView, 55.0, 0.988 ) * 2.5;
    mWakeSpec = min( mWakeSpec, vec3( 0.6 ) );
  }
}
```

and at the end of the block:

```glsl
reflectedLight.directDiffuse += ( mLight + mWake ) * diffuseColor.rgb;
reflectedLight.directSpecular += mLight * 0.035 + mSheen + mWakeSpec;
```

`WAKE_WRAP` is a `#define` set per material in `patchMaterial` beside `SHEEN`: `0.6` for `foliage`, `0.85` otherwise; `lightWithMagic` (cat, animals) defines `0.7`. `STANDARD` is three's own define for `MeshStandardMaterial` (three 0.185, `meshphysical.glsl.js`); Lambert materials (fur shells, some animals) take the fixed roughness.

Wet sand, wet rock and waxy leaves need no special case: their `material.roughness` is already lowered by `detailRoughness`, `gWet`, the swash film and `SHEEN`, so the gloss lobe finds them.

**The cat's shadow** (ground material only; `patchMaterial` adds `#define WAKE_CAT_SHADOW` and this function when `ground` is true):

```glsl
// Does the ray from this point to the kindled light pass through the cat?
// Two spheres (chest, haunch); the penumbra widens with distance from the cat.
float wakeCatShade( vec3 world ) {
  float shade = 0.0;
  vec3 pl = wakeSource.xyz - world;
  float pl2 = max( dot( pl, pl ), 1e-4 );
  for ( int i = 0; i < 2; i++ ) {
    vec3 pc = wakeCat[ i ].xyz - world;
    float t = clamp( dot( pc, pl ) / pl2, 0.0, 1.0 );
    float miss = length( pc - pl * t );
    float along = t * sqrt( pl2 );
    shade = max( shade, ( 1.0 - smoothstep( 0.17, 0.3 + along * 0.06, miss ) ) * smoothstep( 0.05, 0.3, along ) );
  }
  return 1.0 - shade * wakeCat[ 0 ].w * 0.85;
}
```

`wakeCat[i].xyz` = `pose` ± `heading × 0.17 × CAT_SCALE`, y = `pose.y + 0.22 × CAT_SCALE`; `w = night × smooth(I × fall(d_cat), 0.01, 0.06)` (so it is off by day and off when the cat is out of the light). Because the source is low at the wreck, pool, hollow and boat, the shadow is long and rakes across the ground; at the lighthouse it is a small pool under the cat. When the source moves (the boat's lantern swinging as the hull rolls), the shadow swings with it for free.

**Sun-glint gates, for the day** (both use `leafSun`, so only sunlit surfaces flash and at night they do nothing):

- `FOLIAGE_GLSL` (forest.js): before the `gate` line, `float wk = wakeFront.z > 0.0 ? wakeBandAt( cameraPosition + ( vec4( -vViewPosition, 0.0 ) * viewMatrix ).xyz ) : 0.0;` then `gate = max( gate, min( wk * 2.0, 1.0 ) );` and multiply the sparkle add by `( 1.0 + 3.0 * wk )`. A shimmer runs outward through the crowns, leaf by leaf, as when a gust turns them.
- `SAND_GLINT_GLSL`: the grain test becomes `dHash( glintCell + 0.37 ) < 0.1 + 0.25 * wk`, and `flash *= 1.0 + 4.0 * wk`. A line of sun-sparkle runs down the beach.

**The breath** (forest.js `WIND_GLSL`): replace the `magicPulse` block. Positions here are land-group local, which is coast space (the group mirrors z), so un-mirror the source:

```glsl
if ( wakeFront.z > 0.0 ) {
  vec2 pd = p.xz - vec2( wakeSource.x, -wakeSource.z );
  float pl = length( pd ) + 1e-3;
  float fb = ( pl - wakeFront.x ) / ( wakeFront.y * 2.5 );
  float bow = exp( -fb * fb ) * min( wakeFront.z * 2.0, 1.0 ) * h / ( 0.5 + h ) * 0.045;
  offset.xz += pd / pl * bow;
  offset.y -= bow * 0.25;
}
```

4.5 cm at most (it was 12–32 cm). `wakeSource`/`wakeFront` replace `magicPulse` in the vertex declarations.

### 3.6 Sea: one point-light function

`sea-magic.wgsl`: `wisp_on_sea` and `lantern_on_sea` are already point lights on water with the right lobes. Fold them and the waking into one:

```wgsl
// A small light over the water: its broken road of glints toward the eye, and
// the faint pool it spreads on faces and foam turned to it. `core`: its size (m).
fn point_light_on_sea(s: SeaPoint, at: vec3f, colour: vec3f, core: f32) -> vec3f {
  let to = at - s.p;
  let d2 = dot(to, to);
  let l = to * inverseSqrt(max(d2, 1e-4));
  let h = normalize(l - s.ray);
  let nh = max(dot(s.normal, h), 0.0);
  let cell = hash22m(floor(s.p.xz * 6.0)).x;
  let spec = (pow(nh, 600.0) * (1.5 + 5.0 * cell * cell) + pow(nh, 60.0) * 0.35 + pow(nh, 12.0) * 0.05) * s.fresnel * 4.0;
  let pool = max(dot(s.normal, l), 0.0) * (0.03 + 0.35 * s.foam.x);
  let light = colour * (spec + pool) * (core * core / (d2 + core * core));
  return light / (1.0 + max(light.r, max(light.g, light.b)) * 0.6);
}

// A waking's light on the sea. waking: source x, z, front radius, front strength.
// light: tint × inside (rgb), source height (w).
export fn waking_on_sea(s: SeaPoint, waking: vec4f, light: vec4f, time: f32, daylight: f32) -> vec3f {
  let at = vec3f(waking.x, light.w, waking.y);
  let d = length(s.p - at);
  let width = 0.6 + 0.05 * waking.z;                 // = wakingAt().width
  if (d > waking.z + 3.0 * width) { return vec3f(0.0); }
  let reached = 1.0 - smoothstep(waking.z - width, waking.z, d);
  let peak = max(light.r, max(light.g, light.b));
  let tint = light.rgb / max(peak, 1e-4);
  var out = point_light_on_sea(s, at, light.rgb * 6.0, 2.2) * reached;
  // The front: crests and foam turned to the source catch it, and cells flare.
  let fb = (d - waking.z) / width;
  let band = exp(-fb * fb) * waking.w;
  let l = normalize(at - s.p);
  let crest = pow(max(dot(s.normal, l), 0.0), 3.0) * 0.5 + s.foam.x * 0.4;
  let scale = max(0.4, s.pixel * 1.5);
  let g = s.p.xz / scale;
  let pace = time * 2.5 + hash22m(floor(g)).y * 9.0;
  let hh = hash22m(floor(g) + floor(pace) * 0.37);
  let spot = 1.0 - smoothstep(0.08, 0.25, length(fract(g) - 0.25 - hh * 0.5));
  let flare = (1.0 - fract(pace)) * (1.0 - fract(pace));
  let glitter = step(0.88, hh.x) * spot * flare;
  // By day the front is the sun's own glitter switched on in a line.
  out += mix(tint, vec3f(1.0), 0.5 * daylight) * band * (crest + glitter * 2.0) * (0.5 + daylight);
  // Glints lingering in the lit water, thinning as the body light fades.
  out += tint * peak * reached * glitter * 1.5;
  return out;
}
```

`pulse_on_sea` and `PULSE_SEA_REACH` are deleted. `wisp_on_sea(…)` becomes `point_light_on_sea(point, wisp.xyz, colour * wisp.w * 0.8, 3.5)` and `lantern_on_sea` `point_light_on_sea(point, lantern.xyz, flame * lantern.w * (0.4 + 0.6 * night), 1.8)` — check both against today's frames; if either shifts visibly, keep its old function and only add `waking_on_sea`.

**No uniform-struct change.** The existing `pulse` and `pulseColour` Atmosphere fields are reused with new meanings (rename them `waking` / `wakingLight` in view.wgsl, ocean.wgsl `OceanSettings`, water.wgsl, `MAGIC_FIELDS`, `render-sky.mjs` as a second, mechanical commit):

- `pulse` = `[x, z, seaRadius, F]`
- `pulseColour` = `[tint × Isea (rgb), source y]`

`sea-sky-magic.js magicUniforms`: compute `w = wakingAt(age, spec, night)` but with the sea's own reach and tail: `seaRadius = spec.sea * (1 - exp(-u))` (same `u`), `Isea = peak × caught × exp(-max(age − (spec.seaHold ?? 3), 0) / 3)`. Zero both fields when `spec.sea === 0` or the radius has not reached the shore (`seaRadius < distance from source to the nearest sea` is not known on the CPU; skip this test, the shader's distance cull does it). `magicPasses` keeps its `on("pulse", 3)` test, but `pulse[3]` is now F, which is 0 during the linger: test `pulse[2] > 0` (radius) instead.

`ocean.wgsl` line 497: `if (settings.pulse.z > 0.0) { color += waking_on_sea(point, settings.pulse, settings.pulse_colour, settings.time, clamp(dot(settings.skylight, vec3f(0.2126, 0.7152, 0.0722)) * 2.5, 0.0, 1.0)); }`.

The see-through boulders: I could not reproduce it from the code. `waking_on_sea` must not add light where the sea pass is under a rock; if frame C of 5.2 still shows it, multiply by `smoothstep(0.0, 0.15, s.rock_edge)` and report what the cause was.

Pipelines: the awake water pipeline is already compiled by the time of any waking (the wisp wakes it). The awake **sky** pipeline is first needed at the stars' waking and compiles asynchronously, so the figures start late. Call `wakeMagicPasses()` from `journey.start()` (expose it as `state.prewarmMagic`) so it is ready before the wisp lands.

### 3.7 Resolve: the practical

"The waking light never goes out; it shrinks into something the size of a lantern." This is the look-research's one register that works (warm practical light in a blue night), and it gives every gift a visible steady state at its keepsake.

`land-magic.js` glow slot 3 is "the nearest of the island's lamps", all gated by the `lamp` gift through one scalar `state.lampLights`. Generalise the list (`places.lamps` → `practicals`): each entry `{ x, y, z, colour, reach, power, gift }`, lit by `levels[gift] × its own night gate`, slot 3 = the nearest *lit* one to the cat. Existing lamps get `gift: "lamp"`. Add one entry per keepsake source:

| Gift | Practical | colour (linear) | reach m | power | Gate |
|---|---|---|---|---|---|
| fireflies | none new: glow slot 1, the crown's pool, is it | | | | |
| tideglow | an ember in the furnace mouth | [0.10, 0.55, 1.00] | 1.6 | 0.35 | night |
| lamp | none new: `magicLamp`, the beams, the necklace | | | | |
| stars | none: the dew and the sky are it | | | | |
| seafolk | the pool lit from below | [0.20, 0.80, 0.60] | 2.2 | 0.45 | night |
| boat | the hurricane lantern (`lantern` uniform and `catLamp` afloat; a practical entry while ashore) | [1.00, 0.50, 0.16] | 2.6 | 0.6 | night |

Still one glow evaluated per fragment for all practicals: no added cost. The hand-over is a crossfade: the practical's level is `smooth(age, 3, 8)` while the waking's `inside` decays from 3 s, so the sum never dips to dark and never doubles.

### 3.8 The kindled point (wisp.js)

Rewrite slot `burst` (kind 3) from the bubble to the source point; rename `burst` → `kindle`, `burstColour` → `kindleColour`, delete `BURST_SECONDS`.

- Vertex: `centre = kindle.xyz; size = 0.06 + 0.08 * kindle.w` (m, half-size of the quad is ×4 for the halo: use `size * 4.0`), `minPx = 7.0`, `vBright = kindle.w`, `lift = 0.8`.
- Fragment: `hot = exp( -r2 * 40.0 )`, `halo = 1.0 / ( 1.0 + r2 * 22.0 ) - 1.0 / 23.0`; `c = ( mix( kindleColour, vec3( 1.0 ), 0.6 ) * hot * 3.0 + kindleColour * halo * mix( 0.25, 0.6, night ) ) * vBright;` No rim, no `prism()`, no `gifts()` palette.
- `update`: `kindle.w = wakingAt().inside / peak` (0…1, carries the flicker) for `age < 8`, then `× (1 − smooth(age, 6, 8))`; `mesh.visible` while it is above 0.004.
- The veiled pass draws it too (remove kind 3 from the `VEILED` discard): the light in the hollow shows through leaves at a fifth strength, as the wisp does.

Also delete the dead pool code in the same file (`POOL`, `POOL_RADIUS`, `SLOT.pool`, `heights`, `pool`/`poolOrigin` uniforms, the kind 4 branches): no vertices use it.

`wisp-mind.js` "gone" → "emerge": the wisp comes out of the source (it already does, from `dive.y`); set `flare = 0.5 + 0.7 * night` in place of `1.2`.

### 3.9 Motes and sparks (optional garnish, last in the build)

Glints are the main linger. Particles are for the three places they earn it: the boat's wick, the milkwood by day, the finale. Reuse `createDust` (cat-ground.js), which already flies particles on the GPU from a birth record and skips its draw when none is alive. Add a third variant, `{ ember: true, grains: 96 }` (`#define EMBER`):

- Sparks (`size < 0.004`): `life = 0.5 + 0.7 * birth.y`, drag `k = 2.5`, gravity `g = 6.0`.
- Motes (`size ≥ 0.004`): `life = 5.0 + 4.0 * birth.y`, `k = 1.4`, buoyant `g = -0.2`, plus `emberWind.xz * t * 0.6` and a small eddy `sin( t * 1.3 + birth.y * 40.0 ) * 0.08`.
- Point size `clamp( size * dustScale / dist, 1.5, 5.0 )`; brightness `sin( π * t / life )`.
- Colour: `emberColour` (tint × `0.9 × night`) + `emberSun × phase` with motes.js's forward-scatter phase (so by day they are sunlit seed-down, bright looking toward the sun, against shade).
- Blending as motes.js (add colour, leave alpha).

Spawn in `landscape.render` when `magic.waking.age` crosses a beat (`add(time, x, y, z, vx, vy, vz, size, floor)`):

| Gift | Sparks at 0.35 s | Motes over 0.6–4.5 s |
|---|---|---|
| fireflies | 0 | night 0 (the flies are the embers); day 40 |
| tideglow | 0 | 0 |
| lamp | 0 | 0 |
| stars | 0 | 0 |
| seafolk | 0 (a `splash.burst` of 12 drops from the pool surface instead, `size [0.004, 0.01]`, `up [0.4, 0.9]`) | 0 |
| boat | 14 | 10 |
| finale | 0 | 60 |

## 4. Cost

| | Asleep / no waking | During a waking (≤ 16 s, seven times in a playthrough) |
|---|---|---|
| Land fragment | 0 (inside the existing `magicOn` branch; if another gift holds `magicOn`, one extra uniform compare) | about 50–60 ALU where `d < r + 3w`; one compare elsewhere. No texture fetch. Replaces the ring (about 12 ALU) |
| Ground fragment | 0 | + about 25 ALU for the two-sphere shadow, at night only (`wakeCat.w > 0`) |
| Foliage / sand sun-glint gates | one uniform compare | + about 10 ALU (`wakeBandAt`) |
| Land vertex | one uniform compare (as today) | about 12 ALU, the same as the bow it replaces |
| Sea fragment | 0 (`MAGIC_AWAKE` variant; `pulse.z == 0`) | about 40 ALU inside the radius; replaces `pulse_on_sea` (about 40). Wisp and lantern unchanged in count |
| Draw calls | 0 | 0 for the point (the wisp's own draw), + 1 for motes while any is alive (boat, fireflies by day, finale only) |
| Particles | 0 | ≤ 60 of a 96 pool |
| Passes, render targets, textures, lights, shadow maps | none | none |
| Shader programs | the same set (the chunk is in every patched program today); one extra define on the ground program | no compile at wake |
| CPU | `if (!magic.waking)` | one `wakingAt` per frame, six uniform writes |

Net code: the sea file gets shorter (three functions become two); `wisp.js` loses the pool; `land-magic.js` loses its pulse block and gains the chunk.

Measure, do not trust the table: same-tab A/B at the wreck at night with `skycope.waking.freeze("tideglow", 2.2)` on and off, land and water passes separately (protocol in the visual-QA memory note). Budget: land +0.15 ms, water +0.1 ms on the M4 while frozen at the worst age; 0.00 ms when cleared.

## 5. The six gifts

All times are wall seconds after `wakeNow()` (T = 0 as the wisp vanishes into the source). Shared beats: **dark** 0–0.35, **catch** 0.35–1.0, **reach** 1.0–4.5, **linger** 2.5–10, **resolve** 6–16. Card at 2.4 s (`WAKE.card`), held 3.4 s. Sound cue names refer to section 6.

Capture for every frame below: `/?perf&seed=1847&weather=clear`, the other five gifts asleep unless stated, the `#time` slider at 1320 (night) or 750 (noon), the cat placed 5 m from the source with the ceremony's own shot (`SHOTS[gift]` in journey.js) so the source stands beyond the cat, then `skycope.waking.freeze(gift, T)`. Coordinates are seed 1847.

### 5.1 Fireflies: the old milkwood (27.1, 73.9)

- **Source**: the hollow in the bole. Gold, not lime: [1.00, 0.74, 0.28]. Green lives only in the flies themselves.
- **0–0.35 dark**: the wisp is gone into the hollow. Under the dome it is the darkest place on the island.
- **0.35–1.0 catch**: a point of gold in the hollow gutters twice. The fissured bark beside it is lit raking, each ridge with a rim. Leaf litter within 2 m warms.
- **1.0–4.5 reach**: light fills the dome from inside: limbs rim-lit, the undersides of the leaves lit from below (`ndl` on downward normals), falling to dark at the crown's edge. The front leaves the crown at about 1.6 s and runs out over the grass as a line of glints on blade tips, to 24 m. The cat's shadow points away from the bole.
- **1.5–9 linger, and it is the gift**: the fireflies come *out of the hollow*. `fireflies.js`: new uniform `born` (vec4: source in Three world, w = `age`). In the vertex shader, after `p` is computed and before the ground clamp: `float k = smoothstep( 0.0, 1.0, clamp( ( born.w - 1.5 - trait.x * 5.0 ) / 2.5, 0.0, 1.0 ) ); p = mix( born.xyz + vec3( sin( trait.x * 40.0 ), trait.z, cos( trait.y * 40.0 ) ) * 0.15, p, k ); glow *= mix( 1.6, 1.0, k );` with `born.w = 99` when no fireflies waking is in progress. Home lights (40%) rise into the crown first, the roamers drift out, the escort comes to the cat last. `magic.levels.fireflies` already eases over 2.5 s; set `uniforms.level = max(level, smooth(age, 1.2, 2.0))` during the waking so the first flies are not dim.
- **6–16 resolve**: the body light is gone by about 10 s; what remains is glow slot 1 (the crown's breathing pool) and the flies. Three of the escort settle near the cat.
- **Day**: the dome is in deep shade, so the hollow's light does read on the bole and on the cat within about 3 m. The front is a shimmer of sun-sparkle running out through the crown's sunlit top and the grass, with the breath. What leaves the hollow is seed-down (40 motes, 3.9), which the existing day fireflies continue.
- **The cat**: head follows the first flies up into the crown (`interest` y rises from the source to `crown.top − 2` over 1.5–4 s), warm rim on the bole side, shadow on the litter.
- **Sound**: `kindle` as a hollow wooden knock; `reach` as leaves (band 3–6 kHz); `glints` 12 soft glass ticks over 1.5–7 s, one per fly that lights near the cat; then the night-insect bed returns.
- **Judge**:
  - A, night, T = 0.7: only the bole and a 2–3 m disc of litter are gold; everything else is unchanged blue. The cat has a warm edge on the bole side. No ring, no sphere.
  - B, night, T = 2.5: the canopy's underside is lit from below and fades to dark at its edge; a line of glints on grass about 15 m out and nothing lit beyond it; the cat's shadow lies on the ground pointing away from the bole; fewer than 40 flies visible, all between the hollow and the crown.
  - C, night, T = 14: indistinguishable from the restored steady state (`&magic=fireflies`, same view) apart from fly positions. No gold beyond the crown.
  - Day check, noon, T = 2.5: on sunlit pixels, mean luma differs from T < 0 by under 2%; the shaded bole is visibly warmer; a shimmer band is visible in the crown in a 3-frame sequence.

### 5.2 Tideglow: the wreck (−9.4, 43.8)

- **Source**: an ember in the boiler's furnace mouth. Cold blue [0.10, 0.55, 1.00].
- **0.35–1.0 catch**: the furnace mouth glows from inside; rivet rings and the rim of the opening catch it; a fan of blue on the sand in front. Rib faces turned to the boiler are lit, their far faces dark.
- **1.0–2.5 reach, land**: the front runs down the beach. Dry sand barely answers; where the sand turns wet the gloss lobe gives a long blue streak toward the eye, and grains glint in a line. The cat's recent paw prints light in turn as the front crosses them: `PRINT_MAGIC.level.value += 0.6 * exp( -sq( age − tCat ) / 0.3 )`, where `tCat` is when the front reaches the cat (3.2 formula inverted: `tCat = 0.35 − tau × ln(1 − dCat / reach)`), and `PRINT_MAGIC.colour` is the tideglow tint.
- **about 2 s, the sea takes it**: where the front meets the swash the light goes into the water. On the sea it runs on to 120 m as crest-glints and flaring cells, and the lit water behind it keeps glinting for 8 s (`seaHold`) while `levels.tideglow` eases up underneath. By the time the waking's own light fades, the swash line and anything that stirs the water are glowing: the steady state has spread out from the wreck rather than switching on everywhere.
- **6–16 resolve**: land light gone by 8 s. A faint blue ember stays in the furnace at night (practical). The sea answers what moves.
- **Day**: the furnace interior is in shade and shows the blue. The front is a line of sun-sparkle down the wet sand (the `SAND_GLINT` gate), then a band of sun-glitter running out over the water. As the level rises the shallows clear to turquoise (the existing day branch).
- **The cat**: a long blue-edged shadow raked up the beach; its wet prints flashing; eyes to the furnace, then out to sea as the front passes it (`interest` moves to a point 20 m seaward at `tCat`).
- **Sound**: `kindle` as struck iron from inside the boiler (partials 220 / 587 / 1320 Hz, short); `reach` as a fizz running down the beach (noise above 5 kHz); at about 2 s one soft low thump as it enters the water (sine 60 Hz, 0.4 s); `glints` as tiny bright ticks from the swash, panned wide.
- **Judge**:
  - A, night, T = 0.7, from the dune looking seaward past the wreck: the furnace mouth and about 2 m of sand in front are blue; rib faces toward the boiler lit, away dark; sea unchanged.
  - B, night, T = 2.2: a blue specular streak on the wet sand between wreck and swash that lines up, across the waterline, with the glitter on the water (no step in brightness or hue at the seam); the cat's shadow long on the sand; no light on the dunes behind the camera.
  - C, night, T = 12: sand dark; the swash line glowing where it breaks; every boulder opaque and its normal colour (the QA-known see-through bug must be gone).
  - Day check, noon, T = 2.0: a line of sparkle on wet sand and water; no blue on sunlit sand.

### 5.3 The lamp: the lighthouse (123.2, 58.9)

- **Source**: the lantern room, about 16 m up. `core` 5 m (a big lens), `catch: 1` so the waking's catch *is* `lampCatch` at its real 4 s length, and `tau` 2.2.
- **0.35–1.6 catch**: the wick catches and gutters twice. The lantern panes, the gallery rail and the top 3 m of the white tower take the light.
- **1.6–5 reach**: light pours down the tower: a gradient from gold at the gallery to blue at the foot (the wall is at a grazing angle to a light above it, which is exactly what makes it read as coming from the top). It reaches the yard at about 2 s. The other lamps come on *as the front reaches them*: in `places.update`, each halo and the cottage window get `lit × smooth(age − tOf(d), 0, 0.6)` with `tOf(d)` the 3.2 arrival time for its distance from the tower, in place of the single `lights` scalar. The necklace lights outward in order.
- **2.2–7.5**: the clockwork takes up (`lampSpin`, unchanged) and the beams begin to turn.
- **about 8 s resolve**: the first full sweep crosses the cat. The waking's body light has handed over to `magicLamp` (the beams) and the necklace; nothing else remains.
- **Sea**: a gold glitter road from the lamp toward the eye, out to 150 m, for the views that see water.
- **Day**: this is the weakest by day, honestly. The lantern is in its own shade and shows lit; the lens flashes the eye three times as it starts to turn (`FLASH_FRAGMENT`'s `flash`, already drawn); the shimmer and breath run out through the yard's grass; the sound carries the rest. No colour on sunlit ground.
- **The cat**: looks up (`interest` at the lantern; `lookUp` clamps at 0.8); a small shadow pool under it; pupils narrow as the first beam crosses.
- **Sound**: `kindle` as a match and two soft puffs at the gutters (0.4 s, 0.75 s), a glass tink; `reach` as a low warm swell (the old bloom's D2 / A2 at half gain is right here and only here); from 2.2 s a slow clockwork tick easing up to tempo and a faint turning hum; each lamp of the necklace a tiny "pt" as it lights.
- **Judge**:
  - A, night, T = 0.6: the lantern room is lit; the top 3 m of tower is gold; the rest of the tower and all the ground are unchanged.
  - B, night, T = 2.5: a smooth gradient down the tower; the cottage window lit, the far post lamps not yet; ground within about 12 m of the foot warm; the cat's shadow short.
  - C, night, T = 12: beams sweeping; equal to the restored steady state at the same beam angle.
  - Day check, noon, T = 3: lantern visibly lit and starting to turn; sunlit ground luma within 2% of before.

### 5.4 The stars: the trig beacon (62, 86)

- **Source**: the tip of the vanes. Cool and dim: [0.62, 0.72, 1.00] at 0.30. `up: 1`: the light falls from above (`lam` uses `mN.y`), because this gift's light is the sky's.
- **0.35–1.0 catch**: one cool glint on the vanes' sheet metal and the pillar's white top. Almost nothing on the ground.
- **1.0–5 reach**: this is the glint-led gift (`glint: 1.0`, body 0.30). The front runs down the summit and out to 60 m as dew catching: grass tips and upturned leaves spark as it passes and keep twinkling behind it. The steady starlight sheen and dew (`magicSheen`) must spread with it, not switch on island-wide: in the sheen branch multiply `mSheen` by `wakeSheenReach`, a float computed in the waking block as `reached` when `wakeShape.y > 0.5` and 1.0 otherwise (initialise to 1.0 before the block). After the waking ends it is 1 everywhere.
- **1.0–14 sky**: the figures draw (existing, `magic2.x`). Follow look-research: only the figure the camera faces. One meteor, once, at about 3.5 s across the upper half of the frame (`meteorInSlot` force), none else in the ceremony.
- **Resolve**: the sheen and dew are the steady state; no practical at the pillar (the audit cuts its lantern).
- **Day**: the source is in full sun, so there is no emission to see. The vanes flash the sun once (the gloss term at the catch with `frontDay`), a gust of sun-shimmer and breath runs down through the summit grass, and the card says the rest. The figures draw the first night the cat looks up.
- **The cat**: looks straight up at 1.0 s; a cool rim along its back from above; eyeshine once.
- **Sound**: `kindle` as a high glass harmonic, slow attack (A6 with its fifth); `reach` as wind passing downhill through grass; the score's `stars` phrase is the glints (do not add ticks over it); the meteor a soft hiss.
- **Judge**:
  - A, night, T = 0.8: vanes and pillar top glint cool; ground within 2 m barely lifted; sky unchanged.
  - B, night, T = 3: dew glints in a disc about 25 m across and none beyond its edge; the cairn's stones stay grey (no cyan or yellow patches: the audit's bug); one figure partly drawn.
  - C, night, T = 15: equal to the restored steady state; at most one figure, at most one meteor in the whole capture.
  - Day check, noon, T = 2: a shimmer band in the grass in a 3-frame sequence; nothing else changed.

### 5.5 Seafolk: the rock pool (64, 126.8)

- **Source**: under the pool's surface. Sea-green [0.20, 0.80, 0.60], `ripple: 0.4`, short land reach (14 m): this light belongs to the water.
- **0.35–1.0 catch**: the pool lights from within. The rim rocks are lit from below with a slow moving ripple; the urchins and anemones are silhouettes against it. The cat at the rim is lit under the chin and chest.
- **1.0–4 reach**: on land the front only crosses the basin and the nearest rocks. Through the spill notch it reaches the sea and runs out 90 m as green crest-glints.
- **Resolve, and a dependency**: today `seafolk` is read by no code, so there is nothing for the light to resolve into. This design gives it two things that exist: the pool stays dimly lit from below at night (practical, 3.7), and at 4 s a seal's bark answers from offshore (`hear("seal-bark", …)` 40 m out along the pool's seaward bearing, quiet). The real steady state is thread C3's (animals come to the cat). When that lands, the last of the sea glints should gather where the first animal surfaces: add `at: [x, z]` to the sea's waking record then. Until C3 lands, hold the seafolk card back to 4.2 s so it arrives with the answer, not before anything has happened.
- **Day**: the basin is partly shaded and the water shows the glow from inside; twelve drops jump from the surface (3.9); if the audit's anemone uniform exists, they all open outward from the centre; the front on the sea is a band of sun-glitter.
- **The cat**: lit from below; looks down into the pool, then out to sea at the bark.
- **Sound**: `kindle` as a deep water bloop (sine 140 → 70 Hz, 0.25 s) and a trickle of bubbles; `reach` as water running out through the notch; at 4 s the answering bark; no ticks.
- **Judge**:
  - A, night, T = 0.7, from `SHOTS.seafolk` (high, looking down): the pool glows green from within, the rim is under-lit, the cat's chin and chest are lit and its back is not.
  - B, night, T = 2.5: a green glitter path from the notch out across the sea about 40 m; rocks more than 6 m from the pool unlit.
  - C, night, T = 14: the pool dimly lit from below, everything else as before the waking.
  - Day check, noon, T = 0.8: glow visible in the shaded part of the basin; drops in the air.

### 5.6 The boat (76.7, 40.6)

- **Source**: the boat's own hurricane lantern, and it moves: `follow: () => state.boat.lantern`. Flame [1.00, 0.50, 0.16].
- **0.35–1.0 catch**: the wick catches. Light along the strakes of the red hull (each plank edge with a rim), on the roller logs and the sand beside it.
- **1.0–4.5 reach**: the front runs down the launch path ahead of the hull: sand, a glint line on the wet sand, then gold glints on the cove. The hull follows its own light down (the existing 8 s launch, or the audit's hop-launch when C3 lands: either way the waking fires at the moment the hull first moves).
- **Linger**: 14 sparks from the wick at the catch, 10 motes drifting downwind.
- **Resolve**: the lantern itself. Ramp `boat.js`'s lantern strength with the same catch (`lampCatch(age × 2)`), and it is the steady state: the existing `lantern_on_sea` road and `catLamp` on the coat. The waking's body light has faded by 8 s; the practical entry lights the sand while the boat is ashore.
- **Day**: the hull's own motion is the event. The lantern glass shows its flame in the hull's shade; the sun-sparkle line runs to the water; sparks are invisible, motes are not.
- **The cat**: warm side-light; its shadow on the sand swings as the lantern swings with the hull's roll.
- **Sound**: `kindle` as the lantern's glass lifted, a match, the wick; a timber creak as the hull stirs; `reach` as keel on sand; a small slap as the bow meets the water; then lapping, and two quiet squeaks of the lantern's handle.
- **Judge**:
  - A, night, T = 0.7: a point of flame at the lantern; a warm pool about 2.5 m across on hull and sand; nothing else.
  - B, night, T = 2.5: a line of glints on the wet sand toward the cove; the cat's shadow long on the sand, pointing away from the lantern.
  - C, night, after the launch: the boat afloat with its lantern road on the water, equal to the restored steady state.
  - Day check, noon, T = 2: flame visible in the glass; sparkle line to the water.

### 5.7 The finale, briefly

The same mechanism from the wisp over the cat on the summit (`follow` the wisp; warm white; 60 m). Then the island answers: each gift's practical flares once (`power × 2.5`, decaying over 2 s) in order of distance from the summit, one second apart from 2.4 s. From the cairn you see six small lights come up across the island where the keepsakes stand, and the lighthouse beam swing to the summit. No new terms: only practicals' levels and their halo sprites. Cut the spirals of light round the island; keep the fireflies' column if the owner still likes it.

## 6. Sound cues (for the sound engineer)

Nobody has heard any of this site's audio; treat these as a brief, not a mix. Everything is synthesised (`calls.js` `tone`, `burst`); no samples. Delete the `wake` voice. The score's ceremony phrase (`score.js`, on D, landing about 1.8 s after the dive begins) stays and is the music; these are the diegetic layer under it and must sit below it. Peak gains are in `calls.js`'s own units (its bells are 0.05).

New voices, all positional at the source (`hear(name, source, { gift })`; `NEAR` about 12 m; not in `EVERYWHERE`):

| Cue | When | What | Gain |
|---|---|---|---|
| `hush` | T = 0 | the ambient bed ducks 3 dB for 0.4 s (the dark beat). If `sound.js` has no bed gain to ride, skip it | |
| `kindle` | 0.35 s | the source catching: a 2 ms-attack noise tick (high-pass 4 kHz, 0.09 s) plus the gift's own material (table below) | 0.03 |
| `gutter` | 0.55 s, 0.75 s (lamp: 0.8 s, 1.5 s) | two soft puffs, band-passed noise 800 Hz, 0.08 s | 0.012 |
| `reach` | 0.35–2.8 s | air moving outward: pink noise, band-pass sweeping 600 → 2400 Hz, attack 0.5 s, length 2.4 s; pan opens from the source's bearing to centre | 0.03 |
| `arrive` | `tCat` (when the front reaches the cat) | one soft note, the gift's pitch and its octave, 1.2 s: the light reaching *you* | 0.025 |
| `glints` | 1–7 s | sparse ticks, 2.5–6 kHz, 0.05–0.12 s, random pan ±0.6, thinned by the `glint` curve; count per gift | 0.004–0.01 each |
| `settle` | about 6 s | the practical's own small bed begins (clockwork, lapping, insects) | |

| Gift | `kindle` material | Pitch (`arrive`) | `glints` count | Other |
|---|---|---|---|---|
| fireflies | hollow wooden knock, 180 Hz, 60 ms | D6 | 12 | leaves in `reach` (3–6 kHz) |
| tideglow | struck iron, 220 / 587 / 1320 Hz | A4 | 10, from the swash | low thump (60 Hz, 0.4 s) as the front enters the water |
| lamp | match flare, glass tink | D4 | 0 | clockwork from 2.2 s; a "pt" per lamp of the necklace |
| stars | glass harmonic, A6 + E7, 0.6 s attack | A6 | 0 (the score's phrase is the glints) | grass wind downhill; meteor hiss |
| seafolk | water bloop 140 → 70 Hz, bubbles | D3 | 0 | answering bark at 4 s |
| boat | lantern glass, match, wick; timber creak | F#4 | 4 (sparks) | keel on sand; bow slap; handle squeak ×2 |

Schedule them from the same curve as the light (`wakingAt`, `tCat`), in `journey.js` beside `wakeNow()`, so sound and light cannot drift. Ask the owner to listen at one checkpoint: the lamp at night, then the wreck.

## 7. The cat in the light

All through existing hooks; no new animation.

- **Head and eyes**: `thread.js` `interest(critter)` returns the waking's source while `age < 5` (`{ x, y, z, near: false, kind: "light" }`; `near` false so it does not crouch or stalk), with the per-gift moves in section 5. `walker.js` already turns `look` / `lookUp` toward it.
- **Pupils**: `cat.js` `pupilResponse(current, light, dt)`: add `light.glare = clamp( I × fall(dCat) × 3, 0, 1 )` (landscape.js builds `light` at about line 353; `fall = a² / (d² + a²)`), and use `darkness × (1 − glare)`. The slit narrows as the light lands on it and opens again as it fades.
- **Fur**: the coat's materials already take the shared chunk through `lightWithMagic`, so the cat gets the body light and the `edge × against` rim on its shells for nothing: a warm fringe on the side toward the source.
- **Shadow**: 3.5, at night.
- **Prints**: 5.2, tideglow only. Set `PRINT_MAGIC.level` to respond to `levels.tideglow` alone and remove `mixGiftColour`.
- **Held**: `holdsCat` releases at 4 s as now. The cat stands; do not add a pose.

## 8. What to delete (checklist)

- `magic.js`: `PULSE`, `pulse` (→ `waking`), the pastel `GIFT_COLOURS` (→ re-export of the tints).
- `land-magic.js`: `magicPulse`, `magicPulseColour`, the pulse branch and `mEdge` in `MAGIC_LIGHT_GLSL`, the pulse block in `update`, `STEP_COLOURS`, `mixGiftColour`; `lampCatch` / `lampSpin` move to `waking.js` (re-export).
- `forest.js`: the `magicPulse` uniform and bow in `WIND_GLSL` (→ the breath).
- `wisp.js`: the bubble (kind 3 as written), `BURST_SECONDS`, `prism()` and `gifts()` in the burst; all pool code.
- `sea-magic.wgsl`: `pulse_on_sea`; `wisp_on_sea` and `lantern_on_sea` fold into `point_light_on_sea`. `sea-sky-magic.js`: `PULSE_SEA_REACH`, the pulse packing.
- `journey.js`: `magic.pulse = {…}`; `WAKE.card` 0.6 → 2.4; hold scale 0.3 → 0.6 and `WAKE.hold` 1.8 → 1.2; `hear("wake", …)`.
- `calls.js`: the `wake` voice and its `NEAR` / `EVERYWHERE` entries.
- Tests and fixtures that name the pulse: `tests/land-magic.test.js`, `tests/sea-sky-magic.test.js`, `scripts/render-sky.mjs` fixtures `pulse` and `pulse-day` (→ `waking`, `waking-day`, frozen at age 2.2).

## 9. How to judge the whole thing

QA hook, built in step 1 (under `?perf`): `skycope.waking.freeze(gift, age)` puts that gift to sleep quietly, sets `magic.waking = { …source, age, frozen: true }` and holds `levels[gift]` at what it would be at that age; `skycope.waking.play(gift)` runs it live without the ceremony camera; `skycope.waking.clear()`.

Global pass conditions, on top of the three frames per gift:

1. **Never a wash.** In any frame B, mask the pixels more than `reach` from the source: their mean luma is within 1% of the T < 0 frame. Inside the reach, no pixel of foliage exceeds sRGB 0.75 in any channel at night.
2. **It has a direction.** In every night frame B, a surface facing the source is at least 3× brighter than the opposite face of the same object (a rib, a boulder, a trunk).
3. **Night level.** Ground 4 m from the source peaks at sRGB luma 0.35–0.45, never above 0.6. If it is outside that, change the `night` column, not the formula.
4. **Noon.** Sunlit ground changes by under 2% at any age. Something is nonetheless visible in a three-frame sequence at 1.5, 2.0, 2.5 s for every gift (shimmer, motes, the object moving).
5. **It ends.** Frame C equals the restored steady state. At age 16.1 every `wake*` uniform is 0 and `pulse` is `[0, 0, 0, 0]`.
6. **Seam.** At the wreck and the boat, the wet-sand streak and the water's glitter meet without a step (land WebGL and sea WebGPU are two renderers and two tonemap paths; this is where they can disagree).
7. **Asleep cost.** With nothing waking, the same-tab A/B against the commit before step 1 shows no difference in land or water pass time.
8. **Reduced motion.** With `prefers-reduced-motion`, no front, no flicker, no breath; the light eases up and down in place.

Unit tests (`tests/waking.test.js`): `wakingAt` is all zero for `s < 0` and `s > 16`; `radius` is monotonic and never above `reach`; `inside ≤ night` peak; `front` is 0 at `s ≤ 0.35` and at full radius; `reduced` gives `front === 0` and `radius === reach`; `sea-sky-magic` packs zeros for a `sea: 0` gift.

## 10. Risks

1. **No occlusion** (the largest). The kindled light has no shadow map: it passes through the bole, the tower, boulders, a hill. Short reaches, inverse-square falloff and `ndl` hide most of it, and the cat's shadow supplies the cue the eye looks for. Where frames B still show a leak (most likely: the lamp lighting the yard behind the cottage; the milkwood's light on the far side of the bole), add step 8 below. Do not add a shadow map.
2. **Calibration across two renderers and two times of day.** Every intensity here is unseen. Expect one pass of tuning the `night` and `day` columns against section 9, and the land–sea seam.
3. **Glint shimmer.** World-space sparkle cells alias when a cell is under a pixel; `magicSparkle` fades them by footprint as the dew does, which also means glints only exist within about 8 m of the camera. That is intended (restraint), but check the front does not look as if it stops there: the gloss and rim terms carry it further.
4. **Foliage rim on flat leaf cards.** `edge` is 1 across a whole card seen edge-on (the "whitened whole cards" problem FOLIAGE_GLSL already notes). It is multiplied by albedo and 0.35; if cards still flash, drop the rim on `foliage` materials and keep gloss.
5. **Dependencies.** Seafolk has no steady state until C3; sources move when C1 reworks the props (the wreck's furnace, the pillar's vanes); practicals lit at noon need the audit's night gate. None blocks steps 1–4.

## 11. Build order

Each step is one commit or a few; each leaves the site shippable. Step 1 alone is a visible improvement: the wash, the ring and the bubble are gone and a lamp-like light swells from a real point.

1. **Subtract, and one light.** `src/waking.js` (table, `wakingAt`, sources, tests); `magic.waking` and the wall clock; delete the ring, `mEdge`, the bow, the bubble, `pulse_on_sea`'s call (leave the sea dark for now: `pulse` zero); the land body term only (`mWake`: `fall × lam × reached`, new tints); the kindled point in `wisp.js`; card at 2.4 s, hold 0.6; the `skycope.waking` QA hook. Capture frames A for all six.
2. **What catches.** Rim, gloss, the front band, `magicSparkle` and the lingering glints; the sun-glint gates in `FOLIAGE_GLSL` and `SAND_GLINT_GLSL`; the breath. Capture frames B on land, and the noon sequences.
3. **The sea.** `point_light_on_sea`, `waking_on_sea`, the packing, `magicPasses`; sky pipeline prewarm. Tideglow frames B and C; the seam; the boulder regression.
4. **The cat.** The ground shadow, `interest`, pupil glare, tideglow prints.
5. **Resolve.** Practicals list and slot 3; fireflies born from the hollow; the necklace lighting in order; the boat lantern's catch and `follow`; the stars' sheen spreading; seafolk's answer. Frames C for all six.
6. **Sound.** The voices and their schedule; delete `wake`. Owner listens at the lamp and the wreck.
7. **Motes and sparks.** The `ember` variant of `createDust`; boat, milkwood by day, seafolk's drops.
8. **Only if frames show leaks: a cheap horizon.** One height texture of terrain plus built places (the fireflies' 128² `ground` texture is exactly this; move it to `forest.js` shared), and in the waking block four taps along the segment from fragment to source: `occl = min over taps of smoothstep( -0.3, 0.3, mix( mWorld.y, wakeSource.y, t ) - height( at t ) )`. Four fetches per lit fragment, only during a waking. Measure before keeping it.
9. **The finale's answers**, and the mechanical rename of `pulse` / `pulseColour` to `waking` / `wakingLight` across the WGSL structs.
