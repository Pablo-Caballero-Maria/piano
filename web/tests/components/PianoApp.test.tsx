// The whole page, offline (no server): it renders, switches modes and opens the login.
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PianoApp } from "@/components/app/PianoApp";

describe("PianoApp", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 503 })),
    );
    history.replaceState(null, "", "/");
  });

  it("starts in piano mode, and the tabs switch modes (in the address too)", async () => {
    const view = render(<PianoApp />);
    const piano = view.container.querySelector(".piano-view")!;
    const studio = view.container.querySelector(".studio-view")!;
    await waitFor(() => expect(location.hash).toBe("#piano"));
    expect(piano).toBeVisible();
    expect(studio).not.toBeVisible();
    fireEvent.click(screen.getByRole("tab", { name: /Studio/ }));
    await waitFor(() => expect(location.hash).toBe("#studio"));
    expect(studio).toBeVisible();
    expect(localStorage.getItem("piano-mode")).toBe("studio");
    expect(view.container.querySelectorAll(".roll .pk")).toHaveLength(96);
  });

  it("opens in the mode of the address", async () => {
    history.replaceState(null, "", "/#studio");
    const view = render(<PianoApp />);
    await waitFor(() => expect(view.container.querySelector(".studio-view")).toBeVisible());
  });

  it("logged out and without a server: no class; the account button opens the login", async () => {
    render(<PianoApp />);
    expect(await screen.findByText("Not in a lesson")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Class/ })).toBeDisabled();
    act(() => fireEvent.click(screen.getByRole("button", { name: "Log in" })));
    expect(screen.getByRole("dialog", { name: "Your account" })).toBeVisible();
  });
});
