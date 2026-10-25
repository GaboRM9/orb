import { deleteSkill, saveSkill, toggleSkill } from "@/lib/actions";
import { listSkills } from "@/lib/db";

export const dynamic = "force-dynamic";

export default function SkillsPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-4 p-6">
      <h1 className="text-lg font-semibold">Skills</h1>
      <p className="text-sm text-mute">The model sees only name + description, then calls <code>loadSkill</code> to read the full body when relevant.</p>
      {listSkills().map((s) => (
        <details key={s.id} className="rounded-lg border border-line p-4">
          <summary className="flex cursor-pointer items-center justify-between gap-4">
            <span><span className="font-mono text-sm">{s.name}</span> <span className="text-sm text-mute">— {s.description}</span></span>
            <span className="text-xs text-mute">{s.enabled ? "on" : "off"}</span>
          </summary>
          <form action={saveSkill} className="mt-3 space-y-2">
            <input type="hidden" name="id" value={s.id} />
            <input className="field" name="name" defaultValue={s.name} aria-label="Name" />
            <input className="field" name="description" defaultValue={s.description} aria-label="Description" />
            <textarea className="field min-h-24 font-mono" name="body" defaultValue={s.body} aria-label="Body" />
            <div className="flex gap-2">
              <button className="btn-solid">Save</button>
              <button className="btn" formAction={toggleSkill.bind(null, s.id)}>{s.enabled ? "Disable" : "Enable"}</button>
              <button className="btn" formAction={deleteSkill.bind(null, s.id)}>Delete</button>
            </div>
          </form>
        </details>
      ))}
      <form action={saveSkill} className="space-y-2 rounded-lg border border-dashed border-line p-4">
        <div className="text-sm font-medium">New skill</div>
        <input className="field" name="name" placeholder="kebab-case-name" required />
        <input className="field" name="description" placeholder="When should the model use it?" required />
        <textarea className="field min-h-24 font-mono" name="body" placeholder="Full instructions" required />
        <button className="btn-solid">Add</button>
      </form>
    </div>
  );
}
