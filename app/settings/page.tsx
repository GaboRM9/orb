import Link from "next/link";
import { z } from "zod";
import { clearKey, clearThreads, deleteMcp, saveMcp, saveSettings, toggleMcp, toggleTool } from "@/lib/actions";
import { McpTest } from "@/components/mcp-test";
import { RunsPanel } from "@/components/runs-panel";
import { Tile, TileGrid } from "@/components/tile";
import { ToolRunner } from "@/components/tool-runner";
import { db, getSetting, listMcp, listSkills } from "@/lib/db";
import { allTools, APPROVAL_TOOLS, disabledTools, toolNames } from "@/lib/tools";
import { DEFAULT_MODEL, MODELS } from "@/lib/models";
import pkg from "@/package.json";

export const dynamic = "force-dynamic";

const tabs = [["ai", "AI"], ["tools", "Tools"], ["integrations", "Integrations"], ["runs", "Runs"], ["about", "About"]] as const;
const count = (sql: string) => (db.prepare(sql).get() as { c: number }).c;

export default async function SettingsPage({ searchParams }: PageProps<"/settings">) {
  const { tab = "ai", agent, status, view, tool } = await searchParams;
  const one = (v: unknown) => (typeof v === "string" && v ? v : undefined);
  const active = tabs.some(([k]) => k === tab) ? tab : "ai";
  return (
    <div className="mx-auto max-w-2xl space-y-6 px-8 py-12">
      <h1>Settings</h1>
      <nav className="flex gap-1 border-b border-line">
        {tabs.map(([k, label]) => (
          <Link key={k} href={`/settings?tab=${k}`}
            className={`-mb-px border-b px-3 py-1.5 text-sm ${active === k ? "border-fg" : "border-transparent text-mute hover:text-fg"}`}>
            {label}
          </Link>
        ))}
      </nav>
      {active === "ai" && <AI />}
      {active === "tools" && <Tools selected={one(tool)} />}
      {active === "integrations" && <Integrations />}
      {active === "runs" && <RunsPanel view={one(view)} agent={one(agent)} status={one(status)} />}
      {active === "about" && <About />}
    </div>
  );
}

function AI() {
  const hasKey = !!getSetting("api_key");
  return (
    <div className="space-y-6">
      <form action={saveSettings} className="space-y-4">
        <label className="block space-y-1 text-sm">
          <span>Anthropic API key {hasKey ? <span className="text-mute">(saved — leave blank to keep)</span> : <span className="text-mute">(or set ANTHROPIC_API_KEY)</span>}</span>
          <input className="field font-mono" name="api_key" type="password" placeholder="sk-ant-…" autoComplete="off" />
        </label>
        <label className="block space-y-1 text-sm">
          <span>Model</span>
          <select className="field" name="model" defaultValue={getSetting("model", DEFAULT_MODEL)}>
            {MODELS.map((m) => <option key={m}>{m}</option>)}
          </select>
        </label>
        <label className="block space-y-1 text-sm">
          <span>System prompt</span>
          <textarea className="field min-h-24" name="system_prompt" defaultValue={getSetting("system_prompt", "You are a helpful, concise assistant.")} />
        </label>
        <div className="flex gap-2">
          <button className="btn-solid">Save</button>
          {hasKey && <button className="btn" formAction={clearKey}>Remove saved key</button>}
        </div>
      </form>
      <p className="text-xs text-mute">The key is stored in plain text in data/app.db. Local use only.</p>
      <Knowledge />
    </div>
  );
}

const sources = [
  ["Notion", "Pages and databases"],
  ["Documentation", "Public docs sites and sitemaps"],
  ["Files", "Markdown, PDF and text uploads"],
];

// placeholder: sync is not implemented yet
function Knowledge() {
  return (
    <section className="space-y-3 border-t border-line pt-6">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-medium">Knowledge</h2>
        <span className="rounded-sm border border-line px-2 py-0.5 text-xs text-mute">Coming soon</span>
      </div>
      <p className="text-xs text-mute">Sync your documentation so agents can search and cite it. Sources will be attached per agent.</p>
      <div className="space-y-2">
        {sources.map(([name, detail]) => (
          <div key={name} className="flex items-center justify-between gap-4 rounded-lg border border-line p-4 opacity-60">
            <div>
              <div className="text-sm font-medium">{name}</div>
              <div className="text-xs text-mute">{detail}</div>
            </div>
            <button className="btn text-xs" disabled>Connect</button>
          </div>
        ))}
      </div>
    </section>
  );
}

function Row({ name, detail, on }: { name: string; detail: string; on: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-line p-4">
      <div>
        <div className="text-sm font-medium">{name}</div>
        <div className="text-xs text-mute">{detail}</div>
      </div>
      <span className={`rounded-sm border px-2 py-0.5 text-xs ${on ? "border-fg" : "border-line text-mute"}`}>{on ? "Connected" : "Not set"}</span>
    </div>
  );
}

