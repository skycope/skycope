// The one tonemap, shared by both canvases: the WebGPU sky and sea
// (water.wgsl calls `tonemap`) and the Three.js land layer, whose GLSL
// CustomToneMapping is generated from the block between the `glsl` markers
// below (src/tone-glsl.js; tests/tone.test.js checks the translation). Edit
// it here only. Write it in the subset both languages share: typed `let` and
// `var`, float literals with a decimal point, no `select`.
//
// Khronos PBR Neutral: linear through the midtones (colours stay as the
// materials and light make them, shadows stay open and lifted by skylight,
// as in a photograph, not crushed by a filmic S-curve), with a smooth
// shoulder so the sun disc and glints roll off to white instead of clipping.
// Every blend before it happens in linear light.
//
// `adapt` (tone_adapt) is the eye's state. 0 to 1 is dark adaptation: by
// moonlight the rods take over, colour fades and what is left shifts toward
// blue-green (their 507 nm peak, the Purkinje shift). 0 to -1 is a camera's
// white balance under a full cloud deck: cool and neutral, with the greens
// rich (no sun to bleach them), instead of the warm albedos turning the
// whole land khaki.

// glsl: begin
const TONE_GAIN: f32 = 1.35;
const VIBRANCE: f32 = 0.04;
const OVERCAST_BALANCE: vec3f = vec3f(0.94, 0.99, 1.08);
const OVERCAST_VIBRANCE: f32 = 0.14;
fn tone_curve(hdr: vec3f, adapt: f32) -> vec3f {
  let rods: f32 = clamp(adapt, 0.0, 1.0);
  let overcast: f32 = clamp(-adapt, 0.0, 1.0);
  var color: vec3f = max(hdr * TONE_GAIN * mix(vec3f(1.0), OVERCAST_BALANCE, overcast), vec3f(0.0));
  // Bright things (the Moon's disc, glints) still reach the cones.
  let scotopic: f32 = dot(color, vec3f(0.06, 0.56, 0.38));
  // Warm light at night is lamp, lantern, window or wisp light: it keeps its
  // gold against the blue. Only bright warm light: a tabby coat or fallen
  // leaves under the moon are as dim as the sand round them, and go blue
  // with it instead of glowing orange.
  let warm: f32 = clamp((color.r - color.b) / max(color.r, 1e-4), 0.0, 1.0);
  let cones: f32 = smoothstep(0.18, 0.55, warm) * smoothstep(0.08, 0.3, scotopic);
  color = mix(color, vec3f(0.72, 0.9, 1.35) * scotopic, rods * 0.6 * (1.0 - smoothstep(0.25, 1.5, scotopic)) * (1.0 - 0.9 * cones));
  let low: f32 = min(color.r, min(color.g, color.b));
  if (low < 0.08) {
    color -= low - 6.25 * low * low;
  } else {
    color -= 0.04;
  }
  let peak: f32 = max(color.r, max(color.g, color.b));
  if (peak >= 0.76) {
    let new_peak: f32 = 1.0 - 0.0576 / (peak - 0.52);
    color *= new_peak / peak;
    color = mix(color, vec3f(new_peak), 1.0 - 1.0 / (0.15 * (peak - new_peak) + 1.0));
  }
  // A camera's picture profile: vibrance lifts muted colours (sky, leaves,
  // sand) and leaves saturated ones be; more under cloud, where foliage is
  // at its richest. Off by moonlight.
  let luma: f32 = dot(color, vec3f(0.2126, 0.7152, 0.0722));
  let top: f32 = max(color.r, max(color.g, color.b));
  let chroma: f32 = (top - min(color.r, min(color.g, color.b))) / max(top, 1e-4);
  let vibrance: f32 = mix(VIBRANCE, OVERCAST_VIBRANCE, overcast);
  return max(vec3f(luma) + (color - luma) * (1.0 + vibrance * (1.0 - chroma) * (1.0 - rods)), vec3f(0.0));
}
// glsl: end

// The eye's state from the scene's twilight (`night`, 0-1) and the total
// cloud cover (0-1). landscape.js sets the land's toneMappingExposure to
// 1 + toneAdapt(...) (tone-glsl.js), its twin: tests/tone.test.js checks
// they agree.
export fn tone_adapt(night: f32, cover: f32) -> f32 {
  return night - (1.0 - night) * smoothstep(0.55, 0.95, cover);
}

// The sea and sky's final pass: tone curve, then sRGB encoding (three
// encodes the land layer itself).
export fn tonemap(hdr: vec3f, adapt: f32) -> vec3f {
  let mapped = clamp(tone_curve(hdr, adapt), vec3f(0.0), vec3f(1.0));
  return select(1.055 * pow(mapped, vec3f(1.0 / 2.4)) - 0.055, mapped * 12.92, mapped <= vec3f(0.0031308));
}
