import { cascade_size } from "./spectrum.wgsl";

// The wind sea, once per frame into four tiling cascades (128² each, MRT),
// instead of summing sine trains and noise octaves at every water pixel.
// Each cascade sums its 32 modes (src/wave-modes.js) on its tile's lattice
// (spectrum.wgsl: 160 m to 2.5 m tiles, wavelengths L/4..L/16), so together
// they cover 40 m swell down to 16 cm ripples with no gaps. The tiles are
// commensurate, so the foam simulation on the largest can sum every band at
// the same point. The cost is fixed, not per pixel.
//
// Out: height, x/z slope, and Σ k·a·cos θ, which is minus the divergence of
// the Gerstner horizontal displacement, i.e. crest compression. The water
// derives choppy crests and whitecaps (folding) and caustics (focusing,
// since ∇²h ≈ -k Σ k·a·cos θ within a band) from it.
// Per mode: wavevector (xy), amplitude (z), phase at this frame's time (w).
@group(0) @binding(0) var<storage, read> modes: array<vec4f, 128>;

struct Cascades {
  @location(0) c0: vec4f,
  @location(1) c1: vec4f,
  @location(2) c2: vec4f,
  @location(3) c3: vec4f,
};

@fragment
fn fs_main(@location(0) uv: vec2f) -> Cascades {
  var out: Cascades;
  out.c0 = cascade(uv, 0);
  out.c1 = cascade(uv, 1);
  out.c2 = cascade(uv, 2);
  out.c3 = cascade(uv, 3);
  return out;
}

fn cascade(uv: vec2f, c: i32) -> vec4f {
  let x = uv * cascade_size(c);
  var result = vec4f(0.0);
  for (var i = 0; i < 32; i++) {
    let mode = modes[c * 32 + i];
    let phase = dot(mode.xy, x) + mode.w;
    let a = mode.z * cos(phase);
    result += vec4f(a, -mode.z * sin(phase) * mode.xy, a * length(mode.xy));
  }
  return result;
}
