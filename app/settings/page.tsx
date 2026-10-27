import Link from "next/link";
import { logout } from "@/app/login/actions";
import { clearKey, clearThreads, deleteMcp, saveMcp, saveSettings, toggleMcp } from "@/lib/actions";
import { McpTest } from "@/components/mcp-test";
import { RunsPanel } from "@/components/runs-panel";
import { getSetting, listMcp } from "@/lib/db";
import { DEFAULT_MODEL, MODELS } from "@/lib/models";

export const dynamic = "force-dynamic";

const tabs = [["ai", "AI"], ["connections", "Connections"], ["runs", "Runs"]] as const;

export default async function SettingsPage({ searchParams }: PageProps<"/settings">) {
  const { tab = "ai", agent, status, view } = await searchParams;
  const one = (v: unknown) => (typeof v === "string" && v ? v : undefined);
  const active = tabs.some(([k]) => k === tab) ? tab : "ai";
  return (
    <div className="mx-auto max-w-3xl space-y-6 px-6 py-14 md:px-10">
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
      {active === "connections" && <Connections />}
      {active === "runs" && <RunsPanel view={one(view)} agent={one(agent)} status={one(status)} />}
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
      <Account />
    </div>
  );
}

function Account() {
  return (
    <div className="flex gap-2 border-t border-line pt-6">
      <form action={clearThreads}><button className="btn">Delete all chats</button></form>
      <form action={logout}><button className="btn">Sign out</button></form>
    </div>
  );
}

function Connections() {
  return (
    <div className="space-y-3">
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
