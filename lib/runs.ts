import type { UIMessage } from "ai";
import { db, ws, type Approval, type Run } from "./db";
import { runCost, type Usage } from "./models";

const clip = (v: unknown, n = 4000) => {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s && s.length > n ? s.slice(0, n) + "…" : (s ?? null);
};

export type LoggedCall = { name: string; input: unknown; output?: unknown; ms?: number; error?: string };

export async function logRun(r: {
  id: string; threadId: string; agentId?: string | null; model: string; started: number;
  usage?: Usage; status: "ok" | "error" | "aborted"; error?: string; calls: LoggedCall[];
}) {
  const u = r.usage ?? {};
  await db.batch([
    ["insert into runs (workspace_id,id,thread_id,agent_id,model,started,ms,input_tokens,output_tokens,cache_read_tokens,cache_write_tokens,cost,status,error) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      await ws(), r.id, r.threadId, r.agentId ?? null, r.model, r.started, Date.now() - r.started, u.inputTokens ?? null, u.outputTokens ?? null,
      u.inputTokenDetails?.cacheReadTokens ?? null, u.inputTokenDetails?.cacheWriteTokens ?? null, r.usage ? runCost(r.model, u) : null, r.status, r.error ?? null],
    ...r.calls.map((c): [string, ...unknown[]] => ["insert into tool_calls (run_id,name,input,output,ms,error) values (?,?,?,?,?,?)", r.id, c.name, clip(c.input), clip(c.output), c.ms ?? null, c.error ?? null]),
  ]);
}

/** Headline numbers for the Runs tab, for this workspace: runs today, errors today, approvals waiting on a decision, dollars spent today. */
export const runSummary = async () => {
  const today = new Date().setHours(0, 0, 0, 0);
  return (await db.prepare(
    `select (select count(*) from runs where workspace_id = @w and started >= @t) runs,
            (select count(*) from runs where workspace_id = @w and started >= @t and status = 'error') errors,
            (select count(*) from approvals where workspace_id = @w and decision = 'pending') pending,
            (select coalesce(sum(cost), 0) from runs where workspace_id = @w and started >= @t) spent`,
  ).get({ w: await ws(), t: today })) as { runs: number; errors: number; pending: number; spent: number };
};

/** Dollars this workspace spent since local midnight (DAILY_BUDGET_USD caps each workspace). */
export const spentToday = async () => (await runSummary()).spent;

// Stop button: the click may land on a different serverless instance than the run, so it goes through the database.
// The thread row may not exist yet (it's saved when the first turn ends), so the stop carries the workspace instead.
export const requestStop = async (threadId: string) =>
  db.prepare("insert into stops (thread_id, at, workspace_id) values (?,?,?) on conflict(thread_id) do update set at=excluded.at, workspace_id=excluded.workspace_id").run(threadId, Date.now(), await ws());
/** True if Stop was pressed for this thread after the run began (older clicks belong to earlier runs). */
export const stopRequested = async (threadId: string, since: number) =>
  !!(await db.prepare("select 1 from stops where thread_id=? and at >= ? and workspace_id=?").get(threadId, since, await ws()));

export const listRuns = async (agent?: string, status?: string) =>
  (await db.prepare(
    `select r.*, a.name agent, (select count(*) from tool_calls c where c.run_id=r.id) calls
     from runs r left join agents a on a.id=r.agent_id
     where r.workspace_id=? and (? is null or r.agent_id=?) and (? is null or r.status=?)
     order by r.started desc limit 100`,
  ).all(await ws(), agent ?? null, agent ?? null, status ?? null, status ?? null)) as Run[];

type ApprovalPart = { type: string; toolName?: string; input?: unknown; approval?: { id: string; approved?: boolean; reason?: string; isAutomatic?: boolean } };
const toolOf = (p: ApprovalPart) => (p.type === "dynamic-tool" ? (p.toolName ?? "tool") : p.type.replace(/^tool-/, ""));

/**
 * Records approval requests and decisions found in a message's tool parts. Safe to call repeatedly:
 * a request is stored once (pending) and a decision is applied once, so the same message can be synced on every turn.
 */
export async function syncApprovals(runId: string, threadId: string, agentId: string | null | undefined, message: UIMessage | undefined) {
  if (!message || message.role !== "assistant") return;
  const stmts: [string, ...unknown[]][] = [];
  const w = await ws();
  for (const p of message.parts as ApprovalPart[]) {
    const a = p.approval;
    if (!a?.id) continue;
    stmts.push(["insert into approvals (workspace_id,approval_id,run_id,thread_id,agent_id,tool,input,requested) values (?,?,?,?,?,?,?,?) on conflict(approval_id) do nothing",
      w, a.id, runId, threadId, agentId ?? null, toolOf(p), clip(p.input), Date.now()]);
    if (typeof a.approved === "boolean")
      stmts.push(["update approvals set decision=?, reason=?, automatic=?, decided=?, decided_run=? where approval_id=? and workspace_id=? and decision='pending'",
        a.approved ? "approved" : "denied", a.reason ?? null, a.isAutomatic ? 1 : 0, Date.now(), runId, a.id, w]);
  }
  if (stmts.length) await db.batch(stmts);
}

export const listApprovals = async (agent?: string, decision?: string) =>
  (await db.prepare(
    `select p.*, a.name agent from approvals p left join agents a on a.id=p.agent_id
     where p.workspace_id=? and (? is null or p.agent_id=?) and (? is null or p.decision=?)
     order by p.requested desc limit 100`,
  ).all(await ws(), agent ?? null, agent ?? null, decision ?? null, decision ?? null)) as Approval[];

export const approvalsForRun = async (runId: string) =>
  (await db.prepare("select * from approvals where (run_id=? or decided_run=?) and workspace_id=? order by requested").all(runId, runId, await ws())) as Approval[];
