import * as THREE from "three";
import { seededRandom } from "./random.js";
import { groundHeight, islandPoint, shoreDistance } from "./terrain.js";
import { rockLayout } from "./rocks.js";

// Small things worth a cat's attention, animated on the CPU (a few dozen
// matrices a frame) with wingbeats and leg scuttles in the vertex shader:
// - butterflies (cabbage whites, painted ladies, blues) visiting fynbos
//   flowers by day, scattering when the cat comes close;
// - fireflies drifting and blinking over the scrub at night;
// - ghost crabs on the beach that sidle about, then bolt and burrow;
// - kelp gulls standing about at the swash edge, pecking and pacing, that
//   walk off from a cat and take wing if it keeps coming.
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

  // Kelp gulls: a loose party on the wet sand where the swash turns.
  const gullCount = 5;
  const gullMesh = new THREE.InstancedMesh(gullGeometry(), gullMaterial(shared), gullCount);
  gullMesh.frustumCulled = false;
  const gullPeck = new THREE.InstancedBufferAttribute(new Float32Array(gullCount), 1);
  const gullWing = new THREE.InstancedBufferAttribute(new Float32Array(gullCount), 1);
  gullMesh.geometry.setAttribute("peck", gullPeck);
  gullMesh.geometry.setAttribute("wing", gullWing);
  group.add(gullMesh);
  // Along the beach from the home view, where the cat starts: in sight of
  // it, but a walk away.
  // Clear of the boulders: the same layout forest.js draws (its random
  // stream starts with the rocks).
  const boulders = rockLayout(seededRandom(seed)).map((r) => ({ x: r.position.x, z: r.position.z, r: Math.max(r.scale.x, r.scale.z) + 0.6 }));
  const clear = (x, z) => boulders.every((b) => (x - b.x) ** 2 + (z - b.z) ** 2 > b.r * b.r);
  const home = Math.atan2(-70, -52);
  const gullSpot = { theta: home + 0.15 };
  for (let k = 0; k < 40; k++) {
    const theta = home + (k % 2 ? -1 : 1) * (0.1 + k * 0.01);
    const probe = [0, 1, 2].map((j) => islandPoint(theta + (j - 1) * 0.03, 1));
    if (probe.every((q) => clear(q.x, q.z))) { gullSpot.theta = theta; break; }
  }
  const gulls = Array.from({ length: gullCount }, () => landGull({}, gullSpot.theta));

  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const euler = new THREE.Euler(0, 0, 0, "YXZ");
  const interest = { x: 0, y: 0, z: 0, near: false, kind: "" };

  // A gull alights near the party's spot on the shore, facing into the wind
  // more or less, each its own size (females smaller).
  function landGull(gull, theta) {
    let { x, z } = islandPoint(theta, 1);
    for (let k = 0; k < 12; k++) {
      const q = islandPoint(theta + (random() - 0.5) * 0.08, 0.4 + random() * 1.4);
      if (clear(q.x, q.z)) { x = q.x; z = q.z; break; }
    }
    return Object.assign(gull, {
      x, z, y: groundHeight(x, z),
      heading: random() * Math.PI * 2,
      state: "idle",
      timer: 1 + random() * 3,
      peck: 0,
      pecking: 0,
      size: 0.9 + random() * 0.2,
      vx: 0, vz: 0, vy: 0,
      flight: 0,
      away: 0,
    });
  }

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

      // Gulls: peck, look about and pace; step away from a cat at a few
      // metres, and take off, fly low along the shore and alight farther
      // on if it keeps coming. They roost elsewhere at night.
      gullMesh.visible = night < 0.6;
      if (gullMesh.visible) {
        for (let i = 0; i < gullCount; i++) {
          const g = gulls[i];
          const dc = Math.hypot(g.x - cat.x, g.z - cat.z);
          const ax = (g.x - cat.x) / (dc || 1);
          const az = (g.z - cat.z) / (dc || 1);
          g.timer -= dt;
          if (g.state !== "fly") {
            if (dc < 2.2 + cat.speed * 0.5) {
              // Too close: up and away, low along the shore.
              g.state = "fly";
              g.flight = 0;
              const along = Math.atan2(g.z - 70, g.x - 58);
              const side = Math.sign(Math.sin(along) * ax * -1 + Math.cos(along) * az) || 1;
              g.away = along + side * (0.25 + random() * 0.2);
              g.vy = 2.2;
            } else if (dc < 4.5) {
              g.state = "walk";
              g.heading = Math.atan2(ax, az);
              g.timer = 0.6;
            } else if (g.timer < 0) {
              const r = random();
              g.state = r < 0.35 ? "walk" : "idle";
              if (g.state === "walk") g.heading += (random() - 0.5) * 2.4;
              g.timer = g.state === "walk" ? 0.8 + random() * 1.5 : 1.5 + random() * 4;
            }
          }
          let speed = 0;
          if (g.state === "walk") speed = dc < 4.5 ? 0.9 : 0.35;
          if (g.state === "fly") {
            // Toward the landing spot, climbing, then gliding down onto it.
            g.flight += dt;
            if (!g.target) {
              g.target = islandPoint(g.away, 0.8);
              for (let k = 0; k < 10 && !clear(g.target.x, g.target.z); k++) g.target = islandPoint(g.away + (k + 1) * 0.02, 0.8 + k * 0.2);
            }
            const target = g.target;
            const tx = target.x - g.x;
            const tz = target.z - g.z;
            const td = Math.hypot(tx, tz);
            const want = Math.atan2(tx, tz);
            const turn = Math.atan2(Math.sin(want - g.heading), Math.cos(want - g.heading));
            g.heading += turn * Math.min(1, dt * 2);
            const ground = groundHeight(g.x, g.z);
            const cruise = ground + Math.min(3.5, 0.6 + td * 0.25);
            g.y += (cruise - g.y) * Math.min(1, dt * 1.5);
            speed = Math.min(6, 2 + g.flight * 3, td * 1.2 + 0.4);
            if (td < 0.4 && g.flight > 1.5) {
              g.state = "idle";
              g.target = null;
              g.timer = 2 + random() * 3;
              g.y = ground;
            }
          }
          const nx = g.x + Math.sin(g.heading) * speed * dt;
          const nz = g.z + Math.cos(g.heading) * speed * dt;
          const inland = shoreDistance(nx, nz);
          if (g.state === "fly" || (inland > 0.1 && inland < 6 && clear(nx, nz))) {
            g.x = nx;
            g.z = nz;
          } else if (g.state === "walk") g.heading += Math.PI * 0.5 * dt;
          if (g.state !== "fly") g.y = groundHeight(g.x, g.z);
          // Head: pecks at the sand now and then while idle; bobs as it walks.
          if (g.state === "idle" && g.pecking <= 0 && random() < dt * 0.5) g.pecking = 0.5;
          g.pecking -= dt;
          const peck = g.state === "idle"
            ? (g.pecking > 0 ? Math.sin((g.pecking / 0.5) * Math.PI) : 0)
            : g.state === "walk" ? Math.abs(Math.sin(time * 9 + i)) * 0.25 : 0;
          gullPeck.setX(i, peck);
          gullWing.setX(i, g.state === "fly" ? Math.min(1, g.flight * 4) : 0);
          euler.set(g.state === "fly" ? -0.1 : 0, g.heading, 0);
          place(gullMesh, i, g.x, g.y, g.z, euler, g.size);
          if (g.state !== "fly") consider(g.x, g.y + 0.3, g.z, "gull");
        }
        gullMesh.instanceMatrix.needsUpdate = true;
        gullPeck.needsUpdate = true;
        gullWing.needsUpdate = true;
      }
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
      for (const m of [flyMesh, glowMesh, crabMesh, gullMesh]) {
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

function gullMaterial(shared) {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, side: THREE.DoubleSide });
  material.customProgramCacheKey = () => "standing-gull";
  material.onBeforeCompile = (shader) => {
    shader.uniforms.time = shared.time;
    shader.vertexShader = shader.vertexShader
      .replace("void main() {", "uniform float time;\nattribute float peck;\nattribute float wing;\nattribute vec2 part;\nvoid main() {")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        // part.x: head and neck weight (pecks forward and down about the
        // neck's base); part.y: signed wing span (folded along the back at
        // rest, spread and beating in flight). Legs (part.x < 0) tuck up.
        float h = max( part.x, 0.0 );
        vec3 neck = vec3( 0.0, 0.2, 0.1 );
        float a = peck * 1.1 * h;
        vec3 d = transformed - neck;
        transformed = mix( transformed, neck + vec3( d.x, d.y * cos( a ) - d.z * sin( a ), d.y * sin( a ) + d.z * cos( a ) ), step( 0.01, h ) );
        float span = abs( part.y );
        float beat = sin( time * 8.0 + instanceMatrix[3].x ) * 0.8 * wing;
        transformed.x = mix( transformed.x, sign( part.y ) * span * cos( beat ), wing * step( 0.001, span ) );
        transformed.y += span * sin( beat ) * wing;
        transformed.y += max( -part.x, 0.0 ) * wing * 0.08;`,
      );
  };
  return material;
}

// A kelp gull standing, facing +z, about 60 cm long: white head and body,
// slate-black back and folded wings over a white-tipped black tail, a
// yellow bill and olive legs. \`part\` drives head, wings and legs.
function gullGeometry() {
  const positions = [];
  const colours = [];
  const parts = [];
  const lin = (c) => c.map((v) => v ** 2.2);
  const WHITE = lin([0.9, 0.9, 0.88]);
  const BACK = lin([0.12, 0.12, 0.13]);
  const BILL = lin([0.85, 0.7, 0.15]);
  const LEG = lin([0.55, 0.55, 0.4]);
  const add = (geometry, colour, part = [0, 0], shade = null) => {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      positions.push(p.getX(i), p.getY(i), p.getZ(i));
      const c = shade ? shade(p.getX(i), p.getY(i), p.getZ(i)) : colour;
      colours.push(...c);
      parts.push(...(typeof part === "function" ? part(p.getX(i), p.getY(i), p.getZ(i)) : part));
    }
  };
  // Body: white below, the dark mantle over the back.
  const body = new THREE.SphereGeometry(1, 10, 7);
  body.scale(0.075, 0.075, 0.19);
  body.rotateX(0.18);
  body.translate(0, 0.19, -0.02);
  add(body, WHITE, [0, 0], (x, y) => (y > 0.215 ? BACK : WHITE));
  // Head and bill.
  const head = new THREE.SphereGeometry(0.05, 8, 6);
  head.scale(1, 1, 1.15);
  head.translate(0, 0.29, 0.15);
  add(head, WHITE, [1, 0]);
  const neck = new THREE.CylinderGeometry(0.035, 0.05, 0.1, 6);
  neck.rotateX(0.5);
  neck.translate(0, 0.25, 0.12);
  add(neck, WHITE, [0.6, 0]);
  const bill = new THREE.ConeGeometry(0.014, 0.07, 5);
  bill.rotateX(Math.PI / 2 + 0.15);
  bill.translate(0, 0.28, 0.225);
  add(bill, BILL, [1, 0]);
  // Folded wings along the back, tips crossing over the tail; in flight
  // they spread to ~1.4 m.
  for (const side of [-1, 1]) {
    // [folded position, span when spread]: arm, wrist and the long hand.
    const root0 = [[side * 0.05, 0.235, 0.1], 0.08];
    const root1 = [[side * 0.05, 0.235, -0.08], 0.08];
    const wristF = [[side * 0.055, 0.24, -0.02], 0.36];
    const wristB = [[side * 0.05, 0.23, -0.2], 0.36];
    const tip = [[side * 0.04, 0.22, -0.32], 0.7];
    const tris = [[root0, root1, wristF], [root1, wristB, wristF], [wristF, wristB, tip]];
    for (const [lower, colour] of [[0, BACK], [0.004, WHITE]]) {
      const pts = [];
      const spans = [];
      for (const t of tris) for (const v of lower ? [t[0], t[2], t[1]] : t) {
        pts.push(v[0][0], v[0][1] - lower, v[0][2]);
        spans.push(side * v[1]);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
      let k = 0;
      // The dark upper wing ends in a white-spotted black hand; the
      // underside (seen as the wings beat) is white.
      add(g, colour, () => [0, spans[k++]]);
    }
  }
  // Tail.
  const tail = new THREE.BufferGeometry();
  tail.setAttribute("position", new THREE.Float32BufferAttribute([0.04, 0.2, -0.17, -0.04, 0.2, -0.17, 0, 0.21, -0.28], 3));
  add(tail, WHITE);
  // Legs.
  for (const side of [-1, 1]) {
    const leg = new THREE.CylinderGeometry(0.006, 0.006, 0.14, 4);
    leg.translate(side * 0.03, 0.07, 0.0);
    add(leg, LEG, [-1, 0]);
    const foot = new THREE.BufferGeometry();
    foot.setAttribute("position", new THREE.Float32BufferAttribute([side * 0.03, 0.002, -0.01, side * 0.055, 0.002, 0.05, side * 0.005, 0.002, 0.05], 3));
    add(foot, LEG, [-1, 0]);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colours, 3));
  geometry.setAttribute("part", new THREE.Float32BufferAttribute(parts, 2));
  geometry.computeVertexNormals();
  return geometry;
}
