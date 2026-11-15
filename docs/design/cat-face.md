# Cat face and body: build specification (domestic shorthair tabby)

Status: design only. Nothing here has been built or measured in a browser. Written from the review sheets (`docs/review/cat/closeups-after.png`, `day-turnaround-after.png`, `night-turnaround-after.png`, `silhouettes-after.png`, `docs/handover/owner-weird-cat.png`) and a full read of `src/cat-body.js`, `src/cat-rig.js`, `src/cat-coat.js`, `tests/cat-anatomy.test.js`. `src/cat.js` was only grepped (blink, ears, gaze, whisker root line), not read through: items marked **[unverified]** depend on code I did not read or on numbers I derived by hand rather than measured.

Units: head primitives are head-local metres before `HEAD_SCALE` (1.06), as passed to `hell()`. "Drawn" sizes are after `HEAD_SCALE` and the coat loft (`LOFT` 5 mm x the primitive's `fur`), before `CAT_SCALE`. x is across, y up, z forward.

## 0. The six biggest changes

| # | Change | Now | Target |
|---|---|---|---|
| 1 | Widest point of the face moves from the jowls up to the cheekbones; the face tapers to the muzzle | cheek balls at y -0.012, drawn 10.6 cm wide at jaw level (a pear) | zygomatic arches at y -0.003, drawn 9.4 cm; jowls 8.9 cm; muzzle pad 3.8 cm |
| 2 | Eyes become canted almonds, set deeper under a brow ridge | round 1.98 cm socket, cant 0.16 rad, gaze yaw 0.26, no brow | aperture 1.96 x 1.36 cm, cant 0.24 rad (outer corner 4.7 mm higher), globe 1.4 mm deeper, gaze yaw 0.16, brow overhang 2 mm |
| 3 | Pupil is a tall slit by day and a round disc at night | width scales, height fixed at 0.28–0.31 of the eye radius: at night it is wider than tall | half-height 0.50→0.66, half-width 0.035→0.62 of the radius; lids open with the pupil |
| 4 | Muzzle projects, narrows, and gets a stop and a chin | `MUZZLE` 0.006, pads 4.5 cm across, chin 1.84 cm wide and level with the nose | `MUZZLE` 0.010, pads 3.8 cm, chin 1.56 cm wide and 3 mm behind the nose, 2–3.5 mm stop |
| 5 | Face markings are drawn as named strokes, not a stripe field and a circle | `fract(h.x*84)` verticals (read as angry brows), circular pale goggle (owl disc) | explicit M, tear line, two mascara lines, partial spectacles weighted below the eye, white chin, ear-back thumbprint |
| 6 | Ears lower, wider, shorter, thinner; body gets thicker legs, bigger paws, sprung ribs, a closed tail tip | ear 5.0 cm tall, 3.9 cm base, set x 0.024; forearm cone 0.0145 | ear 4.6 cm, 4.3 cm base, set x 0.027, pinna 1.4 mm; forearm 0.0165; paw +10% |

Triangle budget: no increase (section 8).

## 1. What the sheets show

- `closeups-after.png` stand · face: the head is a smooth pear, widest at the jaw. The eyes are two round discs with a bright amber ring, a dark centre and a dark surround, both staring straight out with no lid weight. The muzzle is a broad pale bag with a small pink smudge for a nose. There is no cheekbone, brow or stop: every plane is the same soft curvature, which is the plastic look. The forehead marks sit as two short dark bars over the eyes.
- stand · quarter and the turnaround front column: at distance the pale goggle plus dark rim reads as spectacles on an owl; the ears stand tall and narrow like horns.
- `silhouettes-after.png`: top silhouette is a peanut (ribs 12.2 cm, waist 8.3 cm, hips 11.9 cm per `top-profile-after.json`), but lit from above the coat reads even because nothing on the back breaks the light: no shoulder blades, no spine groove. Side: legs are thin rods under a deep chest.
- walk 0 · under and run · under: an open ring at the tail's end.
- Night sheet: the face is unreadable except boat rows, where the same round-disc eyes show.

## 2. Head masses (`cat-body.js` `anatomy`, the Head block)

Order matters: the two eye sockets are subtractive and are applied in list order, so every new additive head primitive must be pushed **before** the socket loop or the socket will not carve it.

| Primitive | Now (centre; radii; k) | New (centre; radii; k) | Notes |
|---|---|---|---|
| Cranium `head` | [0, 0.010, -0.001]; [0.035, 0.034, 0.032]; 0.03 | [0, 0.011, -0.004]; [0.033, 0.031, 0.034]; 0.03 | 4 mm narrower, 3 mm lower dome, longer behind |
| Forehead `head` | [0, 0.016, 0.012]; [0.029, 0.026, 0.026]; 0.016 | [0, 0.013, 0.012]; [0.027, 0.022, 0.026]; 0.016 | flatter forehead plane that runs down to the stop |
| Brow ridge x2 `head` (new) | none | [±0.015, 0.0185, 0.027]; [0.011, 0.006, 0.009]; 0.008; fur 0.5; comb [side*0.4, 0.5, -0.9] | supraorbital process: overhangs the socket top by ~2 mm so the upper iris sits in shade |
| Zygomatic arch x2 `head` (new, replaces the role of the cheek ball) | none | [±0.027, -0.003, 0.010]; [0.014, 0.011, 0.024]; 0.012; fur 0.7; comb [side*0.9, -0.2, -0.6] | the widest point of the face, level with the lower lid, behind the eye |
| Cheek / masseter x2 `head` | [±0.022, -0.012, 0.004]; [0.024, 0.022, 0.025]; 0.014 | [±0.019, -0.015, 0.004]; [0.019, 0.017, 0.022]; 0.014 | fur 0.85 kept; now 5 mm narrower in total than the cheekbones |
| Whisker pad x2 `head` | [±0.0082, -0.0185, 0.0375+M]; [0.0106, 0.0092, 0.0104]; 0.007 | [±0.0068, -0.0185, 0.0375+M]; [0.0088, 0.0082, 0.0098]; 0.006 | fine kept |
| Muzzle bridge `head` | [0, -0.0085, 0.032+M]; [0.0125, 0.0118, 0.0148]; 0.011 | [0, -0.0075, 0.034+M]; [0.0105, 0.0105, 0.0165]; 0.010 | bridge 2.1 cm wide; the gap it leaves under the forehead is the stop |
| Nose leather `head` | `NOSE` [0, -0.0064, 0.0452+M]; `NOSE_RADII` [0.0058, 0.0042, 0.0032] | [0, -0.0058, 0.0452+M]; [0.0052, 0.0040, 0.0034] | drawn 1.1 cm wide x 0.85 cm high; 29% of the pad width |
| Jaw `jaw` | [0, -0.0235, 0.012]; [0.0178, 0.0092, 0.024]; 0.01 | same centre; [0.0155, 0.0085, 0.024]; 0.01 | narrower mandible |
| Chin `jaw` | [0, -0.0272, 0.0245+M]; [0.0092, 0.0062, 0.0095]; 0.006 | [0, -0.0268, 0.0235+M]; [0.0078, 0.0058, 0.0085]; 0.006 | 1.56 cm wide, front 3 mm behind the nose leather front |

`M` is `MUZZLE`: change `0.006 → 0.010`. It already feeds the nose, pads, chin, the coat's muzzle masks and the whisker roots in `cat.js`, so they follow.

Derived drawn sizes (by hand, **[unverified]** until measured on the mesh):

- Zygomatic width: 2 x (0.027 + 0.014 + 0.0035 loft) x 1.06 = **9.4 cm** (now ~10.6 cm at the jowl).
- Jowl width: 2 x (0.019 + 0.019 + 0.0043) x 1.06 = **8.9 cm**.
- Muzzle pad width: 2 x (0.0068 + 0.0088 + 0.0023) x 1.06 = **3.8 cm**, 40% of head width (now 4.5 cm, 42% of a wider head but with no taper above it).
- Nose front to cornea apex: about **2.4 cm** (now about 1.9 cm).
- Stop: the forehead ellipsoid's front surface and the bridge leave a concavity at the level of the inner eye corners. Target 2–3.5 mm below the straight line from the brow point to the top of the nose leather. If it measures under 2 mm, drop the forehead blend `k` 0.016 → 0.012; if over 3.5 mm, raise the bridge centre y by 1 mm.
- Head length grows ~4 mm. If `head length / body length` leaves [0.2, 0.235], take cranium rz back to 0.032.

### Neck-to-jaw transition and ruff

Now the neck cone (0.036 → 0.031, sx 0.8) and neck ellipsoid meet the skull as a ball on a post. Add one primitive on the `neck` bone, body frame:

- Ruff / nape: `ell("neck", [0, 0.052, 0.196], [0.030, 0.030, 0.026], { k: 0.028, fur: 1.3, comb: [0, -0.6, -0.8] })`.

Drawn half-width 3.65 cm against the jowl's 4.45 cm, so the angle of the jaw stands 8 mm proud of the neck each side and casts its own occlusion; the longer fur (1.3) gives the short ruff a shorthair has behind the cheeks. Check the `visible neck` range [0.035, 0.065] still passes; if the ruff eats it, move its centre z to 0.190.

## 3. Eyes

### Geometry (`cat-body.js`)

| | Now | New |
|---|---|---|
| Socket centre | [±0.0184, 0.0084, 0.0346] | [±0.0178, 0.0072, 0.0338] |
| Socket radii | [0.0099, 0.0099, 0.0086] (round) | [0.0098, 0.0068, 0.0086] (almond: height/width 0.69) |
| Socket Euler (x, y, z; YXZ) | (0.05, side*0.3, side*0.16) | (0.05, side*0.24, side*0.24): keep the sign convention, raise the roll so the outer corner sits 4.7 mm above the inner |
| Socket `k` | 0.0035 | 0.0028 (crisper lid edge) |
| Inner-corner carve (new, `sub: true`) | none | [±0.0085, 0.0040, 0.0375]; [0.0035, 0.0022, 0.0040]; k 0.002; loft 0.6 |
| `eyeCentre` | [0.0188, 0.0062, 0.0276] | [0.0180, 0.0064, 0.0262] |
| `EYE_GAZE.yaw` | 0.26 | 0.16 |
| `EYE_RADIUS`, `EYE_FLAT` | 0.0098, 0.8 | unchanged |

The inner-corner carve is the tear duct: it pulls the medial canthus down and toward the nose, which is what makes the aperture an almond rather than an ellipse. Interpupillary distance drawn: 3.8 cm, 40% of the new head width. After the change, check no globe vertex with eye-frame z > 0.3 lies outside the skin near the outer corner; if the lid gaps there, move `eyeCentre` x back toward 0.0184.

Note: `fine: true` on a subtractive primitive does nothing (`field.dominant` skips `sub`); the lids are refined only because the pads and bridge next to them are fine. That is acceptable; do not add fine primitives to chase lid resolution.

### Lids (`cat-coat.js`, the eye branch of `COMMON_COLOUR`)

Replace the rest curves (`outer` is `e.x * side`):

```glsl
float inner = smoothstep( -0.45, -0.95, outer );            // toward the tear duct
float open = mix( 0.0, 0.10, catPupil );                     // eyes widen in the dark
float upperRest = 0.50 + open + outer * 0.16 - outer * outer * 0.42 - inner * 0.10;
float lowerRest = -0.52 + outer * 0.10 + outer * outer * 0.40 - inner * 0.10;
upperRest += catGaze.y * 0.5;                                // the lid follows the gaze
```

- Upper lid heavier: its black margin `band( e.y - upper, 0.032 )` → 0.050; lower margin 0.030 → 0.022.
- Tear line: keep the wet band on the lower lid; add `eyeWet += inner * 1.2 * band( e.y - lower - 0.03, 0.06 )` so the inner corner glistens.
- `lidShade` stays; with the brow ridge the top third of the iris should now be physically shaded as well.
- Relaxed day aperture: (0.50 + 0.52) / 1.9 = 0.54 height to width; at night 0.59.

### Pupil by light level

Now: `length( vec2( q.x / max( catPupil, 0.05 ), q.y / mix( 0.64, 0.72, catPupil ) ) ) * 2.3`, so the half-height is fixed near 0.3 of the eye radius and at `catPupil` 1 the half-width is 0.43: a wide oval, wider than tall. Replace:

```glsl
float pw = mix( 0.035, 0.62, pow( catPupil, 1.3 ) );         // half-width
float ph = mix( 0.50, 0.66, catPupil );                      // half-height
float pn = mix( 1.5, 2.0, catPupil );                        // pointed ends when a slit
float pd = pow( pow( abs( q.x ) / pw, pn ) + pow( abs( q.y ) / ph, pn ), 1.0 / pn );
float pupil = 1.0 - smoothstep( 0.92, 1.08, pd );
```

| Light | `catPupil` | Shape (drawn, 2.1 cm globe) |
|---|---|---|
| Direct noon sun | 0.10 | slit 1.2 mm x 10.6 mm |
| Open shade, overcast | 0.30 | spindle 3.2 mm x 11.4 mm |
| Dusk, dawn, lantern on the boat | 0.55–0.65 | oval 6.5 mm x 12.3 mm |
| Moonlight, night | 0.9–1.0 | round, 11–13 mm |

`pupilResponse` in `cat.js` was not read **[unverified]**: confirm it reaches at least 0.9 at night and at most 0.15 in direct sun, and that the day floor suggested in `look-research.md` (0.25, set to avoid the old pinprick) is lowered to 0.10 now that the slit keeps its height.

### Iris

- Colour: `mix( lin( vec3( 0.42, 0.47, 0.24 ) ), lin( vec3( 0.62, 0.50, 0.22 ) ), smoothstep( 0.25, 0.75, r ) )`: green-hazel round the pupil, gold at the rim.
- Limbal darkening `1.0 - smoothstep( 0.68, 0.92, r ) * 0.85` → `1.0 - smoothstep( 0.82, 0.96, r ) * 0.7`. The present wide dark ring inside a bright ring is the owl-disc; a cat's limbal ring is thin and mostly under the lids.
- Keep the fibres, collarette, cornea reflection, caustic and eyeshine as they are.

## 4. Ears (`cat-body.js` `ears`, `cat-rig.js` `EAR`)

| | Now | New |
|---|---|---|
| `EAR` (bone, head-local) | [0.024, 0.030, -0.004] | [0.027, 0.026, -0.006] |
| `EAR_HEIGHT` | 0.050 | 0.046 (drawn 4.9 cm, 52% of head width) |
| Base half-width in `width(v)` | 0.0195 | 0.0215 (drawn base 4.5 cm) |
| Tip | `(1 - v)` goes to a point | `pow( 1.0 - v, 0.8 )` and clamp the half-width to at least 0.0022 at v = 1: a rounded tip |
| `earPose` Euler | (-0.10, side*0.14, -side*0.30) | (-0.18, side*0.22, -side*0.38): tipped forward, turned out, leaning 22 degrees off vertical |
| Outer base | bottom at -0.005 | bottom at `-0.005 - 0.006 * max( 0, u * side )`: the outer edge runs down the side of the skull toward eye level |
| Thickness | 0.0021 (1 - 0.6v) + 0.0016 (1 - u²)(1 - v) | 0.0014 (1 - 0.5v) + 0.0012 (1 - u²)(1 - v) |
| Skin weight to the ear bone | smoothstep( v, 0.02, 0.25 ) | smoothstep( v, 0.05, 0.32 ): the wider base stays planted when the ear swivels |

U and V counts are unchanged (12 x 14 at detail 1). Inner gap between the ear bases, drawn: about 4 cm; tip-to-tip span 9–10 cm, about the head's width.

Shader (ear branch): `furThin` inner `mix( 0.35, 1.1, inner )` → `mix( 0.35, 1.4, inner )` scaled by `( 1.0 - 0.5 * smoothstep( 0.0, 0.3, v ) * ( 1.0 - v ) )` so the thin upper pinna glows more than the thick base; keep `furTrans`. Add the ear-back "thumbprint", seen all the time from the follow camera:

```glsl
float thumb = 1.0 - smoothstep( 0.18, 0.34, length( vec2( u * 0.8, v - 0.42 ) ) );
back = mix( back, lin( vec3( 0.55, 0.47, 0.36 ) ), thumb * 0.6 );
back *= 1.0 - smoothstep( 0.78, 1.0, v ) * 0.6;     // dark tip
```

## 5. Whisker pads and whiskers

- Pads: section 2. The two pads sit 1.36 cm apart with k 0.006, leaving a shallow midline cleft for the philtrum the coat already draws.
- Roots (`cat.js` `whiskers`, the one line read: `side * ( 0.0105 + k * 0.0022 ), -0.0158 - row * 0.0026, 0.0435 + MUZZLE - k * 0.0025`): change the x base 0.0105 → 0.0090 so roots stay on the narrower pad. z follows `MUZZLE`.
- Layout target **[unverified against the current counts and lengths]**: 4 rows x 3 per side (12 a side). Lengths 4.5 cm (front of the row) to 7 cm (rear), so the spread is a little wider than the head. Top two rows sweep back and 10–20 degrees up; bottom two forward and 10–15 degrees down. Three brow whiskers per eye, 3–3.5 cm, rooted on the new brow ridge at [±0.012…0.018, 0.024, 0.030]. One or two genal whiskers on each cheek at [±0.036, -0.012, 0.012], 3 cm, pointing out and back.
- Whisker spots in the coat: keep the 4 rows; move the x gate `ax - 0.003` → `ax - 0.0025`.

## 6. Facial markings (`cat-coat.js`, the `head > 0.01` block)

All in head-local `h`, `ax = abs( h.x )`. Dark strokes accumulate into `hd`, pale into `hp`. Stroke widths are the `band()` width (feather from half to full width). Replace the present `m`, `goggle`, `mascara`, `swirl` terms with:

```glsl
// The M: two legs rising above the inner half of each eye, two diagonals
// meeting in a V at the stop. Then four or five fine lines back over the crown.
float mLeg = band( ax - 0.0125 - ( h.y - 0.018 ) * 0.10, 0.0030 )
           * smoothstep( 0.017, 0.021, h.y ) * smoothstep( 0.040, 0.034, h.y );
float mVee = band( ax - 0.0020 - ( h.y - 0.014 ) * 0.55, 0.0026 )
           * smoothstep( 0.013, 0.016, h.y ) * smoothstep( 0.038, 0.034, h.y );
float mFront = max( mLeg, mVee ) * smoothstep( 0.004, 0.016, h.z );
float crownLines = band( fract( h.x * 90.0 + 0.5 + ( cNoise( h * 120.0 ) - 0.5 ) * 0.2 ) - 0.5, 0.22 )
           * smoothstep( 0.030, 0.038, h.y ) * smoothstep( 0.012, 0.0, h.z ) * smoothstep( 0.030, 0.022, ax );
float hd = max( mFront * 0.8, crownLines * 0.6 );

// The eye in its own canted frame (cant 0.24 rad, outer corner up).
vec2 ec = vec2( ax - 0.0178, h.y - 0.0072 );
vec2 ev = vec2( ec.x * 0.971 + ec.y * 0.238, -ec.x * 0.238 + ec.y * 0.971 );
float eyeR = length( ev / vec2( 0.0098, 0.0068 ) );          // 1 at the lid margin
float front = smoothstep( 0.0, 0.025, h.z );

// Eyeliner: 1 mm of black-brown fur at the lid margin.
float liner = band( eyeR - 1.08, 0.14 ) * front;
// Spectacles: a pale ring outside the liner, strong below and at the inner
// corner, weak above. Never a full disc.
float spec = band( eyeR - 1.42, 0.30 ) * front * mix( 0.30, 1.0, smoothstep( 0.003, -0.005, ev.y ) );
// Tear line: from the inner corner down the side of the nose bridge.
float tear = band( ax - 0.0075 - ( 0.004 - h.y ) * 0.25, 0.0016 )
           * smoothstep( 0.004, 0.001, h.y ) * smoothstep( -0.010, -0.006, h.y ) * front;
// Mascara: from the outer corner back and slightly up to below the ear base;
// a second line 7 mm below it, converging toward the same point.
float back = smoothstep( 0.034, 0.024, h.z ) * smoothstep( -0.022, -0.008, h.z );
float mascara1 = band( h.y - 0.0105 - ( ax - 0.028 ) * 0.22, 0.0042 ) * smoothstep( 0.026, 0.030, ax ) * back;
float mascara2 = band( h.y - 0.0020 - ( ax - 0.028 ) * 0.55, 0.0036 ) * smoothstep( 0.027, 0.032, ax ) * back;
// Cheek swirl: an arc under the cheekbone curling toward the jaw angle.
float swirl = band( length( vec2( ax - 0.030, h.y + 0.004 ) ) - 0.013, 0.0030 )
            * smoothstep( -0.004, -0.010, h.y ) * smoothstep( 0.020, 0.008, h.z ) * smoothstep( -0.020, -0.010, h.z );
hd = max( hd, max( max( liner * 0.85, tear * 0.55 ), max( max( mascara1, mascara2 * 0.8 ), swirl * 0.7 ) ) );
```

Pale:

```glsl
float muzzle = smoothstep( -0.010, -0.020, h.y ) * smoothstep( 0.022, 0.035, h.z - MUZZLE );
float chin = smoothstep( -0.021, -0.028, h.y );
float lipPale = smoothstep( -0.014, -0.019, h.y ) * smoothstep( 0.030, 0.040, h.z - MUZZLE );
float earSpot = 1.0 - smoothstep( 0.004, 0.009, length( vec2( ax - 0.024, h.y - 0.020 ) ) );   // in front of the ear base
float hp = max( max( spec * 0.5, earSpot * 0.35 * step( 0.0, h.z ) ), max( muzzle, max( chin, lipPale ) ) );
```

Colour:

- Chin and upper lips go whiter than `cream`: where `chin` or `lipPale` > 0.5, mix the pale colour toward `lin( vec3( 0.93, 0.90, 0.82 ) )`.
- Nose bridge: warm, unmarked. Before the dark/pale mix, `base = mix( base, lin( vec3( 0.62, 0.47, 0.33 ) ), 0.6 * smoothstep( 0.009, 0.004, ax ) * smoothstep( -0.006, 0.0, h.y ) * smoothstep( 0.014, 0.008, h.y ) * front )`.
- Nose leather: keep the brick and black rim; the mask reads `NOSE` and `NOSE_RADII`, so it follows.
- Keep the whisker spots, lip line and philtrum.

Bump `customProgramCacheKey` (`cat-coat-v6` → `v7`). The same `coatAt` feeds the vertex bake, so the far coat follows; at one sample per vertex the 2.6–4.2 mm strokes will soften, which is correct at that distance.

## 7. Body notes

Numbers are edits to `anatomy` in `cat-body.js` unless stated. Bone lengths in `cat-rig.js` do not change, so paw reach and `walker.js` are unaffected.

| Feature | Now | New | Why |
|---|---|---|---|
| Rib spring | ribs [0, 0.023, 0.035]; r [0.056, 0.054, 0.076] | centre z 0.035 → 0.025; r [0.058, 0.052, 0.074] | widest behind the elbows, not at them; barrel reads from above |
| Chest keel | chest [0, 0, 0.11]; r [0.041, 0.048, 0.052] | r [0.039, 0.050, 0.052] | deeper, narrower brisket between the forelegs |
| Tuck-up | loin [0, 0.031, -0.025] ry 0.042; hips [0, 0.034, -0.077] ry 0.047 | loin centre y 0.031 → 0.035, ry 0.042 → 0.039 | belly line rises 2.5–3.5 cm from brisket to groin; pouch unchanged |
| Shoulder blades from above | scapula cone ra 0.008 → rb 0.02, k 0.026, sx 0.55 | ra 0.011, k 0.016 | blade tops stand 3–4 mm above the spine with a groove between; stay under the 6 mm back-line bump limit |
| Haunch mass | thigh ellipsoid r [0.019, a*0.54, 0.048] | r [0.022, a*0.54, 0.052] | fuller haunch in profile; must stay within `haunch <= ribs + 3 mm` |
| Forearm | cone 0.0145 → 0.0105; ell [0.0135, b*0.3, 0.015] | cone 0.0165 → 0.012; ell [0.0155, b*0.3, 0.017] | drawn about 3.3 cm fore-aft; inside the test's 2.2–3.6 cm |
| Upper arm | cone 0.023 → 0.016 | 0.025 → 0.018 | |
| Shin | cone 0.016 → 0.010; ell [0.014, b*0.32, 0.017] | cone 0.0175 → 0.0115; ell [0.0155, b*0.32, 0.019] | |
| Hock, pastern | cones 0.0095, 0.0105 | 0.0105, 0.0115 | |
| Paw | pad [0.0155*w, 0.0092, 0.018*len]; toes r 0.0058 at x ±0.0102, ±0.0036 | pad [0.0170*w, 0.0095, 0.0195*len]; toes r 0.0063 at x ±0.0112, ±0.0040 | drawn 3.5–3.7 cm wide. Risk: neutral paws stand at x = ±0.0209, leaving ~3.6 mm between them; re-run the `STRETCH` and sole-height tests |

### Tail tip

The sheets show an open ring at the tail's end from behind (walk 0 · under, run · under). I did not find a hole in the field: the last cone ends in a round cap (rb clamped to 0.0042 plus 4.5 mm of loft). Two candidate causes, neither verified:

1. The review camera's near plane cuts the tail, which points straight at a rear close-up camera. Back faces are culled, so the inside of the tube shows as a ring. If so it is a camera matter (keep the camera outside the tail's swept volume, as for the cottage walls), not a mesh one.
2. The outer fur shells are culled where they face the camera (`facing > 0.38`), leaving a fringe ring round the end cap while the cap itself is small at the far LOD cell (12.4 mm against an 8.7 mm tip radius).

