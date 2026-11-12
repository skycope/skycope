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
// Above them, the six gifts as small marks, dim until woken and lit in
// their colour after; and once any is awake, a quiet "begin again".
// gifts() → [{ gift, awake, line, colour: [r, g, b] }].
// Fine line marks, drawn as with a mapping pen.
const GLYPHS = {
  fireflies: '<circle cx="3" cy="9.2" r="1"/><circle cx="7" cy="3.6" r="1.25"/><circle cx="10.4" cy="8" r="0.75"/><path d="M3.8 8.4C5 7 5.6 5.6 6.2 4.6M7.9 4.4c1.1.9 1.9 2 2.2 2.9" stroke-dasharray="0.4 1.1"/>',
  tideglow: '<path d="M1 7.6c1.3-1.6 2.6-1.6 3.8 0s2.6 1.6 3.8 0 2.4-1.5 3.4-.4M2.4 10.4c1-.9 2-.9 3 0s2 .9 3 0"/><circle cx="6.5" cy="3.4" r="0.6"/>',
  lamp: '<path d="M5.4 12V5.2h2.2V12M4.3 12h4.4M5.1 5.2h2.8M6.5 5.2V3.6M8.6 4.2l3.6-1.4M8.6 4.8l3.6 1.2"/>',
  stars: '<path d="M6.5 1.2C6.8 4.6 7.6 5.6 11.2 6.2 7.6 6.8 6.8 7.8 6.5 11.4 6.2 7.8 5.4 6.8 1.8 6.2 5.4 5.6 6.2 4.6 6.5 1.2z"/><circle cx="11" cy="2.2" r="0.5"/>',
  seafolk: '<path d="M2 6.8c1.8-2.6 5.4-2.8 7.4-.2-2 2.4-5.6 2.4-7.4.2zM9.4 6.6 11.6 5v3.2zM1.2 10.6c1.4-.9 2.8-.9 4.2 0s2.8.9 4.2 0"/>',
  boat: '<path d="M1.4 8.4h10.2c-.8 1.9-2.4 2.8-5.1 2.8S2.2 10.3 1.4 8.4zM6.4 8.4V1.6M6.4 2.2c2 1.5 3.2 3.4 3.4 5.4H6.4"/>',
};

export function createNotesPanel({ toggle, panel, list, signal, time = (at) => "", gifts = () => [], onBeginAgain = null }) {
  const options = { signal };
  const items = panel?.querySelector("ol");
  const marks = panel?.querySelector(".gift-marks");
  const again = panel?.querySelector(".begin-again");
  const dots = toggle?.querySelector(".gift-dots");
  let dirty = true;
  let confirmUntil = 0;
  again?.addEventListener(
    "click",
    () => {
      if (performance.now() < confirmUntil) {
        confirmUntil = 0;
        again.textContent = "begin again";
        onBeginAgain?.();
        render();
        return;
      }
      confirmUntil = performance.now() + 4000;
      again.textContent = "begin again? · yes";
      setTimeout(() => {
        if (performance.now() >= confirmUntil) again.textContent = "begin again";
      }, 4100);
    },
    options,
  );
  function renderGifts() {
    const list = gifts();
    const awake = list.filter((g) => g.awake && g.gift !== "finale").length;
    if (marks) {
      marks.replaceChildren(
        ...list
          .filter((g) => GLYPHS[g.gift])
          .map((g) => {
            const span = document.createElement("span");
            span.className = "gift-mark";
            span.dataset.awake = String(g.awake);
            if (g.awake) span.style.setProperty("--glow", `rgb(${g.colour.map((c) => Math.round(c * 255)).join(" ")})`);
            span.title = g.awake ? g.line : "asleep";
            span.innerHTML = `<svg viewBox="0 0 13 13" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="0.8" stroke-linecap="round" stroke-linejoin="round">${GLYPHS[g.gift]}</svg>`;
            return span;
          }),
      );
      marks.setAttribute("aria-label", `${awake} of six gifts awake`);
      marks.hidden = list.length === 0;
    }
    if (again) again.hidden = awake === 0;
    if (dots) {
      dots.hidden = awake === 0;
      dots.replaceChildren(
        ...list
          .filter((g) => GLYPHS[g.gift])
          .map((g) => {
            const i = document.createElement("i");
            if (g.awake) i.style.background = `rgb(${g.colour.map((c) => Math.round(c * 255)).join(" ")})`;
            return i;
          }),
      );
    }
  }
  function render() {
    renderGifts();
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
      else {
        renderGifts();
        if (toggle) toggle.dataset.fresh = "true";
      }
    },
    // The gifts changed quietly (restored on load, begun again).
    refresh() {
      dirty = true;
      renderGifts();
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

// A gift's card: a small line (the place) over a larger one (what woke),
// faded in high in the view, held, and gone. `grand` is the finale's title,
// in the manner of the arrival. Written only when shown.
export function createGiftCard(el, { reduced = () => false } = {}) {
  const small = el?.querySelector(".gift-small");
  const big = el?.querySelector(".gift-big");
  let timers = [];
  const clear = () => {
    timers.forEach(clearTimeout);
    timers = [];
  };
  return {
    show(top, line, hold = 4.5, grand = false) {
      if (!el) return;
      clear();
      if (small) small.textContent = top;
      if (big) big.textContent = line;
      el.dataset.grand = String(grand);
      el.hidden = false;
      requestAnimationFrame(() => requestAnimationFrame(() => (el.dataset.state = "in")));
      timers.push(
        setTimeout(() => (el.dataset.state = "out"), hold * 1000),
        setTimeout(() => {
          el.hidden = true;
          delete el.dataset.state;
        }, hold * 1000 + (reduced() ? 300 : 3000)),
      );
    },
    dispose: clear,
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
