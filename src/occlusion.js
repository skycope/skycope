import * as THREE from "three";

// Hardware occlusion culling for the mesh layer. The mesh layer is bound by
// triangles, not pixels (its cost does not move from full to a tenth of the
// resolution), and from the cat's low follow camera most of the island's
// plant chunks stand behind the ground, boulders and nearer plants: inland
// views submitted 6–9 M triangles, 40–70% of them never seen.
//
// After each frame, every heavy mesh that was drawn or held back is tested:
// its (sway-padded) world box is drawn with colour and depth writes off
// against the finished depth buffer, inside an ANY_SAMPLES_PASSED query. The
// answer arrives a frame or two later; a chunk whose box showed no pixel
// skips the next frames' draws until its box shows one again. Held-back
// meshes move to a layer the camera does not see, so THREE.LOD (which resets
// each level's `visible` every frame) and the rest of the scene are untouched.
// A box the camera stands in, a mesh leaving the frustum and a frame that
// re-renders the sun's shadow map all count as visible.

// Meshes lighter than this are cheaper to draw than to test.
const MIN_TRIANGLES = 4000;
// Held-back meshes live here; the main camera only sees layer 0.
const HIDDEN_LAYER = 6;
// Slack round each box (m), beyond the plants' own sway margin: a chunk
// peeking out by less than this between two query results is not missed.
const PAD = 0.25;
// How far plants sway from their rest pose (forest.js SWAY_MARGIN).
const SWAY = 1.5;

const VERTEX = `#version 300 es
uniform mat4 viewProjection;
uniform vec3 boxMin;
uniform vec3 boxSize;
in vec3 corner;
void main() {
  gl_Position = viewProjection * vec4( boxMin + corner * boxSize, 1.0 );
}`;
const FRAGMENT = `#version 300 es
precision lowp float;
out vec4 colour;
void main() { colour = vec4( 0.0 ); }`;

