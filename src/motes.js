import * as THREE from "three";
import { seededRandom } from "./random.js";

// Pollen, seed fluff and dust drifting in the air round the cat. Each mote
// is far below a pixel, so what the eye sees is the sunlight it scatters:
// strongly forward (Mie), so motes are invisible with the sun behind you
// and glitter like sparks when you look toward it, most of all against the
// dark of a shaded wood. They drift on the wind, bob on the eddies, and
// wrap round a box that follows the camera, so there are always some near.
// One draw call of points; nothing is drawn after dark.
const COUNT = 600;
const BOX = 14;

export function createMotes(scene, seed) {
  const random = seededRandom(seed ^ 0x51ed27);
  const positions = new Float32Array(COUNT * 3);
  const traits = new Float32Array(COUNT * 2);
  for (let i = 0; i < COUNT; i++) {
    positions[i * 3] = random() * BOX;
    positions[i * 3 + 1] = random() * BOX * 0.35;
    positions[i * 3 + 2] = random() * BOX;
    // Size (fluff is big, dust small) and a phase for its eddy.
    traits[i * 2] = 0.4 + random() ** 3 * 1.6;
    traits[i * 2 + 1] = random() * 100;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("trait", new THREE.BufferAttribute(traits, 2));
  const uniforms = {
    time: { value: 0 },
    drift: { value: new THREE.Vector3() },
    eye: { value: new THREE.Vector3() },
    sunDir: { value: new THREE.Vector3(0, 1, 0) },
    sunLight: { value: new THREE.Color(0, 0, 0) },
    pixelScale: { value: 600 },
    // waking: the wave (waking.js waveAt) lifting embers behind its front:
    // its source (scene space), its radius, tail (m) and presence; their light.
    waveSource: { value: new THREE.Vector3() },
    wave: { value: new THREE.Vector4(0, 1, 0, 0) },
    waveLight: { value: new THREE.Color(0, 0, 0) },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    // Add light, leave alpha alone: over the sky this canvas is transparent
    // (the WebGPU sky shows through), and additive alpha would paint the
    // motes there as dark specks.
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    blendSrcAlpha: THREE.ZeroFactor,
    blendDstAlpha: THREE.OneFactor,
    vertexShader: /* glsl */ `
      uniform float time;
      uniform vec3 drift;
      uniform vec3 eye;
      uniform vec3 sunDir;
      uniform float pixelScale;
      uniform vec3 waveSource;
      uniform vec4 wave;
      attribute vec2 trait;
      varying float vBright;
      varying float vWave;
      void main() {
        // Wind carries the whole cloud; each mote wanders on its own eddy.
        float ph = trait.y;
        vec3 wander = vec3( sin( time * 0.37 + ph ), sin( time * 0.53 + ph * 1.7 ) * 0.6, cos( time * 0.29 + ph * 0.8 ) ) * 0.6;
        vec3 p = position + drift + wander;
        vec3 box = vec3( ${BOX.toFixed(1)}, ${(BOX * 0.35).toFixed(2)}, ${BOX.toFixed(1)} );
        vec3 origin = eye - vec3( box.x * 0.5, 0.6, box.z * 0.5 );
        p = origin + mod( p - origin, box );
        // waking: a third of them, just behind the wave's front, catch its
        // light and lift as embers, fading as the tail passes (only these,
        // only near the eye: at most ~200 of the 600).
        vWave = 0.0;
        if ( wave.z > 0.0 && fract( ph * 0.37 ) < 0.35 ) {
          float k = ( wave.x - length( p.xz - waveSource.xz ) ) / wave.y;
          if ( k > 0.0 && k < 3.0 ) {
            p.y += ( 1.0 - exp( -k * 1.2 ) ) * ( 0.6 + fract( ph * 1.3 ) * 0.8 );
            vWave = sin( 3.14159 * k / 3.0 ) * wave.z;
          }
        }
        vec4 mv = modelViewMatrix * vec4( p, 1.0 );
        gl_Position = projectionMatrix * mv;
        float dist = length( mv.xyz );
        vec3 toMote = normalize( ( modelMatrix * vec4( p, 1.0 ) ).xyz - eye );
        // Forward-scattering phase: a bright cone round the sun, a faint rest.
        float cosine = max( dot( toMote, sunDir ), 0.0 );
        float phase = pow( cosine, 10.0 ) * 6.0 + pow( cosine, 2.0 ) * 0.35 + 0.04;
        // Fade in from the camera (no fat blobs) and out with distance.
        float fade = smoothstep( 0.4, 1.4, dist ) * ( 1.0 - smoothstep( 6.0, ${(BOX * 0.5).toFixed(1)}, dist ) );
        // Sub-pixel motes: keep the point about 1.5 px and put the rest of
        // their size into brightness, so they twinkle instead of swelling.
        float size = trait.x * 0.004 * pixelScale / dist;
        gl_PointSize = max( clamp( size, 1.0, 2.5 ), 2.0 + 1.5 * vWave );
        vBright = phase * fade * trait.x * max( size / gl_PointSize, 0.15 )
          * ( 0.75 + 0.25 * sin( time * 3.1 + ph * 5.0 ) );
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 sunLight;
      uniform vec3 waveLight;
      varying float vBright;
      varying float vWave;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float disc = 1.0 - smoothstep( 0.2, 0.5, length( c ) );
        gl_FragColor = vec4( sunLight * vBright * disc * 0.04 + waveLight * vWave * disc, 0.0 );
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = 5;
  scene.add(points);
  const flow = new THREE.Vector3();
  let last = null;
  return {
    // All in scene (world) space: `eye` the camera, `sunWorld` the sun's
    // direction, `light` its colour times intensity.
    // `wave`: the waking's wave ({ x, y, z } its source in scene space,
    // radius, tail, presence, tint, light), or null.
    update(time, wind, eye, sunWorld, light, pixelScale, wave = null) {
      const dt = last === null ? 0 : Math.min(0.1, Math.max(0, time - last));
      last = time;
      // Wind is in coast axes; the scene mirrors z.
      flow.x += wind[0] * 0.35 * dt;
      flow.z -= wind[1] * 0.35 * dt;
      flow.y = Math.sin(time * 0.05) * 0.4;
      uniforms.time.value = time;
      uniforms.drift.value.copy(flow);
      uniforms.eye.value.copy(eye);
      uniforms.sunDir.value.copy(sunWorld);
      uniforms.sunLight.value.copy(light);
      uniforms.pixelScale.value = pixelScale;
      if (wave && wave.presence > 0) {
        uniforms.waveSource.value.set(wave.x, wave.y, wave.z);
        uniforms.wave.value.set(wave.radius, wave.tail, wave.presence, 0);
        uniforms.waveLight.value.setRGB(wave.tint[0] * wave.light, wave.tint[1] * wave.light, wave.tint[2] * wave.light);
      } else uniforms.wave.value.z = 0;
      points.visible = light.r + light.g + light.b > 0.02 || uniforms.wave.value.z > 0;
    },
  };
}
