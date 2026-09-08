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
};

export fn view_ray(uv: vec2f, resolution: vec2f, pointer: vec2f, azimuth: f32, pitch: f32) -> vec3f {
  let aspect = resolution.x / resolution.y;
  let screen = (vec2f(uv.x, 1.0 - uv.y) - 0.5) * vec2f(aspect, 1.0);
  let lean = (pointer - 0.5) * vec2f(0.014, 0.009);
  let heading = vec3f(sin(azimuth), 0.0, cos(azimuth));
  let right = vec3f(heading.z, 0.0, -heading.x);
  let forward = heading * cos(pitch) + vec3f(0.0, 1.0, 0.0) * sin(pitch);
  return normalize(forward * 0.9 + right * (screen.x + lean.x) + cross(forward, right) * (screen.y + lean.y));
}
