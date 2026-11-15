// stability: compiling the land layer's programs ahead of their first frame,
// a slice at a time. No three.js here (tests/stability.test.js drives it
// with fakes); landscape.js prewarm() supplies the compile.
//
// Compiling ~30 programs in one task queued seconds of driver work in front
// of the next frame: the picture froze, or went blank, for 3–6 s about ten
// seconds after load. Now each idle moment compiles until one new program
// is created (or `sliceMs` passes), then waits until the GPU reports it
// linked (KHR_parallel_shader_compile) before the next idle moment: never
// more than one program's work in front of a frame.

// One drawable per distinct program shape: its material(s) and the object
// kind three keys programs on, in scene order.
export function prewarmWork(root) {
  const work = [];
  const seen = new Set();
  root.traverse((o) => {
    if (!(o.isMesh || o.isPoints || o.isLine || o.isSprite) || !o.material) return;
    const kind = `${o.isInstancedMesh ? "i" : ""}${o.isSkinnedMesh ? "s" : ""}${o.isPoints ? "p" : o.isLine ? "l" : o.isSprite ? "r" : "m"}${o.receiveShadow ? "r" : ""}`;
    const key = [o.material].flat().map((m) => m.uuid).join() + kind;
    if (seen.has(key)) return;
    seen.add(key);
    work.push(o);
  });
  return work;
}

// `compile(object)` compiles one drawable; `programs()` counts the programs
// created so far; `linked(materials)` is true once those materials'
// programs are ready; `idle(fn)` runs fn at the next idle moment; `wait(fn)`
// a little later (default 16 ms). Resolves with { slices, compiled }.
export function runPrewarm(work, { compile, programs, linked, idle, wait = (fn) => setTimeout(fn, 16), now = () => performance.now(), sliceMs = 4 }) {
  let next = 0;
  let slices = 0;
  return new Promise((resolve) => {
    if (!work.length) return resolve({ slices: 0, compiled: 0 });
    const slice = () => {
      const started = now();
      const before = programs();
      const touched = [];
      while (next < work.length) {
        const object = work[next++];
        compile(object);
        touched.push(...[object.material].flat());
        if (programs() !== before || now() - started > sliceMs) break;
      }
      slices++;
      const check = () => {
        if (!linked(touched)) return wait(check);
        if (next < work.length) idle(slice);
        else resolve({ slices, compiled: next });
      };
      check();
    };
    idle(slice);
  });
}
