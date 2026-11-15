// The loading veil: the sky of this moment, and one small light.
//
// It paints only what it can get right before the world exists: the sky
// and sea the renderer is about to draw (loading-sky.js), framed by the
// camera the world opens on, so its horizon is the world's horizon. No
// land: each visit is a new island, and a guess at it reads as a cut to a
// different picture.
//
// The picture is a small table of linear sky light (direction → colour)
// drawn by one fragment shader at the device's own resolution, toned by
// tone.wgsl's own curve (the GLSL the land layer uses, tone-glsl.js) and
// dithered: smooth at any DPR, crisp at the horizon.
//
// The hand-over is a focus pull: when the first real frame is up the veil
// fades off a world that is still out of focus (index.html `.focus`, a
// backdrop blur over both canvases, driven by body[data-focus]), and the
// blur then eases to nothing, so the land resolves out of soft colour under
// the same sky. The light rises with real progress and, at the hand-over,
// sinks toward where the real wisp will rise.
//
// Cheap on purpose: index.html loads this before main.js; drawing is one
// full-screen triangle per change; motion is CSS transforms and opacity.
import { skyAt } from "./astronomy.js";
import { HALF, HOME_VIEW, STAGES, TABLE_W, cssSky, horizonAt, progressAt, project, skyTable, wispRise } from "./loading-sky.js";
import toneSource from "./shaders/tone.wgsl?raw";
import { toneBlock, wgslToGlsl } from "./tone-glsl.js";
import { presetWeather } from "./weather-panel.js";

export { STAGES, progressAt };

// ---- The picture -----------------------------------------------------------

const LENS = 0.9;

const VERTEX = `#version 300 es
in vec2 corner;
void main() { gl_Position = vec4(corner, 0.0, 1.0); }`;

const FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D tableA;
uniform sampler2D tableB;
uniform float blend;
uniform vec2 resolution;
uniform vec2 view;
uniform float horizon;
uniform vec3 sun;
uniform vec3 discA;
uniform vec3 glowA;
uniform vec3 discB;
uniform vec3 glowB;
uniform float adaptA;
uniform float adaptB;
out vec4 fragColor;
const float TAU = 6.2831853;
const float HALF_PI = 1.5707963;
${wgslToGlsl(toneBlock(toneSource))}
float hash(vec2 p) {
  p = fract(p * vec2(443.897, 441.423));
  p += dot(p, p.yx + 19.19);
  return fract((p.x + p.y) * p.x);
}
vec3 look(sampler2D table, float u, float s, float row0) {
  return texture(table, vec2(u, (row0 + 0.5 + s * ${HALF - 1}.0) / ${HALF * 2}.0)).rgb;
}
vec3 encode(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, c * 12.92, step(c, vec3(0.0031308)));
}
vec3 picture(sampler2D table, vec3 disc, vec3 glow, float adapt, float u, float s, float above, float d, float edge) {
  vec3 c = mix(look(table, u, s, ${HALF}.0), look(table, u, s, 0.0), above);
  // water.wgsl: the sun's disc and its aureole over the sky.
  c += glow * exp(-d * 90.0) * above;
  c = mix(c, disc, (1.0 - smoothstep(0.006 - edge, 0.006 + edge, d)) * above * step(1e-6, dot(disc, disc)));
  return encode(tone_curve(c, adapt));
}
void main() {
  vec2 uv = vec2(gl_FragCoord.x / resolution.x, 1.0 - gl_FragCoord.y / resolution.y);
  float aspect = resolution.x / resolution.y;
  vec2 screen = (vec2(uv.x, 1.0 - uv.y) - 0.5) * vec2(aspect, 1.0);
  vec3 heading = vec3(sin(view.x), 0.0, cos(view.x));
  vec3 right = vec3(heading.z, 0.0, -heading.x);
  vec3 forward = heading * cos(view.y) + vec3(0.0, sin(view.y), 0.0);
  vec3 ray = normalize(forward * ${LENS.toFixed(1)} + right * screen.x + cross(forward, right) * screen.y);
  float u = fract(atan(ray.x, ray.z) / TAU);
  float s = sqrt(min(abs(asin(clamp(ray.y, -1.0, 1.0))), HALF_PI) / HALF_PI);
  // The horizon is a level line: one pixel of antialiasing, as water.wgsl.
  float above = clamp(gl_FragCoord.y - (1.0 - horizon) * resolution.y + 0.5, 0.0, 1.0);
  float d = length(ray - sun);
  float edge = 1.0 / (${LENS.toFixed(1)} * resolution.y);
  vec3 a = picture(tableA, discA, glowA, adaptA, u, s, above, d, edge);
  vec3 b = picture(tableB, discB, glowB, adaptB, u, s, above, d, edge);
  // A triangular dither of one level: no bands in the long gradients.
  float n = hash(gl_FragCoord.xy) - hash(gl_FragCoord.xy + 71.3);
  fragColor = vec4(mix(a, b, blend) + n / 255.0, 1.0);
}`;

// The painter: one WebGL2 canvas, a full-screen triangle, and two tables to
// cross-fade between when the scene changes (live weather arriving, say).
export function createPainter(canvas) {
  const gl = canvas.getContext("webgl2", { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: "low-power" });
  if (!gl) return null;
  const shader = (type, source) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, source);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const program = gl.createProgram();
  gl.attachShader(program, shader(gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(program, shader(gl.FRAGMENT_SHADER, FRAGMENT));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const corner = gl.getAttribLocation(program, "corner");
  gl.enableVertexAttribArray(corner);
  gl.vertexAttribPointer(corner, 2, gl.FLOAT, false, 0, 0);
  const uniforms = new Map();
  const loc = (name) => {
    if (!uniforms.has(name)) uniforms.set(name, gl.getUniformLocation(program, name));
    return uniforms.get(name);
  };
  const textures = [0, 1].map((unit) => {
    const t = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  });
  gl.uniform1i(loc("tableA"), 0);
  gl.uniform1i(loc("tableB"), 1);
  const shown = [null, null];
  const upload = (slot, table) => {
    gl.activeTexture(gl.TEXTURE0 + slot);
    gl.bindTexture(gl.TEXTURE_2D, textures[slot]);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, TABLE_W, HALF * 2, 0, gl.RGBA, gl.HALF_FLOAT, table.half);
    shown[slot] = table;
    const k = slot ? "B" : "A";
    gl.uniform3fv(loc(`disc${k}`), table.disc);
    gl.uniform3fv(loc(`glow${k}`), table.glow);
    gl.uniform1f(loc(`adapt${k}`), table.adapt);
  };
  return {
    // Show `table`; `fade` keeps the one shown to cross-fade from.
    set(table, fade = false) {
      if (!fade || !shown[0]) upload(0, table);
      upload(1, table);
      gl.uniform3fv(loc("sun"), table.sun);
    },
    // The fade is done: the new table is the only one.
    settle() {
      if (shown[1] && shown[1] !== shown[0]) upload(0, shown[1]);
    },
    draw(view, width, height, blend = 1) {
      if (canvas.width !== width || canvas.height !== height) Object.assign(canvas, { width, height });
      gl.viewport(0, 0, width, height);
      gl.uniform2f(loc("resolution"), width, height);
      gl.uniform2f(loc("view"), view.azimuth, view.pitch);
      gl.uniform1f(loc("horizon"), horizonAt(view));
      gl.uniform1f(loc("blend"), blend);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    dispose() {
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}

// ---- The veil --------------------------------------------------------------

const WEATHER_KEY = "skycope.veil-weather";
const WEATHER_AGE_MS = 3 * 3600 * 1000;
// Device pixels, at most: a phone's whole screen, a big monitor's at 2×.
const MAX_PIXELS = 3840 * 2400;

export function createLoadingScreen({ document: doc = globalThis.document, storage = safeStorage() } = {}) {
  const root = doc?.querySelector?.("#loading-screen");
  const noop = { progress() {}, scene() {}, ready() {}, fail() {}, dispose() {} };
  if (!root) return noop;
  const view = doc.defaultView;
  const body = doc.body;
  const reduced = Boolean(view?.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
  const canvas = root.querySelector("canvas");
  const wisp = root.querySelector(".wisp");
  const params = new URLSearchParams(view?.location?.search ?? "");
  const scene = {
    celestial: skyAt(new Date()),
    // `?weather=` opens on that preset; otherwise the last live forecast
    // seen here, if it is recent, until main.js has the current one.
    weather: presetWeather(params.get("weather")) ?? recentWeather(storage),
    view: { azimuth: HOME_VIEW.azimuth, pitch: HOME_VIEW.pitch },
  };
  let painter = null;
  let table = null;
  let key = "";
  let fadeFrame = 0;
  let pullFrame = 0;
  let resizeTimer = 0;
  let progress = 0;
  let state = "loading";
  const timers = [];
  const events = new AbortController();

  const size = () => {
    const dpr = Math.max(1, view.devicePixelRatio || 1);
    const w = Math.max(1, view.innerWidth);
    const h = Math.max(1, view.innerHeight);
    const scale = Math.min(dpr, Math.sqrt(MAX_PIXELS / (w * h)));
    return [Math.round(w * scale), Math.round(h * scale)];
  };
  const draw = (blend = 1) => painter?.draw(scene.view, ...size(), blend);
  // Motion, one frame loop: a new sky cross-fades in over a second, and a
  // new camera (the real one, known once the walker exists) eases the
  // horizon to it rather than jumping.
  let fadeFrom = -1;
  let tween = null;
  const ease = (t) => t * t * (3 - 2 * t);
  const animate = () => {
    fadeFrame = 0;
    const now = performance.now();
    let blend = 1;
    let more = false;
    if (fadeFrom >= 0) {
      const t = Math.min(1, (now - fadeFrom) / 1000);
      blend = ease(t);
      if (t < 1) more = true;
      else {
        fadeFrom = -1;
        painter?.settle();
      }
    }
    if (tween) {
      const t = Math.min(1, (now - tween.start) / (tween.seconds * 1000));
      const k = ease(t);
      scene.view = { azimuth: tween.from.azimuth + (tween.to.azimuth - tween.from.azimuth) * k, pitch: tween.from.pitch + (tween.to.pitch - tween.from.pitch) * k };
      if (t < 1) more = true;
      else tween = null;
    }
    draw(blend);
    if (more && state !== "gone" && state !== "failed") fadeFrame = view.requestAnimationFrame(animate);
  };
  const kick = () => {
    if (!fadeFrame) fadeFrame = view.requestAnimationFrame(animate);
  };
  const fadeIn = () => {
    fadeFrom = performance.now();
    kick();
  };
  const setView = (next, seconds) => {
    const to = { azimuth: next.azimuth, pitch: next.pitch };
    const near = Math.abs(to.pitch - scene.view.pitch) < 1e-4 && Math.abs(to.azimuth - scene.view.azimuth) < 1e-4;
    if (near) return;
    if (reduced || !painter || seconds <= 0) {
      scene.view = to;
      tween = null;
      draw();
      return;
    }
    tween = { from: { ...scene.view }, to, start: performance.now(), seconds };
    kick();
  };
  const moveWisp = ([x, y], seconds) => {
    if (!wisp) return;
    wisp.style.setProperty("--move", `${reduced ? 0 : seconds}s`);
    wisp.style.setProperty("--x", `${(x * 100).toFixed(2)}vw`);
    wisp.style.setProperty("--y", `${(y * 100).toFixed(2)}vh`);
  };
  // Up from low over the sea toward the horizon as the world builds.
  const placeWisp = () => {
    const h = horizonAt(tween?.to ?? scene.view);
    moveWisp([0.5, h + (1 - h) * (0.62 - 0.5 * progress)], 2.4);
  };
  const paint = () => {
    const { celestial, weather } = scene;
    const next = [
      ...celestial.sun.map((x) => x.toFixed(3)),
      ...celestial.moon.map((x) => x.toFixed(2)),
      ...["cover", "low", "mid", "rain"].map((w) => (weather?.[w] ?? 0).toFixed(2)),
    ].join();
    const first = !table;
    if (next !== key) {
      key = next;
      table = skyTable(celestial, weather);
      if (first && canvas) {
        try {
          painter = createPainter(canvas);
        } catch (error) {
          console.warn("loading veil:", error);
          painter = null;
        }
      }
      painter?.set(table, !first && !reduced);
      if (painter && !first && !reduced) fadeIn();
      else draw();
    } else draw();
    // The same sky as a gradient: under the canvas, and the whole picture
    // where WebGL2 is missing.
    root.style.backgroundImage = cssSky(table, tween?.to ?? scene.view, view.innerWidth / Math.max(1, view.innerHeight));
    if (first) {
      if (painter) root.dataset.painted = "";
      view.performance?.mark?.("loading:painted");
      placeWisp();
    }
  };
  const safePaint = () => {
    try {
      paint();
    } catch (error) {
      // A picture is not worth a broken page: the static gradient stays.
      console.warn("loading veil:", error);
    }
  };
  view.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (state !== "loading") return;
      safePaint();
      placeWisp();
    }, 100);
  }, { signal: events.signal });
  // At once: index.html has already asked for main.js, which downloads
  // meanwhile.
  safePaint();

  const setProgress = (value) => {
    progress = value;
    root.style.setProperty("--glow", progress.toFixed(3));
    if (table && state === "loading") placeWisp();
  };
  setProgress(0.04);
  // Everything the veil runs stops here: listeners, frames, timers, the
  // GL context; the focus attribute comes off the body.
  const stop = () => {
    events.abort();
    clearTimeout(resizeTimer);
    view.cancelAnimationFrame?.(fadeFrame);
    view.cancelAnimationFrame?.(pullFrame);
    timers.forEach(clearTimeout);
    timers.length = 0;
    delete body?.dataset.focus;
    body?.style?.removeProperty?.("--horizon");
    painter?.dispose();
    painter = null;
  };
  const finish = (seconds) => {
    events.abort();
    timers.push(setTimeout(() => {
      state = "gone";
      stop();
      root.hidden = true;
      root.dataset.state = "gone";
    }, seconds * 1000));
  };
  // Evidence hook (`?perf`, scripts/loading-capture.mjs): paint the veil
  // over the finished world for a view, as it would have shown it.
  if (params.has("perf"))
    view.__veil = {
      show(v) {
        scene.view = { azimuth: v.azimuth, pitch: v.pitch };
        root.hidden = false;
        delete root.dataset.state;
        // A fresh canvas: the veil's own context was let go at the hand-over.
        painter?.dispose();
        const fresh = canvas.cloneNode();
        root.querySelector("canvas").replaceWith(fresh);
        painter = createPainter(fresh);
        painter.set(skyTable(scene.celestial, scene.weather));
        draw();
        return true;
      },
      hide() {
        root.hidden = true;
        painter?.dispose();
        painter = null;
        return true;
      },
      scene: () => scene,
    };
  return {
    // A milestone (STAGES) reached.
    progress(stage) {
      if (state !== "loading") return;
      setProgress(progressAt(stage, progress));
      view.performance?.mark?.(`loading:${stage}`);
    },
    // What the world will show: { celestial, weather, view } (any of them).
    // Nothing once the hand-over has begun.
    scene(next) {
      if (state !== "loading") return;
      if (next.celestial) scene.celestial = next.celestial;
      if (next.weather) {
        scene.weather = next.weather;
        if (next.weather.observedAt) remember(storage, next.weather);
      }
      safePaint();
      if (next.view) {
        setView(next.view, 1.2);
        root.style.backgroundImage = cssSky(table, next.view, view.innerWidth / Math.max(1, view.innerHeight));
        placeWisp();
        view.performance?.mark?.("loading:view", { detail: { pitch: next.view.pitch } });
      }
    },
    // The first frame is up. The world under the veil goes out of focus
    // (body[data-focus], index.html), the veil fades off it, and the focus
    // pulls in; the light sinks toward where the real wisp will rise.
    //
    // "The first frame is up" means drawn, not just asked for: the land
    // layer's first frame can sit behind seconds of shader compiles on a
    // slow machine, and fading the veil then showed the sea where the land
    // was about to appear. So the veil waits for a fence on the land
    // canvas's context to pass (polled, never blocking), and two frames.
    ready({ view: camera = null, cat = null } = {}) {
      if (state !== "loading") return;
      state = "arriving";
      view.performance?.mark?.("loading:ready", { detail: { pitch: camera?.pitch ?? null, veilPitch: (tween?.to ?? scene.view).pitch } });
      setProgress(1);
      // The real first camera, if it has moved since: the horizon follows it.
      if (camera) setView(camera, 0.3);
      const land = doc.querySelector?.("#landscape")?.getContext?.("webgl2") ?? null;
      let fence = null;
      try {
        fence = land?.fenceSync(land.SYNC_GPU_COMMANDS_COMPLETE, 0) ?? null;
        land?.flush();
      } catch {
        fence = null;
      }
      const started = performance.now();
      let after = 2;
      const wait = () => {
        pullFrame = 0;
        if (state !== "arriving") return;
        let done = !fence;
        if (fence) {
          const status = land.clientWaitSync(fence, 0, 0);
          done = status === land.ALREADY_SIGNALED || status === land.CONDITION_SATISFIED || status === land.WAIT_FAILED;
        }
        // At most 8 s: a lost context must not hold the veil for ever.
        if ((done && after-- <= 0) || performance.now() - started > 8000) {
          if (fence) land.deleteSync(fence);
          view.performance?.mark?.("loading:shown");
          return leave(camera, cat);
        }
        pullFrame = view.requestAnimationFrame(wait);
      };
      wait();
    },
    // No world after all: fade to the static fallback sky.
    fail() {
      if (state !== "loading" && state !== "arriving") return;
      state = "failed";
      root.dataset.state = "failed";
      delete body?.dataset.focus;
      finish(reduced ? 0 : 0.9);
    },
    dispose() {
      state = "gone";
      stop();
      root.hidden = true;
    },
  };

  // The hand-over itself, once the world's first frame is on screen.
  function leave(camera, cat) {
    state = "leaving";
    if (reduced) {
      root.dataset.state = "leaving";
      return finish(0.9);
    }
    const under = doc.querySelector?.(".focus");
    if (under) under.style.backgroundImage = root.style.backgroundImage;
    // The drawn sky fades off the world; the gradient under it must not
    // stay behind (without WebGL2 the whole veil fades instead).
    if (root.dataset.painted !== undefined) root.style.backgroundImage = "none";
    if (body) {
      body.style?.setProperty("--horizon", `${(horizonAt(scene.view) * 100).toFixed(2)}%`);
      body.dataset.focus = "soft";
      // Style the soft state before the pull, so the pull transitions.
      void body.offsetWidth;
    }
    root.dataset.state = "leaving";
    pullFrame = view.requestAnimationFrame(() => {
      if (body && state === "leaving") body.dataset.focus = "pull";
    });
    const aspect = view.innerWidth / Math.max(1, view.innerHeight);
    const rise = camera && cat ? project(camera, wispRise(cat), aspect) : null;
    if (rise && rise[0] > 0.04 && rise[0] < 0.96 && rise[1] > 0.04 && rise[1] < 0.96) moveWisp(rise, 1.3);
    finish(1.6);
  }
}

function recentWeather(storage) {
  try {
    const saved = JSON.parse(storage?.getItem(WEATHER_KEY) ?? "null");
    return saved && Date.now() - saved.observedAt < WEATHER_AGE_MS ? saved : null;
  } catch {
    return null;
  }
}

function remember(storage, { low, mid, high, cover, rain, observedAt }) {
  try {
    storage?.setItem(WEATHER_KEY, JSON.stringify({ low, mid, high, cover, rain, observedAt }));
  } catch {
    // Private windows may refuse; the veil then guesses a clear sky.
  }
}

function safeStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

// The veil main.js and index.html share.
export const loading = createLoadingScreen();
