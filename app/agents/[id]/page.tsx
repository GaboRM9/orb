import { generateId } from "ai";
import { notFound, redirect } from "next/navigation";
import { db, getAgent } from "@/lib/db";

export const dynamic = "force-dynamic";

// Opening an agent resumes the latest conversation with it (?new=1 starts a fresh one).
export default async function OpenAgent({ params, searchParams }: PageProps<"/agents/[id]">) {
  const { id } = await params;
  const { new: fresh } = await searchParams;
  if (!getAgent(id)) notFound();
  const last = db.prepare("select id from threads where agent_id=? order by updated desc limit 1").get(id) as { id: string } | undefined;
  redirect(last && !fresh ? `/chat/${last.id}` : `/chat/${generateId()}?agent=${id}`);
}
