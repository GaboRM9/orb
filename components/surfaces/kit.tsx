"use client";
import { useState, type ReactNode } from "react";

// The pieces every card is built from (kept apart from surface.tsx, which imports the views)
/** The top of every card: an icon, one big value, a label and at most one line of detail. */
export function Hero({ icon, value, unit, label, detail, tint }: { icon?: ReactNode; value: ReactNode; unit?: ReactNode; label?: ReactNode; detail?: ReactNode; tint?: string }) {
  return (
    <div className={`flex items-center gap-4 p-4 ${tint ? "mb-4" : ""}`} style={tint ? { background: `color-mix(in oklab, ${tint} 14%, var(--surface))` } : undefined}>
      {icon}
      <div className="min-w-0">
        <div className="text-4xl font-light tracking-tight">{value}{unit && <span className="text-base text-mute"> {unit}</span>}</div>
        {label && <div className="text-sm">{label}</div>}
        {detail && <div className="text-xs text-mute">{detail}</div>}
      </div>
    </div>
  );
}

/**
 * A card's quick actions. Cheapest first: open a hidden section or change the view (onClick: local or a refetch),
 * leave (href), or ask the agent (prompt: one model turn, so at most one per card, and only from the newest reply).
 */
export type Chip = { label: string; onClick?: () => void; href?: string; prompt?: string; pressed?: boolean };
export function Chips({ items, send, live, busy }: { items: (Chip | false | undefined)[]; send: (text: string) => void; live: boolean; busy: boolean }) {
  return (
    <div className="flex flex-wrap gap-1.5 px-4 pb-4">
      {items.filter((c): c is Chip => !!c).map((c) =>
        c.href ? (
          <a key={c.label} className="act" href={c.href} target="_blank" rel="noopener noreferrer">{c.label} ↗</a>
        ) : (
          <button key={c.label} className={c.prompt ? "act act-ask" : "act"} aria-pressed={c.pressed} disabled={c.prompt ? !live : busy} onClick={c.prompt ? () => send(c.prompt!) : c.onClick}>
            {c.label}{c.prompt && " →"}
          </button>
        ),
      )}
    </div>
  );
}

/** A section a chip opened, under the chips. */
export const More = ({ children }: { children: ReactNode }) => <div className="rise border-t border-line p-4">{children}</div>;

/** Opens one section at a time; the same chip closes it. */
export function useSection<T extends string>() {
  const [open, setOpen] = useState<T | null>(null);
  return { open, toggle: (s: T) => () => setOpen((o) => (o === s ? null : s)) };
}
