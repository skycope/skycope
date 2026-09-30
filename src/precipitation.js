import * as THREE from 'three';
import { seededRandom } from './random.js';
import { groundHeight } from './terrain.js';

// Biological wetting time advances only with the simulation; previewing the
// sun never simulates a storm. Film drains faster than absorbed moisture.
export function advanceRainSurface(surface, dt, rain, exposure = 1, paused = false) {
  if (paused || !Number.isFinite(dt) || dt <= 0) return surface;
  const elapsed = Math.min(dt, 2);
  const forcing = Math.min(1, Math.max(0, Number.isFinite(rain) ? rain : 0) / 4) * Math.max(0, Math.min(1, exposure));
  const wetTarget = forcing > 0 ? Math.min(1, .3 + forcing) : 0;
  const wetRate = forcing > 0 ? 35 / Math.max(.1, forcing) : 240;
  const wetBefore = surface.wetness;
  surface.wetness += (wetTarget - surface.wetness) * (1 - Math.exp(-elapsed / wetRate));
  // Midpoint forcing avoids overestimating film when a reduced-motion frame
  // spans a full second of wetting. Absorbed moisture is integrated exactly.
  const wetMidpoint = wetTarget + (wetBefore - wetTarget) * Math.exp(-elapsed / (2 * wetRate));
  const filmTarget = forcing * Math.max(0, (wetMidpoint - .3) / .7);
  surface.film += (filmTarget - surface.film) * (1 - Math.exp(-elapsed / (forcing > 0 ? 8 : 12)));
  return surface;
}

// Two bounded draw calls, depth-tested in the land layer. Canopy inputs and
// rock tops come from the generated scene; no GPU depth readback or raycast.
export function createPrecipitation(scene, seed, { light = false, habitat = null, obstacles = {} } = {}) {
  const count = light ? 320 : 700;
  const random = seededRandom(seed ^ 0x65abef11);
  const traits = Array.from({ length: count }, () => [random(), random(), random(), 7 + random() * 4]);
  const positions = new Float32Array(count * 6);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.LineBasicMaterial({ color: 0xa5b6bb, transparent: true, opacity: .22, depthTest: true, depthWrite: false, toneMapped: false });
  const streaks = new THREE.LineSegments(geometry, material);
  streaks.frustumCulled = false;
  scene.add(streaks);
  const impacts = createImpacts(scene);
  const surface = { wetness: 0, film: 0, exposure: 1, impacts: [] };
  const columns = new Map();
  let clock = 0, impactCredit = 0;
  let cacheAnchor = '';
  let serial = 0;

  return {
    surface,
    sampleShelter,
    update({ dt = 0, rain = 0, wind = [0, 0], camera, reducedMotion = false, paused = false, brightness = 1 }) {
      if (!camera) return;
      const elapsed = paused ? 0 : Math.max(0, Math.min(.1, dt));
      clock += elapsed;
      const originX = camera.position.x, originZ = -camera.position.z;
      const anchor = `${Math.floor(originX / 4)},${Math.floor(originZ / 4)},${Math.round(wind[0])},${Math.round(wind[1])}`;
      if (anchor !== cacheAnchor) { columns.clear(); cacheAnchor = anchor; }
      const shelter = sampleShelter(originX, originZ, groundHeight(originX, originZ) + .05, wind);
      surface.exposure = shelter;
      // Global moisture history must not change when the camera enters a grove.
      // Consumers apply local canopy exposure to this shared forcing history.
      advanceRainSurface(surface, dt, rain, 1, paused);
      streaks.visible = rain > .02 && !reducedMotion;
      material.opacity = Math.min(.35, .11 + rain * .018) * Math.min(1, Math.max(.12, brightness));
      const active = Math.floor(count * Math.min(1, rain / 5));
      geometry.setDrawRange(0, active * 2);
      if (streaks.visible) {
        for (let i = 0; i < active; i++) {
          const trait = traits[i], fall = trait[3];
          const x = originX - 14 + wrap(trait[0] * 28 + wind[0] * clock * .45 - originX + 14, 28);
          const z = originZ - 14 + wrap(trait[2] * 28 + wind[1] * clock * .45 - originZ + 14, 28);
          const y = camera.position.y - 2 + wrap(trait[1] * 13 - clock * fall - camera.position.y + 2, 13);
          const ground = groundHeight(x, z);
          const visible = y > ground + .05 && trait[0] < sampleShelter(x, z, y, wind);
          const at = i * 6;
          positions[at] = x; positions[at + 1] = visible ? y : -100; positions[at + 2] = -z;
          const length = .13 + rain * .012;
          positions[at + 3] = x - wind[0] * length * .45 / fall;
          positions[at + 4] = visible ? y + length : -100;
          positions[at + 5] = -z + wind[1] * length * .45 / fall;
        }
        geometry.attributes.position.needsUpdate = true;
      }
      surface.impacts = surface.impacts.filter(event => clock - event.time < .45);
      if (!paused && !reducedMotion && rain > .1) {
        impactCredit += elapsed * Math.min(36, rain * 5);
        while (impactCredit >= 1 && surface.impacts.length < 128) {
          impactCredit--;
          const x = originX + (random() - .5) * 18, z = originZ + (random() - .5) * 18;
          if (random() > sampleShelter(x, z, groundHeight(x, z) + .05, wind)) continue;
          surface.impacts.push({ id: `${seed}:rain:${serial++}`, x, z, time: clock, strength: .3 + random() * .7 });
        }
      }
      impacts.update(surface.impacts, clock, camera, reducedMotion || rain < .02, brightness);
    },
    dispose() { scene.remove(streaks); geometry.dispose(); material.dispose(); impacts.dispose(); },
  };

  function sampleShelter(x, z, y, wind = [0, 0]) {
    const key = `${Math.floor(x)},${Math.floor(z)}`;
    let column = columns.get(key);
    if (!column) {
      const cx = Math.floor(x / 8), cz = Math.floor(z / 8);
      const covers = [];
      const referenceY = groundHeight(x, z) + .05;
      if (habitat) for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++)
        for (const crown of habitat.crowns.get(`${cx + dx},${cz + dz}`) ?? []) {
          // Rain carried downwind projects porous crowns onto the floor.
          const top = crown.y + crown.r * .5;
          const ox = x - crown.x - wind[0] * Math.max(0, top - referenceY) * .045;
          const oz = z - crown.z - wind[1] * Math.max(0, top - referenceY) * .045;
          const radial = (ox * ox + oz * oz) / (crown.r * crown.r);
          if (radial < 1) covers.push({ top, transmission: .28 + radial * .65 });
        }
      for (const rock of obstacles.domes ?? []) {
        const i = Math.floor((x - rock.x0) / rock.cell), j = Math.floor((z - rock.z0) / rock.cell);
        if (i >= 0 && j >= 0 && i < rock.nx && j < rock.nz) {
          const top = rock.heights[j * rock.nx + i];
          if (Number.isFinite(top)) covers.push({ top, transmission: 0 });
        }
      }
      column = covers;
      columns.set(key, column);
    }
    let transmission = 1;
    for (const cover of column) if (y < cover.top) transmission *= cover.transmission;
    return transmission;
  }
}

