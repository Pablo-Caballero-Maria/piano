// User accounts: password hashing (scrypt) and login sessions stored in MongoDB.
// The browser keeps a random session token in an HttpOnly cookie; the database only
// stores its SHA-256, so a leaked sessions collection can't be used to log in.
import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";
import { HttpError, getCookie, setCookie } from "./http.js";

const scrypt = promisify(scryptCb);
const COOKIE = "piano_session";
const SESSION_DAYS = 30;
const KEY_LEN = 32;

/** Hash a password as "scrypt$<salt>$<hash>" (base64url). */
export async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, KEY_LEN);
  return `scrypt$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

/** True if `password` matches a hash made by hashPassword (constant-time compare). */
export async function verifyPassword(password, stored) {
  const [kind, salt, hash] = String(stored).split("$");
  if (kind !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const actual = await scrypt(password, Buffer.from(salt, "base64url"), expected.length);
  return timingSafeEqual(actual, expected);
}

const sha256 = (s) => createHash("sha256").update(s).digest("base64url");

/** Start a session for user `userId` and set its cookie on `res`. */
export async function startSession(db, res, userId) {
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  await db.collection("sessions").insertOne({
    tokenHash: sha256(token),
    userId,
    createdAt: now,
    expiresAt: new Date(now.getTime() + SESSION_DAYS * 86400e3),
  });
  setCookie(res, COOKIE, token, SESSION_DAYS * 86400);
}

/** End the request's session (if any) and clear its cookie. */
export async function endSession(db, req, res) {
  const token = getCookie(req, COOKIE);
  if (token) await db.collection("sessions").deleteOne({ tokenHash: sha256(token) });
  setCookie(res, COOKIE, "", 0);
}

/** The logged-in user as {_id, username}, or null. */
export async function currentUser(db, req) {
  const token = getCookie(req, COOKIE);
  if (!token) return null;
  const session = await db.collection("sessions").findOne({ tokenHash: sha256(token), expiresAt: { $gt: new Date() } });
  if (!session) return null;
  return db.collection("users").findOne({ _id: session.userId }, { projection: { username: 1 } });
}

/** Like currentUser, but a 401 when nobody is logged in. */
export async function requireUser(db, req) {
  const user = await currentUser(db, req);
  if (!user) throw new HttpError(401, "Log in first");
  return user;
}

