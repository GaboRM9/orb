"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE, makeToken, MIN_PASSWORD, SESSION_SECONDS } from "@/lib/auth";
import { changePassword, db, requireAuth, signIn } from "@/lib/db";

// Failed sign-ins live in the database so the throttle (5 misses -> 1 min lock) holds across serverless instances.
// ponytail: per email, not per IP; a determined guesser can keep one account locked out for a minute at a time.
export async function login(f: FormData) {
  const email = String(f.get("email") ?? "").trim().toLowerCase();
  const now = Date.now();
  await db.prepare("delete from login_misses where t < ?").run(now - 60_000);
  if (((await db.prepare("select count(*) n from login_misses where email=?").get(email)) as { n: number }).n >= 5) redirect("/login?error=locked");
  const user = await signIn(email, String(f.get("password") ?? ""));
  if (!user) {
    await db.prepare("insert into login_misses (t, email) values (?,?)").run(now, email);
    redirect("/login?error=1");
  }
  await setSession(user.uid, user.workspace, user.tokenV);
  redirect("/agents");
}

const setSession = async (uid: string, workspace: string, tokenV: number) =>
  (await cookies()).set(COOKIE, makeToken(uid, workspace, tokenV), {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: SESSION_SECONDS,
  });

/** Settings → Change password. Other devices are signed out; this one gets a fresh session. */
export async function updatePassword(f: FormData) {
  const s = await requireAuth();
  const back = (result: string): never => redirect(`/settings?password=${result}`);
  const next = String(f.get("new") ?? "");
  if (next.length < MIN_PASSWORD) back("short");
  if (next !== String(f.get("confirm") ?? "")) back("mismatch");
  const tokenV = await changePassword(s.uid, String(f.get("current") ?? ""), next);
  if (tokenV === null) back("wrong");
  await setSession(s.uid, s.workspace, tokenV!);
  back("changed");
}

export async function logout() {
  (await cookies()).delete(COOKIE);
  redirect("/login");
}
