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

const seen: { system: string; tools: string[]; messages: string }[] = [];
const fake = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const b = JSON.parse(body);
    seen.push({ system: JSON.stringify(b.system ?? ""), tools: (b.tools ?? []).map((t: { name: string }) => t.name), messages: JSON.stringify(b.messages) });
    const ev = (e: string, d: object) => `event: ${e}\ndata: ${JSON.stringify({ type: e, ...d })}\n\n`;
    res.writeHead(200, { "content-type": "text/event-stream" });
    const start = ev("message_start", { message: { id: "msg_1", type: "message", role: "assistant", model: b.model, content: [], stop_reason: null, usage: { input_tokens: 11, output_tokens: 1 } } });
    const rest =
      ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } }) +
      ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: "pong" } }) +
      ev("content_block_stop", { index: 0 }) +
      ev("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 7 } }) +
      ev("message_stop", {});
    if (body.includes("twostep") && !body.includes("tool_result")) // first step: call a tool that needs no approval
      return res.end(start +
        ev("content_block_start", { index: 0, content_block: { type: "tool_use", id: "toolu_1", name: "getTime", input: {} } }) +
        ev("content_block_delta", { index: 0, delta: { type: "input_json_delta", partial_json: "{}" } }) +
        ev("content_block_stop", { index: 0 }) +
        ev("message_delta", { delta: { stop_reason: "tool_use", stop_sequence: null }, usage: { output_tokens: 7 } }) +
        ev("message_stop", {}));
    const delay = body.includes("sleepy") || body.includes("twostep") ? 3000 : body.includes("slowpoke") ? 150 : 0;
    if (!delay) return res.end(start + rest);
    res.write(start); // a slow model: the client can hang up, or press Stop, mid-answer
    setTimeout(() => res.end(rest), delay).unref();
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
  await dbm.db.prepare("insert into agents (id,name,instructions,tools_json,skills_json) values ('ada','Ada','You are Ada, a precise research analyst.',?,?)")
    .run(JSON.stringify(["getTime", "calculate", "fetchUrl"]), JSON.stringify(["concise-writer"]));
});
after(() => fake.close());

const post = (body: object, cookie = `${auth.COOKIE}=${auth.makeToken()}`) =>
  route.POST(new Request("http://x/api/chat", { method: "POST", headers: { cookie }, body: JSON.stringify(body) }));

describe("mergeMessage", () => {
  it("appends a new message", async () => {
    assert.equal(store.mergeMessage([user("u1", "hi")], user("u2", "yo")).length, 2);
  });
  it("replaces a resubmitted assistant message by id", async () => {
    const out = store.mergeMessage([user("u1", "hi"), call("a1", "t1")], call("a1", "t1", { state: "output-available" }));
    assert.equal(out.length, 2);
  });
  it("replaces by shared tool call id even when ids differ (the duplicate tool_use bug)", async () => {
    const out = store.mergeMessage([user("u1", "hi"), call("", "t1")], call("msg_client", "t1", { state: "output-available" }));
    assert.equal(out.length, 2);
    assert.equal(out[1].id, "msg_client");
  });
});

describe("fitContext", () => {
  const m = (role: "user" | "assistant", text: string) => ({ role, content: [{ type: "text" as const, text }] });
  it("sends a conversation under budget untouched (same array, so the cached prefix holds)", () => {
    const msgs = [m("user", "hi"), m("assistant", "yo")];
    assert.equal(store.fitContext(msgs, 1000), msgs);
  });
  it("drops the oldest turns over budget, cutting at a user message and keeping the latest", () => {
    const msgs = [m("user", "x".repeat(500)), m("assistant", "y".repeat(500)), m("user", "recent"), m("assistant", "ok"), m("user", "now")];
    const out = store.fitContext(msgs, 400);
    assert.equal(out[0].role, "user");
    assert.deepEqual(out.at(-1), msgs.at(-1));
    assert.ok(JSON.stringify(out).length <= 400);
  });
});

