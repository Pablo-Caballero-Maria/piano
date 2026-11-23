"use client";

/** A warning when the page isn't on https:// (the browser then blocks what accounts need). */
import { useSyncExternalStore } from "react";

const noop = () => () => {};

export function SecureNotice() {
  const insecure = useSyncExternalStore(
    noop,
    () => !window.isSecureContext,
    () => false,
  );
  if (!insecure) return null;
  return (
    <div className="mx-4 mb-2 rounded-[10px] border border-warm-line bg-warm-bg px-3 py-2.5 text-[14px] leading-[1.4] text-warm-fg">
      Open this page over https:// (accounts and the class need a secure page).
    </div>
  );
}
