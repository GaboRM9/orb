"use client";
import { generateId } from "ai";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { delegateBrief, renamePod, savePod, savePodGoal } from "@/lib/actions";
import { MAX_PANES, replacePane, rowSizes, spans, type Pane } from "@/lib/multiplex";
import { Chat, drafts, type PaneStatus } from "./chat";
import { Dialog } from "./dialog";
import type { ChatMessage } from "./gen-ui";
import { GridIcon, LinkIcon, MaximizeIcon, MinimizeIcon, SplitIcon, XIcon } from "./icons";

type LoadedPane = { id: string; messages: ChatMessage[]; title?: string; agent?: { id: string; name: string; description: string }; sees?: string[] };
type Option = { id: string; name: string };

const dot = (s?: PaneStatus["state"]) => (s === "needs" ? "bg-accent" : s === "working" ? "motion-safe:animate-pulse bg-accent/50" : "bg-line");
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

const nameOf = (p: LoadedPane) => p.agent?.name ?? "orb";
/** Puts the cursor in a pane's composer; phones swipe to it too. */
const focusPane = (id: string) => {
  document.querySelector<HTMLTextAreaElement>(`#pane-${CSS.escape(id)} textarea`)?.focus();
  if (!matchMedia("(min-width: 48rem)").matches) document.getElementById(`pane-${id}`)?.scrollIntoView({ inline: "start", block: "nearest" });
};

