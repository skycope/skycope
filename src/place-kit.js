import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { patchMaterial } from "./forest.js";

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
// anchorHeight (ground height for contact shading; rock material).
export function part(geometry, { matrix = null, colour = 0xffffff, shade = 0, anchor = 0 } = {}) {
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
  }
  g.setAttribute("color", new THREE.BufferAttribute(colours, 3));
  g.setAttribute("canopyShade", new THREE.BufferAttribute(shades, 1));
  g.setAttribute("anchorHeight", new THREE.BufferAttribute(anchors, 1));
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
// the far end. Returns an indexed geometry with smooth normals.
export function sweep(points, radii, radial = 6, { cap = true, roll = 0, oval = null } = {}) {
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
  return g;
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

export function createMaterials(shared) {
  const lights = { value: 0 };
  const time = shared.breezeTime;
  // Lime-washed masonry and paint: the colour is per vertex (white walls,
  // red cupola, black iron, the green door), the weathering per pixel:
  // limewash wearing thin in patches, grey rain runs down the walls, damp
  // and green algae rising from the ground.
  const paint = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82 });
  patchMaterial(paint, shared);
  extend(paint, "paint", {
    fragment: (s) => s.replace(
      "#include <color_fragment>",
      `#include <color_fragment>
      {
        float px = max( fwidth( vPlace.x ), max( fwidth( vPlace.y ), fwidth( vPlace.z ) ) );
        vec3 n = normalize( ( vec4( vNormal, 0.0 ) * viewMatrix ).xyz );
        float vertical = 1.0 - abs( n.y );
        float bright = smoothstep( 0.3, 0.6, max( diffuseColor.r, max( diffuseColor.g, diffuseColor.b ) ) );
        float patchy = pOctave( vPlace, 0.9, px ) * 0.6 + pOctave( vPlace, 3.1, px ) * 0.4;
        float runs = pOctave( vec3( vPlace.x * 3.0, vPlace.y * 0.22, vPlace.z * 3.0 ), 1.0, px * 3.0 );
        float grain = pOctave( vPlace, 41.0, px );
        // Limewash: patchy coats, thinner and greyer where it has worn.
        diffuseColor.rgb *= 1.0 - bright * ( smoothstep( 0.55, 0.8, patchy ) * 0.12 + ( grain - 0.5 ) * 0.06 );
        // Rain runs: grey streaks down vertical faces.
        diffuseColor.rgb *= 1.0 - vertical * smoothstep( 0.55, 0.85, runs ) * mix( 0.1, 0.22, bright );
        // Rising damp and green algae at the foot of a wall.
        float above = vPlace.y - vPlaceAnchor;
        float damp = ( 1.0 - smoothstep( 0.05, 0.55 + patchy * 0.4, above ) ) * vertical;
        diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 0.55, 0.6, 0.45 ), damp * 0.7 );
        // land-look: old limewash is never one white. Coats of different
        // ages drift from warm cream to a cool grey over a few metres; rain
        // has drawn long grey-brown stains down from every ledge and the
        // gallery; salt bloom and flaking show the darker render beneath;
        // and the foot of each wall, where splash and soil reach, sits in a
        // soft, damp shadow.
        if ( bright > 0.01 ) {
          float drift = pOctave( vPlace * vec3( 0.35, 0.18, 0.35 ), 1.0, px );
          diffuseColor.rgb *= mix( vec3( 1.0 ), mix( vec3( 0.9, 0.92, 0.95 ), vec3( 1.02, 0.97, 0.88 ), drift ), bright );
          float stain = smoothstep( 0.42, 0.8, pOctave( vec3( vPlace.x * 4.5, vPlace.y * 0.12, vPlace.z * 4.5 ), 1.0, px * 4.5 ) )
            * smoothstep( 0.35, 0.75, pOctave( vec3( vPlace.x * 1.3, vPlace.y * 0.5, vPlace.z * 1.3 ) + 5.0, 1.0, px ) );
          diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 0.68, 0.64, 0.58 ), vertical * stain * 0.55 * bright );
          float flake = smoothstep( 0.74, 0.8, patchy + ( grain - 0.5 ) * 0.3 );
          diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.46, 0.43, 0.38 ), flake * 0.6 * bright );
          // A whitewashed wall is bright but not paper: a touch under white.
          diffuseColor.rgb *= mix( 1.0, 0.9, bright );
        }
        float foot = 1.0 - smoothstep( 0.0, 1.1 + patchy * 0.4, above );
        diffuseColor.rgb *= mix( 1.0, 0.62, foot * foot * vertical );
      }`,
    ).replace("void main() {", "varying float vPlaceAnchor;\nvoid main() {"),
    vertex: (s) => s.replace("void main() {", "varying float vPlaceAnchor;\nvoid main() {\n  vPlaceAnchor = anchorHeight;"),
  });

  // Weathered timber: silver-grey sun-bleached wood with grain and checks;
  // below the tide's reach it goes dark and wet, green with weed and crusted
  // with barnacles and black mussels (wrecks), or stays as painted (boats:
  // vertex colour carries the paint, and saturation marks paint).
  // Cut at the sea surface: the water pass behind shows the rest.
  const wood = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, clippingPlanes: [new THREE.Plane(new THREE.Vector3(0, 1, 0), 0.03)] });
  patchMaterial(wood, shared);
  extend(wood, "wood", {
    vertex: (s) => s.replace("void main() {", "varying float vPlaceAnchor;\nvoid main() {\n  vPlaceAnchor = anchorHeight;"),
    fragment: (s) => s.replace("void main() {", "varying float vPlaceAnchor;\nvoid main() {").replace(
      "#include <color_fragment>",
      `#include <color_fragment>
      {
        float px = max( fwidth( vPlace.x ), max( fwidth( vPlace.y ), fwidth( vPlace.z ) ) );
        vec3 n = normalize( ( vec4( vNormal, 0.0 ) * viewMatrix ).xyz );
        // Grain runs along the timber: it streaks the fastest-varying axis
        // least. Ribs are near vertical, planks and keels horizontal.
        vec3 a = abs( n );
        vec3 stretch = a.y > 0.7 ? vec3( 9.0, 1.0, 0.6 ) : vec3( 9.0, 0.7, 9.0 );
        float grain = pOctave( vPlace * stretch, 6.0, px * 6.0 * 9.0 );
        float checks = smoothstep( 0.82, 0.9, pOctave( vPlace * stretch, 14.0, px * 14.0 * 9.0 ) );
        float blotch = pOctave( vPlace, 1.3, px ) * 0.6 + pOctave( vPlace, 4.0, px ) * 0.4;
        float top = max( diffuseColor.r, max( diffuseColor.g, diffuseColor.b ) );
        float painted = smoothstep( 0.18, 0.4, ( top - min( diffuseColor.r, min( diffuseColor.g, diffuseColor.b ) ) ) / max( top, 1e-3 ) );
        diffuseColor.rgb *= 0.82 + grain * mix( 0.36, 0.12, painted ) - checks * 0.3 + ( blotch - 0.5 ) * 0.2;
        // Paint flaking off to grey wood.
        float flake = smoothstep( 0.7, 0.76, blotch + ( grain - 0.5 ) * 0.2 ) * painted;
        diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.2, 0.18, 0.16 ) * ( 0.8 + grain * 0.4 ), flake * 0.8 );
        // The tide's reach: wet, weed and shell below about 0.6 m above
        // the sea, rising a little above the sand where the swash runs.
        float y = vPlace.y + ( blotch - 0.5 ) * 0.3;
        float wet = 1.0 - smoothstep( 0.35, 0.9, y );
        float marine = wet * ( 1.0 - painted );
        diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 0.45, 0.47, 0.42 ), marine );
        float weed = smoothstep( 0.45, 0.7, blotch ) * ( 1.0 - smoothstep( 0.0, 0.5, y ) ) * marine;
        diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.07, 0.11, 0.03 ), weed * 0.85 );
        float shells = smoothstep( 0.72, 0.8, pOctave( vPlace, 28.0, px ) ) * smoothstep( 0.0, 0.25, y ) * ( 1.0 - smoothstep( 0.45, 0.75, y ) ) * marine;
        diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.5, 0.48, 0.44 ), shells * 0.4 );
        float mussels = smoothstep( 0.6, 0.72, pOctave( vPlace, 9.0, px ) ) * ( 1.0 - smoothstep( 0.05, 0.35, y ) ) * marine;
        diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.02, 0.02, 0.025 ), mussels * 0.9 );
        // Contact: sand-scoured and damp where it meets the ground.
        float above = vPlace.y - vPlaceAnchor;
        diffuseColor.rgb *= mix( 0.6, 1.0, smoothstep( 0.0, 0.4, above ) );
      }`,
    ).replace(
      "#include <roughnessmap_fragment>",
      `#include <roughnessmap_fragment>
      roughnessFactor = mix( roughnessFactor, 0.45, 1.0 - smoothstep( 0.1, 0.7, vPlace.y ) );`,
    ),
  });

  // Rusted iron and gnarled bark share a rough, mottled finish.
  const rough = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93 });
  patchMaterial(rough, shared);
  extend(rough, "rough", {
    vertex: (s) => s.replace("void main() {", "varying float vPlaceAnchor;\nvoid main() {\n  vPlaceAnchor = anchorHeight;"),
    fragment: (s) => s.replace("void main() {", "varying float vPlaceAnchor;\nvoid main() {").replace(
      "#include <color_fragment>",
      `#include <color_fragment>
      {
        float px = max( fwidth( vPlace.x ), max( fwidth( vPlace.y ), fwidth( vPlace.z ) ) );
        float coarse = pOctave( vPlace, 1.7, px ) * 0.55 + pOctave( vPlace, 5.3, px ) * 0.45;
        float fine = pOctave( vPlace, 23.0, px );
        // Bark: fissured plates running up the limb (ridges of the vertical
        // noise), grey with pale crustose lichen and darker furrows.
        float ridge = 1.0 - abs( pOctave( vec3( vPlace.x * 7.0, vPlace.y * 1.6, vPlace.z * 7.0 ), 1.0, px * 7.0 ) * 2.0 - 1.0 );
        diffuseColor.rgb *= 0.62 + coarse * 0.5 + ( fine - 0.5 ) * 0.3 + ridge * 0.22;
        float crust = smoothstep( 0.62, 0.7, pOctave( vPlace, 6.1, px ) + ( fine - 0.5 ) * 0.15 );
        float warm = step( diffuseColor.b * 1.6, diffuseColor.r );
        diffuseColor.rgb = mix( diffuseColor.rgb, mix( vec3( 0.42, 0.44, 0.38 ), vec3( 0.2, 0.085, 0.035 ), warm ), crust * mix( 0.3, 0.4, warm ) );
        float above = vPlace.y - vPlaceAnchor;
        diffuseColor.rgb *= mix( 0.55, 1.0, smoothstep( 0.0, 0.5, above ) );
      }`,
    ),
  });

  // Granite in the rocks' own shader (lichen above the spray, the splash
  // band, barnacles and the swash's wet line), for plinths, steps, the pool
  // platform and the cairn's footing.
  const stone = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 });
  patchMaterial(stone, shared, { rock: true });
  stone.customProgramCacheKey = () => "places-stone";

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

  return { paint, wood, rough, stone, glow, foliage, lichen, net, water, lights };
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
