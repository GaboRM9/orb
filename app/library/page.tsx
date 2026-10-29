import Link from "next/link";
import { attachMcp, deleteKnowledgeDoc, deleteKnowledgeFolder, deleteMcp, revokeMcpTool, deleteSkill, embedKnowledge, saveMcp, saveSkill, toggleMcp, toggleSkill } from "@/lib/actions";
import { GithubImport, KnowledgeUpload } from "@/components/knowledge-upload";
import { EvalsPanel } from "@/components/evals-panel";
import { McpTest } from "@/components/mcp-test";
import { hasEmbeddingKey, listDocs, staleChunks, type Doc } from "@/lib/knowledge";
import { isAdmin, listAgents, listMcp, listSkills, type McpServer } from "@/lib/db";
import { allowedMcp, mcpToolName } from "@/lib/mcp";
import { toolInfo, toolNames } from "@/lib/tools";

export const dynamic = "force-dynamic";

const tabs = [["knowledge", "Knowledge"], ["skills", "Skills"], ["connections", "Connections"], ["evals", "Evals"]] as const;

export default async function LibraryPage({ searchParams }: PageProps<"/library">) {
  const { tab, skill, new: isNew, agent, run, edit, error } = await searchParams;
  const one = (v: unknown) => (typeof v === "string" && v ? v : undefined);
  const admin = await isAdmin();
  const shown = tabs.filter(([k]) => admin || k !== "evals"); // evals spend the workspace's tokens: admins only
  const active = shown.find(([k]) => k === tab)?.[0] ?? "knowledge";
  return (
    <div className="mx-auto max-w-3xl space-y-6 px-6 py-14 md:px-10">
      <h1>Library</h1>
      <p className="text-sm text-mute">What your agents can know and use.</p>
      <nav className="seg">
        {shown.map(([k, label]) => (
          <Link key={k} href={`/library?tab=${k}`}
            aria-current={active === k ? "page" : undefined}>
            {label}
          </Link>
        ))}
      </nav>
      {active === "knowledge" && <Knowledge />}
      {active === "skills" && <Skills skill={one(skill)} isNew={one(isNew)} />}
      {active === "connections" && <Connections />}
      {active === "evals" && <EvalsPanel agent={one(agent)} run={one(run)} edit={one(edit)} error={one(error)} />}
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
        <details key={name} open className="rounded-lg border border-line px-4 py-2">
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
        Documents agents can search (agents with &ldquo;Search your knowledge&rdquo; on). Search combines keywords with OpenAI embeddings when an OpenAI key is set in Settings. With a key, document text and search queries are sent to OpenAI.
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

type Skill = Awaited<ReturnType<typeof listSkills>>[number];

function SkillForm({ cur }: { cur?: Skill }) {
  const have: string[] = cur ? JSON.parse(cur.tools_json) : [];
  return (
    <form action={saveSkill} className="space-y-3 pb-6">
      {cur && <input type="hidden" name="id" value={cur.id} />}
      <input className="field" name="name" defaultValue={cur?.name} placeholder="kebab-case-name" required aria-label="Name" />
      <input className="field" name="description" defaultValue={cur?.description} placeholder="When should the model use it?" required aria-label="Description" />
      <textarea className="field min-h-32 font-mono" name="body" defaultValue={cur?.body} placeholder="Full instructions" required aria-label="Body" />
      <fieldset className="text-sm">
        <legend className="mb-1 text-mute">Tools it needs</legend>
        {toolNames.map((t) => (
          <label key={t} title={toolInfo[t].hint} className="mr-4 inline-flex items-center gap-2 text-xs">
            <input type="checkbox" name="tools" value={t} defaultChecked={have.includes(t)} className="accent-current" /> {toolInfo[t].label}
          </label>
        ))}
      </fieldset>
      <div className="flex items-center gap-2">
        <button className="btn-solid">Save</button>
        {cur && <button className="btn" formAction={toggleSkill.bind(null, cur.id)} formNoValidate>{cur.enabled ? "Disable" : "Enable"}</button>}
        {cur && <button className="btn" formAction={deleteSkill.bind(null, cur.id)} formNoValidate>Delete</button>}
        <Link href="/library?tab=skills" className="ml-auto text-xs text-mute hover:text-fg">Close</Link>
      </div>
    </form>
  );
}

async function Skills({ skill, isNew }: { skill?: string; isNew?: string }) {
  const skills = await listSkills();
  return (
    <div className="space-y-4">
      <p className="text-xs text-mute">Reusable instructions an agent loads when it needs them. Agents can propose new ones; you approve them.</p>
      <div className="divide-y divide-line border-y border-line">
        {skills.map((s) => {
          const open = String(s.id) === skill;
          const extra = [!s.enabled && "Off", s.source === "agent" && "by agent"].filter(Boolean).join(" · ");
          return (
            <div key={s.id}>
              <Link href={open ? "/library?tab=skills" : `/library?tab=skills&skill=${s.id}`} scroll={false} className="block space-y-0.5 py-5">
                <span className="font-mono text-sm">{s.name}</span>
                {extra && <span className="ml-3 text-xs text-mute">{extra}</span>}
                <p className="truncate text-sm text-mute">{s.description}</p>
              </Link>
              {open && <SkillForm cur={s} />}
            </div>
          );
        })}
      </div>
      {isNew ? <SkillForm /> : <Link href="/library?tab=skills&new=1" className="inline-block text-sm text-mute hover:text-fg">+ New skill</Link>}
    </div>
  );
}

async function Connections() {
  const [servers, agents, allowed, admin] = await Promise.all([listMcp(), listAgents(), allowedMcp(), isAdmin()]);
  return (
    <div className="space-y-3">
      <p className="text-xs text-mute">
        Remote tool servers (Streamable HTTP). A server does nothing until it&apos;s attached to an agent. Every call to its tools asks for your approval in the chat, unless you chose Always allow for that tool.
        Credentials are encrypted in the database.{!admin && " Only a workspace admin can add, change or attach servers."}
      </p>
      {servers.map((m) => (
        <div key={m.id} className="space-y-2 card">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="text-sm font-medium">{m.name}</div>
              <div className="truncate font-mono text-xs text-mute">{m.url}{m.headers_json !== "{}" && " · auth header set"}</div>
            </div>
            {admin && <div className="flex gap-2">
              <form action={toggleMcp.bind(null, m.id)}><button className={m.enabled ? "btn-solid text-xs" : "btn text-xs"}>{m.enabled ? "On" : "Off"}</button></form>
              <form action={deleteMcp.bind(null, m.id)}><button className="btn text-xs">Delete</button></form>
            </div>}
          </div>
          <McpUse server={m} agents={agents} allowed={allowed} admin={admin} />
          {admin && <McpTest id={m.id} />}
        </div>
      ))}
      {admin && <form action={saveMcp} className="space-y-2 card">
        <div className="text-sm font-medium">Add MCP server</div>
        <input className="field" name="name" placeholder="Name (e.g. docs)" required />
        <input className="field font-mono" name="url" placeholder="https://example.com/mcp" required />
        <input className="field font-mono" name="auth" type="password" placeholder="Authorization header value (optional), e.g. Bearer …" autoComplete="off" />
        <button className="btn-solid">Add</button>
      </form>}
    </div>
  );
}

/** Which agents can use a server (a server no agent uses does nothing), and the tools that run without asking. */
function McpUse({ server, agents, allowed, admin }: { server: McpServer; agents: { id: string; name: string; mcp_json: string }[]; allowed: Set<string>; admin: boolean }) {
  const using = agents.filter((a) => (JSON.parse(a.mcp_json) as string[]).includes(server.id));
  const others = agents.filter((a) => !using.includes(a));
  const prefix = mcpToolName(server.name, "");
  const always = [...allowed].filter((k) => k.startsWith(`${server.id}:`)).map((k) => k.slice(server.id.length + 1));
  return (
    <div className="space-y-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className={using.length ? "text-mute" : ""}>{using.length ? `Used by ${using.map((a) => a.name).join(", ")}` : "Not attached to any agent yet, so no chat can use it."}</span>
        {admin && others.map((a) => (
          <form key={a.id} action={attachMcp.bind(null, server.id, a.id)}>
            <button className={`${!using.length && a.id === "assistant" ? "btn-solid" : "btn"} !py-1 text-xs`}>Attach to {a.name}</button>
          </form>
        ))}
      </div>
      {always.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-mute">Runs without asking:</span>
          {always.map((t) => (
            <form key={t} action={revokeMcpTool.bind(null, server.id, t)} className="chip inline-flex items-center gap-1.5">
              <span className="font-mono">{t.startsWith(prefix) ? t.slice(prefix.length) : t}</span>
              {admin && <button className="text-mute hover:text-fg" title="Ask before every call again">Ask again</button>}
            </form>
          ))}
        </div>
      )}
    </div>
  );
}
