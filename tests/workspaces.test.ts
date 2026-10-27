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
  const { db, getSetting, setSetting } = require("../lib/db") as typeof import("../lib/db");
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
