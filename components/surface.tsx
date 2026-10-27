"use client";
import { useState } from "react";
import { views } from "./surfaces";

export type SurfaceResult = { params: unknown; data: unknown; summary: string };
export type SurfaceViewProps<P = never, D = never> = {
  params: P;
  data: D;
  refetch: (params: P) => void; // new params → new data, no model call
  busy: boolean;
  live: boolean; // only the newest reply's surface sends messages
  send: (text: string) => void;
};

/**
 * The frame every surface sits in: a header with its live summary, the view, and in-place refreshes.
 * A refresh tells the chat what the surface now shows, so the agent's next turn knows.
 */
// ponytail: refreshes live in component state; a reload shows what the agent first opened. Persist into the message if that matters.
export function SurfaceFrame({ name, result, live, send, setContext }: { name: string; result: SurfaceResult; live: boolean; send: (text: string) => void; setContext: (text: string) => void }) {
  const [state, setState] = useState(result);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const v = views[name];

  const refetch = async (params: unknown) => {
    setBusy(true);
    setError("");
    try {
      const r = await fetch(`/api/surfaces/${encodeURIComponent(name)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ params }) });
      const j = (await r.json().catch(() => ({}))) as SurfaceResult & { error?: string };
      if (!r.ok) throw new Error(j.error || `Couldn't refresh (${r.status})`);
      setState(j);
      setContext(j.summary);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card overflow-hidden !p-0">
      <div className="flex items-baseline justify-between gap-3 border-b border-line px-4 py-2.5 text-xs">
        <span className="font-medium">{v?.title ?? name}</span>
        <span className="truncate text-mute" aria-live="polite">{busy ? "Updating…" : state.summary}</span>
      </div>
      <div className={`transition-opacity ${busy ? "opacity-60" : ""}`}>
        {v ? (
          <v.View params={state.params as never} data={state.data as never} refetch={refetch} busy={busy} live={live} send={send} />
        ) : (
          <p className="p-4 text-sm text-mute">{state.summary}</p>
        )}
      </div>
      {error && <p className="border-t border-line px-4 py-2 text-xs">{error}</p>}
    </div>
  );
}
