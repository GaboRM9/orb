import { z } from "zod";
import { defineSurface } from "./define";

/** Fixed-rate monthly payments. The view runs this too, so its sliders need no refetch. */
export function amortize(amount: number, ratePct: number, years: number) {
  const n = Math.round(years * 12);
  const r = ratePct / 1200;
  const monthly = r ? (amount * r) / (1 - (1 + r) ** -n) : amount / n;
  const balance = [amount]; // at the start of each year, then 0
  let b = amount;
  for (let m = 1; m <= n; m++) {
    b = b * (1 + r) - monthly;
    if (m % 12 === 0 || m === n) balance.push(Math.max(0, b));
  }
  return { monthly, total: monthly * n, interest: monthly * n - amount, balance };
}

export const money = (n: number, currency: string) => new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);

export type LoanParams = { amount: number; rate: number; years: number; currency: string };

export const loan = defineSurface({
  name: "loan",
  title: "Loan",
  when: "loan, mortgage or car-payment questions: monthly payment, total interest; rate is yearly %",
  params: z.object({
    amount: z.number().positive().max(1e10),
    rate: z.number().min(0).max(100),
    years: z.number().min(1).max(50),
    currency: z.string().regex(/^[a-zA-Z]{3}$/).toUpperCase().default("USD"),
  }),
  async fetch({ amount, rate, years }) {
    return amortize(amount, rate, years);
  },
  summary: (p, d) => `${money(d.monthly, p.currency)}/month for ${p.years} years at ${p.rate}%; ${money(d.interest, p.currency)} interest on ${money(p.amount, p.currency)}`,
});
