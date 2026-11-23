"use client";
/** The theme the page shows, for React (it changes when the header's button applies another one). */
import { useSyncExternalStore } from "react";
import { currentTheme, DEFAULT_THEME, type Theme } from "@/lib/theme";

function subscribe(listener: () => void): () => void {
  const observer = new MutationObserver(listener);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}

export function useTheme(): Theme {
  return useSyncExternalStore(
    subscribe,
    () => currentTheme(),
    () => DEFAULT_THEME,
  );
}
