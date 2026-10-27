"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAuth } from "./auth";
import { db, getSetting, listMcp, setSetting } from "./db";
import { parseTheme, type Theme } from "./theme";
import { seal } from "./secret";
import { importGithub } from "./github";
import { addDoc, deleteDoc, deleteFolder, embedMissing } from "./knowledge";
import { clearMcpAllowed, probeMcp, serverForTool, setMcpAllowed } from "./mcp";
import type { McpServer } from "./db";

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

export async function saveSettings(f: FormData) {
  await requireAuth();
  await setSetting("model", s(f, "model"));
  if (s(f, "api_key")) await setSetting("api_key", seal(s(f, "api_key"))); // blank keeps existing
  if (s(f, "openai_key")) await setSetting("openai_key", seal(s(f, "openai_key")));
  revalidatePath("/settings");
}

export async function saveGenUi(f: FormData) {
  await requireAuth();
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
  await requireAuth();
  await db.prepare("delete from settings where key='api_key'").run();
  revalidatePath("/settings");
}

export async function clearOpenAIKey() {
  await requireAuth();
  await db.prepare("delete from settings where key='openai_key'").run();
  revalidatePath("/settings");
}

export async function clearThreads() {
  await requireAuth();
  await db.batch([["delete from messages"], ["delete from threads"]]);
  redirect("/agents");
}

// Runs and approvals are kept on purpose: deleting a chat must not erase the audit trail.
export async function deleteThread(id: string, backTo: string) {
  await requireAuth();
  await db.batch([["delete from messages where thread_id=?", id], ["delete from threads where id=?", id]]);
  revalidatePath("/", "layout");
  redirect(backTo);
}

export async function saveSkill(f: FormData) {
  await requireAuth();
  const id = Number(f.get("id")) || null;
  const v = [s(f, "name"), s(f, "description"), s(f, "body"), JSON.stringify(f.getAll("tools"))];
  if (v.slice(0, 3).some((x) => !x)) return;
  if (id) await db.prepare("update skills set name=?,description=?,body=?,tools_json=? where id=?").run(...v, id);
  else await db.prepare("insert into skills (name,description,body,tools_json) values (?,?,?,?) on conflict(workspace_id, name) do update set description=excluded.description, body=excluded.body, tools_json=excluded.tools_json").run(...v);
  revalidatePath("/library");
  redirect("/library?tab=skills");
}

export async function toggleSkill(id: number) {
  await requireAuth();
  await db.prepare("update skills set enabled = 1 - enabled where id=?").run(id);
  revalidatePath("/library");
}

export async function deleteSkill(id: number) {
  await requireAuth();
  await db.prepare("delete from skills where id=?").run(id);
  revalidatePath("/library");
  redirect("/library?tab=skills");
}

export async function saveAgent(f: FormData) {
  await requireAuth();
  const id = s(f, "id") || crypto.randomUUID().slice(0, 8);
  const name = s(f, "name");
  if (!name) return;
  await db.prepare(
    `insert into agents (id,name,description,instructions,model,tools_json,skills_json,mcp_json) values (?,?,?,?,?,?,?,?)
     on conflict(id) do update set name=excluded.name, description=excluded.description, instructions=excluded.instructions,
       model=excluded.model, tools_json=excluded.tools_json, skills_json=excluded.skills_json, mcp_json=excluded.mcp_json`,
  ).run(id, name, s(f, "description"), s(f, "instructions"), s(f, "model"), JSON.stringify(f.getAll("tools")), JSON.stringify(f.getAll("skills")), JSON.stringify(f.getAll("mcp")));
  revalidatePath("/", "layout");
  redirect("/agents");
}

export async function deleteAgent(id: string) {
  await requireAuth();
  await db.prepare("update threads set agent_id=null where agent_id=?").run(id);
  await db.prepare("delete from agents where id=?").run(id);
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
  const prev = (await db.prepare("select id, url from mcp_servers where name=?").get(name)) as { id: string; url: string } | undefined;
  if (prev && prev.url !== url) await clearMcpAllowed(prev.id); // a new address is a different server: re-ask before every call
  await db.prepare(
    "insert into mcp_servers (id,name,url,headers_json) values (?,?,?,?) on conflict(workspace_id, name) do update set url=excluded.url, headers_json=excluded.headers_json",
  ).run(crypto.randomUUID().slice(0, 8), name, url, auth ? seal(JSON.stringify({ Authorization: auth })) : "{}");
  revalidatePath("/library");
}

export async function toggleMcp(id: string) {
  await requireAuth();
  await db.prepare("update mcp_servers set enabled = 1 - enabled where id=?").run(id);
  revalidatePath("/library");
}

export async function deleteMcp(id: string) {
  await requireAuth();
  await db.prepare("delete from mcp_servers where id=?").run(id);
  await clearMcpAllowed(id);
  // detach from agents so they don't keep a dangling id
  for (const a of (await db.prepare("select id, mcp_json from agents").all()) as { id: string; mcp_json: string }[]) {
    const keep = (JSON.parse(a.mcp_json) as string[]).filter((x) => x !== id);
    await db.prepare("update agents set mcp_json=? where id=?").run(JSON.stringify(keep), a.id);
  }
  revalidatePath("/", "layout");
}

export async function testMcp(id: string): Promise<{ ok: boolean; text: string }> {
  await requireAuth();
  const srv = (await db.prepare("select * from mcp_servers where id=?").get(id)) as McpServer | undefined;
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
  await requireAuth();
  const a = (await db.prepare("select mcp_json from agents where id=?").get(agentId)) as { mcp_json: string } | undefined;
  const ids = a ? (JSON.parse(a.mcp_json) as string[]) : null;
  if (!ids || ids.includes(serverId) || !(await db.prepare("select 1 from mcp_servers where id=?").get(serverId))) return;
  await db.prepare("update agents set mcp_json=? where id=?").run(JSON.stringify([...ids, serverId]), agentId);
  revalidatePath("/", "layout");
}

/** "Always allow" on an approval card: later calls to this MCP tool run without asking. */
export async function alwaysAllowMcpTool(toolName: string) {
  await requireAuth();
  const s = serverForTool(toolName, await listMcp());
  if (s) await setMcpAllowed(s.id, toolName, true);
  revalidatePath("/library");
}

/** Revoke from Library: the tool asks again before every call. */
export async function revokeMcpTool(serverId: string, toolName: string) {
  await requireAuth();
  await setMcpAllowed(serverId, toolName, false);
  revalidatePath("/library");
}
