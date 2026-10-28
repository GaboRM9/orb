"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { addMember, db, getAgent, getSetting, listMcp, me, removeMember, requireAdmin, requireAuth, resetMemberPassword, setMemberRole, setSetting, ws } from "./db";
import { parseTheme, type Theme } from "./theme";
import { seal } from "./secret";
import { importGithub } from "./github";
import { addDoc, deleteDoc, deleteFolder, embedMissing } from "./knowledge";
import { clearMcpAllowed, probeMcp, serverForTool, setMcpAllowed } from "./mcp";
import type { McpServer } from "./db";

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

export async function saveSettings(f: FormData) {
  await requireAdmin();
  await setSetting("model", s(f, "model"));
  if (s(f, "api_key")) await setSetting("api_key", seal(s(f, "api_key"))); // blank keeps existing
  if (s(f, "openai_key")) await setSetting("openai_key", seal(s(f, "openai_key")));
  revalidatePath("/settings");
}

export async function saveGenUi(f: FormData) {
  await requireAdmin();
  await setSetting("gen_ui", s(f, "gen_ui") === "off" ? "off" : "on");
  revalidatePath("/settings");
}

// merges whichever theme fields the form sends; parseTheme drops anything malformed
export async function saveTheme(f: FormData) {
  await requireAuth();
  const t = parseTheme(await getSetting("theme", "{}"));
  const next: Record<string, unknown> = { ...t };
  for (const [k, v] of f.entries()) if (k in t && typeof v === "string") next[k] = typeof t[k as keyof Theme] === "number" ? Number(v) : v;
  await setSetting("theme", JSON.stringify(parseTheme(JSON.stringify(next))));
  revalidatePath("/", "layout");
}

export async function clearKey() {
  await requireAdmin();
  await db.prepare("delete from settings where key='api_key' and workspace_id=?").run(await ws());
  revalidatePath("/settings");
}

export async function clearOpenAIKey() {
  await requireAdmin();
  await db.prepare("delete from settings where key='openai_key' and workspace_id=?").run(await ws());
  revalidatePath("/settings");
}

/** Deletes your own chats; other members' are theirs. */
export async function clearThreads() {
  await requireAuth();
  const [w, u] = [await ws(), await me()];
  await db.batch([["delete from messages where thread_id in (select id from threads where workspace_id=? and user_id=?)", w, u], ["delete from threads where workspace_id=? and user_id=?", w, u]]);
  redirect("/agents");
}

// Runs and approvals are kept on purpose: deleting a chat must not erase the audit trail.
export async function deleteThread(id: string, backTo: string) {
  await requireAuth();
  const [w, u] = [await ws(), await me()];
  await db.batch([["delete from messages where thread_id in (select id from threads where id=? and workspace_id=? and user_id=?)", id, w, u], ["delete from threads where id=? and workspace_id=? and user_id=?", id, w, u]]);
  revalidatePath("/", "layout");
  redirect(backTo);
}

export async function saveSkill(f: FormData) {
  await requireAuth();
  const id = Number(f.get("id")) || null;
  const v = [s(f, "name"), s(f, "description"), s(f, "body"), JSON.stringify(f.getAll("tools"))];
  if (v.slice(0, 3).some((x) => !x)) return;
  if (id) await db.prepare("update skills set name=?,description=?,body=?,tools_json=? where id=? and workspace_id=?").run(...v, id, await ws());
  else await db.prepare("insert into skills (workspace_id,name,description,body,tools_json) values (?,?,?,?,?) on conflict(workspace_id, name) do update set description=excluded.description, body=excluded.body, tools_json=excluded.tools_json").run(await ws(), ...v);
  revalidatePath("/library");
  redirect("/library?tab=skills");
}

export async function toggleSkill(id: number) {
  await requireAuth();
  await db.prepare("update skills set enabled = 1 - enabled where id=? and workspace_id=?").run(id, await ws());
  revalidatePath("/library");
}

export async function deleteSkill(id: number) {
  await requireAuth();
  await db.prepare("delete from skills where id=? and workspace_id=?").run(id, await ws());
  revalidatePath("/library");
  redirect("/library?tab=skills");
}

