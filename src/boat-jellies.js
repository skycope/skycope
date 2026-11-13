import * as THREE from "three";
import { ISLAND, shoreRadius } from "./terrain.js";
import { seededRandom } from "./random.js";

// Somewhere only the boat goes: a smack of moon jellies drifting a few
// metres down, far out past the kelp (~80 m offshore, off the boat's own
// cove). By day they are what a boat sees looking over the side in clear
// water: pale translucent bells, each with its four violet rings, pulsing
// slowly, the deeper ones bluer and softer. By night they glow (cold
// cyan-violet) and the lantern draws them up: the nearer the boat's light,
// the higher they rise and the brighter they answer.
//
// One draw: flat discs laid under the surface, posed in the vertex shader
// from per-jelly seeds and a few uniforms (no buffer uploads); additive,
// so they read as light seen through the water, and they fade where the
// sea would mirror the sky instead. Hidden beyond 75 m.
//
//   createJellies(group, seed, { near }) → { poi, mesh, update({ time, night,
//     eye, lantern }) }   (coast metres; lantern [x, y, z, strength] | null)

export const JELLY_COUNT = 150;
const SPREAD = 24;

export function jelliesPlace(seed, coveTheta) {
  const random = seededRandom((seed ^ 0x7e11) >>> 0 || 1);
  const theta = coveTheta + (random() - 0.5) * 1.1;
  const r = shoreRadius(theta) + 78 + random() * 10;
  return { x: ISLAND.x + Math.cos(theta) * r, z: ISLAND.z + Math.sin(theta) * r, r: SPREAD };
}

const VERTEX = /* glsl */ `
attribute vec2 corner;
attribute vec4 jelly;   // x, z offset in the smack (m), size (m), phase
attribute vec2 drift;   // depth (m), hue
uniform vec3 centre;    // Three world
uniform float time;
uniform vec4 lantern;   // Three world, strength
uniform float night;
varying vec2 vUv2;
varying float vDepth;
varying float vHue;
varying float vPulse;
varying float vLure;
varying float vFacing;
void main() {
  // The quad reaches past the bell for its glow in the water.
  vUv2 = corner * 1.9;
  float t = time;
  // Each drifts on its own slow loop, and the smack as a whole wanders.
  vec2 p = jelly.xy + vec2( sin( t * 0.031 + jelly.w * 6.3 ), cos( t * 0.027 + jelly.w * 4.1 ) ) * 2.4;
  vec3 world = centre + vec3( p.x, 0.0, -p.y );
  float depth = drift.x;
  // Drawn up toward the lantern at night.
  vec3 toL = lantern.xyz - world;
  float lure = lantern.w * night * exp( -dot( toL.xz, toL.xz ) / 70.0 );
  world.xz += toL.xz * 0.12 * lure;
  depth = mix( depth, 0.35 + depth * 0.25, clamp( lure, 0.0, 1.0 ) * 0.8 );
  // The bell's beat: a quick contraction and a slow relaxation.
  float beat = fract( t * 0.55 + jelly.w * 3.7 );
  float squeeze = smoothstep( 0.0, 0.18, beat ) * ( 1.0 - smoothstep( 0.18, 0.9, beat ) );
  vPulse = squeeze;
  float size = jelly.z * ( 1.0 - 0.14 * squeeze );
  world.y = -depth + squeeze * 0.03;
  vDepth = depth;
  vHue = drift.y;
  vLure = lure;
  // A slow turn of each bell.
  float a = jelly.w * 6.28 + t * 0.05 * ( jelly.w - 0.5 );
  vec2 c = vec2( cos( a ) * corner.x - sin( a ) * corner.y, sin( a ) * corner.x + cos( a ) * corner.y );
  world.xz += c * size * 1.9;
  // Seen through the surface: hidden where it would mirror the sky.
  vec3 eye = normalize( cameraPosition - world );
  vFacing = smoothstep( 0.08, 0.45, eye.y );
  gl_Position = projectionMatrix * viewMatrix * vec4( world, 1.0 );
}`;

