import Link from "next/link";
import { logout, updatePassword } from "@/app/login/actions";
import { MIN_PASSWORD } from "@/lib/auth";
import { clearKey, clearThreads, saveGenUi, saveSettings, saveTheme } from "@/lib/actions";
import { parseTheme } from "@/lib/theme";
import { RunsPanel } from "@/components/runs-panel";
import { Members } from "@/components/members";
import { Dialog } from "@/components/dialog";
import { Submit } from "@/components/submit";
import { ThemeSwitch } from "@/components/theme-switch";
import { AnthropicLogo, GithubLogo, OpenAILogo } from "@/components/icons";
import { DEFAULT_WS, getSetting, listMembers, requireAuth } from "@/lib/db";
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
  const [apiKey, openaiKey, githubToken, model, theme, genUi, members] = await Promise.all([
    getSetting("api_key"),
    getSetting("openai_key"),
    getSetting("github_token"),
    getSetting("model", DEFAULT_MODEL),
    getSetting("theme", "{}"),
    getSetting("gen_ui", "on"),
    s.role === "admin" ? listMembers(s.workspace) : [],
  ]);
  const env = s.workspace === DEFAULT_WS; // only the first workspace may fall back to the env keys (envKey)
  return (
    <div className="space-y-6">
      {s.role === "admin" ? (<>
      <div className="grid gap-3 sm:grid-cols-3">
        <Tile logo={<AnthropicLogo />} name="Anthropic" saved={!!apiKey} fromEnv={env && !!process.env.ANTHROPIC_API_KEY} clear={clearKey.bind(null, "api_key")}>
          <input className="field font-mono" name="api_key" type="password" placeholder={apiKey ? "Saved. Paste a new key to replace it" : "sk-ant-…"} autoComplete="off" aria-label="Anthropic API key" />
          <select className="field" name="model" defaultValue={model} aria-label="Model">
            {MODELS.map((m) => <option key={m}>{m}</option>)}
          </select>
        </Tile>
        <Tile logo={<OpenAILogo />} name="OpenAI" saved={!!openaiKey} fromEnv={env && !!process.env.OPENAI_API_KEY} clear={clearKey.bind(null, "openai_key")}
          note="Optional. Adds meaning-based search to your Library; document text and queries are sent to OpenAI.">
          <input className="field font-mono" name="openai_key" type="password" placeholder={openaiKey ? "Saved. Paste a new key to replace it" : "sk-…"} autoComplete="off" aria-label="OpenAI API key" />
        </Tile>
        <Tile logo={<GithubLogo />} name="GitHub" saved={!!githubToken} clear={clearKey.bind(null, "github_token")}
          note="Optional. A read-only token lets Library import docs from private repos. Public repos need none.">
          <input className="field font-mono" name="github_token" type="password" placeholder={githubToken ? "Saved. Paste a new token to replace it" : "github_pat_…"} autoComplete="off" aria-label="GitHub token" />
        </Tile>
      </div>
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

/** An integration: its mark, whether it's connected, and a dialog holding its key. */
function Tile({ logo, name, saved, fromEnv, clear, note, children }: { logo: React.ReactNode; name: string; saved: boolean; fromEnv?: boolean; clear: () => Promise<void>; note?: string; children: React.ReactNode }) {
  const on = saved || fromEnv;
  return (
    <div className="card flex flex-col gap-5 !p-4">
      <div className="flex items-center gap-3">
        {logo}
        <span className="text-sm font-medium">{name}</span>
      </div>
      <div className="mt-auto flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs text-mute">
          <span className={`size-1.5 rounded-full ${on ? "bg-accent" : "bg-line"}`} />
          {on ? "Connected" : "Not set"}
        </span>
        <Dialog label={on ? "Manage" : "Set up"} title={name} className={on ? "btn !py-1 text-xs" : "btn-solid !py-1 text-xs"}>
          <form action={saveSettings} className="space-y-3">
            {children}
            {note && <p className="text-xs text-mute">{note}</p>}
            {fromEnv && !saved && <p className="text-xs text-mute">Using the key from the server environment. A key saved here takes precedence.</p>}
            <p className="text-xs text-mute">Saved encrypted with AUTH_SECRET; change that secret and you&apos;ll need to enter it again.</p>
            <div className="flex gap-2">
              <Submit className="btn-solid">Save</Submit>
              {saved && <Submit className="btn" formAction={clear} formNoValidate>Remove</Submit>}
            </div>
          </form>
        </Dialog>
      </div>
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