export async function saveAgent(f: FormData) {
  const { role } = await requireAuth();
  const id = s(f, "id") || crypto.randomUUID().slice(0, 8);
  const name = s(f, "name");
  if (!name) return;
  // connections are admin-only (like attachMcp): a member's save keeps the ones the agent already has
  const mcp = role === "admin" ? f.getAll("mcp") : JSON.parse((await getAgent(id))?.mcp_json ?? "[]");
  await db.prepare(
    `insert into agents (workspace_id,id,name,description,instructions,model,tools_json,skills_json,mcp_json) values (?,?,?,?,?,?,?,?,?)
     on conflict(id) do update set name=excluded.name, description=excluded.description, instructions=excluded.instructions,
       model=excluded.model, tools_json=excluded.tools_json, skills_json=excluded.skills_json, mcp_json=excluded.mcp_json
     where agents.workspace_id=excluded.workspace_id`,
  ).run(await ws(), id, name, s(f, "description"), s(f, "instructions"), s(f, "model"), JSON.stringify(f.getAll("tools")), JSON.stringify(f.getAll("skills")), JSON.stringify(mcp));
  revalidatePath("/", "layout");
  redirect("/agents");
}

export async function deleteAgent(id: string) {
  await requireAuth();
  const w = await ws();
  await db.prepare("update threads set agent_id=null where agent_id=? and workspace_id=?").run(id, w);
  await db.prepare("delete from agents where id=? and workspace_id=?").run(id, w);
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
  await requireAdmin();
  const name = s(f, "name");
  const url = s(f, "url");
  const auth = s(f, "auth");
  if (!name || !validUrl(url)) return;
  const w = await ws();
  const prev = (await db.prepare("select id, url from mcp_servers where name=? and workspace_id=?").get(name, w)) as { id: string; url: string } | undefined;
  if (prev && prev.url !== url) await clearMcpAllowed(prev.id); // a new address is a different server: re-ask before every call
  await db.prepare(
    "insert into mcp_servers (workspace_id,id,name,url,headers_json) values (?,?,?,?,?) on conflict(workspace_id, name) do update set url=excluded.url, headers_json=excluded.headers_json",
  ).run(w, crypto.randomUUID().slice(0, 8), name, url, auth ? seal(JSON.stringify({ Authorization: auth })) : "{}");
  revalidatePath("/library");
}

export async function toggleMcp(id: string) {
  await requireAdmin();
  await db.prepare("update mcp_servers set enabled = 1 - enabled where id=? and workspace_id=?").run(id, await ws());
  revalidatePath("/library");
}

export async function deleteMcp(id: string) {
  await requireAdmin();
  const w = await ws();
  if (!(await db.prepare("delete from mcp_servers where id=? and workspace_id=?").run(id, w)).changes) return;
  await clearMcpAllowed(id);
  // detach from agents so they don't keep a dangling id
  for (const a of (await db.prepare("select id, mcp_json from agents where workspace_id=?").all(w)) as { id: string; mcp_json: string }[]) {
    const keep = (JSON.parse(a.mcp_json) as string[]).filter((x) => x !== id);
    await db.prepare("update agents set mcp_json=? where id=?").run(JSON.stringify(keep), a.id);
  }
  revalidatePath("/", "layout");
}

export async function testMcp(id: string): Promise<{ ok: boolean; text: string }> {
  await requireAdmin();
  const srv = (await db.prepare("select * from mcp_servers where id=? and workspace_id=?").get(id, await ws())) as McpServer | undefined;
  if (!srv) return { ok: false, text: "Server not found" };
  try {
    const tools = await probeMcp(srv);
    return { ok: true, text: tools.length ? tools.map((t) => `${t.name}${t.description ? ` — ${t.description.slice(0, 80)}` : ""}`).join("\n") : "Connected, but the server lists no tools." };
  } catch (e) {
    return { ok: false, text: e instanceof Error ? e.message : String(e) };
  }
}

// ---- Knowledge
const MAX_FILE = 2_000_000; // chars read per file; bigger files are skipped, not truncated silently
const TEXT = /\.(md|mdx|txt|rst|csv|json|ya?ml|html?)$/i;

