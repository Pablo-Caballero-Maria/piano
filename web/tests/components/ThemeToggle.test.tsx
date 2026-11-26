import { render, screen } from "../render";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { storedTheme } from "@/lib/theme";

afterEach(() => {
  delete document.documentElement.dataset.theme;
});

describe("ThemeToggle", () => {
  it("starts light, switches to dark and back, and remembers the choice", async () => {
    render(<ThemeToggle />);
    await userEvent.click(screen.getByRole("button", { name: "Dark theme" }));
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(storedTheme()).toBe("dark");
    await userEvent.click(await screen.findByRole("button", { name: "Light theme" }));
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});
