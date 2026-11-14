import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { patchMaterial } from "./forest.js";
import { MATERIAL_LINEAR } from "./material-palette.js";

// The landmarks' toolkit: a few geometry helpers (every landmark is built in
// coast metres and merged into one mesh per material, so a whole place is a
// handful of draw calls) and the shared materials. Materials ride on the
// forest's patchMaterial, so fog, aerial perspective, baked sky occlusion
// (`canopyShade`, here used as baked contact shading) and the shared light
// model apply exactly as they do to plants and rocks.

// sRGB-picked colour (real albedos are low; white paint is ~0.75 linear).
export const srgb = (hex) => new THREE.Color(hex);
export const hsl = (h, s, l) => new THREE.Color().setHSL(h, s, l, THREE.SRGBColorSpace);

const _m = new THREE.Matrix4();
const _n = new THREE.Matrix3();
const _p = new THREE.Vector3();
const _v = new THREE.Vector3();
const _c = new THREE.Color();

// One part of a merged mesh: `geometry` (indexed or not), placed by `matrix`,
// coloured by a Color or fn(position, normal, out Color). `shade` (0–1 or
// fn(position, normal)) is baked sky occlusion. `anchor` sets each vertex's
// anchorHeight (ground height for contact shading; rock material). `weep`
// (0–1 or fn(position, normal)): rust weeping from an iron fixture above
// (the kit's weathering).
export function part(geometry, { matrix = null, colour = 0xffffff, shade = 0, anchor = 0, weep = 0 } = {}) {
  let g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  if (geometry.index) geometry.dispose();
  for (const name of Object.keys(g.attributes)) if (name !== "position" && name !== "normal") g.deleteAttribute(name);
  if (!g.attributes.normal) g.computeVertexNormals();
  if (matrix) g.applyMatrix4(matrix);
  const position = g.attributes.position;
  const normal = g.attributes.normal;
  const colours = new Float32Array(position.count * 3);
  const shades = new Float32Array(position.count);
  const anchors = new Float32Array(position.count);
  const weeps = new Float32Array(position.count);
  const fixed = typeof colour === "function" ? null : _c.set(colour).clone();
  for (let i = 0; i < position.count; i++) {
    _p.fromBufferAttribute(position, i);
    _v.fromBufferAttribute(normal, i);
    if (fixed) _c.copy(fixed);
    else colour(_p, _v, _c);
    colours[i * 3] = _c.r;
    colours[i * 3 + 1] = _c.g;
    colours[i * 3 + 2] = _c.b;
    shades[i] = typeof shade === "function" ? shade(_p, _v) : shade;
    anchors[i] = typeof anchor === "function" ? anchor(_p) : anchor;
    weeps[i] = typeof weep === "function" ? weep(_p, _v) : weep;
  }
  g.setAttribute("color", new THREE.BufferAttribute(colours, 3));
  g.setAttribute("canopyShade", new THREE.BufferAttribute(shades, 1));
  g.setAttribute("anchorHeight", new THREE.BufferAttribute(anchors, 1));
  g.setAttribute("placeWeep", new THREE.BufferAttribute(weeps, 1));
  return g;
}

export function merge(parts) {
  const list = parts.filter(Boolean);
  if (!list.length) return null;
  const merged = mergeGeometries(list, false);
  for (const g of list) g.dispose();
  merged.computeBoundingSphere();
  return merged;
}

// A transform: translate, then yaw about y (radians, coast frame), pitch/roll, scale.
export function place(x, y, z, { yaw = 0, pitch = 0, roll = 0, sx = 1, sy = 1, sz = 1 } = {}) {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, roll, "YXZ"));
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(sx, sy, sz));
}

// Matrix that takes local (x along, y up, z across) to a segment from a to b.
export function between(a, b, width = 1, depth = width, roll = 0) {
  const d = new THREE.Vector3().subVectors(b, a);
  const length = d.length();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  if (roll) q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), roll));
  const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
  return new THREE.Matrix4().compose(mid, q, new THREE.Vector3(width, length, depth));
}

