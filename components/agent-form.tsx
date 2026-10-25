import { deleteAgent, saveAgent } from "@/lib/actions";
import { listMcp, listSkills, type Agent } from "@/lib/db";
import { MODELS } from "@/lib/models";
import { toolNames } from "@/lib/tools";


export function AgentForm({ agent }: { agent?: Agent }) {
  const tools: string[] = agent ? JSON.parse(agent.tools_json) : [];
  const skills: string[] = agent ? JSON.parse(agent.skills_json) : [];
  const mcp: string[] = agent ? JSON.parse(agent.mcp_json) : [];
  const servers = listMcp();
  return (
    <form action={saveAgent} className="space-y-4">
      {agent && <input type="hidden" name="id" value={agent.id} />}
      <input className="field" name="name" placeholder="Name" defaultValue={agent?.name} required aria-label="Name" />
      <input className="field" name="description" placeholder="One-line role (shown on the card)" defaultValue={agent?.description} aria-label="Description" />
      <textarea className="field min-h-32" name="instructions" placeholder="Instructions: who is this agent and how does it behave?" defaultValue={agent?.instructions} aria-label="Instructions" />
      <label className="block space-y-1 text-sm">
        <span>Model</span>
        <select className="field" name="model" defaultValue={agent?.model ?? ""}>
          <option value="">Default (from Settings)</option>
          {MODELS.map((m) => <option key={m}>{m}</option>)}
        </select>
      </label>
      <fieldset className="space-y-1 text-sm">
        <legend className="mb-1">Tools <span className="text-mute">(UI components are always available)</span></legend>
        {toolNames.map((t) => (
          <label key={t} className="mr-4 inline-flex items-center gap-2 font-mono text-xs">
            <input type="checkbox" name="tools" value={t} defaultChecked={tools.includes(t)} className="accent-current" /> {t}
          </label>
        ))}
      </fieldset>
      <fieldset className="space-y-1 text-sm">
        <legend className="mb-1">Skills</legend>
        {listSkills().map((k) => (
          <label key={k.id} className="mr-4 inline-flex items-center gap-2 font-mono text-xs">
            <input type="checkbox" name="skills" value={k.name} defaultChecked={skills.includes(k.name)} className="accent-current" /> {k.name}
          </label>
        ))}
      </fieldset>
      {servers.length > 0 && (
        <fieldset className="space-y-1 text-sm">
          <legend className="mb-1">MCP servers <span className="text-mute">(each tool call asks for approval)</span></legend>
          {servers.map((m) => (
            <label key={m.id} className="mr-4 inline-flex items-center gap-2 font-mono text-xs">
              <input type="checkbox" name="mcp" value={m.id} defaultChecked={mcp.includes(m.id)} className="accent-current" /> {m.name}
            </label>
          ))}
        </fieldset>
      )}
      <div className="flex gap-2">
        <button className="btn-solid">Save</button>
        {agent && <button className="btn" formAction={deleteAgent.bind(null, agent.id)} formNoValidate>Delete</button>}
      </div>
    </form>
  );
}
