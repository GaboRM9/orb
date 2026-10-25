import Link from "next/link";
import { Avatar } from "@/components/avatar";
import { listAgents } from "@/lib/db";

export const dynamic = "force-dynamic";

export default function AgentsPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <h1 className="text-lg font-semibold">Agents</h1>
      <p className="text-sm text-mute">Each agent is a persona with its own instructions, model, tools and skills. Open one to chat.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {listAgents().map((a) => (
          <div key={a.id} className="group relative flex gap-3 rounded-lg border border-line p-4 hover:border-fg">
            <Avatar name={a.name} />
            <div className="min-w-0">
              <Link href={`/agents/${a.id}`} className="font-medium after:absolute after:inset-0">{a.name}</Link>
              <p className="text-sm text-mute">{a.description || "No description"}</p>
              <p className="mt-1 font-mono text-xs text-mute">
                {JSON.parse(a.tools_json).length} tools · {JSON.parse(a.skills_json).length} skills · {JSON.parse(a.mcp_json).length} MCP
              </p>
            </div>
            <Link href={`/agents/${a.id}/edit`} className="btn relative z-10 ml-auto h-fit text-xs">Edit</Link>
          </div>
        ))}
        <Link href="/agents/new" className="flex min-h-24 items-center justify-center rounded-lg border border-dashed border-line text-sm text-mute hover:border-fg hover:text-fg">
          + New agent
        </Link>
      </div>
    </div>
  );
}
