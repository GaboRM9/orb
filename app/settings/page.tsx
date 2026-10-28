import Link from "next/link";
import { logout, updatePassword } from "@/app/login/actions";
import { MIN_PASSWORD } from "@/lib/auth";
import { clearKey, clearOpenAIKey, clearThreads, saveGenUi, saveSettings, saveTheme } from "@/lib/actions";
import { parseTheme } from "@/lib/theme";
import { RunsPanel } from "@/components/runs-panel";
import { getSetting } from "@/lib/db";
import { DEFAULT_MODEL, MODELS } from "@/lib/models";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // GitHub import and embedding run inside this page's server actions

export default async function SettingsPage({ searchParams }: PageProps<"/settings">) {
  const { tab, agent, status, view, password } = await searchParams;
  const one = (v: unknown) => (typeof v === "string" && v ? v : undefined);
  const runs = tab === "runs"; // activity is reached by link, not a tab
  return (
    <div className="mx-auto max-w-3xl space-y-6 px-6 py-14 md:px-10">
      <h1>Settings</h1>
      {runs ? (
        <>
          <Link href="/settings" className="block text-xs text-mute hover:text-fg">← Settings · Activity</Link>
          <RunsPanel view={one(view)} agent={one(agent)} status={one(status)} />
        </>
      ) : (
        <AI password={one(password)} />
      )}
    </div>
  );
}

async function AI({ password }: { password?: string }) {
  const hasKey = !!(await getSetting("api_key"));
  const hasOpenAI = !!(await getSetting("openai_key"));
  const model = await getSetting("model", DEFAULT_MODEL);
  const theme = parseTheme(await getSetting("theme", "{}"));
  const genUi = (await getSetting("gen_ui", "on")) !== "off";
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
          <span>OpenAI API key, for searching your Library {hasOpenAI ? <span className="text-mute">(saved — leave blank to keep)</span> : <span className="text-mute">(optional, or set OPENAI_API_KEY; keyword search works without it)</span>}</span>
          <input className="field font-mono" name="openai_key" type="password" placeholder="sk-…" autoComplete="off" />
        </label>
        <div className="flex gap-2">
          <button className="btn-solid">Save</button>
          {hasKey && <button className="btn" formAction={clearKey}>Remove saved key</button>}
          {hasOpenAI && <button className="btn" formAction={clearOpenAIKey}>Remove OpenAI key</button>}
        </div>
      </form>
      <p className="text-xs text-mute">The key is encrypted in data/app.db with AUTH_SECRET (or ADMIN_PASSWORD). Change that secret and you will need to re-enter it.</p>
      <form action={saveGenUi} className="flex items-center justify-between gap-4 text-sm">
        <span>
          Generative UI <span className="chip ml-1 border-accent">Beta</span>
          <span className="mt-0.5 block text-xs text-mute">Answers as cards, options, maps and other interactive views. Off: plain text.</span>
        </span>
        <div className="seg shrink-0">
          {(["on", "off"] as const).map((v) => (
            <button key={v} name="gen_ui" value={v} aria-pressed={genUi === (v === "on")} className="capitalize">{v}</button>
          ))}
        </div>
      </form>
      <form action={saveTheme} className="flex items-center justify-between text-sm">
        <span>Appearance</span>
        <div className="seg">
          {(["system", "light", "dark"] as const).map((m) => (
            <button key={m} name="mode" value={m} aria-pressed={theme.mode === m} className="capitalize">{m}</button>
          ))}
        </div>
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
          <button className="btn-solid">Change password</button>
        </form>
      </details>
      <Link href="/settings?tab=runs" className="block text-sm text-mute hover:text-fg">Activity →</Link>
      <div className="flex flex-wrap gap-2">
      <details className="relative">
        <summary className="btn cursor-pointer list-none [&::-webkit-details-marker]:hidden">Delete all chats</summary>
        <form action={clearThreads} className="absolute left-0 z-10 mt-2 w-56 space-y-2 rounded-md border border-line glass p-3 shadow-lg text-sm">
          <p className="text-mute">Every conversation is deleted. Runs are kept.</p>
          <button className="btn-solid">Yes, delete all</button>
        </form>
      </details>
      <form action={logout}><button className="btn">Sign out</button></form>
      </div>
    </div>
  );
}
