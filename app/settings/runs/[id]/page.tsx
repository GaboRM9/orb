import Link from "next/link";
import { notFound } from "next/navigation";
import { db, type Run, type ToolCall } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function RunDetail({ params }: PageProps<"/settings/runs/[id]">) {
  const { id } = await params;
  const run = db.prepare("select r.*, a.name agent from runs r left join agents a on a.id=r.agent_id where r.id=?").get(id) as Run | undefined;
  if (!run) notFound();
  const calls = db.prepare("select * from tool_calls where run_id=? order by id").all(id) as ToolCall[];
  const facts = [
    ["Agent", run.agent ?? "—"], ["Model", run.model], ["Started", new Date(run.started).toLocaleString()],
    ["Duration", `${run.ms}ms`], ["Tokens in", String(run.input_tokens ?? "—")], ["Tokens out", String(run.output_tokens ?? "—")], ["Status", run.status],
  ];
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <Link href="/settings?tab=runs" className="text-xs text-mute hover:text-fg">← Settings · Runs</Link>
      <h1 className="text-lg font-semibold">Run {run.id}</h1>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-1 rounded-lg border border-line p-4 text-sm sm:grid-cols-4">
        {facts.map(([k, v]) => <div key={k}><dt className="text-xs text-mute">{k}</dt><dd className="font-mono text-xs">{v}</dd></div>)}
      </dl>
      {run.error && <pre className="whitespace-pre-wrap rounded-lg border border-fg p-3 font-mono text-xs">{run.error}</pre>}
      <Link href={`/chat/${run.thread_id}`} className="btn inline-block text-xs">Open conversation</Link>
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