describe("runCost", () => {
  it("prices fresh input, cache writes (1.25x), cache reads and output separately", async () => {
    const { runCost } = await import("../lib/models");
    // Opus 5.5: $4 in, $20 out, $0.20 cache read per million
    const cost = runCost("claude-opus-5-5", { inputTokens: 1_300_000, outputTokens: 100_000, inputTokenDetails: { cacheReadTokens: 1_000_000, cacheWriteTokens: 200_000 } });
    assert.ok(Math.abs(cost! - (0.1 * 4 + 0.2 * 5 + 1 * 0.2 + 0.1 * 20)) < 1e-9);
    assert.equal(runCost("some-unknown-model", { inputTokens: 1 }), null);
  });
});

describe("loadChat", () => {
  it("drops stale duplicates already in the database", async () => {
    await store.saveChat("dup", [user("u1", "hi"), call("", "t1"), call("a2", "t1", { state: "output-available" })]);
    assert.equal((await store.loadChat("dup")).length, 2);
  });
});

describe("fetch guard", () => {
  it("flags private, loopback, metadata and mapped IPv6 addresses", async () => {
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
  it("records a request once, then applies the decision once", async () => {
    await runs.syncApprovals("r1", "th", "ada", part({ id: "ap1" }));
    await runs.syncApprovals("r1", "th", "ada", part({ id: "ap1" })); // same message synced twice
    assert.equal((await runs.listApprovals()).filter((a) => a.approval_id === "ap1").length, 1);
    assert.equal((await runs.listApprovals(undefined, "pending")).length, 1);

    await runs.syncApprovals("r2", "th", "ada", part({ id: "ap1", approved: false, reason: "no" }));
    await runs.syncApprovals("r3", "th", "ada", part({ id: "ap1", approved: true })); // a later flip must not rewrite history
    const row = (await runs.listApprovals()).find((a) => a.approval_id === "ap1")!;
    assert.equal(row.decision, "denied");
    assert.equal(row.decided_run, "r2");
    assert.equal(row.tool, "fetchUrl");
  });
});

describe("run summary", () => {
  const run = (id: string, started: number, status: "ok" | "error") => runs.logRun({ id, threadId: "th", model: "m", started, status, calls: [] });
  it("counts today's runs and errors, skips older ones, and counts pending approvals", async () => {
    const base = await runs.runSummary();
    run("s1", Date.now(), "ok");
    run("s2", Date.now(), "error");
    run("s3", Date.now() - 2 * 86_400_000, "error"); // two days ago: not "today"
    await runs.syncApprovals("s1", "th", "ada", { id: "m", role: "assistant", parts: [{ type: "tool-fetchUrl", input: { url: "https://example.com" }, approval: { id: "ap-summary" } }] } as unknown as UIMessage);
    const now = await runs.runSummary();
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

  it("generative UI is a switch: off means no UI tools and no UI rules", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const ask = async (thread: string) => {
      await (await post({ id: thread, message: user(`${thread}-u`, "ping") })).text();
      return seen.at(-1)!;
    };
    let sent = await ask("genui-on");
    assert.ok(sent.tools.includes("answerVerdict") && sent.tools.includes("open_directions"));
    assert.match(sent.system, /How to answer/);
    await dbm.setSetting("gen_ui", "off");
    try {
      sent = await ask("genui-off");
      assert.ok(!sent.tools.some((t) => t.startsWith("answer") || t.startsWith("show") || t.startsWith("open_") || t === "askUser" || t === "choose"));
      assert.ok(sent.tools.includes("getTime"), "ordinary tools stay");
      assert.doesNotMatch(sent.system, /How to answer/);
    } finally {
      await dbm.setSetting("gen_ui", "on");
    }
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
    assert.ok(!sent.tools.includes("createSkill"), "saving skills is opt-in per agent");

    assert.equal((await store.loadChat("t1")).length, 2);
    assert.equal(((await dbm.db.prepare("select agent_id from threads where id='t1'").get()) as { agent_id: string }).agent_id, "ada");
    const run = (await dbm.db.prepare("select * from runs where thread_id='t1'").get()) as { status: string; input_tokens: number; output_tokens: number; cost: number };
    assert.ok(Math.abs(run.cost - (11 * 2 + 7 * 10) / 1e6) < 1e-12, "priced at Sonnet 5.5 rates"); // default model
    assert.equal(run.status, "ok");
    assert.equal(run.input_tokens, 11);
    assert.equal(run.output_tokens, 7); // message_delta reports the cumulative output count
  });

  it("marks the system prompt and the latest message as cache breakpoints", () => {
    assert.match(seen.at(-1)!.system, /cache_control/);
    const msgs = JSON.parse(seen.at(-1)!.messages) as { content: { cache_control?: unknown }[] }[];
    assert.ok(msgs.at(-1)!.content.at(-1)!.cache_control);
  });

  it("finishes and saves the turn even when the client disconnects", async () => {
    const res = await post({ id: "gone", message: user("u1", "slowpoke") });
    await res.body!.cancel(); // tab closed mid-answer
    const reply = async () => JSON.stringify((await store.loadChat("gone"))[1]?.parts ?? []);
    for (let i = 0; i < 50 && !(await reply()).includes("pong"); i++) await new Promise((r) => setTimeout(r, 20));
    assert.match(await reply(), /pong/);
  });

  it("a stopped run still records the tokens and cost of the steps it finished", async () => {
    const res = await post({ id: "halt2", message: user("u1", "twostep") }); // step 1 calls getTime, step 2 stalls
    await new Promise((r) => setTimeout(r, 300));
    await route.DELETE(new Request("http://x/api/chat?id=halt2", { method: "DELETE", headers: { cookie: `${auth.COOKIE}=${auth.makeToken()}` } }));
    await res.text();
    for (let i = 0; i < 50 && !(await dbm.db.prepare("select 1 from runs where thread_id='halt2'").get()); i++) await new Promise((r) => setTimeout(r, 20));
    const run = (await dbm.db.prepare("select status, cost, input_tokens from runs where thread_id='halt2'").get()) as { status: string; cost: number | null; input_tokens: number | null };
    assert.equal(run.status, "aborted");
    assert.equal(run.input_tokens, 11, "step 1's usage counts toward the budget");
    assert.ok(run.cost! > 0);
  });

  it("Stop aborts the run on the server and keeps the thread", async () => {
    const res = await post({ id: "halt", message: user("u1", "sleepy") });
    const stop = await route.DELETE(new Request("http://x/api/chat?id=halt", { method: "DELETE", headers: { cookie: `${auth.COOKIE}=${auth.makeToken()}` } }));
    assert.equal(stop.status, 204);
    const t = Date.now();
    await res.text(); // ends once the poll sees the flag, long before the model's 3 s answer
    assert.ok(Date.now() - t < 2000);
    for (let i = 0; i < 50 && !(await dbm.db.prepare("select 1 from runs where thread_id='halt'").get()); i++) await new Promise((r) => setTimeout(r, 20));
    assert.equal(((await dbm.db.prepare("select status from runs where thread_id='halt'").get()) as { status: string }).status, "aborted");
    assert.equal((await store.loadChat("halt"))[0].role, "user");
  });

  it("refuses new turns once today's budget is spent", async () => {
    process.env.DAILY_BUDGET_USD = "0.00001"; // the runs above already cost more
    const res = await post({ id: "broke", message: user("u1", "hi") });
    delete process.env.DAILY_BUDGET_USD;
    assert.equal(res.status, 429);
  });

  it("keeps the thread's agent on later turns even if the client omits it", async () => {
    const res = await post({ id: "t1", message: user("u2", "again") });
    await res.text();
    assert.match(seen.at(-1)!.system, /precise research analyst/);
    assert.equal((await store.loadChat("t1")).length, 4);
  });
});

describe("auth", () => {
  it("rejects chat requests without a valid session", async () => {
    assert.equal((await post({ id: "a", message: {} }, "")).status, 401);
    assert.equal((await post({ id: "a", message: {} }, `${auth.COOKIE}=${auth.makeToken()}x`)).status, 401);
  });
  it("accepts only the right password, and fails closed when none is set", async () => {
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

  it("on Vercel, requires AUTH_SECRET instead of falling back to the password", () => {
    process.env.VERCEL = "1";
    assert.ok(!auth.authConfigured());
    assert.ok(!auth.passwordOk("test-pass"));
    process.env.AUTH_SECRET = "s3cret";
    assert.ok(auth.authConfigured());
    delete process.env.VERCEL;
    delete process.env.AUTH_SECRET;
  });
});
