// Where a sound is, heard from where the visitor is. Pure (no audio).
//
// The listener stands 70 % of the way from the camera to the cat, at the
// cat's ear height, facing the camera's yaw: a pure camera listener makes
// the cat's own world far away when zoomed out; a pure cat listener makes
// picture and sound disagree while orbiting.
//
// One model for every positioned voice (sound-plan.md section 3):
//   pan    sin(bearing) × min(1, d / 2) × 0.85 (sources within 2 m narrow)
//   gain   (ref / max(ref, d)) ^ 0.8, the law calls.js always used
//   air    low-pass at 16 kHz × exp(−d / 450), floor 500 Hz
//   send A min(0.5, 0.05 + d / 300): far sounds are wetter
//   behind more than 110° off the view: −2 dB and a −4 dB shelf at 5 kHz
//   cull   a voice under 0.002 is not built

export const CULL = 0.002;

export function listenerFrom(cat, camera) {
  if (!cat) return null;
  const k = 0.7;
  const x = camera && Number.isFinite(camera.x) ? camera.x + (cat.x - camera.x) * k : cat.x;
  const z = camera && Number.isFinite(camera.z) ? camera.z + (cat.z - camera.z) * k : cat.z;
  return { x, z, y: (cat.y ?? 0) + 0.25, yaw: camera?.yaw ?? 0 };
}

// { gain, pan, cutoff, sendA, behind, distance, audible } for a source at
// `at` ({ x, z, y? }) with reference distance `ref` (m).
export function placeSource(listener, at, ref = 10) {
  if (!listener || !at || !Number.isFinite(at.x) || !Number.isFinite(at.z))
    return { gain: 1, pan: 0, cutoff: 20000, sendA: 0.05, behind: false, distance: 0, audible: true };
  const dx = at.x - listener.x;
  const dz = at.z - listener.z;
  const dy = (at.y ?? listener.y) - listener.y;
  const flat = Math.hypot(dx, dz);
  const distance = Math.hypot(flat, dy);
  // The camera looks along (sin yaw, cos yaw); right is (cos yaw, −sin yaw).
  const fx = Math.sin(listener.yaw), fz = Math.cos(listener.yaw);
  const right = flat > 1e-3 ? (dx * fz - dz * fx) / flat : 0;
  const ahead = flat > 1e-3 ? (dx * fx + dz * fz) / flat : 1;
  const pan = Math.max(-1, Math.min(1, right * Math.min(1, flat / 2) * 0.85));
  const behind = flat > 2 && ahead < Math.cos((110 * Math.PI) / 180);
  let gain = (ref / Math.max(ref, distance)) ** 0.8;
  if (behind) gain *= 10 ** (-2 / 20);
  return {
    gain,
    pan,
    cutoff: Math.max(500, 16000 * Math.exp(-distance / 450)),
    sendA: Math.min(0.5, 0.05 + distance / 300),
    behind,
    distance,
    audible: gain >= CULL,
  };
}

// The pan of a direction (unit-free dx, dz) from the listener's view.
export function panToward(listener, dx, dz) {
  if (!listener) return 0;
  const flat = Math.hypot(dx, dz);
  if (flat < 1e-6) return 0;
  return ((dx * Math.cos(listener.yaw) - dz * Math.sin(listener.yaw)) / flat) * 0.85;
}
