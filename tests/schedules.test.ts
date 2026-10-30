import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "schedules-")), "test.db");
process.env.ANTHROPIC_API_KEY = "test";
process.env.ADMIN_PASSWORD = "test-pass";

// a fake Anthropic API that answers "pong"
const fake = http.createServer((req, res) => {
  req.resume();
  req.on("end", () => {
    const ev = (e: string, d: object) => `event: ${e}\ndata: ${JSON.stringify({ type: e, ...d })}\n\n`;
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end(
      ev("message_start", { message: { id: "msg_1", type: "message", role: "assistant", model: "m", content: [], stop_reason: null, usage: { input_tokens: 5, output_tokens: 1 } } }) +
      ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } }) +
      ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: "pong" } }) +
      ev("content_block_stop", { index: 0 }) +
      ev("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 3 } }) +
      ev("message_stop", {}));
  });
});

let sch: typeof import("../lib/schedules");
let dbm: typeof import("../lib/db");
let store: typeof import("../lib/chat-store");
before(async () => {
  await new Promise<void>((r) => fake.listen(0, r));
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(fake.address() as AddressInfo).port}/v1`;
  [sch, dbm, store] = await Promise.all([import("../lib/schedules"), import("../lib/db"), import("../lib/chat-store")]);
  await dbm.db.prepare("insert into users (id, email, pass_hash, created) values ('u1', 'a@x.test', 'x', 0), ('gone', 'b@x.test', 'x', 0)").run();
  await dbm.db.prepare("insert into members (workspace_id, user_id, role) values ('default', 'u1', 'member')").run();
});
after(() => fake.close());

const at = (iso: string) => Date.parse(iso);
const s = (o: Partial<import("../lib/schedules").Schedule>) =>
  ({ every: "daily", hour: 9, tz: "UTC", created: at("2026-10-01T00:00Z"), last_run: null, ...o }) as import("../lib/schedules").Schedule;

describe("isDue", () => {
  it("fires a daily schedule from its hour on, once a day", () => {
    assert.equal(sch.isDue(s({}), at("2026-10-28T08:59Z")), false);
    assert.equal(sch.isDue(s({}), at("2026-10-28T09:00Z")), true);
    assert.equal(sch.isDue(s({ last_run: at("2026-10-28T09:00Z") }), at("2026-10-28T10:00Z")), false, "already ran today");
    assert.equal(sch.isDue(s({ last_run: at("2026-10-27T09:00Z") }), at("2026-10-28T15:00Z")), true, "a missed tick catches up");
  });
  it("starts tomorrow when made after today's hour", () => {
    assert.equal(sch.isDue(s({ created: at("2026-10-28T15:00Z") }), at("2026-10-28T16:00Z")), false);
    assert.equal(sch.isDue(s({ created: at("2026-10-28T15:00Z") }), at("2026-10-29T09:00Z")), true);
  });
  it("reads the hour in the schedule's timezone", () => {
    const ny = s({ tz: "America/New_York" }); // 9:00 in New York is 13:00 UTC in October (EDT)
    assert.equal(sch.isDue(ny, at("2026-10-28T12:30Z")), false);
    assert.equal(sch.isDue(ny, at("2026-10-28T13:00Z")), true);
  });
  it("skips weekends for weekdays", () => {
    assert.equal(sch.isDue(s({ every: "weekdays" }), at("2026-10-31T09:00Z")), false, "Saturday");
    assert.equal(sch.isDue(s({ every: "weekdays" }), at("2026-11-02T09:00Z")), true, "Monday");
  });
  it("fires hourly once per clock hour", () => {
    const h = s({ every: "hourly", last_run: at("2026-10-28T09:00Z") });
    assert.equal(sch.isDue(h, at("2026-10-28T09:59Z")), false);
    assert.equal(sch.isDue(h, at("2026-10-28T10:00Z")), true);
  });
});

describe("runDue", () => {
  it("runs a due schedule as its creator into a new chat, once, and skips one whose creator left", async () => {
    const row = (id: string, user: string) => dbm.db.prepare(
      "insert into schedules (id,workspace_id,user_id,agent_id,prompt,every,hour,tz,created) values (?,'default',?,'assistant','ping','hourly',0,'UTC',?)",
    ).run(id, user, at("2026-10-28T08:00Z"));
    await row("s1", "u1");
    await row("s2", "gone");
    const now = at("2026-10-28T09:00Z");
    assert.equal(await sch.runDue(now), 1);
    assert.equal(await sch.runDue(now), 0, "not twice in the same hour");
    const got = (await dbm.db.prepare("select * from schedules where id='s1'").get()) as import("../lib/schedules").Schedule;
    assert.equal(got.last_error, null);
    assert.ok(got.last_thread);
    const chat = await dbm.inWorkspace("default", () => dbm.asUser("u1", () => store.loadChat(got.last_thread!)));
    assert.equal(chat.length, 2);
    assert.match(JSON.stringify(chat[1]), /pong/);
  });
});

describe("waitingApprovals", () => {
  it("lists pending approvals from a chat's latest run only", async () => {
    const runs = await import("../lib/runs");
    const ins = (sql: string, ...a: unknown[]) => dbm.db.prepare(sql).run(...a);
    await ins("insert into threads (id,title,updated,workspace_id,user_id) values ('t1','Chat',0,'default','u1')");
    await ins("insert into runs (id,thread_id,model,started,ms,status,workspace_id,user_id) values ('r1','t1','m',1,0,'ok','default','u1'), ('r2','t1','m',2,0,'ok','default','u1')");
    const ap = (id: string, run: string) => ins("insert into approvals (approval_id,run_id,thread_id,tool,requested,workspace_id,user_id) values (?,?,'t1','fetchUrl',0,'default','u1')", id, run);
    await ap("old", "r1"); // the user sent another message past this card
    await ap("new", "r2");
    const got = await dbm.inWorkspace("default", () => runs.waitingApprovals("u1"));
    assert.deepEqual(got.map((a) => a.approval_id), ["new"]);
    assert.equal(got[0].title, "Chat");
  });
});

describe("decide (Inbox approve/deny)", () => {
  it("answers the card in the saved chat, resumes the turn and records the decision", async () => {
    const [turn, runs] = await Promise.all([import("../lib/turn"), import("../lib/runs")]);
    const as = <T,>(fn: () => T) => dbm.inWorkspace("default", () => dbm.asUser("u1", fn));
    const chat = [
      { id: "m1", role: "user", parts: [{ type: "text", text: "read example.com" }] },
      { id: "m2", role: "assistant", parts: [{ type: "step-start" }, { type: "tool-fetchUrl", toolCallId: "toolu_9", state: "approval-requested", input: { url: "https://example.com" }, approval: { id: "ap9" } }] },
    ] as import("ai").UIMessage[];
    await as(() => store.saveChat("t9", chat, "assistant"));
    await as(() => runs.syncApprovals("r9", "t9", "assistant", chat[1]));
    assert.equal(await turn.decide("default", "u1", "ap9", false), null);
    const after = await as(() => store.loadChat("t9"));
    assert.match(JSON.stringify(after), /output-denied/);
    assert.match(JSON.stringify(after), /pong/, "the model got the denial and answered");
    const row = (await as(() => runs.listApprovals("u1"))).find((a) => a.approval_id === "ap9")!;
    assert.equal(row.decision, "denied");
    assert.equal(await turn.decide("default", "u1", "ap9", true), "Already decided.");
  });
});
