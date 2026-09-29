import * as THREE from "three";

// Where the cat meets the ground: its shadow, its paw prints and the sand it
// kicks up. All three multiply into (or sit on) the ground in coast metres,
// inside the z-mirrored land group.
//
// They are built on Lambert materials only to borrow three's light uniforms
// and shadow map: so a print or the cat's shadow in the shade of a tree
// knows it is in shade, and relief is lit from wherever the sun really is.

const SUN_SHADOW = /* glsl */ `
  float sunVis = 1.0;
  #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
    DirectionalLightShadow sunShadow = directionalLightShadows[ 0 ];
    sunVis = getShadow( directionalShadowMap[ 0 ], sunShadow.shadowMapSize, sunShadow.shadowIntensity, sunShadow.shadowBias, sunShadow.shadowRadius, vDirectionalShadowCoord[ 0 ] );
  #endif
  vec3 sunColour = vec3( 0.0 );
  vec3 sunDir = vec3( 0.0, 1.0, 0.0 );
  #if NUM_DIR_LIGHTS > 0
    sunColour = directionalLights[ 0 ].color;
    sunDir = directionalLights[ 0 ].direction;
  #endif
  // Skylight irradiance / π on level ground (landscape.js sets it: the sky
  // is image-based, so there is no hemisphere light to read).
  vec3 skyColour = catSky;
  float sunLum = dot( sunColour, vec3( 0.2126, 0.7152, 0.0722 ) );
  float skyLum = dot( skyColour, vec3( 0.2126, 0.7152, 0.0722 ) ) * 3.14159;
`;

// π × the mean skylight radiance on level ground, set per frame by
// landscape.js from the shared lighting model.
export const CAT_SKY = { value: new THREE.Color(0.5, 0.5, 0.5) };

// A Lambert material whose output is a multiplier for whatever is behind it.
function multiplyMaterial({ vertexPars = "", vertexMain = "", fragmentPars = "", fragmentMain, key, uniforms = {} }) {
  const material = new THREE.MeshLambertMaterial({ color: 0xffffff, fog: false });
  Object.assign(material, {
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    blending: THREE.CustomBlending,
    blendSrc: THREE.DstColorFactor,
    blendDst: THREE.ZeroFactor,
    blendSrcAlpha: THREE.ZeroFactor,
    blendDstAlpha: THREE.OneFactor,
  });
  material.customProgramCacheKey = () => key;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms, { catSky: CAT_SKY });
    shader.vertexShader = shader.vertexShader
      .replace("void main() {", `${vertexPars}\nvoid main() {`)
      .replace("#include <fog_vertex>", `#include <fog_vertex>\n${vertexMain}`);
    shader.fragmentShader = shader.fragmentShader
      .replace("void main() {", `uniform vec3 catSky;\n${fragmentPars}\nvoid main() {`)
      .replace("#include <opaque_fragment>", `${SUN_SHADOW}\n${fragmentMain}`)
      .replace("#include <tonemapping_fragment>", "")
      .replace("#include <colorspace_fragment>", "")
      .replace("#include <premultiplied_alpha_fragment>", "")
      .replace("#include <dithering_fragment>", "");
  };
  return material;
}

// ---------------------------------------------------------------------------
// The cat's shadow on the ground: a small grid laid over the terrain (and
// rocks) round the cat, reading the cat's own shadow map with a penumbra
// that widens with distance from the paws (sharp where they touch, soft
// under the chin), plus the skylight the body and paws block where they
// meet the ground.

const GRID = 22;

