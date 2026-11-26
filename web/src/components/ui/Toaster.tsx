"use client";

import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { useStore } from "@/hooks/useStore";
import { toastMotion } from "@/lib/motion";
import { toastStore } from "@/state/toast";

/**
 * The current toast (state/toast.ts), at the bottom of the screen. It comes up gently and goes
 * back down; a new message replaces the old one the same way.
 */
export function Toaster() {
  const t = useStore(toastStore, null);
  return (
    <AnimatePresence>
      {t && (
        <m.div
          key={t.id}
          {...toastMotion}
          className={`fixed bottom-[calc(16px_+_env(safe-area-inset-bottom))] left-1/2 z-100 max-w-[calc(100vw_-_32px)] -translate-x-1/2 rounded-[10px] border bg-raised px-3.5 py-2.5 text-[14px] shadow-[0_6px_20px_rgba(0,0,0,0.4)] ${t.kind === "error" ? "border-err text-danger" : "border-line"}`}
          role="status"
          data-kind={t.kind}
        >
          {t.message}
        </m.div>
      )}
    </AnimatePresence>
  );
}
