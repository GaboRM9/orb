import { notFound } from "next/navigation";
import { AgentForm } from "@/components/agent-form";
import { getAgent } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function EditAgent({ params }: PageProps<"/agents/[id]/edit">) {
  const { id } = await params;
  const agent = getAgent(id);
  if (!agent) notFound();
  return (
    <div className="mx-auto max-w-2xl space-y-4 p-6">
      <h1 className="text-lg font-semibold">Edit {agent.name}</h1>
      <AgentForm agent={agent} />
    </div>
  );
}
