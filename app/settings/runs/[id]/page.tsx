import Link from "next/link";
import { notFound } from "next/navigation";
import { db, type Run, type ToolCall } from "@/lib/db";
import { approvalsForRun } from "@/lib/runs";

export const dynamic = "force-dynamic";

export default async function RunDetail({ params }: PageProps<"/settings/runs/[id]">) {
  const { id } = await params;
  const run = db.prepare("select r.*, a.name agent from runs r left join agents a on a.id=r.agent_id where r.id=?").get(id) as Run | undefined;
  if (!run) notFound();
  const calls = db.prepare("select * from tool_calls where run_id=? order by id").all(id) as ToolCall[];
  const approvals = approvalsForRun(id);
  const threadExists = !!db.prepare("select 1 from threads where id=?").get(run.thread_id);
  const facts = [
    ["Agent", run.agent ?? "—"], ["Model", run.model], ["Started", new Date(run.started).toLocaleString()],
    ["Duration", `${run.ms}ms`], ["Tokens in", String(run.input_tokens ?? "—")], ["Tokens out", String(run.output_tokens ?? "—")], ["Status", run.status],
  ];
  return (
    <div className="mx-auto max-w-3xl space-y-6 px-10 py-14">
      <Link href="/settings?tab=runs" className="text-xs text-mute hover:text-fg">← Settings · Runs</Link>
      <h1>Run {run.id}</h1>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-1 rounded-lg border border-line p-4 text-sm sm:grid-cols-4">
        {facts.map(([k, v]) => <div key={k}><dt className="text-xs text-mute">{k}</dt><dd className="font-mono text-xs">{v}</dd></div>)}
      </dl>
      {run.error && <pre className="whitespace-pre-wrap rounded-lg border border-fg p-3 font-mono text-xs">{run.error}</pre>}
      {threadExists ? (
        <Link href={`/chat/${run.thread_id}`} className="btn inline-block text-xs">Open conversation</Link>
      ) : (
        <p className="text-xs text-mute">The conversation was deleted. This record is kept for audit.</p>
      )}
      {approvals.length > 0 && (
        <>
          <h2 className="pt-2 text-sm font-medium">Approvals ({approvals.length})</h2>
          {approvals.map((a) => (
            <div key={a.id} className="rounded-lg border border-line p-3 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm">{a.tool}</span>
                <span className="rounded-sm border border-fg px-2 py-0.5">{a.decision}{a.automatic ? " (auto)" : ""}</span>
                <span className="text-mute">
                  {a.run_id === id ? "requested in this run" : "requested earlier"}
                  {a.decided_run === id && a.run_id !== id ? " · decided in this run" : ""}
                </span>
              </div>
              {a.reason && <div className="mt-1 text-mute">Reason: {a.reason}</div>}
              <pre className="mt-2 whitespace-pre-wrap font-mono">{a.input}</pre>
            </div>
          ))}
        </>
      )}
      <h2 className="pt-2 text-sm font-medium">Tool calls ({calls.length})</h2>
      {!calls.length && <p className="text-sm text-mute">This run used no tools.</p>}
      {calls.map((c, n) => (
        <details key={c.id} className="rounded-lg border border-line p-3" open={!!c.error}>
          <summary className="cursor-pointer text-sm">
            <span className="mr-2 text-mute">{n + 1}.</span><span className="font-mono">{c.name}</span>
            <span className="ml-2 text-xs text-mute">{c.ms != null ? `${c.ms}ms` : ""}{c.error ? " · error" : ""}</span>
          </summary>
          <div className="mt-2 space-y-2 font-mono text-xs">
            <div><div className="text-mute">input</div><pre className="whitespace-pre-wrap">{c.input}</pre></div>
            <div><div className="text-mute">{c.error ? "error" : "output"}</div><pre className="whitespace-pre-wrap">{c.error ?? c.output}</pre></div>
          </div>
        </details>
      ))}
    </div>
  );
}
