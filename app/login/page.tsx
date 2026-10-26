import { login } from "./actions";
import { authConfigured } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { error } = await searchParams;
  return (
    <div className="mx-auto flex h-full max-w-sm flex-col justify-center gap-4 px-6">
      <h1>Sign in</h1>
      {authConfigured() ? (
        <form action={login} className="space-y-3">
          <input className="field" name="password" type="password" placeholder="Password" autoComplete="current-password" autoFocus required aria-label="Password" />
          {error && <p className="text-sm">{error === "locked" ? "Too many attempts. Wait a minute." : "Wrong password."}</p>}
          <button className="btn-solid w-full">Continue</button>
        </form>
      ) : (
        <p className="text-sm text-mute">Set <code>ADMIN_PASSWORD</code> in <code>.env.local</code> and restart the server.</p>
      )}
    </div>
  );
}
