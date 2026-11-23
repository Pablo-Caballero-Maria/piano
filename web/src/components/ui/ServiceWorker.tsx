"use client";
/**
 * Registers the service worker (src/sw/worker.ts, served at /serwist/sw.js) in production builds,
 * so the page opens without a connection. Not in `next dev`: its page changes constantly.
 */
import { SerwistProvider } from "@serwist/turbopack/react";
import type { ReactNode } from "react";

export function ServiceWorker({ children }: { children: ReactNode }) {
  return (
    <SerwistProvider
      swUrl="/serwist/sw.js"
      disable={process.env.NODE_ENV !== "production"}
      // Getting the connection back must not reload the page in the middle of a lesson
      reloadOnOnline={false}
      // One page (#piano, #studio): nothing to cache on navigation
      cacheOnNavigation={false}
      options={{ scope: "/", type: "classic" }}
    >
      {children}
    </SerwistProvider>
  );
}
