import assert from "node:assert/strict";
import { test } from "node:test";
import { lightingAt, skyRadiance, sunRadiance } from "../src/sunlight.js";

const luminance = (c) => c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
const at = (degrees, moonPhase = 0.5) => {
  const a = (degrees * Math.PI) / 180;
  const sun = [0, Math.sin(a), Math.cos(a)];
  const scene =
    degrees >= 10 ? 0 : degrees >= 0 ? (10 - degrees) / 10 : 1 + Math.min(1, -degrees / 12);
  return { sun, moon: [0.3, 0.6, -0.74], scene, moonPhase };
};

test("the clear sky is blue overhead and reddens the low sun", () => {
  const noon = at(60);
  const zenith = skyRadiance([0, 1, 0], noon.sun);
  assert.ok(zenith[2] > zenith[1] && zenith[1] > zenith[0], "Rayleigh blue zenith");
  const high = sunRadiance(noon.sun);
  const low = sunRadiance(at(2).sun);
  assert.ok(low[0] / low[2] > 4 * (high[0] / high[2]), "sunset light is far redder");
  assert.deepEqual(sunRadiance(at(-5).sun), [0, 0, 0], "the planet occludes a set sun");
});

test("exposure keeps daylight balanced and lets twilight darken into night", () => {
  for (const degrees of [60, 30, 10]) {
    const light = lightingAt(at(degrees));
    const ratio = luminance(light.direct) / luminance(light.sky);
    // Real sun : zenith-sky irradiance ratios are roughly 10-30.
    assert.ok(ratio > 10 && ratio < 35, `${degrees}° sun/sky ratio ${ratio}`);
  }
  const zenith = (d) => luminance(lightingAt(at(d)).sky);
  assert.ok(zenith(-6) < zenith(0) * 0.4, "civil twilight is darker than sunset");
  assert.ok(zenith(-18) < zenith(-6), "night is darker than twilight");
  for (const degrees of [60, 5, -3, -8, -12, -30]) {
    const light = lightingAt(at(degrees));
    assert.ok([...light.direct, ...light.sky, light.exposure].every(Number.isFinite));
  }
});
