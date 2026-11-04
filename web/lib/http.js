// Small helpers for the Vercel Node.js functions in web/api/.
// They rely on Vercel's request/response helpers (req.query, req.body, res.status().json()),
// which web/dev-server.mjs also provides locally.

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * Wrap a route: `routes` maps HTTP methods to async (req, res) => data.
 * The returned data is sent as JSON; an HttpError becomes {error} with its status.
 */
export function route(routes) {
  return async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const fn = routes[req.method];
    if (!fn) {
      res.setHeader("Allow", Object.keys(routes).join(", "));
      return res.status(405).json({ error: "Method not allowed" });
    }
    try {
      const data = await fn(req, res); // a route may set res.statusCode (e.g. 201) first
      res.json(data ?? { ok: true });
    } catch (err) {
      if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
      console.error(err);
      res.status(500).json({ error: "Server error, try again" });
    }
  };
}

/** The parsed JSON body as an object (a missing or invalid body is a 400). */
export function body(req) {
  let b;
  try {
    b = req.body; // Vercel parses JSON lazily and throws on invalid JSON
  } catch {
    throw new HttpError(400, "Invalid JSON");
  }
  if (typeof b === "string") {
    try { b = JSON.parse(b); } catch { throw new HttpError(400, "Invalid JSON"); }
  }
  if (!b || typeof b !== "object" || Array.isArray(b)) throw new HttpError(400, "Expected a JSON object");
  return b;
}

/** Value of cookie `name` from the request, or null. */
export function getCookie(req, name) {
  for (const part of (req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

/** Set (maxAge seconds > 0) or clear (maxAge 0) an HttpOnly session-style cookie. */
export function setCookie(res, name, value, maxAge) {
  res.setHeader(
    "Set-Cookie",
    `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`
  );
}
