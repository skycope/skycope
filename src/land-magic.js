import * as THREE from "three";
import { PRINT_MAGIC } from "./cat-ground.js";

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
//   magicPulse       a waking's ring (Three world x, z, radius m, strength)
//   magicPulseColour its gift's colour
//   magicSheen       starlight on the land (rgb × strength), w: dew glints
//
// No new passes, no lights: a few multiply-adds per fragment, and nothing
// at all while every gift sleeps (a uniform branch the GPU skips whole).

export const MAGIC_LIGHT_DECLARATIONS = /* glsl */ `
uniform float magicOn;
uniform vec4 magicGlow[ 4 ];
uniform vec3 magicGlowColour[ 4 ];
uniform vec4 magicLamp;
uniform vec4 magicBeam;
uniform vec4 magicPulse;
uniform vec3 magicPulseColour;
uniform vec4 magicSheen;
float magicHash( vec3 p ) {
  p = fract( p * 0.1031 );
  p += dot( p, p.zyx + 31.32 );
  return fract( ( p.x + p.y ) * p.z );
}
`;

// After three's light loop: `normal` and vViewPosition are view space.
export const MAGIC_LIGHT_GLSL = /* glsl */ `
if ( magicOn > 0.0 ) {
  vec3 mWorld = cameraPosition + ( vec4( -vViewPosition, 0.0 ) * viewMatrix ).xyz;
  vec3 mN = normalize( ( vec4( normal, 0.0 ) * viewMatrix ).xyz );
  vec3 mLight = vec3( 0.0 );
  vec3 mEdge = vec3( 0.0 );
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
    float cone = exp( -across * across / ( width * width ) ) * mix( 0.3, 1.0, exp( -drop * drop / ( width * width * 9.0 ) ) );
    float reach = smoothstep( 4.0, 14.0, hd ) * exp( -hd / magicBeam.z );
    float face = clamp( dot( mN, -toP ) * inversesqrt( dot( toP, toP ) + 1e-4 ) * 0.7 + 0.3, 0.0, 1.0 );
    mLight += vec3( 1.0, 0.72, 0.4 ) * ( magicLamp.w * cone * reach * face );
  }
  if ( magicPulse.w > 0.0 ) {
    // A ring of light running out across the land, a glow lingering inside.
    float dd = length( mWorld.xz - magicPulse.xy ) - magicPulse.z;
    float ring = exp( -dd * dd * 0.3 ) + 0.18 * exp( min( dd, 0.0 ) * 0.08 ) * step( dd, 0.0 );
    mLight += magicPulseColour * ( magicPulse.w * ring );
    // Its leading edge glows of itself, so it reads even under the sun.
    mEdge = magicPulseColour * ( magicPulse.w * exp( -dd * dd * 1.2 ) * 0.22 );
  }
  vec3 mSheen = vec3( 0.0 );
  if ( magicSheen.w > 0.0 ) {
    // Starlight: a cool sheen on whatever faces the sky, rim-brightened,
    // and dew catching it in points that twinkle.
    vec3 mView = normalize( cameraPosition - mWorld );
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
    mSheen = magicSheen.rgb * ( skyward * ( 0.25 + rim * 0.9 ) ) + magicSheen.rgb * dew * magicSheen.w * 5.0;
  }
  reflectedLight.directDiffuse += mLight * diffuseColor.rgb;
  reflectedLight.directSpecular += mLight * 0.035 + mSheen + mEdge;
}
`;

export function magicUniforms() {
  return {
    magicOn: { value: 0 },
    magicGlow: { value: Array.from({ length: 4 }, () => new THREE.Vector4(0, -1000, 0, 1)) },
    magicGlowColour: { value: Array.from({ length: 4 }, () => new THREE.Color(0, 0, 0)) },
    magicLamp: { value: new THREE.Vector4(0, 0, 0, 0) },
    magicBeam: { value: new THREE.Vector4(1, 0, 70, 0) },
    magicPulse: { value: new THREE.Vector4(0, 0, 0, 0) },
    magicPulseColour: { value: new THREE.Color(1, 1, 1) },
    magicSheen: { value: new THREE.Vector4(0, 0, 0, 0) },
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
        for (const name in shared) if (name.startsWith("magic")) shader.uniforms[name] = shared[name];
        shader.fragmentShader = shader.fragmentShader
          .replace("void main() {", `${MAGIC_LIGHT_DECLARATIONS}\nvoid main() {`)
          .replace("#include <aomap_fragment>", `${MAGIC_LIGHT_GLSL}\n#include <aomap_fragment>`);
      };
      m.customProgramCacheKey = function () {
        return `${key.call(this)}|magic`;
      };
      m.needsUpdate = true;
    }
  });
}

