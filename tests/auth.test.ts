import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";

process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "auth-")), "test.db");
process.env.AUTH_SECRET = "test-secret";
delete process.env.VERCEL;

/* eslint-disable @typescript-eslint/no-require-imports */
const d = require("../lib/db") as typeof import("../lib/db");
const a = require("../lib/auth") as typeof import("../lib/auth");

const addUser = async (email: string, password: string, role: "admin" | "member") => {
  const id = crypto.randomUUID();
  await d.db.batch([
    ["insert into users (id, email, pass_hash, created) values (?,?,?,?)", id, email, a.hashPassword(password), Date.now()],
    ["insert into members (workspace_id, user_id, role) values (?,?,?)", d.DEFAULT_WS, id, role],
  ]);
  return id;
};
const tokenFor = async (email: string, password: string) => {
  const u = await d.signIn(email, password);
  assert.ok(u, `${email} signs in`);
  return a.makeToken(u.uid, u.workspace, u.tokenV);
};

it("signs in only with the right password, and reports the member's role", async () => {
  await addUser("ada@example.com", "correct horse", "admin");
  await addUser("bob@example.com", "battery staple", "member");
  assert.equal(await d.signIn("ada@example.com", "wrong"), null);
  assert.equal(await d.signIn("nobody@example.com", "correct horse"), null);
  assert.equal((await d.sessionFor(await tokenFor("ada@example.com", "correct horse")))?.role, "admin");
  assert.equal((await d.sessionFor(await tokenFor("bob@example.com", "battery staple")))?.role, "member");
});

it("rejects tampered, foreign and unsigned tokens", async () => {
  const t = await tokenFor("bob@example.com", "battery staple");
  const [uid, , v, exp, sig] = t.split(".");
  assert.equal(a.parseToken(`${uid}.other-ws.${v}.${exp}.${sig}`), null, "workspace swapped");
  assert.equal(a.parseToken(`${uid}.default.${v}.${Number(exp) + 1}.${sig}`), null, "expiry extended");
  assert.equal(a.parseToken(t.slice(0, -2)), null, "signature cut");
  process.env.AUTH_SECRET = "another-secret";
  assert.equal(a.parseToken(t), null, "signed with another secret");
  delete process.env.AUTH_SECRET;
  assert.equal(a.parseToken(t), null, "no secret: fails closed");
  process.env.AUTH_SECRET = "test-secret";
  assert.ok(a.parseToken(t));
});

it("a password change signs out old sessions and keeps the new one", async () => {
  const old = await tokenFor("ada@example.com", "correct horse");
  assert.ok(await d.sessionFor(old));
  const uid = (await d.sessionFor(old))!.uid;
  assert.equal(await d.changePassword(uid, "not it", "new password 1"), null, "wrong current password");
  assert.ok(await d.sessionFor(old), "a failed change keeps the session");

  const v = await d.changePassword(uid, "correct horse", "new password 1");
  assert.equal(typeof v, "number");
  assert.equal(await d.sessionFor(old), null, "old token is revoked at once on this instance");
  assert.ok(await d.sessionFor(a.makeToken(uid, d.DEFAULT_WS, v!)), "fresh token works");
  assert.equal(await d.signIn("ada@example.com", "correct horse"), null);
  assert.ok(await d.signIn("ada@example.com", "new password 1"));
});

it("removing a member from the workspace ends their session", async () => {
  const uid = await addUser("cy@example.com", "cy's password", "member");
  const t = await tokenFor("cy@example.com", "cy's password"); // not yet looked up, so not in the 10s memo
  await d.db.prepare("delete from members where user_id=?").run(uid);
  assert.equal(await d.sessionFor(t), null);
  assert.equal(await d.signIn("cy@example.com", "cy's password"), null, "no workspace, no sign-in");
});

