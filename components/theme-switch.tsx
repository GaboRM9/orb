"use client";
import { useState } from "react";
import type { Theme } from "@/lib/theme";

/** Appearance buttons, inside the saveTheme form: the page switches on click and the save follows in the background. */
export function ThemeSwitch({ mode }: { mode: Theme["mode"] }) {
  const [cur, setCur] = useState(mode);
  return (
    <div className="seg">
      {(["system", "light", "dark"] as const).map((m) => (
        <button key={m} name="mode" value={m} aria-pressed={cur === m} className="capitalize" onClick={() => { setCur(m); document.documentElement.dataset.mode = m; }}>{m}</button>
      ))}
    </div>
  );
}
