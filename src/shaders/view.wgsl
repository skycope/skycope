// Shared by the low-resolution cloud pass and the sharp water/composite pass.
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
};

export fn view_ray(uv: vec2f, resolution: vec2f, pointer: vec2f) -> vec3f {
  let aspect = resolution.x / resolution.y;
  let screen = (vec2f(uv.x, 1.0 - uv.y) - 0.5) * vec2f(aspect, 1.0);
  let lean = (pointer - 0.5) * vec2f(0.014, 0.009);
  let forward = vec3f(-0.703233, 0.104528, 0.703233);
  let right = vec3f(0.7071, 0.0, 0.7071);
  return normalize(forward * 0.9 + right * (screen.x + lean.x) + cross(forward, right) * (screen.y + lean.y));
}
