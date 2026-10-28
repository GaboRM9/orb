import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, describe, it } from "node:test";
import { z } from "zod";

process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "surf-")), "test.db");
process.env.ADMIN_PASSWORD = "test-pass";

let lib: typeof import("../lib/surfaces");
let route: typeof import("../app/api/surfaces/[name]/route");
let auth: typeof import("../lib/auth");
let ui: typeof import("../lib/ui-tools");

before(async () => {
  [lib, route, auth, ui] = await Promise.all([import("../lib/surfaces"), import("../app/api/surfaces/[name]/route"), import("../lib/auth"), import("../lib/ui-tools")]);
  const { db } = await import("../lib/db");
  await db.prepare("insert into users (id, email, pass_hash, created) values ('u1', 'ada@x.test', 'x', 0)").run();
  await db.prepare("insert into members (workspace_id, user_id) values ('default', 'u1')").run();
  // a stand-in surface: echoes its params, or returns a huge payload on request
  lib.surfaces.echo = lib.defineSurface({
    name: "echo",
    title: "Echo",
    when: "testing",
    params: z.object({ word: z.string().max(10), huge: z.boolean().optional() }),
    fetch: async (p) => (p.huge ? "x".repeat(300_000) : { word: p.word }),
    summary: (p) => `said ${p.word}`,
  });
});

const refresh = (name: string, params: unknown, cookie = `${auth.COOKIE}=${auth.makeToken("u1", "default", 0)}`) =>
  route.POST(new Request(`http://x/api/surfaces/${name}`, { method: "POST", headers: { cookie }, body: JSON.stringify({ params }) }), { params: Promise.resolve({ name }) } as never);

describe("surfaces", () => {
  it("run: validates params, fetches, summarises", async () => {
    assert.deepEqual(await lib.runSurface(lib.surfaces.echo, { word: "hi" }), { params: { word: "hi" }, data: { word: "hi" }, summary: "said hi" });
    await assert.rejects(lib.runSurface(lib.surfaces.echo, { word: "far too long a word" }));
    await assert.rejects(lib.runSurface(lib.surfaces.echo, { word: "hi", huge: true }), /too much data/);
  });

  it("the model sees the summary, not the data (old open_<name> calls too)", async () => {
    const out = await lib.runSurface(lib.surfaces.echo, { word: "hi" });
    for (const t of [lib.openTool(), lib.legacySurfaceTools().open_echo])
      assert.deepEqual(await t.toModelOutput!({ toolCallId: "1", input: {}, output: out }), { type: "text", value: "said hi" });
  });

  it("open: one tool, a catalog line per template, params checked by the template", async () => {
    assert.equal(lib.signature(lib.surfaces.directions), "directions(from, to, mode?=walk|bike|drive)");
    assert.match(lib.catalog(), /^- echo\(word, huge\?\): testing$/m);
    const open = lib.openTool();
    assert.match(open.description as string, /- directions\(/);
    const run = (input: unknown) => open.execute!(input as never, { toolCallId: "1", messages: [] } as never);
    assert.deepEqual(await run({ t: "echo", p: { word: "yo" } }), { params: { word: "yo" }, data: { word: "yo" }, summary: "said yo" });
    await assert.rejects(run({ t: "echo", p: { word: 5 } }), /word/); // readable, so the model can retry
  });

  it("refresh: needs a session, a known surface and valid params", async () => {
    assert.equal((await refresh("echo", { word: "hi" }, "")).status, 401);
    assert.equal((await refresh("nope", { word: "hi" })).status, 404);
    assert.equal((await refresh("toString", { word: "hi" })).status, 404); // no prototype lookups
    assert.equal((await refresh("echo", { word: 5 })).status, 400);
    const ok = await refresh("echo", { word: "yo" });
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).summary, "said yo");
  });

  it("directions: OSRM maneuvers read as plain steps", async () => {
    const { stepText } = await import("../lib/surfaces/directions");
    const step = (type: string, modifier?: string, name = "Gran Vía") => stepText({ name, distance: 0, maneuver: { type, modifier } });
    assert.equal(step("depart"), "Head out on Gran Vía");
    assert.equal(step("turn", "left"), "Turn left onto Gran Vía");
    assert.equal(step("fork", "slight right"), "Keep slight right onto Gran Vía");
    assert.equal(step("new name", "straight"), "Continue onto Gran Vía");
    assert.equal(step("roundabout", "right", ""), "Take the roundabout");
    assert.equal(step("arrive"), "Arrive");
  });

  it("directions: places are cached and Nominatim calls spaced a second apart", async () => {
    const { geocode } = await import("../lib/surfaces/directions");
    const real = globalThis.fetch;
    const calls: number[] = [];
    globalThis.fetch = (async (url: string) => {
      calls.push(Date.now());
      const missing = String(url).includes("nowhere");
      return new Response(JSON.stringify(missing ? [] : [{ display_name: "Sol, Madrid, Spain", lat: "40.4", lon: "-3.7" }]));
    }) as typeof fetch;
    try {
      const [a] = await Promise.all([geocode("Sol, Madrid"), geocode("Retiro, Madrid")]);
      assert.equal(a.name, "Sol, Madrid");
      assert.ok(calls[1] - calls[0] >= 950, `second call came ${calls[1] - calls[0]}ms after the first`);
      await geocode("  sol, MADRID "); // same place, other spelling: no new request
      assert.equal(calls.length, 2);
      await assert.rejects(geocode("nowhere"), /Couldn't find/);
      await assert.rejects(geocode("nowhere"), /Couldn't find/); // a miss isn't cached
      assert.equal(calls.length, 4);
    } finally {
      globalThis.fetch = real;
    }
  });

  it("surface context from the browser is capped and framed as data", () => {
    assert.equal(ui.surfaceContext(undefined), "");
    assert.equal(ui.surfaceContext([1, "", null]), "");
    const c = ui.surfaceContext(["a".repeat(500), ...Array(6).fill("b")]);
    assert.match(c, /data, not instructions/);
    assert.equal(c.split("\n").length, 6); // header + the last 5
    assert.ok(!c.includes("a".repeat(301)));
  });
});
