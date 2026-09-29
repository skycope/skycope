// The dominant swell train that breaks on the island, shared by the water
// pass (ocean.wgsl), the beach swash on the ground and the rock surf
// (surf.js). One source keeps the breaker, its run-up on the sand and the
// surge up the boulders on the same clock. Coordinates are shore-relative:
// phase = along * shore arc (m) - k * refracted offshore distance - omega * t + phase.
// The presentation clock is slowed like the rest of the sea (0.22).
export const SWELL_SPEED = 0.22;

export function swellAt(seed, wind = [0, 0]) {
  const s = (seed % 65536) / 65536;
  const speed = Math.hypot(wind[0], wind[1]);
  const k = 0.4;
  // A long-period groundswell: its crests run nearly parallel to the beach,
  // turned a little by the seed; local wind only adds height. Big enough to
  // trip on the outer shelf (~1 m deep, 15 m out) as knee-to-thigh-high
  // breakers seen from the sand; the inner surf zone stays depth-limited.
  // Keep in step with the default in sea-surface.js.
  const angle = Math.sin(s * 6.283185) * 0.22;
  return {
    k,
    along: Math.sin(angle) * k,
    omega: SWELL_SPEED * Math.sqrt(9.81 * k),
    phase: ((s * 7.31) % 1) * 6.283185,
    amplitude: 0.28 + Math.min(speed * 0.006, 0.07),
  };
}

// [along, omega, phase, amplitude] for uniforms.
export function swellUniform(seed, wind) {
  const w = swellAt(seed, wind);
  return [w.along, w.omega, w.phase, w.amplitude];
}
