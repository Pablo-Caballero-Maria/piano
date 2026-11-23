"use client";
/** The header's button: switches between the light theme (the default) and the dark one, and remembers it. */
import { useEffect } from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/hooks/useTheme";
import { applyTheme, currentTheme, otherTheme, storeTheme } from "@/lib/theme";
import { button, ICON } from "./classes";

export function ThemeToggle() {
  const theme = useTheme();
  // The <head> script set data-theme; the address bar's colour follows (read from the page: while
  // hydrating, `theme` is still the server's, light).
  useEffect(() => applyTheme(currentTheme()), []);
  const next = otherTheme(theme);
  const label = next === "dark" ? "Dark theme" : "Light theme";
  return (
    <button
      type="button"
      className={button("plain", "icon")}
      aria-label={label}
      title={label}
      onClick={() => {
        applyTheme(next);
        storeTheme(next);
      }}
    >
      {theme === "dark" ? <Sun className={ICON} /> : <Moon className={ICON} />}
    </button>
  );
}