export function createOcclusion(renderer, scene, camera, { enabled = true } = {}) {
  const gl = renderer.getContext();
  if (!enabled || !(gl instanceof WebGL2RenderingContext)) return { cull() {}, test() {}, reset() {}, dispose() {}, stats: null };

  const program = link(gl);
  const uniforms = {
    viewProjection: gl.getUniformLocation(program, "viewProjection"),
    boxMin: gl.getUniformLocation(program, "boxMin"),
    boxSize: gl.getUniformLocation(program, "boxSize"),
  };
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const corners = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, corners);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1]), gl.STATIC_DRAW);
  const indices = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indices);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint8Array([0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1, 1, 5, 6, 1, 6, 2, 2, 6, 7, 2, 7, 3, 3, 7, 4, 3, 4, 0]), gl.STATIC_DRAW);
  const location = gl.getAttribLocation(program, "corner");
  gl.enableVertexAttribArray(location);
  gl.vertexAttribPointer(location, 3, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  // Per heavy mesh: its world box (static: plants, rocks and ground detail
  // never move), its query in flight and whether it is being held back.
  const entries = new Map();
  let candidates = null;
  const frustum = new THREE.Frustum();
  const viewProjection = new THREE.Matrix4();
  const sphere = new THREE.Sphere();
  const stats = { tested: 0, hidden: 0, hiddenTriangles: 0 };

  function collect() {
    candidates = [];
    scene.traverse((object) => {
      if (!object.isMesh || object.frustumCulled === false || object.isSkinnedMesh) return;
      const geometry = object.geometry;
      const count = geometry.index ? geometry.index.count : geometry.attributes.position?.count ?? 0;
      const triangles = (count / 3) * (object.isInstancedMesh ? object.count : 1);
      if (triangles < MIN_TRIANGLES) return;
      object.updateWorldMatrix(true, false);
      if (object.isInstancedMesh) {
        if (!object.boundingBox) object.computeBoundingBox();
      } else if (!geometry.boundingBox) geometry.computeBoundingBox();
      const box = (object.isInstancedMesh ? object.boundingBox : geometry.boundingBox).clone().applyMatrix4(object.matrixWorld);
      // Plants sway and part round the cat beyond their rest pose.
      box.expandByScalar(PAD + (object.isInstancedMesh ? SWAY : 0));
      // The ground itself: its box always holds the camera.
      if (box.getSize(new THREE.Vector3()).x > 150) return;
      candidates.push(object);
      entries.set(object, { box, triangles, query: null, hidden: false, layers: object.layers.mask });
    });
  }

  function show(object, entry) {
    if (!entry.hidden) return;
    entry.hidden = false;
    object.layers.mask = entry.layers;
  }

  // Before the frame: apply the latest answers.
  function cull() {
    if (!candidates) collect();
    // The sun's shadow map (rarely re-rendered) must see every caster, and it
    // tests the main camera's layers.
    const shadows = renderer.shadowMap.enabled && renderer.shadowMap.needsUpdate;
    stats.hidden = 0;
    stats.hiddenTriangles = 0;
    for (const object of candidates) {
      const entry = entries.get(object);
      if (entry.query && gl.getQueryParameter(entry.query, gl.QUERY_RESULT_AVAILABLE)) {
        entry.visibleResult = gl.getQueryParameter(entry.query, gl.QUERY_RESULT) !== 0;
        entry.free = true;
      }
      const hide = !shadows && entry.visibleResult === false && !entry.inside;
      if (hide && !entry.hidden) {
        entry.hidden = true;
        entry.layers = object.layers.mask;
        object.layers.set(HIDDEN_LAYER);
      } else if (!hide) show(object, entry);
      if (entry.hidden) {
        stats.hidden++;
        stats.hiddenTriangles += entry.triangles;
      }
    }
  }

  // After the frame: ask again, against this frame's depth.
  function test() {
    if (!candidates) return;
    viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(viewProjection);
    const eye = camera.position;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.useProgram(program);
    gl.bindVertexArray(vao);
    gl.colorMask(false, false, false, false);
    gl.depthMask(false);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
    gl.disable(gl.STENCIL_TEST);
    gl.disable(gl.SCISSOR_TEST);
    gl.uniformMatrix4fv(uniforms.viewProjection, false, viewProjection.elements);
    stats.tested = 0;
    for (const object of candidates) {
      const entry = entries.get(object);
      // Only meshes the renderer would draw now: every ancestor visible (the
      // LOD's current level) and in the frustum. Anything else forgets its
      // answer, so it is drawn the moment it comes back.
      if (!drawable(object) || !frustum.intersectsBox(entry.box)) {
        entry.visibleResult = undefined;
        continue;
      }
      entry.inside = entry.box.containsPoint(eye);
      if (entry.inside) {
        entry.visibleResult = true;
        continue;
      }
      if (entry.query && !entry.free) continue;
      entry.query ??= gl.createQuery();
      entry.free = false;
      const { min, max } = entry.box;
      gl.uniform3f(uniforms.boxMin, min.x, min.y, min.z);
      gl.uniform3f(uniforms.boxSize, max.x - min.x, max.y - min.y, max.z - min.z);
      gl.beginQuery(gl.ANY_SAMPLES_PASSED_CONSERVATIVE, entry.query);
      gl.drawElements(gl.TRIANGLES, 36, gl.UNSIGNED_BYTE, 0);
      gl.endQuery(gl.ANY_SAMPLES_PASSED_CONSERVATIVE);
      stats.tested++;
    }
    gl.bindVertexArray(null);
    // Three caches GL state; it rebinds what it needs next frame.
    renderer.resetState();
  }

  // Visible ancestors, ignoring the object's own layer (held back or not).
  function drawable(object) {
    for (let o = object; o; o = o.parent) if (!o.visible) return false;
    const material = object.material;
    return Array.isArray(material) ? material.some((m) => m.visible) : material.visible;
  }

  return {
    cull,
    test,
    stats,
    // A jump cut (home, a resize): draw everything until fresh answers come.
    reset() {
      for (const [object, entry] of entries) {
        show(object, entry);
        entry.visibleResult = undefined;
      }
    },
    // The scene changed shape (meshes added or removed).
    rescan() {
      this.reset();
      candidates = null;
    },
    dispose() {
      for (const [object, entry] of entries) {
        show(object, entry);
        if (entry.query) gl.deleteQuery(entry.query);
      }
      entries.clear();
      gl.deleteBuffer(corners);
      gl.deleteBuffer(indices);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(program);
    },
  };
}

function link(gl) {
  const program = gl.createProgram();
  for (const [type, source] of [[gl.VERTEX_SHADER, VERTEX], [gl.FRAGMENT_SHADER, FRAGMENT]]) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    gl.attachShader(program, shader);
    gl.deleteShader(shader);
  }
  gl.linkProgram(program);
  return program;
}
