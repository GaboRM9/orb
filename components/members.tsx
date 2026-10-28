"use client";
import { useState, useTransition } from "react";
import { changeMemberRole, dropMember, inviteMember, resetPassword } from "@/lib/actions";
import type { Member } from "@/lib/db";

type Result = { ok: boolean; text: string; password?: string };

/** Settings → Members (admins): add people, change roles, reset passwords, remove. */
export function Members({ members, me }: { members: Member[]; me: string }) {
  const [res, setRes] = useState<Result>();
  const [busy, start] = useTransition();
  const act = (fn: () => Promise<Result>) => start(async () => setRes(await fn().catch((e: Error) => ({ ok: false, text: e.message }))));
  return (
    <div className="space-y-3">
      <ul className="divide-y divide-line text-sm">
        {members.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center gap-2 py-2">
            <span className="min-w-0 flex-1 truncate">{m.email}{m.id === me && <span className="text-mute"> (you)</span>}</span>
            <select
              className="field w-auto py-1 text-xs"
              aria-label={`Role of ${m.email}`}
              value={m.role}
              disabled={busy}
              onChange={(e) => act(() => changeMemberRole(m.id, e.target.value as Member["role"]))}
            >
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
            {m.id !== me && !m.others && (
              <button className="btn text-xs" disabled={busy} onClick={() => act(() => resetPassword(m.id))}>Reset password</button>
            )}
            {m.id !== me && (
              <button className="btn text-xs" disabled={busy} onClick={() => confirm(`Remove ${m.email}? Their chats stay in Activity.`) && act(() => dropMember(m.id))}>Remove</button>
            )}
          </li>
        ))}
      </ul>
      <form action={(f) => act(() => inviteMember(f))} className="flex flex-wrap gap-2">
        <input className="field min-w-0 flex-1" name="email" type="email" placeholder="name@example.com" required aria-label="Email" autoComplete="off" />
        <select className="field w-auto" name="role" aria-label="Role" defaultValue="member">
          <option value="member">Member</option>
          <option value="admin">Admin</option>
        </select>
        <button className="btn-solid" disabled={busy}>Add</button>
      </form>
      {res && (
        <div role="status" className="text-sm">
          <p className={res.ok ? "" : "text-mute"}>{res.text}</p>
          {res.password && (
            <div className="mt-2 flex items-center gap-2">
              <code className="rounded-md border border-line px-2 py-1 font-mono">{res.password}</code>
              <button className="btn text-xs" onClick={() => navigator.clipboard?.writeText(res.password!).catch(() => {})}>Copy</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
