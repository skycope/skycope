// Shared by the low-resolution cloud pass and the sharp water/composite pass.
// flight carries the camera position (coast metres) and azimuth; pitch tilts
// the view. The default is the original fixed view: (6, 4.5, 0), 315°, 6° up.
export struct Atmosphere {
  resolution: vec2f,
  pointer: vec2f,
  time: f32,
  scene: f32,
  steps: f32,
  seed: f32,
  sun: vec3f,
  moon: vec3f,
  celestial: vec4f,
  weather: vec4f,
  wind: vec2f,
  rain: f32,
  flight: vec4f,
  pitch: f32,
  // From src/sunlight.js, exposed linear units: direct sun/moon light (rgb)
  // with the exposure in w, and zenith skylight (rgb) with night in w.
  light: vec4f,
  ambient: vec4f,
  // Temporal cloud reconstruction (sky passes only): this frame's sub-pixel
  // jitter within each 2x2 block (xy, in pixels), whether the history is
  // usable (z), and the previous frame's view: azimuth, pitch, pointer.
  temporal: vec4f,
  previous: vec4f,
  // The sea (src/swell.js): the breaking swell train (shore-arc wavenumber,
  // angular frequency, phase, amplitude), and for the foam history the frame
  // step in seconds (x) and whether the history is usable (y).
  swell: vec4f,
  ocean: vec4f,
  // sky-events (src/sky-events.js, filled in main.js createUniforms and
  // scripts/render-sky.mjs). All zero = nothing happening, no work done.
  // events: rainbow (x; sunlit rain, by the Moon at night: a moonbow),
  // lightning flash radiance (y, before exposure), ice halo (z) and
  // crepuscular rays (w), each 0-1.
  events: vec4f,
  // A lightning strike: its bearing as a horizontal unit vector (xz), the
  // cloud base's elevation in radians (y), the channel's brightness (w; 0 =
  // an in-cloud flash, no visible bolt).
  bolt: vec4f,
  // Lunar corona (x), zodiacal light (y), green flash (z), 0-1; the bolt's
  // shape seed (w).
  optics: vec4f,
  // A meteor: head direction (xyz) and flux relative to magnitude 0 (w);
  // the trail's far end (xyz) and a fireball's persistent train flux (w);
  // green tint (x) and whether it is a fireball (y).
  meteor: vec4f,
  trail: vec4f,
  streak: vec4f,
  // A sunlit satellite: direction (xyz) and flux (w).
  satellite: vec4f,
  // sea-sky-magic (src/sea-sky-magic.js documents every lane; filled in
  // main.js createUniforms and scripts/render-sky.mjs). All zero = every
  // gift asleep: the shaders skip all of it.
  // magic: tideglow, stars, lamp, finale levels 0-1. magic2: seconds since
  // the stars woke, seconds since the latest meow (0 = none), seafolk, boat.
  magic: vec4f,
  magic2: vec4f,
  // The waking's wave of light: centre x, z (coast metres), ring radius (m),
  // strength; its colour (rgb) and reach (w).
  pulse: vec4f,
  pulseColour: vec4f,
  // The lit lamp: position (coast metres) and beam bearing (w, radians; a
  // beam points along (cos w, -sin w) in coast x, z; the other opposite).
  lamp: vec4f,
  // The guiding wisp: position (coast metres), glow (w; 0 = hidden); colour.
  wisp: vec4f,
  wispColour: vec4f,
};

// sea-sky-magic: false compiles every gift's code out of the sky and water
// pipelines (the default the site runs while every gift sleeps: unexecuted
// code still costs registers). src/sea-sky-magic.js magicVariant() flips it
// in the shader text by its @id; main.js swaps to the awake pipelines the
// first time a magic field is non-zero.
@id(7301) override MAGIC_AWAKE: bool = true;

export fn view_ray(uv: vec2f, resolution: vec2f, pointer: vec2f, azimuth: f32, pitch: f32) -> vec3f {
  let aspect = resolution.x / resolution.y;
  let screen = (vec2f(uv.x, 1.0 - uv.y) - 0.5) * vec2f(aspect, 1.0);
  let lean = (pointer - 0.5) * vec2f(0.014, 0.009);
  let heading = vec3f(sin(azimuth), 0.0, cos(azimuth));
  let right = vec3f(heading.z, 0.0, -heading.x);
  let forward = heading * cos(pitch) + vec3f(0.0, 1.0, 0.0) * sin(pitch);
  return normalize(forward * 0.9 + right * (screen.x + lean.x) + cross(forward, right) * (screen.y + lean.y));
}

// Inverse of view_ray: where a direction lands on screen for a given view.
// xy is the uv; z is 1 when the direction is in front of the camera.
export fn view_uv(ray: vec3f, resolution: vec2f, pointer: vec2f, azimuth: f32, pitch: f32) -> vec3f {
  let aspect = resolution.x / resolution.y;
  let lean = (pointer - 0.5) * vec2f(0.014, 0.009);
  let heading = vec3f(sin(azimuth), 0.0, cos(azimuth));
  let right = vec3f(heading.z, 0.0, -heading.x);
  let forward = heading * cos(pitch) + vec3f(0.0, 1.0, 0.0) * sin(pitch);
  let up = cross(forward, right);
  let depth = dot(ray, forward);
  let screen = vec2f(dot(ray, right), dot(ray, up)) * 0.9 / max(depth, 1e-4) - lean;
  return vec3f(screen.x / aspect + 0.5, 0.5 - screen.y, select(0.0, 1.0, depth > 0.0));
}
