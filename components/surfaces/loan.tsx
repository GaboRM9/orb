"use client";
import { useState } from "react";
import { amortize, money, type LoanParams } from "@/lib/surfaces/loan";
import { Chips, Hero, More, useSection } from "./kit";
import type { SurfaceViewProps } from "../surface";
import { Spark } from "./spark";

// the chips and sliders recompute in the browser with the same amortize() the server ran: no refetch, no model call
export function LoanView({ params, busy, live, send }: SurfaceViewProps<LoanParams, ReturnType<typeof amortize>>) {
  const [p, setP] = useState(params);
  const { open, toggle } = useSection<"adjust">();
  const d = amortize(p.amount, p.rate, p.years);
  const $ = (n: number) => money(n, p.currency);
  const share = (d.total ? (p.amount / d.total) * 100 : 100).toFixed(1);
  const changed = p.amount !== params.amount || p.rate !== params.rate || p.years !== params.years;
  const maxAmount = Math.max(params.amount * 2, 1000);
  const sliders = [
    { k: "amount", label: "Amount", min: 0, max: maxAmount, step: maxAmount / 200, show: $(p.amount) },
    { k: "rate", label: "Rate", min: 0, max: Math.max(15, params.rate * 2), step: 0.05, show: `${p.rate.toFixed(2)}%` },
    { k: "years", label: "Years", min: 1, max: 40, step: 1, show: `${p.years}` },
  ] as const;
  return (
    <div>
      <Hero value={$(d.monthly)} unit="/ month" detail={`${$(d.interest)} interest on ${$(p.amount)} · ${p.years} years at ${+p.rate.toFixed(2)}%`} />
      <Chips send={send} live={live} busy={busy} items={[
        { label: "Adjust", pressed: open === "adjust", onClick: toggle("adjust") },
        p.years > 5 && { label: "−5 years", onClick: () => setP({ ...p, years: p.years - 5 }) },
        p.rate >= 1 && { label: "−1% rate", onClick: () => setP({ ...p, rate: p.rate - 1 }) },
        changed && { label: "Reset", onClick: () => setP(params) },
        { label: "Can I afford this?", prompt: `Can I afford a ${$(d.monthly)} monthly payment? Help me check.` },
      ]} />
      {open === "adjust" && (
        <More>
          <div className="space-y-2">
            {sliders.map((s) => (
              <label key={s.k} className="flex items-center gap-3 text-sm">
                <span className="w-16 text-mute">{s.label}</span>
                <input className="flex-1" type="range" min={s.min} max={s.max} step={s.step} value={p[s.k]} onChange={(e) => setP({ ...p, [s.k]: +e.target.value })} />
                <span className="w-28 text-right font-mono text-xs">{s.show}</span>
              </label>
            ))}
          </div>
          <Spark values={d.balance} label="Balance left, year by year" className="mt-3 h-12 w-full" />
          <div className="text-xs text-mute">Balance left, year by year · principal is {share}% of what you pay</div>
        </More>
      )}
    </div>
  );
}