Do both of these regardless:

- Add a watertight check to the tests: over tail vertices (`region.z > 0.7`), every edge is shared by exactly two triangles, in both `mid` and `far`.
- Close the tip explicitly and remove the kink: drop the `- Math.max( 0, s - 0.93 ) * 0.05` term from `radius(s)`, and add `ell( "tail13", [TAIL_ROOT[0], TAIL_ROOT[1], TAIL_ROOT[2] - TAIL_LENGTH + 0.003], [0.0048, 0.0048, 0.0075], { k: 0.004, region: [0, 0, 1, 0], comb: [0, 0, -1], fur: 0.9, fine: true } )`. Tip drawn about 1.9 cm across with coat, rounded.

## 8. Triangle budget

No increase. `tests/cat.test.js` asserts the `mid` body is under 40,000 triangles (seen in a grep only, **[unverified]** what the present count is).

- New additive primitives (brow ridges, zygomatic arches, ruff) are **not** `fine`. The tail-tip ellipsoid is fine but replaces area already refined (`fine: s1 > 0.85`).
- The fine area on the face shrinks: pads and bridge are smaller.
- Bigger paws add a little fine area. If the count rises, drop `fine` on the carpal pads.
- Eye spheres (22 x 16 at detail 1) and ears (12 x 14) keep their grids.
- Procedure: log `buildStats.mid.vertices` and `buildStats.far.vertices` and both index counts before the change; after, each must be at or below its before value.

