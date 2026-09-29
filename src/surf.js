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
float swashCells( vec2 q ) {
  vec2 cell = floor( q );
  vec2 local = fract( q );
  float f1 = 8.0;
  float f2 = 8.0;
  for ( int j = -1; j <= 1; j++ ) for ( int i = -1; i <= 1; i++ ) {
    vec2 o = vec2( float( i ), float( j ) );
    vec2 d = o + swashHash( cell + o ) * 0.8 + 0.1 - local;
    float r = dot( d, d );
    if ( r < f1 ) { f2 = f1; f1 = r; } else if ( r < f2 ) { f2 = r; }
  }
  return sqrt( f2 ) - sqrt( f1 );
}
// Foam texture in [0, 1], as foam_lace in ocean.wgsl: warped clumps crossed
// by bubble-wall filaments that break up where the foam is thin.
float swashLace( vec2 q, float pixel ) {
  vec2 w = q + ( vec2( swashValue( q * 0.27 + 3.1 ), swashValue( q * 0.27 + 17.7 ) ) - 0.5 ) * 2.2;
  float clumps = smoothstep( 0.28, 0.72, swashValue( w * 0.6 ) * 0.6 + swashValue( w * 1.7 + 5.0 ) * 0.4 );
  float mask = swashValue( w * 1.1 + 9.0 );
  vec2 v = w + ( vec2( swashValue( w * 2.6 + 1.3 ), swashValue( w * 2.6 + 8.9 ) ) - 0.5 ) * 0.45;
  float big = mix( 1.0 - smoothstep( 0.0, 0.08 + 0.22 * clumps, swashCells( v * 2.2 ) ), 0.3, smoothstep( 0.25, 0.8, pixel * 2.2 ) );
  float small = mix( 1.0 - smoothstep( 0.0, 0.2, swashCells( v * 6.3 + 7.3 ) ), 0.3, smoothstep( 0.25, 0.8, pixel * 6.3 ) );
  float filaments = max( big * smoothstep( 0.3, 0.6, mask ), small * smoothstep( 0.45, 0.75, clumps ) );
  return clamp( clumps * 0.6 + filaments * 0.4 - 0.04, 0.0, 1.0 );
}
// Little bubbles, a few millimetres to a couple of centimetres: bright rims
// round clear centres with a pinpoint highlight, each living a few seconds
// before it pops and another rises. Two sizes; they average away once
// smaller than a pixel. Returns (coverage, highlight).
vec2 swashBubbles( vec2 p, float time, float pixel ) {
  vec2 result = vec2( 0.0 );
  float scale = 34.0;
  for ( int layer = 0; layer < 2; layer++ ) {
    vec2 q = p * scale + float( layer ) * 17.0;
    vec2 cell = floor( q );
    vec2 h = swashHash( cell + float( layer ) * 31.0 );
    float life = fract( h.y * 7.0 + time * ( 0.18 + 0.3 * h.x ) );
    float alive = step( 0.35, h.x ) * step( life, 0.7 );
    float r = ( 0.16 + 0.24 * h.y ) * ( 1.0 - 0.3 * life );
    vec2 d = fract( q ) - 0.5 - ( h - 0.5 ) * ( 0.8 - 2.0 * r );
    float dist = length( d );
    float rim = smoothstep( r - 0.1, r - 0.02, dist ) * ( 1.0 - smoothstep( r, r + 0.05, dist ) );
    float glint = 1.0 - smoothstep( 0.0, 0.06, length( d + r * vec2( 0.35, -0.35 ) ) );
    float resolved = 1.0 - smoothstep( 0.35, 0.8, pixel * scale );
    result += vec2( rim * 0.85, glint ) * alive * resolved;
    scale *= 2.3;
  }
  return min( result, vec2( 1.0 ) );
}
`;

// Where the sea meets a boulder: a foam collar clinging to the rock, ripples
// lapping outward, a surge each time a broken swell arrives (the swash clock,
// so rocks and beach flood together), and spray thrown up by the bigger ones. One instanced quad and one point cloud for all rocks
// that straddle the waterline. Coordinates follow the land group (coast metres,
// z mirrored by the parent), and everything is lit by the shared foamLight.
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
  const reach = 2.2;
  const quad = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
  const data = new Float32Array(sections.length * 4);
  sections.forEach((s, i) => data.set([s.x, s.z, s.r, s.phase], i * 4));
  const geometry = new THREE.InstancedBufferGeometry().copy(quad);
  geometry.instanceCount = sections.length;
  geometry.setAttribute("rock", new THREE.InstancedBufferAttribute(data, 4));
  const collar = new THREE.Mesh(
    geometry,
    new THREE.ShaderMaterial({
      uniforms,
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        attribute vec4 rock;
        varying vec2 vLocal;
        varying vec4 vRock;
        void main() {
          float size = rock.z + ${reach.toFixed(1)};
          vec3 p = vec3( rock.x + position.x * size, 0.015, rock.y + position.z * size );
          vLocal = position.xz * size;
          vRock = rock;
          gl_Position = projectionMatrix * modelViewMatrix * vec4( p, 1.0 );
        }`,
      fragmentShader: /* glsl */ `
        uniform float breezeTime;
        uniform vec3 foamLight;
        varying vec2 vLocal;
        varying vec4 vRock;
        ${SWASH_GLSL}
        float hash( vec2 p ) {
          vec3 q = fract( vec3( p.xyx ) * 0.1031 );
          q += dot( q, q.yzx + 33.33 );
          return fract( ( q.x + q.y ) * q.z );
        }
        float noise( vec2 p ) {
          vec2 i = floor( p );
          vec2 f = fract( p );
          vec2 u = f * f * ( 3.0 - 2.0 * f );
          return mix( mix( hash( i ), hash( i + vec2( 1, 0 ) ), u.x ),
            mix( hash( i + vec2( 0, 1 ) ), hash( i + vec2( 1, 1 ) ), u.x ), u.y );
        }
        void main() {
          float t = breezeTime;
          float angle = atan( vLocal.y, vLocal.x );
          // The rock's waterline is not a circle: wobble the contact radius.
          float contact = vRock.z * ( 1.0 + 0.14 * ( noise( vec2( angle * 2.5, vRock.w ) ) - 0.5 ) );
          float edge = length( vLocal ) - contact;
          if ( edge > ${reach.toFixed(1)} ) discard;
          // Each broken swell surges up the rock as it runs up the beach, then
          // drains back.
          float s = fract( -swashPhase( shoreAlong( vRock.xy ), t ) / 6.283185 ) / 0.82;
          float surge = s < 1.0 ? pow( sin( 3.141593 * pow( s, 0.65 ) ), 2.0 ) : 0.0;
          vec2 world = vRock.xy + vLocal;
          float lace = noise( world * 7.0 + t * 0.3 ) * 0.6 + noise( world * 17.0 - t * 0.5 ) * 0.4;
          // Clinging foam right at the contact line, thicker on the surge.
          float cling = exp( -max( edge, 0.0 ) / ( 0.1 + surge * 0.35 ) ) * smoothstep( -0.15, 0.0, edge );
          // Lapping ripples running outward, their crests capped with foam.
          float ripple = sin( edge * 11.0 - t * 3.2 + vRock.w );
          float lap = smoothstep( 0.55, 1.0, ripple ) * exp( -edge / 0.7 ) * 0.55;
          // Drained foam lingering in the lee, stretched round the rock.
          float trail = smoothstep( 0.55, 0.8, noise( vec2( angle * 4.0, edge * 2.0 - t * 0.2 ) + vRock.w ) ) * exp( -edge / 1.2 ) * 0.5;
          float foam = max( cling * ( 0.55 + 0.45 * surge ), max( lap, trail ) ) * smoothstep( 0.3, 0.7, lace + cling * 0.35 );
          foam *= 1.0 - smoothstep( ${(reach - 0.5).toFixed(1)}, ${reach.toFixed(1)}, edge );
          if ( foam < 0.01 ) discard;
          gl_FragColor = vec4( foamLight * 0.85, foam * 0.9 );
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    }),
  );
  collar.frustumCulled = false;
  collar.renderOrder = 2;
  group.add(collar);

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
      for (const m of [collar, droplets]) {
        m.geometry.dispose();
        m.material.dispose();
      }
    },
  };
}
