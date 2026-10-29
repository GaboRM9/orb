import { createAnthropic } from "@ai-sdk/anthropic";
import { generateId, generateText, isStepCount, Output, type LanguageModel } from "ai";
import { z } from "zod";
import { db, envKey, getAgent, getSetting, me, ws } from "./db";
import { addUsage, DEFAULT_MODEL, MODELS, runCost, type Usage } from "./models";
import { MCP_PREFIX } from "./mcp";
import { budgetError } from "./runs";
import { open } from "./secret";
import { agentSetup, APPROVAL_TOOLS } from "./tools";
import { clipOverlong } from "./ui-tools";

// Evals: test prompts per agent, each with a plain-English "a good answer…". A run asks the agent every prompt the way
// chat would, then a grader model passes or fails each answer with a one-line reason.

export const MAX_CASES = 25;
// ponytail: 5 at a time, 45s per case, so a full run fits the 300s function limit; a queue if runs ever outgrow it
const PARALLEL = 5;
const CASE_MS = 45_000;
// one fixed grader, so a pass means the same thing whichever model answered (a small model grading itself passes too much)
export const GRADER_MODEL = "claude-sonnet-5-5";

export type EvalCase = { id: number; agent_id: string; prompt: string; expect: string; tool: string | null };
export type EvalResult = {
  id: number; run_id: string; agent_id: string; case_id: number; prompt: string; model: string; started: number;
  pass: number; reason: string; answer: string; ms: number; cost: number | null;
};
export type EvalRun = { run_id: string; agent_id: string; model: string; started: number; passed: number; total: number; cost: number | null; ms: number };

export const listCases = async (agentId: string) =>
  (await db.prepare("select * from eval_cases where workspace_id=? and agent_id=? order by id").all(await ws(), agentId)) as EvalCase[];

/** Every run, newest first: pass counts, total cost and average answer time. */
export const listEvalRuns = async () =>
  (await db.prepare(
    `select run_id, agent_id, model, min(started) started, sum(pass) passed, count(*) total, sum(cost) cost, cast(avg(ms) as integer) ms
     from eval_results where workspace_id=? group by run_id order by started desc limit 500`,
  ).all(await ws())) as EvalRun[];

export const runResults = async (runId: string) =>
  (await db.prepare("select * from eval_results where workspace_id=? and run_id=? order by case_id").all(await ws(), runId)) as EvalResult[];

/** Cases that passed in the previous run and fail now: the regressions worth looking at first. */
export const newlyFailing = (cur: Pick<EvalResult, "case_id" | "pass">[], prev: Pick<EvalResult, "case_id" | "pass">[]) => {
  const passedBefore = new Set(prev.filter((r) => r.pass).map((r) => r.case_id));
  return new Set(cur.filter((r) => !r.pass && passedBefore.has(r.case_id)).map((r) => r.case_id));
};

/** The deterministic half of grading: a case that names a tool fails without asking the grader if the agent never called it. */
export const missedTool = (tool: string | null, called: string[]) => (tool && !called.includes(tool) ? `Didn't use ${tool}.` : null);

const verdict = z.object({ pass: z.boolean(), reason: z.string().describe("One short sentence on why") });

async function grade(model: LanguageModel, c: EvalCase, answer: string) {
  const { output, usage } = await generateText({
    model,
    output: Output.object({ schema: verdict }),
    instructions: [{ role: "system", content: "You grade an AI assistant's answer against what the user said a good answer looks like. Pass only if it meets every point. Tool calls are part of the answer: the user sees what they show." }],
    prompt: `Question:\n${c.prompt}\n\nA good answer:\n${c.expect}\n\nThe assistant's answer:\n${answer}`,
    abortSignal: AbortSignal.timeout(CASE_MS),
  });
  return { ...output, usage };
}

/**
 * Runs every case of an agent, on `model` if given (to compare models) or else the one it chats with, and stores the
 * results under one run id. Returns the run id, or why it didn't run.
 */
export async function runEval(agentId: string, model?: string): Promise<string | { error: string }> {
  const agent = await getAgent(agentId);
  const cases = await listCases(agentId);
  if (!agent || !cases.length) return { error: "Add a test question first." };
  const apiKey = open(await getSetting("api_key")) || (await envKey("ANTHROPIC_API_KEY"));
  if (!apiKey) return { error: "Set your Anthropic API key in Library → Connections." };
  const overBudget = await budgetError(await me());
  if (overBudget) return { error: overBudget };
  const modelId = (model && MODELS.includes(model) && model) || agent.model || (await getSetting("model", DEFAULT_MODEL));
  const anthropic = createAnthropic({ apiKey });
  const { tools, system, mcp } = await agentSetup(agent, (await getSetting("gen_ui", "on")) !== "off");
  const [runId, started] = [generateId(), Date.now()];

  const one = async (c: EvalCase) => {
    const t0 = Date.now();
    let usage: Usage = {};
    try {
      const r = await generateText({
        model: anthropic(modelId),
        instructions: [{ role: "system", content: system }],
        prompt: c.prompt,
        tools,
        stopWhen: isStepCount(10),
        repairToolCall: clipOverlong,
        abortSignal: AbortSignal.timeout(CASE_MS),
        // nobody is there to approve, and an eval must not have side effects: those calls are refused, the agent carries on
        toolApproval: ({ toolCall: { toolName: n } }) =>
          n.startsWith(MCP_PREFIX) || APPROVAL_TOOLS.has(n) ? { type: "denied", reason: "Not run during evals." } : undefined,
        onStepEnd: (step) => void (usage = addUsage(usage, step.usage)),
      });
      const calls = r.steps.flatMap((s) => s.toolCalls);
      // what the user would see: the prose plus what each tool call showed
      const answer = [r.steps.map((s) => s.text).join("\n").trim(), ...calls.map((t) => `[${t.toolName}] ${JSON.stringify(t.input).slice(0, 1500)}`)]
        .filter(Boolean).join("\n").slice(0, 6000);
      const ms = Date.now() - t0;
      const missed = missedTool(c.tool, calls.map((t) => t.toolName));
      if (missed) return { c, pass: false, reason: missed, answer, ms, cost: runCost(modelId, usage) };
      const g = await grade(anthropic(GRADER_MODEL), c, answer || "(no answer)");
      return { c, pass: g.pass, reason: g.reason, answer, ms, cost: (runCost(modelId, usage) ?? 0) + (runCost(GRADER_MODEL, g.usage) ?? 0) };
    } catch (e) {
      return { c, pass: false, reason: `Error: ${e instanceof Error ? e.message : String(e)}`, answer: "", ms: Date.now() - t0, cost: runCost(modelId, usage) };
    }
  };

  const results: Awaited<ReturnType<typeof one>>[] = [];
  const queue = [...cases];
  try {
    await Promise.all(Array.from({ length: PARALLEL }, async () => {
      for (let c; (c = queue.shift()); ) results.push(await one(c));
    }));
  } finally {
    await mcp.close();
  }
  const [w, u] = [await ws(), await me()];
  await db.batch(results.map((r): [string, ...unknown[]] => [
    "insert into eval_results (workspace_id,user_id,run_id,agent_id,case_id,prompt,model,started,pass,reason,answer,ms,cost) values (?,?,?,?,?,?,?,?,?,?,?,?,?)",
    w, u, runId, agentId, r.c.id, r.c.prompt, modelId, started, r.pass ? 1 : 0, r.reason, r.answer, r.ms, r.cost,
  ]));
  return runId;
}
