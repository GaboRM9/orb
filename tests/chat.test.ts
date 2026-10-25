import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import type { UIMessage } from "ai";

// Temp DB + fake Anthropic API, set up before the app modules are imported.
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "showcase-")), "test.db");
delete process.env.ANTHROPIC_API_KEY;
process.env.ADMIN_PASSWORD = "test-pass";

const seen: { system: string; tools: string[] }[] = [];
const fake = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const b = JSON.parse(body);
    seen.push({ system: JSON.stringify(b.system ?? ""), tools: (b.tools ?? []).map((t: { name: string }) => t.name) });
    const ev = (e: string, d: object) => `event: ${e}\ndata: ${JSON.stringify({ type: e, ...d })}\n\n`;
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end(
      ev("message_start", { message: { id: "msg_1", type: "message", role: "assistant", model: b.model, content: [], stop_reason: null, usage: { input_tokens: 11, output_tokens: 1 } } }) +
        ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } }) +
        ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: "pong" } }) +
        ev("content_block_stop", { index: 0 }) +
        ev("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 7 } }) +
        ev("message_stop", {}),
    );
  });
});

const user = (id: string, text: string): UIMessage => ({ id, role: "user", parts: [{ type: "text", text }] });
const call = (id: string, toolCallId: string, extra: object = {}): UIMessage =>
  ({ id, role: "assistant", parts: [{ type: "tool-askUser", toolCallId, state: "input-available", input: {}, ...extra }] }) as UIMessage;

let store: typeof import("../lib/chat-store");
let dbm: typeof import("../lib/db");
let runs: typeof import("../lib/runs");
let net: typeof import("../lib/net-safe");
let route: typeof import("../app/api/chat/route");
let auth: typeof import("../lib/auth");