/** `files` and `paths` are parallel: FormData drops a folder pick's relative paths, so the client sends them alongside. */
export async function uploadKnowledge(f: FormData): Promise<{ ok: boolean; text: string }> {
  await requireAuth();
  const base = s(f, "folder");
  const paths = f.getAll("paths").map(String);
  let added = 0;
  const files = f.getAll("files");
  for (const [i, file] of files.entries()) {
    if (!(file instanceof File) || !TEXT.test(file.name) || file.size > MAX_FILE) continue;
    await addDoc(`${base}/${paths[i] || file.name}`, file.name, await file.text());
    added++;
  }
  const { left } = await embedMissing(); // one pass for the whole upload
  revalidatePath("/library");
  const skipped = files.length - added;
  return { ok: added > 0, text: `Added ${added}${skipped ? `, skipped ${skipped} (unsupported or over 2MB)` : ""}${left ? `. ${left} chunks are keyword-only until embedded` : ""}` };
}

export async function deleteKnowledgeDoc(id: number) {
  await requireAuth();
  await deleteDoc(id);
  revalidatePath("/library");
}

export async function deleteKnowledgeFolder(path: string) {
  await requireAuth();
  await deleteFolder(path);
  revalidatePath("/library");
}

export async function embedKnowledge() {
  await requireAuth();
  await embedMissing();
  revalidatePath("/library");
}

export async function importGithubDocs(f: FormData): Promise<{ ok: boolean; text: string }> {
  await requireAuth();
  try {
    const { n, truncated } = await importGithub(s(f, "repo"), s(f, "dir"), s(f, "token"));
    revalidatePath("/library");
    return { ok: true, text: `Imported ${n} files${truncated ? " (repo too large: only the first 200 docs were taken, narrow with a folder)" : ""}` };
  } catch (e) {
    return { ok: false, text: e instanceof Error ? e.message : String(e) };
  }
}

/** Gives an agent a connection (the Connections card's "Attach to …" button). */
export async function attachMcp(serverId: string, agentId: string) {
  await requireAdmin();
  const w = await ws();
  const a = (await db.prepare("select mcp_json from agents where id=? and workspace_id=?").get(agentId, w)) as { mcp_json: string } | undefined;
  const ids = a ? (JSON.parse(a.mcp_json) as string[]) : null;
  if (!ids || ids.includes(serverId) || !(await db.prepare("select 1 from mcp_servers where id=? and workspace_id=?").get(serverId, w))) return;
  await db.prepare("update agents set mcp_json=? where id=?").run(JSON.stringify([...ids, serverId]), agentId);
  revalidatePath("/", "layout");
}

/** "Always allow" on an approval card: later calls to this MCP tool run without asking. */
export async function alwaysAllowMcpTool(toolName: string) {
  await requireAdmin();
  const s = serverForTool(toolName, await listMcp());
  if (s) await setMcpAllowed(s.id, toolName, true);
  revalidatePath("/library");
}

/** Revoke from Library: the tool asks again before every call. */
export async function revokeMcpTool(serverId: string, toolName: string) {
  await requireAdmin();
  await setMcpAllowed(serverId, toolName, false);
  revalidatePath("/library");
}

// Settings → Members. Generated passwords come back to the admin once and are never stored in the clear.
type MemberResult = { ok: boolean; text: string; password?: string };
const done = (r: { error?: string }, text: string): MemberResult => (r.error ? { ok: false, text: r.error } : (revalidatePath("/settings"), { ok: true, text }));

export async function inviteMember(f: FormData): Promise<MemberResult> {
  const { workspace } = await requireAdmin();
  const r = await addMember(workspace, s(f, "email"), s(f, "role") === "admin" ? "admin" : "member");
  return "error" in r ? { ok: false, text: r.error } : (revalidatePath("/settings"), { ok: true, text: `Added ${s(f, "email")}. Send them this password; it won't be shown again.`, password: r.password });
}

export async function changeMemberRole(uid: string, role: "admin" | "member"): Promise<MemberResult> {
  const { workspace } = await requireAdmin();
  return done(await setMemberRole(workspace, uid, role === "admin" ? "admin" : "member"), "Role changed.");
}

export async function dropMember(uid: string): Promise<MemberResult> {
  const { workspace } = await requireAdmin();
  return done(await removeMember(workspace, uid), "Removed.");
}

export async function resetPassword(uid: string): Promise<MemberResult> {
  const { workspace } = await requireAdmin();
  const r = await resetMemberPassword(workspace, uid);
  return "error" in r ? { ok: false, text: r.error } : { ok: true, text: "New password set and their sessions signed out. Send it to them; it won't be shown again.", password: r.password };
}
