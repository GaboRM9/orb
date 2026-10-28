import { login } from "./actions";
import { authConfigured } from "@/lib/auth";
import { hasUsers } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { error } = await searchParams;
  return (
    <div className="mx-auto flex h-full max-w-sm flex-col justify-center gap-4 px-6">
      <h1>Sign in</h1>
      {!authConfigured() ? (
        <p className="text-sm text-mute">Set <code>AUTH_SECRET</code> in <code>.env.local</code> and restart the server.</p>
      ) : !(await hasUsers()) ? (
        <p className="text-sm text-mute">No users yet. Create the first one with <code>npx tsx scripts/user.mts add you@example.com --admin</code>.</p>
      ) : (
        <form action={login} className="space-y-3">
          <input className="field" name="email" type="email" placeholder="Email" autoComplete="username" autoFocus required aria-label="Email" />
          <input className="field" name="password" type="password" placeholder="Password" autoComplete="current-password" required aria-label="Password" />
          {error && <p className="text-sm">{error === "locked" ? "Too many attempts. Wait a minute." : "Wrong email or password."}</p>}
          <button className="btn-solid w-full">Continue</button>
        </form>
      )}
    </div>
  );
}
