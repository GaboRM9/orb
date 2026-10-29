import Link from "next/link";
import { Avatar } from "@/components/avatar";
import { PlusIcon } from "@/components/icons";
import { envKey, getSetting, listAgents } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function AgentsPage() {
  const [saved, env, agents] = await Promise.all([getSetting("api_key"), envKey("ANTHROPIC_API_KEY"), listAgents()]);
  return (
    <div className="mx-auto max-w-3xl space-y-6 px-6 py-8 md:px-10 md:py-14">
      <h1>Agents</h1>
      {!saved && !env && (
        <p className="text-sm">Connect Anthropic in <Link href="/library?tab=connections" className="underline">Library → Connections</Link> to start chatting.</p>
      )}
      <div className="divide-y divide-line border-y border-line">
        {agents.map((a) => (
          <div key={a.id} className="group relative flex items-center gap-4 py-5">
            <Avatar name={a.name} size="h-9 w-9 text-sm" />
            <div className="min-w-0 flex-1">
              <Link href={`/agents/${a.id}`} className="font-medium after:absolute after:inset-0">{a.name}</Link>
              <p className="truncate text-sm text-mute">{a.description || "No description"}</p>
            </div>
            <Link href={`/agents/${a.id}/edit`} className="relative z-10 text-sm text-mute hover:text-fg">Edit</Link>
          </div>
        ))}
      </div>
      <Link href="/agents/new" className="btn inline-flex items-center gap-2"><PlusIcon />New agent</Link>
    </div>
  );
}
