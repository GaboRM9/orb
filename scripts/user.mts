// Adds a user to a workspace and prints a generated password once:
//   npx tsx scripts/user.mts add <email> [--admin] [--workspace <id>]
// Uses the app's database (.env.local, then .env: TURSO_DATABASE_URL or DB_PATH).
import { randomBytes } from "node:crypto";

for (const f of [".env.local", ".env"]) try { process.loadEnvFile(f); } catch { /* optional */ }

const [cmd, email, ...flags] = process.argv.slice(2);
if (cmd !== "add" || !email?.includes("@")) {
  console.error("usage: npx tsx scripts/user.mts add <email> [--admin] [--workspace <id>]");
  process.exit(1);
}
// imported after the env files: lib/db picks its database when it loads
const { db, DEFAULT_WS } = await import("../lib/db");
const { hashPassword } = await import("../lib/auth");

const wi = flags.indexOf("--workspace");
const workspace = wi >= 0 ? flags[wi + 1] : DEFAULT_WS;
if (!(await db.prepare("select 1 from workspaces where id=?").get(workspace))) {
  console.error(`No workspace "${workspace}"`);
  process.exit(1);
}
const password = randomBytes(12).toString("base64url");
const id = crypto.randomUUID();
await db.batch([
  ["insert into users (id, email, pass_hash, created) values (?,?,?,?)", id, email, hashPassword(password), Date.now()],
  ["insert into members (workspace_id, user_id, role) values (?,?,?)", workspace, id, flags.includes("--admin") ? "admin" : "member"],
]);
console.log(`${email} is now ${flags.includes("--admin") ? "an admin" : "a member"} of "${workspace}". Password (shown once): ${password}`);
