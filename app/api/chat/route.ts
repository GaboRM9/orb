import { asUser, inWorkspace, requestSession } from "@/lib/db";
import { requestStop } from "@/lib/runs";
import { runTurn, type Turn } from "@/lib/turn";

export const maxDuration = 300; // agent runs with several tool calls outlast the old 60s

export async function POST(req: Request) {
  const session = await requestSession(req);
  if (!session) return new Response("Unauthorized", { status: 401 });
  return runTurn(session.workspace, session.uid, (await req.json()) as Turn);
}

/** Stop button: flags the thread; its running turn sees the flag within STOP_POLL_MS and aborts, keeping what it has so far. */
export async function DELETE(req: Request) {
  const session = await requestSession(req);
  if (!session) return new Response("Unauthorized", { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return new Response("Missing id", { status: 400 });
  await inWorkspace(session.workspace, () => asUser(session.uid, () => requestStop(id)));
  return new Response(null, { status: 204 });
}
