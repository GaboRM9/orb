"use client";
import { generateId } from "ai";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { delegateBrief } from "@/lib/actions";
import { chatHref, MAX_PANES, rowSizes, spans, type Pane } from "@/lib/multiplex";
import { Chat, drafts, type PaneStatus } from "./chat";
import { Dialog } from "./dialog";
import type { ChatMessage } from "./gen-ui";
import { GridIcon, MaximizeIcon, MinimizeIcon, SplitIcon, XIcon } from "./icons";

type LoadedPane = { id: string; messages: ChatMessage[]; title?: string; agent?: { id: string; name: string; description: string } };
type Option = { id: string; name: string };

const dot = (s?: PaneStatus["state"]) => (s === "needs" ? "bg-accent" : s === "working" ? "animate-pulse bg-accent/50" : "bg-line");
const label = (s?: PaneStatus["state"]) => (s === "needs" ? "Needs you" : s === "working" ? "Working" : "Idle");
const rows = (n: number) => `repeat(${n}, minmax(0, 1fr))`;

/** Split a pane: a new chat beside it (blank, or delegated: opening with a brief of this one), or an existing chat. */
function SplitMenu({ from, agents, closed, add, className }: {
  from: LoadedPane; agents: Option[]; closed: Option[]; add: (p: Pane) => void; className: string;
}) {
  const [agent, setAgent] = useState(from.agent?.id ?? agents[0]?.id);
  const [task, setTask] = useState<"idle" | "busy" | string>("idle"); // a string is the delegate error
  const delegate = async (e: React.MouseEvent<HTMLButtonElement>) => {
    const dialog = e.currentTarget.closest("dialog");
    setTask("busy");
    const r = await delegateBrief(from.id).catch(() => ({ error: "Couldn't summarize this chat. Try again." }));
    if ("error" in r) return setTask(r.error);
    setTask("idle");
    const id = generateId();
    drafts.set(id, `${r.brief}\n\nYour task: `);
    dialog?.close();
    add({ id, agent });
  };
  return (
    <Dialog label={<SplitIcon className="h-3.5 w-3.5" />} title="Split" className={className}>
      {/* method=dialog: the plain picks also close the dialog */}
      <form method="dialog" className="space-y-5">
        <label className="block space-y-2">
          <span className="text-xs text-mute">Agent</span>
          <select className="field" value={agent} onChange={(e) => setAgent(e.target.value)}>
            {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
        <div className="flex flex-wrap gap-2">
          <button className="btn text-xs" onClick={() => add({ id: generateId(), agent })}>New chat</button>
          <button type="button" className="btn-solid text-xs" disabled={task === "busy"} onClick={delegate} title="A new chat that opens with a brief of this one; add its task and send">
            {task === "busy" ? "Writing the brief…" : "Delegate from this chat"}
          </button>
        </div>
        {task !== "idle" && task !== "busy" && <p role="status" className="text-xs text-mute">{task}</p>}
        {closed.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs text-mute">Or open a chat</div>
            <div className="flex max-h-64 flex-col overflow-y-auto">
              {closed.map((t) => <button key={t.id} className="row-hover truncate rounded-ctl px-3 py-1.5 text-left text-sm" onClick={() => add({ id: t.id })}>{t.name || "Untitled"}</button>)}
            </div>
          </div>
        )}
      </form>
    </Dialog>
  );
}

/**
 * A chat page: one chat, or up to 10 side by side once you split it. The panes are one flat list in every layout, so
 * splitting or resizing never remounts a running chat: phones swipe between full-screen panes (scroll-snap); from md
 * they're a 12-column grid of even rows, at most 2 columns until lg, then 4. ⤢ gives one pane 2/3 of the screen.
 */
