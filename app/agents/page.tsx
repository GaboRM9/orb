import Link from "next/link";
import { Avatar } from "@/components/avatar";
import { listAgents } from "@/lib/db";

export const dynamic = "force-dynamic";

export default function AgentsPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 px-10 py-14">
      <h1>Agents</h1>
      <p className="text-sm text-mute">Each agent is a persona with its own instructions, model, tools and skills. Open one to chat.</p>
      <div className="divide-y divide-line border-y border-line">
        {listAgents().map((a) => (
          <div key={a.id} className="group relative flex items-center gap-4 py-5">
            <Avatar name={a.name} size="h-9 w-9 text-sm" />
            <div className="min-w-0 flex-1">
              <Link href={`/agents/${a.id}`} className="font-medium after:absolute after:inset-0">{a.name}</Link>
              <p className="truncate text-sm text-mute">{a.description || "No description"}</p>
            </div>
            <p className="hidden font-mono text-xs text-mute sm:block">
              {JSON.parse(a.tools_json).length} tools · {JSON.parse(a.skills_json).length} skills · {JSON.parse(a.mcp_json).length} MCP
            </p>
            <Link href={`/agents/${a.id}/edit`} className="relative z-10 text-xs text-mute hover:text-fg">Edit</Link>
          </div>
        ))}
      </div>
      <Link href="/agents/new" className="inline-block text-sm text-mute hover:text-fg">+ New agent</Link>
    </div>
  );
}
