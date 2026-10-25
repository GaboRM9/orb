import Link from "next/link";
import { notFound } from "next/navigation";
import { Avatar } from "@/components/avatar";
import { deleteThread } from "@/lib/actions";
import { db, getAgent } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function History({ params }: PageProps<"/agents/[id]/history">) {
  const { id } = await params;
  const agent = getAgent(id);
  if (!agent) notFound();
  const threads = db
    .prepare("select id, title, updated, (select json_array_length(json) from messages m where m.thread_id=t.id) n from threads t where agent_id=? order by updated desc")
    .all(id) as { id: string; title: string; updated: number; n: number | null }[];
  return (
    <div className="mx-auto max-w-2xl space-y-4 p-6">
      <div className="flex items-center gap-3">
        <Avatar name={agent.name} size="h-9 w-9 text-sm" />
        <h1 className="flex-1">{agent.name} · History</h1>
        <Link href={`/agents/${id}?new=1`} className="btn-solid text-xs">New conversation</Link>
      </div>
      {!threads.length && <p className="text-sm text-mute">No conversations yet.</p>}
      <ul className="divide-y divide-line rounded-lg border border-line">
        {threads.map((t) => (
          <li key={t.id} className="flex items-center gap-3 px-4 py-3">
            <Link href={`/chat/${t.id}`} className="min-w-0 flex-1">
              <div className="truncate text-sm">{t.title}</div>
              <div className="text-xs text-mute">{new Date(t.updated).toLocaleString()} · {t.n ?? 0} messages</div>
            </Link>
            <form action={deleteThread.bind(null, t.id, `/agents/${id}/history`)}>
              <button className="btn text-xs">Delete</button>
            </form>
          </li>
        ))}
      </ul>
    </div>
  );
}
