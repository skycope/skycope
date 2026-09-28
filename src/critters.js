import * as THREE from "three";
import { seededRandom } from "./random.js";
import { groundHeight, islandPoint, shoreDistance } from "./terrain.js";

// Small things worth a cat's attention, animated on the CPU (a few dozen
// matrices a frame) with wingbeats and leg scuttles in the vertex shader:
// - butterflies (cabbage whites, painted ladies, blues) visiting fynbos
//   flowers by day, scattering when the cat comes close;
// - fireflies drifting and blinking over the scrub at night;
// - ghost crabs on the beach that sidle about, then bolt and burrow.
// `interest` is the nearest one, for the cat's head (and tail) to follow.
export function createCritters(group, seed, flowers) {
  const random = seededRandom(seed ^ 0x2c1b3c6d);
  const shared = { time: { value: 0 } };
  const spots = flowers.length ? flowers : [{ x: 58, z: 70, h: 1 }];

  // Butterflies.
  const flyCount = 16;
  const flyMesh = new THREE.InstancedMesh(butterflyGeometry(), wingMaterial(shared), flyCount);
  flyMesh.frustumCulled = false;
  const palette = [
    [0.95, 0.94, 0.88],
    [0.92, 0.5, 0.18],
    [0.45, 0.6, 0.95],
    [0.98, 0.84, 0.3],
  ];
  const flies = Array.from({ length: flyCount }, (_, i) => {
    const spot = spots[Math.floor(random() * spots.length)];
    const colour = palette[Math.floor(random() * palette.length)];
    flyMesh.setColorAt(i, new THREE.Color(...colour.map((c) => c ** 2.2)));
    return {
      spot,
      x: spot.x,
      y: groundHeight(spot.x, spot.z) + 0.6,
      z: spot.z,
      phase: random() * 100,
      flee: 0,
      fleeX: 0,
      fleeZ: 0,
      heading: 0,
    };
  });
  group.add(flyMesh);

  // Fireflies: tiny unlit spheres, additive, blinking.
  const glowCount = 40;
  const glowMesh = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.012, 6, 4),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(0.7, 1, 0.35).multiplyScalar(3),
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      fog: false,
    }),
    glowCount,
  );
  glowMesh.frustumCulled = false;
  const glows = Array.from({ length: glowCount }, () => {
    const spot = spots[Math.floor(random() * spots.length)];
    return { spot, phase: random() * 100, rate: 0.3 + random() * 0.5, blink: random() * 10 };
  });
  group.add(glowMesh);

  // Ghost crabs.
  const crabCount = 9;
  const crabMesh = new THREE.InstancedMesh(crabGeometry(), crabMaterial(shared), crabCount);
  crabMesh.frustumCulled = false;
  const crabs = Array.from({ length: crabCount }, () => spawnCrab({}));
  const crabGait = new THREE.InstancedBufferAttribute(new Float32Array(crabCount), 1);
  crabMesh.geometry.setAttribute("scuttle", crabGait);
  group.add(crabMesh);

  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const euler = new THREE.Euler(0, 0, 0, "YXZ");
  const interest = { x: 0, y: 0, z: 0, near: false, kind: "" };

  function spawnCrab(crab) {
    const { x, z } = islandPoint(random() * Math.PI * 2, 1.2 + random() * 3.5);
    return Object.assign(crab, {
      x,
      z,
      heading: random() * Math.PI * 2,
      speed: 0,
      wander: random() * 5,
      state: "idle",
      sink: 0,
      hidden: 0,
    });
  }

  return {
    interest,
    update(dt, time, cat, night) {
      shared.time.value = time;
      let best = Infinity;
      interest.near = false;
      const consider = (x, y, z, kind) => {
        const d = Math.hypot(x - cat.x, z - cat.z);
        if (d < best) {
          best = d;
          interest.x = x;
          interest.y = y;
          interest.z = z;
          interest.kind = kind;
          interest.near = d < 2.2;
        }
      };

      // Butterflies by day: loop between the flowers of their patch.
      const day = night < 0.5;
      flyMesh.visible = day;
      if (day) {
        for (let i = 0; i < flyCount; i++) {
          const f = flies[i];
          const t = time * 0.35 + f.phase;
          let tx = f.spot.x + Math.sin(t * 0.9) * 1.6 + Math.sin(t * 2.3) * 0.4;
          let tz = f.spot.z + Math.cos(t * 0.7) * 1.6 + Math.cos(t * 1.9) * 0.4;
          let ty = groundHeight(tx, tz) + 0.25 + f.spot.h * 0.4 + Math.abs(Math.sin(t * 1.7)) * 0.5;
          const dc = Math.hypot(f.x - cat.x, f.z - cat.z);
          if (dc < 1.1 + cat.speed * 0.3 && f.flee <= 0) {
            f.flee = 3 + random() * 2;
            f.fleeX = (f.x - cat.x) / (dc || 1);
            f.fleeZ = (f.z - cat.z) / (dc || 1);
          }
          if (f.flee > 0) {
            f.flee -= dt;
            tx = f.x + f.fleeX * 2;
            tz = f.z + f.fleeZ * 2;
            ty = Math.max(ty, groundHeight(f.x, f.z) + 1.8);
          }
          // Butterflies bob and jink rather than glide.
          const k = Math.min(1, dt * (f.flee > 0 ? 2.5 : 1.3));
          const nx = f.x + (tx - f.x) * k;
          const nz = f.z + (tz - f.z) * k;
          if (Math.hypot(nx - f.x, nz - f.z) > 1e-4) f.heading = Math.atan2(nx - f.x, nz - f.z);
          f.x = nx;
          f.z = nz;
          f.y += (ty + Math.sin(time * 9 + f.phase) * 0.05 - f.y) * k;
          euler.set(Math.sin(time * 3 + f.phase) * 0.3, f.heading, 0);
          place(flyMesh, i, f.x, f.y, f.z, euler, 1);
          consider(f.x, f.y, f.z, "butterfly");
        }
        flyMesh.instanceMatrix.needsUpdate = true;
      }

      // Fireflies at dusk and night.
      glowMesh.visible = night > 0.35;
      if (glowMesh.visible) {
        for (let i = 0; i < glowCount; i++) {
          const g = glows[i];
          const t = time * g.rate + g.phase;
          const x = g.spot.x + Math.sin(t) * 2.2 + Math.sin(t * 2.7) * 0.5;
          const z = g.spot.z + Math.cos(t * 0.8) * 2.2;
          const y = groundHeight(x, z) + 0.4 + Math.sin(t * 1.3) * 0.3 + g.spot.h * 0.3;
          const pulse = Math.max(0, Math.sin(time * 1.6 + g.blink)) ** 6 * night;
          euler.set(0, 0, 0);
          place(glowMesh, i, x, y, z, euler, pulse);
          if (pulse > 0.3) consider(x, y, z, "firefly");
        }
        glowMesh.instanceMatrix.needsUpdate = true;
      }

      // Crabs: sidle, pause, and bolt for a burrow when the cat is close.
      for (let i = 0; i < crabCount; i++) {
        const c = crabs[i];
        if (c.hidden > 0) {
          c.hidden -= dt;
          if (c.hidden <= 0) spawnCrab(c);
          place(crabMesh, i, 0, -50, 0, euler, 0);
          continue;
        }
        const dc = Math.hypot(c.x - cat.x, c.z - cat.z);
        if (c.state !== "burrow" && dc < 1.6 + cat.speed * 0.4) c.state = "bolt";
        c.wander -= dt;
        if (c.state === "idle" && c.wander < 0) {
          c.state = "sidle";
          c.wander = 0.6 + random() * 1.2;
          c.dir = random() < 0.5 ? -1 : 1;
        } else if (c.state === "sidle" && c.wander < 0) {
          c.state = "idle";
          c.wander = 1 + random() * 4;
          c.heading += (random() - 0.5) * 1.2;
        }
        let speed = 0;
        let moveX = Math.cos(c.heading);
        let moveZ = -Math.sin(c.heading);
        if (c.state === "sidle") speed = 0.25 * c.dir;
        if (c.state === "bolt") {
          // Crabs run sideways: turn so the escape line is along the body.
          const ax = (c.x - cat.x) / (dc || 1);
          const az = (c.z - cat.z) / (dc || 1);
          const turn = Math.atan2(-az, ax) - c.heading;
          c.heading += Math.atan2(Math.sin(turn), Math.cos(turn)) * Math.min(1, dt * 6);
          moveX = ax;
          moveZ = az;
          speed = 1.6;
          if (dc > 4.5 || random() < dt * 0.4) {
            c.state = "burrow";
            c.sink = 0;
          }
        }
        if (c.state === "burrow") {
          c.sink += dt * 0.6;
          if (c.sink > 0.06) {
            c.hidden = 15 + random() * 20;
          }
        }
        const nx = c.x + moveX * speed * dt;
        const nz = c.z + moveZ * speed * dt;
        if (shoreDistance(nx, nz) > 0.8 && shoreDistance(nx, nz) < 7) {
          c.x = nx;
          c.z = nz;
        } else if (c.state === "bolt") c.state = "burrow";
        crabGait.setX(i, Math.abs(speed) > 0 ? 1 : 0);
        euler.set(0, c.heading, 0);
        place(crabMesh, i, c.x, groundHeight(c.x, c.z) + 0.018 - c.sink, c.z, euler, 1);
        consider(c.x, groundHeight(c.x, c.z), c.z, "crab");
      }
      crabMesh.instanceMatrix.needsUpdate = true;
      crabGait.needsUpdate = true;
      return best < 6 ? interest : null;

      function place(mesh, index, x, y, z, rotation, s) {
        position.set(x, y, z);
        quaternion.setFromEuler(rotation);
        scale.setScalar(s);
        matrix.compose(position, quaternion, scale);
        mesh.setMatrixAt(index, matrix);
      }
    },
    dispose() {
      for (const m of [flyMesh, glowMesh, crabMesh]) {
        m.geometry.dispose();
        m.material.dispose();
        m.dispose();
      }
    },
  };
}

