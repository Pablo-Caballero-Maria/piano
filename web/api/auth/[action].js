// /api/auth/register, /api/auth/login (POST {username, password}),
// /api/auth/logout (POST) and /api/auth/me (GET: who is logged in).
import { getDb } from "../../lib/db.js";
import { route, body, HttpError } from "../../lib/http.js";
import { hashPassword, verifyPassword, startSession, endSession, currentUser } from "../../lib/auth.js";

const USERNAME = /^[A-Za-z0-9_.-]{3,32}$/;

/** Username and password from the body, checked for shape (not correctness). */
function credentials(req) {
  const { username, password } = body(req);
  if (typeof username !== "string" || !USERNAME.test(username))
    throw new HttpError(400, "The username must be 3-32 letters, digits, _ . or -");
  if (typeof password !== "string" || password.length < 6 || password.length > 200)
    throw new HttpError(400, "The password must be at least 6 characters");
  return { username, password };
}

const publicUser = (u) => ({ id: u._id.toHexString(), username: u.username });

const actions = {
  async register(req, res) {
    const { username, password } = credentials(req);
    const db = await getDb();
    const user = { username, usernameLower: username.toLowerCase(), passwordHash: await hashPassword(password), createdAt: new Date() };
    try {
      user._id = (await db.collection("users").insertOne(user)).insertedId;
    } catch (err) {
      if (err.code === 11000) throw new HttpError(409, "That username is already taken");
      throw err;
    }
    await startSession(db, res, user._id);
    res.statusCode = 201;
    return { user: publicUser(user) };
  },

  async login(req, res) {
    const { username, password } = credentials(req);
    const db = await getDb();
    const user = await db.collection("users").findOne({ usernameLower: username.toLowerCase() });
    if (!user || !(await verifyPassword(password, user.passwordHash)))
      throw new HttpError(401, "Wrong username or password");
    await startSession(db, res, user._id);
    return { user: publicUser(user) };
  },

  async logout(req, res) {
    await endSession(await getDb(), req, res);
    return { ok: true };
  },

  async me(req) {
    const user = await currentUser(await getDb(), req);
    return { user: user && publicUser(user) };
  },
};

export default function handler(req, res) {
  const action = actions[req.query.action];
  if (!action) return res.status(404).json({ error: "Not found" });
  return route({ [action === actions.me ? "GET" : "POST"]: action })(req, res);
}
