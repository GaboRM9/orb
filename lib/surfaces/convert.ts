import { z } from "zod";
import { defineSurface } from "./define";

// unit → [dimension, size in the dimension's base unit, name]; temperature is converted by formula
const UNITS: Record<string, [string, number, string]> = {
  mm: ["length", 0.001, "millimetres"], cm: ["length", 0.01, "centimetres"], m: ["length", 1, "metres"], km: ["length", 1000, "kilometres"],
  in: ["length", 0.0254, "inches"], ft: ["length", 0.3048, "feet"], yd: ["length", 0.9144, "yards"], mi: ["length", 1609.344, "miles"], nmi: ["length", 1852, "nautical miles"],
  mg: ["mass", 1e-6, "milligrams"], g: ["mass", 0.001, "grams"], kg: ["mass", 1, "kilograms"], t: ["mass", 1000, "tonnes"],
  oz: ["mass", 0.028349523125, "ounces"], lb: ["mass", 0.45359237, "pounds"], st: ["mass", 6.35029318, "stone"],
  ml: ["volume", 0.001, "millilitres"], l: ["volume", 1, "litres"], m3: ["volume", 1000, "cubic metres"], tsp: ["volume", 0.00492892, "teaspoons"],
  tbsp: ["volume", 0.0147868, "tablespoons"], floz: ["volume", 0.0295735, "US fluid ounces"], cup: ["volume", 0.24, "cups"], pt: ["volume", 0.473176, "US pints"],
  qt: ["volume", 0.946353, "US quarts"], gal: ["volume", 3.78541, "US gallons"],
  "m/s": ["speed", 1, "metres per second"], "km/h": ["speed", 1 / 3.6, "kilometres per hour"], mph: ["speed", 0.44704, "miles per hour"], kn: ["speed", 0.514444, "knots"],
  m2: ["area", 1, "square metres"], km2: ["area", 1e6, "square kilometres"], ha: ["area", 1e4, "hectares"], ac: ["area", 4046.8564224, "acres"], ft2: ["area", 0.09290304, "square feet"],
  b: ["data", 1, "bytes"], kb: ["data", 1e3, "kilobytes"], mb: ["data", 1e6, "megabytes"], gb: ["data", 1e9, "gigabytes"], tb: ["data", 1e12, "terabytes"],
  s: ["time", 1, "seconds"], min: ["time", 60, "minutes"], h: ["time", 3600, "hours"], day: ["time", 86400, "days"], wk: ["time", 604800, "weeks"],
  c: ["temperature", 1, "°C"], f: ["temperature", 1, "°F"], k: ["temperature", 1, "kelvin"],
};
const toK = { c: (v: number) => v + 273.15, f: (v: number) => ((v - 32) * 5) / 9 + 273.15, k: (v: number) => v } as Record<string, (v: number) => number>;
const fromK = { c: (v: number) => v - 273.15, f: (v: number) => ((v - 273.15) * 9) / 5 + 32, k: (v: number) => v } as Record<string, (v: number) => number>;

/** "°C", "KM/H", "Kg" → the table's key, or a readable error listing what's known. */
export function unit(raw: string) {
  const u = raw.trim().toLowerCase().replace(/^°/, "");
  if (!UNITS[u]) throw new Error(`Unknown unit "${raw}". Known: ${Object.keys(UNITS).join(", ")}`);
  return u;
}
export const unitName = (u: string) => UNITS[u][2];

/** The view runs this too, so editing the number needs no refetch. */
export function convert(value: number, from: string, to: string) {
  const [a, b] = [UNITS[from], UNITS[to]];
  if (a[0] !== b[0]) throw new Error(`Can't convert ${a[0]} to ${b[0]}`);
  return a[0] === "temperature" ? fromK[to](toK[from](value)) : (value * a[1]) / b[1];
}
export const related = (value: number, from: string) =>
  Object.keys(UNITS).filter((u) => UNITS[u][0] === UNITS[from][0] && u !== from).map((u) => ({ unit: u, value: convert(value, from, u) }));

export const round = (n: number) => (Math.abs(n) >= 1000 ? Math.round(n).toLocaleString("en-US") : String(+n.toPrecision(4)));

const unitParam = z.string().max(10).refine((u) => { try { return !!unit(u); } catch { return false; } }, "a known unit (km, mi, kg, lb, l, gal, c, f, mph, GB…)");

export const convertUnits = defineSurface({
  name: "convert",
  title: "Convert",
  when: "unit conversions: length, weight, volume, cooking, speed, area, data, time, temperature (c/f/k)",
  params: z.object({ value: z.number(), from: unitParam, to: unitParam }),
  async fetch({ value, from, to }) {
    const [f, t] = [unit(from), unit(to)];
    return { from: f, to: t, result: convert(value, f, t) };
  },
  summary: ({ value }, d) => `${round(value)} ${unitName(d.from)} = ${round(d.result)} ${unitName(d.to)}`,
});
