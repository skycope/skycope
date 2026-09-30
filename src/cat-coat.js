import * as THREE from "three";
import { HEAD } from "./cat-rig.js";
import { EYE_RADIUS } from "./cat-body.js";

// The coat: a brown mackerel tabby painted per pixel in the bind pose (so
// the markings ride the skin as it moves), lit as fur rather than plastic.
//
// - Diffuse wraps past the terminator with a warm scatter, as light does in
//   a coat; two Kajiya-Kay lobes along the lie of the hair give the sheen
//   that slides over the back as the cat walks.
// - Ears and the fur's edge glow when backlit; the cat shadows itself from
//   a small map of its own (cat.js), on top of the scene's shadow map.
// - Baked occlusion darkens armpits, the chin and between the legs; the
//   belly darkens nearer the ground.
// - Eyes are wet: a slit pupil that opens in the dark, a gold-green iris
//   with fibres and a dark limbal ring, the sky mirrored in the cornea, the
//   sun as a catchlight, eyeshine at night.
// - Shells: one instanced draw of N offset copies, each keeping a thinning,
//   tapering subset of strands that lie back along the body; when strands
//   are finer than a pixel they fade to their average coverage instead of
//   shimmering. Wet fur darkens, clumps and flattens.

// The coat is fixed in the bind pose, so the shells' per-vertex colour is
// painted once on the GPU: one texel per vertex, drawn as points.
export const BAKE_WIDTH = 256;
export function bakeShellColours(renderer, geometry) {
  const count = geometry.attributes.position.count;
  const height = Math.ceil(count / BAKE_WIDTH);
  const target = new THREE.WebGLRenderTarget(BAKE_WIDTH, height, { type: THREE.HalfFloatType, depthBuffer: false });
  const points = new THREE.BufferGeometry();
  for (const name of ["position", "normal", "coat", "region", "furInfo"]) points.setAttribute(name, geometry.attributes[name]);
  const material = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: /* glsl */ `
      precision highp float;
      in vec3 position;
      in vec3 normal;
      in vec4 coat;
      in vec4 region;
      in vec4 furInfo;
      out vec3 colour;
      ${PATTERN_GLSL}
      void main() {
        int x = gl_VertexID % ${BAKE_WIDTH};
        int y = gl_VertexID / ${BAKE_WIDTH};
        gl_Position = vec4( ( float( x ) + 0.5 ) / ${BAKE_WIDTH}.0 * 2.0 - 1.0, ( float( y ) + 0.5 ) / ${height}.0 * 2.0 - 1.0, 0.0, 1.0 );
        gl_PointSize = 1.0;
        // Ears: pale furnishings inside, dark backs; the rest is the coat.
        colour = coat.w > 1.5 ? ( coat.z > 0.5 ? lin( vec3( 0.86, 0.8, 0.72 ) ) : lin( vec3( 0.36, 0.28, 0.2 ) ) )
          : coatAt( coat.xyz, region, normal, furInfo.w, furInfo.z ).colour;
      }`,
    fragmentShader: /* glsl */ `
      precision highp float;
      in vec3 colour;
      out vec4 outColour;
      void main() { outColour = vec4( colour, 1.0 ); }`,
    depthTest: false,
    depthWrite: false,
  });
  const scene = new THREE.Scene();
  const cloud = new THREE.Points(points, material);
  cloud.frustumCulled = false;
  scene.add(cloud);
  const previous = renderer.getRenderTarget();
  renderer.setRenderTarget(target);
  renderer.render(scene, new THREE.Camera());
  renderer.setRenderTarget(previous);
  material.dispose();
  return target;
}

// The sea's light for the cat's submerged parts, set by the landscape: the
// water column's in-scattered colour (ocean.wgsl) and the foam's.
export const CAT_SEA = { colour: { value: new THREE.Color(0.01, 0.04, 0.06) }, foam: { value: new THREE.Color(0.8, 0.8, 0.8) } };

export function catUniforms() {
  return {
    catTime: { value: 0 },
    catBlink: { value: 0 },
    catPupil: { value: 0.2 },
    catEyeshine: { value: 0 },
    catGaze: { value: new THREE.Vector2() },
    catJaw: { value: 0 },
    catWet: { value: 0 },
    catWind: { value: new THREE.Vector3() },
    catGroundY: { value: 0 },
    catShadowMap: { value: null },
    catShadowMatrix: { value: new THREE.Matrix4() },
    catShadowOn: { value: 0 },
    shellCount: { value: 6 },
    furLength: { value: 0.0045 },
    catBodyColours: { value: null },
    catShellColours: { value: null },
    // Radians per pixel, for the shells' screen-size decisions.
    catPixelAngle: { value: 0.001 },
    // The water round the cat: its level at catWaterAt (world x, z), its
    // world slope, and whether there is any (w). catSoak: the bind-pose
    // height the coat is wet to.
    catWater: { value: new THREE.Vector4(0, 0, 0, 0) },
    catWaterAt: { value: new THREE.Vector2() },
    // How deep the water is under the cat: nothing higher above the bed
    // than that is under water, whatever the tilt of the local waterline.
    catWaterDepth: { value: 0 },
    catSoak: { value: -1 },
    catWaterColour: CAT_SEA.colour,
    catFoamLight: CAT_SEA.foam,
  };
}

const HEAD_GLSL = `vec3( ${HEAD.map((v) => v.toFixed(4)).join(", ")} )`;

