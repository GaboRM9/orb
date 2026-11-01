import { db, me, ws } from "./db";
import { normalize, type Pane, type Pod } from "./multiplex";

// A pod: up to 10 chats side by side, saved. It opens at /chat/<any of its chats>; a chat in no pod is a pod of one.

type Row = { id: string; title: string | null; goal: string | null; panes_json: string; updated: number };
const pod = (r: Row | undefined): Pod | undefined => r && { id: r.id, title: r.title, goal: r.goal, panes: JSON.parse(r.panes_json), updated: r.updated };

export const listPods = async () =>
  ((await db.prepare("select * from pods where workspace_id=? and user_id=? order by updated desc").all(await ws(), await me())) as Row[]).map((r) => pod(r)!);

export const getPod = async (id: string) =>
  pod((await db.prepare("select * from pods where id=? and workspace_id=? and user_id=?").get(id, await ws(), await me())) as Row | undefined);

/** The pod holding this chat, if any. */
export const podOf = async (threadId: string) =>
  pod((await db.prepare(
    "select p.* from pods p, json_each(p.panes_json) j where p.workspace_id=? and p.user_id=? and json_extract(j.value, '$.id')=? limit 1",
  ).get(await ws(), await me(), threadId)) as Row | undefined);

/**
 * Saves a pod's panes (a new pod when `id` is null) and returns the pod's id, or null once it's down to one chat: a pod of
 * one is just that chat, so the row goes. A chat moved in here leaves whatever pod it was in.
 * ponytail: last write wins between two tabs editing one pod; add a version column if that ever bites
 */
export async function savePanes(id: string | null, panes: Pane[]) {
  const next = normalize(panes);
  const [w, u] = [await ws(), await me()];
  const podId = id ?? crypto.randomUUID();
  return db.tx(async (t) => {
    const ids = new Set(next.map((p) => p.id));
    for (const r of (await t.prepare("select * from pods where workspace_id=? and user_id=? and id!=?").all(w, u, podId)) as Row[]) {
      const old: Pane[] = JSON.parse(r.panes_json);
      if (!old.some((p) => ids.has(p.id))) continue;
      const left = normalize(old.filter((p) => !ids.has(p.id)));
      await (left.length > 1
        ? t.prepare("update pods set panes_json=? where id=?").run(JSON.stringify(left), r.id)
        : t.prepare("delete from pods where id=?").run(r.id));
    }
    if (next.length < 2) {
      await t.prepare("delete from pods where id=? and workspace_id=? and user_id=?").run(podId, w, u);
      return null;
    }
    // someone else's pod id is left untouched, the same guard as saveChat
    await t.prepare(
      `insert into pods (id,workspace_id,user_id,panes_json,updated) values (?,?,?,?,?)
       on conflict(id) do update set panes_json=excluded.panes_json, updated=excluded.updated
       where pods.workspace_id=excluded.workspace_id and pods.user_id=excluded.user_id`,
    ).run(podId, w, u, JSON.stringify(next), Date.now());
    return podId;
  });
}

export const renamePod = async (id: string, title: string) =>
  db.prepare("update pods set title=? where id=? and workspace_id=? and user_id=?").run(title.trim().slice(0, 60) || null, id, await ws(), await me());

/** The pod's shared goal: every agent in it reads it each turn. Blank clears it. */
export const setPodGoal = async (id: string, goal: string) =>
  db.prepare("update pods set goal=? where id=? and workspace_id=? and user_id=?").run(goal.trim().slice(0, 2000) || null, id, await ws(), await me());

/** Takes a chat out of its pod (it was deleted, or closed). */
export async function dropFromPod(threadId: string) {
  const p = await podOf(threadId);
  if (p) await savePanes(p.id, p.panes.filter((x) => x.id !== threadId));
}

/** The saved chats this one may read: its pane's `sees`, re-read every time so an unlinked pane is unreadable at once. */
export async function linkedPanes(threadId: string) {
  const sees = (await podOf(threadId))?.panes.find((p) => p.id === threadId)?.sees ?? [];
  if (!sees.length) return [];
  return (await db.prepare(
    `select t.id, t.title, coalesce(a.name, 'orb') agent from threads t left join agents a on a.id=t.agent_id and a.workspace_id=t.workspace_id
     where t.workspace_id=? and t.user_id=? and t.id in (${sees.map(() => "?").join(",")})`,
  ).all(await ws(), await me(), ...sees)) as { id: string; title: string; agent: string }[];
}