const GIFT_LIST = ["fireflies", "tideglow", "lamp", "stars", "seafolk", "boat"];
const STEP_COLOURS = {
  fireflies: [0.75, 1.0, 0.2], tideglow: [0.2, 0.75, 1.0], lamp: [1.0, 0.68, 0.22],
  stars: [0.66, 0.6, 1.0], seafolk: [0.3, 1.0, 0.7], boat: [1.0, 0.5, 0.38],
};
// The colour of the gifts awake, weighted by level (a warm gold-green
// before any: the island's own hint), saturated against the night tonemap.
export function mixGiftColour(levels, out, night = 0) {
  let r = 0, g = 0, b = 0, w = 0;
  for (const gift of GIFT_LIST) {
    const k = levels[gift] ?? 0;
    if (k <= 0) continue;
    const c = STEP_COLOURS[gift];
    r += c[0] * k; g += c[1] * k; b += c[2] * k; w += k;
  }
  if (w < 1e-3) { r = 0.9; g = 0.95; b = 0.4; w = 1; }
  out.setRGB(r / w, g / w, b / w);
  return out;
}

const ASLEEP = { fireflies: 0, tideglow: 0, lamp: 0, stars: 0, seafolk: 0, boat: 0, finale: 0 };
const LAMP_PERIOD = 12;

// How the lamp catches when it wakes: s seconds after waking, its light
// (0…1). A wick catches, gutters twice, then the light swells and holds.
export function lampCatch(s) {
  if (!(s >= 0)) return s < 0 ? 0 : 1;
  if (s > 4) return 1;
  const spark = Math.min(1, s / 0.25) * 0.35;
  const gutter = s < 1.6 ? 0.55 + 0.45 * Math.abs(Math.sin(s * 9.5)) * (1 - s / 1.6) : 1;
  const swell = THREE.MathUtils.smoothstep(s, 1.0, 3.6);
  return Math.min(1, spark * gutter + swell * 0.9 + 0.1 * swell * swell);
}

