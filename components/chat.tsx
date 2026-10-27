"use client";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, getToolName, isToolUIPart, lastAssistantMessageIsCompleteWithApprovalResponses, lastAssistantMessageIsCompleteWithToolCalls } from "ai";
import { renderUiPart, type ChatMessage } from "./gen-ui";

import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowUpIcon, OrbIcon, StopIcon } from "./icons";

type ChatAgent = { id: string; name: string; description: string };

// plain-language labels for built-in tools; anything else (MCP tools) shows its own name
const verbs: Record<string, [running: string, done: string]> = {
  getTime: ["Checking the time", "Checked the time"],
  calculate: ["Calculating", "Calculated"],
  fetchUrl: ["Reading a web page", "Read a web page"],
  searchThreads: ["Searching chats", "Searched chats"],
  searchKnowledge: ["Searching your knowledge", "Searched your knowledge"],
  loadSkill: ["Loading a skill", "Loaded a skill"],
  createSkill: ["Saving a skill", "Saved a skill"],
};

// what the user is approving, in one line
function approvalSummary(name: string, input: unknown) {
  const i = (input ?? {}) as Record<string, unknown>;
  if (name === "fetchUrl") return `Open ${String(i.url ?? "a web page")}`;
  if (name === "createSkill") return `Save the skill “${String(i.name ?? "")}”`;
  return `Use ${name}`;
}

type ToolPart = Parameters<typeof getToolName>[0];
const toolLabel = (p: ToolPart) => {
  const name = getToolName(p);
  const [running, finished] = verbs[name] ?? [`Using ${name}`, `Used ${name}`];
  return p.state === "output-error" ? `${name} failed` : p.state === "output-available" ? finished : `${running}…`;
};
const toolJson = (p: ToolPart) => JSON.stringify({ input: p.input, output: "output" in p ? p.output : undefined }, null, 2);

/** Consecutive tool calls collapse into one quiet line; one call keeps its own label. */
function ToolRun({ parts }: { parts: ToolPart[] }) {
  if (parts.length === 1)
    return (
      <details className="text-xs text-mute">
        <summary className="cursor-pointer">{toolLabel(parts[0])}</summary>
        <pre className="mt-1 overflow-x-auto whitespace-pre-wrap font-mono">{toolJson(parts[0])}</pre>
      </details>
    );
  const working = parts.some((p) => p.state !== "output-available" && p.state !== "output-error");
  return (
    <details className="text-xs text-mute">
      <summary className="cursor-pointer">{working ? `Using ${parts.length} tools…` : `Used ${parts.length} tools`}</summary>
      <div className="mt-1 space-y-2">
        {parts.map((p, i) => (
          <div key={i}>
            <div>{toolLabel(p)}</div>
            <pre className="overflow-x-auto whitespace-pre-wrap font-mono">{toolJson(p)}</pre>
          </div>
        ))}
      </div>
    </details>
  );
}