## 9. Test ranges to add (`tests/cat-anatomy.test.js`)

A new test, "the face is a shorthair's", on the standing pose, model metres. `head` = coat points with `region.x > 0.6`. Eye centre and nose from the exported constants.

| Measure | How | Range |
|---|---|---|
| Head width | `span( head, "x" )` (replaces [0.095, 0.108]) | 0.088–0.099 |
| Height of the widest slice | y of the 4 mm slice with the greatest x span, relative to the eye centre | -0.010 to +0.004 |
| Jowl / zygomatic | x span of the slice 2 cm below the eye centre over the head width | 0.88–0.96 |
| Muzzle pad width | x span of head points within 1.2 cm behind the nose front and below the nose centre | 0.034–0.040 |
| Muzzle / head width | | 0.36–0.42 |
| Nose ahead of the eyes | nose front z minus cornea apex z | 0.022–0.028 |
| Chin behind the nose | nose front z minus the foremost jaw-weighted point | 0.002–0.005 |
| Stop | depth of the midline profile under the line from the brow point to the top of the nose leather | 0.002–0.0035 |
| Eye spacing / head width | 2 x `eyeCentre(1)[0]` over head width | 0.38–0.43 |
| Aperture height / width | socket radii (export them) | 0.62–0.72 |
| Eye cant | socket roll | 0.21–0.30 rad |
| Ear height / head width | `EAR_HEIGHT` over head width | 0.46–0.54 |
| Ear tip span | x span of ear vertices (`coat.w` = 2) with v > 0.9 | 0.085–0.105 |
| Paw width | x span of one front paw's points | 0.033–0.038 |
| Tail watertight | section 7 | exactly 2 triangles per edge |

