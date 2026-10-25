import { AgentForm } from "@/components/agent-form";

export const dynamic = "force-dynamic";

export default function NewAgent() {
  return (
    <div className="mx-auto max-w-2xl space-y-4 p-6">
      <h1 className="text-lg font-semibold">New agent</h1>
      <AgentForm />
    </div>
  );
}
