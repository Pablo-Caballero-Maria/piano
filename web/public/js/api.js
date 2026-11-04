// Calls to the backend (web/api/*, Vercel functions + MongoDB Atlas) and the login state.

let user = null;
const listeners = new Set();

/** fetch() a JSON API route; throws Error(message) with .status on failure. */
async function request(method, url, body) {
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
      credentials: "same-origin",
    });
  } catch {
    throw Object.assign(new Error("Can't reach the server. Are you online?"), { status: 0 });
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && user && url !== "/api/auth/login") setUser(null); // session expired
  if (!res.ok) throw Object.assign(new Error(data.error || `Server error (${res.status})`), { status: res.status });
  return data;
}

function setUser(u) {
  user = u;
  for (const fn of listeners) fn(user);
}

export const currentUser = () => user;
/** Call fn(user | null) whenever someone logs in or out. */
export const onAuthChange = (fn) => listeners.add(fn);

/** Ask the server who is logged in (on page load). */
export async function refreshUser() {
  try { setUser((await request("GET", "/api/auth/me")).user); } catch { setUser(null); }
  return user;
}

export async function login(username, password) {
  setUser((await request("POST", "/api/auth/login", { username, password })).user);
}
export async function register(username, password) {
  setUser((await request("POST", "/api/auth/register", { username, password })).user);
}
export async function logout() {
  try { await request("POST", "/api/auth/logout"); } finally { setUser(null); }
}

export const listMelodies = async () => (await request("GET", "/api/melodies")).melodies;
export const getMelody = async (id) => (await request("GET", `/api/melodies/${id}`)).melody;
export const createMelody = async (m) => (await request("POST", "/api/melodies", m)).melody;
export const updateMelody = async (id, m) => (await request("PUT", `/api/melodies/${id}`, m)).melody;
export const deleteMelody = (id) => request("DELETE", `/api/melodies/${id}`);
