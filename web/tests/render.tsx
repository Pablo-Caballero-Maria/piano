/**
 * @testing-library/react's render, inside the providers the page has (TanStack Query, with a new
 * client for each test so nothing is cached between tests).
 */
import { QueryClientProvider } from "@tanstack/react-query";
import { render as baseRender, type RenderOptions } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { makeQueryClient } from "@/lib/query";

export * from "@testing-library/react";

export function render(ui: ReactElement, options?: Omit<RenderOptions, "wrapper">) {
  const client = makeQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { ...baseRender(ui, { wrapper, ...options }), queryClient: client };
}
