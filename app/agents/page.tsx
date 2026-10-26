import Link from "next/link";
import { Avatar } from "@/components/avatar";
import { listAgents, type Agent } from "@/lib/db";

export const dynamic = "force-dynamic";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
// "3 tools, 1 skill" in plain words; MCP only when the agent has servers
function capabilities(a: Agent) {
  const mcp = JSON.parse(a.mcp_json).length;
  return [plural(JSON.parse(a.tools_json).length, "tool"), plural(JSON.parse(a.skills_json).length, "skill"), ...(mcp ? [plural(mcp, "MCP server")] : [])].join(", ");
}

export default function AgentsPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 px-6 py-14 md:px-10">
      <h1>Agents</h1>
      <p className="text-sm text-mute">Each agent is a persona with its own instructions, model, tools and skills. Open one to chat.</p>
      <div className="divide-y divide-line border-y border-line">
        {listAgents().map((a) => (
          <div key={a.id} className="group relative flex items-center gap-4 py-5">
            <Avatar name={a.name} size="h-9 w-9 text-sm" />
            <div className="min-w-0 flex-1">
              <Link href={`/agents/${a.id}`} className="font-medium after:absolute after:inset-0">{a.name}</Link>
              <p className="truncate text-sm text-mute">{a.description || "No description"}</p>
              <p className="text-xs text-mute">{capabilities(a)}</p>
            </div>
            <Link href={`/agents/${a.id}/edit`} className="relative z-10 text-xs text-mute hover:text-fg">Edit</Link>
          </div>
        ))}
      </div>
      <Link href="/agents/new" className="inline-block text-sm text-mute hover:text-fg">+ New agent</Link>
    </div>
  );
}
