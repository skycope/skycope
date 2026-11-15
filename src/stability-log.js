// stability: the `?perf` event log that scripts/stability.mjs reads. Every
// subsystem that changes what is on screen by itself (the render budget, a
// resize, the reveal, a shadow refresh, prewarm, an LOD switch, a time or
// weather change) notes it here with a wall-clock timestamp, and main.js
// records each rendered frame's camera, so a captured frame that steps,
// pops or blanks can be traced to what changed that frame. Without `?perf`
// both calls are no-ops and nothing is kept.
const enabled = typeof location !== "undefined" && new URLSearchParams(location.search).has("perf");
const events = [];
const frames = [];
const origin = typeof performance !== "undefined" ? performance.timeOrigin : 0;

// Wall-clock milliseconds (the screencast's clock).
export function wallNow() {
  return origin + performance.now();
}

export function note(kind, detail = null) {
  if (!enabled) return;
  events.push(detail ? { t: wallNow(), kind, ...detail } : { t: wallNow(), kind });
  if (events.length > 20000) events.splice(0, 10000);
}

// One rendered frame: [t, x, y, z, azimuth, pitch, budget level].
export function noteFrame(view, level) {
  if (!enabled) return;
  frames.push([wallNow(), view.x, view.y, view.z, view.azimuth, view.pitch, level]);
  if (frames.length > 40000) frames.splice(0, 20000);
}

export const stabilityLog = enabled
  ? {
      // Everything since the last drain (the detector drains every second).
      drain() {
        const out = { events: events.slice(), frames: frames.slice() };
        events.length = 0;
        frames.length = 0;
        return out;
      },
    }
  : null;
