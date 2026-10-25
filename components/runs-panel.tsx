import Link from "next/link";
import { listAgents, type Run } from "@/lib/db";
import { listRuns } from "@/lib/runs";

const fmt = (ms: number) => (ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`);

export function RunsPanel({ agent, status }: { agent?: string; status?: string }) {
  const runs = listRuns(agent, status) as Run[];
  const pill = (on: boolean) => `rounded-full border px-2.5 py-0.5 text-xs ${on ? "border-fg bg-fg text-bg" : "border-line text-mute hover:text-fg"}`;
  const href = (a?: string, s?: string) => `/settings?${new URLSearchParams({ tab: "runs", ...(a && { agent: a }), ...(s && { status: s }) })}`;
  return (
    <div className="space-y-4">
      <p className="text-sm text-mute">Every agent response: model, tokens, tool calls and errors.</p>
      <div className="flex flex-wrap gap-2">
        <Link href={href(undefined, status)} className={pill(!agent)}>All agents</Link>
        {listAgents().map((a) => <Link key={a.id} href={href(a.id, status)} className={pill(agent === a.id)}>{a.name}</Link>)}
        <span className="mx-1 border-l border-line" />
        {[undefined, "ok", "error", "aborted"].map((s) => <Link key={s ?? "any"} href={href(agent, s)} className={pill(status === s)}>{s ?? "any status"}</Link>)}
      </div>
      {!runs.length ? (
        <p className="text-sm text-mute">No runs yet. Chat with an agent and they will appear here.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-fg text-xs">
                {["When", "Agent", "Model", "Time", "Tokens in/out", "Tools", "Status"].map((h) => <th key={h} className="py-1.5 pr-4 font-medium">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className="border-b border-line hover:bg-line/40">
                  <td className="py-1.5 pr-4"><Link href={`/settings/runs/${r.id}`} className="underline underline-offset-2">{new Date(r.started).toLocaleString()}</Link></td>
                  <td className="pr-4">{r.agent ?? <span className="text-mute">—</span>}</td>
                  <td className="pr-4 font-mono text-xs">{r.model}</td>
                  <td className="pr-4 font-mono text-xs">{fmt(r.ms)}</td>
                  <td className="pr-4 font-mono text-xs">{r.input_tokens ?? "—"} / {r.output_tokens ?? "—"}</td>
                  <td className="pr-4 font-mono text-xs">{r.calls}</td>
                  <td><span className={`rounded-full border px-2 py-0.5 text-xs ${r.status === "ok" ? "border-line text-mute" : "border-fg"}`}>{r.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
