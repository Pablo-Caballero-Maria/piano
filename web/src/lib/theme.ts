/**
 * The colour theme: light unless the dark one is chosen (the button in the header), remembered in
 * this browser and applied as <html data-theme="…">, which the colours in globals.css follow.
 * The inline script in layout.tsx applies a remembered choice before the first paint, so the page
 * never flashes the other theme.
 */
import { readItem, STORAGE_KEYS, writeItem } from "./storage";

export type Theme = "light" | "dark";

export const DEFAULT_THEME: Theme = "light";

/** The page's background in each theme (globals.css → --color-bg), for the phone's address bar. */
export const THEME_COLORS: Record<Theme, string> = { light: "#f4f5f7", dark: "#14161a" };

export const isTheme = (value: unknown): value is Theme => value === "light" || value === "dark";

export const resolveTheme = (value: string | null | undefined): Theme =>
  isTheme(value) ? value : DEFAULT_THEME;

export const otherTheme = (theme: Theme): Theme => (theme === "dark" ? "light" : "dark");

/** The theme the page shows now. */
export const currentTheme = (doc: Document = document): Theme =>
  resolveTheme(doc.documentElement.dataset.theme);

export function applyTheme(theme: Theme, doc: Document = document): void {
  doc.documentElement.dataset.theme = theme;
  doc.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLORS[theme]);
}

export const storedTheme = (): Theme => resolveTheme(readItem(STORAGE_KEYS.theme));

export const storeTheme = (theme: Theme): void => writeItem(STORAGE_KEYS.theme, theme);

/** Runs in <head> before the first paint (inlined into the page: tiny, no imports). */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
  STORAGE_KEYS.theme,
)});if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}})();`;
