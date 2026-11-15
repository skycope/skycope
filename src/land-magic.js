import * as THREE from "three";
import { PRINT_MAGIC } from "./cat-ground.js";
import { WAKE_LIGHT, wakingAt, frontArrival, waveAt, WAVE_ZERO, practicalLevel, lampCatch, lampSpin } from "./waking.js";
import { CAT_SCALE } from "./cat-rig.js";

// The island's gifts as light on the land. magic.js records which gifts are
// awake; this turns the levels into a handful of uniforms every patched
// material reads (forest.js patchMaterial, so ground, grass, leaves, bark,
// rocks and the landmarks' walls all take the same light):
//
//   magicOn          0 while nothing below is lit: the whole block is skipped
//   magicGlow[4]     moving point glows (Three world xyz, radius m):
//                      0 the fireflies round the cat, 1 the milkwood's crown,
//                      2 the wisp, 3 the nearest of the island's lamps
//   magicGlowColour  their colour × strength (exposed linear units)
//   magicLamp        the lighthouse lamp (Three world xyz, strength)
//   magicBeam        the beams' bearing (cos a, sin a in Three world x, z),
//                    reach (m), unused
//   magicSheen       starlight on the land (rgb × strength), w: dew glints
//
// and, while a gift is waking (waking.js; all zero otherwise), the kindled
// light: one point light at the keepsake whose light reaches outward.
//   wakeSource  the source (Three world xyz), w its soft-core radius (m)
//   wakeFront   x how far its light has reached (m), y the front's
//               half-width (m), z the front's glints F, w lingering glints G
//   wakeColour  its tint × the body light I
//   wakeTint    its tint
//   wakeShape   x ripple (light from under water), y light from above,
//               z how far the body light carries (m)
//
// No new passes, no lights: a few multiply-adds per fragment, and nothing
// at all while every gift sleeps (a uniform branch the GPU skips whole).

export const MAGIC_LIGHT_DECLARATIONS = /* glsl */ `
uniform float magicOn;
uniform float landNightFill; // land-look: night (0–1), for the canopy fill
uniform vec4 magicGlow[ 4 ];
uniform vec3 magicGlowColour[ 4 ];
uniform vec4 magicLamp;
uniform vec4 magicBeam;
uniform vec4 magicSheen;
uniform vec4 wakeSource;
uniform vec4 wakeFront;
uniform vec3 wakeColour;
uniform vec3 wakeTint;
uniform vec4 wakeShape;
uniform vec4 wakeWave;  // the wave: radius (m), lead half-width, tail (m), strength
uniform vec4 wakeEcho;  // its echo home: radius, half-width, strength; w the wave's presence (0…1)
#ifndef WAKE_WRAP
  #define WAKE_WRAP 0.85
#endif
float magicHash( vec3 p ) {
  p = fract( p * 0.1031 );
  p += dot( p, p.zyx + 31.32 );
  return fract( ( p.x + p.y ) * p.z );
}
// Rare round points a pixel or two wide that twinkle as the eye moves; they
// fade out where a cell is bigger than that on screen (the dew's code).
float magicSparkle( vec3 world, vec3 view, float scale, float rare ) {
  vec3 gp = world * scale;
  vec3 cell = floor( gp );
  float h = magicHash( cell );
  float spot = 1.0 - smoothstep( 0.12, 0.3, length( fract( gp ) - 0.5 ) );
  float small = 1.0 - smoothstep( 0.6, 2.0, scale * length( fwidth( world ) ) );
  return step( rare, h ) * spot * small
    * ( 0.5 + 0.5 * sin( h * 40.0 + magicBeam.w * ( 1.5 + 3.0 * h ) + dot( view, vec3( 30.0 ) ) ) );
}
#ifdef WAKE_CAT_SHADOW
// The cat in the kindled light (ground only): does the ray from this point
// to the source pass through it? Two spheres, chest and haunch (Three
// world, w the shadow's strength); the penumbra widens with distance.
uniform vec4 wakeCat[ 2 ];
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
#endif
// The kindled light's front at a world point (0 away from it), for the
// sun-glint gates (forest.js FOLIAGE_GLSL, SAND_GLINT_GLSL).
float wakeBandAt( vec3 world ) {
  float dist = length( wakeSource.xyz - world );
  float fb = ( dist - wakeFront.x ) / wakeFront.y;
  // (And the wave's crest, by its presence alone: a flash of sun.)
  float wf = ( length( ( wakeSource.xyz - world ).xz ) - wakeWave.x ) / wakeWave.y;
  return max( exp( -fb * fb ) * wakeFront.z, exp( -wf * wf ) * wakeEcho.w );
}
`;

