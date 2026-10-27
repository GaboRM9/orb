import { generateId } from "ai";
import { notFound, redirect } from "next/navigation";
import { db, getAgent, ws } from "@/lib/db";

export const dynamic = "force-dynamic";

// Opening an agent resumes the latest conversation with it; "New chat" in the sidebar starts a fresh one.
export default async function OpenAgent({ params }: PageProps<"/agents/[id]">) {
  const { id } = await params;
  if (!(await getAgent(id))) notFound();
  const last = (await db.prepare("select id from threads where agent_id=? and workspace_id=? order by updated desc limit 1").get(id, await ws())) as { id: string } | undefined;
  redirect(last ? `/chat/${last.id}` : `/chat/${generateId()}?agent=${id}`);
}
