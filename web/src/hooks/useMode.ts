"use client";

import { useCallback, useEffect, useState } from "react";
import { readItem, STORAGE_KEYS, writeItem } from "@/lib/storage";
import type { Mode } from "@/services/link/messages";

const parseMode = (value: string | null | undefined): Mode | null =>
  value === "piano" || value === "studio" ? value : null;

/**
 * The page's mode (Piano or Studio), in the address (#piano, #studio: links and the back button
 * work) and remembered in this browser. null until the page runs in the browser (the static HTML
 * shows the piano).
 */
export function useMode(): [Mode | null, (mode: Mode) => void] {
  const [mode, setMode] = useState<Mode | null>(null);

  useEffect(() => {
    const fromHash = (hash: string) => parseMode(hash.slice(1));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the address is only known in the browser
    setMode(fromHash(location.hash) ?? parseMode(readItem(STORAGE_KEYS.mode)) ?? "piano");
    // Where the address went (event.newURL), not where it is when the event arrives: the effect
    // below may have rewritten it meanwhile (a link to #studio followed while the page starts)
    const onHashChange = (e: HashChangeEvent) => setMode(fromHash(new URL(e.newURL).hash) ?? "piano");
    addEventListener("hashchange", onHashChange);
    return () => removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    if (!mode) return;
    writeItem(STORAGE_KEYS.mode, mode);
    if (location.hash !== `#${mode}`) history.replaceState(null, "", `#${mode}`);
  }, [mode]);

  return [mode, useCallback((m: Mode) => setMode(m), [])];
}