export function Multiplex({ panes, agents, threads, canAlwaysAllow }: {
  panes: LoadedPane[]; agents: Option[]; threads: { id: string; title: string }[]; canAlwaysAllow?: boolean;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<Record<string, PaneStatus>>({});
  const [max, setMax] = useState<string | null>(null);
  const [overview, setOverview] = useState(false);
  const [current, setCurrent] = useState(0);
  const n = panes.length;
  const split = n > 1;
  // a pane keeps its agent in the URL only until its thread is saved with it
  const list: Pane[] = panes.map((p) => ({ id: p.id, agent: p.messages.length ? undefined : p.agent?.id }));

  const maxed = split && panes.some((p) => p.id === max) ? max : null;
  useEffect(() => {
    if (!maxed) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMax(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [maxed]);

  const go = (next: Pane[]) => router.replace(chatHref(next));
  const addAfter = (i: number) => (p: Pane) => go([...list.slice(0, i + 1), p, ...list.slice(i + 1)]);
  // desktop: maximize it; phone: swipe to it
  const show = (id: string) => {
    setOverview(false);
    if (matchMedia("(min-width: 48rem)").matches) setMax(id);
    else document.getElementById(`pane-${id}`)?.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" });
  };

  const working = panes.filter((p) => status[p.id]?.state === "working").length;
  const needs = panes.filter((p) => status[p.id]?.state === "needs");
  const [md, lg] = [spans(n, 2), spans(n, 4)];
  const grid = (maxed
    ? { "--rows-md": rows(n - 1), "--rows-lg": rows(n - 1) }
    : { "--rows-md": rows(rowSizes(n, 2).length), "--rows-lg": rows(rowSizes(n, 4).length) }) as React.CSSProperties;
  const place = (id: string, i: number) =>
    (maxed
      ? id === maxed ? { "--c": "1 / span 8", "--cl": "1 / span 8", "--r": `1 / span ${n - 1}` } : { "--c": "span 4", "--cl": "span 4", "--r": "auto" }
      : { "--c": `span ${md[i]}`, "--cl": `span ${lg[i]}`, "--r": "auto" }) as React.CSSProperties;
  const closed = threads.filter((t) => !panes.some((p) => p.id === t.id)).map((t) => ({ id: t.id, name: t.title }));
  const canSplit = n < MAX_PANES;

  return (
    <div className="flex h-full flex-col">
      {split && (
        <div className="flex h-12 shrink-0 items-center gap-3 border-b border-line px-4">
          <span className="hidden text-xs text-mute md:inline">{n} of {MAX_PANES}{working ? ` · ${working} working` : ""}</span>
          {/* phones: one dot per pane, the one on screen drawn long; tap to jump */}
          <div className="flex items-center md:hidden">
            {panes.map((p, i) => (
              <button key={p.id} onClick={() => show(p.id)} aria-label={`${p.agent?.name ?? "orb"}: ${label(status[p.id]?.state)}`} className="p-1">
                <span className={`block h-2 rounded-full transition-[width] ${i === current ? "w-5" : "w-2"} ${dot(status[p.id]?.state)}`} />
              </button>
            ))}
          </div>
          {needs.length > 0 && (
            <button onClick={() => show(needs[0].id)} className="chip shrink-0 border-accent">{needs.length} need{needs.length === 1 ? "s" : ""} you</button>
          )}
          <span className="flex-1" />
          <button onClick={() => setOverview(!overview)} aria-label="Overview" aria-pressed={overview} className={`btn grid h-8 w-8 place-items-center p-0 md:hidden ${overview ? "bg-surface-2" : ""}`}><GridIcon /></button>
        </div>
      )}
      {/* one pane: no pane chrome, just this button where the pane header would be */}
      {!split && panes[0] && (
        <SplitMenu from={panes[0]} agents={agents} closed={closed} add={addAfter(0)} className="btn glass fixed right-4 top-2.5 z-20 grid h-9 w-9 place-items-center p-0 md:top-4" />
      )}
      <div className="relative flex min-h-0 flex-1">
        <div
          style={grid}
          onScroll={(e) => setCurrent(Math.round(e.currentTarget.scrollLeft / e.currentTarget.clientWidth))}
          className={`flex min-w-0 flex-1 snap-x snap-mandatory overflow-x-auto overflow-y-hidden md:grid md:grid-cols-12 md:overflow-hidden md:[grid-template-rows:var(--rows-md)] lg:[grid-template-rows:var(--rows-lg)] ${split ? "md:gap-3 md:p-3" : ""}`}
        >
          {panes.map((p, i) => {
            const s = status[p.id]?.state;
            return (
              <section
                key={p.id}
                id={`pane-${p.id}`}
                aria-label={p.agent?.name ?? "Chat"}
                style={place(p.id, i)}
                className={`flex h-full w-full shrink-0 snap-start flex-col overflow-hidden md:w-auto md:[grid-column:var(--c)] md:[grid-row:var(--r)] lg:[grid-column:var(--cl)] ${split ? `md:rounded-lg md:border ${s === "needs" ? "md:border-accent" : "md:border-line"}` : ""}`}
              >
                {split && (
                  <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line px-3 text-xs">
                    <span title={label(s)} className={`size-2 shrink-0 rounded-full ${dot(s)}`} />
                    <span className="shrink-0 font-medium">{p.agent?.name ?? "orb"}</span>
                    <span className="min-w-0 flex-1 truncate text-mute">{p.title}</span>
                    {canSplit && <SplitMenu from={p} agents={agents} closed={closed} add={addAfter(i)} className="grid h-6 w-6 place-items-center rounded-ctl text-mute hover:bg-hover hover:text-fg" />}
                    <button onClick={() => setMax(maxed === p.id ? null : p.id)} aria-label={maxed === p.id ? "Restore" : "Maximize"} title={maxed === p.id ? "Restore (Esc)" : "Maximize"} className="hidden h-6 w-6 place-items-center rounded-ctl text-mute hover:bg-hover hover:text-fg md:grid">
                      {maxed === p.id ? <MinimizeIcon className="h-3.5 w-3.5" /> : <MaximizeIcon className="h-3.5 w-3.5" />}
                    </button>
                    {/* closing a pane doesn't stop its run: like closing a tab, it finishes and is saved */}
                    <button onClick={() => go(list.filter((q) => q.id !== p.id))} aria-label="Close pane" title="Close pane" className="grid h-6 w-6 place-items-center rounded-ctl text-mute hover:bg-hover hover:text-fg"><XIcon className="h-3.5 w-3.5" /></button>
                  </div>
                )}
                <div className="min-h-0 flex-1">
                  <Chat compact={split} id={p.id} initialMessages={p.messages} agent={p.agent} canAlwaysAllow={canAlwaysAllow} onStatus={(st) => setStatus((prev) => ({ ...prev, [p.id]: st }))} />
                </div>
              </section>
            );
          })}
        </div>
        {/* phones: every pane at a glance, tap one to open it */}
        {overview && split && (
          <div className="absolute inset-0 z-10 grid auto-rows-min grid-cols-2 gap-3 overflow-y-auto bg-bg p-4 md:hidden">
            {panes.map((p) => (
              <button key={p.id} onClick={() => show(p.id)} className={`card space-y-1.5 !p-3 text-left ${status[p.id]?.state === "needs" ? "border-accent" : ""}`}>
                <div className="flex items-center gap-2 text-xs">
                  <span className={`size-2 shrink-0 rounded-full ${dot(status[p.id]?.state)}`} />
                  <span className="truncate font-medium">{p.agent?.name ?? "orb"}</span>
                </div>
                <p className="line-clamp-3 text-xs text-mute">{status[p.id]?.snippet || p.title || label(status[p.id]?.state)}</p>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
