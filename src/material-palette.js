// Authored sRGB colours are converted once; mesh vertex colours and the
// reflection field both consume these linear reflectances, never lit colours.
export const MATERIAL_HEX = Object.freeze({
  sand: '#c2ae8c', wetSand: '#897a5d', dune: '#ae9a74',
  litter: '#4a3a28', moss: '#3a5626', humus: '#3a2d20',
  dryThatch: '#918269', leaf: '#647b43', bark: '#665747',
  waxyLeaf: '#798875', deadGrowth: '#8b7961',
});
export const MATERIAL_LINEAR = Object.freeze(Object.fromEntries(
  Object.entries(MATERIAL_HEX).map(([name, hex]) => [name, Object.freeze(hexToLinear(hex))]),
));

export function hexToLinear(hex) {
  return [1, 3, 5].map((offset) => srgbToLinear(parseInt(hex.slice(offset, offset + 2), 16) / 255));
}

export function srgbToLinear(value) {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}
