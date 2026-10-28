"use client";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, getToolName, isToolUIPart, lastAssistantMessageIsCompleteWithApprovalResponses, lastAssistantMessageIsCompleteWithToolCalls } from "ai";
import { renderUiPart, type ChatMessage } from "./gen-ui";
import { alwaysAllowMcpTool } from "@/lib/actions";

import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowUpIcon, PaperclipIcon, StopIcon, XIcon } from "./icons";
import { FILE_TYPES, MAX_FILE_BYTES } from "@/lib/files";

type ChatAgent = { id: string; name: string; description: string };

// plain-language labels for built-in tools; anything else (MCP tools) shows its own name
// the opening line of an empty chat; picked from the chat id so server and client render the same one
const greetings = ["What are we working on?", "Where should we start?", "What's on your mind?", "Ready when you are.", "What can I take off your plate?"];
const greetingFor = (id: string) => greetings[[...id].reduce((h, c) => h + c.charCodeAt(0), 0) % greetings.length];

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

/** Consecutive tool calls collapse into one chip; one call keeps its own label. */
function ToolRun({ parts }: { parts: ToolPart[] }) {
  if (parts.length === 1)
    return (
      <details className="peek">
        <summary>{toolLabel(parts[0])}</summary>
        <pre>{toolJson(parts[0])}</pre>
      </details>
    );
  const working = parts.some((p) => p.state !== "output-available" && p.state !== "output-error");
  return (
    <details className="peek">
      <summary>{working ? `Using ${parts.length} tools…` : `Used ${parts.length} tools`}</summary>
      <pre>{parts.map((p) => `${toolLabel(p)}\n${toolJson(p)}`).join("\n\n")}</pre>
    </details>
  );
}

// Markdown, CSV and other text files go to the model as plain text: it reads text/plain, not every text/* type.
const TEXTISH = /\.(md|mdx|txt|csv|json|ya?ml|log)$/i;
const asAttachment = (f: File) => (f.type.startsWith("text/") || (!f.type && TEXTISH.test(f.name)) ? new File([f], f.name, { type: "text/plain" }) : f);

// chat id → toolCallId → what that surface shows now (set when the user changes it, sent with the next message)
const surfaceStates = new Map<string, Record<string, string>>();

