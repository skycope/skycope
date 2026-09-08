import * as SunCalc from "suncalc";

export const CAPE_TOWN = {
  latitude: -33.9249,
  longitude: 18.4241,
  timezone: "Africa/Johannesburg",
};
const DEG = Math.PI / 180;
const clockFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: CAPE_TOWN.timezone,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const dateFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: CAPE_TOWN.timezone,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function skyAt(date) {
  const { latitude, longitude } = CAPE_TOWN;
  const sun = SunCalc.getPosition(date, latitude, longitude);
  const moon = SunCalc.getMoonPosition(date, latitude, longitude);
  const illumination = SunCalc.getMoonIllumination(date);
  const altitude = sun.altitude;
  // Continuous solar-altitude palette, including civil and nautical twilight.
  const scene =
    altitude >= 10
      ? 0
      : altitude >= 0
        ? (10 - altitude) / 10
        : 1 + Math.min(1, -altitude / 12);
  const days = date.getTime() / 86400000 + 2440587.5 - 2451545;
  const sidereal =
    ((((280.46061837 + 360.98564736629 * days + longitude) % 360) + 360) %
      360) *
    DEG;
  return {
    sun: direction(sun),
    moon: direction(moon),
    scene,
    moonPhase: illumination.phase,
    moonAngle: (illumination.angle - moon.parallacticAngle) * DEG,
    sidereal,
    latitude: latitude * DEG,
    sunAltitude: altitude,
    sunAzimuth: sun.azimuth,
  };
}

// SunCalc 2 uses degrees clockwise from north; the shader uses east / up / north.
function direction({ altitude, azimuth }) {
  const az = azimuth * DEG;
  const alt = altitude * DEG;
  return [
    Math.sin(az) * Math.cos(alt),
    Math.sin(alt),
    Math.cos(az) * Math.cos(alt),
  ];
}

export function capeTime(date) {
  return clockFormat.format(date);
}

export function capeMinutes(date) {
  const [hours, minutes] = capeTime(date).split(":").map(Number);
  return hours * 60 + minutes;
}

export function dateAtCapeMinutes(minutes, now = new Date()) {
  const parts = Object.fromEntries(
    dateFormat.formatToParts(now).map(({ type, value }) => [type, value]),
  );
  // South Africa uses UTC+02:00 year round, with no daylight-saving changes.
  return new Date(
    Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      0,
      minutes,
    ) -
      2 * 3600000,
  );
}
