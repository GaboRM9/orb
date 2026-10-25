import { AgentForm } from "@/components/agent-form";

export const dynamic = "force-dynamic";

export default function NewAgent() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 px-6 py-14 md:px-10">
      <h1>New agent</h1>
      <AgentForm />
    </div>
  );
}
