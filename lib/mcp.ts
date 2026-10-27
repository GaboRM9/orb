import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import type { Tool } from "ai";
import { db, getSetting, setSetting, type McpServer } from "./db";
import { open } from "./secret";

export const MCP_PREFIX = "mcp_";
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
/** The name the model sees: mcp_<server>_<tool>, within Anthropic's 64-character limit. */
export const mcpToolName = (server: string, tool: string) => `${MCP_PREFIX}${slug(server)}_${tool}`.slice(0, 64).replace(/[^a-zA-Z0-9_-]/g, "_");

/** The server a model-facing tool name belongs to: the longest matching mcp_<server>_ prefix ("docs" vs "docs_v2"). */
export const serverForTool = (name: string, servers: McpServer[]) =>
  servers.filter((s) => name.startsWith(`${MCP_PREFIX}${slug(s.name)}_`)).sort((a, b) => b.name.length - a.name.length)[0];

// Tools the user chose to always allow, as "<server id>:<tool name>". Keyed by server id so a different server
// reusing the name doesn't inherit them; saving a server with a new URL or deleting it clears its entries.
const ALLOW_KEY = "mcp_allow";
export const allowedMcp = async () => new Set(JSON.parse(await getSetting(ALLOW_KEY, "[]")) as string[]);
export async function setMcpAllowed(serverId: string, tool: string, on: boolean) {
  const all = await allowedMcp();
  all[on ? "add" : "delete"](`${serverId}:${tool}`);
  await setSetting(ALLOW_KEY, JSON.stringify([...all]));
}
/** An MCP call asks the user, unless its tool is always allowed for the server that owns it (then it's logged as an automatic approval). */
export const mcpApproval = (name: string, owners: Record<string, string>, allowed: Set<string>) =>
  owners[name] && allowed.has(`${owners[name]}:${name}`) ? ({ type: "approved", reason: "Always allowed in Library" } as const) : ("user-approval" as const);

export async function clearMcpAllowed(serverId: string) {
  await setSetting(ALLOW_KEY, JSON.stringify([...(await allowedMcp())].filter((k) => !k.startsWith(`${serverId}:`))));
}
const withTimeout = <T,>(p: Promise<T>, ms = 8000) =>
  Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`timed out after ${ms / 1000}s`)), ms))]);

const connect = (s: McpServer) =>
  withTimeout(createMCPClient({ transport: { type: "http", url: s.url, headers: JSON.parse(open(s.headers_json) ?? "{}") } })); // unreadable headers (secret changed) connect without auth; redirects stay blocked (SSRF default)

/** Opens the given servers and merges their tools as `mcp_<server>_<tool>`. A dead server is skipped, never fatal. */
export async function openMcp(ids: string[]) {
  const clients: MCPClient[] = [];
  const tools: Record<string, Tool> = {};
  const owners: Record<string, string> = {}; // tool name → server id, for always-allow
  const warnings: string[] = [];
  const servers = ids.length
    ? ((await db.prepare(`select * from mcp_servers where enabled=1 and id in (${ids.map(() => "?").join(",")})`).all(...ids)) as McpServer[])
    : [];
  await Promise.all(
    servers.map(async (s) => {
      try {
        const c = await connect(s);
        clients.push(c);
        for (const [name, t] of Object.entries(await withTimeout(c.tools()))) {
          const key = mcpToolName(s.name, name);
          tools[key] = t as Tool;
          owners[key] = s.id;
        }
      } catch (e) {
        warnings.push(`${s.name}: ${e instanceof Error ? e.message : e}`);
      }
    }),
  );
  let closed = false;
  return {
    tools,
    owners,
    warnings,
    close: async () => {
      if (closed) return;
      closed = true;
      await Promise.allSettled(clients.map((c) => c.close()));
    },
  };
}

/** Connects once and lists what the server offers (for the Test button). */
export async function probeMcp(s: McpServer) {
  const c = await connect(s);
  try {
    const t = await withTimeout(c.tools());
    return Object.entries(t).map(([name, v]) => ({ name, description: String((v as Tool).description ?? "") }));
  } finally {
    await c.close().catch(() => {});
  }
}
