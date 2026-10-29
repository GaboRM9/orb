import { AsyncLocalStorage } from "node:async_hooks";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient, type Client, type InStatement, type Transaction } from "@libsql/client";
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { checkPassword, COOKIE, cookieToken, hashPassword, parseToken } from "./auth";
import { isSealed, seal } from "./secret";

// Hosted: TURSO_DATABASE_URL + TURSO_AUTH_TOKEN (Vercel Marketplace). Local/tests: a SQLite file at DB_PATH.
const REMOTE = process.env.TURSO_DATABASE_URL;
const DB_PATH = process.env.DB_PATH ?? "data/app.db";

type Args = unknown[];
type Exec = Pick<Client, "execute"> | Pick<Transaction, "execute">;
// one object argument means named parameters (@name); anything else is positional
const norm = (args: Args) => (args.length === 1 && args[0] && typeof args[0] === "object" && !Array.isArray(args[0]) && !ArrayBuffer.isView(args[0]) ? args[0] : args);
const stmt = (sql: string, args: Args) => ({ sql, args: norm(args) }) as InStatement;

async function all(c: Exec, sql: string, args: Args) {
  const r = await c.execute(stmt(sql, args));
  return r.rows.map((row) => Object.fromEntries(r.columns.map((col, i) => [col, row[i]])));
}
async function run(c: Exec, sql: string, args: Args) {
  const r = await c.execute(stmt(sql, args));
  return { changes: r.rowsAffected, lastInsertRowid: Number(r.lastInsertRowid ?? 0) };
}
// the same prepare().get/all/run surface on the client and inside a transaction
const api = (c: Exec) => ({
  prepare: (sql: string) => ({
    all: (...a: Args) => all(c, sql, a) as Promise<unknown[]>,
    get: async (...a: Args) => (await all(c, sql, a))[0] as unknown,
    run: (...a: Args) => run(c, sql, a),
  }),
});

// Tenancy: users are global, workspaces (one per org) own every other row. Child tables (messages, tool_calls,
// knowledge_chunks, stops) inherit their workspace from the parent row.
// ponytail: shared tables + workspace_id; move a big or isolated tenant to its own Turso database when SQLite's single writer becomes the ceiling (ids are global, so a workspace copies out as-is).
// These tables' unique keys include workspace_id; existing databases get them rebuilt in init().
const scoped = {
  skills: `(id integer primary key autoincrement, workspace_id text not null default 'default', name text not null,
    description text not null, body text not null, enabled integer not null default 1,
    tools_json text not null default '[]', source text not null default 'user', unique (workspace_id, name))`,
  mcp_servers: `(id text primary key, workspace_id text not null default 'default', name text not null, url text not null,
    headers_json text not null default '{}', enabled integer not null default 1, unique (workspace_id, name))`,
  knowledge_docs: `(id integer primary key autoincrement, workspace_id text not null default 'default', path text not null,
    title text not null, source text not null default 'upload', source_ref text, updated integer not null, unique (workspace_id, path))`,
  settings: `(workspace_id text not null default 'default', key text not null, value text not null, primary key (workspace_id, key))`,
};

const g = globalThis as { __client?: Client; __ready?: Promise<Client> };

