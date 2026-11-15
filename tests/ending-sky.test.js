// The ending's sky (docs/design/story-and-wow.md 5): the star the wisp
// becomes is the real south celestial pole from Cape Town, the Cross that
// points to it is the real Cross, and in the lapse every star turns about
// it, clockwise as seen looking south. The shader draws the pole at the
// catalogue's (0, 0, −1) and the Cross from the atlas; these check the same
// arithmetic (night.wgsl local_from_equatorial, mirrored here) and data.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { skyAt } from "../src/astronomy.js";
import { CRUX, figureId } from "../src/star-catalog.js";

const DEG = Math.PI / 180;
const catalog = JSON.parse(readFileSync(new URL("../src/data/stars.json", import.meta.url)));
const sky = readFileSync(new URL("../src/shaders/sky.wgsl", import.meta.url), "utf8");

// night.wgsl local_from_equatorial: local (east, up, north).
function local(eq, sidereal, latitude) {
  const c = Math.cos(sidereal), s = Math.sin(sidereal);
  const hx = c * eq[0] + s * eq[1];
  const hy = s * eq[0] - c * eq[1];
  const hz = eq[2];
  return [-hy, hx * Math.cos(latitude) + hz * Math.sin(latitude), hz * Math.cos(latitude) - hx * Math.sin(latitude)];
}
const radec = ([ra, dec]) => [Math.cos(dec * DEG) * Math.cos(ra * DEG), Math.cos(dec * DEG) * Math.sin(ra * DEG), Math.sin(dec * DEG)];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => a.map((v) => v / Math.hypot(...a));
const altitude = (v) => Math.asin(v[1]) / DEG;
const azimuth = (v) => ((Math.atan2(v[0], v[2]) / DEG) % 360 + 360) % 360;
const POLE = [0, 0, -1];
const DATES = ["2026-11-15T20:00:00Z", "2026-03-01T19:00:00Z", "2026-06-21T23:30:00Z", "2027-09-10T02:00:00Z"].map((d) => new Date(d));

test("the star: the south celestial pole stands at Cape Town's latitude, due south, at every hour", () => {
  for (const date of DATES) {
    const { sidereal, latitude } = skyAt(date);
    const p = local(POLE, sidereal, latitude);
    assert.ok(Math.abs(altitude(p) - 33.9249) < 1e-6, `altitude ${altitude(p)}`);
    assert.ok(Math.abs(azimuth(p) - 180) < 1e-6, `azimuth ${azimuth(p)}`);
  }
});

test("the shader's pole and Cross are the catalogue's", () => {
  assert.match(sky, /const SOUTH_POLE: vec3f = vec3f\(0\.0, 0\.0, -1\.0\);/);
  const acrux = sky.match(/const ACRUX: vec2f = vec2f\(([-\d.]+), ([-\d.]+)\);/);
  assert.ok(Math.abs(Number(acrux[1]) - CRUX.foot[0] * DEG) < 1e-6 && Math.abs(Number(acrux[2]) - CRUX.foot[1] * DEG) < 1e-6);
  const id = Number(sky.match(/const CRUX_FIGURE: f32 = ([\d.]+);/)[1]);
  assert.ok(Math.abs(id - CRUX.atlas) < 1e-6);
  // The figure at CRUX.index is the Cross (Acrux to Gacrux is one of its
  // lines), and no other figure shares its byte in the atlas.
  const figure = catalog.constellations[CRUX.index];
  const has = ([ra, dec]) => figure.some((line) => line.some(([r, d]) => Math.abs(((r % 360) + 360) % 360 - ra) < 0.01 && Math.abs(d - dec) < 0.01));
  assert.ok(has(CRUX.foot) && has(CRUX.head));
  const byte = (i) => Math.round(figureId(i) * 255);
  for (let i = 0; i < catalog.constellations.length; i++) if (i !== CRUX.index) assert.notEqual(byte(i), byte(CRUX.index), `figure ${i}`);
  // Acrux and Gacrux are real bright stars of the catalogue there.
  for (const [ra, dec] of [CRUX.foot, CRUX.head]) assert.ok(catalog.stars.some((s) => Math.abs(((s[0] % 360) + 360) % 360 - ra) < 0.02 && Math.abs(s[1] - dec) < 0.02 && s[2] < 1.7));
});