export function createContactShadow(parent, uniforms) {
  const geometry = new THREE.PlaneGeometry(1, 1, GRID, GRID).rotateX(-Math.PI / 2);
  geometry.attributes.position.setUsage(THREE.DynamicDrawUsage);
  const local = {
    catBody: { value: new THREE.Vector4() },
    catPaws: { value: Array.from({ length: 4 }, () => new THREE.Vector4()) },
    sunShare: { value: 0.6 },
    shadowSpan: { value: 0.9 },
    catScale: { value: 1 },
  };
  const material = multiplyMaterial({
    key: "cat-contact-shadow",
    uniforms: { ...uniforms, ...local },
    vertexPars: "uniform mat4 catShadowMatrix;\nvarying vec4 vCatShadow;\nvarying vec3 vCoast;\nvarying vec2 vPatch;",
    vertexMain: "vCatShadow = catShadowMatrix * ( modelMatrix * vec4( transformed, 1.0 ) );\nvCoast = transformed;\nvPatch = uv;",
    fragmentPars: /* glsl */ `
      uniform sampler2D catShadowMap;
      uniform float catShadowOn;
      uniform vec4 catBody;
      uniform vec4 catPaws[ 4 ];
      uniform float sunShare;
      uniform float shadowSpan;
      uniform float catScale;
      varying vec4 vCatShadow;
      varying vec3 vCoast;
      varying vec2 vPatch;
      const vec2 POISSON[ 12 ] = vec2[](
        vec2( -0.326, -0.406 ), vec2( -0.840, -0.074 ), vec2( -0.696, 0.457 ), vec2( -0.203, 0.621 ),
        vec2( 0.962, -0.195 ), vec2( 0.473, -0.480 ), vec2( 0.519, 0.767 ), vec2( 0.185, -0.893 ),
        vec2( 0.507, 0.064 ), vec2( 0.896, 0.412 ), vec2( -0.322, -0.933 ), vec2( -0.792, -0.598 ) );`,
    fragmentMain: /* glsl */ `
      float shadow = 0.0;
      if ( catShadowOn > 0.5 ) {
        vec3 c = vCatShadow.xyz / vCatShadow.w;
        // Ground past the shadow camera's far plane is unshadowed, not dark.
        if ( c.x > 0.0 && c.x < 1.0 && c.y > 0.0 && c.y < 1.0 && c.z < 0.999 ) {
          // Blockers: how far above the ground the cat is here.
          float blocker = 0.0;
          float found = 0.0;
          for ( int i = 0; i < 12; i += 2 ) {
            float d = texture2D( catShadowMap, c.xy + POISSON[ i ] * 0.02 ).r;
            if ( d < c.z - 0.0008 ) { blocker += d; found += 1.0; }
          }
          if ( found > 0.0 ) {
            blocker /= found;
            // The sun is half a degree across; haze softens it further.
            // Depth spans the shadow camera's 10 m (cat.js).
            float gap = ( c.z - blocker ) * 10.0;
            float radius = clamp( gap * 0.018 / shadowSpan, 0.0015, 0.03 );
            for ( int i = 0; i < 12; i++ )
              shadow += step( texture2D( catShadowMap, c.xy + POISSON[ i ] * radius ).r, c.z - 0.0008 );
            shadow /= 12.0;
          }
          // Fade out toward the edges of the shadow map and of the ground
          // patch instead of cutting the shadow off square: a low sun
          // throws it further than the patch reaches.
          vec2 m = min( c.xy, 1.0 - c.xy );
          vec2 e = min( vPatch, 1.0 - vPatch );
          shadow *= smoothstep( 0.0, 0.08, min( m.x, m.y ) ) * smoothstep( 0.0, 0.12, min( e.x, e.y ) );
        }
      }
      // Contact occlusion: the body's shadow from the sky, and each paw's.
      vec2 rel = vCoast.xz - catBody.xy;
      float cs = cos( catBody.z ), sn = sin( catBody.z );
      vec2 along = vec2( rel.x * sn + rel.y * cs, rel.x * cs - rel.y * sn );
      vec2 bodyR = along / ( vec2( 0.2, 0.075 ) * catScale );
      float body = exp( -dot( bodyR, bodyR ) ) * catBody.w;
      float paws = 0.0;
      for ( int i = 0; i < 4; i++ ) {
        float d = length( vCoast.xz - catPaws[ i ].xy );
        paws += exp( -d * d / ( 0.00025 * catScale * catScale ) ) * ( 1.0 - smoothstep( 0.0, 0.04 * catScale, catPaws[ i ].z ) );
      }
      float ao = clamp( body * 0.45 + paws * 0.5, 0.0, 0.8 );
      float direct = sunShare * sunVis;
      float lit = 1.0 - shadow * direct;
      lit *= 1.0 - ao * ( 1.0 - direct * 0.6 );
      // What's left in the shadow is skylight: a little bluer.
      vec3 tint = mix( vec3( 1.0 ), vec3( 0.94, 0.97, 1.06 ), shadow * direct );
      gl_FragColor = vec4( tint * lit, 1.0 );`,
  });
  material.uniforms = local;
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  parent.add(mesh);
  let lastKey = "";
  return {
    mesh,
    local,
    // centre (coast), size (m) and heading of the patch; ground(x, z).
    place(cx, cz, size, ground) {
      const key = `${cx.toFixed(3)}:${cz.toFixed(3)}:${size.toFixed(2)}`;
      if (key === lastKey) return;
      lastKey = key;
      const p = geometry.attributes.position;
      for (let j = 0; j <= GRID; j++)
        for (let i = 0; i <= GRID; i++) {
          const k = j * (GRID + 1) + i;
          const x = cx + (i / GRID - 0.5) * size;
          const z = cz + (j / GRID - 0.5) * size;
          p.setXYZ(k, x, ground(x, z) + 0.003, z);
        }
      p.needsUpdate = true;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

// ---------------------------------------------------------------------------
// Paw prints. Each print is one quad whose depression is drawn as a height
// field and lit from the real sun: the metacarpal pad (three lobes behind,
// two in front), four toe beans in an arc with one leading, claws in, the
// hind print narrower. Wet sand keeps a crisp, dark print; dry sand a soft,
// crumbling pit with a rim of pushed-up grains; a running paw digs its toes
// in and throws sand back. On rock, only wet paws leave a mark. Prints fade
// with age, quickly where waves wash over them.

const PRINT_COUNT = 800;

const PRINT_HEIGHT = /* glsl */ `
  float ellipse( vec2 q, vec2 c, vec2 r ) { return length( ( q - c ) / r ); }
  // 0 outside, 1 at the bottom; edge is the rim width.
  float pit( float d, float edge ) { return 1.0 - smoothstep( 1.0 - edge, 1.0 + edge * 0.5, d ); }
  float printHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
  float printNoise( vec2 p ) {
    vec2 i = floor( p ); vec2 f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
    return mix( mix( printHash( i ), printHash( i + vec2( 1, 0 ) ), f.x ), mix( printHash( i + vec2( 0, 1 ) ), printHash( i + vec2( 1, 1 ) ), f.x ), f.y );
  }
  // Height at q (print space, y forward). vShape: x side (±1), y front
  // (1/0), z softness (0 wet … 1 dry), w speed.
  float printHeight( vec2 q ) {
    vec2 s = vec2( q.x * vShape.x, q.y );
    float soft = vShape.z;
    // Crumbling edges in dry sand.
    float n = ( printNoise( q * 7.0 + vSeed * 13.0 ) - 0.5 ) * 0.35 * soft;
    float edge = mix( 0.12, 0.4, soft );
    // Running digs the toes deeper and drags the pad.
    float dig = vShape.w;
    s.y -= 0.08 * dig * smoothstep( 0.0, -0.8, s.y );
    float front = vShape.y;
    float wide = mix( 0.88, 1.0, front );
    s.x /= wide;
    float padD = min( ellipse( s, vec2( 0.0, -0.3 ), vec2( 0.4, 0.28 ) ),
      min( min( ellipse( s, vec2( -0.24, -0.46 ), vec2( 0.17, 0.16 ) ), ellipse( s, vec2( 0.0, -0.5 ), vec2( 0.17, 0.16 ) ) ),
      ellipse( s, vec2( 0.24, -0.46 ), vec2( 0.17, 0.16 ) ) ) );
    // Toes: the inner-middle toe leads.
    float t1 = ellipse( s, vec2( -0.5, 0.14 ), vec2( 0.13, 0.155 ) );
    float t2 = ellipse( s, vec2( -0.18, 0.44 ), vec2( 0.13, 0.16 ) );
    float t3 = ellipse( s, vec2( 0.18, 0.5 ), vec2( 0.13, 0.16 ) );
    float t4 = ellipse( s, vec2( 0.5, 0.18 ), vec2( 0.13, 0.155 ) );
    float toes = min( min( t1, t2 ), min( t3, t4 ) );
    float d = min( padD, toes ) + n;
    float depth = pit( d, edge ) * mix( 1.0, 0.8, soft ) + pit( toes + n, edge ) * dig * 0.4;
    // Displaced sand piles into a low rim, pushed back when running.
    float rim = smoothstep( 1.0, 1.25, d ) * ( 1.0 - smoothstep( 1.25, 1.9, d ) );
    rim *= soft * 0.35 * ( 1.0 + dig * smoothstep( 0.0, -1.0, q.y ) * 2.0 );
    return -depth + rim;
  }`;

export function createPawPrints(parent) {
  const geometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  // born, strength, wetness, rock
  const life = new THREE.InstancedBufferAttribute(new Float32Array(PRINT_COUNT * 4).fill(-1e4), 4);
  // side, front, softness, speed
  const shape = new THREE.InstancedBufferAttribute(new Float32Array(PRINT_COUNT * 4), 4);
  for (const a of [life, shape]) a.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("printLife", life);
  geometry.setAttribute("printShape", shape);
  const uniforms = { printTime: { value: 0 } };
  const material = multiplyMaterial({
    key: "cat-paw-prints",
    uniforms,
    vertexPars: /* glsl */ `
      attribute vec4 printLife;
      attribute vec4 printShape;
      uniform float printTime;
      varying vec2 vPrint;
      varying vec4 vShape;
      varying float vFade;
      varying float vWet;
      varying float vRock;
      varying float vSeed;
      varying vec3 vT;
      varying vec3 vB;
      varying vec3 vN;`,
    vertexMain: /* glsl */ `
      vPrint = uv * 2.0 - 1.0;
      vPrint.y = -vPrint.y;
      vShape = printShape;
      float age = printTime - printLife.x;
      float span = mix( 110.0, 10.0, printLife.z * ( 1.0 - printLife.w ) );
      if ( printLife.w > 0.5 ) span = 18.0;
      vFade = printLife.y * smoothstep( 0.0, 0.08, age ) * ( 1.0 - smoothstep( span * 0.45, span, age ) );
      vWet = printLife.z;
      vRock = printLife.w;
      vSeed = fract( printLife.x * 7.13 );
      // Older prints slump: shallower and softer.
      vShape.z = min( 1.0, vShape.z + smoothstep( 0.0, span, age ) * 0.5 );
      mat3 frame = mat3( modelViewMatrix * instanceMatrix );
      vT = normalize( frame * vec3( 1.0, 0.0, 0.0 ) );
      vB = normalize( frame * vec3( 0.0, 0.0, -1.0 ) );
      vN = normalize( frame * vec3( 0.0, 1.0, 0.0 ) );
      if ( vFade <= 0.0 ) gl_Position = vec4( 0.0, 0.0, -2.0, 1.0 );`,
    fragmentPars: /* glsl */ `
      varying vec2 vPrint;
      varying vec4 vShape;
      varying float vFade;
      varying float vWet;
      varying float vRock;
      varying float vSeed;
      varying vec3 vT;
      varying vec3 vB;
      varying vec3 vN;
      ${PRINT_HEIGHT}`,
    fragmentMain: /* glsl */ `
      vec2 q = vPrint;
      if ( vRock > 0.5 ) {
        // Wet paws on rock: a dark stamp, no relief.
        float h = -printHeight( q );
        float mark = smoothstep( 0.2, 0.8, h ) * vFade;
        gl_FragColor = vec4( vec3( 1.0 - mark * 0.35 ), 1.0 );
      } else {
        float e = 0.06;
        float h0 = printHeight( q );
        float hx = printHeight( q + vec2( e, 0.0 ) );
        float hy = printHeight( q + vec2( 0.0, e ) );
        // Depth in metres: ~6 mm in wet sand, less when dry; across the
        // quad's ~5 cm.
        float relief = mix( 0.1, 0.07, vShape.z ) * vFade;
        vec2 grad = vec2( hx - h0, hy - h0 ) / e * relief;
        vec3 n = normalize( vN - vT * grad.x - vB * grad.y );
        float flatLit = max( dot( vN, sunDir ), 0.0 );
        float tilt = max( dot( n, sunDir ), 0.0 );
        // Pits see less sky.
        float ao = 1.0 - clamp( -h0, 0.0, 1.0 ) * 0.3 * vFade;
        float sunPart = sunLum * sunVis;
        float shade = ( sunPart * tilt + skyLum * ao ) / max( 1e-4, sunPart * flatLit + skyLum );
        // Compacted wet sand is darker; so is the water it draws up.
        float bottom = clamp( -h0, 0.0, 1.0 ) * vFade;
        vec3 tint = mix( vec3( 1.0 ), mix( vec3( 0.93, 0.92, 0.9 ), vec3( 0.8, 0.8, 0.83 ), vWet ), bottom );
        gl_FragColor = vec4( tint * shade, 1.0 );
      }`,
  });
  material.uniforms = uniforms;
  const mesh = new THREE.InstancedMesh(geometry, material, PRINT_COUNT);
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  mesh.renderOrder = 1;
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < PRINT_COUNT; i++) mesh.setMatrixAt(i, hidden);
  parent.add(mesh);
  // At night, a fresh print in wet sand flashes blue: the pressure lights up
  // the bioluminescent plankton the swash left in the sand (ocean.wgsl).
  // Additive, sharing the prints' instances; it draws nothing by day.
  const glowUniforms = { printTime: uniforms.printTime, printNight: { value: 0 } };
  const glow = new THREE.InstancedMesh(
    geometry,
    new THREE.ShaderMaterial({
      uniforms: glowUniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        attribute vec4 printLife;
        attribute vec4 printShape;
        uniform float printTime;
        uniform float printNight;
        varying vec2 vPrint;
        varying vec4 vShape;
        varying float vGlow;
        varying float vSeed;
        void main() {
          vSeed = fract( printLife.x * 7.13 );
          vPrint = uv * 2.0 - 1.0;
          vPrint.y = -vPrint.y;
          vShape = printShape;
          float age = printTime - printLife.x;
          // A bright flash as the paw presses, a slow blue ebb over seconds.
          vGlow = printNight * printLife.z * ( 1.0 - printLife.w ) * printLife.y
            * smoothstep( 0.0, 0.05, age ) * ( exp( -age * 1.4 ) * 0.8 + exp( -age * 0.25 ) * 0.2 );
          gl_Position = vGlow > 0.003 ? projectionMatrix * modelViewMatrix * instanceMatrix * vec4( position, 1.0 ) : vec4( 0.0, 0.0, -2.0, 1.0 );
        }`,
      fragmentShader: /* glsl */ `
        varying vec2 vPrint;
        varying vec4 vShape;
        varying float vGlow;
        varying float vSeed;
        ${PRINT_HEIGHT}
        void main() {
          float h = clamp( -printHeight( vPrint ), 0.0, 1.0 );
          float sparks = step( 0.93, printHash( floor( vPrint * 9.0 ) + floor( vGlow * 40.0 ) ) );
          gl_FragColor = vec4( vec3( 0.05, 0.42, 0.95 ) * vGlow * ( h * 0.25 + sparks * h * 0.8 ), 1.0 );
        }`,
    }),
    PRINT_COUNT,
  );
  glow.instanceMatrix = mesh.instanceMatrix;
  glow.frustumCulled = false;
  glow.renderOrder = 2;
  parent.add(glow);
  const transform = new THREE.Object3D();
  const up = new THREE.Vector3();
  let next = 0;
  return {
    mesh,
    update(time, night = 0) {
      uniforms.printTime.value = time;
      glowUniforms.printNight.value = night;
      glow.visible = night > 0.01;
    },
    // p: { time, x, y, z, heading, front, side (±1), normal [3], strength
    // 0–1, wet 0–1, soft 0–1, speed 0–1, rock }.
    add(p) {
      if (p.strength <= 0.02) return;
      transform.position.set(p.x, p.y + 0.002, p.z);
      up.set(p.normal[0], p.normal[1], p.normal[2]);
      transform.quaternion.setFromUnitVectors(THREE.Object3D.DEFAULT_UP, up);
      transform.rotateY(p.heading + p.side * 0.08);
      const size = p.front ? 0.058 : 0.053;
      transform.scale.set(size, 1, size * (1 + p.speed * 0.15));
      transform.updateMatrix();
      mesh.setMatrixAt(next, transform.matrix);
      life.setXYZW(next, p.time, p.strength, p.wet, p.rock ? 1 : 0);
      shape.setXYZW(next, p.side, p.front ? 1 : 0, p.soft, p.speed);
      // Upload only the new print (three clears the ranges after upload).
      mesh.instanceMatrix.addUpdateRange(next * 16, 16);
      mesh.instanceMatrix.needsUpdate = true;
      for (const [a, n] of [[life, 4], [shape, 4]]) {
        a.addUpdateRange(next * n, n);
        a.needsUpdate = true;
      }
      next = (next + 1) % PRINT_COUNT;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      glow.material.dispose();
      mesh.dispose();
      glow.dispose();
    },
  };
}

// ---------------------------------------------------------------------------
// Kicked-up sand: grains thrown from a paw as it pushes off dry sand at a
// run, or sprayed round a landing. The GPU flies each one (drag and gravity
// from its launch), so spawning is the only CPU work.
//
// The same system, lit as foam, throws water (createSpray): the cat's
// splashes and drips, and the surf bursting on the rocks. Each particle has
// a real size. Drops (under ~1.5 cm) fly almost free and glint in the sun.
// Clumps are torn-off sheets of water: they spread as they fly and turn
// to spray. Every particle dies at its own floor: the sea it fell from, or
// the sand a drip lands on.

const GRAINS = 384;

// Scales every splash the cat and the surf throw (the `?perf` console can
// tune it: skycope.landscape.splash.gain).
export const SPLASH = { gain: 1 };

export function createDust(parent, { water = false, grains = GRAINS, maxPixels = 7 } = {}) {
  const GRAINS = grains;
  const geometry = new THREE.BufferGeometry();
  const origin = new Float32Array(GRAINS * 3);
  const velocity = new Float32Array(GRAINS * 3);
  // Birth time, a random seed, size (m) and the floor it dies at.
  const birth = new Float32Array(GRAINS * 4).fill(-1e4);
  geometry.setAttribute("position", new THREE.BufferAttribute(origin, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute("velocity", new THREE.BufferAttribute(velocity, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute("birth", new THREE.BufferAttribute(birth, 4).setUsage(THREE.DynamicDrawUsage));
  const material = new THREE.ShaderMaterial({
    uniforms: {
      dustTime: { value: 0 },
      dustLight: { value: new THREE.Color(1, 1, 1) },
      dustScale: { value: 400 },
      dustMax: { value: maxPixels },
      dustViewport: { value: new THREE.Vector2(800, 600) },
    },
    vertexShader: /* glsl */ `
      attribute vec3 velocity;
      attribute vec4 birth;
      uniform float dustTime;
      uniform float dustScale;
      uniform float dustMax;
      uniform vec2 dustViewport;
      varying float vAlpha;
      varying float vGlint;
      varying float vClump;
      varying float vSeed;
      varying vec3 vStreak;
      void main() {
        vGlint = 0.0;
        vClump = 0.0;
        vSeed = birth.y;
        float t = dustTime - birth.x;
        vec3 p = position;
        #ifdef WATER
          // Drops and torn sheets keep their speed (air barely slows that
          // much water); only mist, the biggest and thinnest, hangs.
          float size = birth.z;
          float clump = smoothstep( 0.012, 0.045, size );
          float k = mix( 0.45, 0.9, clump ) + 3.5 * smoothstep( 0.1, 0.2, size );
          float g = 9.8;
          float life = mix( 1.0, 1.6, birth.y ) * mix( 1.0, 1.3, clump );
        #else
          float life = 0.55 + birth.y * 0.5;
          // Drag: velocity decays at rate k; gravity pulls the rest down.
          float k = 3.0;
          float g = 4.0;
        #endif
        float travel = ( 1.0 - exp( -k * t ) ) / k;
        p += velocity * travel;
        p.y -= g * ( t - travel ) / k;
        vAlpha = ( t > 0.0 && t < life ) ? ( 1.0 - t / life ) * 0.8 : 0.0;
        #ifdef WATER
          bool alive = t > 0.0 && t < life && p.y > birth.w;
          // A clump spreads into spray as it flies and thins as it goes.
          size *= 1.0 + clump * t * 2.2;
          vClump = clump;
          vAlpha = alive ? mix( 0.9, 0.85, clump ) * ( 1.0 - smoothstep( life * mix( 0.6, 0.25, clump ), life, t ) ) : 0.0;
          vGlint = step( 0.82, fract( birth.y * 17.3 + t * 3.0 ) ) * ( 1.0 - clump );
        #endif
        vec4 mv = modelViewMatrix * vec4( p, 1.0 );
        gl_Position = vAlpha > 0.0 ? projectionMatrix * mv : vec4( 0.0, 0.0, -2.0, 1.0 );
        #ifdef WATER
          // True size on screen. Under a pixel, a drop fades rather than
          // shrinking, so distant spray doesn't sparkle.
          float px = dustScale * size / max( -mv.z, 0.05 );
          vAlpha *= clamp( px, 0.0, 1.0 );
          // Up close a clump is held to the largest sprite, never cropped.
          px = min( px, dustMax );
          // Motion blur: a flying drop is seen as a streak along its path
          // over about one frame, which is most of what makes spray read.
          vec3 vel = velocity * exp( -k * t );
          vel.y -= g * ( 1.0 - exp( -k * t ) ) / k;
          vec4 a = gl_Position;
          vec4 b = projectionMatrix * ( modelViewMatrix * vec4( p - vel * 0.02, 1.0 ) );
          vec2 streak = ( a.xy / a.w - b.xy / max( b.w, 1e-4 ) ) * 0.5 * dustViewport;
          float len = min( length( streak ), dustMax - max( px, 1.0 ) );
          float sprite = clamp( max( px, 1.0 ) + len, 1.0, dustMax );
          gl_PointSize = sprite;
          // The streak in sprite units (y down, as gl_PointCoord), and the
          // drop's width; the drop's light is spread along it.
          vStreak = vec3( normalize( streak + 1e-6 ) * vec2( 1.0, -1.0 ) * len / sprite, max( px, 1.0 ) / sprite );
          vAlpha *= mix( sqrt( max( px, 1.0 ) / ( max( px, 1.0 ) + len ) ), 1.0, 0.35 );
        #else
          gl_PointSize = clamp( dustScale * ( 0.0018 + birth.y * 0.0015 ) / -mv.z, 1.0, 5.0 );
        #endif
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 dustLight;
      varying float vAlpha;
      varying float vGlint;
      varying float vClump;
      varying float vSeed;
      varying vec3 vStreak;
      void main() {
        vec2 c = gl_PointCoord * 2.0 - 1.0;
        float r = dot( c, c );
        #ifdef WATER
          // Distance to the streak's centre line, in drop radii.
          vec2 hs = vStreak.xy;
          float h = clamp( dot( c + hs, hs ) / max( dot( hs, hs ) * 2.0, 1e-5 ), 0.0, 1.0 );
          vec2 q = ( c + hs - 2.0 * hs * h ) / vStreak.z;
          r = dot( q, q );
          // A clear drop: a bright rim, and now and then the sun in it.
          float drop = 1.0 - smoothstep( 0.4, 1.0, r );
          vec3 dropColour = dustLight * ( 0.7 + 0.5 * smoothstep( 0.2, 0.8, r ) + vGlint * 2.5 );
          // A clump: two or three soft lobes of white water, not a disc.
          vec2 o = vec2( cos( vSeed * 40.0 ), sin( vSeed * 40.0 ) ) * 0.35;
          float lobes = max( exp( -dot( q - o, q - o ) * 2.6 ), max( exp( -dot( q + o * 0.8, q + o * 0.8 ) * 3.2 ), exp( -r * 1.7 ) * 0.9 ) );
          lobes *= 1.0 - smoothstep( 0.45, 1.0, r );
          float a = mix( drop * 0.85, lobes, vClump ) * vAlpha;
          if ( a < 0.004 ) discard;
          gl_FragColor = vec4( mix( dropColour, dustLight * ( 0.82 + 0.18 * lobes ), vClump ), a );
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        #else
        float a = ( 1.0 - smoothstep( 0.4, 1.0, r ) ) * vAlpha;
        gl_FragColor = vec4( dustLight * vec3( 0.62, 0.56, 0.44 ), a );
        #endif
      }`,
    transparent: true,
    depthWrite: false,
    defines: water ? { WATER: "" } : {},
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = 3;
  // Streaks are measured in the drawing buffer's pixels.
  if (water) points.onBeforeRender = (renderer) => renderer.getDrawingBufferSize(material.uniforms.dustViewport.value);
  parent.add(points);
  let next = 0;
  // Particles written since the last upload: one upload per frame, however
  // many bursts fired.
  let written = 0;
  let from = 0;
  // When the last particle dies: with nothing in the air the draw is
  // skipped altogether (most of the time, away from the water).
  let lastAlive = -1e4;
  // (Drawn on the first frame regardless, so the shader compiles up front
  // rather than on the first splash.)
  let compiled = false;
  const longest = water ? 2.2 : 1.1;
  const attrs = [[geometry.attributes.position, 3], [geometry.attributes.velocity, 3], [geometry.attributes.birth, 4]];
  const flush = () => {
    if (!written) return;
    const n = Math.min(written, GRAINS);
    const first = from;
    for (const [attr, size] of attrs) {
      if (n === GRAINS) attr.addUpdateRange(0, GRAINS * size);
      else if (first + n <= GRAINS) attr.addUpdateRange(first * size, n * size);
      else {
        attr.addUpdateRange(first * size, (GRAINS - first) * size);
        attr.addUpdateRange(0, (first + n - GRAINS) * size);
      }
      attr.needsUpdate = true;
    }
    written = 0;
  };
  const add = (time, x, y, z, vx, vy, vz, size, floor) => {
    if (!written) from = next;
    origin[next * 3] = x;
    origin[next * 3 + 1] = y;
    origin[next * 3 + 2] = z;
    velocity[next * 3] = vx;
    velocity[next * 3 + 1] = vy;
    velocity[next * 3 + 2] = vz;
    birth[next * 4] = time;
    lastAlive = Math.max(lastAlive, time + longest);
    birth[next * 4 + 1] = Math.random();
    birth[next * 4 + 2] = size;
    birth[next * 4 + 3] = floor;
    next = (next + 1) % GRAINS;
    written++;
  };
  return {
    points,
    // light: a brightness, or (water) the foam's colour.
    update(time, light, pixelScale) {
      flush();
      points.visible = !compiled || time < lastAlive;
      compiled = true;
      material.uniforms.dustTime.value = time;
      if (light.isColor) material.uniforms.dustLight.value.copy(light);
      else material.uniforms.dustLight.value.setRGB(light, light, light * 0.97);
      material.uniforms.dustScale.value = pixelScale;
    },
    // A spray of n grains from (x, y, z), thrown along (dx, dz) and up.
    spray(time, x, y, z, dx, dz, n, speed, up = 1) {
      n = Math.min(n, GRAINS);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const spread = Math.random() * 0.6;
        const s = speed * (0.4 + Math.random() * 0.8);
        add(time, x + Math.cos(a) * 0.01, y + 0.004, z + Math.sin(a) * 0.01, (dx + Math.cos(a) * spread) * s, s * (0.5 + Math.random() * 0.9) * up, (dz + Math.sin(a) * spread) * s, 0, -1e4);
      }
    },
    // One particle, fully specified (water: size in metres, dies below floor).
    add,
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

// Water thrown into the air, for the cat and the surf on the rocks.
//   burst({ x, y, z, n, dir: [dx, dz], spread, speed: [lo, hi], up: [lo, hi],
//           size: [lo, hi], radius, carry: [vx, vz], floor, delay, arc })
// throws n particles from a disc of radius round (x, y, z): horizontally
// along dir (a unit vector, or [0, 0] for all round) with angular spread
// (radians either side; π = all round), at speeds and upward speeds drawn
// from the ranges, sizes drawn log-uniformly, plus a carried velocity (the
// body's own), launched over `delay` seconds rather than all in one frame.
export function createSpray(parent, { grains = 2048, maxPixels = 64 } = {}) {
  const system = createDust(parent, { water: true, grains, maxPixels });
  const range = ([lo, hi], u = Math.random()) => lo + (hi - lo) * u;
  return {
    points: system.points,
    update: system.update,
    burst(time, { x, y, z, n, dir = [0, 0], spread = Math.PI, speed = [0.3, 1], up = [0.5, 1.5], size = [0.004, 0.012], radius = 0.02, carry = [0, 0], floor = y - 0.02, delay = 0 }) {
      n = Math.round(n);
      const base = dir[0] || dir[1] ? Math.atan2(dir[1], dir[0]) : 0;
      const logLo = Math.log(size[0]);
      const logHi = Math.log(size[1]);
      for (let i = 0; i < n; i++) {
        const a = dir[0] || dir[1] ? base + (Math.random() * 2 - 1) * spread : Math.random() * Math.PI * 2;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        const r = radius * Math.sqrt(Math.random());
        const s = range(speed);
        system.add(
          time + Math.random() * delay,
          x + ca * r, y + 0.004, z + sa * r,
          ca * s + carry[0], range(up), sa * s + carry[1],
          Math.exp(range([logLo, logHi])),
          floor,
        );
      }
    },
    dispose: system.dispose,
  };
}