// idempotent and safe to run from several cold instances at once (every statement is "if not exists" / "or ignore")
async function init() {
  // Vercel's filesystem is read-only and per-instance: a local SQLite file can't work there
  if (!REMOTE && process.env.VERCEL) throw new Error("No database: add the Turso integration (Vercel → Storage) and redeploy.");
  if (!REMOTE) mkdirSync(dirname(DB_PATH), { recursive: true });
  const c = (g.__client ??= createClient(REMOTE ? { url: REMOTE, authToken: process.env.TURSO_AUTH_TOKEN } : { url: `file:${DB_PATH}` }));
  if (!REMOTE) await c.executeMultiple("pragma journal_mode = WAL; pragma foreign_keys = ON;");
  await c.executeMultiple(`
    create table if not exists users (
      id text primary key, email text unique not null collate nocase, name text not null default '',
      pass_hash text not null, token_v integer not null default 0, created integer not null);
    create table if not exists workspaces (id text primary key, name text not null, created integer not null);
    create table if not exists members (
      workspace_id text not null references workspaces(id) on delete cascade,
      user_id text not null references users(id) on delete cascade,
      role text not null default 'member' check (role in ('admin','member')),
      primary key (workspace_id, user_id));
    create index if not exists members_user on members(user_id);
    ${Object.entries(scoped).map(([t, def]) => `create table if not exists ${t} ${def};`).join("\n")}
    create table if not exists threads (
      id text primary key, title text not null, updated integer not null);
    create table if not exists messages (
      thread_id text primary key references threads(id) on delete cascade,
      json text not null);
    create table if not exists agents (
      id text primary key, name text not null, description text not null default '',
      instructions text not null default '', model text not null default '',
      tools_json text not null default '[]', skills_json text not null default '[]');
    create table if not exists runs (
      id text primary key, thread_id text not null, agent_id text, model text not null,
      started integer not null, ms integer not null, input_tokens integer, output_tokens integer,
      status text not null, error text);
    create table if not exists tool_calls (
      id integer primary key autoincrement, run_id text not null references runs(id) on delete cascade,
      name text not null, input text, output text, ms integer, error text);
    create table if not exists approvals (
      id integer primary key autoincrement, approval_id text unique not null, run_id text, decided_run text,
      thread_id text not null, agent_id text, tool text not null, input text,
      decision text not null default 'pending', automatic integer not null default 0, reason text,
      requested integer not null, decided integer);
    create table if not exists knowledge_chunks (
      id integer primary key autoincrement, doc_id integer not null references knowledge_docs(id) on delete cascade,
      hash text not null, text text not null, vec F32_BLOB(512), embed_model text);
    create index if not exists knowledge_chunks_doc on knowledge_chunks(doc_id);
    create virtual table if not exists knowledge_fts using fts5(text);
    create trigger if not exists knowledge_chunks_ad after delete on knowledge_chunks
      begin delete from knowledge_fts where rowid = old.id; end;
    create index if not exists runs_started on runs(started desc);
    create table if not exists login_misses (t integer not null);
    create table if not exists guest_signups (t integer not null, ip text);
    create table if not exists stops (thread_id text primary key, at integer not null);
    create table if not exists eval_cases (
      id integer primary key autoincrement, workspace_id text not null, agent_id text not null,
      prompt text not null, expect text not null, tool text);
    create table if not exists eval_results (
      id integer primary key autoincrement, workspace_id text not null, user_id text, run_id text not null, agent_id text not null,
      case_id integer not null, prompt text not null, model text not null, started integer not null,
      pass integer not null, reason text not null, answer text not null, ms integer not null, cost real);
    create index if not exists eval_results_agent on eval_results(workspace_id, agent_id, started desc);
  `);
  const cols = async (table: string) => ((await all(c, `pragma table_info(${table})`, [])) as { name: string }[]).map((x) => x.name);
  for (const [table, col, ddl] of [
    ["agents", "mcp_json", "text not null default '[]'"],
    ["skills", "tools_json", "text not null default '[]'"],
    ["skills", "source", "text not null default 'user'"],
    ["threads", "agent_id", "text"],
    ["runs", "cache_read_tokens", "integer"],
    ["runs", "cache_write_tokens", "integer"],
    ["runs", "cost", "real"],
    ["threads", "workspace_id", "text not null default 'default'"],
    ["agents", "workspace_id", "text not null default 'default'"],
    ["runs", "workspace_id", "text not null default 'default'"],
    ["approvals", "workspace_id", "text not null default 'default'"],
    ["stops", "workspace_id", "text not null default 'default'"],
    ["login_misses", "email", "text"],
    ["login_misses", "ip", "text"],
    ["threads", "user_id", "text"],
    ["runs", "user_id", "text"],
    ["approvals", "user_id", "text"],
    ["eval_results", "user_id", "text"],
  ])
    if (!(await cols(table)).includes(col)) await c.execute(`alter table ${table} add column ${col} ${ddl}`).catch(() => {}); // lost a race: the column exists now
  // single-tenant databases: rebuild with workspace-scoped unique keys; every existing row lands in the first workspace.
  // migrate() turns foreign keys off, so dropping knowledge_docs doesn't cascade into its chunks.
  for (const [table, def] of Object.entries(scoped)) {
    const old = await cols(table);
    if (old.includes("workspace_id")) continue;
    const list = old.join(",");
    await c.migrate([`create table ${table}_ws ${def}`, `insert into ${table}_ws (${list}) select ${list} from ${table}`, `drop table ${table}`, `alter table ${table}_ws rename to ${table}`])
      .catch(async (e) => { if (!(await cols(table)).includes("workspace_id")) throw e; }); // lost a race: another instance rebuilt it
  }
  await c.executeMultiple(`
    create index if not exists threads_ws on threads(workspace_id, updated desc);
    create index if not exists runs_ws on runs(workspace_id, started desc);
    create index if not exists approvals_ws on approvals(workspace_id, decision);
    create index if not exists agents_ws on agents(workspace_id);
    create index if not exists threads_user on threads(workspace_id, user_id, updated desc);
    create index if not exists runs_user on runs(workspace_id, user_id, started desc);
    create index if not exists approvals_user on approvals(workspace_id, user_id, decision);
  `);
  // chats from before ownership go to the workspace's first member (its original owner); a workspace without members yet is
  // retried on the next start
  const first = (t: string) => `(select m.user_id from members m where m.workspace_id=${t}.workspace_id order by m.rowid limit 1)`;
  await c.execute(`update threads set user_id=${first("threads")} where user_id is null`);
  // runs and approvals follow their chat's owner; a deleted chat's go to the first member too
  for (const t of ["runs", "approvals"])
    await c.execute(`update ${t} set user_id=coalesce((select th.user_id from threads th where th.id=${t}.thread_id), ${first(t)}) where user_id is null`);
  await c.execute({ sql: "insert or ignore into workspaces (id, name, created) values ('default', 'Default', ?)", args: [Date.now()] });
  // encrypt credentials saved before encryption existed
  for (const r of (await all(c, "select key, value from settings where key in ('api_key','openai_key','github_token')", [])) as { key: string; value: string }[])
    if (!isSealed(r.value)) await c.execute({ sql: "update settings set value=? where key=?", args: [seal(r.value), r.key] });
  for (const r of (await all(c, "select id, headers_json h from mcp_servers where headers_json != '{}'", [])) as { id: string; h: string }[])
    if (!isSealed(r.h)) await c.execute({ sql: "update mcp_servers set headers_json=? where id=?", args: [seal(r.h), r.id] });
  if (!((await all(c, "select count(*) c from skills", []))[0] as { c: number }).c)
    await c.execute({
      sql: "insert or ignore into skills (name, description, body) values (?,?,?)",
      args: ["concise-writer", "Use when the user asks for a summary, rewrite, or short answer.", "Answer in at most 3 sentences. No preamble, no bullet lists, no closing offers."],
    });
  if (!((await all(c, "select count(*) c from agents", []))[0] as { c: number }).c)
    await c.execute({
      sql: "insert or ignore into agents (id,name,description,instructions,tools_json,skills_json) values (?,?,?,?,?,?)",
      args: ["assistant", "Assistant", "General-purpose helper. Start here.", "You are a helpful, concise assistant.", JSON.stringify(["getTime", "calculate", "fetchUrl"]), "[]"],
    });
  return c;
}

