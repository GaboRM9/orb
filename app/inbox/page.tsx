import Link from "next/link";
import { Submit } from "@/components/submit";
import { decideFromInbox } from "@/lib/actions";
import { requireAuth } from "@/lib/db";
import { waitingApprovals } from "@/lib/runs";
import { listSchedules } from "@/lib/schedules";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // approving resumes the agent's turn inside the action

const WEEK = 7 * 24 * 3600_000;
const ago = (t: number, now: number) => {
  const m = Math.round((now - t) / 60_000);
  return m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};

// outside the component: a page render is one request, so reading the clock here is fine
async function load(uid: string) {
  const [approvals, schedules] = await Promise.all([waitingApprovals(uid), listSchedules(uid)]);
  const now = Date.now();
  const recent = schedules.filter((r) => r.last_run && now - r.last_run < WEEK).sort((a, b) => b.last_run! - a.last_run!);
  return { approvals, recent, now };
}

export default async function InboxPage({ searchParams }: PageProps<"/inbox">) {
  const s = await requireAuth();
  const { error } = await searchParams;
  const { approvals, recent, now } = await load(s.uid);
  return (
    <div className="mx-auto max-w-3xl space-y-8 px-6 py-8 md:px-10 md:py-14">
      <h1>Inbox</h1>
      <section className="space-y-3">
        <h2 className="text-sm">Waiting for your approval</h2>
        {typeof error === "string" && <p role="alert" className="rounded-lg border border-accent p-3 text-sm">{error}</p>}
        {approvals.length ? (
          <div className="divide-y divide-line border-y border-line">
            {approvals.map((a) => (
              <div key={a.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex items-baseline gap-3 text-sm">
                    <Link href={`/chat/${a.thread_id}`} className="truncate hover:underline underline-offset-2">{a.title || "Untitled"}</Link>
                    <span className="shrink-0 text-xs text-mute">{ago(a.requested, now)}</span>
                  </div>
                  <div className="truncate text-xs text-mute" title={a.input ?? ""}>
                    {a.agent ?? "Agent"} wants to use <span className="font-mono">{a.tool}</span>{a.input && <> · <span className="font-mono">{a.input}</span></>}
                  </div>
                </div>
                <form className="flex shrink-0 gap-2">
                  <Submit className="btn-solid text-xs" formAction={decideFromInbox.bind(null, a.approval_id, true)} pendingText="Running…">Approve</Submit>
                  <Submit className="btn text-xs" formAction={decideFromInbox.bind(null, a.approval_id, false)}>Deny</Submit>
                </form>
              </div>
            ))}
          </div>
        ) : <p className="text-sm text-mute">Nothing waiting. When an agent asks to use a tool that needs approval, it shows up here.</p>}
      </section>
      <section className="space-y-3">
        <h2 className="text-sm">Scheduled runs this week</h2>
        {recent.length ? (
          <div className="divide-y divide-line border-y border-line">
            {recent.map((r) => {
              const row = (
                <>
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="truncate">{r.agent ?? "Deleted agent"}: {r.prompt}</span>
                    <span className="shrink-0 text-xs text-mute">{ago(r.last_run!, now)}</span>
                  </div>
                  {r.last_error && <div className="truncate text-xs">Failed: {r.last_error}</div>}
                </>
              );
              return r.last_thread && !r.last_error
                ? <Link key={r.id} href={`/chat/${r.last_thread}`} className="row-hover block space-y-0.5 py-3">{row}</Link>
                : <div key={r.id} className="space-y-0.5 py-3">{row}</div>;
            })}
          </div>
        ) : <p className="text-sm text-mute">No scheduled runs yet. Add one in <Link href="/library?tab=schedules" className="underline underline-offset-2">Library → Schedules</Link>.</p>}
      </section>
    </div>
  );
}
