"use client";
import { useState } from "react";
import { convert, related, round, unitName } from "@/lib/surfaces/convert";
import { Chips, Hero, More, useSection } from "./kit";
import type { SurfaceViewProps } from "../surface";

type Data = { from: string; to: string; result: number };

// everything recomputes in the browser: the value, both units and the swap
export function ConvertView({ params, data, busy, live, send }: SurfaceViewProps<{ value: number }, Data>) {
  const [value, setValue] = useState(String(params.value));
  const [from, setFrom] = useState(data.from);
  const [to, setTo] = useState(data.to);
  const { open, toggle } = useSection<"more">();
  const v = Number(value) || 0;
  const units = [from, ...related(0, from).map((r) => r.unit)];
  const pick = (u: string, set: (u: string) => void, label: string) => (
    <select className="bg-transparent text-mute outline-none" value={u} onChange={(e) => set(e.target.value)} aria-label={label}>
      {units.map((x) => <option key={x} value={x}>{unitName(x)}</option>)}
    </select>
  );
  return (
    <div>
      <Hero
        value={round(convert(v, from, to))}
        unit={pick(to, setTo, "To unit")}
        label={
          <span className="flex items-center gap-1.5">
            <input className="w-20 rounded-sm border-b border-line bg-transparent font-mono outline-none focus:border-accent" type="number" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} aria-label="Value" />
            {pick(from, setFrom, "From unit")}
          </span>
        }
      />
      <Chips send={send} live={live} busy={busy} items={[
        { label: "⇄ Swap", onClick: () => (setFrom(to), setTo(from)) },
        { label: "More units", pressed: open === "more", onClick: toggle("more") },
      ]} />
      {open === "more" && (
        <More>
          <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
            {related(v, from).filter((r) => r.unit !== to).map((r) => (
              <li key={r.unit} className="flex justify-between gap-2"><span className="text-mute">{unitName(r.unit)}</span><span className="font-mono">{round(r.value)}</span></li>
            ))}
          </ul>
        </More>
      )}
    </div>
  );
}