// After three's light loop: `normal` and vViewPosition are view space.
export const MAGIC_LIGHT_GLSL = /* glsl */ `
if ( magicOn > 0.0 ) {
  vec3 mWorld = cameraPosition + ( vec4( -vViewPosition, 0.0 ) * viewMatrix ).xyz;
  vec3 mN = normalize( ( vec4( normal, 0.0 ) * viewMatrix ).xyz );
  vec3 mLight = vec3( 0.0 );
  for ( int i = 0; i < 4; i++ ) {
    vec3 d = magicGlow[ i ].xyz - mWorld;
    float r = magicGlow[ i ].w;
    float d2 = dot( d, d ) + 1e-4;
    // Inverse square with a soft core, windowed out by three radii.
    float fall = r * r / ( d2 + r * r ) * ( 1.0 - smoothstep( r * 1.0, r * 4.0, sqrt( d2 ) ) );
    // Wrapped: leaves and grass are thin, light gets round them.
    float wrap = clamp( dot( mN, d ) * inversesqrt( d2 ) * 0.6 + 0.4, 0.0, 1.0 );
    mLight += magicGlowColour[ i ] * ( fall * wrap );
  }
  if ( magicLamp.w > 0.0 ) {
    // The lighthouse beams: a pair of cones turning about the lamp. Light
    // falls on whatever the cone's axis passes near (its width grows with
    // distance), brightest on faces turned to the lamp.
    vec3 toP = mWorld - magicLamp.xyz;
    float hd = length( toP.xz );
    vec2 hdir = toP.xz / max( hd, 1e-3 );
    float along = dot( hdir, magicBeam.xy );
    float across = sqrt( max( 1.0 - along * along, 0.0 ) ) * hd;
    float width = 0.7 + hd * 0.085;
    float drop = toP.y + hd * 0.06;
    // Only what stands near the beam's height takes its light: ground far
    // below it (the beach behind a hill, the sand behind a boulder seen from
    // the lamp) stays dark, as if shadowed.
    float cone = exp( -across * across / ( width * width ) ) * exp( -drop * drop / ( width * width * 14.0 ) );
    float reach = smoothstep( 4.0, 14.0, hd ) * exp( -hd / magicBeam.z );
    float face = clamp( dot( mN, -toP ) * inversesqrt( dot( toP, toP ) + 1e-4 ) * 0.7 + 0.3, 0.0, 1.0 );
    mLight += vec3( 1.0, 0.72, 0.4 ) * ( magicLamp.w * cone * reach * face );
  }
  // The kindled light (waking.js): a point at the keepsake whose light has
  // reached wakeFront.x metres. Behind the front the world is lit as by a
  // lamp (inverse square, by which way it faces, times albedo); nothing
  // ahead of it is.
  vec3 mView = normalize( cameraPosition - mWorld );
  vec3 mWake = vec3( 0.0 );      // diffuse: times albedo below
  vec3 mWakeSpec = vec3( 0.0 );  // glints
  float wakeSheenReach = 1.0;    // the stars' dew spreads with their light
  if ( wakeFront.x > 0.0 ) {
    vec3 wd = wakeSource.xyz - mWorld;
    float d2 = dot( wd, wd );
    float d = sqrt( d2 );
    if ( d < wakeFront.x + 3.0 * wakeFront.y ) {
      vec3 wl = wd / max( d, 1e-3 );
      float a2 = wakeSource.w * wakeSource.w;
      float fall = a2 / ( d2 + a2 );
      float reached = 1.0 - smoothstep( wakeFront.x - wakeFront.y, wakeFront.x, d );
      float ndl = dot( mN, wl );
      // Solids take it as a lamp's light; thin leaves let it round. The
      // stars' light falls from above.
      float lam = clamp( mix( ndl, mN.y, wakeShape.y ) * WAKE_WRAP + ( 1.0 - WAKE_WRAP ), 0.0, 1.0 );
      // Seafolk: light from under moving water.
      float ripple = 1.0 + wakeShape.x * sin( dot( mWorld.xz, vec2( 5.1, 3.7 ) ) + magicBeam.w * 2.3 ) * sin( dot( mWorld.xz, vec2( -2.9, 4.6 ) ) - magicBeam.w * 1.7 );
      // (Windowed: the body light lights its own place, wakeShape.z metres.)
      float mWin = 1.0 - smoothstep( wakeShape.z * 0.45, wakeShape.z, d );
      float body = fall * lam * reached * ripple * mWin;
      #ifdef WAKE_CAT_SHADOW
        body *= wakeCatShade( mWorld );
      #endif
      mWake = wakeColour * body;
      if ( wakeShape.y > 0.5 ) wakeSheenReach = reached;
      // What catches: edges seen against the light, and gloss (wet sand,
      // wet rock, waxy leaves: their roughness is already low).
      // (Not on leaf cards: a flat card seen edge-on is all edge, and it
      // whitened whole cards. Leaves catch by gloss alone.)
      #ifdef WAKE_FOLIAGE
        float edge = 0.0;
      #else
        float edge = pow( 1.0 - abs( dot( mN, mView ) ), 3.0 );
      #endif
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
      float lit = sqrt( fall ) * reached * mWin;
      // Behind the front: a steady rim and sheen from the light itself.
      mWakeSpec = wakeColour * lit * ( edge * against * 0.35 * mix( vec3( 1.0 ), diffuseColor.rgb * 4.0, 0.7 ) + gloss * 2.0 );
      // The front: glints running outward…
      // (The front's rim takes the surface's albedo and its gloss only wet or
      // waxy surfaces: at a grazing view the band covered whole slopes of dry
      // ground in a blue sheen that read as water.)
      mWakeSpec += wakeTint * band * ( edge * against * 0.5 * min( diffuseColor.rgb * 2.5, vec3( 1.0 ) ) + gloss * 1.2 * smoothstep( 0.6, 0.35, rough ) + magicSparkle( mWorld, mView, 55.0, 0.97 ) * 3.0 );
      // …and a few that keep twinkling behind it.
      mWakeSpec += wakeTint * wakeFront.w * lit * magicSparkle( mWorld, mView, 55.0, 0.988 ) * 2.5;
      mWakeSpec = min( mWakeSpec, vec3( 0.6 ) );
    }
  }
  // The wave (waking.js waveAt): one front of the gift's light crossing the
  // whole island. It is light on things, not a wash: faces turned to the
  // source catch it, rims and gloss flash, and behind the bright leading
  // edge a short tail breaks into glints. Nothing ahead of it, nothing left
  // behind. Outside its band there is no work.
  if ( wakeWave.w + wakeEcho.z > 0.0 ) {
    vec3 vd = wakeSource.xyz - mWorld;
    // (Across the ground, not through the air: from a source 16 m up the
    // lighthouse, a 3D distance laid a broad glare round the tower's foot.)
    float vdist = length( vd.xz );
    float wf = vdist - wakeWave.x;              // + ahead of the front, − behind it
    float ef = vdist - wakeEcho.x;
    bool inWave = wakeWave.w > 0.0 && wf < 3.0 * wakeWave.y && wf > -2.5 * wakeWave.z;
    bool inEcho = wakeEcho.z > 0.0 && abs( ef ) < 3.0 * wakeEcho.y;
    if ( inWave || inEcho ) {
      // From the source's side, a little from above: slopes that face it
      // catch it most, flat ground some, the lee of hills and the far faces
      // of rocks and trunks none.
      vec3 vl = vd / max( vdist, 1e-3 );
      vec3 vv = normalize( vl + vec3( 0.0, 0.4, 0.0 ) );
      float face = clamp( dot( mN, vv ) * WAKE_WRAP + ( 1.0 - WAKE_WRAP ) * 0.5, 0.0, 1.0 );
      float facing = clamp( dot( mN, vl ), 0.0, 1.0 );
      #ifdef WAKE_FOLIAGE
        float vEdge = 0.0;
      #else
        float vEdge = pow( 1.0 - abs( dot( mN, mView ) ), 3.0 ) * ( 0.3 + 0.7 * facing );
      #endif
      #ifdef STANDARD
        float vRough = material.roughness;
      #else
        float vRough = 0.85;
      #endif
      float vGloss = pow( clamp( dot( mN, normalize( vv + mView ) ), 0.0, 1.0 ), mix( 160.0, 12.0, vRough ) ) * smoothstep( 0.7, 0.3, vRough );
      #ifdef WAKE_FOLIAGE
        vGloss *= 0.3; // (a glossy crown flashed white)
      #endif
      vec3 alb = min( diffuseColor.rgb * 2.5, vec3( 1.0 ) );
      if ( inWave ) {
        // Brightest at the leading edge (soft ahead), a tail behind it.
        float crest = exp( -wf * wf / ( wakeWave.y * wakeWave.y ) );
        float tail = wf < 0.0 ? exp( wf / wakeWave.z ) : 0.0;
        // A touch of iridescence at the very edge, just ahead of the crest.
        float ahead = wf > 0.0 ? crest : 0.0;
        vec3 hue = 0.55 + 0.45 * cos( 6.2832 * ( wf / ( wakeWave.y * 3.0 ) + vec3( 0.0, 0.33, 0.67 ) ) );
        vec3 tint = mix( wakeTint, hue * max( wakeTint.r, max( wakeTint.g, wakeTint.b ) ), 0.2 * ahead );
        // The tail shimmers: slow cells of light that thin as it fades.
        // (Fixed in space and slow in time: a point never flickers, < 0.4 Hz.)
        vec2 sq = mWorld.xz * 0.6 + vec2( magicBeam.w * 0.15, 0.0 );
        vec2 si = floor( sq ), sf = fract( sq );
        sf = sf * sf * ( 3.0 - 2.0 * sf );
        float sn = mix( mix( magicHash( vec3( si, 1.0 ) ), magicHash( vec3( si + vec2( 1.0, 0.0 ), 1.0 ) ), sf.x ), mix( magicHash( vec3( si + vec2( 0.0, 1.0 ), 1.0 ) ), magicHash( vec3( si + 1.0, 1.0 ) ), sf.x ), sf.y );
        float shimmer = smoothstep( 0.25, 0.85, sn );
        // (The crest itself is uneven too: never one even stroke.)
        float glow = crest * ( 0.7 + 0.5 * sn ) + tail * 0.07 * shimmer;
        // (Evened over albedo: pale sand glared while dark leaves barely
        // took it; the light reads as one front over both.)
        float even = 1.0 / ( 0.4 + 2.0 * dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) ) );
        // (Softer in the few metres round the eye: as the front passes the
        // camera it sweeps by, it does not fill the frame.)
        float nearEye = mix( 0.35, 1.0, smoothstep( 3.0, 16.0, length( cameraPosition - mWorld ) ) );
        mWake += tint * wakeWave.w * glow * face * even * nearEye;
        mWakeSpec += tint * wakeWave.w * (
          crest * ( vEdge * 0.7 * alb + vGloss * 1.4 + magicSparkle( mWorld, mView, 40.0, 0.95 ) * 2.0 )
          + tail * ( magicSparkle( mWorld, mView, 40.0, 0.93 ) * 1.6 * tail + vGloss * 0.4 ) );
      }
      if ( inEcho ) {
        // The answer: a fainter shimmer running back home.
        float back = exp( -ef * ef / ( wakeEcho.y * wakeEcho.y ) );
        mWake += wakeTint * wakeEcho.z * back * face * 0.5;
        mWakeSpec += wakeTint * wakeEcho.z * back * ( magicSparkle( mWorld, mView, 40.0, 0.94 ) * 2.0 + vGloss );
      }
      mWakeSpec = min( mWakeSpec, vec3( 1.2 ) );
    }
  }
  vec3 mSheen = vec3( 0.0 );
  if ( magicSheen.w > 0.0 ) {
    // Starlight: a cool sheen on whatever faces the sky, rim-brightened,
    // and dew catching it in points that twinkle.
    float rim = pow( 1.0 - clamp( dot( mN, mView ), 0.0, 1.0 ), 3.0 );
    float skyward = clamp( mN.y * 0.5 + 0.5, 0.0, 1.0 );
    // Dew: rare points on upturned leaves and grass, a pixel or two wide
    // (round, and fading out where a cell is bigger than that on screen),
    // twinkling as the eye moves.
    vec3 dp = mWorld * 70.0;
    vec3 cell = floor( dp );
    float spot = 1.0 - smoothstep( 0.12, 0.3, length( fract( dp ) - 0.5 ) );
    float small = 1.0 - smoothstep( 0.6, 2.0, 70.0 * length( fwidth( mWorld ) ) );
    float dew = step( 0.993, magicHash( cell ) ) * spot * small * smoothstep( 0.55, 0.85, mN.y )
      * ( 0.5 + 0.5 * sin( magicHash( cell + 3.1 ) * 40.0 + magicBeam.w * 2.0 + dot( mView, vec3( 30.0 ) ) ) );
    mSheen = ( magicSheen.rgb * ( skyward * ( 0.25 + rim * 0.9 ) ) + magicSheen.rgb * dew * magicSheen.w * 2.5 ) * wakeSheenReach;
  }
  reflectedLight.directDiffuse += ( mLight + mWake ) * diffuseColor.rgb;
  reflectedLight.directSpecular += mLight * 0.035 + mSheen + mWakeSpec;
}
`;

