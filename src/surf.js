import { createSpray, SPLASH } from "./cat-ground.js";
import { shoreAlong } from "./sea-surface.js";
import { ISLAND, shoreDistance } from "./terrain.js";

// The swash, shared by the beach (forest.js ground) and the rock surf here:
// GLSL twin of set_envelope, breaker_warp and swash in ocean.wgsl, driven by
// the same swell uniform (src/swell.js) and clock. Keep them in step.
// swash() returns (film, foam density, wetness of the sand, film depth).
export const SWASH_GLSL = /* glsl */ `
uniform vec4 swell;
uniform float nightGlow;
float shoreAlong( vec2 p ) {
  vec2 d = p - vec2( 58.0, 70.0 );
  return atan( d.y, d.x ) * 62.0;
}
float swashEnvelope( float along, float time ) {
  return 0.8 + 0.17 * sin( along * 0.032258 - time * 0.061 + 1.3 ) + 0.1 * sin( along * 0.016129 + time * 0.023 );
}
float breakerTheta( float psi, float beta, float q ) {
  float psi1 = psi - beta * cos( psi );
  float theta = psi1 + q * sin( psi1 );
  return psi1 + q * sin( theta );
}
// The breaking train's phase at the waterline, unwrapped: it falls by 2π per wave.
float swashPhase( float along, float time ) {
  return breakerTheta( along * swell.x - swell.y * time + swell.z, 0.65, 0.75 );
}
vec4 swash( float along, float inland, float time ) {
  float s = fract( -swashPhase( along, time ) / 6.283185 );
  float cusps = 1.0 + 0.2 * cos( along * 0.693548 + 0.9 * sin( along * 0.048387 ) );
  float reach = ( 1.2 + swell.w * 6.0 ) * swashEnvelope( along, time ) * cusps;
  float u = s / 0.82;
  float rise = pow( min( u, 1.0 ), 0.65 );
  float front = u < 1.0 ? -0.6 + ( reach + 0.6 ) * sin( 3.141593 * rise ) : -0.6;
  float film = 1.0 - smoothstep( front - 0.1, front + 0.02, inland );
  float edge = smoothstep( front - 0.5, front - 0.02, inland ) * film;
  float backwash = smoothstep( 0.4, 0.6, rise );
  float foam = film * mix( max( edge * 0.95, 0.6 - 0.25 * rise ), 0.5 * ( 1.0 - min( u, 1.0 ) ) + edge * 0.25, backwash );
  float mark = exp( -pow( ( inland - reach ) / 0.09, 2.0 ) ) * backwash * max( 1.0 - u, 0.0 ) * 0.7;
  foam = max( foam, mark );
  float y = clamp( ( inland + 0.6 ) / ( reach + 0.6 ), 0.0, 1.0 );
  float exposed = pow( 1.0 - asin( y ) / 3.141593, 1.0 / 0.65 );
  float period = 6.283185 / swell.y;
  float age = ( inland < reach && u > exposed ) ? ( u - exposed ) * 0.82 * period : 99.0;
  float wet = max( film, exp( -age / 5.0 ) );
  return vec4( film, foam, wet, max( front - inland, 0.0 ) );
}
vec2 swashHash( vec2 p ) {
  vec3 q = fract( p.xyx * vec3( 0.1031, 0.1030, 0.0973 ) );
  q += dot( q, q.yzx + 33.33 );
  return fract( ( q.xx + q.yz ) * q.zy );
}
float swashValue( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = fract( p );
  vec2 u = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( swashHash( i ).x, swashHash( i + vec2( 1.0, 0.0 ) ).x, u.x ),
    mix( swashHash( i + vec2( 0.0, 1.0 ) ).x, swashHash( i + vec2( 1.0, 1.0 ) ).x, u.x ), u.y );
}
// Foam as in foam_cover (ocean.wgsl): holes open round their own seeds as
// the foam thins, at two scales, until only irregular lace is left.
float swashHoles( vec2 q, float local, float cellsPerPixel, float warp ) {
  float thin = 1.0 - local;
  float mean = 1.0 - min( 0.92, 1.55 * thin * thin );
  if ( cellsPerPixel > 0.8 ) return mean;
  vec2 base = floor( q - 0.5 );
  float nearest = 8.0;
  float seed = 0.0;
  for ( int j = 0; j <= 1; j++ ) for ( int i = 0; i <= 1; i++ ) {
    vec2 cell = base + vec2( float( i ), float( j ) );
    vec2 h = swashHash( cell );
    vec2 d = cell + 0.2 + h * 0.6 - q;
    float r = dot( d, d );
    if ( r < nearest ) { nearest = r; seed = h.y; }
  }
  float radius = thin * ( 0.25 + 0.8 * pow( fract( seed * 7.13 ), 1.5 ) );
  float soft = 0.05 + cellsPerPixel * 0.6;
  float open = smoothstep( radius - soft, radius + soft, sqrt( nearest ) + ( warp - 0.5 ) * 0.35 * thin );
  return mix( open, mean, smoothstep( 0.3, 0.8, cellsPerPixel ) );
}
float swashFoam( vec2 qIn, float density, float time, float pixelIn ) {
  vec2 q = qIn * 1.6;
  float pixel = pixelIn * 1.6;
  vec2 w = q + ( vec2( swashValue( q * 0.25 + 3.1 ), swashValue( q * 0.25 + 17.7 ) ) - 0.5 ) * 2.4;
  float clump = swashValue( w * 0.5 + vec2( time * 0.02, 0.0 ) ) * 0.6 + swashValue( w * 1.7 + 5.0 ) * 0.4;
  float fray = mix( swashValue( w * 6.1 + 2.2 ), 0.5, smoothstep( 0.3, 0.8, pixel * 6.1 ) );
  float local = clamp( density * ( 0.2 + 1.9 * clump * clump ) * ( 0.65 + 0.7 * fray ), 0.0, 1.0 );
  if ( local < 0.02 ) return 0.0;
  vec2 bend = vec2( swashValue( w * 2.3 + 1.3 ), swashValue( w * 2.3 + 8.9 ) ) - 0.5;
  float big = swashHoles( w * 1.3 + bend * 1.1, local, pixel * 1.3, fray );
  if ( big < 0.005 ) return 0.0;
  float small = swashHoles( w * 4.1 + bend * 2.2 + 7.3, min( 1.0, local * 1.15 ), pixel * 4.1, 1.0 - fray );
  float film = mix( 0.45 + 0.55 * fray, 1.0, smoothstep( 0.35, 0.85, local ) );
  return big * small * film * smoothstep( 0.02, 0.2, local );
}
// Little bubbles, a few millimetres to a few centimetres: bright rims round
// clear centres with a pinpoint highlight, each living a few seconds before
// it pops and another rises. Sizes are heavy-tailed (many tiny, a few big),
// each sits anywhere in its cell and may cross into the next (the two
// nearest cells on each axis are searched), and they gather where the foam
// clumps. Three layers, each turned and at a non-integer scale, so no
// lattice shows. They average away once smaller than a pixel. Returns
// (coverage, highlight).
vec2 swashBubbles( vec2 p, float time, float pixel, float gate ) {
  vec2 result = vec2( 0.0 );
  float scale = 34.0;
  mat2 turn = mat2( 0.8, 0.6, -0.6, 0.8 );
  for ( int layer = 0; layer < 3; layer++ ) {
    // Even this layer's largest bubbles are below a pixel: so are the rest.
    if ( pixel * scale > 1.0 ) break;
    float fl = float( layer );
    float clump = swashValue( p * ( 2.3 + fl ) + fl * 5.1 );
    float share = gate * ( 0.04 + 0.5 * clump * clump * clump );
    vec2 q = turn * p * scale + fl * 17.0;
    vec2 base = floor( q - 0.5 );
    for ( int j = 0; j < 2; j++ ) for ( int i = 0; i < 2; i++ ) {
      vec2 cell = base + vec2( float( i ), float( j ) );
      vec2 h = swashHash( cell + fl * 31.0 );
      vec2 k = swashHash( cell * 1.7 + 11.0 + fl );
      float life = fract( h.y * 7.0 + time * ( 0.12 + 0.3 * h.x ) );
      if ( k.x > share || life > 0.75 ) continue;
      float r = ( 0.08 + 0.42 * pow( k.y, 4.0 ) ) * ( 1.0 - 0.3 * life );
      float footprint = pixel * scale / ( 2.0 * r );
      if ( footprint > 0.8 ) continue;
      vec2 d = q - ( cell + 0.5 + ( h - 0.5 ) * 0.9 );
      float dist = length( d );
      float hollow = smoothstep( 0.28, 0.45, r );
      float rim = smoothstep( r * 0.6 * hollow, r * 0.9 * hollow + 0.001, dist ) * ( 1.0 - smoothstep( r, r * 1.12, dist ) );
      float glint = 1.0 - smoothstep( 0.0, r * 0.22, length( d + r * vec2( 0.35, -0.35 ) ) );
      float resolved = 1.0 - smoothstep( 0.35, 0.8, footprint );
      result += vec2( rim * mix( 0.6, 0.85, hollow ), glint ) * resolved;
    }
    scale *= 1.93;
    turn = turn * mat2( 0.28, 0.96, -0.96, 0.28 );
  }
  return min( result, vec2( 1.0 ) );
}
`;

