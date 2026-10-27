import Link from "next/link";
import { listAgents } from "@/lib/db";
import { listApprovals, listRuns, runSummary } from "@/lib/runs";

const fmt = (ms: number) => (ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`);
const pill = (on: boolean) => `rounded-full border px-3 py-0.5 text-xs ${on ? "border-fg bg-fg text-bg" : "border-line text-mute hover:text-fg"}`;
const Th = ({ h }: { h: string }) => <th className="py-1.5 pr-4 font-medium">{h}</th>;

export async function RunsPanel({ view, agent, status }: { view?: string; agent?: string; status?: string }) {
  const approvals = view === "approvals";
  const href = (o: { view?: string; agent?: string; status?: string }) =>
    `/settings?${new URLSearchParams({ tab: "runs", ...(o.view && { view: o.view }), ...(o.agent && { agent: o.agent }), ...(o.status && { status: o.status }) })}`;
  const statuses = approvals ? ["pending", "approved", "denied"] : ["ok", "error", "aborted"];
  const s = await runSummary();
  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-3 gap-px border border-line bg-line">
        {([["Runs today", s.runs], ["Errors today", s.errors], ["Waiting for approval", s.pending]] as const).map(([label, n]) => (
          <div key={label} className="bg-bg p-4">
            <dt className="text-xs text-mute">{label}</dt>
            <dd className="mt-1 text-2xl font-light">{n}</dd>
          </div>
        ))}
      </dl>
      <div className="flex gap-1 border-b border-line">
        {[["Runs", undefined], ["Approvals", "approvals"]].map(([label, v]) => (
          <Link key={label} href={href({ view: v })} className={`-mb-px border-b px-3 py-1.5 text-sm ${(v === "approvals") === approvals ? "border-fg" : "border-transparent text-mute hover:text-fg"}`}>{label}</Link>
        ))}
      </div>
      <p className="text-sm text-mute">
        {approvals ? "Every approval requested for a tool call, who decided and how long it took." : "Every agent response: model, tokens, tool calls and errors."}
      </p>
      <div className="flex flex-wrap gap-2">
        <Link href={href({ view, status })} className={pill(!agent)}>All agents</Link>
        {(await listAgents()).map((a) => <Link key={a.id} href={href({ view, agent: a.id, status })} className={pill(agent === a.id)}>{a.name}</Link>)}
        <span className="mx-1 border-l border-line" />
        {[undefined, ...statuses].map((s) => <Link key={s ?? "any"} href={href({ view, agent, status: s })} className={pill(status === s)}>{s ?? "any status"}</Link>)}
      </div>
      {approvals ? <ApprovalsTable agent={agent} status={status} /> : <RunsTable agent={agent} status={status} />}
    </div>
  );
}

async function RunsTable({ agent, status }: { agent?: string; status?: string }) {
  const runs = await listRuns(agent, status);
  if (!runs.length) return <p className="text-sm text-mute">No runs yet. Chat with an agent and they will appear here.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm">
        <thead><tr className="border-b border-fg text-xs">{["When", "Agent", "Model", "Time", "Tokens in/out", "Tools", "Status"].map((h) => <Th key={h} h={h} />)}</tr></thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.id} className="border-b border-line row-hover">
              <td className="py-1.5 pr-4"><Link href={`/settings/runs/${r.id}`} className="underline underline-offset-2">{new Date(r.started).toLocaleString()}</Link></td>
              <td className="pr-4">{r.agent ?? <span className="text-mute">—</span>}</td>
              <td className="pr-4 font-mono text-xs">{r.model}</td>
              <td className="pr-4 font-mono text-xs">{fmt(r.ms)}</td>
              <td className="pr-4 font-mono text-xs">{r.input_tokens ?? "—"} / {r.output_tokens ?? "—"}</td>
              <td className="pr-4 font-mono text-xs">{r.calls}</td>
              <td><span className={`rounded-full border border-current px-2.5 py-0.5 text-xs ${r.status === "ok" ? "text-mute" : ""}`}>{r.status}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

async function ApprovalsTable({ agent, status }: { agent?: string; status?: string }) {
  const rows = await listApprovals(agent, status);
  if (!rows.length) return <p className="text-sm text-mute">No approvals yet. They appear when an agent asks to use an MCP tool or fetchUrl.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm">
        <thead><tr className="border-b border-fg text-xs">{["Requested", "Agent", "Tool", "Input", "Decision", "Took"].map((h) => <Th key={h} h={h} />)}</tr></thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.id} className="border-b border-line row-hover">
              <td className="py-1.5 pr-4">
                {a.run_id ? <Link href={`/settings/runs/${a.run_id}`} className="underline underline-offset-2">{new Date(a.requested).toLocaleString()}</Link> : new Date(a.requested).toLocaleString()}
              </td>
              <td className="pr-4">{a.agent ?? <span className="text-mute">—</span>}</td>
              <td className="pr-4 font-mono text-xs">{a.tool}</td>
              <td className="max-w-48 truncate pr-4 font-mono text-xs text-mute" title={a.input ?? ""}>{a.input}</td>
              <td className="pr-4">
                <span className={`rounded-full border border-current px-2.5 py-0.5 text-xs ${a.decision === "pending" ? "text-mute" : ""}`}>{a.decision}{a.automatic ? " (auto)" : ""}</span>
              </td>
              <td className="font-mono text-xs">{a.decided ? fmt(a.decided - a.requested) : "waiting"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