// A generalized cylinder along a polyline: rings of `radial` vertices, each
// ring's radius from `radii` (or `[rx, ry]` pairs for an oval section), the
// frame carried along by parallel transport so it never twists. `cap` closes
// the far end. Returns an indexed geometry with smooth normals, or with
// `flat` faceted ones (sawn timber, not a log).
export function sweep(points, radii, radial = 6, { cap = true, roll = 0, oval = null, flat = false } = {}) {
  const n = points.length;
  const positions = [];
  const index = [];
  const tangent = new THREE.Vector3();
  let normal = new THREE.Vector3();
  const binormal = new THREE.Vector3();
  const prevT = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(n - 1, i + 1)];
    tangent.subVectors(b, a).normalize();
    if (i === 0) {
      normal.set(0, 1, 0);
      if (Math.abs(tangent.y) > 0.9) normal.set(1, 0, 0);
      normal.sub(_v.copy(tangent).multiplyScalar(normal.dot(tangent))).normalize();
    } else {
      // Parallel transport: rotate the previous normal by the turn.
      const axis = _v.crossVectors(prevT, tangent);
      const s = axis.length();
      if (s > 1e-6) normal.applyAxisAngle(axis.normalize(), Math.asin(Math.min(1, s)) * (prevT.dot(tangent) < 0 ? -1 : 1));
      normal.sub(_p.copy(tangent).multiplyScalar(normal.dot(tangent))).normalize();
    }
    prevT.copy(tangent);
    binormal.crossVectors(tangent, normal);
    const r = radii[i];
    const ry = Array.isArray(r) ? r[1] : r;
    const rx = Array.isArray(r) ? r[0] : r;
    for (let k = 0; k < radial; k++) {
      const a2 = (k / radial) * Math.PI * 2 + roll;
      const ox = Math.cos(a2) * rx * (oval ? oval[0] : 1);
      const oy = Math.sin(a2) * ry * (oval ? oval[1] : 1);
      positions.push(
        points[i].x + normal.x * ox + binormal.x * oy,
        points[i].y + normal.y * ox + binormal.y * oy,
        points[i].z + normal.z * ox + binormal.z * oy,
      );
    }
  }
  for (let i = 0; i < n - 1; i++)
    for (let k = 0; k < radial; k++) {
      const a = i * radial + k;
      const b = i * radial + ((k + 1) % radial);
      const c = (i + 1) * radial + k;
      const d = (i + 1) * radial + ((k + 1) % radial);
      index.push(a, c, b, b, c, d);
    }
  if (cap) {
    const tip = positions.length / 3;
    const last = points[n - 1];
    positions.push(last.x + tangent.x * 0.01, last.y + tangent.y * 0.01, last.z + tangent.z * 0.01);
    for (let k = 0; k < radial; k++) index.push((n - 1) * radial + k, tip, (n - 1) * radial + ((k + 1) % radial));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  if (!flat) return g;
  const faceted = g.toNonIndexed();
  g.dispose();
  faceted.computeVertexNormals();
  return faceted;
}

// Lathe: profile [[r, y], …] round y. Smooth normals (three's LatheGeometry).
export function lathe(profile, segments = 24, phiStart = 0, phiLength = Math.PI * 2) {
  return new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(Math.max(r, 1e-4), y)), segments, phiStart, phiLength);
}

export function smooth01(a, b, x) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export function hash(x, y = 0, z = 0) {
  const n = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return n - Math.floor(n);
}

// ---- Materials ---------------------------------------------------------------

// Small value noise for the material patches (world space, coast z).
const NOISE_GLSL = /* glsl */ `
varying vec3 vPlace;
float pHash3( vec3 p ) {
  p = fract( p * 0.1031 );
  p += dot( p, p.zyx + 31.32 );
  return fract( ( p.x + p.y ) * p.z );
}
float pNoise3( vec3 p ) {
  vec3 i = floor( p );
  vec3 f = fract( p );
  vec3 u = f * f * ( 3.0 - 2.0 * f );
  return mix(
    mix( mix( pHash3( i ), pHash3( i + vec3( 1, 0, 0 ) ), u.x ), mix( pHash3( i + vec3( 0, 1, 0 ) ), pHash3( i + vec3( 1, 1, 0 ) ), u.x ), u.y ),
    mix( mix( pHash3( i + vec3( 0, 0, 1 ) ), pHash3( i + vec3( 1, 0, 1 ) ), u.x ), mix( pHash3( i + vec3( 0, 1, 1 ) ), pHash3( i + vec3( 1, 1, 1 ) ), u.x ), u.y ),
    u.z );
}
// Fades an octave to its mean once it is finer than ~2 pixels.
float pOctave( vec3 p, float k, float px ) {
  return mix( pNoise3( p * k ), 0.5, smoothstep( 0.2, 0.5, px * k ) );
}
`;

