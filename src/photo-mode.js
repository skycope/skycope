// Photo mode: every bit of UI away, the cat holds still, the camera is the
// viewer's (orbit and zoom ease), time flows unless paused. The shutter
// renders a frame and reads both canvases (the WebGPU sky and sea, the WebGL
// land over it) in the same task, so neither needs preserveDrawingBuffer;
// it composites them with the CSS vignette, optionally crops to a wide
// frame and adds a small caption, and shares (phones) or downloads the PNG.

export const WIDE = 2.39;

// Draws `layers` (canvases, bottom first, each stretched over the frame)
// into a new canvas `width` × `height`, with the page's vignette.
export function composePhoto(layers, { width, height, wide = false, caption = "", doc = document, font = "Departure Mono" }) {
  const full = doc.createElement("canvas");
  full.width = width;
  full.height = height;
  const g = full.getContext("2d");
  g.fillStyle = "#000";
  g.fillRect(0, 0, width, height);
  g.imageSmoothingQuality = "high";
  for (const layer of layers) if (layer?.width && layer?.height) g.drawImage(layer, 0, 0, width, height);
  // index.html .vignette: radial-gradient(ellipse farthest-corner, ...).
  g.save();
  g.translate(width / 2, height / 2);
  g.scale((width / 2) * Math.SQRT2, (height / 2) * Math.SQRT2);
  const v = g.createRadialGradient(0, 0, 0, 0, 0, 1);
  v.addColorStop(0, "rgba(0,0,0,0)");
  v.addColorStop(0.35, "rgba(0,0,0,0.012)");
  v.addColorStop(0.7, "rgba(0,0,0,0.045)");
  v.addColorStop(1, "rgba(0,0,0,0.1)");
  g.fillStyle = v;
  g.fillRect(-1, -1, 2, 2);
  g.restore();
  let out = full;
  if (wide && width / height < WIDE + 0.01) {
    const h = Math.round(width / WIDE);
    out = doc.createElement("canvas");
    out.width = width;
    out.height = h;
    out.getContext("2d").drawImage(full, 0, Math.round((height - h) / 2), width, h, 0, 0, width, h);
  } else if (wide) {
    const w = Math.round(height * WIDE);
    out = doc.createElement("canvas");
    out.width = w;
    out.height = height;
    out.getContext("2d").drawImage(full, Math.round((width - w) / 2), 0, w, height, 0, 0, w, height);
  }
  if (caption) {
    const c = out.getContext("2d");
    const size = Math.max(12, Math.round(out.height * 0.017));
    c.font = `${size}px "${font}", ui-monospace, monospace`;
    c.textBaseline = "alphabetic";
    c.fillStyle = "rgba(246, 243, 234, 0.86)";
    c.shadowColor = "rgba(15, 30, 40, 0.45)";
    c.shadowBlur = size * 0.8;
    const margin = Math.round(Math.max(size * 1.6, out.height * 0.035));
    c.fillText(caption, margin, out.height - margin);
  }
  return out;
}

