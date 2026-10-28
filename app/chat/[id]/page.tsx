import { loadChat } from "@/lib/chat-store";
import { Chat } from "@/components/chat";
import type { ChatMessage } from "@/components/gen-ui";
import { getAgent, isAdmin, listAgents, threadAgentId } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function Page({ params, searchParams }: PageProps<"/chat/[id]">) {
  const { id } = await params;
  const { agent: agentParam } = await searchParams;
  const messages = (await loadChat(id)) as ChatMessage[];
  // a new thread starts with Assistant (or the agent its link names); one with history keeps whatever it had.
  // listAgents is the fallback in case Assistant was deleted.
  const agent =
    (await getAgent((await threadAgentId(id)) ?? (typeof agentParam === "string" ? agentParam : undefined))) ??
    (messages.length ? undefined : ((await getAgent("assistant")) ?? (await listAgents())[0]));
  return (
    <Chat
      key={id}
      id={id}
      initialMessages={messages}
      agent={agent && { id: agent.id, name: agent.name, description: agent.description }}
      canAlwaysAllow={await isAdmin()}
    />
  );
}
