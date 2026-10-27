import Link from "next/link";
import { logout } from "@/app/login/actions";
import { clearKey, clearOpenAIKey, clearThreads, deleteKnowledgeDoc, deleteKnowledgeFolder, deleteMcp, embedKnowledge, saveMcp, saveSettings, toggleMcp } from "@/lib/actions";
import { GithubImport, KnowledgeUpload } from "@/components/knowledge-upload";
import { hasEmbeddingKey, listDocs, staleChunks, type Doc } from "@/lib/knowledge";
import { McpTest } from "@/components/mcp-test";
import { RunsPanel } from "@/components/runs-panel";
import { getSetting, listMcp } from "@/lib/db";
import { DEFAULT_MODEL, MODELS } from "@/lib/models";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // GitHub import and embedding run inside this page's server actions

const tabs = [["ai", "AI"], ["knowledge", "Knowledge"], ["connections", "Connections"], ["runs", "Runs"]] as const;

export default async function SettingsPage({ searchParams }: PageProps<"/settings">) {
  const { tab = "ai", agent, status, view } = await searchParams;
  const one = (v: unknown) => (typeof v === "string" && v ? v : undefined);
  const active = tab === "runs" || tabs.some(([k]) => k === tab) ? tab : "ai"; // Runs is reachable by link, not a tab
  return (
    <div className="mx-auto max-w-3xl space-y-6 px-6 py-14 md:px-10">
      <h1>Settings</h1>
      {active === "runs" ? (
        <Link href="/settings" className="block text-xs text-mute hover:text-fg">← Settings · Runs</Link>
      ) : (
      <nav className="flex gap-1 border-b border-line">
        {tabs.map(([k, label]) => (
          <Link key={k} href={`/settings?tab=${k}`}
            className={`-mb-px border-b px-3 py-1.5 text-sm ${active === k ? "border-fg" : "border-transparent text-mute hover:text-fg"}`}>
            {label}
          </Link>
        ))}
      </nav>
      )}
      {active === "ai" && <AI />}
      {active === "knowledge" && <Knowledge />}
      {active === "connections" && <Connections />}
      {active === "runs" && <RunsPanel view={one(view)} agent={one(agent)} status={one(status)} />}
    </div>
  );
}

async function AI() {
  const hasKey = !!(await getSetting("api_key"));
  const hasOpenAI = !!(await getSetting("openai_key"));
  const model = await getSetting("model", DEFAULT_MODEL);
  return (
    <div className="space-y-6">
      <form action={saveSettings} className="space-y-4">
        <label className="block space-y-1 text-sm">
          <span>Anthropic API key {hasKey ? <span className="text-mute">(saved — leave blank to keep)</span> : <span className="text-mute">(or set ANTHROPIC_API_KEY)</span>}</span>
          <input className="field font-mono" name="api_key" type="password" placeholder="sk-ant-…" autoComplete="off" />
        </label>
        <label className="block space-y-1 text-sm">
          <span>Model</span>
          <select className="field" name="model" defaultValue={model}>
            {MODELS.map((m) => <option key={m}>{m}</option>)}
          </select>
        </label>
        <label className="block space-y-1 text-sm">
          <span>OpenAI API key, for Knowledge search {hasOpenAI ? <span className="text-mute">(saved — leave blank to keep)</span> : <span className="text-mute">(optional, or set OPENAI_API_KEY; keyword search works without it)</span>}</span>
          <input className="field font-mono" name="openai_key" type="password" placeholder="sk-…" autoComplete="off" />
        </label>
        <div className="flex gap-2">
          <button className="btn-solid">Save</button>
          {hasKey && <button className="btn" formAction={clearKey}>Remove saved key</button>}
          {hasOpenAI && <button className="btn" formAction={clearOpenAIKey}>Remove OpenAI key</button>}
        </div>
      </form>
      <p className="text-xs text-mute">The key is encrypted in data/app.db with AUTH_SECRET (or ADMIN_PASSWORD). Change that secret and you will need to re-enter it.</p>
      <Account />
    </div>
  );
}

