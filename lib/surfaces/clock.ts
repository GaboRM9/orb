import { z } from "zod";
import { defineSurface } from "./define";

// No API: time zones come from the runtime's Intl data, on the server and in the browser alike.
const validZone = (z: string) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: z });
    return true;
  } catch {
    return false;
  }
};

/** Minutes `zone` is ahead of UTC at instant `t`. */
export function offsetMin(zone: string, t: number) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" })
      .formatToParts(t)
      .map((x) => [x.type, x.value]),
  );
  return Math.round((Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(t / 1000) * 1000) / 60000);
}

/** "2026-10-28T15:00" read as the wall clock in `zone` → epoch ms (two passes settle a DST change in between). */
export function zonedTime(local: string, zone: string) {
  const naive = Date.parse(`${local}Z`);
  const guess = naive - offsetMin(zone, naive) * 60000;
  return naive - offsetMin(zone, guess) * 60000;
}

export const zoneLabel = (zone: string) => zone.split("/").at(-1)!.replaceAll("_", " ");
export const clockTime = (t: number, zone: string) => new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit" }).format(t);

export type ClockData = { at: number | null }; // a fixed moment to compare, or null for live clocks

export const clock = defineSurface({
  name: "clock",
  title: "World clock",
  when: "what time it is somewhere, time differences, or when a time in one place falls in others; IANA zones, e.g. Europe/Madrid; at is wall time in the first zone",
  params: z.object({
    zones: z.array(z.string().refine(validZone, "an IANA time zone, e.g. America/Mexico_City")).min(1).max(6),
    at: z.string().regex(/^\d{4}-\d\d-\d\dT\d\d:\d\d$/, "YYYY-MM-DDTHH:mm").optional(),
  }),
  async fetch({ zones, at }): Promise<ClockData> {
    return { at: at ? zonedTime(at, zones[0]) : null };
  },
  summary: ({ zones }, d) => {
    const t = d.at ?? Date.now();
    return zones.map((z) => `${clockTime(t, z)} ${zoneLabel(z)}`).join(", ");
  },
});