// Spray where the sea meets a boulder: each rock that straddles the
// waterline takes every broken swell on its seaward face and throws it up in
// a burst of torn sheets, drops and mist that climbs the face, spills over
// the top and rains back into the sea. The size of each hit varies from wave
// to wave, and grows with the set, the rock and how far out it stands (a
// rock high on the beach only sees the swash). Between swells the wind chop
// slaps it. The water pass draws the rest (ocean.wgsl, rocks.wgsl): the
// rings, the foam collar and the calm lee. Timed on the swash clock (swash
// above, ocean.wgsl), so the spray flies as the collar surges. Coast metres,
// in the land group; lit by the shared foamLight.
export function createSurf(group, rocks, shared, { light = false } = {}) {
  const sections = [];
  for (const rock of rocks) {
    const cy = rock.position.y;
    const sy = rock.scale.y;
    if (cy + sy * 0.75 < 0.05 || cy - sy * 0.75 > 0.02) continue;
    const t = Math.min(0.95, Math.abs(cy) / sy);
    const radius = ((rock.scale.x + rock.scale.z) / 2) * 0.86 * Math.sqrt(1 - t * t);
    if (radius < 0.12) continue;
    const dx = rock.position.x - ISLAND.x;
    const dz = rock.position.z - ISLAND.z;
    const d = Math.hypot(dx, dz) || 1;
    sections.push({
      x: rock.position.x,
      z: rock.position.z,
      r: radius,
      top: Math.max(0.1, cy + sy),
      seaward: [dx / d, dz / d],
      along: shoreAlong(rock.position.x, rock.position.z),
      inland: shoreDistance(rock.position.x, rock.position.z),
      phase: Math.random() * 6.28,
      wave: null,
      slap: Math.random() * 3,
    });
  }
  if (!sections.length) return { update() {}, dispose() {} };
  const spray = createSpray(group, { grains: light ? 3072 : 8192, maxPixels: light ? 48 : 96 });
  const gain = light ? 0.6 : 1;
  const swell = shared.swell.value;
  let last = null;
  const hash = (a, b) => fract(Math.sin(a * 12.9898 + b * 78.233) * 43758.5453);

  // One wave's hit: strength 0…1 of a big one.
  // lod: 1 up close; further off, fewer and bigger particles cover the
  // same spray.
  const hit = (time, rock, strength, level, lod) => {
    const g = gain * SPLASH.gain * (0.35 + rock.r) * strength * lod;
    const grow = 1 / Math.sqrt(lod);
    const [sx, sz] = rock.seaward;
    const face = Math.atan2(sz, sx);
    const floor = level - 0.02;
    // Water the face stops dead shoots up it and over the top, faster the
    // bigger the wave; round the flanks it wraps past, low and wide; and
    // mist hangs over the rock as the rest falls. [count, sizes, upward and
    // outward speeds, arc round the face, launch spread]
    for (const [n, size, up, out, arc, flank, delay] of [
      [250, [0.06, 0.2], [2 + 2.6 * strength, 3.2 + 3.4 * strength], [0.3, 0.8 + 0.8 * strength], 1.0, false, 0.25],
      [500, [0.006, 0.02], [1.8 + 2.4 * strength, 3.4 + 4 * strength], [0.3, 1.2 + 1.2 * strength], 1.0, false, 0.3],
      [120, [0.05, 0.15], [0.7, 1.4 + 1.6 * strength], [0.5, 1.4 + 0.9 * strength], 0.7, true, 0.35],
      [250, [0.006, 0.018], [0.7, 1.6 + 1.8 * strength], [0.5, 1.6 + 1.1 * strength], 0.7, true, 0.35],
      [30, [0.25, 0.5], [1.2, 2.4 + 2.4 * strength], [0.1, 0.5], 1.0, false, 0.4],
    ]) {
      const count = Math.round(n * g);
      for (let k = 0; k < count; k++) {
        // On the face: carried on landward over the top (a few flung back
        // out to sea). On a flank: past it, outward and landward.
        const side = Math.random() < 0.5 ? -1 : 1;
        const a = flank ? face + side * (1.2 + Math.random() * arc) : face + (Math.random() * 2 - 1) * arc;
        const back = !flank && Math.random() < 0.2 ? -1 : 1;
        const dir = flank ? [Math.cos(a) * 0.7 - sx * 0.7, Math.sin(a) * 0.7 - sz * 0.7] : [-sx * back, -sz * back];
        spray.burst(time, {
          x: rock.x + Math.cos(a) * rock.r * 0.95,
          y: level,
          z: rock.z + Math.sin(a) * rock.r * 0.95,
          n: 1,
          dir,
          spread: flank ? 0.4 : 0.9,
          speed: out,
          up,
          size: [size[0] * grow, size[1] * grow],
          radius: 0.05,
          floor,
          delay,
        });
      }
    }
  };
  // The chop slapping the face: a small throw at one point.
  const slap = (time, rock, strength, level, lod) => {
    const [sx, sz] = rock.seaward;
    const a = Math.atan2(sz, sx) + (Math.random() * 2 - 1) * 1.4;
    const at = { x: rock.x + Math.cos(a) * rock.r, y: level, z: rock.z + Math.sin(a) * rock.r, dir: [Math.cos(a), Math.sin(a)], radius: 0.08, floor: level - 0.02 };
    const g = gain * SPLASH.gain * strength * (0.5 + rock.r) * lod;
    spray.burst(time, { ...at, n: 45 * g, spread: 0.9, speed: [0.1, 0.6], up: [0.6, 1.4 + strength], size: [0.006, 0.018], delay: 0.08 });
    spray.burst(time, { ...at, n: 12 * g, spread: 0.7, speed: [0.05, 0.4], up: [0.5, 1 + strength * 0.8], size: [0.03, 0.08], delay: 0.08 });
  };

  return {
    // `?perf` QA: the rocks that throw spray, and their last hit.
    sections,
    // eye: the camera (coast metres). water(x, z) → { level }.
    update(time, eye, pixelScale, water) {
      spray.update(time, shared.foamLight.value, pixelScale);
      const dt = last === null ? 0 : clamp(time - last, 0, 0.1);
      last = time;
      for (const rock of sections) {
        // Far off, the spray is too small to be worth its particles.
        const far = Math.hypot(rock.x - eye[0], rock.z - eye[2]);
        const cycle = -breakerTheta(rock.along * swell.x - swell.y * time + swell.z, 0.65, 0.75) + 0.4;
        const wave = Math.floor(cycle / 6.283185);
        const fresh = rock.wave !== null && wave !== rock.wave;
        rock.wave = wave;
        if (far > 60) continue;
        const lod = clamp(12 / far, 0.2, 1);
        // The set and the swash's reach up the beach (swash above).
        const envelope = 0.8 + 0.17 * Math.sin(rock.along * 0.032258 - time * 0.061 + 1.3) + 0.1 * Math.sin(rock.along * 0.016129 + time * 0.023);
        const reach = (1.2 + swell.w * 6) * envelope;
        const exposure = 1 - smooth(-1.5, reach, rock.inland - rock.r);
        if (exposure <= 0) continue;
        const sample = () => {
          const at = water(rock.x + rock.seaward[0] * (rock.r + 0.15), rock.z + rock.seaward[1] * (rock.r + 0.15)).level;
          return Number.isFinite(at) ? at : 0;
        };
        if (fresh) {
          // Some swells hit hard, most modestly.
          const size = Math.pow(hash(wave, rock.phase), 1.3);
          const strength = exposure * (0.4 + 0.6 * size) * clamp(swell.w / 0.17, 0.6, 1.4) * envelope;
          rock.hit = { time, strength };
          hit(time, rock, strength, sample(), lod);
        }
        rock.slap -= dt;
        if (rock.slap < 0 && rock.inland < rock.r) {
          rock.slap = 0.6 + Math.random() * 1.6;
          slap(time, rock, exposure * (0.35 + Math.random() * 0.6), sample(), lod);
        }
      }
    },
    dispose() {
      spray.dispose();
    },
  };
}

function breakerTheta(psi, beta, q) {
  const psi1 = psi - beta * Math.cos(psi);
  const theta = psi1 + q * Math.sin(psi1);
  return psi1 + q * Math.sin(theta);
}

function fract(v) {
  return v - Math.floor(v);
}

function clamp(v, a, b) {
  return Math.min(b, Math.max(a, v));
}

function smooth(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
