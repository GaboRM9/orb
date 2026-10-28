import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { secret } from "./secret";

export const COOKIE = "orb_session";
export const SESSION_SECONDS = 7 * 24 * 3600;

// Users sign in with email + password (users table). Sessions are stateless HMAC tokens, uid.workspace.token_v.exp.sig,
// signed with AUTH_SECRET (or ADMIN_PASSWORD locally; on Vercel AUTH_SECRET is required). No database here, so the
// proxy can check signatures; membership and token_v are checked against the database in lib/db.ts (sessionFor).
export const authConfigured = () => !!secret();
const mac = (s: string) => createHmac("sha256", secret()).update(s).digest("base64url");
const same = (a: string, b: string) => timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());

// User passwords: scrypt with a per-user salt, stored as "scrypt:<salt>:<hash>".
export function hashPassword(p: string) {
  const salt = randomBytes(16);
  return `scrypt:${salt.toString("base64url")}:${scryptSync(p, salt, 64).toString("base64url")}`;
}
export function checkPassword(p: string, stored: string) {
  const [kind, salt, hash] = stored.split(":");
  if (kind !== "scrypt" || !salt || !hash) return false;
  const want = Buffer.from(hash, "base64url");
  return timingSafeEqual(scryptSync(p, Buffer.from(salt, "base64url"), want.length), want);
}

export function makeToken(uid: string, workspace: string, tokenV: number) {
  const body = `${uid}.${workspace}.${tokenV}.${Math.floor(Date.now() / 1000) + SESSION_SECONDS}`;
  return `${body}.${mac(body)}`;
}

/** The signed claims of an unexpired token. Fails closed: no secret configured means no valid tokens. */
export function parseToken(token?: string) {
  if (!token || !authConfigured()) return null;
  const parts = token.split(".");
  if (parts.length !== 5) return null;
  const [uid, workspace, tokenV, exp, sig] = parts;
  if (!(Number(exp) > Date.now() / 1000) || !same(sig, mac(parts.slice(0, 4).join(".")))) return null;
  return { uid, workspace, tokenV: Number(tokenV) };
}

export const verifyToken = (token?: string) => !!parseToken(token);

/** For route handlers: the session token from a raw Cookie header. */
export const cookieToken = (req: Request) => req.headers.get("cookie")?.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`))?.[1];
