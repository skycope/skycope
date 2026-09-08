import { CAPE_TOWN } from "./astronomy.js";

export const WEATHER_REFRESH_MS = 10 * 60 * 1000;
export const WEATHER_MAX_AGE_MS = 90 * 60 * 1000;

export async function fetchWeather(signal) {
  const fields = [
    "temperature_2m",
    "cloud_cover",
    "cloud_cover_low",
    "cloud_cover_mid",
    "cloud_cover_high",
    "precipitation",
    "weather_code",
    "wind_speed_10m",
    "wind_direction_10m",
  ];
  const query = new URLSearchParams({
    latitude: CAPE_TOWN.latitude,
    longitude: CAPE_TOWN.longitude,
    current: fields.join(","),
    timezone: CAPE_TOWN.timezone,
    timeformat: "unixtime",
  });
  const response = await fetch(
    `https://api.open-meteo.com/v1/forecast?${query}`,
    { signal },
  );
  if (!response.ok)
    throw new Error(`Weather request failed: ${response.status}`);
  const { current } = await response.json();
  if (
    !current ||
    ![current.time, ...fields.map((field) => current[field])].every(
      Number.isFinite,
    )
  ) {
    throw new Error("Weather response is incomplete");
  }
  const observedAt = current.time * 1000;
  if (Math.abs(Date.now() - observedAt) > WEATHER_MAX_AGE_MS)
    throw new Error("Weather data is out of date");
  const angle = ((current.wind_direction_10m + 180) * Math.PI) / 180;
  const speed = current.wind_speed_10m / 3.6;
  return {
    observedAt,
    cover: current.cloud_cover / 100,
    low: current.cloud_cover_low / 100,
    mid: current.cloud_cover_mid / 100,
    high: current.cloud_cover_high / 100,
    rain: Math.max(0, current.precipitation),
    wind: [Math.sin(angle) * speed, Math.cos(angle) * speed],
    temperature: Math.round(current.temperature_2m),
    description: weatherDescription(current.weather_code),
  };
}

export function weatherDescription(code) {
  if (code === 0) return "clear sky";
  if (code === 1) return "mostly clear";
  if (code === 2) return "partly cloudy";
  if (code === 3) return "overcast";
  if (code <= 48) return "fog";
  if (code <= 57) return "drizzle";
  if (code <= 67) return "rain";
  if (code <= 77) return "snow";
  if (code <= 82) return "rain showers";
  if (code <= 86) return "snow showers";
  return "thunderstorms";
}
