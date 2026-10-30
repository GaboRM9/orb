import { demoLogin, login, setup } from "./actions";
import { authConfigured, MIN_PASSWORD } from "@/lib/auth";
import { demoOn, hasUsers } from "@/lib/db";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  locked: "Too many attempts. Wait a minute.",
  secret: "That isn't this deployment's AUTH_SECRET.",
  short: `Use at least ${MIN_PASSWORD} characters.`,
  taken: "Setup is already done. Sign in instead.",
  "demo-full": "The demo is busy right now. Try again later.",
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { error } = await searchParams;
  const message = error && (ERRORS[String(error)] ?? "Wrong email or password.");
  const firstRun = authConfigured() && !(await hasUsers());
  return (
    <div className="mx-auto flex h-full max-w-sm flex-col justify-center gap-4 px-6">
      <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="7" className="halo mx-auto size-64 max-w-full" aria-hidden>
        <circle cx="32" cy="32" r="24" pathLength="1" />
      </svg>
      <h1>{firstRun ? "Set up orb" : "Sign in"}</h1>
      {!authConfigured() ? (
        <p className="text-sm text-mute">Set <code>AUTH_SECRET</code> in <code>.env.local</code> and restart the server.</p>
      ) : firstRun ? (
        <form action={setup} className="space-y-3">
          <p className="text-sm text-mute">Create the admin account. Paste the <code>AUTH_SECRET</code> you set, so only whoever deployed this can claim it.</p>
          <input className="field" name="secret" type="password" placeholder="AUTH_SECRET" autoComplete="off" autoFocus required aria-label="AUTH_SECRET" />
          <input className="field" name="email" type="email" placeholder="Your email" autoComplete="username" required aria-label="Email" />
          <input className="field" name="password" type="password" placeholder="Choose a password" autoComplete="new-password" minLength={MIN_PASSWORD} required aria-label="Password" />
          {message && <p className="text-sm">{message}</p>}
          <button className="btn-solid w-full">Create admin</button>
        </form>
      ) : (
        <>
          <form action={login} className="space-y-3">
            <input className="field" name="email" type="email" placeholder="Email" autoComplete="username" autoFocus required aria-label="Email" />
            <input className="field" name="password" type="password" placeholder="Password" autoComplete="current-password" required aria-label="Password" />
            {message && <p className="text-sm">{message}</p>}
            <button className="btn-solid w-full">Continue</button>
          </form>
          {demoOn() && (
            <form action={demoLogin}>
              <button className="btn w-full">Try the demo</button>
            </form>
          )}
        </>
      )}
    </div>
  );
}
