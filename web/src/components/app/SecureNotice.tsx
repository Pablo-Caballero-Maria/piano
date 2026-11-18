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
    <div className="notice">Open this page over https:// (accounts and the class need a secure page).</div>
  );
}
