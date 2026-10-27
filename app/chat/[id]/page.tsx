import { loadChat } from "@/lib/chat-store";
import { Chat } from "@/components/chat";
import type { ChatMessage } from "@/components/gen-ui";
import { getAgent, threadAgentId } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function Page({ params, searchParams }: PageProps<"/chat/[id]">) {
  const { id } = await params;
  const { agent: agentParam } = await searchParams;
  const agent = await getAgent((await threadAgentId(id)) ?? (typeof agentParam === "string" ? agentParam : undefined));
  return (
    <Chat
      key={id}
      id={id}
      initialMessages={(await loadChat(id)) as ChatMessage[]}
      agent={agent && { id: agent.id, name: agent.name, description: agent.description }}
    />
  );
}
