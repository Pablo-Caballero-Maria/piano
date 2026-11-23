import { afterEach, describe, expect, it } from "vitest";
import {
  applyTheme,
  currentTheme,
  otherTheme,
  resolveTheme,
  storedTheme,
  storeTheme,
  THEME_COLORS,
  THEME_INIT_SCRIPT,
} from "@/lib/theme";

afterEach(() => {
  delete document.documentElement.dataset.theme;
  document.head.innerHTML = "";
});

describe("the theme", () => {
  it("is light unless the dark one was chosen", () => {
    expect(resolveTheme(null)).toBe("light");
    expect(resolveTheme("sepia")).toBe("light");
    expect(resolveTheme("dark")).toBe("dark");
    expect(currentTheme()).toBe("light");
    expect(storedTheme()).toBe("light");
    expect(otherTheme("light")).toBe("dark");
  });

  it("is applied to <html> and the address bar's colour", () => {
    document.head.innerHTML = `<meta name="theme-color" content="${THEME_COLORS.light}">`;
    applyTheme("dark");
    expect(currentTheme()).toBe("dark");
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute("content")).toBe(
      THEME_COLORS.dark,
    );
  });

  it("is remembered, and the <head> script applies it before the first paint", () => {
    storeTheme("dark");
    expect(storedTheme()).toBe("dark");
    new Function(THEME_INIT_SCRIPT)();
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});
