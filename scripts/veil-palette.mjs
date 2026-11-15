// The loading veil's very first colours: a small table, inlined in
// index.html, that a few lines of plain script turn into the sky of this
// moment as the page's first paint, before any module has downloaded
// (src/loading-screen.js then draws the exact sky over it).
//
// For the sun at each altitude, morning and evening (15 Nov, clear, no
// moon), the home view's colours down the centre of the frame, from
// loading-sky.js itself. tests/loading-screen.test.js checks the inlined
// block is what this writes.
//
//   node scripts/veil-palette.mjs        (rewrites the block in index.html)
import { readFileSync, writeFileSync } from "node:fs";
import { HOME_VIEW, cssStops, skyTable } from "../src/loading-sky.js";
import { skyAt } from "../src/astronomy.js";
import { presetWeather } from "../src/weather-panel.js";

// Every 1.5° through twilight and the low sun (where the sky changes
// fastest), every 6° above 12°.
export const ALTITUDES = [...Array.from({ length: 21 }, (_, k) => -18 + k * 1.5), ...Array.from({ length: 10 }, (_, k) => 18 + k * 6)];
const SKY = 5;
const SEA = 3;

// Cape Town's sun: altitude in degrees and whether it is morning (NOAA's
// short formulae; within half a degree of suncalc). Inlined as written, so
// the table is indexed by the same numbers the page computes.
export function capeSun(now) {
  var r = Math.PI / 180;
  var g = ((2 * Math.PI) / 365) * ((now - Date.UTC(now.getUTCFullYear(), 0, 1)) / 864e5);
  var dec = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  var eq = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  var minutes = now.getUTCHours() * 60 + now.getUTCMinutes() + now.getUTCSeconds() / 60;
  var hour = ((minutes + eq + 4 * 18.4241) / 4 - 180) * r;
  var lat = -33.9249 * r;
  return { altitude: Math.asin(Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(hour)) / r, morning: hour < 0 };
}

export function palette() {
  const minutes = Array.from({ length: 1440 }, (_, m) => {
    const date = new Date(Date.UTC(2026, 10, 15, 0, m) - 2 * 3600000);
    return { m, date, sun: capeSun(date) };
  });
  // Clear, and under a deck (the overcast preset): the page picks one from
  // `?weather=` or the last forecast it saw, as loading-screen.js does.
  const rows = {};
  for (const [sky, weather] of [["clear", null], ["grey", presetWeather("overcast")]])
    for (const half of ["morning", "evening"]) {
      const span = minutes.filter(({ sun }) => sun.morning === (half === "morning"));
      rows[`${sky}${half === "morning" ? "Morning" : "Evening"}`] = ALTITUDES.map((a) => {
        const { date } = span.reduce((best, x) => (Math.abs(x.sun.altitude - a) < Math.abs(best.sun.altitude - a) ? x : best));
        // No moon: the first paint cannot know it cheaply.
        const celestial = { ...skyAt(date), moon: [0, -1, 0] };
        return cssStops(skyTable(celestial, weather), HOME_VIEW, 1, SKY, SEA).map((s) => s.colour).join("");
      });
    }
  const table = skyTable(skyAt(minutes[720].date), null);
  return { stops: cssStops(table, HOME_VIEW, 1, SKY, SEA).map((s) => Number(s.at.toFixed(4))), rows };
}

// Under a deck? `?weather=` names a grey preset, or the forecast the veil
// last saw here (loading-screen.js keeps it three hours) was mostly cloud.
export function greyDay(search, storage) {
  var named = (search.match(/[?&]weather=(\w+)/) || [])[1];
  if (named) return named === "overcast" || named === "rain" || named === "storm";
  try {
    var saved = JSON.parse(storage.getItem("skycope.veil-weather") || "null");
    return !!saved && Date.now() - saved.observedAt < 3 * 3600 * 1000 && saved.cover > 0.75;
  } catch (e) {
    return false;
  }
}

// The inlined script: the sun now, the two nearest rows, mixed.
export function block() {
  const { stops, rows } = palette();
  return `<script>
      // The veil's first paint: this moment's sky from a table (scripts/veil-palette.mjs).
      (function () {
        var P = ${JSON.stringify({ at: stops, ...rows })};
        ${capeSun.toString()}
        ${greyDay.toString()}
        try {
          var sun = capeSun(new Date());
          var grey = false;
          try { grey = greyDay(location.search, localStorage); } catch (e) {}
          var rows = P[(grey ? "grey" : "clear") + (sun.morning ? "Morning" : "Evening")];
          var f = sun.altitude <= 12 ? (sun.altitude + 18) / 1.5 : 20 + (sun.altitude - 12) / 6;
          f = Math.max(0, Math.min(rows.length - 1.001, f));
          var i = Math.floor(f), t = f - i;
          var stops = [];
          for (var k = 0; k < P.at.length; k++) {
            var c = [0, 1, 2].map(function (n) {
              var a = parseInt(rows[i].substr(k * 6 + n * 2, 2), 16), b = parseInt(rows[i + 1].substr(k * 6 + n * 2, 2), 16);
              return Math.round(a + (b - a) * t);
            });
            stops.push("rgb(" + c.join(",") + ") " + (P.at[k] * 100).toFixed(2) + "%");
          }
          // In <head>, before anything is drawn: the veil's CSS reads it.
          document.documentElement.style.setProperty("--veil-sky", "linear-gradient(" + stops.join(",") + ")");
        } catch (e) {}
      })();
    </script>`;
}

const BEGIN = "<!-- veil palette: begin -->";
const END = "<!-- veil palette: end -->";
export function inlined(html) {
  const a = html.indexOf(BEGIN);
  const b = html.indexOf(END);
  return a < 0 || b < 0 ? null : html.slice(a + BEGIN.length, b).trim();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const file = new URL("../index.html", import.meta.url);
  const html = readFileSync(file, "utf8");
  const a = html.indexOf(BEGIN);
  const b = html.indexOf(END);
  if (a < 0 || b < 0) throw new Error("no veil palette markers in index.html");
  writeFileSync(file, `${html.slice(0, a + BEGIN.length)}\n    ${block()}\n    ${html.slice(b)}`);
  console.log("index.html: veil palette written");
}
