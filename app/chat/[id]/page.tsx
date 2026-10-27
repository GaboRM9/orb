import { loadChat } from "@/lib/chat-store";
import { Chat } from "@/components/chat";
import type { ChatMessage } from "@/components/gen-ui";
import { getAgent, listAgents, threadAgentId } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function Page({ params, searchParams }: PageProps<"/chat/[id]">) {
  const { id } = await params;
  const { agent: agentParam } = await searchParams;
  const messages = (await loadChat(id)) as ChatMessage[];
  const agents = await listAgents();
  // an empty thread starts with the first agent; a thread that already has history keeps whatever it had
  const agent = (await getAgent((await threadAgentId(id)) ?? (typeof agentParam === "string" ? agentParam : undefined))) ?? (messages.length ? undefined : agents[0]);
  return (
    <Chat
      key={id}
      id={id}
      initialMessages={messages}
      agent={agent && { id: agent.id, name: agent.name, description: agent.description }}
      agents={agents.map((a) => ({ id: a.id, name: a.name }))}
    />
  );
}
