import { createAnthropic } from "@ai-sdk/anthropic";
import { after } from "next/server";
import { consumeStream, convertToModelMessages, createIdGenerator, createUIMessageStreamResponse, generateId, isStepCount, isToolUIPart, lastAssistantMessageIsCompleteWithApprovalResponses, streamText, toUIMessageStream, type SystemModelMessage, type UIMessage } from "ai";
import { asUser, db, envKey, getAgent, getSetting, inWorkspace, threadAgentId } from "@/lib/db";
import { fitContext, loadChat, mergeMessage, saveChat } from "@/lib/chat-store";
import { fileError } from "@/lib/files";
import { addUsage, DEFAULT_MODEL, type Usage } from "@/lib/models";
import { allowedMcp, MCP_PREFIX, mcpApproval } from "@/lib/mcp";
import { open } from "@/lib/secret";
import { budgetError, logRun, stopRequested, syncApprovals, type LoggedCall } from "@/lib/runs";
import { legacySurfaceTools } from "@/lib/surfaces";
import { agentSetup, APPROVAL_TOOLS, genUiTools } from "@/lib/tools";
import { clipOverlong, surfaceContext } from "@/lib/ui-tools";

const CACHE = { anthropic: { cacheControl: { type: "ephemeral" } } } as const;
const MAX_STEPS = 25;
// ponytail: polls the database for the Stop flag; a pub/sub channel if runs ever need instant stops
const STOP_POLL_MS = 500;

export type Turn = { id: string; message: UIMessage; agentId?: string; context?: unknown };

/**
 * One chat turn as workspace `w` and user `uid`: the chat route streams it to the browser, the scheduler reads it to the end
 * with nobody watching. Either way the chat is saved and the run logged; a tool needing approval ends the turn on its card.
 */
export async function runTurn(w: string, uid: string, { id, message, agentId, context }: Turn) {
  const started = Date.now();
  // callbacks below can run after the response ends, outside the request: they get the workspace and user explicitly
  const scoped = <T,>(fn: () => T) => inWorkspace(w, () => asUser(uid, fn));
  // independent reads side by side: on Turso each await is a network round trip before the first token
  const [savedKey, overBudget, saved, agent, genUiSetting, allowed, modelSetting] = await Promise.all([
    getSetting("api_key"),
    scoped(() => budgetError(uid)),
    scoped(() => loadChat(id)),
    scoped(() => threadAgentId(id)).then((t) => getAgent(t ?? agentId)), // a thread keeps the agent it started with
    getSetting("gen_ui", "on"),
    allowedMcp(),
    getSetting("model", DEFAULT_MODEL),
  ]);
  const apiKey = open(savedKey) || (await envKey("ANTHROPIC_API_KEY"));
  if (!apiKey) return new Response("Set your Anthropic API key in Library → Connections.", { status: 400 });
  if (overBudget) return new Response(overBudget, { status: 429 });

  const badFile = fileError(message);
  if (badFile) return new Response(badFile, { status: 400 });
  const messages = mergeMessage(saved, message);
  const genUi = genUiSetting !== "off"; // beta switch in Settings: off means plain-text answers
  const runId = generateId();
  const [{ tools, system, mcp }] = await Promise.all([
    agentSetup(agent, genUi),
    syncApprovals(runId, id, agent?.id, message), // the user's approve/deny click arrives with this request
  ]);
  const mcpDown = mcp.warnings.length ? `Some MCP servers were unreachable this turn (tell the user if relevant): ${mcp.warnings.join("; ")}` : "";
  // tools + the stable system prompt are one cached prefix; the per-turn MCP warning sits after the breakpoint so it can't bust it
  const instructions: SystemModelMessage[] = [{ role: "system", content: system, providerOptions: CACHE }];
  if (mcpDown) instructions.push({ role: "system", content: mcpDown });
  const surfaceState = surfaceContext(context);
  if (surfaceState) instructions.push({ role: "system", content: surfaceState });
  // with the UI tools even when they're off, so surfaces from earlier turns still reach the model as their summary, not their data
  const history = fitContext(await convertToModelMessages(messages, { tools: { ...legacySurfaceTools(), ...genUiTools(), ...tools } }));
  const last = history.at(-1);
  if (last) last.providerOptions = { ...last.providerOptions, ...CACHE }; // the conversation so far is read from cache next step and next turn

  const model = agent?.model || modelSetting;
  // writes after the last byte are kept alive: a serverless function may freeze once the response ends
  const pending: Promise<unknown>[] = [];
  const track = <T,>(p: Promise<T>) => (pending.push(p), p);
  try { after(() => Promise.allSettled(pending)); } catch { /* called directly (tests): no request scope, nothing to keep alive */ }
  const calls: LoggedCall[] = [];
  const stopper = new AbortController();
  const poll = setInterval(() => void scoped(() => stopRequested(id, started)).then((s) => s && stopper.abort(), () => {}), STOP_POLL_MS);
  // ponytail: tokens of a step cut off mid-stream are billed but unseen here; only finished steps are counted
  let usage: Usage | undefined;
  const finish = async (status: "ok" | "error" | "aborted", error?: unknown) => {
    clearInterval(poll);
    await mcp.close();
    await scoped(() => logRun({
      id: runId, threadId: id, agentId: agent?.id, model, started, status, calls, usage,
      error: error == null ? undefined : error instanceof Error ? error.message : String(error),
    }));
  };

  const result = scoped(() => streamText({
    model: createAnthropic({ apiKey })(model),
    instructions,
    messages: history,
    tools,
    stopWhen: isStepCount(MAX_STEPS),
    repairToolCall: clipOverlong,
    abortSignal: stopper.signal, // only the Stop button aborts; a closed tab lets the turn finish
    // external and outbound-network tools can have side effects: the user approves each call in the chat
    // an MCP tool the user chose to always allow (Library) is approved automatically, which still logs it as an approval
    toolApproval: ({ toolCall: { toolName: n } }) => (n.startsWith(MCP_PREFIX) ? mcpApproval(n, mcp.owners, allowed) : APPROVAL_TOOLS.has(n) ? "user-approval" : undefined),
    onToolExecutionEnd: ({ toolCall, toolExecutionMs, toolOutput }) => {
      calls.push({
        name: toolCall.toolName,
        input: toolCall.input,
        ms: toolExecutionMs,
        ...(toolOutput.type === "tool-result" ? { output: toolOutput.output } : { error: String(toolOutput.error) }),
      });
    },
    onStepEnd: (step) => void (usage = addUsage(usage ?? {}, step.usage)),
    onEnd: () => track(finish("ok")),
    onError: ({ error }) => void track(finish("error", error)),
    onAbort: () => void track(finish("aborted")),
  })); // tools run as this user too (searchThreads)

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      stream: result.stream,
      originalMessages: messages,
      generateMessageId: createIdGenerator({ prefix: "msg", size: 16 }), // same id on client and in the DB
      onEnd: async ({ messages }) => {
        await track(scoped(() => saveChat(id, messages, agent?.id)));
        await track(scoped(() => syncApprovals(runId, id, agent?.id, messages.at(-1)))); // approval requests this run produced
      },
    }),
    // drain our own copy of the stream so a closed tab still finishes the turn and saves it (kept alive via after())
    consumeSseStream: ({ stream }) => track(consumeStream({ stream })),
  });
}


