import * as THREE from "three";

// The camera's lens, over everything: one full-screen triangle drawn last
// in the land layer, blended premultiplied (rgb added, alpha darkening), so
// it acts on the land and, through the transparent canvas, on the sky and
// sea beneath. Vignette, rain streaking across the lens, veiling glare
// around the sun and a fine animated grain. A handful of ALU per pixel.
export function createLens() {
  const scene = new THREE.Scene();
  scene.matrixWorldAutoUpdate = false;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const uniforms = {
    resolution: { value: new THREE.Vector2(1, 1) },
    time: { value: 0 },
    rain: { value: 0 },
    slant: { value: 0 },
    rainColour: { value: new THREE.Color(0.6, 0.65, 0.7) },
    sun: { value: new THREE.Vector3(0.5, 0.5, 0) },
    glareColour: { value: new THREE.Color(1, 0.95, 0.85) },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = position.xy * 0.5 + 0.5;
        gl_Position = vec4( position.xy, 0.0, 1.0 );
      }`,
    fragmentShader: /* glsl */ `
      uniform vec2 resolution;
      uniform float time;
      uniform float rain;
      uniform float slant;
      uniform vec3 rainColour;
      uniform vec3 sun;
      uniform vec3 glareColour;
      varying vec2 vUv;
      vec2 hash2( vec2 p ) {
        vec3 q = fract( vec3( p.x, p.y, p.x ) * vec3( 0.1031, 0.1030, 0.0973 ) );
        q += dot( q, q.yzx + 33.33 );
        return fract( ( q.xx + q.yz ) * q.zy );
      }
      void main() {
        vec2 pixel = vUv * resolution;
        vec3 add = vec3( 0.0 );
        // Natural vignette: cos^4-ish falloff, kept gentle.
        vec2 screen = vUv - 0.5;
        float dark = dot( screen, screen ) * 0.2;
        // Rain: streaks of falling drops close to the lens, two depths.
        if ( rain > 0.01 ) {
          float total = 0.0;
          for ( int layer = 0; layer < 2; layer++ ) {
            vec2 scale = layer == 1 ? vec2( 5.0, 44.0 ) : vec2( 3.0, 26.0 );
            vec2 p = vec2( pixel.x, resolution.y - pixel.y ) / scale;
            float x = p.x + p.y * slant;
            float column = floor( x );
            vec2 lane = hash2( vec2( column, float( layer ) * 7.0 ) );
            float y = p.y + time * ( 2.2 + lane.y * 1.6 ) * ( 1.0 + float( layer ) * 0.6 ) + lane.x * 40.0;
            float cell = floor( y );
            vec2 random = hash2( vec2( column, cell ) );
            vec2 local = vec2( fract( x ), fract( y ) );
            total += step( random.x, min( 0.5, rain * 0.1 ) )
              * ( 1.0 - smoothstep( 0.08, 0.2, abs( local.x - 0.5 - ( random.y - 0.5 ) * 0.6 ) ) )
              * smoothstep( 0.0, 0.4, local.y ) * ( 1.0 - smoothstep( 0.5, 1.0, local.y ) ) * ( 0.6 + float( layer ) * 0.4 );
          }
          add += rainColour * total * 0.22;
        }
        // Veiling glare: light scattered inside the lens lifts the blacks
        // around a bright sun, on land and sky alike.
        if ( sun.z > 0.001 ) {
          vec2 d = ( vUv - sun.xy ) * vec2( resolution.x / resolution.y, 1.0 );
          float r = length( d );
          add += glareColour * sun.z * ( exp( -r * 9.0 ) * 0.05 + exp( -r * 2.2 ) * 0.025 );
        }
        // Film grain, a level or two, fresh each frame.
        float grain = hash2( pixel + fract( time * 7.13 ) * 131.0 ).x - 0.5;
        add += max( grain, 0.0 ) * 0.016;
        dark += max( -grain, 0.0 ) * 0.016;
        gl_FragColor = vec4( add, dark );
      }`,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    fog: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1e9;
  scene.add(mesh);
  const projected = new THREE.Vector3();
  const toDisplay = (v) => Math.pow(Math.min(1, Math.max(0, v * 1.35)), 1 / 2.2);
  return {
    scene,
    update({ camera, time, rain, wind, sky, sunDirection, sunColour, sunVisible, width, height }) {
      uniforms.resolution.value.set(width, height);
      uniforms.time.value = time;
      uniforms.rain.value = rain;
      uniforms.slant.value = (wind?.[0] ?? 0) * 0.012;
      uniforms.rainColour.value.setRGB(toDisplay(sky[0] * 0.8 + 0.01), toDisplay(sky[1] * 0.8 + 0.01), toDisplay(sky[2] * 0.8 + 0.01));
      projected.copy(sunDirection).multiplyScalar(1000).add(camera.position).project(camera);
      const inFront = projected.z < 1 && projected.z > -1;
      // Glare fades as the sun leaves the frame.
      const off = Math.max(Math.abs(projected.x), Math.abs(projected.y));
      const strength = inFront ? sunVisible * (1 - THREE.MathUtils.smoothstep(off, 1.0, 1.6)) : 0;
      uniforms.sun.value.set(projected.x * 0.5 + 0.5, projected.y * 0.5 + 0.5, strength);
      const peak = Math.max(sunColour.r, sunColour.g, sunColour.b, 1e-6);
      uniforms.glareColour.value.setRGB(sunColour.r / peak, sunColour.g / peak, sunColour.b / peak);
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
