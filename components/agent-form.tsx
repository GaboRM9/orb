import { deleteAgent, saveAgent } from "@/lib/actions";
import { isAdmin, listMcp, listSkills, type Agent } from "@/lib/db";
import { MODELS } from "@/lib/models";
import { Submit } from "./submit";
import { DEFAULT_TOOLS, toolInfo, toolNames } from "@/lib/tools";

export async function AgentForm({ agent }: { agent?: Agent }) {
  const tools: string[] = agent ? JSON.parse(agent.tools_json) : [];
  const skills: string[] = agent ? JSON.parse(agent.skills_json) : [];
  const mcp: string[] = agent ? JSON.parse(agent.mcp_json) : [];
  const [servers, admin, allSkills] = await Promise.all([listMcp(), isAdmin(), listSkills()]);
  return (
    <form action={saveAgent} className="space-y-10">
      {agent && <input type="hidden" name="id" value={agent.id} />}
      <div className="space-y-3">
        <input className="field" name="name" placeholder="Name" defaultValue={agent?.name} required aria-label="Name" />
        <textarea className="field min-h-40" name="instructions" placeholder="Instructions: who is this agent and how does it behave?" defaultValue={agent?.instructions} aria-label="Instructions" />
      </div>
      <details className="border-t border-line pt-6">
        <summary className="cursor-pointer text-sm font-medium">
          Abilities
          <span className="ml-2 text-xs font-normal text-mute">{agent ? `${tools.length} on` : `${DEFAULT_TOOLS.length} on by default`}{skills.length + mcp.length > 0 && ` · ${skills.length} skills · ${mcp.length} connections`}</span>
        </summary>
        <div className="mt-6 space-y-8">
          <fieldset className="space-y-3 text-sm">
            {toolNames.map((t) => (
              <label key={t} className="flex items-start gap-3">
                <input type="checkbox" name="tools" value={t} defaultChecked={agent ? tools.includes(t) : DEFAULT_TOOLS.includes(t)} className="mt-1 accent-current" />
                <span>{toolInfo[t].label}<span className="block text-xs text-mute">{toolInfo[t].hint}</span></span>
              </label>
            ))}
          </fieldset>
          {allSkills.length > 0 && (
            <fieldset className="space-y-2 text-sm">
              <legend className="mb-2 text-mute">Skills</legend>
              {allSkills.map((k) => (
                <label key={k.id} className="mr-4 inline-flex items-center gap-2 text-sm">
                  <input type="checkbox" name="skills" value={k.name} defaultChecked={skills.includes(k.name)} className="accent-current" /> {k.name}
                </label>
              ))}
            </fieldset>
          )}
          {servers.length > 0 && (
            <fieldset className="space-y-2 text-sm">
              <legend className="mb-2 text-mute">Connections <span>({admin ? "each tool call asks for approval" : "a workspace admin attaches these"})</span></legend>
              {servers.map((m) => (
                <label key={m.id} className="mr-4 inline-flex items-center gap-2 text-sm">
                  <input type="checkbox" name="mcp" value={m.id} defaultChecked={mcp.includes(m.id)} disabled={!admin} className="accent-current" /> {m.name}
                </label>
              ))}
            </fieldset>
          )}
        </div>
      </details>
      <details className="border-t border-line pt-6">
        <summary className="cursor-pointer text-sm font-medium">Advanced</summary>
        <div className="mt-6 space-y-3">
          <input className="field" name="description" placeholder="One-line role (shown when you start a chat)" defaultValue={agent?.description} aria-label="Description" />
          <label className="block space-y-1 text-sm">
            <span className="text-mute">Model</span>
            <select className="field" name="model" defaultValue={agent?.model ?? ""}>
              <option value="">Default (from Settings)</option>
              {MODELS.map((m) => <option key={m}>{m}</option>)}
            </select>
          </label>
        </div>
      </details>
      <div className="sticky bottom-0 border-t border-line glass py-4">
        <Submit className="btn-solid">Save</Submit>
      </div>
      {agent && (
        <details className="border-t border-line pt-6 text-sm">
          <summary className="cursor-pointer text-mute hover:text-fg">Danger zone</summary>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
            <p className="text-mute">Deleting removes this agent. Its conversations stay in the sidebar.</p>
            <Submit className="btn shrink-0" formAction={deleteAgent.bind(null, agent.id)} formNoValidate>Delete agent</Submit>
          </div>
        </details>
      )}
    </form>
  );
}