const VERTEX_PARS = /* glsl */ `
attribute vec4 coat;
attribute vec4 region;
attribute vec4 furInfo;
attribute vec3 comb;
varying vec4 vCoat;
varying vec4 vRegion;
varying vec4 vFur;
varying vec3 vComb;
varying vec3 vBindNormal;
varying vec3 vCombBind;
varying vec4 vCatShadow;
varying float vShell;
varying float vGroundH;
uniform mat4 catShadowMatrix;
uniform float catGroundY;
uniform float shellCount;
uniform float furLength;
uniform float catWet;
uniform float catTime;
uniform vec3 catWind;
uniform float catPixelAngle;
uniform vec4 catWater;
uniform vec2 catWaterAt;
uniform float catWaterDepth;
uniform float catSoak;
varying vec3 vWaterP;
varying float vWet;
`;

// Under the surface the coat is seen through the water: dimmed and tinted
// by the column above it (the same absorption as ocean.wgsl), and fading so
// the sea, drawn behind, shows through. Where it meets the surface, a bright
// wet meniscus. gl_FragColor is linear here (tonemapped after).
const WATER_PARS = /* glsl */ `
uniform vec4 catWater;
uniform vec3 catWaterColour;
uniform vec3 catFoamLight;
varying vec3 vWaterP;
varying float vWet;
`;
const WATER_FRAGMENT = /* glsl */ `#include <opaque_fragment>
  if ( catWater.w > 0.5 ) {
    float d = vWaterP.z;
    if ( d > 0.0 ) {
      vec3 through = exp( -vec3( 0.478, 0.103, 0.073 ) * d * 2.6 );
      gl_FragColor.rgb = gl_FragColor.rgb * through + catWaterColour * ( 1.0 - through );
      gl_FragColor.a *= 0.8 * exp( -d * 5.5 );
    }
    // Only a faint, broken film of light: froth caught in the fur.
    float line = exp( -d * d / 0.000012 ) * ( 0.4 + 0.6 * fract( sin( dot( floor( vWaterP.xy * 90.0 ), vec2( 12.9898, 78.233 ) ) ) * 43758.5453 ) );
    gl_FragColor.rgb = mix( gl_FragColor.rgb, catFoamLight * 0.8, line * 0.22 );
  }`;


