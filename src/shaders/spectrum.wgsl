// Shared by the wind-sea pass (waves.wgsl), the whitecap history (foam.wgsl)
// and the water (ocean.wgsl).

// Per-cascade share of the Cox–Munk mean-square slope, 0.003 + 0.00512 U,
// spread evenly over the ~8.3 natural-log units of wavenumber from the peak
// to capillaries; each cascade spans a factor of 4 (ln 4 = 1.386). Whatever
// cascades a pixel cannot resolve become microfacet roughness, and the
// capillary rest always is.
export fn band_variance(wind: f32) -> f32 {
  let u = max(wind, 3.0);
  return (0.003 + 0.00512 * u) / 8.3 * 1.386;
}

// The wind sea's four cascades tile at 160, 40, 10 and 2.5 m (128² texels
// each), holding wavelengths L/4..L/16: 40 m swell down to 16 cm ripples.
// Each tile is 4× the next, so all of them repeat on the largest.
export const SEA_TILE: f32 = 160.0;

export fn cascade_size(c: i32) -> f32 {
  return SEA_TILE / pow(4.0, f32(c));
}