function wingMaterial(shared) {
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, side: THREE.DoubleSide });
  material.customProgramCacheKey = () => "butterfly";
  material.onBeforeCompile = (shader) => {
    shader.uniforms.time = shared.time;
    shader.vertexShader = shader.vertexShader
      .replace("void main() {", "uniform float time;\nvoid main() {")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          float seedPhase = instanceMatrix[3].x * 3.1 + instanceMatrix[3].z * 1.7;
        #else
          float seedPhase = 0.0;
        #endif
        // Wings clap up over the back and open flat, fast.
        float flap = 0.2 + 1.1 * ( 0.5 + 0.5 * sin( time * 22.0 + seedPhase ) );
        float side = sign( position.x );
        float reach = abs( position.x );
        transformed.x = side * reach * cos( flap );
        transformed.y += reach * sin( flap );`,
      );
  };
  return material;
}

// Four wing panels either side of a thin body, facing +z, ~6 cm across.
function butterflyGeometry() {
  const p = [];
  const quad = (a, b, c, d) => p.push(...a, ...b, ...c, ...a, ...c, ...d);
  for (const s of [-1, 1]) {
    quad([0.002 * s, 0, 0.012], [0.03 * s, 0, 0.022], [0.034 * s, 0, 0.002], [0.002 * s, 0, 0]);
    quad([0.002 * s, 0, 0], [0.026 * s, 0, -0.004], [0.02 * s, 0, -0.022], [0.002 * s, 0, -0.012]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
  g.computeVertexNormals();
  return g;
}

function crabMaterial(shared) {
  const material = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.62, 0.55, 0.42).convertSRGBToLinear(), roughness: 0.6 });
  material.customProgramCacheKey = () => "crab";
  material.onBeforeCompile = (shader) => {
    shader.uniforms.time = shared.time;
    shader.vertexShader = shader.vertexShader
      .replace("void main() {", "uniform float time;\nattribute float scuttle;\nattribute float leg;\nvoid main() {")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        // Legs cycle in alternating sets as the crab sidles.
        transformed.y += leg * scuttle * max( 0.0, sin( time * 30.0 + leg * 2.4 + position.z * 60.0 ) ) * 0.008;`,
      );
  };
  return material;
}