// Shared by both stages: the shell pass paints its coat per vertex.
const PATTERN_GLSL = /* glsl */ `
float cHash( vec3 p ) {
  p = fract( p * 0.3183099 + 0.1 );
  p *= 17.0;
  return fract( p.x * p.y * p.z * ( p.x + p.y + p.z ) );
}
float cNoise( vec3 x ) {
  vec3 i = floor( x );
  vec3 f = fract( x );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( mix( cHash( i ), cHash( i + vec3( 1, 0, 0 ) ), f.x ),
                   mix( cHash( i + vec3( 0, 1, 0 ) ), cHash( i + vec3( 1, 1, 0 ) ), f.x ), f.y ),
              mix( mix( cHash( i + vec3( 0, 0, 1 ) ), cHash( i + vec3( 1, 0, 1 ) ), f.x ),
                   mix( cHash( i + vec3( 0, 1, 1 ) ), cHash( i + vec3( 1, 1, 1 ) ), f.x ), f.y ), f.z );
}
vec3 lin( vec3 c ) { return c * c * ( c * 0.3 + 0.7 ); }
// Soft-edged band: 1 inside, feathered by the fur.
float band( float v, float width ) { return 1.0 - smoothstep( width * 0.5, width, abs( v ) ); }

// Brown mackerel tabby. p: bind-pose position (m). Returns colour; also
// writes how pale and how dark the marking is (for strand tips).
struct Coat { vec3 colour; float dark; float pale; float pad; float nose; float mouth; };

Coat coatAt( vec3 p, vec4 region, vec3 n, float nose, float mouth ) {
  Coat c;
  // Agouti: every hair is banded, so up close the ground colour is a warm
  // grey-brown salt-and-pepper, redder low on the flanks.
  vec3 agoutiLight = lin( vec3( 0.64, 0.53, 0.4 ) );
  vec3 agoutiDark = lin( vec3( 0.46, 0.37, 0.28 ) );
  vec3 stripe = lin( vec3( 0.15, 0.11, 0.075 ) );
  vec3 cream = lin( vec3( 0.84, 0.76, 0.62 ) );
  float tick = cNoise( p * 1400.0 ) * 0.55 + cNoise( p * 520.0 ) * 0.3 + cNoise( p * 90.0 ) * 0.15;
  vec3 base = mix( agoutiDark, agoutiLight, 0.5 + ( smoothstep( 0.2, 0.8, tick ) - 0.5 ) * 0.6 );
  float head = region.x;
  float leg = region.y;
  float tail = region.z;
  float paw = region.w;
  float body = clamp( 1.0 - head - leg - tail - paw, 0.0, 1.0 );
  float dark = 0.0;
  float pale = 0.0;
  c.pad = 0.0;
  if ( body > 0.01 ) {
    float flank = smoothstep( 0.04, -0.04, p.y );
    base = mix( base, base * vec3( 1.16, 0.98, 0.8 ), flank * 0.6 );
    // Three dorsal lines, wavering, merging over the rump and running on
    // into the tail.
    float wob = ( cNoise( p * vec3( 12.0, 12.0, 30.0 ) ) - 0.5 ) * 0.007;
    float top = smoothstep( 0.035, 0.065, p.y + 0.012 * smoothstep( 0.1, 0.2, p.z ) );
    float lines = max( band( p.x + wob, 0.0042 ), band( abs( p.x + wob ) - 0.012, 0.0028 ) * 0.7 ) * 0.8;
    float bd = lines * top;
    // Mackerel stripes: narrow, many, falling from the spine and sweeping
    // back as they descend; forked, broken into dashes toward the belly.
    float warp = ( cNoise( p * 20.0 ) - 0.5 ) * 2.6 + ( cNoise( p * 60.0 ) - 0.5 ) * 0.9;
    float wave = p.z * 235.0 - ( 0.07 - p.y ) * 38.0 + warp + ( cNoise( p * vec3( 8.0, 30.0, 12.0 ) ) - 0.5 ) * 2.4;
    float line = abs( fract( wave / 6.2832 ) - 0.5 ) * 2.0;
    float width = mix( 0.12, 0.26, cNoise( p * vec3( 20.0, 44.0, 30.0 ) ) );
    float dash = smoothstep( 0.2, 0.45, cNoise( p * vec3( 30.0, 75.0, 48.0 ) ) );
    float mackerel = ( 1.0 - smoothstep( width * 0.25, width * 1.15, line ) ) * dash * 0.9;
    mackerel *= smoothstep( -0.05, 0.0, p.y ) * ( 1.0 - top * 0.6 );
    // Haunch bars wrap the thigh; necklaces cross the chest.
    float haunch = smoothstep( -0.085, -0.125, p.z );
    float bars = band( fract( p.y * 34.0 + p.z * 14.0 + warp * 0.2 ) - 0.5, 0.2 ) * haunch * smoothstep( -0.07, -0.02, p.y );
    float belly = smoothstep( -0.028, -0.06, p.y );
    float chest = smoothstep( 0.1, 0.16, p.z ) * smoothstep( 0.02, -0.04, p.y );
    float necklace = band( fract( ( p.z - p.y * 0.7 ) * 36.0 + cNoise( p * 60.0 ) * 0.3 ) - 0.5, 0.14 ) * 0.7 * smoothstep( 0.13, 0.17, p.z ) * smoothstep( 0.06, 0.0, p.y ) * smoothstep( 0.24, 0.18, p.z );
    float spots = smoothstep( 0.63, 0.73, cNoise( p * 95.0 ) ) * belly * smoothstep( 0.1, -0.12, p.z );
    float bodyDark = max( bd * 0.9, max( mackerel * ( 1.0 - haunch ), bars ) );
    bodyDark = max( bodyDark * ( 1.0 - belly ), max( spots, necklace * 0.85 ) );
    float bodyPale = max( belly * 0.85, chest * smoothstep( 0.025, 0.0, abs( p.x ) ) * 0.55 );
    dark += bodyDark * body;
    pale += bodyPale * body;
  }
  if ( head > 0.01 ) {
    vec3 h = p - ${HEAD_GLSL};
    float ax = abs( h.x );
    float front = smoothstep( 0.0, 0.025, h.z );
    // The forehead "M" and fine lines back over the crown.
    float crown = smoothstep( 0.012, 0.035, h.y );
    float m = band( fract( h.x * 84.0 + 0.5 + sin( h.y * 150.0 ) * 0.12 ) - 0.5, 0.17 ) * smoothstep( 0.034, 0.018, ax );
    float hd = m * crown * mix( 0.65, 1.0, front );
    // Mascara line from the outer eye corner, the cheek swirl below it.
    vec2 eye = vec2( ax - 0.026, h.y - 0.004 );
    float mascara = band( eye.y + eye.x * 0.3, 0.0034 ) * smoothstep( -0.002, 0.004, eye.x ) * smoothstep( 0.028, 0.004, eye.x ) * step( h.z, 0.036 );
    float swirl = band( h.y + 0.012 + ( ax - 0.03 ) * 0.55, 0.0032 ) * smoothstep( 0.022, 0.036, ax ) * smoothstep( 0.03, 0.0, h.z + 0.012 );
    hd = max( hd, max( mascara, swirl * 0.85 ) );
    // Pale goggles round the eyes, the muzzle, chin and throat cream.
    float goggle = band( length( vec2( ax - 0.018, ( h.y - 0.006 ) * 1.3 ) ) - 0.0118, 0.0028 ) * front;
    float muzzle = smoothstep( -0.012, -0.022, h.y ) * smoothstep( 0.022, 0.035, h.z );
    float chin = smoothstep( -0.022, -0.03, h.y );
    float hp = max( goggle * 0.28, max( muzzle, chin ) );
    // Rows of dark whisker spots on the pads.
    vec2 pad = vec2( ax - 0.004, h.y + 0.018 );
    float spot = 1.0 - smoothstep( 0.00055, 0.0009, length( vec2( fract( ( h.z - 0.03 ) * 360.0 ) - 0.5, fract( pad.y * 360.0 + 0.5 ) - 0.5 ) / 360.0 ) );
    spot *= smoothstep( 0.0, 0.003, ax - 0.003 ) * smoothstep( -0.024, -0.02, h.y ) * smoothstep( -0.013, -0.017, h.y ) * smoothstep( 0.034, 0.038, h.z );
    hd = max( hd, spot * 0.7 );
    // The lips are lined in black.
    hd = max( hd, smoothstep( 0.55, 0.9, mouth ) * 0.75 );
    dark += hd * head;
    pale += hp * head * ( 1.0 - hd );
  }
  if ( leg > 0.01 ) {
    // Bars, closer together and bolder toward the paws, over a paler inner
    // side; the backs of the hind feet are dark ("boots").
    float warp = ( cNoise( p * 70.0 ) - 0.5 ) * 0.3;
    float bar = abs( fract( p.y * mix( 36.0, 48.0, smoothstep( -0.05, -0.17, p.y ) ) + p.z * 5.0 + warp ) - 0.5 ) * 2.0;
    float width = mix( 0.12, 0.24, cNoise( p * vec3( 40.0, 90.0, 40.0 ) ) );
    float ld = ( 1.0 - smoothstep( width * 0.25, width * 1.1, bar ) ) * 0.45 * smoothstep( 0.02, -0.06, p.y ) * smoothstep( 0.25, 0.55, cNoise( p * vec3( 50.0, 20.0, 50.0 ) ) + 0.25 );
    float inner = smoothstep( 0.2, 0.8, -n.x * sign( p.x ) );
    float boot = smoothstep( -0.2, -0.6, n.z ) * smoothstep( -0.11, -0.14, p.y ) * step( p.z, -0.02 );
    ld = max( ld * ( 1.0 - inner * 0.6 ), boot * 0.9 );
    dark += ld * leg;
    pale += inner * 0.4 * leg;
  }
  if ( paw > 0.01 ) {
    // Paler toes; the soles are dark pads.
    float sole = smoothstep( -0.6, -0.85, n.y ) * smoothstep( -0.1985, -0.2015, p.y );
    c.pad = sole * paw;
    pale += ( 0.06 + smoothstep( 0.3, 0.9, n.z ) * 0.12 ) * paw;
  }
  if ( tail > 0.01 ) {
    // Rings, broader toward the tip, a dark line along the top, black tip.
    float s = clamp( ( -0.165 - p.z ) / 0.3, 0.0, 1.0 );
    float ring = abs( fract( s * ( 7.5 + s * 2.0 ) + cNoise( p * 40.0 ) * 0.15 ) - 0.5 ) * 2.0;
    float td = 1.0 - smoothstep( 0.3, 0.52 + s * 0.15, ring );
    td = max( td, smoothstep( 0.4, 0.85, n.y ) * 0.65 );
    td = max( td, smoothstep( 0.86, 0.92, s ) );
    pale += smoothstep( -0.4, -0.9, n.y ) * 0.25 * tail * ( 1.0 - td );
    dark += td * tail;
  }
  dark = clamp( dark, 0.0, 1.0 );
  pale = clamp( pale, 0.0, 1.0 );
  vec3 col = mix( base, stripe * ( 0.8 + tick * 0.45 ), dark );
  col = mix( col, cream * ( 0.9 + tick * 0.15 ), pale );
  // Paw pads: dark, faintly pink-brown leather.
  col = mix( col, lin( vec3( 0.2, 0.13, 0.12 ) ), c.pad );
  // Nose leather: brick red, rimmed in black, with nostrils.
  {
    vec3 h = p - ${HEAD_GLSL} - vec3( 0.0, -0.0064, 0.0452 );
    vec3 hn = h / vec3( 0.0058, 0.0042, 0.0032 );
    // A rounded triangle, wide at the top: narrower toward the bottom.
    hn.x *= 1.0 + smoothstep( 0.3, -0.9, hn.y ) * 0.6;
    float rim = smoothstep( 1.0, 1.3, length( hn ) );
    float nostril = 1.0 - smoothstep( 0.0009, 0.0015, length( vec2( abs( h.x ) - 0.0026, ( h.y + 0.0016 ) * 1.6 ) ) );
    vec3 leather = mix( lin( vec3( 0.58, 0.34, 0.31 ) ), lin( vec3( 0.12, 0.08, 0.07 ) ), max( rim * 0.85, nostril ) );
    leather *= 0.9 + cHash( floor( p * 4000.0 ) ) * 0.2;
    float leatherMask = ( 1.0 - smoothstep( 1.35, 1.55, length( hn ) ) ) * smoothstep( -0.001, 0.002, h.z ) * step( 0.3, head );
    col = mix( col, leather, leatherMask );
    // The philtrum: a fine dark groove from the nose down to the lip.
    float philtrum = band( h.x, 0.0007 ) * smoothstep( -0.004, -0.006, h.y ) * smoothstep( -0.013, -0.011, h.y ) * step( 0.3, head );
    col = mix( col, lin( vec3( 0.14, 0.1, 0.08 ) ), philtrum * 0.8 );
    nose = max( nose, leatherMask );
  }
  c.colour = col;
  c.dark = dark;
  c.pale = pale;
  c.nose = nose;
  c.mouth = mouth;
  return c;
}

`;

