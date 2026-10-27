import Link from "next/link";
import { Avatar } from "@/components/avatar";
import { envKey, getSetting, listAgents } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function AgentsPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 px-6 py-14 md:px-10">
      <h1>Agents</h1>
      {!(await getSetting("api_key")) && !(await envKey("ANTHROPIC_API_KEY")) && (
        <p className="text-sm">Add your Anthropic key in <Link href="/settings" className="underline">Settings</Link> to start chatting.</p>
      )}
      <div className="divide-y divide-line border-y border-line">
        {(await listAgents()).map((a) => (
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
      <Link href="/agents/new" className="inline-block text-sm text-mute hover:text-fg">+ New agent</Link>
    </div>
  );
}
