import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, describe, it } from "node:test";

process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "mcp-")), "test.db");
process.env.ADMIN_PASSWORD = "test-pass";
/* eslint-disable-next-line @typescript-eslint/no-require-imports */
(require("../lib/db") as typeof import("../lib/db")).workspaceScope.enterWith("default"); // these tests run as the first workspace

let mcp: typeof import("../lib/mcp");
before(async () => {
  mcp = await import("../lib/mcp");
});

const server = (id: string, name: string) => ({ id, name, url: "https://x", headers_json: "{}", enabled: 1 });

describe("mcp", () => {
  it("names tools per server and finds the owner by the longest prefix", () => {
    assert.equal(mcp.mcpToolName("Deep Wiki", "ask_wiki_question"), "mcp_deep_wiki_ask_wiki_question");
    const servers = [server("a", "docs"), server("b", "docs v2")];
    assert.equal(mcp.serverForTool("mcp_docs_v2_search", servers)?.id, "b");
    assert.equal(mcp.serverForTool("mcp_docs_search", servers)?.id, "a");
    assert.equal(mcp.serverForTool("mcp_other_search", servers), undefined);
  });

  it("always allow: by server id, revocable, cleared per server", async () => {
    const owners = { mcp_docs_search: "a", mcp_wiki_ask: "b" };
    assert.equal(mcp.mcpApproval("mcp_docs_search", owners, await mcp.allowedMcp()), "user-approval");

    await mcp.setMcpAllowed("a", "mcp_docs_search", true);
    await mcp.setMcpAllowed("b", "mcp_wiki_ask", true);
    assert.deepEqual(mcp.mcpApproval("mcp_docs_search", owners, await mcp.allowedMcp()), { type: "approved", reason: "Always allowed in Library" });
    // the same tool name from a different server (e.g. a renamed or re-added one) still asks
    assert.equal(mcp.mcpApproval("mcp_docs_search", { mcp_docs_search: "c" }, await mcp.allowedMcp()), "user-approval");
    assert.equal(mcp.mcpApproval("mcp_unknown_tool", owners, await mcp.allowedMcp()), "user-approval");

    await mcp.setMcpAllowed("a", "mcp_docs_search", false);
    assert.equal(mcp.mcpApproval("mcp_docs_search", owners, await mcp.allowedMcp()), "user-approval");
    await mcp.clearMcpAllowed("b");
    assert.equal(mcp.mcpApproval("mcp_wiki_ask", owners, await mcp.allowedMcp()), "user-approval");
  });
});
