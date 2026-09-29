import * as THREE from "three";

// The swash, shared by the beach (forest.js ground) and the rock surf here:
// GLSL twin of set_envelope, breaker_warp and swash in ocean.wgsl, driven by
// the same swell uniform (src/swell.js) and clock. Keep them in step.
// swash() returns (film, foam density, wetness of the sand, film depth).
export const SWASH_GLSL = /* glsl */ `
uniform vec4 swell;
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
float swashHoles( vec2 q, float local, float cellsPerPixel ) {
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
  float open = smoothstep( radius - soft, radius + soft, sqrt( nearest ) );
  return mix( open, mean, smoothstep( 0.3, 0.8, cellsPerPixel ) );
}
float swashFoam( vec2 q, float density, float time, float pixel ) {
  vec2 w = q + ( vec2( swashValue( q * 0.25 + 3.1 ), swashValue( q * 0.25 + 17.7 ) ) - 0.5 ) * 2.4;
  float clump = swashValue( w * 0.5 + vec2( time * 0.02, 0.0 ) ) * 0.6 + swashValue( w * 1.7 + 5.0 ) * 0.4;
  float local = clamp( density * ( 0.2 + 1.9 * clump * clump ), 0.0, 1.0 );
  if ( local < 0.02 ) return 0.0;
  vec2 bend = vec2( swashValue( w * 2.3 + 1.3 ), swashValue( w * 2.3 + 8.9 ) ) - 0.5;
  float big = swashHoles( w * 1.3 + bend * 1.1, local, pixel * 1.3 );
  if ( big < 0.005 ) return 0.0;
  float small = swashHoles( w * 4.1 + bend * 2.2 + 7.3, min( 1.0, local * 1.15 ), pixel * 4.1 );
  float speck = mix( swashValue( w * 11.0 + 3.0 ), 0.5, smoothstep( 0.3, 0.8, pixel * 11.0 ) );
  float film = mix( 0.45 + 0.55 * speck, 1.0, smoothstep( 0.35, 0.85, local ) );
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
      float hollow = smoothstep( 0.12, 0.3, r );
      float rim = smoothstep( r * 0.6 * hollow, r * 0.9 * hollow + 0.001, dist ) * ( 1.0 - smoothstep( r, r * 1.12, dist ) );
      float glint = 1.0 - smoothstep( 0.0, r * 0.22, length( d + r * vec2( 0.35, -0.35 ) ) );
      float resolved = 1.0 - smoothstep( 0.35, 0.8, footprint );
      result += vec2( rim * 0.85, glint ) * resolved;
    }
    scale *= 1.93;
    turn = turn * mat2( 0.28, 0.96, -0.96, 0.28 );
  }
  return min( result, vec2( 1.0 ) );
}
`;

// Spray where the sea meets a boulder: each rock that straddles the
// waterline throws droplets on the bigger surges, on the swash clock. The
// water pass draws the rest (ocean.wgsl, rocks.wgsl): lapping ripples, the
// foam collar, the calm lee. One point cloud for all rocks; coordinates
// follow the land group (coast metres, z mirrored by the parent), lit by the
// shared foamLight.
export function createSurf(group, rocks, shared) {
  const sections = [];
  for (const rock of rocks) {
    const cy = rock.position.y;
    const sy = rock.scale.y;
    if (cy + sy * 0.75 < 0.05 || cy - sy * 0.75 > 0.02) continue;
    const t = Math.min(0.95, Math.abs(cy) / sy);
    const radius = ((rock.scale.x + rock.scale.z) / 2) * 0.86 * Math.sqrt(1 - t * t);
    if (radius < 0.12) continue;
    sections.push({ x: rock.position.x, z: rock.position.z, r: radius, phase: Math.random() * 6.28 });
  }
  if (!sections.length) return { dispose() {} };

  const uniforms = {
    breezeTime: shared.breezeTime,
    foamLight: shared.foamLight,
    swell: shared.swell,
  };
  // Spray: each rock throws a burst of droplets on its bigger surges.
  const perRock = 36;
  const count = sections.length * perRock;
  const spray = new THREE.BufferGeometry();
  const rockAttr = new Float32Array(count * 4);
  const seedAttr = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const s = sections[Math.floor(i / perRock)];
    rockAttr.set([s.x, s.z, s.r, s.phase], i * 4);
    seedAttr.set([Math.random(), Math.random(), Math.random()], i * 3);
  }
  spray.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  spray.setAttribute("rock", new THREE.BufferAttribute(rockAttr, 4));
  spray.setAttribute("seed", new THREE.BufferAttribute(seedAttr, 3));
  const droplets = new THREE.Points(
    spray,
    new THREE.ShaderMaterial({
      uniforms,
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        uniform float breezeTime;
        attribute vec4 rock;
        attribute vec3 seed;
        varying float vAlpha;
        ${SWASH_GLSL}
        void main() {
          // Bursts fire as each broken swell hits (the collar's clock), and
          // only the biggest of them (every few swells) throw spray.
          float cycle = -swashPhase( shoreAlong( rock.xy ), breezeTime ) + 0.4;
          float wave = floor( cycle / 6.283185 );
          float big = step( 0.6, fract( sin( wave * 12.9898 + rock.w * 78.2 ) * 43758.5453 ) );
          float age = fract( cycle / 6.283185 ) * 6.283185 / swell.y;
          float life = 1.1 + seed.z * 0.5;
          float alive = big * step( age, life ) * min( 1.0, rock.z );
          float a = seed.x * 6.283185;
          vec2 out2 = vec2( cos( a ), sin( a ) );
          float speed = 1.2 + seed.y * 1.8;
          vec3 p = vec3( rock.x, 0.0, rock.y ) + vec3( out2.x, 0.0, out2.y ) * ( rock.z * 0.9 + speed * 0.45 * age );
          p.y = ( 1.6 + seed.z * 2.2 ) * age - 4.9 * age * age + rock.z * 0.2;
          vAlpha = alive * smoothstep( life, life * 0.4, age ) * step( 0.0, p.y );
          vec4 mv = modelViewMatrix * vec4( p, 1.0 );
          gl_Position = projectionMatrix * mv;
          gl_PointSize = alive * ( 26.0 + seed.y * 40.0 ) / max( -mv.z, 0.5 );
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 foamLight;
        varying float vAlpha;
        void main() {
          float d = length( gl_PointCoord - 0.5 );
          float a = vAlpha * smoothstep( 0.5, 0.15, d ) * 0.8;
          if ( a < 0.01 ) discard;
          gl_FragColor = vec4( foamLight, a );
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    }),
  );
  droplets.frustumCulled = false;
  droplets.renderOrder = 3;
  group.add(droplets);

  return {
    dispose() {
      for (const m of [droplets]) {
        m.geometry.dispose();
        m.material.dispose();
      }
    },
  };
}
