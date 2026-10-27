"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE, makeToken, SESSION_SECONDS } from "@/lib/auth";
import { db, signIn } from "@/lib/db";

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
  (await cookies()).set(COOKIE, makeToken(user.uid, user.workspace, user.tokenV), {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: SESSION_SECONDS,
  });
  redirect("/agents");
}

export async function logout() {
  (await cookies()).delete(COOKIE);
  redirect("/login");
}
