import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

// Encrypts stored credentials (API key, MCP auth headers) with AES-256-GCM. The key comes from AUTH_SECRET (or ADMIN_PASSWORD),
// so changing it makes saved secrets unreadable: open() returns null and the user re-enters them.
const PREFIX = "enc:v1:";
const secret = () => process.env.AUTH_SECRET || process.env.ADMIN_PASSWORD || "";
const key = () => scryptSync(secret(), "orbz-secrets-v1", 32);

export const isSealed = (v: string) => v.startsWith(PREFIX);

export function seal(plain: string) {
  if (!secret()) return plain; // no secret configured: nobody can sign in anyway
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return PREFIX + Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64url");
}

/** Plaintext from before encryption passes through; a wrong secret or tampered value gives null. */
export function open(stored: string) {
  if (!isSealed(stored)) return stored;
  try {
    const b = Buffer.from(stored.slice(PREFIX.length), "base64url");
    const d = createDecipheriv("aes-256-gcm", key(), b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}
