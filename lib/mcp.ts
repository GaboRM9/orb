import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import type { Tool } from "ai";
import { db, type McpServer } from "./db";
import { open } from "./secret";

export const MCP_PREFIX = "mcp_";
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
const withTimeout = <T,>(p: Promise<T>, ms = 8000) =>
  Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`timed out after ${ms / 1000}s`)), ms))]);

const connect = (s: McpServer) =>
  withTimeout(createMCPClient({ transport: { type: "http", url: s.url, headers: JSON.parse(open(s.headers_json) ?? "{}") } })); // unreadable headers (secret changed) connect without auth; redirects stay blocked (SSRF default)

/** Opens the given servers and merges their tools as `mcp_<server>_<tool>`. A dead server is skipped, never fatal. */
export async function openMcp(ids: string[]) {
  const clients: MCPClient[] = [];
  const tools: Record<string, Tool> = {};
  const warnings: string[] = [];
  const servers = ids.length
    ? (db.prepare(`select * from mcp_servers where enabled=1 and id in (${ids.map(() => "?").join(",")})`).all(...ids) as McpServer[])
    : [];
  await Promise.all(
    servers.map(async (s) => {
      try {
        const c = await connect(s);
        clients.push(c);
        for (const [name, t] of Object.entries(await withTimeout(c.tools())))
          tools[`${MCP_PREFIX}${slug(s.name)}_${name}`.slice(0, 64).replace(/[^a-zA-Z0-9_-]/g, "_")] = t as Tool;
      } catch (e) {
        warnings.push(`${s.name}: ${e instanceof Error ? e.message : e}`);
      }
    }),
  );
  let closed = false;
  return {
    tools,
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
