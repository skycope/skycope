import * as THREE from "three";

// Where the sea meets a boulder: a foam collar clinging to the rock, ripples
// lapping outward, periodic surges when a swell arrives, and spray thrown up
// by the bigger ones. One instanced quad and one point cloud for all rocks
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
          // Each swell surges up the rock, then drains back.
          float surge = pow( 0.5 + 0.5 * sin( t * 0.9 + vRock.w ), 5.0 );
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
        void main() {
          // Bursts fire on the surge peaks (same clock as the collar), and
          // only the biggest of them (every few swells) throw spray.
          float cycle = breezeTime * 0.9 + rock.w + 1.5708;
          float wave = floor( cycle / 6.283185 );
          float big = step( 0.6, fract( sin( wave * 12.9898 + rock.w * 78.2 ) * 43758.5453 ) );
          float age = fract( cycle / 6.283185 ) * 6.283185 / 0.9;
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
