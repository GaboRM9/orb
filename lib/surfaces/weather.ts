import { z } from "zod";
import { defineSurface } from "./define";
import { geocode, get, type Place } from "./directions";

// ponytail: Open-Meteo's free tier is non-commercial and keyless; their paid plan is the same API with a key.
export type Sky = "clear" | "partly" | "cloudy" | "fog" | "drizzle" | "rain" | "snow" | "storm";
export const SKY_LABEL: Record<Sky, string> = { clear: "Clear", partly: "Partly cloudy", cloudy: "Cloudy", fog: "Fog", drizzle: "Drizzle", rain: "Rain", snow: "Snow", storm: "Thunderstorm" };

/** WMO weather codes (what Open-Meteo returns) folded into the few skies the view draws. */
export function sky(code: number): Sky {
  if (code <= 1) return "clear";
  if (code === 2) return "partly";
  if (code === 45 || code === 48) return "fog";
  if (code >= 51 && code <= 57) return "drizzle";
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return "rain";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
  if (code >= 95) return "storm";
  return "cloudy";
}

// always fetched in °C and km/h; °F and mph are converted for display, so a unit switch needs no refetch
export const toUnit = (c: number, units: "c" | "f") => Math.round(units === "f" ? (c * 9) / 5 + 32 : c);
export const windUnit = (kmh: number, units: "c" | "f") => (units === "f" ? `${Math.round(kmh * 0.621371)} mph` : `${Math.round(kmh)} km/h`);

export type WeatherData = {
  place: Place;
  now: { temp: number; feels: number; sky: Sky; day: boolean; wind: number; humidity: number };
  hours: { time: string; temp: number; rain: number; wind: number; sky: Sky }[]; // the next 24, local wall time
  days: { date: string; min: number; max: number; rain: number; sky: Sky; sunrise: string; sunset: string }[];
};

type Raw = {
  current: { temperature_2m: number; apparent_temperature: number; weather_code: number; is_day: number; wind_speed_10m: number; relative_humidity_2m: number };
  hourly: { time: string[]; temperature_2m: number[]; precipitation_probability: number[]; weather_code: number[]; wind_speed_10m: number[] };
  daily: { time: string[]; weather_code: number[]; temperature_2m_max: number[]; temperature_2m_min: number[]; precipitation_probability_max: number[]; sunrise: string[]; sunset: string[] };
};

export const weather = defineSurface({
  name: "weather",
  title: "Weather",
  when: "weather, temperature, rain or wind for a place, now or this week",
  params: z.object({ city: z.string().min(2).max(120), units: z.enum(["c", "f"]).default("c") }),
  async fetch({ city }): Promise<WeatherData> {
    const place = await geocode(city);
    const r = (await get(
      `https://api.open-meteo.com/v1/forecast?latitude=${place.lat}&longitude=${place.lng}&timezone=auto&forecast_days=7&forecast_hours=24` +
        "&current=temperature_2m,apparent_temperature,weather_code,is_day,wind_speed_10m,relative_humidity_2m" +
        "&hourly=temperature_2m,precipitation_probability,weather_code,wind_speed_10m" +
        "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset",
    )) as Raw;
    const { current: c, hourly: h, daily: d } = r;
    return {
      place,
      now: { temp: c.temperature_2m, feels: c.apparent_temperature, sky: sky(c.weather_code), day: c.is_day === 1, wind: c.wind_speed_10m, humidity: c.relative_humidity_2m },
      hours: h.time.map((time, i) => ({ time, temp: h.temperature_2m[i], rain: h.precipitation_probability[i] ?? 0, wind: h.wind_speed_10m[i], sky: sky(h.weather_code[i]) })),
      days: d.time.map((date, i) => ({
        date,
        min: d.temperature_2m_min[i],
        max: d.temperature_2m_max[i],
        rain: d.precipitation_probability_max[i] ?? 0,
        sky: sky(d.weather_code[i]),
        sunrise: d.sunrise[i],
        sunset: d.sunset[i],
      })),
    };
  },
  summary: ({ units }, { place, now, days: [today] }) =>
    `${toUnit(now.temp, units)}° and ${SKY_LABEL[now.sky].toLowerCase()} in ${place.name}; today ${toUnit(today.min, units)}–${toUnit(today.max, units)}°, ${today.rain}% chance of rain`,
});
