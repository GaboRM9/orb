"use client";
import { useSyncExternalStore } from "react";
import { MoonIcon, SunIcon } from "./icons";

const query = "(prefers-color-scheme: dark)";
const listeners = new Set<() => void>();

// no saved choice means "system": follow the OS
const savedTheme = () => {
  try { return localStorage.getItem("theme"); } catch { return null; }
};
const isDark = () => {
  const saved = savedTheme();
  return saved === "dark" || (saved !== "light" && matchMedia(query).matches);
};
const apply = () => document.documentElement.classList.toggle("dark", isDark());

const subscribe = (cb: () => void) => {
  const mq = matchMedia(query);
  const onOsChange = () => { apply(); cb(); };
  listeners.add(cb);
  mq.addEventListener("change", onOsChange);
  return () => {
    listeners.delete(cb);
    mq.removeEventListener("change", onOsChange);
  };
};

const flip = () => {
  try { localStorage.setItem("theme", isDark() ? "light" : "dark"); } catch {}
  apply();
  listeners.forEach((cb) => cb());
};

export function ThemeToggle() {
  // the server doesn't know the OS or saved theme, so it renders the light icon and the client corrects it on hydrate
  const dark = useSyncExternalStore(subscribe, isDark, () => false);
  const label = dark ? "Switch to light mode" : "Switch to dark mode";
  return (
    <button onClick={flip} aria-label={label} title={label} className="btn grid h-9 w-9 place-items-center p-0 text-mute hover:text-fg">
      {dark ? <MoonIcon /> : <SunIcon />}
    </button>
  );
}
