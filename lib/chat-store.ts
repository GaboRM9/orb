import type { UIMessage } from "ai";
import { db } from "./db";

export function loadChat(id: string): UIMessage[] {
  const r = db.prepare("select json from messages where thread_id=?").get(id) as { json: string } | undefined;
  return r ? dedupe(JSON.parse(r.json)) : [];
}

// A message superseded by a later one (same id, or same tool call) is a stale copy: drop it.
// Duplicate tool_use ids make Anthropic reject the request and duplicate React keys break the UI.
const callIds = (m: UIMessage) => m.parts.flatMap((p) => ("toolCallId" in p ? [p.toolCallId] : []));
function dedupe(ms: UIMessage[]) {
  return ms.filter((m, i) => {
    const ids = callIds(m);
    return !ms.slice(i + 1).some((n) => n.id === m.id || (ids.length > 0 && ids.some((c) => callIds(n).includes(c))));
  });
}

export function saveChat(id: string, messages: UIMessage[], agentId?: string | null) {
  const first = messages.find((m) => m.role === "user")?.parts.find((p) => p.type === "text");
  const title = (first && "text" in first ? first.text : "New chat").slice(0, 60);
  db.transaction(() => {
    db.prepare(
      "insert into threads (id,title,updated,agent_id) values (?,?,?,?) on conflict(id) do update set updated=excluded.updated",
    ).run(id, title, Date.now(), agentId ?? null);
    db.prepare(
      "insert into messages (thread_id,json) values (?,?) on conflict(thread_id) do update set json=excluded.json",
    ).run(id, JSON.stringify(messages));
  })();
}
