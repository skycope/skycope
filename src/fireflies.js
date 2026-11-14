import * as THREE from "three";
import { seededRandom } from "./random.js";
import { terrainHeight, ISLAND } from "./terrain.js";

// The old milkwood's gift: lights that live in the island's air. Three
// flocks in one draw call of soft points, flown entirely on the GPU from a
// few uniforms:
//
//   escort  round the cat: they gather about it, stream behind it when it
//           runs, scatter when it leaps and re-form, settle on it as it
//           dozes, and flash together when it meows (magic.call)
//   home    in the milkwood's crown, breathing slowly like hung lanterns
//   roam    drifting over the grass and through the woods wherever you are
//
// By day the same lights are sun-motes and floating seed-down: warm, pale
// and fewer, glinting in the cat's wake. At the finale every one of them
// rises in a slow turning column over the summit and spreads into the sky.
// Asleep (level 0) the mesh is hidden: no draw, no update.

export const FLY_KIND = { escort: 0, home: 1, roam: 2 };

// Per-fly traits, deterministic by seed: [phase, reach, height, size] and
// [kind, blink phase]. Shares: escort 22 %, home 40 %, roam the rest: the
// milkwood's own colony is the densest.
export function fireflyTraits(seed, count) {
  const random = seededRandom((seed ^ 0xf1ef1e5) >>> 0 || 1);
  const traits = new Float32Array(count * 4);
  const kinds = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    const share = i / count;
    const kind = share < 0.22 ? FLY_KIND.escort : share < 0.62 ? FLY_KIND.home : FLY_KIND.roam;
    traits[i * 4] = random();
    traits[i * 4 + 1] = random();
    traits[i * 4 + 2] = random();
    // Mostly small, a few large and near: depth and variety.
    traits[i * 4 + 3] = 0.55 + random() ** 3 * 1.4;
    kinds[i * 2] = kind;
    kinds[i * 2 + 1] = random();
  }
  return { traits, kinds };
}

// The escort's steering, on the CPU (a handful of numbers a frame, no
// allocation): where its centre is (coast metres), how far it spreads,
// the trail it streams along, scatter after a leap, settling as the cat
// dozes, and the flash of a meow.
export function createFlySteer() {
  const s = {
    x: 0, y: -100, z: 0, vx: 0, vz: 0,
    spread: 1.25, scatter: 0, sleep: 0, call: 0, gather: 0, still: 0,
    lastX: NaN, lastZ: NaN, lastCall: null,
  };
  return {
    state: s,
    step(dt, pose, call = null) {
      if (!pose) return s;
      dt = Math.min(Math.max(dt, 0), 0.1);
      if (!Number.isFinite(s.lastX) || !(dt > 0)) {
        s.x = pose.x; s.y = (pose.y ?? 0) + 0.4; s.z = pose.z;
        s.lastX = pose.x; s.lastZ = pose.z;
        if (!(dt > 0)) return s;
      }
      // The cat's ground velocity, smoothed (from its moves, so a teleport
      // is clamped rather than streaked across the island).
      const mx = Math.max(-12, Math.min(12, (pose.x - s.lastX) / dt));
      const mz = Math.max(-12, Math.min(12, (pose.z - s.lastZ) / dt));
      s.lastX = pose.x; s.lastZ = pose.z;
      const kv = 1 - Math.exp(-dt * 4);
      s.vx += (mx - s.vx) * kv;
      s.vz += (mz - s.vz) * kv;
      // The swarm's heart lags the cat a little: it follows, it is not glued.
      const k = 1 - Math.exp(-dt * 2.2);
      const far = Math.hypot(pose.x - s.x, pose.z - s.z);
      const snap = far > 25 ? 1 : k;
      s.x += (pose.x - s.x) * snap;
      s.y += ((pose.y ?? 0) + 0.45 - s.y) * snap;
      s.z += (pose.z - s.z) * snap;
      // A leap throws them wide; they drift back over a second or two.
      if ((pose.air ?? 0) > 0.05) s.scatter = Math.min(1, s.scatter + dt * 6);
      else s.scatter *= Math.exp(-dt * 1.4);
      // Dozing: they come down and settle on its back.
      const dozing = Math.min(1, Math.max(0, ((pose.sleepy ?? 0) - 0.2) / 0.3));
      s.sleep += (dozing - s.sleep) * (1 - Math.exp(-dt * 0.6));
      // A meow: every one flashes at once, and they draw in close.
      if (call && call !== s.lastCall) {
        s.call = 1;
        s.lastCall = call;
      }
      s.call *= Math.exp(-dt * 1.1);
      const speed = Math.hypot(s.vx, s.vz);
      // They come to a cat that has stopped (or called), and drift off
      // again, thinning and widening, once it moves on.
      s.still = speed < 0.25 ? s.still + dt : 0;
      const want = Math.max(Math.min(1, Math.max(0, s.still - 1.5) / 3), s.call);
      s.gather += (want - s.gather) * (1 - Math.exp(-dt * (want > s.gather ? 0.7 : 0.35)));
      s.spread = (1.25 + Math.min(speed, 6) * 0.08 + s.scatter * 2.2) * (1.9 - 0.9 * s.gather);
      return s;
    },
  };
}

