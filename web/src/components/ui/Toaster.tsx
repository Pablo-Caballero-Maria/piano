"use client";

import { useStore } from "@/hooks/useStore";
import { toastStore } from "@/state/toast";

/** The current toast (state/toast.ts), at the bottom of the screen. */
export function Toaster() {
  const t = useStore(toastStore, null);
  if (!t) return null;
  return (
    <div
      className={`fixed bottom-[calc(16px_+_env(safe-area-inset-bottom))] left-1/2 z-100 max-w-[calc(100vw_-_32px)] -translate-x-1/2 rounded-[10px] border bg-[#2a2f37] px-3.5 py-2.5 text-[14px] shadow-[0_6px_20px_rgba(0,0,0,0.4)] ${t.kind === "error" ? "border-err text-[#ffb3b5]" : "border-line"}`}
      role="status"
      data-kind={t.kind}
    >
      {t.message}
    </div>
  );
}
