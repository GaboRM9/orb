"use client";

export function ThemeToggle() {
  const flip = () => {
    const dark = document.documentElement.classList.toggle("dark");
    try { localStorage.theme = dark ? "dark" : "light"; } catch {}
  };
  return <button className="btn w-full" onClick={flip}>Toggle theme</button>;
}
