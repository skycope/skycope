import { shoreDistance, ISLAND } from "./terrain.js";

// The sea where the cat is, on the CPU: a port of the geometric part of
// wave_surface (the breaking train, the shorter shore swells and the long
// wind-sea cascades), seabed_depth and swash in ocean.wgsl, on the same
// clock and uniforms, so a swimming cat rides the waves the water pass
// draws. Keep in step with ocean.wgsl.
const TAU = Math.PI * 2;

export function shoreAlong(x, z) {
  return Math.atan2(z - ISLAND.z, x - ISLAND.x) * 62;
}

export function seabedDepth(offshore, along) {
  const rips = smooth(-0.3, 0.5, Math.sin(along * 0.145161 + 0.7 * Math.sin(along * 0.032258)));
  const x = (offshore - 11) / 2.6;
  const bar = 0.3 * Math.exp(-x * x) * (0.3 + 0.7 * rips);
  return offshore * 0.06 + Math.max(0, offshore - 13) * 0.16 + Math.max(0, offshore - 30) * 0.3 + Math.max(0, offshore - 50) * 0.3 - bar;
}

function setEnvelope(along, time) {
  return 0.8 + 0.17 * Math.sin(along * 0.032258 - time * 0.061 + 1.3) + 0.1 * Math.sin(along * 0.016129 + time * 0.023);
}

function breakerTheta(psi, beta, q) {
  const psi1 = psi - beta * Math.cos(psi);
  const theta = psi1 + q * Math.sin(psi1);
  return psi1 + q * Math.sin(theta);
}

// (film, metres behind the uprush front) on the sand; see swash in ocean.wgsl.
function swash(along, inland, time, swell) {
  const theta = breakerTheta(along * swell[0] - swell[1] * time + swell[2], 0.65, 0.75);
  const s = fract(-theta / TAU);
  const cusps = 1 + 0.2 * Math.cos(along * 0.693548 + 0.9 * Math.sin(along * 0.048387));
  const reach = (1.2 + swell[3] * 6) * setEnvelope(along, time) * cusps;
  const u = s / 0.82;
  const rise = Math.pow(Math.min(u, 1), 0.65);
  const front = u < 1 ? -0.6 + (reach + 0.6) * Math.sin(Math.PI * rise) : -0.6;
  const film = 1 - smooth(front - 0.1, front + 0.02, inland);
  // The film runs up fast and drains back: its flow, inland positive.
  const flow = u < 1 ? (rise < 0.5 ? 1 : -0.6) : 0;
  return [film, Math.max(front - inland, 0), flow];
}

// modes: the wave-modes buffer (wave-modes.js), phases updated per frame.
export function createSea(seed, modes) {
  const s = (seed % 65536) / 65536;
  let time = 0;
  let swell = [0, 1, 0, 0.17];
  let wind = [0, 0];
  const out = { level: 0, flowX: 0, flowZ: 0, breaking: 0 };

  function height(x, z, offshore, along, rx, rz, withFlow) {
    const depth = seabedDepth(offshore, along);
    const shallows = Math.exp(-offshore / 12);
    const refracted = offshore + 9 * (1 - shallows);
    const speed = Math.hypot(wind[0], wind[1]);
    const windAngle = Math.atan2(wind[1] + 0.01, wind[0] + 0.01);
    const shoal = clamp(Math.pow(3.7 / Math.max(depth, 0.08), 0.25), 1, 2.6);
    const cap = 0.39 * depth + 0.012;
    const shoreWeight = 1 - smooth(8, 70, offshore) * 0.65;
    // The breaking train.
    const k = 0.4;
    const alongK = swell[0] / k;
    const across = Math.sqrt(Math.max(1 - alongK * alongK, 0));
    const grown = swell[3] * setEnvelope(along, time) * shoal;
    const a = Math.min(grown, cap);
    const breaking = smooth(0.75, 1, grown / cap);
    const psi = (-refracted * across + along * alongK) * k - swell[1] * time + swell[2];
    const theta = breakerTheta(psi, 0.08 + 0.57 * breaking, 0.25 + 0.5 * breaking);
    let h = a * Math.cos(theta) * shoreWeight;
    if (withFlow) {
      // Orbital velocity under the train, shoreward under each crest, and
      // the broken bore carrying a floating cat in.
      const excursion = Math.min(a / (k * Math.max(depth, 0.25)), 1.1);
      const u = excursion * swell[1] * Math.cos(theta) * shoreWeight + breaking * 0.12 * Math.max(0, Math.cos(theta));
      out.flowX = -rx * u;
      out.flowZ = -rz * u;
      out.breaking = breaking;
    }
    // Two shorter shore swells.
    let ks = 0.4;
    let amplitude = 0.06 + Math.min(speed * 0.003, 0.03);
    const windTurn = Math.sin(windAngle) * 0.18;
    for (let i = 1; i < 3; i++) {
      const random = fract(Math.sin(i * 91.345 + s * 451.123 + 0.71) * 47453.5453);
      ks *= 1.24;
      amplitude *= 0.72;
      const kk = ks * (1 + random * 0.05);
      const al = Math.round((Math.sin(i * 2.39996 + s * TAU) * 0.6 + windTurn) * kk * 62) / (62 * kk);
      const ac = Math.sqrt(Math.max(1 - al * al, 0));
      const travel = 0.22 * Math.sqrt(9.81 * kk) * time - random * TAU;
      const c = Math.cos((-refracted * ac + along * al) * kk - travel);
      h += (c + 0.18 * (c * c - 0.5)) * Math.min(amplitude * shoal, cap) * shoreWeight;
    }
    // The two longest wind-sea cascades (the shorter ones only shade).
    if (modes) {
      const felt = smooth(0.3, 3.5, depth);
      for (let c = 0; c < 2; c++) {
        const w = c === 0 ? felt : 0.35 + 0.65 * felt;
        if (w < 0.01) continue;
        let sum = 0;
        for (let i = c * 32; i < c * 32 + 32; i++) {
          const o = i * 4;
          sum += modes[o + 2] * Math.cos(modes[o] * x + modes[o + 1] * z + modes[o + 3]);
        }
        h += sum * w;
      }
    }
    return h;
  }

  return {
    // Per frame, with the water pass's own uniforms.
    set(t, swellUniform, windNow) {
      time = t;
      swell = swellUniform;
      wind = windNow;
    },
    // The water surface at (x, z), or -Infinity where the sand is dry; and
    // the flow a floating body is carried by. `ground` is the sand height.
    at(x, z, ground) {
      const inland = shoreDistance(x, z);
      const along = shoreAlong(x, z);
      const dx = x - ISLAND.x;
      const dz = z - ISLAND.z;
      const r = Math.hypot(dx, dz) || 1;
      out.flowX = out.flowZ = out.breaking = 0;
      out.level = -Infinity;
      if (inland < 0) out.level = height(x, z, -inland, along, dx / r, dz / r, true);
      if (inland > -1 && inland < 9) {
        // The swash film over the sand, a few centimetres deep.
        const [film, behind, flow] = swash(along, inland, time, swell);
        if (film > 0.2) {
          out.level = Math.max(out.level, ground + film * Math.min(0.06, 0.008 + behind * 0.03));
          if (inland > -0.5) {
            out.flowX += (-dx / r) * flow * 0.5 * film;
            out.flowZ += (-dz / r) * flow * 0.5 * film;
          }
        }
      }
      return out;
    },
  };
}

function clamp(v, a, b) {
  return Math.min(b, Math.max(a, v));
}
function fract(v) {
  return v - Math.floor(v);
}
function smooth(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