export function magicUniforms() {
  return {
    magicOn: { value: 0 },
    landNightFill: { value: 0 },
    magicGlow: { value: Array.from({ length: 4 }, () => new THREE.Vector4(0, -1000, 0, 1)) },
    magicGlowColour: { value: Array.from({ length: 4 }, () => new THREE.Color(0, 0, 0)) },
    magicLamp: { value: new THREE.Vector4(0, 0, 0, 0) },
    magicBeam: { value: new THREE.Vector4(1, 0, 70, 0) },
    magicSheen: { value: new THREE.Vector4(0, 0, 0, 0) },
    wakeSource: { value: new THREE.Vector4(0, -1000, 0, 1) },
    wakeFront: { value: new THREE.Vector4(0, 1, 0, 0) },
    wakeColour: { value: new THREE.Color(0, 0, 0) },
    wakeTint: { value: new THREE.Color(0, 0, 0) },
    wakeShape: { value: new THREE.Vector4(0, 0, 0, 0) },
    wakeWave: { value: new THREE.Vector4(0, 1, 1, 0) },
    wakeEcho: { value: new THREE.Vector4(0, 1, 0, 0) },
    wakeCat: { value: [new THREE.Vector4(0, -1000, 0, 0), new THREE.Vector4(0, -1000, 0, 0)] },
  };
}

