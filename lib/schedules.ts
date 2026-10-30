import { generateId } from "ai";
import { db, inWorkspace, asUser, ws } from "./db";
import { runTurn } from "./turn";

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

/**
 * Whether a schedule should fire at `now`: its slot (this hour, or today at its hour) has started and it hasn't run, or
 * been created, since. A missed tick catches up later the same day; a daily schedule made after its hour starts tomorrow.
 */
export function isDue(s: Pick<Schedule, "every" | "hour" | "tz" | "created" | "last_run">, now: number) {
  const n = wallClock(now, s.tz);
  const slot = s.every === "hourly" ? n.hour : s.hour;
  if (n.hour < slot || (s.every === "weekdays" && n.weekend)) return false;
  const prev = wallClock(s.last_run ?? s.created, s.tz);
  return key(prev.date, prev.hour) < key(n.date, slot);
}

/** Your schedules (or, for an admin, everyone's in the workspace), with the agent's name. */
export const listSchedules = async (user: string | null) =>
  (await db.prepare(
    `select s.*, a.name agent from schedules s left join agents a on a.id=s.agent_id
     where s.workspace_id=? and (? is null or s.user_id=?) order by s.created`,
  ).all(await ws(), user, user)) as (Schedule & { agent: string | null })[];

/**
 * Fires one schedule now. Claims it first (last_run moves only if nobody else moved it), so two overlapping ticks can't
 * both run it. Returns the new chat's id, or null if another tick had it.
 */
export async function fire(s: Schedule, now = Date.now()) {
  const claimed = await db.prepare("update schedules set last_run=? where id=? and last_run is ?").run(now, s.id, s.last_run);
  if (!claimed.changes) return null;
  const threadId = generateId();
  let error: string | null = null;
  try {
    const res = await inWorkspace(s.workspace_id, () => asUser(s.user_id, () =>
      runTurn(s.workspace_id, s.user_id, { id: threadId, agentId: s.agent_id, message: { id: generateId(), role: "user", parts: [{ type: "text", text: s.prompt }] } })));
    const body = await res.text(); // reading to the end is what saves the chat
    if (!res.ok) error = body.slice(0, 300);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  await db.prepare("update schedules set last_thread=?, last_error=? where id=?").run(error ? s.last_thread : threadId, error, s.id);
  return error ? null : threadId;
}

const PARALLEL = 5;
// ponytail: every due schedule in one 300s function, 5 at a time; a queue (Vercel Queues) if a tick ever has more than fits
/** The cron tick: every enabled schedule that's due, across workspaces, whose creator is still a member and agent still exists. */
export async function runDue(now = Date.now()) {
  const rows = (await db.prepare(
    `select s.* from schedules s join members m on m.workspace_id=s.workspace_id and m.user_id=s.user_id
     join agents a on a.id=s.agent_id and a.workspace_id=s.workspace_id where s.enabled=1`,
  ).all()) as Schedule[];
  const queue = rows.filter((s) => isDue(s, now));
  let fired = 0;
  await Promise.all(Array.from({ length: PARALLEL }, async () => {
    for (let s; (s = queue.shift()); ) if (await fire(s, now)) fired++;
  }));
  return fired;
}
