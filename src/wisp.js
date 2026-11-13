import * as THREE from "three";
import { GIFTS, GIFT_COLOURS } from "./magic.js";

// The wisp, drawn. A soft luminous core whose light falls off as real glow
// does (a long 1/(1+r²) tail, the colours parting very slightly at its rim as
// light through a dewdrop, four faint glints turning slowly); a silky
// ribbon of light tapering behind it, its colour running through the gifts
// it has woken; embers that slip off it and drift up as they fade; at each
// waking a sphere of light blooming out from the keepsake in the gift's
// colour; and after dark a pool of its light on the ground below.
//
// Where it is and how bright comes from the shared record (magic.wisp, kept
// by thread.js / journey.js); this only draws it. One draw call: a static
// geometry placed in the vertex shader from a handful of uniforms (no
// per-frame allocation or buffer upload). It lives in the z-mirrored `land`
// group, so positions are coast metres.

const TRAIL = 40;
const EMBERS = 6;
const POOL = 7;
const POOL_RADIUS = 2.6;
// Slots: what each vertex belongs to (the ribbon's are RIBBON + index).
const SLOT = { halo: 0, core: 1, burst: 2, ember: 3, pool: 40, ribbon: 100 };
const BURST_SECONDS = 2.2;

export function createWisp(group, { light = false } = {}) {
  const corners = [];
  const slots = [];
  const quad = (slot) => {
    for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]]) {
      corners.push(u, v);
      slots.push(slot);
    }
  };
  // Drawn back to front-ish (all additive, so order barely matters).
  quad(SLOT.burst);
  quad(SLOT.halo);
  // The ribbon: a strip through the trail's points, two vertices per point.
  for (let i = 0; i < TRAIL - 1; i++)
    for (const [k, side] of [[0, -1], [0, 1], [1, 1], [0, -1], [1, 1], [1, -1]]) {
      corners.push(side, 0);
      slots.push(SLOT.ribbon + i + k);
    }
  for (let i = 0; i < EMBERS; i++) quad(SLOT.ember + i);
  quad(SLOT.core);
  for (let j = 0; j < POOL - 1; j++)
    for (let i = 0; i < POOL - 1; i++)
      for (const [di, dj] of [[0, 0], [1, 0], [1, 1], [0, 0], [1, 1], [0, 1]]) {
        corners.push(i + di, j + dj);
        slots.push(SLOT.pool);
      }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(slots.length * 3), 3));
  geometry.setAttribute("corner", new THREE.Float32BufferAttribute(corners, 2));
  geometry.setAttribute("slot", new THREE.Float32BufferAttribute(slots, 1));

  const trail = new Float32Array(TRAIL * 4);
  const heights = new Float32Array(POOL * POOL);
  const palette = new Float32Array(6 * 3);
  const uniforms = {
    core: { value: new THREE.Vector4(0, -100, 0, 0) },
    colour: { value: new THREE.Color(1, 0.95, 0.85) },
    trail: { value: trail },
    palette: { value: palette },
    paletteCount: { value: 0 },
    pool: { value: heights },
    poolOrigin: { value: new THREE.Vector2() },
    burst: { value: new THREE.Vector4(0, -100, 0, 99) },
    burstColour: { value: new THREE.Color(1, 1, 1) },
    time: { value: 0 },
    night: { value: 0 },
    viewHeight: { value: 800 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    // Built in view space, after the land group's mirror: three's winding
    // flip for mirrored objects would cull it.
    side: THREE.DoubleSide,
    // Light adds; alpha is left alone so over the sky (where this canvas is
    // transparent) it still adds to the WebGPU sky beneath.
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    blendSrcAlpha: THREE.ZeroFactor,
    blendDstAlpha: THREE.OneFactor,
    toneMapped: false,
    vertexShader: /* glsl */ `
      #define TRAIL ${TRAIL}
      #define POOL ${POOL}
      attribute vec2 corner;
      attribute float slot;
      uniform vec4 core;
      uniform vec4 trail[TRAIL];
      uniform float pool[POOL * POOL];
      uniform vec2 poolOrigin;
      uniform vec4 burst;
      uniform float time;
      uniform float night;
      uniform float viewHeight;
      varying vec2 vUv;
      varying float vKind;
      varying float vBright;
      varying float vAlong;
      float pxPerMetre( float depth ) {
        return projectionMatrix[1][1] * 0.5 * viewHeight / max( depth, 0.05 );
      }
      void main() {
        vUv = corner;
        vAlong = 0.0;
        if ( slot > ${SLOT.ribbon - 0.5} ) {
          // The ribbon: a strip facing the eye, tapering from the core.
          vKind = 2.0;
          int i = int( slot ) - ${SLOT.ribbon};
          vec4 a = trail[i];
          vec3 here = ( modelViewMatrix * vec4( a.xyz, 1.0 ) ).xyz;
          vec3 prev = ( modelViewMatrix * vec4( trail[max( i - 1, 0 )].xyz, 1.0 ) ).xyz;
          vec3 next = ( modelViewMatrix * vec4( trail[min( i + 1, TRAIL - 1 )].xyz, 1.0 ) ).xyz;
          vec2 t = next.xy / max( -next.z, 0.05 ) - prev.xy / max( -prev.z, 0.05 );
          vec2 n = length( t ) > 1e-6 ? normalize( vec2( -t.y, t.x ) ) : vec2( 0.0, 1.0 );
          float f = 1.0 - float( i ) / float( TRAIL - 1 );
          float depth = max( -here.z, 0.05 );
          float px = pxPerMetre( depth );
          float width = max( 0.034 * pow( f, 1.6 ) * ( 0.6 + 0.4 * min( core.w, 1.5 ) ), ( 0.4 + 2.2 * f * f ) / px );
          here.xy += n * corner.x * width;
          vAlong = 1.0 - f;
          vBright = a.w * f * min( core.w, 1.4 );
          gl_Position = projectionMatrix * vec4( here, 1.0 );
          return;
        }
        if ( slot > ${SLOT.pool - 0.5} ) {
          // The pool of light on the ground under the wisp.
          vKind = 4.0;
          vec2 g = corner / float( POOL - 1 ) * 2.0 - 1.0;
          int k = int( corner.y ) * POOL + int( corner.x );
          vec3 p = vec3( poolOrigin.x + g.x * ${POOL_RADIUS.toFixed(2)}, pool[k] + 0.05, poolOrigin.y + g.y * ${POOL_RADIUS.toFixed(2)} );
          vUv = g;
          float above = max( core.y - pool[( POOL / 2 ) * POOL + POOL / 2], 0.2 );
          vBright = core.w * night / ( 1.0 + above * above * 0.35 );
          gl_Position = projectionMatrix * modelViewMatrix * vec4( p, 1.0 );
          return;
        }
        vec3 centre = core.xyz;
        float size;
        float minPx;
        float lift = 0.0;
        if ( slot < ${SLOT.halo + 0.5} ) {
          vKind = 0.0;
          size = mix( 0.5, 1.1, night ) * clamp( core.w, 0.0, 2.0 );
          minPx = 40.0 * clamp( core.w, 0.0, 1.0 );
          vBright = core.w;
          lift = 0.7;
        } else if ( slot < ${SLOT.core + 0.5} ) {
          vKind = 1.0;
          size = 0.2 * ( 0.8 + 0.2 * min( core.w, 1.8 ) );
          minPx = 20.0 * clamp( core.w * 1.5, 0.0, 1.0 );
          vBright = core.w;
          lift = 0.8;
        } else if ( slot < ${SLOT.burst + 0.5} ) {
          // A waking's bloom: a sphere of light swelling out and fading.
          vKind = 3.0;
          centre = burst.xyz;
          float age = burst.w / ${BURST_SECONDS.toFixed(2)};
          size = 0.6 + 5.5 * ( 1.0 - pow( 1.0 - clamp( age, 0.0, 1.0 ), 3.0 ) );
          minPx = 0.0;
          vBright = age < 1.0 ? pow( 1.0 - age, 1.5 ) : 0.0;
          vAlong = age;
          lift = 0.0;
        } else {
          // Embers: slip off the trail and drift up, turning, as they fade.
          vKind = 5.0;
          float j = slot - ${SLOT.ember.toFixed(1)};
          float life = 1.6 + 0.6 * fract( j * 0.618 );
          float age = fract( time / life + j * 0.381 );
          int k = int( age * float( TRAIL ) * 0.45 );
          vec4 from = trail[min( k, TRAIL - 1 )];
          float seed = j * 2.399;
          centre = from.xyz + vec3( cos( seed + time * 0.6 ) * 0.18, 0.12 + age * 0.45, sin( seed + time * 0.6 ) * 0.18 ) * age;
          size = 0.016 * ( 1.0 - age * 0.5 );
          minPx = 2.6;
          vBright = core.w * sin( age * 3.14159 ) * max( from.w, 0.45 );
          vAlong = fract( j * 0.27 + time * 0.05 );
        }
        vec4 mv = modelViewMatrix * vec4( centre, 1.0 );
        float px = pxPerMetre( -mv.z );
        float world = max( size * px, minPx ) / px;
        // Lift halo and core toward the eye so the ground does not cut them.
        mv.z += world * lift;
        mv.xy += corner * world;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 colour;
      uniform vec3 palette[6];
      uniform float paletteCount;
      uniform vec3 burstColour;
      uniform float time;
      uniform float night;
      varying vec2 vUv;
      varying float vKind;
      varying float vBright;
      varying float vAlong;
      // Soft spectral shimmer (a dewdrop's colours), and the woken gifts'
      // colours one into the next.
      // The land's tone curve (landscape.js) without its night shift toward
      // blue: a light looked at directly is seen in colour, by the cones.
      vec3 wispTone( vec3 color ) {
        color = max( color * 1.35, vec3( 0.0 ) );
        float low = min( color.r, min( color.g, color.b ) );
        color -= low < 0.08 ? low - 6.25 * low * low : 0.04;
        float peak = max( color.r, max( color.g, color.b ) );
        if ( peak >= 0.76 ) {
          float newPeak = 1.0 - 0.0576 / ( peak - 0.52 );
          color *= newPeak / peak;
          color = mix( color, vec3( newPeak ), 1.0 - 1.0 / ( 0.15 * ( peak - newPeak ) + 1.0 ) );
        }
        return color;
      }
      vec3 prism( float h ) {
        return 0.55 + 0.45 * cos( 6.2831853 * ( h + vec3( 0.0, 0.33, 0.67 ) ) );
      }
      vec3 gifts( float t ) {
        if ( paletteCount < 0.5 ) return colour;
        float x = fract( t ) * paletteCount;
        int a = int( x );
        int b = int( mod( float( a + 1 ), paletteCount ) );
        return mix( palette[a], palette[b], smoothstep( 0.0, 1.0, fract( x ) ) );
      }
      void main() {
        float r2 = dot( vUv, vUv );
        vec3 c = vec3( 0.0 );
        if ( vKind < 0.5 ) {
          // Halo: glow with a long soft tail, as light in hazy air.
          if ( r2 > 1.0 ) discard;
          float g = ( 1.0 / ( 1.0 + r2 * 22.0 ) - 1.0 / 23.0 ) * ( 1.0 - r2 );
          vec3 tint = mix( colour, gifts( time * 0.05 ), 0.35 );
          c = tint * g * vBright * mix( 0.3, 0.6, night );
        } else if ( vKind < 1.5 ) {
          // Core: white-hot, the colours parting faintly at its edge, and
          // four faint glints turning slowly.
          if ( r2 > 1.0 ) discard;
          vec3 hot = vec3( exp( -r2 * 34.0 ), exp( -r2 * 40.0 ), exp( -r2 * 31.0 ) );
          float body = exp( -r2 * 9.0 );
          float a = atan( vUv.y, vUv.x ) + time * 0.15;
          float r = sqrt( r2 );
          float glint = pow( abs( cos( a * 2.0 ) ), 80.0 ) * exp( -r * 4.0 ) * ( 1.0 - r );
          vec3 rim = prism( r * 1.3 - time * 0.07 ) * exp( -r2 * 14.0 ) * smoothstep( 0.05, 0.3, r );
          c = ( hot * 3.4 + colour * body * 1.1 + rim * 0.35 + mix( colour, vec3( 1.0 ), 0.6 ) * glint * 0.9 ) * vBright;
        } else if ( vKind < 2.5 ) {
          // Ribbon: soft across, fading along, its colour running through the gifts.
          float across = exp( -vUv.x * vUv.x * 3.0 );
          float fade = pow( 1.0 - vAlong, 1.4 );
          vec3 tint = mix( gifts( vAlong * 0.9 - time * 0.12 ), prism( vAlong * 0.7 - time * 0.1 ), 0.22 );
          tint = mix( vec3( 1.0, 0.97, 0.92 ), tint, smoothstep( 0.0, 0.25, vAlong ) );
          c = tint * across * fade * vBright * 1.0;
        } else if ( vKind < 3.5 ) {
          // The waking's bloom: a bright rim with colour at its edge, filled
          // softly, swelling out and fading.
          if ( r2 > 1.0 ) discard;
          float r = sqrt( r2 );
          float rim = exp( -pow( ( r - 0.84 ) / 0.11, 2.0 ) );
          float fill = exp( -r2 * 2.2 ) * 0.3;
          // Its rim carries every gift woken so far, round its circle.
          vec3 edge = mix( mix( burstColour, gifts( atan( vUv.y, vUv.x ) * 0.159 + vAlong * 0.25 ), 0.55 ), prism( r * 2.0 - vAlong ), 0.18 );
          // By day a faint ring of light, by night a brighter one.
          c = ( edge * rim * 0.8 + burstColour * fill * mix( 0.35, 1.0, night ) ) * vBright * mix( 0.45, 1.0, night );
        } else if ( vKind < 4.5 ) {
          // The pool: its light on the ground, falling off from the middle.
          float r = sqrt( r2 );
          float g = exp( -r2 * 3.2 ) * ( 1.0 - smoothstep( 0.8, 1.0, r ) );
          c = colour * g * vBright * 0.9;
        } else {
          // Embers: tiny soft points.
          if ( r2 > 1.0 ) discard;
          c = mix( gifts( vAlong ), vec3( 1.0 ), 0.45 ) * exp( -r2 * 5.0 ) * vBright * 1.4;
        }
        #ifdef VEILED
          // Seen through leaves: a fifth of the light, none of the bloom or pool.
          if ( vKind > 2.5 && vKind < 4.5 ) discard;
          c *= 0.2;
        #endif
        // The night scene is dim (its light is a few hundredths of the day's):
        // the wisp is a lantern in it, not a floodlight.
        c *= mix( 1.0, 0.09, night );
        gl_FragColor = vec4( c, 0.0 );
        gl_FragColor.rgb = wispTone( gl_FragColor.rgb );
        #include <colorspace_fragment>
      }
    `,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 6;
  mesh.visible = false;
  mesh.matrixAutoUpdate = false;
  group.add(mesh);
  // A second, faint pass without the depth test: a bright light behind
  // leaves still glows through them, so the wisp can be found in a thicket
  // (its bloom and pool are left out). The same uniforms, shared.
  const veiled = new THREE.ShaderMaterial({
    uniforms: { ...uniforms },
    vertexShader: material.vertexShader,
    fragmentShader: material.fragmentShader,
    defines: { VEILED: 1 },
    transparent: true,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    blendSrcAlpha: THREE.ZeroFactor,
    blendDstAlpha: THREE.OneFactor,
    toneMapped: false,
  });
  const through = new THREE.Mesh(geometry, veiled);
  through.frustumCulled = false;
  through.renderOrder = 7;
  through.visible = false;
  through.matrixAutoUpdate = false;
  group.add(through);

  let state = null;
  let surface = null;
  let magic = null;
  let lastSample = -Infinity;
  let lastTime = 0;
  let paletteKey = "";
  const head = { x: 0, y: -100, z: 0 };

  return {
    mesh,
    // The record to draw (magic.wisp), the ground height (walker.surface)
    // and the whole record (for the woken gifts' colours and the pulse).
    follow(wisp, ground, record = null) {
      state = wisp;
      surface = ground;
      magic = record;
    },
    // Per frame, before the scene renders.
    update(time, night, viewHeight) {
      const w = state;
      const pulse = magic?.pulse;
      const burstAge = pulse ? magic.clock - pulse.at : Infinity;
      const bursting = burstAge >= 0 && burstAge < BURST_SECONDS;
      mesh.visible = (Boolean(w?.visible) && w.glow > 0.004) || bursting;
      through.visible = mesh.visible && w.visible;
      if (!mesh.visible) return;
      const [x, y, z] = w.position;
      uniforms.core.value.set(x, y, z, w.visible ? w.glow : 0);
      uniforms.colour.value.setRGB(w.colour[0], w.colour[1], w.colour[2]);
      uniforms.time.value = time;
      uniforms.night.value = night;
      uniforms.viewHeight.value = viewHeight;
      if (bursting) {
        uniforms.burst.value.set(pulse.x, pulse.y, pulse.z, burstAge);
        const c = pulse.colour ?? GIFT_COLOURS[pulse.gift] ?? [1, 1, 1];
        uniforms.burstColour.value.setRGB(c[0], c[1], c[2]);
      } else uniforms.burst.value.w = 99;
      // The woken gifts' colours, for the ribbon and embers.
      if (magic) {
        let key = "";
        for (const g of GIFTS) key += magic.isAwake(g) ? "1" : "0";
        if (key !== paletteKey) {
          paletteKey = key;
          let n = 0;
          for (const g of GIFTS) if (magic.isAwake(g)) palette.set(GIFT_COLOURS[g], 3 * n++);
          uniforms.paletteCount.value = n;
        }
      }
      // The trail: a new point whenever the wisp has moved a little (or a
      // moment has passed); older points fade with age.
      const dt = Math.max(0, time - lastTime);
      lastTime = time;
      const moved = Math.hypot(x - head.x, y - head.y, z - head.z);
      if (moved > 4) {
        for (let i = 0; i < TRAIL; i++) {
          trail[i * 4] = x;
          trail[i * 4 + 1] = y;
          trail[i * 4 + 2] = z;
          trail[i * 4 + 3] = 0;
        }
      }
      if (moved > 0.05 || time - lastSample > 0.04) {
        trail.copyWithin(4, 0, (TRAIL - 1) * 4);
        lastSample = time;
        head.x = x;
        head.y = y;
        head.z = z;
      }
      trail[0] = x;
      trail[1] = y;
      trail[2] = z;
      trail[3] = 1;
      const fade = Math.exp(-dt * 2.6);
      for (let i = 1; i < TRAIL; i++) trail[i * 4 + 3] *= fade;
      uniforms.poolOrigin.value.set(x, z);
      // The pool's ground, only after dark.
      if (night > 0.05 && surface)
        for (let j = 0; j < POOL; j++)
          for (let i = 0; i < POOL; i++)
            heights[j * POOL + i] = Math.max(surface(x + ((i / (POOL - 1)) * 2 - 1) * POOL_RADIUS, z + ((j / (POOL - 1)) * 2 - 1) * POOL_RADIUS), 0.02);
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      veiled.dispose();
      group.remove(mesh, through);
    },
  };
}
