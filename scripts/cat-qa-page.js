// In-page half of scripts/cat-qa.mjs (evaluated in `/?perf` pages, where
// window.skycope exposes the landscape's renderer, scene and camera).
//
// Installs window.catQA:
//   sample()  renders the current frame four ways off screen and returns,
//             per part of the cat (torso, head, four legs, tail), how many
//             pixels it should show (unoccluded, depth-tested against the
//             scene) and how many of those the real frame actually changes.
//             A part whose pixels are expected but not drawn is "missing".
//             Also flags non-finite bone matrices and the near plane.
//   shot(view) renders the scene from a camera placed round the cat (side,
//             front, rear, top, follow, face, thighs) into an sRGB image.
//   sheet(cells, cols, title) composes shots into one PNG data URL.
(() => {
  const THREE = window.__THREE;
  const L = window.skycope.landscape;
  const { renderer, scene } = L;
  const catRoot = scene.getObjectByName("cat");
  const debug = catRoot.userData.debug;
  const PARTS = ["torso", "head", "lf", "rf", "lh", "rh", "tail"];
  const PALETTE = [
    [1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 0], [1, 0, 1], [0, 1, 1], [1, 0.5, 0],
  ];
  const partOfBone = (name) => {
    if (/^tail/.test(name)) return 6;
    if (/^(neck|head|jaw|ear)/.test(name)) return 1;
    for (const [i, leg] of ["lf", "rf", "lh", "rh"].entries()) if (name.startsWith(leg) && !/Scapula/.test(name)) return 2 + i;
    return 0;
  };
  const body = () => debug.meshes[0];
  const bones = () => body().skeleton.bones;
  const partTable = () => bones().map((b) => partOfBone(b.name));

  // Flat part colours from each vertex's strongest bone (skinIndex.x: the
  // weights are sorted, cat-body.js bake).
  const idMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, fog: false });
  idMaterial.onBeforeCompile = (shader) => {
    shader.uniforms.partOf = { value: new Float32Array(64) };
    shader.uniforms.palette = { value: PALETTE.map((c) => new THREE.Vector3(...c)) };
    idMaterial.userData.shader = shader;
    shader.vertexShader = shader.vertexShader
      .replace("void main() {", "uniform float partOf[ 64 ];\nuniform vec3 palette[ 7 ];\nflat out vec3 vPart;\nvoid main() {")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\n vPart = palette[ int( partOf[ int( skinIndex.x ) ] + 0.5 ) ];");
    shader.fragmentShader = shader.fragmentShader
      .replace("void main() {", "flat in vec3 vPart;\nvoid main() {")
      .replace("#include <dithering_fragment>", "#include <dithering_fragment>\n gl_FragColor = vec4( vPart, 1.0 );");
  };
  idMaterial.customProgramCacheKey = () => "cat-qa-id";

  let rt = null;
  const target = (w, h) => {
    if (!rt || rt.width !== w || rt.height !== h) {
      rt?.dispose();
      rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.FloatType, depthBuffer: true, stencilBuffer: true });
    }
    return rt;
  };
  const whiskers = () => {
    const out = [];
    catRoot.traverse((o) => o.isLineSegments && out.push(o));
    return out;
  };

  function renderInto(t, camera, buffer) {
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(t);
    renderer.clear(true, true, true);
    renderer.render(scene, camera);
    renderer.readRenderTargetPixels(t, 0, 0, t.width, t.height, buffer);
    renderer.setRenderTarget(previous);
  }

  function sample({ scale = 0.5 } = {}) {
    const camera = L.camera;
    const canvas = renderer.domElement;
    const w = Math.max(64, Math.round(canvas.width * scale));
    const h = Math.max(64, Math.round(canvas.height * scale));
    const t = target(w, h);
    const n = w * h * 4;
    const A = new Float32Array(n), B = new Float32Array(n), C = new Float32Array(n), D = new Float32Array(n);
    const [coat, shells, ghost] = debug.meshes;
    const wh = whiskers();
    const saved = { coatMat: coat.material, coatOrder: coat.renderOrder, vis: [coat, shells, ghost, ...wh].map((m) => m.visible), autoClear: renderer.autoClear, layers: camera.layers.mask };
    renderer.autoClear = false;
    try {
      // A: the real frame (without the see-through silhouette).
      ghost.visible = false;
      renderInto(t, camera, A);
      // B: the frame without the cat.
      coat.visible = shells.visible = false;
      wh.forEach((m) => (m.visible = false));
      renderInto(t, camera, B);
      // C: the cat as flat part colours, opaque, depth-tested against the scene.
      coat.visible = true;
      coat.material = idMaterial;
      coat.renderOrder = 0;
      if (idMaterial.userData.shader) idMaterial.userData.shader.uniforms.partOf.value.set(partTable());
      renderInto(t, camera, C);
      if (!idMaterial.userData.shader) return { retry: true };
      idMaterial.userData.shader.uniforms.partOf.value.set(partTable());
      renderInto(t, camera, C);
      // D: the cat alone (no occluders).
      coat.layers.set(7);
      camera.layers.set(7);
      renderInto(t, camera, D);
    } finally {
      coat.layers.set(0);
      camera.layers.mask = saved.layers;
      coat.material = saved.coatMat;
      coat.renderOrder = saved.coatOrder;
      [coat, shells, ghost, ...wh].forEach((m, i) => (m.visible = saved.vis[i]));
      renderer.autoClear = saved.autoClear;
    }
    const idOf = (buf, i) => {
      if (buf[i + 3] < 0.5) return -1;
      for (let p = 0; p < PALETTE.length; p++) {
        const c = PALETTE[p];
        if (Math.abs(buf[i] - c[0]) < 0.02 && Math.abs(buf[i + 1] - c[1]) < 0.02 && Math.abs(buf[i + 2] - c[2]) < 0.02) return p;
      }
      return -1;
    };
    const visible = new Array(7).fill(0), drawn = new Array(7).fill(0), alone = new Array(7).fill(0);
    for (let i = 0; i < n; i += 4) {
      const a = idOf(D, i);
      if (a >= 0) alone[a]++;
      const p = idOf(C, i);
      if (p < 0) continue;
      visible[p]++;
      const d = Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]) + Math.abs(A[i + 3] - B[i + 3]);
      if (d > 2e-3) drawn[p]++;
    }
    // Rig sanity: every bone matrix finite; the nearest bone to the lens.
    let finite = true;
    let nearest = Infinity;
    const p = new THREE.Vector3();
    for (const b of bones()) {
      if (!b.matrixWorld.elements.every(Number.isFinite)) finite = false;
      nearest = Math.min(nearest, p.setFromMatrixPosition(b.matrixWorld).distanceTo(camera.position));
    }
    const parts = {};
    const missing = [];
    PARTS.forEach((name, i) => {
      parts[name] = { alone: alone[i], visible: visible[i], drawn: drawn[i] };
      if (visible[i] >= 30 && drawn[i] / visible[i] < 0.75) missing.push(`${name} ${drawn[i]}/${visible[i]}`);
      // Visible alone but gone from the depth-tested ID pass while the rest
      // of the cat shows: occluded (fine) or depth-fighting/clipped (not).
    });
    const cat = window.skycope.walker.cat;
    return {
      parts, missing, finite, nearest: +nearest.toFixed(3), near: camera.near,
      material: debug.meshes[0].material.customProgramCacheKey?.() ?? "",
      pose: { sit: +cat.sit.toFixed(2), speed: +cat.speed.toFixed(2), air: +cat.air.toFixed(3), swim: +cat.swim.toFixed(2), wade: +cat.wade.toFixed(2), water: +cat.water.toFixed(3) },
    };
  }

  // ---------------------------------------------------------------------
  // Sheets: tone-mapped sRGB renders from cameras placed round the cat.
  let shotTarget = null;
  const shotCamera = new THREE.PerspectiveCamera(20, 1, 0.02, 400);
  function shot({ view = "side", size = 360, fov = 9, distance = null, background = null, aim = null } = {}) {
    if (!shotTarget || shotTarget.width !== size) {
      shotTarget?.dispose();
      shotTarget = new THREE.WebGLRenderTarget(size, size, { depthBuffer: true, stencilBuffer: true });
      shotTarget.texture.colorSpace = THREE.SRGBColorSpace;
      shotTarget.isXRRenderTarget = true;
    }
    catRoot.updateMatrixWorld(true);
    const b = Object.fromEntries(bones().map((x) => [x.name, x]));
    const centre = new THREE.Vector3().setFromMatrixPosition(b.spine.matrixWorld);
    const q = new THREE.Quaternion();
    catRoot.getWorldQuaternion(q);
    // The cat's yaw only (its pitch and roll stay visible in the shot).
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    fwd.y = 0;
    fwd.normalize();
    const left = new THREE.Vector3(0, 1, 0).cross(fwd).normalize();
    const up = new THREE.Vector3(0, 1, 0);
    const dir = {
      side: left.clone(),
      right: left.clone().negate(),
      front: fwd.clone(),
      rear: fwd.clone().negate(),
      top: up.clone().addScaledVector(fwd, -0.001),
      follow: fwd.clone().negate().multiplyScalar(Math.cos(0.38)).addScaledVector(up, Math.sin(0.38)),
      quarter: fwd.clone().add(left).normalize().multiplyScalar(Math.cos(0.25)).addScaledVector(up, Math.sin(0.25)),
      face: fwd.clone().multiplyScalar(Math.cos(0.08)).addScaledVector(up, Math.sin(0.08)).addScaledVector(left, 0.25).normalize(),
      thighs: fwd.clone().negate().multiplyScalar(0.8).addScaledVector(up, -0.05).addScaledVector(left, 0.6).normalize(),
      under: fwd.clone().negate().multiplyScalar(0.9).addScaledVector(up, 0.12).normalize(),
    }[view];
    let look = centre.clone();
    if (aim === "head" || view === "face") look = new THREE.Vector3().setFromMatrixPosition(b.head.matrixWorld);
    if (aim === "hips" || view === "thighs" || view === "under") look = new THREE.Vector3().setFromMatrixPosition(b.hips.matrixWorld).addScaledVector(up, -0.08);
    if (aim && typeof aim === "object") look = new THREE.Vector3(...aim);
    const span = view === "face" ? 0.22 : view === "thighs" || view === "under" ? 0.42 : 0.95;
    const d = distance ?? span / 2 / Math.tan((fov * Math.PI) / 360);
    shotCamera.fov = fov;
    shotCamera.aspect = 1;
    shotCamera.position.copy(look).addScaledVector(dir, d);
    shotCamera.up.set(0, 1, 0);
    if (view === "top") shotCamera.up.copy(fwd);
    shotCamera.lookAt(look);
    shotCamera.near = Math.max(0.02, d - 3);
    shotCamera.far = d + 60;
    shotCamera.updateProjectionMatrix();
    shotCamera.updateMatrixWorld();
    const saved = { bg: scene.background, autoClear: renderer.autoClear, target: renderer.getRenderTarget() };
    if (background) scene.background = new THREE.Color(background);
    renderer.autoClear = true;
    renderer.setRenderTarget(shotTarget);
    renderer.render(scene, shotCamera);
    const px = new Uint8Array(size * size * 4);
    renderer.readRenderTargetPixels(shotTarget, 0, 0, size, size, px);
    renderer.setRenderTarget(saved.target);
    renderer.autoClear = saved.autoClear;
    scene.background = saved.bg;
    // Flip rows (GL is bottom-up); transparent pixels on a mid grey.
    const img = new ImageData(size, size);
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const s = ((size - 1 - y) * size + x) * 4, o = (y * size + x) * 4;
        const a = px[s + 3] / 255;
        for (let k = 0; k < 3; k++) img.data[o + k] = px[s + k] + (1 - a) * 128;
        img.data[o + 3] = 255;
      }
    return img;
  }

  function sheet(cells, cols, title = "") {
    const size = cells[0].img.width;
    const rows = Math.ceil(cells.length / cols);
    const head = title ? 28 : 0;
    const c = document.createElement("canvas");
    c.width = cols * size;
    c.height = rows * (size + 18) + head;
    const g = c.getContext("2d");
    g.fillStyle = "#222";
    g.fillRect(0, 0, c.width, c.height);
    g.font = "14px sans-serif";
    g.fillStyle = "#eee";
    if (title) g.fillText(title, 8, 19);
    cells.forEach(({ img, label }, i) => {
      const x = (i % cols) * size, y = head + Math.floor(i / cols) * (size + 18);
      g.putImageData(img, x, y);
      g.fillStyle = "#eee";
      g.fillText(label, x + 6, y + size + 14);
    });
    return c.toDataURL("image/png");
  }

  // Silhouette widths from straight above, along the body (cat-sized
  // metres, before CAT_SCALE): for the shoulders / waist / hips check.
  function topProfile() {
    const size = 400;
    const fov = 9;
    const img = shot({ view: "top", size, fov, background: 0xff00ff });
    const span = 0.95;
    const metresPerPx = span / size / window.__CAT_SCALE;
    const rows = [];
    // Rows run along the body (up = forward in the top shot).
    for (let y = 0; y < size; y++) {
      let lo = -1, hi = -1;
      for (let x = 0; x < size; x++) {
        const o = (y * size + x) * 4;
        const bg = img.data[o] > 200 && img.data[o + 1] < 60 && img.data[o + 2] > 200;
        if (!bg) {
          if (lo < 0) lo = x;
          hi = x;
        }
      }
      rows.push(lo < 0 ? 0 : (hi - lo + 1) * metresPerPx);
    }
    return { rows, metresPerPx, size };
  }

  window.catQA = { sample, shot, sheet, topProfile, PARTS };
})();
