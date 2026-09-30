import { Atmosphere } from "./view.wgsl";
import { band_variance, SEA_TILE } from "./spectrum.wgsl";

// Whitecap foam that lives on: a 512² world-space history over the 160 m
// wave tile (the tile the whole spectrum repeats on). Where the wind sea's
// crests fold (the Gerstner Jacobian drops, Σ k·a·cos θ is high), foam is
// born; each frame it decays, drifts downwind and diffuses, so a breaking
// crest leaves a patch that thins and opens into lace behind it. r: surface
// foam, g: the bubble cloud under it, which lingers longer and makes the water
// milky. b: advected age of surface froth in seconds. Coverage follows Monahan's whitecap law (≈ U^3.4), exaggerated a
// little because a 6 m camera sees less sea than a ship.
@group(0) @binding(0) var<uniform> atmosphere: Atmosphere;
@group(0) @binding(1) var waves0: texture_2d<f32>;
@group(0) @binding(2) var waves1: texture_2d<f32>;
@group(0) @binding(3) var waves2: texture_2d<f32>;
@group(0) @binding(4) var foamHistory: texture_2d<f32>;
@group(0) @binding(5) var filtering: sampler;

@fragment
fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let wind = length(atmosphere.wind);
  let dt = clamp(atmosphere.ocean.x, 0.0, 0.1);
  // Crest compression summed over every breaking-scale band at this point;
  // the finer tiles repeat exactly 4 and 16 times across this one.
  let compression = textureSampleLevel(waves0, filtering, uv, 0.0).w
    + textureSampleLevel(waves1, filtering, uv * 4.0, 0.0).w
    + textureSampleLevel(waves2, filtering, uv * 16.0, 0.0).w * 0.6;
  let sigma = sqrt(band_variance(wind) * 1.36);
  let coverage = clamp(1.2e-5 * pow(max(wind, 0.1), 3.41), 1e-5, 0.12);
  let threshold = sqrt(max(-2.0 * log(2.5 * coverage), 0.5));
  let birth = smoothstep(threshold, threshold + 0.8, compression / sigma) * smoothstep(3.5, 6.0, wind) * 0.9;
  // Semi-Lagrangian drift downwind (a few cm/s per m/s of wind), plus a
  // little diffusion so patches spread and soften as they age.
  let texel = 1.0 / 512.0;
  let drift = atmosphere.wind * 0.03 * dt / SEA_TILE;
  let back = uv - drift;
  var previous = textureSampleLevel(foamHistory, filtering, back, 0.0).rgb * 0.6
    + (textureSampleLevel(foamHistory, filtering, back + vec2f(texel, 0.0), 0.0).rgb
      + textureSampleLevel(foamHistory, filtering, back - vec2f(texel, 0.0), 0.0).rgb
      + textureSampleLevel(foamHistory, filtering, back + vec2f(0.0, texel), 0.0).rgb
      + textureSampleLevel(foamHistory, filtering, back - vec2f(0.0, texel), 0.0).rgb) * 0.1;
  previous *= atmosphere.ocean.y;
  let decay = exp(-dt / vec2f(1.8, 4.5));
  let aged = previous.xy * decay;
  let foam = max(aged, vec2f(birth, birth * 0.8));
  // Fresh compression resets age; the same backtrace carries density and age.
  let age = select(min(previous.z + dt, 30.0), 0.0, birth > aged.x || foam.x < 0.001);
  return vec4f(foam, age, 1.0);
}
