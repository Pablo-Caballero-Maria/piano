/**
 * What Better Auth needs from the system key (PIANO_DATA_KEY, the same on every teacher's PC and on
 * Vercel), derived exactly as pianocore/crypto.py does: HKDF-SHA256 with the salt "esp32-piano" and
 * one purpose per key. Both sides must agree, or a session signed here wouldn't be accepted by the
 * Python API (tests check it against fixed values computed by the Python side).
 */
import { createHmac, hkdfSync } from "node:crypto";

const SALT = "esp32-piano";

export interface SystemKeys {
  /** Better Auth's `secret` (it signs the session tokens). */
  secret: string;
  /** What the store sends in X-Piano-Internal to the accounts API. */
  internalToken: string;
  /** The stored id of a username (case-insensitive): pianocore's Keys.user_id. */
  userId(username: string): string;
}

const b64url = (data: Buffer): string => data.toString("base64url");

export function systemKeys(dataKey: string): SystemKeys {
  const master = Buffer.from(dataKey.trim(), "base64");
  if (master.length !== 32) throw new Error("PIANO_DATA_KEY must be 32 bytes in base64");
  const derive = (purpose: string) => Buffer.from(hkdfSync("sha256", master, SALT, purpose, 32));
  const ids = derive("ids");
  return {
    secret: b64url(derive("better-auth")),
    internalToken: b64url(derive("internal")),
    userId: (username) => createHmac("sha256", ids).update(username.toLowerCase()).digest("hex").slice(0, 32),
  };
}