it("admins add, promote, reset and remove members; the workspace keeps an admin", async () => {
  const w = d.DEFAULT_WS;
  const added = await d.addMember(w, " Dee@Example.com ", "member");
  assert.ok("password" in added);
  assert.ok("error" in (await d.addMember(w, "dee@example.com", "admin")), "an email has one account");
  assert.ok("error" in (await d.addMember(w, "not an email", "member")));
  const t = await tokenFor("dee@example.com", added.password);
  const dee = (await d.sessionFor(t))!;
  assert.equal(dee.role, "member");

  await d.setMemberRole(w, dee.uid, "admin");
  assert.equal((await d.sessionFor(t))?.role, "admin", "a role change lands without signing in again");

  const reset = await d.resetMemberPassword(w, dee.uid);
  assert.ok("password" in reset);
  assert.equal(await d.sessionFor(t), null, "a reset signs them out");
  assert.equal(await d.signIn("dee@example.com", added.password), null);
  const t2 = await tokenFor("dee@example.com", reset.password);

  // demoting or removing the last admin is refused
  for (const m of await d.listMembers(w)) if (m.id !== dee.uid && m.role === "admin") await d.setMemberRole(w, m.id, "member");
  assert.ok("error" in (await d.setMemberRole(w, dee.uid, "member")));
  assert.ok("error" in (await d.removeMember(w, dee.uid)));

  const eve = await d.addMember(w, "eve@example.com", "member");
  assert.ok("password" in eve);
  const eveId = (await d.listMembers(w)).find((m) => m.email === "eve@example.com")!.id;
  assert.deepEqual(await d.removeMember(w, eveId), {});
  assert.equal(await d.signIn("eve@example.com", eve.password), null, "removed accounts can't sign in");
  assert.ok("password" in (await d.addMember(w, "eve@example.com", "member")), "and the email can be added again");
  assert.ok(await d.sessionFor(t2));
});

it("an admin can't reset the password of someone who is also in another workspace", async () => {
  await d.db.prepare("insert or ignore into workspaces (id, name, created) values ('other', 'Other', ?)").run(Date.now());
  const uid = await addUser("fay@example.com", "fay's password", "member");
  await d.db.prepare("insert into members (workspace_id, user_id, role) values ('other', ?, 'admin')").run(uid);
  assert.ok("error" in (await d.resetMemberPassword(d.DEFAULT_WS, uid)));
  assert.ok("error" in (await d.resetMemberPassword("other", "nobody")), "not a member");
  await d.removeMember(d.DEFAULT_WS, uid);
  assert.ok(await d.signIn("fay@example.com", "fay's password"), "removed here, the account stays for the other workspace");
});

it("first-run setup needs AUTH_SECRET and only ever makes one admin", async () => {
  assert.equal(a.ownsDeployment("wrong"), false);
  assert.equal(a.ownsDeployment(" test-secret "), true);
  // this database already has users from the tests above: setup is closed
  assert.equal(await d.createFirstAdmin("late@example.com", "a long password"), null);
  await d.db.batch([["delete from members"], ["delete from users"]]);
  assert.equal(await d.createFirstAdmin("not an email", "a long password"), null);
  const [first, second] = await Promise.all([d.createFirstAdmin("owner@example.com", "a long password"), d.createFirstAdmin("racer@example.com", "a long password")]);
  assert.ok(!!first !== !!second, "exactly one of two racing setups wins");
  const winner = first ? "owner@example.com" : "racer@example.com";
  assert.equal((await d.sessionFor(await tokenFor(winner, "a long password")))?.role, "admin");
});

it("demo guests are capped per IP and can't edit shared things", async () => {
  const env = { DEMO: process.env.DEMO, DAILY_BUDGET_USD: process.env.DAILY_BUDGET_USD, USER_DAILY_BUDGET_USD: process.env.USER_DAILY_BUDGET_USD };
  process.env.DEMO = "1";
  assert.equal(d.demoOn(), false, "no budgets set: no demo");
  Object.assign(process.env, { DAILY_BUDGET_USD: "5", USER_DAILY_BUDGET_USD: "0.5" });
  assert.equal(d.demoOn(), true);

  const guests = [];
  for (let i = 0; i < 4; i++) guests.push(await d.addGuest("203.0.113.9"));
  assert.ok(guests.slice(0, 3).every(Boolean));
  assert.equal(guests[3], null, "the 4th guest from one IP within an hour is refused");
  assert.ok(await d.addGuest("198.51.100.1"), "another IP still gets in");

  const g = guests[0]!;
  const guest = (await d.sessionFor(a.makeToken(g.uid, g.workspace, g.tokenV)))!;
  assert.equal(guest.role, "member");
  assert.equal(d.readOnly(guest), true);
  assert.equal(d.readOnly({ ...guest, role: "admin" }), false);
  delete process.env.DEMO;
  assert.equal(d.readOnly(guest), false, "without DEMO, members edit as before");
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
});
