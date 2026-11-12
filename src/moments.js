// Small moments around the thread: the line of type a discovery writes, the
// field-notes panel, the hint that teaches by doing, the arrival title, the
// camera drifting to watch the sky while the cat sits, and dawn arriving
// as a time-lapse while it sleeps through the night. DOM is written only
// when something changes; nothing here runs per frame except the lapse's
// arithmetic (and that only while it plays).
import { skyAt, dateAtCapeMinutes } from "./astronomy.js";
import { ISLAND } from "./terrain.js";

// A line of type that fades in, holds and fades out ("found · the hilltop").
// Lines arriving while one shows wait their turn.
export function createFindLine(el, { reduced = () => false, hold = 3600 } = {}) {
  const queue = [];
  let timer = 0;
  let busy = false;
  let paused = false;
  const next = () => {
    if (busy || paused || !queue.length || !el) return;
    busy = true;
    el.textContent = queue.shift();
    el.dataset.state = "in";
    timer = setTimeout(() => {
      el.dataset.state = "out";
      timer = setTimeout(() => {
        busy = false;
        next();
      }, reduced() ? 200 : 2200);
    }, hold);
  };
  return {
    show(text) {
      if (queue.length < 3) queue.push(text);
      next();
    },
    // Held back (the arrival title, photo mode) and let go again.
    pause(on) {
      paused = on;
      if (!on) next();
    },
    dispose() {
      clearTimeout(timer);
    },
  };
}

// The field notes: found things by name (with the Cape Town time each was
// found), the rest as dim dashes. Rendered from discoveries.list() only, so
// an unfound title never reaches the page.
export function createNotesPanel({ toggle, panel, list, signal, time = (at) => "" }) {
  const options = { signal };
  const items = panel?.querySelector("ol");
  let dirty = true;
  function render() {
    if (!items) return;
    dirty = false;
    const entries = list();
    const found = entries.filter((e) => e.found).length;
    const rows = entries.filter((e) => e.found).map((entry) => {
      const li = document.createElement("li");
      const name = document.createElement("span");
      name.textContent = entry.title;
      const when = document.createElement("time");
      when.textContent = time(entry.at);
      li.append(name, when);
      return li;
    });
    // What is still out there: one dim dash each, on one quiet line.
    const left = entries.length - found;
    if (left > 0) {
      const li = document.createElement("li");
      li.className = "unfound";
      li.setAttribute("aria-label", `${left} still to find`);
      li.textContent = Array(left).fill("–").join(" ");
      rows.push(li);
    }
    items.replaceChildren(...rows);
    panel.querySelector(".notes-empty")?.toggleAttribute("hidden", found > 0);
  }
  function show(open) {
    if (!panel) return;
    panel.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    if (open) {
      if (dirty) render();
      delete toggle.dataset.fresh;
    }
  }
  toggle?.addEventListener("click", () => show(panel.hidden), options);
  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape" && panel && !panel.hidden) {
        show(false);
        toggle.focus();
      }
    },
    options,
  );
  document.addEventListener(
    "pointerdown",
    (event) => {
      if (panel && !panel.hidden && !panel.contains(event.target) && !toggle.contains(event.target)) show(false);
    },
    options,
  );
  return {
    // Something new was found: redraw if open, otherwise mark the toggle.
    changed() {
      dirty = true;
      if (panel && !panel.hidden) render();
      else if (toggle) toggle.dataset.fresh = "true";
    },
    get open() {
      return panel ? !panel.hidden : false;
    },
    show,
  };
}

// The hint teaches by doing: one small line at a time, each gone once it has
// been done (and never shown again on this browser).
const LESSONS = [
  { id: "walk", mouse: "wasd or click to walk", touch: "tap the ground to walk", motion: true },
  { id: "look", mouse: "drag to look round · scroll to zoom", touch: "drag to look round · pinch to zoom", after: "walk", motion: true },
  { id: "run", mouse: "shift to run · space to jump", touch: null, after: "look", motion: true, when: (c) => c.moving },
  { id: "meow", mouse: "m to meow", touch: "tap the cat to hear it", after: "walk", when: (c) => c.sitting, motion: true },
  { id: "photo", mouse: "p for a photo", touch: "◎ for a photo", after: "look", when: (c) => c.found >= 2 || c.golden },
];

