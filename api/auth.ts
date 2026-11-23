/**
 * Better Auth on Vercel: every /api/auth/* request (vercel.json sends them here instead of to the
 * Python function, api/index.py). The handler is web/server/auth/vercel.ts; its store is
 * api/index.py's accounts API.
 */
import { handleAuth } from "../web/server/auth/vercel.js";

export const GET = handleAuth;
export const POST = handleAuth;