function createImpacts(scene) {
  const positions = new Float32Array(128 * 3), ages = new Float32Array(128);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('age', new THREE.BufferAttribute(ages, 1));
  const material = new THREE.ShaderMaterial({
    transparent: true, depthTest: true, depthWrite: false,
    uniforms: { pixelScale: { value: 500 }, brightness: { value: 1 } },
    vertexShader: `attribute float age; uniform float pixelScale; varying float vAge;
      void main(){vAge=age;vec4 p=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*p;
      gl_PointSize=clamp((.015+age*.08)*pixelScale/max(1.,-p.z),1.,9.);}`,
    fragmentShader: `uniform float brightness; varying float vAge; void main(){
      float r=length(gl_PointCoord-.5)*2.;float a=(1.-smoothstep(.7,1.,r))*smoothstep(.45,.65,r)*(1.-vAge);
      gl_FragColor=vec4(vec3(.55,.64,.67)*brightness,a*.25);}`,
  });
  const points = new THREE.Points(geometry, material); points.frustumCulled = false; scene.add(points);
  return {
    update(events, time, camera, hidden, brightness) {
      points.visible = !hidden && events.length > 0;
      geometry.setDrawRange(0, events.length);
      events.forEach((event, i) => { positions[i * 3] = event.x; positions[i * 3 + 1] = groundHeight(event.x, event.z) + .025; positions[i * 3 + 2] = -event.z; ages[i] = Math.min(1, (time - event.time) / .45); });
      geometry.attributes.position.needsUpdate = true; geometry.attributes.age.needsUpdate = true;
      material.uniforms.pixelScale.value = 500 / Math.tan(camera.fov * Math.PI / 360);
      material.uniforms.brightness.value = Math.min(1, Math.max(.1, brightness));
    },
    dispose() { scene.remove(points); geometry.dispose(); material.dispose(); },
  };
}

function wrap(value, range) { return ((value % range) + range) % range; }
