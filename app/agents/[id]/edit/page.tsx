import { notFound } from "next/navigation";
import { AgentForm } from "@/components/agent-form";
import { getAgent } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function EditAgent({ params }: PageProps<"/agents/[id]/edit">) {
  const { id } = await params;
  const agent = await getAgent(id);
  if (!agent) notFound();
  return (
    <div className="mx-auto max-w-3xl space-y-6 px-6 py-8 md:px-10 md:py-14">
      <h1>Edit {agent.name}</h1>
      <AgentForm agent={agent} />
    </div>
  );
}