// ponytail: one shared client + setup promise per instance (survives Next dev hot reload); a failed setup is retried on the next call
const ready = () => (g.__ready ??= init().catch((e) => { g.__ready = undefined; throw e; }));

export const db = {
  prepare: (sql: string) => ({
    all: async (...a: Args) => all(await ready(), sql, a) as Promise<unknown[]>,
    get: async (...a: Args) => (await all(await ready(), sql, a))[0] as unknown,
    run: async (...a: Args) => run(await ready(), sql, a),
  }),
  /** Several statements in one round trip, atomically. */
  batch: async (stmts: [sql: string, ...args: Args][]) => void (await (await ready()).batch(stmts.map(([sql, ...a]) => stmt(sql, a)), "write")),
  /** Interactive transaction: statements may depend on earlier results. Rolls back if `fn` throws. */
  tx: async <T,>(fn: (t: ReturnType<typeof api>) => Promise<T>) => {
    const t = await (await ready()).transaction("write");
    try {
      const out = await fn(api(t));
      await t.commit();
      return out;
    } catch (e) {
      await t.rollback().catch(() => {});
      throw e;
    } finally {
      t.close();
    }
  },
};

export const DEFAULT_WS = "default";
const scope = new AsyncLocalStorage<string>();
/** Runs `fn` as workspace `id`: background jobs and tests, which have no request to read a session from. */
export const inWorkspace = <T,>(id: string, fn: () => T) => scope.run(id, fn);
export const workspaceScope = scope;
const users = new AsyncLocalStorage<string>();
/** Runs `fn` as user `uid`, for the same reasons as inWorkspace(). */
export const asUser = <T,>(uid: string, fn: () => T) => users.run(uid, fn);
export const userScope = users;

