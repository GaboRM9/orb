import { createHash, timingSafeEqual } from "node:crypto";
import { runDue } from "@/lib/schedules";

export const maxDuration = 300; // the due schedules' turns run inside this request

const sha = (s: string) => createHash("sha256").update(s).digest();

/** Vercel Cron (vercel.json) calls this hourly with `Authorization: Bearer $CRON_SECRET`. No secret set: nobody can. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const got = req.headers.get("authorization") ?? "";
  if (!secret || !timingSafeEqual(sha(got), sha(`Bearer ${secret}`))) return new Response("Unauthorized", { status: 401 });
  return Response.json({ fired: await runDue() });
}
