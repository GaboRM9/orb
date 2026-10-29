import { createAnthropic } from "@ai-sdk/anthropic";
import { after } from "next/server";
import { consumeStream, convertToModelMessages, createIdGenerator, createUIMessageStreamResponse, generateId, isStepCount, streamText, toUIMessageStream, type SystemModelMessage, type UIMessage } from "ai";
import { asUser, envKey, getAgent, getSetting, inWorkspace, requestSession, threadAgentId } from "@/lib/db";
import { fitContext, loadChat, mergeMessage, saveChat } from "@/lib/chat-store";
import { fileError } from "@/lib/files";
import { addUsage, DEFAULT_MODEL, type Usage } from "@/lib/models";
import { allowedMcp, MCP_PREFIX, mcpApproval } from "@/lib/mcp";
import { open } from "@/lib/secret";
import { budgetError, logRun, requestStop, stopRequested, syncApprovals, type LoggedCall } from "@/lib/runs";
import { legacySurfaceTools } from "@/lib/surfaces";
import { agentSetup, APPROVAL_TOOLS, genUiTools } from "@/lib/tools";
import { clipOverlong, surfaceContext } from "@/lib/ui-tools";

export const maxDuration = 300; // agent runs with several tool calls outlast the old 60s
const CACHE = { anthropic: { cacheControl: { type: "ephemeral" } } } as const;
const MAX_STEPS = 25;
// ponytail: polls the database for the Stop flag; a pub/sub channel if runs ever need instant stops
const STOP_POLL_MS = 500;

export async function POST(req: Request) {
  const started = Date.now();
  const session = await requestSession(req);
  if (!session) return new Response("Unauthorized", { status: 401 });
  const { id, message, agentId, context }: { id: string; message: UIMessage; agentId?: string; context?: unknown } = await req.json();
  // callbacks below can run after the response ends, outside the request: they get the workspace and user explicitly
  const { workspace: w, uid } = session;
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

/** Stop button: flags the thread; its running turn sees the flag within STOP_POLL_MS and aborts, keeping what it has so far. */
export async function DELETE(req: Request) {
  const session = await requestSession(req);
  if (!session) return new Response("Unauthorized", { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return new Response("Missing id", { status: 400 });
  await inWorkspace(session.workspace, () => asUser(session.uid, () => requestStop(id)));
  return new Response(null, { status: 204 });
}
