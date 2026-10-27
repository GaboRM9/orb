import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { createClient } from "@libsql/client";

process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "ws-")), "test.db");

it("moves a single-tenant database into the first workspace without losing rows", async () => {
  // the pre-workspace schema, with data
  const old = createClient({ url: `file:${process.env.DB_PATH}` });
  await old.executeMultiple(`
    pragma foreign_keys = ON;
    create table skills (id integer primary key autoincrement, name text unique not null, description text not null, body text not null, enabled integer not null default 1);
    create table settings (key text primary key, value text not null);
    create table knowledge_docs (id integer primary key autoincrement, path text unique not null, title text not null, source text not null default 'upload', source_ref text, updated integer not null);
    create table knowledge_chunks (id integer primary key autoincrement, doc_id integer not null references knowledge_docs(id) on delete cascade, hash text not null, text text not null, vec F32_BLOB(512), embed_model text);
    create table threads (id text primary key, title text not null, updated integer not null);
    insert into skills (name, description, body) values ('mine', 'd', 'b');
    insert into settings values ('model', 'x');
    insert into knowledge_docs (path, title, updated) values ('a.md', 'A', 1);
    insert into knowledge_chunks (doc_id, hash, text) values (1, 'h', 'chunk');
    insert into threads values ('t1', 'T', 1);
  `);
  old.close();

  /* eslint-disable @typescript-eslint/no-require-imports */
  const { db, getSetting, setSetting, workspaceScope } = require("../lib/db") as typeof import("../lib/db");
  workspaceScope.enterWith("default");
  const one = async (sql: string) => (await db.prepare(sql).get()) as Record<string, unknown>;

  assert.deepEqual(await one("select workspace_id, name from skills where name='mine'"), { workspace_id: "default", name: "mine" });
  assert.equal((await one("select workspace_id from threads")).workspace_id, "default");
  assert.equal((await one("select count(*) n from knowledge_chunks where doc_id=1")).n, 1, "rebuilding docs must not cascade into chunks");
  assert.equal(await getSetting("model"), "x");
  await setSetting("model", "y");
  assert.equal(await getSetting("model"), "y");

  // two workspaces can now hold the same skill name, path and setting key
  await db.prepare("insert into workspaces (id, name, created) values ('acme', 'Acme', 0)").run();
  await db.prepare("insert into skills (workspace_id, name, description, body) values ('acme', 'mine', 'd', 'b')").run();
  await db.prepare("insert into knowledge_docs (workspace_id, path, title, updated) values ('acme', 'a.md', 'A', 1)").run();
  await db.prepare("insert into settings (workspace_id, key, value) values ('acme', 'model', 'z')").run();
  assert.equal((await one("select count(*) n from skills where name='mine'")).n, 2);
});

it("keeps each workspace's rows to itself", async () => {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const d = require("../lib/db") as typeof import("../lib/db");
  const store = require("../lib/chat-store") as typeof import("../lib/chat-store");
  const k = require("../lib/knowledge") as typeof import("../lib/knowledge");
  const msg = (id: string, text: string) => [{ id, role: "user" as const, parts: [{ type: "text" as const, text }] }];
  delete process.env.OPENAI_API_KEY; // keyword search only: no network
  d.workspaceScope.enterWith("default");

  await d.db.prepare("insert or ignore into workspaces (id, name, created) values ('acme', 'Acme', 0)").run();
  await d.inWorkspace("acme", async () => {
    await store.saveChat("t-acme", msg("m1", "acme secret"));
    await d.setSetting("api_key", "acme-key");
    await d.db.prepare("insert into agents (workspace_id, id, name) values ('acme', 'a-acme', 'Acme agent')").run();
    await k.addDoc("plans/launch.md", "Launch", "acme launch plan");
  });

  assert.ok(!(await d.listThreads()).some((t) => t.id === "t-acme"));
  assert.equal(await d.getAgent("a-acme"), undefined);
  assert.deepEqual(await store.loadChat("t-acme"), []);
  assert.notEqual(await d.getSetting("api_key"), "acme-key");
  assert.equal((await k.search("launch")).length, 0);
  assert.equal((await d.inWorkspace("acme", () => k.search("launch"))).length, 1);

  // knowing another workspace's thread id doesn't let you write into it
  await store.saveChat("t-acme", msg("m2", "overwrite"));
  assert.equal((await d.inWorkspace("acme", () => store.loadChat("t-acme")))[0].id, "m1");

  // the env API keys belong to the first workspace only
  process.env.OPENAI_API_KEY = "sk-owner";
  assert.equal(await d.envKey("OPENAI_API_KEY"), "sk-owner");
  assert.equal(await d.inWorkspace("acme", () => d.envKey("OPENAI_API_KEY")), undefined);
  delete process.env.OPENAI_API_KEY;

  // no workspace, no query
  await assert.rejects(d.workspaceScope.exit(() => d.listThreads()));
});
