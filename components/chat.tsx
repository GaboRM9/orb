"use client";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, getToolName, isToolUIPart, lastAssistantMessageIsCompleteWithApprovalResponses, lastAssistantMessageIsCompleteWithToolCalls } from "ai";
import { renderUiPart, type ChatMessage } from "./gen-ui";

export const TEST_UI = `Test UI: build me a weekend trip planner. (1) Ask me a form with destination (text), budget (slider 200-5000), start date (date), accent color (color) and a toggle for "include flights". (2) Show your plan as a checklist. (3) Show the places on a map with accurate coordinates. (4) Show the day-by-day schedule as a timeline. (5) Show a cost breakdown as a table and a bar chart of spend per category. (6) Show 3 hotel options as cards. (7) Finally ask me to pick one upgrade option.`;
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Avatar } from "./avatar";

export type ChatAgent = { id: string; name: string; description: string };

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
  const { messages, sendMessage, addToolOutput, addToolApprovalResponse, status, error, stop } = useChat<ChatMessage>({
    id,
    messages: initialMessages,
    transport,
    // resume after a form/choice answer or an approve/deny click
    sendAutomaticallyWhen: (o) => lastAssistantMessageIsCompleteWithToolCalls(o) || lastAssistantMessageIsCompleteWithApprovalResponses(o),
    onFinish: () => router.refresh(), // refresh thread list
  });
  const busy = status === "submitted" || status === "streaming";

  useEffect(() => end.current?.scrollIntoView({ block: "end" }), [messages]);

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col px-4">
      {agent && (
        <header className="flex items-center gap-3 border-b border-line py-3">
          <Avatar name={agent.name} size="h-9 w-9 text-sm" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">{agent.name}</div>
            <div className="truncate text-xs text-mute">{agent.description}</div>
          </div>
          <Link href={`/agents/${agent.id}/history`} className="btn text-xs">History</Link>
          <Link href={`/agents/${agent.id}?new=1`} className="btn text-xs">New conversation</Link>
        </header>
      )}
      <div className="flex-1 space-y-5 overflow-y-auto py-6">
        {!messages.length && (
          <div className="mt-24 space-y-3 text-center text-sm text-mute">
            <p>{agent ? `Say hi to ${agent.name}.` : "Ask anything, or run the full UI showcase."}</p>
            <button className="btn" onClick={() => sendMessage({ text: TEST_UI })}>Run UI showcase</button>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={m.role === "user" ? "flex justify-end" : ""}>
            <div className={`space-y-2 text-sm leading-6 ${m.role === "user" ? "max-w-[85%] rounded-lg border border-line px-3 py-2" : ""}`}>
              {m.parts.map((p, i) => {
                if (p.type === "text") return <p key={i} className="whitespace-pre-wrap">{p.text}</p>;
                if (isToolUIPart(p) && p.state === "approval-requested" && !p.approval.isAutomatic) {
                  const respond = (approved: boolean) => addToolApprovalResponse({ id: p.approval.id, approved });
                  return (
                    <div key={i} className="space-y-2 rounded-lg border border-fg p-3">
                      <div className="text-xs text-mute">Approval needed</div>
                      <div className="font-mono text-xs">{getToolName(p)}</div>
                      <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-xs">{JSON.stringify(p.input, null, 2)}</pre>
                      <div className="flex gap-2">
                        <button className="btn-solid" onClick={() => respond(true)}>Approve</button>
                        <button className="btn" onClick={() => respond(false)}>Deny</button>
                      </div>
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
                return (
                  <details key={i} className="rounded-md border border-line px-2 py-1 font-mono text-xs">
                    <summary className="cursor-pointer text-mute">
                      <span className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-current ${p.state === "output-available" || p.state === "output-error" ? "" : "animate-pulse"}`} />
                      {getToolName(p)} · {p.state === "output-available" ? "done" : p.state === "output-error" ? "error" : "running…"}
                    </summary>
                    <pre className="mt-1 overflow-x-auto whitespace-pre-wrap">{JSON.stringify({ input: p.input, output: "output" in p ? p.output : undefined }, null, 2)}</pre>
                  </details>
                );
              })}
            </div>
          </div>
        ))}
        {error && <p className="text-sm text-fg">{error.message}</p>}
        <div ref={end} />
      </div>
      <form
        className="flex gap-2 pb-6"
        onSubmit={(e) => {
          e.preventDefault();
          if (!input.trim() || busy) return;
          sendMessage({ text: input });
          setInput("");
        }}
      >
        <input className="field" value={input} onChange={(e) => setInput(e.target.value)} placeholder={agent ? `Message ${agent.name}` : "Message"} autoFocus suppressHydrationWarning />
        {busy ? <button type="button" className="btn" onClick={stop}>Stop</button> : <button className="btn-solid">Send</button>}
      </form>
    </div>
  );
}
