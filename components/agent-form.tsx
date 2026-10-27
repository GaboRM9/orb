import { deleteAgent, saveAgent } from "@/lib/actions";
import { listMcp, listSkills, type Agent } from "@/lib/db";
import { MODELS } from "@/lib/models";
import { toolNames } from "@/lib/tools";

const Section = ({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) => (
  <section className="space-y-3">
    <h2 className="text-sm font-medium">{title}{hint && <span className="ml-2 font-normal text-mute">{hint}</span>}</h2>
    {children}
  </section>
);

export function AgentForm({ agent }: { agent?: Agent }) {
  const tools: string[] = agent ? JSON.parse(agent.tools_json) : [];
  const skills: string[] = agent ? JSON.parse(agent.skills_json) : [];
  const mcp: string[] = agent ? JSON.parse(agent.mcp_json) : [];
  const servers = listMcp();
  return (
    <form action={saveAgent} className="space-y-10">
      {agent && <input type="hidden" name="id" value={agent.id} />}
      <Section title="Identity">
        <input className="field" name="name" placeholder="Name" defaultValue={agent?.name} required aria-label="Name" />
        <input className="field" name="description" placeholder="One-line role (shown on the card)" defaultValue={agent?.description} aria-label="Description" />
      </Section>
      <Section title="Behavior">
        <textarea className="field min-h-32" name="instructions" placeholder="Instructions: who is this agent and how does it behave?" defaultValue={agent?.instructions} aria-label="Instructions" />
        <label className="block space-y-1 text-sm">
          <span className="text-mute">Model</span>
          <select className="field" name="model" defaultValue={agent?.model ?? ""}>
            <option value="">Default (from Settings)</option>
            {MODELS.map((m) => <option key={m}>{m}</option>)}
          </select>
        </label>
      </Section>
      {/* new agents start with abilities open; existing ones keep them folded and show what they have */}
      <details open={!agent} className="border-t border-line pt-6">
        <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-medium [&::-webkit-details-marker]:hidden">
          <span>Abilities</span>
          <span className="font-mono text-xs font-normal text-mute">{tools.length} tools · {skills.length} skills · {mcp.length} connections</span>
        </summary>
        <div className="mt-6 space-y-8">
          <fieldset className="space-y-2 text-sm">
            <legend className="mb-2 text-mute">Tools <span>(UI components are always available)</span></legend>
            {toolNames.map((t) => (
              <label key={t} className="mr-4 inline-flex items-center gap-2 font-mono text-xs">
                <input type="checkbox" name="tools" value={t} defaultChecked={tools.includes(t)} className="accent-current" /> {t}
              </label>
            ))}
          </fieldset>
          <fieldset className="space-y-2 text-sm">
            <legend className="mb-2 text-mute">Skills</legend>
            {listSkills().map((k) => (
              <label key={k.id} className="mr-4 inline-flex items-center gap-2 font-mono text-xs">
                <input type="checkbox" name="skills" value={k.name} defaultChecked={skills.includes(k.name)} className="accent-current" /> {k.name}
              </label>
            ))}
          </fieldset>
          {servers.length > 0 && (
            <fieldset className="space-y-2 text-sm">
              <legend className="mb-2 text-mute">Connections <span>(each tool call asks for approval)</span></legend>
              {servers.map((m) => (
                <label key={m.id} className="mr-4 inline-flex items-center gap-2 font-mono text-xs">
                  <input type="checkbox" name="mcp" value={m.id} defaultChecked={mcp.includes(m.id)} className="accent-current" /> {m.name}
                </label>
              ))}
            </fieldset>
          )}
        </div>
      </details>
      <div className="sticky bottom-0 border-t border-line bg-bg py-4">
        <button className="btn-solid">Save</button>
      </div>
      {agent && (
        <details className="border-t border-line pt-6 text-sm">
          <summary className="cursor-pointer text-mute hover:text-fg">Danger zone</summary>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
            <p className="text-mute">Deleting removes this agent. Its conversations stay in the sidebar.</p>
            <button className="btn shrink-0" formAction={deleteAgent.bind(null, agent.id)} formNoValidate>Delete agent</button>
          </div>
        </details>
      )}
    </form>
  );
}
