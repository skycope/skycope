// The land layer's tonemap is the sea and sky's: src/shaders/tone.wgsl is
// the one source, and this turns its `glsl: begin` … `glsl: end` block into
// GLSL for three's CustomToneMapping. The block keeps to the subset both
// languages share (see tone.wgsl), so a handful of rewrites is the whole
// translation; anything else left in WGSL syntax throws here, at load, and
// in tests/tone.test.js.

const TYPES = { f32: "float", vec2f: "vec2", vec3f: "vec3", vec4f: "vec4", bool: "bool" };
const glslType = (t) => {
  if (!TYPES[t]) throw new Error(`tone-glsl: no GLSL type for ${t}`);
  return TYPES[t];
};

export function toneBlock(wgsl) {
  const match = wgsl.match(/\/\/ glsl: begin\n([\s\S]*?)\/\/ glsl: end/);
  if (!match) throw new Error("tone-glsl: no `// glsl: begin` … `// glsl: end` block");
  return match[1];
}

export function wgslToGlsl(block) {
  const glsl = block
    .replace(/\bconst (\w+): (\w+) =/g, (_, name, type) => `const ${glslType(type)} ${name} =`)
    .replace(/\bfn (\w+)\(([^)]*)\) -> (\w+) \{/g, (_, name, params, type) => {
      const args = params.split(",").filter((p) => p.trim()).map((p) => {
        const [arg, t] = p.split(":").map((s) => s.trim());
        return `${glslType(t)} ${arg}`;
      });
      return `${glslType(type)} ${name}(${args.join(", ")}) {`;
    })
    .replace(/\b(?:let|var) (\w+): (\w+) =/g, (_, name, type) => `${glslType(type)} ${name} =`)
    .replace(/\b(vec[234])f\(/g, "$1(");
  const left = glsl.replace(/\/\/.*$/gm, "").match(/\b(?:let|var|fn|select|f32|vec[234]f)\b|->|: \w+ =/);
  if (left) throw new Error(`tone-glsl: untranslated WGSL "${left[0]}" in the tone block`);
  return glsl;
}

// three's CustomToneMapping body: the shared curve, with the eye's state
// carried in toneMappingExposure as 1 + adapt (see landscape.js).
export function customToneMapping(wgsl) {
  return `${wgslToGlsl(toneBlock(wgsl))}
vec3 CustomToneMapping( vec3 color ) {
  return tone_curve( color, toneMappingExposure - 1.0 );
}`;
}

// Twin of tone.wgsl's tone_adapt (tests/tone.test.js checks they agree).
export function toneAdapt(night, cover = 0) {
  const t = Math.max(0, Math.min(1, (cover - 0.55) / 0.4));
  return night - (1 - night) * t * t * (3 - 2 * t);
}
