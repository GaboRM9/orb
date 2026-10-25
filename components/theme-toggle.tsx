"use client";

export function ThemeToggle() {
  const flip = () => {
    const dark = document.documentElement.classList.toggle("dark");
    try { localStorage.theme = dark ? "dark" : "light"; } catch {}
  };
  return <button className="btn w-full text-mute" onClick={flip}>Appearance</button>;
}
