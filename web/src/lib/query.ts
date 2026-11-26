/**
 * TanStack Query's client. What it loads (the server's config, melody lists, the classroom PC's
 * status) is refreshed when something changes it, not on a timer, focus or reconnection; a failed
 * request isn't retried (the API client already says why it failed).
 */
import { QueryClient } from "@tanstack/react-query";

export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, refetchOnWindowFocus: false, refetchOnReconnect: false, retry: false },
      mutations: { retry: false },
    },
  });
}
