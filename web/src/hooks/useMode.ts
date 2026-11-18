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
    const fromAddress = () => parseMode(location.hash.slice(1));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the address is only known in the browser
    setMode(fromAddress() ?? parseMode(readItem(STORAGE_KEYS.mode)) ?? "piano");
    const onHashChange = () => setMode(fromAddress() ?? "piano");
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
