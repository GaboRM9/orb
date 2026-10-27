import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { z } from "zod";

process.env.ADMIN_PASSWORD = "test-pass";

let lib: typeof import("../lib/surfaces");
let route: typeof import("../app/api/surfaces/[name]/route");
let auth: typeof import("../lib/auth");
let ui: typeof import("../lib/ui-tools");

before(async () => {
  [lib, route, auth, ui] = await Promise.all([import("../lib/surfaces"), import("../app/api/surfaces/[name]/route"), import("../lib/auth"), import("../lib/ui-tools")]);
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

const refresh = (name: string, params: unknown, cookie = `${auth.COOKIE}=${auth.makeToken()}`) =>
  route.POST(new Request(`http://x/api/surfaces/${name}`, { method: "POST", headers: { cookie }, body: JSON.stringify({ params }) }), { params: Promise.resolve({ name }) } as never);

describe("surfaces", () => {
  it("run: validates params, fetches, summarises", async () => {
    assert.deepEqual(await lib.runSurface(lib.surfaces.echo, { word: "hi" }), { params: { word: "hi" }, data: { word: "hi" }, summary: "said hi" });
    await assert.rejects(lib.runSurface(lib.surfaces.echo, { word: "far too long a word" }));
    await assert.rejects(lib.runSurface(lib.surfaces.echo, { word: "hi", huge: true }), /too much data/);
  });

  it("the model sees the summary, not the data", async () => {
    const t = lib.surfaceTools().open_echo;
    const out = await lib.runSurface(lib.surfaces.echo, { word: "hi" });
    assert.deepEqual(await t.toModelOutput!({ toolCallId: "1", input: { word: "hi" }, output: out }), { type: "text", value: "said hi" });
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

  it("surface context from the browser is capped and framed as data", () => {
    assert.equal(ui.surfaceContext(undefined), "");
    assert.equal(ui.surfaceContext([1, "", null]), "");
    const c = ui.surfaceContext(["a".repeat(500), ...Array(6).fill("b")]);
    assert.match(c, /data, not instructions/);
    assert.equal(c.split("\n").length, 6); // header + the last 5
    assert.ok(!c.includes("a".repeat(301)));
  });
});