// Chains a fragment/vertex patch after patchMaterial's, with its own cache key.
function extend(material, key, { vertex = null, fragment = null, uniforms = {} } = {}) {
  const base = material.onBeforeCompile;
  material.customProgramCacheKey = () => `places-${key}`;
  material.onBeforeCompile = (shader, renderer) => {
    base?.(shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("void main() {", "varying vec3 vPlace;\nvoid main() {")
      .replace(
        "#include <project_vertex>",
        `#include <project_vertex>
        {
          vec4 placeWorld = vec4( transformed, 1.0 );
          #ifdef USE_INSTANCING
            placeWorld = instanceMatrix * placeWorld;
          #endif
          placeWorld = modelMatrix * placeWorld;
          vPlace = vec3( placeWorld.x, placeWorld.y, -placeWorld.z );
        }`,
      );
    if (vertex) shader.vertexShader = vertex(shader.vertexShader);
    shader.fragmentShader = shader.fragmentShader.replace("void main() {", `${NOISE_GLSL}\nvoid main() {`);
    if (fragment) shader.fragmentShader = fragment(shader.fragmentShader);
  };
  return material;
}

// ---- The material kit --------------------------------------------------------
//
// Five surfaces build every made thing on the island, each one real stuff
// that has stood a few decades by the sea:
//   limewash   whitewashed render and the paint on it (walls, tower, the
//              cupola, doors, sills: the vertex colour says which paint)
//   rubble     dressed and drystone granite, in the rocks' own shader
//              (aprons, steps, footings, the cairn's capstone, the pool shelf)
//   iron       corrugated sheet: red-oxide roofs and the galvanised tank;
//              the corrugation is per pixel (a flat sheet of two triangles)
//   timber     weathered wood: silver above the tide, weed and shell below,
//              painted where the vertex colour is saturated (the boat)
//   rust       wrought and cast iron gone to rust: the boiler, bolts, lamp
//              tin, the beacon's vanes and railings
// and one weathering block (placeWeathering) they share on top of the
// shared grounding term (forest.js: drift, dust, contact, the sea's wet
// band): rain runs down every vertical face; the sea side is salt-greyed
// up to about 1.5 m; rust weeps down from iron fixtures (a part's `weep`).
// Glow (lamps, panes, lanterns) is its own material and is lit only by
// night (places.js update gates `lights`).
// The milkwood's bark, leaves and lichen, the trap netting and the pool's
// water are the other, non-kit materials.

const WEATHER_GLSL = /* glsl */ `
varying float vPlaceWeep;
// n: world normal (three's frame); bright: how pale the albedo is.
vec3 placeWeathering( vec3 albedo, vec3 n, float px, float above, float bright ) {
  float vertical = 1.0 - abs( n.y );
  // Rain runs: long grey streaks down vertical faces.
  float runs = pOctave( vec3( vPlace.x * 3.0, vPlace.y * 0.22, vPlace.z * 3.0 ), 1.0, px * 3.0 );
  albedo *= 1.0 - vertical * smoothstep( 0.55, 0.85, runs ) * mix( 0.08, 0.2, bright );
  // Salt: faces turned to the open sea are greyed and chalky to about
  // 1.5 m above the ground, patchily.
  vec2 seaDir = normalize( vPlace.xz - vec2( 58.0, 70.0 ) + 1e-4 );
  float seaSide = smoothstep( -0.05, 0.6, dot( vec2( n.x, -n.z ), seaDir ) ) * vertical;
  float salt = seaSide * ( 1.0 - smoothstep( 0.3, 1.6, above ) ) * ( 0.55 + 0.45 * pOctave( vPlace, 2.7, px ) );
  float luma = dot( albedo, vec3( 0.3, 0.59, 0.11 ) );
  albedo = mix( albedo, vec3( luma ) * vec3( 0.98, 0.99, 1.0 ) + 0.035, salt * 0.5 );
  // Rust weep: thin orange-brown streaks hanging below iron fixtures.
  float streak = smoothstep( 0.52, 0.82, pOctave( vec3( vPlace.x * 11.0, vPlace.y * 0.3, vPlace.z * 11.0 ), 1.0, px * 11.0 ) );
  albedo = mix( albedo, albedo * vec3( 0.7, 0.5, 0.33 ), vPlaceWeep * streak * vertical * 0.75 );
  return albedo;
}
`;
const WEEP_VERTEX = (s) => s
  .replace("void main() {", "attribute float placeWeep;\nvarying float vPlaceWeep;\nvoid main() {\n  vPlaceWeep = placeWeep;");

export function createMaterials(shared) {
  const lights = { value: 0 };
  const kit = (material, key, fragment, extra = {}) => extend(material, key, {
    vertex: (s) => WEEP_VERTEX(extra.vertex ? extra.vertex(s) : s),
    fragment: (s) => fragment(s.replace("void main() {", `${WEATHER_GLSL}\nvoid main() {`)),
    uniforms: extra.uniforms,
  });
  const preamble = /* glsl */ `
        float px = max( fwidth( vPlace.x ), max( fwidth( vPlace.y ), fwidth( vPlace.z ) ) );
        vec3 n = normalize( ( vec4( vNormal, 0.0 ) * viewMatrix ).xyz );
        float vertical = 1.0 - abs( n.y );
        float above = groundingH;`;

  // Limewash: the colour is per vertex (white walls, red cupola, the green
  // door), the wear per pixel: coats of different ages drifting from warm
  // cream to cool grey, flaking to the grey render beneath, strong paint
  // sun-faded and chalky, and rising damp with green algae at the foot.
  const limewash = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86 });
  patchMaterial(limewash, shared, { grounded: true });
  kit(limewash, "limewash", (s) => s.replace(
    "#include <color_fragment>",
    `#include <color_fragment>
      {${preamble}
        float bright = smoothstep( 0.3, 0.6, max( diffuseColor.r, max( diffuseColor.g, diffuseColor.b ) ) );
        float patchy = pOctave( vPlace, 0.9, px ) * 0.6 + pOctave( vPlace, 3.1, px ) * 0.4;
        float grain = pOctave( vPlace, 41.0, px );
        diffuseColor.rgb *= 1.0 - bright * ( smoothstep( 0.55, 0.8, patchy ) * 0.1 + ( grain - 0.5 ) * 0.06 );
        if ( bright > 0.01 ) {
          float drift = pOctave( vPlace * vec3( 0.35, 0.18, 0.35 ), 1.0, px );
          diffuseColor.rgb *= mix( vec3( 1.0 ), mix( vec3( 0.9, 0.92, 0.95 ), vec3( 1.02, 0.97, 0.88 ), drift ), bright );
          float flake = smoothstep( 0.74, 0.8, patchy + ( grain - 0.5 ) * 0.3 );
          diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.46, 0.43, 0.38 ), flake * 0.55 * bright );
          // Bright but not paper: a touch under white.
          diffuseColor.rgb *= mix( 1.0, 0.9, bright );
        }
        {
          float top = max( diffuseColor.r, max( diffuseColor.g, diffuseColor.b ) );
          float sat = ( top - min( diffuseColor.r, min( diffuseColor.g, diffuseColor.b ) ) ) / max( top, 1e-3 );
          float luma = dot( diffuseColor.rgb, vec3( 0.3, 0.59, 0.11 ) );
          diffuseColor.rgb = mix( diffuseColor.rgb, vec3( luma ) * vec3( 1.04, 1.0, 0.95 ), sat * 0.32 );
          diffuseColor.rgb *= 1.0 - smoothstep( 0.45, 0.85, patchy ) * 0.2 * sat;
        }
        diffuseColor.rgb = placeWeathering( diffuseColor.rgb, n, px, above, bright );
        float damp = ( 1.0 - smoothstep( 0.05, 0.5 + patchy * 0.4, above ) ) * vertical;
        diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 0.58, 0.62, 0.48 ), damp * 0.6 );
      }`,
  ));

  // Corrugated iron: red-oxide roofs and the galvanised tank. The ribs are
  // a per-pixel normal (76 mm pitch) across the sheet: along the ridge on a
  // roof, round the drum on a tank; they fade out once finer than a pixel.
  // Galvanised (unsaturated vertex colour) goes dull grey with white zinc
  // bloom; red oxide fades chalky; both bleed rust down the troughs and
  // along the lower edge.
  const iron = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.0 });
  patchMaterial(iron, shared, { grounded: true });
  kit(iron, "iron", (s) => s.replace(
    "#include <color_fragment>",
    `#include <color_fragment>
      float ironGalv = 0.0;
      {${preamble}
        float top = max( diffuseColor.r, max( diffuseColor.g, diffuseColor.b ) );
        float sat = ( top - min( diffuseColor.r, min( diffuseColor.g, diffuseColor.b ) ) ) / max( top, 1e-3 );
        ironGalv = 1.0 - smoothstep( 0.15, 0.35, sat );
        float blotch = pOctave( vPlace, 1.4, px ) * 0.6 + pOctave( vPlace, 4.3, px ) * 0.4;
        vec3 world = vec3( vPlace.x, vPlace.y, -vPlace.z );
        vec3 across = n.y > 0.3 ? normalize( cross( vec3( 0.0, 1.0, 0.0 ), n ) + 1e-4 ) : vec3( 0.0, 1.0, 0.0 );
        float phase = dot( world, across ) * 82.7;
        float trough = smoothstep( 0.2, 1.0, -sin( phase ) ) * ( 1.0 - smoothstep( 0.3, 0.6, px * 13.0 ) );
        // Red oxide: faded and chalky. Galvanised: grey, zinc-bloomed.
        diffuseColor.rgb = mix( diffuseColor.rgb, vec3( dot( diffuseColor.rgb, vec3( 0.3, 0.59, 0.11 ) ) ) * vec3( 1.06, 0.98, 0.92 ), ( 1.0 - ironGalv ) * 0.25 );
        diffuseColor.rgb *= 0.85 + blotch * 0.3;
        diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.42, 0.43, 0.42 ), ironGalv * smoothstep( 0.6, 0.8, blotch ) * 0.4 );
        // Rust: down the troughs, in blooms, and heaviest low on a sheet.
        float runs = pOctave( vec3( world.x * 6.0, world.y * 0.5, world.z * 6.0 ), 1.0, px * 6.0 );
        float rust = clamp( smoothstep( 0.55, 0.85, runs ) * ( 0.4 + trough * 0.6 ) + smoothstep( 0.72, 0.85, blotch ) * 0.6, 0.0, 1.0 );
        diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.19, 0.085, 0.04 ) * ( 0.8 + blotch * 0.4 ), rust * mix( 0.55, 0.35, ironGalv ) );
        diffuseColor.rgb = placeWeathering( diffuseColor.rgb, n, px, above, 0.0 );
      }`,
  ).replace(
    "#include <normal_fragment_maps>",
    `#include <normal_fragment_maps>
      {
        vec3 nW = normalize( ( vec4( normal, 0.0 ) * viewMatrix ).xyz );
        float px = max( fwidth( vPlace.x ), max( fwidth( vPlace.y ), fwidth( vPlace.z ) ) );
        vec3 world = vec3( vPlace.x, vPlace.y, -vPlace.z );
        vec3 across = abs( nW.y ) > 0.3 ? normalize( cross( vec3( 0.0, 1.0, 0.0 ), nW ) + 1e-4 ) : vec3( 0.0, 1.0, 0.0 );
        float amp = 0.55 * ( 1.0 - smoothstep( 0.3, 0.6, px * 13.0 ) );
        nW = normalize( nW + across * cos( dot( world, across ) * 82.7 ) * amp );
        normal = normalize( ( viewMatrix * vec4( nW, 0.0 ) ).xyz );
      }`,
  ).replace(
    "#include <roughnessmap_fragment>",
    `#include <roughnessmap_fragment>
      roughnessFactor = mix( roughnessFactor, 0.5, ironGalv );`,
  ).replace(
    "#include <metalnessmap_fragment>",
    `#include <metalnessmap_fragment>
      metalnessFactor = ironGalv * 0.35;`,
  ));

  // Weathered timber: silver-grey sun-bleached wood with grain and end
  // checks; below the tide's reach dark, weedy, crusted with barnacles and
  // black mussels; paint (saturated vertex colour) faded and flaking.
  // Cut at the sea surface: the water pass behind shows the rest.
  const timber = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, clippingPlanes: [new THREE.Plane(new THREE.Vector3(0, 1, 0), 0.03)] });
  patchMaterial(timber, shared, { grounded: true });
  kit(timber, "timber", (s) => s.replace(
    "#include <color_fragment>",
    `#include <color_fragment>
      {${preamble}
        vec3 a = abs( n );
        vec3 stretch = a.y > 0.7 ? vec3( 9.0, 1.0, 0.6 ) : vec3( 9.0, 0.7, 9.0 );
        float grain = pOctave( vPlace * stretch, 6.0, px * 6.0 * 9.0 );
        float checks = smoothstep( 0.82, 0.9, pOctave( vPlace * stretch, 14.0, px * 14.0 * 9.0 ) );
        float blotch = pOctave( vPlace, 1.3, px ) * 0.6 + pOctave( vPlace, 4.0, px ) * 0.4;
        float top = max( diffuseColor.r, max( diffuseColor.g, diffuseColor.b ) );
        float painted = smoothstep( 0.18, 0.4, ( top - min( diffuseColor.r, min( diffuseColor.g, diffuseColor.b ) ) ) / max( top, 1e-3 ) );
        diffuseColor.rgb *= 0.82 + grain * mix( 0.36, 0.12, painted ) - checks * 0.3 + ( blotch - 0.5 ) * 0.2;
        diffuseColor.rgb = mix( diffuseColor.rgb, vec3( dot( diffuseColor.rgb, vec3( 0.3, 0.59, 0.11 ) ) ) * vec3( 1.05, 1.0, 0.94 ), painted * 0.3 );
        float flake = smoothstep( 0.7, 0.76, blotch + ( grain - 0.5 ) * 0.2 ) * painted;
        diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.2, 0.18, 0.16 ) * ( 0.8 + grain * 0.4 ), flake * 0.8 );
        // Bare timber above the tide bleaches silver-grey.
        float dryWood = ( 1.0 - painted ) * smoothstep( 0.15, 0.6, vPlace.y + ( blotch - 0.5 ) * 0.3 );
        diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.36, 0.35, 0.32 ) * ( 0.72 + grain * 0.4 + ( blotch - 0.5 ) * 0.3 ), dryWood * 0.75 );
        float y = vPlace.y + ( blotch - 0.5 ) * 0.3;
        float marine = ( 1.0 - smoothstep( 0.35, 0.9, y ) ) * ( 1.0 - painted );
        diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 0.8, 0.82, 0.74 ), marine );
        float weed = smoothstep( 0.45, 0.7, blotch ) * ( 1.0 - smoothstep( 0.0, 0.5, y ) ) * marine;
        diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.07, 0.11, 0.03 ), weed * 0.85 );
        float shells = smoothstep( 0.72, 0.8, pOctave( vPlace, 28.0, px ) ) * smoothstep( 0.0, 0.25, y ) * ( 1.0 - smoothstep( 0.45, 0.75, y ) ) * marine;
        diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.5, 0.48, 0.44 ), shells * 0.4 );
        float mussels = smoothstep( 0.6, 0.72, pOctave( vPlace, 9.0, px ) ) * ( 1.0 - smoothstep( 0.05, 0.35, y ) ) * marine;
        diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.02, 0.02, 0.025 ), mussels * 0.9 );
        diffuseColor.rgb = placeWeathering( diffuseColor.rgb, n, px, above, 0.3 );
      }`,
  ));

  // Rusted iron: dark brown scale with orange blooms where it is still
  // flaking, pitted, near black where wet.
  const rust = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 });
  patchMaterial(rust, shared, { grounded: true });
  kit(rust, "rust", (s) => s.replace(
    "#include <color_fragment>",
    `#include <color_fragment>
      {${preamble}
        float coarse = pOctave( vPlace, 1.7, px ) * 0.55 + pOctave( vPlace, 5.3, px ) * 0.45;
        float fine = pOctave( vPlace, 23.0, px );
        float pits = smoothstep( 0.66, 0.74, pOctave( vPlace, 47.0, px ) );
        diffuseColor.rgb *= 0.7 + coarse * 0.45 + ( fine - 0.5 ) * 0.3 - pits * 0.25;
        float bloom = smoothstep( 0.6, 0.72, pOctave( vPlace, 3.1, px ) + ( fine - 0.5 ) * 0.2 );
        float warm = step( diffuseColor.b * 1.4, diffuseColor.r );
        diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.24, 0.1, 0.035 ), bloom * 0.45 * warm );
        diffuseColor.rgb = placeWeathering( diffuseColor.rgb, n, px, above, 0.0 );
      }`,
  ));

  // Bark (the milkwood): fissured plates running up the limb, grey with
  // pale crustose lichen and dark furrows.
  const bark = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93 });
  patchMaterial(bark, shared, { grounded: true });
  extend(bark, "bark", {
    fragment: (s) => s.replace(
      "#include <color_fragment>",
      `#include <color_fragment>
      {
        float px = max( fwidth( vPlace.x ), max( fwidth( vPlace.y ), fwidth( vPlace.z ) ) );
        float coarse = pOctave( vPlace, 1.7, px ) * 0.55 + pOctave( vPlace, 5.3, px ) * 0.45;
        float fine = pOctave( vPlace, 23.0, px );
        float ridge = 1.0 - abs( pOctave( vec3( vPlace.x * 7.0, vPlace.y * 1.6, vPlace.z * 7.0 ), 1.0, px * 7.0 ) * 2.0 - 1.0 );
        diffuseColor.rgb *= 0.62 + coarse * 0.5 + ( fine - 0.5 ) * 0.3 + ridge * 0.22;
        float crust = smoothstep( 0.62, 0.7, pOctave( vPlace, 6.1, px ) + ( fine - 0.5 ) * 0.15 );
        diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.42, 0.44, 0.38 ), crust * 0.3 );
      }`,
    ),
  });

  // Soil: a levelled pad's graded bank (pad() below). It takes the colour
  // of the ground it was dug from (the ground field: forest.js grounding),
  // trodden a little darker and gritty, so it reads as the island's own
  // ground raised to a level, not as a thing set on it.
  const chroma = (c) => { const l = c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722; return c.map((v) => (v / l).toFixed(3)).join(", "); };
  const soil = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.97 });
  patchMaterial(soil, shared, { grounded: true });
  extend(soil, "soil", {
    fragment: (s) => s.replace(
      "#include <color_fragment>",
      `#include <color_fragment>
      {
        float px = max( fwidth( vPlace.x ), max( fwidth( vPlace.z ), 1e-4 ) );
        vec3 earth = mix( vec3( ${chroma(MATERIAL_LINEAR.litter)} ), vec3( ${chroma(MATERIAL_LINEAR.sand)} ), groundingField.a ) * groundingField.b;
        float grit = pOctave( vPlace, 37.0, px ) * 0.5 + pOctave( vPlace, 9.0, px ) * 0.5;
        float stones = smoothstep( 0.7, 0.78, pOctave( vPlace, 13.0, px ) );
        diffuseColor.rgb = earth * ( 0.86 + grit * 0.22 ) * diffuseColor.rgb;
        diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.2, 0.19, 0.17 ), stones * 0.5 );
      }`,
    ),
  });

  // Rubble: granite in the rocks' own shader (lichen above the spray, the
  // splash band, barnacles and the swash's wet line).
  const rubble = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 });
  patchMaterial(rubble, shared, { rock: true });
  rubble.customProgramCacheKey = () => "places-rubble";

  // Glass that glows: lamp lenses, windows and lanterns. The vertex colour is
  // the light each gives when lit; unlit it is dark, reflective glass.
  const glow = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.12, metalness: 0 });
  patchMaterial(glow, shared);
  extend(glow, "glow", {
    uniforms: { placeLights: lights },
    fragment: (s) => s.replace("void main() {", "uniform float placeLights;\nvoid main() {")
      .replace("#include <color_fragment>", "#include <color_fragment>\n  vec3 lampColour = diffuseColor.rgb;\n  diffuseColor.rgb = vec3( 0.025, 0.028, 0.03 );")
      // A lamp in the room: brighter low and to one side, a curtain's
      // fold or a sash bar here and there.
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
  float roomLight = 0.65 + 0.55 * pNoise3( vPlace * vec3( 2.3, 1.4, 2.3 ) + 7.0 );
  totalEmissiveRadiance += lampColour * placeLights * roomLight;`),
  });

  // Foliage: thin glossy leaves in the forest's own foliage shading.
  const foliage = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, vertexColors: true, side: THREE.DoubleSide });
  patchMaterial(foliage, shared, { sway: true, flutter: 0.03, foliage: true, bent: 0.6 });
  foliage.customProgramCacheKey = () => "places-foliage";

  // Old man's beard (Usnea): pale hanging strands that stir in the wind.
  const lichen = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, vertexColors: true, side: THREE.DoubleSide });
  patchMaterial(lichen, shared);
  extend(lichen, "lichen", {
    vertex: (s) => s.replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>
      {
        // position.y < 0 down the strand; the tip swings most.
        float hang = clamp( -position.y, 0.0, 1.0 );
        vec4 root = vec4( 0.0, 0.0, 0.0, 1.0 );
        #ifdef USE_INSTANCING
          root = instanceMatrix * root;
        #endif
        float phase = root.x * 1.7 + root.z * 1.3;
        float swing = sin( breezeTime * 1.6 + phase ) * 0.6 + sin( breezeTime * 3.7 + phase * 2.3 ) * 0.25;
        transformed.x += swing * hang * hang * ( 0.1 + breezeStrength * 0.25 );
        transformed.z += cos( breezeTime * 1.2 + phase ) * hang * hang * 0.08;
      }`,
    ),
  });

  // Netting and wire mesh: a lattice cut from a solid surface (alpha test
  // so it stays in the opaque pass and casts a netted shadow).
  const net = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide, alphaTest: 0.5 });
  patchMaterial(net, shared);
  extend(net, "net", {
    fragment: (s) => s.replace(
      "#include <alphatest_fragment>",
      `{
        // Mesh about 5 cm: a diamond lattice in world space, faded to a
        // translucent grey once the strands are below a pixel.
        float px = max( fwidth( vPlace.x ), max( fwidth( vPlace.y ), fwidth( vPlace.z ) ) );
        vec2 g = vec2( vPlace.x + vPlace.z + vPlace.y * 0.6, vPlace.x - vPlace.z + vPlace.y * 0.9 ) * 20.0;
        vec2 f = abs( fract( g ) - 0.5 );
        float strand = 1.0 - smoothstep( 0.32, 0.38 + px * 20.0, min( f.x, f.y ) + 0.2 );
        float cover = mix( strand, 0.6, smoothstep( 0.01, 0.03, px ) );
        diffuseColor.a = cover;
      }
      #include <alphatest_fragment>`,
    ),
  });
  net.alphaToCoverage = true;

  // Still pool water: a dark, clear film that mirrors the sky at a glancing
  // angle (Fresnel alpha) and shows the floor straight down; a breath of
  // wind wrinkles it.
  const water = new THREE.MeshStandardMaterial({ color: srgb("#0e2624"), roughness: 0.05, metalness: 0, transparent: true, depthWrite: false });
  patchMaterial(water, shared);
  extend(water, "water", {
    fragment: (s) => s.replace(
      "#include <normal_fragment_maps>",
      `#include <normal_fragment_maps>
      {
        vec2 q = vPlace.xz;
        float t = breezeTime;
        float h = sin( dot( q, vec2( 7.1, 3.3 ) ) + t * 2.1 ) * 0.5 + sin( dot( q, vec2( -4.3, 8.7 ) ) + t * 1.7 ) * 0.5
          + sin( dot( q, vec2( 13.0, -9.0 ) ) - t * 3.3 ) * 0.25;
        h *= 0.0012;
        vec3 dpx = dFdx( -vViewPosition );
        vec3 dpy = dFdy( -vViewPosition );
        vec3 r1 = cross( dpy, normal );
        vec3 r2 = cross( normal, dpx );
        float det = dot( dpx, r1 );
        vec3 grad = sign( det ) * ( dFdx( h ) * r1 + dFdy( h ) * r2 );
        normal = normalize( abs( det ) * normal - grad );
      }`,
    ).replace(
      "#include <lights_fragment_begin>",
      `{
        float facing = abs( dot( normal, normalize( vViewPosition ) ) );
        diffuseColor.a = mix( 0.38, 0.95, pow( 1.0 - facing, 3.0 ) );
      }
      #include <lights_fragment_begin>`,
    ),
  });

  return { limewash, rubble, iron, timber, rust, bark, soil, glow, foliage, lichen, net, water, lights };
}