test("the Cross's long axis points to the pole: within a few degrees, about four and a half lengths on", () => {
  const foot = radec(CRUX.foot);
  const head = radec(CRUX.head);
  const length = Math.acos(dot(foot, head)) / DEG;
  const toPole = Math.acos(dot(foot, POLE)) / DEG;
  // The great circle from the head through the foot passes the pole at:
  const n = norm(cross(head, foot));
  const miss = Math.asin(Math.abs(dot(POLE, n))) / DEG;
  // …and the pole is beyond the foot, not behind the head.
  const ahead = dot(POLE, norm(cross(n, foot)));
  // The pointer's turn off the Cross's own axis, at the foot.
  const axis = norm(cross(n, foot));
  const towards = norm(cross(norm(cross(foot, POLE)), foot));
  const turn = Math.acos(Math.min(1, dot(axis, towards))) / DEG;
  console.log(`Cross ${length.toFixed(2)}°, foot to pole ${toPole.toFixed(2)}° (${(toPole / length).toFixed(2)} lengths), axis misses the pole by ${miss.toFixed(2)}°, pointer turns ${turn.toFixed(2)}° off the axis`);
  assert.ok(miss < 3, `misses by ${miss}°`);
  assert.ok(ahead > 0);
  assert.ok(toPole / length > 4 && toPole / length < 5, `${toPole / length} lengths`);
  assert.ok(turn < 6);
});

test("the sky turns about the pole, clockwise looking south; the pole does not move", () => {
  const start = new Date("2026-11-15T20:30:00Z");
  const stars = catalog.stars.filter((s) => s[2] < 3 && s[1] < -40).map((s) => radec([s[0], s[1]]));
  assert.ok(stars.length > 20);
  for (const minutes of [10, 60, 120]) {
    const a = skyAt(start);
    const b = skyAt(new Date(start.getTime() + minutes * 60000));
    const pa = local(POLE, a.sidereal, a.latitude);
    const pb = local(POLE, b.sidereal, b.latitude);
    assert.ok(Math.acos(Math.min(1, dot(pa, pb))) < 1e-9, "the pole is still");
    // Hours of turning: 15.04° of sidereal angle an hour.
    const turned = ((((b.sidereal - a.sidereal) / DEG) % 360) + 360) % 360;
    assert.ok(Math.abs(turned - minutes * 0.250684) < 1e-3, `${turned}°`);
    for (const s of stars) {
      const la = local(s, a.sidereal, a.latitude);
      const lb = local(s, b.sidereal, b.latitude);
      // Every star keeps its distance from the pole.
      assert.ok(Math.abs(dot(la, pa) - dot(lb, pb)) < 1e-9);
      // Seen looking south (right is west, x < 0; up is up), the turn about
      // the pole is clockwise: the cross product of the star's offsets from
      // the pole before and after points away from the viewer.
      const view = (v) => [-v[0], dot(v, [0, -pa[2], pa[1]])];
      const u = view(la), w = view(lb);
      const z = u[0] * w[1] - u[1] * w[0];
      if (Math.hypot(...u) > 0.05) assert.ok(z < 0, "clockwise");
    }
  }
});

test("the ending's lapse: eased keyframes; tonight's dusk and dawn from the real sun", async () => {
  const { lapseMinutes, duskMinutes, dawnMinutes, previewDate } = await import("../src/moments.js");
  const keys = [[0, 1320], [30, 1440]];
  assert.equal(lapseMinutes(keys, -1), 1320);
  assert.equal(lapseMinutes(keys, 15), 1380);
  assert.equal(lapseMinutes(keys, 31), 1440);
  assert.ok(lapseMinutes(keys, 3) - 1320 < 6, "eases in");
  const date = new Date("2026-11-15T10:00:00Z");
  const dusk = duskMinutes(750, date, -9);
  const dawn = dawnMinutes(dusk + 60, date, -9);
  assert.ok(dusk > 750 && dusk < 1440, `dusk at ${dusk}`);
  assert.ok(Math.abs(skyAt(previewDate(dusk, date)).sunAltitude + 9) < 0.2);
  assert.ok(dawn > 1440 && dawn < 1440 + 420, `dawn at ${dawn}`);
  assert.ok(Math.abs(skyAt(previewDate(dawn, date)).sunAltitude + 9) < 0.2);
  // Already dark: tonight's dusk is now.
  assert.equal(duskMinutes(1380, date, -9), 1380);
});

test("the ending's beats are in order, and the cat is held only until free", async () => {
  const { ENDING } = await import("../src/journey.js");
  for (const p of Object.values(ENDING)) {
    assert.ok(p.nose < p.rise && p.rise < p.arrive && p.arrive < p.cross && p.cross < p.turn[0] && p.turn[0] < p.turn[1] && p.turn[1] <= p.after);
  }
  assert.equal(ENDING.night.free, 16);
  assert.equal(ENDING.night.turn[1] - ENDING.night.turn[0], 30);
  assert.equal(ENDING.night.hours, 2);
  assert.equal(ENDING.day.after, 66);
});
