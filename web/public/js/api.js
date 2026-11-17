// Accounts and melodies through the REST API (pianocore/api.py). The same page talks to the
// teacher's PC in the classroom (data on the classroom board) or to Vercel online (data in
// MongoDB Atlas); /api/config says which. The login session token is kept in this browser.

const SESSION_KEY = "piano-session"; // {token, user: {username, role}}
let session = null;
const listeners = new Set();
let configPromise = null;

try { session = JSON.parse(localStorage.getItem(SESSION_KEY)); } catch {}
if (!session?.token || !session?.user?.username) session = null;

/** {mode: "classroom" | "online", realtime: "ws" | "ably" | null, board?} from the server. */
export function config() {
  configPromise ??= fetch("/api/config", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : { mode: "offline", realtime: null }))
    .catch(() => ({ mode: "offline", realtime: null }));
  return configPromise;
}

/** The logged-in user {username, role} (remembered in this browser), or null. */
export const currentUser = () => session?.user ?? null;
export const token = () => session?.token ?? null;
export const isTeacher = () => session?.user?.role === "teacher";
/** Call fn(user | null) whenever someone logs in or out. */
export const onAuthChange = (fn) => listeners.add(fn);

function setSession(s) {
  session = s;
  try {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
  } catch {}
  for (const fn of listeners) fn(currentUser());
}

/** fetch() /api…, with the session; throws Error(message) with .status on failure. */
async function call(method, path, body) {
  const headers = { "Content-Type": "application/json" };
  if (session) headers.Authorization = `Bearer ${session.token}`;
  let r;
  try {
    r = await fetch(`/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw Object.assign(new Error("Can't reach the server"), { status: 0 });
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (r.status === 401 && session) setSession(null);
    throw Object.assign(new Error(data.error || `Server error ${r.status}`), { status: r.status });
  }
  return data;
}
export const post = (path, body) => call("POST", path, body ?? {});
export const get = (path) => call("GET", path);

/**
 * The password never leaves the browser: the server gets PBKDF2-SHA256(password),
 * salted with the username and stretched 100 000 times (64 hex digits).
 */
async function passwordKey(username, password) {
  const enc = new TextEncoder();
  const base = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: enc.encode(`esp32-piano|${username.toLowerCase()}`), iterations: 100000 },
    base, 256,
  );
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function checkCredentials(username, password) {
  if (!/^[A-Za-z0-9_.-]{3,32}$/.test(username)) throw new Error("The username must be 3-32 letters, digits, _ . or -");
  if (password.length < 6) throw new Error("The password must be at least 6 characters");
}

/** Log in; returns a notice for the user ("" usually). */
export async function login(username, password) {
  checkCredentials(username, password);
  const r = await post("/auth/login", { username, key: await passwordKey(username, password) });
  setSession({ token: r.token, user: r.user });
  return r.notice || "";
}

/** Create an account (role: "teacher" | "student") and log in. */
export async function register(username, password, role) {
  checkCredentials(username, password);
  const r = await post("/auth/register", { username, role, key: await passwordKey(username, password) });
  setSession({ token: r.token, user: r.user });
  return r.notice || "";
}

export function logout() { setSession(null); }

// ---- Melodies ----------------------------------------------------------------------------
// Notes travel and are stored as text, "p:s:d p:s:d …" (MIDI note, start, duration in beats).
const num = (x) => String(Math.round(x * 1e4) / 1e4);
export const encodeNotes = (notes) => notes.map((n) => `${n.p}:${num(n.s)}:${num(n.d)}`).join(" ");
export function decodeNotes(text) {
  return text.split(" ").filter(Boolean).map((t) => {
    const [p, s, d] = t.split(":").map(Number);
    return { p, s, d };
  }).filter((n) => Number.isInteger(n.p) && n.s >= 0 && n.d > 0);
}

function toPayload(m) {
  const length = m.notes.reduce((e, n) => Math.max(e, n.s + n.d), 0);
  return { name: m.name, bpm: m.bpm, notes: encodeNotes(m.notes), length, public: !!m.public };
}

/** scope "mine" (my melodies) or "public" (everyone's public ones). */
export async function listMelodies(scope = "mine") {
  return (await get(`/melodies?scope=${scope}`)).melodies;
}

export async function getMelody(id) {
  const m = (await get(`/melodies/${id}`)).melody;
  return { ...m, notes: decodeNotes(m.notes) };
}

export const createMelody = async (m) => (await post("/melodies", toPayload(m))).melody;
export const updateMelody = async (id, m) => (await call("PUT", `/melodies/${id}`, toPayload(m))).melody;
export const deleteMelody = (id) => call("DELETE", `/melodies/${id}`);