// Additive glows: unlit, depth-tested, no depth writes, no fog (lights carry
// through haze), toned like everything else.
// Light adds to what is behind it, and leaves the canvas alpha alone: the
// mesh canvas is composited (premultiplied) over the sky canvas, so a beam
// over open sky adds to the sky instead of painting over it.
export function glowMaterial({ colour = [1, 0.85, 0.6], vertex, fragment, uniforms = {} }) {
  return new THREE.ShaderMaterial({
    uniforms: { glowColour: { value: new THREE.Color(...colour) }, ...uniforms },
    vertexShader: vertex,
    fragmentShader: fragment,
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
  });
}

// A static, frozen mesh: matrices composed once.
export function staticMesh(geometry, material, { cast = true, receive = true } = {}) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  return mesh;
}

export { _m as scratchMatrix, _n as scratchNormalMatrix };

// ---- The prop contract ---------------------------------------------------------
//
// Every landmark builder (place-*.js) returns one of these, through prop():
//
//   lod: { near, far = null, farDistance = 45, cullDistance = 0 }
//       near/far: Object3Ds in the place's frame (coast x, z relative to
//       its centre; y absolute). cullDistance > 0 drops it entirely there.
//   surfaces: { trunks = [], tiles = [], solids = [] }
//       trunks: { x, z, r } posts the cat walks round (walker.js);
//       tiles: height tiles it stands on, hops onto, jumps over (heightTile);
//       solids: blockers.js primitives the camera keeps out of (and the
//       cat's body, unless `body: false`).
//   covers: [{ kind, x, z, yaw = 0, hu, hv, y }]  (or { kind, x, z, r, y })
//       shelter: below height y inside the box (half-lengths hu along
//       (sin yaw, cos yaw), hv across) or circle, no rain falls. kind:
//       "roof" | "eave" | "crown". Data for precipitation.js.
//   lights: [{ kind, x, y, z, colour: [r, g, b], size, reach, power, flicker }]
//       kind: "lamp" (the lighthouse's lantern, which carries the beams),
//       "window" (lights the yard only: no halo), "lantern" (a halo too).
//       All lit by night only (places.js gates them).
//   affordances: [{ id, kind, x, y, z, r, facing?, hint? }]
//       Named spots a later src/affordances.js turns into events (walker
//       emits on-top, inside, sat-near, meow-near, bumped, ran-at; props
//       answer). Data only for now. kind:
//         "on-top"   standing on a surface (the hull, the boiler, a sill)
//         "inside"   within a volume (the boiler's furnace, under the crown)
//         "sit-near" sitting within r (the pool rim, the beacon's top step)
//         "meow-near" a meow within r (the lighthouse, the boiler)
//         "perch"    a seat reached by a route (the milkwood fork, a sill)
//       x, y, z: coast metres, y the standing height; r: reach in metres;
//       facing: the radians a seated cat looks (sin, cos); hint: what in
//       the world says the spot is there.
//   update?({ time, night, wind, eye, pose, lit }), extra?, and the
//   place-specific handles (hull, crown) places.js passes on.
export function prop({ lod, surfaces = {}, covers = [], lights = [], affordances = [], ...rest }) {
  if (!lod?.near) throw new Error("prop: lod.near is required");
  for (const a of affordances) {
    if (!["on-top", "inside", "sit-near", "meow-near", "perch"].includes(a.kind)) throw new Error(`prop: affordance kind ${a.kind}`);
    if (![a.x, a.y, a.z, a.r].every(Number.isFinite)) throw new Error(`prop: affordance ${a.id} not finite`);
  }
  return {
    lod: { far: null, farDistance: 45, cullDistance: 0, ...lod },
    surfaces: { trunks: [], tiles: [], solids: [], ...surfaces },
    covers,
    lights,
    affordances,
    ...rest,
  };
}