// The same light on materials forest.js does not patch (the cat's coat,
// the animals): wraps each lit material's own onBeforeCompile. Patched
// materials (userData.magicLit) and unlit ones are left alone.
export function lightWithMagic(root, shared) {
  const done = new Set();
  root.traverse((o) => {
    const list = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of list) {
      if (done.has(m) || m.userData.magicLit) continue;
      done.add(m);
      if (!(m.isMeshStandardMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial)) continue;
      m.userData.magicLit = true;
      const before = m.onBeforeCompile;
      const key = m.customProgramCacheKey;
      m.onBeforeCompile = function (shader, renderer) {
        before.call(this, shader, renderer);
        for (const name in shared) if (name.startsWith("magic") || name.startsWith("wake")) shader.uniforms[name] = shared[name];
        shader.fragmentShader = shader.fragmentShader
          .replace("void main() {", `#define WAKE_WRAP 0.7\n${MAGIC_LIGHT_DECLARATIONS}\nvoid main() {`)
          .replace("#include <aomap_fragment>", `${MAGIC_LIGHT_GLSL}\n#include <aomap_fragment>`);
      };
      m.customProgramCacheKey = function () {
        return `${key.call(this)}|magic`;
      };
      m.needsUpdate = true;
    }
  });
}


const ASLEEP = { fireflies: 0, tideglow: 0, lamp: 0, stars: 0, seafolk: 0, boat: 0, finale: 0 };
const LAMP_PERIOD = 12;