export type Session = { uid: string; workspace: string; role: "admin" | "member" };
const checked = new Map<string, { s: Session | null; at: number }>();
/**
 * The member behind a session token, or null: the signature must hold, the user must still be a member of the
 * workspace, and token_v must match (bump it to sign a user out everywhere).
 */
export async function sessionFor(token: string | undefined): Promise<Session | null> {
  const t = parseToken(token);
  if (!t) return null;
  // ponytail: per-instance 10s memo, so a page's many queries cost one lookup; revocation lands within 10s
  const hit = checked.get(token!);
  if (hit && Date.now() - hit.at < 10_000) return hit.s;
  const row = (await db.prepare(
    "select m.role from users u join members m on m.user_id=u.id where u.id=? and u.token_v=? and m.workspace_id=?",
  ).get(t.uid, t.tokenV, t.workspace)) as { role: Session["role"] } | undefined;
  const s = row ? { uid: t.uid, workspace: t.workspace, role: row.role } : null;
  if (checked.size > 1000) checked.clear();
  checked.set(token!, { s, at: Date.now() });
  return s;
}
export const session = async () => sessionFor((await cookies()).get(COOKIE)?.value);
/** For route handlers. */
export const requestSession = (req: Request) => sessionFor(cookieToken(req));

/** Call first in every server action: the proxy only checks the signature. */
export async function requireAuth() {
  const s = await session();
  if (!s) redirect("/login");
  return s;
}
/** Workspace-wide config (API keys, model, MCP servers and their trust, deleting every chat) is for admins. */
export async function requireAdmin() {
  const s = await requireAuth();
  if (s.role !== "admin") throw new Error("Only a workspace admin can change this.");
  return s;
}
/** DEMO=1: guests (and any other member) can chat but not change what everyone shares. */
export const readOnly = (s: Session) => !!process.env.DEMO && s.role === "member";
/** For actions that change shared agents, skills or Knowledge. */
export async function requireEditor() {
  const s = await requireAuth();
  if (readOnly(s)) throw new Error("The demo is read-only. Clone the repo to edit.");
  return s;
}
export const isAdmin = async () => (await session())?.role === "admin";

let dummy: string | undefined;
/** The user and their first workspace if the password matches. Unknown emails cost the same scrypt, so timing doesn't reveal who has an account. */
export async function signIn(email: string, password: string) {
  const u = (await db.prepare(
    "select u.id, u.pass_hash, u.token_v, m.workspace_id from users u join members m on m.user_id=u.id where u.email=? order by m.rowid limit 1",
  ).get(email.trim())) as { id: string; pass_hash: string; token_v: number; workspace_id: string } | undefined;
  const ok = checkPassword(password, u?.pass_hash ?? (dummy ??= hashPassword("")));
  return u && ok ? { uid: u.id, workspace: u.workspace_id, tokenV: u.token_v } : null;
}
/**
 * Replaces the password if `current` matches, and bumps token_v so every session (on every device) is signed out.
 * Returns the new token_v, or null when the current password is wrong.
 */
export async function changePassword(uid: string, current: string, next: string) {
  const u = (await db.prepare("select pass_hash from users where id=?").get(uid)) as { pass_hash: string } | undefined;
  if (!u || !checkPassword(current, u.pass_hash)) return null;
  const r = (await db.prepare("update users set pass_hash=?, token_v=token_v+1 where id=? returning token_v").get(hashPassword(next), uid)) as { token_v: number };
  checked.clear(); // this instance drops old sessions now; others within the 10s memo
  return r.token_v;
}
export const hasUsers = async () => !!(await db.prepare("select 1 from users limit 1").get());

/** First-run setup: the first account, admin of the default workspace. Null once anyone has an account (checked inside the write, so two visitors racing a fresh deploy can't both get in). */
export async function createFirstAdmin(email: string, password: string) {
  email = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+$/.test(email)) return null;
  const id = crypto.randomUUID();
  // one atomic batch: the insert itself checks for users, so a second, racing setup inserts nothing
  await db.batch([
    ["insert into users (id, email, pass_hash, created) select ?,?,?,? where not exists (select 1 from users)", id, email, hashPassword(password), Date.now()],
    ["insert into members (workspace_id, user_id, role) select ?,?,'admin' where exists (select 1 from users where id=?)", DEFAULT_WS, id, id],
  ]);
  return (await db.prepare("select 1 from users where id=?").get(id)) ? { uid: id, workspace: DEFAULT_WS, tokenV: 0 } : null;
}

