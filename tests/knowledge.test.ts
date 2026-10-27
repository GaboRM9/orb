import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, it } from "node:test";

process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "kb-")), "test.db");
process.env.ADMIN_PASSWORD = "test-pass";
process.env.OPENAI_API_KEY = "sk-test";

// Fake embeddings: a 512-dim vector whose "topic" axis is chosen by keyword, so meaning-matches are deterministic.
const topic = (t: string) => (/leave|vacation|time off|holiday/i.test(t) ? 0 : /deploy|release/i.test(t) ? 1 : 2);
let embedCalls = 0;
let embedFails = false;
let short = false;
globalThis.fetch = (async (_url: unknown, init: { body: string }) => {
  if (embedFails) return new Response("no", { status: 500 });
  let { input } = JSON.parse(init.body) as { input: string[] };
  embedCalls += input.length;
  if (short) input = input.slice(1);
  return Response.json({ data: input.map((t, index) => ({ index, embedding: Array.from({ length: 512 }, (_, i) => (i === topic(t) ? 1 : 0)) })) });
}) as typeof fetch;

// require (not import) so env vars above are set first and no top-level await is needed under tsx/cjs
/* eslint-disable @typescript-eslint/no-require-imports */
const { db } = require("../lib/db") as typeof import("../lib/db");
const k = require("../lib/knowledge") as typeof import("../lib/knowledge");
(require("../lib/db") as typeof import("../lib/db")).workspaceScope.enterWith("default");

beforeEach(async () => {
  await db.batch([["delete from knowledge_chunks"], ["delete from knowledge_docs"]]);
  embedCalls = 0;
  embedFails = false;
  short = false;
});

describe("github import", () => {
  it("imports only md/txt files under the folder, as github/<repo>/…", async () => {
    const real = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
      if (url.includes("/git/trees/")) return Response.json({ tree: [
        { path: "docs/a.md", type: "blob", size: 10 }, { path: "docs/img.png", type: "blob", size: 10 }, { path: "src/b.md", type: "blob", size: 10 }] });
      return new Response("hello from " + url.split("/contents/")[1]);
    }) as typeof fetch;
    try {
      const { importGithub } = require("../lib/github") as typeof import("../lib/github");
      assert.equal((await importGithub("o/r", "docs")).n, 1);
      assert.deepEqual((await k.listDocs()).map((d) => d.path), ["github/r/docs/a.md"]);
      await assert.rejects(importGithub("not a repo"));
      await assert.rejects(importGithub("../.."));
    } finally {
      globalThis.fetch = real;
    }
  });
});

describe("knowledge", () => {
  it("chunks on paragraphs and cuts oversized ones", async () => {
    assert.deepEqual(k.chunk("a\n\nb"), ["a\n\nb"]);
    assert.equal(k.chunk("x".repeat(1700)).length, 3);
    assert.equal(k.chunk(("p".repeat(500) + "\n\n").repeat(3)).length, 3);
  });

  it("finds an exact term by keyword", async () => {
    await k.addDoc("ops/errors.md", "errors", "Error E1042 means the token expired.\n\nUnrelated text about lunch.");
    const [hit] = await k.search("E1042");
    assert.match(hit.text, /E1042/);
    assert.equal(hit.path, "ops/errors.md");
  });

  it("finds a paraphrase through the vector side", async () => {
    await k.addDoc("hr/leave.md", "leave", "Employees get 20 days of vacation per year.");
    await k.addDoc("eng/deploy.md", "deploy", "Run the release script on Fridays.");
    const hits = await k.search("how much time off do I get?");
    assert.equal(hits[0].path, "hr/leave.md"); // no shared keyword besides "time off" -> only embeddings link them
  });

  it("restricts to a folder", async () => {
    await k.addDoc("a/one.md", "one", "alpha shared term");
    await k.addDoc("b/two.md", "two", "alpha shared term");
    assert.deepEqual((await k.search("alpha", "b")).map((h) => h.path), ["b/two.md"]);
  });

  it("re-importing unchanged text embeds nothing", async () => {
    await k.addDoc("a.md", "a", "same text");
    await k.embedMissing();
    const first = embedCalls;
    await k.addDoc("a.md", "a", "same text");
    await k.embedMissing();
    assert.equal(embedCalls, first);
  });

  it("embeds a whole batch of docs once, even when asked concurrently", async () => {
    for (let i = 0; i < 10; i++) await k.addDoc(`d${i}.md`, "d", `doc ${i}`);
    await Promise.all([k.embedMissing(), k.embedMissing(), k.embedMissing()]);
    assert.equal(embedCalls, 10);
  });

  it("treats a short embedding response as a failed embed, not a crash", async () => {
    short = true;
    await k.addDoc("a.md", "a", "x");
    await k.embedMissing();
    short = false;
    assert.equal((await k.staleChunks()), 1);
  });

  it("falls back to keywords when embedding fails, then embeds later", async () => {
    embedFails = true;
    await k.addDoc("a.md", "a", "keyword only");
    await k.embedMissing();
    assert.equal((await k.staleChunks()), 1);
    assert.equal((await k.search("keyword")).length, 1);
    embedFails = false;
    await k.embedMissing();
    assert.equal((await k.staleChunks()), 0);
  });

  it("deleting a folder removes its docs, chunks and keyword index", async () => {
    await k.addDoc("x/y/a.md", "a", "findme");
    await k.addDoc("x/b.md", "b", "other");
    await k.deleteFolder("x/y");
    assert.deepEqual((await k.listDocs()).map((d) => d.path), ["x/b.md"]);
    assert.equal(((await db.prepare("select count(*) c from knowledge_fts").get()) as { c: number }).c, 1);
  });
});
