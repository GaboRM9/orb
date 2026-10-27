"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE, makeToken, passwordOk, SESSION_SECONDS } from "@/lib/auth";
import { db } from "@/lib/db";

// Failed sign-ins live in the database so the throttle (5 misses -> 1 min lock) holds across serverless instances.
// ponytail: one global counter, not per IP; a determined guesser can keep the admin locked out for a minute at a time.
export async function login(f: FormData) {
  const now = Date.now();
  await db.prepare("delete from login_misses where t < ?").run(now - 60_000);
  if (((await db.prepare("select count(*) n from login_misses").get()) as { n: number }).n >= 5) redirect("/login?error=locked");
  if (!passwordOk(String(f.get("password") ?? ""))) {
    await db.prepare("insert into login_misses (t) values (?)").run(now);
    redirect("/login?error=1");
  }
  (await cookies()).set(COOKIE, makeToken(), {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: SESSION_SECONDS,
  });
  redirect("/agents");
}

export async function logout() {
  (await cookies()).delete(COOKIE);
  redirect("/login");
}
