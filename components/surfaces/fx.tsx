"use client";
import { useState } from "react";
import type { FxData } from "@/lib/surfaces/fx";
import { Chips, Hero, More, useSection } from "./kit";
import type { SurfaceViewProps } from "../surface";
import { Spark } from "./spark";

type Params = { amount: number; from: string; to: string };
const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: n < 10 ? 4 : 2 });

export function FxView({ params, data, refetch, busy, live, send }: SurfaceViewProps<Params, FxData>) {
  const [amount, setAmount] = useState(String(params.amount)); // typing recomputes locally; only Swap refetches
  const { open, toggle } = useSection<"trend">();
  const n = Number(amount) || 0;
  const rates = data.series.map((s) => s.rate);
  const change = rates.length > 1 ? ((data.rate - rates[0]) / rates[0]) * 100 : 0;
  const date = new Date(`${data.date}T12:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return (
    <div>
      <Hero
        value={fmt(n * data.rate)}
        unit={data.to}
        label={
          <label className="flex items-center gap-1.5 text-mute">
            <input className="w-20 rounded-sm border-b border-line bg-transparent font-mono text-fg outline-none focus:border-accent" type="number" min="0" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label={`Amount in ${data.from}`} />
            {data.from}
          </label>
        }
        detail={`1 ${data.from} = ${fmt(data.rate)} ${data.to} · ECB, ${date}`}
      />
      <Chips send={send} live={live} busy={busy} items={[
        { label: `⇄ ${data.to} → ${data.from}`, onClick: () => refetch({ amount: n || 1, from: data.to, to: data.from }) },
        ...[100, 1000].map((a) => ({ label: `${a.toLocaleString("en-US")} ${data.from}`, pressed: n === a, onClick: () => setAmount(String(a)) })),
        { label: "30-day trend", pressed: open === "trend", onClick: toggle("trend") },
      ]} />
      {open === "trend" && (
        <More>
          <Spark values={rates} label={`${data.from} to ${data.to} over 30 days`} />
          <div className="flex justify-between text-xs text-mute">
            <span>{fmt(Math.min(...rates))} – {fmt(Math.max(...rates))}</span>
            <span>{change >= 0 ? "+" : ""}{change.toFixed(2)}%</span>
          </div>
        </More>
      )}
    </div>
  );
}