// DEMO=1: "Try the demo" makes a member per visitor, so each one's chats stay private. Signups are capped per IP and per day,
// or new guests would walk around USER_DAILY_BUDGET_USD.
// ponytail: guest rows are never cleaned up; delete old @demo.invalid users when they pile up
const GUESTS_PER_IP_HOUR = 3;
export const demoOn = () => !!process.env.DEMO && !!Number(process.env.DAILY_BUDGET_USD) && !!Number(process.env.USER_DAILY_BUDGET_USD);
export async function addGuest(ip: string | null) {
  const now = Date.now();
  const n = (await db.prepare(
    "select count(*) filter (where ip=@ip and t>=@hour) ip, count(*) filter (where t>=@day) day from guest_signups",
  ).get({ ip, hour: now - 3600_000, day: now - 86400_000 })) as { ip: number; day: number };
  if (n.ip >= GUESTS_PER_IP_HOUR || n.day >= (Number(process.env.DEMO_GUESTS_PER_DAY) || 200)) return null;
  const id = crypto.randomUUID();
  await db.batch([
    ["insert into guest_signups (t, ip) values (?,?)", now, ip],
    ["insert into users (id, email, pass_hash, created) values (?,?,?,?)", id, `guest-${id.slice(0, 8)}@demo.invalid`, hashPassword(newPassword()), now],
    ["insert into members (workspace_id, user_id, role) values (?,?,'member')", DEFAULT_WS, id],
  ]);
  return { uid: id, workspace: DEFAULT_WS, tokenV: 0 };
}

// Members (Settings → Members, scripts/user.mts). There is no workspace switcher, so an account belongs to one workspace:
// an admin can't add, or reset the password of, someone who is also in another org.
export type Member = { id: string; email: string; role: Session["role"]; others: number };
export const listMembers = async (workspace: string) =>
  (await db.prepare(
    "select u.id, u.email, m.role, (select count(*) from members o where o.user_id=u.id and o.workspace_id!=m.workspace_id) others from members m join users u on u.id=m.user_id where m.workspace_id=? order by m.rowid",
  ).all(workspace)) as Member[];
const newPassword = () => randomBytes(12).toString("base64url");

/** Creates the account and returns its generated password (shown once), or an error for the admin. */
export async function addMember(workspace: string, email: string, role: Session["role"]): Promise<{ password: string } | { error: string }> {
  email = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+$/.test(email)) return { error: "That isn't an email address." };
  if (await db.prepare("select 1 from users where email=?").get(email)) return { error: `${email} already has an account.` };
  const id = crypto.randomUUID();
  const password = newPassword();
  await db.batch([
    ["insert into users (id, email, pass_hash, created) values (?,?,?,?)", id, email, hashPassword(password), Date.now()],
    ["insert into members (workspace_id, user_id, role) values (?,?,?)", workspace, id, role],
  ]);
  return { password };
}

// how many other workspaces a member is also in; undefined if they aren't in this one
const membership = async (workspace: string, uid: string) =>
  (await db.prepare("select (select count(*) from members o where o.user_id=m.user_id and o.workspace_id!=m.workspace_id) others from members m where m.workspace_id=? and m.user_id=?").get(workspace, uid)) as { others: number } | undefined;
const lastAdmin = async (workspace: string, uid: string) =>
  !(await db.prepare("select 1 from members where workspace_id=? and role='admin' and user_id!=?").get(workspace, uid));

/** Changes a member's role; the workspace always keeps one admin. */
export async function setMemberRole(workspace: string, uid: string, role: Session["role"]) {
  if (role === "member" && (await lastAdmin(workspace, uid))) return { error: "A workspace needs at least one admin." };
  await db.prepare("update members set role=? where workspace_id=? and user_id=?").run(role, workspace, uid);
  checked.clear();
  return {};
}

