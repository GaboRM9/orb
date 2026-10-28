"use client";
import { useState } from "react";
import { SKY_LABEL, toUnit, windUnit, type Sky, type WeatherData } from "@/lib/surfaces/weather";
import { Chips, Hero, More, useSection } from "./kit";
import type { SurfaceViewProps } from "../surface";

type Params = { city: string; units: "c" | "f" };
const TINT: Record<Sky, string> = { clear: "#f5b301", partly: "#e8b84a", cloudy: "#8a94a6", fog: "#9a9a9a", drizzle: "#5b9bd5", rain: "#3b82f6", snow: "#9cc9ff", storm: "#7c3aed" };

const day = (date: string, i: number) => (i === 0 ? "Today" : new Date(`${date}T12:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }));

// units and the sections only change how the data is drawn: local state, no refetch
export function WeatherView({ params, data, busy, live, send }: SurfaceViewProps<Params, WeatherData>) {
  const [units, setUnits] = useState(params.units);
  const { open, toggle } = useSection<"hours" | "week">();
  const { place, now, hours, days } = data;
  const deg = (c: number) => `${toUnit(c, units)}°`;
  const [wLo, wHi] = [Math.min(...days.map((d) => d.min)), Math.max(...days.map((d) => d.max))];
  const wet = days[0].rain >= 50;
  const city = place.name.split(",")[0];

  return (
    <div>
      <Hero
        tint={now.sky === "clear" && !now.day ? "#4c5a9e" : TINT[now.sky]}
        icon={<Glyph sky={now.sky} night={!now.day} className="h-12 w-12" />}
        value={deg(now.temp)}
        label={SKY_LABEL[now.sky]}
        detail={`Feels ${deg(now.feels)} · Wind ${windUnit(now.wind, units)} · Humidity ${now.humidity}%`}
      />
      <Chips send={send} live={live} busy={busy} items={[
        { label: "Next hours", pressed: open === "hours", onClick: toggle("hours") },
        { label: "This week", pressed: open === "week", onClick: toggle("week") },
        { label: units === "c" ? "°F" : "°C", onClick: () => setUnits(units === "c" ? "f" : "c") },
        wet ? { label: "Do I need an umbrella?", prompt: `Do I need an umbrella in ${city} today?` } : { label: "What should I wear?", prompt: `What should I wear in ${city} today?` },
      ]} />
      {open === "hours" && (
        <More>
          <div className="-mx-4 flex gap-1 overflow-x-auto px-4" role="list" aria-label="Next 24 hours">
            {hours.map((h, i) => (
              <div key={h.time} role="listitem" className="flex w-11 shrink-0 flex-col items-center gap-1 text-xs">
                <span className="text-mute">{i === 0 ? "Now" : h.time.slice(11, 13)}</span>
                <Glyph sky={h.sky} className="h-4 w-4" />
                <span className="font-mono">{deg(h.temp)}</span>
                <span className="font-mono text-mute">{h.rain ? `${h.rain}%` : ""}</span>
              </div>
            ))}
          </div>
        </More>
      )}
      {open === "week" && (
        <More>
          <ul className="divide-y divide-line text-sm">
            {days.map((d, i) => (
              <li key={d.date} className="flex items-center gap-3 py-2">
                <span className="w-12">{day(d.date, i)}</span>
                <Glyph sky={d.sky} className="h-4 w-4" />
                <span className="w-10 text-right font-mono text-xs text-mute">{d.rain ? `${d.rain}%` : ""}</span>
                <span className="w-9 text-right font-mono text-mute">{deg(d.min)}</span>
                <span className="relative h-1.5 flex-1 rounded-full bg-surface-2" aria-hidden>
                  <span className="absolute inset-y-0 rounded-full bg-accent" style={{ left: `${((d.min - wLo) / (wHi - wLo || 1)) * 100}%`, right: `${((wHi - d.max) / (wHi - wLo || 1)) * 100}%` }} />
                </span>
                <span className="w-9 font-mono">{deg(d.max)}</span>
              </li>
            ))}
          </ul>
        </More>
      )}
    </div>
  );
}

function Glyph({ sky, night, className }: { sky: Sky; night?: boolean; className?: string }) {
  const cloud = <path d="M7 18h10a4 4 0 0 0 .5-7.97A5.5 5.5 0 0 0 7 11a3.5 3.5 0 0 0 0 7z" />;
  const body =
    sky === "clear" ? (night ? <path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z" /> : <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>)
    : sky === "partly" ? <><path d="M8 3v1.5M3.5 8H2M4.8 4.8l1 1M11.2 4.8l-1 1" /><path d="M5.5 10.5A3 3 0 0 1 11 7" />{cloud}</>
    : sky === "fog" ? <path d="M4 9h16M3 13h18M5 17h14" />
    : sky === "drizzle" || sky === "rain" ? <>{cloud}<path d={sky === "rain" ? "M8 20l-1 2M12 20l-1 2M16 20l-1 2" : "M9 20.5v.5M15 20.5v.5"} /></>
    : sky === "snow" ? <>{cloud}<path d="M8 21h.01M12 21h.01M16 21h.01" /></>
    : sky === "storm" ? <>{cloud}<path d="M12 15l-2 4h3l-2 4" /></>
    : cloud;
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 ${className}`} role="img" aria-label={SKY_LABEL[sky]}>
      {body}
    </svg>
  );
}
