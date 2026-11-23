/**
 * Better Auth's password hasher for piano. The browser never sends the password: it sends a key
 * derived from it (PBKDF2, web/src/lib/credentials.ts), and the store keeps sha256(salt + key)
 * with a random 16-byte salt — the same scheme as before Better Auth, so existing accounts keep
 * signing in. Stored as "<salt hex>:<hash hex>" in Better Auth's credential account.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** What the browser sends as the password: 64 hex digits. */
export const PASSWORD_KEY = /^[0-9a-f]{64}$/;

const digest = (salt: string, key: string): string =>
  createHash("sha256").update(Buffer.from(salt, "hex")).update(key).digest("hex");

export function joinHash(salt: string, hash: string): string {
  return `${salt}:${hash}`;
}

export function splitHash(stored: string): { salt: string; hash: string } {
  const [salt = "", hash = ""] = stored.split(":");
  return { salt, hash };
}

export async function hashPasswordKey(key: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  return joinHash(salt, digest(salt, key));
}

export async function verifyPasswordKey({
  hash,
  password,
}: {
  hash: string;
  password: string;
}): Promise<boolean> {
  const stored = splitHash(hash);
  if (!/^[0-9a-f]{32}$/.test(stored.salt) || !/^[0-9a-f]{64}$/.test(stored.hash)) return false;
  return timingSafeEqual(Buffer.from(digest(stored.salt, password), "hex"), Buffer.from(stored.hash, "hex"));
}
