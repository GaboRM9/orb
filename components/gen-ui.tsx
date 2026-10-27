"use client";
import type { InferUITools, UIMessage } from "ai";
import { useState } from "react";
import type { retiredUiTools, uiTools } from "@/lib/ui-tools";

export type ChatMessage = UIMessage<never, never, InferUITools<typeof uiTools & typeof retiredUiTools>>;
type AddOutput = (a: { tool: string; toolCallId: string; output: unknown }) => void;
type Part = ChatMessage["parts"][number];
/** What a rendered part can do: answer a client tool, or send a follow-up message (only from the newest reply, when idle). */
export type UiCtx = { addOutput: AddOutput; send: (text: string) => void; live: boolean };

const Title = ({ children }: { children?: string }) => (children ? <div className="mb-3 text-sm font-medium">{children}</div> : null);

/** Returns a component for known UI-tool parts, or null so the caller falls back to the generic card. */
export function renderUiPart(p: Part, ctx: UiCtx) {
  const { addOutput } = ctx;
  switch (p.type) {
    case "tool-answerVerdict": {
      const i = p.input;
      if (!i?.headline) return <Skeleton label="Working out the answer…" />;
      return (
        <div className="space-y-3">
          <div className="card space-y-1">
            <div className="text-lg font-medium leading-snug tracking-tight">{i.headline}</div>
            {i.reason && <p className="text-sm text-mute">{i.reason}</p>}
            {i.caveat && <p className="pt-1 text-xs"><span className="chip mr-2 border-accent">Heads-up</span>{i.caveat}</p>}
          </div>
          <Evidence e={i.evidence} />
          <Actions actions={i.actions} ctx={ctx} />
        </div>
      );
    }
    case "tool-answerOptions": {
      const i = p.input;
      if (!i?.options?.length) return <Skeleton label="Lining up options…" />;
      return (
        <div className="space-y-3">
          {i.question && <div className="text-sm font-medium">{i.question}</div>}
          <div className="grid gap-3 sm:grid-cols-2">
            {i.options.map((o, n) => o?.title && (
              <div key={n} className={`card flex flex-col gap-2 ${o.recommended ? "border-accent" : ""}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="font-medium">{o.title}</div>
                  {o.recommended && <span className="chip border-accent bg-accent text-on-accent">Recommended</span>}
                </div>
                <ul className="flex-1 space-y-0.5 text-sm text-mute">{o.facts?.map((f, k) => <li key={k}>{f}</li>)}</ul>
                <button className={`${o.recommended ? "btn-solid" : "btn"} self-start !py-1.5 text-xs`} disabled={!ctx.live} onClick={() => ctx.send(`I'll go with ${o.title}.`)}>
                  Pick
                </button>
              </div>
            ))}
          </div>
          <Evidence e={i.evidence} />
          <Actions actions={i.actions} ctx={ctx} />
        </div>
      );
    }
    case "tool-askUser": {
      if (p.state === "output-available") return <Answered label={p.input.title} text={Object.entries(p.output).map(([k, v]) => `${k}: ${v}`).join(" · ")} />;
      if (p.state === "input-available") return <Form key={p.toolCallId} input={p.input} onSubmit={(output) => addOutput({ tool: "askUser", toolCallId: p.toolCallId, output })} />;
      return <Skeleton label="Preparing form…" />;
    }
    case "tool-choose": {
      if (p.state === "output-available") return <Answered label={p.input.question} text={p.output.label} />;
      if (p.state === "input-available")
        return (
          <div className="card">
            <Title>{p.input.question}</Title>
            <div className="grid gap-2 sm:grid-cols-2">
              {p.input.options.map((o) => (
                <button key={o.id} className="btn rounded-lg text-left" onClick={() => addOutput({ tool: "choose", toolCallId: p.toolCallId, output: { id: o.id, label: o.label } })}>
                  <div>{o.label}</div>
                  {o.description && <div className="text-xs text-mute">{o.description}</div>}
                </button>
              ))}
            </div>
          </div>
        );
      return <Skeleton label="Preparing options…" />;
    }
    case "tool-showPlan": {
      const i = p.input;
      if (!i?.steps) return <Skeleton label="Planning…" />;
      const mark = { todo: "○", doing: "◐", done: "●" } as const;
      return (
        <div className="card">
          <Title>{i.title}</Title>
          <ol className="space-y-1.5 text-sm">
            {i.steps.map((s, n) => (
              <li key={n} className={s?.status === "todo" ? "text-mute" : ""}>
                <span className="mr-2 font-mono">{s?.status ? mark[s.status] : "○"}</span>
                <span className={s?.status === "done" ? "line-through" : ""}>{s?.title}</span>
              </li>
            ))}
          </ol>
        </div>
      );
    }
    case "tool-showCards": {
      const i = p.input;
      if (!i?.cards) return <Skeleton label="Building cards…" />;
      return (
        <div>
          <Title>{i.title}</Title>
          <div className="grid gap-3 sm:grid-cols-2">
            {i.cards.map((c, n) => (
              <div key={n} className="card">
                <div className="flex items-start justify-between gap-2">
                  <div className="font-medium">{c?.title}</div>
                  {c?.tag && <span className="chip">{c.tag}</span>}
                </div>
                {c?.subtitle && <div className="text-xs text-mute">{c.subtitle}</div>}
                <p className="mt-2 text-sm">{c?.body}</p>
                {c?.price && <div className="mt-2 font-mono text-sm">{c.price}</div>}
              </div>
            ))}
          </div>
        </div>
      );
    }
    case "tool-showTable":
      return p.input?.columns ? <div className="card"><TableView {...(p.input as TableData)} /></div> : <Skeleton label="Building table…" />;
    case "tool-showChart":
      return p.input?.data ? <div className="card"><ChartView {...(p.input as ChartData)} /></div> : <Skeleton label="Drawing chart…" />;
    case "tool-showTimeline":
      return p.input?.events ? <div className="card"><TimelineView {...(p.input as TimelineData)} /></div> : <Skeleton label="Building timeline…" />;
    case "tool-showMap": {
      const i = p.input;
      if (!i?.places?.length) return <Skeleton label="Loading map…" />;
      return <div className="card"><MapView title={i.title ?? ""} places={validPlaces(i.places)} /></div>;
    }
  }
  return null;
}

// Partial inputs arrive while the model streams, so every field below may still be missing.
type TableData = { title?: string; columns?: (string | undefined)[]; rows?: ((string | undefined)[] | undefined)[] };
type ChartData = { title?: string; unit?: string; data?: ({ label?: string; value?: number } | undefined)[] };
type TimelineData = { title?: string; events?: ({ when?: string; title?: string; detail?: string } | undefined)[] };
type EvidenceData = ({ kind?: "table" } & TableData) | ({ kind?: "chart" } & ChartData) | ({ kind?: "timeline" } & TimelineData) | { kind?: "map"; title?: string; places?: unknown[] };

const validPlaces = (places: unknown[] | undefined) =>
  (places ?? []).filter((x): x is Place => typeof (x as Place)?.lat === "number" && typeof (x as Place)?.lng === "number" && !!(x as Place).name);

function TableView({ title, columns, rows }: TableData) {
  return (
    <div className="overflow-x-auto">
      <Title>{title}</Title>
      <table className="w-full border-collapse text-left text-sm">
        <thead><tr>{columns?.map((c, n) => <th key={n} className="border-b border-line py-1.5 pr-4 font-medium">{c}</th>)}</tr></thead>
        <tbody>
          {rows?.map((r, n) => (
            <tr key={n}>{r?.map((c, k) => <td key={k} className="border-b border-line py-1.5 pr-4">{c}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ChartView({ title, unit, data }: ChartData) {
  const max = Math.max(1, ...(data ?? []).map((d) => d?.value ?? 0));
  return (
    <div>
      <Title>{title}</Title>
      <div className="space-y-2">
        {data?.map((d, n) => (
          <div key={n} className="grid grid-cols-[7rem_1fr_auto] items-center gap-3 text-xs">
            <span className="truncate text-mute">{d?.label}</span>
            <div className="h-3 overflow-hidden rounded-full border border-line"><div className="h-full bg-accent transition-all" style={{ width: `${((d?.value ?? 0) / max) * 100}%` }} /></div>
            <span className="font-mono">{d?.value}{unit ?? ""}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TimelineView({ title, events }: TimelineData) {
  return (
    <div>
      <Title>{title}</Title>
      <ol className="ml-1 border-l border-line">
        {events?.map((e, n) => (
          <li key={n} className="relative pb-4 pl-5 last:pb-0">
            <span className="absolute -left-[5px] top-1.5 h-2.5 w-2.5 rounded-full bg-accent" />
            <div className="font-mono text-xs text-mute">{e?.when}</div>
            <div className="text-sm font-medium">{e?.title}</div>
            {e?.detail && <div className="text-sm text-mute">{e.detail}</div>}
          </li>
        ))}
      </ol>
    </div>
  );
}

/** An answer's supporting data: collapsed behind a chip, so the answer reads first. */
function Evidence({ e }: { e?: EvidenceData }) {
  if (!e?.kind) return null;
  const size = e.kind === "table" ? e.rows?.length : e.kind === "chart" ? e.data?.length : e.kind === "timeline" ? e.events?.length : e.kind === "map" ? e.places?.length : 0;
  const noun = { table: "row", chart: "value", timeline: "event", map: "place" }[e.kind];
  return (
    <details className="peek">
      <summary>{e.title || "Details"}{size ? ` · ${size} ${noun}${size === 1 ? "" : "s"}` : ""}</summary>
      <div className="card mt-2 text-sm">
        {e.kind === "table" && <TableView {...e} title={undefined} />}
        {e.kind === "chart" && <ChartView {...e} title={undefined} />}
        {e.kind === "timeline" && <TimelineView {...e} title={undefined} />}
        {e.kind === "map" && <MapView title="" places={validPlaces(e.places)} />}
      </div>
    </details>
  );
}

/** Next-step buttons: a click sends the action's prompt as the user's message. Only the newest reply's buttons work. */
function Actions({ actions, ctx }: { actions?: ({ label?: string; prompt?: string } | undefined)[]; ctx: UiCtx }) {
  const ok = actions?.filter((a): a is { label: string; prompt?: string } => !!a?.label);
  if (!ok?.length) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {ok.map((a, n) => (
        <button key={n} className="btn !py-1.5 text-xs" disabled={!ctx.live} onClick={() => ctx.send(a.prompt || a.label)}>{a.label}</button>
      ))}
    </div>
  );
}

const Skeleton = ({ label }: { label: string }) => <div className="animate-pulse card text-xs text-mute">{label}</div>;
const Answered = ({ label, text }: { label: string; text: string }) => (
  <div className="chip !px-4 !py-2"><span className="text-mute">{label} → </span>{text}</div>
);

type FormInput = Extract<Part, { type: "tool-askUser"; state: "input-available" }>["input"];

function Form({ input, onSubmit }: { input: FormInput; onSubmit: (v: Record<string, string | number | boolean>) => void }) {
  const [v, setV] = useState<Record<string, string | number | boolean>>(() =>
    Object.fromEntries(input.fields.map((f) => [f.name, f.type === "toggle" ? false : f.type === "select" ? (f.options?.[0] ?? "") : f.type === "slider" ? (f.min ?? 0) : f.type === "color" ? "#000000" : ""])),
  );
  const set = (k: string, x: string | number | boolean) => setV((o) => ({ ...o, [k]: x }));
  return (
    <form className="card space-y-3" onSubmit={(e) => { e.preventDefault(); onSubmit(v); }}>
      <Title>{input.title}</Title>
      {input.fields.map((f) => (
        <label key={f.name} className="block space-y-1 text-sm">
          {f.type === "toggle" ? (
            <span className="flex items-center gap-2">
              <input type="checkbox" checked={!!v[f.name]} onChange={(e) => set(f.name, e.target.checked)} className="accent-accent" /> {f.label}
            </span>
          ) : (
            <>
              <span>{f.label}</span>
              {f.type === "select" ? (
                <select className="field" value={String(v[f.name])} onChange={(e) => set(f.name, e.target.value)}>
                  {f.options?.map((o) => <option key={o}>{o}</option>)}
                </select>
              ) : f.type === "slider" ? (
                <div className="flex items-center gap-3">
                  <input type="range" className="w-full accent-current" min={f.min ?? 0} max={f.max ?? 100} step={f.step ?? 1} value={Number(v[f.name])} onChange={(e) => set(f.name, Number(e.target.value))} />
                  <span className="w-12 text-right font-mono text-xs">{String(v[f.name])}</span>
                </div>
              ) : f.type === "color" ? (
                <input type="color" className="h-9 w-16 cursor-pointer rounded-ctl border border-line bg-bg" value={String(v[f.name])} onChange={(e) => set(f.name, e.target.value)} />
              ) : (
                <input className="field" required type={f.type} placeholder={f.placeholder} value={String(v[f.name])}
                  onChange={(e) => set(f.name, f.type === "number" ? Number(e.target.value) : e.target.value)} />
              )}
            </>
          )}
        </label>
      ))}
      <button className="btn-solid">Submit</button>
    </form>
  );
}

type Place = { name: string; lat: number; lng: number; note?: string };

// ponytail: OSM embed shows one marker; list buttons re-center it. Swap for MapLibre if multi-marker maps matter.
function MapView({ title, places }: { title: string; places: Place[] }) {
  const [sel, setSel] = useState(0);
  const pl = places[Math.min(sel, places.length - 1)];
  if (!pl) return <Skeleton label="Loading map…" />;
  const d = 0.03;
  const src = `https://www.openstreetmap.org/export/embed.html?bbox=${pl.lng - d},${pl.lat - d},${pl.lng + d},${pl.lat + d}&layer=mapnik&marker=${pl.lat},${pl.lng}`;
  return (
    <div>
      <Title>{title}</Title>
      <iframe title={pl.name} src={src} className="h-64 w-full rounded-lg border border-line grayscale dark:invert" loading="lazy" />
      <div className="mt-3 flex flex-wrap gap-2">
        {places.map((x, n) => (
          <button key={n} className={n === sel ? "btn-solid" : "btn"} onClick={() => setSel(n)}>{x.name}</button>
        ))}
      </div>
      {pl.note && <p className="mt-2 text-sm text-mute">{pl.note}</p>}
    </div>
  );
}
