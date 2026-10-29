"use server";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE, makeToken, MIN_PASSWORD, ownsDeployment, SESSION_SECONDS } from "@/lib/auth";
import { addGuest, changePassword, createFirstAdmin, db, demoOn, requireAuth, signIn } from "@/lib/db";

// Failed sign-ins live in the database so the throttle holds across serverless instances: 5 misses lock an email for a
// minute, 20 misses lock the IP (x-forwarded-for, set by Vercel) for a minute, so one client can't walk many accounts.
// ponytail: an email can still be locked out by anyone guessing it; a CAPTCHA or per-device trust if that gets abused.
const EMAIL_MISSES = 5;
const IP_MISSES = 20;
const clientIp = async () => (await headers()).get("x-forwarded-for")?.split(",")[0].trim() || null;
// a locked email or IP redirects; otherwise returns the miss to log on failure
async function throttle(email: string) {
  const ip = await clientIp();
  const now = Date.now();
  await db.prepare("delete from login_misses where t < ?").run(now - 60_000);
  const n = (await db.prepare("select count(*) filter (where email=@email) email, count(*) filter (where ip=@ip) ip from login_misses").get({ email, ip })) as { email: number; ip: number };
  if (n.email >= EMAIL_MISSES || n.ip >= IP_MISSES) redirect("/login?error=locked");
  return () => db.prepare("insert into login_misses (t, email, ip) values (?,?,?)").run(now, email, ip);
}

export async function login(f: FormData) {
  const email = String(f.get("email") ?? "").trim().toLowerCase();
  const miss = await throttle(email);
  const user = await signIn(email, String(f.get("password") ?? ""));
  if (!user) {
    await miss();
    redirect("/login?error=1");
  }
  await setSession(user.uid, user.workspace, user.tokenV);
  redirect("/agents");
}

/** First run, no users yet: pasting AUTH_SECRET proves you deployed this, and you become its admin. */
export async function setup(f: FormData) {
  const miss = await throttle("setup"); // secret guesses share the sign-in throttle
  if (!ownsDeployment(String(f.get("secret") ?? ""))) {
    await miss();
    redirect("/login?error=secret");
  }
  const password = String(f.get("password") ?? "");
  if (password.length < MIN_PASSWORD) redirect("/login?error=short");
  const user = await createFirstAdmin(String(f.get("email") ?? ""), password);
  if (!user) redirect("/login?error=taken");
  await setSession(user.uid, user.workspace, user.tokenV);
  redirect("/settings");
}

/** DEMO=1: a fresh read-only guest per visitor. */
export async function demoLogin() {
  if (!demoOn()) redirect("/login");
  const user = await addGuest(await clientIp());
  if (!user) redirect("/login?error=demo-full");
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