/** Removes the member and their account (which is only ever in this workspace). Their chats, runs and approvals stay as history. */
export async function removeMember(workspace: string, uid: string) {
  if (await lastAdmin(workspace, uid)) return { error: "A workspace needs at least one admin." };
  const m = await membership(workspace, uid);
  if (!m) return { error: "Not a member." };
  await db.batch([
    ["delete from members where workspace_id=? and user_id=?", workspace, uid],
    ...(m.others ? [] : [["delete from users where id=?", uid] as [string, ...unknown[]]]),
  ]);
  checked.clear();
  return {};
}

/** Sets a generated password (shown once) and signs the member out everywhere. */
export async function resetMemberPassword(workspace: string, uid: string): Promise<{ password: string } | { error: string }> {
  const m = await membership(workspace, uid);
  if (!m) return { error: "Not a member." };
  if (m.others) return { error: "This account is also in another workspace; reset it there or with the CLI." };
  const password = newPassword();
  await db.prepare("update users set pass_hash=?, token_v=token_v+1 where id=?").run(hashPassword(password), uid);
  checked.clear();
  return { password };
}

/**
 * The workspace every query is scoped to: an inWorkspace() scope, else the signed-in session's. A request whose session
 * is no longer valid (signed out elsewhere, removed from the workspace) goes to /login; outside a request it throws.
 * Either way a query never falls back to another org's rows.
 */
export async function ws() {
  const w = scope.getStore() ?? (await session())?.workspace;
  if (!w) redirect("/login");
  return w;
}

/** The user every chat query is scoped to: chats belong to whoever started them. Same fallbacks as ws(). */
export async function me() {
  const u = users.getStore() ?? (await session())?.uid;
  if (!u) redirect("/login");
  return u;
}

/** The env API keys are the owner's: only the first workspace may fall back to them; other orgs bring their own. */
export const envKey = async (name: "ANTHROPIC_API_KEY" | "OPENAI_API_KEY") => ((await ws()) === DEFAULT_WS ? process.env[name] : undefined);

export const getSetting = async (k: string, d = "") =>
  ((await db.prepare("select value from settings where workspace_id=? and key=?").get(await ws(), k)) as { value: string } | undefined)?.value ?? d;
export const setSetting = async (k: string, v: string) =>
  db.prepare("insert into settings (workspace_id,key,value) values (?,?,?) on conflict(workspace_id, key) do update set value=excluded.value").run(await ws(), k, v);

export type Thread = { id: string; title: string; updated: number };
type Skill = { id: number; name: string; description: string; body: string; enabled: number; tools_json: string; source: "user" | "agent" };
export type Agent = { id: string; name: string; description: string; instructions: string; model: string; tools_json: string; skills_json: string; mcp_json: string };
export const listThreads = async () =>
  (await db.prepare("select id, title, updated from threads where workspace_id=? and user_id=? order by updated desc").all(await ws(), await me())) as Thread[];
export const listSkills = async () => (await db.prepare("select * from skills where workspace_id=? order by name").all(await ws())) as Skill[];
export const listAgents = async () => (await db.prepare("select * from agents where workspace_id=? order by name").all(await ws())) as Agent[];
export const getAgent = async (id: string | null | undefined) =>
  id ? ((await db.prepare("select * from agents where id=? and workspace_id=?").get(id, await ws())) as Agent | undefined) : undefined;
export const threadAgentId = async (threadId: string) =>
  ((await db.prepare("select agent_id from threads where id=? and workspace_id=? and user_id=?").get(threadId, await ws(), await me())) as { agent_id: string | null } | undefined)?.agent_id ?? null;

export type McpServer = { id: string; name: string; url: string; headers_json: string; enabled: number };
export const listMcp = async () => (await db.prepare("select * from mcp_servers where workspace_id=? order by name").all(await ws())) as McpServer[];
export type Run = {
  id: string; thread_id: string; agent_id: string | null; model: string; started: number; ms: number;
  input_tokens: number | null; output_tokens: number | null; cache_read_tokens: number | null; cache_write_tokens: number | null;
  cost: number | null; status: string; error: string | null;
  agent?: string | null; calls?: number;
};
export type ToolCall = { id: number; run_id: string; name: string; input: string | null; output: string | null; ms: number | null; error: string | null };
export type Approval = {
  id: number; approval_id: string; run_id: string | null; decided_run: string | null; thread_id: string; agent_id: string | null;
  tool: string; input: string | null; decision: "pending" | "approved" | "denied"; automatic: number; reason: string | null;
  requested: number; decided: number | null; agent?: string | null;
};