export function createPhotoMode({ bar, button, guide, flash, signal, capture, caption = () => "", onChange = () => {}, reduced = () => false, touch = false }) {
  const options = { signal };
  const body = document.body;
  const status = bar?.querySelector(".photo-status");
  const control = (name) => bar?.querySelector(`[data-photo="${name}"]`);
  const state = { active: false, paused: false, wide: false, caption: false, saving: false, last: null };
  let idleTimer = 0;
  let statusTimer = 0;

  const sync = () => {
    control("frame")?.setAttribute("aria-pressed", String(state.wide));
    control("caption")?.setAttribute("aria-pressed", String(state.caption));
    const pause = control("pause");
    if (pause) {
      pause.setAttribute("aria-pressed", String(state.paused));
      pause.textContent = state.paused ? "time paused" : "pause time";
    }
    if (guide) guide.dataset.wide = String(state.active && state.wide);
  };
  const say = (text) => {
    if (!status) return;
    clearTimeout(statusTimer);
    status.textContent = text;
    statusTimer = setTimeout(() => (status.textContent = ""), 2400);
  };
  // The bar steps back when the pointer rests, and comes back on movement.
  const wake = () => {
    if (!state.active || !bar) return;
    if (bar.dataset.idle === "true") bar.dataset.idle = "false";
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (!bar.matches(":focus-within")) bar.dataset.idle = "true";
    }, 2800);
  };

  function enter() {
    if (state.active) return;
    state.active = true;
    body.dataset.photo = "true";
    if (bar) bar.hidden = false;
    sync();
    wake();
    onChange(state);
    bar?.querySelector(".shutter")?.focus({ preventScroll: true });
  }
  function exit() {
    if (!state.active) return;
    state.active = false;
    state.paused = false;
    delete body.dataset.photo;
    if (bar) bar.hidden = true;
    clearTimeout(idleTimer);
    sync();
    onChange(state);
    button?.focus({ preventScroll: true });
  }
  async function save() {
    if (!state.active || state.saving) return null;
    state.saving = true;
    try {
      // Render and read in this task; the shot restores the live view.
      const shot = capture();
      if (!shot) return null;
      let photo;
      try {
        photo = composePhoto(shot.layers, { width: shot.width, height: shot.height, wide: state.wide, caption: state.caption ? caption() : "" });
      } finally {
        shot.restore();
      }
      if (flash && !reduced()) {
        flash.dataset.on = "true";
        requestAnimationFrame(() => requestAnimationFrame(() => (flash.dataset.on = "false")));
      }
      const blob = await new Promise((resolve) => photo.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("no image");
      state.last = blob;
      const how = await deliver(blob, fileName(caption()));
      say(how === "shared" ? "shared" : how === "cancelled" ? "" : "saved");
      return blob;
    } catch (error) {
      console.warn("Photo:", error);
      say("could not save");
      return null;
    } finally {
      state.saving = false;
    }
  }
  async function deliver(blob, name) {
    // Phones share (to photos, messages...); desktops download.
    const file = typeof File === "function" ? new File([blob], name, { type: "image/png" }) : null;
    if (touch && file && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: "Sky Cope" });
        return "shared";
      } catch (error) {
        if (error?.name === "AbortError") return "cancelled";
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.rel = "noopener";
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return "downloaded";
  }

  const actions = {
    frame() {
      state.wide = !state.wide;
      sync();
    },
    caption() {
      state.caption = !state.caption;
      sync();
    },
    pause() {
      state.paused = !state.paused;
      sync();
      onChange(state);
    },
    exit,
  };
  button?.addEventListener("click", () => (state.active ? exit() : enter()), options);
  bar?.querySelector(".shutter")?.addEventListener("click", () => save(), options);
  for (const [name, act] of Object.entries(actions)) control(name)?.addEventListener("click", act, options);
  window.addEventListener("pointermove", wake, { ...options, passive: true });
  window.addEventListener("pointerdown", wake, { ...options, passive: true });
  sync();

  return {
    get active() {
      return state.active;
    },
    get paused() {
      return state.active && state.paused;
    },
    get last() {
      return state.last;
    },
    enter,
    exit,
    toggle: () => (state.active ? exit() : enter()),
    save,
    // Keys while in photo mode; returns true if the key was taken.
    key(key) {
      if (key === "p" && !state.active) {
        enter();
        return true;
      }
      if (!state.active) return false;
      wake();
      if (key === "p" || key === "escape") exit();
      else if (key === "s" || key === "enter") save();
      else if (key === " ") actions.pause();
      else if (key === "c") actions.caption();
      else if (key === "f") actions.frame();
      else return false;
      return true;
    },
  };
}

function fileName(caption) {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, (c) => (c === "T" ? "-" : c === ":" ? "" : "-"));
  return `sky-cope-${stamp}.png`;
}