const FRAGMENT_PARS = /* glsl */ `
varying vec4 vCoat;
varying vec4 vRegion;
varying vec4 vFur;
varying vec3 vComb;
varying vec3 vBindNormal;
varying vec3 vCombBind;
varying vec4 vCatShadow;
varying float vShell;
varying float vGroundH;
uniform float catBlink;
uniform float shellCount;
uniform float catPupil;
uniform float catEyeshine;
uniform vec2 catGaze;
uniform float catJaw;
uniform float catWet;
uniform sampler2D catShadowMap;
uniform float catShadowOn;
// Set in main() before the light loop, read by RE_Direct_Fur.
float furSelfShadow = 1.0;
vec3 furT = vec3( 0.0, 1.0, 0.0 );
float furSheen = 1.0;
float furGloss = 0.0;
float furThin = 0.0;
float furSoft = 1.0;
float furIris = 0.0;
vec3 furTrans = vec3( 1.0, 0.45, 0.35 );

${PATTERN_GLSL}
// The cat's own shadow (a small map from the sun, fit round the cat).
float catShadow( vec4 coord, float bias ) {
  if ( catShadowOn < 0.5 ) return 1.0;
  vec3 c = coord.xyz / coord.w;
  if ( c.x < 0.0 || c.x > 1.0 || c.y < 0.0 || c.y > 1.0 ) return 1.0;
  float lit = 0.0;
  vec2 texel = vec2( 1.0 / 256.0 );
  for ( int i = 0; i < 4; i++ ) {
    vec2 o = vec2( float( i & 1 ) - 0.5, float( i >> 1 ) - 0.5 ) * texel * 1.5;
    lit += step( c.z - bias, texture2D( catShadowMap, c.xy + o ).r );
  }
  return lit * 0.25;
}

// Fur lighting (see the header comment).
void RE_Direct_Fur( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
  IncidentLight lit = directLight;
  lit.color *= furSelfShadow;
  vec3 L = lit.direction;
  vec3 N = geometryNormal;
  vec3 V = geometryViewDir;
  float nl = dot( N, L );
  // Thin parts pass light through: ears, the fringe at the silhouette.
  float back = pow( clamp( dot( V, -L ), 0.0, 1.0 ), 3.0 );
  reflectedLight.directDiffuse += lit.color * furTrans * back * furThin * material.diffuseContribution * 2.0;
  if ( furGloss > 0.5 ) {
    RE_Direct_Physical( lit, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
    // The cornea is a lens: sunlight focuses into a bright crescent on the
    // far side of the iris from the catchlight.
    float caustic = furIris * smoothstep( 0.05, 0.4, nl ) * ( 1.0 - smoothstep( 0.45, 0.9, nl ) );
    reflectedLight.directDiffuse += lit.color * material.diffuseContribution * caustic * 1.2;
    return;
  }
  float wrap = 0.45 * furSoft;
  float diffuse = clamp( ( nl + wrap ) / ( ( 1.0 + wrap ) * ( 1.0 + wrap ) ), 0.0, 1.0 );
  // Light scattered in the coat reddens past the terminator.
  vec3 scatter = vec3( 1.0, 0.62, 0.42 ) * max( 0.0, diffuse - max( nl, 0.0 ) ) * 0.9;
  reflectedLight.directDiffuse += lit.color * ( vec3( diffuse ) + scatter ) * BRDF_Lambert( material.diffuseContribution );
  // Kajiya-Kay: a white primary lobe shifted toward the tips and a broad,
  // coloured secondary lobe from light that passed through the hair.
  vec3 H = normalize( L + V );
  vec3 t1 = normalize( furT + N * 0.15 );
  vec3 t2 = normalize( furT - N * 0.25 );
  float th1 = dot( t1, H );
  float th2 = dot( t2, H );
  float s1 = pow( max( 0.0, 1.0 - th1 * th1 ), 40.0 );
  float s2 = pow( max( 0.0, 1.0 - th2 * th2 ), 12.0 );
  vec3 sheen = ( vec3( s1 ) * 0.015 + material.diffuseContribution * s2 * 0.08 ) * smoothstep( 0.0, 0.5, nl ) * furSheen;
  reflectedLight.directSpecular += lit.color * sheen;
}
`;

