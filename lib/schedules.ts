import { generateId } from "ai";
import { db, ws } from "./db";
import { runToEnd } from "./turn";

// Schedules: an agent gets a prompt hourly, daily or on weekdays at an hour in its creator's timezone. Each firing is an
// ordinary chat turn as the creator, in a new chat of theirs: it uses their budget, and a tool needing approval stops on
// its card until they open the chat (the Inbox lists it).

export const EVERY = ["hourly", "daily", "weekdays"] as const;
export type Schedule = {
  id: string; workspace_id: string; user_id: string; agent_id: string; prompt: string; every: (typeof EVERY)[number];
  hour: number; tz: string; enabled: number; created: number; last_run: number | null; last_thread: string | null; last_error: string | null;
};

/** The wall clock in `tz` at `t`: a sortable "YYYY-MM-DD HH" key, the hour, and whether it's a weekend. */
export function wallClock(t: number, tz: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23", weekday: "short" })
      .formatToParts(t).map((x) => [x.type, x.value]),
  );
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), weekend: p.weekday === "Sat" || p.weekday === "Sun" };
}

export const validTz = (tz: string) => {
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; }
};

const key = (date: string, hour: number) => `${date} ${String(hour).padStart(2, "0")}`;
const DAY = 24 * 3600_000;

/** The most recent slot at or before `now`, as a key: this hour, or the latest day (a weekday, for weekdays) whose hour has come. */
function lastSlot(s: Pick<Schedule, "every" | "hour" | "tz">, now: number) {
  const n = wallClock(now, s.tz);
  if (s.every === "hourly") return key(n.date, n.hour);
  // ponytail: steps back whole days of 24h, so a DST change can name the wrong day in the hour around midnight
  for (let d = 0; ; d++) {
    const c = d ? wallClock(now - d * DAY, s.tz) : n;
    if ((d || c.hour >= s.hour) && !(s.every === "weekdays" && c.weekend)) return key(c.date, s.hour);
  }
}

/**
 * Whether a schedule should fire at `now`: it hasn't run (or been created) since its latest slot. So a late tick, like
 * the once-a-day cron on Vercel Hobby, still runs the slot it missed; a schedule made after today's slot waits for the next.
 */
export function isDue(s: Pick<Schedule, "every" | "hour" | "tz" | "created" | "last_run">, now: number) {
  const prev = wallClock(s.last_run ?? s.created, s.tz);
  return key(prev.date, prev.hour) < lastSlot(s, now);
}

/** Your schedules (or, for an admin, everyone's in the workspace), with the agent's name. */
export const listSchedules = async (user: string | null) =>
  (await db.prepare(
    `select s.*, a.name agent from schedules s left join agents a on a.id=s.agent_id
     where s.workspace_id=? and (? is null or s.user_id=?) order by s.created`,
  ).all(await ws(), user, user)) as (Schedule & { agent: string | null })[];

/**
 * Fires one schedule now. Claims it first (last_run moves only if nobody else moved it), so two overlapping ticks can't
 * both run it. Returns the new chat (if one was saved) and why the run failed, or null if another tick had it.
 */
export async function fire(s: Schedule, now = Date.now()) {
  const claimed = await db.prepare("update schedules set last_run=? where id=? and last_run is ?").run(now, s.id, s.last_run);
  if (!claimed.changes) return null;
  const threadId = generateId();
  let error: string | null;
  try {
    error = await runToEnd(s.workspace_id, s.user_id, { id: threadId, agentId: s.agent_id, message: { id: generateId(), role: "user", parts: [{ type: "text", text: s.prompt }] } });
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  // a run that failed mid-stream may still have saved its chat
  const saved = await db.prepare("select 1 from threads where id=?").get(threadId);
  await db.prepare("update schedules set last_thread=?, last_error=? where id=?").run(saved ? threadId : s.last_thread, error, s.id);
  return { thread: saved ? threadId : null, error };
}

// a schedule may run only while its creator is a member and its agent exists: it runs as them, with that agent
const LIVE = `select s.* from schedules s join members m on m.workspace_id=s.workspace_id and m.user_id=s.user_id
  join agents a on a.id=s.agent_id and a.workspace_id=s.workspace_id`;
/** The schedule, if it may still run (see LIVE). */
export const runnable = async (id: string) => (await db.prepare(`${LIVE} where s.id=?`).get(id)) as Schedule | undefined;

const PARALLEL = 5;
// ponytail: every due schedule in one 300s function, 5 at a time; a queue (Vercel Queues) if a tick ever has more than fits
/** The cron tick: every enabled schedule that's due, across workspaces, whose creator is still a member and agent still exists. */
export async function runDue(now = Date.now()) {
  const rows = (await db.prepare(`${LIVE} where s.enabled=1`).all()) as Schedule[];
  const queue = rows.filter((s) => isDue(s, now));
  let fired = 0;
  await Promise.all(Array.from({ length: PARALLEL }, async () => {
    for (let s; (s = queue.shift()); ) if ((await fire(s, now))?.thread) fired++;
  }));
  return fired;
}
