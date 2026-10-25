import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import { dirname } from "path";

const DB_PATH = process.env.DB_PATH ?? "data/app.db";

// idempotent: safe to re-run on an existing connection (hot reload keeps the old one, so new tables must still be created)
function init(existing?: Database.Database) {
  mkdirSync(dirname(DB_PATH), { recursive: true });
  const db = existing ?? new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON"); // so deleting a thread cascades to its messages
  db.exec(`
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
    create index if not exists runs_started on runs(started desc);
    create table if not exists settings (key text primary key, value text not null);
  `);
  if (!(db.pragma("table_info(agents)") as { name: string }[]).some((c) => c.name === "mcp_json"))
    db.exec("alter table agents add column mcp_json text not null default '[]'");
  if (!(db.pragma("table_info(threads)") as { name: string }[]).some((c) => c.name === "agent_id"))
    db.exec("alter table threads add column agent_id text");
  db.exec("delete from messages where thread_id not in (select id from threads)"); // orphans from before FKs were on
  const n = db.prepare("select count(*) c from skills").get() as { c: number };
  if (!n.c)
    db.prepare("insert into skills (name, description, body) values (?,?,?)").run(
      "concise-writer",
      "Use when the user asks for a summary, rewrite, or short answer.",
      "Answer in at most 3 sentences. No preamble, no bullet lists, no closing offers.",
    );
  if (!(db.prepare("select count(*) c from agents").get() as { c: number }).c) {
    const ins = db.prepare("insert into agents (id,name,description,instructions,tools_json,skills_json) values (?,?,?,?,?,?)");
    ins.run("ada", "Ada", "Research analyst. Fast, factual, shows her math.",
      "You are Ada, a precise research analyst. Verify facts with tools, show calculations, and present results with tables or charts.",
      JSON.stringify(["getTime", "calculate", "fetchUrl"]), JSON.stringify(["concise-writer"]));
    ins.run("milo", "Milo", "Trip planner. Asks questions, builds itineraries.",
      "You are Milo, a friendly trip planner. Collect preferences with a form first, then present plans with timelines, maps and cards.",
      JSON.stringify(["getTime"]), JSON.stringify([]));
  }
  return db;
}

// ponytail: survives Next dev hot reload; sync better-sqlite3 is fine for single-user local use
const g = globalThis as { __db?: Database.Database };
// lazy so parallel `next build` workers importing this module don't race on opening the file
let migrated = false; // per module instance, so a hot-reloaded module re-runs init once
export const db = new Proxy({} as Database.Database, {
  get(_, p) {
    if (!migrated) { g.__db = init(g.__db); migrated = true; }
    const d = g.__db!;
    const v = d[p as keyof Database.Database];
    return typeof v === "function" ? v.bind(d) : v;
  },
});

export const getSetting = (k: string, d = "") =>
  (db.prepare("select value from settings where key=?").get(k) as { value: string } | undefined)?.value ?? d;
export const setSetting = (k: string, v: string) =>
  db.prepare("insert into settings (key,value) values (?,?) on conflict(key) do update set value=excluded.value").run(k, v);

export type Thread = { id: string; title: string; updated: number; agent_id: string | null; agent: string | null };
export type Skill = { id: number; name: string; description: string; body: string; enabled: number };
export type Agent = { id: string; name: string; description: string; instructions: string; model: string; tools_json: string; skills_json: string; mcp_json: string };
export const listThreads = () =>
  db.prepare("select t.*, a.name agent from threads t left join agents a on a.id=t.agent_id order by t.updated desc").all() as Thread[];
export const listSkills = () => db.prepare("select * from skills order by name").all() as Skill[];
export const listAgents = () => db.prepare("select * from agents order by name").all() as Agent[];
export const getAgent = (id: string | null | undefined) =>
  id ? (db.prepare("select * from agents where id=?").get(id) as Agent | undefined) : undefined;
export const threadAgentId = (threadId: string) =>
  (db.prepare("select agent_id from threads where id=?").get(threadId) as { agent_id: string | null } | undefined)?.agent_id ?? null;

export type McpServer = { id: string; name: string; url: string; headers_json: string; enabled: number };
export const listMcp = () => db.prepare("select * from mcp_servers order by name").all() as McpServer[];
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