Existing ranges that must still pass unchanged: head length / body length, head depth / chest depth, crown / withers, visible neck, ribs, waist, shoulders, haunch, forearm thickness, tail taper, sole heights, back-line bump, stretch, inner-thigh edge, paw slide.

Add to `tests/cat.test.js` (or wherever `pupilResponse` is tested) **[unverified location]**: pupil aspect (width / height) under 0.15 in direct sun and over 0.85 at night.

## 10. Five camera angles and pass criteria

Shoot each at noon (sun three-quarter front) and at night, the same harness as the existing sheets, standing on sand. Distances are from the nose, in world metres.

| # | Camera | Pass when |
|---|---|---|
| A | Front, eye height, 0.35 m | The outline is a rounded wedge: widest at the cheekbones, tapering to the muzzle; no pear. Eyes are almonds with the outer corners higher; the upper third of each iris is in lid shade; no full pale ring round either eye. Noon: pupils are slits under 1/8 of the iris width. Night: round, over half the iris width. The M reads as four strokes. Chin is white and sits back from the nose. |
| B | Three-quarter front, 35 degrees off, 10 degrees above, 0.5 m | The far eye is partly hidden by the nose bridge. The near cheekbone catches light with a shadow under it. The brow casts onto the eye. Mascara lines run from the outer corner toward the ear. Jaw angle is distinct from the neck. |
| C | Profile, eye height, 0.5 m | A visible stop; the nose leather leads the chin; the muzzle is about a quarter of the head length ahead of the eye; the ear leans forward; the eye is a wedge, not a disc. The neck meets the skull behind the jaw without a ball-on-a-post step. |
| D | Follow camera (default play view, behind and above) | Ear backs show dark with a pale thumbprint and are about a head-width apart at the tips; the skull is narrower than the ribs; crown lines run into the neck; shoulder blades show as two soft highlights; the tail tip is closed. No worse than the present sheet at this distance. |
| E | Top, orthographic | Head outline: ears, cheekbones, then a narrower muzzle. Body: shoulders, sprung ribs behind the elbows, waist, haunches; the lit view shows the blade and spine relief, not an even log. Paws visible beside the chest when walking. |

