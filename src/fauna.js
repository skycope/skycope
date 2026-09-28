import * as THREE from "three";
import { seededRandom } from "./random.js";
import { ISLAND } from "./terrain.js";

// Wildlife as a handful of instanced meshes animated on the CPU (a few
// hundred matrices a frame) with wingbeats in the vertex shader:
// - kelp gulls soaring in loose thermals over the island, flapping now and then;
// - Cape cormorants, black and fast, skimming the sea in long lines;
// - a dolphin pod porpoising offshore, clipped at the sea surface so only
//   the arcs above water show (the WebGPU sea is drawn underneath).
// Coordinates are coast metres; the land group mirrors z like forest.js.
export function createFauna(group, seed) {
  const random = seededRandom(seed ^ 0x51ed270b);
  const shared = { time: { value: 0 } };
  const gulls = flock(group, shared, {
    count: 26,
    body: 0.45,
    span: 1.25,
    colour: [0.86, 0.87, 0.86],
    wing: [0.62, 0.64, 0.66],
    tip: [0.05, 0.05, 0.06],
    flapRate: 5.5,
  });
  const cormorants = flock(group, shared, {
    count: 18,
    body: 0.5,
    span: 0.95,
    colour: [0.03, 0.03, 0.035],
    wing: [0.04, 0.04, 0.045],
    tip: [0.02, 0.02, 0.02],
    flapRate: 9,
  });
  const dolphins = pod(group);

  const gullPaths = Array.from({ length: gulls.count }, () => ({
    centre: new THREE.Vector2(
      ISLAND.x + (random() - 0.5) * 120,
      ISLAND.z + (random() - 0.5) * 120,
    ),
    radius: 8 + random() * 22,
    height: 14 + random() * 26,
    speed: (0.15 + random() * 0.12) * (random() < 0.5 ? -1 : 1),
    phase: random() * Math.PI * 2,
    drift: random() * 100,
    flapBias: random(),
  }));
  // Cormorants fly in lines along a great offshore loop.
  const lineOffset = random() * Math.PI * 2;
  const pods = Array.from({ length: 5 }, (_, i) => ({
    angle: random() * Math.PI * 2,
    radius: 92 + random() * 30,
    phase: i * 1.3 + random(),
  }));

  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3(1, 1, 1);
  const euler = new THREE.Euler(0, 0, 0, "YXZ");

  return {
    update(time, wind, night) {
      shared.time.value = time;
      // Birds roost at night.
      const visible = night < 0.7;
      gulls.mesh.visible = visible;
      cormorants.mesh.visible = visible;
      if (visible) {
        const drift = new THREE.Vector2(wind[0], -wind[1]).multiplyScalar(0.6);
        for (let i = 0; i < gulls.count; i++) {
          const g = gullPaths[i];
          const a = g.phase + time * g.speed;
          // Thermals drift downwind and wander; the bird banks into the turn.
          const cx = g.centre.x + Math.sin(time * 0.013 + g.drift) * 30 + drift.x * Math.sin(time * 0.01);
          const cz = g.centre.y + Math.cos(time * 0.011 + g.drift) * 30 + drift.y * Math.sin(time * 0.01);
          const x = cx + Math.cos(a) * g.radius;
          const z = cz + Math.sin(a) * g.radius;
          const y = g.height + Math.sin(time * 0.2 + g.drift) * 3;
          const heading = Math.atan2(-Math.sin(a) * Math.sign(g.speed), Math.cos(a) * Math.sign(g.speed));
          euler.set(Math.sin(time * 0.3 + g.drift) * 0.08, heading, -Math.sign(g.speed) * 0.45);
          place(gulls.mesh, i, x, y, z, euler);
          // Mostly soaring: flap in short bursts.
          const burst = Math.sin(time * 0.35 + g.drift * 7) > 0.72 - g.flapBias * 0.2 ? 1 : 0;
          gulls.flap.setX(i, burst);
        }
        gulls.mesh.instanceMatrix.needsUpdate = true;
        gulls.flap.needsUpdate = true;
        let n = 0;
        for (const line of pods) {
          const a = line.angle + time * 0.05 + lineOffset;
          for (let k = 0; k < cormorants.count / pods.length && n < cormorants.count; k++, n++) {
            const along = a - k * 0.035;
            const x = ISLAND.x + Math.cos(along) * line.radius + k * 0.8;
            const z = ISLAND.z + Math.sin(along) * line.radius;
            const y = 1.2 + Math.sin(time * 0.7 + k + line.phase) * 0.25;
            euler.set(0, -Math.atan2(Math.cos(along), -Math.sin(along)) + Math.PI / 2, 0);
            place(cormorants.mesh, n, x, y, z, euler);
            cormorants.flap.setX(n, 1);
          }
        }
        cormorants.mesh.instanceMatrix.needsUpdate = true;
        cormorants.flap.needsUpdate = true;
      }
      // Dolphins: each surfaces on its own breathing cycle, travelling along
      // the pod's slow circuit round the island.
      const podAngle = time * 0.012 + 1.3;
      for (let i = 0; i < dolphins.count; i++) {
        const lane = (i % 3) - 1;
        const cycle = (time * 0.22 + i * 0.37) % 1;
        const t = podAngle - i * 0.012;
        const radius = 108 + lane * 3 + Math.sin(i * 2.1) * 2;
        const x = ISLAND.x + Math.cos(t) * radius;
        const z = ISLAND.z + Math.sin(t) * radius;
        const forward = new THREE.Vector2(-Math.sin(t), Math.cos(t));
        // An arc: rise, leap, dive, then a long stretch underwater.
        const leap = cycle < 0.35 ? Math.sin((cycle / 0.35) * Math.PI) : -1;
        const along = (cycle - 0.175) * 6;
        const y = leap > 0 ? leap * 1.1 - 0.4 : -2;
        // Nose up leaving the water, nose down re-entering (+x rotation dips +z).
        const pitch = cycle < 0.35 ? -Math.cos((cycle / 0.35) * Math.PI) * 0.9 : 0;
        euler.set(pitch, -Math.atan2(forward.y, forward.x) + Math.PI / 2, 0);
        place(dolphins.mesh, i, x + forward.x * along, y, z + forward.y * along, euler);
      }
      dolphins.mesh.instanceMatrix.needsUpdate = true;

      function place(mesh, index, x, y, z, rotation) {
        position.set(x, y, z);
        quaternion.setFromEuler(rotation);
        matrix.compose(position, quaternion, scale);
        mesh.setMatrixAt(index, matrix);
      }
    },
    dispose() {
      for (const m of [gulls.mesh, cormorants.mesh, dolphins.mesh]) {
        m.geometry.dispose();
        m.material.dispose();
        m.dispose();
      }
    },
  };

  function flock(parent, uniforms, spec) {
    const geometry = birdGeometry(spec);
    const flap = new THREE.InstancedBufferAttribute(new Float32Array(spec.count), 1);
    geometry.setAttribute("flapping", flap);
    const phases = new Float32Array(spec.count).map(() => random() * 6.28);
    geometry.setAttribute("phase", new THREE.InstancedBufferAttribute(phases, 1));
    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.8,
      side: THREE.DoubleSide,
    });
    material.onBeforeCompile = (shader) => {
      shader.uniforms.time = uniforms.time;
      shader.vertexShader = shader.vertexShader
        .replace(
          "void main() {",
          `uniform float time;
          attribute float flapping;
          attribute float phase;
          attribute float span;
          void main() {`,
        )
        .replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
          // Wingbeat: rotate each wing about the body axis, more at the tip.
          float beat = sin( time * ${spec.flapRate.toFixed(1)} + phase );
          float angle = mix( 0.12 + 0.04 * sin( time * 0.7 + phase ), beat * 0.75, flapping );
          float reach = abs( span );
          transformed.y += sin( angle ) * reach * ( 1.0 + reach * 0.6 );
          transformed.x *= mix( 1.0, cos( angle ), step( 0.01, reach ) );`,
        );
    };
    const mesh = new THREE.InstancedMesh(geometry, material, spec.count);
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    parent.add(mesh);
    return { mesh, flap, count: spec.count };
  }

  function pod(parent) {
    const geometry = dolphinGeometry();
    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.35,
      metalness: 0,
      side: THREE.DoubleSide,
      // Only the parts above the sea surface are drawn.
      clippingPlanes: [new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)],
    });
    const count = 7;
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.frustumCulled = false;
    parent.add(mesh);
    return { mesh, count };
  }
}

// A gull/cormorant silhouette facing +z: a spindle body, a tail fan, and two
// swept wings in two segments each (the "span" attribute drives the beat).
function birdGeometry(spec) {
  const positions = [];
  const colours = [];
  const spans = [];
  const push = (p, c, s) => {
    positions.push(...p);
    colours.push(...c);
    spans.push(s);
  };
  const L = spec.body;
  const S = spec.span;
  const tri = (a, b, c, colour, sa = 0, sb = 0, sc = 0) => {
    push(a, colour, sa);
    push(b, colour, sb);
    push(c, colour, sc);
  };
  const body = spec.colour;
  // Body: a diamond-section spindle.
  const nose = [0, 0, L * 0.55];
  const tail = [0, 0, -L * 0.45];
  const ring = [
    [L * 0.08, 0, 0],
    [0, L * 0.07, 0],
    [-L * 0.08, 0, 0],
    [0, -L * 0.08, 0],
  ];
  for (let i = 0; i < 4; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % 4];
    tri(nose, a, b, i === 3 || i === 2 ? body : body.map((v) => v * 0.92));
    tri(tail, b, a, body);
  }
  // Tail fan.
  tri([0, 0, -L * 0.35], [L * 0.12, 0, -L * 0.62], [-L * 0.12, 0, -L * 0.62], spec.wing);
  // Wings: inner (arm) and outer (hand) panels, swept back.
  for (const side of [-1, 1]) {
    const root0 = [side * L * 0.06, 0.01, L * 0.12];
    const root1 = [side * L * 0.06, 0.01, -L * 0.12];
    const elbow0 = [side * S * 0.25, 0.02, L * 0.1];
    const elbow1 = [side * S * 0.25, 0.02, -L * 0.14];
    const tip = [side * S * 0.5, 0.0, -L * 0.25];
    tri(root0, elbow0, root1, spec.wing, 0, side * 0.25, 0);
    tri(root1, elbow0, elbow1, spec.wing, 0, side * 0.25, side * 0.25);
    tri(elbow0, tip, elbow1, spec.tip, side * 0.25, side * 0.5, side * 0.25);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colours.map((c) => Math.pow(c, 2.2)), 3));
  geometry.setAttribute("span", new THREE.Float32BufferAttribute(spans, 1));
  geometry.computeVertexNormals();
  return geometry;
}

// A common dolphin: a lathed body (beak, melon, tapering tail stock) with a
// dorsal fin, flippers and flukes. Dark grey back, pale belly.
function dolphinGeometry() {
  const profile = [];
  const length = 2.2;
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    const r =
      t < 0.08
        ? 0.04 + t * 0.6
        : 0.25 * Math.pow(Math.sin(Math.PI * Math.min(1, (t - 0.02) / 0.98)), 0.7) * (1 - t * 0.55) + 0.02;
    profile.push(new THREE.Vector2(r, (0.5 - t) * length));
  }
  const body = new THREE.LatheGeometry(profile, 12);
  body.rotateX(Math.PI / 2);
  const fin = new THREE.BufferGeometry();
  fin.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      [
        0, 0.2, 0.15, 0, 0.2, -0.3, 0, 0.55, -0.35,
        // flukes
        0, 0, -1.05, 0.38, 0, -1.25, 0.12, 0, -1.05,
        0, 0, -1.05, -0.12, 0, -1.05, -0.38, 0, -1.25,
        // flippers
        0.18, -0.1, 0.35, 0.45, -0.22, 0.05, 0.2, -0.12, 0.15,
        -0.18, -0.1, 0.35, -0.2, -0.12, 0.15, -0.45, -0.22, 0.05,
      ],
      3,
    ),
  );
  const merged = mergeTo(body, fin);
  const p = merged.attributes.position;
  const colours = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const back = THREE.MathUtils.smoothstep(p.getY(i), -0.08, 0.1);
    const c = 0.35 + (0.012 - 0.35) * back;
    colours.set([c * 0.95, c, c * 1.05], i * 3);
  }
  merged.setAttribute("color", new THREE.BufferAttribute(colours, 3));
  merged.computeVertexNormals();
  return merged;
}

function mergeTo(a, b) {
  const ga = a.index ? a.toNonIndexed() : a;
  const pa = ga.attributes.position.array;
  const pb = b.attributes.position.array;
  const merged = new THREE.BufferGeometry();
  const all = new Float32Array(pa.length + pb.length);
  all.set(pa);
  all.set(pb, pa.length);
  merged.setAttribute("position", new THREE.BufferAttribute(all, 3));
  return merged;
}