const VERTEX = /* glsl */ `
attribute vec4 trait;
attribute vec2 kind;
uniform float time;
uniform float level;
uniform float night;
uniform float call;
uniform float sleep;
uniform float finale;
uniform float pixelScale;
uniform vec4 escort;   // centre (Three world), spread
uniform vec4 trail;    // lag (world x, z, metres), scatter, unused
uniform vec4 home;     // crown foot (Three world: x, ground y, z), radius
uniform float homeSpan; // crown height above the ground
uniform vec4 roam;     // eye (Three world), ground height near the cat
uniform float gather;  // how many of the escort are close (0 few … 1 a cloud)
uniform sampler2D ground; // terrain height over the island (fireflies stay above it)
uniform vec4 groundBox;   // x0, z0 (coast), span, unused
float groundAt( vec3 w ) {
  vec2 uv = ( vec2( w.x, -w.z ) - groundBox.xy ) / groundBox.z;
  return texture2D( ground, clamp( uv, 0.0, 1.0 ) ).r;
}
uniform vec4 column;   // summit (Three world), height
varying vec3 vColour;
varying float vGlow;
varying float vSoft;
void main() {
  float a = trait.x, r = trait.y, h = trait.z;
  float t = time;
  vec3 p;
  float glow;
  float present = 1.0;
  if ( kind.x < 0.5 ) {
    // Escort: each on its own slow orbit, wobbling, some one way, some the
    // other; the trail pulls them out behind a running cat like a comet.
    float dir = fract( a * 13.7 ) > 0.5 ? 1.0 : -1.0;
    float ang = a * 6.2832 + t * ( 0.22 + 0.38 * r ) * dir;
    float rad = escort.w * ( 0.3 + r * 1.1 ) * ( 1.0 - 0.75 * sleep ) * ( 1.0 - 0.35 * call );
    vec3 off = vec3( cos( ang ) * rad, 0.0, sin( ang ) * rad );
    off.y = mix( ( h * 1.4 - 0.25 ) + sin( t * 0.9 + a * 31.0 ) * 0.18, 0.02 + h * 0.12, sleep );
    off.xz -= trail.xy * ( 0.1 + r * r * 1.3 );
    off += vec3( sin( t * 1.3 + a * 50.0 ), sin( t * 1.1 + h * 40.0 ) * 0.6, cos( t * 1.7 + r * 60.0 ) ) * ( 0.12 + trail.z * 1.4 * r );
    p = escort.xyz + off;
    float blink = pow( max( 0.0, sin( t * ( 0.9 + r * 0.7 ) + kind.y * 6.2832 ) ), 6.0 );
    glow = mix( 0.22 + 0.78 * blink, 0.55 + 0.25 * sin( t * 0.4 + a * 9.0 ), sleep );
    // Only some of the escort are lit at once: the cat shows through them.
    // Only some of the escort are near at once: a few while the cat goes,
    // more as it stops; each fades in and out rather than popping.
    float share = mix( 0.12, 0.38, gather );
    present = 1.0 - smoothstep( share - 0.06, share, kind.y );
  } else if ( kind.x < 1.5 ) {
    // Home: hung under the milkwood's dome, where the cat walks, and over
    // its outer leaves, on slow drifting paths, breathing.
    float th = a * 6.2832 + t * 0.025 * ( r - 0.5 );
    if ( fract( a * 3.7 ) < 0.6 ) {
      float rr = home.w * ( 0.12 + 0.72 * sqrt( r ) );
      p = home.xyz + vec3( cos( th ) * rr, 1.0 + h * homeSpan * 0.32, sin( th ) * rr );
    } else {
      float el = mix( 0.0, 1.3, h * h );
      float rr = home.w * 1.04;
      p = home.xyz + vec3( cos( th ) * cos( el ) * rr, homeSpan * ( 0.3 + sin( el ) * 0.72 ), sin( th ) * cos( el ) * rr );
    }
    p += vec3( sin( t * 0.31 + a * 20.0 ), sin( t * 0.23 + h * 30.0 ) * 0.5, cos( t * 0.27 + r * 25.0 ) ) * 0.35;
    glow = 0.35 + 0.65 * pow( 0.5 + 0.5 * sin( t * 0.55 + kind.y * 6.2832 ), 2.0 );
  } else {
    // Roam: a 36 m box wrapped round the eye, drifting with slow eddies, a
    // little above the ground near the cat.
    float size = 36.0;
    vec3 base = vec3( a, 0.0, r ) * size + vec3( sin( t * 0.05 + h * 9.0 ), 0.0, cos( t * 0.04 + a * 7.0 ) ) * 4.0;
    vec3 lo = roam.xyz - size * 0.5;
    p = lo + mod( base - lo, size );
    p.y = 0.25 + h * h * 3.2 + sin( t * 0.6 + a * 40.0 ) * 0.25;
    // Fade at the box's edges, so wrapping never pops.
    vec2 e = abs( p.xz - roam.xz ) / ( size * 0.5 );
    present = 1.0 - smoothstep( 0.75, 1.0, max( e.x, e.y ) );
    float blink = pow( max( 0.0, sin( t * ( 0.7 + r * 0.5 ) + kind.y * 6.2832 ) ), 10.0 );
    glow = 0.1 + 0.9 * blink;
  }
  // A meow: every light on the island answers at once.
  glow = mix( glow, 1.4, call * ( kind.x < 0.5 ? 1.0 : 0.6 ) );
  // The finale: they rise from wherever they are into a slow turning
  // column over the summit, and spread out into the sky at its top.
  float rise = 0.0;
  if ( finale > 0.0 ) {
    // (The cat keeps a few of its own: the escort stays with it.)
    float k = smoothstep( 0.0, 1.0, clamp( finale * 1.8 - a * 0.8, 0.0, 1.0 ) ) * ( kind.x < 0.5 ? 0.0 : 1.0 );
    rise = k;
    float u = fract( a * 7.31 + r * 0.37 + t * 0.011 );
    float ang = u * 26.0 + t * 0.22 + r * 6.2832;
    float rad = 0.8 + r * 2.2 + u * 3.0 + pow( u, 4.0 ) * 30.0;
    vec3 col = column.xyz + vec3( cos( ang ) * rad, u * column.w + sin( t * 0.5 + a * 30.0 ) * 0.6, sin( ang ) * rad );
    p = mix( p, col, k );
    glow = mix( glow, 0.6 + 0.4 * sin( t * 1.3 + kind.y * 6.2832 ), k );
    present = mix( present, 1.0, k );
  }
  // Never in the ground: lifted to at least a hand above the terrain.
  if ( rise < 0.5 ) {
    float g = groundAt( p );
    if ( kind.x > 1.5 ) p.y += g;
    p.y = max( p.y, g + 0.12 );
  }
  vec4 mv = viewMatrix * vec4( p, 1.0 );
  gl_Position = projectionMatrix * mv;
  float depth = max( -mv.z, 0.05 );
  // A small light (a few cm) with a soft halo several times its size.
  float lantern = kind.x > 0.5 && kind.x < 1.5 ? step( 0.55, trait.w ) : 0.0;
  // The column's lights are seen from across the island: larger than life.
  float px = trait.w * mix( 0.1, 0.13, lantern ) * ( 1.0 + rise * 3.0 ) * pixelScale / depth;
  // Never a large soft disc: a firefly is a point with a small halo.
  // (The crown's lanterns may be a little larger: they hang in the leaves.)
  gl_PointSize = clamp( px, 2.0, 12.0 );
  // Under a pixel and a half, brightness carries what size cannot.
  float tiny = clamp( px / 2.0, 0.15, 1.0 );
  // Too close to the lens: fade rather than fill the screen.
  float near = smoothstep( 0.8, 2.6, depth ) * ( 1.0 - smoothstep( 14.0, 20.0, px ) * 0.5 );
  // Firefly gold-green by night; sun-warm seed-down by day.
  // (Saturated beyond what they look: the night tonemap greys dim colour.)
  float tone = fract( a * 5.3 + r );
  vec3 fly = mix( mix( vec3( 1.0, 0.8, 0.38 ), vec3( 0.86, 0.95, 0.42 ), tone ), vec3( 1.0, 0.68, 0.3 ), step( 0.82, fract( r * 7.7 ) ) );
  // The crown's lights are amber and larger, like lanterns in the leaves.
  fly = mix( fly, vec3( 1.0, 0.66, 0.3 ), lantern );
  vec3 down = mix( vec3( 1.0, 0.93, 0.78 ), vec3( 1.0, 0.82, 0.55 ), r );
  vColour = mix( down, fly, night );
  // The milkwood is their one dense place; the roaming ones are few and faint.
  float colony = kind.x > 0.5 && kind.x < 1.5 ? 1.1 : kind.x > 1.5 ? 0.45 : 0.8;
  vGlow = glow * level * present * near * tiny * mix( 0.5, 1.35, night ) * colony;
  vSoft = mix( 0.55, 1.0, night );
}`;