export function Chat({ id, initialMessages, agent, agents }: { id: string; initialMessages: ChatMessage[]; agent?: ChatAgent; agents: { id: string; name: string }[] }) {
  const router = useRouter();
  const agentId = agent?.id;
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        // server holds history; send only the newest message (+ which agent this thread talks to)
        prepareSendMessagesRequest: ({ id, messages }) => ({ body: { id, agentId, message: messages[messages.length - 1] } }),
      }),
    [agentId],
  );
  const [input, setInput] = useState("");
  const end = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const { messages, sendMessage, addToolOutput, addToolApprovalResponse, status, error, stop } = useChat<ChatMessage>({
    id,
    messages: initialMessages,
    transport,
    // resume after a form/choice answer or an approve/deny click
    sendAutomaticallyWhen: (o) => lastAssistantMessageIsCompleteWithToolCalls(o) || lastAssistantMessageIsCompleteWithApprovalResponses(o),
    onFinish: () => router.refresh(), // refresh thread list
  });
  const busy = status === "submitted" || status === "streaming";
  const last = messages[messages.length - 1];
  // the orb stands in until the agent's first words arrive
  const waiting = busy && !(last?.role === "assistant" && last.parts.some((p) => p.type === "text" && p.text));

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  // grow the composer with its text; max-h on the textarea caps it
  useLayoutEffect(() => {
    const t = box.current;
    if (!t) return;
    t.style.height = "auto";
    t.style.height = `${t.scrollHeight}px`;
  }, [input]);

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col px-6">
      <div className="flex-1 space-y-6 overflow-y-auto py-6">
        {!messages.length && (
          <div className="mt-24 flex flex-col items-center gap-3 text-center">
            <OrbIcon className="h-14 w-14" />
            <p className="text-xl font-light tracking-tight">{agent?.name ?? "Ask anything"}</p>
            {agent?.description && <p className="max-w-sm text-sm text-mute">{agent.description}</p>}
          </div>
        )}
        {messages.map((m) => {
          const text = m.parts.flatMap((p) => (p.type === "text" ? [p.text] : [])).join("\n\n");
          return (
            <div key={m.id} className={`${m.role === "user" ? "flex justify-end" : "space-y-1"} ${m.id === last?.id ? "rise" : ""}`}>
              {/* the agent's name marks each reply once, not on every block */}
              {m.role === "assistant" && agent && <div className="text-xs text-mute">{agent.name}</div>}
              <div className={`group space-y-2 text-[15px] leading-7 ${m.role === "user" ? "max-w-[85%] rounded-lg bg-fg px-4 py-2.5 text-bg" : ""}`}>
                {(() => {
                  const blocks: React.ReactNode[] = [];
                  let run: ToolPart[] = [];
                  const flush = (key: number) => {
                    if (run.length) blocks.push(<ToolRun key={`run${key}`} parts={run} />);
                    run = [];
                  };
                  m.parts.forEach((p, i) => {
                    if (p.type === "text") return (flush(i), blocks.push(<p key={i} className="whitespace-pre-wrap">{p.text}</p>));
                    if (isToolUIPart(p) && p.state === "approval-requested" && !p.approval.isAutomatic) {
                      const respond = (approved: boolean) => addToolApprovalResponse({ id: p.approval.id, approved });
                      flush(i);
                      return blocks.push(
                        <div key={i} className="space-y-3 rounded-lg border border-line p-4">
                          <div className="text-xs text-mute">Needs your approval</div>
                          <div className="text-sm">{approvalSummary(getToolName(p), p.input)}</div>
                          <div className="flex gap-2">
                            <button className="btn-solid" onClick={() => respond(true)}>Approve</button>
                            <button className="btn" onClick={() => respond(false)}>Deny</button>
                          </div>
                          <details className="text-xs text-mute">
                            <summary className="cursor-pointer">Details</summary>
                            <pre className="mt-2 overflow-x-auto whitespace-pre-wrap font-mono">{JSON.stringify(p.input, null, 2)}</pre>
                          </details>
                        </div>,
                      );
                    }
                    if (p.type === "reasoning")
                      return (flush(i), blocks.push(
                        <details key={i} className="text-xs text-mute">
                          <summary className="cursor-pointer">{p.state === "streaming" ? "Thinking…" : "Thought"}</summary>
                          <p className="mt-1 whitespace-pre-wrap">{p.text}</p>
                        </details>,
                      ));
                    const ui = renderUiPart(p, addToolOutput as never);
                    if (ui) return (flush(i), blocks.push(<div key={i}>{ui}</div>));
                    if (isToolUIPart(p)) run.push(p);
                  });
                  flush(m.parts.length);
                  return blocks;
                })()}
                {m.role === "assistant" && text && (
                  <button
                    onClick={() => navigator.clipboard?.writeText(text).catch(() => {})}
                    className="text-xs text-mute opacity-0 transition-opacity hover:text-fg focus-visible:opacity-100 group-hover:opacity-100"
                  >
                    Copy
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {waiting && <OrbIcon className="breathe h-6 w-6" />}
        {error && <p className="text-sm text-fg">{error.message}</p>}
        <div ref={end} />
      </div>
      <div className="space-y-2 pb-6">
        {!messages.length && agents.length > 1 && (
          <select
            aria-label="Agent"
            value={agent?.id}
            onChange={(e) => router.replace(`/chat/${id}?agent=${e.target.value}`)}
            className="rounded-full border border-line bg-bg px-3 py-1 text-xs outline-none hover:shadow-[0_0_0_1px_var(--fg)]"
          >
            {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        )}
        <form
          className="composer flex items-end gap-2 rounded-lg border border-line bg-bg py-1.5 pl-4 pr-1.5 transition-shadow focus-within:shadow-[0_0_0_1px_var(--fg)]"
          onSubmit={(e) => {
            e.preventDefault();
            if (!input.trim() || busy) return;
            sendMessage({ text: input });
            setInput("");
          }}
        >
          <textarea
            ref={box}
            rows={1}
            className="max-h-40 min-w-0 flex-1 resize-none overflow-y-auto bg-transparent py-2 text-[15px] leading-6 outline-none placeholder:text-mute"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends; Shift+Enter inserts a newline; IME composition is left alone
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder={agent ? `Message ${agent.name}` : "Message"}
            aria-label="Message"
            autoFocus
            suppressHydrationWarning
          />
          {busy ? (
            <button type="button" onClick={() => { stop(); void fetch(`/api/chat?id=${encodeURIComponent(id)}`, { method: "DELETE" }); }} aria-label="Stop" className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-fg text-bg"><StopIcon /></button>
          ) : (
            <button aria-label="Send" disabled={!input.trim()} className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-fg bg-fg text-bg disabled:bg-bg disabled:text-fg"><ArrowUpIcon /></button>
          )}
        </form>
      </div>
    </div>
  );
}
