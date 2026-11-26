"use client";

/**
 * What the page runs inside: TanStack Query's client (lib/query.ts), motion (only its basic
 * animation features, loaded once; none when the system asks for reduced motion) and the service
 * worker's registration.
 */
import { QueryClientProvider } from "@tanstack/react-query";
import { LazyMotion, MotionConfig, domAnimation } from "motion/react";
import { type ReactNode, useState } from "react";
import { makeQueryClient } from "@/lib/query";
import { ServiceWorker } from "./ServiceWorker";

export function Providers({ children }: { children: ReactNode }) {
  // One client for the page, created on its first render.
  const [queryClient] = useState(makeQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      <MotionConfig reducedMotion="user">
        <LazyMotion features={domAnimation} strict>
          <ServiceWorker>{children}</ServiceWorker>
        </LazyMotion>
      </MotionConfig>
    </QueryClientProvider>
  );
}
