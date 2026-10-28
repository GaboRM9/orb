"use client";
import { useEffect, useState } from "react";
import { clockTime, offsetMin, zoneLabel, type ClockData } from "@/lib/surfaces/clock";
import { Chips, More, useSection } from "./kit";
import type { SurfaceViewProps } from "../surface";

type Params = { zones: string[]; at?: string };
const ymd = (t: number, zone: string) => new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(t); // 2026-10-28
const hourIn = (t: number, zone: string) => +new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", hourCycle: "h23" }).format(t);
const mood = (h: number) => (h >= 9 && h < 18 ? "working" : h >= 7 && h < 23 ? "awake" : "asleep");

export function ClockView({ params, data, busy, live, send }: SurfaceViewProps<Params, ClockData>) {
  const [now, setNow] = useState(() => Date.now());
  const [shift, setShift] = useState(0); // hours, from the slider: "what if it were 3 h later"
  const { open, toggle } = useSection<"plan">();
  useEffect(() => {
    if (data.at !== null) return;
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, [data.at]);
  const t = (data.at ?? now) + (open === "plan" ? shift : 0) * 3_600_000;
  const [base] = params.zones;
  const names = params.zones.map(zoneLabel);

  return (
    <div>
      <ul className="space-y-1 p-4">
        {params.zones.map((z) => {
          const diffH = (offsetMin(z, t) - offsetMin(base, t)) / 60;
          const dayDiff = Math.round((Date.parse(ymd(t, z)) - Date.parse(ymd(t, base))) / 86_400_000);
          return (
            <li key={z} className="flex items-baseline justify-between gap-3">
              <span className="text-sm">
                {zoneLabel(z)}
                <span className="text-xs text-mute">
                  {z !== base && ` ${diffH >= 0 ? "+" : ""}${diffH} h`}
                  {dayDiff ? ` · ${dayDiff > 0 ? "tomorrow" : "yesterday"}` : ""}
                  {open === "plan" && ` · ${mood(hourIn(t, z))}`}
                </span>
              </span>
              <span className="font-mono text-2xl font-light">{clockTime(t, z)}</span>
            </li>
          );
        })}
      </ul>
      <Chips send={send} live={live} busy={busy} items={[
        { label: "Plan a time", pressed: open === "plan", onClick: toggle("plan") },
        params.zones.length > 1 && { label: "Best time for a call?", prompt: `What's a good time for a call between ${names.join(", ")}?` },
      ]} />
      {open === "plan" && (
        <More>
          <label className="flex items-center gap-3 text-xs text-mute">
            <span className="w-16">{shift ? `${shift > 0 ? "+" : ""}${shift} h` : data.at ? "as asked" : "now"}</span>
            <input className="flex-1" type="range" min="-12" max="12" step="0.5" value={shift} onChange={(e) => setShift(+e.target.value)} aria-label="Shift the time" />
          </label>
        </More>
      )}
    </div>
  );
}