// A ghost crab: a squarish carapace, stalked eyes and four legs a side. The
// `leg` attribute marks leg vertices for the scuttle.
function crabGeometry() {
  const parts = [];
  const legs = [];
  const add = (geometry, leg) => {
    const g = geometry.toNonIndexed();
    g.deleteAttribute("uv");
    parts.push(g);
    legs.push(new Float32Array(g.attributes.position.count).fill(leg));
  };
  const shell = new THREE.SphereGeometry(1, 12, 8);
  shell.scale(0.024, 0.011, 0.02);
  add(shell, 0);
  for (const s of [-1, 1]) {
    const eye = new THREE.CylinderGeometry(0.0025, 0.002, 0.014, 5);
    eye.translate(s * 0.009, 0.014, 0.015);
    add(eye, 0);
    const claw = new THREE.SphereGeometry(1, 6, 4);
    claw.scale(0.008, 0.005, 0.008);
    claw.translate(s * 0.02, 0.0, 0.02);
    add(claw, 0);
    for (let k = 0; k < 4; k++) {
      const leg = new THREE.BoxGeometry(0.03, 0.003, 0.003);
      leg.rotateZ(s * -0.5);
      leg.translate(s * 0.03, -0.006, 0.012 - k * 0.009);
      add(leg, k % 2 ? 1 : 1.0001);
    }
  }
  const positions = [];
  parts.forEach((g) => positions.push(...g.attributes.position.array));
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  const legAttr = new Float32Array(positions.length / 3);
  let o = 0;
  legs.forEach((l) => {
    legAttr.set(l, o);
    o += l.length;
  });
  geometry.setAttribute("leg", new THREE.BufferAttribute(legAttr, 1));
  geometry.computeVertexNormals();
  return geometry;
}
