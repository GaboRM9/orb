import type { UIMessage } from "ai";
import { db, type Approval, type Run } from "./db";

const clip = (v: unknown, n = 4000) => {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s && s.length > n ? s.slice(0, n) + "…" : (s ?? null);
};

export type LoggedCall = { name: string; input: unknown; output?: unknown; ms?: number; error?: string };

export async function logRun(r: {
  id: string; threadId: string; agentId?: string | null; model: string; started: number;
  inputTokens?: number; outputTokens?: number; status: "ok" | "error" | "aborted"; error?: string; calls: LoggedCall[];
}) {
  await db.batch([
    ["insert into runs (id,thread_id,agent_id,model,started,ms,input_tokens,output_tokens,status,error) values (?,?,?,?,?,?,?,?,?,?)",
      r.id, r.threadId, r.agentId ?? null, r.model, r.started, Date.now() - r.started, r.inputTokens ?? null, r.outputTokens ?? null, r.status, r.error ?? null],
    ...r.calls.map((c): [string, ...unknown[]] => ["insert into tool_calls (run_id,name,input,output,ms,error) values (?,?,?,?,?,?)", r.id, c.name, clip(c.input), clip(c.output), c.ms ?? null, c.error ?? null]),
  ]);
}

/** Headline numbers for the Runs tab: runs today, errors today, approvals waiting on a decision. */
export const runSummary = async () => {
  const today = new Date().setHours(0, 0, 0, 0);
  return (await db.prepare(
    `select (select count(*) from runs where started >= ?) runs,
            (select count(*) from runs where started >= ? and status = 'error') errors,
            (select count(*) from approvals where decision = 'pending') pending`,
  ).get(today, today)) as { runs: number; errors: number; pending: number };
};

export const listRuns = async (agent?: string, status?: string) =>
  (await db.prepare(
    `select r.*, a.name agent, (select count(*) from tool_calls c where c.run_id=r.id) calls
     from runs r left join agents a on a.id=r.agent_id
     where (? is null or r.agent_id=?) and (? is null or r.status=?)
     order by r.started desc limit 100`,
  ).all(agent ?? null, agent ?? null, status ?? null, status ?? null)) as Run[];

type ApprovalPart = { type: string; toolName?: string; input?: unknown; approval?: { id: string; approved?: boolean; reason?: string; isAutomatic?: boolean } };
const toolOf = (p: ApprovalPart) => (p.type === "dynamic-tool" ? (p.toolName ?? "tool") : p.type.replace(/^tool-/, ""));

/**
 * Records approval requests and decisions found in a message's tool parts. Safe to call repeatedly:
 * a request is stored once (pending) and a decision is applied once, so the same message can be synced on every turn.
 */
export async function syncApprovals(runId: string, threadId: string, agentId: string | null | undefined, message: UIMessage | undefined) {
  if (!message || message.role !== "assistant") return;
  const stmts: [string, ...unknown[]][] = [];
  for (const p of message.parts as ApprovalPart[]) {
    const a = p.approval;
    if (!a?.id) continue;
    stmts.push(["insert into approvals (approval_id,run_id,thread_id,agent_id,tool,input,requested) values (?,?,?,?,?,?,?) on conflict(approval_id) do nothing",
      a.id, runId, threadId, agentId ?? null, toolOf(p), clip(p.input), Date.now()]);
    if (typeof a.approved === "boolean")
      stmts.push(["update approvals set decision=?, reason=?, automatic=?, decided=?, decided_run=? where approval_id=? and decision='pending'",
        a.approved ? "approved" : "denied", a.reason ?? null, a.isAutomatic ? 1 : 0, Date.now(), runId, a.id]);
  }
  if (stmts.length) await db.batch(stmts);
}

export const listApprovals = async (agent?: string, decision?: string) =>
  (await db.prepare(
    `select p.*, a.name agent from approvals p left join agents a on a.id=p.agent_id
     where (? is null or p.agent_id=?) and (? is null or p.decision=?)
     order by p.requested desc limit 100`,
  ).all(agent ?? null, agent ?? null, decision ?? null, decision ?? null)) as Approval[];

export const approvalsForRun = async (runId: string) =>
  (await db.prepare("select * from approvals where run_id=? or decided_run=? order by requested").all(runId, runId)) as Approval[];
