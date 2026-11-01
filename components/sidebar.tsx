"use client";
import { generateId } from "ai";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { usePref } from "@/lib/pref";
import { deletePod, deleteThread, savePod } from "@/lib/actions";
import { MAX_PANES, type Pod } from "@/lib/multiplex";
import { Dialog } from "./dialog";
import { Submit } from "./submit";
import { BookIcon, BotIcon, GearIcon, InboxIcon, MenuIcon, OrbIcon, PanelLeftIcon, PlusIcon, XIcon } from "./icons";

type Thread = { id: string; title: string; updated: number };

// [label, href, icon, path prefix that keeps the tab highlighted]
const tabs = [["Inbox", "/inbox", InboxIcon, "/inbox"], ["Agents", "/agents", BotIcon, "/agents"], ["Library", "/library", BookIcon, "/library"], ["Settings", "/settings", GearIcon, "/settings"]] as const;

// Below md the sidebar is a drawer behind a top bar; from md up it's the column (or the icon rail when collapsed).
// The collapsed classes are md-only so the drawer always shows labels.
// waiting: the chats with an approval waiting on you
export function Sidebar({ threads, pods, waiting }: { threads: Thread[]; pods: Pod[]; waiting: string[] }) {
  const path = usePathname();
  const router = useRouter();
  const params = useSearchParams();
  // the chats open on screen: the one in the path, or its whole pod
  const current = path.startsWith("/chat/") ? path.slice(6) : null;
  const podOf = new Map(pods.flatMap((p) => p.panes.map((x) => [x.id, p] as const)));
  const pod = current ? podOf.get(current) : undefined;
  const panes = pod?.panes ?? (current ? [{ id: current, agent: params.get("agent") ?? undefined }] : []);
  // one list, newest first: pods (as new as their newest chat) and the chats in no pod
  const updated = new Map(threads.map((t) => [t.id, t.updated]));
  const titles = new Map(threads.map((t) => [t.id, t.title]));
  const rows: ({ pod: Pod; thread?: never; at: number } | { pod?: never; thread: Thread; at: number })[] = [
    ...pods.map((p) => ({ pod: p, at: Math.max(p.updated, ...p.panes.map((x) => updated.get(x.id) ?? 0)) })),
    ...threads.filter((t) => !podOf.has(t.id)).map((t) => ({ thread: t, at: t.updated })),
  ].sort((a, b) => b.at - a.at).slice(0, 30);
  const needs = new Set(waiting);
  const dot = <span className="mr-2 inline-block size-2 rounded-full bg-accent"><span className="sr-only">Needs you: </span></span>;
  const [collapsed, setCollapsed] = usePref("sidebar", "collapsed", "expanded");
  const [zen] = usePref("zen");
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  if (zen && current) return null; // zen mode: a chat page is only its chats
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
        <Link href="/" prefetch={false} onClick={(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey) return; /* new tab: "/" redirects there */ e.preventDefault(); close(); router.push(`/chat/${generateId()}`); }} aria-label="New pod" title="New pod" className={`btn flex items-center gap-3 !px-3 text-sm ${rail}`}>
          <PlusIcon className="h-5 w-5" /><span className={hideWhenCollapsed}>New pod</span>
        </Link>
        <div className={`mt-6 flex min-h-0 flex-1 flex-col gap-0.5 ${hideWhenCollapsed}`}>
          {rows.length > 0 && <div className="px-3 pb-1 text-xs text-mute">Recent</div>}
          <div className="flex min-h-0 flex-col gap-0.5 overflow-y-auto">
            {rows.map((r) => {
              if (r.pod) {
                const p = r.pod;
                const here = pod?.id === p.id;
                const name = p.title || titles.get(p.panes[0].id) || "Untitled pod";
                return (
                  <div key={p.id} className="group relative">
                    <Link href={`/chat/${p.panes[0].id}`} onClick={close} className={`${item(here)} flex items-center rounded-ctl !py-1.5 !pl-4 !pr-9 !text-sm`}>
                      {p.panes.some((x) => needs.has(x.id)) && dot}
                      <span className="min-w-0 flex-1 truncate">{name}</span>
                      <span className="ml-2 shrink-0 text-xs text-mute">{p.panes.length}</span>
                    </Link>
                    <div className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100 text-mute hover:text-fg">
                      <Dialog label={<XIcon className="h-3.5 w-3.5" />} title={`Delete “${name}”`} className="grid h-6 w-6 place-items-center rounded-ctl text-current hover:bg-hover pointer-coarse:size-8">
                        <p className="text-sm text-mute">This pod has {p.panes.length} chats.</p>
                        <div className="flex flex-wrap gap-2">
                          <form action={deletePod.bind(null, p.id, false, path)}><Submit className="btn text-xs">Keep the chats</Submit></form>
                          <form action={deletePod.bind(null, p.id, true, here ? "/" : path)}><Submit className="btn-solid text-xs">Delete the chats too</Submit></form>
                        </div>
                      </Dialog>
                    </div>
                  </div>
                );
              }
              const t = r.thread;
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
                      void savePod(pod?.id ?? null, [...panes, { id: t.id }]);
                    }}
                    className={`${item(shown)} rounded-ctl !py-1.5 !pl-4 !pr-9 !text-sm`}>
                    {needs.has(t.id) && dot}{t.title || "Untitled"}
                  </Link>
                  <form action={deleteThread.bind(null, t.id, here ? "/" : path)} className={`absolute right-1 top-1/2 -translate-y-1/2 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100 text-mute hover:text-fg`}>
                    <Submit aria-label={`Delete ${t.title || "chat"}`} className="grid h-6 w-6 place-items-center rounded-ctl text-current hover:bg-hover disabled:opacity-40 pointer-coarse:size-8"><XIcon className="h-3.5 w-3.5" /></Submit>
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
              aria-label={collapsed || (href === "/inbox" && waiting.length) ? `${label}${href === "/inbox" && waiting.length ? `, ${waiting.length} waiting` : ""}` : undefined}
              title={collapsed ? label : undefined}
              className={`${item(on(prefix))} relative flex items-center gap-3 rounded-ctl !px-3 ${rail}`}
            >
              <Icon className="h-5 w-5" /><span className={hideWhenCollapsed}>{label}</span>
              {href === "/inbox" && waiting.length > 0 && (
                <span className={`ml-auto min-w-5 rounded-full bg-accent px-1.5 text-center text-xs leading-5 text-on-accent ${collapsed ? "md:absolute md:-right-1 md:-top-1 md:ml-0" : ""}`}>{waiting.length}</span>
              )}
            </Link>
          ))}
          <button
            onClick={() => setCollapsed(!collapsed)}
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
