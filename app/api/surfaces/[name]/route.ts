import { requestAuthed } from "@/lib/auth";
import { runSurface, surfaces } from "@/lib/surfaces";

// The app-visible side of a surface: the view refetches with new params (a mode switch, a new date) without a model call.
export async function POST(req: Request, ctx: RouteContext<"/api/surfaces/[name]">) {
  if (!requestAuthed(req)) return new Response("Unauthorized", { status: 401 });
  const { name } = await ctx.params;
  const s = Object.hasOwn(surfaces, name) ? surfaces[name] : undefined;
  if (!s) return new Response("No such surface", { status: 404 });
  const { params } = (await req.json().catch(() => ({}))) as { params?: unknown };
  const ok = s.params.safeParse(params);
  if (!ok.success) return Response.json({ error: ok.error.issues.map((i) => i.message).join("; ") }, { status: 400 });
  try {
    return Response.json(await runSurface(s, ok.data));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