const FRAGMENT = /* glsl */ `
uniform float night;
uniform float day;
uniform float time;
varying vec2 vUv2;
varying float vDepth;
varying float vHue;
varying float vPulse;
varying float vLure;
varying float vFacing;
void main() {
  // The surface's ripples bend the view down to it.
  vec2 uv = vUv2 + 0.06 * vec2( sin( time * 1.3 + vUv2.y * 3.0 + vHue * 9.0 ), cos( time * 1.1 + vUv2.x * 3.0 ) ) * ( 0.4 + vDepth * 0.3 );
  float r = length( uv );
  if ( r > 1.9 ) discard;
  float a = atan( uv.y, uv.x );
  // Seen through metres of water the edges soften.
  float blur = 0.06 + vDepth * 0.05;
  // The bell: clear in the middle, a brighter scalloped margin, fine
  // radial canals, and four horseshoe gonads round the centre.
  float scallop = 0.97 + 0.012 * sin( a * 16.0 );
  float rim = exp( -pow( ( r - 0.9 * scallop ) / blur, 2.0 ) );
  float body = smoothstep( 1.0 + blur, 0.85 - blur, r ) * 0.25;
  // Light scattered in the water round it.
  float halo = exp( -r * r * 1.6 ) * 0.22;
  float canals = smoothstep( 0.96, 1.0, cos( a * 16.0 ) ) * smoothstep( 0.3, 0.8, r ) * smoothstep( 0.95, 0.8, r ) * 0.18;
  float ring = 0.0;
  for ( int k = 0; k < 4; k++ ) {
    float ang = float( k ) * 1.5708 + 0.785;
    vec2 cc = vec2( cos( ang ), sin( ang ) ) * 0.3;
    float d = length( uv - cc );
    ring = max( ring, exp( -pow( ( d - 0.15 ) / ( 0.035 + blur * 0.5 ), 2.0 ) ) );
  }
  // Deeper: dimmer, bluer, softer.
  float clear = exp( -vDepth * 0.45 );
  vec3 milk = mix( vec3( 0.55, 0.62, 0.7 ), vec3( 0.3, 0.55, 0.75 ), 1.0 - clear );
  vec3 gonad = mix( vec3( 0.62, 0.42, 0.85 ), vec3( 0.85, 0.5, 0.7 ), vHue );
  vec3 dayColour = ( milk * ( body + rim * 0.8 + canals + halo * 0.3 ) + gonad * ring * 0.9 ) * 0.11 * clear;
  // At night, light of their own (cyan at the margin, violet at the
  // rings), answering the lantern.
  vec3 glowColour = vec3( 0.18, 0.75, 1.0 ) * ( rim * 1.2 + canals * 0.8 + body * 0.6 + halo ) + vec3( 0.65, 0.35, 1.0 ) * ring * 0.6;
  float shimmer = 0.75 + 0.25 * sin( time * 2.3 + vHue * 20.0 + r * 6.0 );
  vec3 nightColour = glowColour * ( 0.16 + 0.55 * vPulse + 1.4 * vLure ) * shimmer * mix( 0.35, 1.0, clear );
  vec3 c = dayColour * day + nightColour * night;
  gl_FragColor = vec4( c * vFacing, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function createJellies(group, seed, { coveTheta = 0, light = false } = {}) {
  const place = jelliesPlace(seed, coveTheta);
  const random = seededRandom((seed ^ 0x6e11) >>> 0 || 1);
  const n = light ? Math.round(JELLY_COUNT * 0.6) : JELLY_COUNT;
  const quad = [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]];
  const corners = new Float32Array(n * 12);
  const jelly = new Float32Array(n * 24);
  const drift = new Float32Array(n * 12);
  for (let i = 0; i < n; i++) {
    // Denser toward the middle, in loose drifts.
    const a = random() * Math.PI * 2;
    const r = SPREAD * Math.sqrt(random()) * (0.6 + 0.4 * random());
    const x = Math.cos(a) * r, z = Math.sin(a) * r * 0.7;
    const size = 0.1 + random() * random() * 0.28;
    const phase = random();
    const depth = 0.4 + random() * random() * 6;
    const hue = random();
    for (let k = 0; k < 6; k++) {
      const v = i * 6 + k;
      corners[v * 2] = quad[k][0];
      corners[v * 2 + 1] = quad[k][1];
      jelly.set([x, z, size, phase], v * 4);
      drift.set([depth, hue], v * 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(n * 18), 3));
  geometry.setAttribute("corner", new THREE.Float32BufferAttribute(corners, 2));
  geometry.setAttribute("jelly", new THREE.Float32BufferAttribute(jelly, 4));
  geometry.setAttribute("drift", new THREE.Float32BufferAttribute(drift, 2));
  const uniforms = {
    centre: { value: new THREE.Vector3(place.x, 0, -place.z) },
    time: { value: 0 },
    night: { value: 0 },
    day: { value: 1 },
    lantern: { value: new THREE.Vector4() },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    blendEquationAlpha: THREE.AddEquation,
    blendSrcAlpha: THREE.ZeroFactor,
    blendDstAlpha: THREE.OneFactor,
    toneMapped: true,
    fog: false,
    side: THREE.DoubleSide,
  });
  // In the Three world directly (the shader ignores the model matrix): add
  // it to the scene, not the z-mirrored land group.
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  mesh.renderOrder = 8;
  mesh.visible = false;
  group.add(mesh);
  return {
    mesh,
    poi: { id: "jellies", title: "The lantern jellies", x: place.x, z: place.z, r: 16 },
    place,
    update({ time, night, eye, lantern }) {
      const d = Math.hypot(eye[0] - place.x, eye[2] - place.z);
      mesh.visible = d < SPREAD + 75;
      if (!mesh.visible) return;
      uniforms.time.value = time;
      uniforms.night.value = night;
      uniforms.day.value = 1 - night;
      if (lantern) uniforms.lantern.value.set(lantern[0], lantern[1], -lantern[2], lantern[3]);
      else uniforms.lantern.value.w = 0;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      group.remove(mesh);
    },
  };
}
