import Link from "next/link";
import { deleteSkill, saveSkill, toggleSkill } from "@/lib/actions";
import { listSkills } from "@/lib/db";
import { toolNames } from "@/lib/tools";

export const dynamic = "force-dynamic";

type Skill = ReturnType<typeof listSkills>[number];

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
  );
}

export default async function SkillsPage({ searchParams }: PageProps<"/skills">) {
  const { skill, new: isNew } = await searchParams;
  const skills = listSkills();
  return (
    <div className="mx-auto max-w-3xl space-y-6 px-6 py-14 md:px-10">
      <h1>Skills</h1>
      <p className="text-sm text-mute">Reusable instructions an agent loads on demand, with the tools they need. Agents can propose new ones; you approve them.</p>
      <div className="divide-y divide-line border-y border-line">
        {skills.map((s) => {
          const open = String(s.id) === skill;
          const extra = [!s.enabled && "Off", s.source === "agent" && "by agent"].filter(Boolean).join(" · ");
          return (
            <div key={s.id}>
              <Link href={open ? "/skills" : `/skills?skill=${s.id}`} scroll={false} className="block space-y-0.5 py-5">
                <span className="font-mono text-sm">{s.name}</span>
                {extra && <span className="ml-3 text-xs text-mute">{extra}</span>}
                <p className="truncate text-sm text-mute">{s.description}</p>
              </Link>
              {open && <SkillForm cur={s} />}
            </div>
          );
        })}
      </div>
      {isNew ? <SkillForm /> : <Link href="/skills?new=1" className="inline-block text-sm text-mute hover:text-fg">+ New skill</Link>}
    </div>
  );
}