// ---- Levelled pads -----------------------------------------------------------

// A levelled pad: the ground graded up to a level round a footprint, as a
// builder makes a site on a slope, instead of a podium. The footprint is a
// rounded rectangle (half-lengths hu, hv about (cu, cv) in a place's u, v
// frame; `at(u, v)` → local [x, z]). The bank leaves the footprint's edge
// at `top` and runs straight out over `reach` metres to meet the ground
// exactly (soil material: it takes the ground's own colour). Downhill it
// is a graded fill; uphill it dips under the ground and the hill shows.
// Returns the bank geometry (place-local x, z; y absolute) and its height
// at a local (u, v) for a collision tile (−Infinity off the bank).
export function pad(ground, at, { cu = 0, cv = 0, hu, hv, top, reach = 2.4, rings = 6, segments = 56, k = 6 }) {
  const norm = (u, v) => Math.pow(Math.pow(Math.abs(u) / hu, k) + Math.pow(Math.abs(v) / hv, k), 1 / k);
  const positions = [];
  const index = [];
  const groundUV = (u, v) => ground(...at(u, v));
  const ease = (t) => t * t * (3 - 2 * t);
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    for (let j = 0; j < segments; j++) {
      const a = (j / segments) * Math.PI * 2;
      const c = Math.cos(a), s = Math.sin(a);
      const r = 1 / norm(c, s); // the footprint's edge along this ray
      const d = r + reach * t;
      const u = cu + c * d, v = cv + s * d;
      const g = groundUV(u, v);
      const y = i === rings ? g : top + (g - top) * ease(t);
      const [x, z] = at(u, v);
      positions.push(x, y, z);
    }
  }
  for (let i = 0; i < rings; i++)
    for (let j = 0; j < segments; j++) {
      const a = i * segments + j, b = i * segments + ((j + 1) % segments), c = a + segments, d = b + segments;
      index.push(a, b, c, b, d, c);
    }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  // Normals face up whichever way the rings wind.
  const n = geometry.attributes.normal;
  let up = 0;
  for (let i = 0; i < n.count; i++) up += n.getY(i);
  if (up < 0) { index.reverse(); geometry.setIndex(index); geometry.computeVertexNormals(); }
  return {
    geometry,
    height(u, v) {
      const du = u - cu, dv = v - cv;
      const len = Math.hypot(du, dv);
      if (len < 1e-6) return -Infinity;
      const r = norm(du, dv);
      if (r <= 1) return top;
      const d = len - len / r;
      if (d >= reach) return -Infinity;
      return top + (groundUV(u, v) - top) * ease(d / reach);
    },
  };
}