/**
 * Approve or deny from the Inbox, without the chat open: does what the approval card's click does in the browser. The
 * card's part is answered in the saved chat; once nothing else in that step waits on the user, the turn resumes here as
 * `runTurn` (which records the decision) and is read to the end. Returns why it couldn't, or null.
 */
export async function decide(w: string, uid: string, approvalId: string, approved: boolean) {
  return inWorkspace(w, () => asUser(uid, async () => {
    const row = (await db.prepare("select thread_id, run_id from approvals where approval_id=? and workspace_id=? and user_id=? and decision='pending'")
      .get(approvalId, w, uid)) as { thread_id: string; run_id: string } | undefined;
    if (!row) return "Already decided.";
    const messages = await loadChat(row.thread_id);
    const last = messages.at(-1);
    type Part = UIMessage["parts"][number];
    const asks = (p: Part): p is Extract<Part, { state: "approval-requested" }> => isToolUIPart(p) && p.state === "approval-requested" && p.approval.id === approvalId;
    if (!last?.parts.some(asks)) return "The chat has moved on; open it to see.";
    const message = { ...last, parts: last.parts.map((p) => (asks(p) ? { ...p, state: "approval-responded", approval: { ...p.approval, approved } } : p)) } as UIMessage;
    if (!lastAssistantMessageIsCompleteWithApprovalResponses({ messages: [message] })) {
      // another card (or a form) in the same step still waits: keep this answer, resume when the last one is in
      await saveChat(row.thread_id, mergeMessage(messages, message));
      await syncApprovals(row.run_id, row.thread_id, await threadAgentId(row.thread_id), message);
      return null;
    }
    const res = await runTurn(w, uid, { id: row.thread_id, message });
    const body = await res.text();
    return res.ok ? null : body.slice(0, 300);
  }));
}