type Node = { dirs: Map<string, Node>; docs: Doc[] };
function tree(docs: Doc[]) {
  const root: Node = { dirs: new Map(), docs: [] };
  for (const d of docs) {
    const parts = d.path.split("/");
    let n = root;
    for (const p of parts.slice(0, -1)) n = n.dirs.get(p) ?? (n.dirs.set(p, { dirs: new Map(), docs: [] }), n.dirs.get(p)!);
    n.docs.push(d);
  }
  return root;
}

function Folder({ node, prefix }: { node: Node; prefix: string }) {
  return (
    <div className="space-y-1">
      {[...node.dirs].map(([name, child]) => (
        <details key={name} open className="rounded-md border border-line px-3 py-1.5">
          <summary className="flex cursor-pointer items-center justify-between gap-2 text-sm font-medium">
            <span>📁 {name}</span>
            <button className="btn text-xs" formAction={deleteKnowledgeFolder.bind(null, prefix + name)}>Delete folder</button>
          </summary>
          <div className="mt-1 ml-3"><Folder node={child} prefix={`${prefix}${name}/`} /></div>
        </details>
      ))}
      {node.docs.map((d) => (
        <div key={d.id} className="flex items-center justify-between gap-2 py-0.5 text-sm">
          <span className="min-w-0 truncate">{d.title} <span className="text-xs text-mute">· {d.chunks} chunks · {d.source}{d.source_ref && ` · ${d.source_ref}`}</span></span>
          <button className="btn text-xs" formAction={deleteKnowledgeDoc.bind(null, d.id)}>Delete</button>
        </div>
      ))}
    </div>
  );
}

async function Knowledge() {
  const docs = await listDocs();
  const stale = await staleChunks();
  const canEmbed = await hasEmbeddingKey();
  return (
    <div className="space-y-4">
      <p className="text-xs text-mute">
        Documents agents can search (turn on the searchKnowledge tool in an agent). Search combines keywords with OpenAI embeddings when a key is set in the AI tab. With a key, document text and search queries are sent to OpenAI.
      </p>
      {stale > 0 && (
        <form action={embedKnowledge} className="flex items-center gap-3 text-sm">
          <span className="text-mute">{stale} chunks have no embedding{canEmbed ? "" : " (add an OpenAI key first)"}; they are still found by keyword.</span>
          {canEmbed && <button className="btn text-xs">Embed now</button>}
        </form>
      )}
      <form>{docs.length ? <Folder node={tree(docs)} prefix="" /> : <p className="text-sm text-mute">Nothing here yet.</p>}</form>
      <KnowledgeUpload />
      <GithubImport />
    </div>
  );
}

function Account() {
  return (
    <div className="space-y-4 border-t border-line pt-6">
      <Link href="/settings?tab=runs" className="block text-sm text-mute hover:text-fg">Run history →</Link>
      <div className="flex flex-wrap gap-2">
      <details className="relative">
        <summary className="btn cursor-pointer list-none [&::-webkit-details-marker]:hidden">Delete all chats</summary>
        <form action={clearThreads} className="absolute left-0 z-10 mt-2 w-56 space-y-2 rounded-md border border-line bg-bg p-3 text-sm">
          <p className="text-mute">Every conversation is deleted. Runs are kept.</p>
          <button className="btn-solid">Yes, delete all</button>
        </form>
      </details>
      <form action={logout}><button className="btn">Sign out</button></form>
      </div>
    </div>
  );
}

async function Connections() {
  return (
    <div className="space-y-3">
      <p className="text-xs text-mute">
        Remote tool servers (Streamable HTTP). Attach them to an agent in its form. Every call to an MCP tool asks for your approval in the chat.
        Credentials are encrypted in data/app.db.
      </p>
      {(await listMcp()).map((m) => (
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
