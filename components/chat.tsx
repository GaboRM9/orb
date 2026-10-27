"use client";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, getToolName, isToolUIPart, lastAssistantMessageIsCompleteWithApprovalResponses, lastAssistantMessageIsCompleteWithToolCalls } from "ai";
import { renderUiPart, type ChatMessage } from "./gen-ui";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Avatar } from "./avatar";
import { OrbIcon } from "./icons";

type ChatAgent = { id: string; name: string; description: string };

// plain-language labels for built-in tools; anything else (MCP tools) shows its own name
const verbs: Record<string, [running: string, done: string]> = {
  getTime: ["Checking the time", "Checked the time"],
  calculate: ["Calculating", "Calculated"],
  fetchUrl: ["Reading a web page", "Read a web page"],
  searchThreads: ["Searching chats", "Searched chats"],
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

export function Chat({ id, initialMessages, agent }: { id: string; initialMessages: ChatMessage[]; agent?: ChatAgent }) {
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
      {agent && (
        <header className="flex items-center gap-3 border-b border-line py-4">
          <Avatar name={agent.name} size="h-9 w-9 text-sm" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">{agent.name}</div>
            <div className="truncate text-xs text-mute">{agent.description}</div>
          </div>
          {/* secondary actions live in one menu; no-JS disclosure */}
          <details className="relative">
            <summary aria-label="Conversation options" className="btn grid h-8 w-8 cursor-pointer list-none place-items-center p-0 text-mute hover:text-fg [&::-webkit-details-marker]:hidden">…</summary>
            <div className="absolute right-0 z-10 mt-2 flex w-48 flex-col rounded-md border border-line bg-bg p-1 text-sm">
              <Link href={`/agents/${agent.id}?new=1`} className="rounded-sm px-3 py-2 hover:bg-fg/5">New conversation</Link>
              <Link href={`/agents/${agent.id}/history`} className="rounded-sm px-3 py-2 hover:bg-fg/5">History</Link>
            </div>
          </details>
        </header>
      )}
      <div className="flex-1 space-y-6 overflow-y-auto py-6">
        {!messages.length && (
          <div className="mt-24 space-y-3 text-center text-sm text-mute">
            <p>{agent ? `Say hi to ${agent.name}.` : "Ask anything."}</p>
          </div>
        )}
        {messages.map((m) => {
          const text = m.parts.flatMap((p) => (p.type === "text" ? [p.text] : [])).join("\n\n");
          return (
            <div key={m.id} className={`${m.role === "user" ? "flex justify-end" : "space-y-1"} ${m.id === last?.id ? "rise" : ""}`}>
              {/* the agent's name marks each reply once, not on every block */}
              {m.role === "assistant" && agent && <div className="text-xs text-mute">{agent.name}</div>}
              <div className={`group space-y-2 text-[15px] leading-7 ${m.role === "user" ? "max-w-[85%] rounded-lg border border-line px-3 py-2" : ""}`}>
                {m.parts.map((p, i) => {
                  if (p.type === "text") return <p key={i} className="whitespace-pre-wrap">{p.text}</p>;
                  if (isToolUIPart(p) && p.state === "approval-requested" && !p.approval.isAutomatic) {
                    const respond = (approved: boolean) => addToolApprovalResponse({ id: p.approval.id, approved });
                    return (
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
                      </div>
                    );
                  }
                  const ui = renderUiPart(p, addToolOutput as never);
                  if (p.type === "reasoning")
                    return (
                      <details key={i} className="text-xs text-mute">
                        <summary className="cursor-pointer">{p.state === "streaming" ? "Thinking…" : "Thought"}</summary>
                        <p className="mt-1 whitespace-pre-wrap">{p.text}</p>
                      </details>
                    );
                  if (ui) return <div key={i}>{ui}</div>;
                  if (!isToolUIPart(p)) return null;
                  const name = getToolName(p);
                  const done = p.state === "output-available";
                  const failed = p.state === "output-error";
                  const [running, finished] = verbs[name] ?? [`Using ${name}`, `Used ${name}`];
                  return (
                    <details key={i} className="text-xs text-mute">
                      <summary className="cursor-pointer">
                        {failed ? `${name} failed` : done ? finished : `${running}…`}
                      </summary>
                      <pre className="mt-1 overflow-x-auto whitespace-pre-wrap font-mono">{JSON.stringify({ input: p.input, output: "output" in p ? p.output : undefined }, null, 2)}</pre>
                    </details>
                  );
                })}
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
        {waiting && <OrbIcon className="breathe h-6 w-6 text-mute" />}
        {error && <p className="text-sm text-fg">{error.message}</p>}
        <div ref={end} />
      </div>
      <div className="space-y-2 pb-8">
        <form
          className="flex items-end gap-2"
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
            className="field max-h-40 resize-none overflow-y-auto leading-6"
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
            autoFocus
            suppressHydrationWarning
          />
          {busy ? <button type="button" className="btn" onClick={stop}>Stop</button> : <button className="btn-solid">Send</button>}
        </form>
        <p className="text-center text-xs text-mute">Enter to send · Shift+Enter for a new line</p>
      </div>
    </div>
  );
}
