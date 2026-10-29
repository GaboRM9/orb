import { loadChat } from "@/lib/chat-store";
import { Multiplex } from "@/components/multiplex";
import type { ChatMessage } from "@/components/gen-ui";
import { isAdmin, listAgents, listThreads, threadAgentId } from "@/lib/db";
import { panesOf } from "@/lib/multiplex";

export const dynamic = "force-dynamic";

// a chat is a grid of one; Split adds panes beside it (?with=…)
export default async function Page({ params, searchParams }: PageProps<"/chat/[id]">) {
  const { id } = await params;
  const { agent, with: more } = await searchParams;
  const panes = panesOf(id, typeof agent === "string" ? agent : null, typeof more === "string" ? more : null);
  const [agents, threads, admin] = await Promise.all([listAgents(), listThreads(), isAdmin()]);
  const loaded = await Promise.all(
    panes.map(async (p) => {
      const [messages, saved] = await Promise.all([loadChat(p.id), threadAgentId(p.id)]);
      // a new thread starts with Assistant (or the agent its link names); one with history keeps whatever it had.
      // the first agent is the fallback in case Assistant was deleted.
      const a =
        agents.find((x) => x.id === (saved ?? p.agent)) ??
        (messages.length ? undefined : (agents.find((x) => x.id === "assistant") ?? agents[0]));
      return {
        id: p.id,
        messages: messages as ChatMessage[],
        title: threads.find((t) => t.id === p.id)?.title,
        agent: a && { id: a.id, name: a.name, description: a.description },
      };
    }),
  );
  return (
    <Multiplex
      panes={loaded}
      agents={agents.map((a) => ({ id: a.id, name: a.name }))}
      threads={threads.slice(0, 30).map((t) => ({ id: t.id, title: t.title }))}
      canAlwaysAllow={admin}
    />
  );
}
