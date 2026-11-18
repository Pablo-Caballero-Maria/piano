"use client";

import { useStore } from "@/hooks/useStore";
import { toastStore } from "@/state/toast";

/** The current toast (state/toast.ts), at the bottom of the screen. */
export function Toaster() {
  const t = useStore(toastStore, null);
  if (!t) return null;
  return (
    <div className="toast" role="status" data-kind={t.kind}>
      {t.message}
    </div>
  );
}
