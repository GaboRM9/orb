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