const FRAGMENT = /* glsl */ `
varying vec3 vColour;
varying float vGlow;
varying float vSoft;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot( q, q );
  // A hot core, a soft halo with a long tail (the eye's own bloom).
  float core = exp( -r2 * 34.0 ) * 1.6;
  float halo = exp( -r2 * 6.0 ) * 0.32 * vSoft + exp( -r2 * 2.2 ) * 0.08 * vSoft;
  vec3 c = vColour * ( core + halo ) * vGlow + vec3( 1.0, 0.95, 0.75 ) * core * vGlow * 0.15;
  gl_FragColor = vec4( c * ( 1.0 - smoothstep( 0.7, 1.0, r2 ) ), 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// `scene`: Three world (not the mirrored land group). `crown`: the
// milkwood's ({ x, z, radius, top }, coast metres). `summit`: { x, y, z }.
// `surface(x, z)`: the ground with the boulders and landmarks on it
// (walker.js surfaceOf), so no firefly sits inside a rock.
export function createFireflies(scene, seed, { light = false, crown = null, summit = null, surface = null } = {}) {
  // Restraint: a real night has a few hundred, not a wall of them.
  const count = light ? 260 : 600;
  const { traits, kinds } = fireflyTraits(seed, count);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geometry.setAttribute("trait", new THREE.BufferAttribute(traits, 4));
  geometry.setAttribute("kind", new THREE.BufferAttribute(kinds, 2));
  const homeAt = crown ? new THREE.Vector4(crown.x, crown.ground, -crown.z, crown.radius * 0.95) : new THREE.Vector4(0, -500, 0, 1);
  // The terrain under them (128² over the island, half floats) so no light
  // ever sinks into a slope.
  const GN = 128, span = 200, gx0 = ISLAND.x - span / 2, gz0 = ISLAND.z - span / 2;
  const heights = new Uint16Array(GN * GN);
  // solid: the highest of the boulders over each texel too (sampled across
  // it, the texel being wider than a small boulder): they hung inside rocks.
  const cell = span / GN;
  const top = surface ?? terrainHeight;
  for (let j = 0; j < GN; j++)
    for (let i = 0; i < GN; i++) {
      let h = -2;
      for (let b = 0; b < 3; b++)
        for (let a = 0; a < 3; a++) h = Math.max(h, top(gx0 + (i + (a + 0.5) / 3) * cell, gz0 + (j + (b + 0.5) / 3) * cell));
      heights[j * GN + i] = THREE.DataUtils.toHalfFloat(h);
    }
  const groundTexture = new THREE.DataTexture(heights, GN, GN, THREE.RedFormat, THREE.HalfFloatType);
  groundTexture.magFilter = THREE.LinearFilter;
  groundTexture.minFilter = THREE.LinearFilter;
  groundTexture.needsUpdate = true;
  const uniforms = {
    ground: { value: groundTexture },
    groundBox: { value: new THREE.Vector4(gx0, gz0, span, 0) },
    gather: { value: 0 },
    time: { value: 0 },
    level: { value: 0 },
    night: { value: 0 },
    call: { value: 0 },
    sleep: { value: 0 },
    finale: { value: 0 },
    pixelScale: { value: 600 },
    escort: { value: new THREE.Vector4(0, -100, 0, 1.3) },
    trail: { value: new THREE.Vector4() },
    home: { value: homeAt },
    homeSpan: { value: crown ? crown.top - crown.ground : 8 },
    roam: { value: new THREE.Vector4() },
    column: { value: summit ? new THREE.Vector4(summit.x, summit.y + 2, -summit.z, 34) : new THREE.Vector4(58, 30, -70, 75) },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthWrite: false,
    // Add light; leave the canvas alpha alone (motes.js).
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    blendSrcAlpha: THREE.ZeroFactor,
    blendDstAlpha: THREE.OneFactor,
    fog: false,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = 13;
  points.visible = false;
  points.matrixAutoUpdate = false;
  scene.add(points);
  const steer = createFlySteer();
  const homeFoot = crown ? [crown.x, crown.ground + 2.2, crown.z] : [0, -500, 0];
  const homeRadius = crown ? Math.min(7, crown.radius * 0.55) : 1;
  // What the land reads to be lit by them (land-magic.js glow slots 0, 1).
  const glow = {
    light: 0, centre: [0, -100, 0], radius: 2.6,
    homeLight: 0, home: crown ? [crown.x, crown.ground + 2.2, crown.z] : [0, -500, 0], homeRadius: crown ? Math.min(7, crown.radius * 0.55) : 1,
  };
  return {
    points,
    steer,
    glow,
    // `level`: magic.levels.fireflies; `finale`: magic.levels.finale.
    update({ dt, time, pose, night, level = 0, finale = 0, call = null, eye, pixelScale }) {
      const on = Math.max(level, finale);
      points.visible = on > 0.002;
      if (!points.visible) {
        glow.light = 0;
        glow.homeLight = 0;
        steer.state.lastX = NaN;
        return glow;
      }
      const s = steer.step(dt, pose, call);
      uniforms.time.value = time;
      uniforms.level.value = on;
      uniforms.night.value = night;
      uniforms.call.value = s.call;
      uniforms.sleep.value = s.sleep;
      uniforms.finale.value = finale;
      uniforms.pixelScale.value = pixelScale;
      uniforms.escort.value.set(s.x, s.y, -s.z, s.spread);
      uniforms.gather.value = s.gather;
      // The trail: how far behind (metres) the slowest of them lag.
      uniforms.trail.value.set(s.vx * 0.55, -s.vz * 0.55, s.scatter, 0);
      uniforms.roam.value.set(eye.x, eye.y, eye.z, (pose?.y ?? 0));
      const dark = 0.12 + 0.88 * night;
      // A local pool round the cat, never brighter than the wisp's.
      glow.light = Math.min(0.24, on * dark * (0.06 + 0.12 * s.gather + 0.04 * Math.sin(time * 1.3) ** 2 + s.call * 0.2));
      glow.centre[0] = s.x; glow.centre[1] = s.y + 0.2; glow.centre[2] = s.z;
      glow.radius = 1.0 + s.spread * 0.35;
      // The colony's pool on the grass under the dome: local, breathing.
      glow.homeLight = Math.min(0.4, on * dark * (0.3 + 0.06 * Math.sin(time * 0.55)));
      // The finale: the crown's light moves to the column over the summit
      // and grows to light the whole hilltop under it.
      if (finale > 0 && summit) {
        const f = finale;
        glow.home[0] = homeFoot[0] + (summit.x - homeFoot[0]) * f;
        glow.home[1] = homeFoot[1] + (summit.y + 9 - homeFoot[1]) * f;
        glow.home[2] = homeFoot[2] + (summit.z - homeFoot[2]) * f;
        glow.homeRadius = homeRadius + (9 - homeRadius) * f;
        glow.homeLight = glow.homeLight * (1 - f) + f * Math.min(0.6, dark * (0.5 + 0.1 * Math.sin(time * 0.4)));
      }
      return glow;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      groundTexture.dispose();
      scene.remove(points);
    },
  };
}
