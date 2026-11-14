import * as THREE from "three";
import { GIFTS, GIFT_COLOURS } from "./magic.js";
import { WAKE_LIGHT, wakingAt } from "./waking.js";

const smoothstep = THREE.MathUtils.smoothstep;

// The wisp, drawn: a small warm lantern-light. A soft core whose light falls
// off as real glow does (a long 1/(1+r²) tail; after dark, four faint glints
// turning slowly); a short ribbon of light tapering behind it, touched after
// dark with the gifts it has woken; embers that slip off it and drift up as
// they fade; at each waking the kindled point it re-lights in the keepsake
// (waking.js), in the gift's colour. Never large on screen: its quads are clamped in
// pixels and it fades out close to the lens. Its light on the ground after
// dark is the land's own shading (land-magic.js glow 2), which lights the
// real sand, rock and grass.
//
// Where it is and how bright comes from the shared record (magic.wisp, kept
// by thread.js / journey.js); this only draws it. One draw call: a static
// geometry placed in the vertex shader from a handful of uniforms (no
// per-frame allocation or buffer upload). It lives in the z-mirrored `land`
// group, so positions are coast metres.

const TRAIL = 14;
const EMBERS = 6;
// Slots: what each vertex belongs to (the ribbon's are RIBBON + index).
const SLOT = { halo: 0, core: 1, kindle: 2, ember: 3, ribbon: 100 };

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
  quad(SLOT.kindle);
  quad(SLOT.halo);
  // The ribbon: a strip through the trail's points, two vertices per point.
  for (let i = 0; i < TRAIL - 1; i++)
    for (const [k, side] of [[0, -1], [0, 1], [1, 1], [0, -1], [1, 1], [1, -1]]) {
      corners.push(side, 0);
      slots.push(SLOT.ribbon + i + k);
    }
  for (let i = 0; i < EMBERS; i++) quad(SLOT.ember + i);
  quad(SLOT.core);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(slots.length * 3), 3));
  geometry.setAttribute("corner", new THREE.Float32BufferAttribute(corners, 2));
  geometry.setAttribute("slot", new THREE.Float32BufferAttribute(slots, 1));

  const trail = new Float32Array(TRAIL * 4);
  const palette = new Float32Array(6 * 3);
  const uniforms = {
    core: { value: new THREE.Vector4(0, -100, 0, 0) },
    colour: { value: new THREE.Color(1, 0.95, 0.85) },
    trail: { value: trail },
    palette: { value: palette },
    paletteCount: { value: 0 },
    kindle: { value: new THREE.Vector4(0, -100, 0, 0) },
    kindleColour: { value: new THREE.Color(1, 1, 1) },
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
      attribute vec2 corner;
      attribute float slot;
      uniform vec4 core;
      uniform vec4 trail[TRAIL];
      uniform vec4 kindle;
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
      // Close to the lens it fades to nothing rather than fill the frame.
      float lens( float depth ) {
        return smoothstep( 1.5, 2.5, depth );
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
          vBright = a.w * f * min( core.w, 1.4 ) * lens( depth );
          gl_Position = projectionMatrix * vec4( here, 1.0 );
          return;
        }
        vec3 centre = core.xyz;
        float size;
        float minPx;
        float maxPx = 1e4;
        float lift = 0.0;
        if ( slot < ${SLOT.halo + 0.5} ) {
          // By day a small halo; after dark a lantern's wider one (dim).
          vKind = 0.0;
          size = mix( 0.12, 1.1, night ) * clamp( core.w, 0.0, 2.0 );
          minPx = mix( 10.0, 40.0, night ) * clamp( core.w, 0.0, 1.0 );
          maxPx = mix( 84.0, 336.0, night );
          vBright = core.w;
          lift = 0.7;
        } else if ( slot < ${SLOT.core + 0.5} ) {
          vKind = 1.0;
          size = 0.2 * ( 0.8 + 0.2 * min( core.w, 1.8 ) );
          minPx = 20.0 * clamp( core.w * 1.5, 0.0, 1.0 );
          maxPx = 28.0;
          vBright = core.w;
          lift = 0.8;
        } else if ( slot < ${SLOT.kindle + 0.5} ) {
          // waking: the kindled point, a few centimetres of light in the
          // keepsake's recess (its quad is four times that, for the halo).
          vKind = 3.0;
          centre = kindle.xyz;
          size = ( 0.06 + 0.08 * kindle.w ) * 4.0;
          minPx = 12.0;
          vBright = kindle.w;
          lift = 0.8;
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
        float world = clamp( size * px, minPx, maxPx ) / px;
        vBright *= lens( -mv.z );
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
      uniform vec3 kindleColour;
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
      // The colour it is seen in: a warm lamp, after dark touched with its
      // own (the last gift it woke).
      vec3 lampTint() {
        return mix( vec3( 1.0, 0.8, 0.46 ), colour, 0.35 * night );
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
          vec3 tint = mix( lampTint(), gifts( time * 0.05 ), 0.35 * night );
          c = tint * g * vBright * mix( 0.3, 0.6, night );
        } else if ( vKind < 1.5 ) {
          // Core: a warm hot centre in a soft body; after dark, four faint
          // glints turning slowly.
          if ( r2 > 1.0 ) discard;
          vec3 tint = lampTint();
          vec3 hot = mix( tint, vec3( 1.0 ), 0.55 ) * exp( -r2 * 34.0 );
          float body = exp( -r2 * 9.0 );
          float a = atan( vUv.y, vUv.x ) + time * 0.15;
          float r = sqrt( r2 );
          float glint = pow( abs( cos( a * 2.0 ) ), 80.0 ) * exp( -r * 4.0 ) * ( 1.0 - r ) * night;
          c = ( hot * mix( 0.9, 3.4, night ) + tint * body * 1.1 + mix( tint, vec3( 1.0 ), 0.6 ) * glint * 0.9 ) * vBright;
        } else if ( vKind < 2.5 ) {
          // Ribbon: soft across, fading along; faint by day, and after dark
          // its colour running a little through the gifts.
          float across = exp( -vUv.x * vUv.x * 3.0 );
          float fade = pow( 1.0 - vAlong, 1.4 );
          vec3 tint = mix( lampTint(), gifts( vAlong * 0.9 - time * 0.12 ), 0.4 * night * smoothstep( 0.0, 0.25, vAlong ) );
          c = tint * across * fade * vBright * mix( 0.3, 1.0, night );
        } else if ( vKind < 3.5 ) {
          // waking: the kindled point, a white-hot centre in its own colour
          // and a small halo of lit air.
          if ( r2 > 1.0 ) discard;
          float hot = exp( -r2 * 40.0 );
          float halo = ( 1.0 / ( 1.0 + r2 * 22.0 ) - 1.0 / 23.0 ) * ( 1.0 - r2 );
          c = ( mix( kindleColour, vec3( 1.0 ), 0.6 ) * hot * 3.0 + kindleColour * halo * mix( 0.25, 0.6, night ) ) * vBright;
        } else {
          // Embers: tiny soft points.
          if ( r2 > 1.0 ) discard;
          c = mix( mix( lampTint(), gifts( vAlong ), 0.4 * night ), vec3( 1.0 ), 0.45 ) * exp( -r2 * 5.0 ) * vBright * 1.4;
        }
        #ifdef VEILED
          // Seen through leaves: a fifth of the light.
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
  // (its bloom is left out). The same uniforms, shared.
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
    // solid: through leaves, not through rock, walls or the hull: those
    // mark stencil bit 2 where they are the nearest surface (cat-coat.js).
    stencilWrite: true,
    stencilRef: 0,
    stencilFuncMask: 2,
    stencilWriteMask: 0,
    stencilFunc: THREE.EqualStencilFunc,
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
      // waking: the kindled point at the keepsake (waking.js), for its
      // first eight seconds; then the gift's own steady light has it.
      const waking = magic?.waking;
      const spec = waking ? WAKE_LIGHT[waking.gift] : null;
      let kindled = 0;
      if (spec && waking.age < 8) {
        const peak = spec.day + (spec.night - spec.day) * night;
        kindled = peak > 0 ? (wakingAt(waking.age, spec, night).inside / peak) * (1 - smoothstep(waking.age, 6, 8)) : 0;
      }
      const kindling = kindled > 0.004;
      mesh.visible = (Boolean(w?.visible) && w.glow > 0.004) || kindling;
      through.visible = mesh.visible && (w.visible || kindling);
      if (!mesh.visible) return;
      const [x, y, z] = w.position;
      uniforms.core.value.set(x, y, z, w.visible ? w.glow : 0);
      uniforms.colour.value.setRGB(w.colour[0], w.colour[1], w.colour[2]);
      uniforms.time.value = time;
      uniforms.night.value = night;
      uniforms.viewHeight.value = viewHeight;
      if (kindling) {
        uniforms.kindle.value.set(waking.x, waking.y, waking.z, kindled);
        uniforms.kindleColour.value.setRGB(spec.tint[0], spec.tint[1], spec.tint[2]);
      } else uniforms.kindle.value.w = 0;
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
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      veiled.dispose();
      group.remove(mesh, through);
    },
  };
}
