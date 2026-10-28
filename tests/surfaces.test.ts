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

  it("templates: the logic behind weather, clock, loan, convert and nearby", async () => {
    assert.match(lib.catalog(), /^- clock\(zones\[\], at\?\): /m);
    const w = await import("../lib/surfaces/weather");
    assert.deepEqual([0, 2, 3, 45, 53, 63, 81, 73, 95].map(w.sky), ["clear", "partly", "cloudy", "fog", "drizzle", "rain", "rain", "snow", "storm"]);
    assert.equal(w.toUnit(100, "f"), 212);

    const c = await import("../lib/surfaces/clock");
    assert.equal(c.offsetMin("Asia/Kolkata", Date.UTC(2026, 0, 1)), 330);
    assert.equal(c.zonedTime("2026-07-01T15:00", "Europe/Madrid"), Date.UTC(2026, 6, 1, 13)); // summer time, UTC+2
    assert.equal(c.zonedTime("2026-12-01T15:00", "Europe/Madrid"), Date.UTC(2026, 11, 1, 14));
    await assert.rejects(lib.runSurface(lib.surfaces.clock, { zones: ["Mars/Base"] }), /IANA/);

    const l = await import("../lib/surfaces/loan");
    const a = l.amortize(300_000, 6.5, 30);
    assert.equal(Math.round(a.monthly), 1896);
    assert.equal(a.balance.length, 31);
    assert.equal(Math.round(a.balance.at(-1)!), 0);
    assert.equal(l.amortize(1200, 0, 1).monthly, 100); // no interest

    const u = await import("../lib/surfaces/convert");
    assert.equal(u.round(u.convert(10, "km", "mi")), "6.214");
    assert.equal(u.round(u.convert(100, u.unit("°F"), u.unit("C"))), "37.78");
    assert.throws(() => u.convert(1, "kg", "km"), /mass to length/);
    assert.throws(() => u.unit("furlong"), /Known: /);

    const n = await import("../lib/surfaces/nearby");
    assert.equal(n.distanceM({ lat: 0, lng: 0 }, { lat: 0, lng: 1 }), 111_195); // one degree along the equator
  });

  it("cards open compact: the headline and quick actions, details only behind a chip", async () => {
    const { createElement } = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const props = { refetch: () => {}, busy: false, live: true, send: () => {} };
    const html = (View: unknown, params: unknown, data: unknown) => renderToStaticMarkup(createElement(View as never, { ...props, params, data } as never));
    const hour = { time: "2026-10-28T14:00", temp: 17, rain: 5, wind: 5, sky: "partly" };
    const weather = {
      place: { name: "Barcelona, Barcelonès", lat: 41.4, lng: 2.2 },
      now: { temp: 17, feels: 19, sky: "partly", day: true, wind: 5, humidity: 93 },
      hours: [hour, { ...hour, time: "2026-10-28T15:00" }],
      days: [{ date: "2026-10-28", min: 17, max: 23, rain: 5, sky: "partly", sunrise: "2026-10-28T07:00", sunset: "2026-10-28T18:00" }],
    };
    const w = html((await import("../components/surfaces/weather")).WeatherView, { city: "Barcelona", units: "c" }, weather);
    assert.match(w, /17°.*Partly cloudy.*Feels 19° · Wind 5 km\/h · Humidity 93%/);
    assert.match(w, /Next hours.*This week.*°F.*What should I wear\? →/);
    assert.doesNotMatch(w, /Today|Now/, "the hourly strip and the week stay closed");

    const loan = html((await import("../components/surfaces/loan")).LoanView, { amount: 300_000, rate: 6.5, years: 30, currency: "USD" }, null);
    assert.match(loan, /\$1,896.*\/ month/);
    assert.doesNotMatch(loan, /type="range"/, "sliders stay behind Adjust");

    const fx = html((await import("../components/surfaces/fx")).FxView, { amount: 100, from: "USD", to: "MXN" }, { from: "USD", to: "MXN", rate: 18.6, date: "2026-10-27", series: [{ date: "2026-10-01", rate: 18 }, { date: "2026-10-27", rate: 18.6 }] });
    assert.match(fx, /1,860/);
    assert.doesNotMatch(fx, /<svg/, "the trend stays behind its chip");

    const wiki = html((await import("../components/surfaces/wiki")).WikiView, {}, { title: "Ada Lovelace", description: "mathematician", extract: "One. Two. Three. Four.", image: null, url: "https://en.wikipedia.org/wiki/Ada_Lovelace", ambiguous: false });
    assert.match(wiki, /One\. Two\.<\/p>/);
    assert.match(wiki, /Key facts →/);
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