// ---- Collision tiles ---------------------------------------------------------

// solid: low things as surfaces, not walls. A trunk is a wall of no height
// (the cat met it in mid-air and could never jump over it or onto it); a
// tile is a surface the walker treats like a boulder: walked round, hopped
// onto when low, jumped over, landed on. Coast metres.
// A flat-topped disc (a crayfish trap, a plinth).
export function discTile(x, z, r, top) {
  return heightTile(x, z, r + 0.1, 0.06, (px, pz) => (Math.hypot(px - x, pz - z) <= r ? top : -Infinity));
}
// A round timber lying along a polyline of { x, y, z } (centre line) with
// radius r: its upper surface.
export function timberTile(points, r) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const q of points) { x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); z0 = Math.min(z0, q.z); z1 = Math.max(z1, q.z); }
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const half = Math.max(x1 - x0, z1 - z0) / 2 + r + 0.1;
  return heightTile(cx, cz, half, 0.06, timberHeight(points, r));
}

// The top of a round timber along `points` (radius r) at (x, z), or
// -Infinity off it: a timber tile's surface, exact.
export function timberHeight(points, r) {
  return (px, pz) => {
    let best = -Infinity;
    for (let i = 0; i + 1 < points.length; i++) {
      const a = points[i], b = points[i + 1];
      const dx = b.x - a.x, dz = b.z - a.z;
      const l2 = dx * dx + dz * dz || 1e-9;
      const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (pz - a.z) * dz) / l2));
      const d = Math.hypot(px - a.x - dx * t, pz - a.z - dz * t);
      if (d < r) best = Math.max(best, a.y + (b.y - a.y) * t + Math.sqrt(r * r - d * d));
    }
    return best;
  };
}

// A collision height tile in walker.js's dome format, sampled from fn(x, z)
// (−Infinity where there is nothing to stand on).
export function heightTile(cx, cz, half, cell, fn) {
  const nx = Math.ceil((half * 2) / cell) + 1;
  const nz = nx;
  const x0 = cx - half, z0 = cz - half;
  const heights = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) heights[j * nx + i] = fn(x0 + i * cell, z0 + j * cell);
  // `gradient`: walker.js takes a wall's normal from the tile's own slope,
  // not from its centre (a wall round a yard pointed the cat inside the
  // yard into the wall, and it pushed there for good).
  return { x0, z0, cell, nx, nz, heights, x: cx, z: cz, r: half, gradient: true };
}
