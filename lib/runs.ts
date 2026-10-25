import { db } from "./db";

const clip = (v: unknown, n = 4000) => {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s && s.length > n ? s.slice(0, n) + "…" : (s ?? null);
};

export type LoggedCall = { name: string; input: unknown; output?: unknown; ms?: number; error?: string };

export function logRun(r: {
  id: string; threadId: string; agentId?: string | null; model: string; started: number;
  inputTokens?: number; outputTokens?: number; status: "ok" | "error" | "aborted"; error?: string; calls: LoggedCall[];
}) {
  db.transaction(() => {
    db.prepare("insert into runs (id,thread_id,agent_id,model,started,ms,input_tokens,output_tokens,status,error) values (?,?,?,?,?,?,?,?,?,?)").run(
      r.id, r.threadId, r.agentId ?? null, r.model, r.started, Date.now() - r.started,
      r.inputTokens ?? null, r.outputTokens ?? null, r.status, r.error ?? null,
    );
    const ins = db.prepare("insert into tool_calls (run_id,name,input,output,ms,error) values (?,?,?,?,?,?)");
    for (const c of r.calls) ins.run(r.id, c.name, clip(c.input), clip(c.output), c.ms ?? null, c.error ?? null);
  })();
}

export const listRuns = (agent?: string, status?: string) =>
  db.prepare(
    `select r.*, a.name agent, (select count(*) from tool_calls c where c.run_id=r.id) calls
     from runs r left join agents a on a.id=r.agent_id
     where (? is null or r.agent_id=?) and (? is null or r.status=?)
     order by r.started desc limit 100`,
  ).all(agent ?? null, agent ?? null, status ?? null, status ?? null);
