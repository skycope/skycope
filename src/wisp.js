import * as THREE from "three";

// The wisp, drawn: a bright, slightly prismatic spark with a soft halo, a
// trail of fading light behind it, a few sparks that orbit it, and, after
// dark, a pool of its light on the ground beneath. Where it is and how
// bright comes from the shared record (magic.wisp, which thread.js and
// wisp-mind.js keep); this only draws it. One draw call: every part is a
// quad in one static geometry, placed in the vertex shader from a handful
// of uniforms (no per-frame allocation, no buffer uploads).
//
// It lives in the z-mirrored `land` group, so positions are coast metres.

const TRAIL = 32;
const SPARKS = 8;
// The ground pool's grid (vertices per side) and radius.
const POOL = 7;
const POOL_RADIUS = 2.6;
const SLOT = { halo: 0, core: 1, trail: 2, spark: 2 + TRAIL, pool: 2 + TRAIL + SPARKS };

export function createWisp(group, { light = false } = {}) {
  const corners = [];
  const slots = [];
  const quad = (slot) => {
    for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]]) {
      corners.push(u, v);
      slots.push(slot);
    }
  };
  quad(SLOT.halo);
  quad(SLOT.core);
  for (let i = 0; i < TRAIL; i++) quad(SLOT.trail + i);
  for (let i = 0; i < SPARKS; i++) quad(SLOT.spark + i);
  // The pool: a small grid on the ground, its heights from the CPU.
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
  const uniforms = {
    core: { value: new THREE.Vector4(0, -100, 0, 0) },
    colour: { value: new THREE.Color(1, 0.95, 0.85) },
    trail: { value: trail },
    pool: { value: heights },
    poolOrigin: { value: new THREE.Vector2() },
    time: { value: 0 },
    night: { value: 0 },
    viewHeight: { value: 800 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    // Quads are built in view space, after the land group's mirror: three's
    // winding flip for mirrored objects would cull them.
    side: THREE.DoubleSide,
    // Premultiplied over: light adds (alpha 0), and by day a faint dark rim
    // (alpha > 0) lifts the spark off bright sand. Over the sky this canvas
    // is transparent, so additive light there must leave alpha alone.
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    vertexShader: /* glsl */ `
      #define TRAIL ${TRAIL}
      #define POOL ${POOL}
      attribute vec2 corner;
      attribute float slot;
      uniform vec4 core;
      uniform vec4 trail[TRAIL];
      uniform float pool[POOL * POOL];
      uniform vec2 poolOrigin;
      uniform float time;
      uniform float night;
      uniform float viewHeight;
      varying vec2 vUv;
      varying float vKind;
      varying float vBright;
      varying float vAlong;
      void main() {
        vUv = corner;
        vAlong = 0.0;
        if ( slot > ${SLOT.pool - 0.5} ) {
          // The pool of light on the ground under the wisp.
          vKind = 4.0;
          vec2 g = corner / float( POOL - 1 ) * 2.0 - 1.0;
          int k = int( corner.y ) * POOL + int( corner.x );
          vec3 p = vec3( poolOrigin.x + g.x * ${POOL_RADIUS.toFixed(2)}, pool[k] + 0.05, poolOrigin.y + g.y * ${POOL_RADIUS.toFixed(2)} );
          vUv = g;
          // Light falls off with the wisp's height above the ground.
          float above = max( core.y - pool[( POOL / 2 ) * POOL + POOL / 2], 0.2 );
          vBright = core.w * night / ( 1.0 + above * above * 0.35 );
          gl_Position = projectionMatrix * modelViewMatrix * vec4( p, 1.0 );
          return;
        }
        vec3 centre = core.xyz;
        float size;
        float minPx;
        float lift = 0.0;
        if ( slot < 0.5 ) {
          vKind = 0.0;
          size = mix( 0.42, 1.25, night ) * clamp( core.w, 0.0, 1.8 );
          minPx = 22.0 * clamp( core.w, 0.0, 1.0 );
          vBright = core.w;
          lift = 0.8;
        } else if ( slot < 1.5 ) {
          vKind = 1.0;
          size = 0.085 * ( 0.75 + 0.25 * min( core.w, 1.6 ) );
          minPx = 6.5 * clamp( core.w * 1.5, 0.0, 1.0 );
          vBright = core.w;
          lift = 0.9;
        } else if ( slot < ${SLOT.spark - 0.5} ) {
          vKind = 2.0;
          int i = int( slot ) - ${SLOT.trail};
          vec4 t = trail[i];
          centre = t.xyz;
          float f = 1.0 - float( i ) / float( TRAIL );
          size = 0.05 * f + 0.012;
          minPx = 3.2 * f + 0.8;
          vAlong = float( i ) / float( TRAIL );
          vBright = t.w * f * min( core.w, 1.2 );
        } else {
          vKind = 3.0;
          float j = slot - ${SLOT.spark.toFixed(1)};
          float a = time * ( 1.1 + j * 0.23 ) + j * 0.785;
          float r = ( 0.14 + 0.09 * sin( time * 0.7 + j * 2.1 ) ) * ( 0.8 + 0.4 * max( core.w - 1.0, 0.0 ) );
          centre += vec3( cos( a ) * r, sin( a * 1.3 + j ) * 0.1, sin( a ) * r );
          size = 0.018;
          minPx = 2.2;
          float twinkle = 0.5 + 0.5 * sin( time * 6.3 + j * 2.7 );
          vBright = core.w * twinkle * twinkle;
        }
        vec4 mv = modelViewMatrix * vec4( centre, 1.0 );
        float depth = max( -mv.z, 0.05 );
        float pxPerM = projectionMatrix[1][1] * 0.5 * viewHeight / depth;
        float world = max( size * pxPerM, minPx ) / pxPerM;
        // Far off, a spark kept at its smallest size is dimmer per pixel.
        // Lift halo and core toward the eye so the ground does not cut them.
        mv.z += world * lift;
        mv.xy += corner * world;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 colour;
      uniform float time;
      uniform float night;
      varying vec2 vUv;
      varying float vKind;
      varying float vBright;
      varying float vAlong;
      vec3 prism( float h ) {
        return 0.5 + 0.5 * cos( 6.2831853 * ( h + vec3( 0.0, 0.33, 0.67 ) ) );
      }
      void main() {
        float r = length( vUv );
        if ( r > 1.0 ) discard;
        vec3 c = vec3( 0.0 );
        float a = 0.0;
        float day = 1.0 - night;
        if ( vKind < 0.5 ) {
          // Halo: a soft bloom of the wisp's colour in the air.
          float g = exp( -r * r * 4.5 ) - exp( -4.5 );
          c = colour * g * vBright * mix( 0.22, 0.75, night );
        } else if ( vKind < 1.5 ) {
          // Core: white-hot centre, its colour round it, and a faint
          // rainbow fringe turning slowly, as light through a dewdrop.
          float hot = exp( -r * r * 22.0 );
          float body = exp( -r * r * 6.0 );
          float ring = smoothstep( 0.3, 0.55, r ) * ( 1.0 - smoothstep( 0.55, 0.9, r ) );
          vec3 fringe = prism( r * 1.4 - time * 0.21 + atan( vUv.y, vUv.x ) * 0.159 );
          c = ( vec3( 1.0, 0.98, 0.94 ) * hot * 4.0 + colour * body * 1.8 + fringe * ring * 0.55 ) * vBright;
          // By day a thin shadow round it, so it reads on bright sand.
          a = day * 0.2 * smoothstep( 0.6, 0.78, r ) * ( 1.0 - smoothstep( 0.8, 1.0, r ) ) * min( vBright, 1.0 );
        } else if ( vKind < 2.5 ) {
          // Trail: soft beads, shifting hue along their length.
          float g = exp( -r * r * 3.5 );
          vec3 tint = mix( colour, prism( vAlong * 0.8 - time * 0.12 ), 0.4 );
          c = tint * g * vBright * 1.5;
        } else if ( vKind < 3.5 ) {
          // Sparks: tiny four-pointed stars.
          vec2 q = abs( vUv );
          float star = max( 1.0 - q.x * 5.0, 0.0 ) * max( 1.0 - q.y, 0.0 ) + max( 1.0 - q.y * 5.0, 0.0 ) * max( 1.0 - q.x, 0.0 );
          c = mix( colour, vec3( 1.0 ), 0.5 ) * star * vBright * 2.2;
        } else {
          // The pool: its light on the ground, falling off from the middle.
          float g = exp( -r * r * 3.2 ) * ( 1.0 - smoothstep( 0.8, 1.0, r ) );
          c = colour * g * vBright * 0.32;
        }
        gl_FragColor = vec4( c, a );
        #include <tonemapping_fragment>
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

  let state = null;
  let surface = null;
  let lastSample = -Infinity;
  let lastTime = 0;
  const head = { x: 0, y: -100, z: 0 };

  return {
    mesh,
    // The record to draw (magic.wisp) and the ground height (walker.surface).
    follow(wisp, ground) {
      state = wisp;
      surface = ground;
    },
    // Per frame, before the scene renders.
    update(time, night, viewHeight) {
      const w = state;
      mesh.visible = Boolean(w?.visible) && w.glow > 0.004;
      if (!mesh.visible) return;
      const [x, y, z] = w.position;
      uniforms.core.value.set(x, y, z, w.glow);
      uniforms.colour.value.setRGB(w.colour[0], w.colour[1], w.colour[2]);
      uniforms.time.value = time;
      uniforms.night.value = night;
      uniforms.viewHeight.value = viewHeight;
      // The trail: a new bead whenever the wisp has moved a little (or a
      // moment has passed); older beads fade with age.
      const dt = Math.max(0, time - lastTime);
      lastTime = time;
      const moved = Math.hypot(x - head.x, y - head.y, z - head.z);
      if (moved > 0.06 || time - lastSample > 0.05 || moved > 3) {
        if (moved > 3) for (let i = 0; i < TRAIL; i++) trail.set([x, y, z, 0], i * 4);
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
      const fade = Math.exp(-dt * 1.8);
      for (let i = 1; i < TRAIL; i++) trail[i * 4 + 3] *= fade;
      // The pool's ground, only after dark.
      if (night > 0.05 && surface) {
        uniforms.poolOrigin.value.set(x, z);
        for (let j = 0; j < POOL; j++)
          for (let i = 0; i < POOL; i++) {
            const gx = x + ((i / (POOL - 1)) * 2 - 1) * POOL_RADIUS;
            const gz = z + ((j / (POOL - 1)) * 2 - 1) * POOL_RADIUS;
            heights[j * POOL + i] = Math.max(surface(gx, gz), 0.02);
          }
      } else uniforms.poolOrigin.value.set(x, z);
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      group.remove(mesh);
    },
  };
}