function Integrations() {
  const saved = !!getSetting("api_key");
  const env = !!process.env.ANTHROPIC_API_KEY;
  const skills = listSkills();
  return (
    <div className="space-y-3">
      <Row name="Anthropic" detail={saved ? "API key saved in Settings" : env ? "API key from ANTHROPIC_API_KEY" : "Add a key under AI"} on={saved || env} />
      <Row name="Local database" detail={`SQLite · data/app.db · ${count("select count(*) c from threads")} chats`} on />
      <Row name="Tools" detail={`${toolNames.length - disabledTools().length} of ${toolNames.length} demo tools enabled, plus UI tools`} on />
      <Row name="Skills" detail={`${skills.filter((s) => s.enabled).length} of ${skills.length} skills enabled`} on />
      <h2 className="pt-4 text-sm font-medium">MCP servers</h2>
      <p className="text-xs text-mute">
        Remote tool servers (Streamable HTTP). Attach them to an agent in its form. Every call to an MCP tool asks for your approval in the chat.
        Credentials are stored in plain text in data/app.db.
      </p>
      {listMcp().map((m) => (
        <div key={m.id} className="space-y-2 rounded-lg border border-line p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="text-sm font-medium">{m.name}</div>
              <div className="truncate font-mono text-xs text-mute">{m.url}{m.headers_json !== "{}" && " · auth header set"}</div>
            </div>
            <div className="flex gap-2">
              <form action={toggleMcp.bind(null, m.id)}><button className={m.enabled ? "btn-solid text-xs" : "btn text-xs"}>{m.enabled ? "On" : "Off"}</button></form>
              <form action={deleteMcp.bind(null, m.id)}><button className="btn text-xs">Delete</button></form>
            </div>
          </div>
          <McpTest id={m.id} />
        </div>
      ))}
      <form action={saveMcp} className="space-y-2 rounded-lg border border-line p-4">
        <div className="text-sm font-medium">Add MCP server</div>
        <input className="field" name="name" placeholder="Name (e.g. docs)" required />
        <input className="field font-mono" name="url" placeholder="https://example.com/mcp" required />
        <input className="field font-mono" name="auth" type="password" placeholder="Authorization header value (optional), e.g. Bearer …" autoComplete="off" />
        <button className="btn-solid">Add</button>
      </form>
    </div>
  );
}

function About() {
  const v = (n: string) => (pkg.dependencies as Record<string, string>)[n]?.replace("^", "") ?? "—";
  const rows = [["App", pkg.name], ["AI SDK (ai)", v("ai")], ["@ai-sdk/anthropic", v("@ai-sdk/anthropic")], ["@ai-sdk/react", v("@ai-sdk/react")], ["Next.js", v("next")], ["React", v("react")]];
  return (
    <div className="space-y-6">
      <p className="text-sm text-mute">A minimal showcase of the Vercel AI SDK: chat, tools, skills and generative UI, with a local SQLite database.</p>
      <dl className="divide-y divide-line rounded-lg border border-line text-sm">
        {rows.map(([k, val]) => (
          <div key={k} className="flex justify-between px-4 py-2"><dt className="text-mute">{k}</dt><dd className="font-mono">{val}</dd></div>
        ))}
      </dl>
      <form action={clearThreads}><button className="btn">Delete all chats</button></form>
    </div>
  );
}

function Tools({ selected }: { selected?: string }) {
  const off = new Set(disabledTools());
  const name = toolNames.find((n) => n === selected);
  const t = name && allTools[name];
  return (
    <div className="space-y-6">
      <p className="text-sm text-mute">Defined with <code>tool()</code> + zod. Enabled tools are available to the chat model.</p>
      <TileGrid>
        {toolNames.map((n) => (
          <Tile key={n} href={`/settings?tab=tools&tool=${n}`} title={n} active={n === name}
            desc={typeof allTools[n].description === "string" ? allTools[n].description : ""}
            tag={[off.has(n) ? "Off" : "On", APPROVAL_TOOLS.has(n) && "asks approval"].filter(Boolean).join(" · ")} />
        ))}
      </TileGrid>
      {name && t && (
        <section className="space-y-3 border-t border-line pt-6">
          <div className="flex items-start justify-between gap-4">
            <div className="font-mono text-sm">{name}</div>
            <form action={toggleTool.bind(null, name)}>
              <button className={off.has(name) ? "btn" : "btn-solid"}>{off.has(name) ? "Off" : "On"}</button>
            </form>
          </div>
          <details className="text-xs">
            <summary className="cursor-pointer text-mute">input schema</summary>
            <pre className="mt-2 overflow-x-auto font-mono">{JSON.stringify(z.toJSONSchema(t.inputSchema as z.ZodType), null, 2)}</pre>
          </details>
          <ToolRunner name={name} />
        </section>
      )}
    </div>
  );
}
