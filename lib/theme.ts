import type { CSSProperties } from "react";

// Six knobs plus the light/dark mode; every other colour is derived from these in globals.css.
// paper and ink are the light-mode background and text; dark mode swaps them.
export type Theme = {
  mode: "system" | "light" | "dark";
  paper: string;
  ink: string;
  accent: string; // "" follows ink
  radius: number; // px
  density: number; // spacing multiplier
  font: keyof typeof FONTS;
};

export const FONTS = {
  geist: "var(--font-geist-sans), system-ui, sans-serif",
  system: "-apple-system, BlinkMacSystemFont, system-ui, sans-serif",
  serif: "ui-serif, Georgia, Cambria, serif",
  mono: "var(--font-geist-mono), ui-monospace, monospace",
};

export const DEFAULT_THEME: Theme = { mode: "system", paper: "#ffffff", ink: "#0a0a0a", accent: "", radius: 14, density: 1, font: "geist" };

const hex = (v: unknown) => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);
const num = (v: unknown, lo: number, hi: number) => typeof v === "number" && v >= lo && v <= hi;

// values land in a style attribute, so anything that isn't exactly the expected shape falls back to the default
export function parseTheme(json: string): Theme {
  let raw: Record<string, unknown> = {};
  try { raw = JSON.parse(json) ?? {}; } catch {}
  const d = DEFAULT_THEME;
  return {
    mode: raw.mode === "light" || raw.mode === "dark" ? raw.mode : "system",
    paper: hex(raw.paper) ? (raw.paper as string) : d.paper,
    ink: hex(raw.ink) ? (raw.ink as string) : d.ink,
    accent: hex(raw.accent) ? (raw.accent as string) : "",
    radius: num(raw.radius, 0, 24) ? (raw.radius as number) : d.radius,
    density: num(raw.density, 0.8, 1.25) ? (raw.density as number) : d.density,
    font: typeof raw.font === "string" && raw.font in FONTS ? (raw.font as Theme["font"]) : d.font,
  };
}

// WCAG relative luminance of a #rrggbb colour
export const luminance = (h: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

export const themeStyle = (t: Theme) =>
  ({
    colorScheme: t.mode === "system" ? "light dark" : t.mode,
    "--paper": t.paper,
    "--ink": t.ink,
    ...(t.accent && { "--accent": t.accent, "--on-accent": luminance(t.accent) > 0.18 ? "#000" : "#fff" }), // 0.18: where black and white text contrast equally
    "--radius": `${t.radius}px`,
    "--density": t.density,
    "--font": FONTS[t.font],
  }) as CSSProperties;