// One program per variant; three caches by the onBeforeCompile text, so
// each needs its own key.
// baked: the coat colour comes from the per-vertex bake (the body at the
// usual distance, where stripes span a few pixels) instead of per pixel.
export function coatMaterial(uniforms, { shell = false, baked = false } = {}) {
  // Shells are fuzz at the silhouette: Lambert-lit, painted per vertex.
  const material = shell ? new THREE.MeshLambertMaterial({ color: 0xffffff }) : new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 });
  material.customProgramCacheKey = () => `cat-coat-v4-${shell}-${baked}`;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("void main() {", `${VERTEX_PARS}${baked ? `uniform sampler2D catBodyColours;\nvarying vec3 vBakedColour;` : ""}${shell ? `uniform sampler2D catShellColours;\nvarying vec3 vShellColour;\nvarying float vShellShadow;\nuniform sampler2D catShadowMap;\nuniform float catShadowOn;` : ""}\nvoid main() {\n vCoat = coat; vRegion = region; vFur = furInfo; vBindNormal = normal; vCombBind = comb;\n vWet = max( catWet, smoothstep( catSoak + 0.015, catSoak - 0.015, position.y ) );${baked ? `\n vBakedColour = texelFetch( catBodyColours, ivec2( gl_VertexID % ${BAKE_WIDTH}, gl_VertexID / ${BAKE_WIDTH} ), 0 ).rgb;` : ""}`)
      .replace(
        "#include <begin_vertex>",
        shell
          ? /* glsl */ `#include <begin_vertex>
          // Each instance is one shell, pushed out along the normal and laid
          // back along the fur's direction (short coats lie flat), a little
          // shorter and flatter when wet.
          vShell = ( float( gl_InstanceID ) + 1.0 ) / shellCount;
          bool shellCulled = false;
          float furLen = furLength * furInfo.y * ( 1.0 - vWet * 0.45 );
          // (Added after skinning, below.)
          vec3 shellOffset = normal * vShell * furLen * ( 0.8 - vWet * 0.3 ) + comb * vShell * vShell * furLen * 1.4;
          shellOffset.y -= vShell * vShell * furLen * 0.25;`
          : `#include <begin_vertex>\n vShell = 0.0;`,
      )
      .replace(
        "#include <skinning_vertex>",
        /* glsl */ `#include <skinning_vertex>
        #ifdef USE_SKINNING
          vComb = normalize( ( modelViewMatrix * ( skinMatrix * vec4( comb, 0.0 ) ) ).xyz + 1e-6 );
        #else
          vComb = normalize( ( modelViewMatrix * vec4( comb, 0.0 ) ).xyz + 1e-6 );
        #endif
        ${
          shell
            ? /* glsl */ `// Wind ruffles the tips, in gusts that travel along the body.
          float gust = 0.6 + 0.4 * sin( catTime * 5.0 + dot( coat.xyz, vec3( 40.0, 25.0, 60.0 ) ) ) * sin( catTime * 1.7 + coat.z * 20.0 );
          shellOffset += catWind * vShell * vShell * furLength * furInfo.y * gust;
          // Shells cost fill, so only the silhouette gets the outer ones:
          // where this shell faces the camera, it tucks just under the skin
          // and fails the depth test before any shading. Up close, where
          // strands are resolved, the two inner shells cover everything.
          vec4 shellView = modelViewMatrix * vec4( transformed, 1.0 );
          float facing = abs( dot( normalize( transformedNormal ), normalize( -shellView.xyz ) ) );
          float strandPixels = 0.00087 / ( -shellView.z * catPixelAngle );
          bool inner = gl_InstanceID < 2 && strandPixels > 1.6;
          #ifdef USE_SKINNING
            vec3 offsetNow = ( skinMatrix * vec4( shellOffset, 0.0 ) ).xyz;
          #else
            vec3 offsetNow = shellOffset;
          #endif
          shellCulled = facing > 0.38 && !inner;
          // Baked once per vertex (bakeShellColours).
          vShellColour = texelFetch( catShellColours, ivec2( gl_VertexID % ${BAKE_WIDTH}, gl_VertexID / ${BAKE_WIDTH} ), 0 ).rgb;
          transformed += offsetNow;`
            : ""
        }
        vec4 catWorld = modelMatrix * vec4( transformed, 1.0 );
        // Depth under the local surface, which wobbles with little ripples.
        vWaterP = vec3( catWorld.xz, min( catWater.x + dot( catWater.yz, catWorld.xz - catWaterAt ) - catWorld.y
          + 0.005 * sin( dot( catWorld.xz, vec2( 23.0, 17.0 ) ) - catTime * 5.1 ) + 0.004 * sin( dot( catWorld.xz, vec2( -13.0, 29.0 ) ) - catTime * 3.7 ), catWaterDepth - ( catWorld.y - catGroundY ) + 0.02 ) );
        vCatShadow = catShadowMatrix * catWorld;
        vGroundH = catWorld.y - catGroundY;
        ${shell ? `{
          vec3 sc = vCatShadow.xyz / vCatShadow.w;
          bool inside = catShadowOn > 0.5 && sc.x > 0.0 && sc.x < 1.0 && sc.y > 0.0 && sc.y < 1.0;
          vShellShadow = inside ? step( sc.z - 0.0024, texture( catShadowMap, sc.xy ).r ) : 1.0;
        }` : ""}`,
      );
    // A culled shell vertex goes behind the near plane: whole triangles
    // clip away unrasterised, and edge triangles clip cleanly.
    if (shell)
      shader.vertexShader = shader.vertexShader.replace(
        "#include <project_vertex>",
        "#include <project_vertex>\n if ( shellCulled ) gl_Position.z = -2.0 * gl_Position.w;",
      );
    if (shell) {
      shader.fragmentShader = shader.fragmentShader
        .replace("void main() {", `${SHELL_PARS}${WATER_PARS}\nvoid main() {`)
        .replace("#include <color_fragment>", `#include <color_fragment>\n${SHELL_COLOUR}`)
        .replace("#include <opaque_fragment>", WATER_FRAGMENT);
      return;
    }
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <lights_physical_pars_fragment>",
        `#include <lights_physical_pars_fragment>\n${baked ? "#define CAT_BAKED\nvarying vec3 vBakedColour;\n" : ""}${shell ? "#define CAT_SHELL\nvarying vec3 vShellColour;\n" : ""}${FRAGMENT_PARS}${WATER_PARS}\n#undef RE_Direct\n#define RE_Direct RE_Direct_Fur`,
      )
      .replace("#include <opaque_fragment>", WATER_FRAGMENT)
      .replace("#include <color_fragment>", `#include <color_fragment>\n${shell ? SHELL_COLOUR : BASE_COLOUR}`)
      .replace(
        "#include <roughnessmap_fragment>",
        "#include <roughnessmap_fragment>\n roughnessFactor = mix( roughnessFactor, eyeRough, furGloss );",
      )
      .replace(
        "#include <normal_fragment_maps>",
        /* glsl */ `#include <normal_fragment_maps>
        furT = normalize( vComb - normal * dot( vComb, normal ) + 1e-5 );`,
      )
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\n totalEmissiveRadiance += glow;")
      .replace(
        "#include <lights_fragment_end>",
        /* glsl */ `#include <lights_fragment_end>
        {
          // Occlusion: baked in the bind pose, deeper toward the roots, and
          // the ground's own shadow under the belly.
          float groundAO = mix( 0.72, 1.0, smoothstep( 0.0, 0.2, vGroundH ) );
          float occlusion = furAO * groundAO;
          reflectedLight.indirectDiffuse *= occlusion;
          reflectedLight.directDiffuse *= mix( 1.0, furAO, 0.3 );
          // Fur scatters skylight round its silhouette.
          float rim = pow( 1.0 - clamp( dot( normal, normalize( vViewPosition ) ), 0.0, 1.0 ), 2.5 ) * ( 1.0 - furGloss );
          reflectedLight.indirectDiffuse *= 1.0 + rim * 0.7;
          #if NUM_HEMI_LIGHTS > 0
          if ( furGloss > 0.5 ) {
            // The cornea mirrors the sky above and the ground below.
            vec3 V = normalize( vViewPosition );
            vec3 R = reflect( -V, normal );
            float up = dot( R, hemisphereLights[ 0 ].direction ) * 0.5 + 0.5;
            vec3 env = mix( hemisphereLights[ 0 ].groundColor, hemisphereLights[ 0 ].skyColor, smoothstep( 0.35, 0.75, up ) );
            float fres = 0.04 + 0.96 * pow( 1.0 - clamp( dot( normal, V ), 0.0, 1.0 ), 5.0 );
            reflectedLight.indirectSpecular += env * fres * eyeWet * 0.9;
          }
          #endif
        }`,
      );
  };
  return material;
}

