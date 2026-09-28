// Weather controls: the live Open-Meteo estimate by default, or a preset or
// hand-tuned sky. Presets use the same fields the renderer reads from the live
// forecast (low/mid/high cloud decks, overall cover, rain in mm/h, wind as an
// east/north vector in m/s). Nothing here renders; it only produces weather.
export const WEATHER_PRESETS = {
  clear: { low: 0, mid: 0, high: 0.12, cover: 0.05, rain: 0, speed: 3.5, direction: 150, temperature: 23, description: "clear sky" },
  cloudy: { low: 0.5, mid: 0.2, high: 0.4, cover: 0.55, rain: 0, speed: 5, direction: 160, temperature: 19, description: "partly cloudy" },
  overcast: { low: 0.9, mid: 0.6, high: 0.5, cover: 0.95, rain: 0, speed: 6, direction: 170, temperature: 16, description: "overcast" },
  rain: { low: 0.95, mid: 0.75, high: 0.8, cover: 1, rain: 3, speed: 8, direction: 320, temperature: 14, description: "rain" },
  storm: { low: 1, mid: 0.9, high: 0.9, cover: 1, rain: 8, speed: 15, direction: 300, temperature: 12, description: "storm" },
};

// Cloud decks scale together with the single cover slider, keeping the
// low-deck-heavy structure of Cape Town's usual stratocumulus.
function fromControls({ cover, speed, direction, rain }) {
  const angle = ((direction + 180) * Math.PI) / 180;
  return {
    low: Math.min(1, cover * 0.95),
    mid: Math.min(1, cover * 0.6),
    high: Math.min(1, 0.1 + cover * 0.6),
    cover,
    rain,
    wind: [Math.sin(angle) * speed, Math.cos(angle) * speed],
  };
}

export function presetWeather(name) {
  const p = WEATHER_PRESETS[name];
  if (!p) return null;
  const angle = ((p.direction + 180) * Math.PI) / 180;
  return {
    low: p.low,
    mid: p.mid,
    high: p.high,
    cover: p.cover,
    rain: p.rain,
    wind: [Math.sin(angle) * p.speed, Math.cos(angle) * p.speed],
    temperature: p.temperature,
    description: p.description,
    preset: name,
    observedAt: Date.now(),
  };
}

const COMPASS = ["n", "ne", "e", "se", "s", "sw", "w", "nw"];
const compass = (degrees) => COMPASS[Math.round(degrees / 45) % 8];

// `onChange(override)` receives null for live weather, or a weather object.
export function createWeatherPanel({ toggle, panel, onChange, initial, signal }) {
  const options = { signal };
  const buttons = [...panel.querySelectorAll("[data-preset]")];
  const sliders = Object.fromEntries(
    ["cover", "speed", "direction", "rain"].map((name) => [
      name,
      panel.querySelector(`[name="${name}"]`),
    ]),
  );
  const outputs = Object.fromEntries(
    Object.keys(sliders).map((name) => [name, panel.querySelector(`output[for="weather-${name}"]`)]),
  );
  let selected = initial && WEATHER_PRESETS[initial] ? initial : "live";

  function show(open) {
    panel.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    if (open) (buttons.find((b) => b.getAttribute("aria-pressed") === "true") ?? buttons[0]).focus();
  }

  function label() {
    const v = Object.fromEntries(Object.entries(sliders).map(([k, el]) => [k, Number(el.value)]));
    outputs.cover.textContent = `${v.cover}%`;
    outputs.speed.textContent = `${v.speed} m/s`;
    outputs.direction.textContent = `${compass(v.direction)} ${v.direction}°`;
    outputs.rain.textContent = `${v.rain} mm/h`;
    return v;
  }

  // Sliders mirror the selection; they are disabled while following live data.
  function sync(weather) {
    buttons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.preset === selected)));
    panel.dataset.mode = selected;
    const live = selected === "live";
    Object.values(sliders).forEach((el) => (el.disabled = live));
    if (weather) {
      const speed = Math.hypot(weather.wind[0], weather.wind[1]);
      const direction = ((Math.atan2(weather.wind[0], weather.wind[1]) * 180) / Math.PI + 180 + 360) % 360;
      sliders.cover.value = Math.round(weather.cover * 100);
      sliders.speed.value = Math.round(speed);
      sliders.direction.value = Math.round(direction / 5) * 5 % 360;
      sliders.rain.value = Math.round(weather.rain * 2) / 2;
    }
    label();
  }

  function choose(name) {
    selected = name;
    const weather = name === "live" ? null : presetWeather(name);
    onChange(weather);
    return weather;
  }

  toggle.addEventListener("click", () => show(panel.hidden), options);
  buttons.forEach((button) =>
    button.addEventListener(
      "click",
      () => sync(choose(button.dataset.preset) ?? panelLive()),
      options,
    ),
  );
  Object.values(sliders).forEach((el) =>
    el.addEventListener(
      "input",
      () => {
        const v = label();
        selected = "custom";
        buttons.forEach((b) => b.setAttribute("aria-pressed", "false"));
        panel.dataset.mode = "custom";
        onChange({
          ...fromControls({ cover: v.cover / 100, speed: v.speed, direction: v.direction, rain: v.rain }),
          temperature: null,
          description: v.rain >= 6 ? "storm" : v.rain > 0 ? "rain" : v.cover > 0.85 ? "overcast" : v.cover > 0.25 ? "partly cloudy" : "clear sky",
          preset: "custom",
          observedAt: Date.now(),
        });
      },
      options,
    ),
  );
  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape" && !panel.hidden) {
        show(false);
        toggle.focus();
      }
    },
    options,
  );
  document.addEventListener(
    "pointerdown",
    (event) => {
      if (!panel.hidden && !panel.contains(event.target) && !toggle.contains(event.target)) show(false);
    },
    options,
  );

  let liveWeather = null;
  function panelLive() {
    return liveWeather;
  }

  const first = selected === "live" ? null : presetWeather(selected);
  sync(first);
  return {
    initial: first,
    // Keep the sliders showing live values while following the forecast.
    setLive(weather) {
      liveWeather = weather;
      if (selected === "live") sync(weather);
    },
  };
}
