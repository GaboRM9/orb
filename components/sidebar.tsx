"use client";
import { generateId } from "ai";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { deleteThread } from "@/lib/actions";
import { chatHref, MAX_PANES, panesOf } from "@/lib/multiplex";
import { Submit } from "./submit";
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
  const router = useRouter();
  const params = useSearchParams();
  // the chats open on screen: the one in the path, plus any split off beside it
  const panes = path.startsWith("/chat/") ? panesOf(path.slice(6), params.get("agent"), params.get("with")) : [];
  const collapsed = useSyncExternalStore(subscribe, readCollapsed, () => false);
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  const item = (on: boolean) => `block truncate px-3 py-2 text-sm transition-colors ${on ? "bg-surface-2" : "hover:bg-hover"}`;
  const on = (prefix: string) => path.startsWith(prefix);
  const hideWhenCollapsed = collapsed ? "md:hidden" : "";
  const rail = collapsed ? "md:mx-auto md:size-10 md:justify-center md:!p-0" : ""; // every collapsed control: one 40px circle on the same centre line
  return (
    <>
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line glass px-4 md:hidden">
        <button onClick={() => setOpen(true)} aria-label="Open menu" className="btn grid h-9 w-9 place-items-center p-0">
          <MenuIcon />
        </button>
        <OrbIcon className="h-6 w-6" label="orb" />
      </header>
      {open && <div onClick={close} className="fixed inset-0 z-30 bg-black/30 backdrop-blur-sm md:hidden" aria-hidden />}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col overflow-hidden border-r border-line bg-surface p-5 transition-[transform,visibility] duration-200 md:static md:z-auto md:shrink-0 md:translate-x-0 md:transition-[width] ${open ? "translate-x-0" : "invisible -translate-x-full md:visible"} ${collapsed ? "md:w-16 md:p-3" : ""}`}
      >
        <div className={`mb-6 px-3 ${collapsed ? "md:flex md:justify-center md:px-0" : ""}`}><OrbIcon className="h-7 w-7" label="orb" /></div>
        {/* the fresh id is made here, on click, so it is never cached and reused, and there's no redirect through "/" */}
        <Link href="/" prefetch={false} onClick={(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey) return; /* new tab: "/" redirects there */ e.preventDefault(); close(); router.push(`/chat/${generateId()}`); }} aria-label="New chat" title="New chat" className={`btn flex items-center gap-3 !px-3 text-sm ${rail}`}>
          <PlusIcon className="h-5 w-5" /><span className={hideWhenCollapsed}>New chat</span>
        </Link>
        <div className={`mt-6 flex min-h-0 flex-1 flex-col gap-0.5 ${hideWhenCollapsed}`}>
          {threads.length > 0 && <div className="px-3 pb-1 text-xs text-mute">Recent</div>}
          <div className="flex min-h-0 flex-col gap-0.5 overflow-y-auto">
            {threads.slice(0, 30).map((t) => {
              const here = path === `/chat/${t.id}`;
              const shown = panes.some((p) => p.id === t.id);
              return (
                <div key={t.id} className="group relative">
                  <Link
                    href={`/chat/${t.id}`}
                    title="Shift-click to open beside this chat"
                    onClick={(e) => {
                      close();
                      // Shift-click splits it in; ⌘/Ctrl-click keeps opening a new tab
                      if (!e.shiftKey || !panes.length || shown || panes.length >= MAX_PANES) return;
                      e.preventDefault();
                      router.replace(chatHref([...panes, { id: t.id }]));
                    }}
                    className={`${item(shown)} rounded-ctl !py-1.5 !pl-4 !pr-9 !text-sm`}>
                    {t.title || "Untitled"}
                  </Link>
                  <form action={deleteThread.bind(null, t.id, here ? "/" : path)} className={`absolute right-1 top-1/2 -translate-y-1/2 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 text-mute hover:text-fg`}>
                    <Submit aria-label={`Delete ${t.title || "chat"}`} className="grid h-6 w-6 place-items-center rounded-ctl text-current hover:bg-hover disabled:opacity-40"><XIcon className="h-3.5 w-3.5" /></Submit>
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
              className={`${item(on(prefix))} flex items-center gap-3 rounded-ctl !px-3 ${rail}`}
            >
              <Icon className="h-5 w-5" /><span className={hideWhenCollapsed}>{label}</span>
            </Link>
          ))}
          <button
            onClick={toggleCollapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={`btn mt-2 hidden place-items-center p-0 md:grid md:size-10 ${collapsed ? "md:mx-auto" : ""}`}
          >
            <PanelLeftIcon className="h-5 w-5" />
          </button>
        </nav>
      </aside>
    </>
  );
}
