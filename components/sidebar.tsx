"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { deleteThread } from "@/lib/actions";
import { BookIcon, BotIcon, GearIcon, MenuIcon, OrbIcon, PanelLeftIcon, PlusIcon, XIcon } from "./icons";

type Thread = { id: string; title: string };

// [label, href, icon, path prefix that keeps the tab highlighted]
const tabs = [["Agents", "/agents", BotIcon, "/agents"], ["Library", "/library", BookIcon, "/library"], ["Settings", "/settings", GearIcon, "/settings"]] as const;

// collapsed state lives in localStorage; the server renders expanded
const listeners = new Set<() => void>();
const readCollapsed = () => {
  try { return localStorage.getItem("sidebar") === "collapsed"; } catch { return false; }
};
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
};
const toggleCollapsed = () => {
  try { localStorage.setItem("sidebar", readCollapsed() ? "expanded" : "collapsed"); } catch {}
  listeners.forEach((cb) => cb());
};

// Below md the sidebar is a drawer behind a top bar; from md up it's the column (or the icon rail when collapsed).
// The collapsed classes are md-only so the drawer always shows labels.
export function Sidebar({ threads }: { threads: Thread[] }) {
  const path = usePathname();
  const collapsed = useSyncExternalStore(subscribe, readCollapsed, () => false);
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  const item =(on: boolean) => `block truncate px-3 py-2 text-[15px] transition-colors ${on ? "text-fg" : "text-mute hover:text-fg"}`;
  const on = (prefix: string) => path.startsWith(prefix);
  const hideWhenCollapsed = collapsed ? "md:hidden" : "";
  return (
    <>
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line glass px-4 md:hidden">
        <button onClick={() => setOpen(true)} aria-label="Open menu" className="btn grid h-9 w-9 place-items-center p-0 text-mute hover:text-fg">
          <MenuIcon />
        </button>
        <div className="flex items-center gap-2 font-mono text-sm font-light tracking-[0.3em]"><OrbIcon className="h-5 w-5" />orb</div>
      </header>
      {open && <div onClick={close} className="fixed inset-0 z-30 bg-black/30 backdrop-blur-sm md:hidden" aria-hidden />}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col overflow-hidden border-r border-line bg-surface p-5 transition-[transform,visibility] duration-200 md:static md:z-auto md:shrink-0 md:translate-x-0 md:transition-[width] ${open ? "translate-x-0" : "invisible -translate-x-full md:visible"} ${collapsed ? "md:w-16 md:p-3" : ""}`}
      >
        <div className="mb-6 flex items-center gap-2.5 px-2 font-mono text-base font-light tracking-[0.3em]">
          <OrbIcon className="h-6 w-6" /><span className={hideWhenCollapsed}>orb</span>
        </div>
        {/* prefetch off: "/" redirects to a fresh chat id, which must not be cached and reused */}
        <Link href="/" prefetch={false} onClick={close} aria-label="New chat" title="New chat" className="btn flex items-center gap-3 !px-3 text-sm">
          <PlusIcon /><span className={hideWhenCollapsed}>New chat</span>
        </Link>
        <div className={`mt-6 flex min-h-0 flex-1 flex-col gap-0.5 ${hideWhenCollapsed}`}>
          {threads.length > 0 && <div className="px-3 pb-1 text-xs text-mute">Recent</div>}
          <div className="flex min-h-0 flex-col gap-0.5 overflow-y-auto">
            {threads.slice(0, 30).map((t) => {
              const here = path === `/chat/${t.id}`;
              return (
                <div key={t.id} className="group relative">
                  <Link href={`/chat/${t.id}`} onClick={close} className={`${item(here)} rounded-md !py-1.5 !pr-9 !text-sm ${here ? "bg-fg/5" : "hover:bg-fg/5"}`}>
                    {t.title || "Untitled"}
                  </Link>
                  <form action={deleteThread.bind(null, t.id, here ? "/" : path)} className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                    <button aria-label={`Delete ${t.title || "chat"}`} className="grid h-6 w-6 place-items-center rounded-full text-mute hover:text-fg"><XIcon className="h-3.5 w-3.5" /></button>
                  </form>
                </div>
              );
            })}
          </div>
        </div>
        <nav className="flex flex-col gap-1 pt-4">
          {tabs.map(([label, href, Icon, prefix]) => (
            <Link
              key={label}
              href={href}
              onClick={close}
              aria-label={collapsed ? label : undefined}
              title={collapsed ? label : undefined}
              className={`${item(on(prefix))} flex items-center gap-3 rounded-md ${on(prefix) ? "bg-fg/5" : "hover:bg-fg/5"}`}
            >
              <Icon /><span className={hideWhenCollapsed}>{label}</span>
            </Link>
          ))}
          <button
            onClick={toggleCollapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="btn mt-2 hidden place-items-center p-0 text-mute hover:text-fg md:grid md:h-9 md:w-9"
          >
            <PanelLeftIcon />
          </button>
        </nav>
      </aside>
    </>
  );
}
