// Accounts and melodies, stored on the ESP32 (esp32/store.py) and reached over
// Bluetooth (ble.js request()). The login session token is kept in this browser.
import * as ble from "./ble.js";

const SESSION_KEY = "piano-esp32-session"; // {tok, username}
let session = null;
let user = null;
const listeners = new Set();

try { session = JSON.parse(localStorage.getItem(SESSION_KEY)); } catch {}
if (session?.tok && session?.username) user = { username: session.username };
else session = null;

function setUser(u) {
  user = u;
  for (const fn of listeners) fn(user);
}

function saveSession(tok, u) {
  session = tok ? { tok, username: u.username } : null;
  try {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
  } catch {}
  setUser(session ? u : null);
}

/** The logged-in user {username} (remembered in this browser), or null. */
export const currentUser = () => user;
/** Call fn(user | null) whenever someone logs in or out. */
export const onAuthChange = (fn) => listeners.add(fn);

// When the ESP32 connects, check that our session is still valid on that board
ble.onConnectionChange(async (on) => {
  if (!on || !session || !ble.hasStorage()) return;
  try {
    const r = await ble.request("me", { tok: session.tok });
    if (r.user) setUser(r.user);
    else saveSession(null);
  } catch (err) {
    console.warn("Session check failed", err);
  }
});

/**
 * Make sure the ESP32 is connected (opens the Bluetooth chooser if needed).
 * Call it first thing in a click handler: the chooser needs a fresh user gesture.
 */
export async function ensureConnected() {
  if (!ble.connected()) await ble.connect();
  if (!ble.connected()) throw new Error("Not connected to the ESP32");
  if (!ble.hasStorage()) throw new Error("This ESP32 can't store melodies: install the new esp32/main.py and store.py");
}

/** A storage request that needs the login; a 401 means the session is gone. */
async function call(op, args = {}) {
  await ensureConnected();
  if (!session) throw Object.assign(new Error("Log in first"), { status: 401 });
  try {
    return await ble.request(op, { tok: session.tok, ...args });
  } catch (err) {
    if (err.status === 401) saveSession(null);
    throw err;
  }
}

/**
 * The password never leaves the browser: the ESP32 gets PBKDF2-SHA256(password),
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

function checkCredentials(username, password) {
  if (!/^[A-Za-z0-9_.-]{3,32}$/.test(username)) throw new Error("The username must be 3-32 letters, digits, _ . or -");
  if (password.length < 6) throw new Error("The password must be at least 6 characters");
}

async function auth(op, username, password) {
  await ensureConnected(); // first, while the click still counts as a user gesture
  checkCredentials(username, password);
  const r = await ble.request(op, { user: username, key: await passwordKey(username, password) });
  saveSession(r.tok, r.user);
}

export const login = (username, password) => auth("login", username, password);
export const register = (username, password) => auth("register", username, password);

export async function logout() {
  const tok = session?.tok;
  saveSession(null);
  if (tok && ble.hasStorage()) await ble.request("logout", { tok }).catch(() => {});
}

// ---- Melodies ----------------------------------------------------------------------------
// Notes travel and are stored as text, "p:s:d p:s:d …" (MIDI note, start, duration in beats),
// so the ESP32 never has to build big lists in its small memory.
const num = (x) => String(Math.round(x * 1e4) / 1e4);
const encodeNotes = (notes) => notes.map((n) => `${n.p}:${num(n.s)}:${num(n.d)}`).join(" ");
function decodeNotes(text) {
  return text.split(" ").filter(Boolean).map((t) => {
    const [p, s, d] = t.split(":").map(Number);
    return { p, s, d };
  }).filter((n) => Number.isInteger(n.p) && n.s >= 0 && n.d > 0);
}

function toPayload(m) {
  const length = m.notes.reduce((e, n) => Math.max(e, n.s + n.d), 0);
  return { name: m.name, bpm: m.bpm, notes: encodeNotes(m.notes), length };
}

/** Free flash on the ESP32 in KB, from the last melody list (null if unknown). */
export let freeKB = null;

export async function listMelodies() {
  const r = await call("list");
  freeKB = r.free ?? null;
  return r.melodies.map(([id, name, bpm, noteCount, length, updatedAt]) => ({ id, name, bpm, noteCount, length, updatedAt }));
}

export async function getMelody(id) {
  const m = (await call("get", { mid: id })).melody;
  return { ...m, notes: decodeNotes(m.notes) };
}

export const createMelody = async (m) => (await call("create", { melody: toPayload(m) })).melody;
export const updateMelody = async (id, m) => (await call("update", { mid: id, melody: toPayload(m) })).melody;
export const deleteMelody = (id) => call("delete", { mid: id });