// How the lamp catches and its beams take up: the one catch curve every
// waking uses (waking.js).
export { lampCatch, lampSpin };

// Which `count` of the island's lamps lie nearest (x, z): indices into
// `lights`, written into `out` (no allocation).
export function nearestLights(lights, x, z, out, count = 1) {
  out.length = 0;
  for (let k = 0; k < count; k++) {
    let best = -1, bestD = Infinity;
    for (let i = 0; i < lights.length; i++) {
      if (out.includes(i)) continue;
      const d = (lights[i].x - x) ** 2 + (lights[i].z - z) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    }
    if (best >= 0) out.push(best);
  }
  return out;
}

// `shared`: forest.js's uniform set (magicUniforms merged in). `lamps`: the
// island's lamps from places.js ({ x, y, z, colour, size } in coast metres);
// `beacon`: the lighthouse lamp ({ x, y, z }) or null.
export function createLandMagic({ shared, lamps = [], practicals = [], beacon = null, light = false } = {}) {
  const u = shared;
  let beamAngle = 0;
  let lastClock = null;
  const near = [];
  const state = {
    // The lighthouse lamp as the land sees it this frame (coast metres):
    // `lit` 0…1, `angle` the beams' angle in Three world (direction
    // (cos a, sin a) in world x, z = coast (cos a, −sin a)), and the pair.
    lamp: { lit: 0, angle: 0, strength: 0, x: beacon?.x ?? 0, y: beacon?.y ?? 0, z: beacon?.z ?? 0 },
    lampLights: 0,
    // This frame's waking curves (waking.js wakingAt), or null.
    waking: null,
  };
  return {
    state,
    update({ magic = null, time = 0, dt = 0, night = 0, pose = null, flies = null, reduced = false, afloat = false }) {
      const levels = magic?.levels ?? ASLEEP;
      const clock = magic?.clock ?? time;
      const step = lastClock === null ? 0 : Math.max(0, Math.min(0.25, clock - lastClock));
      lastClock = clock;
      const lampLevel = levels.lamp ?? 0;
      let on = 0;

      // The lamp: dark until its gift wakes; then it catches, and the
      // clockwork takes the beams round once every 12 s.
      // (While the lamp's own waking plays, on its wall clock: the same
      // catch as its kindled light.)
      const since = magic?.waking?.gift === "lamp" ? magic.waking.age : clock - (magic?.wakeAt?.lamp ?? Infinity);
      const caught = lampLevel > 0 ? lampCatch(since) * Math.min(1, lampLevel * 1.6) : 0;
      beamAngle = (beamAngle + step * ((Math.PI * 2) / LAMP_PERIOD) * lampSpin(since) * (lampLevel > 0 ? 1 : 0)) % (Math.PI * 2);
      const lamp = state.lamp;
      lamp.lit = caught;
      lamp.angle = beamAngle;
      // Its glass burns by day too once awake; its beams read as the sky darkens.
      lamp.strength = caught * (0.18 + 0.82 * night);
      // The island's other lamps come on with it (a necklace of warm points).
      // (Restraint: the necklace is a few small warm points, not floodlights.)
      state.lampLights = caught * (0.2 + 0.4 * THREE.MathUtils.smoothstep(night, 0.02, 0.3));
      if (beacon && caught > 0) {
        u.magicLamp.value.set(beacon.x, beacon.y, -beacon.z, lamp.strength * 1.0);
        u.magicBeam.value.set(Math.cos(beamAngle), Math.sin(beamAngle), 70, time);
        on = 1;
      } else u.magicLamp.value.w = 0;
      u.magicBeam.value.w = time;

      const glows = u.magicGlow.value, colours = u.magicGlowColour.value;
      // 0: the fireflies round the cat (fireflies.js gives centre and light).
      if (flies && flies.light > 0) {
        glows[0].set(flies.centre[0], flies.centre[1], -flies.centre[2], flies.radius);
        colours[0].setRGB(0.95, 0.88, 0.45).multiplyScalar(flies.light);
        on = 1;
      } else colours[0].setRGB(0, 0, 0);
      // 1: the milkwood's crown, home of the fireflies.
      if (flies && flies.homeLight > 0) {
        glows[1].set(flies.home[0], flies.home[1], -flies.home[2], flies.homeRadius);
        colours[1].setRGB(0.95, 0.86, 0.42).multiplyScalar(flies.homeLight);
        on = 1;
      } else colours[1].setRGB(0, 0, 0);
      // 2: the wisp, the quest's guiding light (magic.wisp, thread.js).
      const wisp = magic?.wisp;
      if (wisp?.visible && wisp.glow > 0) {
        glows[2].set(wisp.position[0], wisp.position[1], -wisp.position[2], 1.5);
        const k = wisp.glow * (0.04 + 0.2 * night);
        colours[2].setRGB(wisp.colour[0] * k, wisp.colour[1] * k, wisp.colour[2] * k);
        on = 1;
      } else colours[2].setRGB(0, 0, 0);
      // 3: whichever of the island's practicals is lit and nearest the cat:
      // the lamps (lit with the lighthouse) and each keepsake's own small
      // steady light, the waking's resolve (`practicals`: { x, y, z,
      // colour, reach, power, gift }, lit by its gift by night; the waking
      // hands over to it, practicalLevel).
      let best = null, bestK = 0, bestD = Infinity;
      if (pose) {
        if (state.lampLights > 0 && lamps.length) {
          nearestLights(lamps, pose.x, pose.z, near, 1);
          const l = lamps[near[0]];
          best = l;
          bestK = state.lampLights * (l.power ?? 0.7) * (0.25 + 0.75 * night);
          bestD = (l.x - pose.x) ** 2 + (l.z - pose.z) ** 2;
        }
        const nightGate = THREE.MathUtils.smoothstep(night, 0.05, 0.4);
        for (const p of practicals) {
          if (p.gift === "boat" && afloat) continue;
          const lvl = levels[p.gift] ?? 0;
          if (lvl <= 0 || nightGate <= 0) continue;
          const handover = magic?.waking?.gift === p.gift ? practicalLevel(magic.waking.age) : 1;
          const k = lvl * handover * nightGate * p.power;
          const d = (p.x - pose.x) ** 2 + (p.z - pose.z) ** 2;
          if (k > 0.003 && d < bestD) [best, bestK, bestD] = [p, k, d];
        }
      }
      // stability: one slot, so a change of light is a hand-over, not a
      // pop: the one held stays until another is clearly nearer (a fifth),
      // fades out over a quarter second, and the new one fades in.
      const slot = (state.slot3 ??= { light: null, fade: 0 });
      if (slot.light && best && best !== slot.light) {
        const held = slot.light;
        const heldD = (held.x - (pose?.x ?? 0)) ** 2 + (held.z - (pose?.z ?? 0)) ** 2;
        const heldLit = lamps.includes(held) ? state.lampLights > 0 : (levels[held.gift] ?? 0) > 0;
        if (heldLit && bestD > heldD * 0.64) [best, bestK] = [held, slot.k ?? bestK];
      }
      const fadeStep = Math.min(1, Math.max(0, dt ?? 0) * 4);
      if (best && best === slot.light) slot.fade = Math.min(1, slot.fade + fadeStep);
      else if (slot.light && slot.fade > 0) slot.fade = Math.max(0, slot.fade - fadeStep);
      else { slot.light = best; slot.fade = reduced ? 1 : fadeStep; }
      if (best === slot.light) slot.k = bestK;
      const shown = slot.light;
      if (shown && slot.fade > 0) {
        const k = (slot.k ?? 0) * slot.fade;
        glows[3].set(shown.x, shown.y, -shown.z, shown.reach ?? 3.5);
        colours[3].setRGB(shown.colour[0] * k, shown.colour[1] * k, shown.colour[2] * k);
        on = 1;
      } else colours[3].setRGB(0, 0, 0);

      // The kindled light of a waking (magic.waking, waking.js).
      const waking = magic?.waking;
      const spec = waking ? WAKE_LIGHT[waking.gift] : null;
      const w = spec ? wakingAt(waking.age, spec, night, reduced) : null;
      state.waking = w;
      if (w && w.radius > 0 && w.inside + w.front + w.glint > 1e-4) {
        u.wakeSource.value.set(waking.x, waking.y, -waking.z, spec.core);
        u.wakeFront.value.set(w.radius, w.width, w.front, w.glint);
        u.wakeColour.value.setRGB(spec.tint[0] * w.inside, spec.tint[1] * w.inside, spec.tint[2] * w.inside);
        u.wakeTint.value.setRGB(spec.tint[0], spec.tint[1], spec.tint[2]);
        u.wakeShape.value.set(spec.ripple ?? 0, spec.up ?? 0, spec.body ?? spec.reach, 0);
        on = 1;
      } else {
        u.wakeFront.value.set(0, 1, 0, 0);
        u.wakeColour.value.setRGB(0, 0, 0);
      }
      // The wave crossing the island (waking.js waveAt).
      const v = spec ? waveAt(waking.age, spec, night, reduced) : WAVE_ZERO;
      state.wave = v;
      if (v.strength + v.echoStrength > 1e-4) {
        u.wakeSource.value.set(waking.x, waking.y, -waking.z, spec.core);
        u.wakeTint.value.setRGB(spec.tint[0], spec.tint[1], spec.tint[2]);
        u.wakeWave.value.set(v.radius, v.lead, v.tail, v.strength);
        u.wakeEcho.value.set(v.echo, 2.5 + 0.02 * v.echo, v.echoStrength, v.presence);
        on = 1;
      } else {
        u.wakeWave.value.w = 0;
        u.wakeEcho.value.set(0, 1, 0, 0);
      }
      // The cat's shadow from it, on the ground, by night and while the
      // light on the cat is enough to cast one (chest and haunch).
      let catLight = 0;
      if (w && pose && w.inside > 0) {
        const dx = pose.x - waking.x, dy = (pose.y ?? 0) - waking.y, dz = pose.z - waking.z;
        const d2 = dx * dx + dy * dy + dz * dz, a2 = spec.core * spec.core;
        catLight = Math.sqrt(d2) < w.radius ? w.inside * (a2 / (d2 + a2)) : 0;
      }
      const shadow = night * THREE.MathUtils.smoothstep(catLight, 0.02, 0.12);
      const cats = u.wakeCat.value;
      if (shadow > 0) {
        const fx = Math.sin(pose.heading ?? 0) * 0.17 * CAT_SCALE, fz = Math.cos(pose.heading ?? 0) * 0.17 * CAT_SCALE;
        const y = (pose.y ?? 0) + 0.22 * CAT_SCALE;
        cats[0].set(pose.x + fx, y, -(pose.z + fz), shadow);
        cats[1].set(pose.x - fx, y, -(pose.z - fz), shadow);
      } else cats[0].w = 0;
      state.catLight = catLight;

      // The cat's steps answer the tideglow alone: blue, on wet sand. As
      // its waking's front crosses them they flash once in turn.
      let printFlash = 0;
      if (waking?.gift === "tideglow" && pose && !reduced) {
        const tCat = frontArrival(Math.hypot(pose.x - waking.x, pose.z - waking.z), spec);
        if (Number.isFinite(tCat)) printFlash = 0.6 * Math.exp(-((waking.age - tCat) ** 2) / 0.3);
      }
      PRINT_MAGIC.level.value = 0.4 * (levels.tideglow ?? 0) + printFlash;
      PRINT_MAGIC.night.value = night;
      PRINT_MAGIC.colour.value.setRGB(...WAKE_LIGHT.tideglow.tint);

      // Starlight (the beacon's gift): a cool sheen on the night land.
      const stars = (levels.stars ?? 0) * THREE.MathUtils.smoothstep(night, 0.3, 0.9);
      if (stars > 0) {
        u.magicSheen.value.set(0.0035 * stars, 0.0052 * stars, 0.011 * stars, light ? 0 : stars);
        on = 1;
      } else u.magicSheen.value.set(0, 0, 0, 0);

      u.magicOn.value = on;
      return state;
    },
  };
}