// The beams' angular speed s seconds after waking: still while the lamp
// catches, then the clockwork takes up and the first sweep begins.
export function lampSpin(s) {
  if (!(s >= 0)) return s < 0 ? 0 : 1;
  return THREE.MathUtils.smoothstep(s, 2.2, 7.5);
}

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
export function createLandMagic({ shared, lamps = [], beacon = null, light = false } = {}) {
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
  };
  return {
    state,
    update({ magic = null, time = 0, dt = 0, night = 0, pose = null, flies = null }) {
      const levels = magic?.levels ?? ASLEEP;
      const clock = magic?.clock ?? time;
      const step = lastClock === null ? 0 : Math.max(0, Math.min(0.25, clock - lastClock));
      lastClock = clock;
      const lampLevel = levels.lamp ?? 0;
      const finale = levels.finale ?? 0;
      let on = 0;

      // The lamp: dark until its gift wakes; then it catches, and the
      // clockwork takes the beams round once every 12 s.
      const since = clock - (magic?.wakeAt?.lamp ?? Infinity);
      const caught = lampLevel > 0 ? lampCatch(since) * Math.min(1, lampLevel * 1.6) : 0;
      beamAngle = (beamAngle + step * ((Math.PI * 2) / LAMP_PERIOD) * lampSpin(since) * (lampLevel > 0 ? 1 : 0)) % (Math.PI * 2);
      const lamp = state.lamp;
      lamp.lit = caught;
      lamp.angle = beamAngle;
      // Its glass burns by day too once awake; its beams read as the sky darkens.
      lamp.strength = caught * (0.18 + 0.82 * night) * (1 + finale * 0.35);
      // The island's other lamps come on with it (a necklace of warm points).
      state.lampLights = caught * (0.3 + 0.7 * THREE.MathUtils.smoothstep(night, 0.02, 0.3)) * (1 + finale * 0.3);
      if (beacon && caught > 0) {
        u.magicLamp.value.set(beacon.x, beacon.y, -beacon.z, lamp.strength * 2.4);
        u.magicBeam.value.set(Math.cos(beamAngle), Math.sin(beamAngle), 70, time);
        on = 1;
      } else u.magicLamp.value.w = 0;
      u.magicBeam.value.w = time;

      const glows = u.magicGlow.value, colours = u.magicGlowColour.value;
      // 0: the fireflies round the cat (fireflies.js gives centre and light).
      if (flies && flies.light > 0) {
        glows[0].set(flies.centre[0], flies.centre[1], -flies.centre[2], flies.radius);
        colours[0].setRGB(0.8, 0.95, 0.12).multiplyScalar(flies.light);
        on = 1;
      } else colours[0].setRGB(0, 0, 0);
      // 1: the milkwood's crown, home of the fireflies.
      if (flies && flies.homeLight > 0) {
        glows[1].set(flies.home[0], flies.home[1], -flies.home[2], flies.homeRadius);
        colours[1].setRGB(1.0, 0.72, 0.16).multiplyScalar(flies.homeLight);
        on = 1;
      } else colours[1].setRGB(0, 0, 0);
      // 2: the wisp, the quest's guiding light (magic.wisp, thread.js).
      const wisp = magic?.wisp;
      if (wisp?.visible && wisp.glow > 0) {
        glows[2].set(wisp.position[0], wisp.position[1], -wisp.position[2], 2.2);
        const k = wisp.glow * (0.12 + 0.55 * night);
        colours[2].setRGB(wisp.colour[0] * k, wisp.colour[1] * k, wisp.colour[2] * k);
        on = 1;
      } else colours[2].setRGB(0, 0, 0);
      // 3: whichever of the island's lamps is nearest the cat.
      if (state.lampLights > 0 && lamps.length && pose) {
        nearestLights(lamps, pose.x, pose.z, near, 1);
        const l = lamps[near[0]];
        glows[3].set(l.x, l.y, -l.z, l.reach ?? 3.5);
        const k = state.lampLights * (l.power ?? 0.7) * (0.25 + 0.75 * night);
        colours[3].setRGB(l.colour[0] * k, l.colour[1] * k, l.colour[2] * k);
        on = 1;
      } else colours[3].setRGB(0, 0, 0);

      // A waking's ring (magic.pulse: radius (clock − at) × speed, spent
      // past reach), in its gift's colour.
      const pulse = magic?.pulse;
      if (pulse) {
        const r = (clock - pulse.at) * (pulse.speed ?? 18);
        const reach = pulse.reach ?? 150;
        if (r >= 0 && r < reach) {
          const fade = (1 - THREE.MathUtils.smoothstep(r, reach * 0.55, reach)) * THREE.MathUtils.smoothstep(r, 0, 4);
          u.magicPulse.value.set(pulse.x, -pulse.z, r, fade * (1.4 - 0.5 * night));
          // Saturated beyond the gift's own colour: the night tonemap
          // greys dim light toward blue, and the ring must stay its colour.
          const c = pulse.colour ?? [1, 1, 1];
          const luma = c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
          const k = 1 + 1.2 * night;
          u.magicPulseColour.value.setRGB(...c.map((v) => Math.max(0.02, luma + (v - luma) * k)));
          on = 1;
        } else u.magicPulse.value.w = 0;
      } else u.magicPulse.value.w = 0;

      // The cat's steps: a hint of glow from the start, more with every
      // gift awake, and brightest at the finale (cat-ground.js prints).
      let awake = 0;
      for (const g of GIFT_LIST) awake += levels[g] ?? 0;
      PRINT_MAGIC.level.value = (0.12 * night + 0.88 * (awake / GIFT_LIST.length)) * (1 + finale * 0.5);
      PRINT_MAGIC.night.value = night;
      // The step glow takes on the colours of the gifts awake.
      mixGiftColour(levels, PRINT_MAGIC.colour.value, night);

      // Starlight (the beacon's gift): a cool sheen on the night land.
      const stars = (levels.stars ?? 0) * THREE.MathUtils.smoothstep(night, 0.3, 0.9);
      if (stars > 0) {
        u.magicSheen.value.set(0.007 * stars, 0.0105 * stars, 0.022 * stars, light ? 0 : stars);
        on = 1;
      } else u.magicSheen.value.set(0, 0, 0, 0);

      u.magicOn.value = on;
      return state;
    },
  };
}