// Shared by both passes: the coat colour and the lighting inputs.
const COMMON_COLOUR = /* glsl */ `
  float catPart = floor( vCoat.w + 0.5 );
  vec3 glow = vec3( 0.0 );
  float eyeRough = 0.12;
  float eyeWet = 0.0;
  float furAO = vFur.x;
  vec3 coatColour;
  // Biases are in shadow depth, which spans 10 m (cat.js).
  furSelfShadow = catShadow( vCatShadow, 0.0016 );
  furSheen = 1.0 + vWet * 1.6;
  if ( catPart < 0.5 ) {
    #if defined( CAT_BAKED )
      Coat c;
      c.colour = vBakedColour;
      c.nose = smoothstep( 0.3, 0.7, vFur.w );
      c.pad = 0.0;
    #else
      Coat c = coatAt( vCoat.xyz, vRegion, normalize( vBindNormal ), vFur.w, vFur.z );
    #endif
    coatColour = c.colour;
    // The lips part when the jaw opens: the mouth's lining shows.
    coatColour = mix( coatColour, lin( vec3( 0.36, 0.12, 0.13 ) ), smoothstep( 0.3, 0.8, vFur.z ) * smoothstep( 0.0, 0.25, catJaw ) );
    furSheen *= 1.0 - c.nose - c.pad * 0.5;
    eyeRough = 0.45;
    furSoft = 1.0 - c.nose;
    furThin = 0.12;
  } else if ( catPart < 1.5 ) {
    // Eye (coordinates in the eye's own frame, +z along its gaze).
    vec3 e = normalize( vCoat.xyz );
    float side = vCoat.w > 1.1 ? -1.0 : 1.0;
    // Toward the outer corner of this eye.
    float outer = e.x * side;
    vec2 q = e.xy - catGaze * e.z;
    float r = length( q );
    float ang = atan( q.y, q.x );
    // The iris fills nearly all of the opening; a thin dark limbal ring.
    float iris = 1.0 - smoothstep( 0.83, 0.88, r );
    // Radial fibres: long streaks outward from the pupil, a few crypts.
    float fibre = cNoise( vec3( ang * 7.0, r * 3.0, 0.0 ) ) * 0.28 + cNoise( vec3( ang * 26.0, r * 2.5, 3.0 ) ) * 0.2 + cNoise( vec3( ang * 60.0, r * 1.5, 7.0 ) ) * 0.08;
    vec3 irisColour = mix( lin( vec3( 0.42, 0.52, 0.17 ) ), lin( vec3( 0.86, 0.66, 0.24 ) ), smoothstep( 0.2, 0.72, r ) );
    irisColour *= 0.72 + fibre;
    // The collarette: a paler ring round the pupil.
    irisColour *= 1.0 + band( r - 0.26, 0.09 ) * 0.35;
    irisColour *= 1.0 - smoothstep( 0.7, 0.86, r ) * 0.7;
    // Slit pupil, rounder as it opens.
    float pupil = 1.0 - smoothstep( 0.9, 1.1, length( vec2( q.x / max( catPupil, 0.05 ), q.y / mix( 0.64, 0.72, catPupil ) ) ) * 2.3 );
    coatColour = mix( lin( vec3( 0.18, 0.14, 0.1 ) ), irisColour, iris ) * ( 1.0 - pupil * 0.98 );
    glow = lin( vec3( 0.3, 0.85, 0.5 ) ) * pupil * catEyeshine * 0.45 * pow( clamp( e.z, 0.0, 1.0 ), 3.0 );
    furGloss = 1.0;
    eyeRough = 0.05;
    eyeWet = 1.0;
    furIris = iris * ( 1.0 - pupil );
    furAO = mix( 0.5, 1.0, smoothstep( 0.2, 0.85, e.z ) );
    // Almond lids at rest (the outer corner a little higher), closing from
    // above and meeting a rising lower lid to blink.
    float upperRest = 0.84 + outer * 0.1 - outer * outer * 0.3;
    float lowerRest = -0.6 + outer * 0.1 + outer * outer * 0.18;
    float upper = mix( upperRest, lowerRest + 0.12, catBlink );
    float lower = mix( lowerRest, lowerRest + 0.1, catBlink );
    float lid = max( smoothstep( upper - 0.03, upper + 0.03, e.y ), smoothstep( lower + 0.03, lower - 0.03, e.y ) );
    // The lid margins are black; a wet line of tears sits on the lower one.
    float rim = band( e.y - upper, 0.09 ) + band( e.y - lower, 0.08 );
    eyeWet += band( e.y - lower - 0.05, 0.05 ) * 1.5;
    coatColour = mix( coatColour, lin( vec3( 0.42, 0.33, 0.24 ) ), lid );
    coatColour *= 1.0 - clamp( rim, 0.0, 1.0 ) * 0.92;
    furGloss *= 1.0 - lid;
    eyeWet *= 1.0 - lid;
    glow *= 1.0 - lid;
    furIris *= 1.0 - lid;
  } else {
    // Ear: coat.xyz = ( u across, v up, 1 on the inner face ).
    float u = vCoat.x;
    float v = vCoat.y;
    float inner = step( 0.5, vCoat.z ) * ( 1.0 - smoothstep( 0.72, 0.92, abs( u ) ) );
    float tick = cNoise( vec3( u * 30.0, v * 40.0, vCoat.z ) );
    vec3 back = mix( lin( vec3( 0.3, 0.23, 0.17 ) ), lin( vec3( 0.46, 0.36, 0.26 ) ), tick );
    back *= 1.0 - smoothstep( 0.75, 1.0, v ) * 0.5;
    vec3 skin = lin( vec3( 0.84, 0.6, 0.56 ) );
    // Pale furnishings from the inner rim and the base.
    float tuft = max( smoothstep( 0.45, 0.8, abs( u ) ), smoothstep( 0.35, 0.05, v ) ) * ( 0.5 + 0.5 * cNoise( vec3( u * 14.0, v * 9.0, 1.0 ) ) );
    skin = mix( skin, lin( vec3( 0.88, 0.84, 0.76 ) ), smoothstep( 0.3, 0.7, tuft ) );
    coatColour = mix( back, skin, inner );
    furThin = mix( 0.35, 1.3, inner ) * ( 1.0 - v * 0.3 );
    furTrans = vec3( 1.0, 0.35, 0.3 );
    furSheen = 1.0 - inner;
    furAO *= mix( 1.0, mix( 0.45, 1.0, v ), inner );
  }
  coatColour *= 1.0 - vWet * 0.3;
`;

