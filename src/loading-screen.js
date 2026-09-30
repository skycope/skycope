// A plain "loading" veil over the page until the first frame is presented.
// If the scene fails, it lifts and the static fallback sky shows through.
export function createLoadingScreen({ document: doc = globalThis.document } = {}) {
  const root = doc?.querySelector("#loading-screen");
  if (!root) return { stage() {}, ready() {}, fail() {}, dispose() {} };
  let timer = null;
  const hide = (fade) => {
    clearTimeout(timer);
    root.dataset.state = "leaving";
    const reduced = doc.defaultView?.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (!fade || reduced) root.hidden = true;
    else timer = setTimeout(() => { root.hidden = true; }, 450);
  };
  return {
    stage() {},
    ready: () => hide(true),
    fail: () => hide(false),
    dispose: () => hide(false),
  };
}
