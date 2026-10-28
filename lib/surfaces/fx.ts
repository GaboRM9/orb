import { z } from "zod";
import { defineSurface } from "./define";
import { get } from "./directions";

// Frankfurter: European Central Bank reference rates, keyless, about 30 major currencies, updated on working days.
const API = "https://api.frankfurter.dev/v1";
const code = z.string().regex(/^[a-zA-Z]{3}$/, "a 3-letter ISO currency code").toUpperCase();

export type FxData = { from: string; to: string; rate: number; date: string; series: { date: string; rate: number }[] };

export const fx = defineSurface({
  name: "fx",
  title: "Currency",
  when: "converting money or exchange rates between major currencies (ISO codes like USD, EUR, MXN)",
  params: z.object({ amount: z.number().positive().default(1), from: code, to: code }),
  async fetch({ from, to }): Promise<FxData> {
    if (from === to) throw new Error("Pick two different currencies");
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    const [latest, history] = (await Promise.all([get(`${API}/latest?from=${from}&to=${to}`), get(`${API}/${since}..?from=${from}&to=${to}`)]).catch(() => {
      throw new Error(`No rates for ${from} → ${to} (only major currencies are covered)`);
    })) as [{ date: string; rates: Record<string, number> }, { rates: Record<string, Record<string, number>> }];
    return {
      from,
      to,
      rate: latest.rates[to],
      date: latest.date,
      series: Object.entries(history.rates).map(([date, r]) => ({ date, rate: r[to] })),
    };
  },
  summary: ({ amount }, d) => `${amount} ${d.from} = ${+(amount * d.rate).toFixed(2)} ${d.to} (rate ${d.rate}, ${d.date})`,
});