/** Which other panes of the pod this pane's agent may read (readPane). One-way; "both ways" links the checked ones back. */
function LinkMenu({ pane, others, save }: { pane: LoadedPane; others: LoadedPane[]; save: (sees: string[], both: boolean) => void }) {
  return (
    <Dialog label={<LinkIcon className="h-3.5 w-3.5" />} title={`What ${nameOf(pane)} can read`} className="grid h-6 w-6 place-items-center rounded-ctl text-mute hover:bg-hover hover:text-fg pointer-coarse:size-8">
      <form key={pane.sees?.join()} method="dialog" className="space-y-4" onSubmit={(e) => {
        const f = new FormData(e.currentTarget);
        save(f.getAll("sees").map(String), f.has("both"));
      }}>
        <p className="text-xs text-mute">Chats are private to their pane until you link them. A linked chat is read only when the agent needs it.</p>
        <div className="space-y-2">
          {others.map((o) => (
            <label key={o.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="sees" value={o.id} defaultChecked={pane.sees?.includes(o.id)} />
              <span className="shrink-0 font-medium">{nameOf(o)}</span>
              <span className="min-w-0 truncate text-mute">{o.title || "New chat"}</span>
            </label>
          ))}
        </div>
        <label className="flex items-center gap-2 text-xs text-mute"><input type="checkbox" name="both" /> Both ways: the checked chats can read this one too</label>
        <button className="btn-solid text-xs">Save</button>
      </form>
    </Dialog>
  );
}

/**
 * The pane's agent. An empty chat just switches; one with history hands off: a new chat with that agent takes the
 * slot, opening with a brief of this one, and this one carries on as a chat of its own.
 */
function AgentPicker({ pane, agents, started, pick, className }: {
  pane: LoadedPane; agents: Option[]; started: boolean; pick: (agent: string) => Promise<string | void>; className: string;
}) {
  const [state, setState] = useState(""); // "busy", or the hand-off error
  return (
    <label className="flex min-w-0 items-center gap-1.5">
      <span className="sr-only">{started ? "Hand this chat off to another agent" : "Agent for this chat"}</span>
      <select
        value={pane.agent?.id ?? ""}
        disabled={state === "busy"}
        title={started ? "Pick an agent to hand this chat off with a brief" : "Agent for this chat"}
        onChange={async (e) => {
          setState("busy");
          setState((await pick(e.target.value)) ?? "");
        }}
        className={className}
      >
        {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>
      {state && <span role="status" className="truncate text-xs text-mute">{state === "busy" ? "Writing the brief…" : state}</span>}
    </label>
  );
}

const SHORTCUTS = [["⌃⌥ ← / →", "Previous or next pane"], ["⌃⌥ Enter", "Maximize or restore the pane"], ["Esc", "Restore"], ["?", "These shortcuts"]];

/** The pod's optional shared goal: every agent in the pod reads it each turn. */
function GoalMenu({ pod }: { pod: { id: string; goal: string | null } }) {
  return (
    <Dialog label="Goal" title="Shared goal" className={`chip shrink-0 ${pod.goal ? "border-accent" : "text-mute"}`}>
      <form key={pod.goal} method="dialog" className="space-y-4" onSubmit={(e) => void savePodGoal(pod.id, String(new FormData(e.currentTarget).get("goal") ?? ""))}>
        <p className="text-xs text-mute">Optional. Every agent in this pod sees it on each turn, so their work stays aimed at the same thing. Leave it blank for none.</p>
        <textarea name="goal" rows={4} maxLength={2000} defaultValue={pod.goal ?? ""} placeholder="e.g. Ship the Q4 launch plan: budget $20k, ready by Nov 15" className="field w-full" />
        <button className="btn-solid text-xs">Save</button>
      </form>
    </Dialog>
  );
}

/**
 * A pod: one chat, or up to 10 side by side once you split it. The panes are one flat list in every layout, so
 * splitting or resizing never remounts a running chat: phones swipe between full-screen panes (scroll-snap); from md
 * they're a 12-column grid of even rows, at most 2 columns until lg, then 4. ⤢ gives one pane 2/3 of the screen.
 */
export function Multiplex({ pod, focus, panes, agents, threads, canAlwaysAllow }: {
  pod?: { id: string; title: string | null; goal: string | null }; focus: string; // the chat in the URL
  panes: LoadedPane[]; agents: Option[]; threads: { id: string; title: string }[]; canAlwaysAllow?: boolean;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<Record<string, PaneStatus>>({});
  const [max, setMax] = useState<string | null>(null);
  const [overview, setOverview] = useState(false);
  const [current, setCurrent] = useState(0);
  const [said, setSaid] = useState(""); // what the live region last announced
  const [fresh, setFresh] = useState<string>(); // the pane just added: its composer takes focus
  const refocus = useRef<string>(undefined); // after a close: the neighbour that takes focus
  const n = panes.length;
  const split = n > 1;
  const list: Pane[] = panes.map((p) => ({ id: p.id, agent: p.agent?.id, sees: p.sees }));

  const maxed = split && panes.some((p) => p.id === max) ? max : null;
  // ⌃⌥ because the obvious keys are taken: ⌘[ is Back, ⌥/⇧ arrows move through the text you're typing
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const at = panes.findIndex((p) => document.getElementById(`pane-${p.id}`)?.contains(document.activeElement));
      const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName));
      if (e.key === "Escape" && maxed) setMax(null);
      else if (e.ctrlKey && e.altKey && (e.key === "ArrowRight" || e.key === "ArrowLeft") && n > 1)
        focusPane(panes[(Math.max(at, 0) + (e.key === "ArrowRight" ? 1 : n - 1)) % n].id);
      else if (e.ctrlKey && e.altKey && e.key === "Enter" && split && at >= 0) setMax((m) => (m === panes[at].id ? null : panes[at].id));
      else if (e.key === "?" && !typing) document.getElementById("shortcuts")?.click();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // saved, then the page refreshes with it; closing the chat in the URL opens one that's left
  // ponytail: that open remounts the other panes; a running one reloads from the database once its turn is saved
  const go = async (next: Pane[], to?: string) => {
    await savePod(pod?.id ?? null, next);
    const open = to ? next.find((p) => p.id === to) : next.some((p) => p.id === focus) ? undefined : next[0];
    if (open) router.replace(`/chat/${open.id}${open.agent ? `?agent=${open.agent}` : ""}`);
  };
  // what the live chat holds, not what the page loaded with: a pane chatted in since is no longer empty
  const started = (p: LoadedPane) => (status[p.id]?.count ?? p.messages.length) > 0;
  const pick = (p: LoadedPane) => async (agent: string): Promise<string | void> => {
    if (agent === p.agent?.id) return;
    if (!started(p)) return split ? void (await go(replacePane(list, p.id, { id: p.id, agent }))) : router.replace(`/chat/${p.id}?agent=${agent}`);
    const r = await delegateBrief(p.id).catch(() => ({ error: "Couldn't summarize this chat. Try again." }));
    if ("error" in r) return r.error;
    const id = generateId();
    drafts.set(id, `${r.brief}\n\nYour task: `);
    setFresh(id);
    if (!split) return router.push(`/chat/${id}?agent=${agent}`);
    await go(replacePane(list, p.id, { id, agent }), p.id === focus ? id : undefined);
  };
  const link = (id: string) => (sees: string[], both: boolean) =>
    go(list.map((q) => (q.id === id ? { ...q, sees } : both && sees.includes(q.id) ? { ...q, sees: [...(q.sees ?? []), id] } : q)));
  // opened from a link to one of its chats (Inbox, a schedule): phones swipe to that pane
  const first = panes[0]?.id;
  useEffect(() => {
    if (focus !== first && !matchMedia("(min-width: 48rem)").matches) document.getElementById(`pane-${focus}`)?.scrollIntoView({ inline: "start", block: "nearest" });
  }, [focus, first]);
  const addAfter = (i: number) => (p: Pane) => (setFresh(p.id), go([...list.slice(0, i + 1), p, ...list.slice(i + 1)]));
  const close = (i: number) => {
    refocus.current = (list[i + 1] ?? list[i - 1])?.id;
    void go(list.filter((_, k) => k !== i));
  };
  useEffect(() => {
    if (!refocus.current || !panes.some((p) => p.id === refocus.current)) return;
    focusPane(refocus.current);
    refocus.current = undefined;
  }, [panes]);
  // background panes speak up: a screen reader hears when one needs you or finishes
  const onStatus = (p: LoadedPane) => (st: PaneStatus) => {
    const was = status[p.id]?.state;
    if (split && was && was !== st.state && (st.state === "needs" || was === "working"))
      setSaid(st.state === "needs" ? `${nameOf(p)} needs you` : `${nameOf(p)} finished`);
    setStatus((prev) => ({ ...prev, [p.id]: st }));
  };
  // desktop: maximize it; phone: swipe to it
  const show = (id: string) => {
    setOverview(false);
    if (matchMedia("(min-width: 48rem)").matches) setMax(id);
    else document.getElementById(`pane-${id}`)?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", inline: "start", block: "nearest" });
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
      <div aria-live="polite" className="sr-only">{said}</div>
      {/* opened with ?; hidden until it takes keyboard focus */}
      <Dialog id="shortcuts" label="Keyboard shortcuts" title="Keyboard shortcuts" className="btn sr-only text-xs focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-30">
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
          {SHORTCUTS.map(([k, what]) => <div key={k} className="contents"><dt className="font-mono text-xs leading-5">{k}</dt><dd className="text-mute">{what}</dd></div>)}
        </dl>
      </Dialog>
      {split && (
        <div className="flex h-12 shrink-0 items-center gap-3 border-b border-line px-4">
          {pod && (
            <input
              key={pod.title}
              aria-label="Pod name"
              defaultValue={pod.title ?? ""}
              placeholder={panes[0]?.title || "Untitled pod"}
              onBlur={(e) => e.target.value !== (pod.title ?? "") && void renamePod(pod.id, e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
              className="min-w-0 max-w-48 truncate bg-transparent text-sm font-medium outline-none placeholder:text-fg"
            />
          )}
          {pod && <GoalMenu pod={pod} />}
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
        <div className="fixed right-4 top-2.5 z-20 flex items-center gap-2 md:top-4">
          <AgentPicker pane={panes[0]} agents={agents} started={started(panes[0])} pick={pick(panes[0])} className="btn glass h-9 max-w-40 truncate py-0 text-xs" />
          <SplitMenu from={panes[0]} agents={agents} closed={closed} add={addAfter(0)} className="btn glass grid h-9 w-9 place-items-center p-0" />
        </div>
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
                aria-label={`${nameOf(p)}: ${p.title || "New chat"}`}
                style={place(p.id, i)}
                className={`flex h-full w-full shrink-0 snap-start flex-col overflow-hidden md:w-auto md:[grid-column:var(--c)] md:[grid-row:var(--r)] lg:[grid-column:var(--cl)] ${split ? `md:rounded-lg md:border ${s === "needs" ? "md:border-accent" : "md:border-line"}` : ""}`}
              >
                {split && (
                  <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line px-3 text-xs">
                    <span title={label(s)} className={`size-2 shrink-0 rounded-full ${dot(s)}`}><span className="sr-only">{label(s)}</span></span>
                    <AgentPicker pane={p} agents={agents} started={started(p)} pick={pick(p)} className="max-w-32 shrink-0 truncate rounded-ctl bg-transparent font-medium hover:bg-hover" />
                    <span className="min-w-0 flex-1 truncate text-mute">
                      {p.sees?.length ? `↳ sees ${panes.filter((o) => p.sees!.includes(o.id)).map(nameOf).join(", ")} · ` : ""}{p.title}
                    </span>
                    <LinkMenu pane={p} others={panes.filter((o) => o.id !== p.id)} save={link(p.id)} />
                    {canSplit && <SplitMenu from={p} agents={agents} closed={closed} add={addAfter(i)} className="grid h-6 w-6 place-items-center rounded-ctl text-mute hover:bg-hover hover:text-fg pointer-coarse:size-8" />}
                    <button onClick={() => setMax(maxed === p.id ? null : p.id)} aria-label={maxed === p.id ? "Restore" : "Maximize"} title={maxed === p.id ? "Restore (Esc)" : "Maximize"} className="hidden h-6 w-6 place-items-center rounded-ctl text-mute hover:bg-hover hover:text-fg md:grid">
                      {maxed === p.id ? <MinimizeIcon className="h-3.5 w-3.5" /> : <MaximizeIcon className="h-3.5 w-3.5" />}
                    </button>
                    {/* closing a pane doesn't stop its run: like closing a tab, it finishes and is saved */}
                    <button onClick={() => close(i)} aria-label="Close pane" title="Close pane" className="grid h-6 w-6 place-items-center rounded-ctl text-mute hover:bg-hover hover:text-fg pointer-coarse:size-8"><XIcon className="h-3.5 w-3.5" /></button>
                  </div>
                )}
                <div className="min-h-0 flex-1">
                  <Chat compact={split} focus={p.id === fresh} id={p.id} initialMessages={p.messages} agent={p.agent} canAlwaysAllow={canAlwaysAllow} onStatus={onStatus(p)} />
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
                  <span className={`size-2 shrink-0 rounded-full ${dot(status[p.id]?.state)}`}><span className="sr-only">{label(status[p.id]?.state)}: </span></span>
                  <span className="truncate font-medium">{nameOf(p)}</span>
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
