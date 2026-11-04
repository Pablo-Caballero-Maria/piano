// Local stand-in for Vercel: serves public/ and runs the functions in api/ with the
// same file-based routes ([param].js) and the request/response helpers they use.
// Usage (from web/):  npm run dev   → http://localhost:3000
// Reads MONGODB_URI from web/.env.local (not in git).
import http from "node:http";
import { readFile, readdir, stat } from "node:fs/promises";
import { join, extname, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
try { process.loadEnvFile(join(ROOT, ".env.local")); } catch { console.warn("No web/.env.local: the API will fail without MONGODB_URI"); }

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json" };

/** All api/**.js files as routes: {regex, params, file}, static paths before [dynamic] ones. */
async function findRoutes(dir = join(ROOT, "api")) {
  const routes = [];
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".js")) continue;
    const file = join(entry.parentPath, entry.name);
    const parts = relative(ROOT, file).slice(0, -3).split(sep);
    if (parts.at(-1) === "index") parts.pop();
    const params = [];
    const re = parts.map((p) => {
      const m = /^\[(\w+)\]$/.exec(p);
      if (!m) return p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      params.push(m[1]);
      return "([^/]+)";
    });
    routes.push({ regex: new RegExp(`^/${re.join("/")}/?$`), params, file, dynamic: params.length });
  }
  return routes.sort((a, b) => a.dynamic - b.dynamic);
}

/** Add the Vercel helpers (req.query, req.body, res.status/json/send) and call the function. */
async function runFunction(route, match, req, res, url) {
  const query = Object.fromEntries(url.searchParams);
  route.params.forEach((p, i) => (query[p] = decodeURIComponent(match[i + 1])));
  req.query = query;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString();
  Object.defineProperty(req, "body", {
    get() {
      if (!raw) return undefined;
      if ((req.headers["content-type"] || "").includes("application/json")) return JSON.parse(raw);
      return raw;
    },
  });
  res.status = (code) => ((res.statusCode = code), res);
  res.json = (obj) => (res.setHeader("Content-Type", "application/json; charset=utf-8"), res.end(JSON.stringify(obj)));
  res.send = (b) => res.end(b);
  const mod = await import(pathToFileURL(route.file).href + `?t=${(await stat(route.file)).mtimeMs}`);
  await mod.default(req, res);
}

const routes = await findRoutes();

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const t0 = Date.now();
    try {
      if (url.pathname.startsWith("/api/")) {
        for (const r of routes) {
          const m = r.regex.exec(url.pathname);
          if (m) return await runFunction(r, m, req, res, url);
        }
        res.statusCode = 404;
        return res.end("No such function");
      }
      let path = join(ROOT, "public", decodeURIComponent(url.pathname));
      if (!path.startsWith(join(ROOT, "public"))) throw Object.assign(new Error(), { code: "ENOENT" });
      if ((await stat(path).catch(() => null))?.isDirectory()) path = join(path, "index.html");
      const data = await readFile(path);
      res.setHeader("Content-Type", MIME[extname(path)] || "application/octet-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.end(data);
    } catch (err) {
      if (err.code !== "ENOENT") console.error(err);
      if (!res.headersSent) res.statusCode = err.code === "ENOENT" ? 404 : 500;
      res.end();
    } finally {
      if (url.pathname.startsWith("/api/")) console.log(req.method, url.pathname, res.statusCode, `${Date.now() - t0} ms`);
    }
  })
  .listen(PORT, () => console.log(`Dev server: http://localhost:${PORT}`));