const BASE_COLOUR = /* glsl */ `
  ${COMMON_COLOUR}
  // Under the fur the coat is a touch darker (roots in their own shade).
  if ( catPart < 0.5 ) coatColour *= 0.85;
  diffuseColor.rgb = coatColour;
`;

const SHELL_COLOUR = /* glsl */ `
  // Strands first (cheap), so most shell fragments are gone before the
  // coat is painted and lit.
  // Strands: ~0.9 mm cells in the bind pose (the same cell at every shell
  // height, so each strand is continuous), tapering toward a per-strand
  // length. Wet fur clumps into fewer, thicker points.
  float shellPart = floor( vCoat.w + 0.5 );
  float len = vFur.y * ( 1.0 - vWet * 0.3 );
  if ( len < 0.08 || ( shellPart > 0.5 && shellPart < 1.5 ) ) discard;
  float clumpScale = mix( 1150.0, 520.0, vWet );
  vec3 sp = vCoat.xyz * clumpScale + ( shellPart > 1.5 ? vec3( 0.0, 0.0, vCoat.z * 20.0 ) : vec3( 0.0 ) );
  float footprint = length( fwidth( sp ) );
  vec3 cell = floor( sp );
  vec3 f = fract( sp ) - 0.5;
  // Jittered within the cell, and drawn out along the lie of the hair, so
  // the coat reads as strands, not dots.
  f -= ( vec3( cHash( cell + 1.7 ), cHash( cell + 3.1 ), cHash( cell + 5.3 ) ) - 0.5 ) * 0.5;
  vec3 lie = normalize( vCombBind + 1e-5 );
  f -= lie * dot( f, lie ) * 0.8;
  float rnd = cHash( cell );
  float strandLen = mix( 0.5, 1.0, rnd ) * min( 1.0, len * 1.2 );
  float radius = 0.55 * clamp( 1.0 - vShell / strandLen, 0.0, 1.0 );
  float strand = 1.0 - smoothstep( radius - 0.12, radius + 0.12, length( f ) );
  // Finer than a pixel: fade to the strands' average coverage.
  float coverage = clamp( 1.0 - vShell / min( 1.0, len * 1.2 ), 0.0, 1.0 );
  coverage = coverage * coverage * 0.75;
  float alpha = mix( strand, coverage, smoothstep( 0.5, 1.4, footprint ) );
  alpha *= smoothstep( 0.05, 0.25, len );
  if ( alpha < 0.03 ) discard;
  // The coat was painted per vertex; roots sit in shade and agouti hairs
  // end in a darker tip. The cat's own shadow was looked up per vertex too.
  vec3 coatColour = vShellColour;
  coatColour *= mix( 0.62, 1.05, vShell );
  coatColour *= 1.0 - smoothstep( 0.7, 1.0, vShell / strandLen ) * 0.25;
  coatColour *= mix( 1.0, vShellShadow, 0.65 ) * ( 1.0 - vWet * 0.3 );
  diffuseColor.rgb = coatColour;
  diffuseColor.a = alpha;
`;

const SHELL_PARS = /* glsl */ `
varying vec4 vCoat;
varying vec4 vFur;
varying vec3 vCombBind;
varying float vShell;
varying vec3 vShellColour;
varying float vShellShadow;
uniform float catWet;
float cHash( vec3 p ) {
  p = fract( p * 0.3183099 + 0.1 );
  p *= 17.0;
  return fract( p.x * p.y * p.z * ( p.x + p.y + p.z ) );
}
`;

// Silhouette through whatever hides the cat (drawn only where it fails the
// depth test and isn't already drawn).
export function ghostMaterial() {
  return new THREE.MeshBasicMaterial({
    color: new THREE.Color(0.95, 0.85, 0.7),
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
    depthFunc: THREE.GreaterDepth,
    fog: false,
    toneMapped: false,
    stencilWrite: true,
    stencilRef: 1,
    stencilFunc: THREE.NotEqualStencilFunc,
    stencilZPass: THREE.IncrementStencilOp,
  });
}

export { EYE_RADIUS };
