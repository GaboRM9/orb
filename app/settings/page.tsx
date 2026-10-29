import Link from "next/link";
import { logout, updatePassword } from "@/app/login/actions";
import { MIN_PASSWORD } from "@/lib/auth";
import { clearThreads, saveGenUi, saveTheme } from "@/lib/actions";
import { parseTheme } from "@/lib/theme";
import { RunsPanel } from "@/components/runs-panel";
import { Members } from "@/components/members";
import { Submit } from "@/components/submit";
import { ThemeSwitch } from "@/components/theme-switch";
import { getSetting, listMembers, requireAuth } from "@/lib/db";
import { DEFAULT_MODEL } from "@/lib/models";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // GitHub import and embedding run inside this page's server actions

export default async function SettingsPage({ searchParams }: PageProps<"/settings">) {
  const { tab, agent, status, view, password } = await searchParams;
  const one = (v: unknown) => (typeof v === "string" && v ? v : undefined);
  const runs = tab === "runs"; // activity is reached by link, not a tab
  return (
    <div className="mx-auto max-w-3xl space-y-6 px-6 py-8 md:px-10 md:py-14">
      <h1>Settings</h1>
      {runs ? (
        <>
          <Link href="/settings" className="block text-xs text-mute hover:text-fg">Back to Settings</Link>
          <RunsPanel view={one(view)} agent={one(agent)} status={one(status)} />
        </>
      ) : (
        <AI password={one(password)} />
      )}
    </div>
  );
}

async function AI({ password }: { password?: string }) {
  const s = await requireAuth();
  const [model, theme, genUi, members] = await Promise.all([
    getSetting("model", DEFAULT_MODEL),
    getSetting("theme", "{}"),
    getSetting("gen_ui", "on"),
    s.role === "admin" ? listMembers(s.workspace) : [],
  ]);
  return (
    <div className="space-y-6">
      {s.role === "admin" ? (<>
      <form action={saveGenUi} className="flex items-center justify-between gap-4 text-sm">
        <span>
          Generative UI
          <span className="mt-0.5 block text-xs text-mute">Answers as cards, options, maps and other interactive views. Off: plain text.</span>
        </span>
        <div className="seg shrink-0">
          {(["on", "off"] as const).map((v) => (
            <button key={v} name="gen_ui" value={v} aria-pressed={(genUi !== "off") === (v === "on")} className="capitalize">{v}</button>
          ))}
        </div>
      </form>
      <section className="space-y-3 border-t border-line pt-6">
        <h2 className="text-sm">Members</h2>
        <Members members={members} me={s.uid} />
      </section>
      </>) : (
        <p className="text-sm text-mute">Model: {model}. API keys, Generative UI and connections are managed by a workspace admin.</p>
      )}
      <form action={saveTheme} className="flex items-center justify-between text-sm">
        <span>Appearance</span>
        <ThemeSwitch mode={parseTheme(theme).mode} />
      </form>
      <Account password={password} />
    </div>
  );
}

const PASSWORD_MESSAGES: Record<string, string> = {
  changed: "Password changed. Other devices are signed out.",
  wrong: "Current password is wrong.",
  short: `Use at least ${MIN_PASSWORD} characters.`,
  mismatch: "The new passwords don't match.",
};

function Account({ password }: { password?: string }) {
  return (
    <div className="space-y-4 border-t border-line pt-6">
      <details className="text-sm" open={!!password}>
        <summary className="cursor-pointer text-mute hover:text-fg">Change password</summary>
        <form action={updatePassword} className="mt-3 max-w-sm space-y-3">
          <input className="field" name="current" type="password" placeholder="Current password" autoComplete="current-password" required aria-label="Current password" />
          <input className="field" name="new" type="password" placeholder="New password" autoComplete="new-password" minLength={MIN_PASSWORD} required aria-label="New password" />
          <input className="field" name="confirm" type="password" placeholder="New password, again" autoComplete="new-password" minLength={MIN_PASSWORD} required aria-label="Confirm new password" />
          {password && PASSWORD_MESSAGES[password] && <p role="status">{PASSWORD_MESSAGES[password]}</p>}
          <Submit className="btn-solid">Change password</Submit>
        </form>
      </details>
      <Link href="/settings?tab=runs" className="block text-sm text-mute hover:text-fg">Activity</Link>
      <div className="flex flex-wrap gap-2">
      <details className="relative">
        <summary className="btn cursor-pointer list-none [&::-webkit-details-marker]:hidden">Delete all chats</summary>
        <form action={clearThreads} className="absolute left-0 z-10 mt-2 w-56 space-y-2 rounded-md border border-line glass p-3 shadow-lg text-sm">
          <p className="text-mute">Every conversation of yours is deleted. Runs are kept.</p>
          <Submit className="btn-solid">Yes, delete all</Submit>
        </form>
      </details>
      <form action={logout}><Submit className="btn">Sign out</Submit></form>
      </div>
    </div>
  );
}
