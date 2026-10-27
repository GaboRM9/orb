import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { secret } from "./secret";
import { redirect } from "next/navigation";

export const COOKIE = "orb_session";
export const SESSION_SECONDS = 7 * 24 * 3600;

// Single admin: ADMIN_PASSWORD gates the whole app. Sessions are stateless HMAC tokens signed with AUTH_SECRET (or the password, except on Vercel, where AUTH_SECRET is required).
// ponytail: one shared admin, no users table; swap for a provider (Clerk/Auth0) when you need per-user accounts or roles.
export const authConfigured = () => !!process.env.ADMIN_PASSWORD && !!secret();
const mac = (s: string) => createHmac("sha256", secret()).update(s).digest("base64url");
const same = (a: string, b: string) => timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());

export const passwordOk = (p: string) => authConfigured() && same(p, process.env.ADMIN_PASSWORD!);

export function makeToken() {
  const exp = String(Math.floor(Date.now() / 1000) + SESSION_SECONDS);
  return `${exp}.${mac(exp)}`;
}

/** Fails closed: no ADMIN_PASSWORD configured means nobody gets in. */
export function verifyToken(token?: string) {
  if (!token || !authConfigured()) return false;
  const [exp, sig] = token.split(".");
  return !!sig && Number(exp) > Date.now() / 1000 && same(sig, mac(exp));
}

/** For route handlers: read the session from a raw Cookie header. */
export const requestAuthed = (req: Request) =>
  verifyToken(req.headers.get("cookie")?.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`))?.[1]);

export async function isAuthed() {
  return verifyToken((await cookies()).get(COOKIE)?.value);
}

/** Call first in every server action: the proxy is only the first line of defense. */
export async function requireAuth() {
  if (!(await isAuthed())) redirect("/login");
}