before(async () => {
  await new Promise<void>((r) => fake.listen(0, r));
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(fake.address() as AddressInfo).port}/v1`;
  [store, dbm, runs, net, route, auth] = await Promise.all([
    import("../lib/chat-store"), import("../lib/db"), import("../lib/runs"), import("../lib/net-safe"), import("../app/api/chat/route"), import("../lib/auth"),
  ]);
});
after(() => fake.close());

const post = (body: object, cookie = `${auth.COOKIE}=${auth.makeToken()}`) =>
  route.POST(new Request("http://x/api/chat", { method: "POST", headers: { cookie }, body: JSON.stringify(body) }));

describe("mergeMessage", () => {
  it("appends a new message", () => {
    assert.equal(store.mergeMessage([user("u1", "hi")], user("u2", "yo")).length, 2);
  });
  it("replaces a resubmitted assistant message by id", () => {
    const out = store.mergeMessage([user("u1", "hi"), call("a1", "t1")], call("a1", "t1", { state: "output-available" }));
    assert.equal(out.length, 2);
  });
  it("replaces by shared tool call id even when ids differ (the duplicate tool_use bug)", () => {
    const out = store.mergeMessage([user("u1", "hi"), call("", "t1")], call("msg_client", "t1", { state: "output-available" }));
    assert.equal(out.length, 2);
    assert.equal(out[1].id, "msg_client");
  });
});

describe("loadChat", () => {
  it("drops stale duplicates already in the database", () => {
    store.saveChat("dup", [user("u1", "hi"), call("", "t1"), call("a2", "t1", { state: "output-available" })]);
    assert.equal(store.loadChat("dup").length, 2);
  });
});

describe("fetch guard", () => {
  it("flags private, loopback, metadata and mapped IPv6 addresses", () => {
    for (const ip of ["127.0.0.1", "10.0.0.1", "172.16.0.1", "192.168.1.1", "169.254.169.254", "::1", "fe80::1", "::ffff:7f00:1", "::ffff:10.0.0.1"])
      assert.equal(net.isPrivateAddress(ip), true, ip);
    for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "2606:4700:4700::1111", "::ffff:808:808"])
      assert.equal(net.isPrivateAddress(ip), false, ip);
  });
  it("refuses localhost and non-http schemes", async () => {
    await assert.rejects(net.assertPublicUrl("http://localhost:3000"));
    await assert.rejects(net.assertPublicUrl("http://169.254.169.254/latest/meta-data"));
    await assert.rejects(net.assertPublicUrl("file:///etc/passwd"));
  });
});

describe("approval log", () => {
  const part = (approval: object) => ({ id: "a", role: "assistant", parts: [{ type: "tool-fetchUrl", input: { url: "https://example.com" }, approval }] }) as unknown as UIMessage;
  it("records a request once, then applies the decision once", () => {
    runs.syncApprovals("r1", "th", "ada", part({ id: "ap1" }));
    runs.syncApprovals("r1", "th", "ada", part({ id: "ap1" })); // same message synced twice
    assert.equal(runs.listApprovals().filter((a) => a.approval_id === "ap1").length, 1);
    assert.equal(runs.listApprovals(undefined, "pending").length, 1);

    runs.syncApprovals("r2", "th", "ada", part({ id: "ap1", approved: false, reason: "no" }));
    runs.syncApprovals("r3", "th", "ada", part({ id: "ap1", approved: true })); // a later flip must not rewrite history
    const row = runs.listApprovals().find((a) => a.approval_id === "ap1")!;
    assert.equal(row.decision, "denied");
    assert.equal(row.decided_run, "r2");
    assert.equal(row.tool, "fetchUrl");
  });
});

describe("run summary", () => {
  const run = (id: string, started: number, status: "ok" | "error") => runs.logRun({ id, threadId: "th", model: "m", started, status, calls: [] });
  it("counts today's runs and errors, skips older ones, and counts pending approvals", () => {
    const base = runs.runSummary();
    run("s1", Date.now(), "ok");
    run("s2", Date.now(), "error");
    run("s3", Date.now() - 2 * 86_400_000, "error"); // two days ago: not "today"
    runs.syncApprovals("s1", "th", "ada", { id: "m", role: "assistant", parts: [{ type: "tool-fetchUrl", input: { url: "https://example.com" }, approval: { id: "ap-summary" } }] } as unknown as UIMessage);
    const now = runs.runSummary();
    assert.equal(now.runs - base.runs, 2);
    assert.equal(now.errors - base.errors, 1);
    assert.equal(now.pending - base.pending, 1);
  });
});

describe("POST /api/chat", () => {
  it("asks for an API key when none is set", async () => {
    const res = await post({ id: "t0", message: user("u1", "hi") });
    assert.equal(res.status, 400);
  });

  it("runs the agent: its instructions and tools only, saves the thread, logs the run", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const res = await post({ id: "t1", agentId: "ada", message: user("u1", "ping") });
    assert.equal(res.status, 200);
    await res.text(); // consume the stream so onEnd handlers run

    const sent = seen.at(-1)!;
    assert.match(sent.system, /precise research analyst/);
    assert.ok(sent.tools.includes("calculate") && sent.tools.includes("fetchUrl"));
    assert.ok(!sent.tools.includes("searchThreads"), "tools outside the agent's list must not be offered");

    assert.equal(store.loadChat("t1").length, 2);
    assert.equal((dbm.db.prepare("select agent_id from threads where id='t1'").get() as { agent_id: string }).agent_id, "ada");
    const run = dbm.db.prepare("select * from runs where thread_id='t1'").get() as { status: string; input_tokens: number; output_tokens: number };
    assert.equal(run.status, "ok");
    assert.equal(run.input_tokens, 11);
    assert.equal(run.output_tokens, 7); // message_delta reports the cumulative output count
  });

  it("keeps the thread's agent on later turns even if the client omits it", async () => {
    const res = await post({ id: "t1", message: user("u2", "again") });
    await res.text();
    assert.match(seen.at(-1)!.system, /precise research analyst/);
    assert.equal(store.loadChat("t1").length, 4);
  });
});

describe("auth", () => {
  it("rejects chat requests without a valid session", async () => {
    assert.equal((await post({ id: "a", message: {} }, "")).status, 401);
    assert.equal((await post({ id: "a", message: {} }, `${auth.COOKIE}=${auth.makeToken()}x`)).status, 401);
  });
  it("accepts only the right password, and fails closed when none is set", () => {
    assert.ok(auth.passwordOk("test-pass"));
    assert.ok(!auth.passwordOk("nope"));
    const [exp] = auth.makeToken().split(".");
    assert.ok(!auth.verifyToken(`${exp}.forged`));
    assert.ok(!auth.verifyToken(`1.${auth.makeToken().split(".")[1]}`)); // expired
    const saved = process.env.ADMIN_PASSWORD;
    delete process.env.ADMIN_PASSWORD;
    assert.ok(!auth.verifyToken(auth.makeToken()));
    process.env.ADMIN_PASSWORD = saved;
  });
});
