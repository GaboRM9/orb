"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAuth } from "./auth";
import { db, setSetting } from "./db";
import { seal } from "./secret";
import { probeMcp } from "./mcp";
import type { McpServer } from "./db";

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

export async function saveSettings(f: FormData) {
  await requireAuth();
  setSetting("model", s(f, "model"));
  if (s(f, "api_key")) setSetting("api_key", seal(s(f, "api_key"))); // blank keeps existing
  revalidatePath("/settings");
}

export async function clearKey() {
  await requireAuth();
  db.prepare("delete from settings where key='api_key'").run();
  revalidatePath("/settings");
}

export async function clearThreads() {
  await requireAuth();
  db.prepare("delete from threads").run();
  redirect("/agents");
}

// Runs and approvals are kept on purpose: deleting a chat must not erase the audit trail.
export async function deleteThread(id: string, backTo: string) {
  await requireAuth();
  db.prepare("delete from threads where id=?").run(id);
  revalidatePath("/", "layout");
  redirect(backTo);
}

export async function saveSkill(f: FormData) {
  await requireAuth();
  const id = Number(f.get("id")) || null;
  const v = [s(f, "name"), s(f, "description"), s(f, "body"), JSON.stringify(f.getAll("tools"))];
  if (v.slice(0, 3).some((x) => !x)) return;
  if (id) db.prepare("update skills set name=?,description=?,body=?,tools_json=? where id=?").run(...v, id);
  else db.prepare("insert into skills (name,description,body,tools_json) values (?,?,?,?) on conflict(name) do update set description=excluded.description, body=excluded.body, tools_json=excluded.tools_json").run(...v);
  revalidatePath("/skills");
  redirect("/skills");
}

export async function toggleSkill(id: number) {
  await requireAuth();
  db.prepare("update skills set enabled = 1 - enabled where id=?").run(id);
  revalidatePath("/skills");
}

export async function deleteSkill(id: number) {
  await requireAuth();
  db.prepare("delete from skills where id=?").run(id);
  revalidatePath("/skills");
  redirect("/skills");
}

export async function saveAgent(f: FormData) {
  await requireAuth();
  const id = s(f, "id") || crypto.randomUUID().slice(0, 8);
  const name = s(f, "name");
  if (!name) return;
  db.prepare(
    `insert into agents (id,name,description,instructions,model,tools_json,skills_json,mcp_json) values (?,?,?,?,?,?,?,?)
     on conflict(id) do update set name=excluded.name, description=excluded.description, instructions=excluded.instructions,
       model=excluded.model, tools_json=excluded.tools_json, skills_json=excluded.skills_json, mcp_json=excluded.mcp_json`,
  ).run(id, name, s(f, "description"), s(f, "instructions"), s(f, "model"), JSON.stringify(f.getAll("tools")), JSON.stringify(f.getAll("skills")), JSON.stringify(f.getAll("mcp")));
  revalidatePath("/", "layout");
  redirect("/agents");
}

export async function deleteAgent(id: string) {
  await requireAuth();
  db.prepare("update threads set agent_id=null where agent_id=?").run(id);
  db.prepare("delete from agents where id=?").run(id);
  revalidatePath("/", "layout");
  redirect("/agents");
}

// ---- MCP servers
const validUrl = (u: string) => {
  try {
    const x = new URL(u);
    // plain http only for localhost; everything remote must be https
    return x.protocol === "https:" || (x.protocol === "http:" && ["localhost", "127.0.0.1"].includes(x.hostname));
  } catch {
    return false;
  }
};

export async function saveMcp(f: FormData) {
  await requireAuth();
  const name = s(f, "name");
  const url = s(f, "url");
  const auth = s(f, "auth");
  if (!name || !validUrl(url)) return;
  db.prepare(
    "insert into mcp_servers (id,name,url,headers_json) values (?,?,?,?) on conflict(name) do update set url=excluded.url, headers_json=excluded.headers_json",
  ).run(crypto.randomUUID().slice(0, 8), name, url, auth ? seal(JSON.stringify({ Authorization: auth })) : "{}");
  revalidatePath("/settings");
}

export async function toggleMcp(id: string) {
  await requireAuth();
  db.prepare("update mcp_servers set enabled = 1 - enabled where id=?").run(id);
  revalidatePath("/settings");
}

export async function deleteMcp(id: string) {
  await requireAuth();
  db.prepare("delete from mcp_servers where id=?").run(id);
  // detach from agents so they don't keep a dangling id
  for (const a of db.prepare("select id, mcp_json from agents").all() as { id: string; mcp_json: string }[]) {
    const keep = (JSON.parse(a.mcp_json) as string[]).filter((x) => x !== id);
    db.prepare("update agents set mcp_json=? where id=?").run(JSON.stringify(keep), a.id);
  }
  revalidatePath("/", "layout");
}

export async function testMcp(id: string): Promise<{ ok: boolean; text: string }> {
  await requireAuth();
  const srv = db.prepare("select * from mcp_servers where id=?").get(id) as McpServer | undefined;
  if (!srv) return { ok: false, text: "Server not found" };
  try {
    const tools = await probeMcp(srv);
    return { ok: true, text: tools.length ? tools.map((t) => `${t.name}${t.description ? ` — ${t.description.slice(0, 80)}` : ""}`).join("\n") : "Connected, but the server lists no tools." };
  } catch (e) {
    return { ok: false, text: e instanceof Error ? e.message : String(e) };
  }
}
