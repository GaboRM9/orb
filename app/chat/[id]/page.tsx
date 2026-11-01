import { loadChat } from "@/lib/chat-store";
import { Multiplex } from "@/components/multiplex";
import type { ChatMessage } from "@/components/gen-ui";
import { isAdmin, listAgents, listThreads, threadAgentId } from "@/lib/db";
import { podOf } from "@/lib/pods";

export const dynamic = "force-dynamic";

// a chat is a pod of one; in a pod, any of its chats opens the whole pod
export default async function Page({ params, searchParams }: PageProps<"/chat/[id]">) {
  const { id } = await params;
  const { agent } = await searchParams;
  const [agents, threads, admin, pod] = await Promise.all([listAgents(), listThreads(), isAdmin(), podOf(id)]);
  const panes = pod?.panes ?? [{ id, agent: typeof agent === "string" ? agent : undefined }];
  const loaded = await Promise.all(
    panes.map(async (p) => {
      const [messages, saved] = await Promise.all([loadChat(p.id), threadAgentId(p.id)]);
      // a new thread starts with Assistant (or the agent its pane names); one with history keeps whatever it had.
      // the first agent is the fallback in case Assistant was deleted.
      const a =
        agents.find((x) => x.id === (saved ?? p.agent)) ??
        (messages.length ? undefined : (agents.find((x) => x.id === "assistant") ?? agents[0]));
      return {
        id: p.id,
        messages: messages as ChatMessage[],
        title: threads.find((t) => t.id === p.id)?.title,
        agent: a && { id: a.id, name: a.name, description: a.description },
        sees: "sees" in p ? p.sees : undefined,
      };
    }),
  );
  return (
    <Multiplex
      pod={pod && { id: pod.id, title: pod.title, goal: pod.goal }}
      focus={id}
      panes={loaded}
      agents={agents.map((a) => ({ id: a.id, name: a.name }))}
      threads={threads.slice(0, 30).map((t) => ({ id: t.id, title: t.title }))}
      canAlwaysAllow={admin}
    />
  );
}
