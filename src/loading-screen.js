// The loading veil: a coarse, gently moving pixel sky over a pixel sea, at
// the same block size the world first renders at (main.js REVEAL), so the
// hand-over reads as one image sharpening. Lifts on the first frame; on
// failure it lifts and the static fallback sky shows through.
const BLOCKS = 32;

export function createLoadingScreen({ document: doc = globalThis.document } = {}) {
  const root = doc?.querySelector("#loading-screen");
  if (!root) return { stage() {}, ready() {}, fail() {}, dispose() {} };
  const view = doc.defaultView;
  const reduced = view?.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const canvas = root.querySelector("canvas");
  const context = canvas?.getContext?.("2d");
  let timer = null;
  let raf = 0;
  let last = 0;

  const paint = (now) => {
    raf = view.requestAnimationFrame(paint);
    if (now - last < 66) return; // ~15 fps is plenty for a slow shimmer
    last = now;
    const w = BLOCKS;
    const h = Math.max(8, Math.round((BLOCKS * view.innerHeight) / Math.max(1, view.innerWidth)));
    if (canvas.width !== w || canvas.height !== h) Object.assign(canvas, { width: w, height: h });
    const image = context.createImageData(w, h);
    const t = now / 1000;
    const horizon = Math.round(h * 0.58);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const n = noise(x * 0.35 + t * 0.15, y * 0.5) * 0.6 + noise(x * 0.9 - t * 0.3, y * 1.3 + t * 0.2) * 0.4;
        let r, g, b;
        if (y < horizon) {
          // Sky: deep blue overhead to a pale haze at the horizon, with soft
          // drifting cloud cells.
          const up = 1 - y / horizon;
          r = 150 - up * 95;
          g = 192 - up * 72;
          b = 222 - up * 22;
          const cloud = Math.max(0, n - 0.55) * 2.2 * (0.4 + up * 0.6);
          r += (236 - r) * cloud;
          g += (240 - g) * cloud;
          b += (244 - b) * cloud;
        } else {
          // Sea: turquoise shallows to deeper blue, glitter cells drifting.
          const down = (y - horizon) / (h - horizon);
          r = 60 - down * 30;
          g = 132 + down * 40;
          b = 160 + down * 10;
          const glint = Math.max(0, noise(x * 1.7 + t * 0.9, y * 2.3 - t * 0.6) - 0.72) * 3;
          r += (225 - r) * glint;
          g += (240 - g) * glint;
          b += (245 - b) * glint;
        }
        image.data[i] = r;
        image.data[i + 1] = g;
        image.data[i + 2] = b;
        image.data[i + 3] = 255;
      }
    context.putImageData(image, 0, 0);
  };
  if (context && !reduced) raf = view.requestAnimationFrame(paint);
  else if (context) paint(0);

  const hide = (fade) => {
    clearTimeout(timer);
    root.dataset.state = "leaving";
    const stop = () => {
      root.hidden = true;
      view?.cancelAnimationFrame?.(raf);
    };
    if (!fade || reduced) stop();
    else timer = setTimeout(stop, 700);
  };
  return {
    stage() {},
    ready: () => hide(true),
    fail: () => hide(false),
    dispose: () => hide(false),
  };
}

// Smooth value noise, 0…1.
function noise(x, y) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy) + (hash(ix + 1, iy) - hash(ix, iy)) * u;
  const b = hash(ix, iy + 1) + (hash(ix + 1, iy + 1) - hash(ix, iy + 1)) * u;
  return a + (b - a) * v;
}

function hash(x, y) {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}