Fail on any of: sclera or a white gap at a lid corner; a globe vertex outside the skin; lids crossing the pupil at rest by day; markings reading as eyebrows at D distance; triangle counts above the before values; any existing anatomy test failing.

Per the project's performance-first rule: compare frame time before and after on the follow camera. The shader edits swap terms rather than add passes; the pupil adds three `pow` calls in the eye branch only.

## 11. Expressions on the new shapes

- **Blink** (`catBlink`): unchanged in timing. With the new curves the upper lid does about 80% of the travel and the closed line follows the cant, so a blink reads as a lid coming down, not a shutter. The slow blink (0.9 s when sitting) should stop at 0.85 so a line of iris shows. Sleepy and rain already feed `catBlink`; add a sun squint: a floor of 0.15 when the pupil is under 0.15 **[needs the `cat.js` blink line edited; that code was only grepped]**.
- **Lids and light**: the resting aperture widens with `catPupil` (section 3), so at night the cat is wide-eyed with round pupils and by day half-lidded with slits. No new uniform.
- **Gaze** (`catGaze`): saccades stay at ±0.09 across, ±0.04 up; cap total at 0.12 so the iris edge never leaves the narrower aperture. The upper lid follows vertical gaze (`upperRest += catGaze.y * 0.5`). With `EYE_GAZE.yaw` at 0.16 the two eyes converge on a subject at A distance instead of diverging.
- **Ear flick and swivel**: the rotation code in `cat.js` sets the bone rotation outright, and the new rest pose is baked into the geometry by `earPose`, so no change is needed. The wider base and the later skin-weight ramp keep the base still while the upper two thirds turn. Flattening (`flat`) now folds the ears out and back over a narrower skull: check they do not cut the ruff at `flat` = 1; if they do, limit the roll term to 0.38.
- **Jaw** (meow, yawn): the chin and mandible stay on the `jaw` bone. The narrower chin opens a clearer mouth corner; the lip line (`mouth` in `furInfo.z`) is computed from weights and follows.
- **Whiskers**: the existing `back` term sweeps them; brow whiskers should take 0.5 of it and drop slightly with `catBlink`.

## 12. Build order

1. `cat-body.js` head primitives, sockets, `MUZZLE`, `NOSE`; run the anatomy tests; record `buildStats`.
2. Eyes: `eyeCentre`, `EYE_GAZE`, lids and pupil in the shader; check angle A at noon and night.
3. Ears and `EAR`.
4. Face markings; bump the cache key; check A, B, D.
5. Neck ruff, then the body table, then the tail tip; full test run.
6. Whisker roots and layout in `cat.js`.
7. Five-angle sheet, day and night, beside the present `-after` sheets; frame-time comparison.

## 13. Not verified

- All drawn sizes in sections 2–4 and 7 are hand arithmetic from primitive radii and loft; blends (`k`) will shift them by a millimetre or two.
- The sign of the socket roll (which way `side * 0.16` cants) was not traced through the inverted matrix; the spec says keep the sign and raise the magnitude. Confirm the outer corner is the high one on angle A.
- `cat.js` was grepped, not read: `pupilResponse`, the whisker count, lengths and directions, the blink line, and ear limits.
- The current triangle counts and where the present head measurements sit within the test ranges.
- The cause of the tail ring.
- The GLSL in section 6 has not been compiled.
