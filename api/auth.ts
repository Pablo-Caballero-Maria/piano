/**
 * Better Auth on Vercel: every /api/auth/* request (vercel.json sends them here instead of to the
 * Python function, api/index.py). The handler is web/server/auth/vercel.ts; its store is
 * api/index.py's accounts API.
 *
 * Vercel builds this file as CommonJS and web/server as ES modules (web/ is "type": "module"), and its
 * runtime can't require() an ES module: the handler is loaded with import() instead (TypeScript keeps
 * dynamic imports in CommonJS output, and Vercel's file tracing still follows them).
 */
const loaded = import("../web/server/auth/vercel.js");

export async function GET(request: Request): Promise<Response> {
  return (await loaded).handleAuth(request);
}

export async function POST(request: Request): Promise<Response> {
  return (await loaded).handleAuth(request);
}
