"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE, makeToken, passwordOk, SESSION_SECONDS } from "@/lib/auth";

// ponytail: in-memory throttle (5 misses -> 1 min lock), process-wide; use a shared store if you run several instances
let misses: number[] = [];

export async function login(f: FormData) {
  const now = Date.now();
  misses = misses.filter((t) => now - t < 60_000);
  if (misses.length >= 5) redirect("/login?error=locked");
  if (!passwordOk(String(f.get("password") ?? ""))) {
    misses.push(now);
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
