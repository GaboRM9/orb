import { createClient, type Client, type InStatement, type Transaction } from "@libsql/client";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
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

const g = globalThis as { __client?: Client; __ready?: Promise<Client> };

// idempotent and safe to run from several cold instances at once (every statement is "if not exists" / "or ignore")
async function init() {
  if (!REMOTE) mkdirSync(dirname(DB_PATH), { recursive: true });
  const c = (g.__client ??= createClient(REMOTE ? { url: REMOTE, authToken: process.env.TURSO_AUTH_TOKEN } : { url: `file:${DB_PATH}` }));
  if (!REMOTE) await c.executeMultiple("pragma journal_mode = WAL; pragma foreign_keys = ON;");
  await c.executeMultiple(`
    create table if not exists threads (
      id text primary key, title text not null, updated integer not null);
    create table if not exists messages (
      thread_id text primary key references threads(id) on delete cascade,
      json text not null);
    create table if not exists skills (
      id integer primary key autoincrement, name text unique not null,
      description text not null, body text not null, enabled integer not null default 1);
    create table if not exists agents (
      id text primary key, name text not null, description text not null default '',
      instructions text not null default '', model text not null default '',
      tools_json text not null default '[]', skills_json text not null default '[]');
    create table if not exists mcp_servers (
      id text primary key, name text unique not null, url text not null,
      headers_json text not null default '{}', enabled integer not null default 1);
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
    create table if not exists knowledge_docs (
      id integer primary key autoincrement, path text unique not null, title text not null,
      source text not null default 'upload', source_ref text, updated integer not null);
    create table if not exists knowledge_chunks (
      id integer primary key autoincrement, doc_id integer not null references knowledge_docs(id) on delete cascade,
      hash text not null, text text not null, vec F32_BLOB(512), embed_model text);
    create index if not exists knowledge_chunks_doc on knowledge_chunks(doc_id);
    create virtual table if not exists knowledge_fts using fts5(text);
    create trigger if not exists knowledge_chunks_ad after delete on knowledge_chunks
      begin delete from knowledge_fts where rowid = old.id; end;
    create index if not exists runs_started on runs(started desc);
    create table if not exists settings (key text primary key, value text not null);
    create table if not exists login_misses (t integer not null);
  `);
  const cols = async (table: string) => ((await all(c, `pragma table_info(${table})`, [])) as { name: string }[]).map((x) => x.name);
  for (const [table, col, ddl] of [
    ["agents", "mcp_json", "text not null default '[]'"],
    ["skills", "tools_json", "text not null default '[]'"],
    ["skills", "source", "text not null default 'user'"],
    ["threads", "agent_id", "text"],
  ])
    if (!(await cols(table)).includes(col)) await c.execute(`alter table ${table} add column ${col} ${ddl}`).catch(() => {}); // lost a race: the column exists now
  // encrypt credentials saved before encryption existed
  for (const r of (await all(c, "select key, value from settings where key in ('api_key','openai_key')", [])) as { key: string; value: string }[])
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
      args: ["assistant", "Assistant", "General-purpose helper. Start here.", "You are a helpful, concise assistant.", JSON.stringify(["getTime", "calculate"]), "[]"],
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

export const getSetting = async (k: string, d = "") =>
  ((await db.prepare("select value from settings where key=?").get(k)) as { value: string } | undefined)?.value ?? d;
export const setSetting = (k: string, v: string) =>
  db.prepare("insert into settings (key,value) values (?,?) on conflict(key) do update set value=excluded.value").run(k, v);

export type Thread = { id: string; title: string; updated: number };
type Skill = { id: number; name: string; description: string; body: string; enabled: number; tools_json: string; source: "user" | "agent" };
export type Agent = { id: string; name: string; description: string; instructions: string; model: string; tools_json: string; skills_json: string; mcp_json: string };
export const listThreads = async () =>
  (await db.prepare("select id, title, updated from threads order by updated desc").all()) as Thread[];
export const listSkills = async () => (await db.prepare("select * from skills order by name").all()) as Skill[];
export const listAgents = async () => (await db.prepare("select * from agents order by name").all()) as Agent[];
export const getAgent = async (id: string | null | undefined) =>
  id ? ((await db.prepare("select * from agents where id=?").get(id)) as Agent | undefined) : undefined;
export const threadAgentId = async (threadId: string) =>
  ((await db.prepare("select agent_id from threads where id=?").get(threadId)) as { agent_id: string | null } | undefined)?.agent_id ?? null;

export type McpServer = { id: string; name: string; url: string; headers_json: string; enabled: number };
export const listMcp = async () => (await db.prepare("select * from mcp_servers order by name").all()) as McpServer[];
export type Run = {
  id: string; thread_id: string; agent_id: string | null; model: string; started: number; ms: number;
  input_tokens: number | null; output_tokens: number | null; status: string; error: string | null;
  agent?: string | null; calls?: number;
};
export type ToolCall = { id: number; run_id: string; name: string; input: string | null; output: string | null; ms: number | null; error: string | null };
export type Approval = {
  id: number; approval_id: string; run_id: string | null; decided_run: string | null; thread_id: string; agent_id: string | null;
  tool: string; input: string | null; decision: "pending" | "approved" | "denied"; automatic: number; reason: string | null;
  requested: number; decided: number | null; agent?: string | null;
};
