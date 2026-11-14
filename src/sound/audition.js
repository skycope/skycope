// /?audition: a plain page listing every sound cue (catalog.js) with a
// play button, numbered to match the owner's listening checklist
// (docs/design/sound-plan.md section 10), so each can be heard alone.
// No world loads; the listener stands at the origin facing ahead.
import { createSound } from "../sound.js";
import { CUES, CHECKLIST, AUDITION_BASE, startCue, sceneInput } from "./catalog.js";

export function numbered() {
  const counts = {};
  return CUES.map((cue) => {
    counts[cue.n] = (counts[cue.n] ?? 0) + 1;
    return { ...cue, number: `${cue.n}.${counts[cue.n]}` };
  });
}

export function mount(root = document.body) {
  document.title = "Sky Cope · sound audition";
  root.innerHTML = "";
  root.removeAttribute("data-scene");
  const style = document.createElement("style");
  style.textContent = `
    body { margin: 0; background: #f4f1ea; color: #1d2a30; font: 15px/1.45 "Departure Mono", ui-monospace, monospace; }
    main { max-width: 860px; margin: 0 auto; padding: 24px 16px 80px; }
    h1 { font-size: 20px; margin: 0 0 6px; }
    h2 { font-size: 16px; margin: 28px 0 8px; border-bottom: 1px solid #c9c2b4; padding-bottom: 4px; }
    p.note { margin: 0 0 12px; color: #4b5a60; }
    ol { list-style: none; padding: 0; margin: 0; }
    li { display: grid; grid-template-columns: 3.2em 4.6em 1fr; gap: 10px; align-items: start; padding: 6px 0; border-bottom: 1px dotted #ddd6c8; }
    li .num { color: #6b7a80; padding-top: 4px; }
    li .what b { font-weight: normal; display: block; }
    li .what span { color: #55666c; font-size: 13px; }
    button { font: inherit; padding: 4px 10px; border: 1px solid #1d2a30; background: #fff; border-radius: 4px; cursor: pointer; }
    button.playing { background: #1d2a30; color: #fff; }
    .bar { position: sticky; top: 0; background: #f4f1ea; padding: 8px 0; display: flex; gap: 10px; align-items: center; z-index: 1; }
    .bar span { color: #4b5a60; font-size: 13px; }
  `;
  document.head.append(style);
  const main = document.createElement("main");
  main.innerHTML = `<h1>Sound audition</h1>
    <p class="note">Every sound the island makes, one at a time. Nobody has listened to these yet: they were tuned by measurement only.
    Please report by number (for example "2.3 too loud", "8.5 sounds like static", "5.1 ok"). Headphones first, then laptop speakers, then a phone,
    at the volume you would play music at. Scenes run for the time shown; positioned sounds come from where the name says.</p>`;
  const bar = document.createElement("div");
  bar.className = "bar";
  bar.innerHTML = `<button type="button" data-stop>stop</button><span data-status>tap a play button</span>`;
  main.append(bar);
  root.append(main);

  let sound = null;
  let running = null;
  const status = bar.querySelector("[data-status]");

  function ensure() {
    if (!sound) {
      sound = createSound({ storage: null, seed: 1 });
      sound.setMusic(false);
    }
    sound.start();
    sound._qa?.ctx.resume();
    return sound;
  }

  function stop() {
    if (running) {
      cancelAnimationFrame(running.frame);
      running.button.classList.remove("playing");
      running.cue.teardown?.(sound);
      sound?.setPurr(false);
      running = null;
    }
    if (sound) {
      sound.dispose();
      sound = null;
    }
    status.textContent = "stopped";
  }
  bar.querySelector("[data-stop]").addEventListener("click", stop);

  function play(cue, button) {
    if (running) stop();
    const s = ensure();
    // A new engine each time, so nothing from the last cue lingers.
    s.update({ ...AUDITION_BASE, beds: false });
    const begun = performance.now();
    if (cue.scene) s.update(sceneInput(s, cue, 0));
    else startCue(s, cue);
    button.classList.add("playing");
    status.textContent = `${cue.number} ${cue.name}`;
    running = { cue, button, frame: 0 };
    const tick = () => {
      const t = (performance.now() - begun) / 1000;
      if (!running || running.cue !== cue) return;
      if (t > cue.seconds + 0.5) {
        button.classList.remove("playing");
        cue.teardown?.(s);
        running = null;
        status.textContent = `${cue.number} done`;
        return;
      }
      s.update(cue.scene ? sceneInput(s, cue, t) : { ...AUDITION_BASE, beds: false });
      running.frame = requestAnimationFrame(tick);
    };
    running.frame = requestAnimationFrame(tick);
  }

  const list = numbered();
  for (const item of CHECKLIST) {
    const h = document.createElement("h2");
    h.textContent = `${item.n}. ${item.title}`;
    main.append(h);
    const ol = document.createElement("ol");
    for (const cue of list.filter((c) => c.n === item.n)) {
      const li = document.createElement("li");
      li.innerHTML = `<span class="num">${cue.number}</span><span><button type="button">play</button></span><span class="what"><b></b><span></span></span>`;
      li.querySelector("b").textContent = `${cue.name}${cue.scene ? "" : ""}`;
      li.querySelector(".what span").textContent = `should sound like: ${cue.says}`;
      const button = li.querySelector("button");
      button.addEventListener("click", () => play(cue, button));
      li.dataset.cue = cue.id;
      ol.append(li);
    }
    main.append(ol);
  }
  return { play: (id) => play(list.find((c) => c.id === id), main.querySelector(`[data-cue="${id}"] button`)), stop };
}
