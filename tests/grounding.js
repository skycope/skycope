// Floating and sunken things: transform each rock's mesh (and each
// landmark's meshes) and compare the underside with the ground beneath.
import * as THREE from 'three';
import { rockGeometry } from '../src/rocks.js';
import { groundHeight, terrainHeight } from '../src/terrain.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _n = new THREE.Vector3();
const shapes = new Map();
const shape = (variant) => {
  if (!shapes.has(variant)) shapes.set(variant, rockGeometry(4, variant));
  return shapes.get(variant);
};

// How far a rock's underside hangs above the ground: the highest gap
// between a downward-facing vertex inside its footprint and the ground
// under it (metres; ≤ 0 is seated). `stacked` rocks rest on others.
export function rockHang(rock) {
  const g = shape(rock.variant ?? 0);
  const pos = g.attributes.position, nor = g.attributes.normal;
  _q.setFromEuler(rock.rotation);
  _m.compose(rock.position, _q, rock.scale);
  const rx = Math.max(rock.scale.x, rock.scale.z);
  // Stacked on another stone: its lowest point should meet the stone below
  // (rock.ground is that support's height); the rest of its underside
  // overhangs the lower stone's curve, as it would.
  const stacked = rock.ground !== undefined && rock.ground > terrainHeight(rock.position.x, rock.position.z) + 0.1;
  let lowest = Infinity;
  let worst = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    _v.fromBufferAttribute(pos, i).applyMatrix4(_m);
    _n.fromBufferAttribute(nor, i).applyQuaternion(_q);
    if (stacked) { lowest = Math.min(lowest, _v.y); continue; }
    // Under the sea surface the land layer is cut (the water shows).
    if (_n.y > -0.35 || _v.y < 0.12) continue;
    // Inside the inner footprint (the rim of a round stone overhangs).
    if (Math.hypot(_v.x - rock.position.x, _v.z - rock.position.z) > rx * 0.7) continue;
    worst = Math.max(worst, _v.y - groundHeight(_v.x, _v.z));
  }
  return stacked ? lowest - rock.ground : worst;
}

// How deep a rock is buried: the fraction of its height below the ground at
// its centre.
export function rockBuried(rock) {
  const g = terrainHeight(rock.position.x, rock.position.z);
  return (g - (rock.position.y - rock.scale.y)) / (2 * rock.scale.y);
}