export function createLessons({ el, storage = safeStorage(), touch = false, reduced = () => false }) {
  const KEY = "skycope.lessons";
  let done = new Set();
  try {
    done = new Set(JSON.parse(storage?.getItem(KEY) ?? "[]"));
  } catch {
    done = new Set();
  }
  const mouse = el?.querySelector(".mouse");
  const tap = el?.querySelector(".touch");
  let current = null;
  let shownAt = 0;
  let quietUntil = 0;
  let enabled = false;
  const hide = () => {
    if (el && el.dataset.hidden !== "true") el.dataset.hidden = "true";
    current = null;
  };
  hide();
  return {
    // Lessons begin once the visitor can see the world.
    begin(now) {
      enabled = true;
      quietUntil = now + 1.5;
    },
    did(id, now = 0) {
      if (done.has(id)) return;
      done.add(id);
      try {
        storage?.setItem(KEY, JSON.stringify([...done]));
      } catch {
        // This visit only.
      }
      if (current?.id === id) {
        hide();
        quietUntil = now + 4;
      }
    },
    // A few times a second. ctx: { now, moving, sitting, found, golden, hidden }
    update(ctx) {
      if (!el) return;
      if (!enabled || ctx.hidden) return current && hide();
      if (current) {
        // A lesson nobody takes up fades after a while and comes back later.
        if (ctx.now - shownAt > 14) {
          hide();
          quietUntil = ctx.now + 25;
        }
        return;
      }
      if (ctx.now < quietUntil) return;
      const lesson = LESSONS.find(
        (l) =>
          !done.has(l.id) &&
          (!l.after || done.has(l.after)) &&
          (touch ? l.touch : l.mouse) &&
          !(l.motion && reduced()) &&
          (!l.when || l.when(ctx)),
      );
      if (!lesson) return;
      current = lesson;
      shownAt = ctx.now;
      if (mouse) mouse.textContent = lesson.mouse ?? "";
      if (tap) tap.textContent = lesson.touch ?? "";
      el.dataset.hidden = "false";
    },
    get current() {
      return current?.id ?? null;
    },
  };
}

// The arrival: the name in the middle of the view as the world sharpens,
// then gone, and the header in its place.
export function createArrival(el, { reduced = () => false } = {}) {
  const body = document.body;
  let timers = [];
  const finish = () => {
    timers.forEach(clearTimeout);
    timers = [];
    body.dataset.arrival = "done";
    if (el) el.hidden = true;
  };
  return {
    play(onDone = () => {}) {
      if (!el || reduced()) {
        finish();
        onDone();
        return;
      }
      el.hidden = false;
      // Two frames so the transition runs from the hidden state.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          el.dataset.state = "in";
        }),
      );
      timers.push(
        setTimeout(() => {
          el.dataset.state = "out";
          body.dataset.arrival = "settling";
        }, 2900),
        setTimeout(() => {
          finish();
          onDone();
        }, 5600),
      );
    },
    skip: finish,
  };
}

// Sit and watch: once the cat has sat a while and nobody has touched
// anything, the camera drifts round, slowly, to frame the sun, the moon or
// the sea horizon, and the UI dims. Any input hands the view back.
export function watchView(celestial, cat, spectacles = []) {
  const toCoast = ([e, u, n]) => [(e + n) * Math.SQRT1_2, u, (n - e) * Math.SQRT1_2];
  const altitude = (v) => (Math.asin(Math.max(-1, Math.min(1, v[1]))) * 180) / Math.PI;
  let target = null;
  for (const s of spectacles) if (s?.direction && (s.visible ?? 1) > 0.5) target = s.direction;
  if (!target && celestial) {
    const sun = celestial.sunAltitude;
    const moon = altitude(celestial.moon);
    if (sun > -3 && sun < 24) target = celestial.sun;
    else if (moon > -1 && moon < 28 && celestial.scene > 0.8) target = celestial.moon;
  }
  let yaw;
  let alt;
  if (target) {
    const [x, y, z] = toCoast(target);
    yaw = Math.atan2(x, z);
    alt = Math.asin(Math.max(-1, Math.min(1, y)));
  } else {
    // The open sea, straight out from where the cat sits.
    yaw = Math.atan2(cat.x - ISLAND.x, cat.z - ISLAND.z);
    alt = 0.04;
  }
  return { yaw, elevation: Math.max(0.04, Math.min(0.3, 0.2 - alt)), distance: 4.6 };
}

