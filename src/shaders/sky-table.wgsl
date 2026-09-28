import { Atmosphere } from "./view.wgsl";
import { lut_direction, sky_view } from "./skyview.wgsl";

// Pass 1 of the sky: the sky-view table (see skyview.wgsl). A few thousand
// texels instead of a million pixels of scattering integrals.
@group(0) @binding(0) var<uniform> atmosphere: Atmosphere;

@fragment
fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let night = smoothstep(1.0, 2.0, atmosphere.scene);
  let ray = lut_direction(uv);
  return vec4f(sky_view(ray, atmosphere.sun, atmosphere.moon, night, atmosphere.celestial.z), 1.0);
}
