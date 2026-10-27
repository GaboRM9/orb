import Link from "next/link";
import { deleteSkill, saveSkill, toggleSkill } from "@/lib/actions";
import { listSkills } from "@/lib/db";
import { toolNames } from "@/lib/tools";
import { Tile, TileGrid } from "@/components/tile";

export const dynamic = "force-dynamic";

export default async function SkillsPage({ searchParams }: PageProps<"/skills">) {
  const { skill, new: isNew } = await searchParams;
  const skills = listSkills();
  const cur = skills.find((s) => String(s.id) === skill);
  const have: string[] = cur ? JSON.parse(cur.tools_json) : [];
  return (
    <div className="mx-auto max-w-3xl space-y-6 px-6 py-14 md:px-10">
      <h1>Skills</h1>
      <p className="text-sm text-mute">Reusable instructions an agent loads on demand, with the tools they need. Agents can propose new ones; you approve them.</p>
      <TileGrid>
        {skills.map((s) => (
          <Tile key={s.id} href={`/skills?skill=${s.id}`} title={s.name} desc={s.description} active={cur?.id === s.id}
            tag={[s.enabled ? "On" : "Off", s.source === "agent" && "by agent", JSON.parse(s.tools_json).length && `${JSON.parse(s.tools_json).length} tools`].filter(Boolean).join(" · ")} />
        ))}
        <Tile href="/skills?new=1" title="+ New skill" desc="Name it, say when to use it, list the steps and tools." active={!!isNew} />
      </TileGrid>
      {(cur || isNew) && (
        <form action={saveSkill} className="space-y-3 border-t border-line pt-6">
          {cur && <input type="hidden" name="id" value={cur.id} />}
          <input className="field" name="name" defaultValue={cur?.name} placeholder="kebab-case-name" required aria-label="Name" />
          <input className="field" name="description" defaultValue={cur?.description} placeholder="When should the model use it?" required aria-label="Description" />
          <textarea className="field min-h-32 font-mono" name="body" defaultValue={cur?.body} placeholder="Full instructions" required aria-label="Body" />
          <fieldset className="text-sm">
            <legend className="mb-1 text-mute">Tools it needs</legend>
            {toolNames.map((t) => (
              <label key={t} className="mr-4 inline-flex items-center gap-2 font-mono text-xs">
                <input type="checkbox" name="tools" value={t} defaultChecked={have.includes(t)} className="accent-current" /> {t}
              </label>
            ))}
          </fieldset>
          <div className="flex items-center gap-2">
            <button className="btn-solid">Save</button>
            {cur && <button className="btn" formAction={toggleSkill.bind(null, cur.id)} formNoValidate>{cur.enabled ? "Disable" : "Enable"}</button>}
            {cur && <button className="btn" formAction={deleteSkill.bind(null, cur.id)} formNoValidate>Delete</button>}
            <Link href="/skills" className="ml-auto text-xs text-mute hover:text-fg">Close</Link>
          </div>
        </form>
      )}
    </div>
  );
}