export function createWatch({ walker, body = document.body, wait = 22 }) {
  let watching = false;
  return {
    get watching() {
      return watching;
    },
    // ctx: { cat, idleInput (seconds since input), celestial, spectacles, blocked }
    update(ctx) {
      const ready = !ctx.blocked && ctx.cat.sit > 0.9 && ctx.cat.idle > wait && ctx.idleInput > wait;
      if (ready && !watching) {
        watching = true;
        walker.watch(watchView(ctx.celestial, ctx.cat, ctx.spectacles));
        body.dataset.watching = "true";
      } else if (!ready && watching) this.stop();
    },
    stop() {
      if (!watching) return;
      watching = false;
      walker.watch(null);
      delete body.dataset.watching;
    },
  };
}

// Sleeping through the night: curled up in the dark, the cat dreams and the
// sky runs on to dawn as a time-lapse. It is a preview (the time panel says
// so and offers live again); any input stops it where it is.
export function dawnMinutes(fromMinutes, date = new Date(), altitude = 1) {
  const sunAt = (m) => skyAt(previewDate(m, date)).sunAltitude;
  for (let m = fromMinutes; m < fromMinutes + 1440; m += 5)
    if (sunAt(m) >= altitude) {
      let lo = m - 5;
      let hi = m;
      for (let i = 0; i < 8; i++) {
        const mid = (lo + hi) / 2;
        if (sunAt(mid) >= altitude) hi = mid;
        else lo = mid;
      }
      return hi;
    }
  return null;
}

// Fractional, unwrapped preview minutes (past 1440 is tomorrow) to a date.
export function previewDate(minutes, date = new Date()) {
  const whole = Math.floor(minutes);
  return new Date(dateAtCapeMinutes(whole, date).getTime() + (minutes - whole) * 60000);
}

export function createDawnLapse({ preview, onStart = () => {}, onEnd = () => {} }) {
  let asleepFor = 0;
  let minutes = 0;
  let dawn = null;
  let active = false;
  let lastLabel = 0;
  const stop = (reason) => {
    if (!active) return;
    active = false;
    preview(minutes, true);
    onEnd(reason);
  };
  return {
    get active() {
      return active;
    },
    // ctx: { asleep, sunAltitude, nowMinutes (unwrapped, fractional), date, blocked, realDt }
    update(ctx, dt) {
      if (!active) {
        asleepFor = ctx.asleep && !ctx.blocked ? asleepFor + dt : 0;
        if (asleepFor > 6 && ctx.sunAltitude < -8) {
          minutes = ctx.nowMinutes;
          dawn = dawnMinutes(minutes, ctx.date);
          if (dawn === null) return;
          active = true;
          asleepFor = 0;
          lastLabel = 0;
          onStart();
        }
        return;
      }
      if (!ctx.asleep || ctx.blocked) return stop("woke");
      // Quick through the small hours, slowing as the sky pales.
      const remaining = dawn - minutes;
      const rate = Math.max(0.8, Math.min(15, remaining * 0.12));
      minutes = Math.min(dawn, minutes + rate * dt);
      lastLabel += dt;
      const label = lastLabel > 0.25;
      if (label) lastLabel = 0;
      preview(minutes, label);
      if (minutes >= dawn) stop("dawn");
    },
    stop,
  };
}

function safeStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