export function Chat({ id, initialMessages, agent, canAlwaysAllow }: { id: string; initialMessages: ChatMessage[]; agent?: ChatAgent; canAlwaysAllow?: boolean }) {
  const router = useRouter();
  const agentId = agent?.id;
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        // server holds history; send only the newest message (+ which agent this thread talks to)
        // + what open surfaces show now, if the user changed them since the agent opened them
        prepareSendMessagesRequest: ({ id, messages }) => ({ body: { id, agentId, message: messages[messages.length - 1], context: Object.values(surfaceStates.get(id) ?? {}) } }),
      }),
    [agentId],
  );
  const [input, setInput] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [fileMsg, setFileMsg] = useState("");
  const picker = useRef<HTMLInputElement>(null);
  const attach = (picked: FileList | null) => {
    const next = [...files, ...[...(picked ?? [])].map(asAttachment)];
    const bad = next.find((f) => !FILE_TYPES.includes(f.type));
    if (bad) setFileMsg(`Can't attach ${bad.name}: use an image, PDF or text file.`);
    else if (next.reduce((n, f) => n + f.size, 0) > MAX_FILE_BYTES) setFileMsg("Attachments are limited to 3 MB per message.");
    else {
      setFiles(next);
      setFileMsg("");
    }
    if (picker.current) picker.current.value = "";
  };
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
  const name = agent?.name ?? "orb";
  const empty = !messages.length;
  const greeting = greetingFor(id);

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
    // an empty chat sits in the middle of the screen: the agent opens with a greeting turn and the composer right under it.
    // The first message drops the centering, so the composer settles at the bottom and the thread grows above it.
    <div className={`mx-auto flex h-full max-w-3xl flex-col px-6 ${empty ? "justify-center pb-[12vh]" : ""}`}>
      <div className={`space-y-7 overflow-y-auto ${empty ? "pb-6" : "flex-1 py-8"}`}>
        {empty && (
          <div className="turn turn-agent rise">
            <div className="mb-1 text-xs text-mute">{name}</div>
            <p className="text-2xl font-light tracking-tight">{greeting}</p>
            {agent?.description && <p className="mt-1 text-sm text-mute">{agent.description}</p>}
          </div>
        )}
        {messages.map((m) => {
          const text = m.parts.flatMap((p) => (p.type === "text" ? [p.text] : [])).join("\n\n");
          const live = busy && m.id === last?.id && m.role === "assistant";
          return (
            // no bubbles: a line in the margin says who's speaking, and pulses while the agent works
            <div key={m.id} className={`turn ${m.role === "assistant" ? "turn-agent" : "turn-user"} ${live ? "turn-live" : ""} ${m.id === last?.id ? "rise" : ""}`}>
              <div className={`mb-1 text-xs text-mute ${m.role === "user" ? "text-right" : ""}`}>{m.role === "user" ? "You" : name}</div>
              <div className="group space-y-3 text-sm leading-7">
                {(() => {
                  const blocks: React.ReactNode[] = [];
                  let run: ToolPart[] = [];
                  const flush = (key: number) => {
                    if (run.length) blocks.push(<ToolRun key={`run${key}`} parts={run} />);
                    run = [];
                  };
                  m.parts.forEach((p, i) => {
                    if (p.type === "text") return (flush(i), blocks.push(<p key={i} className="whitespace-pre-wrap">{p.text}</p>));
                    if (p.type === "file")
                      return (flush(i), blocks.push(
                        p.mediaType.startsWith("image/")
                          // eslint-disable-next-line @next/next/no-img-element -- an inline data URL; next/image has nothing to optimize
                          ? <img key={i} src={p.url} alt={p.filename ?? "Attached image"} className={`max-h-64 rounded-md border border-line ${m.role === "user" ? "ml-auto" : ""}`} />
                          : <span key={i} className={`chip block w-fit ${m.role === "user" ? "ml-auto" : ""}`}>{p.filename ?? p.mediaType}</span>,
                      ));
                    if (isToolUIPart(p) && p.state === "approval-requested" && !p.approval.isAutomatic) {
                      const respond = (approved: boolean) => addToolApprovalResponse({ id: p.approval.id, approved });
                      flush(i);
                      return blocks.push(
                        <div key={i} className="card space-y-3 border-accent">
                          <div className="text-xs text-mute">Needs your approval</div>
                          <div className="text-sm">{approvalSummary(getToolName(p), p.input)}</div>
                          <div className="flex gap-2">
                            <button className="btn-solid" onClick={() => respond(true)}>Approve</button>
                            {/* saved before approving, so the resumed turn already runs later calls without asking */}
                            {canAlwaysAllow && getToolName(p).startsWith("mcp_") && (
                              <button className="btn" title="Later calls to this tool run without asking. Undo in Library → Connections." onClick={async () => { await alwaysAllowMcpTool(getToolName(p)).catch(() => {}); respond(true); }}>
                                Always allow
                              </button>
                            )}
                            <button className="btn" onClick={() => respond(false)}>Deny</button>
                          </div>
                          <details className="peek">
                            <summary>Details</summary>
                            <pre>{JSON.stringify(p.input, null, 2)}</pre>
                          </details>
                        </div>,
                      );
                    }
                    if (p.type === "reasoning")
                      return (flush(i), blocks.push(
                        <details key={i} className="peek">
                          <summary>{p.state === "streaming" ? "Thinking…" : "Thought"}</summary>
                          <pre className="!font-sans">{p.text}</pre>
                        </details>,
                      ));
                    const ui = renderUiPart(p, { addOutput: addToolOutput as never, send: (text) => sendMessage({ text }), live: !busy && m.id === last?.id, setContext: (k, t) => surfaceStates.set(id, { ...surfaceStates.get(id), [k]: t }) });
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
        {/* before the reply's first part arrives, an empty turn holds its place */}
        {busy && last?.role === "user" && (
          <div className="turn turn-agent turn-live">
            <div className="mb-1 text-xs text-mute">{name}</div>
            <div className="h-7" />
          </div>
        )}
        {error && <p className="text-sm text-fg">{error.message}</p>}
        {fileMsg && <p role="status" className="text-sm text-mute">{fileMsg}</p>}
        <div ref={end} />
      </div>
      {/* the composer floats: messages fade out under it instead of stopping at a hard edge */}
      <div className={`relative ${empty ? "" : "pb-6 before:pointer-events-none before:absolute before:inset-x-0 before:-top-10 before:h-10 before:bg-linear-to-t before:from-bg"}`}>
        <form
          className="composer flex flex-wrap items-end gap-2 rounded-ctl border border-line bg-bg py-1.5 px-1.5 shadow-lg transition-shadow focus-within:border-accent focus-within:ring-3 focus-within:ring-ring"
          onSubmit={(e) => {
            e.preventDefault();
            if ((!input.trim() && !files.length) || busy) return;
            const dt = new DataTransfer();
            files.forEach((f) => dt.items.add(f));
            sendMessage(input.trim() ? { text: input, files: dt.files } : { files: dt.files });
            setInput("");
            setFiles([]);
          }}
        >
          {files.length > 0 && (
            <div className="flex basis-full flex-wrap gap-1.5 pt-1.5">
              {files.map((f, i) => (
                <span key={i} className="chip flex items-center gap-1">
                  {f.name}
                  <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))}><XIcon /></button>
                </span>
              ))}
            </div>
          )}
          <input ref={picker} type="file" multiple hidden accept={[...FILE_TYPES, ".md,.csv,.json,.yaml,.yml"].join(",")} onChange={(e) => attach(e.target.files)} />
          <button type="button" onClick={() => picker.current?.click()} aria-label="Attach files" className="grid h-9 w-9 shrink-0 place-items-center rounded-ctl text-mute hover:text-fg"><PaperclipIcon /></button>
          <textarea
            ref={box}
            rows={1}
            className="max-h-40 min-w-0 flex-1 resize-none overflow-y-auto bg-transparent py-2 text-sm leading-6 outline-none placeholder:text-mute"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onPaste={(e) => e.clipboardData.files.length && (e.preventDefault(), attach(e.clipboardData.files))}
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
            <button type="button" onClick={() => { stop(); void fetch(`/api/chat?id=${encodeURIComponent(id)}`, { method: "DELETE" }); }} aria-label="Stop" className="grid h-9 w-9 shrink-0 place-items-center rounded-ctl bg-accent text-on-accent"><StopIcon /></button>
          ) : (
            <button aria-label="Send" disabled={!input.trim() && !files.length} className="grid h-9 w-9 shrink-0 place-items-center rounded-ctl bg-accent text-on-accent transition-colors disabled:bg-surface-2 disabled:text-mute"><ArrowUpIcon /></button>
          )}
        </form>
      </div>
    </div>
  );
}
